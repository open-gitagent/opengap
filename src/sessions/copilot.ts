/**
 * GitHub Copilot CLI session adapter.
 *
 * Sessions live at ~/.copilot/session-state/<id>/events.jsonl (a JSONL event
 * log). We read messages + tool calls from that log. Listing scans the
 * session-state directories (no SQLite dependency).
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
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

function stateDir(): string {
  return join(homedir(), '.copilot', 'session-state');
}

function eventsPath(sessionId: string): string {
  return join(stateDir(), sessionId, 'events.jsonl');
}

interface CopilotEvent {
  type: string;
  data?: Record<string, any>;
  timestamp?: string;
}

function parseEvents(path: string): CopilotEvent[] {
  const out: CopilotEvent[] = [];
  const content = readFileSync(path, 'utf-8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as CopilotEvent);
    } catch {
      /* skip malformed lines */
    }
  }
  return out;
}

function listCopilot(): SessionListEntry[] {
  const dir = stateDir();
  if (!existsSync(dir)) return [];
  const entries: SessionListEntry[] = [];
  for (const id of readdirSync(dir)) {
    const path = eventsPath(id);
    if (!existsSync(path)) continue;
    let cwd: string | undefined;
    let updated: string | undefined;
    try {
      const events = parseEvents(path);
      const start = events.find(e => e.type === 'session.start');
      cwd = start?.data?.context?.cwd ?? start?.data?.cwd;
      updated = events[events.length - 1]?.timestamp ?? start?.data?.startTime;
    } catch {
      /* ignore unreadable session */
    }
    entries.push({ id, cwd, updated_at: updated });
  }
  return entries;
}

function readCopilot(opts: SessionReadOptions): CanonicalSession {
  const path = eventsPath(opts.sessionId);
  if (!existsSync(path)) {
    throw new Error(`Copilot session not found: ${path}`);
  }
  const events = parseEvents(path);
  const items: CanonicalItem[] = [];
  let cwd: string | undefined;
  let createdAt: string | undefined;

  for (const ev of events) {
    const d = ev.data ?? {};
    switch (ev.type) {
      case 'session.start':
        cwd = d.context?.cwd ?? d.cwd;
        createdAt = d.startTime;
        break;
      case 'user.message':
        if (typeof d.content === 'string') {
          items.push({ type: 'message', role: 'user', text: d.content });
        }
        break;
      case 'assistant.message':
        if (typeof d.content === 'string' && d.content.trim()) {
          items.push({ type: 'message', role: 'assistant', text: d.content });
        }
        break;
      case 'tool.execution_start':
        items.push({
          type: 'tool_call',
          id: d.toolCallId,
          name: d.toolName,
          args: d.arguments ?? {},
        });
        break;
      case 'tool.execution_complete': {
        const content =
          typeof d.result?.content === 'string'
            ? d.result.content
            : JSON.stringify(d.result?.content ?? d.result ?? '');
        items.push({
          type: 'tool_result',
          id: d.toolCallId,
          content,
          is_error: d.success === false,
        });
        break;
      }
      default:
        break;
    }
  }

  return {
    schema_version: SESSION_SCHEMA_VERSION,
    source: 'copilot',
    session_id: opts.sessionId,
    created_at: createdAt,
    cwd,
    items,
  };
}

function storeDbPath(): string {
  return join(homedir(), '.copilot', 'session-store.db');
}

