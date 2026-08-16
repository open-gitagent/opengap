import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { loadAgentManifest, loadFileIfExists, type AgentManifest } from './loader.js';

export interface FieldDiff {
  path: string;
  from: unknown;
  to: unknown;
}

export interface TextDiff {
  fromPresent: boolean;
  toPresent: boolean;
  changed: boolean;
  added: number;
  removed: number;
}

export interface DutiesDiff extends TextDiff {
  conflictsAdded: string[][];
  conflictsRemoved: string[][];
}

export interface ListDiff {
  added: string[];
  removed: string[];
  modified: string[];
}

export interface HookEntry {
  event: string;
  script: string;
  failOpen?: boolean;
}

export interface AgentDiffResult {
  from: string;
  to: string;
  manifestPresent: { from: boolean; to: boolean };
  identity: TextDiff;
  manifest: FieldDiff[];
  rules: TextDiff;
  duties: DutiesDiff;
  skills: ListDiff;
  tools: ListDiff;
  workflows: ListDiff;
  compliance: {
    riskTier: { from?: string; to?: string };
    riskEscalated: boolean;
    frameworksAdded: string[];
    frameworksRemoved: string[];
    changed: FieldDiff[];
  };
  hooks: { added: HookEntry[]; removed: HookEntry[]; enforcementAdded: boolean };
  memory: { changed: boolean; files: string[] };
}

const RISK_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function riskRank(tier: string | undefined): number {
  if (!tier) return -1;
  return RISK_RANK[tier] ?? -1;
}

function tryLoadManifest(dir: string): AgentManifest | null {
  try {
    return loadAgentManifest(dir);
  } catch {
    return null;
  }
}

/** LCS-based line diff. Returns how many lines were added/removed going from oldText to newText. */
export function diffLines(oldText: string | null, newText: string | null): { added: number; removed: number } {
  const a = oldText ? oldText.split('\n') : [];
  const b = newText ? newText.split('\n') : [];
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const common = lcs[0][0];
  return { added: m - common, removed: n - common };
}

function diffTextSection(oldText: string | null, newText: string | null): TextDiff {
  const { added, removed } = diffLines(oldText, newText);
  return {
    fromPresent: oldText !== null,
    toPresent: newText !== null,
    changed: added > 0 || removed > 0,
    added,
    removed,
  };
}

export function diffStringList(
  oldList: string[],
  newList: string[],
): { added: string[]; removed: string[]; common: string[] } {
  const oldSet = new Set(oldList);
  const newSet = new Set(newList);
  return {
    added: newList.filter(x => !oldSet.has(x)),
    removed: oldList.filter(x => !newSet.has(x)),
    common: oldList.filter(x => newSet.has(x)),
  };
}

function hashFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Flatten a nested object into dot-path -> leaf value pairs, for generic schema diffing. Arrays are kept whole. */
function flatten(obj: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj === null || obj === undefined) return out;
  if (Array.isArray(obj)) {
    out[prefix || '(root)'] = obj;
    return out;
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) {
      out[prefix || '(root)'] = obj;
      return out;
    }
    for (const [k, v] of entries) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return out;
  }
  out[prefix || '(root)'] = obj;
  return out;
}

function diffObjects(oldObj: unknown, newObj: unknown): FieldDiff[] {
  const a = flatten(oldObj);
  const b = flatten(newObj);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changes: FieldDiff[] = [];
  for (const key of Array.from(keys).sort()) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      changes.push({ path: key, from: a[key], to: b[key] });
    }
  }
  return changes;
}

function omit(obj: object | null | undefined, keys: string[]): Record<string, unknown> {
  if (!obj) return {};
  const copy: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  for (const k of keys) delete copy[k];
  return copy;
}

function listDirNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
}

function listYamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .filter(f => statSync(join(dir, f)).isFile())
    .sort();
}

function diffSkills(fromDir: string, toDir: string): ListDiff {
  const { added, removed, common } = diffStringList(listDirNames(join(fromDir, 'skills')), listDirNames(join(toDir, 'skills')));
  const modified = common.filter(name => {
    const a = hashFile(join(fromDir, 'skills', name, 'SKILL.md'));
    const b = hashFile(join(toDir, 'skills', name, 'SKILL.md'));
    return a !== b;
  });
  return { added, removed, modified };
}

function diffYamlDir(fromDir: string, toDir: string, sub: string): ListDiff {
  const { added, removed, common } = diffStringList(listYamlFiles(join(fromDir, sub)), listYamlFiles(join(toDir, sub)));
  const modified = common.filter(name => hashFile(join(fromDir, sub, name)) !== hashFile(join(toDir, sub, name)));
  const strip = (f: string) => f.replace(/\.ya?ml$/, '');
  return { added: added.map(strip), removed: removed.map(strip), modified: modified.map(strip) };
}

function conflictKey(pair: string[]): string {
  return [...pair].sort().join('<->');
}

