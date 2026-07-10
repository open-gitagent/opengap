import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { loadAgentManifest, loadFileIfExists } from '../utils/loader.js';
import { loadAllSkills, getAllowedTools } from '../utils/skill-loader.js';
import { parseModel } from '../utils/model.js';
import { buildMcpServersMarkdown } from './shared.js';

/**
 * Export a gitagent to Nanobot format.
 *
 * Nanobot uses ~/.nanobot/config.json for configuration
 * and reads system instructions inline. This export produces:
 *   - config.json (providers, agents, model settings)
 *   - system prompt string (instructions for the agent)
 */
export interface NanobotExport {
  config: object;
  systemPrompt: string;
}

export function exportToNanobot(dir: string): NanobotExport {
  const agentDir = resolve(dir);
  const manifest = loadAgentManifest(agentDir);

  const config = buildNanobotConfig(manifest);
  const systemPrompt = buildSystemPrompt(agentDir, manifest);

  return { config, systemPrompt };
}

/**
 * Export as a single string (for `gitagent export -f nanobot`).
 */
export function exportToNanobotString(dir: string): string {
  const exp = exportToNanobot(dir);
  const parts: string[] = [];

  parts.push('# === config.json ===');
  parts.push(JSON.stringify(exp.config, null, 2));

  parts.push('\n# === System Prompt ===');
  parts.push(exp.systemPrompt);

  return parts.join('\n');
}

function buildNanobotConfig(manifest: ReturnType<typeof loadAgentManifest>): object {
  // Canonical "provider:model" → Nanobot "provider/model" form.
  const { provider, modelId } = parseModel(manifest.model?.preferred ?? 'anthropic:claude-sonnet-4-5-20250929');
  const model = `${provider}/${modelId}`;

  const config: Record<string, unknown> = {
    providers: {
      [provider]: {
        apiKey: `\${${provider.toUpperCase()}_API_KEY}`,
      },
    },
    agents: {
      defaults: {
        model,
      },
    },
  };

  return config;
}

function buildSystemPrompt(agentDir: string, manifest: ReturnType<typeof loadAgentManifest>): string {
  const parts: string[] = [];

  // Agent identity
  parts.push(`# ${manifest.name} v${manifest.version}`);
  parts.push(`${manifest.description}\n`);

  // SOUL.md
  const soul = loadFileIfExists(join(agentDir, 'SOUL.md'));
  if (soul) {
    parts.push(soul);
  }

  // RULES.md
  const rules = loadFileIfExists(join(agentDir, 'RULES.md'));
  if (rules) {
    parts.push(rules);
  }

  // Skills
  const skillsDir = join(agentDir, 'skills');
  const skills = loadAllSkills(skillsDir);
  for (const skill of skills) {
    const toolsList = getAllowedTools(skill.frontmatter);
    const toolsNote = toolsList.length > 0 ? `\nAllowed tools: ${toolsList.join(', ')}` : '';
    parts.push(`## Skill: ${skill.frontmatter.name}\n${skill.frontmatter.description}${toolsNote}\n\n${skill.instructions}`);
  }

  // Knowledge (always_load)
  const knowledgeDir = join(agentDir, 'knowledge');
  const indexPath = join(knowledgeDir, 'index.yaml');
  if (existsSync(indexPath)) {
    const index = yaml.load(readFileSync(indexPath, 'utf-8')) as {
      documents?: Array<{ path: string; always_load?: boolean }>;
    };

    if (index.documents) {
      const alwaysLoad = index.documents.filter(d => d.always_load);
      for (const doc of alwaysLoad) {
        const content = loadFileIfExists(join(knowledgeDir, doc.path));
        if (content) {
          parts.push(`## Knowledge: ${doc.path}\n${content}`);
        }
      }
    }
  }

  // Tools
  const toolsDir = join(agentDir, 'tools');
  if (existsSync(toolsDir)) {
    const files = readdirSync(toolsDir).filter(f => f.endsWith('.yaml'));
    if (files.length > 0) {
      const toolParts: string[] = ['## Available Tools\n'];
      for (const file of files) {
        try {
          const content = readFileSync(join(toolsDir, file), 'utf-8');
          const toolConfig = yaml.load(content) as {
            name: string;
            description: string;
            input_schema?: {
              properties?: Record<string, { type: string; description?: string }>;
              required?: string[];
            };
          };
          toolParts.push(`### ${toolConfig.name}`);
          toolParts.push(`${toolConfig.description}\n`);
        } catch { /* skip */ }
      }
      parts.push(toolParts.join('\n'));
    }
  }

  // MCP servers
  const mcpSection = buildMcpServersMarkdown(manifest.mcp_servers);
  if (mcpSection) {
    parts.push(mcpSection);
  }

  // Compliance constraints
  if (manifest.compliance) {
    const c = manifest.compliance;
    const constraints: string[] = [];

    if (c.supervision?.human_in_the_loop === 'always') {
      constraints.push('- All decisions require human approval before execution');
    }
    if (c.communications?.fair_balanced) {
      constraints.push('- All communications must be fair and balanced');
    }
    if (c.communications?.no_misleading) {
      constraints.push('- Never make misleading, exaggerated, or promissory statements');
    }
    if (c.data_governance?.pii_handling === 'redact') {
      constraints.push('- Redact all PII from outputs');
    }
    if (c.data_governance?.pii_handling === 'prohibit') {
      constraints.push('- Do not process any personally identifiable information');
    }

    if (constraints.length > 0) {
      parts.push(`## Compliance Constraints\n${constraints.join('\n')}`);
    }
  }

  // Memory
  const memory = loadFileIfExists(join(agentDir, 'memory', 'MEMORY.md'));
  if (memory && memory.trim().split('\n').length > 2) {
    parts.push(`## Memory\n${memory}`);
  }

  return parts.join('\n\n');
}
