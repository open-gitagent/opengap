import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseGeminiSession, geminiAdapter } from './gemini.js';
import { CanonicalSession, SESSION_SCHEMA_VERSION } from './canonical.js';

/** Build a Gemini session JSONL fixture (metadata line + records). */
function jsonl(records: object[]): string {
  return records.map(r => JSON.stringify(r)).join('\n') + '\n';
}

/** Read back the records the writer produced (skips the metadata line). */
function writeAndReadRecords(session: CanonicalSession): any[] {
  const dir = mkdtempSync(join(tmpdir(), 'gemini-write-test-'));
  const res = geminiAdapter.write!(session, { dir });
  return readFileSync(res.paths[0], 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

describe('gemini parseGeminiSession', () => {
  test('maps user/gemini turns, tool calls, and tool results in order', () => {
    const content = jsonl([
      { sessionId: 'abc-123', startTime: '2026-07-08T00:00:00.000Z', kind: 'main' }, // metadata
      { $set: { messages: [] } }, // event-sourced patch → ignored
      { id: 'm1', type: 'user', content: [{ text: 'read the file' }] },
      { id: 'm2', type: 'gemini', content: '', toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'x.ts' } }] },
      { id: 'm3', type: 'user', content: [{ functionResponse: { id: 'c1', name: 'read_file', response: { output: 'file body' } } }] },
      // m4 carries BOTH `thoughts` and `content`, so it yields two items in
      // order: a `reasoning` (from thoughts) then a `message` (from content).
      { id: 'm4', type: 'gemini', content: 'Here is the summary.', thoughts: 'thinking…' },
    ]);

    const { items, sessionId, createdAt } = parseGeminiSession(content);
    assert.equal(sessionId, 'abc-123');
    assert.equal(createdAt, '2026-07-08T00:00:00.000Z');
    // m1→message, m2→tool_call, m3→tool_result, m4→reasoning+message.
    assert.deepEqual(items.map(i => i.type), ['message', 'tool_call', 'tool_result', 'reasoning', 'message']);

    assert.equal((items[0] as { text: string }).text, 'read the file');
    const call = items[1] as { name: string; args: Record<string, unknown>; id?: string };
    assert.equal(call.name, 'read_file');
    assert.deepEqual(call.args, { path: 'x.ts' });
    assert.equal(call.id, 'c1');
    const result = items[2] as { id?: string; content: string; is_error?: boolean };
    assert.equal(result.id, 'c1');
    assert.match(result.content, /file body/);
    assert.equal(result.is_error, false);
    assert.equal((items[4] as { text: string }).text, 'Here is the summary.');
  });

  test('dedupes the repeated assistant text Gemini logs alongside a tool call', () => {
    const content = jsonl([
      { sessionId: 's', startTime: '2026-07-08T00:00:00.000Z' },
      { id: 'u1', type: 'user', content: [{ text: 'update my memory' }] },
      { id: 'g1', type: 'gemini', content: 'Done — updated your memory.' }, // streamed text
      { id: 'g2', type: 'gemini', content: 'Done — updated your memory.', toolCalls: [{ id: 'c1', name: 'replace', args: {} }] }, // same text + tool call
      { id: 'u2', type: 'user', content: [{ functionResponse: { id: 'c1', response: { output: 'ok' } } }] },
      { id: 'g3', type: 'gemini', content: 'All set!' },
    ]);

    const { items } = parseGeminiSession(content);
    // The duplicate assistant line is dropped; its tool call is kept.
    assert.deepEqual(items.map(i => i.type), ['message', 'message', 'tool_call', 'tool_result', 'message']);
    const texts = items.filter(i => i.type === 'message').map(i => (i as { text: string }).text);
    assert.deepEqual(texts, ['update my memory', 'Done — updated your memory.', 'All set!']);
  });

  test('flags error tool results and drops info/synthetic messages', () => {
    const content = jsonl([
      { sessionId: 's', startTime: '2026-07-08T00:00:00.000Z' },
      { id: 'i1', type: 'info', content: 'Authentication succeeded' }, // UI banner → skip
      { id: 'u0', type: 'user', content: [{ text: '<session_context>\nsetup\n</session_context>' }] }, // synthetic → skip
      { id: 'u1', type: 'user', content: [{ text: 'hello' }] },
      { id: 'u2', type: 'user', content: [{ functionResponse: { id: 'c9', response: { error: 'File not found' } } }] },
    ]);

    const { items } = parseGeminiSession(content);
    assert.deepEqual(items.map(i => i.type), ['message', 'tool_result']);
    assert.equal((items[0] as { text: string }).text, 'hello');
    assert.equal((items[1] as { is_error?: boolean }).is_error, true);
  });
});

describe('gemini writeGemini tool steps', () => {
  const base: Omit<CanonicalSession, 'items'> = { schema_version: SESSION_SCHEMA_VERSION, source: 'codex' };

  test('carries tool_call/tool_result (with ids) as toolCalls + functionResponse, paired by id', () => {
    const recs = writeAndReadRecords({
      ...base,
      items: [
        { type: 'message', role: 'user', text: 'read app.js' },
        { type: 'tool_call', id: 'c1', name: 'read_file', args: { path: 'app.js' } },
        { type: 'tool_result', id: 'c1', content: 'file body', is_error: false },
        { type: 'message', role: 'assistant', text: 'Done.' },
      ],
    });

    const call = recs.find(r => Array.isArray(r.toolCalls));
    assert.equal(call.type, 'gemini');
    assert.equal(call.toolCalls[0].id, 'c1');
    assert.equal(call.toolCalls[0].name, 'read_file');

    const result = recs.find(r => Array.isArray(r.content) && r.content[0]?.functionResponse);
    assert.equal(result.type, 'user');
    assert.equal(result.content[0].functionResponse.id, 'c1'); // paired to the call
    assert.equal(result.content[0].functionResponse.name, 'read_file');
    assert.deepEqual(result.content[0].functionResponse.response, { output: 'file body' });
  });

  test('drops tool steps when ids are absent (order-linked sources like gitagent)', () => {
    const recs = writeAndReadRecords({
      ...base,
      source: 'gitagent',
      items: [
        { type: 'message', role: 'user', text: 'do it' },
        { type: 'tool_call', name: 'read_file', args: {} }, // no id
        { type: 'tool_result', content: 'body' }, // no id
        { type: 'message', role: 'assistant', text: 'Done.' },
      ],
    });

    assert.ok(!recs.some(r => Array.isArray(r.toolCalls)), 'no toolCalls records');
    assert.ok(!recs.some(r => Array.isArray(r.content) && r.content[0]?.functionResponse), 'no functionResponse records');
    // conversation still carried
    assert.deepEqual(
      recs.filter(r => r.type === 'user' || r.type === 'gemini').map(r => (Array.isArray(r.content) ? r.content[0].text : r.content)),
      ['do it', 'Done.'],
    );
  });
});
