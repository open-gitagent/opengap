import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveInside } from './path-safety.js';

const GITHUB_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Parse an `owner/repo[#path]` reference, rejecting unsafe repo names and paths. */
export function parseGitHubSkillRef(skillRef: string): { repo: string; subPath?: string } {
  const [repo, subPath] = skillRef.split('#');
  if (!GITHUB_REPO_RE.test(repo) || repo.split('/').some(seg => seg === '.' || seg === '..')) {
    throw new Error(`Invalid GitHub repository reference: "${repo}" (expected owner/repo)`);
  }
  if (subPath !== undefined) {
    const segments = subPath.split('/').filter(Boolean);
    if (subPath.startsWith('/') || segments.length === 0 || segments.some(seg => seg === '.' || seg === '..' || seg.startsWith('-'))) {
      throw new Error(`Invalid skill path: "${subPath}"`);
    }
    return { repo, subPath: segments.join('/') };
  }
  return { repo };
}

function skillInstallDir(targetDir: string, skillName: string): string {
  const dir = resolveInside(targetDir, skillName);
  if (!dir || skillName.includes('/') || skillName.includes('\\')) {
    throw new Error(`Invalid skill name: "${skillName}"`);
  }
  return dir;
}

export interface RegistryConfig {
  name: string;
  url?: string;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  items: SearchResultItem[];
  total: number;
}

export interface SearchResultItem {
  name: string;
  description: string;
  version: string;
  author?: string;
  downloads?: number;
  registry: string;
}

export interface SkillPackage {
  name: string;
  version: string;
  description: string;
  files: string[];
  skillMd: string;
}

/**
 * Provider-agnostic skill registry interface.
 * Implementations: SkillsMPProvider, GitHubProvider, LocalProvider.
 */
export interface SkillRegistryProvider {
  name: string;
  search(query: string, options?: SearchOptions): Promise<SearchResult>;
  fetch(skillName: string): Promise<SkillPackage>;
  install(skillName: string, targetDir: string): Promise<void>;
}

/**
 * SkillsMP marketplace provider (default).
 * Uses the SkillsMP REST API.
 */
export class SkillsMPProvider implements SkillRegistryProvider {
  name = 'skillsmp';
  private baseUrl: string;

