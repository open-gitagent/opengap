import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentManifest, loadAgentManifest, agentDirExists } from '../utils/loader.js';
import { parseModel } from '../utils/model.js';
import { resolveRepo, ResolveRepoOptions } from '../utils/git-cache.js';
import { exportToSystemPrompt } from '../adapters/system-prompt.js';
import { runWithClaude } from './claude.js';
import { runWithOpenAI } from './openai.js';
import { runWithCrewAI } from './crewai.js';
import { runWithOpenClaw } from './openclaw.js';
import { runWithNanobot } from './nanobot.js';
import { runWithLyzr } from './lyzr.js';
import { runWithGitHub } from './github.js';
import { runWithOpenCode } from './opencode.js';
import { error, info, success, label, heading, divider, warn } from '../utils/format.js';

export interface GitRunOptions {
  repo: string;
  branch?: string;
  refresh?: boolean;
  noCache?: boolean;
  adapter?: string;
  prompt?: string;
  workspace?: string;
}

/**
 * Clone a git repo containing a gitagent agent and run it with the
 * adapter specified in agent.yaml (or overridden via --adapter).
 *
 * This is the "one-command" runner:
 *   gitagent run -a git -r https://github.com/user/agent -p "Hello"
 *
 * It resolves the repo, reads agent.yaml to detect the best adapter,
 * then delegates to the appropriate runner.
 */
export async function runWithGit(
  repoUrl: string,
  options: GitRunOptions,
): Promise<void> {
  heading('Git Runner');
  label('Repository', repoUrl);
  label('Branch', options.branch ?? 'main');

  // Clone / resolve from cache
  let agentDir: string;
  let cleanup: (() => void) | undefined;

  try {
    const result = resolveRepo(repoUrl, {
      branch: options.branch,
      refresh: options.refresh,
      noCache: options.noCache,
    });
    agentDir = result.dir;
    cleanup = result.cleanup;
    success(`Resolved to ${agentDir}`);
  } catch (e) {
    error(`Failed to clone repository: ${(e as Error).message}`);
    process.exit(1);
  }

  // Validate
  if (!agentDirExists(agentDir)) {
    error(`No agent.yaml found in ${agentDir}`);
    if (cleanup) cleanup();
    process.exit(1);
  }

  let manifest: AgentManifest;
  try {
    manifest = loadAgentManifest(agentDir);
  } catch (e) {
    error(`Failed to load manifest: ${(e as Error).message}`);
    if (cleanup) cleanup();
    process.exit(1);
  }

  // Detect adapter: explicit override > .gitagent_adapter file > model-based detection > claude
  const adapter = options.adapter ?? detectAdapter(agentDir, manifest);

  divider();
  heading(`Running: ${manifest.name} v${manifest.version}`);
  label('Description', manifest.description);
  if (manifest.model?.preferred) {
    label('Model', manifest.model.preferred);
  }
  label('Adapter', adapter);
  if (options.workspace) {
    label('Workspace', resolve(options.workspace));
  }
  divider();

  try {
    switch (adapter) {
      case 'claude':
        runWithClaude(agentDir, manifest, { prompt: options.prompt, workspace: options.workspace });
        break;
      case 'openai':
        runWithOpenAI(agentDir, manifest, { workspace: options.workspace });
        break;
      case 'crewai':
        runWithCrewAI(agentDir, manifest, { workspace: options.workspace });
        break;
      case 'openclaw':
        runWithOpenClaw(agentDir, manifest, { prompt: options.prompt, workspace: options.workspace });
        break;
      case 'nanobot':
        runWithNanobot(agentDir, manifest, { prompt: options.prompt, workspace: options.workspace });
        break;
      case 'opencode':
        runWithOpenCode(agentDir, manifest, { prompt: options.prompt, workspace: options.workspace });
        break;
      case 'lyzr':
        await runWithLyzr(agentDir, manifest, { prompt: options.prompt, workspace: options.workspace });
        break;
      case 'github':
        await runWithGitHub(agentDir, manifest, { prompt: options.prompt, workspace: options.workspace });
        break;
      case 'prompt':
        console.log(exportToSystemPrompt(agentDir));
        break;
      default:
        error(`Unknown adapter: ${adapter}`);
        process.exit(1);
    }
  } catch (e) {
    error(`Run failed: ${(e as Error).message}`);
    process.exit(1);
  } finally {
    if (cleanup) cleanup();
  }
}

/**
 * Auto-detect the best adapter from the agent definition.
 *
 * Priority:
 * 1. .gitagent_adapter file in the repo (explicit preference)
 * 2. Model name hints (claude-* → claude, gpt-* → openai)
 * 3. Presence of framework-specific files (CLAUDE.md, .cursorrules, etc.)
 * 4. Default: claude
 */
function detectAdapter(agentDir: string, manifest: AgentManifest): string {
  // 1. Explicit adapter file
  const adapterFile = join(agentDir, '.gitagent_adapter');
  if (existsSync(adapterFile)) {
    const val = readFileSync(adapterFile, 'utf-8').trim().toLowerCase();
    if (val) {
      info(`Detected adapter from .gitagent_adapter: ${val}`);
      return val;
    }
  }

  // 2. Model name hints (canonical "provider:model" → provider implies adapter)
  const model = manifest.model?.preferred;
  if (model && model.includes(':')) {
    const { provider } = parseModel(model);
    if (provider === 'anthropic') {
      info('Auto-detected adapter: claude (from model preference)');
      return 'claude';
    }
    if (provider === 'openai') {
      info('Auto-detected adapter: openai (from model preference)');
      return 'openai';
    }
    if (provider === 'google') {
      info('Auto-detected adapter: gemini (from model preference)');
      return 'gemini';
    }
  }

  // 3. Framework-specific file hints
  if (existsSync(join(agentDir, 'CLAUDE.md')) || existsSync(join(agentDir, '.claude'))) {
    info('Auto-detected adapter: claude (from CLAUDE.md/.claude)');
    return 'claude';
  }
  if (existsSync(join(agentDir, '.cursorrules'))) {
    info('Auto-detected adapter: openai (from .cursorrules)');
    return 'openai';
  }
  if (existsSync(join(agentDir, 'crew.yaml')) || existsSync(join(agentDir, 'crewai.yaml'))) {
    info('Auto-detected adapter: crewai (from crew.yaml)');
    return 'crewai';
  }
  if (existsSync(join(agentDir, '.lyzr_agent_id'))) {
    info('Auto-detected adapter: lyzr (from .lyzr_agent_id)');
    return 'lyzr';
  }
  if (existsSync(join(agentDir, '.github_models'))) {
    info('Auto-detected adapter: github (from .github_models)');
    return 'github';
  }
  if (existsSync(join(agentDir, 'opencode.json'))) {
    info('Auto-detected adapter: opencode (from opencode.json)');
    return 'opencode';
  }

  // 4. Default
  info('Using default adapter: claude');
  return 'claude';
}