/** Walk up from a dir to find the nearest .git root; fall back to the dir itself. */
function findGitRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 30; i++) {
    if (existsSync(join(cur, '.git'))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return start;
}

/** Read the installed Copilot version from an existing real session's log; fallback constant. */
function detectCopilotVersion(): string {
  try {
    const base = stateDir();
    for (const id of readdirSync(base)) {
      const p = join(base, id, 'events.jsonl');
      if (!existsSync(p)) continue;
      const first = readFileSync(p, 'utf-8').split('\n', 1)[0];
      const v = JSON.parse(first)?.data?.copilotVersion;
      if (typeof v === 'string' && v) return v;
    }
  } catch {
    /* ignore */
  }
  return '1.0.68';
}

/** Read a model id from an existing real session's assistant.message; fallback. */
function detectModel(): string {
  try {
    const base = stateDir();
    for (const id of readdirSync(base)) {
      const p = join(base, id, 'events.jsonl');
      if (!existsSync(p)) continue;
      for (const line of readFileSync(p, 'utf-8').split('\n')) {
        if (!line.includes('"assistant.message"')) continue;
        const m = JSON.parse(line)?.data?.model;
        if (typeof m === 'string' && m) return m;
      }
    }
  } catch {
    /* ignore */
  }
  return 'gpt-4o';
}

/** Current branch of a git root (best-effort). */
function gitBranch(gitRoot: string): string {
  try {
    const head = readFileSync(join(gitRoot, '.git', 'HEAD'), 'utf-8').trim();
    const m = head.match(/ref:\s*refs\/heads\/(.+)/);
    return m ? m[1] : 'main';
  } catch {
    return 'main';
  }
}

/** HEAD commit sha of a git root (best-effort, '' if none). */
function gitHeadCommit(gitRoot: string): string {
  try {
    const head = readFileSync(join(gitRoot, '.git', 'HEAD'), 'utf-8').trim();
    if (head.startsWith('ref:')) {
      const ref = head.slice(4).trim();
      return readFileSync(join(gitRoot, '.git', ref), 'utf-8').trim();
    }
    return head;
  } catch {
    return '';
  }
}

/** Pair canonical messages into Copilot turns (user → following assistant text). */
function buildTurns(session: CanonicalSession): { user: string; assistant: string; ts: string }[] {
  const turns: { user: string; assistant: string; ts: string }[] = [];
  const now = session.created_at ?? new Date().toISOString();
  let cur: { user: string; assistant: string; ts: string } | null = null;
  for (const it of session.items) {
    if (it.type !== 'message') continue;
    if (it.role === 'user') {
      if (cur) turns.push(cur);
      cur = { user: it.text, assistant: '', ts: now };
    } else if (it.role === 'assistant') {
      if (!cur) cur = { user: '', assistant: '', ts: now };
      cur.assistant += (cur.assistant ? '\n' : '') + it.text;
    }
  }
  if (cur) turns.push(cur);
  return turns;
}

/** Write the per-session state dir (events.jsonl + the files a real session has). */
function writeSessionState(dir: string, sessionId: string, cwd: string, gitRoot: string, name: string, session: CanonicalSession, nowIso: string): void {
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'files'), { recursive: true });
  mkdirSync(join(dir, 'research'), { recursive: true });
  mkdirSync(join(dir, 'checkpoints'), { recursive: true });
  mkdirSync(join(dir, 'rewind-snapshots'), { recursive: true });

  // events.jsonl — the full event log Copilot replays on resume. Each line MUST
  // be a valid event envelope: { type, data, id:<uuid>, timestamp, parentId }.
  const rawEvents: { type: string; data: Record<string, unknown> }[] = [];
  rawEvents.push({
    type: 'session.start',
    data: {
      sessionId,
      version: 1,
      producer: 'copilot-agent',
      copilotVersion: detectCopilotVersion(),
      startTime: nowIso,
      contextTier: null,
      context: { cwd, gitRoot, branch: gitBranch(gitRoot), headCommit: gitHeadCommit(gitRoot) },
      alreadyInUse: false,
      remoteSteerable: false,
    },
  });
  const model = detectModel();
  for (const it of session.items) {
    if (it.type === 'message') {
      if (it.role === 'system') continue;
      if (it.role === 'user') {
        rawEvents.push({ type: 'user.message', data: { content: it.text } });
      } else {
        rawEvents.push({
          type: 'assistant.message',
          data: {
            messageId: randomUUID(),
            model,
            content: it.text,
            toolRequests: [],
            interactionId: randomUUID(),
            turnId: '0',
          },
        });
      }
    } else if (it.type === 'tool_call') {
      rawEvents.push({
        type: 'tool.execution_start',
        data: { toolCallId: it.id ?? randomUUID(), toolName: it.name, arguments: it.args ?? {} },
      });
    } else if (it.type === 'tool_result') {
      rawEvents.push({
        type: 'tool.execution_complete',
        data: { toolCallId: it.id ?? '', success: it.is_error !== true, result: { content: it.content } },
      });
    }
  }
  // Wrap each event in the envelope Copilot's resume validator requires.
  let parentId: string | null = null;
  const lines = rawEvents.map(e => {
    const id = randomUUID();
    const line = JSON.stringify({ ...e, id, timestamp: nowIso, parentId });
    parentId = id;
    return line;
  });
  writeFileSync(join(dir, 'events.jsonl'), lines.join('\n') + '\n', 'utf-8');

  // workspace.yaml — full field set matching a real session
  writeFileSync(
    join(dir, 'workspace.yaml'),
    [
      `id: ${sessionId}`,
      `cwd: ${cwd}`,
      `git_root: ${gitRoot}`,
      `branch: main`,
      `client_name: opengap`,
      `name: ${name}`,
      `user_named: false`,
      `summary_count: 0`,
      `created_at: ${nowIso}`,
      `updated_at: ${nowIso}`,
      '',
    ].join('\n'),
    'utf-8',
  );

  // checkpoints/index.md + rewind-snapshots/index.json (empty templates)
  writeFileSync(
    join(dir, 'checkpoints', 'index.md'),
    '# Checkpoint History\n\nCheckpoints are listed in chronological order. Checkpoint 1 is the oldest, higher numbers are more recent.\n\n| # | Title | File |\n|---|-------|------|\n',
    'utf-8',
  );
  writeFileSync(join(dir, 'rewind-snapshots', 'index.json'), JSON.stringify({ version: 1, snapshots: [] }, null, 2), 'utf-8');

  // per-session session.db with the tables a real session has (empty)
  const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
  const sdb = new DatabaseSync(join(dir, 'session.db'));
  try {
    sdb.exec(`
      CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','done','blocked')), created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS todo_deps (todo_id TEXT NOT NULL, depends_on TEXT NOT NULL, PRIMARY KEY (todo_id, depends_on));
      CREATE TABLE IF NOT EXISTS inbox_entries (id TEXT PRIMARY KEY, recipient_session_id TEXT NOT NULL, sender_id TEXT NOT NULL, sender_name TEXT NOT NULL, sender_type TEXT NOT NULL, interaction_id TEXT NOT NULL, sequence INTEGER NOT NULL DEFAULT 0, summary TEXT NOT NULL, content TEXT NOT NULL, unread INTEGER NOT NULL DEFAULT 1, sent_at INTEGER NOT NULL, read_at INTEGER, notified_at INTEGER);
    `);
  } finally {
    sdb.close();
  }
}

