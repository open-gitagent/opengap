import { writeFileSync, unlinkSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import yaml from 'js-yaml';
import { exportToSystemPrompt } from '../adapters/system-prompt.js';
import { AgentManifest } from '../utils/loader.js';
import { loadAllSkills, getAllowedTools } from '../utils/skill-loader.js';
import { parseModel } from '../utils/model.js';
import { error, info, warn } from '../utils/format.js';

export interface ClaudeRunOptions {
  prompt?: string;
  workspace?: string;
  /** Continue the most recent Claude Code conversation in the working directory. */
  continue?: boolean;
  /** Resume a specific Claude Code session by its session ID. */
  resume?: string;
  /** Start the conversation with a specific session ID (UUID) so it can be resumed later. */
  sessionId?: string;
}

export function runWithClaude(agentDir: string, manifest: AgentManifest, options: ClaudeRunOptions = {}): void {
  const systemPrompt = exportToSystemPrompt(agentDir);
  const tmpFiles: string[] = [];

  const promptFile = join(tmpdir(), `gitagent-${randomBytes(4).toString('hex')}.md`);
  writeFileSync(promptFile, systemPrompt, 'utf-8');
  tmpFiles.push(promptFile);

  const args: string[] = [];

  // Model (canonical provider:model → Claude CLI wants the bare model id)
  if (manifest.model?.preferred) {
    args.push('--model', parseModel(manifest.model.preferred).modelId);
  }

  // Fallback model
  if (manifest.model?.fallback?.length) {
    args.push('--fallback-model', parseModel(manifest.model.fallback[0]).modelId);
  }

  // Max turns
  if (manifest.runtime?.max_turns) {
    args.push('--max-turns', String(manifest.runtime.max_turns));
  }

  // Permission mode from compliance supervision
  if (manifest.compliance?.supervision?.human_in_the_loop === 'always') {
    args.push('--permission-mode', 'plan');
    info('Compliance: human_in_the_loop=always → using plan permission mode');
  }

  // Collect allowed tools from skills and tool definitions
  const allowedTools = collectAllowedTools(agentDir);
  if (allowedTools.length > 0) {
    for (const tool of allowedTools) {
      args.push('--allowedTools', tool);
    }
  }

  // Map sub-agents from agents/ directory
  const subagents = buildSubagentConfig(agentDir, manifest);
  if (subagents) {
    args.push('--agents', JSON.stringify(subagents));
  }

  // Add knowledge and skill directories as extra working dirs
  const extraDirs = collectExtraDirs(agentDir);
  for (const dir of extraDirs) {
    args.push('--add-dir', dir);
  }

  // Map hooks to Claude Code settings
  const settingsFile = buildHooksSettings(agentDir);
  if (settingsFile) {
    args.push('--settings', settingsFile);
    tmpFiles.push(settingsFile);
  }

  // Session continuation — maps to Claude Code's native session flags.
  // --continue resumes the most recent conversation in the working directory,
  // so it pairs with --workspace: the session is looked up in runCwd.
  if (options.continue && options.resume) {
    error('--continue and --resume are mutually exclusive');
    process.exitCode = 1;
    return;
  }
  if (options.continue) {
    args.push('--continue');
    info('Continuing most recent Claude Code session in the working directory');
  }
  if (options.resume) {
    args.push('--resume', options.resume);
    info(`Resuming Claude Code session ${options.resume}`);
  }
  if (options.sessionId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.sessionId)) {
      error(`--session-id must be a valid UUID, got: ${options.sessionId}`);
      process.exitCode = 1;
      return;
    }
    args.push('--session-id', options.sessionId);
  }

  // Initial prompt (print mode)
  if (options.prompt) {
    args.push('-p', options.prompt);
  }

  // Append system prompt LAST to prevent the long prompt string
  // from interfering with argument parsing of other flags
  args.push('--append-system-prompt', systemPrompt);

  const runCwd = resolve(options.workspace ?? agentDir);

  info(`Launching Claude Code with agent "${manifest.name}"...`);
  info(`Working directory: ${runCwd}`);

  // Resolve the real Claude Code binary, skipping any node_modules/.bin/claude
  // that may shadow it (e.g. when running via npx)
  const claudePath = resolveClaudeBinary();
  info(`Claude binary: ${claudePath}`);

  try {
    const result = spawnSync(claudePath, args, {
      stdio: 'inherit',
      cwd: runCwd,
    });

    if (result.error) {
      error(`Failed to launch Claude Code: ${result.error.message}`);
      info('Make sure Claude Code CLI is installed: npm install -g @anthropic-ai/claude-code');
      process.exitCode = 1;
      return;
    }

    process.exitCode = result.status ?? 0;
  } finally {
    for (const f of tmpFiles) {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
  }
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
 * Build --agents JSON config from agents/ directory sub-agents.
 */
function buildSubagentConfig(agentDir: string, manifest: AgentManifest): object[] | null {
  if (!manifest.agents) return null;

  const agents: object[] = [];
  for (const [name, config] of Object.entries(manifest.agents)) {
    const subDir = join(agentDir, 'agents', name);
    let instructions = config.description ?? '';

    // Load sub-agent's SOUL.md if it exists
    const soulPath = join(subDir, 'SOUL.md');
    if (existsSync(soulPath)) {
      instructions += '\n\n' + readFileSync(soulPath, 'utf-8');
    }

    agents.push({
      name,
      description: config.description ?? name,
      instructions,
      ...(config.delegation?.triggers ? { triggers: config.delegation.triggers } : {}),
    });
  }

  return agents.length > 0 ? agents : null;
}

/**
 * Collect extra directories (knowledge, skills) to add via --add-dir.
 */
function collectExtraDirs(agentDir: string): string[] {
  const dirs: string[] = [];

  const knowledgeDir = join(agentDir, 'knowledge');
  if (existsSync(knowledgeDir)) {
    dirs.push(knowledgeDir);
  }

  const skillsDir = join(agentDir, 'skills');
  if (existsSync(skillsDir)) {
    dirs.push(skillsDir);
  }

  return dirs;
}

/**
 * Map hooks/hooks.yaml to Claude Code settings format.
 *
 * Claude Code expects:
 * {
 *   hooks: {
 *     "<event>": [
 *       { matcher: "<pattern>", hooks: [{ type: "command", command: "..." }] }
 *     ]
 *   }
 * }
 */
function buildHooksSettings(agentDir: string): string | null {
  const hooksPath = join(agentDir, 'hooks', 'hooks.yaml');
  if (!existsSync(hooksPath)) return null;

  try {
    const content = readFileSync(hooksPath, 'utf-8');
    const hooksConfig = yaml.load(content) as {
      hooks?: Record<string, Array<{
        script: string;
        description?: string;
        timeout?: number;
      }>>;
    };

    if (!hooksConfig?.hooks) return null;

    // Map gitagent hook events to Claude Code hook events
    const eventMap: Record<string, string> = {
      'on_session_start': 'SessionStart',
      'pre_tool_use': 'PreToolUse',
      'post_tool_use': 'PostToolUse',
      'pre_response': 'UserPromptSubmit',
      'post_response': 'Stop',
      'on_error': 'PostToolUseFailure',
      'on_session_end': 'SessionEnd',
    };

    const ccHooks: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>> = {};

    for (const [event, hooks] of Object.entries(hooksConfig.hooks)) {
      const ccEvent = eventMap[event];
      if (!ccEvent) continue;

      if (!ccHooks[ccEvent]) {
        ccHooks[ccEvent] = [];
      }

      const hookCommands: Array<{ type: string; command: string }> = [];
      for (const hook of hooks) {
        const scriptPath = join(agentDir, 'hooks', hook.script);
        if (existsSync(scriptPath)) {
          hookCommands.push({
            type: 'command',
            command: `bash ${scriptPath}`,
          });
        }
      }

      if (hookCommands.length > 0) {
        ccHooks[ccEvent].push({
          matcher: '',
          hooks: hookCommands,
        });
      }
    }

    if (Object.keys(ccHooks).length === 0) return null;

    const settings = { hooks: ccHooks };
    const tmpFile = join(tmpdir(), `gitagent-hooks-${randomBytes(4).toString('hex')}.json`);
    writeFileSync(tmpFile, JSON.stringify(settings, null, 2), 'utf-8');

    const totalHooks = Object.values(ccHooks).reduce((sum, entries) => sum + entries.reduce((s, e) => s + e.hooks.length, 0), 0);
    warn(`Mapped ${totalHooks} hooks to Claude Code settings`);
    return tmpFile;
  } catch {
    return null;
  }
}

/**
 * Resolve the real Claude Code CLI binary, skipping node_modules/.bin/claude
 * which may be a different package shadowing the real one (common with npx).
 */
function resolveClaudeBinary(): string {
  const result = spawnSync('which', ['-a', 'claude'], { encoding: 'utf-8' });
  if (result.status === 0) {
    const paths = result.stdout.trim().split('\n').filter(Boolean);
    // Prefer the first path that is NOT inside node_modules
    const realClaude = paths.find(p => !p.includes('node_modules'));
    if (realClaude) return realClaude;
    // Fall back to first match if all are in node_modules
    if (paths.length > 0) return paths[0];
  }
  return 'claude';
}
