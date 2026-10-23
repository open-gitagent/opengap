import { writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { exportToCrewAIScript } from '../adapters/crewai.js';
import { AgentManifest } from '../utils/loader.js';
import { error, info } from '../utils/format.js';
import { resolveOpenAIKey } from '../utils/auth-provision.js';

export interface CrewAIRunOptions {
  prompt?: string;
  workspace?: string;
}

export function runWithCrewAI(agentDir: string, _manifest: AgentManifest, options: CrewAIRunOptions = {}): void {
  if (!resolveOpenAIKey() && !process.env.ANTHROPIC_API_KEY) {
    info('No OPENAI_API_KEY or ANTHROPIC_API_KEY found — set the key for whichever provider your agent model uses.');
  }

  const script = exportToCrewAIScript(agentDir, { prompt: options.prompt });
  const tmpFile = join(tmpdir(), `gitagent-${randomBytes(4).toString('hex')}.py`);

  writeFileSync(tmpFile, script, 'utf-8');

  const runCwd = resolve(options.workspace ?? agentDir);

  info(`Running CrewAI agent from "${agentDir}"...`);
  info(`Working directory: ${runCwd}`);

  try {
    const result = spawnSync('python3', [tmpFile], {
      stdio: 'inherit',
      cwd: runCwd,
      env: { ...process.env },
    });

    if (result.error) {
      error(`Failed to run CrewAI: ${result.error.message}`);
      info('Make sure Python 3 and the crewai package are installed: pip install crewai');
      process.exitCode = 1;
      return;
    }

    process.exitCode = result.status ?? 0;
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}
