import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportToSystemPrompt } from '../adapters/system-prompt.js';
import { AgentManifest } from '../utils/loader.js';
import { parseModel } from '../utils/model.js';
import { error, info, success, label, heading, divider } from '../utils/format.js';
import { ensureGitHubAuth } from '../utils/auth-provision.js';

const GITHUB_MODELS_BASE_URL = 'https://models.github.ai/inference';

/** Default model when agent.yaml doesn't specify one */
const DEFAULT_MODEL = 'openai/gpt-4.1';

export interface GitHubRunOptions {
  prompt?: string;
  token?: string;
  workspace?: string;
}

/**
 * Map an agent.yaml model preference to a GitHub Models model ID.
 *
 * GitHub Models hosts models under vendor namespaces:
 *   openai/gpt-4.1, openai/o4-mini, meta/llama-4-scout, etc.
 *
 * If the model already has a slash it's used as-is; otherwise we
 * prefix the most likely vendor namespace.
 */
function resolveGitHubModel(model?: string): string {
  // Canonical "provider:model" → GitHub Models "provider/model" namespace.
  if (!model) return DEFAULT_MODEL;
  const { provider, modelId } = parseModel(model);
  return `${provider}/${modelId}`;
}

/**
 * Run an agent via the GitHub Models API (OpenAI-compatible chat completions).
 *
 * Streams the response token-by-token to stdout.
 */
export async function runWithGitHub(
  agentDir: string,
  manifest: AgentManifest,
  options: GitHubRunOptions = {},
): Promise<void> {
  const token = ensureGitHubAuth(options.token);

  if (!options.prompt) {
    error('GitHub Models requires a prompt. Use -p "your message" to provide one.');
    info('Example: gitagent run -d ./my-agent -a github -p "Hello"');
    process.exit(1);
  }

  const systemPrompt = exportToSystemPrompt(agentDir);
  const model = resolveGitHubModel(manifest.model?.preferred);
  const temperature = manifest.model?.constraints?.temperature ?? 0.3;
  const maxTokens = manifest.model?.constraints?.max_tokens ?? 4096;

  info(`Launching GitHub Models agent "${manifest.name}"...`);
  label('Model', model);
  label('Temperature', String(temperature));
  divider();

  const resp = await fetch(`${GITHUB_MODELS_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: options.prompt },
      ],
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    error(`GitHub Models API failed (${resp.status}): ${body}`);
    if (resp.status === 401) {
      info('Make sure your GITHUB_TOKEN has the "models:read" scope.');
      info('Generate one at: https://github.com/settings/tokens');
    }
    process.exit(1);
  }

  // Stream SSE response
  const reader = resp.body?.getReader();
  if (!reader) {
    error('No response body from GitHub Models API');
    process.exit(1);
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;

      try {
        const chunk = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) {
          process.stdout.write(content);
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  // Final newline
  process.stdout.write('\n');
}