function diffConflicts(
  fromConflicts: Array<[string, string]>,
  toConflicts: Array<[string, string]>,
): { added: string[][]; removed: string[][] } {
  const fromMap = new Map(fromConflicts.map(p => [conflictKey(p), p]));
  const toMap = new Map(toConflicts.map(p => [conflictKey(p), p]));
  const added = [...toMap.entries()].filter(([k]) => !fromMap.has(k)).map(([, p]) => p);
  const removed = [...fromMap.entries()].filter(([k]) => !toMap.has(k)).map(([, p]) => p);
  return { added, removed };
}

interface RawHooksFile {
  hooks?: Record<string, Array<{ script?: string; fail_open?: boolean }>>;
}

function loadHooks(dir: string): HookEntry[] {
  const content = loadFileIfExists(join(dir, 'hooks', 'hooks.yaml'));
  if (!content) return [];

  let parsed: RawHooksFile;
  try {
    parsed = yaml.load(content) as RawHooksFile;
  } catch {
    return [];
  }

  const out: HookEntry[] = [];
  for (const [event, entries] of Object.entries(parsed.hooks ?? {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry?.script) out.push({ event, script: entry.script, failOpen: entry.fail_open });
    }
  }
  return out;
}

function hookKey(h: HookEntry): string {
  return `${h.event}:${h.script}`;
}

function diffHooks(fromDir: string, toDir: string): { added: HookEntry[]; removed: HookEntry[]; enforcementAdded: boolean } {
  const fromHooks = loadHooks(fromDir);
  const toHooks = loadHooks(toDir);
  const fromKeys = new Set(fromHooks.map(hookKey));
  const toKeys = new Set(toHooks.map(hookKey));
  const added = toHooks.filter(h => !fromKeys.has(hookKey(h)));
  const removed = fromHooks.filter(h => !toKeys.has(hookKey(h)));
  return { added, removed, enforcementAdded: added.some(h => h.failOpen === false) };
}

function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, relPath);
      else out.push(relPath);
    }
  };
  walk(dir, '');
  return out.sort();
}

function diffMemory(fromDir: string, toDir: string): { changed: boolean; files: string[] } {
  const allFiles = new Set([...listFilesRecursive(join(fromDir, 'memory')), ...listFilesRecursive(join(toDir, 'memory'))]);
  const files: string[] = [];
  for (const rel of allFiles) {
    if (hashFile(join(fromDir, 'memory', rel)) !== hashFile(join(toDir, 'memory', rel))) {
      files.push(rel);
    }
  }
  files.sort();
  return { changed: files.length > 0, files };
}

/**
 * Compute a semantic diff between two agent directories (already-materialized
 * on disk — the caller resolves git refs / clones before calling this).
 */
export function computeAgentDiff(fromDir: string, toDir: string, fromLabel: string, toLabel: string): AgentDiffResult {
  const fromManifest = tryLoadManifest(fromDir);
  const toManifest = tryLoadManifest(toDir);

  const fromConflicts = fromManifest?.compliance?.segregation_of_duties?.conflicts ?? [];
  const toConflicts = toManifest?.compliance?.segregation_of_duties?.conflicts ?? [];
  const conflictDiff = diffConflicts(fromConflicts, toConflicts);

  const fromTier = fromManifest?.compliance?.risk_tier;
  const toTier = toManifest?.compliance?.risk_tier;
  const frameworksDiff = diffStringList(fromManifest?.compliance?.frameworks ?? [], toManifest?.compliance?.frameworks ?? []);
  const complianceChanged = diffObjects(fromManifest?.compliance ?? null, toManifest?.compliance ?? null).filter(
    c => c.path !== 'risk_tier' && c.path !== 'frameworks',
  );

  return {
    from: fromLabel,
    to: toLabel,
    manifestPresent: { from: fromManifest !== null, to: toManifest !== null },
    identity: diffTextSection(loadFileIfExists(join(fromDir, 'SOUL.md')), loadFileIfExists(join(toDir, 'SOUL.md'))),
    manifest: diffObjects(
      omit(fromManifest, ['skills', 'tools', 'compliance']),
      omit(toManifest, ['skills', 'tools', 'compliance']),
    ),
    rules: diffTextSection(loadFileIfExists(join(fromDir, 'RULES.md')), loadFileIfExists(join(toDir, 'RULES.md'))),
    duties: {
      ...diffTextSection(loadFileIfExists(join(fromDir, 'DUTIES.md')), loadFileIfExists(join(toDir, 'DUTIES.md'))),
      conflictsAdded: conflictDiff.added,
      conflictsRemoved: conflictDiff.removed,
    },
    skills: diffSkills(fromDir, toDir),
    tools: diffYamlDir(fromDir, toDir, 'tools'),
    workflows: diffYamlDir(fromDir, toDir, 'workflows'),
    compliance: {
      riskTier: { from: fromTier, to: toTier },
      riskEscalated: riskRank(toTier) > riskRank(fromTier),
      frameworksAdded: frameworksDiff.added,
      frameworksRemoved: frameworksDiff.removed,
      changed: complianceChanged,
    },
    hooks: diffHooks(fromDir, toDir),
    memory: diffMemory(fromDir, toDir),
  };
}