  constructor(config?: RegistryConfig) {
    this.baseUrl = config?.url ?? 'https://api.skillsmp.com';
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    const params = new URLSearchParams({
      q: query,
      limit: String(options?.limit ?? 20),
      offset: String(options?.offset ?? 0),
    });

    const response = await fetch(`${this.baseUrl}/v1/skills/search?${params}`);
    if (!response.ok) {
      throw new Error(`SkillsMP search failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      skills: Array<{
        name: string;
        description: string;
        version: string;
        author?: string;
        downloads?: number;
      }>;
      total: number;
    };

    return {
      items: data.skills.map(s => ({
        name: s.name,
        description: s.description,
        version: s.version,
        author: s.author,
        downloads: s.downloads,
        registry: this.name,
      })),
      total: data.total,
    };
  }

  async fetch(skillName: string): Promise<SkillPackage> {
    const response = await fetch(`${this.baseUrl}/v1/skills/${skillName}`);
    if (!response.ok) {
      throw new Error(`SkillsMP fetch failed for "${skillName}": ${response.status}`);
    }

    return await response.json() as SkillPackage;
  }

  async install(skillName: string, targetDir: string): Promise<void> {
    const skillDir = skillInstallDir(targetDir, skillName);
    const pkg = await this.fetch(skillName);

    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), pkg.skillMd, 'utf-8');
  }
}

/**
 * GitHub provider — install skills directly from GitHub repos.
 * Expects repo format: owner/repo or owner/repo#path/to/skill
 */
export class GitHubProvider implements SkillRegistryProvider {
  name = 'github';

  async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    const params = new URLSearchParams({
      q: `${query} filename:SKILL.md`,
      per_page: String(options?.limit ?? 20),
    });

    const response = await fetch(`https://api.github.com/search/code?${params}`, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
    });

    if (!response.ok) {
      throw new Error(`GitHub search failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      items: Array<{
        repository: { full_name: string; description: string | null };
        path: string;
      }>;
      total_count: number;
    };

    return {
      items: data.items.map(item => ({
        name: item.path.replace(/\/SKILL\.md$/, '').split('/').pop() ?? item.repository.full_name,
        description: item.repository.description ?? '',
        version: 'latest',
        author: item.repository.full_name.split('/')[0],
        registry: this.name,
      })),
      total: data.total_count,
    };
  }

  async fetch(skillRef: string): Promise<SkillPackage> {
    // skillRef format: owner/repo or owner/repo#path
    const { repo, subPath } = parseGitHubSkillRef(skillRef);
    const path = subPath ?? '';
    const skillMdPath = path ? `${path}/SKILL.md` : 'SKILL.md';

    const response = await fetch(
      `https://api.github.com/repos/${repo}/contents/${skillMdPath}`,
      { headers: { 'Accept': 'application/vnd.github.v3.raw' } },
    );

    if (!response.ok) {
      throw new Error(`GitHub fetch failed for "${skillRef}": ${response.status}`);
    }

    const skillMd = await response.text();
    const name = path ? path.split('/').pop()! : repo.split('/').pop()!;

    return {
      name,
      version: 'latest',
      description: '',
      files: ['SKILL.md'],
      skillMd,
    };
  }

  async install(skillRef: string, targetDir: string): Promise<void> {
    const { repo, subPath } = parseGitHubSkillRef(skillRef);

    if (subPath) {
      // Clone and extract specific path
      const tmpDir = join(targetDir, '.tmp-git-clone');
      try {
        execFileSync('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--', `https://github.com/${repo}.git`, tmpDir], { stdio: 'pipe' });
        execFileSync('git', ['-C', tmpDir, 'sparse-checkout', 'set', '--', subPath], { stdio: 'pipe' });
        const skillName = subPath.split('/').pop()!;
        const skillDir = skillInstallDir(targetDir, skillName);
        const sourceDir = resolveInside(tmpDir, subPath);
        if (!sourceDir) {
          throw new Error(`Invalid skill path: "${subPath}"`);
        }
        mkdirSync(skillDir, { recursive: true });
        cpSync(sourceDir, skillDir, { recursive: true });
      } finally {
        if (existsSync(tmpDir)) {
          rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    } else {
      // Clone entire repo as a skill
      const skillName = repo.split('/').pop()!;
      const skillDir = skillInstallDir(targetDir, skillName);
      execFileSync('git', ['clone', '--depth', '1', '--', `https://github.com/${repo}.git`, skillDir], { stdio: 'pipe' });
    }
  }
}

/**
 * Local provider — install from local filesystem paths.
 */
export class LocalProvider implements SkillRegistryProvider {
  name = 'local';

  async search(): Promise<SearchResult> {
    throw new Error('Search is not supported for local provider');
  }

  async fetch(localPath: string): Promise<SkillPackage> {
    const absPath = resolve(localPath);
    const skillMdPath = join(absPath, 'SKILL.md');

    if (!existsSync(skillMdPath)) {
      throw new Error(`No SKILL.md found at ${absPath}`);
    }

    const skillMd = readFileSync(skillMdPath, 'utf-8');
    const name = absPath.split('/').pop()!;

    return {
      name,
      version: 'local',
      description: '',
      files: ['SKILL.md'],
      skillMd,
    };
  }

  async install(localPath: string, targetDir: string): Promise<void> {
    const absPath = resolve(localPath);
    const skillName = absPath.split('/').pop()!;
    const skillDir = join(targetDir, skillName);

    mkdirSync(skillDir, { recursive: true });
    cpSync(absPath, skillDir, { recursive: true });
  }
}

/**
 * Factory: create a provider from configuration.
 */
export function createProvider(config: RegistryConfig): SkillRegistryProvider {
  switch (config.name) {
    case 'skillsmp':
      return new SkillsMPProvider(config);
    case 'github':
      return new GitHubProvider();
    case 'local':
      return new LocalProvider();
    default:
      // Treat unknown providers as SkillsMP-compatible with custom URL
      if (config.url) {
        return new SkillsMPProvider(config);
      }
      throw new Error(`Unknown registry provider: ${config.name}`);
  }
}

/**
 * Get the default provider (SkillsMP).
 */
export function getDefaultProvider(): SkillRegistryProvider {
  return new SkillsMPProvider();
}
