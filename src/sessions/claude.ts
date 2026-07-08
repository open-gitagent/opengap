/**
 * Claude Code session adapter.
 *
 * Sessions live at ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl, using
 * the Anthropic Messages API shape (message.content is an array of blocks:
 * text / tool_use / tool_result / thinking). tool_result blocks live inside a
 * user message.
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
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

/**
 * Encode a cwd into Claude's project-dir name (slashes → dashes).
 * LOSSY BY DESIGN — this matches Claude Code's own scheme, so we can't change it
 * without breaking resume compatibility. Consequence: two cwds that differ only
 * by dash-vs-slash (e.g. "/home/alice-bob/x" vs "/home/alice/bob/x") encode to
 * the same project dir, so their sessions can collide there.
 */
function encodeCwd(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

function projectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

/**
 * Decode Claude's dir name back to a path — LOSSY (dashes in real path segments,
 * e.g. a username like "abhinivesh-s", can't be distinguished from separators).
 * Only a fallback; prefer the real `cwd` recorded inside the transcript.
 */
function decodeCwd(dirName: string): string {
  return dirName.replace(/-/g, '/');
}

/** Read the real cwd from a transcript's leading lines (bounded read). */
function cwdFromTranscript(path: string): string | undefined {
  try {
    const fd = openSync(path, 'r');
    try {
      const buf = Buffer.alloc(32768);
      const n = readSync(fd, buf, 0, buf.length, 0);
      for (const line of buf.toString('utf-8', 0, n).split('\n')) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line);
          if (typeof o.cwd === 'string' && o.cwd) return o.cwd;
        } catch {
          /* partial last line — ignore */
        }
      }
    } finally {
      closeSync(fd);
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/** Find the transcript file for a session uuid across all project dirs. */
function findSessionFile(sessionId: string): { path: string; cwd: string } | null {
  const base = projectsDir();
  if (!existsSync(base)) return null;
  for (const proj of readdirSync(base)) {
    const path = join(base, proj, `${sessionId}.jsonl`);
    if (existsSync(path)) return { path, cwd: cwdFromTranscript(path) ?? decodeCwd(proj) };
  }
  return null;
}

function listClaude(): SessionListEntry[] {
  const base = projectsDir();
  if (!existsSync(base)) return [];
  const entries: SessionListEntry[] = [];
  for (const proj of readdirSync(base)) {
    const projPath = join(base, proj);
    let files: string[] = [];
    try {
      files = readdirSync(projPath).filter(f => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of files) {
      const id = f.replace(/\.jsonl$/, '');
      let updated: string | undefined;
      try {
        updated = statSync(join(projPath, f)).mtime.toISOString();
      } catch {
        /* ignore */
      }
      entries.push({ id, cwd: cwdFromTranscript(join(projPath, f)) ?? decodeCwd(proj), updated_at: updated });
    }
  }
  return entries;
}

/** Flatten a Claude content-block's text (block.content may be string or array). */
function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(c => (typeof c === 'string' ? c : typeof c?.text === 'string' ? c.text : ''))
      .join('');
  }
  return '';
}

function readClaude(opts: SessionReadOptions): CanonicalSession {
  const found = findSessionFile(opts.sessionId);
  if (!found) throw new Error(`Claude Code session not found: ${opts.sessionId}.jsonl`);

  const items: CanonicalItem[] = [];
  const content = readFileSync(found.path, 'utf-8');

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    const msg = entry.message;
    if (!msg) continue;
    const role: 'user' | 'assistant' = entry.type;
    const blocks = Array.isArray(msg.content)
      ? msg.content
      : [{ type: 'text', text: String(msg.content ?? '') }];

    for (const b of blocks) {
      switch (b?.type) {
        case 'text':
          if (b.text?.trim()) items.push({ type: 'message', role, text: b.text });
          break;
        case 'thinking':
          if (b.thinking?.trim?.() || b.text?.trim?.())
            items.push({ type: 'reasoning', text: b.thinking ?? b.text });
          break;
        case 'tool_use':
          items.push({ type: 'tool_call', id: b.id, name: b.name, args: b.input ?? {} });
          break;
        case 'tool_result':
          items.push({
            type: 'tool_result',
            id: b.tool_use_id,
            content: blockText(b.content),
            is_error: b.is_error === true,
          });
          break;
        default:
          break;
      }
    }
  }

  return {
    schema_version: SESSION_SCHEMA_VERSION,
    source: 'claude',
    session_id: opts.sessionId,
    cwd: found.cwd,
    items,
  };
}

/**
 * Write a canonical session as a Claude Code transcript so it is resumable via
 * the shipped `opengap run -a claude --resume <uuid> --workspace <cwd>`.
 *
 * Best-effort: Claude Code's transcript schema is internal/undocumented, so this
 * produces a minimal, tolerant shape (one content block per line, parentUuid
 * threading). Verify resume before relying on it.
 */
function writeClaude(session: CanonicalSession, opts: SessionWriteOptions): SessionWriteResult {
  const cwd = opts.dir ?? session.cwd;
  if (!cwd) {
    throw new Error('claude write requires --agent <working dir> (or a source session with a known cwd)');
  }
  // Validate first, then assign — avoids a confusing throwaway assignment.
  if (opts.sessionId && !UUID_RE.test(opts.sessionId)) {
    throw new Error(`claude --session-id must be a UUID, got: ${opts.sessionId}`);
  }
  const sessionId = opts.sessionId ?? randomUUID();

  const dir = join(homedir(), '.claude', 'projects', encodeCwd(cwd));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sessionId}.jsonl`);

  const nowIso = session.created_at ?? new Date().toISOString();
  const lines: string[] = [];
  let parentUuid: string | null = null;

  const push = (type: 'user' | 'assistant', content: unknown[]) => {
    const uuid = randomUUID();
    lines.push(
      JSON.stringify({
        parentUuid,
        isSidechain: false,
        type,
        message: { role: type, content },
        uuid,
        timestamp: nowIso,
        cwd,
        sessionId,
      }),
    );
    parentUuid = uuid;
  };

  // Carry cross-session memory (e.g. gitagent MEMORY.md) as leading context so
  // the target recalls it even when the transcript is thin.
  const memText = (session.memory ?? [])
    .map(m => m.text.trim())
    .filter(Boolean)
    .join('\n\n');
  if (memText) {
    push('assistant', [{ type: 'text', text: `Context I remember about you from previous sessions:\n\n${memText}` }]);
  }

  for (const it of session.items) {
    if (it.type === 'message') {
      if (it.role === 'system') continue; // system prompt isn't part of the transcript
      push(it.role, [{ type: 'text', text: it.text }]);
    } else if (it.type === 'tool_call') {
      push('assistant', [{ type: 'tool_use', id: it.id ?? randomUUID(), name: it.name, input: it.args ?? {} }]);
    } else if (it.type === 'tool_result') {
      push('user', [
        { type: 'tool_result', tool_use_id: it.id ?? '', content: it.content, is_error: it.is_error === true },
      ]);
    }
    // reasoning is skipped (Claude thinking blocks require signatures)
  }

  writeFileSync(file, lines.length ? lines.join('\n') + '\n' : '', 'utf-8');

  return {
    paths: [file],
    resumeHint: `opengap run -a claude --resume ${sessionId} --workspace ${cwd} -p "continue"`,
  };
}

export const claudeAdapter: SessionAdapter = {
  name: 'claude',
  list: listClaude,
  read: readClaude,
  write: writeClaude,
};
