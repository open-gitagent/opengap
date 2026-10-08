import { existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

export interface ResolveRepoOptions {
  branch?: string;
  refresh?: boolean;
  noCache?: boolean;
}

export interface ResolveRepoResult {
  dir: string;
  cleanup?: () => void;
}

const CACHE_BASE = join(homedir(), '.gitagent', 'cache');

function cacheKey(url: string, branch: string): string {
  return createHash('sha256').update(`${url}#${branch}`).digest('hex').slice(0, 16);
}

function isDirEmpty(dir: string): boolean {
  try {
    return readdirSync(dir).length === 0;
  } catch {
    return true;
  }
}

function detectDefaultBranch(url: string): string {
  try {
    const output = execFileSync('git', ['ls-remote', '--symref', '--', url, 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15_000,
    });
    // Parse: ref: refs/heads/master	HEAD
    const match = output.match(/ref: refs\/heads\/(\S+)\s+HEAD/);
    if (match?.[1]) return match[1];
  } catch {
    // fallback
  }
  return 'main';
}

export function resolveRepo(url: string, options: ResolveRepoOptions = {}): ResolveRepoResult {
  const requestedBranch = options.branch ?? 'main';

  if (options.noCache) {
    const branch = requestedBranch === 'main' ? detectDefaultBranch(url) : requestedBranch;
    const dir = join(tmpdir(), `gitagent-${cacheKey(url, branch)}-${Date.now()}`);
    cloneRepo(url, branch, dir);
    return {
      dir,
      cleanup: () => {
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      },
    };
  }

  const hash = cacheKey(url, requestedBranch);
  const dir = join(CACHE_BASE, hash);

  // If cached dir exists, is non-empty, and no refresh requested — use it
  if (existsSync(dir) && !isDirEmpty(dir) && !options.refresh) {
    return { dir };
  }

  // Clean up stale/empty cache dir
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }

  // Try cloning with requested branch first, fall back to auto-detect
  try {
    cloneRepo(url, requestedBranch, dir);
  } catch {
    // Branch not found — auto-detect default branch and retry
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    const detectedBranch = detectDefaultBranch(url);
    if (detectedBranch !== requestedBranch) {
      cloneRepo(url, detectedBranch, dir);
    } else {
      throw new Error(`Could not clone ${url} — branch "${requestedBranch}" not found`);
    }
  }

  return { dir };
}

function cloneRepo(url: string, branch: string, dir: string): void {
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['clone', '--depth', '1', '--branch', branch, '--', url, dir], {
    stdio: 'pipe',
  });
}
