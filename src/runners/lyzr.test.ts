/**
 * Tests for Lyzr user_id resolution.
 *
 * Uses Node.js built-in test runner (node --test).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resolveLyzrUserId } from './lyzr.js';

describe('resolveLyzrUserId', () => {
  test('never returns the API key', () => {
    const saved = process.env.LYZR_USER_ID;
    delete process.env.LYZR_USER_ID;
    try {
      const key = 'sk-test-0123456789abcdef';
      const id = resolveLyzrUserId(key);
      assert.notEqual(id, key);
      assert.ok(!id.includes(key));
      assert.match(id, /^gitagent-[0-9a-f]{16}$/);
      // Stable for the same key
      assert.equal(resolveLyzrUserId(key), id);
    } finally {
      if (saved !== undefined) process.env.LYZR_USER_ID = saved;
    }
  });

  test('prefers explicit user ID, then LYZR_USER_ID', () => {
    const saved = process.env.LYZR_USER_ID;
    process.env.LYZR_USER_ID = 'env-user';
    try {
      assert.equal(resolveLyzrUserId('key', 'explicit-user'), 'explicit-user');
      assert.equal(resolveLyzrUserId('key'), 'env-user');
    } finally {
      if (saved === undefined) delete process.env.LYZR_USER_ID;
      else process.env.LYZR_USER_ID = saved;
    }
  });
});
