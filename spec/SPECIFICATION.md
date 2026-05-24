# gitagent Specification v0.1.0

> A framework-agnostic, git-native standard for defining AI agents.

## 1. Overview

**gitagent** defines a portable, version-controlled, human-readable format for AI agent definitions. An agent is fully described by files in a git repository. Cloning the repo gives you a complete agent.

The standard is designed to be:
- **Framework-agnostic** — works with Claude Code, OpenAI, LangChain, CrewAI, AutoGen, and others
- **Git-native** — version control, branching, diffing, and collaboration built in
- **Compliance-ready** — first-class support for FINRA, Federal Reserve, interagency regulatory requirements, and segregation of duties
- **Composable** — agents can extend, depend on, and delegate to other agents

## 2. Directory Structure

```
my-agent/
├── agent.yaml              # [REQUIRED] Agent manifest
├── SOUL.md                 # [REQUIRED] Identity and personality
├── RULES.md                # Hard constraints and boundaries
├── DUTIES.md                 # Segregation of duties policy and role declaration
├── AGENTS.md               # Framework-agnostic fallback instructions
├── README.md               # Human documentation
├── skills/                 # Reusable capability modules
│   └── <skill-name>/
│       ├── SKILL.md            # Frontmatter + instructions
│       ├── scripts/            # Executable helpers
│       ├── references/         # Supporting docs
│       ├── assets/             # Templates, schemas
│       └── examples/           # Example inputs/outputs
├── tools/                  # MCP-compatible tool definitions
│   ├── <name>.yaml             # Tool schema
│   └── <name>.py|.sh|.js       # Optional implementation
├── knowledge/              # Reference documents
│   ├── index.yaml              # Retrieval hints
│   └── *.md|csv|pdf            # Any readable format
├── memory/                 # Persistent cross-session memory
│   ├── MEMORY.md               # Current state (200 line max)
│   ├── memory.yaml             # Config
│   └── archive/                # Historical snapshots
├── workflows/              # Multi-step procedures
│   ├── *.yaml                  # Structured workflows
│   └── *.md                    # Narrative workflows
├── hooks/                  # Lifecycle event handlers
│   ├── hooks.yaml              # Hook config
│   └── scripts/                # Hook implementations
├── examples/               # Calibration interactions
│   ├── good-outputs.md
│   ├── bad-outputs.md
│   └── scenarios/*.md
├── agents/                 # Sub-agent definitions
│   ├── <name>/agent.yaml       # Full sub-agent (directory)
│   └── <name>.md               # Lightweight sub-agent (file)
├── compliance/             # Regulatory compliance artifacts
│   ├── regulatory-map.yaml     # Rule-to-control mappings
│   ├── audit-log.schema.json   # Audit log format
│   ├── validation-schedule.yaml# Validation cadence
│   └── risk-assessment.md      # Risk tier justification
├── config/                 # Environment-specific overrides
│   ├── default.yaml
│   └── <env>.yaml
└── .gitagent/              # Runtime state (gitignored)
    ├── deps/
    ├── state.json
    └── cache/
```

## 3. agent.yaml — The Manifest

The `agent.yaml` file is the only file with a strict schema. All other files have schemas for their frontmatter/structure but the schema is for validation, not hard enforcement.

### Naming Convention

All YAML keys use **snake_case**. Agent names, skill names, and tool names use **kebab-case** (lowercase with hyphens). This applies uniformly across all gitagent files.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Agent identifier (lowercase, hyphens, pattern: `^[a-z][a-z0-9-]*$`) |
| `version` | string | Semantic version (pattern: `^X.Y.Z[-prerelease][+build]$`) |
| `description` | string | One-line description |

### Recommended Fields

