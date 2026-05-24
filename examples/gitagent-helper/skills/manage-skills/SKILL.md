---
name: manage-skills
description: "Searches the SkillsMP registry, installs skills locally or globally, creates custom skills with SKILL.md frontmatter, and manages the skill lifecycle. Use when the user wants to find skills, add new capabilities, install a skill, browse available skills, create a custom skill, or manage the skills system."
license: MIT
metadata:
  author: gitagent
  version: "1.0.0"
  category: skills
---

# Manage Skills

## When to Use
When a user wants to find skills, install them, create new ones, or understand the skills system.

## Verify Installation

After installing a skill, confirm it's available:

```bash
opengap skills list -d ./my-agent | grep "code-review"
```

## Search Skills

```bash
# Search SkillsMP registry
opengap skills search "code review"

# Search GitHub
opengap skills search "pdf reader" --provider github

# Limit results
opengap skills search "testing" --limit 5
```

## Install Skills

```bash
# Install from SkillsMP to agent-local skills/
opengap skills install code-review -d ./my-agent

# Install globally to ~/.agents/skills/
opengap skills install code-review --global

# Install from GitHub
opengap skills install owner/repo#skills/my-skill --provider github
```

## List Skills

```bash
# Show all discovered skills (local + global)
opengap skills list -d ./my-agent

# Only agent-local skills
opengap skills list -d ./my-agent --local
```

## Inspect a Skill

```bash
opengap skills info code-review -d ./my-agent
```

Shows: name, description, license, allowed tools, metadata, optional directories.

## Create a Skill

1. Create directory: `skills/<name>/`
2. Create `SKILL.md` with frontmatter:

```markdown
---
name: my-skill
description: What this skill does (max 1024 chars)
license: MIT
allowed-tools: Read Edit Grep Glob Bash
metadata:
  author: your-name
  version: "1.0.0"
  category: developer-tools
---

# Instructions

[Detailed instructions for using this skill.
Keep under ~5000 tokens / ~20000 characters.]
```

3. Reference it in `agent.yaml`:
```yaml
skills:
  - my-skill
```

4. Validate:
```bash
opengap validate -d ./my-agent
```

## Skill Discovery Paths

Skills are found in this order (first match wins):

| Priority | Path |
|----------|------|
| 1 | `<agent>/skills/` |
| 2 | `<agent>/.agents/skills/` |
| 3 | `<agent>/.claude/skills/` |
| 4 | `<agent>/.github/skills/` |
| 5 | `~/.agents/skills/` |

## Optional Directories in Skills

- `scripts/` — Executable scripts the skill can reference
- `references/` — Reference documents
- `assets/` — Images, static files
- `agents/` — Skill-specific sub-agents
