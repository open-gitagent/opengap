import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { loadAgentManifest, loadFileIfExists } from '../utils/loader.js';
import { loadKnowledgeDocument } from '../utils/path-safety.js';
import { loadAllSkills, getAllowedTools } from '../utils/skill-loader.js';
import { buildComplianceSection, buildMcpServersMarkdown } from './shared.js';

/**
 * Export a gitagent to GitHub Copilot CLI format.
 *
 * Copilot CLI uses:
 *   - .github/agents/<name>.agent.md  (agent definition with YAML frontmatter)
 *   - .github/skills/<name>/SKILL.md  (skill files)
 *
 * Returns structured output with all files that should be written.
 */
export interface CopilotExport {
  agentMd: string;
  agentFileName: string;
  skills: Array<{ name: string; content: string }>;
}

export function exportToCopilot(dir: string): CopilotExport {
  const agentDir = resolve(dir);
  const manifest = loadAgentManifest(agentDir);

  const agentFileName = slugify(manifest.name);
  const agentMd = buildAgentMd(agentDir, manifest);
  const skills = collectSkills(agentDir);

  return { agentMd, agentFileName, skills };
}

/**
 * Export as a single string (for `gitagent export -f copilot`).
 */
export function exportToCopilotString(dir: string): string {
  const exp = exportToCopilot(dir);
  const parts: string[] = [];

  parts.push(`# === .github/agents/${exp.agentFileName}.agent.md ===`);
  parts.push(exp.agentMd);

  for (const skill of exp.skills) {
    parts.push(`\n# === .github/skills/${skill.name}/SKILL.md ===`);
    parts.push(skill.content);
  }

  return parts.join('\n');
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildAgentMd(
  agentDir: string,
  manifest: ReturnType<typeof loadAgentManifest>,
): string {
  const parts: string[] = [];

  // YAML frontmatter — Copilot agent.md supports description and tools
  const frontmatter: Record<string, unknown> = {
    description: manifest.description,
  };

  // Collect tool names from tools/ directory
  const toolNames = collectToolNames(agentDir);
  if (toolNames.length > 0) {
    frontmatter.tools = toolNames;
  }

  parts.push('---');
  parts.push(yaml.dump(frontmatter).trimEnd());
  parts.push('---');
  parts.push('');

  // Agent identity
  parts.push(`# ${manifest.name}`);
  parts.push('');

  // SOUL.md
  const soul = loadFileIfExists(join(agentDir, 'SOUL.md'));
  if (soul) {
    parts.push(soul);
    parts.push('');
  }

  // RULES.md
  const rules = loadFileIfExists(join(agentDir, 'RULES.md'));
  if (rules) {
    parts.push(rules);
    parts.push('');
  }

  // DUTIES.md
  const duty = loadFileIfExists(join(agentDir, 'DUTIES.md'));
  if (duty) {
    parts.push(duty);
    parts.push('');
  }

  // Skills
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

  // Knowledge (always_load documents)
  const knowledgeDir = join(agentDir, 'knowledge');
  const indexPath = join(knowledgeDir, 'index.yaml');
  if (existsSync(indexPath)) {
    const index = yaml.load(readFileSync(indexPath, 'utf-8')) as {
      documents?: Array<{ path: string; always_load?: boolean }>;
    };

    if (index?.documents) {
      const alwaysLoad = index.documents.filter(d => d.always_load);
      if (alwaysLoad.length > 0) {
        parts.push('## Knowledge');
        parts.push('');
        for (const doc of alwaysLoad) {
          const content = loadKnowledgeDocument(knowledgeDir, doc.path);
          if (content) {
            parts.push(`### ${doc.path}`);
            parts.push(content);
            parts.push('');
          }
        }
      }
    }
  }

  // MCP servers
  const mcpSection = buildMcpServersMarkdown(manifest.mcp_servers);
  if (mcpSection) {
    parts.push(mcpSection);
  }

  // Compliance constraints
  if (manifest.compliance) {
    const constraints = buildComplianceSection(manifest.compliance);
    if (constraints) {
      parts.push(constraints);
      parts.push('');
    }
  }

  // Memory
  const memory = loadFileIfExists(join(agentDir, 'memory', 'MEMORY.md'));
  if (memory && memory.trim().split('\n').length > 2) {
    parts.push('## Memory');
    parts.push(memory);
    parts.push('');
  }

  return parts.join('\n').trimEnd() + '\n';
}

function collectToolNames(agentDir: string): string[] {
  const toolsDir = join(agentDir, 'tools');
  if (!existsSync(toolsDir)) return [];

  const files = readdirSync(toolsDir).filter(f => f.endsWith('.yaml'));
  const names: string[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(toolsDir, file), 'utf-8');
      const toolConfig = yaml.load(content) as { name?: string };
      if (toolConfig?.name) {
        names.push(toolConfig.name);
      }
    } catch { /* skip malformed tools */ }
  }

  return names;
}

function collectSkills(agentDir: string): Array<{ name: string; content: string }> {
  const skills: Array<{ name: string; content: string }> = [];
  const skillsDir = join(agentDir, 'skills');
  if (!existsSync(skillsDir)) return skills;

  const entries = readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMdPath = join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    skills.push({
      name: entry.name,
      content: readFileSync(skillMdPath, 'utf-8'),
    });
  }

  return skills;
}

