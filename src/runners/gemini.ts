import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { exportToGemini } from '../adapters/gemini.js';
import { AgentManifest } from '../utils/loader.js';
import { error, info } from '../utils/format.js';

export interface GeminiRunOptions {
  prompt?: string;
  workspace?: string;
}

/**
 * Run a gitagent agent using Google Gemini CLI.
 *
 * Creates a temporary workspace with:
 *   - GEMINI.md              (agent instructions)
 *   - .gemini/settings.json  (model config, tool permissions, approval mode)
 *
 * Then launches `gemini` in that workspace. Gemini CLI reads both files
 * automatically on startup.
 *
 * Supports both interactive mode (no prompt) and single-shot mode (`gemini -p`).
 */
export function runWithGemini(agentDir: string, manifest: AgentManifest, options: GeminiRunOptions = {}): void {
  if (options.workspace) {
    info('--workspace is not applied to Gemini because it reads GEMINI.md and .gemini/settings.json from the prepared temporary workspace.');
  }

  const exp = exportToGemini(agentDir);

  // Create a temporary workspace
  const workspaceDir = join(tmpdir(), `gitagent-gemini-${randomBytes(4).toString('hex')}`);
  mkdirSync(workspaceDir, { recursive: true });

  // Write GEMINI.md at project root
  writeFileSync(join(workspaceDir, 'GEMINI.md'), exp.instructions, 'utf-8');

  // Create .gemini directory and write settings.json
  const geminiDir = join(workspaceDir, '.gemini');
  mkdirSync(geminiDir, { recursive: true });
  writeFileSync(join(geminiDir, 'settings.json'), JSON.stringify(exp.settings, null, 2), 'utf-8');

  // Copy hooks directory if it exists (needed for hook script execution)
  const hooksDir = join(agentDir, 'hooks');
  if (existsSync(hooksDir)) {
    const targetHooksDir = join(workspaceDir, 'hooks');
    cpSync(hooksDir, targetHooksDir, { recursive: true });
  }

  info(`Workspace prepared at ${workspaceDir}`);
  info(`  GEMINI.md, .gemini/settings.json`);
  if (manifest.model?.preferred) {
    info(`  Model: ${manifest.model.preferred}`);
  }

  // Build gemini CLI args
  const args: string[] = [];

  // Model override (if specified in manifest and not in settings)
  if (manifest.model?.preferred && !exp.settings.model) {
    args.push('--model', manifest.model.preferred);
  }

  // Approval mode from compliance (if not already in settings)
  if (manifest.compliance?.supervision?.human_in_the_loop && !exp.settings.approvalMode) {
    const hitl = manifest.compliance.supervision.human_in_the_loop;
    if (hitl === 'always') {
      args.push('--approval-mode', 'plan');
    } else if (hitl === 'conditional') {
      args.push('--approval-mode', 'default');
    } else if (hitl === 'none') {
      args.push('--approval-mode', 'yolo');
    } else if (hitl === 'advisory') {
      args.push('--approval-mode', 'auto_edit');
    }
  }

  // Single-shot mode uses `gemini -p "..."`, interactive is just `gemini`
  if (options.prompt) {
    args.push('-p', options.prompt);
  }

  info(`Launching Gemini CLI agent "${manifest.name}"...`);
  if (!options.prompt) {
    info('Starting interactive mode. Type your messages to chat.');
  }

  // On Windows, `gemini` is a .cmd shim that must be run through cmd.exe.
  // We never use `shell: true`; instead we invoke cmd.exe explicitly with
  // every argument double-quoted, and refuse arguments containing characters
  // that cmd.exe would still interpret inside quotes.
  let result;
  if (process.platform === 'win32') {
    const unsafe = args.find(arg => !isSafeWindowsCmdArg(arg));
    if (unsafe !== undefined) {
      try { rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* ignore */ }
      error('On Windows, arguments passed to Gemini CLI cannot contain " % ! or line breaks.');
      process.exitCode = 1;
      return;
    }
    const commandLine = ['gemini', ...args].map(quoteWindowsCmdArg).join(' ');
    result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${commandLine}"`], {
      stdio: 'inherit',
      cwd: workspaceDir,
      env: { ...process.env },
      windowsVerbatimArguments: true,
    });
  } else {
    result = spawnSync('gemini', args, {
      stdio: 'inherit',
      cwd: workspaceDir,
      env: { ...process.env },
    });
  }

  // Cleanup temp workspace before exiting
  try { rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* ignore */ }

  if (result.error) {
    error(`Failed to launch Gemini CLI: ${result.error.message}`);
    info('Make sure Gemini CLI is installed: npm install -g @google/gemini-cli');
    info('Or visit: https://github.com/google-gemini/gemini-cli');
    process.exitCode = 1;
    return;
  }

  process.exitCode = result.status ?? 0;
}

/**
 * Characters that cmd.exe interprets even inside double quotes
 * (quote itself, variable expansion, delayed expansion, line breaks).
 */
export function isSafeWindowsCmdArg(arg: string): boolean {
  return !/["%!\r\n\0]/.test(arg);
}

/** Double-quote an argument for cmd.exe; caller must check isSafeWindowsCmdArg first. */
function quoteWindowsCmdArg(arg: string): string {
  // Double trailing backslashes so they don't escape the closing quote
  return `"${arg.replace(/(\\+)$/, '$1$1')}"`;
}
