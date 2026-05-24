# gitagent vs. Alternatives: A Comparison

> How does gitagent differ from other approaches to defining, versioning, and running AI agents?

This document compares gitagent against three common alternatives developers reach for when they need to deploy a reusable AI agent: the **Agent Definition Language (ADL)** (and similar emerging formats), **raw YAML/JSON config files**, and **no-standard / framework-native definitions** (inline code).

---

## TL;DR

| Dimension | gitagent | ADL / Emerging Formats | Raw YAML/JSON | Framework-Native (inline code) |
|-----------|----------|----------------------|---------------|-------------------------------|
| **Where does the agent live?** | Git repository = the agent | Separate spec file, usually checked into a repo | Config file(s) checked into a repo | Python/TypeScript class, checked into a repo |
| **Portable across frameworks?** | ✅ Yes — `export` to 9+ targets | ⚠️ Depends on adoption | ❌ No — framework-specific parsers | ❌ No — tied to one framework |
| **Runnable from repo URL?** | ✅ `opengap run -r github.com/org/agent` | ❌ No | ❌ No | ❌ No |
| **Version-controlled identity** | ✅ Git tags = agent versions | ⚠️ Optional | ⚠️ Manual | ⚠️ Git blame only |
| **Compliance / audit built-in** | ✅ Yes — FINRA, SEC, CFPB, SR 11-7 fields | ❌ No | ❌ No | ❌ No |
| **Multi-agent topology** | ✅ Native `agents:` block + SOD | ❌ No standard | ❌ No | ⚠️ Framework-specific |
| **Skills / reusable capabilities** | ✅ `skills/` directory, installable via `npx skills add` | ❌ No | ❌ No | ❌ No |
| **Human-in-the-loop model** | ✅ Branch + PR = agent learning | ❌ No | ❌ No | ❌ No |

---

## 1. gitagent vs. ADL (Agent Definition Language)

ADL and similar emerging formats (e.g., proposals in the A2A / MCP ecosystem) define a structured schema for describing agent capabilities, inputs, and outputs — typically as a single JSON or YAML file.

### How they differ

**gitagent** treats the entire *repository* as the agent. It is not a single file — it is a directory standard where `agent.yaml` anchors identity but `SOUL.md`, `RULES.md`, `skills/`, `knowledge/`, `hooks/`, and `memory/` collectively form the agent’s complete definition. The repository is the unit of deployment.

**ADL** (and similar specs) describe an agent’s *interface* — what it can do, what inputs it accepts, what outputs it produces. It is closer to an OpenAPI spec for agents than a deployable agent.

### When to use which

- **gitagent**: You want a deployable, runnable agent that can be cloned, versioned with git tags, exported to multiple frameworks, and audited for compliance. The agent has rich behavioral context (skills, knowledge, memory, compliance rules) not just a capability schema.
- **ADL/Interface Specs**: You are building an agent registry or marketplace where agents advertise capabilities for discovery — not for direct execution. ADL describes what the agent *is*; gitagent describes how the agent *behaves and runs*.

### Can they coexist?

Yes. A gitagent repository can include an ADL-formatted capability manifest in `agent.yaml` under the `tools` or `capabilities` block. They are not mutually exclusive.

---

## 2. gitagent vs. Raw YAML/JSON

Many teams define agents with hand-rolled YAML files that are parsed by custom code — a `config.yaml` with system prompt, model, temperature, tool list, etc.

### How they differ

**Raw YAML/JSON** gives you full flexibility but zero standardization. Every team invents their own schema, every framework reads it differently, and there is no tooling layer.

**gitagent** gives you a *community standard* schema with:
- A validated `agent.yaml` spec (run `opengap validate` to check conformance)
- A CLI layer (`opengap export`, `opengap run`, `opengap audit`) that acts on the standard
- Installable skills from a shared ecosystem (`npx skills add`)
- A compliance block that maps to real regulatory frameworks (FINRA 3110/4511, SEC 17a-4, SR 11-7, CFPB) — not invented fields

