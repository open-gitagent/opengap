import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { loadAgentManifest, loadFileIfExists, type AgentManifest } from '../utils/loader.js';
import { loadAllSkills, type ParsedSkill } from '../utils/skill-loader.js';
import { buildComplianceSection } from './shared.js';
import { warn } from '../utils/format.js';

/**
 * Export a gitagent to a DeepAgents (LangChain) Python module.
 *
 * The whole agent is one `create_deep_agent(...)` call. There is no graph
 * wiring — execution flow (planning, sub-agent delegation, tool use) is decided
 * by the model at runtime, so the agent directory maps across directly.
 *
 * Mapping:
 *   agent.yaml (model.preferred)              → model="..."
 *   SOUL.md + RULES.md + DUTIES.md + compliance → system_prompt="..."
 *   skills/                                   → skills=["./skills"] (DeepAgents loads SKILL.md natively)
 *   tools/*.yaml                              → @tool defs in tools=[...]
 *   hooks/hooks.yaml (pre_tool_use)           → wrapper that runs hook scripts before each tool call
 *   agents/<name>/                            → subagents=[{ name, description, system_prompt, ... }]
 *
 * Reference: https://docs.langchain.com/oss/python/deepagents/overview
 */
export interface DeepAgentsExport {
  /** Generated Python source for the DeepAgents application. */
  code: string;
}

interface ToolDef {
  name: string;
  description: string;
  params: Array<{ name: string; pyType: string }>;
}

interface SubAgentDef {
  name: string;
  description: string;
  systemPrompt: string;
  hasSkills: boolean;
  /**
   * Tool names to expose to this sub-agent. An array (including an empty one)
   * means `tools:` was declared and narrows the set; null means it was absent,
   * so the sub-agent inherits the full parent TOOLS list.
   */
  toolNames: string[] | null;
}

export function exportToDeepAgents(dir: string): DeepAgentsExport {
  const agentDir = resolve(dir);
  const manifest = loadAgentManifest(agentDir);

  const systemPrompt = buildSystemPrompt(agentDir, manifest);
  const skills = loadAllSkills(join(agentDir, 'skills'));
  const tools = collectTools(agentDir);
  const preToolUseScripts = collectPreToolUseHooks(agentDir);
  const subAgents = collectSubAgents(agentDir, tools);

  const code = renderPython({
    manifest,
    systemPrompt,
    skills,
    tools,
    preToolUseScripts,
    subAgents,
  });

  return { code };
}

export function exportToDeepAgentsString(dir: string): string {
  return exportToDeepAgents(dir).code;
}

// System prompt assembly
function buildSystemPrompt(agentDir: string, manifest: AgentManifest): string {
  const parts: string[] = [];

  parts.push(`# ${manifest.name}`);
  parts.push(manifest.description);
  parts.push('');

  const soul = loadFileIfExists(join(agentDir, 'SOUL.md'));
  if (soul) { parts.push(soul.trim()); parts.push(''); }

  const rules = loadFileIfExists(join(agentDir, 'RULES.md'));
  if (rules) { parts.push(rules.trim()); parts.push(''); }

  const duties = loadFileIfExists(join(agentDir, 'DUTIES.md'));
  if (duties) { parts.push(duties.trim()); parts.push(''); }

  if (manifest.compliance) {
    const compliance = buildComplianceSection(manifest.compliance);
    if (compliance) { parts.push(compliance); parts.push(''); }
  }

  return parts.join('\n').trimEnd() + '\n';
}

// Tool / hook / sub-agent discovery

