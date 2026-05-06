import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { warn } from './format.js';

/**
 * Agent Skills standard frontmatter — matches agentskills.io spec exactly.
 * gitagent-specific fields (category, risk_tier, etc.) live in metadata.
 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  'allowed-tools'?: string;
  metadata?: Record<string, string>;
}

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  instructions: string;
  directory: string;
  hasScripts: boolean;
  hasReferences: boolean;
  hasAssets: boolean;
  hasAgents: boolean;
}

export interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
  allowedTools?: string[];
  directory: string;
}

/**
 * Parse a SKILL.md file into frontmatter + instructions body.
 */
export function parseSkillMd(filePath: string): ParsedSkill {
  const content = readFileSync(filePath, 'utf-8');
  const dir = join(filePath, '..');

  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n*([\s\S]*)$/);

  let frontmatter: SkillFrontmatter;
  let instructions: string;

  if (frontmatterMatch) {
    frontmatter = yaml.load(frontmatterMatch[1]) as SkillFrontmatter;
    instructions = frontmatterMatch[2].trim();
  } else {
    throw new Error(`SKILL.md at ${filePath} is missing YAML frontmatter (---)`);
  }

  if (!frontmatter.name || !frontmatter.description) {
    throw new Error(`SKILL.md at ${filePath} is missing required fields: name, description`);
  }

  return {
    frontmatter,
    instructions,
    directory: dir,
    hasScripts: existsSync(join(dir, 'scripts')),
    hasReferences: existsSync(join(dir, 'references')),
    hasAssets: existsSync(join(dir, 'assets')),
    hasAgents: existsSync(join(dir, 'agents')),
  };
}

/**
 * Progressive disclosure: load metadata only (~100 tokens).
 * Returns name + description for lightweight listing/routing.
 */
export function loadSkillMetadata(filePath: string): SkillMetadata {
  const content = readFileSync(filePath, 'utf-8');
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

  if (!frontmatterMatch) {
    throw new Error(`SKILL.md at ${filePath} is missing YAML frontmatter`);
  }

  const fm = yaml.load(frontmatterMatch[1]) as SkillFrontmatter;
  const tools = getAllowedTools(fm);

  return {
    name: fm.name,
    description: fm.description,
    license: fm.license,
    allowedTools: tools.length > 0 ? tools : undefined,
    directory: join(filePath, '..'),
  };
}

/**
 * Progressive disclosure: load full skill (<5000 tokens recommended).
 * Returns complete frontmatter + instructions for active use.
 */
export function loadSkillFull(filePath: string): ParsedSkill {
  return parseSkillMd(filePath);
}

/**
 * Get the list of allowed tools from the space-delimited string.
 */
export function getAllowedTools(skill: SkillFrontmatter): string[] {
  const tools = skill['allowed-tools'];
  if (!tools || tools.trim() === '') return [];
  return tools.split(/\s+/).filter(Boolean);
}

/**
 * Load all skills from a skills/ directory.
 * Returns array of fully parsed skills.
 */
export function loadAllSkills(skillsDir: string): ParsedSkill[] {
  if (!existsSync(skillsDir)) return [];

  const skills: ParsedSkill[] = [];
  const entries = readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMdPath = join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    try {
      skills.push(parseSkillMd(skillMdPath));
    } catch (err) {
      warn(`Skill parse failed: ${skillMdPath} — ${(err as Error).message}`);
    }
  }

  return skills;
}

/**
 * Load all skill metadata from a skills/ directory.
 * Lightweight version for listing/routing.
 */
export function loadAllSkillMetadata(skillsDir: string): SkillMetadata[] {
  if (!existsSync(skillsDir)) return [];

  const skills: SkillMetadata[] = [];
  const entries = readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMdPath = join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    try {
      skills.push(loadSkillMetadata(skillMdPath));
    } catch (err) {
      warn(`Skill metadata load failed: ${skillMdPath} — ${(err as Error).message}`);
    }
  }

  return skills;
}
