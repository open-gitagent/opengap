/**
 * Tests for registry submission input validation.
 *
 * Uses Node.js built-in test runner (node --test).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { isValidAgentName, normalizeGitHubRepoUrl } from './registry.js';

describe('isValidAgentName', () => {
  test('accepts lowercase kebab-case names', () => {
    for (const name of ['a', 'my-agent', 'agent2', 'code-review-bot']) {
      assert.equal(isValidAgentName(name), true, name);
    }
  });

  test('rejects names with other characters', () => {
    for (const name of ['', 'My-Agent', '1agent', '-agent', 'my agent', 'a;b', 'a$(b)', 'a/b', 'a"b', 'a\nb']) {
      assert.equal(isValidAgentName(name), false, JSON.stringify(name));
    }
  });
});

describe('normalizeGitHubRepoUrl', () => {
  test('normalizes valid repository URLs', () => {
    assert.equal(normalizeGitHubRepoUrl('https://github.com/org/repo'), 'https://github.com/org/repo');
    assert.equal(normalizeGitHubRepoUrl('https://github.com/org/repo/'), 'https://github.com/org/repo');
    assert.equal(normalizeGitHubRepoUrl('https://github.com/org/repo.git'), 'https://github.com/org/repo');
  });

  test('rejects non-GitHub, malformed or decorated URLs', () => {
    for (const url of [
      'http://github.com/org/repo',
      'https://github.com.evil.example/org/repo',
      'https://user@github.com/org/repo',
      'https://github.com/org',
      'https://github.com/org/repo/tree/main',
      'https://github.com/org/repo?x=1',
      'https://github.com/org/repo#frag',
      'https://github.com/org/re po',
      'https://github.com/org/repo;x',
      'not a url',
    ]) {
      assert.equal(normalizeGitHubRepoUrl(url), null, url);
    }
  });
});
