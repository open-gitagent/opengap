/**
 * Tests for the DeepAgents adapter (export).
 *
 * Uses Node.js built-in test runner (node --test).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { exportToDeepAgents, exportToDeepAgentsString } from './deepagents.js';

// Helpers

interface MakeAgentDirOpts {
  name?: string;
  description?: string;
  version?: string;
  soul?: string;
  rules?: string;
  duties?: string;
  model?: string;
  skills?: Array<{ name: string; description: string; instructions: string }>;
  tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
  hooks?: Record<string, Array<{ script: string }>>;
  subAgents?: Array<{ name: string; description: string; soul?: string }>;
}

function makeAgentDir(opts: MakeAgentDirOpts): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitagent-deepagents-test-'));

  const modelBlock = opts.model ? `model:\n  preferred: ${opts.model}\n` : '';

  writeFileSync(
    join(dir, 'agent.yaml'),
    `spec_version: '0.1.0'\nname: ${opts.name ?? 'test-agent'}\nversion: '${opts.version ?? '0.1.0'}'\ndescription: '${opts.description ?? 'A test agent'}'\n${modelBlock}`,
    'utf-8',
  );

  if (opts.soul !== undefined) writeFileSync(join(dir, 'SOUL.md'), opts.soul, 'utf-8');
  if (opts.rules !== undefined) writeFileSync(join(dir, 'RULES.md'), opts.rules, 'utf-8');
  if (opts.duties !== undefined) writeFileSync(join(dir, 'DUTIES.md'), opts.duties, 'utf-8');

  if (opts.skills) {
    for (const skill of opts.skills) {
      const skillDir = join(dir, 'skills', skill.name);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---\nname: ${skill.name}\ndescription: '${skill.description}'\n---\n\n${skill.instructions}\n`,
        'utf-8',
      );
    }
  }

  if (opts.tools) {
    const toolsDir = join(dir, 'tools');
    mkdirSync(toolsDir, { recursive: true });
    for (const tool of opts.tools) {
      const lines = [
        `name: ${tool.name}`,
        `description: '${tool.description ?? ''}'`,
      ];
      if (tool.inputSchema) {
        lines.push(`input_schema: ${JSON.stringify(tool.inputSchema)}`);
      }
      writeFileSync(join(toolsDir, `${tool.name}.yaml`), lines.join('\n') + '\n', 'utf-8');
    }
  }

  if (opts.hooks) {
    const hooksDir = join(dir, 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const lines: string[] = ['hooks:'];
    for (const [event, entries] of Object.entries(opts.hooks)) {
      lines.push(`  ${event}:`);
      for (const entry of entries) {
        lines.push(`    - script: ${entry.script}`);
      }
    }
    writeFileSync(join(hooksDir, 'hooks.yaml'), lines.join('\n') + '\n', 'utf-8');
  }

  if (opts.subAgents) {
    for (const sub of opts.subAgents) {
      const subDir = join(dir, 'agents', sub.name);
      mkdirSync(subDir, { recursive: true });
      writeFileSync(
        join(subDir, 'agent.yaml'),
        `spec_version: '0.1.0'\nname: ${sub.name}\nversion: '0.1.0'\ndescription: '${sub.description}'\n`,
        'utf-8',
      );
      if (sub.soul) writeFileSync(join(subDir, 'SOUL.md'), sub.soul, 'utf-8');
    }
  }

  return dir;
}

/** Run an export while trapping the adapter's warn() output so it can be asserted on. */
function captureLogs(fn: () => { code: string }): { code: string; logs: string[] } {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };
  try {
    return { code: fn().code, logs };
  } finally {
    console.log = original;
  }
}

// exportToDeepAgents