/** Register the session in the global session-store.db (sessions + turns + FTS). */
function writeStoreDb(sessionId: string, cwd: string, summary: string, session: CanonicalSession, nowIso: string): void {
  const dbPath = storeDbPath();
  if (!existsSync(dbPath)) {
    throw new Error(`Copilot session store not found at ${dbPath} — is the Copilot CLI installed and run at least once?`);
  }
  const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  try {
    // idempotent: clear any prior rows for this id
    db.prepare('DELETE FROM turns WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    try {
      db.prepare('DELETE FROM search_index WHERE session_id = ?').run(sessionId);
    } catch {
      /* FTS optional */
    }

    db.prepare(
      'INSERT INTO sessions (id, cwd, repository, host_type, branch, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(sessionId, cwd, '', '', 'main', summary, nowIso, nowIso);

    const turns = buildTurns(session);
    const insTurn = db.prepare(
      'INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp) VALUES (?, ?, ?, ?, ?)',
    );
    let insSearch: ReturnType<typeof db.prepare> | null = null;
    try {
      insSearch = db.prepare('INSERT INTO search_index (content, session_id, source_type, source_id) VALUES (?, ?, ?, ?)');
    } catch {
      insSearch = null;
    }
    turns.forEach((t, i) => {
      insTurn.run(sessionId, i, t.user, t.assistant, t.ts);
      if (insSearch) {
        try {
          insSearch.run(`${t.user}\n${t.assistant}`, sessionId, 'turn', String(i));
        } catch {
          /* ignore FTS failures */
        }
      }
    });
  } finally {
    db.close();
  }
}

/**
 * Write a canonical session as a fully-registered Copilot session: the
 * per-session state dir (events.jsonl + workspace.yaml + session.db + checkpoints
 * + rewind snapshots) AND rows in the global session-store.db (sessions + turns +
 * FTS), so the Copilot CLI lists and resumes it.
 */
/** Load node:sqlite up front with a clear error, so we never do a partial write. */
function requireSqlite(): void {
  try {
    const mod = nodeRequire('node:sqlite') as typeof import('node:sqlite');
    if (!mod?.DatabaseSync) throw new Error('missing DatabaseSync');
  } catch {
    throw new Error(
      'Writing a Copilot session requires the built-in node:sqlite module (Node 22.5+). ' +
        'Your Node runtime does not provide it — upgrade Node or use a different --to target.',
    );
  }
}

function writeCopilot(session: CanonicalSession, opts: SessionWriteOptions): SessionWriteResult {
  // Fail BEFORE writing any files: both node:sqlite availability and the global
  // store DB must exist, else we'd leave an orphaned session-state dir.
  requireSqlite();
  const dbPath = storeDbPath();
  if (!existsSync(dbPath)) {
    throw new Error(
      `Copilot session store not found at ${dbPath} — is the Copilot CLI installed and run at least once?`,
    );
  }
  const sessionId = opts.sessionId || randomUUID();
  const cwd = opts.dir ?? session.cwd ?? process.cwd();
  const gitRoot = findGitRoot(cwd);
  const nowIso = session.created_at ?? new Date().toISOString();
  const firstUser = session.items.find(i => i.type === 'message' && i.role === 'user') as
    | { text: string }
    | undefined;
  const summary = session.summary ?? (firstUser ? firstUser.text.slice(0, 60) : 'Imported session');

  // Carry cross-session memory into the transcript as leading context, so the
  // target recalls it (memory is the source of truth for tools like gitagent,
  // whose chat-history transcript may be incomplete).
  const memText = (session.memory ?? [])
    .map(m => m.text.trim())
    .filter(Boolean)
    .join('\n\n');
  const items = memText
    ? [
        {
          type: 'message' as const,
          role: 'assistant' as const,
          text: `Context I remember about you from previous sessions:\n\n${memText}`,
        },
        ...session.items,
      ]
    : session.items;
  const effSession: CanonicalSession = { ...session, items };

  const dir = join(stateDir(), sessionId);
  writeSessionState(dir, sessionId, cwd, gitRoot, summary, effSession, nowIso);
  writeStoreDb(sessionId, cwd, summary, effSession, nowIso);

  return {
    paths: [join(dir, 'events.jsonl'), storeDbPath()],
    resumeHint: `Copilot session ${sessionId} registered. Resume with:  copilot --resume ${sessionId}   (run from ${cwd})`,
  };
}

export const copilotAdapter: SessionAdapter = {
  name: 'copilot',
  list: listCopilot,
  read: readCopilot,
  write: writeCopilot,
};