### When to use which

- **gitagent**: Team of 2+ people, agents that need to be portable, regulated industries (finance, healthcare, legal), agents that will evolve over time.
- **Raw YAML/JSON**: Solo prototype, one-off experiment, framework-specific config that will never leave one codebase.

### The migration path

Raw YAML → gitagent is straightforward:
```bash
opengap init -t minimal  # scaffold the standard layout
# copy your system prompt → SOUL.md
# copy your rules → RULES.md
# move your config fields into agent.yaml
opengap validate         # check conformance
```

---

## 3. gitagent vs. Framework-Native (Inline Code)

LangChain agents, CrewAI agents, AutoGen agents, etc. are all defined as Python or TypeScript classes — the agent’s identity, prompt, tools, and memory are wired together in code.

### How they differ

**Framework-native code** is the most powerful approach — full programming language expressivity, tight integration with the framework’s ecosystem. But it is:
- **Not portable** — a CrewAI agent cannot be trivially run with OpenAI Agents SDK
- **Not auditable** as a unit — you need to read through code to understand what the agent will do
- **Not versioned semantically** — git history gives you line-level diffs, not “agent v2.1.0 changed the compliance policy”

**gitagent** sits *above* frameworks. You define the agent once in the standard format, then export to the framework of your choice:

```bash
opengap export -f crewai    # → YAML config for CrewAI
opengap export -f openai    # → Python script for OpenAI Agents SDK
opengap export -f langchain # → Python script for LangChain
opengap export -f langgraph # → Python StateGraph for LangGraph
opengap export -f claude-code  # → CLAUDE.md for Claude Code
```

The framework-native implementation becomes a *derived artifact* of the canonical gitagent definition, not the source of truth.

### When to use which

- **gitagent**: Multi-framework deployment, compliance requirements, team collaboration, long-lived agents that need version history.
- **Framework-native**: Deep framework integration, performance-critical code paths, prototype that will stay within one framework indefinitely.

### The hybrid pattern

Many teams combine both: gitagent defines the agent’s identity, compliance, and skills; framework-native code handles tool implementations, memory backends, and custom orchestration. The `opengap export` output is a starting point, not a locked output.

---

## 4. The Compliance Dimension

This is where gitagent has no direct equivalent.

gitagent’s `agent.yaml` compliance block maps directly to financial regulatory requirements:

```yaml
compliance:
  framework: FINRA
  rules:
    - rule: "3110"        # Supervision
      description: All agent outputs must be reviewed before client delivery
    - rule: "4511"        # Books and records
      description: All interactions logged to immutable audit trail
  communications:
    fair_balanced: true   # FINRA 2210
    no_misleading: true
  data_governance:
    pii_handling: redact
    retention_years: 7    # SEC 17a-4
  supervision:
    human_in_the_loop: always
  segregation_of_duties:
    conflicts:
      - [maker, checker]  # No agent may both make and check its own work
```

Running `opengap audit` against this produces a structured compliance report. No other agent definition format offers this.

For teams building agents in regulated industries — financial services, healthcare (HIPAA), or any environment governed by SEC/FINRA/CFPB/MiCA rules — gitagent’s compliance model is the primary differentiator.

---

## Summary

gitagent is not a competitor to LangChain, CrewAI, or framework-native code — it is a layer *above* them that provides:

1. **A portable identity** — the repository *is* the agent, exportable to any framework
2. **Semantic versioning** — git tags map to agent versions; changes are auditable
3. **A compliance model** — maps to real regulatory frameworks, not invented abstractions
4. **A shared skills ecosystem** — reusable capabilities installable across agents

If you are building a one-off prototype, raw code or YAML is fine. If you are building agents that will run in production, evolve over time, or need to satisfy audit requirements — gitagent provides the structural discipline to do it right.

---

*Contributions welcome. Open an issue or PR if you see gaps, inaccuracies, or additional frameworks worth comparing.*
