import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { loadAgentManifest, loadFileIfExists } from '../utils/loader.js';
import { loadAllSkills, getAllowedTools } from '../utils/skill-loader.js';
import { buildComplianceSection, buildMcpServersConfig } from './shared.js';

/**
 * Export a gitagent to Google Gemini CLI format.
 *
 * Gemini CLI uses:
 *   - GEMINI.md              (custom agent instructions, project root or ~/.gemini/GEMINI.md)
 *   - .gemini/settings.json  (model configuration, tool permissions, approval mode)
 *
 * Returns structured output with all files that should be written.
 */
export interface GeminiExport {
  instructions: string;
  settings: Record<string, unknown>;
}

export function exportToGemini(dir: string): GeminiExport {
  const agentDir = resolve(dir);
  const manifest = loadAgentManifest(agentDir);

  const instructions = buildInstructions(agentDir, manifest);
  const settings = buildSettings(agentDir, manifest);

  return { instructions, settings };
}

/**
 * Export as a single string (for `gitagent export -f gemini`).
 */
export function exportToGeminiString(dir: string): string {
  const exp = exportToGemini(dir);
  const parts: string[] = [];

  parts.push('# === GEMINI.md ===');
  parts.push(exp.instructions);
  parts.push('\n# === .gemini/settings.json ===');
  parts.push(JSON.stringify(exp.settings, null, 2));

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

  // SOUL.md → identity section
  const soul = loadFileIfExists(join(agentDir, 'SOUL.md'));
  if (soul) {
    parts.push(soul);
    parts.push('');
  }

  // RULES.md → constraints section
  const rules = loadFileIfExists(join(agentDir, 'RULES.md'));
  if (rules) {
    parts.push(rules);
    parts.push('');
  }

  // DUTIES.md → segregation of duties policy
  const duty = loadFileIfExists(join(agentDir, 'DUTIES.md'));
  if (duty) {
    parts.push(duty);
    parts.push('');
  }

  // Skills — loaded via skill-loader (progressive disclosure)
  const skillsDir = join(agentDir, 'skills');
  const skills = loadAllSkills(skillsDir);
  if (skills.length > 0) {
    parts.push('## Skills');
    parts.push('');
    for (const skill of skills) {
      const skillDirName = skill.directory.split(/[/\\]/).pop()!;
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

  // Sub-agents (document as delegation pattern since Gemini CLI doesn't have native support)
  if (manifest.agents && Object.keys(manifest.agents).length > 0) {
    parts.push('## Delegation Pattern');
    parts.push('');
    parts.push('This agent uses sub-agents for specialized tasks:');
    parts.push('');
    for (const [name, config] of Object.entries(manifest.agents)) {
      parts.push(`### ${name}`);
      if (config.description) {
        parts.push(config.description);
      }
      if (config.delegation?.triggers) {
        parts.push(`Triggers: ${config.delegation.triggers.join(', ')}`);
      }
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

function buildSettings(
  agentDir: string,
  manifest: ReturnType<typeof loadAgentManifest>,
): Record<string, unknown> {
  const settings: Record<string, unknown> = {};

  // Model preference - Gemini CLI expects object format
  if (manifest.model?.preferred) {
    // Extract provider from model name or default to google
    const modelName = manifest.model.preferred;
    const provider = modelName.includes('claude') ? 'anthropic' : 
                     modelName.includes('gpt') ? 'openai' : 'google';
    
    settings.model = {
      id: modelName,
      provider: provider
    };
  }

  // Collect allowed tools from skills and tool definitions
  const allowedTools = collectAllowedTools(agentDir);
  if (allowedTools.length > 0) {
    settings.allowedTools = allowedTools;
  }

  // Approval mode from compliance supervision
  if (manifest.compliance?.supervision?.human_in_the_loop) {
    const hitl = manifest.compliance.supervision.human_in_the_loop;
    if (hitl === 'always') {
      settings.approvalMode = 'plan'; // read-only mode
    } else if (hitl === 'conditional') {
      settings.approvalMode = 'default'; // prompt for approval
    } else if (hitl === 'none') {
      settings.approvalMode = 'yolo'; // auto-approve all
    } else if (hitl === 'advisory') {
      settings.approvalMode = 'auto_edit'; // auto-approve edits only
    }
  }

  // Policy files (if they exist in compliance/)
  const policyDir = join(agentDir, 'compliance');
  if (existsSync(policyDir)) {
    const policyFiles = readdirSync(policyDir).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
    if (policyFiles.length > 0) {
      settings.policy = policyFiles.map(f => `compliance/${f}`);
    }
  }

  // Hooks mapping
  const hooksConfig = buildHooksConfig(agentDir);
  if (hooksConfig && Object.keys(hooksConfig).length > 0) {
    settings.hooks = hooksConfig;
  }

  // MCP servers
  const mcpServers = buildMcpServersConfig(manifest.mcp_servers);
  settings.mcpServers = mcpServers ?? {};

  return settings;
}

/**
 * Collect allowed tools from skills (allowed-tools frontmatter)
 * and tool definitions (tools/*.yaml names).
 */
function collectAllowedTools(agentDir: string): string[] {
  const tools: Set<string> = new Set();

  // From skills' allowed-tools
  const skillsDir = join(agentDir, 'skills');
  const skills = loadAllSkills(skillsDir);
  for (const skill of skills) {
    for (const tool of getAllowedTools(skill.frontmatter)) {
      tools.add(tool);
    }
  }

  // From tools/*.yaml definitions
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

/**
 * Map hooks/hooks.yaml to Gemini CLI hooks format.
 *
 * Gemini CLI expects hooks in settings.json.
 */
function buildHooksConfig(agentDir: string): Record<string, any> | null {
  try {
    const hooksPath = join(agentDir, 'hooks', 'hooks.yaml');
    if (!existsSync(hooksPath)) {
      return null;
    }

    const hooksYaml = readFileSync(hooksPath, 'utf-8');
    const hooksConfig = yaml.load(hooksYaml) as { hooks: Record<string, Array<{ script: string; description?: string }>> };

    if (!hooksConfig.hooks || Object.keys(hooksConfig.hooks).length === 0) {
      return null;
    }
    
    // Map gitagent hook events to Gemini CLI hook events
    // Gemini CLI uses PascalCase event names
    const eventMap: Record<string, string> = {
      'on_session_start': 'SessionStart',
      'on_session_end': 'SessionEnd',
      'pre_tool_use': 'BeforeTool',
      'post_tool_use': 'AfterTool',
      'pre_agent': 'BeforeAgent',
      'post_agent': 'AfterAgent',
      'pre_model': 'BeforeModel',
      'post_model': 'AfterModel',
      'pre_response': 'AfterModel',  // Runs after model generates response
      'post_response': 'AfterAgent', // Runs after agent loop completes
      'on_error': 'Notification',    // Map errors to notification system
    };

    // Gemini CLI uses a matcher-based structure for hooks
    const geminiHooks: Record<string, Array<{
      matcher: string;
      hooks: Array<{
        name: string;
        type: string;
        command: string;
        description?: string;
      }>;
    }>> = {};

    for (const [event, hooks] of Object.entries(hooksConfig.hooks)) {
      const geminiEvent = eventMap[event] || event;
      
      // Filter out hooks whose script files don't exist
      // Scripts are relative to the hooks directory
      const validHooks = hooks.filter(hook => {
        const scriptPath = join(agentDir, 'hooks', hook.script);
        return existsSync(scriptPath);
      });

      // Skip this event if no valid hooks remain
      if (validHooks.length === 0) continue;

      if (!geminiHooks[geminiEvent]) {
        geminiHooks[geminiEvent] = [];
      }

      // Convert each hook to Gemini CLI format with matcher
      const geminiHookDefs = validHooks.map((hook, index) => {
        // On Windows, Gemini CLI uses PowerShell which can't run .sh files directly
        // Prefix with 'bash' and include hooks/ directory path
        let command = `hooks/${hook.script}`;
        if (process.platform === 'win32' && hook.script.endsWith('.sh')) {
          command = `bash ${command}`;
        }
        
        return {
          name: `hook-${index}`,
          type: 'command',
          command: command,
          description: hook.description,
        };
      });

      // Wrap hooks in a matcher object (use '*' to match all)
      geminiHooks[geminiEvent].push({
        matcher: '*',
        hooks: geminiHookDefs,
      });
    }

    return Object.keys(geminiHooks).length > 0 ? geminiHooks : null;
  } catch (err) {
    console.warn(`Hook config parse failed: ${(err as Error).message}`);
    return null;
  }
}
