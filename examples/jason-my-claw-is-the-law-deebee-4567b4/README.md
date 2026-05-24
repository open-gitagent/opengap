# Jason — My Claw IS the Law — DeeBee #4567b4

![DeeBee #4567b4](https://img.shields.io/badge/DeeBee-%234567b4-4567b4)

An autonomous CEO-mode AI agent built on [OpenClaw](https://openclaw.dev), running under the **ClawLaw** operating system.

**Mission:** Grow the ARC Angels Advance Reader Community for the Genie Wars series.

## What Makes This Different

Most agent setups drift: scope expands, context bloats, models hallucinate system state, sessions die. Jason runs under two hard disciplines that prevent this:

### 1. Atomic Work Packet

Every task that produces a side effect is decomposed into one locked, reviewable unit before execution. Scope is immutable after approval. Expansion requires a new packet.

No side effect runs before `review_status = APPROVED`. No task is marked done before real exec output is logged.

### 2. Compute Ladder

Models are selected by **provider health**, not task complexity. Local model (RTX 3090) handles most tasks. Fast free cloud (Groq) is tier 1. Paid models are break-glass for auditing only.

Fallbacks activate on 429 or timeout — never because a task "seems complex."

## Stack

| Component | Detail |
|-----------|--------|
| Platform | OpenClaw (self-hosted) |
| Primary model | `ollama/qwen3-coder:latest` (local, RTX 3090, 128 TPS) |
| Tier-1 cloud | Groq — `llama-3.3-70b-versatile` |
| Audit model | `claude-opus-4.6` (break-glass only) |
| Search | Exa API (exec wrapper) |
| Comms | Slack (OpenClaw plugin) + Gmail (gog CLI) |
| Memory | File-based, daily notes + MEMORY.md |

## gitagent Structure

```
jason-my-claw-is-the-law-deebee-4567b4/
├── agent.yaml                          # Manifest with ClawLaw config
├── SOUL.md                             # Voice, decision rules, budget limits
├── RULES.md                            # ClawLaw hard rules
├── skills/
│   ├── packet-factory/SKILL.md         # Atomic work packet gatekeeper
│   ├── compute-ladder/SKILL.md         # Model tier selection
│   └── narco-check/SKILL.md            # Memory integrity audit
├── workflows/
│   └── clawlaw-architecture.md         # Full architecture + implementation checklist
└── knowledge/
    └── clawlaw-test-harness.md         # 42-test validation suite
```

## Quick Start

```bash
# Install gitagent
npm install -g @open-gitagent/opengap

# Clone this agent
opengap clone open-gitagent/gitagent examples/jason-my-claw-is-the-law-deebee-4567b4 my-jason

# Review the rules before running
cat my-jason/RULES.md
```

## ClawLaw Test Harness

42 tests across 10 groups validating every ClawLaw rule. Run after any architecture change:

```bash
bash skills/packet-factory/test-clawlaw.sh
# Expected: 40 PASS | 0 FAIL | 2 SKIP (sites pending deploy)
```

---

Built by [@bengii](https://github.com/bengii). Part of the [open-gitagent](https://github.com/open-gitagent) collection.
