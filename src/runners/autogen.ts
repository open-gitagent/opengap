import { writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { exportToAutogenScript } from '../adapters/autogen.js';
import { AgentManifest } from '../utils/loader.js';
import { error, info } from '../utils/format.js';
import { resolveOpenAIKey } from '../utils/auth-provision.js';

export interface AutogenRunOptions {
  prompt?: string;
  workspace?: string;
}

/** First interpreter that actually runs; `python3` is usually missing on Windows. */
function findPython(): string | undefined {
  for (const cmd of ['python3', 'python', 'py']) {
    const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) return cmd;
  }
  return undefined;
}

export function runWithAutogen(agentDir: string, _manifest: AgentManifest, options: AutogenRunOptions = {}): void {
  if (!resolveOpenAIKey() && !process.env.ANTHROPIC_API_KEY) {
    info('No OPENAI_API_KEY or ANTHROPIC_API_KEY found — set the key for whichever provider your agent model uses.');
  }

  const python = findPython();
  if (!python) {
    error('Failed to run AutoGen: no Python interpreter found (tried python3, python, py).');
    info('Install Python 3.10+ and the AutoGen packages: pip install "autogen-agentchat" "autogen-ext[openai,anthropic]"');
    process.exitCode = 1;
    return;
  }

  const script = exportToAutogenScript(agentDir, { prompt: options.prompt });
  const tmpFile = join(tmpdir(), `gitagent-${randomBytes(4).toString('hex')}.py`);

  writeFileSync(tmpFile, script, 'utf-8');

  const runCwd = resolve(options.workspace ?? agentDir);

  info(`Running AutoGen agent from "${agentDir}"...`);
  info(`Working directory: ${runCwd}`);

  try {
    const result = spawnSync(python, [tmpFile], {
      stdio: 'inherit',
      cwd: runCwd,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    if (result.error) {
      error(`Failed to run AutoGen: ${result.error.message}`);
      info('Make sure Python 3.10+ and AutoGen are installed: pip install "autogen-agentchat" "autogen-ext[openai,anthropic]"');
      process.exitCode = 1;
      return;
    }

    if (result.status === 1) {
      info('If the script failed on an import, install the extra for your provider: autogen-ext[openai], [anthropic], [ollama] or [azure].');
    }
    process.exitCode = result.status ?? 0;
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}
