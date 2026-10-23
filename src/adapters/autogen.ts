import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { loadAgentManifest, loadFileIfExists, agentDirExists } from '../utils/loader.js';
import { exportToSystemPrompt } from './system-prompt.js';

type Manifest = ReturnType<typeof loadAgentManifest>;

interface ToolParam {
  name: string;
  pyType: string;
  description: string;
  required: boolean;
}

interface ToolSpec {
  /** Name the model sees (from the tool yaml). */
  name: string;
  /** Python identifier for the generated function. */
  fn: string;
  description: string;
  params: ToolParam[];
}

interface AutogenAgentEntry {
  /** Python identifier, also used as the AutoGen agent name. */
  name: string;
  description: string;
  systemMessage: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools: ToolSpec[];
}

const DEFAULT_MAX_TURNS = 20;

/**
 * Model-client factory embedded in every generated script. Ported from the
 * autogen-trial model_factory.py: an explicit "provider/model" prefix wins,
 * otherwise the model name decides the provider. Clients are imported lazily so
 * only the extra for the provider in use has to be installed.
 */
const PY_MODEL_CLIENT = String.raw`
UNKNOWN_MODEL_INFO = ModelInfo(
    vision=False, function_calling=True, json_output=True, structured_output=False, family="unknown"
)

# OpenAI-protocol providers: provider -> (base_url, api key env vars)
OPENAI_COMPATIBLE = {
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai/", ("GEMINI_API_KEY", "GOOGLE_API_KEY")),
    "llama": ("https://api.llama.com/compat/v1/", ("LLAMA_API_KEY",)),
}
PROVIDERS = ("openai", "azure", "anthropic", "ollama", *OPENAI_COMPATIBLE)

# (regex on model name, provider) - first match wins
RULES = [
    (r"^(gpt-|o\d|chatgpt-)", "openai"),
    (r"^claude-", "anthropic"),
    (r"^gemini-", "gemini"),
    (r"^llama-\d", "llama"),
    (r"^(llama|mistral|qwen|phi|gemma|deepseek)", "ollama"),
]


def resolve_provider(model):
    if not model:
        raise ValueError("No model configured: set model.preferred in agent.yaml or the LLM_MODEL env var.")
    for sep in ("/", ":"):
        provider, found, rest = model.partition(sep)
        if found and provider.lower() in PROVIDERS:
            return provider.lower(), rest
    for pattern, provider in RULES:
        if re.match(pattern, model, re.IGNORECASE):
            return provider, model
    raise ValueError(f"Can't infer a provider for model '{model}'. Use 'provider/model' with one of {list(PROVIDERS)}.")


def _flag(var):
    value = os.getenv(var)
    return None if value is None else value.strip().lower() in {"1", "true", "yes"}


def model_info_from_env():
    """ModelInfo from LLM_VISION / LLM_FUNCTION_CALLING / LLM_JSON_OUTPUT / LLM_STRUCTURED_OUTPUT / LLM_FAMILY."""
    names = ("LLM_VISION", "LLM_FUNCTION_CALLING", "LLM_JSON_OUTPUT", "LLM_STRUCTURED_OUTPUT", "LLM_FAMILY")
    if not any(os.getenv(n) for n in names):
        return None
    info = dict(UNKNOWN_MODEL_INFO)
    for key, var in (("vision", "LLM_VISION"), ("function_calling", "LLM_FUNCTION_CALLING"),
                     ("json_output", "LLM_JSON_OUTPUT"), ("structured_output", "LLM_STRUCTURED_OUTPUT")):
        value = _flag(var)
        if value is not None:
            info[key] = value
    info["family"] = os.getenv("LLM_FAMILY", info["family"])
    return ModelInfo(**info)


def make_client(model, temperature=None, max_tokens=None):
    """Build the AutoGen model client matching the model name."""
    provider, name = resolve_provider(model)
    sampling = {}
    if temperature is not None:
        sampling["temperature"] = temperature
    if max_tokens is not None:
        sampling["max_tokens"] = max_tokens
    info = model_info_from_env()

    if provider == "anthropic":
        from autogen_ext.models.anthropic import AnthropicChatCompletionClient  # autogen-ext[anthropic]
        return AnthropicChatCompletionClient(model=name, **sampling)

    if provider == "ollama":
        from autogen_ext.models.ollama import OllamaChatCompletionClient  # autogen-ext[ollama]
        options = {}
        if temperature is not None:
            options["temperature"] = temperature
        if max_tokens is not None:
            options["num_predict"] = max_tokens
        kw = {"options": options} if options else {}
        if info:
            kw["model_info"] = info
        return OllamaChatCompletionClient(model=name, **kw)

    from autogen_ext.models.openai import AzureOpenAIChatCompletionClient, OpenAIChatCompletionClient  # autogen-ext[openai]
    if provider == "azure":
        return AzureOpenAIChatCompletionClient(
            azure_deployment=name,
            model=os.getenv("AZURE_OPENAI_MODEL", name),
            api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-06-01"),
            azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
            api_key=os.environ["AZURE_OPENAI_API_KEY"],
            **({"model_info": info} if info else {}),
            **sampling,
        )
    if provider in OPENAI_COMPATIBLE:
        base_url, key_envs = OPENAI_COMPATIBLE[provider]
        api_key = next((os.environ[k] for k in key_envs if os.environ.get(k)), None)
        if not api_key:
            raise KeyError(f"Set {' or '.join(key_envs)} to use the '{provider}' provider.")
        return OpenAIChatCompletionClient(
            model=name, base_url=base_url, api_key=api_key, model_info=info or UNKNOWN_MODEL_INFO, **sampling
        )
    return OpenAIChatCompletionClient(model=name, **({"model_info": info} if info else {}), **sampling)
`;

