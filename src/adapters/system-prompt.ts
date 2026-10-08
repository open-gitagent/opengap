import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { loadAgentManifest, loadFileIfExists } from '../utils/loader.js';
import { loadKnowledgeDocument } from '../utils/path-safety.js';
import { loadAllSkills, getAllowedTools } from '../utils/skill-loader.js';
import { buildMcpServersMarkdown } from './shared.js';

export function exportToSystemPrompt(dir: string): string {
  const agentDir = resolve(dir);
  const manifest = loadAgentManifest(agentDir);
  const parts: string[] = [];

  // Agent identity header
  parts.push(`# ${manifest.name} v${manifest.version}`);
  parts.push(`${manifest.description}\n`);

  // SOUL.md
  const soul = loadFileIfExists(join(agentDir, 'SOUL.md'));
  if (soul) {
    parts.push(soul);
  }

  // RULES.md
  const rules = loadFileIfExists(join(agentDir, 'RULES.md'));
  if (rules) {
    parts.push(rules);
  }

  // DUTIES.md
  const duty = loadFileIfExists(join(agentDir, 'DUTIES.md'));
  if (duty) {
    parts.push(duty);
  }

  // Skills — loaded via skill-loader
  const skillsDir = join(agentDir, 'skills');
  const skills = loadAllSkills(skillsDir);
  for (const skill of skills) {
    const toolsList = getAllowedTools(skill.frontmatter);
    const toolsNote = toolsList.length > 0 ? `\nAllowed tools: ${toolsList.join(', ')}` : '';
    parts.push(`## Skill: ${skill.frontmatter.name}\n${skill.frontmatter.description}${toolsNote}\n\n${skill.instructions}`);
  }

  // Knowledge (always_load documents)
  const knowledgeDir = join(agentDir, 'knowledge');
  const indexPath = join(knowledgeDir, 'index.yaml');
  if (existsSync(indexPath)) {
    const index = yaml.load(readFileSync(indexPath, 'utf-8')) as {
      documents?: Array<{ path: string; always_load?: boolean }>;
    };

    if (index?.documents) {
      const alwaysLoad = index.documents.filter(d => d.always_load);
      for (const doc of alwaysLoad) {
        const content = loadKnowledgeDocument(knowledgeDir, doc.path);
        if (content) {
          parts.push(`## Knowledge: ${doc.path}\n${content}`);
        }
      }
    }
  }

  // MCP servers
  const mcpSection = buildMcpServersMarkdown(manifest.mcp_servers);
  if (mcpSection) {
    parts.push(mcpSection);
  }

  // Compliance constraints as system instructions
  if (manifest.compliance) {
    const c = manifest.compliance;
    const constraints: string[] = [];

    if (c.supervision?.human_in_the_loop === 'always') {
      constraints.push('- All decisions require human approval before execution');
    }
    if (c.supervision?.escalation_triggers) {
      constraints.push('- Escalate to human supervisor when:');
      for (const trigger of c.supervision.escalation_triggers) {
        for (const [key, value] of Object.entries(trigger)) {
          constraints.push(`  - ${key}: ${value}`);
        }
      }
    }
    if (c.communications?.fair_balanced) {
      constraints.push('- All communications must be fair and balanced (FINRA 2210)');
    }
    if (c.communications?.no_misleading) {
      constraints.push('- Never make misleading, exaggerated, or promissory statements');
    }
    if (c.data_governance?.pii_handling === 'redact') {
      constraints.push('- Redact all PII from outputs and intermediate reasoning');
    }
    if (c.data_governance?.pii_handling === 'prohibit') {
      constraints.push('- Do not process any personally identifiable information');
    }

    if (c.segregation_of_duties) {
      const sod = c.segregation_of_duties;
      constraints.push('- Segregation of duties is enforced:');
      if (sod.assignments) {
        for (const [agentName, roles] of Object.entries(sod.assignments)) {
          constraints.push(`  - Agent "${agentName}" has role(s): ${roles.join(', ')}`);
        }
      }
      if (sod.conflicts) {
        constraints.push('- Duty separation rules (no single agent may hold both):');
        for (const [a, b] of sod.conflicts) {
          constraints.push(`  - ${a} and ${b}`);
        }
      }
      if (sod.handoffs) {
        constraints.push('- The following actions require multi-agent handoff:');
        for (const h of sod.handoffs) {
          constraints.push(`  - ${h.action}: must pass through roles ${h.required_roles.join(' → ')}${h.approval_required !== false ? ' (approval required)' : ''}`);
        }
      }
      if (sod.isolation?.state === 'full') {
        constraints.push('- Agent state/memory is fully isolated per role — do not access another agent\'s state');
      }
      if (sod.isolation?.credentials === 'separate') {
        constraints.push('- Credentials are segregated per role — use only credentials assigned to your role');
      }
      if (sod.enforcement === 'strict') {
        constraints.push('- SOD enforcement is STRICT — violations will block execution');
      }
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
