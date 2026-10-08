/**
 * Tests for install path confinement (mount targets and local sources).
 *
 * Uses Node.js built-in test runner (node --test).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveInstallTarget, resolveLocalSource } from './install.js';

function makeDirs(): { root: string; agentDir: string; depsDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'gitagent-install-test-'));
  const agentDir = join(root, 'agent');
  const depsDir = join(agentDir, '.gitagent', 'deps');
  mkdirSync(depsDir, { recursive: true });
  return { root, agentDir, depsDir };
}

describe('resolveInstallTarget', () => {
  test('accepts a relative mount inside the agent directory', () => {
    const { agentDir, depsDir } = makeDirs();
    const res = resolveInstallTarget(agentDir, depsDir, { name: 'dep', mount: 'agents/dep' });
    assert.deepEqual(res, { path: join(agentDir, 'agents', 'dep') });
  });

  test('defaults to .gitagent/deps/<name>', () => {
    const { agentDir, depsDir } = makeDirs();
    const res = resolveInstallTarget(agentDir, depsDir, { name: 'dep' });
    assert.deepEqual(res, { path: join(depsDir, 'dep') });
  });

  test('rejects mounts that escape or equal the agent directory', () => {
    const { agentDir, depsDir } = makeDirs();
    for (const mount of ['../x', '../../x', 'a/../../x', '.', './', '/tmp/x']) {
      const res = resolveInstallTarget(agentDir, depsDir, { name: 'dep', mount });
      assert.ok('error' in res, `mount ${mount} should be rejected`);
    }
  });

  test('rejects dependency names that escape the deps directory', () => {
    const { agentDir, depsDir } = makeDirs();
    const res = resolveInstallTarget(agentDir, depsDir, { name: '../../escape' });
    assert.ok('error' in res);
  });
});

describe('resolveLocalSource', () => {
  test('returns null for non-local sources', () => {
    const { agentDir } = makeDirs();
    assert.equal(resolveLocalSource(agentDir, 'https://github.com/org/repo.git', false), null);
  });

  test('accepts local sources inside the agent directory', () => {
    const { agentDir } = makeDirs();
    mkdirSync(join(agentDir, 'vendor', 'dep'), { recursive: true });
    assert.deepEqual(resolveLocalSource(agentDir, './vendor/dep', false), { path: join(agentDir, 'vendor', 'dep') });
  });

  test('rejects local sources outside the agent directory unless allowed', () => {
    const { root, agentDir } = makeDirs();
    mkdirSync(join(root, 'sibling'), { recursive: true });
    const denied = resolveLocalSource(agentDir, '../sibling', false);
    assert.ok(denied && 'error' in denied);
    const deniedAbs = resolveLocalSource(agentDir, join(root, 'sibling'), false);
    assert.ok(deniedAbs && 'error' in deniedAbs);
    assert.deepEqual(resolveLocalSource(agentDir, '../sibling', true), { path: join(root, 'sibling') });
  });
});