/**
 * Standalone Python script for `opengap export -f autogen`. With no sub-agents
 * it is a single AssistantAgent; with sub-agents it is a SelectorGroupChat.
 */
export function exportToAutogen(dir: string): string {
  return exportToAutogenScript(dir);
}

/**
 * Generate a standalone Python script that builds and runs the agent with
 * AutoGen (autogen-agentchat >= 0.4).
 *
 * - No sub-agents: one AssistantAgent, streamed through Console.
 * - With sub-agents: the main agent becomes the team's coordinator and every
 *   entry under `agents:` in agent.yaml becomes an AssistantAgent. They run in
 *   a SelectorGroupChat, which has the model pick the next speaker; the run
 *   ends when the coordinator says TERMINATE or max_turns messages have been
 *   exchanged.
 *
 * The task is the `prompt` option, falling back to the agent description. The
 * script also accepts the task as command-line arguments.
 */
export function exportToAutogenScript(dir: string, options: { prompt?: string } = {}): string {
  const agentDir = resolve(dir);
  const manifest = loadAgentManifest(agentDir);
  const subEntries = buildAutogenSubAgentEntries(agentDir, manifest);
  const hasSubAgents = subEntries.length > 0;

  const mainName = pyIdent(manifest.name);
  const mainModel = manifest.model?.preferred;
  const main: AutogenAgentEntry = {
    name: mainName,
    description: hasSubAgents
      ? `Coordinator. ${manifest.description}`
      : manifest.description,
    systemMessage: buildMainSystemMessage(agentDir, manifest, subEntries),
    model: mainModel,
    temperature: manifest.model?.constraints?.temperature,
    maxTokens: manifest.model?.constraints?.max_tokens,
    tools: loadToolSpecs(agentDir, manifest),
  };

  const allAgents = [main, ...subEntries];
  const tools = uniqueTools(allAgents);
  const maxTurns = manifest.runtime?.max_turns ?? DEFAULT_MAX_TURNS;
  const task = options.prompt ?? manifest.description;

  const lines: string[] = [];

  lines.push('"""');
  lines.push(`AutoGen agent definition for ${manifest.name} v${manifest.version}`);
  lines.push('Generated by gitagent export');
  lines.push('');
  lines.push('Requires: pip install "autogen-agentchat>=0.4" "autogen-ext[openai,anthropic]"');
  lines.push('(use the autogen-ext extra for whichever provider the agent model needs: openai, anthropic, ollama, azure)');
  lines.push('"""\n');

  lines.push('import asyncio');
  lines.push('import os');
  lines.push('import re');
  lines.push('import sys');
  if (tools.some(t => t.params.some(p => !p.required))) lines.push('from typing import Any, Optional');
  else lines.push('from typing import Any');
  lines.push('');
  lines.push('from typing_extensions import Annotated');
  lines.push('from autogen_agentchat.agents import AssistantAgent');
  if (hasSubAgents) {
    lines.push('from autogen_agentchat.conditions import MaxMessageTermination, TextMentionTermination');
    lines.push('from autogen_agentchat.teams import SelectorGroupChat');
  }
  lines.push('from autogen_agentchat.ui import Console');
  lines.push('from autogen_core.models import ModelInfo');
  if (tools.length > 0) lines.push('from autogen_core.tools import FunctionTool');
  lines.push(PY_MODEL_CLIENT);

  lines.push(`DEFAULT_MODEL = ${mainModel ? pyStr(mainModel) : 'os.environ.get("LLM_MODEL")'}`);
  lines.push(`DEFAULT_TASK = ${pyStr(task)}\n`);

  for (const tool of tools) {
    lines.push(...renderTool(tool));
  }

  lines.push('async def main(task: str) -> None:');
  lines.push('    clients = []\n');
  lines.push('    def new_client(model=None, **kw):');
  lines.push('        client = make_client(model or DEFAULT_MODEL, **kw)');
  lines.push('        clients.append(client)');
  lines.push('        return client\n');
  lines.push('    try:');

  for (const agent of allAgents) {
    lines.push(...renderAgent(agent, hasSubAgents));
  }

  if (!hasSubAgents) {
    lines.push(`        await Console(agent_${main.name}.run_stream(task=task))`);
  } else {
    const participants = allAgents.map(a => `agent_${a.name}`).join(', ');
    lines.push('        team = SelectorGroupChat(');
    lines.push(`            [${participants}],`);
    lines.push(`            model_client=new_client(${pyArgs(main)}),`);
    lines.push(`            termination_condition=TextMentionTermination("TERMINATE") | MaxMessageTermination(${maxTurns}),`);
    lines.push(`            selector_prompt=${pyStr(buildSelectorPrompt(main.name))},`);
    lines.push('            allow_repeated_speaker=False,');
    lines.push('        )');
    lines.push('        await Console(team.run_stream(task=task))');
  }

  lines.push('    finally:');
  lines.push('        for client in clients:');
  lines.push('            await client.close()\n');

  lines.push('if __name__ == "__main__":');
  lines.push('    for stream in (sys.stdout, sys.stderr):');
  lines.push('        try:');
  lines.push('            stream.reconfigure(encoding="utf-8")');
  lines.push('        except (AttributeError, ValueError):');
  lines.push('            pass');
  lines.push('    asyncio.run(main(" ".join(sys.argv[1:]) or DEFAULT_TASK))\n');

  return lines.join('\n');
}

