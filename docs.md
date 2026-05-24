# OpenGAP Documentation

A framework-agnostic, git-native standard for defining AI agents. `opengap` is the reference CLI for the Git Agent Protocol.

**Clone a repo, get an agent.**

> The package was originally published as `@open-gitagent/gitagent`, then `@open-gitagent/gapman`. Starting with v0.4.0 it is published as [`@open-gitagent/opengap`](https://www.npmjs.com/package/@open-gitagent/opengap). Both `opengap` and `gitagent` commands are installed as binaries — they point to the same CLI.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Directory Structure](#directory-structure)
- [Agent Manifest (agent.yaml)](#agent-manifest)
- [CLI Commands](#cli-commands)
  - [init](#init)
  - [validate](#validate)
  - [info](#info)
  - [export](#export)
  - [import](#import)
  - [install](#install)
  - [audit](#audit)
  - [skills](#skills)
  - [run](#run)
  - [lyzr](#lyzr)
- [Export Formats](#export-formats)
- [Adapters & Runners](#adapters--runners)
  - [Claude](#claude-runner)
  - [OpenAI](#openai-runner)
  - [CrewAI](#crewai-runner)
  - [OpenClaw](#openclaw-runner)
  - [Nanobot](#nanobot-runner)
  - [Lyzr](#lyzr-runner)
  - [GitHub Models](#github-models-runner)
  - [Git (Auto-Detect)](#git-runner-auto-detect)
- [Skills System](#skills-system)
- [Compliance](#compliance)
- [Inheritance & Composition](#inheritance--composition)
- [Git Caching](#git-caching)
- [Authentication](#authentication)
- [Environment Variables](#environment-variables)
- [Examples](#examples)
- [JSON Schemas](#json-schemas)

---

## Installation

```bash
npm install -g @open-gitagent/opengap
```

Verify:

```bash
opengap --version   # 0.3.1
opengap --help

# gitagent alias also works
opengap --version
```

---

## Quick Start

```bash
# Create a new agent
opengap init --template standard --dir ./my-agent

# Validate it
opengap validate -d ./my-agent

# Run it locally with Claude Code
opengap run -d ./my-agent

# Run from a git repo
opengap run -r https://github.com/user/my-agent -p "Hello"

# Run with a different adapter
opengap run -d ./my-agent -a github -p "Summarize this project"

# Clone + auto-detect best adapter + run
opengap run -r https://github.com/user/my-agent -a git -p "Hello"

# Deploy to Lyzr Studio and chat
opengap lyzr run -r https://github.com/user/my-agent -p "Hello"

# Export to another framework
opengap export -f openai -d ./my-agent -o agent.py
```

---

## Core Concepts

**Git-native** — Every agent is a git repo. Version control, branching, diffing, PRs, and collaboration come free.

**Framework-agnostic** — Define your agent once, export to Claude Code, OpenAI, CrewAI, OpenClaw, Nanobot, Lyzr, or GitHub Models with adapters.

**Compliance-ready** — First-class support for FINRA, Federal Reserve, SEC, and CFPB regulatory requirements baked into the manifest.

**Composable** — Agents can extend parent agents, declare dependencies, and delegate to sub-agents.

---

## Directory Structure

```
my-agent/
├── agent.yaml          # [REQUIRED] Manifest — name, version, model, skills, tools, compliance
├── SOUL.md             # [REQUIRED] Identity, personality, communication style, values
├── RULES.md            # Hard constraints, must-always/must-never, safety boundaries
├── PROMPT.md           # Default task framing and output format
├── AGENTS.md           # Framework-agnostic fallback instructions
├── skills/             # Reusable capability modules (SKILL.md + scripts)
│   └── my-skill/
│       ├── SKILL.md    # Frontmatter + instructions
│       ├── scripts/    # Executable scripts
│       ├── references/ # Reference documents
│       └── assets/     # Static assets
├── tools/              # MCP-compatible tool definitions (YAML schemas)
│   └── my-tool.yaml
├── knowledge/          # Reference documents the agent can consult
│   ├── index.yaml      # Document index with always_load flags
│   └── docs/
├── memory/             # Persistent cross-session memory
│   ├── MEMORY.md       # Working memory (max 200 lines)
│   └── memory.yaml     # Memory configuration
├── workflows/          # Multi-step procedures/playbooks
├── hooks/              # Lifecycle event handlers
│   ├── hooks.yaml      # Hook definitions
│   └── scripts/        # Hook scripts
├── examples/           # Calibration interactions (few-shot)
├── agents/             # Sub-agent definitions (recursive structure)
│   └── sub-agent/
│       ├── agent.yaml
│       └── SOUL.md
├── compliance/         # Regulatory compliance artifacts
│   ├── risk-assessment.md
│   ├── regulatory-map.yaml
│   └── validation-schedule.yaml
├── config/             # Environment-specific overrides
│   └── default.yaml
├── .gitagent_adapter   # Optional: hint for git runner auto-detection (e.g. "lyzr", "github")
├── .lyzr_agent_id      # Auto-generated: Lyzr Studio agent ID (after lyzr create)
├── .github_models      # Optional: hint for git runner to use GitHub Models adapter
└── .gitagent/          # Runtime state (gitignored)
```

Only `agent.yaml` and `SOUL.md` are required. Everything else is optional.

---

## Agent Manifest

`agent.yaml` is the only file with a strict schema. It defines the agent's identity, model preferences, capabilities, and compliance configuration.

### Minimal

```yaml
spec_version: "0.1.0"
name: my-agent
version: 0.1.0
description: A helpful assistant agent
```

### Standard

```yaml
spec_version: "0.1.0"
name: code-review-agent
version: 1.0.0
description: Automated code review agent with best-practice enforcement
author: gitagent-examples
license: MIT

model:
  preferred: claude-sonnet-4-5-20250929
  fallback:
    - claude-haiku-4-5-20251001
  constraints:
    temperature: 0.2
    max_tokens: 4096

skills:
  - code-review

tools:
  - lint-check
  - complexity-analysis

runtime:
  max_turns: 20
  timeout: 120

tags:
  - code-review
  - developer-tools
```

### Full (with Compliance)

```yaml
spec_version: "0.1.0"
name: compliance-analyst
version: 1.0.0
description: Financial compliance analysis agent
author: Acme Corp
license: MIT

model:
  preferred: claude-opus-4-6
  fallback:
    - claude-sonnet-4-5-20250929
  constraints:
    temperature: 0.2
    max_tokens: 4096
    top_p: 0.9

skills:
  - code-review
  - security-audit

tools:
  - search-codebase
  - run-tests

agents:
  fact-checker:
    description: Verifies factual claims
    delegation:
      mode: auto
      triggers:
        - "verify this claim"

delegation:
  mode: auto
  router: semantic

runtime:
  max_turns: 50
  temperature: 0.3
  timeout: 300

a2a:
  url: https://api.example.com/agent
  capabilities:
    - code-review
    - compliance-check
  authentication:
    type: bearer
    required: true
  protocols:
    - a2a-v1

extends: https://github.com/org/base-agent.git

dependencies:
  - name: fact-checker
    source: https://github.com/org/fact-checker.git
    version: ^1.0.0
    mount: agents/fact-checker
    vendor_management:
      due_diligence_date: "2024-01-15"
      soc_report: true
      risk_assessment: low

compliance:
  risk_tier: high
  frameworks:
    - finra
    - federal_reserve
    - sec
  supervision:
    designated_supervisor: John Smith
    review_cadence: weekly
    human_in_the_loop: always
    escalation_triggers:
      - condition: pii_detected
        action: halt_and_escalate
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
    inventory_id: MRM-2024-001
    validation_cadence: quarterly
    validation_type: full
    ongoing_monitoring: true
    outcomes_analysis: true
    drift_detection: true
  data_governance:
    pii_handling: redact
    data_classification: confidential
    consent_required: true
    cross_border: false
    bias_testing: true
  communications:
    type: correspondence
    pre_review_required: true
    fair_balanced: true
    no_misleading: true
    disclosures_required: true
  vendor_management:
    due_diligence_complete: true
    soc_report_required: true
    vendor_ai_notification: true
    subcontractor_assessment: true

tags:
  - finance
  - compliance
metadata:
  team: platform
```

---

## CLI Commands

### init

Scaffold a new agent repository.

```bash
opengap init [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-t, --template <name>` | `standard` | Template: `minimal`, `standard`, or `full` |
| `-d, --dir <dir>` | `.` | Target directory |

**Templates:**

| Template | Files Created |
|----------|---------------|
| `minimal` | `agent.yaml`, `SOUL.md` |
| `standard` | `agent.yaml`, `SOUL.md`, `RULES.md`, `AGENTS.md`, `skills/`, `knowledge/`, `tools/` |
| `full` | Everything in standard + `memory/`, `hooks/`, `examples/`, `agents/`, `compliance/`, `config/`, `.gitignore` |

```bash
opengap init --template minimal
opengap init --template full --dir ./my-agent
```

---

### validate

Validate an agent against the specification and optionally check regulatory compliance.

```bash
opengap validate [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-d, --dir <dir>` | `.` | Agent directory |
| `-c, --compliance` | `false` | Include regulatory compliance validation |

**What gets validated:**

- **agent.yaml** — JSON schema validation, referenced skills/tools/agents exist
- **SOUL.md** — Exists, not empty, has real content
- **Skills** — Valid frontmatter, name matches directory, description length, instruction size
- **Hooks** — Valid YAML, referenced scripts exist
- **Tools** — Valid YAML schema

**With `--compliance`:**

- Risk tier required when compliance section exists
- High/critical tiers require human-in-the-loop and audit logging
- FINRA: fair_balanced and no_misleading enforcement
- Federal Reserve: model_risk section with ongoing_monitoring
- SEC: audit logging, PII handling checks
- CFPB: bias testing recommendation
- Compliance artifacts directory check
- Vendor management metadata for dependencies

```bash
opengap validate
opengap validate --compliance
opengap validate -d ./examples/full --compliance
```

---

### info

Display a formatted summary of the agent configuration.

```bash
opengap info [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-d, --dir <dir>` | `.` | Agent directory |

Shows: name, version, description, author, license, model preferences, skills, tools, sub-agents, runtime config, compliance settings, tags, and a SOUL.md preview.

```bash
opengap info
opengap info -d ./examples/standard
```

---

### export

Export an agent to another framework's format.

```bash
opengap export [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-f, --format <format>` | *(required)* | Export format (see table below) |
| `-d, --dir <dir>` | `.` | Agent directory |
| `-o, --output <path>` | stdout | Output file path |

**Supported formats:**

| Format | Output | Description |
|--------|--------|-------------|
| `system-prompt` | Markdown | Concatenated system prompt for any LLM |
| `claude-code` | Markdown | Claude Code `CLAUDE.md` file |
| `openai` | Python | OpenAI Agents SDK code with tool definitions |
| `crewai` | YAML | CrewAI crew configuration |
| `openclaw` | JSON + Markdown | OpenClaw workspace (config + AGENTS.md + skills) |
| `nanobot` | JSON + Markdown | Nanobot config.json + system prompt |
| `lyzr` | JSON | Lyzr Studio API payload (agent creation) |
| `github` | JSON | GitHub Models API chat completions payload |

```bash
# Print system prompt to terminal
opengap export --format system-prompt

# Save Claude Code format to file
opengap export --format claude-code --output CLAUDE.md

# Generate OpenAI Python code
opengap export --format openai --output agent.py

# Preview Lyzr API payload
opengap export --format lyzr -d ./examples/lyzr-agent

# Preview GitHub Models payload
opengap export --format github -d ./examples/standard

# Export CrewAI config
opengap export --format crewai -d ./examples/standard
```

---

### import

Import from another agent framework into gitagent format.

```bash
opengap import --from <format> <path> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--from <format>` | *(required)* | Source format: `claude`, `cursor`, `crewai` |
| `<path>` | *(required)* | Source file or directory |
| `-d, --dir <dir>` | `.` | Target directory |

**Import sources:**

| Source | What it reads | What it creates |
|--------|---------------|-----------------|
| `claude` | `CLAUDE.md`, `.claude/skills/` | `agent.yaml`, `SOUL.md`, `RULES.md`, imported skills |
| `cursor` | `.cursorrules` or `AGENTS.md` | `agent.yaml`, `SOUL.md`, `AGENTS.md` |
| `crewai` | CrewAI YAML config | `agent.yaml`, `SOUL.md`, sub-agents in `agents/` |

```bash
opengap import --from claude ./my-claude-project
opengap import --from cursor ./.cursorrules
opengap import --from crewai ./crew.yaml --dir ./imported-agent
```

---

### install

Resolve and install git-based agent dependencies declared in `agent.yaml`.

```bash
opengap install [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-d, --dir <dir>` | `.` | Agent directory |

For each entry in `dependencies`:
- Local paths are copied
- Git URLs are shallow-cloned at the specified version/branch
- Target directory is `mount` path or `.gitagent/deps/<name>`
- Validates that installed dependencies contain `agent.yaml`

```bash
opengap install
opengap install -d ./my-agent
```

---

### audit

Generate a comprehensive compliance audit report.

```bash
opengap audit [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-d, --dir <dir>` | `.` | Agent directory |

**Report sections:**

1. **Risk Classification** — Risk tier and applicable frameworks
2. **Supervision (FINRA Rule 3110)** — Supervisor assignment, review cadence, human-in-the-loop, escalation triggers, override capability, kill switch
3. **Recordkeeping (FINRA 4511 / SEC 17a-4)** — Audit logging, log format, retention period, log contents, immutability
4. **Model Risk Management (SR 11-7)** — Inventory ID, validation cadence, ongoing monitoring, outcomes analysis, drift detection
5. **Data Governance (Reg S-P, CFPB)** — PII handling, data classification, consent, cross-border, bias testing
6. **Communications Compliance (FINRA 2210)** — Type classification, fair/balanced, no misleading, pre-review, disclosures
7. **Vendor Management (SR 23-4)** — Due diligence, SOC reports, vendor AI notification, subcontractor assessment
8. **Compliance Artifacts** — Directory and file existence checks
9. **Audit Hooks** — hooks.yaml and compliance-flagged hooks

```bash
opengap audit
opengap audit -d ./examples/full
```

---

### skills

Manage agent skills — search registries, install, list, and inspect.

#### skills search

```bash
opengap skills search <query> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --provider <name>` | `skillsmp` | Registry: `skillsmp` or `github` |
| `-d, --dir <dir>` | `.` | Agent directory |
| `-l, --limit <n>` | `20` | Max results |

#### skills install

```bash
opengap skills install <name> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --provider <name>` | `skillsmp` | Registry: `skillsmp`, `github`, or `local` |
| `-g, --global` | `false` | Install to `~/.agents/skills/` |
| `-d, --dir <dir>` | `.` | Agent directory for local install |

**GitHub format:** `owner/repo#path/to/skill`

#### skills list

```bash
opengap skills list [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-d, --dir <dir>` | `.` | Agent directory |
| `-l, --local` | `false` | Only show agent-local skills |

#### skills info

```bash
opengap skills info <name> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-d, --dir <dir>` | `.` | Agent directory |

```bash
opengap skills search "code review"
opengap skills install code-review --global
opengap skills list
opengap skills info code-review
```

---

### run

Run an agent interactively with a specific adapter/framework.

```bash
opengap run [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-r, --repo <url>` | — | Git repository URL |
| `-d, --dir <dir>` | — | Local directory (alternative to `--repo`) |
| `-a, --adapter <name>` | `claude` | Adapter (see table below) |
| `-b, --branch <branch>` | `main` | Git branch or tag to clone |
| `-w, --workspace <dir>` | Agent directory | Working directory for spawned agent process |
| `--refresh` | `false` | Force re-clone (pull latest) |
| `--no-cache` | `false` | Clone to temp dir, delete on exit |
| `-p, --prompt <query>` | — | Initial prompt (non-interactive for some adapters) |

Either `--repo` or `--dir` is required.

`--workspace` lets an agent definition live separately from the repository it operates on. It is honored by adapters that can safely set the spawned process working directory directly, including `claude`, `openai`, `crewai`, `openclaw`, and `nanobot`. Adapters that generate an isolated runtime workspace, such as `opencode`, `gemini`, and `gitclaw`, continue to run from that prepared workspace to avoid overwriting files such as `AGENTS.md`, `GEMINI.md`, or `agent.yaml` in the target repository.

**Available adapters:**

| Adapter | Mode | Requirements |
|---------|------|-------------|
| `claude` | Interactive / one-shot | Claude Code CLI |
| `openai` | One-shot | `OPENAI_API_KEY`, Python 3, `openai-agents` |
| `crewai` | One-shot | CrewAI CLI |
| `openclaw` | One-shot (`-p` required) | `ANTHROPIC_API_KEY`, OpenClaw CLI |
| `nanobot` | Interactive / one-shot | `ANTHROPIC_API_KEY`, Nanobot CLI |
| `lyzr` | One-shot (`-p` required) | `LYZR_API_KEY` |
| `github` | One-shot (`-p` required) | `GITHUB_TOKEN` with `models:read` scope |
| `git` | Auto-detect | Depends on detected adapter |
| `prompt` | Print only | None |

```bash
# Run a local agent with Claude Code (interactive)
opengap run -d ./my-agent

# Run from a git repo
opengap run -r https://github.com/user/agent

# Run with GitHub Models
opengap run -d ./my-agent -a github -p "Review my code"

# Run with Lyzr
opengap run -r https://github.com/user/agent -a lyzr -p "Hello"

# Auto-detect adapter from repo contents
opengap run -r https://github.com/user/agent -a git -p "Hello"

# One-shot prompt mode
opengap run -d ./my-agent -p "Review my authentication code"

# Run an agent definition against a separate target workspace
opengap run -d ./agents/reviewer --workspace ~/code/my-app -a claude -p "Review this repository"

# Run a specific branch, force refresh
opengap run -r https://github.com/user/agent -b develop --refresh

# Just output the system prompt (no runner)
opengap run -d ./my-agent -a prompt
```

---

### lyzr

Manage Lyzr Studio agents — create, update, inspect, and run.

```bash
opengap lyzr <subcommand> [options]
```

#### lyzr create

Create a new agent on Lyzr Studio from the local gitagent definition.

```bash
opengap lyzr create [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-d, --dir <dir>` | `.` | Agent directory |
| `--api-key <key>` | — | Lyzr API key (or set `LYZR_API_KEY`) |

Saves the returned agent ID to `.lyzr_agent_id` for reuse.

```bash
opengap lyzr create -d ./examples/lyzr-agent
```

#### lyzr update

Push the current gitagent definition to an existing Lyzr agent.

```bash
opengap lyzr update [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-d, --dir <dir>` | `.` | Agent directory |
| `--agent-id <id>` | — | Lyzr agent ID (or reads from `.lyzr_agent_id`) |
| `--api-key <key>` | — | Lyzr API key (or set `LYZR_API_KEY`) |

```bash
opengap lyzr update -d ./examples/lyzr-agent
opengap lyzr update --agent-id abc123
```

#### lyzr info

Show the Lyzr agent ID linked to this gitagent directory.

```bash
opengap lyzr info [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-d, --dir <dir>` | `.` | Agent directory |

```bash
opengap lyzr info -d ./examples/lyzr-agent
```

#### lyzr run

Clone a git agent repo, create it on Lyzr, and chat — all in one command.

```bash
opengap lyzr run [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-r, --repo <url>` | — | Git repository URL |
| `-d, --dir <dir>` | — | Local agent directory |
| `-b, --branch <branch>` | `main` | Git branch/tag |
| `--refresh` | `false` | Force re-clone |
| `-p, --prompt <message>` | — | Message to send to the agent |
| `--api-key <key>` | — | Lyzr API key (or set `LYZR_API_KEY`) |
| `--user-id <id>` | — | User ID for chat session |

If no `.lyzr_agent_id` exists, the agent is created on Lyzr Studio first. If no prompt is provided, it just creates the agent and prints the ID.

```bash
# Full one-liner: clone + create + chat
opengap lyzr run -r https://github.com/user/my-agent -p "Hello"

# From local directory
opengap lyzr run -d ./examples/lyzr-agent -p "Summarize AI trends"

# Just create (no prompt)
opengap lyzr run -r https://github.com/user/my-agent
```

**Lyzr API Endpoints:**

| Endpoint | Purpose |
|----------|---------|
| `POST /v3/agents/template/single-task` | Create agent |
| `PUT /v3/agents/template/single-task/{id}` | Update agent |
| `GET /v3/agents/{id}` | Fetch agent |
| `POST /v3/inference/chat/` | Chat with agent |

Base URL: `https://agent-prod.studio.lyzr.ai`

---

## Export Formats

### system-prompt

A single concatenated markdown document suitable for any LLM. Contains (in order):

1. Agent identity header (name + version)
2. SOUL.md content
3. RULES.md content
4. Skills with instructions and allowed tools
5. Knowledge documents (those marked `always_load` in `knowledge/index.yaml`)
6. Compliance constraints as behavioral rules
7. Memory content (if `MEMORY.md` has content)

### claude-code

A `CLAUDE.md` file compatible with Claude Code. Includes SOUL.md, RULES.md, skills, model preference (as HTML comment), compliance constraints, and knowledge references.

### openai

Python source code for the OpenAI Agents SDK. Generates:
- `from agents import Agent, Tool`
- Python function stubs for each tool in `tools/*.yaml` with docstrings and parameter type mappings
- `Agent()` instantiation with name, instructions, model, and tools list

### crewai

YAML configuration for CrewAI. Parses SOUL.md to extract role, goal, and backstory. Includes skill descriptions in backstory. Maps sub-agents from `agents/` directory.

### openclaw

OpenClaw workspace format. Returns structured output with:
- `openclaw.json` config (model mapping, workspace settings)
- `AGENTS.md` (identity, rules, knowledge, compliance, sub-agents)
- `SOUL.md` (passthrough)
- Tool definitions as markdown
- Skills as separate SKILL.md files

### nanobot

Nanobot configuration format. Returns:
- `config.json` (provider config, agent settings, model mapping)
- System prompt (SOUL.md + RULES.md + skills + knowledge + compliance + tools)

### lyzr

Lyzr Studio API payload for agent creation. Returns JSON with:
- `name`, `description` — from agent.yaml
- `agent_role` — extracted from SOUL.md "Core Identity" section
- `agent_goal` — extracted from SOUL.md "Values/Purpose/Goal" section
- `agent_instructions` — full system prompt (SOUL + RULES + skills + compliance + memory)
- `provider_id` — mapped from model name (`OpenAI`, `Anthropic`, `Google`)
- `model` — from agent.yaml `model.preferred`
- `temperature`, `top_p` — from model constraints
- `llm_credential_id` — mapped to Lyzr credential IDs (`lyzr_openai`, `lyzr_anthropic`, etc.)
- `features` — memory feature enabled by default

**Model-to-Provider mapping:**

| Model Prefix | Lyzr Provider | Credential ID |
|-------------|---------------|---------------|
| `claude-*` | Anthropic | `lyzr_anthropic` |
| `gpt-*`, `o1-*`, `o3-*` | OpenAI | `lyzr_openai` |
| `gemini-*` | Google | `lyzr_google` |
| *(default)* | OpenAI | `lyzr_openai` |

### github

GitHub Models API payload (OpenAI-compatible chat completions). Returns JSON with:
- `model` — namespaced for GitHub Models (e.g. `openai/gpt-4.1`)
- `messages` — system prompt from agent definition
- `temperature`, `max_tokens` — from model constraints
- `stream: true` — always streams

**Model namespace mapping:**

| Model Prefix | GitHub Namespace |
|-------------|-----------------|
| `gpt-*`, `o1-*`, `o3-*`, `o4-*` | `openai/` |
| `claude-*` | `anthropic/` |
| `llama-*`, `Llama-*` | `meta/` |
| `mistral-*`, `Mistral-*` | `mistralai/` |
| `gemini-*` | `google/` |
| `deepseek-*`, `DeepSeek-*` | `deepseek/` |

---

## Adapters & Runners

When you run `opengap run -a <adapter>`, the corresponding runner prepares the environment and launches the framework.

### Claude Runner

Adapter: `claude`

1. Generates system prompt from agent definition
2. Builds Claude Code CLI arguments:
   - `--append-system-prompt` — layers agent identity on Claude Code defaults
   - `--model` / `--fallback-model` — from manifest
   - `--max-turns` — from runtime config
   - `--permission-mode plan` — if `human_in_the_loop` is `always`
   - `--allowedTools` — from skills and tool definitions
   - `--agents` — sub-agent configuration from `agents/`
   - `--add-dir` — knowledge and skills directories
   - `--settings` — hooks mapped to Claude Code format
3. Spawns `claude` CLI with stdio inherited (interactive)

**Requires:** [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed globally.

**Hooks mapping:**

| gitagent Hook | Claude Code Event |
|--------------|-------------------|
| `on_session_start` | `PreToolUse` |
| `pre_tool_use` | `PreToolUse` |
| `post_tool_use` | `PostToolUse` |
| `pre_response` | `PostToolUse` |
| `post_response` | `PostToolUse` |
| `on_error` | `PostToolUse` |
| `on_session_end` | `PostToolUse` |

---

### OpenAI Runner

Adapter: `openai`

1. Checks `OPENAI_API_KEY` is set
2. Exports agent as Python code (OpenAI Agents SDK)
3. Writes to temp file and runs with `python3`
4. Cleans up temp file after execution

**Requires:** Python 3, `openai-agents` package, `OPENAI_API_KEY` environment variable.

---

### CrewAI Runner

Adapter: `crewai`

1. Exports agent as CrewAI YAML config
2. Writes to temp file
3. Runs `crewai kickoff --config <tmpfile>`

**Requires:** `crewai` CLI installed (`pip install crewai`).

---

### OpenClaw Runner

Adapter: `openclaw`

1. Auto-provisions auth from `ANTHROPIC_API_KEY` (writes `~/.openclaw/agents/main/agent/auth-profiles.json` if needed)
2. Creates temporary workspace with `AGENTS.md`, `SOUL.md`, `TOOLS.md`, skills
3. Maps `human_in_the_loop=always` to `thinking=high`
4. Runs `openclaw agent --local --session-id <id> --message <prompt>`
5. Cleans up temp workspace

**Requires:** [OpenClaw](https://openclaw.ai) installed, `ANTHROPIC_API_KEY` set, `-p` prompt required.

---

### Nanobot Runner

Adapter: `nanobot`

1. Auto-provisions auth from `ANTHROPIC_API_KEY` (writes `~/.nanobot/config.json` if needed)
2. Creates temp config directory with `config.json` + `system-prompt.md`
3. Runs `nanobot agent` (interactive) or `nanobot agent --message <prompt>` (one-shot)
4. Sets `NANOBOT_CONFIG` and `NANOBOT_SYSTEM_PROMPT` environment variables
5. Cleans up temp directory

**Requires:** [Nanobot](https://nanobot.ai) installed (`pip install nanobot-ai`), `ANTHROPIC_API_KEY` set.

---

### Lyzr Runner

Adapter: `lyzr`

1. Ensures `LYZR_API_KEY` is set (or passed via `--api-key`)
2. Exports agent to Lyzr API payload
3. Creates agent on Lyzr Studio via POST (if no `.lyzr_agent_id` exists)
4. Saves agent ID to `.lyzr_agent_id` for reuse
5. Sends prompt to Lyzr inference chat API
6. Prints response

**Requires:** `LYZR_API_KEY` environment variable (get from [Lyzr Studio](https://studio.lyzr.ai)). Prompt (`-p`) is required.

**API flow:**

```
POST /v3/agents/template/single-task  →  agent_id
POST /v3/inference/chat/              →  response
```

---

### GitHub Models Runner

Adapter: `github`

1. Ensures `GITHUB_TOKEN` or `GH_TOKEN` is set with `models:read` scope
2. Exports system prompt from agent definition
3. Resolves model name to GitHub Models namespace (e.g. `gpt-4.1` → `openai/gpt-4.1`)
4. Sends streaming chat completions request to GitHub Models API
5. Streams response tokens to stdout in real-time

**Requires:** `GITHUB_TOKEN` or `GH_TOKEN` with `models:read` scope. Generate at [github.com/settings/tokens](https://github.com/settings/tokens). Prompt (`-p`) is required.

**API endpoint:** `https://models.github.ai/inference/chat/completions`

**Default model:** `openai/gpt-4.1` (when no model specified in agent.yaml)

```bash
export GITHUB_TOKEN="ghp_..."
opengap run -d ./my-agent -a github -p "Review this code"
```

---

### Git Runner (Auto-Detect)

Adapter: `git`

The git runner clones a repository and auto-detects the best adapter from the agent definition, then delegates to the appropriate runner.

**Auto-detection priority:**

| Priority | Signal | Detected Adapter |
|----------|--------|-----------------|
| 1 | `.gitagent_adapter` file | Value in file (e.g. `lyzr`, `github`) |
| 2 | Model name starts with `claude` | `claude` |
| 3 | Model name starts with `gpt`, `o1`, `o3` | `openai` |
| 4 | `CLAUDE.md` or `.claude/` exists | `claude` |
| 5 | `.cursorrules` exists | `openai` |
| 6 | `crew.yaml` or `crewai.yaml` exists | `crewai` |
| 7 | `.lyzr_agent_id` exists | `lyzr` |
| 8 | `.github_models` exists | `github` |
| 9 | *(fallback)* | `claude` |

```bash
# Auto-detect and run
opengap run -a git -r https://github.com/user/my-agent -p "Hello"

# Force a specific branch
opengap run -a git -r https://github.com/user/my-agent -b develop --refresh -p "Hello"
```

---

## Skills System

Skills are reusable capability modules following the [Agent Skills](https://agentskills.io) standard.

### Skill Structure

```
skills/
└── my-skill/
    ├── SKILL.md        # Required: frontmatter + instructions
    ├── scripts/        # Optional: executable scripts
    ├── references/     # Optional: reference documents
    ├── assets/         # Optional: static assets
    └── agents/         # Optional: skill-specific sub-agents
```

### SKILL.md Format

```markdown
---
name: code-review
description: Performs thorough code reviews with security analysis
license: MIT
compatibility: ">=0.1.0"
allowed-tools: Read Edit Grep Glob Bash
metadata:
  author: "Jane Doe"
  version: "1.0.0"
  category: "developer-tools"
---

# Instructions

Review the code for:
- Security vulnerabilities
- Performance issues
- Code style consistency
...
```

**Frontmatter fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Skill identifier, max 64 chars |
| `description` | Yes | Max 1024 characters |
| `license` | No | License type |
| `compatibility` | No | Semantic version compatibility |
| `allowed-tools` | No | Space-delimited tool names |
| `metadata` | No | Arbitrary key-value pairs |

**Constraints:** Instructions should be under ~5000 tokens (~20000 chars).

### Discovery

Skills are discovered from multiple locations (highest to lowest priority):

| Priority | Path | Source |
|----------|------|--------|
| 1 | `<agent>/skills/` | Agent-local |
| 2 | `<agent>/.agents/skills/` | agentskills.io standard |
| 3 | `<agent>/.claude/skills/` | Claude Code |
| 4 | `<agent>/.github/skills/` | GitHub |
| 5 | `~/.agents/skills/` | Personal (global) |

Deduplication: first match by name wins.

### Progressive Loading

- **Metadata** (~100 tokens): name + description only, used for listing
- **Full** (~5000 tokens max recommended): frontmatter + complete instructions, used when skill is active

### Registries

| Provider | Search | Install |
|----------|--------|---------|
| `skillsmp` | SkillsMP REST API (`https://api.skillsmp.com`) | Download + extract |
| `github` | GitHub code search | Sparse clone from `owner/repo#path` |
| `local` | — | Copy from filesystem path |

---

## Compliance

gitagent has deep support for financial regulatory compliance, built directly into the agent manifest.

### Risk Tiers

| Tier | Requirements |
|------|-------------|
| `low` | Minimal — standard logging |
| `standard` | Audit logging recommended |
| `high` | Human-in-the-loop required, audit logging required, compliance artifacts required |
| `critical` | All of `high` + kill switch, immutable logs, quarterly validation |

### Regulatory Frameworks

| Framework | Key Rules | What gitagent validates |
|-----------|-----------|------------------------|
| **FINRA** | Rule 3110 (Supervision), Rule 4511 (Recordkeeping), Rule 2210 (Communications) | Supervisor assignment, HITL, escalation triggers, audit logging, retention periods (min 6y), fair/balanced, no misleading |
| **Federal Reserve** | SR 11-7 (Model Risk), SR 23-4 (Third-Party Risk) | Model inventory, validation cadence, ongoing monitoring, vendor due diligence |
| **SEC** | Reg S-P (Privacy), 17a-4 (Records) | Audit logging, PII handling, retention periods (min 3y) |
| **CFPB** | Circular 2022-03 (Fair Lending) | Bias testing, LDA search |

### Compliance Artifacts

For `high` and `critical` risk tiers, gitagent expects:

```
compliance/
├── risk-assessment.md        # Risk tier justification
├── regulatory-map.yaml       # Framework mappings
└── validation-schedule.yaml  # Validation cadence schedule
```

### Audit Report

Run `opengap audit` to generate a section-by-section compliance checklist with pass/fail/warning indicators for every regulatory requirement.

---

## Inheritance & Composition

### Extending Agents

```yaml
# agent.yaml
extends: https://github.com/org/base-agent.git
```

A child agent inherits the parent's configuration and can override specific fields.

### Dependencies

```yaml
dependencies:
  - name: fact-checker
    source: https://github.com/org/fact-checker.git
    version: ^1.0.0
    mount: agents/fact-checker
    vendor_management:
      due_diligence_date: "2024-01-15"
      soc_report: true
      risk_assessment: low
```

Run `opengap install` to resolve and clone all dependencies.

### Sub-Agents

```yaml
agents:
  reviewer:
    description: Reviews code for quality
    delegation:
      mode: auto
      triggers:
        - "review this code"
  security-scanner:
    description: Scans for vulnerabilities
    delegation:
      mode: manual
```

Sub-agents are defined in `agents/<name>/` with their own `agent.yaml` and `SOUL.md`.

---

## Git Caching

When running agents from git URLs, gitagent caches repositories locally to avoid repeated clones.

**Cache location:** `~/.gitagent/cache/<hash>/`

The hash is derived from SHA-256 of `{url}#{branch}` (first 16 characters).

| Flag | Behavior |
|------|----------|
| *(default)* | Clone once, reuse from cache |
| `--refresh` | Pull latest into existing cache |
| `--no-cache` | Clone to temp directory, delete on exit |

---

## Authentication

gitagent auto-provisions authentication for supported adapters:

| Adapter | Environment Variable | Auto-provision |
|---------|---------------------|----------------|
| Claude | `ANTHROPIC_API_KEY` or `ANTHROPIC_OAUTH_TOKEN` | No (uses Claude Code auth) |
| OpenAI | `OPENAI_API_KEY` | No |
| OpenClaw | `ANTHROPIC_API_KEY` | Yes — creates `~/.openclaw/agents/main/agent/auth-profiles.json` |
| Nanobot | `ANTHROPIC_API_KEY` | Yes — creates `~/.nanobot/config.json` |
| Lyzr | `LYZR_API_KEY` or `--api-key` | No |
| GitHub | `GITHUB_TOKEN` or `GH_TOKEN` | No |

---

## Environment Variables

| Variable | Used By | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Claude, OpenClaw, Nanobot | Anthropic API key |
| `ANTHROPIC_OAUTH_TOKEN` | Claude, OpenClaw, Nanobot | Anthropic OAuth token (alternative to API key) |
| `OPENAI_API_KEY` | OpenAI runner | OpenAI API key |
| `LYZR_API_KEY` | Lyzr runner, `lyzr` command | Lyzr Studio API key |
| `GITHUB_TOKEN` | GitHub Models runner | GitHub personal access token (`models:read` scope) |
| `GH_TOKEN` | GitHub Models runner | GitHub token (alternative, used by `gh` CLI) |

---

## Examples

The `examples/` directory contains reference agents:

### examples/minimal

The absolute minimum — 2 files:

```
examples/minimal/
├── agent.yaml
└── SOUL.md
```

### examples/standard

A code review agent with skills, tools, and knowledge:

```
examples/standard/
├── agent.yaml          # claude-sonnet-4-5, code-review skill
├── SOUL.md             # Code review specialist identity
├── RULES.md            # Security-first rules, output constraints
├── PROMPT.md           # Review task framing and output format
├── AGENTS.md
├── skills/
│   └── code-review/
│       └── SKILL.md
├── tools/
│   ├── lint-check.yaml
│   └── complexity-analysis.yaml
└── knowledge/
    ├── index.yaml
    └── owasp-top-10.md
```

### examples/full

A production-ready compliance agent with every directory:

```
examples/full/
├── agent.yaml          # Full compliance configuration
├── SOUL.md
├── RULES.md
├── agents/
│   └── fact-checker/
├── compliance/
│   ├── risk-assessment.md
│   ├── regulatory-map.yaml
│   └── validation-schedule.yaml
├── config/
│   ├── default.yaml
│   └── production.yaml
├── examples/
│   ├── good-outputs.md
│   ├── bad-outputs.md
│   └── scenarios/
├── hooks/
│   ├── hooks.yaml
│   └── scripts/
├── knowledge/
│   ├── index.yaml
│   └── *.md
├── memory/
│   ├── MEMORY.md
│   └── memory.yaml
├── skills/
│   ├── document-review/
│   └── regulatory-analysis/
├── tools/
│   ├── generate-report.yaml
│   └── search-regulations.yaml
└── workflows/
    └── regulatory-review.yaml
```

### examples/lyzr-agent

A research assistant designed for Lyzr Studio:

```
examples/lyzr-agent/
├── agent.yaml          # gpt-4.1, research skill
├── SOUL.md             # Research assistant identity
├── RULES.md            # Structured output, no fabrication
├── PROMPT.md           # Research task framing
├── .gitagent_adapter   # Auto-selects lyzr adapter
├── README.md
└── skills/
    └── research/
        └── SKILL.md
```

```bash
opengap lyzr create -d ./examples/lyzr-agent
opengap lyzr run -d ./examples/lyzr-agent -p "What are AI agents?"
```

---

## JSON Schemas

Validation schemas are located in `spec/schemas/`:

| Schema | Validates |
|--------|-----------|
| `agent-yaml.schema.json` | `agent.yaml` manifest |
| `skill.schema.json` | SKILL.md frontmatter |
| `tool.schema.json` | Tool definitions in `tools/*.yaml` |
| `hooks.schema.json` | `hooks/hooks.yaml` |
| `hook-io.schema.json` | Hook input/output format |
| `knowledge.schema.json` | `knowledge/index.yaml` |
| `memory.schema.json` | `memory/memory.yaml` |
| `workflow.schema.json` | Workflow definitions |
| `marketplace.schema.json` | Marketplace skill metadata |

---

## Project Structure

```
gitagent/
├── src/
│   ├── index.ts                    # CLI entry point (Commander)
│   ├── commands/
│   │   ├── init.ts                 # opengap init
│   │   ├── validate.ts             # opengap validate
│   │   ├── info.ts                 # opengap info
│   │   ├── export.ts               # opengap export
│   │   ├── import.ts               # opengap import
│   │   ├── install.ts              # opengap install
│   │   ├── audit.ts                # opengap audit
│   │   ├── skills.ts               # opengap skills
│   │   ├── run.ts                  # opengap run
│   │   └── lyzr.ts                 # opengap lyzr
│   ├── adapters/
│   │   ├── index.ts                # Re-exports all adapters
│   │   ├── system-prompt.ts        # Markdown system prompt
│   │   ├── claude-code.ts          # CLAUDE.md format
│   │   ├── openai.ts               # Python OpenAI Agents SDK
│   │   ├── crewai.ts               # CrewAI YAML
│   │   ├── openclaw.ts             # OpenClaw workspace
│   │   ├── nanobot.ts              # Nanobot config
│   │   ├── lyzr.ts                 # Lyzr Studio API payload
│   │   └── github.ts               # GitHub Models payload
│   ├── runners/
│   │   ├── claude.ts               # Spawns Claude Code CLI
│   │   ├── openai.ts               # Spawns Python with OpenAI SDK
│   │   ├── crewai.ts               # Spawns CrewAI CLI
│   │   ├── openclaw.ts             # Spawns OpenClaw CLI
│   │   ├── nanobot.ts              # Spawns Nanobot CLI
│   │   ├── lyzr.ts                 # Calls Lyzr REST API
│   │   ├── github.ts               # Calls GitHub Models API
│   │   └── git.ts                  # Clone + auto-detect + delegate
│   └── utils/
│       ├── loader.ts               # agent.yaml loading, AgentManifest type
│       ├── format.ts               # Terminal formatting (chalk)
│       ├── schemas.ts              # JSON schema loading
│       ├── skill-loader.ts         # SKILL.md parsing (frontmatter + instructions)
│       ├── skill-discovery.ts      # Multi-path skill discovery
│       ├── git-cache.ts            # Git clone caching (~/.gitagent/cache/)
│       ├── registry-provider.ts    # SkillsMP, GitHub, Local providers
│       └── auth-provision.ts       # API key resolution + auto-provisioning
├── spec/
│   └── schemas/                    # JSON validation schemas
├── examples/
│   ├── minimal/                    # 2-file agent
│   ├── standard/                   # Code review agent
│   ├── full/                       # Production compliance agent
│   └── lyzr-agent/                 # Lyzr research assistant
├── package.json
├── tsconfig.json
└── docs.md
```

---

## License

MIT
