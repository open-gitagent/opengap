import { resolve, join } from 'node:path';
import { loadAgentManifest, loadFileIfExists } from '../utils/loader.js';
import { loadAllSkills, getAllowedTools } from '../utils/skill-loader.js';
import { parseModel } from '../utils/model.js';
import { buildMcpServersMarkdown } from './shared.js';

export interface LyzrAgentPayload {
  name: string;
  description: string;
  agent_role: string;
  agent_goal: string;
  agent_instructions: string;
  provider_id: string;
  model: string;
  temperature: number;
  top_p: number;
  llm_credential_id: string;
  store_messages: boolean;
  features: object[];
  response_format?: object;
  file_output: boolean;
}

const PROVIDER_CREDENTIAL_MAP: Record<string, string> = {
  OpenAI: 'lyzr_openai',
  Google: 'lyzr_google',
  Perplexity: 'lyzr_perplexity',
  Anthropic: 'lyzr_anthropic',
};

function mapModelToLyzrProvider(model?: string): { provider_id: string; model: string } {
  if (!model) return { provider_id: 'OpenAI', model: 'gpt-4.1' };

  // Canonical "provider:model" → Lyzr's capitalized provider_id + bare model id.
  const { provider, modelId } = parseModel(model);
  const providerMap: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google',
  };
  return { provider_id: providerMap[provider] ?? 'OpenAI', model: modelId };
}

/**
 * Build the agent_instructions field from SOUL.md, RULES.md, skills, compliance, etc.
 */
function buildAgentInstructions(agentDir: string): string {
  const parts: string[] = [];
  const manifest = loadAgentManifest(agentDir);

  // SOUL.md
  const soul = loadFileIfExists(join(agentDir, 'SOUL.md'));
  if (soul) parts.push(soul);

  // RULES.md
  const rules = loadFileIfExists(join(agentDir, 'RULES.md'));
  if (rules) parts.push(`## Rules\n${rules}`);

  // Skills
  const skillsDir = join(agentDir, 'skills');
  const skills = loadAllSkills(skillsDir);
  for (const skill of skills) {
    const tools = getAllowedTools(skill.frontmatter);
    const toolsNote = tools.length > 0 ? `\nAllowed tools: ${tools.join(', ')}` : '';
    parts.push(`## Skill: ${skill.frontmatter.name}\n${skill.frontmatter.description}${toolsNote}\n\n${skill.instructions}`);
  }

  // MCP servers
  const mcpSection = buildMcpServersMarkdown(manifest.mcp_servers);
  if (mcpSection) parts.push(mcpSection);

  // Compliance constraints
  if (manifest.compliance) {
    const c = manifest.compliance;
    const constraints: string[] = [];
    if (c.supervision?.human_in_the_loop === 'always') {
      constraints.push('- All decisions require human approval before execution');
    }
    if (c.communications?.fair_balanced) {
      constraints.push('- All communications must be fair and balanced (FINRA 2210)');
    }
    if (c.communications?.no_misleading) {
      constraints.push('- Never make misleading, exaggerated, or promissory statements');
    }
    if (c.data_governance?.pii_handling === 'redact') {
      constraints.push('- Redact all PII from outputs');
    }
    if (constraints.length > 0) {
      parts.push(`## Compliance Constraints\n${constraints.join('\n')}`);
    }
  }

  // Memory
  const memory = loadFileIfExists(join(agentDir, 'memory', 'MEMORY.md'));
  if (memory && memory.trim().split('\n').length > 2) {
    parts.push(`## Memory\n${memory}`);
  }

  return parts.join('\n\n');
}

/**
 * Export a gitagent directory to a Lyzr API-ready payload for agent creation.
 */
export function exportToLyzr(dir: string): LyzrAgentPayload {
  const agentDir = resolve(dir);
  const manifest = loadAgentManifest(agentDir);

  const { provider_id, model } = mapModelToLyzrProvider(manifest.model?.preferred);
  const credentialId = PROVIDER_CREDENTIAL_MAP[provider_id] || 'lyzr_openai';

  const instructions = buildAgentInstructions(agentDir);

  // Extract role/goal from SOUL.md or manifest
  const soul = loadFileIfExists(join(agentDir, 'SOUL.md')) || '';
  const roleMatch = soul.match(/##\s*Core\s*Identity\s*\n+([\s\S]*?)(?=\n##|\n$|$)/i);
  const goalMatch = soul.match(/##\s*(?:Values|Purpose|Goal|Mission)\s*.*?\n+([\s\S]*?)(?=\n##|\n$|$)/i);

  const agentRole = roleMatch
    ? roleMatch[1].trim().split('\n')[0].replace(/^[-*]\s*/, '')
    : manifest.description;
  const agentGoal = goalMatch
    ? goalMatch[1].trim().split('\n')[0].replace(/^[-*]\s*/, '')
    : manifest.description;

  const features: object[] = [
    {
      type: 'MEMORY',
      config: { max_messages_context_count: 50 },
      priority: 0,
    },
  ];

  return {
    name: manifest.name,
    description: manifest.description,
    agent_role: agentRole,
    agent_goal: agentGoal,
    agent_instructions: instructions,
    provider_id,
    model,
    temperature: manifest.model?.constraints?.temperature ?? manifest.runtime?.temperature ?? 0.3,
    top_p: manifest.model?.constraints?.top_p ?? 0.9,
    llm_credential_id: credentialId,
    store_messages: true,
    features,
    file_output: false,
  };
}

/**
 * String export for the `gitagent export --format lyzr` command.
 */
export function exportToLyzrString(dir: string): string {
  const payload = exportToLyzr(dir);
  return JSON.stringify(payload, null, 2);
}
