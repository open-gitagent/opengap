import { writeFileSync, mkdirSync, rmSync, cpSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { exportToGitclaw } from '../adapters/gitclaw.js';
import { AgentManifest } from '../utils/loader.js';
import { error, info } from '../utils/format.js';

export interface GitclawRunOptions {
  prompt?: string;
  workspace?: string;
}

/**
 * Run a gitagent agent using the gitclaw SDK.
 *
 * Creates a temporary workspace with the full gitclaw directory structure:
 *   - agent.yaml (provider:model format)
 *   - SOUL.md, RULES.md, DUTIES.md
 *   - skills/, tools/, hooks/, knowledge/
 *
 * Then launches `gitclaw` CLI in that workspace.
 * Supports both interactive mode (no prompt) and single-shot mode (`gitclaw run -p`).
 */
export function runWithGitclaw(agentDir: string, manifest: AgentManifest, options: GitclawRunOptions = {}): void {
  if (options.workspace) {
    info('--workspace is not applied to gitclaw because it reads agent.yaml and related files from the prepared temporary workspace.');
  }

  const exp = exportToGitclaw(agentDir);

  // Create a temporary workspace
  const workspaceDir = join(tmpdir(), `gitagent-gitclaw-${randomBytes(4).toString('hex')}`);
  mkdirSync(workspaceDir, { recursive: true });

  // Write agent.yaml
  writeFileSync(join(workspaceDir, 'agent.yaml'), exp.agentYaml, 'utf-8');

  // Write identity files
  if (exp.soulMd) writeFileSync(join(workspaceDir, 'SOUL.md'), exp.soulMd, 'utf-8');
  if (exp.rulesMd) writeFileSync(join(workspaceDir, 'RULES.md'), exp.rulesMd, 'utf-8');
  if (exp.dutiesMd) writeFileSync(join(workspaceDir, 'DUTIES.md'), exp.dutiesMd, 'utf-8');

  // Copy knowledge documents, hook scripts and full skill directories
  // (scripts/, references/, ...) so they are available to gitclaw.
  copyDirIfExists(join(agentDir, 'knowledge'), join(workspaceDir, 'knowledge'));
  copyDirIfExists(join(agentDir, 'hooks'), join(workspaceDir, 'hooks'));
  for (const skill of exp.skills) {
    copyDirIfExists(join(agentDir, 'skills', skill.name), join(workspaceDir, 'skills', skill.name));
  }

  // Write knowledge index (converted to gitclaw format)
  if (exp.knowledgeIndex) {
    mkdirSync(join(workspaceDir, 'knowledge'), { recursive: true });
    writeFileSync(join(workspaceDir, 'knowledge', 'index.yaml'), exp.knowledgeIndex, 'utf-8');
  } else {
    // Don't leave a gitagent-format index behind for gitclaw to misread
    rmSync(join(workspaceDir, 'knowledge', 'index.yaml'), { force: true });
  }

  // Write skills
  for (const skill of exp.skills) {
    const skillDir = join(workspaceDir, 'skills', skill.name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), skill.content, 'utf-8');
  }

  // Write tools
  if (exp.tools.length > 0) {
    mkdirSync(join(workspaceDir, 'tools'), { recursive: true });
    for (const tool of exp.tools) {
      writeFileSync(join(workspaceDir, 'tools', tool.name), tool.content, 'utf-8');
    }
  }

  // Write hooks
  if (exp.hooks) {
    mkdirSync(join(workspaceDir, 'hooks'), { recursive: true });
    writeFileSync(join(workspaceDir, 'hooks', 'hooks.yaml'), exp.hooks, 'utf-8');
  }

  info(`Workspace prepared at ${workspaceDir}`);
  info(`  agent.yaml${exp.soulMd ? ', SOUL.md' : ''}${exp.rulesMd ? ', RULES.md' : ''}`);
  if (exp.skills.length > 0) {
    info(`  Skills: ${exp.skills.map(s => s.name).join(', ')}`);
  }
  if (manifest.model?.preferred) {
    info(`  Model: ${manifest.model.preferred}`);
  }

  // Build gitclaw CLI args
  const args: string[] = [];

  if (options.prompt) {
    args.push('run', '-p', options.prompt);
  }

  info(`Launching gitclaw agent "${manifest.name}"...`);
  if (!options.prompt) {
    info('Starting interactive mode. Type your messages to chat.');
  }

  const result = spawnSync('gitclaw', args, {
    stdio: 'inherit',
    cwd: workspaceDir,
    env: { ...process.env },
  });

  // Cleanup temp workspace before exiting
  try { rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* ignore */ }

  if (result.error) {
    error(`Failed to launch gitclaw: ${result.error.message}`);
    info('Make sure gitclaw is installed: npm install -g gitclaw');
    process.exitCode = 1;
    return;
  }

  process.exitCode = result.status ?? 0;
}

/** Recursively copy a directory, skipping symlinks so nothing outside the agent is pulled in. */
function copyDirIfExists(src: string, dest: string): void {
  if (!existsSync(src)) return;
  cpSync(src, dest, {
    recursive: true,
    filter: (path) => !lstatSync(path).isSymbolicLink(),
  });
}
