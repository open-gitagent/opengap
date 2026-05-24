# gitagent Command Reference

## Commands

| Command | Description |
|---------|-------------|
| `opengap init` | Scaffold a new agent repo (`-t minimal\|standard\|full`) |
| `opengap validate` | Validate agent.yaml and structure (`-c` for compliance) |
| `opengap info` | Show agent summary |
| `opengap export` | Export to other formats (`-f system-prompt\|claude-code\|openai\|crewai\|openclaw\|nanobot\|lyzr\|github`) |
| `opengap import` | Import from other frameworks (`--from claude\|cursor\|crewai`) |
| `opengap install` | Resolve git dependencies |
| `opengap audit` | Generate compliance audit report |
| `opengap skills search` | Search skill registries |
| `opengap skills install` | Install a skill |
| `opengap skills list` | List discovered skills |
| `opengap skills info` | Inspect a skill |
| `opengap run` | Run agent with an adapter (`-a claude\|openai\|crewai\|openclaw\|nanobot\|lyzr\|github\|git\|prompt`) |
| `opengap lyzr create` | Create agent on Lyzr Studio |
| `opengap lyzr update` | Push changes to Lyzr |
| `opengap lyzr info` | Show linked Lyzr agent ID |
| `opengap lyzr run` | Clone + create + chat on Lyzr in one command |

## Common Flags

| Flag | Commands | Description |
|------|----------|-------------|
| `-d, --dir <dir>` | All | Agent directory (default: `.`) |
| `-r, --repo <url>` | run, lyzr run | Git repository URL |
| `-a, --adapter <name>` | run | Adapter selection |
| `-p, --prompt <msg>` | run, lyzr run | Initial prompt |
| `-b, --branch <branch>` | run, lyzr run | Git branch (default: `main`) |
| `--refresh` | run, lyzr run | Force re-clone |
| `--no-cache` | run | Clone to temp dir |
| `-f, --format <fmt>` | export | Export format |
| `-o, --output <path>` | export | Output file |
| `-t, --template <name>` | init | Template type |
| `-c, --compliance` | validate | Enable compliance checks |
| `--api-key <key>` | lyzr * | Lyzr API key override |

## Environment Variables

| Variable | Adapters |
|----------|----------|
| `ANTHROPIC_API_KEY` | claude, openclaw, nanobot |
| `OPENAI_API_KEY` | openai |
| `LYZR_API_KEY` | lyzr |
| `GITHUB_TOKEN` / `GH_TOKEN` | github |

## Required Files

- `agent.yaml` — Always required
- `SOUL.md` — Always required
- Everything else is optional

## Directory Cheat Sheet

```
agent.yaml       → Identity, model, skills, tools, compliance
SOUL.md          → Personality, values, expertise
RULES.md         → Hard constraints, boundaries
PROMPT.md        → Default task framing
skills/          → Reusable capability modules
tools/           → MCP-compatible tool schemas
knowledge/       → Reference documents
memory/          → Cross-session memory
hooks/           → Lifecycle event handlers
agents/          → Sub-agent definitions
compliance/      → Regulatory artifacts
config/          → Environment overrides
workflows/       → Multi-step procedures
```
