import { Command } from 'commander';
import { resolve } from 'node:path';
import { error, heading, info, label, divider } from '../utils/format.js';
import { loadAgentManifest, agentDirExists } from '../utils/loader.js';
import { exportToSystemPrompt } from '../adapters/system-prompt.js';
import { resolveRepo } from '../utils/git-cache.js';
import { runWithClaude } from '../runners/claude.js';
import { runWithOpenAI } from '../runners/openai.js';
import { runWithCrewAI } from '../runners/crewai.js';
import { runWithOpenClaw } from '../runners/openclaw.js';
import { runWithNanobot } from '../runners/nanobot.js';
import { runWithLyzr } from '../runners/lyzr.js';
import { runWithGitHub } from '../runners/github.js';
import { runWithGit } from '../runners/git.js';
import { runWithOpenCode } from '../runners/opencode.js';
import { runWithGemini } from '../runners/gemini.js';
import { runWithGitclaw } from '../runners/gitclaw.js';
import { runWithLangChain } from '../runners/langchain.js';

interface RunOptions {
  repo?: string;
  adapter: string;
  branch: string;
  refresh: boolean;
  cache: boolean;
  prompt?: string;
  dir?: string;
  workspace?: string;
  continue?: boolean;
  resume?: string;
  sessionId?: string;
}

export const runCommand = new Command('run')
  .description('Run an agent from a git repository or local directory')
  .option('-r, --repo <url>', 'Git repository URL')
  .option('-a, --adapter <name>', 'Adapter: claude, openai, crewai, openclaw, nanobot, lyzr, github, opencode, gemini, gitclaw, langchain, git, prompt', 'claude')
  .option('-b, --branch <branch>', 'Git branch/tag to clone', 'main')
  .option('--refresh', 'Force re-clone (pull latest)', false)
  .option('--no-cache', 'Clone to temp dir, delete on exit')
  .option('-p, --prompt <query>', 'Initial prompt to send to the agent')
  .option('-d, --dir <dir>', 'Use local directory instead of git URL')
  .option('-w, --workspace <dir>', 'Working directory for the spawned agent process')
  .option('-c, --continue', 'Continue the most recent session in the working directory (claude adapter)', false)
  .option('--resume <sessionId>', 'Resume a specific session by ID (claude adapter)')
  .option('--session-id <uuid>', 'Start with a specific session ID so it can be resumed later (claude adapter)')
  .action(async (options: RunOptions) => {
    let agentDir: string;
    let cleanup: (() => void) | undefined;

    // Resolve agent directory
    if (options.dir) {
      agentDir = resolve(options.dir);
    } else if (options.repo) {
      heading('Resolving repository');
      info(`URL: ${options.repo}`);
      info(`Branch: ${options.branch}`);

      try {
        const result = resolveRepo(options.repo, {
          branch: options.branch,
          refresh: options.refresh,
          noCache: !options.cache,
        });
        agentDir = result.dir;
        cleanup = result.cleanup;
      } catch (e) {
        error(`Failed to clone repository: ${(e as Error).message}`);
        process.exit(1);
      }
    } else {
      error('Either --repo (-r) or --dir (-d) is required');
      process.exit(1);
    }

    // Validate agent directory
    if (!agentDirExists(agentDir)) {
      error(`No agent.yaml found in ${agentDir}`);
      if (cleanup) cleanup();
      process.exit(1);
    }

    // Load manifest
    let manifest;
    try {
      manifest = loadAgentManifest(agentDir);
    } catch (e) {
      error(`Failed to load agent: ${(e as Error).message}`);
      if (cleanup) cleanup();
      process.exit(1);
    }

    // Print agent info
    heading(`Running agent: ${manifest.name}`);
    label('Version', manifest.version);
    label('Description', manifest.description);
    if (manifest.model?.preferred) {
      label('Model', manifest.model.preferred);
    }
    label('Adapter', options.adapter);
    if (options.workspace) {
      label('Workspace', resolve(options.workspace));
    }
    divider();

    // Session flags are claude-adapter-only — warn instead of silently dropping
    if ((options.continue || options.resume || options.sessionId) && options.adapter !== 'claude') {
      error(`--continue / --resume / --session-id are only supported by the claude adapter (got: ${options.adapter})`);
      if (cleanup) cleanup();
      process.exit(1);
    }

    // Run with selected adapter
    try {
      switch (options.adapter) {
        case 'claude':
          runWithClaude(agentDir, manifest, {
            prompt: options.prompt,
            workspace: options.workspace,
            continue: options.continue,
            resume: options.resume,
            sessionId: options.sessionId,
          });
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
        case 'lyzr':
          await runWithLyzr(agentDir, manifest, { prompt: options.prompt, workspace: options.workspace });
          break;
        case 'github':
          await runWithGitHub(agentDir, manifest, { prompt: options.prompt, workspace: options.workspace });
          break;
        case 'opencode':
          runWithOpenCode(agentDir, manifest, { prompt: options.prompt, workspace: options.workspace });
          break;
        case 'gemini':
          runWithGemini(agentDir, manifest, { prompt: options.prompt, workspace: options.workspace });
          break;
        case 'gitclaw':
          runWithGitclaw(agentDir, manifest, { prompt: options.prompt, workspace: options.workspace });
          break;
        case 'langchain':
          runWithLangChain(agentDir, manifest, { prompt: options.prompt });
          break;
        case 'git':
          if (!options.repo) {
            error('The git adapter requires --repo (-r)');
            process.exit(1);
          }
          await runWithGit(options.repo, {
            repo: options.repo,
            branch: options.branch,
            refresh: options.refresh,
            noCache: !options.cache,
            prompt: options.prompt,
            workspace: options.workspace,
          });
          break;
        case 'prompt':
          console.log(exportToSystemPrompt(agentDir));
          break;
        default:
          error(`Unknown adapter: ${options.adapter}`);
          info('Supported adapters: claude, openai, crewai, openclaw, nanobot, lyzr, github, opencode, gemini, gitclaw, langchain, git, prompt');
          process.exit(1);
      }
    } catch (e) {
      error(`Run failed: ${(e as Error).message}`);
      process.exit(1);
    } finally {
      if (cleanup) cleanup();
    }
  });
