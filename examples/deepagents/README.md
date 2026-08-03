# DeepAgents example

A research agent with a fact-checker sub-agent, demonstrating the DeepAgents adapter:

- `agent.yaml` — manifest (model, skills, tools, sub-agent declaration)
- `SOUL.md` — agent identity, embedded in the generated `system_prompt`
- `skills/web-research/`, `skills/summarize/` — passed via a `skills=` path resolved next to the generated module (`Path(__file__).parent / "skills"`), so discovery works from any working directory; DeepAgents loads each `SKILL.md` natively
- `tools/web-search.yaml` — emitted as a `@tool` function bound into `tools=[...]`
- `agents/fact-checker/` — emitted as a `SubAgent` dict in `subagents=[...]`. By default a sub-agent inherits the full parent `TOOLS` list; add a `tools:` list to the sub-agent's own `agent.yaml` to narrow it to a subset.
- `expected_output.py` — the Python module the adapter produces

DeepAgents is a filesystem-shaped harness — there is no graph wiring. The
agent directory maps straight onto `create_deep_agent(...)`, and the model
decides at runtime when to plan, when to delegate to sub-agents, and when to
call tools. Nothing here needs a step graph, which is why this is the only
LangChain-family adapter opengap ships.

## Regenerate

```bash
opengap export --dir examples/deepagents --format deepagents --output examples/deepagents/expected_output.py
```

## Run the generated agent

```bash
pip install deepagents langchain-anthropic
python examples/deepagents/expected_output.py
```

Or let gitagent generate and run it for you (pass an initial message with `-p`, read from `GITAGENT_PROMPT`):

```bash
opengap run --dir examples/deepagents --adapter deepagents -p "Who won the 2022 World Cup?"
```

The generated file leaves tool implementations as `NotImplementedError` stubs — replace them with your own logic before invoking.