function buildMainSystemMessage(agentDir: string, manifest: Manifest, subs: AutogenAgentEntry[]): string {
  const base = exportToSystemPrompt(agentDir);
  if (subs.length === 0) return base;

  const team = subs.map(s => `- ${s.name}: ${s.description}`).join('\n');
  return `${base}

## Team Coordination
You are the main agent and own the user's request. These specialist agents are available to consult:
${team}

When part of the request falls within a specialist's described expertise, address that specialist by name and ask them directly, then wait for their reply instead of answering that part yourself. Handle everything else yourself. Use specialists' replies in your answer, and when the request is fully handled, give the final answer and end your message with the word TERMINATE.`;
}

function buildSelectorPrompt(coordinator: string): string {
  // Follows the SelectorGroupChat docs prompt; {roles}, {history} and {participants}
  // are filled in by AutoGen, so this must stay a plain (non-f) Python string.
  return `Select an agent to perform the next task.

{roles}

Current conversation context:
{history}

Read the above conversation, then select an agent from {participants} to speak next.
"${coordinator}" is the main agent: it owns the user's request, speaks first, and gives the final answer. The other agents are helpers it can consult.
- If the latest message asks or names a specific agent, select that agent.
- After a helper replies, select "${coordinator}" again so it can use the result.
- Otherwise, select the agent whose role best fits what is needed next. Default to "${coordinator}".
Only select one agent.`;
}

