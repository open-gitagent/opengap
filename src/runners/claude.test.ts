/**
 * Tests for Claude runner helpers.
 *
 * Uses Node.js built-in test runner (node --test).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { shellQuote } from './claude.js';

describe('shellQuote', () => {
  test('round-trips through a POSIX shell as a single word', () => {
    for (const value of ['/tmp/with space/hook.sh', "it's", 'plain', '$(x) `y` ;z']) {
      const out = spawnSync('sh', ['-c', `printf %s ${shellQuote(value)}`], { encoding: 'utf-8' });
      assert.equal(out.stdout, value);
    }
  });
});
