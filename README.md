<p align="center">
  <img src="hero.png" alt="OpenGAP — GitAgentProtocol (Open GAP)" width="700" />
</p>

# OpenGAP | your repository becomes your agent

> **`opengap`** — the OpenGAP CLI, published as [`@open-gitagent/opengap`](https://www.npmjs.com/package/@open-gitagent/opengap). Previously published as `@open-gitagent/gapman` and originally `@open-gitagent/gitagent`; the `gitagent` command is still installed as an alias for backward compatibility.

[![npm version](https://img.shields.io/npm/v/@open-gitagent/opengap)](https://www.npmjs.com/package/@open-gitagent/opengap)
[![CI](https://github.com/open-gitagent/gitagent/actions/workflows/ci.yml/badge.svg)](https://github.com/open-gitagent/gitagent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Spec: v0.1.0](https://img.shields.io/badge/spec-v0.1.0-blue)](https://github.com/open-gitagent/gitagent/blob/main/spec/SPECIFICATION.md)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

OpenGAP (the Git Agent Protocol) is a framework-agnostic, git-native standard for defining AI agents. Clone a repo, get an agent. `opengap` is its reference CLI.

## Why

Every AI framework has its own structure. There's no universal, portable way to define an agent that works across Claude Code, OpenAI, LangChain, CrewAI, and AutoGen. **gitagent** fixes that.

- **Git-native** — Version control, branching, diffing, and collaboration built in
- **Framework-agnostic** — Export to any framework with adapters
- **Compliance-ready** — First-class support for FINRA, Federal Reserve, SEC, and segregation of duties
- **Composable** — Agents can extend, depend on, and delegate to other agents

## The Standard

Your repository becomes your agent. Drop these files into any git repo and it becomes a portable, framework-agnostic agent definition — everything else (CLI, adapters, patterns) builds on top of it.

```
my-agent/
│
│   # ── Core Identity (required) ──────────────────────────
├── agent.yaml              # Manifest — name, version, model, skills, tools, compliance
├── SOUL.md                 # Identity, personality, communication style, values
│
│   # ── Behavior & Rules ──────────────────────────────────
├── RULES.md                # Hard constraints, must-always/must-never, safety boundaries
├── DUTIES.md               # Segregation of duties policy and role boundaries
├── AGENTS.md               # Framework-agnostic fallback instructions
│
│   # ── Capabilities ──────────────────────────────────────
├── skills/                 # Reusable capability modules (SKILL.md + scripts)
│   └── code-review/
│       ├── SKILL.md
│       └── review.sh
├── tools/                  # MCP-compatible tool definitions (YAML schemas)
├── workflows/              # Multi-step procedures/playbooks
│
│   # ── Knowledge & Memory ────────────────────────────────
├── knowledge/              # Reference documents the agent can consult
├── memory/                 # Persistent cross-session memory
│   └── runtime/            # Live agent state (dailylog.md, context.md)
│
│   # ── Lifecycle & Ops ───────────────────────────────────
├── hooks/                  # Lifecycle event handlers (bootstrap.md, teardown.md)
├── config/                 # Environment-specific overrides
├── compliance/             # Regulatory compliance artifacts
│
│   # ── Composition ───────────────────────────────────────
├── agents/                 # Sub-agent definitions (recursive structure)
│   └── fact-checker/
│       ├── agent.yaml
│       ├── SOUL.md
│       └── DUTIES.md       # This agent's role, permissions, boundaries
├── examples/               # Calibration interactions (few-shot)
│
│   # ── Runtime ───────────────────────────────────────────
└── .gitagent/              # Runtime state (gitignored)
```

Only two files are required: **`agent.yaml`** (the manifest) and **`SOUL.md`** (the identity). Everything else is optional — add what you need, ignore the rest.

## Patterns

These are the architectural patterns that emerge when you define agents as git-native file systems.

### Human-in-the-Loop for RL Agents
When an agent learns a new skill or writes to memory, it opens a branch + PR for human review before merging.

<img src="patterns/human-in-the-loop.png" alt="Human-in-the-Loop" width="600" />

### Segregation of Duties (SOD)
No single agent should control a critical process end-to-end. Define roles (`maker`, `checker`, `executor`, `auditor`), a conflict matrix (which roles can't be the same agent), and handoff workflows — all in `agent.yaml` + `DUTIES.md`. The validator catches violations before deployment.

```yaml
compliance:
  segregation_of_duties:
    roles:
      - id: maker
        description: Creates proposals
        permissions: [create, submit]
      - id: checker
        description: Reviews and approves
        permissions: [review, approve, reject]
    conflicts:
      - [maker, checker]         # maker cannot approve own work
    assignments:
      loan-originator: [maker]
      credit-reviewer: [checker]
    handoffs:
      - action: credit_decision
        required_roles: [maker, checker]
        approval_required: true
    enforcement: strict
```

### Live Agent Memory
The `memory/` folder holds a `runtime/` subfolder where agents write live knowledge — `dailylog.md`, `key-decisions.md`, and `context.md` — persisting state across sessions.

<img src="patterns/live-agent-memory.png" alt="Live Agent Memory" width="600" />

### Agent Versioning
Every change to your agent is a git commit. Roll back broken prompts, revert bad skills, and explore past versions — full undo history for your agent.

<img src="patterns/agent-versioning.png" alt="Agent Versioning" width="600" />

### Shared Context & Skills via Monorepo
Root-level `context.md`, `skills/`, `tools/` are automatically shared across every agent in the monorepo. No duplication, one source of truth.

<img src="patterns/shared-context.png" alt="Shared Context" width="600" />

### Branch-based Deployment
Use git branches (`dev` → `staging` → `main`) to promote agent changes through environments, just like shipping software.

<img src="patterns/branch-deployment.png" alt="Branch-based Deployment" width="600" />

### Knowledge Tree
The `knowledge/` folder stores entity relationships as a hierarchical tree with embeddings, letting agents reason over structured data at runtime.

<img src="patterns/knowledge-tree.png" alt="Knowledge Tree" width="600" />

### Agent Forking & Remixing
Fork any public agent repo, customize its `SOUL.md`, add your own skills, and PR improvements back upstream — open-source collaboration for AI agents.

<img src="patterns/agent-forking.png" alt="Agent Forking & Remixing" width="600" />

### CI/CD for Agents
Run `opengap validate` on every push via GitHub Actions. Test agent behavior in CI, block bad merges, and auto-deploy — treat agent quality like code quality.

<img src="patterns/ci-cd-agents.png" alt="CI/CD for Agents" width="600" />

### Agent Diff & Audit Trail
`git diff` shows exactly what changed between agent versions. `git blame` traces every line to who wrote it and when — full traceability out of the box.

<img src="patterns/agent-diff-audit.png" alt="Agent Diff & Audit Trail" width="600" />

### Tagged Releases
Tag stable agent versions like `v1.1.0`. Pin production to a tag, canary new versions on staging, and roll back instantly if something breaks.

<img src="patterns/tagged-releases.png" alt="Tagged Releases" width="600" />

### Secret Management via .gitignore
Agent tools that need API keys read from a local `.env` file — kept out of version control via `.gitignore`. Agent config is shareable, secrets stay local.

<img src="patterns/secret-management.png" alt="Secret Management" width="600" />

### Agent Lifecycle with Hooks
Define `bootstrap.md` and `teardown.md` in the `hooks/` folder to control what an agent does on startup and before it stops.

<img src="patterns/agent-automation-hooks.png" alt="Agent Lifecycle Hooks" width="600" />

### SkillsFlow
Deterministic, multi-step workflows defined in `workflows/` as YAML. Chain `skill:`, `agent:`, and `tool:` steps with `depends_on` ordering, `${{ }}` template data flow, and per-step `prompt:` overrides. Every run follows the same path — no LLM discretion on execution order.

```yaml
name: code-review-flow
description: Full code review pipeline
triggers:
  - pull_request

steps:
  lint:
    skill: static-analysis
    inputs:
      path: ${{ trigger.changed_files }}

  review:
    agent: code-reviewer
    depends_on: [lint]
    prompt: |
      Focus on security and performance.
      Flag any use of eval() or raw SQL.
    inputs:
      findings: ${{ steps.lint.outputs.issues }}

  test:
    tool: bash
    depends_on: [lint]
    inputs:
      command: "npm test -- --coverage"

  report:
    skill: review-summary
    depends_on: [review, test]
    conditions:
      - ${{ steps.review.outputs.severity != 'none' }}
    inputs:
      review: ${{ steps.review.outputs.comments }}
      coverage: ${{ steps.test.outputs.report }}

error_handling:
  on_failure: notify
  channel: "#eng-reviews"
```

### Porting Framework Agents to GitAgent

Agents built in frameworks like NVIDIA AIQ, LangGraph, or CrewAI have their identity split across config files, Jinja2 templates, and Python code. gitagent extracts the **identity layer** — prompts, rules, roles, tool schemas — into a portable, versionable format.

> **What ports cleanly:** system prompts, persona definitions, hard constraints, tool schemas, role/SOD policies, model preferences.
>
> **What stays in the framework:** runtime orchestration (state machines, graph wiring), live tool execution, memory I/O, iterative loops.

This pattern is demonstrated with [NVIDIA's AIQ Deep Researcher](https://github.com/NVIDIA-AI-Blueprints/aiq) — a 3-agent hierarchy (orchestrator → planner → researcher) that produces cited research reports. The gitagent version captures the agent's identity, rules, and SOD policy so you can:

- **Fork for a new domain** — edit `SOUL.md` for legal/medical/finance research without touching Python
- **Version prompts independently** — `git diff` when the orchestrator's style regresses
- **Validate SOD** — `opengap validate --compliance` ensures the orchestrator can't also be the researcher
- **Export to other runtimes** — same identity on Claude Code, OpenAI, or as a raw system prompt

```
examples/nvidia-deep-researcher/
├── agent.yaml                  # Manifest + SOD policy
├── SOUL.md                     # Orchestrator identity (from orchestrator.j2)
├── RULES.md                    # Citation rules, report constraints
├── DUTIES.md                   # Role separation: orchestrator ↔ planner ↔ researcher
├── agents/planner/             # Planner sub-agent (from planner.j2)
├── agents/researcher/          # Researcher sub-agent (from researcher.j2)
├── skills/{web,paper,knowledge}-search/
├── tools/*.yaml                # MCP-compatible tool schemas
└── config/                     # Model assignments per environment
```

See [`examples/nvidia-deep-researcher/`](examples/nvidia-deep-researcher/) for the full working example.

## Quick Start

```bash
# Install
npm i -g @open-gitagent/opengap

# Create a new agent
opengap init --template standard

# Validate
opengap validate

# View agent info
opengap info

# Export to system prompt
opengap export --format system-prompt
```

> `gitagent` is installed as an alias — all `opengap <cmd>` calls work as `gitagent <cmd>` too.

## agent.yaml

The only file with a strict schema. Minimal example:

```yaml
spec_version: "0.1.0"
name: my-agent
version: 0.1.0
description: A helpful assistant agent
```

Full example with compliance:

```yaml
spec_version: "0.1.0"
name: compliance-analyst
version: 1.0.0
description: Financial compliance analysis agent
model:
  preferred: claude-opus-4-6
compliance:
  risk_tier: high
  frameworks: [finra, federal_reserve, sec]
  supervision:
    human_in_the_loop: always
    kill_switch: true
  recordkeeping:
    audit_logging: true
    retention_period: 7y
    immutable: true
  model_risk:
    validation_cadence: quarterly
    ongoing_monitoring: true
  segregation_of_duties:
    roles:
      - id: analyst
        permissions: [create, submit]
      - id: reviewer
        permissions: [review, approve, reject]
    conflicts:
      - [analyst, reviewer]
    assignments:
      compliance-analyst: [analyst]
      fact-checker: [reviewer]
    enforcement: strict
```

## CLI Commands

Both `opengap` and `gitagent` refer to the same binary — use whichever you prefer.

| Command | Description |
|---------|-------------|
| `opengap init [--template]` | Scaffold new agent (`minimal`, `standard`, `full`, `llm-wiki`) |
| `opengap validate [--compliance]` | Validate against spec and regulatory requirements |
| `opengap info` | Display agent summary |
| `opengap export --format <fmt>` | Export to other formats (see adapters below) |
| `opengap import --from <fmt> <path>` | Import (`claude`, `cursor`, `crewai`, `opencode`) |
| `opengap run <source> --adapter <a>` | Run an agent from a git repo or local directory |
| `opengap install` | Resolve and install git-based dependencies |
| `opengap audit` | Generate compliance audit report |
| `opengap skills <cmd>` | Manage skills (`search`, `install`, `list`, `info`) |
| `opengap lyzr <cmd>` | Manage Lyzr agents (`create`, `update`, `info`, `run`) |

## Compliance

gitagent has first-class support for financial regulatory compliance:

### FINRA
- **Rule 3110** — Supervision: human-in-the-loop, escalation triggers, kill switch
- **Rule 4511** — Recordkeeping: immutable audit logs, retention periods, SEC 17a-4 compliance
- **Rule 2210** — Communications: fair/balanced enforcement, no misleading statements
- **Reg Notice 24-09** — Existing rules apply to GenAI/LLMs

### Federal Reserve
- **SR 11-7** — Model Risk Management: validation cadence, ongoing monitoring, outcomes analysis
- **SR 23-4** — Third-Party Risk: vendor due diligence, SOC reports, subcontractor assessment

### SEC / CFPB
- **Reg S-P** — Customer privacy, PII handling
- **CFPB Circular 2022-03** — Explainable adverse action, Less Discriminatory Alternative search

### Segregation of Duties
- **Roles & Permissions** — Define maker, checker, executor, auditor roles with controlled permissions
- **Conflict Matrix** — Declare which role pairs cannot be held by the same agent
- **Handoff Workflows** — Require multi-agent participation for critical actions (credit decisions, regulatory filings)
- **Isolation** — Full state and credential segregation between roles
- **DUTIES.md** — Root-level policy + per-agent role declarations
- **Enforcement** — Strict (blocks deployment) or advisory (warnings only)

Inspired by [Salient AI](https://www.trysalient.com/)'s purpose-built agent architecture and the [FINOS AI Governance Framework](https://air-governance-framework.finos.org/mitigations/mi-22_multi-agent-isolation-and-segmentation.html).

Run `opengap audit` for a full compliance checklist against your agent configuration.

## Adapters

Adapters are used by both `export` and `run`. Available adapters:

| Adapter | Description |
|---------|-------------|
| `system-prompt` | Concatenated system prompt (works with any LLM) |
| `claude-code` | Claude Code compatible CLAUDE.md |
| `openai` | OpenAI Agents SDK Python code |
| `crewai` | CrewAI YAML configuration |
| `lyzr` | Lyzr Studio agent |
| `github` | GitHub Models inference |
| `git` | Git-native execution (run only) |
| `opencode` | OpenCode instructions + config |
| `gemini` | Google Gemini CLI (GEMINI.md + settings.json) |
| `openclaw` | OpenClaw format |
| `nanobot` | Nanobot format |
| `cursor` | Cursor `.cursor/rules/*.mdc` files |
| `copilot` | GitHub Copilot instructions (export only) |
| `codex` | OpenAI Codex CLI instructions (export only) |
| `kiro` | Kiro agent format (export only) |
| `gitclaw` | GitClaw agent format |

```bash
# Export to system prompt
opengap export --format system-prompt

# Run an agent directly
opengap run ./my-agent --adapter lyzr

# Run an agent definition against a separate target workspace
opengap run --dir ./agents/reviewer --workspace ~/code/my-app --adapter claude -p "Review this repository"
```

## Inheritance & Composition

```yaml
# Extend a parent agent
extends: https://github.com/org/base-agent.git

# Compose with dependencies
dependencies:
  - name: fact-checker
    source: https://github.com/org/fact-checker.git
    version: ^1.0.0
    mount: agents/fact-checker
```

## Examples

See the `examples/` directory:

- **`examples/minimal/`** — 2-file hello world (agent.yaml + SOUL.md)
- **`examples/standard/`** — Code review agent with skills, tools, and rules
- **`examples/full/`** — Production compliance agent with all directories, hooks, workflows, sub-agents, SOD with DUTIES.md, and regulatory artifacts
- **`examples/gitagent-helper/`** — Helper agent that assists with creating gitagent definitions
- **`examples/lyzr-agent/`** — Example Lyzr Studio integration

## Specification

Full specification at [`spec/SPECIFICATION.md`](spec/SPECIFICATION.md).

JSON Schemas for validation at `spec/schemas/`.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=open-gitagent/opengap&type=Date)](https://star-history.com/#open-gitagent/opengap&Date)

## Built with gitagent?

If you've built an agent using gitagent, we'd love to hear about it! [Open a discussion](https://github.com/open-gitagent/gitagent/discussions) or add a `gitagent` topic to your repo.

## License

MIT
