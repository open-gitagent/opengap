import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir, platform } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { exportToLangChainString } from '../adapters/langchain.js';
import { detectProvider } from '../adapters/langchain-utils.js';
import { AgentManifest } from '../utils/loader.js';
import { error, info } from '../utils/format.js';

const IS_WINDOWS = platform() === 'win32';

/** Paths inside a venv differ between Windows and Unix. */
function venvPython(venvDir: string): string {
  return IS_WINDOWS
    ? join(venvDir, 'Scripts', 'python.exe')
    : join(venvDir, 'bin', 'python');
}

function venvPip(venvDir: string): string {
  return IS_WINDOWS
    ? join(venvDir, 'Scripts', 'pip.exe')
    : join(venvDir, 'bin', 'pip');
}

/** Find a system Python 3 to bootstrap the venv. */
function findSystemPython(): string | null {
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['--version'], { stdio: 'pipe' });
    if (!r.error && r.status === 0) {
      // Reject the Windows Store stub (outputs to stderr, version string absent from stdout)
      const out = (r.stdout?.toString() ?? '') + (r.stderr?.toString() ?? '');
      if (out.includes('Python 3')) return cmd;
    }
  }
  return null;
}

export function runWithLangChain(agentDir: string, _manifest: AgentManifest, options: { prompt?: string } = {}): void {
  const model = _manifest.model?.preferred ?? 'gpt-4o';
  const providerInfo = detectProvider(model);

  // Unsupported model — tell the user clearly
  if (!providerInfo) {
    error(`Model "${model}" is not supported by the LangChain adapter.`);
    info('gitagent with LangChain currently supports:');
    info('  • OpenAI  — gpt-4o, gpt-4, o1-mini, o3-mini, …');
    info('  • Anthropic — claude-3-5-sonnet, claude-3-opus, …');
    process.exit(1);
  }

  // Check the appropriate API key env var
  if (!process.env[providerInfo.envVar]) {
    error(`${providerInfo.envVar} environment variable is not set`);
    info(`Set it with: ${IS_WINDOWS ? '$env:' : 'export '}${providerInfo.envVar}="your-key-here"`);
    process.exit(1);
  }

  // Persistent venv at ~/.gitagent/langchain-venv — reused across runs
  const venvDir = join(homedir(), '.gitagent', 'langchain-venv');
  const packages = ['langchain', 'langchain-core', providerInfo.pipPackage];

  // --- Step 1: create venv if it doesn't exist ---
  if (!existsSync(venvPython(venvDir))) {
    info(`Creating Python virtual environment at ${venvDir} ...`);
    const sysPython = findSystemPython();
    if (!sysPython) {
      error('Python 3 not found. Please install Python 3 and try again.');
      process.exit(1);
    }
    const create = spawnSync(sysPython, ['-m', 'venv', venvDir], { stdio: 'inherit' });
    if (create.status !== 0) {
      error('Failed to create virtual environment.');
      process.exit(1);
    }
  }

  // --- Step 2: install packages if any are missing ---
  const checkImport = spawnSync(
    venvPython(venvDir),
    ['-c', `import langchain; import ${providerInfo.pipPackage.replace(/-/g, '_')}`],
    { stdio: 'pipe' },
  );

  if (checkImport.status !== 0) {
    info(`Installing packages: ${packages.join(' ')} ...`);
    const install = spawnSync(
      venvPip(venvDir),
      ['install', '--quiet', '--upgrade', ...packages],
      { stdio: 'inherit' },
    );
    if (install.status !== 0) {
      error('Failed to install required packages.');
      info(`Try manually: ${venvPip(venvDir)} install ${packages.join(' ')}`);
      process.exit(1);
    }
  }

  // --- Step 3: write + run script ---
  const script = exportToLangChainString(agentDir);
  const tmpFile = join(tmpdir(), `gitagent-langchain-${randomBytes(4).toString('hex')}.py`);
  writeFileSync(tmpFile, script, 'utf-8');

  info(`Running LangChain agent from "${agentDir}" ...`);

  // Pass prompt as a CLI arg so the script receives it via sys.argv
  const scriptArgs = options.prompt ? [tmpFile, options.prompt] : [tmpFile];

  try {
    const result = spawnSync(venvPython(venvDir), scriptArgs, {
      stdio: 'inherit',
      cwd: agentDir,
      env: { ...process.env },
    });

    if (result.error) {
      error(`Failed to run script: ${result.error.message}`);
      process.exit(1);
    }

    process.exit(result.status ?? 0);
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}
