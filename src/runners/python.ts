import { writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { error, info } from '../utils/format.js';

export interface PythonRunOptions {
  prompt?: string;
  workspace?: string;
}

export function runPythonModule(
  agentDir: string,
  code: string,
  label: string,
  installHint: string,
  options: PythonRunOptions = {},
): void {
  const python = resolvePython();
  if (!python) {
    error('Python 3 is required to run this adapter but was not found on PATH.');
    info(installHint);
    process.exitCode = 1;
    return;
  }

  const filePath = join(agentDir, `.gitagent-${label}-${randomBytes(4).toString('hex')}.py`);
  const runCwd = resolve(options.workspace ?? agentDir);

  writeFileSync(filePath, code, 'utf-8');
  info(`Running ${label} agent from "${agentDir}"...`);
  info(`Working directory: ${runCwd}`);

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.prompt) env.GITAGENT_PROMPT = options.prompt;

  try {
    const result = spawnSync(python, [filePath], { stdio: 'inherit', cwd: runCwd, env });
    if (result.error) {
      error(`Failed to run ${label}: ${result.error.message}`);
      info(installHint);
      process.exitCode = 1;
      return;
    }
    process.exitCode = result.status ?? 0;
  } finally {
    try { unlinkSync(filePath); } catch { void 0; }
  }
}

function resolvePython(): string | null {
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
    if (!probe.error) return candidate;
  }
  return null;
}
