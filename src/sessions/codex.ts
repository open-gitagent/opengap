/**
 * OpenAI Codex CLI session adapter (read + list).
 *
 * Sessions live at ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl using
 * the OpenAI Responses API shape. A `~/.codex/session_index.jsonl` holds
 * {id, thread_name, updated_at} used for nicer list summaries.
 *
 * Read-only for now: `write` (a resumable rollout) requires reverse-engineering
 * what `codex resume` validates — added in a later phase.
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
import {
  CanonicalItem,
  CanonicalSession,
  SESSION_SCHEMA_VERSION,
  SessionAdapter,
  SessionListEntry,
  SessionReadOptions,
  SessionWriteOptions,
  SessionWriteResult,
} from './canonical.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Codex injects synthetic context messages (cwd/sandbox via <environment_context>,
// AGENTS.md via <user_instructions>, sandbox rules via <permissions instructions>)
// as leading user/developer turns. They aren't real conversation, so we drop them
// on read and ignore them when picking a title.
const SYNTHETIC_MSG_RE = /^\s*<(environment_context|user_instructions|permissions[ _]instructions)/;

function sessionsDir(): string {
  return join(homedir(), '.codex', 'sessions');
}
function indexPath(): string {
  return join(homedir(), '.codex', 'session_index.jsonl');
}

/** All rollout files (recursive), newest last by path (date-partitioned). */
function rolloutFiles(): string[] {
  const base = sessionsDir();
  if (!existsSync(base)) return [];
  let rel: string[] = [];
  try {
    rel = readdirSync(base, { recursive: true }) as string[];
  } catch {
    return [];
  }
  return rel
    .filter(p => /rollout-.*\.jsonl$/.test(p))
    .map(p => join(base, p))
    .sort();
}

/** The uuid is the trailing segment of the filename: rollout-<ts>-<uuid>.jsonl */
function idFromFile(path: string): string {
  const base = path.split('/').pop() ?? '';
  const m = base.match(/rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return m ? m[1] : base.replace(/\.jsonl$/, '');
}

/** thread_name lookup from session_index.jsonl. */
function indexSummaries(): Map<string, string> {
  const map = new Map<string, string>();
  const p = indexPath();
  if (!existsSync(p)) return map;
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o.id && o.thread_name) map.set(o.id, o.thread_name);
    } catch {
      /* skip */
    }
  }
  return map;
}

/** Read the session_meta (first line) of a rollout for id/cwd/timestamp. */
function readMeta(path: string): { id?: string; cwd?: string; created?: string } {
  try {
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      const o = JSON.parse(line);
      if (o.type === 'session_meta') {
        const p = o.payload ?? {};
        return { id: p.id, cwd: p.cwd, created: p.timestamp ?? o.timestamp };
      }
      break; // session_meta is the first record
    }
  } catch {
    /* ignore */
  }
  return {};
}

function listCodex(): SessionListEntry[] {
  const summaries = indexSummaries();
  return rolloutFiles().map(path => {
    const id = idFromFile(path);
    const meta = readMeta(path);
    return { id, summary: summaries.get(id), updated_at: meta.created, cwd: meta.cwd };
  });
}

function findRollout(sessionId: string): string | null {
  for (const path of rolloutFiles()) {
    if (idFromFile(path) === sessionId) return path;
  }
  return null;
}

/** Flatten a Codex message payload's content blocks to text. */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(c => (typeof c === 'string' ? c : typeof c?.text === 'string' ? c.text : ''))
      .join('');
  }
  return '';
}

/**
 * Parse a Codex rollout (JSONL) into canonical items. Pure (no filesystem), so
 * the mapping + synthetic-message filtering is unit-testable. Reads conversation
 * from `response_item` records; `event_msg`/`turn_context`/`token_count` are the
 * UI/telemetry log and are ignored on read.
 */