| Field | Type | Description |
|-------|------|-------------|
| `spec_version` | string | gitagent spec version this manifest targets (e.g., `"0.1.0"`) |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `author` | string | Author name or organization |
| `license` | string | SPDX license identifier |
| `model` | object | Model preferences (see Model section) |
| `model.preferred` | string | Primary model ID (e.g., `claude-opus-4-6`, `gpt-4o`) |
| `model.fallback` | string[] | Fallback model IDs in priority order |
| `model.constraints` | object | Parameters: `temperature`, `max_tokens`, `top_p`, `top_k`, `stop_sequences`, `presence_penalty`, `frequency_penalty` |
| `extends` | string | Parent agent (git URL or local path) |
| `dependencies` | object[] | Composed agents with vendor management metadata |
| `skills` | string[] | Enabled skill directories (kebab-case names) |
| `tools` | string[] | Enabled tool files without extension (kebab-case names) |
| `agents` | object | Sub-agent config (keys are agent names) |
| `delegation` | object | Delegation strategy |
| `delegation.mode` | enum | `auto`, `explicit`, or `router` |
| `delegation.router` | string | Router agent name (when mode=router) |
| `runtime` | object | Execution parameters |
| `runtime.max_turns` | integer | Maximum conversation turns |
| `runtime.temperature` | number | 0.0–2.0 |
| `runtime.timeout` | integer | Seconds |
| `a2a` | object | Agent-to-Agent protocol metadata (`url`, `capabilities`, `authentication`, `protocols`) |
| `compliance` | object | Regulatory compliance configuration (see Compliance section) |
| `tags` | string[] | Categorization tags |
| `metadata` | object | Arbitrary key-value pairs (values must be string, number, or boolean) |

### Compliance Section

The `compliance` section enables regulatory adherence for agents operating in regulated environments (financial services, healthcare, etc.).

```yaml
compliance:
  # Risk classification per regulatory framework
  risk_tier: standard  # low | standard | high | critical

  # Applicable regulatory frameworks (extensible — any string value accepted)
  # Standard values: finra, federal_reserve, sec, cfpb, occ, fdic, bsa_aml
  # Non-US examples: eu_ai_act, uk_fca, mas_singapore, gdpr
  frameworks:
    - finra        # FINRA rules (3110, 4511, 2210, etc.)
    - federal_reserve  # SR 11-7, SR 23-4, etc.
    - sec          # SEC regulations (Reg BI, S-P, 17a-4)
    - cfpb         # CFPB fair lending, adverse action

  # Supervision configuration (FINRA Rule 3110)
  supervision:
    designated_supervisor: null       # Principal responsible
    review_cadence: quarterly         # How often agent is reviewed
    human_in_the_loop: conditional    # always | conditional | advisory | none
    escalation_triggers:              # Typed trigger conditions
      - confidence_below: 0.7              # Escalate on low confidence
      - action_type: customer_communication # Escalate for specific actions
      - action_type: trade_execution
      - action_type: credit_decision
      - error_detected: true               # Escalate on errors
      # Other trigger types: data_classification_above, token_count_above, custom
    override_capability: true         # Humans can override any decision
    kill_switch: true                 # Immediate halt capability

  # Recordkeeping (FINRA Rule 4511, SEC 17a-4)
  recordkeeping:
    audit_logging: true               # Log all decisions and actions
    log_format: structured_json       # structured_json | plaintext
    retention_period: 6y              # Minimum retention (6 years per 4511)
    log_contents:
      - prompts_and_responses         # Full I/O logging
      - tool_calls                    # Intermediate tool invocations
      - decision_pathways             # Reasoning traces
      - model_version                 # Which model version was used
      - timestamps                    # ISO 8601
    immutable: true                   # Logs cannot be modified after write

  # Model risk management (SR 11-7)
  model_risk:
    inventory_id: null                # ID in firm's model inventory
    validation_cadence: annual        # How often validated
    validation_type: full             # full | targeted | change_based
    conceptual_soundness: null        # Link to documentation
    ongoing_monitoring: true          # Continuous performance tracking
    outcomes_analysis: true           # Back-testing against actual results
    drift_detection: true             # Monitor for model degradation
    parallel_testing: false           # Run alongside existing system

  # Data governance
  data_governance:
    pii_handling: redact              # redact | encrypt | prohibit | allow
    data_classification: confidential # public | internal | confidential | restricted
    consent_required: true            # Requires user consent for data use
    cross_border: false               # Data crosses jurisdictions
    bias_testing: true                # Regular bias testing required
    lda_search: false                 # Less Discriminatory Alternative search (CFPB)

  # Communications compliance (FINRA Rule 2210)
  communications:
    type: correspondence              # correspondence | retail | institutional
    pre_review_required: false        # Requires principal pre-approval
    fair_balanced: true               # Must be fair and balanced
    no_misleading: true               # No misleading statements
    disclosures_required: false       # AI disclosure to customers

  # Third-party vendor management (SR 23-4)
  vendor_management:
    due_diligence_complete: false     # Vendor DD performed
    soc_report_required: false        # SOC 2 report required
    vendor_ai_notification: true      # Vendor must notify of AI changes
    subcontractor_assessment: false   # Fourth-party risk assessed

  # Segregation of duties (multi-agent duty separation)
  segregation_of_duties:
    roles:                                   # Define roles for agents (min 2)
      - id: maker                            # Initiates/creates
        description: Creates proposals and initiates actions
        permissions: [create, submit]
      - id: checker                          # Reviews/approves
        description: Reviews and approves maker outputs
        permissions: [review, approve, reject]
      - id: executor                         # Executes approved work
        description: Executes approved actions
        permissions: [execute]
      - id: auditor                          # Audits completed work
        description: Reviews completed actions for compliance
        permissions: [audit, report]

    conflicts:                               # SOD conflict matrix
      - [maker, checker]                     # Maker cannot approve own work
      - [maker, auditor]                     # Maker cannot audit own work
      - [executor, checker]                  # Executor cannot approve what they execute
      - [executor, auditor]                  # Executor cannot audit own execution

    assignments:                             # Bind roles to agents
      loan-originator: [maker]
      credit-reviewer: [checker]
      loan-processor: [executor]
      compliance-auditor: [auditor]

    isolation:
      state: full                            # full | shared | none
      credentials: separate                  # separate | shared

    handoffs:                                # Critical actions requiring multi-role handoff
      - action: credit_decision
        required_roles: [maker, checker]
        approval_required: true
      - action: loan_disbursement
        required_roles: [maker, checker, executor]
        approval_required: true

    enforcement: strict                      # strict | advisory

# Financial governance (runtime spending controls for payment-capable agents)
  financial_governance:
    enabled: true                 # false = declared but not enforced
    firewall: valkurai            # named identifier: valkurai, stripe-radar, local-script
    spending:
      max_per_transaction_cents: 5000   # $50.00 hard cap per transaction
      max_monthly_cents: 100000         # $1,000.00 monthly cumulative cap
      currency: AUD                     # ISO 4217 default currency
      allowed_categories:
        - software
        - compute
        - api_services
      blocked_categories:
        - gambling
        - crypto
        - unknown
    approval:
      require_above_cents: 2000         # human approval required above $20.00
      timeout_minutes: 60
      auto_deny_on_timeout: true        # timeout = DENIED
```

