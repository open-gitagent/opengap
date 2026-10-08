import { Command } from 'commander';
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadAgentManifest } from '../utils/loader.js';
import { success, error, warn, info, heading, divider } from '../utils/format.js';

interface RegistryOptions {
  dir: string;
  repo: string;
  category: string;
  adapters: string;
}

const REGISTRY_REPO = 'open-gitagent/registry';
const VALID_CATEGORIES = [
  'developer-tools', 'data-engineering', 'devops', 'compliance',
  'security', 'documentation', 'testing', 'research',
  'productivity', 'finance', 'customer-support', 'creative',
  'education', 'other',
];

const AGENT_NAME_RE = /^[a-z][a-z0-9-]*$/;
const GITHUB_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;

/** Registry agent names must be lowercase kebab-case. */
export function isValidAgentName(name: string): boolean {
  return AGENT_NAME_RE.test(name);
}

/**
 * Validate a public GitHub repository URL and return its normalized form
 * (https://github.com/<owner>/<repo>), or null if invalid.
 */
export function normalizeGitHubRepoUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
  if (url.username || url.password || url.port || url.search || url.hash) return null;
  const segments = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (segments.length !== 2) return null;
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, '');
  if (!GITHUB_SEGMENT_RE.test(owner) || !GITHUB_SEGMENT_RE.test(repo)) return null;
  if (owner.startsWith('.') || repo.startsWith('.')) return null;
  return `https://github.com/${owner}/${repo}`;
}

