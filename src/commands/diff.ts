import { Command } from 'commander';
import { existsSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeAgentDiff, type AgentDiffResult, type TextDiff, type ListDiff } from '../utils/agent-diff.js';
import { materializeGitRef } from '../utils/git-ref.js';
import { success, error, warn, label, heading, divider } from '../utils/format.js';

interface DiffOptions {
  dir: string;
  json: boolean;
}

interface DiffSource {
  dir: string;
  label: string;
  cleanup?: () => void;
}

function isExistingDirectory(path: string): boolean {
  return existsSync(path) && lstatSync(path).isDirectory();
}

function resolveDiffSource(spec: string | undefined, repoDir: string): DiffSource {
  if (spec === undefined) {
    return { dir: repoDir, label: 'working directory' };
  }
  const asPath = resolve(spec);
  if (isExistingDirectory(asPath)) {
    return { dir: asPath, label: spec };
  }
  const { dir, cleanup } = materializeGitRef(repoDir, spec);
  return { dir, label: spec, cleanup };
}

export const diffCommand = new Command('diff')
  .description('Show a semantic diff between two agent versions (git refs or directories)')
  .argument('[from]', 'Git ref or directory to compare from (default: HEAD)')
  .argument('[to]', 'Git ref or directory to compare to (default: working directory)')
  .option('-d, --dir <dir>', 'Repository/agent directory used to resolve git refs', '.')
  .option('--json', 'Output as JSON', false)
  .action((fromArg: string | undefined, toArg: string | undefined, options: DiffOptions) => {
    const repoDir = resolve(options.dir);

    let from = fromArg;
    let to = toArg;
    if (!to && from?.includes('..')) {
      const idx = from.indexOf('..');
      const a = from.slice(0, idx);
      const b = from.slice(idx + 2);
      if (a && b) {
        from = a;
        to = b;
      }
    }
    from = from ?? 'HEAD';

    let fromSource: DiffSource;
    let toSource: DiffSource;
    try {
      fromSource = resolveDiffSource(from, repoDir);
      toSource = resolveDiffSource(to, repoDir);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }

    let result: AgentDiffResult;
    try {
      result = computeAgentDiff(fromSource.dir, toSource.dir, fromSource.label, toSource.label);
    } finally {
      fromSource.cleanup?.();
      toSource.cleanup?.();
    }

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      renderDiff(result);
    }
  });

function textSummary(t: TextDiff): string {
  if (!t.fromPresent && !t.toPresent) return 'not present';
  if (!t.fromPresent) return 'added';
  if (!t.toPresent) return 'removed';
  if (!t.changed) return 'unchanged';
  return `+${t.added} added, -${t.removed} removed`;
}

function listSummary(l: ListDiff): string {
  if (l.added.length === 0 && l.removed.length === 0 && l.modified.length === 0) return 'unchanged';
  const parts: string[] = [];
  parts.push(l.added.length ? `+${l.added.length} added (${l.added.join(', ')})` : '0 added');
  parts.push(l.removed.length ? `-${l.removed.length} removed (${l.removed.join(', ')})` : '0 removed');
  if (l.modified.length) parts.push(`${l.modified.length} modified (${l.modified.join(', ')})`);
  return parts.join(', ');
}

function fmt(v: unknown): string {
  if (v === undefined) return 'unset';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function isEmpty(r: AgentDiffResult): boolean {
  return (
    !r.identity.changed &&
    r.manifest.length === 0 &&
    !r.rules.changed &&
    !r.duties.changed &&
    r.duties.conflictsAdded.length === 0 &&
    r.duties.conflictsRemoved.length === 0 &&
    r.skills.added.length === 0 &&
    r.skills.removed.length === 0 &&
    r.skills.modified.length === 0 &&
    r.tools.added.length === 0 &&
    r.tools.removed.length === 0 &&
    r.tools.modified.length === 0 &&
    r.workflows.added.length === 0 &&
    r.workflows.removed.length === 0 &&
    r.workflows.modified.length === 0 &&
    r.compliance.riskTier.from === r.compliance.riskTier.to &&
    r.compliance.frameworksAdded.length === 0 &&
    r.compliance.frameworksRemoved.length === 0 &&
    r.compliance.changed.length === 0 &&
    r.hooks.added.length === 0 &&
    r.hooks.removed.length === 0 &&
    !r.memory.changed
  );
}

function renderDiff(r: AgentDiffResult): void {
  heading(`gitagent diff: ${r.from} → ${r.to}`);
  divider();

  if (!r.manifestPresent.from || !r.manifestPresent.to) {
    warn(`agent.yaml missing on one side (from: ${r.manifestPresent.from}, to: ${r.manifestPresent.to}) — comparison may be incomplete`);
  }

  label('Identity (SOUL.md)', textSummary(r.identity));

  if (r.manifest.length === 0) {
    label('Manifest (agent.yaml)', 'unchanged');
  } else {
    for (const f of r.manifest) {
      label(`Manifest.${f.path}`, `${fmt(f.from)} → ${fmt(f.to)}`);
    }
  }

  label('Rules (RULES.md)', textSummary(r.rules));

  const dutiesParts = [textSummary(r.duties)];
  for (const pair of r.duties.conflictsAdded) dutiesParts.push(`conflict added: [${pair.join(', ')}]`);
  for (const pair of r.duties.conflictsRemoved) dutiesParts.push(`conflict removed: [${pair.join(', ')}]`);
  label('Duties (DUTIES.md)', dutiesParts.join('; '));

  label('Skills', listSummary(r.skills));
  label('Tools', listSummary(r.tools));
  if (r.workflows.added.length || r.workflows.removed.length || r.workflows.modified.length) {
    label('Workflows', listSummary(r.workflows));
  }

  if (r.compliance.riskTier.from !== r.compliance.riskTier.to) {
    const line = `${r.compliance.riskTier.from ?? 'unset'} → ${r.compliance.riskTier.to ?? 'unset'}`;
    if (r.compliance.riskEscalated) {
      warn(`Compliance.risk_tier: ${line}  ⚠ tier escalation`);
    } else {
      label('Compliance.risk_tier', line);
    }
  }
  if (r.compliance.frameworksAdded.length || r.compliance.frameworksRemoved.length) {
    const parts: string[] = [];
    if (r.compliance.frameworksAdded.length) parts.push(`+${r.compliance.frameworksAdded.join(', ')}`);
    if (r.compliance.frameworksRemoved.length) parts.push(`-${r.compliance.frameworksRemoved.join(', ')}`);
    label('Compliance.frameworks', parts.join(', '));
  }
  for (const f of r.compliance.changed) {
    label(`Compliance.${f.path}`, `${fmt(f.from)} → ${fmt(f.to)}`);
  }

  if (r.hooks.added.length || r.hooks.removed.length) {
    const parts = [
      ...r.hooks.added.map(h => `+${h.event}:${h.script}${h.failOpen === false ? ' (fail_open=false)' : ''}`),
      ...r.hooks.removed.map(h => `-${h.event}:${h.script}`),
    ];
    if (r.hooks.enforcementAdded) {
      warn(`Hooks: ${parts.join(', ')}  ⚠ enforcement added`);
    } else {
      label('Hooks', parts.join(', '));
    }
  }

  if (r.memory.changed) {
    warn(`Memory: ${r.memory.files.join(', ')} changed  ⚠ review needed`);
  }

  divider();
  if (isEmpty(r)) {
    success('No semantic changes detected');
  }
}