### Example Minimal agent.yaml

```yaml
spec_version: "0.1.0"
name: my-agent
version: 0.1.0
description: A helpful assistant agent
```

### Example Regulated agent.yaml

```yaml
spec_version: "0.1.0"
name: compliance-analyst
version: 1.0.0
description: Financial compliance analysis agent
author: Acme Financial
license: proprietary
model:
  preferred: claude-opus-4-6
  fallback:
    - claude-sonnet-4-5-20250929
  constraints:
    temperature: 0.1
    max_tokens: 8192
skills:
  - regulatory-analysis
  - document-review
tools:
  - search-regulations
  - generate-report
runtime:
  max_turns: 50
  timeout: 300
compliance:
  risk_tier: high
  frameworks:
    - finra
    - federal_reserve
    - sec
  supervision:
    designated_supervisor: chief-compliance-officer
    review_cadence: monthly
    human_in_the_loop: always
    escalation_triggers:
      - confidence_below: 0.85
      - action_type: regulatory_filing
      - error_detected: true
    override_capability: true
    kill_switch: true
  recordkeeping:
    audit_logging: true
    log_format: structured_json
    retention_period: 7y
    log_contents:
      - prompts_and_responses
      - tool_calls
      - decision_pathways
      - model_version
      - timestamps
    immutable: true
  model_risk:
    inventory_id: MRM-2024-0047
    validation_cadence: quarterly
    validation_type: full
  data_governance:
    pii_handling: redact
    data_classification: restricted
    consent_required: true
    bias_testing: true
    lda_search: true
  communications:
    type: institutional
    pre_review_required: true
    fair_balanced: true
    no_misleading: true
    disclosures_required: true
tags:
  - compliance
  - financial-services
  - regulated
```

