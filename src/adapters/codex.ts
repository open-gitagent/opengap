import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { loadAgentManifest, loadFileIfExists } from '../utils/loader.js';
import { loadAllSkills, getAllowedTools } from '../utils/skill-loader.js';
import { parseModel } from '../utils/model.js';
import { buildComplianceSection, buildMcpServersConfig } from './shared.js';

/**
 * Export a gitagent to OpenAI Codex CLI format.
 *
 * Codex CLI (openai/codex) uses:
 *   - AGENTS.md              (custom agent instructions, project root)
 *   - codex.json             (model and provider configuration)
 *
 * Reference: https://github.com/openai/codex
 */
export interface CodexExport {
  /** Content for AGENTS.md */
  instructions: string;
  /** Content for codex.json */
  config: Record<string, unknown>;
}

/**
 * Export a gitagent directory to Codex CLI format.
 */
export function exportToCodex(dir: string): CodexExport {
  const agentDir = resolve(dir);
  const manifest = loadAgentManifest(agentDir);

  const instructions = buildInstructions(agentDir, manifest);
  const config = buildConfig(manifest);

  return { instructions, config };
}

/**
 * Export as a single string (for `gitagent export -f codex`).
 */
export function exportToCodexString(dir: string): string {
  const exp = exportToCodex(dir);
  const parts: string[] = [];

  parts.push('# === AGENTS.md ===');
  parts.push(exp.instructions);
  parts.push('\n# === codex.json ===');
  parts.push(JSON.stringify(exp.config, null, 2));

  return parts.join('\n');
}

function buildInstructions(
  agentDir: string,
  manifest: ReturnType<typeof loadAgentManifest>,
): string {
  const parts: string[] = [];

  // Agent identity
  parts.push(`# ${manifest.name}`);
  parts.push(`${manifest.description}`);
  parts.push('');

  // SOUL.md — persona / identity
  const soul = loadFileIfExists(join(agentDir, 'SOUL.md'));
  if (soul) {
    parts.push(soul);
    parts.push('');
  }

  // RULES.md — constraints and operational rules
  const rules = loadFileIfExists(join(agentDir, 'RULES.md'));
  if (rules) {
    parts.push(rules);
    parts.push('');
  }

  // DUTIES.md — segregation of duties policy
  const duty = loadFileIfExists(join(agentDir, 'DUTIES.md'));
  if (duty) {
    parts.push(duty);
    parts.push('');
  }

  // Skills — include full instructions (Codex reads AGENTS.md as a single file)
  const skillsDir = join(agentDir, 'skills');
  const skills = loadAllSkills(skillsDir);
  if (skills.length > 0) {
    parts.push('## Skills');
    parts.push('');
    for (const skill of skills) {
      const toolsList = getAllowedTools(skill.frontmatter);
      const toolsNote = toolsList.length > 0 ? `\nAllowed tools: ${toolsList.join(', ')}` : '';
      parts.push(`### ${skill.frontmatter.name}`);
      parts.push(`${skill.frontmatter.description}${toolsNote}`);
      parts.push('');
      parts.push(skill.instructions);
      parts.push('');
    }
  }

  // Tools
  const toolsDir = join(agentDir, 'tools');
  if (existsSync(toolsDir)) {
    const toolFiles = readdirSync(toolsDir).filter(f => f.endsWith('.yaml'));
    if (toolFiles.length > 0) {
      parts.push('## Tools');
      parts.push('');
      for (const file of toolFiles) {
        try {
          const content = readFileSync(join(toolsDir, file), 'utf-8');
          const toolConfig = yaml.load(content) as {
            name?: string;
            description?: string;
            input_schema?: Record<string, unknown>;
          };
          if (toolConfig?.name) {
            parts.push(`### ${toolConfig.name}`);
            if (toolConfig.description) {
              parts.push(toolConfig.description);
            }
            if (toolConfig.input_schema) {
              parts.push('');
              parts.push('```yaml');
              parts.push(yaml.dump(toolConfig.input_schema).trimEnd());
              parts.push('```');
            }
            parts.push('');
          }
        } catch { /* skip malformed tools */ }
      }
    }
  }

  // Knowledge (always_load documents)
  const knowledgeDir = join(agentDir, 'knowledge');
  const indexPath = join(knowledgeDir, 'index.yaml');
  if (existsSync(indexPath)) {
    const index = yaml.load(readFileSync(indexPath, 'utf-8')) as {
      documents?: Array<{ path: string; always_load?: boolean }>;
    };

    if (index.documents) {
      const alwaysLoad = index.documents.filter(d => d.always_load);
      if (alwaysLoad.length > 0) {
        parts.push('## Knowledge');
        parts.push('');
        for (const doc of alwaysLoad) {
          const content = loadFileIfExists(join(knowledgeDir, doc.path));
          if (content) {
            parts.push(`### ${doc.path}`);
            parts.push(content);
            parts.push('');
          }
        }
      }
    }
  }

  // Compliance constraints
  if (manifest.compliance) {
    const constraints = buildComplianceSection(manifest.compliance);
    if (constraints) {
      parts.push(constraints);
      parts.push('');
    }
  }

  return parts.join('\n').trimEnd() + '\n';
}

function buildConfig(manifest: ReturnType<typeof loadAgentManifest>): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  // Canonical "provider:model" → Codex CLI { model, provider? }
  // Codex defaults to openai; any non-openai provider is reached via its openai-compatible endpoint.
  if (manifest.model?.preferred) {
    const { provider, modelId } = parseModel(manifest.model.preferred);
    config.model = modelId;
    if (provider !== 'openai' && provider !== 'openai-codex') {
      config.provider = 'openai-compatible';
    }
  }

  // MCP servers
  const mcpServers = buildMcpServersConfig(manifest.mcp_servers);
  if (mcpServers) {
    config.mcpServers = mcpServers;
  }

  return config;
}

