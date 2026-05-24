# NVIDIA Deep Researcher — GitAgent PoC

This is a working proof of concept that defines NVIDIA's [AIQ Deep Researcher](https://github.com/NVIDIA-AI-Blueprints/aiq) agent in the gitagent standard. It demonstrates how GitAgent enhances a production multi-agent system with portability, versioning, compliance, and git-native lifecycle management.

## What This Is

NVIDIA's Deep Researcher is a 3-agent hierarchy that produces comprehensive research reports:

- **Orchestrator** — coordinates workflow, writes final 3000-5000 word report
- **Planner** — builds TOC, generates search queries, writes structured plan
- **Researcher** — executes searches (max 8 calls), writes cited findings

This gitagent definition faithfully translates the NVIDIA Jinja2 prompts (`orchestrator.j2`, `planner.j2`, `researcher.j2`) into the gitagent standard format (`SOUL.md`, `RULES.md`, `DUTIES.md`, `agent.yaml`).

## What GitAgent Adds

| Capability | Without GitAgent | With GitAgent |
|---|---|---|
| **Portability** | Locked to LangChain runtime | Export to Claude Code, OpenAI, CrewAI, system-prompt |
| **Prompt versioning** | Prompts in Jinja2 templates | Every SOUL.md change is a git commit; bisect regressions |
| **SOD enforcement** | Implicit in code | Explicit roles, conflicts, and handoffs validated in CI |
| **Fork & customize** | Modify Python code | Fork for legal/medical/finance variants without touching code |
| **Memory** | No persistence across sessions | Version-controlled research session history |
| **CI/CD** | Manual testing | `opengap validate --compliance` on every push |
| **Audit trail** | None | Every prompt, skill, and rule change traced via git |

## Quick Start

### Validate

```bash
cd examples/nvidia-deep-researcher
opengap validate --compliance
```

### Export

```bash
# System prompt (for any LLM)
opengap export --format system-prompt

# Claude Code (generates CLAUDE.md)
opengap export --format claude-code
```

### Info

```bash
opengap info
```

## Structure

```
nvidia-deep-researcher/
├── agent.yaml              # Agent manifest (models, skills, tools, SOD)
├── SOUL.md                 # Orchestrator identity and 8-step workflow
├── RULES.md                # Hard constraints (citations, report format, limits)
├── AGENTS.md               # Multi-agent architecture overview
├── DUTIES.md               # Segregation of duties policy
├── agents/
│   ├── planner/            # Plan generation sub-agent
│   └── researcher/         # Search execution sub-agent
├── skills/
│   ├── web-search/         # Tavily web search skill
│   ├── paper-search/       # Google Scholar skill
│   └── knowledge-retrieval/# RAG knowledge base skill
├── tools/
│   ├── tavily-web-search.yaml
│   ├── paper-search.yaml
│   └── knowledge-retrieval.yaml
├── knowledge/              # Document ingestion index
├── memory/                 # Research session persistence
├── hooks/                  # Bootstrap and teardown hooks
└── config/                 # Environment configurations
```

## Fork & Customize

To create a domain-specific variant (e.g., legal research):

```bash
cp -r examples/nvidia-deep-researcher my-legal-researcher
cd my-legal-researcher

# Edit SOUL.md to add legal domain expertise
# Edit RULES.md to add legal citation requirements
# Add legal knowledge docs to knowledge/
# Update agent.yaml with domain-specific metadata

opengap validate --compliance
```

No Python code changes needed — just edit the markdown and YAML files.

## Upstream

This PoC is based on the NVIDIA AIQ Deep Researcher Blueprint:
- **Repository**: https://github.com/NVIDIA-AI-Blueprints/aiq
- **Source path**: `src/aiq_agent/agents/deep_researcher`
- **Prompts**: `prompts/orchestrator.j2`, `prompts/planner.j2`, `prompts/researcher.j2`
