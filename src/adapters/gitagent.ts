import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { loadAgentManifest, loadFileIfExists } from '../utils/loader.js';
import { loadAllSkills } from '../utils/skill-loader.js';

/**
 * Export a gitagent to gitagent format.
 *
 * Gitagent uses the same git-native directory structure but with differences:
 *   - agent.yaml model format: "provider:model-id" (colon, not slash)
 *   - knowledge/index.yaml uses "entries" (not "documents")
 *   - tools are a flat string array of built-in names in agent.yaml
 *   - Has plugins section
 *
 * Most files (SOUL.md, RULES.md, DUTIES.md, skills/, hooks/) pass through
 * unchanged. The adapter transforms agent.yaml and knowledge/index.yaml.
 */
export interface GitagentExport {
  agentYaml: string;
  soulMd: string | null;
  rulesMd: string | null;
  dutiesMd: string | null;
  knowledgeIndex: string | null;
  skills: Array<{ name: string; content: string }>;
  tools: Array<{ name: string; content: string }>;
  hooks: string | null;
}

export function exportToGitagent(dir: string): GitagentExport {
  const agentDir = resolve(dir);
  const manifest = loadAgentManifest(agentDir);

  const agentYaml = buildAgentYaml(agentDir, manifest);
  const soulMd = loadFileIfExists(join(agentDir, 'SOUL.md'));
  const rulesMd = loadFileIfExists(join(agentDir, 'RULES.md'));
  const dutiesMd = loadFileIfExists(join(agentDir, 'DUTIES.md'));
  const knowledgeIndex = buildKnowledgeIndex(agentDir);
  const skills = collectSkills(agentDir);
  const tools = collectTools(agentDir);
  const hooks = loadFileIfExists(join(agentDir, 'hooks', 'hooks.yaml'));

  return { agentYaml, soulMd, rulesMd, dutiesMd, knowledgeIndex, skills, tools, hooks };
}

export function exportToGitagentString(dir: string): string {
  const exp = exportToGitagent(dir);
  const parts: string[] = [];

  parts.push('# === agent.yaml ===');
  parts.push(exp.agentYaml);

  if (exp.soulMd) {
    parts.push('\n# === SOUL.md ===');
    parts.push(exp.soulMd);
  }

  if (exp.rulesMd) {
    parts.push('\n# === RULES.md ===');
    parts.push(exp.rulesMd);
  }

  if (exp.dutiesMd) {
    parts.push('\n# === DUTIES.md ===');
    parts.push(exp.dutiesMd);
  }

  if (exp.knowledgeIndex) {
    parts.push('\n# === knowledge/index.yaml ===');
    parts.push(exp.knowledgeIndex);
  }

  for (const skill of exp.skills) {
    parts.push(`\n# === skills/${skill.name}/SKILL.md ===`);
    parts.push(skill.content);
  }

  for (const tool of exp.tools) {
    parts.push(`\n# === tools/${tool.name} ===`);
    parts.push(tool.content);
  }

  if (exp.hooks) {
    parts.push('\n# === hooks/hooks.yaml ===');
    parts.push(exp.hooks);
  }

  return parts.join('\n');
}

function buildAgentYaml(
  agentDir: string,
  manifest: ReturnType<typeof loadAgentManifest>,
): string {
  const gc: Record<string, unknown> = {
    spec_version: '0.1.0',
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
  };

  if (manifest.author) gc.author = manifest.author;
  if (manifest.license) gc.license = manifest.license;

  // Model: convert to gitagent "provider:model-id" format
  if (manifest.model) {
    const model: Record<string, unknown> = {};
    if (manifest.model.preferred) {
      model.preferred = toGitagentModel(manifest.model.preferred);
    }
    if (manifest.model.fallback) {
      model.fallback = manifest.model.fallback.map(toGitagentModel);
    }
    if (manifest.model.constraints) {
      model.constraints = manifest.model.constraints;
    }
    gc.model = model;
  }

  // Tools: collect tool names as flat string array
  const toolNames = collectToolNames(agentDir);
  if (toolNames.length > 0) {
    gc.tools = toolNames;
  }

  // Skills: list skill names
  if (manifest.skills && manifest.skills.length > 0) {
    gc.skills = manifest.skills;
  }

  // Runtime
  if (manifest.runtime) {
    gc.runtime = manifest.runtime;
  }

  // Extends
  if (manifest.extends) {
    gc.extends = manifest.extends;
  }

  // Delegation
  if (manifest.delegation) {
    gc.delegation = manifest.delegation;
  }

  // Sub-agents
  if (manifest.agents) {
    gc.agents = manifest.agents;
  }

  return yaml.dump(gc, { lineWidth: 120 });
}

/**
 * Convert gitagent model name to gitagent "provider:model-id" format.
 * gitagent: "claude-sonnet-4-5" or "anthropic/claude-sonnet-4-5"
 * gitagent:  "anthropic:claude-sonnet-4-5"
 */
function toGitagentModel(model: string): string {
  // Already in provider:model format
  if (model.includes(':') && !model.includes('://')) return model;

  // provider/model → provider:model
  if (model.includes('/')) {
    return model.replace('/', ':');
  }

  // Infer provider from model name
  if (model.startsWith('claude') || model.includes('anthropic')) return `anthropic:${model}`;
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')) return `openai:${model}`;
  if (model.startsWith('gemini')) return `google:${model}`;
  if (model.startsWith('deepseek')) return `deepseek:${model}`;
  if (model.startsWith('llama') || model.startsWith('mistral')) return `ollama:${model}`;
  return `openai:${model}`;
}

function collectToolNames(agentDir: string): string[] {
  const names: string[] = [];
  const toolsDir = join(agentDir, 'tools');
  if (!existsSync(toolsDir)) return names;

  const files = readdirSync(toolsDir).filter(f => f.endsWith('.yaml'));
  for (const file of files) {
    try {
      const content = readFileSync(join(toolsDir, file), 'utf-8');
      const toolConfig = yaml.load(content) as { name?: string };
      if (toolConfig?.name) names.push(toolConfig.name);
    } catch { /* skip malformed tools */ }
  }
  return names;
}

/**
 * Convert gitagent knowledge/index.yaml (documents) to gitagent format (entries).
 */
function buildKnowledgeIndex(agentDir: string): string | null {
  const indexPath = join(agentDir, 'knowledge', 'index.yaml');
  if (!existsSync(indexPath)) return null;

  try {
    const raw = yaml.load(readFileSync(indexPath, 'utf-8')) as {
      documents?: Array<{ path: string; always_load?: boolean; tags?: string[] }>;
    };

    if (!raw?.documents || raw.documents.length === 0) return null;

    const entries = raw.documents.map(doc => ({
      path: doc.path,
      always_load: doc.always_load ?? false,
      ...(doc.tags ? { tags: doc.tags } : {}),
      priority: doc.always_load ? 'high' : 'medium',
    }));

    return yaml.dump({ entries }, { lineWidth: 120 });
  } catch {
    return null;
  }
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

function collectTools(agentDir: string): Array<{ name: string; content: string }> {
  const tools: Array<{ name: string; content: string }> = [];
  const toolsDir = join(agentDir, 'tools');
  if (!existsSync(toolsDir)) return tools;

  const files = readdirSync(toolsDir).filter(f => f.endsWith('.yaml'));
  for (const file of files) {
    tools.push({
      name: file,
      content: readFileSync(join(toolsDir, file), 'utf-8'),
    });
  }
  return tools;
}
