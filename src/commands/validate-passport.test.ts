/**
 * Tests for GitAgent Passport Preflight Validation (Checkpoints 1 & 2).
 *
 * Uses Node.js built-in test runner (node --test).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  validateExplainabilityMd,
  validateDutiesMd,
  validatePassport
} from './validate.js';

function createTempAgentDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitagent-passport-test-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf-8');
  }
  return dir;
}

describe('GitAgent Passport: validateExplainabilityMd (Checkpoint 2)', () => {
  test('passes with valid decision, data sources, and limitations sections', () => {
    const dir = createTempAgentDir({
      'EXPLAINABILITY.md': `# Explainability

## Decision Making and Reasoning
The agent parses user queries using first-principles reasoning. It decomposes complex problems into atomic steps before evaluating.

## Data Sources and Inputs
All calculations are grounded in standard peer-reviewed literature. Numerical parameters are ingested through validated schemas.

## Limitations and Known Constraints
The agent cannot provide medical diagnostics. It will gracefully refuse questions outside of theoretical physics.
`
    });

    const result = validateExplainabilityMd(dir);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  test('fails if EXPLAINABILITY.md is missing', () => {
    const dir = createTempAgentDir({});
    const result = validateExplainabilityMd(dir);
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /required for Passport Checkpoint 2 but not found/i);
  });

  test('fails if decision/reasoning section is missing', () => {
    const dir = createTempAgentDir({
      'EXPLAINABILITY.md': `# Explainability

## Data Sources
The agent reads reference papers. Numerical inputs are checked.

## Limitations
The agent has bounded context windows. Hallucinations are actively filtered.
`
    });

    const result = validateExplainabilityMd(dir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Decision/Reasoning')));
  });

  test('fails if data sources/inputs section is missing', () => {
    const dir = createTempAgentDir({
      'EXPLAINABILITY.md': `# Explainability

## Reasoning Approach
The agent employs chain of thought reasoning. It validates each step logically.

## Known Limitations
The agent requires external tool invocation. Latency may increase under load.
`
    });

    const result = validateExplainabilityMd(dir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Data Sources/Inputs')));
  });

  test('fails if limitations section is missing', () => {
    const dir = createTempAgentDir({
      'EXPLAINABILITY.md': `# Explainability

## How It Decides
The agent follows strict deterministic rules. It verifies intermediate steps.

## Input Data Used
Inputs are sanitized against standard regex. All inputs are UTF-8 encoded.
`
    });

    const result = validateExplainabilityMd(dir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Limitations')));
  });

  test('fails if a section contains fewer than 2 sentences', () => {
    const dir = createTempAgentDir({
      'EXPLAINABILITY.md': `# Explainability

## Decision Logic
Only one sentence here.

## Data Sources
First valid sentence. Second valid sentence.

## Constraints
First limitation sentence. Second limitation sentence.
`
    });

    const result = validateExplainabilityMd(dir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('at least 2 sentences explaining decision logic')));
  });
});

describe('GitAgent Passport: validateDutiesMd (Checkpoint 1)', () => {
  test('passes with segregated maker and checker duties', () => {
    const dir = createTempAgentDir({
      'DUTIES.md': `# Separation of Duties Policy

- **Sage (Maker):** Formulates step-by-step STEM derivations and drafting responses.
- **Reviewer (Checker):** Independently audits calculations, checks assumptions, and approves release.
`
    });

    const result = validateDutiesMd(dir);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  test('fails if maker and checker are combined in the same role definition', () => {
    const dir = createTempAgentDir({
      'DUTIES.md': `# Separation of Duties Policy

- Role: Maker and Checker (Single agent creates and validates output)
`
    });

    const result = validateDutiesMd(dir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Maker and Checker cannot be assigned to the same entity or role')));
  });

  test('returns warning if DUTIES.md is absent', () => {
    const dir = createTempAgentDir({});
    const result = validateDutiesMd(dir);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.ok(result.warnings.length > 0);
  });
});

describe('GitAgent Passport: validatePassport preflight aggregator', () => {
  test('validates both checkpoints together', () => {
    const dir = createTempAgentDir({
      'DUTIES.md': `- Maker: Author\n- Checker: Auditor`,
      'EXPLAINABILITY.md': `## How It Decides\nSentence one about logic. Sentence two about logic.\n## Data Used\nSentence one about data. Sentence two about data.\n## Known Issues\nSentence one about constraints. Sentence two about constraints.`
    });

    const result = validatePassport(dir);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.checkpoint1.valid, true);
    assert.equal(result.checkpoint2.valid, true);
  });
});