## 4. SOUL.md — Identity

Defines who the agent *is*. Minimal valid SOUL.md is a single paragraph.

### Recommended Sections

- **Core Identity** — What the agent is and its primary purpose
- **Communication Style** — Tone, formality, verbosity preferences
- **Values & Principles** — What the agent prioritizes
- **Domain Expertise** — Areas of specialized knowledge
- **Collaboration Style** — How it works with humans and other agents

### Example

```markdown
# Soul

## Core Identity
I am a regulatory compliance analyst specializing in FINRA and SEC rules.

## Communication Style
Precise, formal, citation-heavy. I always reference specific rule numbers.

## Values & Principles
- Accuracy over speed
- Conservative interpretation of ambiguous regulations
- Transparency in reasoning

## Domain Expertise
- FINRA rules and regulatory notices
- SEC regulations (Reg BI, Reg S-P, 17a-4)
- Federal Reserve supervisory letters (SR 11-7, SR 23-4)
- BSA/AML compliance

## Collaboration Style
I escalate uncertainty rather than guessing. I ask clarifying questions
when requirements are ambiguous.
```

## 5. RULES.md — Constraints

Hard boundaries the agent must respect. These are non-negotiable.

### Recommended Sections

- **Must Always** — Required behaviors
- **Must Never** — Prohibited behaviors
- **Output Constraints** — Format/content restrictions
- **Interaction Boundaries** — Scope limits
- **Safety & Ethics** — Ethical guardrails
- **Regulatory Constraints** — Compliance-specific rules

### Regulatory Constraints Section

For regulated agents, RULES.md should include explicit regulatory constraints:

```markdown
## Regulatory Constraints

### FINRA Rule 2210 — Communications
- All outputs to customers must be fair and balanced
- Never make promissory, exaggerated, or misleading statements
- Never omit material facts that make a statement misleading
- AI-generated nature must be disclosed where required

### FINRA Rule 3110 — Supervision
- All customer-facing outputs require principal review before delivery
- Escalate to designated supervisor when confidence is below threshold
- Log all decisions with full reasoning trace

### SR 11-7 — Model Risk Management
- Document all assumptions and limitations
- Flag when operating outside trained domain
- Never present model outputs as certainties without confidence intervals

### Fair Lending (ECOA/Reg B)
- Never use protected class information in credit decisions
- Document adverse action reasons in specific, actionable terms
- "Black box" complexity is not a defense for unexplainable decisions

### Data Governance
- Never include PII in logs or outputs unless explicitly required
- Redact customer identifiers in all intermediate reasoning
- Never transmit restricted data across jurisdictional boundaries
```

## 5a. DUTIES.md — Segregation of Duties

Declares the agent's duties, role boundaries, and the system-wide SOD policy. DUTIES.md exists at two levels:

**Root level** (`DUTIES.md`) — Documents the system-wide segregation of duties policy: all roles, the conflict matrix, handoff workflows, isolation policy, and enforcement mode. This is the SOD equivalent of `RULES.md` — it defines the policy that all agents in the system must follow.

**Per-agent level** (`agents/<name>/DUTIES.md`) — Declares this specific agent's role, permissions, boundaries, and handoff participation. Each sub-agent's DUTIES.md answers: what is my role, what can I do, what must I not do, and who do I hand off to.

### Root DUTIES.md Recommended Sections

- **Roles** — Table of all roles, assigned agents, and permissions
- **Conflict Matrix** — Which role pairs cannot be held by the same agent
- **Handoff Workflows** — Step-by-step handoff chains for critical actions
- **Isolation Policy** — State and credential isolation levels
- **Enforcement** — Strict vs advisory mode

### Per-Agent DUTIES.md Recommended Sections

- **Role** — This agent's assigned role
- **Permissions** — What actions this agent can take
- **Boundaries** — Must/must-not rules specific to this role
- **Handoff Participation** — Where this agent sits in handoff chains
- **Isolation** — This agent's isolation constraints

## 6. AGENTS.md — Framework-Agnostic Instructions

Provides fallback instructions compatible with Cursor, Copilot, and other tools that read `AGENTS.md`. This file supplements `agent.yaml` + `SOUL.md` for systems that don't understand the gitagent format.

## 7. Skills — Agent Skills Open Standard