export function parseRollout(content: string): { items: CanonicalItem[]; cwd?: string; createdAt?: string } {
  const items: CanonicalItem[] = [];
  let cwd: string | undefined;
  let createdAt: string | undefined;

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === 'session_meta') {
      cwd = entry.payload?.cwd;
      createdAt = entry.payload?.timestamp ?? entry.timestamp;
      continue;
    }
    if (entry.type !== 'response_item') continue; // skip event_msg / turn_context / token_count
    const p = entry.payload ?? {};
    switch (p.type) {
      case 'message': {
        const role: 'user' | 'assistant' | 'system' =
          p.role === 'user' ? 'user' : p.role === 'assistant' ? 'assistant' : 'system';
        const text = messageText(p.content);
        // Skip Codex's synthetic context injections — not real conversation.
        if (text.trim() && !SYNTHETIC_MSG_RE.test(text)) items.push({ type: 'message', role, text });
        break;
      }
      case 'function_call': {
        let args: Record<string, unknown> = {};
        try {
          args = typeof p.arguments === 'string' ? JSON.parse(p.arguments) : p.arguments ?? {};
        } catch {
          args = { _raw: p.arguments };
        }
        items.push({ type: 'tool_call', id: p.call_id, name: p.name, args });
        break;
      }
      case 'function_call_output':
        items.push({
          type: 'tool_result',
          id: p.call_id,
          content: typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? ''),
        });
        break;
      // 'reasoning' is encrypted (encrypted_content) — not carryable; skip.
      default:
        break;
    }
  }
  return { items, cwd, createdAt };
}

function readCodex(opts: SessionReadOptions): CanonicalSession {
  const path = findRollout(opts.sessionId);
  if (!path) throw new Error(`Codex session not found: rollout for ${opts.sessionId}`);

  const { items, cwd, createdAt } = parseRollout(readFileSync(path, 'utf-8'));

  return {
    schema_version: SESSION_SCHEMA_VERSION,
    source: 'codex',
    session_id: opts.sessionId,
    created_at: createdAt,
    cwd,
    items,
  };
}

/**
 * Find the current Codex state DB. It is version-suffixed (`state_5.sqlite`);
 * newer CLI releases bump the number, so pick the highest.
 */
