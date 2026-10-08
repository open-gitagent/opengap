import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { exportToLyzr } from '../adapters/lyzr.js';
import { AgentManifest } from '../utils/loader.js';
import { error, info, success, label, heading, divider } from '../utils/format.js';
import { ensureLyzrAuth } from '../utils/auth-provision.js';

const LYZR_AGENT_BASE_URL = 'https://agent-prod.studio.lyzr.ai';

export interface LyzrRunOptions {
  prompt?: string;
  apiKey?: string;
  userId?: string;
  workspace?: string;
}

/**
 * Resolve the user_id sent with Lyzr chat requests.
 * Precedence: explicit option, LYZR_USER_ID env var, then a stable
 * non-secret identifier derived from a hash of the API key.
 * The API key itself is never used as the user ID.
 */
export function resolveLyzrUserId(apiKey: string, userId?: string): string {
  if (userId) return userId;
  const fromEnv = process.env.LYZR_USER_ID;
  if (fromEnv) return fromEnv;
  const digest = createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
  return `gitagent-${digest}`;
}

/**
 * Create a new Lyzr agent from a gitagent directory.
 * Returns the agent_id from Lyzr Studio.
 */
export async function createLyzrAgent(agentDir: string, options: LyzrRunOptions = {}): Promise<string> {
  const apiKey = ensureLyzrAuth(options.apiKey);
  const payload = exportToLyzr(agentDir);

  info(`Creating Lyzr agent "${payload.name}"...`);
  label('Provider', payload.provider_id);
  label('Model', payload.model);

  const resp = await fetch(`${LYZR_AGENT_BASE_URL}/v3/agents/template/single-task`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const body = await resp.text();
    error(`Failed to create agent (${resp.status}): ${body}`);
    process.exit(1);
  }

  const data = await resp.json() as { agent_id?: string; [key: string]: unknown };

  if (!data.agent_id) {
    error('No agent_id returned from Lyzr API');
    error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  success(`Agent created: ${data.agent_id}`);
  return data.agent_id;
}

/**
 * Update an existing Lyzr agent with the current gitagent definition.
 * Fetches the existing agent, merges with the local export, then PUTs.
 */
export async function updateLyzrAgent(agentDir: string, agentId: string, options: LyzrRunOptions = {}): Promise<void> {
  const apiKey = ensureLyzrAuth(options.apiKey);

  // Fetch existing agent to merge
  const safeAgentId = encodeURIComponent(agentId);
  info(`Fetching existing agent ${agentId}...`);
  const getResp = await fetch(`${LYZR_AGENT_BASE_URL}/v3/agents/${safeAgentId}`, {
    headers: { 'x-api-key': apiKey },
  });

  if (!getResp.ok) {
    error(`Failed to fetch agent (${getResp.status}): ${await getResp.text()}`);
    process.exit(1);
  }

  const existing = await getResp.json() as Record<string, unknown>;
  const payload = exportToLyzr(agentDir);

  // Merge: new payload overrides existing
  const merged = { ...existing, ...payload };

  info(`Updating agent "${payload.name}" (${agentId})...`);

  const resp = await fetch(`${LYZR_AGENT_BASE_URL}/v3/agents/template/single-task/${safeAgentId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(merged),
  });

  if (!resp.ok) {
    const body = await resp.text();
    error(`Failed to update agent (${resp.status}): ${body}`);
    process.exit(1);
  }

  success(`Agent updated: ${agentId}`);
}

/**
 * Run/chat with a Lyzr agent.
 *
 * If no .lyzr_agent_id file exists in the agent directory, the agent is
 * created on Lyzr Studio first and the ID is saved for reuse.
 * Then sends the prompt via the inference chat endpoint.
 */
export async function runWithLyzr(agentDir: string, manifest: AgentManifest, options: LyzrRunOptions = {}): Promise<void> {
  const apiKey = ensureLyzrAuth(options.apiKey);

  // Lyzr requires a prompt (no interactive mode)
  if (!options.prompt) {
    error('Lyzr requires a prompt. Use -p "your message" to provide one.');
    info('Example: gitagent run -r <url> -a lyzr -p "Review my auth module"');
    process.exit(1);
  }

  // Resolve or create agent on Lyzr
  const agentIdFile = join(agentDir, '.lyzr_agent_id');
  let agentId: string;

  if (existsSync(agentIdFile)) {
    agentId = readFileSync(agentIdFile, 'utf-8').trim();
    info(`Using existing Lyzr agent: ${agentId}`);
  } else {
    info('No .lyzr_agent_id found — creating agent on Lyzr...');
    agentId = await createLyzrAgent(agentDir, options);
    writeFileSync(agentIdFile, agentId, 'utf-8');
    info(`Saved agent ID to .lyzr_agent_id`);
  }

  divider();

  // Build chat request
  const userId = resolveLyzrUserId(apiKey, options.userId);
  const sessionId = `${agentId}-${randomBytes(4).toString('hex')}`;

  info(`Launching Lyzr agent "${manifest.name}"...`);

  const resp = await fetch(`${LYZR_AGENT_BASE_URL}/v3/inference/chat/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      user_id: userId,
      agent_id: agentId,
      session_id: sessionId,
      message: options.prompt,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    error(`Chat failed (${resp.status}): ${body}`);
    info('Make sure your LYZR_API_KEY is valid and the agent exists on Lyzr Studio');
    process.exit(1);
  }

  const data = await resp.json() as { response?: string; result?: string; message?: string; [key: string]: unknown };

  // The API may return the response in different fields
  const response = data.response || data.result || data.message || JSON.stringify(data, null, 2);
  console.log(response);
}
