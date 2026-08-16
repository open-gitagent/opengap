/**
 * Tests for the agent semantic diff engine.
 *
 * Uses Node.js built-in test runner (node --test).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { computeAgentDiff, diffLines, diffStringList } from './agent-diff.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentDir(): string {
  return mkdtempSync(join(tmpdir(), 'gitagent-diff-test-'));
}

function writeAgentYaml(dir: string, content: string): void {
  writeFileSync(join(dir, 'agent.yaml'), content, 'utf-8');
}

const BASE_MANIFEST = `spec_version: "0.1.0"\nname: test-agent\nversion: 0.1.0\ndescription: A test agent\n`;

// ---------------------------------------------------------------------------
// diffLines
// ---------------------------------------------------------------------------

describe('diffLines', () => {
  test('reports no changes for identical text', () => {
    const result = diffLines('a\nb\nc', 'a\nb\nc');
    assert.deepEqual(result, { added: 0, removed: 0 });
  });

  test('counts pure additions', () => {
    const result = diffLines('a\nb', 'a\nb\nc\nd');
    assert.deepEqual(result, { added: 2, removed: 0 });
  });

  test('counts pure removals', () => {
    const result = diffLines('a\nb\nc', 'a');
    assert.deepEqual(result, { added: 0, removed: 2 });
  });

  test('handles null (file not present) on either side', () => {
    assert.deepEqual(diffLines(null, 'a\nb'), { added: 2, removed: 0 });
    assert.deepEqual(diffLines('a\nb', null), { added: 0, removed: 2 });
    assert.deepEqual(diffLines(null, null), { added: 0, removed: 0 });
  });
});

// ---------------------------------------------------------------------------
// diffStringList
// ---------------------------------------------------------------------------

describe('diffStringList', () => {
  test('separates added, removed, and common entries', () => {
    const result = diffStringList(['a', 'b', 'c'], ['b', 'c', 'd']);
    assert.deepEqual(result.added, ['d']);
    assert.deepEqual(result.removed, ['a']);
    assert.deepEqual(result.common, ['b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// computeAgentDiff
// ---------------------------------------------------------------------------

describe('computeAgentDiff — manifest fields', () => {
  test('reports no manifest changes for identical agents', () => {
    const from = makeAgentDir();
    const to = makeAgentDir();
    writeAgentYaml(from, BASE_MANIFEST);
    writeAgentYaml(to, BASE_MANIFEST);

    const result = computeAgentDiff(from, to, 'from', 'to');
    assert.deepEqual(result.manifest, []);
  });

  test('detects a version bump', () => {
    const from = makeAgentDir();
    const to = makeAgentDir();
    writeAgentYaml(from, BASE_MANIFEST);
    writeAgentYaml(to, BASE_MANIFEST.replace('version: 0.1.0', 'version: 0.2.0'));

    const result = computeAgentDiff(from, to, 'from', 'to');
    const versionChange = result.manifest.find(c => c.path === 'version');
    assert.ok(versionChange, 'expected a version field change');
    assert.equal(versionChange!.from, '0.1.0');
    assert.equal(versionChange!.to, '0.2.0');
  });

  test('handles a missing agent.yaml on one side without throwing', () => {
    const from = makeAgentDir();
    const to = makeAgentDir();
    writeAgentYaml(to, BASE_MANIFEST);

    const result = computeAgentDiff(from, to, 'from', 'to');
    assert.equal(result.manifestPresent.from, false);
    assert.equal(result.manifestPresent.to, true);
  });
});

describe('computeAgentDiff — identity and rules', () => {
  test('flags SOUL.md as unchanged when identical', () => {
    const from = makeAgentDir();
    const to = makeAgentDir();
    writeFileSync(join(from, 'SOUL.md'), '# Soul\nI am helpful.\n');
    writeFileSync(join(to, 'SOUL.md'), '# Soul\nI am helpful.\n');

    const result = computeAgentDiff(from, to, 'from', 'to');
    assert.equal(result.identity.changed, false);
  });

  test('counts added/removed lines in RULES.md', () => {
    const from = makeAgentDir();
    const to = makeAgentDir();
    writeFileSync(join(from, 'RULES.md'), 'Rule 1\nRule 2\n');
    writeFileSync(join(to, 'RULES.md'), 'Rule 1\nRule 2\nRule 3\nRule 4\n');

    const result = computeAgentDiff(from, to, 'from', 'to');
    assert.equal(result.rules.added, 2);
    assert.equal(result.rules.removed, 0);
    assert.equal(result.rules.changed, true);
  });
});

describe('computeAgentDiff — skills, tools, workflows', () => {
  function addSkill(dir: string, name: string, description: string): void {
    const skillDir = join(dir, 'skills', name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\nDo the thing.\n`);
  }

  test('detects added, removed, and modified skills', () => {
    const from = makeAgentDir();
    const to = makeAgentDir();
    addSkill(from, 'code-review', 'Reviews code');
    addSkill(from, 'old-skill', 'Will be removed');
    addSkill(to, 'code-review', 'Reviews code thoroughly'); // modified description
    addSkill(to, 'new-skill', 'Brand new');

    const result = computeAgentDiff(from, to, 'from', 'to');
    assert.deepEqual(result.skills.added, ['new-skill']);
    assert.deepEqual(result.skills.removed, ['old-skill']);
    assert.deepEqual(result.skills.modified, ['code-review']);
  });

  test('detects added tool YAML files', () => {
    const from = makeAgentDir();
    const to = makeAgentDir();
    mkdirSync(join(to, 'tools'), { recursive: true });
    writeFileSync(join(to, 'tools', 'lint-check.yaml'), 'name: lint-check\n');

    const result = computeAgentDiff(from, to, 'from', 'to');
    assert.deepEqual(result.tools.added, ['lint-check']);
    assert.deepEqual(result.tools.removed, []);
  });
});

describe('computeAgentDiff — compliance', () => {
  function withCompliance(riskTier: string, frameworks: string[]): string {
    return `${BASE_MANIFEST}compliance:\n  risk_tier: ${riskTier}\n  frameworks:\n${frameworks.map(f => `    - ${f}`).join('\n')}\n`;
  }

  test('flags risk tier escalation', () => {
    const from = makeAgentDir();
    const to = makeAgentDir();
    writeAgentYaml(from, withCompliance('low', []));
    writeAgentYaml(to, withCompliance('high', []));

    const result = computeAgentDiff(from, to, 'from', 'to');
    assert.equal(result.compliance.riskTier.from, 'low');
    assert.equal(result.compliance.riskTier.to, 'high');
    assert.equal(result.compliance.riskEscalated, true);
  });

  test('does not flag a risk tier downgrade as escalation', () => {
    const from = makeAgentDir();
    const to = makeAgentDir();
    writeAgentYaml(from, withCompliance('critical', []));
    writeAgentYaml(to, withCompliance('medium', []));

    const result = computeAgentDiff(from, to, 'from', 'to');
    assert.equal(result.compliance.riskEscalated, false);
  });

  test('reports framework additions and removals', () => {
    const from = makeAgentDir();
    const to = makeAgentDir();
    writeAgentYaml(from, withCompliance('medium', ['finra']));
    writeAgentYaml(to, withCompliance('medium', ['finra', 'sec']));

    const result = computeAgentDiff(from, to, 'from', 'to');
    assert.deepEqual(result.compliance.frameworksAdded, ['sec']);
    assert.deepEqual(result.compliance.frameworksRemoved, []);
  });

  test('detects segregation-of-duties conflict pairs added, order-insensitively', () => {
    const from = makeAgentDir();
    const to = makeAgentDir();
    writeAgentYaml(from, BASE_MANIFEST);
    writeAgentYaml(
      to,
      `${BASE_MANIFEST}compliance:\n  segregation_of_duties:\n    conflicts:\n      - [maker, checker]\n`,
    );

    const result = computeAgentDiff(from, to, 'from', 'to');
    assert.deepEqual(result.duties.conflictsAdded, [['maker', 'checker']]);
  });
});

describe('computeAgentDiff — hooks', () => {
  function writeHooks(dir: string, failOpen: boolean): void {
    mkdirSync(join(dir, 'hooks'), { recursive: true });
    writeFileSync(
      join(dir, 'hooks', 'hooks.yaml'),
      `hooks:\n  pre_tool_use:\n    - script: scripts/spending-cap.sh\n      fail_open: ${failOpen}\n`,
    );
  }

  test('flags enforcement added when a new hook has fail_open: false', () => {
    const from = makeAgentDir();
    const to = makeAgentDir();
    writeHooks(to, false);

    const result = computeAgentDiff(from, to, 'from', 'to');
    assert.equal(result.hooks.added.length, 1);
    assert.equal(result.hooks.enforcementAdded, true);
  });

  test('does not flag enforcement when the new hook has fail_open: true', () => {
    const from = makeAgentDir();
    const to = makeAgentDir();
    writeHooks(to, true);

    const result = computeAgentDiff(from, to, 'from', 'to');
    assert.equal(result.hooks.enforcementAdded, false);
  });
});

describe('computeAgentDiff — memory', () => {
  test('detects changed files under memory/', () => {
    const from = makeAgentDir();
    const to = makeAgentDir();
    mkdirSync(join(from, 'memory'), { recursive: true });
    mkdirSync(join(to, 'memory'), { recursive: true });
    writeFileSync(join(from, 'memory', 'MEMORY.md'), 'v1');
    writeFileSync(join(to, 'memory', 'MEMORY.md'), 'v2');

    const result = computeAgentDiff(from, to, 'from', 'to');
    assert.equal(result.memory.changed, true);
    assert.deepEqual(result.memory.files, ['MEMORY.md']);
  });

  test('reports unchanged when memory/ is absent on both sides', () => {
    const from = makeAgentDir();
    const to = makeAgentDir();

    const result = computeAgentDiff(from, to, 'from', 'to');
    assert.equal(result.memory.changed, false);
  });
});
