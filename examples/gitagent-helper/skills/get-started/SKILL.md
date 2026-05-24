---
name: get-started
description: "Guides installation of gitagent and creation of first agent with scaffolding, configuration, and validation. Use when the user is new to gitagent, asks how to get started, wants to install gitagent, set up their first agent, or says 'how do I start?'"
license: MIT
metadata:
  author: gitagent
  version: "1.0.0"
  category: onboarding
---

# Get Started with gitagent

## When to Use
When a user is new to gitagent, wants to set up their first agent, or asks "how do I start?"

## Instructions

### Installation
```bash
npm install -g @open-gitagent/opengap
opengap --version
```

### Create Your First Agent
Walk the user through these steps:

1. **Scaffold** — Pick a template:
   ```bash
   # Minimal (2 files)
   opengap init --template minimal --dir ./my-agent

   # Standard (with skills, tools, knowledge)
   opengap init --template standard --dir ./my-agent

   # Full (compliance, hooks, memory, workflows)
   opengap init --template full --dir ./my-agent
   ```

2. **Edit** — Customize `agent.yaml` (name, description, model) and `SOUL.md` (identity, personality)

3. **Validate** — Check your work:
   ```bash
   opengap validate -d ./my-agent
   ```

4. **Run** — Launch with Claude:
   ```bash
   opengap run -d ./my-agent
   ```

5. **Share** — Push to git and anyone can run it:
   ```bash
   cd my-agent && git init && git add . && git commit -m "Initial agent"
   # Push to GitHub, then:
   opengap run -r https://github.com/you/my-agent
   ```

### Minimum Required Files
- `agent.yaml` — name, version, description (required)
- `SOUL.md` — agent identity (required)
- Everything else is optional
