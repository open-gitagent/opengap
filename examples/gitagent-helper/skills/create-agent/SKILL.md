---
name: create-agent
description: "Creates and configures agent.yaml files, writes SOUL.md personality definitions, and sets up agent directory structures with skills, tools, and knowledge. Use when the user wants to configure an agent, create agent.yaml, write SOUL.md, set up agent directory structure, or customize agent settings."
license: MIT
metadata:
  author: gitagent
  version: "1.0.0"
  category: authoring
---

# Create & Configure Agents

## Quick Start

1. Create directory structure: `mkdir -p my-agent/skills`
2. Write `agent.yaml` with required fields (see below)
3. Create `SOUL.md` with agent identity
4. Add skills, tools, and knowledge as needed
5. Validate: `opengap validate -d ./my-agent`

## agent.yaml Reference

### Required Fields
```yaml
spec_version: "0.1.0"
name: my-agent          # Unique identifier
version: 1.0.0          # Semantic version
description: What this agent does
```

### Model Configuration
```yaml
model:
  preferred: claude-sonnet-4-5-20250929
  fallback:
    - claude-haiku-4-5-20251001
  constraints:
    temperature: 0.2     # 0.0 - 1.0
    max_tokens: 4096
    top_p: 0.9
```

### Skills & Tools
```yaml
skills:
  - code-review          # Must match directory name in skills/
  - security-audit

tools:
  - lint-check           # Must match filename in tools/ (without .yaml)
```

### Runtime
```yaml
runtime:
  max_turns: 20          # Max conversation turns
  timeout: 120           # Seconds
```

### Sub-Agents
```yaml
agents:
  reviewer:
    description: Reviews code quality
    delegation:
      mode: auto
      triggers:
        - "review this"
```

## Writing a Good SOUL.md

A SOUL.md should have these sections:
- **Core Identity** — Who is this agent? One clear sentence.
- **Communication Style** — How does it talk? (direct, friendly, formal, etc.)
- **Values & Principles** — What does it prioritize?
- **Domain Expertise** — What does it know?
- **Collaboration Style** — How does it work with the user?

## Writing RULES.md

Structure as:
- **Must Always** — Non-negotiable behaviors
- **Must Never** — Hard boundaries
- **Output Constraints** — Formatting rules
- **Interaction Boundaries** — Scope limits

## Adding Skills

Create `skills/<name>/SKILL.md`:
```markdown
---
name: my-skill
description: What this skill does
license: MIT
allowed-tools: Read Edit Grep
metadata:
  version: "1.0.0"
---

# Instructions
[Detailed instructions for using this skill]
```

## Adding Tools

Create `tools/<name>.yaml`:
```yaml
name: my-tool
description: What this tool does
input_schema:
  type: object
  properties:
    query:
      type: string
      description: Search query
  required:
    - query
```

## Adding Knowledge

Create `knowledge/index.yaml`:
```yaml
documents:
  - path: reference.md
    always_load: true    # Include in system prompt
  - path: appendix.md
    always_load: false   # Available on demand
```
