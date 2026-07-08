import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import _Ajv from 'ajv';
import { gitagentAdapter } from './gitagent.js';
import { loadSchema } from '../utils/schemas.js';
import { CanonicalSession, SESSION_SCHEMA_VERSION } from './canonical.js';

const Ajv = _Ajv as unknown as typeof _Ajv.default;

function sampleSession(): CanonicalSession {
  return {
    schema_version: SESSION_SCHEMA_VERSION,
    source: 'copilot',
    session_id: 'abc123',
    cwd: '/tmp/x',
    items: [
      { type: 'message', role: 'user', text: 'create hello.txt' },
      { type: 'tool_call', id: 'call_1', name: 'create', args: { path: 'hello.txt' } },
      { type: 'tool_result', id: 'call_1', content: 'Created file', is_error: false },
      { type: 'message', role: 'assistant', text: 'Done — created hello.txt.' },
    ],
  };
}

describe('canonical session schema', () => {
  test('a sample session validates against session.schema.json', () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const schema = loadSchema('session') as Record<string, unknown>;
    delete schema['$schema'];
    delete schema['$id'];
    const validate = ajv.compile(schema);
    assert.ok(validate(sampleSession()), JSON.stringify(validate.errors));
  });

  test('bare message without role fails validation', () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const schema = loadSchema('session') as Record<string, unknown>;
    delete schema['$schema'];
    delete schema['$id'];
    const validate = ajv.compile(schema);
    const bad = { schema_version: '0.1.0', source: 'x', items: [{ type: 'message', text: 'hi' }] };
    assert.equal(validate(bad), false);
  });
});

describe('gitagent adapter round-trip', () => {
  test('write produces MEMORY.md + chat-history, read recovers items', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitagent-session-test-'));
    const res = gitagentAdapter.write!(sampleSession(), { dir, sessionId: 'test-branch' });

    // MEMORY.md written with the user ask + tools used
    const mem = join(dir, 'memory', 'MEMORY.md');
    assert.ok(existsSync(mem));
    const memText = readFileSync(mem, 'utf-8');
    assert.match(memText, /create hello\.txt/);
    assert.match(memText, /Tools used:.*create/);
    assert.ok(res.paths.includes(mem));

    // chat-history round-trips back through read
    const back = gitagentAdapter.read!({ dir, sessionId: 'test-branch' });
    const types = back.items.map(i => i.type);
    assert.deepEqual(types, ['message', 'tool_call', 'tool_result', 'message']);

    // write prefixes `chat/` onto the branch (so it shows in the voice UI); the
    // file is chat__test-branch.jsonl, and read(sessionId) round-trips via the fallback.
    const chatFile = join(dir, '.gitagent', 'chat-history', 'chat__test-branch.jsonl');
    assert.match(readFileSync(chatFile, 'utf-8'), /"type":"tool_result","toolName":"create"/);
  });
});
