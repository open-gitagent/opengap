/**
 * Tests for `init` scaffolding into a directory that does not exist yet.
 *
 * Uses Node.js built-in test runner (node --test).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { initCommand } from './init.js';

describe('init -d <new dir>', () => {
  for (const template of ['minimal', 'standard', 'full', 'llm-wiki']) {
    test(`creates the target directory for the ${template} template`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'gitagent-init-test-'));
      const dir = join(root, 'nested', template);
      await initCommand.parseAsync(['-t', template, '-d', dir], { from: 'user' });
      assert.ok(existsSync(join(dir, 'agent.yaml')));
      assert.ok(existsSync(join(dir, 'SOUL.md')));
    });
  }
});
