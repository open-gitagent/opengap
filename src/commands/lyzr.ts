import { Command } from 'commander';
import { resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { error, heading, info, label, divider, success } from '../utils/format.js';
import { agentDirExists, loadAgentManifest } from '../utils/loader.js';
import { createLyzrAgent, updateLyzrAgent, runWithLyzr } from '../runners/lyzr.js';
import { resolveRepo } from '../utils/git-cache.js';

interface LyzrCreateOptions {
  dir: string;
  apiKey?: string;
}

interface LyzrUpdateOptions {
  dir: string;
  agentId?: string;
  apiKey?: string;
}

export const lyzrCommand = new Command('lyzr')
  .description('Manage Lyzr agents — create, update, and push gitagent definitions to Lyzr Studio');

// gitagent lyzr create
lyzrCommand
  .command('create')
  .description('Create a new agent on Lyzr Studio from the local gitagent definition')
  .option('-d, --dir <dir>', 'Agent directory', '.')
  .option('--api-key <key>', 'Lyzr API key (or set LYZR_API_KEY)')
  .action(async (options: LyzrCreateOptions) => {
    const agentDir = resolve(options.dir);

    if (!agentDirExists(agentDir)) {
      error(`No agent.yaml found in ${agentDir}`);
      process.exit(1);
    }

    const manifest = loadAgentManifest(agentDir);
    heading(`Creating Lyzr agent: ${manifest.name}`);
    label('Version', manifest.version);
    label('Description', manifest.description);
    divider();

    const agentId = await createLyzrAgent(agentDir, { apiKey: options.apiKey });

    // Save agent ID to .lyzr_agent_id
    const idFile = join(agentDir, '.lyzr_agent_id');
    writeFileSync(idFile, agentId, 'utf-8');
    success(`Saved agent ID to .lyzr_agent_id`);

    divider();
    info('Run your agent:');
    info(`  gitagent run -d ${options.dir} -a lyzr -p "Hello"`);
    info('Or use curl:');
    info(`  curl -X POST '${getInferenceUrl()}' \\`);
    info(`    -H 'Content-Type: application/json' \\`);
    info(`    -H 'x-api-key: <YOUR_API_KEY>' \\`);
    info(`    -d '{"user_id":"user@example.com","agent_id":"${agentId}","session_id":"${agentId}-session","message":"Hello"}'`);
  });

// gitagent lyzr update
lyzrCommand
  .command('update')
  .description('Update an existing Lyzr agent with the current gitagent definition')
  .option('-d, --dir <dir>', 'Agent directory', '.')
  .option('--agent-id <id>', 'Lyzr agent ID (or reads from .lyzr_agent_id)')
  .option('--api-key <key>', 'Lyzr API key (or set LYZR_API_KEY)')
  .action(async (options: LyzrUpdateOptions) => {
    const agentDir = resolve(options.dir);

    if (!agentDirExists(agentDir)) {
      error(`No agent.yaml found in ${agentDir}`);
      process.exit(1);
    }

    // Resolve agent ID
    let agentId = options.agentId;
    if (!agentId) {
      const idFile = join(agentDir, '.lyzr_agent_id');
      if (existsSync(idFile)) {
        agentId = readFileSync(idFile, 'utf-8').trim();
      }
    }

    if (!agentId) {
      error('No agent ID provided. Use --agent-id or run `gitagent lyzr create` first.');
      info('The agent ID is saved to .lyzr_agent_id after creation.');
      process.exit(1);
    }

    const manifest = loadAgentManifest(agentDir);
    heading(`Updating Lyzr agent: ${manifest.name}`);
    label('Agent ID', agentId);
    divider();

    await updateLyzrAgent(agentDir, agentId, { apiKey: options.apiKey });

    divider();
    success('Agent definition synced to Lyzr Studio.');
  });

// gitagent lyzr info
lyzrCommand
  .command('info')
  .description('Show the Lyzr agent ID linked to this gitagent directory')
  .option('-d, --dir <dir>', 'Agent directory', '.')
  .action((options: { dir: string }) => {
    const agentDir = resolve(options.dir);
    const idFile = join(agentDir, '.lyzr_agent_id');

    if (!existsSync(idFile)) {
      info('No Lyzr agent linked. Run `gitagent lyzr create` to create one.');
      return;
    }

    const agentId = readFileSync(idFile, 'utf-8').trim();
    heading('Lyzr Agent');
    label('Agent ID', agentId);
    label('Inference URL', getInferenceUrl());
    label('Studio', `https://studio.lyzr.ai`);
  });

// gitagent lyzr run — the one-liner: clone + create + chat
lyzrCommand
  .command('run')
  .description('Clone a git agent repo, create it on Lyzr, and chat — all in one command')
  .option('-r, --repo <url>', 'Git repository URL')
  .option('-d, --dir <dir>', 'Local agent directory')
  .option('-b, --branch <branch>', 'Git branch/tag', 'main')
  .option('--refresh', 'Force re-clone (pull latest)', false)
  .option('-p, --prompt <message>', 'Message to send to the agent')
  .option('--api-key <key>', 'Lyzr API key (or set LYZR_API_KEY)')
  .option('--user-id <id>', 'User ID for chat session (default: $LYZR_USER_ID, else derived from a hash of the API key)')
  .action(async (options: {
    repo?: string;
    dir?: string;
    branch: string;
    refresh: boolean;
    prompt?: string;
    apiKey?: string;
    userId?: string;
  }) => {
    let agentDir: string;
    let cleanup: (() => void) | undefined;

    // Resolve agent directory
    if (options.dir) {
      agentDir = resolve(options.dir);
    } else if (options.repo) {
      heading('Cloning agent repository');
      label('URL', options.repo);
      label('Branch', options.branch);

      try {
        const result = resolveRepo(options.repo, {
          branch: options.branch,
          refresh: options.refresh,
        });
        agentDir = result.dir;
        cleanup = result.cleanup;
        success(`Cloned to ${agentDir}`);
      } catch (e) {
        error(`Failed to clone: ${(e as Error).message}`);
        process.exit(1);
      }
    } else {
      error('Either --repo (-r) or --dir (-d) is required');
      process.exit(1);
    }

    if (!agentDirExists(agentDir)) {
      error(`No agent.yaml found in ${agentDir}`);
      if (cleanup) cleanup();
      process.exit(1);
    }

    const manifest = loadAgentManifest(agentDir);
    divider();

    // Create on Lyzr if no .lyzr_agent_id exists
    const idFile = join(agentDir, '.lyzr_agent_id');
    if (!existsSync(idFile)) {
      const agentId = await createLyzrAgent(agentDir, { apiKey: options.apiKey });
      writeFileSync(idFile, agentId, 'utf-8');
      success(`Saved agent ID to .lyzr_agent_id`);
    }

    // Chat
    if (!options.prompt) {
      const agentId = readFileSync(idFile, 'utf-8').trim();
      divider();
      success(`Lyzr agent ready: ${agentId}`);
      info('Run with a prompt:');
      info(`  gitagent lyzr run -r ${options.repo || options.dir} -p "Your message"`);
      if (cleanup) cleanup();
      return;
    }

    await runWithLyzr(agentDir, manifest, {
      prompt: options.prompt,
      apiKey: options.apiKey,
      userId: options.userId,
    });

    if (cleanup) cleanup();
  });

function getInferenceUrl(): string {
  return 'https://agent-prod.studio.lyzr.ai/v3/inference/chat/';
}
