/**
 * Canonical, tool-neutral session format — the hub that every tool's native
 * session format reads into / writes out of.
 *
 * Mirrors spec/schemas/session.schema.json. Keep the two in sync.
 */

export const SESSION_SCHEMA_VERSION = '0.1.0';

export interface CanonicalMessage {
  type: 'message';
  role: 'user' | 'assistant' | 'system';
  text: string;
}

export interface CanonicalToolCall {
  type: 'tool_call';
  /** Links to the matching tool_result. Synthesized for tools that link by order. */
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

export interface CanonicalToolResult {
  type: 'tool_result';
  id?: string;
  content: string;
  is_error?: boolean;
}

export interface CanonicalReasoning {
  type: 'reasoning';
  text: string;
}

export type CanonicalItem =
  | CanonicalMessage
  | CanonicalToolCall
  | CanonicalToolResult
  | CanonicalReasoning;

export interface CanonicalMemoryFact {
  kind?: string;
  text: string;
}

export interface CanonicalSession {
  schema_version: string;
  source: string;
  session_id?: string;
  created_at?: string;
  cwd?: string;
  summary?: string;
  items: CanonicalItem[];
  memory?: CanonicalMemoryFact[];
}

/** Lightweight descriptor returned by `list`. */
export interface SessionListEntry {
  id: string;
  updated_at?: string;
  summary?: string;
  cwd?: string;
}

/**
 * A per-tool session adapter. Not every tool implements every capability
 * (e.g. read-only tools omit `write`). Options are tool-specific bags.
 */
export interface SessionAdapter {
  /** Tool identifier, e.g. "copilot" | "claude" | "gitagent". */
  name: string;
  /** List available sessions for this tool. */
  list?(opts?: SessionListOptions): SessionListEntry[];
  /** Read a native session into the canonical format. */
  read?(opts: SessionReadOptions): CanonicalSession;
  /** Write a canonical session out to this tool's native format. */
  write?(session: CanonicalSession, opts: SessionWriteOptions): SessionWriteResult;
}

export interface SessionListOptions {
  /** Agent directory (gitagent) or scope hint. */
  dir?: string;
}

export interface SessionReadOptions {
  /** Source session id (Copilot/Claude uuid, gitagent branch, ...). */
  sessionId: string;
  /** Agent directory, for tools whose sessions live under an agent (gitagent). */
  dir?: string;
}

export interface SessionWriteOptions {
  /** Target agent directory (gitagent) or working dir (claude). */
  dir?: string;
  /** Explicit session/branch id to write under. */
  sessionId?: string;
}

export interface SessionWriteResult {
  /** Files written. */
  paths: string[];
  /** Human-readable instruction for how to resume the written session. */
  resumeHint: string;
}

/** Registry of tool name → adapter. Adapters register here. */
export const sessionAdapters: Record<string, SessionAdapter> = {};

export function registerSessionAdapter(adapter: SessionAdapter): void {
  sessionAdapters[adapter.name] = adapter;
}

export function getSessionAdapter(name: string): SessionAdapter {
  const a = sessionAdapters[name];
  if (!a) {
    throw new Error(
      `Unknown session tool: "${name}". Available: ${Object.keys(sessionAdapters).join(', ') || '(none registered)'}`,
    );
  }
  return a;
}
