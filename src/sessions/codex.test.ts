import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseRollout } from './codex.js';

/**
 * Build a Codex rollout JSONL fixture (one record per line). Each record is a
 * full envelope `{ timestamp, type, payload }` — the parser reads conversation
 * from records whose top-level `type` is "response_item". Tests that pass a
 * pre-serialized `msg(...)` string still carry this envelope.
 */
function rollout(records: Array<{ type: string; payload: Record<string, unknown> }>): string {
  return records.map(r => JSON.stringify({ timestamp: '2026-07-08T00:00:00.000Z', ...r })).join('\n') + '\n';
}

const msg = (role: string, text: string) => ({
  type: 'response_item',
  payload: { type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] },
});

describe('codex parseRollout', () => {
  test('maps messages, tool calls, and tool results in order', () => {
    const content = rollout([
      { type: 'session_meta', payload: { id: 'x', cwd: '/tmp/proj', timestamp: '2026-07-08T00:00:00.000Z' } },
      { type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } }, // ignored (UI log)
      msg('user', 'create hello.txt'),
      { type: 'response_item', payload: { type: 'function_call', name: 'create', arguments: '{"path":"hello.txt"}', call_id: 'c1' } },
      { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: 'Created file' } },
      msg('assistant', 'Done — created hello.txt.'),
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1' } }, // ignored
    ]);

    const { items, cwd, createdAt } = parseRollout(content);
    assert.equal(cwd, '/tmp/proj');
    assert.equal(createdAt, '2026-07-08T00:00:00.000Z');
    assert.deepEqual(items.map(i => i.type), ['message', 'tool_call', 'tool_result', 'message']);

    const call = items[1] as { type: 'tool_call'; name: string; args: Record<string, unknown> };
    assert.equal(call.name, 'create');
    assert.deepEqual(call.args, { path: 'hello.txt' }); // JSON-string args parsed to an object
    assert.equal((items[2] as { content: string }).content, 'Created file');
  });

  test('drops Codex synthetic context injections', () => {
    const content = rollout([
      msg('user', '<environment_context>\n<cwd>/tmp</cwd>\n</environment_context>'),
      msg('user', '<user_instructions>\nfollow AGENTS.md\n</user_instructions>'),
      { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<permissions instructions>\nsandbox rules\n</permissions>' }] } },
      msg('user', 'Hello, i am a story writer'),
      msg('assistant', 'What are you working on?'),
    ]);

    const { items } = parseRollout(content);
    // Only the two real turns survive; the three synthetic injections are gone.
    assert.deepEqual(
      items.map(i => (i as { text: string }).text),
      ['Hello, i am a story writer', 'What are you working on?'],
    );
  });

  test('malformed JSON lines are skipped, not fatal', () => {
    const content = 'not json\n' + JSON.stringify(msg('user', 'hi')) + '\n{"partial":';
    const { items } = parseRollout(content);
    assert.equal(items.length, 1);
    assert.equal((items[0] as { text: string }).text, 'hi');
  });
});
