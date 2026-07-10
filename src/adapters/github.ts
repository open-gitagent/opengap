import { resolve, join } from 'node:path';
import { loadAgentManifest } from '../utils/loader.js';
import { parseModel } from '../utils/model.js';
import { exportToSystemPrompt } from './system-prompt.js';

export interface GitHubModelsPayload {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  max_tokens: number;
  stream: boolean;
}

/**
 * Map an agent.yaml model to a GitHub Models model ID (vendor/model).
 */
function resolveModel(model?: string): string {
  // Canonical "provider:model" → GitHub Models "provider/model" form.
  if (!model) return 'openai/gpt-4.1';
  const { provider, modelId } = parseModel(model);
  return `${provider}/${modelId}`;
}

/**
 * Export a gitagent directory to a GitHub Models API-ready payload.
 */
export function exportToGitHub(dir: string): GitHubModelsPayload {
  const agentDir = resolve(dir);
  const manifest = loadAgentManifest(agentDir);
  const systemPrompt = exportToSystemPrompt(agentDir);

  return {
    model: resolveModel(manifest.model?.preferred),
    messages: [
      { role: 'system', content: systemPrompt },
    ],
    temperature: manifest.model?.constraints?.temperature ?? 0.3,
    max_tokens: manifest.model?.constraints?.max_tokens ?? 4096,
    stream: true,
  };
}

/**
 * String export for `gitagent export --format github`.
 */
export function exportToGitHubString(dir: string): string {
  const payload = exportToGitHub(dir);
  return JSON.stringify(payload, null, 2);
}
