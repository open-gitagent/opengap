/**
 * Contract tests for the Claude Code runner.
 *
 * Runs `runWithClaude` against a fake `claude` binary that records the argv it
 * receives, then checks the flags match what the Claude Code CLI accepts.
 *
 * Uses Node.js built-in test runner (node --test).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWithClaude } from './claude.js';
import { loadAgentManifest } from '../utils/loader.js';

// Records the argv it was launched with.
const FAKE_CLAUDE = `#!/usr/bin/env node
require('fs').writeFileSync(process.env.FAKE_CLAUDE_OUT, JSON.stringify({ argv: process.argv.slice(2) }));
`;

// The fake binary is a shebang script, which Windows can't execute.
const skip = process.platform === 'win32';

function runAgent(files: Record<string, string>): { argv: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'gitagent-claude-runner-test-'));
  const agentDir = join(root, 'agent');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(agentDir, path, '..'), { recursive: true });
    writeFileSync(join(agentDir, path), content, 'utf-8');
  }

  const binDir = join(root, 'bin');
  mkdirSync(binDir);
  writeFileSync(join(binDir, 'claude'), FAKE_CLAUDE, 'utf-8');
  chmodSync(join(binDir, 'claude'), 0o755);

  const out = join(root, 'argv.json');
  const savedPath = process.env.PATH;
  process.env.PATH = `${binDir}${delimiter}${savedPath ?? ''}`;
  process.env.FAKE_CLAUDE_OUT = out;
  try {
    runWithClaude(agentDir, loadAgentManifest(agentDir), { prompt: 'hello' });
  } finally {
    process.env.PATH = savedPath;
    delete process.env.FAKE_CLAUDE_OUT;
  }
  assert.equal(process.exitCode ?? 0, 0, 'runner should launch the fake claude cleanly');
  return JSON.parse(readFileSync(out, 'utf-8'));
}

function flagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

const BASE_MANIFEST = `spec_version: '0.1.0'
name: test-agent
version: '0.1.0'
description: 'A test agent'
`;

const SUBAGENTS_BLOCK = `agents:
  fact-checker:
    description: Verifies factual claims
    delegation:
      mode: auto
      triggers:
        - factual_claim_detected
`;

describe('runWithClaude', () => {
  test('passes sub-agents as an object keyed by name with description and prompt', { skip }, () => {
    const { argv } = runAgent({
      'agent.yaml': BASE_MANIFEST + SUBAGENTS_BLOCK,
      'SOUL.md': 'Main agent soul.',
      'agents/fact-checker/SOUL.md': 'You verify claims against sources.',
    });

    const raw = flagValue(argv, '--agents');
    assert.ok(raw, '--agents flag should be passed');
    const agents = JSON.parse(raw);
    assert.equal(Array.isArray(agents), false, '--agents must be an object, not an array');
    assert.deepEqual(Object.keys(agents), ['fact-checker']);

    const def = agents['fact-checker'];
    assert.equal(typeof def.description, 'string');
    assert.equal(typeof def.prompt, 'string');
    assert.match(def.description, /Use when: factual_claim_detected/);
    assert.match(def.prompt, /You verify claims against sources\./);
  });

  test('omits --agents when the manifest declares no sub-agents', { skip }, () => {
    const { argv } = runAgent({ 'agent.yaml': BASE_MANIFEST, 'SOUL.md': 'Soul.' });
    assert.equal(argv.includes('--agents'), false);
  });
});
