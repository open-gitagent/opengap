import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { loadSkillMetadata, loadSkillFull, type SkillMetadata, type ParsedSkill } from './skill-loader.js';
import { warn } from './format.js';

export interface DiscoveredSkill {
  name: string;
  description: string;
  license?: string;
  directory: string;
  source: SkillSource;
}

export type SkillSource =
  | 'agent'       // <agentDir>/skills/
  | 'agentskills' // .agents/skills/ (agentskills.io standard)
  | 'personal'    // ~/.agents/skills/ (personal skills)
  | 'claude'      // .claude/skills/ (Claude Code)
  | 'github';     // .github/skills/ (GitHub)

interface DiscoveryOptions {
  /** Agent directory to search from */
  agentDir: string;
  /** Only return skills from agent-local paths */
  localOnly?: boolean;
}

/**
 * Standard skill search paths in priority order.
 * Earlier entries take precedence on name collision.
 */
function getSearchPaths(agentDir: string): Array<{ path: string; source: SkillSource }> {
  const dir = resolve(agentDir);
  const home = homedir();

  return [
    // Agent-local (highest priority)
    { path: join(dir, 'skills'), source: 'agent' },
    // agentskills.io standard locations
    { path: join(dir, '.agents', 'skills'), source: 'agentskills' },
    // Tool-specific locations
    { path: join(dir, '.claude', 'skills'), source: 'claude' },
    { path: join(dir, '.github', 'skills'), source: 'github' },
    // Personal skills (lowest priority)
    { path: join(home, '.agents', 'skills'), source: 'personal' },
  ];
}

/**
 * Discover all skills from standard locations.
 * Deduplicates by name: local > agentskills > tool-specific > personal.
 */
export function discoverSkills(options: DiscoveryOptions): DiscoveredSkill[] {
  const searchPaths = getSearchPaths(options.agentDir);
  const seen = new Map<string, DiscoveredSkill>();

  for (const { path, source } of searchPaths) {
    if (options.localOnly && source !== 'agent') continue;
    if (!existsSync(path)) continue;

    const entries = readdirSync(path, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip if already found at higher priority
      if (seen.has(entry.name)) continue;

      const skillMdPath = join(path, entry.name, 'SKILL.md');
      if (!existsSync(skillMdPath)) continue;

      try {
        const meta = loadSkillMetadata(skillMdPath);
        seen.set(entry.name, {
          name: meta.name,
          description: meta.description,
          license: meta.license,
          directory: meta.directory,
          source,
        });
      } catch (err) {
        warn(`Skill discovery failed: ${skillMdPath} — ${(err as Error).message}`);
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Discover and fully load all skills from standard locations.
 */
export function discoverAndLoadSkills(options: DiscoveryOptions): ParsedSkill[] {
  const discovered = discoverSkills(options);
  const skills: ParsedSkill[] = [];

  for (const disc of discovered) {
    const skillMdPath = join(disc.directory, 'SKILL.md');
    try {
      skills.push(loadSkillFull(skillMdPath));
    } catch (err) {
      warn(`Skill load failed: ${skillMdPath} — ${(err as Error).message}`);
    }
  }

  return skills;
}

/**
 * Find a single skill by name from standard locations.
 */
export function findSkill(name: string, agentDir: string): DiscoveredSkill | null {
  const all = discoverSkills({ agentDir });
  return all.find(s => s.name === name) ?? null;
}
