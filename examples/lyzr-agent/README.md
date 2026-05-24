# Lyzr Research Agent

A gitagent example designed to run on [Lyzr Studio](https://studio.lyzr.ai).

## Quick Start

```bash
# Create the agent on Lyzr
opengap lyzr create -d ./examples/lyzr-agent

# Chat with it
opengap lyzr run -d ./examples/lyzr-agent -p "Summarize the latest trends in AI agents"

# Or do it all in one command from a git repo
opengap lyzr run -r https://github.com/youruser/lyzr-research-agent -p "What is RAG?"
```

## Prerequisites

Set your Lyzr API key:

```bash
export LYZR_API_KEY="your-key-here"
```

Get your API key from [Lyzr Studio](https://studio.lyzr.ai).

## Commands

| Command | Description |
|---------|-------------|
| `opengap lyzr create -d .` | Create the agent on Lyzr Studio |
| `opengap lyzr update -d .` | Push local changes to Lyzr |
| `opengap lyzr info -d .` | Show the linked Lyzr agent ID |
| `opengap lyzr run -d . -p "..."` | Chat with the agent |
| `opengap export -d . -f lyzr` | Preview the Lyzr API payload |

## How It Works

1. `agent.yaml` defines the model (GPT-4.1), skills, and runtime config
2. `SOUL.md` defines the agent's identity and communication style
3. `RULES.md` sets behavioral constraints
4. `PROMPT.md` frames the default task and output format
5. `skills/research/SKILL.md` provides structured research instructions
6. `.gitagent_adapter` tells the git runner to use Lyzr automatically

When you run `opengap lyzr create`, all of these files are combined into a single Lyzr API payload and sent to Lyzr Studio. The returned agent ID is saved to `.lyzr_agent_id` for subsequent runs.
