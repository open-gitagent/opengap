# gitagent-helper

The official gitagent assistant — an AI agent that helps you build, run, and manage AI agents with gitagent.

## Try It

```bash
# Run directly from GitHub
opengap run -r https://github.com/anthropics/gitagent-helper

# Or with a prompt
opengap run -r https://github.com/anthropics/gitagent-helper -p "How do I create my first agent?"
```

## What It Can Do

- **Get started** — Install gitagent, scaffold your first agent, validate and run it
- **Create agents** — Write agent.yaml, SOUL.md, RULES.md, add skills, tools, and knowledge
- **Run agents** — Use any adapter (Claude, OpenAI, Lyzr, GitHub Models, etc.)
- **Export & import** — Convert between gitagent and other frameworks
- **Manage skills** — Search, install, create, and organize skills

## Skills

| Skill | Description |
|-------|-------------|
| `get-started` | Installation and first-agent walkthrough |
| `create-agent` | agent.yaml schema, SOUL.md writing, directory structure |
| `run-agent` | All adapters, flags, caching, auto-detection |
| `export-agent` | Export formats, import sources, conversion |
| `manage-skills` | Search, install, create, discover skills |

## Run Locally

```bash
git clone https://github.com/anthropics/gitagent-helper
opengap run -d ./gitagent-helper
```

## Structure

```
gitagent-helper/
├── agent.yaml
├── SOUL.md
├── RULES.md
├── skills/
│   ├── get-started/
│   ├── create-agent/
│   ├── run-agent/
│   ├── export-agent/
│   └── manage-skills/
└── knowledge/
    ├── index.yaml
    └── command-reference.md
```
