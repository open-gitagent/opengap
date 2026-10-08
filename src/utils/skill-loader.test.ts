/**
 * Tests for SKILL.md parsing (CRLF line endings, allowed-tools forms).
 *
 * Uses Node.js built-in test runner (node --test).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseSkillMd, loadSkillMetadata, getAllowedTools, loadAllSkills } from './skill-loader.js';

function writeSkill(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitagent-skill-test-'));
  const skillDir = join(dir, 'skills', 'demo');
  mkdirSync(skillDir, { recursive: true });
  const path = join(skillDir, 'SKILL.md');
  writeFileSync(path, content, 'utf-8');
  return path;
}

describe('skill-loader CRLF handling', () => {
  test('parses SKILL.md with CRLF line endings', () => {
    const path = writeSkill('---\r\nname: demo\r\ndescription: A demo skill\r\n---\r\n\r\nDo the thing.\r\n');
    const skill = parseSkillMd(path);
    assert.equal(skill.frontmatter.name, 'demo');
    assert.equal(skill.frontmatter.description, 'A demo skill');
    assert.equal(skill.instructions, 'Do the thing.');

    const meta = loadSkillMetadata(path);
    assert.equal(meta.name, 'demo');
  });
});

describe('getAllowedTools', () => {
  test('accepts a space-delimited string', () => {
    assert.deepEqual(getAllowedTools({ name: 'a', description: 'b', 'allowed-tools': 'Read  Write\tGrep' }), ['Read', 'Write', 'Grep']);
  });

  test('accepts a YAML list', () => {
    assert.deepEqual(getAllowedTools({ name: 'a', description: 'b', 'allowed-tools': ['Read', ' Bash(git status) ', ''] }), ['Read', 'Bash(git status)']);
  });

  test('returns [] when missing or empty', () => {
    assert.deepEqual(getAllowedTools({ name: 'a', description: 'b' }), []);
    assert.deepEqual(getAllowedTools({ name: 'a', description: 'b', 'allowed-tools': '' }), []);
  });

  test('list-form allowed-tools in a SKILL.md loads without error', () => {
    const path = writeSkill('---\nname: demo\ndescription: d\nallowed-tools:\n  - Read\n  - Write\n---\nBody\n');
    const skills = loadAllSkills(join(path, '..', '..'));
    assert.equal(skills.length, 1);
    assert.deepEqual(getAllowedTools(skills[0].frontmatter), ['Read', 'Write']);
    assert.deepEqual(loadSkillMetadata(path).allowedTools, ['Read', 'Write']);
  });
});
