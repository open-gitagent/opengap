/**
 * Canonical model-string handling for gitagent manifests.
 *
 * The canonical format is "provider:model-id" (colon-separated), e.g.
 *   anthropic:claude-opus-4-8
 *   openai:gpt-4o
 *   openai:gpt-4o@https://my-host:8080   (custom OpenAI-compatible endpoint)
 *
 * Parsing splits on the FIRST colon only: everything before is the provider,
 * everything after is the model id (so an "@host:port" suffix stays intact).
 */

/** Providers recognised by the gitagent ecosystem. */
export const KNOWN_PROVIDERS = [
  'amazon-bedrock',
  'anthropic',
  'google',
  'google-gemini-cli',
  'google-antigravity',
  'google-vertex',
  'openai',
  'azure-openai-responses',
  'openai-codex',
  'deepseek',
  'github-copilot',
  'xai',
  'groq',
  'cerebras',
  'openrouter',
  'vercel-ai-gateway',
  'zai',
  'mistral',
  'minimax',
  'minimax-cn',
  'huggingface',
  'fireworks',
  'opencode',
  'opencode-go',
  'kimi-coding',
  'cloudflare-workers-ai',
] as const;

export type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

export interface ParsedModel {
  provider: string;
  modelId: string;
}

/**
 * Parse a canonical "provider:model" string. Splits on the first colon, so any
 * "@https://host:port" suffix remains part of modelId.
 *
 * @throws if the string has no colon (i.e. no provider prefix).
 */
export function parseModel(modelStr: string): ParsedModel {
  const colonIndex = modelStr.indexOf(':');
  if (colonIndex === -1) {
    throw new Error(
      `Invalid model format: "${modelStr}". Expected "provider:model" (e.g. "anthropic:claude-opus-4-8").`,
    );
  }
  return {
    provider: modelStr.slice(0, colonIndex),
    modelId: modelStr.slice(colonIndex + 1),
  };
}

/** Whether a provider string is in the known-providers list. */
export function isKnownProvider(provider: string): provider is KnownProvider {
  return (KNOWN_PROVIDERS as readonly string[]).includes(provider);
}
