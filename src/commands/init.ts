import { Command } from 'commander';
import { mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { success, error, info, heading } from '../utils/format.js';

interface InitOptions {
  template: string;
  dir: string;
}

const MINIMAL_AGENT_YAML = `spec_version: "0.1.0"
name: my-agent
version: 0.1.0
description: A helpful assistant agent
`;

const MINIMAL_SOUL_MD = `# Soul

I am a helpful assistant. I communicate clearly and concisely, focusing on providing accurate and useful information.
`;

const STANDARD_AGENT_YAML = `spec_version: "0.1.0"
name: my-agent
version: 0.1.0
description: A helpful assistant agent
author: ""
license: MIT
model:
  preferred: claude-sonnet-4-5-20250929
  constraints:
    temperature: 0.3
    max_tokens: 4096
skills: []
tools: []
runtime:
  max_turns: 30
  timeout: 120
tags: []
`;

const STANDARD_SOUL_MD = `# Soul

## Core Identity
I am a helpful assistant specializing in [your domain].

## Communication Style
Clear, concise, and professional. I adapt my tone to the context.

## Values & Principles
- Accuracy over speed
- Transparency in reasoning
- Helpfulness without overstepping

## Domain Expertise
- [List your areas of expertise]

## Collaboration Style
I ask clarifying questions when requirements are ambiguous.
`;

const STANDARD_RULES_MD = `# Rules

## Must Always
- Provide accurate, well-sourced information
- Ask clarifying questions when requirements are ambiguous
- Acknowledge limitations and uncertainty

## Must Never
- Make claims without supporting evidence
- Provide harmful or dangerous information
- Ignore safety boundaries

## Output Constraints
- Use clear, structured formatting
- Keep responses focused and relevant

## Interaction Boundaries
- Stay within defined domain expertise
- Escalate appropriately when outside scope
`;

const FULL_AGENT_YAML = `spec_version: "0.1.0"
name: my-agent
version: 0.1.0
description: A production-ready agent with full compliance configuration
author: ""
license: proprietary
model:
  preferred: claude-opus-4-6
  fallback:
    - claude-sonnet-4-5-20250929
  constraints:
    temperature: 0.1
    max_tokens: 8192
skills: []
tools: []
delegation:
  mode: auto
runtime:
  max_turns: 50
  timeout: 300
compliance:
  risk_tier: standard
  frameworks: []
  supervision:
    designated_supervisor: null
    review_cadence: quarterly
    human_in_the_loop: conditional
    escalation_triggers:
      - confidence_below: 0.7
      - error_detected: true
    override_capability: true
    kill_switch: true
  recordkeeping:
    audit_logging: true
    log_format: structured_json
    retention_period: 6y
    log_contents:
      - prompts_and_responses
      - tool_calls
      - decision_pathways
      - model_version
      - timestamps
    immutable: true
  model_risk:
    inventory_id: null
    validation_cadence: annual
    validation_type: full
    conceptual_soundness: null
    ongoing_monitoring: true
    outcomes_analysis: true
    drift_detection: true
    parallel_testing: false
  data_governance:
    pii_handling: redact
    data_classification: confidential
    consent_required: true
    cross_border: false
    bias_testing: true
    lda_search: false
  communications:
    type: correspondence
    pre_review_required: false
    fair_balanced: true
    no_misleading: true
    disclosures_required: false
  vendor_management:
    due_diligence_complete: false
    soc_report_required: false
    vendor_ai_notification: true
    subcontractor_assessment: false
tags: []
metadata: {}
`;

const FULL_RULES_MD = `# Rules

## Must Always
- Provide accurate, well-sourced information
- Log all decisions with reasoning trace
- Escalate to supervisor when confidence is below threshold
- Include confidence levels with assessments

## Must Never
- Make determinations without human review for high-risk decisions
- Store PII in outputs or logs without authorization
- Generate misleading, exaggerated, or promissory statements
- Override human-in-the-loop escalation triggers

## Output Constraints
- Use structured formatting with clear sections
- Include standard disclaimer where required
- Maximum response length per policy

## Interaction Boundaries
- Only process data explicitly provided
- Do not access external systems without authorization
- Scope limited to defined domain

## Safety & Ethics
- Report potential conflicts of interest
- Protect confidential information
- Do not assist in circumventing regulatory requirements

## Regulatory Constraints
- All outputs subject to applicable regulatory framework
- Communications must be fair and balanced
- Audit trail must be maintained for all decisions
`;

const AGENTS_MD = `# Agent

A brief description of this agent for tools that read AGENTS.md (Cursor, Copilot, etc.).

## Capabilities
- [List key capabilities]

## Constraints
- [List key constraints]
`;

const HOOKS_YAML = `hooks:
  on_session_start:
    - script: scripts/on-start.sh
      description: Initialize session context
      timeout: 10
      compliance: false
      fail_open: true
  on_error:
    - script: scripts/on-error.sh
      description: Handle errors and escalate if needed
      timeout: 10
      compliance: false
      fail_open: true
`;

const HOOK_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
echo '{"action": "allow", "modifications": null}'
`;

const MEMORY_YAML = `layers:
  - name: working
    path: MEMORY.md
    max_lines: 200
    format: markdown
  - name: archive
    path: archive/
    format: yaml
    rotation: monthly
update_triggers:
  - on_session_end
  - on_explicit_save
archive_policy:
  max_entries: 1000
  compress_after: 90d
`;

const MEMORY_MD = `# Memory

This file tracks persistent state across sessions. Max 200 lines.
`;

const KNOWLEDGE_INDEX = `documents: []
`;

const SKILL_MD = `---
name: example-skill
description: An example skill
license: MIT
allowed-tools: ""
metadata:
  author: ""
  version: "1.0.0"
  category: general
---

# Example Skill

## Instructions
Describe the skill instructions here.
`;

const FULL_DUTIES_MD = `# Duties

System-wide segregation of duties policy.

## Roles

| Role | Agent | Permissions | Description |
|------|-------|-------------|-------------|
| (define roles) | (assign agents) | (list permissions) | (describe duty) |

## Conflict Matrix

No single agent may hold both roles in any pair:

- (define role conflicts)

## Handoff Workflows

(Define critical actions that require multi-role handoff)

## Isolation Policy

- **State isolation:** (full | shared | none)
- **Credential segregation:** (separate | shared)

## Enforcement

(strict | advisory)
`;

const REGULATORY_MAP = `mappings: []
`;

const VALIDATION_SCHEDULE = `schedule: []
`;

const RISK_ASSESSMENT = `# Risk Assessment

## Agent: [name]
## Risk Tier: [tier]
## Assessment Date: [date]
## Assessor: [name]

## Risk Tier Justification
[Explain why this risk tier was chosen]

## Applicable Regulatory Frameworks
[List applicable frameworks and rules]

## Risk Categories
[Assess each risk category]

## Mitigation Controls
[List controls and their status]

## Approval
- [ ] Risk team approval
- [ ] Compliance team approval
- [ ] Supervisor approval
`;

function createDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function createFile(path: string, content: string): void {
  writeFileSync(path, content, 'utf-8');
}

// --- LLM Wiki template ---

const WIKI_AGENT_YAML = `spec_version: "0.1.0"
name: my-wiki
version: 0.1.0
description: "LLM-maintained personal wiki — a persistent, compounding knowledge base built from raw sources."
model:
  preferred: claude-sonnet-4-5-20250929
skills:
  - wiki-ingest
  - wiki-query
  - wiki-lint
runtime:
  max_turns: 50
  timeout: 300
tags:
  - knowledge-management
  - wiki
  - research
`;

const WIKI_SOUL_MD = `# Soul

## Core Identity
I am a wiki maintainer. I build and maintain a persistent, structured knowledge base from raw sources. I don't just retrieve information — I compile it, cross-reference it, and keep it current. The wiki is my primary artifact.

## Philosophy
Most knowledge systems rediscover information from scratch on every query. I work differently. When a new source arrives, I read it, extract the key information, and integrate it into the existing wiki — updating entity pages, revising topic summaries, noting contradictions, strengthening the evolving synthesis. Knowledge is compiled once and kept current, not re-derived every time.

## How I Work
- **The human** curates sources, directs analysis, asks questions, and thinks about meaning
- **I** do the summarizing, cross-referencing, filing, and bookkeeping that makes a knowledge base useful over time
- The wiki compounds with every source ingested and every question asked

## Communication Style
Structured and precise. I use markdown with clear headings, wikilinks for cross-references, and citations to source documents.

## Values
- Accuracy over speed — verify claims against sources before writing
- Synthesis over summary — connect ideas across documents, don't just compress them
- Maintenance is continuous — cross-references, contradictions, and gaps are caught proactively
- The wiki is the artifact — good answers get filed back as wiki pages, not lost in chat history
`;

const WIKI_RULES_MD = `# Rules

## Must Always
- Read memory/wiki/index.md before any operation to understand the current wiki state
- Cite source documents when making claims in wiki pages
- Use [[wikilinks]] for cross-references between wiki pages
- Update memory/wiki/index.md after creating or modifying any wiki page
- Append to memory/log.md after every ingest, query-filing, or lint operation
- Flag contradictions when new sources conflict with existing wiki pages

## Must Never
- Modify files in knowledge/ — raw sources are immutable
- Delete wiki pages without logging the reason
- Make claims not grounded in source documents
- Let the wiki index drift out of sync with actual pages

## Wiki Page Format
- Every wiki page starts with a # Title heading
- Include a "Sources" section listing contributing raw documents
- Use YAML frontmatter: tags, created, updated, source_count
- One entity, concept, or topic per page

## File Conventions
- Wiki pages: memory/wiki/ (lowercase-hyphen.md)
- Index: memory/wiki/index.md (master catalog)
- Log: memory/log.md (append-only, prefixed with ## [YYYY-MM-DD] operation | title)
- Sources: knowledge/ with index.yaml catalog
`;

const WIKI_INGEST_SKILL = `---
name: wiki-ingest
description: "Ingest a raw source document into the wiki. Reads the source, extracts key information, creates or updates wiki pages, maintains cross-references, and logs the operation."
allowed-tools: Read Write Edit Glob Grep
---

# Wiki Ingest

## Workflow
1. **Read** the source document from knowledge/
2. **Discuss** key takeaways with the user
3. **Update wiki** — create/update entity and concept pages in memory/wiki/
4. **Write source summary** — memory/wiki/sources/<name>.md
5. **Update index** — memory/wiki/index.md
6. **Log** — append to memory/log.md

A single source typically touches 5-15 wiki pages. For each entity or concept:
- Check if a wiki page exists (read index.md)
- If yes: integrate new info, update Sources section, bump source_count
- If no: create new page with frontmatter, content, and citations
- Add [[wikilinks]] in both directions between related pages
`;

const WIKI_QUERY_SKILL = `---
name: wiki-query
description: "Query the wiki to answer questions. Searches wiki pages, synthesizes answers with citations, and optionally files valuable answers back as new wiki pages."
allowed-tools: Read Write Edit Glob Grep
---

# Wiki Query

## Workflow
1. **Search** — read memory/wiki/index.md, grep for terms across memory/wiki/
2. **Synthesize** — combine info from multiple pages, cite sources
3. **Present** — format depends on question (factual, comparison, overview, analysis)
4. **File back** (optional) — if the answer is a valuable synthesis, ask user if it should become a wiki page

Good answers should not disappear into chat history. Filing them back means explorations compound in the knowledge base.
`;

const WIKI_LINT_SKILL = `---
name: wiki-lint
description: "Health-check the wiki for contradictions, stale claims, orphan pages, missing cross-references, and knowledge gaps."
allowed-tools: Read Glob Grep
---

# Wiki Lint

## Checks
- **Contradictions** — conflicting claims across pages
- **Stale claims** — pages not updated after newer sources arrived
- **Orphan pages** — no inbound [[wikilinks]]
- **Missing pages** — [[wikilinks]] pointing to nonexistent pages
- **Missing cross-references** — pages discussing same topic without linking
- **Knowledge gaps** — suggest questions and sources to investigate

## Output
Structured health report with counts and specific findings per category. Append summary to memory/log.md.
`;

const WIKI_MEMORY_MD = `# Wiki Memory

## Structure
- wiki/ — LLM-generated wiki pages
- wiki/index.md — master catalog
- log.md — chronological operation log
- daily-log/ — per-session notes

## Stats
- Sources ingested: 0
- Wiki pages: 0
- Last operation: none
`;

const WIKI_MEMORY_YAML = `layers:
  - name: index
    path: MEMORY.md
    max_lines: 200
    format: markdown
  - name: wiki
    path: wiki/
    format: markdown
  - name: log
    path: log.md
    format: markdown
  - name: daily-log
    path: daily-log/
    format: markdown
    rotation: daily

update_triggers:
  - on_session_end
  - on_explicit_save

archive_policy:
  max_entries: 5000
  retention_period: 7y
`;

const WIKI_KNOWLEDGE_INDEX = `documents: []
# Add your raw source documents here. Example:
# documents:
#   - path: article-title.md
#     tags: [topic, subtopic]
#     priority: high
#     always_load: false
#     description: "What this source contains"
`;

export const initCommand = new Command('init')
  .description('Scaffold a new gitagent repository')
  .option('-t, --template <template>', 'Template to use (minimal, standard, full, llm-wiki)', 'standard')
  .option('-d, --dir <dir>', 'Target directory', '.')
  .action((options: InitOptions) => {
    const dir = resolve(options.dir);
    const template = options.template;

    if (existsSync(join(dir, 'agent.yaml'))) {
      error('agent.yaml already exists in this directory');
      process.exit(1);
    }

    if (!['minimal', 'standard', 'full', 'llm-wiki'].includes(template)) {
      error(`Unknown template: ${template}. Use minimal, standard, full, or llm-wiki.`);
      process.exit(1);
    }

    heading(`Scaffolding ${template} gitagent`);

    mkdirSync(dir, { recursive: true });

    if (template === 'minimal') {
      createFile(join(dir, 'agent.yaml'), MINIMAL_AGENT_YAML);
      createFile(join(dir, 'SOUL.md'), MINIMAL_SOUL_MD);
      success('Created agent.yaml');
      success('Created SOUL.md');
    } else if (template === 'standard') {
      createFile(join(dir, 'agent.yaml'), STANDARD_AGENT_YAML);
      createFile(join(dir, 'SOUL.md'), STANDARD_SOUL_MD);
      createFile(join(dir, 'RULES.md'), STANDARD_RULES_MD);
      createFile(join(dir, 'AGENTS.md'), AGENTS_MD);

      createDir(join(dir, 'skills', 'example-skill'));
      createFile(join(dir, 'skills', 'example-skill', 'SKILL.md'), SKILL_MD);
      createDir(join(dir, 'tools'));
      createDir(join(dir, 'knowledge'));
      createFile(join(dir, 'knowledge', 'index.yaml'), KNOWLEDGE_INDEX);

      success('Created agent.yaml');
      success('Created SOUL.md');
      success('Created RULES.md');
      success('Created AGENTS.md');
      success('Created skills/example-skill/SKILL.md');
      success('Created knowledge/index.yaml');
    } else if (template === 'full') {
      createFile(join(dir, 'agent.yaml'), FULL_AGENT_YAML);
      createFile(join(dir, 'SOUL.md'), STANDARD_SOUL_MD);
      createFile(join(dir, 'RULES.md'), FULL_RULES_MD);
      createFile(join(dir, 'AGENTS.md'), AGENTS_MD);
      createFile(join(dir, 'DUTIES.md'), FULL_DUTIES_MD);

      createDir(join(dir, 'skills', 'example-skill'));
      createFile(join(dir, 'skills', 'example-skill', 'SKILL.md'), SKILL_MD);

      createDir(join(dir, 'tools'));
      createDir(join(dir, 'knowledge'));
      createFile(join(dir, 'knowledge', 'index.yaml'), KNOWLEDGE_INDEX);

      createDir(join(dir, 'memory', 'archive'));
      createFile(join(dir, 'memory', 'MEMORY.md'), MEMORY_MD);
      createFile(join(dir, 'memory', 'memory.yaml'), MEMORY_YAML);

      createDir(join(dir, 'workflows'));

      createDir(join(dir, 'hooks', 'scripts'));
      createFile(join(dir, 'hooks', 'hooks.yaml'), HOOKS_YAML);
      createFile(join(dir, 'hooks', 'scripts', 'on-start.sh'), HOOK_SCRIPT);
      createFile(join(dir, 'hooks', 'scripts', 'on-error.sh'), HOOK_SCRIPT);

      createDir(join(dir, 'examples', 'scenarios'));

      createDir(join(dir, 'agents'));

      createDir(join(dir, 'compliance'));
      createFile(join(dir, 'compliance', 'regulatory-map.yaml'), REGULATORY_MAP);
      createFile(join(dir, 'compliance', 'validation-schedule.yaml'), VALIDATION_SCHEDULE);
      createFile(join(dir, 'compliance', 'risk-assessment.md'), RISK_ASSESSMENT);

      createDir(join(dir, 'config'));
      createFile(join(dir, 'config', 'default.yaml'), 'log_level: info\ncompliance_mode: true\n');

      // Add .gitagent to .gitignore
      const gitignorePath = join(dir, '.gitignore');
      if (existsSync(gitignorePath)) {
        const existing = readFileSync(gitignorePath, 'utf-8');
        if (!existing.includes('.gitagent/')) {
          appendFileSync(gitignorePath, '\n.gitagent/\n');
        }
      } else {
        createFile(gitignorePath, '.gitagent/\n');
      }

      success('Created agent.yaml (with compliance config)');
      success('Created SOUL.md');
      success('Created RULES.md');
      success('Created AGENTS.md');
      success('Created DUTIES.md');
      success('Created skills/example-skill/SKILL.md');
      success('Created knowledge/index.yaml');
      success('Created memory/MEMORY.md + memory.yaml');
      success('Created hooks/hooks.yaml + scripts');
      success('Created compliance/ (regulatory-map, validation-schedule, risk-assessment)');
      success('Created config/default.yaml');
    } else if (template === 'llm-wiki') {
      createFile(join(dir, 'agent.yaml'), WIKI_AGENT_YAML);
      createFile(join(dir, 'SOUL.md'), WIKI_SOUL_MD);
      createFile(join(dir, 'RULES.md'), WIKI_RULES_MD);

      createDir(join(dir, 'skills', 'wiki-ingest'));
      createFile(join(dir, 'skills', 'wiki-ingest', 'SKILL.md'), WIKI_INGEST_SKILL);
      createDir(join(dir, 'skills', 'wiki-query'));
      createFile(join(dir, 'skills', 'wiki-query', 'SKILL.md'), WIKI_QUERY_SKILL);
      createDir(join(dir, 'skills', 'wiki-lint'));
      createFile(join(dir, 'skills', 'wiki-lint', 'SKILL.md'), WIKI_LINT_SKILL);

      createDir(join(dir, 'knowledge'));
      createFile(join(dir, 'knowledge', 'index.yaml'), WIKI_KNOWLEDGE_INDEX);

      createDir(join(dir, 'memory', 'wiki'));
      createDir(join(dir, 'memory', 'daily-log'));
      createFile(join(dir, 'memory', 'MEMORY.md'), WIKI_MEMORY_MD);
      createFile(join(dir, 'memory', 'memory.yaml'), WIKI_MEMORY_YAML);
      createFile(join(dir, 'memory', 'wiki', 'index.md'), '# Wiki Index\n\nNo pages yet. Use `/wiki-ingest` to add your first source.\n');
      createFile(join(dir, 'memory', 'log.md'), '# Operation Log\n');

      success('Created agent.yaml (LLM Wiki)');
      success('Created SOUL.md (wiki maintainer identity)');
      success('Created RULES.md (wiki maintenance rules)');
      success('Created skills/wiki-ingest/SKILL.md');
      success('Created skills/wiki-query/SKILL.md');
      success('Created skills/wiki-lint/SKILL.md');
      success('Created knowledge/index.yaml');
      success('Created memory/ (MEMORY.md, wiki/, log.md)');
    } else {
      error(`Unknown template: ${template}. Use minimal, standard, full, or llm-wiki.`);
      process.exit(1);
    }

    info(`\nAgent scaffolded at ${dir}`);
    info('Next steps:');
    info('  1. Edit agent.yaml with your agent details');
    info('  2. Write your SOUL.md identity');
    if (template !== 'minimal') {
      info('  3. Run `gitagent validate` to check your configuration');
    }
  });