function findStateDb(): string | null {
  const base = join(homedir(), '.codex');
  if (!existsSync(base)) return null;
  const dbs = readdirSync(base)
    .filter(f => /^state_\d+\.sqlite$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return dbs.length ? join(base, dbs[dbs.length - 1]) : null;
}

/**
 * Ensure everything needed to register a session exists BEFORE we write files,
 * so we never leave a rollout that the picker can't see. Returns the state DB.
 */
function requireCodexStore(): string {
  try {
    const mod = nodeRequire('node:sqlite') as typeof import('node:sqlite');
    if (!mod?.DatabaseSync) throw new Error('missing DatabaseSync');
  } catch {
    throw new Error('Writing a Codex session requires the built-in node:sqlite module (Node 22.5+).');
  }
  const db = findStateDb();
  if (!db) {
    throw new Error('Codex state DB (~/.codex/state_*.sqlite) not found — is the Codex CLI installed and run at least once?');
  }
  return db;
}

/**
 * The cli_version + model Codex last recorded (from its own threads), so an
 * imported rollout matches this install rather than hardcoded values that could
 * fail a resume-time model allowlist.
 */
function threadDefaults(dbPath: string): { cliVersion: string; model?: string } {
  try {
    const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    try {
      const row = db
        .prepare("SELECT cli_version, model FROM threads WHERE cli_version <> '' ORDER BY created_at DESC LIMIT 1")
        .get() as { cli_version?: string; model?: string } | undefined;
      const modelRow = db
        .prepare("SELECT model FROM threads WHERE model IS NOT NULL AND model <> '' ORDER BY created_at DESC LIMIT 1")
        .get() as { model?: string } | undefined;
      return { cliVersion: row?.cli_version || '0.0.0', model: modelRow?.model || row?.model || undefined };
    } finally {
      db.close();
    }
  } catch {
    return { cliVersion: '0.0.0' };
  }
}

/**
 * The model_context_window Codex records in a real rollout's task_started event,
 * so the imported session reports the same window. Scans real rollouts newest
 * first (only the first few records — task_started is near the top).
 */
function detectContextWindow(): number | undefined {
  const files = rolloutFiles();
  for (let i = files.length - 1; i >= 0; i--) {
    try {
      let n = 0;
      for (const line of readFileSync(files[i], 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        if (++n > 30) break;
        const o = JSON.parse(line);
        if (o.type === 'event_msg' && o.payload?.type === 'task_started' && typeof o.payload.model_context_window === 'number') {
          return o.payload.model_context_window;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/** Timestamp for a rollout filename: YYYY-MM-DDTHH-MM-SS (from an ISO string). */
function fileStamp(iso: string): string {
  return iso.replace(/\.\d+Z?$/, '').replace(/:/g, '-');
}

/** Best-effort git metadata for the session_meta `git` block (null outside a repo). */
function gitInfo(cwd: string): { commit_hash: string; branch: string; repository_url?: string } | null {
  const run = (args: string[]): string | undefined => {
    try {
      return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || undefined;
    } catch {
      return undefined;
    }
  };
  const commit_hash = run(['rev-parse', 'HEAD']);
  if (!commit_hash) return null; // not a repo (or no commits)
  return {
    commit_hash,
    branch: run(['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'HEAD',
    repository_url: run(['config', '--get', 'remote.origin.url']),
  };
}

// A minimal workspace-write sandbox policy; Codex stores this per thread and the
// picker requires the column to be non-null.
const DEFAULT_SANDBOX_POLICY = '{"type":"workspace-write","network_access":false,"exclude_tmpdir_env_var":false,"exclude_slash_tmp":false}';

/**
 * Write a canonical session as a Codex rollout AND register it in the state DB
 * `threads` table (the index `codex resume` reads — visible only when `preview`
 * is non-empty). BEST-EFFORT: the rollout schema is undocumented; verify with
 * `codex resume` and iterate on any validation errors.
 */
function writeCodex(session: CanonicalSession, opts: SessionWriteOptions): SessionWriteResult {
  if (opts.sessionId && !UUID_RE.test(opts.sessionId)) {
    throw new Error(`codex --session-id must be a UUID, got: ${opts.sessionId}`);
  }
  // Fail before writing anything if we can't register the session afterwards.
  const stateDb = requireCodexStore();
  const sessionId = opts.sessionId ?? randomUUID();
  const cwd = opts.dir ?? session.cwd ?? process.cwd();
  const nowIso = new Date().toISOString();
  const defaults = threadDefaults(stateDb);
  const cliVersion = defaults.cliVersion;
  const d = new Date(nowIso);
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');

  const dir = join(sessionsDir(), yyyy, mm, dd);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `rollout-${fileStamp(nowIso)}-${sessionId}.jsonl`);

  const lines: string[] = [];
  const emit = (type: string, payload: Record<string, unknown>) =>
    lines.push(JSON.stringify({ timestamp: nowIso, type, payload }));

  // Carry cross-session memory as a leading assistant message.
  const memText = (session.memory ?? [])
    .map(m => m.text.trim())
    .filter(Boolean)
    .join('\n\n');
  const items: CanonicalItem[] = memText
    ? [{ type: 'message', role: 'assistant', text: `Context I remember about you from previous sessions:\n\n${memText}` }, ...session.items]
    : session.items;

  const turnId = randomUUID();
  const startedAt = Math.floor(d.getTime() / 1000);
  // Prefer what this Codex install actually uses (from its own threads/rollouts)
  // over hardcoded values, in case resume validates the model/window.
  const model = defaults.model ?? 'gpt-5.5';
  const modelContextWindow = detectContextWindow() ?? 258400;
  const currentDate = `${yyyy}-${mm}-${dd}`;
  let timezone = 'UTC';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    /* keep UTC */
  }
  const sandboxPolicy = { type: 'workspace-write', network_access: false, exclude_tmpdir_env_var: false, exclude_slash_tmp: false };
  const git = gitInfo(cwd);

  // session_meta — current Codex records both session_id and id, plus a
  // context_window id and (inside a repo) git metadata.
  emit('session_meta', {
    session_id: sessionId,
    id: sessionId,
    timestamp: nowIso,
    cwd,
    originator: 'opengap',
    cli_version: cliVersion,
    source: 'cli',
    thread_source: 'user',
    model_provider: 'openai',
    base_instructions: { text: '' },
    history_mode: 'legacy',
    context_window: { window_id: randomUUID() },
    ...(git ? { git } : {}),
  });

  // The picker reconciles each thread FROM its rollout, so we emit the same
  // scaffolding a native session has: a started turn plus its context.
  emit('event_msg', {
    type: 'task_started',
    turn_id: turnId,
    started_at: startedAt,
    model_context_window: modelContextWindow,
    collaboration_mode_kind: 'default',
  });
  emit('turn_context', {
    turn_id: turnId,
    cwd,
    workspace_roots: [cwd],
    current_date: currentDate,
    timezone,
    approval_policy: 'on-request',
    sandbox_policy: sandboxPolicy,
    model,
  });

  let lastAssistant = '';
  for (const it of items) {
    if (it.type === 'message') {
      const role = it.role === 'system' ? 'developer' : it.role;
      const blockType = it.role === 'assistant' ? 'output_text' : 'input_text';
      // event_msg drives the picker's title/preview and marks real user
      // activity; response_item is what `codex resume` replays into the model.
      if (it.role === 'user') {
        emit('event_msg', { type: 'user_message', message: it.text, images: [], local_images: [], text_elements: [] });
      } else if (it.role === 'assistant') {
        emit('event_msg', { type: 'agent_message', message: it.text, phase: 'final_answer', memory_citation: null });
        lastAssistant = it.text;
      }
      emit('response_item', { type: 'message', role, content: [{ type: blockType, text: it.text }] });
    } else if (it.type === 'tool_call') {
      emit('response_item', {
        type: 'function_call',
        name: it.name,
        arguments: JSON.stringify(it.args ?? {}),
        call_id: it.id ?? randomUUID(),
      });
    } else if (it.type === 'tool_result') {
      emit('response_item', { type: 'function_call_output', call_id: it.id ?? '', output: it.content });
    }
    // reasoning skipped (Codex reasoning is encrypted)
  }

  emit('event_msg', {
    type: 'task_complete',
    turn_id: turnId,
    last_agent_message: lastAssistant,
    completed_at: startedAt,
    duration_ms: 0,
    time_to_first_token_ms: 0,
  });

  writeFileSync(file, lines.join('\n') + '\n', 'utf-8');

  // Register the session in the state DB `threads` table — the index that
  // `codex resume` actually lists. `preview` must be non-empty to be visible.
  // Prefer the first real user turn; skip Codex's synthetic <environment_context>
  // / <user_instructions> wrapper messages so the picker shows meaningful text.
  const firstUser = (
    items.find(
      i => i.type === 'message' && i.role === 'user' && !SYNTHETIC_MSG_RE.test(i.text),
    ) as { text?: string } | undefined
  )?.text;
  const summary = (session.summary ?? firstUser ?? 'Imported session').replace(/\s+/g, ' ').trim().slice(0, 120);
  const nowSec = Math.floor(d.getTime() / 1000);
  const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
  const db = new DatabaseSync(stateDb);
  try {
    db.prepare('DELETE FROM threads WHERE id = ?').run(sessionId); // idempotent re-import
    db.prepare(
      `INSERT INTO threads
         (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
          sandbox_policy, approval_mode, cli_version, first_user_message, preview, model,
          has_user_event, history_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId, file, nowSec, nowSec, 'cli', 'openai', cwd, summary,
      DEFAULT_SANDBOX_POLICY, 'on-request', cliVersion, summary, summary, model,
      1, 'legacy',
    );
  } finally {
    db.close();
  }

  return {
    paths: [file, stateDb],
    resumeHint: `Codex session ${sessionId} registered. Resume with:  codex resume   (pick it from the list, or 'codex resume --last').`,
  };
}

export const codexAdapter: SessionAdapter = {
  name: 'codex',
  list: listCodex,
  read: readCodex,
  write: writeCodex,
};
