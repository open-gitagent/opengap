/**
 * Tests for import helpers (markdown section parsing, CrewAI config shape).
 *
 * Uses Node.js built-in test runner (node --test).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseSections, extractCrewAIAgents } from './import.js';

describe('parseSections', () => {
  test('keeps text before the first heading', () => {
    const sections = parseSections('Intro line.\n\n# Identity\nI am helpful.\n');
    assert.deepEqual(sections, [
      ['', 'Intro line.'],
      ['Identity', 'I am helpful.'],
    ]);
  });

  test('does not split on headings inside fenced code blocks', () => {
    const md = [
      '# Setup',
      'Run this:',
      '```bash',
      '# not a heading',
      'echo hi',
      '```',
      '~~~',
      '## also not a heading',
      '~~~',
      '## Rules',
      'Be nice.',
    ].join('\n');
    const sections = parseSections(md);
    assert.equal(sections.length, 2);
    assert.equal(sections[0][0], 'Setup');
    assert.ok(sections[0][1].includes('# not a heading'));
    assert.ok(sections[0][1].includes('## also not a heading'));
    assert.deepEqual(sections[1], ['Rules', 'Be nice.']);
  });

  test('handles CRLF input and empty documents', () => {
    assert.deepEqual(parseSections('# A\r\nbody\r\n'), [['A', 'body']]);
    assert.deepEqual(parseSections(''), []);
  });
});

describe('extractCrewAIAgents', () => {
  test('accepts the standard top-level agents.yaml map', () => {
    const agents = extractCrewAIAgents({
      researcher: { role: 'Researcher', goal: 'Find facts', backstory: 'Curious' },
      writer: { role: 'Writer', goal: 'Write' },
    });
    assert.deepEqual(Object.keys(agents ?? {}), ['researcher', 'writer']);
  });

  test('accepts a wrapped agents: key', () => {
    const agents = extractCrewAIAgents({ agents: { analyst: { role: 'Analyst' } } });
    assert.deepEqual(Object.keys(agents ?? {}), ['analyst']);
  });

  test('returns null when no agent definitions are present', () => {
    assert.equal(extractCrewAIAgents(null), null);
    assert.equal(extractCrewAIAgents({ tasks: ['x'] }), null);
    assert.equal(extractCrewAIAgents({ agents: {} }), null);
  });
});
