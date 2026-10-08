import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { exportToOpenClaw } from '../adapters/openclaw.js';
import { AgentManifest } from '../utils/loader.js';
import { error, info, success, warn } from '../utils/format.js';
import { ensureOpenClawAuth } from '../utils/auth-provision.js';
import { isPathInside } from '../utils/path-safety.js';

export interface OpenClawRunOptions {
  prompt?: string;
  workspace?: string;
}

export function runWithOpenClaw(agentDir: string, manifest: AgentManifest, options: OpenClawRunOptions = {}): void {
  ensureOpenClawAuth();
  const exp = exportToOpenClaw(agentDir);

  // Create a temporary workspace
  const workspaceDir = join(tmpdir(), `gitagent-openclaw-${randomBytes(4).toString('hex')}`);
  mkdirSync(workspaceDir, { recursive: true });

  // The adapter emits a multi-agent config (`agents`) whenever the manifest
  // declares sub-agents, even if some sub-agent directories are missing.
  const config = exp.config as Record<string, Record<string, unknown>>;
  const isMultiAgent = !!config.agents && typeof config.agents === 'object';

  // Write main workspace files
  const mainWorkspace = isMultiAgent ? join(workspaceDir, `workspace-main`) : workspaceDir;
  mkdirSync(mainWorkspace, { recursive: true });

  writeFileSync(join(mainWorkspace, 'AGENTS.md'), exp.agentsMd, 'utf-8');
  writeFileSync(join(mainWorkspace, 'SOUL.md'), exp.soulMd, 'utf-8');

  if (exp.toolsMd) {
    writeFileSync(join(mainWorkspace, 'TOOLS.md'), exp.toolsMd, 'utf-8');
  }

  // Write main skills
  for (const skill of exp.skills) {
    const skillDir = join(mainWorkspace, 'skills', skill.name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), skill.content, 'utf-8');
  }

  // Write sub-agent workspaces
  for (const sub of exp.subAgents) {
    const subWorkspace = join(workspaceDir, `workspace-${sub.name}`);
    if (!isPathInside(workspaceDir, subWorkspace)) {
      warn(`Skipping sub-agent with invalid name: ${sub.name}`);
      continue;
    }
    mkdirSync(subWorkspace, { recursive: true });

    writeFileSync(join(subWorkspace, 'SOUL.md'), sub.soulMd, 'utf-8');
    writeFileSync(join(subWorkspace, 'AGENTS.md'), sub.agentsMd, 'utf-8');
    if (sub.toolsMd) {
      writeFileSync(join(subWorkspace, 'TOOLS.md'), sub.toolsMd, 'utf-8');
    }
    for (const skill of sub.skills) {
      const skillDir = join(subWorkspace, 'skills', skill.name);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), skill.content, 'utf-8');
    }
    info(`  Sub-agent workspace: workspace-${sub.name}/`);
  }

  const runCwd = resolve(options.workspace ?? workspaceDir);

  // Write openclaw.json config, pointing workspaces to temp dirs
  if (isMultiAgent) {
    const agents = config.agents;
    if (!agents.main || typeof agents.main !== 'object') {
      agents.main = {};
    }
    (agents.main as Record<string, unknown>).workspace = mainWorkspace;
    for (const [name, value] of Object.entries(agents)) {
      if (name === 'main' || name === 'list' || !value || typeof value !== 'object') continue;
      // Sub-agents without an exported directory still get an (empty) temp workspace
      const subWorkspace = join(workspaceDir, `workspace-${name}`);
      if (!isPathInside(workspaceDir, subWorkspace)) continue;
      mkdirSync(subWorkspace, { recursive: true });
      (value as Record<string, unknown>).workspace = subWorkspace;
    }
  } else {
    config.agent = config.agent ?? {};
    config.agent.workspace = runCwd;
  }

  const configFile = join(workspaceDir, 'openclaw.json');
  writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');

  info(`Workspace prepared at ${workspaceDir}`);
  info(`  AGENTS.md, SOUL.md${exp.toolsMd ? ', TOOLS.md' : ''}`);
  if (exp.skills.length > 0) {
    info(`  Skills: ${exp.skills.map(s => s.name).join(', ')}`);
  }

  // OpenClaw agent requires --message
  if (!options.prompt) {
    error('OpenClaw requires a prompt. Use -p "your message" to provide one.');
    info('Example: gitagent run -r <url> -a openclaw -p "Review my auth module"');
    try { rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* ignore */ }
    process.exit(1);
  }

  // Build openclaw CLI args
  // --local runs embedded agent, --session-id provides an ad-hoc session
  const sessionId = `gitagent-${manifest.name}-${randomBytes(4).toString('hex')}`;
  const args: string[] = ['agent', '--local', '--session-id', sessionId, '--message', options.prompt];

  // Map thinking level from model constraints
  if (manifest.compliance?.supervision?.human_in_the_loop === 'always') {
    args.push('--thinking', 'high');
    info('Compliance: human_in_the_loop=always → thinking=high');
  }

  info(`Launching OpenClaw agent "${manifest.name}"...`);
  info(`Working directory: ${runCwd}`);

  try {
    const result = spawnSync('openclaw', args, {
      stdio: 'inherit',
      cwd: runCwd,
      env: {
        ...process.env,
        OPENCLAW_CONFIG: configFile,
      },
    });

    if (result.error) {
      error(`Failed to launch OpenClaw: ${result.error.message}`);
      info('Make sure OpenClaw is installed: npm install -g openclaw@latest');
      process.exitCode = 1;
      return;
    }

    process.exitCode = result.status ?? 0;
  } finally {
    // Cleanup temp workspace
    try { rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