describe('exportToDeepAgents', () => {
  test('returns { code: string }', () => {
    const dir = makeAgentDir({ name: 'demo-agent' });
    const result = exportToDeepAgents(dir);
    assert.equal(typeof result.code, 'string');
    assert.ok(result.code.length > 0);
  });

  test('imports create_deep_agent from deepagents', () => {
    const dir = makeAgentDir({});
    const { code } = exportToDeepAgents(dir);
    assert.match(code, /from deepagents import create_deep_agent/);
  });

  test('emits a create_deep_agent(...) call', () => {
    const dir = makeAgentDir({});
    const { code } = exportToDeepAgents(dir);
    assert.match(code, /agent = create_deep_agent\(/);
    assert.match(code, /model=MODEL/);
    assert.match(code, /system_prompt=SYSTEM_PROMPT/);
    assert.match(code, /tools=TOOLS/);
  });

  test('embeds SOUL.md, RULES.md, DUTIES.md into the system prompt', () => {
    const dir = makeAgentDir({
      soul: '# Soul\n\nBe precise.',
      rules: '# Rules\n\nNever lie.',
      duties: '# Duties\n\nThe analyst proposes, the reviewer approves.',
    });
    const { code } = exportToDeepAgents(dir);
    assert.match(code, /Be precise/);
    assert.match(code, /Never lie/);
    assert.match(code, /The analyst proposes/);
  });

  test('tools/*.yaml become @tool functions registered in TOOLS', () => {
    const dir = makeAgentDir({
      tools: [
        {
          name: 'web-search',
          description: 'Search the web',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
    });
    const { code } = exportToDeepAgents(dir);
    assert.match(code, /@tool/);
    assert.match(code, /def web_search\(query: str\) -> str:/);
    assert.match(code, /TOOLS = \[web_search\]/);
  });

  test('skills/ becomes skills=SKILLS resolved relative to the module', () => {
    const dir = makeAgentDir({
      skills: [
        { name: 'research', description: 'Research a topic', instructions: 'Cite sources.' },
      ],
    });
    const { code } = exportToDeepAgents(dir);
    assert.match(code, /from pathlib import Path/);
    assert.match(code, /SKILLS = \[str\(Path\(__file__\)\.resolve\(\)\.parent \/ "skills"\)\]/);
    assert.match(code, /skills=SKILLS,/);
    assert.match(code, /#\s+- research:/);
  });

  test('no skills/ → SKILLS is an empty list and not passed to create_deep_agent', () => {
    const dir = makeAgentDir({});
    const { code } = exportToDeepAgents(dir);
    assert.match(code, /SKILLS: list = \[\]/);
    assert.doesNotMatch(code, /skills=SKILLS/);
  });

  test('sub-agents become SubAgent dicts with name, description, system_prompt', () => {
    const dir = makeAgentDir({
      subAgents: [
        { name: 'fact-checker', description: 'Verifies claims', soul: '# Soul\n\nBe pedantic.' },
      ],
    });
    const { code } = exportToDeepAgents(dir);
    assert.match(code, /fact_checker_subagent = \{/);
    assert.match(code, /"name": "fact-checker"/);
    assert.match(code, /"description": "Verifies claims"/);
    assert.match(code, /"system_prompt":/);
    assert.match(code, /Be pedantic/);
    assert.match(code, /SUBAGENTS = \[fact_checker_subagent\]/);
    assert.match(code, /subagents=SUBAGENTS,/);
  });

  test('sub-agent with its own `tools:` list gets a narrowed tools array, not the full parent TOOLS', () => {
    const dir = makeAgentDir({
      tools: [{ name: 'web-search' }, { name: 'send-email' }],
      subAgents: [{ name: 'fact-checker', description: 'Verifies claims' }],
    });
    writeFileSync(
      join(dir, 'agents', 'fact-checker', 'agent.yaml'),
      `spec_version: '0.1.0'\nname: fact-checker\nversion: '0.1.0'\ndescription: 'Verifies claims'\ntools:\n  - web-search\n`,
      'utf-8',
    );
    const { code } = exportToDeepAgents(dir);
    assert.match(code, /"tools": \[web_search\],/);
    assert.doesNotMatch(code, /"tools": TOOLS,/);
  });

  test('sub-agent without a `tools:` list inherits the full parent TOOLS', () => {
    const dir = makeAgentDir({
      tools: [{ name: 'web-search' }],
      subAgents: [{ name: 'fact-checker', description: 'Verifies claims' }],
    });
    const { code } = exportToDeepAgents(dir);
    assert.match(code, /"tools": TOOLS,/);
  });

  test('sub-agent declaring only unknown tools narrows to [] and warns rather than inheriting TOOLS', () => {
    const dir = makeAgentDir({
      tools: [{ name: 'web-search' }],
      subAgents: [{ name: 'fact-checker', description: 'Verifies claims' }],
    });
    writeFileSync(
      join(dir, 'agents', 'fact-checker', 'agent.yaml'),
      `spec_version: '0.1.0'\nname: fact-checker\nversion: '0.1.0'\ndescription: 'Verifies claims'\ntools:\n  - websearch\n`,
      'utf-8',
    );
    const { code, logs } = captureLogs(() => exportToDeepAgents(dir));

    // A list of nothing but typos must not silently widen to the parent toolset.
    assert.match(code, /"tools": \[\],/);
    assert.doesNotMatch(code, /"tools": TOOLS,/);
    assert.ok(
      logs.some(l => l.includes('websearch')),
      `expected a warning naming the dropped tool, got: ${JSON.stringify(logs)}`,
    );
  });

  test('sub-agent with an explicit empty `tools: []` gets no tools', () => {
    const dir = makeAgentDir({
      tools: [{ name: 'web-search' }],
      subAgents: [{ name: 'fact-checker', description: 'Verifies claims' }],
    });
    writeFileSync(
      join(dir, 'agents', 'fact-checker', 'agent.yaml'),
      `spec_version: '0.1.0'\nname: fact-checker\nversion: '0.1.0'\ndescription: 'Verifies claims'\ntools: []\n`,
      'utf-8',
    );
    const { code, logs } = captureLogs(() => exportToDeepAgents(dir));

    assert.match(code, /"tools": \[\],/);
    assert.doesNotMatch(code, /"tools": TOOLS,/);
    // Deliberately empty is not a mistake — nothing to warn about.
    assert.deepEqual(logs, []);
  });

  test('pre_tool_use hooks are invoked from inside each generated tool function', () => {
    const dir = makeAgentDir({
      tools: [{ name: 'noop', description: 'A no-op' }],
      hooks: {
        pre_tool_use: [{ script: 'audit.sh' }],
      },
    });
    const { code } = exportToDeepAgents(dir);
    assert.match(code, /_run_pre_tool_use_hooks\("noop"\)/);
    assert.match(code, /hooks\/audit\.sh/);
  });

  test('model.preferred is emitted as MODEL', () => {
    const dir = makeAgentDir({ model: 'claude-opus-4-7' });
    const { code } = exportToDeepAgents(dir);
    assert.match(code, /MODEL = "claude-opus-4-7"/);
  });

  test('default model is used when model.preferred is absent', () => {
    const dir = makeAgentDir({});
    const { code } = exportToDeepAgents(dir);
    assert.match(code, /MODEL = "anthropic:claude-sonnet-4-5"/);
  });
});

// exportToDeepAgentsString

describe('exportToDeepAgentsString', () => {
  test('matches exportToDeepAgents().code', () => {
    const dir = makeAgentDir({ name: 'parity-agent' });
    assert.equal(exportToDeepAgentsString(dir), exportToDeepAgents(dir).code);
  });

  test('output contains create_deep_agent', () => {
    const dir = makeAgentDir({});
    assert.match(exportToDeepAgentsString(dir), /create_deep_agent/);
  });
});
