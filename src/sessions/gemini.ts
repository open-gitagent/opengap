/**
 * Gemini CLI session adapter.
 *
 * Gemini stores each session as JSONL at
 *   ~/.gemini/tmp/<projectId>/chats/session-<ts>-<shortid>.jsonl
 * where line 1 is metadata ({sessionId, projectHash, startTime, lastUpdated,
 * kind}) and the remaining lines are either event-sourced `$set` patches (which
 * we ignore) or message records:
 *   { id, timestamp, type: "user"|"gemini"|"info", content, ... }
 * - user.content   is a Part[]  ({text} → message, {functionResponse} → result)
 * - gemini.content is a string  (assistant text); optional `toolCalls[]`,`thoughts`
 * - info           is a UI banner (skipped)
 *
 * The <projectId> dir name is a slug registered in ~/.gemini/projects.json
 * ({ projects: { <absPath>: <slug> } }), which we invert to recover each
 * session's real cwd.
 *
 * WRITE targets Gemini's own `--session-file` import: we emit a session JSONL
 * and the resume command is `gemini --session-file <path>`, which re-homes it
 * into the current project (so we never have to compute project slugs/hashes).
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
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

// Gemini injects synthetic leading user turns that aren't real conversation:
// a <session_context> wrapper and (with the IDE integration) an "editor context
// as a JSON object" blob. Both are dropped on read.
const SYNTHETIC_MSG_RE = /^\s*(<(session_context|environment_context)|Here is the user's editor context as a JSON object)/;

function tmpDir(): string {
  return join(homedir(), '.gemini', 'tmp');
}

/** Invert ~/.gemini/projects.json ({ <absPath>: <slug> }) → slug → absPath. */
function slugToCwd(): Map<string, string> {
  const map = new Map<string, string>();
  const p = join(homedir(), '.gemini', 'projects.json');
  if (!existsSync(p)) return map;
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8'));
    for (const [path, slug] of Object.entries(data?.projects ?? {})) {
      if (typeof slug === 'string') map.set(slug, path);
    }
  } catch {
    /* ignore */
  }
  return map;
}

/** All session files: ~/.gemini/tmp/<slug>/chats/session-*.jsonl */
function sessionFiles(): Array<{ path: string; slug: string }> {
  const base = tmpDir();
  if (!existsSync(base)) return [];
  const out: Array<{ path: string; slug: string }> = [];
  for (const slug of readdirSync(base)) {
    const chats = join(base, slug, 'chats');
    let files: string[] = [];
    try {
      files = readdirSync(chats).filter(f => f.startsWith('session-') && f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of files) out.push({ path: join(chats, f), slug });
  }
  return out;
}

/** Flatten a Gemini Part[] (or string) content to plain text. */
function partsText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('');
  }
  return '';
}

interface ParsedGemini {
  items: CanonicalItem[];
  sessionId?: string;
  createdAt?: string;
}

/**
 * Parse a Gemini session JSONL into canonical items. Pure (no filesystem) so the
 * mapping is unit-testable.
 */