gitagent fully adopts the **Agent Skills** open standard ([agentskills.io](https://agentskills.io)) for its `skills/` directory. Any valid Agent Skills skill works in gitagent with zero modification, and opengap skills work in Claude Code, Codex, VS Code, Cursor, Gemini CLI, and all other tools that support the standard.

### SKILL.md Format (Agent Skills Standard)

Skills use YAML frontmatter with the exact fields defined by the Agent Skills spec:

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | Yes | string | Kebab-case, max 64 chars, no `--`, no leading/trailing `-` |
| `description` | Yes | string | Max 1024 characters |
| `license` | No | string | SPDX identifier or `proprietary` |
| `compatibility` | No | string | Free-text compatibility notes (max 500 chars) |
| `allowed-tools` | No | string | Space-delimited tool names (experimental) |
| `metadata` | No | map | String-to-string key-value pairs |

gitagent-specific extensions (`category`, `risk_tier`, `regulatory_frameworks`) live inside `metadata`, preserving full portability:

```markdown
---
name: regulatory-analysis
description: Analyze documents for regulatory compliance
license: proprietary
allowed-tools: search-regulations
metadata:
  author: gitagent-examples
  version: "1.0.0"
  category: compliance
  risk_tier: high
  regulatory_frameworks: finra,sec,federal_reserve,cfpb
---

# Regulatory Analysis

## Instructions
When analyzing a document for regulatory compliance:
1. Identify the applicable regulatory framework
2. Map document contents to specific rules
3. Flag potential violations with rule citations
4. Recommend remediation steps

## Output Format
Use structured findings with severity levels: CRITICAL, HIGH, MEDIUM, LOW.
```

### Progressive Disclosure (3-Tier Loading)

Skills follow the Agent Skills standard's progressive disclosure model:

1. **Metadata only** (~100 tokens) — name + description, for listing and routing
2. **Full skill** (<5000 tokens recommended) — complete frontmatter + instructions, for active use
3. **With resources** — optional `scripts/`, `references/`, `assets/`, `agents/` directories

### Skill Discovery

Skills are discovered from multiple standard locations, in priority order:

| Path | Source | Priority |
|------|--------|----------|
| `<agentDir>/skills/` | Agent-local | Highest |
| `<agentDir>/.agents/skills/` | agentskills.io standard | High |
| `<agentDir>/.claude/skills/` | Claude Code | Medium |
| `<agentDir>/.github/skills/` | GitHub | Medium |
| `~/.agents/skills/` | Personal | Lowest |

On name collision, higher-priority sources win.

### Skill Directory Structure

```
skills/
└── skill-name/
    ├── SKILL.md               # Instructions + frontmatter (required)
    ├── scripts/               # Executable helpers
    ├── references/            # Supporting docs
    ├── assets/                # Templates, schemas
    ├── agents/                # Agent-specific config (e.g., openai.yaml)
    └── examples/              # Example inputs/outputs
```

### Marketplace — Provider-Agnostic Registry

Skills can be installed from marketplace registries. The architecture is provider-agnostic:

```yaml
# In agent.yaml
registries:
  - name: skillsmp
    url: https://api.skillsmp.com
  - name: enterprise
    url: https://skills.internal.company.com
```

Built-in providers:
- **skillsmp** — SkillsMP marketplace (default)
- **github** — Install directly from GitHub repos
- **local** — Install from local filesystem paths

### Skills CLI Commands

| Command | Description |
|---------|-------------|
| `opengap skills search <query>` | Search for skills in a registry |
| `opengap skills install <name>` | Install a skill from a registry |
| `opengap skills list` | List discovered skills |
| `opengap skills info <name>` | Show detailed skill information |

Options: `--provider <name>`, `--global` (install to `~/.agents/skills/`), `--dir <dir>`

## 8. Tools

Tools are MCP-compatible definitions stored in `tools/<name>.yaml`.

### Tool Schema

```yaml
name: search-regulations
description: Search FINRA and SEC regulatory databases
version: 1.0.0
input_schema:
  type: object
  properties:
    query:
      type: string
      description: Search query
    framework:
      type: string
      enum: [finra, sec, federal_reserve, cfpb]
    date_range:
      type: object
      properties:
        from: { type: string, format: date }
        to: { type: string, format: date }
  required: [query]
output_schema:
  type: object
  properties:
    results:
      type: array
      items:
        type: object
        properties:
          title: { type: string }
          citation: { type: string }
          excerpt: { type: string }
          url: { type: string }
implementation:
  type: script
  path: search-regulations.py
  runtime: python3
  timeout: 30
annotations:
  requires_confirmation: false
  read_only: true
  cost: low
```

## 9. Hooks

Lifecycle event handlers stored in `hooks/`.

### hooks.yaml

```yaml
hooks:
  on_session_start:
    - script: scripts/load-compliance-context.sh
      description: Load regulatory context for session
  pre_tool_use:
    - script: scripts/audit-tool-call.sh
      description: Log tool invocation for audit trail
      compliance: true
  post_response:
    - script: scripts/check-communications-compliance.sh
      description: Verify response meets FINRA 2210 standards
      compliance: true
  on_error:
    - script: scripts/escalate-error.sh
      description: Escalate errors to designated supervisor
```

### Hook Script Protocol

Hook scripts receive JSON on stdin and return JSON on stdout:

**Input:**
```json
{
  "event": "pre_tool_use",
  "timestamp": "2026-02-16T12:00:00Z",
  "data": {
    "tool_name": "search-regulations",
    "arguments": { "query": "FINRA Rule 3110" }
  },
  "session": {
    "id": "sess_abc123",
    "agent": "compliance-analyst",
    "model_version": "claude-opus-4-6"
  }
}
```

**Output:**
```json
{
  "action": "allow",
  "modifications": null,
  "audit": {
    "logged": true,
    "log_id": "audit_xyz789"
  }
}
```

Actions: `allow`, `block`, `modify`.

## 10. Workflows

Multi-step procedures in `workflows/`.

### Structured Format (YAML)

```yaml
name: regulatory-review
description: Complete regulatory review workflow
version: 1.0.0
inputs:
  - name: document
    type: file
    required: true
  - name: framework
    type: string
    default: finra
steps:
  - id: classify
    action: Classify document type and applicable regulations
    skill: regulatory-analysis
    outputs: [doc_type, applicable_rules]
  - id: analyze
    action: Analyze document against applicable rules
    depends_on: [classify]
    skill: regulatory-analysis
    inputs:
      rules: ${{ steps.classify.outputs.applicable_rules }}
  - id: report
    action: Generate compliance report
    depends_on: [analyze]
    skill: report-generation
    conditions:
      - ${{ steps.analyze.outputs.findings_count > 0 }}
```

## 11. Knowledge

Reference documents in `knowledge/`.

### index.yaml

```yaml
documents:
  - path: finra-rules-summary.md
    tags: [finra, rules, reference]
    priority: high
    always_load: true
  - path: sr-11-7-guide.pdf
    tags: [federal-reserve, model-risk]
    priority: medium
  - path: compliance-procedures.csv
    tags: [procedures, internal]
    priority: low
```

## 12. Memory

Persistent cross-session state in `memory/`.

### memory.yaml

```yaml
layers:
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
```

## 13. Sub-Agents

Defined in `agents/` using either full directories or single files.

### Full Sub-Agent (Directory)

```
agents/
└── research-assistant/
    ├── agent.yaml
    ├── SOUL.md
    └── skills/
```

### Lightweight Sub-Agent (Single File)

```markdown
---
name: fact-checker
description: Verifies claims against authoritative sources
model:
  preferred: claude-haiku-4-5-20251001
delegation:
  mode: auto
  triggers:
    - factual_claim_detected
---

# Fact Checker

You verify factual claims by consulting authoritative sources.
Always cite your sources. Flag unverifiable claims explicitly.
```

## 14. Compliance Directory

For regulated agents, the `compliance/` directory contains regulatory artifacts.

### regulatory-map.yaml

Maps agent capabilities to regulatory requirements:

```yaml
mappings:
  - capability: customer_communication
    rules:
      - id: finra-2210
        name: Communications with the Public
        controls:
          - fair_balanced_check
          - no_misleading_check
          - principal_pre_review
      - id: finra-4511
        name: Books and Records
        controls:
          - communication_retention
          - format_compliance
  - capability: trade_recommendation
    rules:
      - id: finra-2111
        name: Suitability
        controls:
          - customer_profile_check
          - risk_assessment
      - id: sec-reg-bi
        name: Regulation Best Interest
        controls:
          - best_interest_determination
          - conflict_disclosure
  - capability: credit_decision
    rules:
      - id: ecoa-reg-b
        name: Equal Credit Opportunity Act
        controls:
          - adverse_action_notice
          - no_protected_class_input
          - lda_search_documentation
      - id: cfpb-circular-2022-03
        name: Adverse Action and Complex Algorithms
        controls:
          - explainable_reasons
          - specific_actionable_factors
```

### validation-schedule.yaml

```yaml
schedule:
  - type: full_validation
    cadence: annual
    last_completed: null
    owner: model-risk-team
    sr_11_7_elements:
      - conceptual_soundness
      - ongoing_monitoring
      - outcomes_analysis
  - type: bias_testing
    cadence: quarterly
    last_completed: null
    owner: fair-lending-team
  - type: supervisory_review
    cadence: monthly
    last_completed: null
    owner: designated-supervisor
    finra_rules: [3110, 3120]
  - type: communications_review
    cadence: weekly
    last_completed: null
    owner: compliance-team
    finra_rules: [2210]
```

## 15. Inheritance

### extends

Single inheritance via `extends` in `agent.yaml`:

```yaml
extends: https://github.com/org/base-agent.git
```

**Resolution rules:**
- `agent.yaml`: Child fields override parent fields (deep merge)
- `SOUL.md`: Child replaces parent entirely
- `RULES.md`: Child rules append to parent rules (union)
- `skills/`, `tools/`: Union with child shadowing parent on name collision
- `memory/`: Isolated per agent (not inherited)
- `compliance/`: Child inherits parent compliance config, can override

### dependencies

Compose external agents as mounted capabilities:

```yaml
dependencies:
  - name: fact-checker
    source: https://github.com/org/fact-checker-agent.git
    version: ^1.0.0
    mount: agents/fact-checker
    vendor_management:
      due_diligence_date: 2026-01-15
      soc_report: true
      risk_assessment: low
```

## 16. Configuration

Environment-specific overrides in `config/`.

### default.yaml

```yaml
log_level: info
model_override: null
compliance_mode: true
```

### production.yaml

```yaml
log_level: warn
compliance_mode: true
audit_logging: true
```

Configs are deep-merged: `default.yaml` ← `<env>.yaml`.

## 17. Runtime State

`.gitagent/` is gitignored and contains runtime artifacts:

- `deps/` — Installed dependencies
- `state.json` — Current session state
- `cache/` — Temporary cache

## 18. Validation Rules

A valid gitagent repository must:

1. Contain `agent.yaml` with required fields (`name`, `version`, `description`)
2. Contain `SOUL.md` with at least one non-empty paragraph
3. If `compliance` section exists in `agent.yaml`:
   - `risk_tier` must be specified
   - If `risk_tier` is `high` or `critical`:
     - `supervision.human_in_the_loop` must be `always` or `conditional`
     - `recordkeeping.audit_logging` must be `true`
     - `model_risk.validation_cadence` must be `quarterly` or more frequent
   - If `frameworks` includes `finra`:
     - `communications.fair_balanced` must be `true`
     - `communications.no_misleading` must be `true`
   - If `frameworks` includes `federal_reserve`:
     - `model_risk` section must be present
     - `model_risk.ongoing_monitoring` must be `true`
4. All referenced skills must exist in `skills/`
5. All referenced tools must exist in `tools/`
6. All referenced sub-agents must exist in `agents/`
7. `hooks.yaml` scripts must exist at specified paths
8. If `compliance.segregation_of_duties` is present:
   - `roles` must define at least 2 roles with unique IDs
   - `conflicts` pairs must reference defined role IDs
   - `assignments` must reference defined role IDs
   - No agent in `assignments` may hold roles that appear together in `conflicts`
   - `handoffs.required_roles` must reference defined role IDs and include at least 2
   - Assigned agents should exist in the `agents` section
9. If `compliance.financial_governance` is present:
   - `enabled` must be specified
   - If `enabled` is `true` and `spending` is present, `max_per_transaction_cents` must be a positive integer
   - `approval.auto_deny_on_timeout` should default to `true` if not specified
   - `firewall` references a named integration identifier, not an endpoint URL
  
## 19. CLI Commands

### Implemented (v0.1.0)

| Command | Description |
|---------|-------------|
| `opengap init [--template]` | Scaffold new agent (`minimal`, `standard`, `full`) |
| `opengap validate [--compliance]` | Validate against spec, optionally with regulatory checks |
| `opengap info` | Display agent summary |
| `opengap export --format <fmt>` | Export (`system-prompt`, `claude-code`, `openai`, `crewai`) |
| `opengap import --from <fmt> <path>` | Import (`claude`, `cursor`, `crewai`) |
| `opengap install` | Resolve and install git-based dependencies |
| `opengap audit` | Generate compliance audit report |
| `opengap skills search <query>` | Search for skills in a registry |
| `opengap skills install <name>` | Install a skill from a registry |
| `opengap skills list` | List discovered skills |
| `opengap skills info <name>` | Show detailed skill information |

### Planned (future versions)

| Command | Description |
|---------|-------------|
| `opengap run [--env] [--model]` | Start agent interactively |
| `gitagent serve --protocol <proto>` | Run as A2A/MCP server |
| `opengap test` | Run against example scenarios |
| `gitagent publish` | Publish to registry |
| `gitagent card` | Generate A2A Agent Card |
| `opengap diff <ref1> <ref2>` | Semantic diff between versions |

## 19a. JSON Schemas

All schemas are in `spec/schemas/`:

| Schema | File | Validates |
|--------|------|-----------|
| Agent Manifest | `agent-yaml.schema.json` | `agent.yaml` |
| Tool Definition | `tool.schema.json` | `tools/*.yaml` |
| Hooks Config | `hooks.schema.json` | `hooks/hooks.yaml` |
| Hook I/O Protocol | `hook-io.schema.json` | Hook script stdin/stdout JSON |
| Workflow | `workflow.schema.json` | `workflows/*.yaml` |
| Memory Config | `memory.schema.json` | `memory/memory.yaml` |
| Skill Frontmatter | `skill.schema.json` | YAML frontmatter in `skills/*/SKILL.md` (Agent Skills standard) |
| Marketplace Package | `marketplace.schema.json` | Skill distribution manifest (`marketplace.json`) |
| Knowledge Index | `knowledge.schema.json` | `knowledge/index.yaml` |
| Config | `config.schema.json` | `config/*.yaml` |

## 20. Regulatory Reference

### FINRA Rules

| Rule | Subject | gitagent Impact |
|------|---------|-----------------|
| 2010 | Standards of Commercial Honor | `RULES.md` ethical constraints |
| 2111 | Suitability | `compliance.communications` |
| 2210 | Communications with the Public | `compliance.communications` |
| 3110 | Supervision | `compliance.supervision` |
| 3120 | Supervisory Control System | `compliance.supervision` |
| 4370 | Business Continuity Plans | `hooks.on_error` |
| 4511 | General Requirements (Books and Records) | `compliance.recordkeeping` |

### FINRA Regulatory Notices

| Notice | Subject |
|--------|---------|
| 24-09 | Regulatory Obligations When Using GenAI/LLMs |
| 25-07 | Modernizing Workplaces (GenAI recordkeeping) |
| 21-29 | Outsourcing to Third-Party Vendors |

### Federal Reserve / Interagency

| Document | Subject | gitagent Impact |
|----------|---------|-----------------|
| SR 11-7 | Model Risk Management | `compliance.model_risk` |
| SR 23-4 | Third-Party Risk Management | `dependencies.vendor_management` |
| SR 21-8 | BSA/AML Model Risk | `compliance.model_risk` for AML agents |
| CFPB Circular 2022-03 | Adverse Action + AI | `compliance.data_governance.lda_search` |

### Segregation of Duties References

| Document | Subject | gitagent Impact |
|----------|---------|-----------------|
| FINOS AI Governance Framework | Multi-Agent Isolation & Segmentation | `compliance.segregation_of_duties` |
| SOC 2 Type II | Logical Access Controls | `segregation_of_duties.isolation` |
| SR 11-7 Section IV | Independent Review | `segregation_of_duties.conflicts` (maker/checker separation) |
| FINRA 3110 | Supervisory Systems (duty separation) | `segregation_of_duties.handoffs` |

---

*This specification is a living document. Contributions welcome.*