/**
 * One entry per sub-agent declared under `agents:` in agent.yaml. A sub-agent
 * is either a full agent (`agents/<name>/agent.yaml`, with its own SOUL/RULES,
 * skills, tools and model) or a lightweight one (the `description` from the
 * parent's `agents:` map plus an optional `agents/<name>/SOUL.md`) that
 * inherits the team's default model.
 */
function buildAutogenSubAgentEntries(agentDir: string, manifest: Manifest): AutogenAgentEntry[] {
  if (!manifest.agents) return [];

  const entries: AutogenAgentEntry[] = [];
  for (const [name, config] of Object.entries(manifest.agents)) {
    const subDir = join(agentDir, 'agents', name);

    if (agentDirExists(subDir)) {
      const subManifest = loadAgentManifest(subDir);
      entries.push({
        name: pyIdent(name),
        description: config.description ?? subManifest.description,
        systemMessage: exportToSystemPrompt(subDir),
        model: subManifest.model?.preferred,
        temperature: subManifest.model?.constraints?.temperature,
        maxTokens: subManifest.model?.constraints?.max_tokens,
        tools: loadToolSpecs(subDir, subManifest),
      });
    } else {
      const description = config.description ?? name;
      const soul = loadFileIfExists(join(subDir, 'SOUL.md'));
      entries.push({
        name: pyIdent(name),
        description,
        systemMessage: soul ? `${description}\n\n${soul}` : description,
        tools: [],
      });
    }
  }

  return entries;
}

/**
 * Tools declared for an agent: every `tools/*.yaml`, narrowed to the names
 * listed under `tools:` in agent.yaml when that list is present.
 */
function loadToolSpecs(agentDir: string, manifest: Manifest): ToolSpec[] {
  const toolsDir = join(agentDir, 'tools');
  if (!existsSync(toolsDir)) return [];

  const wanted = manifest.tools && manifest.tools.length > 0 ? new Set(manifest.tools) : null;
  const specs: ToolSpec[] = [];

  for (const file of readdirSync(toolsDir).filter(f => f.endsWith('.yaml')).sort()) {
    const config = yaml.load(readFileSync(join(toolsDir, file), 'utf-8')) as {
      name?: string;
      description?: string;
      input_schema?: {
        properties?: Record<string, { type?: string; description?: string; items?: { type?: string } }>;
        required?: string[];
      };
    } | undefined;
    if (!config) continue;

    const name = config.name ?? basename(file, '.yaml');
    if (wanted && !wanted.has(name) && !wanted.has(basename(file, '.yaml'))) continue;

    const required = new Set(config.input_schema?.required ?? []);
    const params: ToolParam[] = Object.entries(config.input_schema?.properties ?? {}).map(([pName, schema]) => ({
      name: pyIdent(pName),
      pyType: jsonSchemaToPython(schema),
      description: schema.description ?? pName,
      required: required.has(pName),
    }));
    // Python requires parameters without defaults to come first.
    params.sort((a, b) => Number(b.required) - Number(a.required));

    specs.push({
      name,
      fn: pyIdent(name),
      description: config.description ?? name,
      params,
    });
  }

  return specs;
}