export function parseGeminiSession(content: string): ParsedGemini {
  const items: CanonicalItem[] = [];
  let sessionId: string | undefined;
  let createdAt: string | undefined;
  // Gemini logs an assistant turn's text twice — once as a plain record, then
  // again on the record that carries the tool call. Track the last assistant
  // text to drop that immediate repeat.
  let lastAssistant: string | undefined;

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    // Metadata line (has no message `type`); `$set` journal patches are ignored.
    if (typeof rec.type !== 'string') {
      if (rec.sessionId && !sessionId) sessionId = rec.sessionId;
      if (rec.startTime && !createdAt) createdAt = rec.startTime;
      continue;
    }

    switch (rec.type) {
      case 'user': {
        const parts = Array.isArray(rec.content) ? rec.content : null;
        // functionResponse parts are tool results; text parts are a user turn.
        const fnResponses = parts?.filter((p: any) => p && p.functionResponse) ?? [];
        if (fnResponses.length) {
          for (const p of fnResponses) {
            const fr = p.functionResponse ?? {};
            const resp = fr.response ?? {};
            items.push({
              type: 'tool_result',
              id: fr.id,
              content: typeof resp === 'string' ? resp : JSON.stringify(resp),
              is_error: resp != null && typeof resp === 'object' && 'error' in resp,
            });
          }
          break;
        }
        const text = partsText(rec.content);
        if (text.trim() && !SYNTHETIC_MSG_RE.test(text)) {
          items.push({ type: 'message', role: 'user', text });
          lastAssistant = undefined; // a real user turn ends the assistant run
        }
        break;
      }
      case 'gemini': {
        // tool calls first (they precede their functionResponse turn in the log)
        if (Array.isArray(rec.toolCalls)) {
          for (const tc of rec.toolCalls) {
            if (tc?.name) items.push({ type: 'tool_call', id: tc.id, name: tc.name, args: tc.args ?? {} });
          }
        }
        if (typeof rec.thoughts === 'string' && rec.thoughts.trim()) {
          items.push({ type: 'reasoning', text: rec.thoughts });
        }
        const text = partsText(rec.content);
        // Skip the immediate repeat of the same assistant text (see note above).
        if (text.trim() && text !== lastAssistant) {
          items.push({ type: 'message', role: 'assistant', text });
          lastAssistant = text;
        }
        break;
      }
      // 'info' and anything else are UI banners — skipped.
      default:
        break;
    }
  }
  return { items, sessionId, createdAt };
}

function listGemini(): SessionListEntry[] {
  const cwds = slugToCwd();
  const entries: SessionListEntry[] = [];
  for (const { path, slug } of sessionFiles()) {
    let id = '';
    let updated: string | undefined;
    let summary: string | undefined;
    try {
      const parsed = parseGeminiSession(readFileSync(path, 'utf-8'));
      id = parsed.sessionId ?? '';
      updated = statSync(path).mtime.toISOString();
      const firstUser = parsed.items.find(i => i.type === 'message' && i.role === 'user') as
        | { text?: string }
        | undefined;
      summary = firstUser?.text?.replace(/\s+/g, ' ').slice(0, 60);
    } catch {
      /* skip unreadable */
    }
    if (!id) id = path.split('/').pop()!.replace(/\.jsonl$/, '');
    entries.push({ id, updated_at: updated, summary, cwd: cwds.get(slug) });
  }
  return entries;
}

