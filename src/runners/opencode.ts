import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { exportToOpenCode } from '../adapters/opencode.js';
import { AgentManifest } from '../utils/loader.js';
import { error, info } from '../utils/format.js';

export interface OpenCodeRunOptions {
  prompt?: string;
  workspace?: string;
}

/**
 * Run a gitagent agent using OpenCode (sst/opencode).
 *
 * Creates a temporary workspace with:
 *   - AGENTS.md       (agent instructions)
 *   - opencode.json   (provider + model config)
 *
 * Then launches `opencode` in that workspace. OpenCode reads both files
 * automatically on startup.
 *
 * Supports both interactive mode (no prompt) and single-shot mode (`opencode run "<message>"`).
 */
export function runWithOpenCode(agentDir: string, manifest: AgentManifest, options: OpenCodeRunOptions = {}): void {
  if (options.workspace) {
    info('--workspace is not applied to OpenCode because it reads AGENTS.md and opencode.json from the prepared temporary workspace.');
  }

  const exp = exportToOpenCode(agentDir);

  // Create a temporary workspace
  const workspaceDir = join(tmpdir(), `gitagent-opencode-${randomBytes(4).toString('hex')}`);
  mkdirSync(workspaceDir, { recursive: true });

  // Write AGENTS.md at project root
  writeFileSync(join(workspaceDir, 'AGENTS.md'), exp.instructions, 'utf-8');

  // Write opencode.json
  writeFileSync(join(workspaceDir, 'opencode.json'), JSON.stringify(exp.config, null, 2), 'utf-8');

  info(`Workspace prepared at ${workspaceDir}`);
  info(`  AGENTS.md, opencode.json`);
  if (manifest.model?.preferred) {
    info(`  Model: ${manifest.model.preferred}`);
  }

  // Build opencode CLI args
  const args: string[] = [];

  // Single-shot mode: `opencode run "<message>"` — prompt is a positional arg.
  // Note: opencode's `-p` / `--password` is NOT for prompts; the prompt goes as positional message.
  if (options.prompt) {
    args.push('run', options.prompt);
  }

  info(`Launching OpenCode agent "${manifest.name}"...`);
  if (!options.prompt) {
    info('Starting interactive mode. Type your messages to chat.');
  }

  const result = spawnSync('opencode', args, {
    stdio: 'inherit',
    cwd: workspaceDir,
    env: { ...process.env },
  });

  // Cleanup temp workspace before exiting
  try { rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* ignore */ }

  if (result.error) {
    error(`Failed to launch OpenCode: ${result.error.message}`);
    info('Make sure OpenCode is installed: npm install -g opencode');
    info('Or: brew install sst/tap/opencode');
    process.exitCode = 1;
    return;
  }

  process.exitCode = result.status ?? 0;
}
