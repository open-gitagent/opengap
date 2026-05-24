---
name: export-agent
description: "Converts agent definitions between frameworks — exports to Claude Code, OpenAI, CrewAI, Lyzr, and GitHub Models formats, and imports from Claude, Cursor, and CrewAI projects. Use when the user wants to convert an agent, migrate to another framework, export to LangChain/AutoGen/CrewAI, or import from existing automation tools."
license: MIT
metadata:
  author: gitagent
  version: "1.0.0"
  category: interop
---

# Export & Import Agents

## Verify Export

After exporting, check the output matches expectations:

```bash
# Verify export file was created and contains agent name
opengap export -f system-prompt -d ./my-agent | head -5
```

## Export

Convert a gitagent definition to another framework:

```bash
opengap export -f <format> -d ./my-agent [-o output-file]
```

### Formats

| Format | Output | Use Case |
|--------|--------|----------|
| `system-prompt` | Markdown | Universal — paste into any LLM |
| `claude-code` | CLAUDE.md | Drop into a Claude Code project |
| `openai` | Python | Run with OpenAI Agents SDK |
| `crewai` | YAML | Run with CrewAI |
| `openclaw` | JSON + MD | Run with OpenClaw |
| `nanobot` | JSON + MD | Run with Nanobot |
| `lyzr` | JSON | Create agent on Lyzr Studio |
| `github` | JSON | Call GitHub Models API |

### Examples

```bash
# Get a system prompt for any LLM
opengap export -f system-prompt -d ./my-agent

# Generate a CLAUDE.md
opengap export -f claude-code -d ./my-agent -o CLAUDE.md

# Generate Python code for OpenAI
opengap export -f openai -d ./my-agent -o agent.py

# Preview what Lyzr API will receive
opengap export -f lyzr -d ./my-agent

# Preview GitHub Models payload
opengap export -f github -d ./my-agent
```

## Import

Convert existing agent frameworks into gitagent:

```bash
opengap import --from <format> <path> [-d target-dir]
```

### Sources

| Source | Input | What It Creates |
|--------|-------|-----------------|
| `claude` | CLAUDE.md, .claude/skills/ | agent.yaml, SOUL.md, RULES.md, skills |
| `cursor` | .cursorrules | agent.yaml, SOUL.md, AGENTS.md |
| `crewai` | crew.yaml | agent.yaml, SOUL.md, agents/ |

### Examples

```bash
# Import a Claude Code project
opengap import --from claude ./my-project

# Import from Cursor
opengap import --from cursor ./.cursorrules

# Import CrewAI config
opengap import --from crewai ./crew.yaml -d ./imported
```