export const registryCommand = new Command('registry')
  .description('Submit an agent to the gitagent registry')
  .requiredOption('-r, --repo <url>', 'Public GitHub repository URL of the agent')
  .option('-d, --dir <dir>', 'Local agent directory to validate', '.')
  .option('-c, --category <category>', 'Agent category', 'developer-tools')
  .option('-a, --adapters <adapters>', 'Comma-separated adapters', 'claude-code,system-prompt')
  .action(async (options: RegistryOptions) => {
    const dir = resolve(options.dir);

    heading('Submitting agent to gitagent registry');
    divider();

    // ── Step 1: Validate the local agent ──
    info('Validating agent...');

    if (!existsSync(join(dir, 'agent.yaml'))) {
      error('agent.yaml not found. Run this from your agent directory or use -d <dir>');
      process.exit(1);
    }

    if (!existsSync(join(dir, 'SOUL.md'))) {
      error('SOUL.md not found. Every agent needs a SOUL.md');
      process.exit(1);
    }

    let manifest;
    try {
      manifest = loadAgentManifest(dir);
    } catch (e) {
      error(`Failed to load agent.yaml: ${(e as Error).message}`);
      process.exit(1);
    }

    if (!manifest.name) {
      error('agent.yaml must have a "name" field');
      process.exit(1);
    }

    if (!isValidAgentName(manifest.name)) {
      error(`Invalid agent name "${manifest.name}": must match ${AGENT_NAME_RE} (lowercase letters, digits, hyphens)`);
      process.exit(1);
    }

    if (!manifest.version) {
      error('agent.yaml must have a "version" field');
      process.exit(1);
    }

    if (!manifest.description) {
      error('agent.yaml must have a "description" field');
      process.exit(1);
    }

    success('Agent validated');

    // ── Step 2: Validate repo URL ──
    const repoUrl = normalizeGitHubRepoUrl(options.repo);
    if (!repoUrl) {
      error('Repository URL must be a GitHub repository URL (https://github.com/<owner>/<repo>)');
      process.exit(1);
    }

    info(`Repository: ${repoUrl}`);

    // ── Step 3: Validate category ──
    if (!VALID_CATEGORIES.includes(options.category)) {
      error(`Invalid category: "${options.category}"`);
      info(`Valid categories: ${VALID_CATEGORIES.join(', ')}`);
      process.exit(1);
    }

    // ── Step 4: Detect GitHub username ──
    let ghUser: string;
    try {
      ghUser = execFileSync('gh', ['api', 'user', '-q', '.login'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      if (!/^[A-Za-z0-9-]+$/.test(ghUser)) {
        throw new Error('unexpected GitHub username');
      }
    } catch {
      error('Could not detect GitHub username. Make sure `gh` CLI is installed and authenticated.');
      info('Run: gh auth login');
      process.exit(1);
    }

    info(`GitHub user: ${ghUser}`);

    // ── Step 5: Build metadata.json ──
    const adapters = options.adapters.split(',').map(a => a.trim()).filter(Boolean);
    const tags = manifest.tags ?? [];
    const model = manifest.model?.preferred ?? 'claude-sonnet-4-5-20250929';
    const license = manifest.license ?? 'MIT';

    const metadata = {
      name: manifest.name,
      author: ghUser,
      description: manifest.description.slice(0, 200),
      repository: repoUrl,
      version: manifest.version,
      category: options.category,
      tags: tags.slice(0, 10),
      license,
      model,
      adapters,
      icon: false,
      banner: false,
    };

    heading('Registry submission');
    info(`Name: ${metadata.name}`);
    info(`Author: ${metadata.author}`);
    info(`Category: ${metadata.category}`);
    info(`Tags: ${metadata.tags.join(', ') || '(none)'}`);
    info(`Adapters: ${metadata.adapters.join(', ')}`);
    divider();

    // ── Step 6: Fork the registry repo ──
    info('Forking registry repo...');

    try {
      execFileSync('gh', ['repo', 'fork', REGISTRY_REPO, '--clone=false'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // Fork may already exist, that's fine
    }

    // ── Step 7: Clone fork and create branch ──
    const tmpDir = join(resolve('.'), `.gitagent-registry-${Date.now()}`);
    const folderName = `${ghUser}__${manifest.name}`;
    const branchName = `add-${manifest.name}`;

    info('Cloning your fork...');
    try {
      execFileSync('gh', ['repo', 'clone', `${ghUser}/registry`, tmpDir, '--', '--depth', '1'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      error(`Failed to clone fork. Make sure you have fork access to ${REGISTRY_REPO}`);
      process.exit(1);
    }

    // ── Step 8: Create agent folder with metadata + README ──
    info('Creating submission...');

    const agentDir = join(tmpDir, 'agents', folderName);
    mkdirSync(agentDir, { recursive: true });

    // Write metadata.json
    writeFileSync(join(agentDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');

    // Write README.md
    const readme = buildReadme(manifest, repoUrl);
    writeFileSync(join(agentDir, 'README.md'), readme);

    success(`Created agents/${folderName}/`);

    // ── Step 9: Commit and push ──
    info('Pushing to your fork...');
    try {
      const gitOpts = { cwd: tmpDir, stdio: 'pipe' as const };
      execFileSync('git', ['checkout', '-b', branchName], gitOpts);
      execFileSync('git', ['add', '--', `agents/${folderName}`], gitOpts);
      execFileSync('git', ['commit', '-m', `feat: add ${manifest.name} agent to registry`], gitOpts);
      execFileSync('git', ['push', 'origin', branchName], gitOpts);
    } catch (e) {
      error(`Failed to push: ${(e as Error).message}`);
      cleanup(tmpDir);
      process.exit(1);
    }

    // ── Step 10: Create PR ──
    info('Creating pull request...');
    let prUrl: string;
    try {
      const body = `## Agent Submission

- **Name**: ${manifest.name}
- **Author**: ${ghUser}
- **Repository**: ${repoUrl}
- **Category**: ${options.category}
- **Description**: ${manifest.description}

### Checklist

- [x] \`metadata.json\` follows the schema
- [x] \`README.md\` included
- [x] Agent repository is public
- [x] Repository contains valid \`agent.yaml\`
- [x] Repository contains \`SOUL.md\`
`;
      prUrl = execFileSync(
        'gh',
        ['pr', 'create', '--repo', REGISTRY_REPO, '--head', `${ghUser}:${branchName}`, '--title', `Add ${manifest.name} agent`, '--body', body],
        { encoding: 'utf-8', cwd: tmpDir, stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
    } catch (e) {
      error(`Failed to create PR: ${(e as Error).message}`);
      cleanup(tmpDir);
      process.exit(1);
    }

    // ── Cleanup ──
    cleanup(tmpDir);

    divider();
    success('Submission complete!');
    info(`Pull request: ${prUrl}`);
    info('CI will validate your agent. Once approved, it appears on registry.gitagent.sh');
  });

function buildReadme(manifest: { name: string; description: string; skills?: string[] }, repoUrl: string): string {
  const skills = manifest.skills ?? [];
  const skillsList = skills.length > 0
    ? skills.map(s => `- \`${s}\``).join('\n')
    : '- (no skills defined)';

  return `# ${manifest.name}

${manifest.description}

## Run

\`\`\`bash
npx @open-gitagent/opengap run -r ${repoUrl}
\`\`\`

## Skills

${skillsList}

## Built with

[gitagent](https://github.com/open-gitagent/gitagent) — a git-native, framework-agnostic open standard for AI agents.
`;
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}
