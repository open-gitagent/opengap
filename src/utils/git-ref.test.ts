/**
 * Tests for git ref materialization (used by `opengap diff` to compare
 * an agent directory against a past commit, branch, or tag).
 *
 * Uses Node.js built-in test runner (node --test).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { materializeGitRef } from './git-ref.js';

function makeRepoWithTwoCommits(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitagent-ref-test-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });

  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');

  writeFileSync(join(dir, 'agent.yaml'), 'name: test-agent\nversion: 0.1.0\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');

  writeFileSync(join(dir, 'agent.yaml'), 'name: test-agent\nversion: 0.2.0\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'bump version');

  return dir;
}

describe('materializeGitRef', () => {
  test('extracts the file tree at the given ref into a temp directory', () => {
    const repo = makeRepoWithTwoCommits();
    const { dir, cleanup } = materializeGitRef(repo, 'HEAD~1');
    try {
      const content = readFileSync(join(dir, 'agent.yaml'), 'utf-8');
      assert.match(content, /version: 0\.1\.0/);
    } finally {
      cleanup();
    }
  });

  test('HEAD resolves to the latest commit content', () => {
    const repo = makeRepoWithTwoCommits();
    const { dir, cleanup } = materializeGitRef(repo, 'HEAD');
    try {
      const content = readFileSync(join(dir, 'agent.yaml'), 'utf-8');
      assert.match(content, /version: 0\.2\.0/);
    } finally {
      cleanup();
    }
  });

  test('cleanup removes the temp directory', () => {
    const repo = makeRepoWithTwoCommits();
    const { dir, cleanup } = materializeGitRef(repo, 'HEAD');
    assert.ok(existsSync(dir));
    cleanup();
    assert.equal(existsSync(dir), false);
  });

  test('throws a helpful error for a nonexistent ref', () => {
    const repo = makeRepoWithTwoCommits();
    assert.throws(() => materializeGitRef(repo, 'not-a-real-ref'), /not a valid git ref/);
  });
});