function uniqueTools(agents: AutogenAgentEntry[]): ToolSpec[] {
  const byFn = new Map<string, ToolSpec>();
  for (const agent of agents) {
    for (const tool of agent.tools) {
      if (!byFn.has(tool.fn)) byFn.set(tool.fn, tool);
    }
  }
  return [...byFn.values()];
}

/**
 * A tool becomes an async function whose Annotated parameters carry the
 * descriptions, wrapped in a FunctionTool. AutoGen derives the JSON schema
 * from the signature. The body is a placeholder: tool yamls only describe the
 * interface.
 */
function renderTool(tool: ToolSpec): string[] {
  const lines: string[] = [];
  const params = tool.params.map(p => {
    const annotated = `Annotated[${p.required ? p.pyType : `Optional[${p.pyType}]`}, ${pyStr(p.description)}]`;
    return p.required ? `${p.name}: ${annotated}` : `${p.name}: ${annotated} = None`;
  });

  if (params.length <= 1) {
    lines.push(`async def ${tool.fn}(${params.join(', ')}) -> str:`);
  } else {
    lines.push(`async def ${tool.fn}(`);
    for (const p of params) lines.push(`    ${p},`);
    lines.push(') -> str:');
  }
  lines.push(`    ${pyStr(tool.description)}`);
  lines.push('    # TODO: Implement tool logic');
  lines.push(`    return ${pyStr(`Tool '${tool.name}' is not implemented in this generated script.`)}\n`);
  lines.push(`${tool.fn}_tool = FunctionTool(${tool.fn}, description=${pyStr(tool.description)}, name=${pyStr(tool.name)})\n`);
  return lines;
}

function renderAgent(agent: AutogenAgentEntry, inTeam: boolean): string[] {
  const lines: string[] = [];
  lines.push(`        agent_${agent.name} = AssistantAgent(`);
  lines.push(`            name=${pyStr(agent.name)},`);
  lines.push(`            model_client=new_client(${pyArgs(agent)}),`);
  lines.push(`            system_message=${pyStr(agent.systemMessage)},`);
  if (inTeam) lines.push(`            description=${pyStr(agent.description)},`);
  if (agent.tools.length > 0) {
    lines.push(`            tools=[${agent.tools.map(t => `${t.fn}_tool`).join(', ')}],`);
    // Without reflection the agent's reply is the raw tool result.
    lines.push('            reflect_on_tool_use=True,');
  }
  lines.push('        )\n');
  return lines;
}

function pyArgs(agent: Pick<AutogenAgentEntry, 'model' | 'temperature' | 'maxTokens'>): string {
  const args: string[] = [];
  if (agent.model) args.push(pyStr(agent.model));
  if (agent.temperature !== undefined) args.push(`temperature=${agent.temperature}`);
  if (agent.maxTokens !== undefined) args.push(`max_tokens=${agent.maxTokens}`);
  return args.join(', ');
}

function jsonSchemaToPython(schema: { type?: string; items?: { type?: string } }): string {
  switch (schema.type) {
    case 'string': return 'str';
    case 'integer': return 'int';
    case 'number': return 'float';
    case 'boolean': return 'bool';
    case 'array': return schema.items?.type ? `list[${jsonSchemaToPython(schema.items)}]` : 'list';
    case 'object': return 'dict[str, Any]';
    default: return 'str';
  }
}

/** AutoGen requires agent names to be valid Python identifiers. */
function pyIdent(value: string): string {
  const ident = value.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[0-9]/.test(ident) ? `_${ident}` : ident;
}

/** Triple-quoted Python string literal. */
function pyStr(value: string): string {
  // A trailing quote would merge with the closing delimiter, so escape it separately.
  const endsWithQuote = value.endsWith('"');
  const body = endsWithQuote ? value.slice(0, -1) : value;
  const escaped = body.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
  return `"""${escaped}${endsWithQuote ? '\\"' : ''}"""`;
}
