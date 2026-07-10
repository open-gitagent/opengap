export interface ProviderInfo {
  provider: string;
  pipPackage: string;
  envVar: string;
}

/**
 * Maps a model name to its LangChain provider info.
 * Returns null for unsupported models.
 *
 * OpenAI coverage: gpt-* and o<digit>-* (o1, o3, o4-mini, …)
 * Anthropic coverage: claude-*
 */
export function detectProvider(model: string): ProviderInfo | null {
  const m = model.toLowerCase();
  if (m.startsWith('claude'))
    return { provider: 'anthropic', pipPackage: 'langchain-anthropic', envVar: 'ANTHROPIC_API_KEY' };
  // Matches gpt-* and OpenAI reasoning models: o1, o3, o4-mini, etc.
  if (m.startsWith('gpt') || /^o\d/.test(m))
    return { provider: 'openai', pipPackage: 'langchain-openai', envVar: 'OPENAI_API_KEY' };
  return null;
}
