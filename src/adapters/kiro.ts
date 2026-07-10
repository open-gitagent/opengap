import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { loadAgentManifest, loadFileIfExists } from '../utils/loader.js';
import { loadAllSkills, getAllowedTools } from '../utils/skill-loader.js';
import { parseModel } from '../utils/model.js';
import { buildComplianceSection } from './shared.js';

/**
 * Export a gitagent to AWS Kiro CLI custom agent format.
 *
 * Kiro CLI uses a JSON config file (`.kiro/agents/<name>.json`) with:
 *   - name, description, prompt (inline or file:// URI)
 *   - mcpServers, tools, allowedTools
 *   - model, hooks, resources
 *
 * Reference: https://kiro.dev/docs/cli/custom-agents/configuration-reference/
 */
export interface KiroExport {
  config: Record<string, unknown>;
  prompt: string;
}

export function exportToKiro(dir: string): KiroExport {
  const agentDir = resolve(dir);
  const manifest = loadAgentManifest(agentDir);

  const prompt = buildPrompt(agentDir, manifest);
  const config = buildConfig(agentDir, manifest);

  return { config, prompt };
}

export function exportToKiroString(dir: string): string {
  const exp = exportToKiro(dir);
  const parts: string[] = [];

  parts.push('# === .kiro/agents/<name>.json ===');
  parts.push(JSON.stringify(exp.config, null, 2));
  parts.push('\n# === prompt.md (referenced via file://./prompt.md) ===');
  parts.push(exp.prompt);

  return parts.join('\n');
}

function buildPrompt(
  agentDir: string,
  manifest: ReturnType<typeof loadAgentManifest>,
): string {
  const parts: string[] = [];

  parts.push(`# ${manifest.name}`);
  parts.push(`${manifest.description}`);
  parts.push('');

  const soul = loadFileIfExists(join(agentDir, 'SOUL.md'));
  if (soul) {
    parts.push(soul);
    parts.push('');
  }

  const rules = loadFileIfExists(join(agentDir, 'RULES.md'));
  if (rules) {
    parts.push(rules);
    parts.push('');
  }

  const duty = loadFileIfExists(join(agentDir, 'DUTIES.md'));
  if (duty) {
    parts.push(duty);
    parts.push('');
  }

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

  if (manifest.compliance) {
    const constraints = buildComplianceSection(manifest.compliance);
    if (constraints) {
      parts.push(constraints);
      parts.push('');
    }
  }

  return parts.join('\n').trimEnd() + '\n';
}

function buildConfig(
  agentDir: string,
  manifest: ReturnType<typeof loadAgentManifest>,
): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  config.name = manifest.name;
  if (manifest.description) {
    config.description = manifest.description;
  }

  // Use file:// URI for prompt so the markdown file is maintained separately
  config.prompt = 'file://./prompt.md';

  if (manifest.model?.preferred) {
    config.model = parseModel(manifest.model.preferred).modelId;
  }

  // Collect tools from skills and tool definitions
  const tools = collectTools(agentDir);
  if (tools.length > 0) {
    config.tools = tools;
    config.allowedTools = tools;
  }

  // Map MCP servers from tools/*.yaml that declare mcp_server
  const mcpServers = collectMcpServers(agentDir);
  if (Object.keys(mcpServers).length > 0) {
    config.mcpServers = mcpServers;
  }

  // Hooks
  const hooks = buildHooks(agentDir);
  if (hooks && Object.keys(hooks).length > 0) {
    config.hooks = hooks;
  }

  // Sub-agents as welcome message hint
  if (manifest.agents && Object.keys(manifest.agents).length > 0) {
    const agentNames = Object.keys(manifest.agents);
    config.welcomeMessage = `This agent delegates to: ${agentNames.join(', ')}`;
  }

  return config;
}

function collectTools(agentDir: string): string[] {
  const tools: Set<string> = new Set();

  const skillsDir = join(agentDir, 'skills');
  const skills = loadAllSkills(skillsDir);
  for (const skill of skills) {
    for (const tool of getAllowedTools(skill.frontmatter)) {
      tools.add(tool);
    }
  }

  const toolsDir = join(agentDir, 'tools');
  if (existsSync(toolsDir)) {
    const files = readdirSync(toolsDir).filter(f => f.endsWith('.yaml'));
    for (const file of files) {
      try {
        const content = readFileSync(join(toolsDir, file), 'utf-8');
        const toolConfig = yaml.load(content) as { name?: string };
        if (toolConfig?.name) {
          tools.add(toolConfig.name);
        }
      } catch { /* skip malformed tools */ }
    }
  }

  return Array.from(tools);
}

function collectMcpServers(agentDir: string): Record<string, Record<string, unknown>> {
  const servers: Record<string, Record<string, unknown>> = {};

  const toolsDir = join(agentDir, 'tools');
  if (!existsSync(toolsDir)) return servers;

  const files = readdirSync(toolsDir).filter(f => f.endsWith('.yaml'));
  for (const file of files) {
    try {
      const content = readFileSync(join(toolsDir, file), 'utf-8');
      const toolConfig = yaml.load(content) as {
        mcp_server?: {
          name?: string;
          command?: string;
          args?: string[];
          env?: Record<string, string>;
          type?: string;
          url?: string;
        };
      };
      if (toolConfig?.mcp_server?.name) {
        const mcp = toolConfig.mcp_server;
        const entry: Record<string, unknown> = {};
        if (mcp.type) entry.type = mcp.type;
        if (mcp.command) entry.command = mcp.command;
        if (mcp.args) entry.args = mcp.args;
        if (mcp.env) entry.env = mcp.env;
        if (mcp.url) entry.url = mcp.url;
        servers[mcp.name!] = entry;
      }
    } catch { /* skip malformed tools */ }
  }

  return servers;
}

function buildHooks(agentDir: string): Record<string, unknown> | null {
  try {
    const hooksPath = join(agentDir, 'hooks', 'hooks.yaml');
    if (!existsSync(hooksPath)) return null;

    const hooksYaml = readFileSync(hooksPath, 'utf-8');
    const hooksConfig = yaml.load(hooksYaml) as {
      hooks: Record<string, Array<{ script: string; description?: string }>>;
    };

    if (!hooksConfig.hooks || Object.keys(hooksConfig.hooks).length === 0) return null;

    // Kiro CLI hook events use camelCase: preToolUse, postToolUse, stop, agentSpawn, userPromptSubmit
    const eventMap: Record<string, string> = {
      'on_session_start': 'agentSpawn',
      'pre_tool_use': 'preToolUse',
      'post_tool_use': 'postToolUse',
      'pre_response': 'userPromptSubmit',
      'on_session_end': 'stop',
    };

    const kiroHooks: Record<string, Array<{ command: string }>> = {};

    for (const [event, hooks] of Object.entries(hooksConfig.hooks)) {
      const kiroEvent = eventMap[event];
      if (!kiroEvent) continue;

      const validHooks = hooks.filter(hook =>
        existsSync(join(agentDir, 'hooks', hook.script))
      );
      if (validHooks.length === 0) continue;

      kiroHooks[kiroEvent] = validHooks.map(hook => ({
        command: `hooks/${hook.script}`,
      }));
    }

    return Object.keys(kiroHooks).length > 0 ? kiroHooks : null;
  } catch {
    return null;
  }
}