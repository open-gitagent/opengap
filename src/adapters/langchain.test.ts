/**
 * Tests for the LangChain adapter.
 *
 * Uses Node.js built-in test runner (node --test).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { exportToLangChainString as exportToLangChain } from './langchain.js';
import { detectProvider } from './langchain-utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentDir(opts: {
  name?: string;
  description?: string;
  soul?: string;
  rules?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxTurns?: number;
  skills?: Array<{ name: string; description: string; instructions: string }>;
  tools?: Array<{ name: string; description: string; params?: Record<string, { type: string; required?: boolean }> }>;
  subAgents?: Array<{ name: string; description: string; model?: string }>;
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitagent-langchain-test-'));

  const agentYaml: any = {
    spec_version: '0.1.0',
    name: opts.name ?? 'test-agent',
    version: '0.1.0',
    description: opts.description ?? 'A test agent',
  };

  if (opts.model || opts.temperature || opts.maxTokens) {
    agentYaml.model = {};
    if (opts.model) agentYaml.model.preferred = opts.model;
    if (opts.temperature !== undefined || opts.maxTokens !== undefined) {
      agentYaml.model.constraints = {};
      if (opts.temperature !== undefined) agentYaml.model.constraints.temperature = opts.temperature;
      if (opts.maxTokens !== undefined) agentYaml.model.constraints.max_tokens = opts.maxTokens;
    }
  }

  if (opts.maxTurns) {
    agentYaml.runtime = { max_turns: opts.maxTurns };
  }

  if (opts.subAgents && opts.subAgents.length > 0) {
    agentYaml.agents = {};
    agentYaml.delegation = { mode: 'manual' };
    for (const sub of opts.subAgents) {
      agentYaml.agents[sub.name] = { description: sub.description };
      
      const subDir = join(dir, 'agents', sub.name);
      mkdirSync(subDir, { recursive: true });
      
      const subYaml: any = {
        spec_version: '0.1.0',
        name: sub.name,
        version: '0.1.0',
        description: sub.description,
      };
      if (sub.model) {
        subYaml.model = { preferred: sub.model };
      }
      
      writeFileSync(
        join(subDir, 'agent.yaml'),
        `spec_version: '0.1.0'\nname: ${sub.name}\nversion: '0.1.0'\ndescription: '${sub.description}'\n${sub.model ? `model:\n  preferred: ${sub.model}\n` : ''}`,
        'utf-8',
      );
      writeFileSync(join(subDir, 'SOUL.md'), `I am ${sub.name}`, 'utf-8');
    }
  }

  writeFileSync(
    join(dir, 'agent.yaml'),
    Object.entries(agentYaml).map(([k, v]) => {
      if (typeof v === 'object') {
        return `${k}:\n${JSON.stringify(v, null, 2).split('\n').map(l => '  ' + l.replace(/["{},]/g, '')).join('\n')}`;
      }
      return `${k}: ${typeof v === 'string' ? `'${v}'` : v}`;
    }).join('\n'),
    'utf-8',
  );

  if (opts.soul !== undefined) {
    writeFileSync(join(dir, 'SOUL.md'), opts.soul, 'utf-8');
  }

  if (opts.rules !== undefined) {
    writeFileSync(join(dir, 'RULES.md'), opts.rules, 'utf-8');
  }

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
      const toolYaml: any = {
        name: tool.name,
        description: tool.description,
      };
      if (tool.params) {
        toolYaml.input_schema = {
          properties: tool.params,
          required: Object.entries(tool.params)
            .filter(([_, schema]) => (schema as any).required)
            .map(([name]) => name),
        };
      }
      writeFileSync(
        join(toolsDir, `${tool.name}.yaml`),
        `name: ${tool.name}\ndescription: ${tool.description}\n${tool.params ? `input_schema:\n  properties:\n${Object.entries(tool.params).map(([name, schema]) => `    ${name}:\n      type: ${schema.type}`).join('\n')}\n  required: [${Object.entries(tool.params).filter(([_, s]) => (s as any).required).map(([n]) => n).join(', ')}]\n` : ''}`,
        'utf-8',
      );
    }
  }

  return dir;
}

// ---------------------------------------------------------------------------
// detectProvider
// ---------------------------------------------------------------------------

describe('detectProvider', () => {
  test('detects OpenAI for gpt-4o', () => {
    const result = detectProvider('gpt-4o');
    assert.ok(result);
    assert.equal(result.provider, 'openai');
    assert.equal(result.pipPackage, 'langchain-openai');
    assert.equal(result.envVar, 'OPENAI_API_KEY');
  });

  test('detects OpenAI for gpt-4', () => {
    const result = detectProvider('gpt-4');
    assert.ok(result);
    assert.equal(result.provider, 'openai');
    assert.equal(result.pipPackage, 'langchain-openai');
  });

  test('detects OpenAI for o1-mini', () => {
    const result = detectProvider('o1-mini');
    assert.ok(result);
    assert.equal(result.provider, 'openai');
  });

  test('detects OpenAI for o3-mini', () => {
    const result = detectProvider('o3-mini');
    assert.ok(result);
    assert.equal(result.provider, 'openai');
  });

  test('detects Anthropic for claude-3-5-sonnet', () => {
    const result = detectProvider('claude-3-5-sonnet');
    assert.ok(result);
    assert.equal(result.provider, 'anthropic');
    assert.equal(result.pipPackage, 'langchain-anthropic');
    assert.equal(result.envVar, 'ANTHROPIC_API_KEY');
  });

  test('detects Anthropic for claude-opus-4-6', () => {
    const result = detectProvider('claude-opus-4-6');
    assert.ok(result);
    assert.equal(result.provider, 'anthropic');
  });

  test('returns null for unsupported model', () => {
    const result = detectProvider('llama3.1');
    assert.equal(result, null);
  });

  test('returns null for gemini models', () => {
    const result = detectProvider('gemini-pro');
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// exportToLangChain — basic structure
// ---------------------------------------------------------------------------

describe('exportToLangChain — basic structure', () => {
  test('generates valid Python code with LangChain imports', () => {
    const dir = makeAgentDir({ name: 'test-agent', model: 'gpt-4o' });
    const result = exportToLangChain(dir);
    
    assert.match(result, /from langchain\.chat_models import init_chat_model/);
    assert.match(result, /from langchain\.agents import create_agent/);
    assert.match(result, /from langchain\.tools import tool/);
  });

  test('includes pip install instructions with correct packages', () => {
    const dir = makeAgentDir({ name: 'test-agent', model: 'gpt-4o' });
    const result = exportToLangChain(dir);
    
    assert.match(result, /pip install langchain langchain-openai/);
  });

  test('includes Anthropic package for claude models', () => {
    const dir = makeAgentDir({ name: 'test-agent', model: 'claude-3-5-sonnet' });
    const result = exportToLangChain(dir);
    
    assert.match(result, /pip install langchain langchain-anthropic/);
  });

  test('includes agent name and description in docstring', () => {
    const dir = makeAgentDir({ name: 'my-agent', description: 'My test description' });
    const result = exportToLangChain(dir);
    
    assert.match(result, /my-agent/);
    assert.match(result, /My test description/);
  });

  test('includes SOUL.md content in system prompt', () => {
    const dir = makeAgentDir({ soul: '# Soul\n\nI am helpful and precise.' });
    const result = exportToLangChain(dir);
    
    assert.match(result, /I am helpful and precise/);
  });

  test('includes RULES.md content in system prompt', () => {
    const dir = makeAgentDir({ rules: '# Rules\n\nNever share credentials.' });
    const result = exportToLangChain(dir);
    
    assert.match(result, /Never share credentials/);
  });
});

// ---------------------------------------------------------------------------
// exportToLangChain — model configuration
// ---------------------------------------------------------------------------

describe('exportToLangChain — model configuration', () => {
  test('uses default gpt-4o when no model specified', () => {
    const dir = makeAgentDir({});
    const result = exportToLangChain(dir);
    
    assert.match(result, /init_chat_model\("gpt-4o"/);
  });

  test('uses specified model', () => {
    const dir = makeAgentDir({ model: 'claude-opus-4-6' });
    const result = exportToLangChain(dir);
    
    assert.match(result, /init_chat_model\("claude-opus-4-6"/);
  });

  test('includes temperature parameter', () => {
    const dir = makeAgentDir({ model: 'gpt-4o', temperature: 0.3 });
    const result = exportToLangChain(dir);
    
    assert.match(result, /temperature=0\.3/);
  });

  test('includes max_tokens parameter when specified', () => {
    const dir = makeAgentDir({ model: 'gpt-4o', maxTokens: 4096 });
    const result = exportToLangChain(dir);
    
    assert.match(result, /max_tokens=4096/);
  });

  test('includes recursion_limit when max_turns specified', () => {
    const dir = makeAgentDir({ model: 'gpt-4o', maxTurns: 10 });
    const result = exportToLangChain(dir);
    
    assert.match(result, /recursion_limit.*20/);
  });
});

// ---------------------------------------------------------------------------
// exportToLangChain — environment variables
// ---------------------------------------------------------------------------

describe('exportToLangChain — environment variables', () => {
  test('checks OPENAI_API_KEY for OpenAI models', () => {
    const dir = makeAgentDir({ model: 'gpt-4o' });
    const result = exportToLangChain(dir);
    
    assert.match(result, /OPENAI_API_KEY/);
    assert.match(result, /os\.environ\.get\("OPENAI_API_KEY"\)/);
  });

  test('checks ANTHROPIC_API_KEY for Anthropic models', () => {
    const dir = makeAgentDir({ model: 'claude-3-5-sonnet' });
    const result = exportToLangChain(dir);
    
    assert.match(result, /ANTHROPIC_API_KEY/);
    assert.match(result, /os\.environ\.get\("ANTHROPIC_API_KEY"\)/);
  });
});

// ---------------------------------------------------------------------------
// exportToLangChain — tools
// ---------------------------------------------------------------------------

describe('exportToLangChain — tools', () => {
  test('generates tool stubs with @tool decorator', () => {
    const dir = makeAgentDir({
      tools: [
        { name: 'search-web', description: 'Search the web', params: { query: { type: 'string', required: true } } },
      ],
    });
    const result = exportToLangChain(dir);
    
    assert.match(result, /@tool/);
    assert.match(result, /def search_web\(/);
    assert.match(result, /Search the web/);
  });

  test('converts tool names with hyphens to underscores', () => {
    const dir = makeAgentDir({
      tools: [
        { name: 'my-custom-tool', description: 'A tool' },
      ],
    });
    const result = exportToLangChain(dir);
    
    assert.match(result, /def my_custom_tool\(/);
  });

  test('generates correct Python type annotations', () => {
    const dir = makeAgentDir({
      tools: [
        {
          name: 'test-tool',
          description: 'Test',
          params: {
            name: { type: 'string', required: true },
            count: { type: 'integer', required: true },
            ratio: { type: 'number' },
            enabled: { type: 'boolean' },
          },
        },
      ],
    });
    const result = exportToLangChain(dir);
    
    assert.match(result, /name: str/);
    assert.match(result, /count: int/);
    assert.match(result, /ratio: float = None/);
    assert.match(result, /enabled: bool = None/);
  });
});

// ---------------------------------------------------------------------------
// exportToLangChain — sub-agents
// ---------------------------------------------------------------------------

describe('exportToLangChain — sub-agents', () => {
  test('generates sub-agent delegates', () => {
    const dir = makeAgentDir({
      model: 'gpt-4o',
      subAgents: [
        { name: 'fact-checker', description: 'Verifies facts', model: 'gpt-4o-mini' },
      ],
    });
    const result = exportToLangChain(dir);
    
    assert.match(result, /_fact_checker = create_agent\(/);
    assert.match(result, /def delegate_to_fact_checker\(/);
    assert.match(result, /Verifies facts/);
  });

  test('sub-agent uses its own model', () => {
    const dir = makeAgentDir({
      model: 'gpt-4o',
      subAgents: [
        { name: 'helper', description: 'Helps', model: 'claude-3-5-sonnet' },
      ],
    });
    const result = exportToLangChain(dir);
    
    assert.match(result, /init_chat_model\("claude-3-5-sonnet"/);
  });

  test('includes both provider packages when sub-agent uses different provider', () => {
    const dir = makeAgentDir({
      model: 'gpt-4o',
      subAgents: [
        { name: 'helper', description: 'Helps', model: 'claude-3-5-sonnet' },
      ],
    });
    const result = exportToLangChain(dir);
    
    assert.match(result, /langchain-openai/);
    assert.match(result, /langchain-anthropic/);
  });

  test('checks both API keys when sub-agent uses different provider', () => {
    const dir = makeAgentDir({
      model: 'gpt-4o',
      subAgents: [
        { name: 'helper', description: 'Helps', model: 'claude-3-5-sonnet' },
      ],
    });
    const result = exportToLangChain(dir);
    
    assert.match(result, /OPENAI_API_KEY/);
    assert.match(result, /ANTHROPIC_API_KEY/);
  });
});

// ---------------------------------------------------------------------------
// exportToLangChain — skills
// ---------------------------------------------------------------------------

describe('exportToLangChain — skills', () => {
  test('includes skill instructions in system prompt', () => {
    const dir = makeAgentDir({
      skills: [
        { name: 'code-review', description: 'Reviews code', instructions: 'Check for bugs and style issues.' },
      ],
    });
    const result = exportToLangChain(dir);
    
    assert.match(result, /code-review/);
    assert.match(result, /Check for bugs and style issues/);
  });

  test('includes multiple skills', () => {
    const dir = makeAgentDir({
      skills: [
        { name: 'skill-a', description: 'Skill A', instructions: 'Do A.' },
        { name: 'skill-b', description: 'Skill B', instructions: 'Do B.' },
      ],
    });
    const result = exportToLangChain(dir);
    
    assert.match(result, /skill-a/);
    assert.match(result, /skill-b/);
    assert.match(result, /Do A/);
    assert.match(result, /Do B/);
  });
});

// ---------------------------------------------------------------------------
// exportToLangChain — error handling
// ---------------------------------------------------------------------------

describe('exportToLangChain — error handling', () => {
  test('throws error for unsupported model', () => {
    const dir = makeAgentDir({ model: 'llama3.1' });
    
    assert.throws(
      () => exportToLangChain(dir),
      /Model "llama3\.1" is not supported/
    );
  });

  test('throws error for unsupported sub-agent model', () => {
    const dir = makeAgentDir({
      model: 'gpt-4o',
      subAgents: [
        { name: 'helper', description: 'Helps', model: 'gemini-pro' },
      ],
    });
    
    assert.throws(
      () => exportToLangChain(dir),
      /Sub-agent model "gemini-pro" is not supported/
    );
  });
});
