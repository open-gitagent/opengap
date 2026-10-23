/**
 * Tests for the AutoGen adapter (export).
 *
 * Uses Node.js built-in test runner (node --test).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { exportToAutogen, exportToAutogenScript } from './autogen.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentDir(opts: {
  name?: string;
  description?: string;
  model?: string;
  agents?: Record<string, { description: string; soul?: string }>;
  tools?: Array<{ name: string; description: string }>;
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitagent-autogen-test-'));

  const modelBlock = opts.model ? `model:\n  preferred: ${opts.model}\n` : '';
  const agentsBlock = opts.agents
    ? `agents:\n${Object.entries(opts.agents)
        .map(([n, a]) => `  ${n}:\n    description: '${a.description}'\n`)
        .join('')}`
    : '';

  writeFileSync(
    join(dir, 'agent.yaml'),
    `spec_version: '0.1.0'\nname: ${opts.name ?? 'test-agent'}\nversion: '0.1.0'\ndescription: '${opts.description ?? 'A test agent'}'\n${modelBlock}${agentsBlock}`,
    'utf-8',
  );
  writeFileSync(join(dir, 'SOUL.md'), '# Soul\nI am a test agent.\n', 'utf-8');

  for (const [n, a] of Object.entries(opts.agents ?? {})) {
    if (a.soul === undefined) continue;
    const subDir = join(dir, 'agents', n);
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'SOUL.md'), a.soul, 'utf-8');
  }

  if (opts.tools) {
    mkdirSync(join(dir, 'tools'), { recursive: true });
    for (const t of opts.tools) {
      writeFileSync(
        join(dir, 'tools', `${t.name}.yaml`),
        `name: ${t.name}\ndescription: '${t.description}'\ninput_schema:\n  properties:\n    query:\n      type: string\n      description: The query\n  required: [query]\n`,
        'utf-8',
      );
    }
  }

  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('exportToAutogen', () => {
  test('single agent without sub-agents uses AssistantAgent only', () => {
    const dir = makeAgentDir({ name: 'solo', model: 'gpt-4o' });
    const script = exportToAutogen(dir);

    assert.ok(script.includes('AssistantAgent('));
    assert.ok(script.includes('name="""solo"""'));
    assert.ok(script.includes('Console(agent_solo.run_stream(task=task))'));
    assert.ok(!script.includes('SelectorGroupChat'));
    assert.ok(!script.includes('TERMINATE'));
  });

  test('sub-agents produce a SelectorGroupChat with every participant', () => {
    const dir = makeAgentDir({
      name: 'helpdesk',
      model: 'gpt-4o',
      agents: {
        'reservations-agent': { description: 'Handles bookings and check-in times.', soul: '# Soul\nCheck in is 3 PM.\n' },
        'billing-agent': { description: 'Answers billing questions.' },
      },
    });
    const script = exportToAutogen(dir);

    assert.ok(script.includes('SelectorGroupChat('));
    assert.ok(script.includes('[agent_helpdesk, agent_reservations_agent, agent_billing_agent]'));
    assert.ok(script.includes('TextMentionTermination("TERMINATE")'));
    assert.ok(script.includes('MaxMessageTermination(20)'));
    assert.ok(script.includes('allow_repeated_speaker=False'));
  });

  test('sub-agent descriptions and souls reach the generated script', () => {
    const dir = makeAgentDir({
      agents: { 'reservations-agent': { description: 'Handles bookings and check-in times.', soul: '# Soul\nCheck in is 3 PM.\n' } },
    });
    const script = exportToAutogen(dir);

    assert.ok(script.includes('description="""Handles bookings and check-in times."""'));
    assert.ok(script.includes('Check in is 3 PM.'));
    // The coordinator is told about its team.
    assert.ok(script.includes('- reservations_agent: Handles bookings and check-in times.'));
  });

  test('selector prompt keeps AutoGen placeholders and names the main agent', () => {
    const dir = makeAgentDir({
      name: 'helpdesk',
      agents: { helper: { description: 'Helps.' } },
    });
    const script = exportToAutogen(dir);

    for (const placeholder of ['{roles}', '{history}', '{participants}']) {
      assert.ok(script.includes(placeholder), `missing ${placeholder}`);
    }
    assert.ok(script.includes('"helpdesk" is the main agent'));
  });

  test('tools become FunctionTools attached to the agent', () => {
    const dir = makeAgentDir({ tools: [{ name: 'lookup', description: 'Looks things up.' }] });
    const script = exportToAutogen(dir);

    assert.ok(script.includes('async def lookup('));
    assert.ok(script.includes('lookup_tool = FunctionTool(lookup'));
    assert.ok(script.includes('tools=[lookup_tool]'));
    assert.ok(script.includes('reflect_on_tool_use=True'));
  });

  test('model from agent.yaml is the default; otherwise LLM_MODEL env var', () => {
    assert.ok(exportToAutogen(makeAgentDir({ model: 'gpt-4o' })).includes('DEFAULT_MODEL = """gpt-4o"""'));
    assert.ok(exportToAutogen(makeAgentDir({})).includes('DEFAULT_MODEL = os.environ.get("LLM_MODEL")'));
  });

  test('prompt option overrides the default task', () => {
    const dir = makeAgentDir({ description: 'Default description' });

    assert.ok(exportToAutogenScript(dir).includes('DEFAULT_TASK = """Default description"""'));
    assert.ok(exportToAutogenScript(dir, { prompt: 'Do the thing' }).includes('DEFAULT_TASK = """Do the thing"""'));
  });

  test('agent names that are not Python identifiers are sanitised', () => {
    const dir = makeAgentDir({ name: '1st-agent' });
    assert.ok(exportToAutogen(dir).includes('agent__1st_agent'));
  });
});