/** Locate a session file by its metadata sessionId (or filename fallback). */
function findSession(sessionId: string): { path: string; slug: string } | null {
  for (const entry of sessionFiles()) {
    if (entry.path.includes(sessionId)) return entry; // fast path: id in filename
  }
  for (const entry of sessionFiles()) {
    try {
      if (parseGeminiSession(readFileSync(entry.path, 'utf-8')).sessionId === sessionId) return entry;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function readGemini(opts: SessionReadOptions): CanonicalSession {
  const found = findSession(opts.sessionId);
  if (!found) throw new Error(`Gemini session not found: ${opts.sessionId}`);
  const parsed = parseGeminiSession(readFileSync(found.path, 'utf-8'));
  return {
    schema_version: SESSION_SCHEMA_VERSION,
    source: 'gemini',
    session_id: parsed.sessionId ?? opts.sessionId,
    created_at: parsed.createdAt,
    cwd: slugToCwd().get(found.slug),
    items: parsed.items,
  };
}

/** 32-char hex id, matching Gemini's own message id shape. */
function hexId(): string {
  return randomUUID().replace(/-/g, '');
}

/** Wrap a tool_result's content as a Gemini functionResponse `response` object. */
function toResponse(content: string, isError: boolean): Record<string, unknown> {
  if (isError) return { error: content };
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
  } catch {
    /* not JSON — wrap as output */
  }
  return { output: content };
}

/**
 * Write a canonical session as a Gemini `--session-file` JSONL. Carries
 * user/assistant turns (+ memory as a leading assistant turn). Tool steps ARE
 * carried when they have ids (tool_call → a `gemini` record with `toolCalls`,
 * tool_result → a `user` record with a `functionResponse`), paired by id so
 * Gemini's history reconstruction matches them. Sources that link tool calls by
 * order rather than id (e.g. gitagent) have no ids, so their tool steps are
 * dropped rather than emitted unpaired. Resume: `cd <cwd> && gemini --session-file <path>`.
 */
function writeGemini(session: CanonicalSession, opts: SessionWriteOptions): SessionWriteResult {
  const cwd = opts.dir ?? session.cwd ?? process.cwd();
  const sessionId = opts.sessionId ?? randomUUID();
  const nowIso = session.created_at ?? new Date().toISOString();

  const lines: string[] = [];
  // Metadata (line 1). Gemini's loader ONLY accepts the file if this line has
  // BOTH sessionId and projectHash (isPartialMetadataRecord); projectHash is
  // sha256(projectRoot). Gemini re-homes/overrides these on --session-file import.
  const projectHash = createHash('sha256').update(cwd).digest('hex');
  lines.push(JSON.stringify({ sessionId, projectHash, startTime: nowIso, lastUpdated: nowIso, kind: 'main' }));

  const pushUser = (text: string) =>
    lines.push(JSON.stringify({ id: hexId(), timestamp: nowIso, type: 'user', content: [{ text }] }));
  const pushGemini = (text: string) =>
    lines.push(JSON.stringify({ id: hexId(), timestamp: nowIso, type: 'gemini', content: text }));

  // Carry cross-session memory as a leading assistant turn.
  const memText = (session.memory ?? [])
    .map(m => m.text.trim())
    .filter(Boolean)
    .join('\n\n');
  if (memText) pushGemini(`Context I remember about you from previous sessions:\n\n${memText}`);

  // tool_result records reference their call by id; resolve the call's name for
  // the functionResponse, and only emit a result whose call we actually wrote.
  const nameById = new Map<string, string>();
  for (const it of session.items) {
    if (it.type === 'tool_call' && it.id) nameById.set(it.id, it.name);
  }
  const emittedCalls = new Set<string>();

  for (const it of session.items) {
    if (it.type === 'message') {
      if (it.role === 'user') pushUser(it.text);
      else if (it.role === 'assistant') pushGemini(it.text);
      // system prompts are not part of the transcript
    } else if (it.type === 'tool_call') {
      if (it.id) {
        lines.push(
          JSON.stringify({
            id: hexId(),
            timestamp: nowIso,
            type: 'gemini',
            content: '',
            toolCalls: [{ id: it.id, name: it.name, args: it.args ?? {} }],
          }),
        );
        emittedCalls.add(it.id);
      }
      // no id → can't pair with a result, so drop (sources like gitagent)
    } else if (it.type === 'tool_result') {
      if (it.id && emittedCalls.has(it.id)) {
        lines.push(
          JSON.stringify({
            id: hexId(),
            timestamp: nowIso,
            type: 'user',
            content: [
              {
                functionResponse: {
                  id: it.id,
                  name: nameById.get(it.id) ?? 'tool',
                  response: toResponse(it.content, it.is_error === true),
                },
              },
            ],
          }),
        );
      }
    }
    // reasoning is dropped
  }

  mkdirSync(cwd, { recursive: true });
  const file = join(cwd, `gemini-session-${sessionId.slice(0, 8)}.jsonl`);
  writeFileSync(file, lines.join('\n') + '\n', 'utf-8');

  return {
    paths: [file],
    resumeHint: `cd ${cwd} && gemini --session-file ${file}`,
  };
}

export const geminiAdapter: SessionAdapter = {
  name: 'gemini',
  list: listGemini,
  read: readGemini,
  write: writeGemini,
};
