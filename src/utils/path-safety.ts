import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Returns true when `child` is strictly inside `parent` (never equal to it).
 * Both paths are resolved lexically; no filesystem access.
 */
export function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== '' && !rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel);
}

/**
 * Resolve `relPath` against `baseDir` and ensure the result stays strictly
 * inside `baseDir`. Absolute paths and paths that escape via `..` are
 * rejected. Symlinks are followed: the real path of the target (or of its
 * deepest existing ancestor) must also be inside the real path of `baseDir`.
 *
 * Returns the resolved absolute path, or null if the path is not confined.
 */
export function resolveInside(baseDir: string, relPath: string): string | null {
  if (typeof relPath !== 'string' || relPath === '' || isAbsolute(relPath)) return null;
  const base = resolve(baseDir);
  const target = resolve(base, relPath);
  if (!isPathInside(base, target)) return null;

  // Follow symlinks: resolve the deepest existing ancestor (or the target
  // itself) and make sure it does not lead outside the base directory.
  try {
    const realBase = existsSync(base) ? realpathSync(base) : base;
    let existing = target;
    while (!existsSync(existing) && existing !== base) {
      existing = dirname(existing);
    }
    const realExisting = existsSync(existing) ? realpathSync(existing) : existing;
    const realTarget = resolve(realExisting, relative(existing, target));
    if (!isPathInside(realBase, realTarget)) return null;
  } catch {
    return null;
  }
  return target;
}

/**
 * Read a knowledge document referenced from knowledge/index.yaml.
 * The path must resolve inside `knowledgeDir` (symlinks included);
 * otherwise a warning is printed and null is returned.
 */
export function loadKnowledgeDocument(knowledgeDir: string, docPath: string): string | null {
  const full = resolveInside(knowledgeDir, docPath);
  if (!full) {
    console.warn(`Warning: skipping knowledge document outside knowledge/: ${String(docPath)}`);
    return null;
  }
  if (!existsSync(full)) return null;
  try {
    return readFileSync(full, 'utf-8');
  } catch {
    return null;
  }
}