function collectTools(agentDir: string): ToolDef[] {
  const toolsDir = join(agentDir, 'tools');
  if (!existsSync(toolsDir)) return [];

  const out: ToolDef[] = [];
  const files = readdirSync(toolsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  for (const file of files) {
    try {
      const cfg = yaml.load(readFileSync(join(toolsDir, file), 'utf-8')) as {
        name?: string;
        description?: string;
        input_schema?: {
          properties?: Record<string, { type?: string }>;
        };
      };
      if (!cfg?.name) continue;
      const props = cfg.input_schema?.properties ?? {};
      const params = Object.entries(props).map(([name, schema]) => ({
        name,
        pyType: jsonTypeToPython(schema?.type),
      }));
      out.push({ name: cfg.name, description: cfg.description ?? '', params });
    } catch {
      // skip malformed tool
    }
  }
  return out;
}

function collectPreToolUseHooks(agentDir: string): string[] {
  const hooksPath = join(agentDir, 'hooks', 'hooks.yaml');
  if (!existsSync(hooksPath)) return [];
  try {
    const cfg = yaml.load(readFileSync(hooksPath, 'utf-8')) as {
      hooks?: Record<string, Array<{ script?: string }>>;
    };
    return (cfg?.hooks?.pre_tool_use ?? [])
      .map(h => h.script ?? '')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function collectSubAgents(agentDir: string, tools: ToolDef[]): SubAgentDef[] {
  const agentsDir = join(agentDir, 'agents');
  if (!existsSync(agentsDir)) return [];

  const knownToolNames = new Set(tools.map(t => t.name));
  const out: SubAgentDef[] = [];
  const entries = readdirSync(agentsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subDir = join(agentsDir, entry.name);
    if (!existsSync(join(subDir, 'agent.yaml'))) continue;

    try {
      const subManifest = loadAgentManifest(subDir);
      out.push({
        name: subManifest.name,
        description: subManifest.description,
        systemPrompt: buildSystemPrompt(subDir, subManifest),
        hasSkills: existsSync(join(subDir, 'skills')),
        toolNames: resolveSubAgentTools(entry.name, subManifest, knownToolNames),
      });
    } catch {
      // skip sub-agents that fail to load
    }
  }
  return out;
}

/**
 * Decide which of the parent's tools a sub-agent receives.
 *
 * The *presence* of `tools:` in the sub-agent's agent.yaml is the signal, not
 * how many names survive filtering — otherwise a list of nothing but typos
 * would silently fall back to the full parent toolset, handing the sub-agent
 * more tools than the author asked for. Unknown names are dropped with a
 * warning, and an explicit `tools: []` narrows to no tools at all.
 *
 * Returns null only when `tools:` is absent, meaning "inherit the full TOOLS".
 */
function resolveSubAgentTools(
  subDirName: string,
  subManifest: AgentManifest,
  knownToolNames: Set<string>,
): string[] | null {
  const declared = subManifest.tools;
  if (!Array.isArray(declared)) return null;

  const known = declared.filter(name => knownToolNames.has(name));
  const unknown = declared.filter(name => !knownToolNames.has(name));

  if (unknown.length > 0) {
    warn(
      `agents/${subDirName}/agent.yaml declares tool(s) not defined in tools/: ` +
      `${unknown.join(', ')} — dropped from this sub-agent's toolset.`,
    );
  }
  if (declared.length > 0 && known.length === 0) {
    warn(
      `agents/${subDirName}/agent.yaml narrowed to no known tools — ` +
      `the sub-agent is exported with "tools": [].`,
    );
  }
  return known;
}

// Python code rendering

interface RenderContext {
  manifest: AgentManifest;
  systemPrompt: string;
  skills: ParsedSkill[];
  tools: ToolDef[];
  preToolUseScripts: string[];
  subAgents: SubAgentDef[];
}

function renderPython(ctx: RenderContext): string {
  const { manifest, systemPrompt, skills, tools, preToolUseScripts, subAgents } = ctx;
  const lines: string[] = [];
  const model = manifest.model?.preferred ?? 'anthropic:claude-sonnet-4-5';
  const needsPath = skills.length > 0 || subAgents.some(s => s.hasSkills);

  // Header
  lines.push('"""');
  lines.push(`DeepAgents definition for ${manifest.name} v${manifest.version}`);
  lines.push('Generated by gitagent export --format deepagents');
  lines.push('"""');
  lines.push('');

  // Imports
  lines.push('from __future__ import annotations');
  lines.push('');
  lines.push('from deepagents import create_deep_agent');
  lines.push('from langchain_core.tools import tool');
  if (needsPath) lines.push('from pathlib import Path');
  lines.push('');

  // Agent metadata
  lines.push('# Agent metadata');
  lines.push(`AGENT_NAME = ${pyStr(manifest.name)}`);
  lines.push(`AGENT_VERSION = ${pyStr(manifest.version)}`);
  // create_deep_agent() resolves a string MODEL via langchain's init_chat_model,
  // which natively understands "provider:model" strings (e.g. "anthropic:claude-sonnet-4-5").
  // No prefix stripping is needed here — passing it straight through is correct.
  lines.push(`MODEL = ${pyStr(model)}`);
  lines.push('');

  // System prompt
  lines.push('# System prompt (SOUL.md + RULES.md + DUTIES.md + compliance)');
  lines.push(`SYSTEM_PROMPT = ${pyTripleStr(systemPrompt)}`);
  lines.push('');

  // Pre-tool-use hook wrapper
  lines.push('# Hooks (pre_tool_use scripts run before every tool call)');
  lines.push('def _run_pre_tool_use_hooks(tool_name: str) -> None:');
  if (preToolUseScripts.length > 0) {
    lines.push('    """Run hooks/<script> entries declared as pre_tool_use in hooks.yaml."""');
    lines.push('    import subprocess');
    for (const script of preToolUseScripts) {
      lines.push(`    subprocess.run([${pyStr(`hooks/${script}`)}, tool_name], check=False)`);
    }
  } else {
    lines.push('    """No pre_tool_use hooks configured in hooks/hooks.yaml."""');
    lines.push('    return None');
  }
  lines.push('');
  lines.push('# NOTE: other hook events (post_tool_use, on_session_start, etc.) have no');
  lines.push('# DeepAgents equivalent and are intentionally skipped.');
  lines.push('# NOTE: memory/ has no direct DeepAgents equivalent — wire a checkpointer if needed.');
  lines.push('');

  // Tools
  lines.push('# Tools (from tools/*.yaml)');
  if (tools.length > 0) {
    for (const t of tools) {
      const fnName = pyIdent(t.name);
      const sig = t.params.map(p => `${pyIdent(p.name)}: ${p.pyType}`).join(', ');
      lines.push('@tool');
      lines.push(`def ${fnName}(${sig}) -> str:`);
      lines.push(`    ${pyTripleStr(t.description || `Tool: ${t.name}`)}`);
      lines.push(`    _run_pre_tool_use_hooks(${pyStr(t.name)})`);
      lines.push(`    # TODO: replace this stub with a real implementation of "${t.name}"`);
      lines.push(`    raise NotImplementedError("Implement tool: ${t.name}")`);
      lines.push('');
    }
    lines.push(`TOOLS = [${tools.map(t => pyIdent(t.name)).join(', ')}]`);
  } else {
    lines.push('# No tools defined in tools/');
    lines.push('TOOLS: list = []');
  }
  lines.push('');

  // Skills — DeepAgents loads SKILL.md natively from directory paths
  lines.push('# Skills (skills/<name>/SKILL.md — DeepAgents loads these natively)');
  if (skills.length > 0) {
    lines.push('# Resolved relative to this file so discovery works from any working directory.');
    lines.push('SKILLS = [str(Path(__file__).resolve().parent / "skills")]');
    lines.push('');
    lines.push('# For reference, the skills available in this agent:');
    for (const skill of skills) {
      lines.push(`#   - ${skill.frontmatter.name}: ${escapeForComment(skill.frontmatter.description)}`);
    }
  } else {
    lines.push('SKILLS: list = []');
  }
  lines.push('');

  // Sub-agents
  lines.push('# Sub-agents (agents/<name>/ → SubAgent dicts)');
  if (subAgents.length > 0) {
    for (const sub of subAgents) {
      const ident = pyIdent(sub.name);
      lines.push(`${ident}_subagent = {`);
      lines.push(`    "name": ${pyStr(sub.name)},`);
      lines.push(`    "description": ${pyStr(sub.description)},`);
      lines.push(`    "system_prompt": ${pyTripleStr(sub.systemPrompt)},`);
      if (sub.toolNames) {
        const list = sub.toolNames.map(pyIdent).join(', ');
        lines.push(`    "tools": [${list}],  # narrowed via agents/${sub.name}/agent.yaml's \`tools:\` list`);
      } else {
        lines.push('    "tools": TOOLS,  # inherits the full parent toolset (default) — add `tools: [...]` to');
        lines.push(`    # this sub-agent's agent.yaml (agents/${sub.name}/agent.yaml) to narrow it`);
      }
      if (sub.hasSkills) {
        lines.push(`    "skills": [str(Path(__file__).resolve().parent / "agents" / ${pyStr(sub.name)} / "skills")],`);
      }
      lines.push('}');
      lines.push('');
    }
    lines.push(`SUBAGENTS = [${subAgents.map(s => `${pyIdent(s.name)}_subagent`).join(', ')}]`);
  } else {
    lines.push('SUBAGENTS: list = []');
  }
  lines.push('');

  // Agent construction
  lines.push('# Agent');
  lines.push('agent = create_deep_agent(');
  lines.push('    model=MODEL,');
  lines.push('    system_prompt=SYSTEM_PROMPT,');
  lines.push('    tools=TOOLS,');
  if (skills.length > 0) {
    lines.push('    skills=SKILLS,');
  }
  if (subAgents.length > 0) {
    lines.push('    subagents=SUBAGENTS,');
  }
  lines.push(')');
  lines.push('');

  // CLI entry point
  lines.push('if __name__ == "__main__":');
  lines.push('    import os');
  lines.push('    user_input = os.environ.get("GITAGENT_PROMPT", "Hello")');
  lines.push('    result = agent.invoke({"messages": [{"role": "user", "content": user_input}]})');
  lines.push('    for message in result["messages"]:');
  lines.push('        print(message)');
  lines.push('');

  return lines.join('\n');
}

// Helpers

function pyIdent(name: string): string {
  let out = name.replace(/[^A-Za-z0-9_]/g, '_');
  if (/^[0-9]/.test(out)) out = `_${out}`;
  return out || '_';
}

function pyStr(value: string): string {
  return JSON.stringify(value);
}

function pyTripleStr(value: string): string {
  const safe = value.replace(/"""/g, '\\"\\"\\"').replace(/\\$/gm, '\\\\');
  return `"""${safe}"""`;
}

function escapeForComment(value: string): string {
  return value.replace(/\n/g, ' ').replace(/"""/g, '"\\""');
}

function jsonTypeToPython(jsonType: string | undefined): string {
  switch (jsonType) {
    case 'string': return 'str';
    case 'integer': return 'int';
    case 'number': return 'float';
    case 'boolean': return 'bool';
    case 'array': return 'list';
    case 'object': return 'dict';
    default: return 'str';
  }
}
