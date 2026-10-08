/**
 * Tests for path confinement helpers and knowledge document loading
 * across all adapters that inline always_load knowledge.
 *
 * Uses Node.js built-in test runner (node --test).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { isPathInside, resolveInside, loadKnowledgeDocument } from './path-safety.js';
import { exportToSystemPrompt } from '../adapters/system-prompt.js';
import { exportToClaudeCodeString } from '../adapters/claude-code.js';
import { exportToOpenClawString } from '../adapters/openclaw.js';
import { exportToCopilotString } from '../adapters/copilot.js';
import { exportToKiroString } from '../adapters/kiro.js';
import { exportToGeminiString } from '../adapters/gemini.js';
import { exportToOpenCodeString } from '../adapters/opencode.js';
import { exportToCodexString } from '../adapters/codex.js';
import { exportToNanobotString } from '../adapters/nanobot.js';

const ADAPTERS: Array<[string, (dir: string) => string]> = [
  ['system-prompt', exportToSystemPrompt],
  ['claude-code', exportToClaudeCodeString],
  ['openclaw', exportToOpenClawString],
  ['copilot', exportToCopilotString],
  ['kiro', exportToKiroString],
  ['gemini', exportToGeminiString],
  ['opencode', exportToOpenCodeString],
  ['codex', exportToCodexString],
  ['nanobot', exportToNanobotString],
];

function makeAgentDir(knowledgeIndex: string): { root: string; agentDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'gitagent-pathsafety-test-'));
  const agentDir = join(root, 'agent');
  mkdirSync(join(agentDir, 'knowledge'), { recursive: true });
  writeFileSync(
    join(agentDir, 'agent.yaml'),
    `spec_version: '0.1.0'\nname: test-agent\nversion: '0.1.0'\ndescription: 'A test agent'\n`,
    'utf-8',
  );
  writeFileSync(join(agentDir, 'SOUL.md'), '# Soul\nHelpful.\n', 'utf-8');
  writeFileSync(join(agentDir, 'knowledge', 'index.yaml'), knowledgeIndex, 'utf-8');
  return { root, agentDir };
}

describe('isPathInside', () => {
  test('accepts strict descendants', () => {
    assert.equal(isPathInside('/a/b', '/a/b/c'), true);
    assert.equal(isPathInside('/a/b', '/a/b/c/d.txt'), true);
  });

  test('rejects the directory itself, siblings and parents', () => {
    assert.equal(isPathInside('/a/b', '/a/b'), false);
    assert.equal(isPathInside('/a/b', '/a/bc'), false);
    assert.equal(isPathInside('/a/b', '/a'), false);
    assert.equal(isPathInside('/a/b', '/a/b/../c'), false);
  });
});

describe('resolveInside', () => {
  test('resolves relative paths inside the base', () => {
    const base = mkdtempSync(join(tmpdir(), 'gitagent-ri-'));
    assert.equal(resolveInside(base, 'x/y.md'), join(base, 'x', 'y.md'));
  });

  test('rejects absolute paths, parent traversal and the base itself', () => {
    const base = mkdtempSync(join(tmpdir(), 'gitagent-ri-'));
    assert.equal(resolveInside(base, '/etc/hostname'), null);
    assert.equal(resolveInside(base, '../outside'), null);
    assert.equal(resolveInside(base, 'a/../../outside'), null);
    assert.equal(resolveInside(base, '.'), null);
    assert.equal(resolveInside(base, ''), null);
  });

  test('rejects symlinks that point outside the base', () => {
    const root = mkdtempSync(join(tmpdir(), 'gitagent-ri-'));
    const base = join(root, 'base');
    const outside = join(root, 'outside');
    mkdirSync(base);
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'nope', 'utf-8');
    symlinkSync(join(outside, 'secret.txt'), join(base, 'file-link'));
    symlinkSync(outside, join(base, 'dir-link'));

    assert.equal(resolveInside(base, 'file-link'), null);
    assert.equal(resolveInside(base, 'dir-link/secret.txt'), null);
    assert.equal(resolveInside(base, 'dir-link/not-yet-created'), null);
  });
});

describe('loadKnowledgeDocument', () => {
  test('reads documents inside knowledge/ and skips escapes', () => {
    const { root, agentDir } = makeAgentDir('documents: []\n');
    const knowledgeDir = join(agentDir, 'knowledge');
    writeFileSync(join(knowledgeDir, 'ok.md'), 'inside', 'utf-8');
    writeFileSync(join(root, 'outside.md'), 'outside', 'utf-8');

    assert.equal(loadKnowledgeDocument(knowledgeDir, 'ok.md'), 'inside');
    assert.equal(loadKnowledgeDocument(knowledgeDir, '../../outside.md'), null);
    assert.equal(loadKnowledgeDocument(knowledgeDir, join(root, 'outside.md')), null);
    assert.equal(loadKnowledgeDocument(knowledgeDir, 'missing.md'), null);
  });
});

describe('adapters: knowledge confinement', () => {
  for (const [name, exportFn] of ADAPTERS) {
    test(`${name} inlines in-tree documents but not ones outside knowledge/`, () => {
      const { root, agentDir } = makeAgentDir(
        'documents:\n' +
        '  - path: guide.md\n    always_load: true\n' +
        '  - path: ../../outside.md\n    always_load: true\n' +
        '  - path: linked.md\n    always_load: true\n',
      );
      writeFileSync(join(agentDir, 'knowledge', 'guide.md'), 'IN_TREE_MARKER', 'utf-8');
      writeFileSync(join(root, 'outside.md'), 'OUTSIDE_MARKER', 'utf-8');
      writeFileSync(join(root, 'linked-target.md'), 'SYMLINK_MARKER', 'utf-8');
      symlinkSync(join(root, 'linked-target.md'), join(agentDir, 'knowledge', 'linked.md'));

      const out = exportFn(agentDir);
      assert.ok(out.includes('IN_TREE_MARKER'), 'in-tree knowledge should be included');
      assert.ok(!out.includes('OUTSIDE_MARKER'), 'traversal path must not be read');
      assert.ok(!out.includes('SYMLINK_MARKER'), 'symlink escape must not be read');
    });

    test(`${name} tolerates an empty knowledge/index.yaml`, () => {
      const { agentDir } = makeAgentDir('');
      assert.doesNotThrow(() => exportFn(agentDir));
    });
  }
});
