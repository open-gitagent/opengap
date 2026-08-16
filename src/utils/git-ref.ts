import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

export interface MaterializedRef {
  dir: string;
  cleanup: () => void;
}

/**
 * Materialize a git ref (commit, branch, tag) from repoDir into a standalone
 * temp directory via `git archive`, so it can be loaded like any other agent
 * directory. Caller must invoke the returned cleanup() when done.
 */
export function materializeGitRef(repoDir: string, ref: string): MaterializedRef {
  try {
    execFileSync('git', ['-C', repoDir, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      stdio: 'pipe',
    });
  } catch {
    throw new Error(`"${ref}" is not a valid git ref in ${repoDir} (and no directory with that name exists either)`);
  }

  const dir = mkdtempSync(join(tmpdir(), 'gitagent-diff-'));
  const tarPath = join(dir, '.snapshot.tar');

  try {
    execFileSync('git', ['-C', repoDir, 'archive', '--format=tar', '-o', tarPath, ref], { stdio: 'pipe' });
    execFileSync('tar', ['-xf', tarPath, '-C', dir], { stdio: 'pipe' });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`Failed to materialize git ref "${ref}" from ${repoDir}: ${(e as Error).message}`);
  } finally {
    if (existsSync(tarPath)) rmSync(tarPath);
  }

  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}
