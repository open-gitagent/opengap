# OpenGAP
### GitAgentProtocol — *A Git-Native Protocol for the AI Agent Lifecycle*

**Shreyas Kapale**
OpenGAP Working Group
[shreyas@lyzr.ai](mailto:shreyas@lyzr.ai) · [gitagent.sh](https://gitagent.sh) · [github.com/open-gitagent/opengap](https://github.com/open-gitagent/opengap)

*Preprint. April 2026.*

---

## Abstract

AI agents are being deployed into regulated, high-stakes environments faster than the tooling to govern them has matured. Today, an agent's *identity* lives in a Python class, its *policy* lives in a dashboard, its *memory* lives in a vector store, its *audit trail* lives nowhere in particular, and its *version* is whatever commit someone happens to deploy. This paper argues that the right unit of an agent is not a process, not a model, not a config file, and not a dashboard, but a **git repository** — and presents the **GitAgentProtocol (OpenGAP)**, an open standard that makes that abstraction concrete.

Under OpenGAP, an agent is fully described by files in a directory: identity (`SOUL.md`), hard constraints (`RULES.md`), segregation-of-duties (`DUTIES.md`), skills, tools, knowledge, memory, hooks, sub-agents, and regulatory-compliance artifacts. A single canonical definition deterministically exports to **15 execution environments** (Claude Code, OpenAI Agents SDK, CrewAI, Cursor, Gemini CLI, Codex, OpenCode, Kiro, Lyzr, OpenClaw, Nanobot, GitHub Copilot, GitHub Models, GitClaw, system-prompt) with a documented **fidelity profile** per target. **Fourteen lifecycle patterns** — which we show decompose into four meta-patterns: *structural guarantees*, *lifecycle operations*, *collaboration primitives*, and *runtime hooks* — emerge naturally from the git substrate. Compliance is a first-class spec element, mapped onto FINRA 3110/4511/2210, SEC Reg BI/Reg S-P/17a-4, Federal Reserve SR 11-7, and CFPB Circular 2022-03, and enforced through `pre_tool_use` hooks with `fail_open: false` semantics. We prove a simple **structural SOD theorem**: any segregation-of-duties conflict declared in `DUTIES.md` is unbypassable by the agent itself, provided branch-protection rules are active and the agent has no force-push rights.

Spec v0.4 adds three concrete extensions to this surface: portable `mcp_servers` declarations that export to each runtime's native MCP configuration, a `financial_governance` block with spending caps and approval thresholds for payment-capable agents, and an accepted RFC for an optional Ed25519 cryptographic-identity layer.

OpenGAP is MIT-licensed. The reference implementation has **2,700+ GitHub stars**, 15 adapters, 11 runtime runners, and ships provenance-signed as `@open-gitagent/opengap` (v0.4.0) on npm. This paper consolidates the specification, the adapter model, the patterns, and the compliance framing into a single citable artifact, and sets an agenda for conformance testing, formal SOD verification, and an event schema for regulated agent-to-agent interaction.

**Keywords:** AI agents · protocols · version control · governance · segregation of duties · FINRA · SEC · SR 11-7 · model risk management · interoperability · open standards.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [The Design Lineage](#2-the-design-lineage-from-unix-to-gitops-to-agents)
3. [Related Work](#3-related-work)
4. [The OpenGAP Protocol](#4-the-opengap-protocol)
5. [Portability: The Adapter Model](#5-portability-the-adapter-model)
6. [Lifecycle Patterns](#6-lifecycle-patterns)
7. [Enterprise and Regulatory](#7-enterprise-and-regulatory)
8. [A Structural SOD Theorem](#8-a-structural-sod-theorem)
9. [Reference Implementation](#9-reference-implementation)
10. [Case Studies](#10-case-studies)
11. [Evaluation](#11-evaluation)
12. [Discussion](#12-discussion)
13. [Future Work](#13-future-work)
14. [Conclusion](#14-conclusion)
15. [References](#references)
16. [Appendix A: `agent.yaml` Schema (Excerpt)](#appendix-a-agentyaml-schema-excerpt)
17. [Appendix B: Full Fidelity Matrix](#appendix-b-full-fidelity-matrix)
18. [Appendix C: Formal Definitions](#appendix-c-formal-definitions)

---

## 1. Introduction

> **Consider a scenario.** A compliance officer at a mid-sized broker-dealer is served with a FINRA inquiry. Regulators want to know: on March 3, 2026, at 14:22 ET, what instructions did your AI trading-assistant agent have? Which supervisory rules applied? Who reviewed them last? What did its memory contain, and what tool calls did it make? Produce the record.
>
> If the agent is a Python class checked into a repo, line-level `git blame` may answer *what the code said*, but not *which policy version was in force*. If the agent is configured in a vendor dashboard, the record is not under the firm's control and may not be retained under SEC 17a-4. If the agent's memory is a vector store, there is no time-indexed snapshot at all. The compliance officer's honest answer is some combination of "we'll get back to you" and "we don't know."

This scenario is not hypothetical. Every team we have spoken with that deploys agents into regulated settings reports some version of it. The remedy is not better documentation, better dashboards, or better vendors. The remedy is a change of *substrate*: the agent itself must become an artifact that the regulator's question can be answered against in constant time, from first principles, without trust in any runtime.

We argue in this paper that the right substrate is a **git repository**, and we present **OpenGAP** — the GitAgentProtocol — as an open standard that makes the "repository-as-agent" abstraction concrete, portable, and enforceable.

### 1.1 Three problems, one cause

Three widely-observed problems share a common root cause.

- **Non-portability.** An agent defined in CrewAI cannot be run under OpenAI Agents SDK without a rewrite; an agent configured in Claude Code's `.claude/` directory cannot be executed by Gemini CLI. Teams end up maintaining n copies of "the same" agent.
- **Non-auditability.** A system prompt in a vendor dashboard does not appear in `git blame`, is not covered by SEC 17a-4 retention, and cannot be signed off by a compliance officer as the canonical version that ran during a specific interval.
- **Non-governance.** Segregation of duties, human-in-the-loop supervision, spending controls, and PII redaction are, in nearly every production deployment, wrapped around the agent by a runtime — which means they can be bypassed by changing the runtime, and they cannot be inspected by reading the agent's own definition.

The common cause is the absence of a standardized *definition layer*. Existing protocols standardize adjacent layers: MCP standardizes the *tool-call* interface, A2A standardizes the *agent-to-agent messaging* interface, ACP and AG-UI standardize the *user-interaction stream*. None of them say what the agent itself *is*.

### 1.2 Thesis

> **The definition layer of an AI agent should be a git repository with a standardized directory layout, a validated manifest, and a deterministic export to any given runtime.**

This thesis is conservative in the sense that it does not invent new technology — it reuses the most rigorously-operated piece of infrastructure in software engineering (git) for a new purpose. It is ambitious in the sense that, if adopted, it reorganizes the AI-agent stack: the definition is the contract, the runtime is plural, and governance becomes a property of the artifact rather than the environment.

### 1.3 Contributions

1. **The repository-as-agent abstraction** (§4). A directory layout and manifest schema under which every aspect of an agent — identity, rules, duties, skills, tools, knowledge, memory, hooks, sub-agents, compliance — is a file, under version control.
2. **The adapter model with a measurable fidelity profile** (§5). A systematic translation from the canonical definition to fifteen execution environments, with per-target fidelity tabulated and reproducible by running the reference CLI.
3. **A taxonomy of fourteen lifecycle patterns organized into four meta-patterns** (§6). We show that the patterns that emerge from git-native agents are not a grab-bag but decompose cleanly into *structural guarantees*, *lifecycle operations*, *collaboration primitives*, and *runtime hooks*.
4. **A structural SOD theorem** (§8). A simple formal statement and proof sketch that segregation-of-duties conflicts declared in `DUTIES.md` are unbypassable by the agent itself under a stated assumption about the hosting platform.
5. **Compliance-by-construction** (§7). A mapping from FINRA, SEC, Federal Reserve, and CFPB controls onto the git substrate, and an enforcement mechanism (`pre_tool_use` hooks with `fail_open: false`) that places policy, not beside it, but *inside* the agent.

### 1.4 Paper organization

§2 places OpenGAP in a design lineage from the Unix philosophy through Infrastructure-as-Code and GitOps. §3 positions GAP against MCP, A2A, ADL, framework-native, and raw-YAML approaches. §4 specifies the protocol. §5 presents the adapter model and fidelity profile. §6 develops the pattern taxonomy. §7 develops the compliance story. §8 states and sketches the SOD theorem. §9 describes the reference implementation. §10 presents three case studies. §11 reports evaluation. §12 discusses limitations and governance. §13 sets future work. §14 concludes.

---

## 2. The Design Lineage: From Unix to GitOps to Agents

OpenGAP is not a novel idea in software engineering; it is the natural extension of a fifty-year arc. Understanding that arc helps explain why GAP is the shape it is and why its constraints are load-bearing rather than incidental.

**1970s — Unix and plain-text files.** The Unix philosophy treated everything as text: configuration, data, even kernel state. The insight was not philosophical but practical — text files could be read, diffed, grepped, piped, and version-controlled by tools that did not need to know what the text contained. Programs became small; pipelines became expressive.

**1980s — Makefile as declarative build.** `make` separated *what* to build from *how* to build it. A declarative target graph replaced ad-hoc scripts. The insight was that build intent was more durable than build implementation.

**2000s — Infrastructure as Code (Puppet, Chef, Ansible).** The data-center was brought under version control. Server configuration, previously a dashboard operation or a runbook, became a file. Convergent reconciliation replaced imperative deployment. The insight was that infrastructure *is* data, and if it is data, it should live where data is curated.

**2010s — Terraform and Kubernetes.** Infrastructure became *declarative* at multi-cloud scale. A Terraform plan is a pure function of state and configuration; a Kubernetes manifest is a desired state that a controller reconciles toward. The insight was that declarative beats imperative at scale because diffs are compositional.

**2017–present — GitOps.** The deployed state of production is whatever the latest commit on a specific branch says it is. Merge equals deploy. Rollback equals `git revert`. The insight was that the git commit graph, not a CI/CD dashboard, is the authoritative record of what is running.

**2024–present — Agents.** AI agents entered production with none of this discipline. An agent's identity lives in a Python class; its policy lives in a dashboard; its memory lives in a vector store; its version is "whatever commit someone deployed." The entire arc of software engineering toward declarative, version-controlled, reconciliation-friendly artifacts has, for agents, been bypassed.

**OpenGAP is the move of AI agents to their own GitOps moment.** The agent's identity becomes a file. The policy becomes a file. The memory becomes a directory of files with append-only semantics. The runtime becomes plural, and the artifact becomes the contract. Everything the regulated industries already know how to audit — commits, tags, diffs, branch protection, signed releases — now applies to the agent unchanged.

> **Design insight.** Every time a previously opaque part of the software stack has been expressed as files under version control, the operational properties of that stack have improved by an order of magnitude. AI agents are the most recent stack to undergo this move.

---

## 3. Related Work

Existing agent-related protocols and formats decompose into five categories, each of which standardizes a layer *other than* the one GAP occupies.

### 3.1 Interface protocols: MCP, A2A, ACP, AG-UI

**Model Context Protocol (MCP)** [1] is a JSON-RPC interface by which a model host invokes external tools and resources. It specifies the wire format of a tool call and the lifecycle of a session. It does *not* specify what the tools are, what the agent is, or what rules the agent obeys.

**Agent-to-Agent (A2A)** [2] is Google's protocol for peer agents to exchange task requests and results. It specifies discovery, handshake, and message envelopes. It does *not* specify what the two agents are internally or what controls govern them.

**ACP and AG-UI** cover the user-facing edge — streaming tokens, handling user input, rendering agent output. Again, the edge, not the interior.

The observation: these protocols standardize *edges*. An edge protocol presupposes an agent. Without a standardized agent, every vendor's MCP server, A2A client, or AG-UI renderer is parameterized by a different internal artifact, and portability claims at the edge protocol level do not compose into portability at the agent level.

**OpenGAP is complementary.** A GAP agent may expose MCP-compatible tools (`tools/*.yaml` with MCP schema annotations), declare A2A compatibility (`agent.yaml: a2a: [a2a-v1]`), and stream through AG-UI at runtime. GAP is the *interior*; MCP, A2A, AG-UI are the *edges*.

### 3.2 Agent Definition Languages (ADLs)

Several proposals define a single YAML or JSON file describing an agent's *capabilities* for discovery or marketplace purposes — an OpenAPI-for-agents. These artifacts are useful for registries: an agent can publish "I accept inputs X, produce outputs Y, obey policy Z." But they are not runnable, they have no place for skills, knowledge, memory, or hooks, and they are silent on version lineage.

GAP differs on two counts. First, the unit is a *directory*, not a file; a single-file schema cannot carry the multi-document nature of identity (`SOUL.md`), rules (`RULES.md`), duties (`DUTIES.md`), skills, knowledge bases, and regulatory artifacts without becoming unwieldy. Second, a GAP repository is directly **runnable and exportable**, not merely an advertisement. The two approaches compose: a GAP `agent.yaml` can embed an ADL-style capability block in its `tools:` or `capabilities:` section.

### 3.3 Framework-native definitions

LangChain, LangGraph, CrewAI, AutoGen, and similar frameworks define the agent as a programming-language object — a Python or TypeScript class with methods. This gives full expressivity, but the agent becomes inseparable from the framework. Three specific consequences:

- **Not portable.** A CrewAI agent is not a LangGraph agent is not an OpenAI-Agents-SDK agent. Each requires a rewrite.
- **Not auditable as a unit.** The agent's rules, identity, and policy are entangled with control flow. A compliance reviewer must read code rather than read a manifest.
- **Not semantically versioned.** `git diff` between two commits of a LangGraph agent shows line-level changes, not "v2.1.0 changed the supervisory policy from `review_above_cents: 10000` to `review_above_cents: 5000`."

GAP sits **above** frameworks: the canonical definition is the repository, and the framework-native implementation is a *derived artifact* produced by `opengap export`. Teams that already have framework-native agents can adopt GAP incrementally by using `opengap import --from <fmt>` to extract a canonical definition, then treating the framework-native version as a generated output.

### 3.4 Raw YAML/JSON configuration

Hand-rolled `config.yaml` is the most common shape in the wild. It offers flexibility but no community-standard schema, no validator, no skill ecosystem, and no regulatory mapping. Each team reinvents the schema; each framework reads it differently. The OpenGAP specification (§4) is what `config.yaml` would look like if teams agreed on one.

### 3.5 Summary

| Protocol / format      | Layer              | Unit               | Portable?             | Compliance story |
|------------------------|--------------------|--------------------|-----------------------|------------------|
| MCP [1]                | Tool call          | JSON-RPC endpoint  | n/a                   | out of scope     |
| A2A [2]                | Agent–agent        | Message format     | n/a                   | out of scope     |
| ACP / AG-UI            | Agent–user         | Event stream       | n/a                   | out of scope     |
| ADL-style              | Capability advert  | YAML/JSON file     | by adoption           | out of scope     |
| Framework-native       | Implementation     | Python/TS class    | no                    | ad-hoc           |
| Raw YAML               | Config             | File               | no                    | none             |
| **OpenGAP**           | **Definition**     | **Git repo**       | **yes (15 adapters)** | **first-class**  |

The table is not a competitive framing. It is a **division of labour**: OpenGAP does what existing protocols do not, and OpenGAP agents use existing protocols at their edges.

---

## 4. The OpenGAP Protocol
<a id="4-the-opengap-protocol"></a>

### 4.1 Design principles

OpenGAP is grounded in four principles. Each is load-bearing; removing any one degrades the protocol into one of the alternatives in §3.

- **P1 — Git-native.** Version control, branching, diffing, tagging, and PR review are the operations already available. The protocol's shape is chosen so that these operations map directly onto the semantic operations of the agent lifecycle.
- **P2 — Framework-agnostic.** The canonical definition does not presuppose a runtime. A deterministic export layer produces framework-native artifacts on demand.
- **P3 — Declarative over programmatic.** Behavior is described in structured files wherever practicable. Programmatic escape hatches exist (hook scripts, tool implementations), but the default is data.
- **P4 — Composable.** Agents can extend, depend on, and delegate to other agents, each itself a git repository pinned by version.

### 4.2 Formal definition

A GAP agent is a directed labeled tree of files. Formally, we define a **GAP agent** as a tuple

$$ M = (I, R, D, S, T, K, Me, H, A, C) $$

where each component is either a single file or a directory of files:

| Symbol | Component     | Required | Concrete artifact                                       |
|:------:|---------------|:--------:|---------------------------------------------------------|
| $I$    | Identity      |    ✓     | `SOUL.md`                                               |
| $M$    | Manifest      |    ✓     | `agent.yaml` (validated against JSON Schema)            |
| $R$    | Rules         |   opt    | `RULES.md`                                              |
| $D$    | Duties        |   opt    | `DUTIES.md`                                             |
| $S$    | Skills        |   opt    | `skills/*/SKILL.md` + `scripts/ references/ assets/`    |
| $T$    | Tools         |   opt    | `tools/*.yaml` (+ optional `*.py|.sh|.js`)              |
| $K$    | Knowledge     |   opt    | `knowledge/*` + `knowledge/index.yaml`                  |
| $Me$   | Memory        |   opt    | `memory/MEMORY.md` + `memory/runtime/` + `archive/`     |
| $H$    | Hooks         |   opt    | `hooks/hooks.yaml` + `hooks/scripts/`                   |
| $A$    | Sub-agents    |   opt    | `agents/<name>/` (recursively a GAP agent)              |
| $C$    | Compliance    |   opt    | `compliance/*`                                          |

Only $I$ and the manifest are strictly required. An agent consisting only of `SOUL.md` and `agent.yaml` is valid.

### 4.3 The directory layout

```
my-agent/
├── agent.yaml              # [REQUIRED] Manifest, validated against JSON Schema
├── SOUL.md                 # [REQUIRED] Identity, personality, voice
├── RULES.md                # Hard constraints — must-always and must-never
├── DUTIES.md               # Segregation of duties policy / role boundaries
├── AGENTS.md               # Framework-agnostic fallback instructions
├── README.md               # Human documentation
├── skills/                 # Reusable capability modules
│   └── code-review/{SKILL.md, scripts/, references/, assets/, examples/}
├── tools/                  # MCP-compatible tool schemas + implementations
├── knowledge/              # Reference documents (index.yaml + *.md|csv|pdf)
├── memory/                 # Persistent cross-session memory
│   ├── MEMORY.md           # ≤200 lines, always loaded
│   ├── runtime/            # Live state (dailylog.md, context.md)
│   └── archive/            # Historical snapshots
├── skillflows/             # Deterministic multi-step YAML procedures (DAGs)
├── hooks/                  # Lifecycle handlers (7 events) + scripts/
├── examples/               # Calibration interactions (few-shot)
├── agents/                 # Sub-agent definitions (recursive)
├── compliance/             # Regulatory artifacts (regulatory-map, risk-assessment, ...)
├── config/                 # Environment-specific overrides (default.yaml, prod.yaml)
└── .gitagent/              # Runtime state (gitignored)
```

### 4.4 The three normative files

Three files carry the agent's normative content. They are read in this order by every compliance reviewer and by every adapter that supports them.

- **`SOUL.md`** — the agent's identity: who it is, what it values, how it communicates, what it is not. Short, stable, declarative.
- **`RULES.md`** — the agent's hard constraints. Phrased as "must always" and "must never." RULES are tested by the `audit` command and referenced by enforcement hooks.
- **`DUTIES.md`** — the agent's role within a multi-agent topology. Declares which roles it may hold, which it is forbidden from holding, and which roles it cannot hold simultaneously. This file is what operationalizes segregation of duties (§8).

### 4.5 Capabilities

**Skills** ($S$) are reusable capability modules. Each skill is a directory with `SKILL.md` (Markdown + YAML frontmatter), optional `scripts/`, `references/`, `assets/`, and `examples/`. Skills are installable from a shared registry via `opengap skills install`; one skill can be shared across many agents.

**Tools** ($T$) are MCP-compatible schemas annotated with cost class (`none|low|medium|high`) and side-effect class. Implementations may be local (`tools/name.py`) or remote (URL).

**MCP servers** (`mcp_servers` in `agent.yaml`) declare external Model Context Protocol servers once and export them to each runtime's native config. Each entry is stdio-based (`command` + `args` + `env`) or HTTP-based (`url` + `headers`), with `${VAR}` interpolation for secrets. One declaration renders to `.mcp.json` (Claude Code), the `mcpServers` block (Codex), `.cursor/mcp.json` (Cursor), or a markdown section (crewai, copilot) — extending "define once, run anywhere" from behavior to infrastructure integrations.

**Knowledge** ($K$) is read-only reference material: Markdown, CSV, PDF, or any readable format, indexed by `knowledge/index.yaml`. Embeddings and retrieval indices are derived artifacts materialized in `.gitagent/cache/`.

**Memory** ($Me$) is append-only by convention. `MEMORY.md` (≤200 lines) is always loaded at session start; `runtime/` holds live state; `archive/` holds aged-out snapshots.

**Hooks** ($H$) register handlers for seven lifecycle events:

| Event                  | Fires when                                |
|------------------------|-------------------------------------------|
| `on_session_start`     | Session begins                            |
| `user_prompt_submit`   | User submits a prompt                     |
| `pre_tool_use`         | Immediately before a tool call            |
| `post_tool_use`        | Immediately after a tool call             |
| `on_error`             | An error occurs during execution          |
| `agent_spawn`          | A sub-agent is spawned                    |
| `on_session_end`       | Session terminates                        |

Each hook has a `fail_open` flag. `fail_open: true` means a hook failure is non-blocking (advisory); `fail_open: false` means a hook failure blocks the triggering operation (enforcement). The distinction is the single most important lever in the protocol for governance.

### 4.6 Composition

- **`extends:`** — inherits from a parent agent by git URL. Child files shadow parent files; unshadowed parent files are inherited verbatim.
- **`dependencies:`** — declares peer agents, shallow-cloned to mount paths at pinned versions.
- **`agents/<name>/`** — defines sub-agents, each itself a full GAP directory. Handoffs carry duty scope; a sub-agent cannot perform a duty its parent forbids.

### 4.7 The manifest

Appendix A excerpts `agent-yaml.schema.json`. The specification currently ships ten JSON schemas covering agent manifest, hooks, hook I/O, tools, skills, knowledge, memory, skillflows, configuration, and marketplace descriptors. Every `agent.yaml` in a GAP repository is validated against the manifest schema by `opengap validate`.

> **Key insight.** In GAP, every file has a purpose, every purpose has a file, and the tuple $(I, R, D, S, T, K, Me, H, A, C)$ enumerates the complete surface of what an agent is. Compliance review becomes a finite, structural exercise rather than an open-ended code audit.

---

## 5. Portability: The Adapter Model

### 5.1 Export-time versus runtime

A GAP agent can be consumed in two ways.

- **Export mode.** `opengap export --format <target>` renders the canonical definition into the target framework's native format as a directory or file. The output is deterministic — the same GAP directory yields the same output bytes — and is a reviewable artifact that the team may check into source control, attach to a PR, or hand to auditors.
- **Runtime mode.** `opengap run --adapter <target> -p "prompt"` performs the equivalent export into a temporary workspace and launches the target runtime over it, either one-shot or interactively.

Export produces an artifact; runtime produces a process. A team that wants reviewable outputs chooses export; a team that wants convenience chooses runtime. Either is GAP-compliant.

### 5.2 Fidelity as a function

Formally, an adapter is a function

$$ \mathsf{Adapter}_t : \mathsf{GAPAgent} \to \mathsf{TargetArtifact}_t $$

for each target $t$ in the adapter set. Not every adapter preserves every element of the GAP definition — some targets lack a notion of sub-agents, some cannot represent hooks, some accept only a single system-prompt blob. We define the **fidelity function** of an adapter over GAP elements $E = \{I, R, D, S, T, K, Me, H, A, C\}$ as

$$ f_t : E \to \{\mathsf{F}, \mathsf{P}, \bot\} $$

where **F** means fully preserved, **P** means partially preserved (text present, semantics lost), and $\bot$ means absent from the target artifact. A target's fidelity profile is the vector $f_t(E)$.

### 5.3 Adapter inventory

Fifteen targets currently ship:

| Adapter          | Export | Runtime | Dependency         | Target native format                      |
|------------------|:------:|:-------:|--------------------|-------------------------------------------|
| `claude-code`    |   ✓    |    ✓    | Claude Code CLI    | `CLAUDE.md` + `.claude/`                  |
| `cursor`         |   ✓    |    –    | Cursor IDE         | `.cursor/rules/*.mdc`                     |
| `codex`          |   ✓    |    –    | OpenAI Codex CLI   | `AGENTS.md` + config                      |
| `gemini`         |   ✓    |    ✓    | Gemini CLI         | `GEMINI.md` + `settings.json`             |
| `opencode`       |   ✓    |    ✓    | OpenCode CLI       | `AGENTS.md` + `opencode.json`             |
| `kiro`           |   ✓    |    –    | Kiro CLI           | `.kiro/agents/*.json`                     |
| `openai`         |   ✓    |    ✓    | OpenAI Agents SDK  | Python script                             |
| `crewai`         |   ✓    |    ✓    | CrewAI CLI         | YAML config                               |
| `lyzr`           |   ✓    |    ✓    | Lyzr Studio        | Lyzr agent definition                     |
| `openclaw`       |   ✓    |    ✓    | OpenClaw CLI       | Workspace layout                          |
| `nanobot`        |   ✓    |    ✓    | Nanobot CLI        | Nanobot config                            |
| `copilot`        |   ✓    |    –    | GitHub Copilot     | `.github/copilot-*`                       |
| `github`         |   ✓    |    ✓    | GitHub Models      | GitHub Actions workflow                   |
| `gitclaw`        |   ✓    |    ✓    | GitClaw            | GitClaw workspace                         |
| `system-prompt`  |   ✓    |    –    | any LLM            | Concatenated text                         |

### 5.4 Fidelity profile

The abbreviated fidelity matrix follows; the full matrix is in Appendix B.

| Adapter          | $I$ | $R$ | $D$ | $S$ | $T$ | $H$ | $Me$ | $A$ | $C$ |
|------------------|:---:|:---:|:---:|:---:|:---:|:---:|:----:|:---:|:---:|
| `claude-code`    |  F  |  F  |  F  |  F  |  F  |  F  |  F   |  F  |  F  |
| `cursor`         |  F  |  F  |  P  |  F  |  F  |  ⊥  |  ⊥   |  ⊥  |  P  |
| `opencode`       |  F  |  F  |  P  |  F  |  F  |  F  |  P   |  ⊥  |  F  |
| `gemini`         |  F  |  F  |  P  |  F  |  F  |  ⊥  |  P   |  ⊥  |  P  |
| `codex`          |  F  |  F  |  P  |  P  |  F  |  ⊥  |  ⊥   |  ⊥  |  P  |
| `kiro`           |  F  |  F  |  P  |  F  |  F  |  F  |  ⊥   |  ⊥  |  P  |
| `openai`         |  F  |  F  |  P  |  F  |  F  |  ⊥  |  ⊥   |  ⊥  |  ⊥  |
| `crewai`         |  F  |  F  |  P  |  F  |  F  |  ⊥  |  ⊥   |  F  |  ⊥  |
| `lyzr`           |  F  |  F  |  P  |  F  |  F  |  ⊥  |  P   |  ⊥  |  P  |
| `openclaw`       |  F  |  F  |  P  |  F  |  F  |  P  |  F   |  F  |  F  |
| `nanobot`        |  F  |  F  |  P  |  F  |  F  |  P  |  P   |  ⊥  |  ⊥  |
| `system-prompt`  |  F  |  F  |  P  |  P  |  ⊥  |  ⊥  |  ⊥   |  ⊥  |  ⊥  |

> **Key insight.** Complete bidirectional interop is *impossible* because target frameworks differ in expressive power. A serious portability claim must therefore be not "we preserve everything" but "we preserve exactly this set, and we document what is lost." OpenGAP chooses the latter.

---

## 6. Lifecycle Patterns

Defining agents git-natively produces a set of architectural patterns that have no clean analogue in framework-native or dashboard-configured agents. We identify **14 patterns** and show that they organize into **four meta-patterns**.

### 6.1 A pattern taxonomy

| Meta-pattern           | Patterns                                                                                             |
|------------------------|------------------------------------------------------------------------------------------------------|
| **Structural guarantees** | P1 Human-in-the-Loop · P3 Segregation of Duties · P10 Agent Diff & Audit Trail · P11 Tagged Releases |
| **Lifecycle operations**  | P2 Agent Versioning · P4 CI/CD for Agents · P5 Branch-Based Deployment · P12 Secret Management        |
| **Collaboration primitives** | P7 Shared Context & Skills · P8 Agent Forking & Remixing · P9 Knowledge Tree                       |
| **Runtime behaviors**    | P6 Live Agent Memory · P13 Lifecycle Hooks · P14 SkillsFlow                                          |

The claim is that **structural guarantees are load-bearing for regulated deployments**, **lifecycle operations are load-bearing for engineering discipline**, **collaboration primitives enable a skill ecosystem**, and **runtime behaviors allow determinism and observability at run time**. A GAP deployment typically uses all four kinds.

### 6.2 Structural guarantees

**P1 — Human-in-the-Loop via Branch + PR.** When an agent proposes a new skill, a new rule, or a change to its own memory, it opens a branch and a pull request. A human reviewer approves before merge. Reinforcement-learning-style updates become subject to code-review semantics: diffs, comments, blocking approvals, `git revert`. The *structural* property is that the agent's learning is review-gated by default.

**P3 — Segregation of Duties via Branch Protection.** `DUTIES.md` declares role boundaries; branch protection enforces that the agent cannot merge its own branch. This is a structural guarantee, not a policy assertion: no code path in the agent can bypass it. See §8 for the formal statement.

**P10 — Agent Diff & Audit Trail.** `git diff v2.1.0..v2.2.0` is a diff of the agent's identity, rules, duties, and capabilities. A compliance reviewer inspecting a change sees exactly what changed, not an approximate summary. Combined with signed tags, this gives regulated deployments a high-resolution record.

**P11 — Tagged Releases.** Tags are signed, optionally immutable, and semantic. `v2025-Q1-audit` is the canonical state as of the close of a quarter. Consumers pin to tags; rollback is `git checkout`.

### 6.3 Lifecycle operations

**P2 — Agent Versioning via Git Tags.** A runtime consumes `github.com/org/agent@v2.1.0`. The version is the deployment unit. Undo history is the commit graph. Rollback is not a database operation but a git operation.

**P4 — CI/CD for Agents.** `opengap validate --compliance` runs on every push via GitHub Actions. A failing manifest blocks merge. Agent quality is treated as code quality. Quarterly validation schedules can be enforced as CI gates.

**P5 — Branch-Based Deployment.** `dev`, `staging`, `main` correspond to environments. Promotion is merge. Environment-specific configuration lives in `config/<env>.yaml` and is selected at runtime.

**P12 — Secret Management via `.env`.** Secrets are never committed. The spec declares required variables in `agent.yaml: env_vars:`, and the reference implementation warns on missing variables before runtime.

### 6.4 Collaboration primitives

**P7 — Shared Context & Skills.** When multiple agents share a working directory, root-level `skills/`, `tools/`, and `knowledge/` are common across sub-agents in `agents/<name>/`. A natural monorepo pattern emerges without repository sprawl.

**P8 — Agent Forking & Remixing.** `extends: <git-url>` lets an agent fork a parent and shadow only the files it wishes to change. Open-source agents become a remix culture; vendor-specific overrides live in forks.

**P9 — Knowledge Tree.** `knowledge/index.yaml` describes a hierarchical document set with retrieval hints. Embeddings and indices are derived artifacts.

### 6.5 Runtime behaviors

**P6 — Live Agent Memory.** `memory/MEMORY.md` is 200-line cross-session memory; `memory/runtime/` holds live state. Memory writes are commits, preserving *what the agent knew and when*.

**P13 — Lifecycle Hooks.** The seven-event hook system is the programmability of the protocol. Hooks are first-class, versioned alongside the agent. Enforcement (§6.3, §7.3) lives here.

**P14 — SkillsFlow.** Deterministic multi-step workflows described in `skillflows/*.yaml` with explicit `depends_on` ordering and `${{...}}` variable substitution. Where a skill is probabilistic (LLM reasoning), a skillflow is deterministic (a DAG over skills). SkillsFlows are the GAP counterpart to LangGraph's `StateGraph`, with the critical difference that the flow is declarative data rather than imperative code.

### 6.6 Why the taxonomy matters

The taxonomy is not taxonomic decoration. It tells a deployment team what to prioritize.

- Regulated deployments require the **structural guarantees** meta-pattern in full. Every item in that row is a SHOULD in SR 11-7 and a MUST in FINRA 3110.
- Engineering-discipline deployments require the **lifecycle operations** meta-pattern. A team without CI/CD for agents will experience precisely the failure modes that teams without CI/CD for code experienced before 2010.
- Skill-ecosystem deployments require **collaboration primitives**.
- Any non-toy runtime requires **runtime behaviors**.

A deployment that skips an entire meta-pattern fails to claim one of the properties that justifies using GAP at all.

---

## 7. Enterprise and Regulatory

### 7.1 Compliance as a first-class spec element

Most agent frameworks treat compliance as a runtime wrapper: a governance service intercepts tool calls, a policy engine audits responses, an SRE team files retention policies manually. The agent itself is unaware of its regulatory context. This is brittle — swapping the runtime loses the controls — and opaque — a compliance reviewer cannot read the agent's definition and determine what regime applies.

OpenGAP inverts this. A `compliance:` block in `agent.yaml` carries the regulatory declaration, and a `compliance/` directory holds the supporting artifacts:

```yaml
compliance:
  framework: FINRA
  risk_tier: high              # SR 11-7 model-risk tier
  rules:
    - rule: "3110"             # FINRA supervision
      description: All outputs reviewed before client delivery
    - rule: "4511"             # FINRA books-and-records
      description: Immutable audit trail of all interactions
  communications:
    fair_balanced: true        # FINRA 2210
    no_misleading: true
  data_governance:
    pii_handling: redact       # Reg S-P
    retention_years: 7         # SEC 17a-4
  supervision:
    human_in_the_loop: always
  segregation_of_duties:
    roles:
      - id: analyst
        permissions: [draft, revise]
      - id: reviewer
        permissions: [review, approve, reject]
    conflicts:
      - [analyst, reviewer]
    enforcement: strict
```

### 7.2 Regulatory mapping

| Regulation             | Control                          | GAP field(s)                                                         |
|------------------------|----------------------------------|----------------------------------------------------------------------|
| FINRA 3110             | Supervision                      | `supervision.human_in_the_loop`, hook PR review                      |
| FINRA 3120             | Compliance testing               | `compliance/validation-schedule.yaml`                                |
| FINRA 4511             | Books and records                | `compliance.recordkeeping.retention_years`                           |
| FINRA 2210             | Communications                   | `communications.fair_balanced`                                       |
| Reg Notice 24-09       | GenAI/LLM application            | entire `compliance:` block                                           |
| SEC Reg BI             | Best interest                    | `RULES.md` best-interest constraints                                 |
| SEC Reg S-P            | Privacy / PII                    | `data_governance.pii_handling`                                       |
| SEC 17a-4              | Electronic records               | `retention_years: 7`, git history                                    |
| Federal Res. SR 11-7   | Model risk management            | `risk_tier`, `compliance/risk-assessment.md`                         |
| Federal Res. SR 23-4   | AI risk management               | `compliance/validation-schedule.yaml`                                |
| CFPB Circular 2022-03  | Adverse-action notices           | `RULES.md` explainability requirements                               |
| EU AI Act (Art. 9–15)  | High-risk systems                | `risk_tier: high`, `compliance/risk-assessment.md`                   |
| ISO/IEC 42001          | AI management systems            | `compliance/validation-schedule.yaml`, `audit-log.schema.json`       |

This is not a legal opinion; it is a *structural mapping* that auditors use to demonstrate control coverage.

### 7.3 Hook-based enforcement

Declaring a policy is not enforcing it. Enforcement happens at `pre_tool_use`:

```yaml
# hooks/hooks.yaml
pre_tool_use:
  - name: spending-cap
    script: hooks/scripts/check-spending.sh
    fail_open: false          # block on hook error — enforcement semantics
    timeout_seconds: 5
    applies_to: [payment.execute, wire.transfer, vendor.pay]
```

The registered pre-tool hook fires before any matching tool call, receives the tool name and arguments on `stdin`, and exits `0` to allow or non-zero to block. `fail_open: false` upgrades the hook from advisory to enforcement: hook error, timeout, and non-zero exit all block the call.

As of spec v0.4 the `compliance.financial_governance` block is a shipped, schema-validated feature for payment-capable agents — spending limits in absolute cents, an approval threshold, allowed/blocked categories, and a named `firewall` identifier (never an endpoint URL, keeping the spec vendor-neutral):

```yaml
compliance:
  risk_tier: high
  financial_governance:
    enabled: true
    firewall: valkurai          # named identifier, not an endpoint
    spending:
      max_per_transaction_cents: 5000     # $50.00 hard cap
      max_monthly_cents: 100000           # $1,000.00 cumulative
      currency: AUD                       # ISO 4217
      allowed_categories: [software, compute, api_services]
      blocked_categories: [gambling, crypto, unknown]
    approval:
      require_above_cents: 2000           # human approval above $20.00
      timeout_minutes: 60
      auto_deny_on_timeout: true
```

The block is declarative; enforcement is a `pre_tool_use` hook (`check-spending.sh`) that reads `financial_governance.spending.max_per_transaction_cents`, parses the pending payment from tool input, and blocks the call if the cap is exceeded. `opengap validate` warns when a `risk_tier: high` agent declares financial tools but no `financial_governance` block, and rejects a `firewall` value that looks like a URL. The hook lives in the agent repository under version control, reviewed in the same PR as the policy it enforces. This locality — *policy and enforcement in one diff* — is the property that runtime-only policy engines cannot provide. The cross-runtime payment **event schema** is deliberately deferred (§13) until two or more enforcement implementations exist.

### 7.4 Audit trail is `git log`

Every commit to the agent repository is an audit-eligible event. `git log` gives a timestamped, attributed, immutable sequence; `git blame` answers *who changed this rule, when, and why* in constant time. No separate audit store is required.

The mapping between regulated-industry controls and git workflows is structural rather than analogical:

| Regulated control              | Git equivalent                  | How it works                                                                 |
|--------------------------------|----------------------------------|------------------------------------------------------------------------------|
| Maker-checker approval         | Pull request merge               | Agent (maker) opens PR; human reviewer (checker) approves before merge       |
| Audit trail                    | `git log`                        | Every action is a commit — immutable, timestamped, attributable              |
| Segregation of duties          | Branch protection                | Agent cannot merge own branch; reviewer role enforced by branch rules         |
| Control documentation          | `RULES.md`                       | Agent's constraints are in version control, reviewed, auditable              |
| Point-in-time snapshot         | `git tag`                        | Signed-off state is a tag on main — `v2025-01-close`                         |
| Exception log                  | Exception commits + PR comments  | Unresolved items are committed as exceptions; resolution recorded on the PR  |
| Institutional knowledge        | `memory/MEMORY.md`               | Prior resolutions, patterns, context survive personnel changes               |

For a regulated deployment, an organization pins its agents to signed tags, writes review findings as PR comments, and archives the repository on retention-compliant storage. The compliance property is structural rather than bolted on. See [15] for a worked financial-close implementation.

### 7.5 Threat model

Honesty about limitations is more valuable than an enumeration of features. OpenGAP does **not** prevent:

1. **A runtime that ignores hooks.** If the target framework does not execute `pre_tool_use` hooks, enforcement silently degrades to advisory. The fidelity matrix (§5.4, Appendix B) makes this explicit per target.
2. **An adversary with commit rights.** Branch protection defeats accidents; signed commits and code-owner reviews mitigate insider risk but do not eliminate it.
3. **Prompt injection through knowledge.** Documents in `knowledge/` may carry payloads that override rules. Defenses (content filters, provenance checks) are out of scope for the spec.
4. **Model capability drift.** `human_in_the_loop: always` does not verify that the human reviewed the output; it only requires that the runtime offer a review gate.
5. **Extrinsic compliance obligations.** GAP maps structural controls onto git workflows. Jurisdiction-specific duties (MiCA, AI Act specifics, HIPAA, GDPR Article 22) require local legal review.

### 7.6 Cryptographic identity (RFC, optional)

The insider item above motivates an optional cryptographic-identity layer, accepted as an RFC (`spec/rfcs/identity.md`) in spec v0.4 and slated as an optional `identity` block on `agent.yaml`. It separates two concerns the literature conflates: **provenance** (this manifest at this commit was authored by the holder of key *X* — already solvable with signed tags or sigstore, no spec change needed) and **runtime delegation** (the running agent producing this output acts on behalf of parent agent *Y*, with scope *Z*, signed by *Y*'s key, not yet revoked — the genuine gap). The RFC binds a manifest to an Ed25519 public key, with an optional `passport_uri` pointing at a richer identity document for scoped delegation and revocation, and reserves `signatures.<scope>` for manifest signatures. Verification semantics live in the spec; enforcement (refuse-to-load, sandbox, log-and-continue) is left to the runtime. Fully optional — manifests without it are unchanged. This closes the inter-organization delegation case and the regulated-runtime check: *prove the agent that produced this output was the agent in the manifest, with authority not yet revoked.*

---

## 8. A Structural SOD Theorem

Segregation of duties is the most important guarantee a regulated deployment asks of an agent. We state it formally.

### 8.1 Setting

Let $M$ be a GAP agent deployed on a git hosting platform $P$ (GitHub, GitLab, Bitbucket). Let $D = \{(r_i, r_j) : r_i, r_j \in \text{roles}\}$ be the set of *conflicting role pairs* declared in `DUTIES.md`:

```yaml
segregation_of_duties:
  conflicts:
    - [analyst, reviewer]
    - [maker, checker]
```

Let $W$ be the set of all tool-call traces the agent produces during a deployment window.

### 8.2 Assumptions

- **(A1) Branch protection.** On $P$, merges into `main` require a PR with at least one approving review from a human in a disjoint role from the author.
- **(A2) No force-push.** The agent's identity on $P$ lacks force-push rights on `main`.
- **(A3) Role attribution.** Every tool call in $W$ is attributable to a role declared in `DUTIES.md`.

### 8.3 Theorem

> **Theorem (Structural SOD).** *Under assumptions A1–A3, no single identity acting as the agent can complete a workflow whose tool-call trace spans both elements of a conflicting pair $(r_i, r_j) \in D$ without the intervention of a distinct human identity.*

### 8.4 Proof sketch

Let $w \in W$ be a trace that contains tool calls attributable to both $r_i$ and $r_j$. By A3, each call is attributable. By A1, any state change that persists across sessions (merge into `main`) requires a human PR review from an identity distinct from the author. By A2, the agent cannot rewrite history to erase attributions. Therefore, for $w$ to complete with persisted effect, a human identity distinct from the agent's identity must have approved the transition between the two roles. The agent acting alone cannot satisfy this requirement; hence the conflict is unbypassable by the agent. $\square$

### 8.5 What the theorem does and does not claim

- **Does claim.** The agent cannot, by itself, commit an SOD violation that persists in the repository.
- **Does not claim.** (i) The theorem does not guarantee substantive review — a human who rubber-stamps every PR defeats the structural guarantee behaviorally. (ii) The theorem does not cover ephemeral actions that do not touch the repository (e.g., API calls with no recorded effect). (iii) The theorem assumes platform-level branch protection is configured and has not been disabled.

> **Key insight.** SOD in GAP is enforced *by the hosting platform*, not by the agent's own code. This is why it is structural: the agent cannot disable it from the inside.

---

## 9. Reference Implementation

The reference implementation is **`opengap`**, a TypeScript CLI published to npm as `@open-gitagent/opengap` (scoped, provenance-signed via GitHub Actions OIDC) at v0.4.0. The `gitagent` command is installed as a backward-compatibility alias for the same binary. The repository is [github.com/open-gitagent/opengap](https://github.com/open-gitagent/opengap); the license is MIT. (The project was originally named `gitagent`, briefly `gapman`; the unscoped root name `opengap` is unavailable on npm under its package-similarity policy, so the scoped name is canonical.)

### 9.1 Verb surface

| Verb        | Purpose                                                                          |
|-------------|----------------------------------------------------------------------------------|
| `init`      | Scaffold from templates (`minimal`, `standard`, `full`, `llm-wiki`)              |
| `validate`  | JSON-schema validation + optional compliance audit                               |
| `info`      | Summarize an agent (identity, capabilities, compliance)                          |
| `export`    | Render to a target framework (15 adapters)                                       |
| `import`    | Convert from Claude, Cursor, CrewAI, OpenCode, Gemini, or Codex format           |
| `install`   | Resolve git-based dependencies, shallow-cloning to mount paths                   |
| `audit`     | Produce a structured compliance report                                           |
| `skills`    | Search, install, list, inspect                                                   |
| `run`       | One-shot or interactive execution under an adapter                               |
| `registry`  | Browse the community registry                                                    |
| `lyzr`      | Lyzr Studio integration (create, update, run)                                    |

### 9.2 Architecture

Adapters and runners are separated. `src/adapters/` contains **deterministic renderers** — pure functions from a GAP directory to a target native artifact. `src/runners/` contains the code that **provisions a workspace, manages credentials, launches the target runtime**, and streams results back. Adapters are unit-testable; runners are integration-tested. This separation is what lets a team that has no interest in running the agent in a third-party environment still benefit from GAP: the export is a pure function.

### 9.3 Publication

The reference implementation is published on npm with provenance attestations signed by GitHub Actions OIDC. Every release is tied to a commit and a signed tag, meeting the supply-chain requirements of regulated deployments by default.

---

## 10. Case Studies

Case studies are where a protocol either earns its keep or is revealed as marketing. We present three.

### 10.1 NVIDIA Deep Researcher: SOD in a three-agent hierarchy

`examples/nvidia-deep-researcher/` is a three-agent hierarchy modeled on NVIDIA AIQ's deep-research workflow — an *orchestrator*, a *planner*, and a *researcher* sub-agent. The researcher has three skills: paper search, web search, knowledge retrieval.

The SOD policy is declared once, at the orchestrator level:

```yaml
# DUTIES.md (excerpt)
segregation_of_duties:
  conflicts:
    - [orchestrator, researcher]   # no single agent both plans and executes
  roles:
    orchestrator: [plan, delegate, summarize]
    planner:      [plan, critique]
    researcher:   [search, retrieve, cite]
```

Under the SOD theorem (§8), the orchestrator cannot perform research; the researcher cannot perform orchestration. The structural guarantee holds regardless of the runtime.

**What stays identical, what differs.** Exported to Claude Code, the hierarchy becomes a parent agent with two sub-agents, each with its own `.claude/agents/*` entry. Exported to CrewAI, the same hierarchy becomes three crew members with a task graph. Exported to OpenClaw, it becomes three workspaces. **Identity, duties, and skills are preserved unchanged across all three exports; only the native encoding differs.**

### 10.2 A full-compliance financial agent

`examples/full/` is a production-grade compliance agent. It includes:

- `compliance/regulatory-map.yaml` — 12 specific rules mapped to 12 controls
- `compliance/risk-assessment.md` — justification for `risk_tier: high` under SR 11-7
- `compliance/validation-schedule.yaml` — annual bias testing, quarterly parallel testing
- `hooks/pre_tool_use.sh` with `fail_open: false` — blocks tool calls that violate the spending cap

Every file is what a regulated team would produce. The diff between `v1.0.0` and `v1.1.0` is a coherent, reviewable PR — ~300 lines of Markdown, YAML, and shell that a compliance officer can read in ten minutes and sign off on.

### 10.3 The LLM Wiki: a cognitive pattern in the GAP shape

`examples/llm-wiki/` implements the knowledge-compile pattern described by Karpathy [14]:

- `knowledge/` holds raw source material (PDFs, web captures, transcripts)
- `memory/wiki/` holds compiled wiki pages with `[[wikilinks]]`
- Three skills cover the wiki lifecycle: `wiki-ingest`, `wiki-query`, `wiki-lint`
- `memory/log.md` is an append-only operation log

The provenance trail is complete: every ingestion produces a log entry, every query records the pages consulted, every compilation commits to the wiki with a diff. The pattern predated GAP and was implemented separately across multiple research teams; under GAP it fits without spec changes. This is evidence that GAP's shape is *general* — the protocol accommodates substantive cognitive patterns from outside its community.

---

## 11. Evaluation

Evaluation has three axes: adoption, fidelity, and qualitative comparison.

### 11.1 Adoption

As of May 2026, the reference repository `open-gitagent/opengap` has:

- **2,700+ GitHub stars**
- **15 export adapters + 11 runtime runners**; five adapters (Cursor, Kiro, Codex, Gemini, OpenCode) were contributed by pull request from *external authors* unaffiliated with the maintainer
- **Three spec features shipped from community RFCs/PRs** in v0.4: portable `mcp_servers`, the `financial_governance` block, and the accepted cryptographic-identity RFC
- **Provenance-signed** releases on npm as `@open-gitagent/opengap` v0.4.0 (the unscoped root `opengap` is blocked by npm's package-similarity policy, so the scoped name is canonical)
- **CI on Node 18 / 20 / 22** building and validating the bundled example agents on every push
- **Cross-community pollination**: GAP agents appear in registries that predate it (the Lyzr registry) and in new registries that postdate it (GitClaw, the OpenClaw ecosystem)

External adapter and spec contributions are the strongest signal that the protocol is perceived as a **neutral substrate**, not a vendor product. No single contributor has standing to force a breaking change in favor of their framework.

### 11.2 Export fidelity (empirical)

The fidelity matrix (§5.4, Appendix B) is generated mechanically by running `opengap export --format <target>` over `examples/standard/` and `examples/full/` and diffing the output for the presence of each GAP element. Two headline findings:

- **`claude-code` is the only adapter with full fidelity.** GAP and Claude Code were co-designed; the directory layout is nearly isomorphic. Other adapters vary.
- **Hooks and sub-agents are the most frequently dropped elements.** `cursor`, `gemini`, `codex`, `openai`, and `system-prompt` all drop hooks entirely. Hook-based enforcement is a GAP-native guarantee that degrades gracefully per-target; teams requiring enforcement should choose a target that preserves hooks or should rely on GAP-native runtime modes.

### 11.3 Qualitative comparison

| Capability                        | GAP           | MCP | A2A | ADL-style  | Framework-native |
|-----------------------------------|:-------------:|:---:|:---:|:----------:|:----------------:|
| Defines agent's identity          | ✓             | –   | –   | partial    | ✓                |
| Versioned via git tags            | ✓             | –   | –   | –          | partial          |
| Portable across frameworks        | ✓ (15)        | –   | –   | by adoption| –                |
| Compliance fields first-class     | ✓             | –   | –   | –          | –                |
| SOD structural guarantee          | ✓ (§8)        | –   | –   | –          | ad-hoc           |
| Enforcement hook layer            | ✓             | –   | –   | –          | ad-hoc           |
| Runnable from repo URL            | ✓             | –   | –   | –          | –                |
| Tool-call format                  | uses MCP      | ✓   | –   | –          | framework        |
| Agent-to-agent messaging          | uses A2A      | –   | ✓   | –          | framework        |

The contrast is strongest on compliance and portability and indistinguishable from status-quo on fundamental interface concerns (tool calls, streaming, messaging). This is by design: OpenGAP complements MCP/A2A rather than competing with them.

---

## 12. Discussion

### 12.1 Limitations

The specification is at v0.1.0. Several elements are deliberately under-formalized:

- **Memory archival policy.** MEMORY.md aging into `archive/` is by convention, not by schema.
- **Skill-registry trust model.** The registry currently treats all skill contributions as equally trustworthy; a signing-and-verification scheme is open work.
- **Multi-tenant hook interactions.** `config/<env>.yaml` and `hooks/` may interact in surprising ways in multi-tenant runtimes; formal semantics are future work.

A conformance test suite does not yet exist; adapters are validated by unit tests and community use. Formal SOD semantics (§8) are sketched; a machine-checkable version (TLA⁺ or Alloy) is future work.

### 12.2 Vendor-capture risk

An open protocol with a dominant reference implementation is one bug report away from becoming a de facto vendor standard. OpenGAP addresses this through three structural choices:

1. **Shared licensing and repository.** Specification and reference implementation ship in one MIT-licensed repository under a working-group charter — no silent re-licensing.
2. **Plural adapter authorship.** External contributions for Cursor, Kiro, Codex, Gemini, OpenCode, Copilot, and GitHub Models demonstrate plural interest. No target dictates changes.
3. **Named implementations are examples, not *the reference*.** Vendor implementations (including, notably, ours) are listed in documentation as examples; the *specification* never names a specific vendor as canonical. This is a lesson learned from SAML and several OAuth extensions, where a single vendor's implementation became the de facto standard and then fragmented as the vendor's needs diverged from the community's.

### 12.3 Why a protocol, not a framework

A framework solves problems for the framework's users. A protocol creates a substrate that multiple competing products can build on. OpenGAP chooses the protocol path. The reference implementation `opengap` is one of potentially many, and the specification has deliberate latitude so that vendors add value within their adapters without needing to modify the canonical definition.

### 12.4 Why git, not a new system

Git is imperfect. Its UX is unloved; its model of content-addressed history is surprising to newcomers; its security model depends on operational discipline. We chose it anyway because the thing a regulated deployment needs is not an *ideal* versioned substrate but an *operated* one. Git has been operated at scale, under audit, under regulatory supervision, for fifteen years. Every other option requires reinventing operational maturity.

---

## 13. Future Work

1. **Conformance test suite.** A portable, language-agnostic test suite that an adapter implementer can run to certify a fidelity claim. The single highest-leverage next artifact.
2. **Formal SOD verification.** Express `DUTIES.md` conflict rules as logical assertions and verify that an agent's tool-call trace satisfies them. TLA⁺ or Alloy is a natural fit; a more ambitious direction is synthesis — generate an agent's executable policy from its declarative `DUTIES.md`.
3. **Financial-governance Phase 2/3.** The declarative `financial_governance` block shipped in v0.4 (§6.3); Phase 2 is a reference `pre_tool_use` enforcement hook, and Phase 3 is a `payment_required` / `payment_approval` / `payment_receipt` event schema for cross-runtime interop. Phase 3 waits until two or more enforcement implementations exist; standardizing earlier risks codifying imaginary interop [16].
4. **Identity-layer implementation.** The cryptographic-identity RFC (§7.6) is accepted; next is the `identity` block in `agent-yaml.schema.json`, a reference verifier, and a delegation-chain example.
6. **A2A server adapter.** GAP currently declares A2A compatibility in `agent.yaml` but does not ship a reference A2A server. Closing this loop enables GAP agents to serve as first-class A2A peers.
7. **Empirical user study.** A controlled comparison of team velocity, change-review latency, and compliance-prep time when defining, porting, and auditing agents under GAP versus framework-native equivalents. This is the evaluation a full systems-venue submission would require.
8. **Cross-jurisdictional regulatory mappings.** Extend the mapping table (§7.2) to EU AI Act, UK FCA guidance, MAS Singapore, ISO 42001, and sectoral controls (HIPAA, HITRUST). The structural claims are jurisdiction-neutral, but the mapping is not.
9. **Knowledge provenance.** A spec extension for signed, cryptographically-verifiable provenance on documents in `knowledge/`, addressing the prompt-injection threat in §7.5.
10. **Agent-to-agent supply chain.** Transitively pinned `extends:` chains with signed provenance — `this agent extends A@v1.2.3 which extends B@v4.0.1, verified signatures, verified fidelity claims`.

---

## 14. Conclusion

The history of systems engineering is a series of moves from the opaque to the declarative. Configuration became Infrastructure as Code. Server provisioning became Terraform. Deployment became GitOps. Each move produced an order-of-magnitude improvement in the operational properties of the stack beneath it.

AI agents are the most recent stack to undergo this move. Until now, an agent's identity has lived in a Python class, its policy in a dashboard, its memory in a vector store, its version in a deployment record, and its compliance story in a PDF. **OpenGAP makes all of these into files under version control**, and makes a git repository the canonical unit of an agent.

The consequences compose. Portability becomes a property of the artifact rather than a promise of the runtime. Audit becomes a property of `git log` rather than a separate system. Segregation of duties becomes a structural guarantee of the hosting platform rather than a policy assertion. Compliance becomes a first-class spec element with a finite surface area a compliance officer can actually review.

The protocol is MIT-licensed, the reference implementation is community-maintained with 2,700+ stars and external contributions, and the full specification, patterns, adapters, and case studies ship together in one repository. Our invitation to the research community is to contribute conformance tests, formal verification, case studies, and critical review — and to the practitioner community, to adopt the protocol wherever an agent needs to be portable, auditable, or accountable. **The definition layer of AI agents belongs in git.** OpenGAP is our proposal for what that looks like.

### Acknowledgments

The OpenGAP working group thanks contributors to the reference implementation and to the Cursor, Kiro, Codex, Gemini, OpenCode, and Copilot adapters. Early design conversations with the MCP and A2A communities sharpened the scoping of OpenGAP as a complementary definition layer. Andrej Karpathy's LLM Wiki gist directly motivated the knowledge-compile pattern in `examples/llm-wiki/`. We thank the GitClose maintainers for a production-grade worked example of GAP in the monthly financial close. All remaining mistakes are our own.

---

## References

1. **Anthropic.** *Model Context Protocol: Specification.* 2024. <https://modelcontextprotocol.io/specification>
2. **Google.** *Agent-to-Agent (A2A) Protocol.* 2024. <https://github.com/google/A2A>
3. **A. Wright, H. Andrews, B. Hutton, G. Dennis.** *JSON Schema: A Media Type for Describing JSON Documents.* IETF Internet-Draft, 2020. <https://json-schema.org/draft/2020-12/json-schema-core>
4. **FINRA.** *Rule 3110 — Supervision.* 2014. <https://www.finra.org/rules-guidance/rulebooks/finra-rules/3110>
5. **FINRA.** *Rule 4511 — General Requirements (Books and Records).* 2011. <https://www.finra.org/rules-guidance/rulebooks/finra-rules/4511>
6. **FINRA.** *Rule 2210 — Communications with the Public.* 2013. <https://www.finra.org/rules-guidance/rulebooks/finra-rules/2210>
7. **FINRA.** *Regulatory Notice 24-09: FINRA Reminds Firms that FINRA Rules Apply to the Use of Generative AI and LLMs.* 2024. <https://www.finra.org/rules-guidance/notices/24-09>
8. **U.S. SEC.** *Rule 17a-4 — Electronic Storage and Records Retention.* 1997. <https://www.sec.gov/rules/final/34-38245.txt>
9. **U.S. SEC.** *Regulation Best Interest (Reg BI).* 2019. <https://www.sec.gov/regulation-best-interest>
10. **U.S. SEC.** *Regulation S-P — Privacy of Consumer Financial Information.* 2000. <https://www.sec.gov/rules/final/34-42974.htm>
11. **Board of Governors of the Federal Reserve System.** *SR 11-7: Guidance on Model Risk Management.* 2011. <https://www.federalreserve.gov/supervisionreg/srletters/sr1107.htm>
12. **Board of Governors of the Federal Reserve System.** *SR 23-4: Interagency Guidance on Third-Party Relationships.* 2023. <https://www.federalreserve.gov/supervisionreg/srletters/SR2304.htm>
13. **CFPB.** *Circular 2022-03: Adverse Action Notification Requirements in Connection with Credit Decisions Based on Complex Algorithms.* 2022. <https://www.consumerfinance.gov/compliance/circulars/circular-2022-03>
14. **A. Karpathy.** *LLM Wiki — a note on a pattern for LLM-managed knowledge bases.* GitHub Gist, 2025. <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>
15. **P. Priyam.** *GitClose: A git-native reference implementation of the monthly financial close using OpenGAP.* 2026. <https://github.com/Priyanshu-Priyam/gitclose>
16. **OpenGAP Working Group.** *RFC #38 — `compliance.financial_governance` block.* 2026. <https://github.com/open-gitagent/opengap/issues/38>
17. **OpenGAP Working Group.** *OpenGAP Specification v0.1.0.* 2026. <https://github.com/open-gitagent/opengap/blob/main/spec/SPECIFICATION.md>
18. **OpenGAP Working Group.** *opengap on npm.* 2026. <https://www.npmjs.com/package/@open-gitagent/opengap>
19. **L. Lamport.** *Specifying Systems: The TLA+ Language and Tools for Hardware and Software Engineers.* Addison-Wesley, 2002.
20. **D. Jackson.** *Software Abstractions: Logic, Language, and Analysis (Alloy).* MIT Press, 2012.
21. **Commission of the European Union.** *Regulation (EU) 2024/1689 (Artificial Intelligence Act).* 2024.
22. **ISO/IEC.** *ISO/IEC 42001:2023 — Artificial intelligence management systems.* 2023.

---

## Appendix A: `agent.yaml` Schema (Excerpt)

```json
{
  "$id": "https://gitagent.sh/spec/v0.1.0/agent-yaml.schema.json",
  "type": "object",
  "required": ["name", "version", "description"],
  "properties": {
    "spec_version":  { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "name":          { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
    "version":       { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+(?:[-+].+)?$" },
    "description":   { "type": "string" },
    "model": {
      "type": "object",
      "properties": {
        "preferred": { "type": "string" },
        "fallback":  { "type": "array", "items": { "type": "string" } },
        "constraints": {
          "type": "object",
          "properties": {
            "temperature": { "type": "number", "minimum": 0, "maximum": 2 },
            "max_tokens":  { "type": "integer", "minimum": 1 }
          }
        }
      }
    },
    "compliance": {
      "type": "object",
      "properties": {
        "framework":             { "type": "string" },
        "risk_tier":             { "enum": ["low", "medium", "high", "critical"] },
        "supervision":           { "type": "object" },
        "segregation_of_duties": { "type": "object" },
        "recordkeeping":         { "type": "object" }
      }
    },
    "dependencies": { "type": "array" },
    "extends":      { "type": "string" },
    "a2a":          { "type": "array", "items": { "type": "string" } }
  }
}
```

---

## Appendix B: Full Fidelity Matrix

| Adapter          | $I$ | $R$ | $D$ | $S$ | $T$ | $H$ | $Me$ | $A$ | $C$ |
|------------------|:---:|:---:|:---:|:---:|:---:|:---:|:----:|:---:|:---:|
| `claude-code`    |  F  |  F  |  F  |  F  |  F  |  F  |  F   |  F  |  F  |
| `cursor`         |  F  |  F  |  P  |  F  |  F  |  ⊥  |  ⊥   |  ⊥  |  P  |
| `codex`          |  F  |  F  |  P  |  P  |  F  |  ⊥  |  ⊥   |  ⊥  |  P  |
| `gemini`         |  F  |  F  |  P  |  F  |  F  |  ⊥  |  P   |  ⊥  |  P  |
| `opencode`       |  F  |  F  |  P  |  F  |  F  |  F  |  P   |  ⊥  |  F  |
| `kiro`           |  F  |  F  |  P  |  F  |  F  |  F  |  ⊥   |  ⊥  |  P  |
| `openai`         |  F  |  F  |  P  |  F  |  F  |  ⊥  |  ⊥   |  ⊥  |  ⊥  |
| `crewai`         |  F  |  F  |  P  |  F  |  F  |  ⊥  |  ⊥   |  F  |  ⊥  |
| `lyzr`           |  F  |  F  |  P  |  F  |  F  |  ⊥  |  P   |  ⊥  |  P  |
| `openclaw`       |  F  |  F  |  P  |  F  |  F  |  P  |  F   |  F  |  F  |
| `nanobot`        |  F  |  F  |  P  |  F  |  F  |  P  |  P   |  ⊥  |  ⊥  |
| `copilot`        |  F  |  F  |  P  |  P  |  P  |  ⊥  |  ⊥   |  ⊥  |  ⊥  |
| `github`         |  F  |  F  |  P  |  P  |  F  |  ⊥  |  ⊥   |  ⊥  |  P  |
| `gitclaw`        |  F  |  F  |  F  |  F  |  F  |  F  |  F   |  F  |  F  |
| `system-prompt`  |  F  |  F  |  P  |  P  |  ⊥  |  ⊥  |  ⊥   |  ⊥  |  ⊥  |

**Legend:** **F** = fully preserved · **P** = partially preserved (text present, semantics dropped) · **⊥** = not representable in the target format. Columns correspond to $I$=identity, $R$=rules, $D$=duties, $S$=skills, $T$=tools, $H$=hooks, $Me$=memory, $A$=sub-agents, $C$=compliance.

The CSV source is [`tables/fidelity-matrix.csv`](tables/fidelity-matrix.csv), regenerated by running `opengap export` against `examples/standard/` and `examples/full/` for each adapter.

---

## Appendix C: Formal Definitions

### C.1 GAP agent

A **GAP agent** $M$ is a tuple $(I, R, D, S, T, K, Me, H, A, C, m)$ where:

- $I$ is the content of `SOUL.md` (Markdown, required).
- $R$ is the content of `RULES.md` (Markdown, optional).
- $D$ is the content of `DUTIES.md` (Markdown + YAML frontmatter, optional).
- $S$ is a set of skill directories, each a tuple $(\text{name}, \text{SKILL.md}, \text{scripts}, \text{references}, \text{assets}, \text{examples})$.
- $T$ is a set of tool definitions, each a YAML schema with optional implementation.
- $K$ is a set of knowledge documents plus an index.
- $Me$ is a memory layout: `MEMORY.md` (≤200 lines) + `runtime/` + `archive/`.
- $H$ is a set of hook definitions, each with event, script, `fail_open`, timeout, and selectors.
- $A$ is a set of sub-agents, each itself a GAP agent (recursive).
- $C$ is a set of compliance artifacts.
- $m$ is the manifest (`agent.yaml`), validated against the JSON Schema.

### C.2 Fidelity

Let $E = \{I, R, D, S, T, K, Me, H, A, C\}$ be the set of GAP elements. For target $t$ with adapter $\mathsf{Adapter}_t$, the **fidelity function** $f_t : E \to \{F, P, \bot\}$ is defined per element:

- $f_t(e) = F$ iff $\mathsf{Adapter}_t(M)$ contains enough structured information to reconstruct $e$ up to semantics-preserving transformation.
- $f_t(e) = P$ iff $\mathsf{Adapter}_t(M)$ contains textual but not structural representation of $e$ (e.g., duties appended to a system prompt with no role schema).
- $f_t(e) = \bot$ iff $\mathsf{Adapter}_t(M)$ does not represent $e$.

A target's fidelity profile is the vector $f_t(E) \in \{F, P, \bot\}^{10}$.

### C.3 Conformance

A CLI or library is **GAP-conformant at level $k$** iff:

- **Level 0 (read):** it can parse any valid GAP directory without error.
- **Level 1 (validate):** it validates `agent.yaml` against the manifest schema and reports errors with file and line.
- **Level 2 (export):** for at least one target $t$, it produces an output artifact whose fidelity profile matches the specification's published profile for $t$.
- **Level 3 (run):** for at least one target $t$, it launches the target runtime in a way that honors $(R, D, H)$ when those elements are present.

The reference implementation `opengap` is Level 3-conformant on Claude Code, OpenCode, Gemini, CrewAI, OpenAI, Lyzr, OpenClaw, Nanobot, GitHub, and GitClaw.

---

*This paper is the canonical Markdown rendering of `open-gap.tex`. Both are maintained alongside the specification. License: MIT. For citation: see [`README.md`](README.md).*
