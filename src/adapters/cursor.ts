import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import yaml from 'js-yaml';
import { loadAgentManifest, loadFileIfExists } from '../utils/loader.js';
import { loadAllSkills, getAllowedTools } from '../utils/skill-loader.js';
import { buildMcpServersConfig } from './shared.js';

/**
 * Export a gitagent to Cursor rules format.
 *
 * Cursor uses:
 *   - `.cursor/rules/<name>.mdc`  (YAML frontmatter + markdown content)
 *
 * Frontmatter fields:
 *   - `description`   Human-readable summary
 *   - `globs`         Array of file patterns to scope the rule (optional)
 *   - `alwaysApply`   boolean — true for global rules (SOUL.md + RULES.md)
 *
 * Mapping:
 *   - SOUL.md + RULES.md  → `.cursor/rules/<agent-name>.mdc`  (alwaysApply: true)
 *   - Each skill          → `.cursor/rules/<skill-name>.mdc`  (alwaysApply: false, globs from metadata.globs)
 */
export interface CursorRule {
  /** Destination filename inside `.cursor/rules/` (without directory) */
  filename: string;
  /** Full .mdc content (YAML frontmatter + markdown body) */
  content: string;
}

export interface CursorExport {
  rules: CursorRule[];
  /** Content for .cursor/mcp.json (null if no MCP servers defined) */
  mcpConfig: Record<string, unknown> | null;
}

export function exportToCursor(dir: string): CursorExport {
  const agentDir = resolve(dir);
  const manifest = loadAgentManifest(agentDir);

  const rules: CursorRule[] = [];

  // --- Global rule: SOUL.md + RULES.md → alwaysApply: true ---
  const globalRule = buildGlobalRule(agentDir, manifest);
  if (globalRule) {
    rules.push(globalRule);
  }

  // --- Skill rules: one .mdc per skill ---
  const skillsDir = join(agentDir, 'skills');
  const skills = loadAllSkills(skillsDir);
  for (const skill of skills) {
    rules.push(buildSkillRule(skill));
  }

  // MCP servers
  const mcpServers = buildMcpServersConfig(manifest.mcp_servers);
  const mcpConfig = mcpServers ? { mcpServers } : null;

  return { rules, mcpConfig };
}

/**
 * Export as a single string showing the files that would be written.
 * Used by `gitagent export --format cursor`.
 */
export function exportToCursorString(dir: string): string {
  const exp = exportToCursor(dir);
  const parts: string[] = [];

  for (const rule of exp.rules) {
    parts.push(`# === .cursor/rules/${rule.filename} ===`);
    parts.push(rule.content);
    parts.push('');
  }

  if (exp.mcpConfig) {
    parts.push('# === .cursor/mcp.json ===');
    parts.push(JSON.stringify(exp.mcpConfig, null, 2));
    parts.push('');
  }

  return parts.join('\n').trimEnd() + '\n';
}

/**
 * Build the global alwaysApply rule from SOUL.md and RULES.md.
 * Returns null if neither file exists (no global rule to emit).
 */
function buildGlobalRule(
  agentDir: string,
  manifest: ReturnType<typeof loadAgentManifest>,
): CursorRule | null {
  const soul = loadFileIfExists(join(agentDir, 'SOUL.md'));
  const rules = loadFileIfExists(join(agentDir, 'RULES.md'));

  if (!soul && !rules) return null;

  const frontmatter: Record<string, unknown> = {
    description: manifest.description,
    alwaysApply: true,
  };

  const bodyParts: string[] = [];

  if (soul) {
    bodyParts.push('## Identity & Soul');
    bodyParts.push('');
    bodyParts.push(soul.trim());
  }

  if (rules) {
    if (bodyParts.length > 0) bodyParts.push('');
    bodyParts.push('## Rules & Constraints');
    bodyParts.push('');
    bodyParts.push(rules.trim());
  }

  const content = buildMdcFile(frontmatter, bodyParts.join('\n'));
  const agentSlug = slugify(manifest.name);

  return {
    filename: `${agentSlug}.mdc`,
    content,
  };
}

/**
 * Build a scoped skill rule from a parsed skill.
 * Uses metadata.globs for file scoping when available.
 */
function buildSkillRule(
  skill: import('../utils/skill-loader.js').ParsedSkill,
): CursorRule {
  const fm = skill.frontmatter;

  const frontmatter: Record<string, unknown> = {
    description: fm.description,
    alwaysApply: false,
  };

  // Globs: read from metadata.globs (space or comma separated) or allowed-tools scope hint
  const globs = parseGlobs(fm.metadata?.['globs']);
  if (globs.length > 0) {
    frontmatter['globs'] = globs;
  }

  const bodyParts: string[] = [];

  // Skill heading
  bodyParts.push(`# ${fm.name}`);
  bodyParts.push('');
  bodyParts.push(skill.instructions.trim());

  // Allowed tools note
  const toolsList = getAllowedTools(fm);
  if (toolsList.length > 0) {
    bodyParts.push('');
    bodyParts.push(`**Allowed tools:** ${toolsList.join(', ')}`);
  }

  const content = buildMdcFile(frontmatter, bodyParts.join('\n'));

  return {
    filename: `${slugify(fm.name)}.mdc`,
    content,
  };
}

/**
 * Render a .mdc file: YAML frontmatter block + markdown body.
 */
function buildMdcFile(frontmatter: Record<string, unknown>, body: string): string {
  const fm = yaml.dump(frontmatter, { lineWidth: 120 }).trimEnd();
  return `---\n${fm}\n---\n\n${body.trim()}\n`;
}

/**
 * Parse a globs string (space or comma separated) into an array.
 * Returns an empty array if the input is falsy or blank.
 *
 * Examples:
 *   "*.ts src/api/**"   → ["*.ts", "src/api/**"]
 *   "*.py,tests/**"     → ["*.py", "tests/**"]
 */
function parseGlobs(raw: string | undefined): string[] {
  if (!raw || raw.trim() === '') return [];
  return raw
    .split(/[\s,]+/)
    .map(g => g.trim())
    .filter(Boolean);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Enhanced import: read .cursor/rules/*.mdc → gitagent skills
// ---------------------------------------------------------------------------

/**
 * Parse a single .mdc file into its frontmatter and body.
 */
export interface MdcFile {
  frontmatter: {
    description?: string;
    globs?: string | string[];
    alwaysApply?: boolean;
  };
  body: string;
}

export function parseMdcFile(content: string): MdcFile {
  const match = content.replace(/\r\n?/g, '\n').match(/^---\n([\s\S]*?)\n---\n*([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }
  const frontmatter = (yaml.load(match[1]) ?? {}) as MdcFile['frontmatter'];
  return { frontmatter, body: match[2].trim() };
}

/**
 * Read all .mdc files from a `.cursor/rules/` directory.
 * Returns a list of { filename, parsed } objects, or an empty array if the
 * directory does not exist.
 */
export function readCursorRules(
  sourceDir: string,
): Array<{ filename: string; parsed: MdcFile }> {
  const rulesDir = join(resolve(sourceDir), '.cursor', 'rules');
  if (!existsSync(rulesDir)) return [];

  return readdirSync(rulesDir)
    .filter(f => f.endsWith('.mdc'))
    .map(filename => ({
      filename,
      parsed: parseMdcFile(readFileSync(join(rulesDir, filename), 'utf-8')),
    }));
}
