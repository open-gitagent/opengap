---
name: run-agent
description: "Configures and runs agents with different adapters including Claude, OpenAI, CrewAI, Lyzr, and GitHub Models. Supports local execution, remote git repos, and one-shot prompts. Use when the user wants to run an agent, switch LLM providers, configure adapter settings, or launch agents from git repositories."
license: MIT
metadata:
  author: gitagent
  version: "1.0.0"
  category: execution
---

# Run Agents

## When to Use
When a user wants to run an agent locally, from a git repo, or with a specific adapter/framework.

## Troubleshooting

If you see authentication errors:
- **Claude**: Ensure Claude Code is authenticated (`claude auth status`)
- **OpenAI**: Verify `OPENAI_API_KEY` is set and valid
- **GitHub**: Check `GITHUB_TOKEN` has correct permissions
- **Lyzr**: Confirm `LYZR_API_KEY` is active

## Basic Usage

```bash
# Run local agent with Claude (default)
opengap run -d ./my-agent

# Run from git repo
opengap run -r https://github.com/user/agent

# Run with a prompt (one-shot mode)
opengap run -d ./my-agent -p "Review my code"
```

## Adapters

| Adapter | Flag | Env Var Required | Interactive |
|---------|------|-----------------|-------------|
| Claude | `-a claude` | *(uses Claude Code auth)* | Yes |
| OpenAI | `-a openai` | `OPENAI_API_KEY` | No |
| CrewAI | `-a crewai` | — | No |
| OpenClaw | `-a openclaw` | `ANTHROPIC_API_KEY` | No (`-p` required) |
| Nanobot | `-a nanobot` | `ANTHROPIC_API_KEY` | Yes |
| Lyzr | `-a lyzr` | `LYZR_API_KEY` | No (`-p` required) |
| GitHub | `-a github` | `GITHUB_TOKEN` | No (`-p` required) |
| Git | `-a git` | *(auto-detects)* | Depends |
| Prompt | `-a prompt` | — | Print only |

## Examples

```bash
# Claude (interactive)
opengap run -d ./my-agent

# GitHub Models (one-shot, streaming)
export GITHUB_TOKEN="ghp_..."
opengap run -d ./my-agent -a github -p "Explain this codebase"

# Lyzr (creates agent on Lyzr Studio + chats)
export LYZR_API_KEY="..."
opengap run -r https://github.com/user/agent -a lyzr -p "Hello"

# Lyzr one-liner (clone + create + chat)
opengap lyzr run -r https://github.com/user/agent -p "Hello"

# Auto-detect adapter from repo
opengap run -r https://github.com/user/agent -a git -p "Hello"

# Just print the system prompt
opengap run -d ./my-agent -a prompt
```

## Git Caching

Repos cloned via `-r` are cached at `~/.gitagent/cache/`:
```bash
# Use cache (default)
opengap run -r https://github.com/user/agent

# Force refresh
opengap run -r https://github.com/user/agent --refresh

# No cache (temp dir, deleted after)
opengap run -r https://github.com/user/agent --no-cache
```

## Auto-Detection (`-a git`)

The git adapter detects the best runner from the repo:
1. `.gitagent_adapter` file (explicit hint)
2. Model name (claude-* → claude, gpt-* → openai)
3. Framework files (CLAUDE.md, .cursorrules, crew.yaml, .lyzr_agent_id, .github_models)
4. Default: claude
