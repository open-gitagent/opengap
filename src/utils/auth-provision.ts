import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { info, warn, error } from './format.js';

/**
 * Resolve the Anthropic API key from environment variables.
 * Checks ANTHROPIC_API_KEY and ANTHROPIC_OAUTH_TOKEN.
 */
export function resolveAnthropicKey(): string | null {
  return process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_OAUTH_TOKEN ?? null;
}

/**
 * Resolve the OpenAI API key from environment variables.
 */
export function resolveOpenAIKey(): string | null {
  return process.env.OPENAI_API_KEY ?? null;
}

type JsonObject = Record<string, unknown>;

/**
 * Read a JSON config file that may hold credentials.
 * Returns {} if it does not exist. Exits with an error (instead of
 * overwriting) if the file exists but cannot be parsed.
 */
function readJsonConfig(path: string): JsonObject {
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data as JsonObject;
  } catch { /* fall through */ }
  error(`Could not parse ${path}; refusing to overwrite it.`);
  info('Fix or move the file, then run the command again.');
  process.exit(1);
}

/** Write a credentials-bearing JSON file readable only by the current user. */
function writeSecureJson(path: string, data: JsonObject): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best effort (e.g. Windows) */ }
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

/**
 * Ensure OpenClaw has Anthropic auth configured.
 * Writes auth-profiles.json if ANTHROPIC_API_KEY is set but OpenClaw isn't configured.
 */
export function ensureOpenClawAuth(): void {
  const agentDir = join(homedir(), '.openclaw', 'agents', 'main', 'agent');
  const authPath = join(agentDir, 'auth-profiles.json');

  // Check if already configured with valid profiles
  const existing = readJsonConfig(authPath);
  if (Object.keys(asObject(existing.profiles)).length > 0) {
    return; // Already configured
  }

  const key = resolveAnthropicKey();
  if (!key) {
    error('No Anthropic API key found for OpenClaw.');
    info('Set ANTHROPIC_API_KEY or run: openclaw onboard');
    process.exit(1);
  }

  const store = {
    version: 1,
    ...existing,
    profiles: {
      ...asObject(existing.profiles),
      'anthropic:api': {
        type: 'api_key',
        provider: 'anthropic',
        key,
      },
    },
  };
  writeSecureJson(authPath, store);
  info('Auto-configured OpenClaw auth from ANTHROPIC_API_KEY');
}

/**
 * Ensure Nanobot has API key configured.
 * Writes ~/.nanobot/config.json if ANTHROPIC_API_KEY is set but Nanobot isn't configured.
 */
export function ensureNanobotAuth(): void {
  const configDir = join(homedir(), '.nanobot');
  const configPath = join(configDir, 'config.json');

  // Check if already configured
  const existing = readJsonConfig(configPath);
  if (Object.keys(asObject(existing.providers)).length > 0) {
    return; // Already configured
  }

  const key = resolveAnthropicKey();
  if (!key) {
    error('No API key found for Nanobot.');
    info('Set ANTHROPIC_API_KEY or configure ~/.nanobot/config.json');
    process.exit(1);
  }

  const config = {
    ...existing,
    providers: {
      ...asObject(existing.providers),
      anthropic: { apiKey: key },
    },
  };
  writeSecureJson(configPath, config);
  info('Auto-configured Nanobot auth from ANTHROPIC_API_KEY');
}

/**
 * Resolve the Lyzr API key from environment variables or an explicit value.
 */
export function resolveLyzrApiKey(explicit?: string): string | null {
  return explicit ?? process.env.LYZR_API_KEY ?? null;
}

/**
 * Ensure a Lyzr API key is available.
 * Accepts an optional explicit key; falls back to LYZR_API_KEY env var.
 * Exits with an error if neither is set.
 */
export function ensureLyzrAuth(explicit?: string): string {
  const key = resolveLyzrApiKey(explicit);
  if (!key) {
    error('No Lyzr API key found.');
    info('Set LYZR_API_KEY or pass --api-key <key>');
    process.exit(1);
  }
  return key;
}

/**
 * Resolve a GitHub token from an explicit value or environment variables.
 * Checks GITHUB_TOKEN and GH_TOKEN.
 */
export function resolveGitHubToken(explicit?: string): string | null {
  return explicit ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
}

/**
 * Ensure a GitHub token is available for the GitHub Models API.
 * Accepts an optional explicit token; falls back to GITHUB_TOKEN / GH_TOKEN env vars.
 * Exits with an error if none is set.
 */
export function ensureGitHubAuth(explicit?: string): string {
  const token = resolveGitHubToken(explicit);
  if (!token) {
    error('No GitHub token found.');
    info('Set GITHUB_TOKEN or GH_TOKEN with the "models:read" scope.');
    info('Generate one at: https://github.com/settings/tokens');
    process.exit(1);
  }
  return token;
}
