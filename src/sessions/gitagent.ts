/**
 * gitagent session adapter.
 *
 * gitagent stores conversation history per git branch at
 *   <agentDir>/.gitagent/chat-history/<branch>.jsonl   (lines: {ts, msg:ServerMessage})
 * and cross-session memory at <agentDir>/memory/MEMORY.md.
 *
 * IMPORTANT: the gitagent CLI only *recalls* across sessions via MEMORY.md — the
 * chat-history log is written but NOT replayed into the model in CLI mode. So on
 * WRITE we distill into MEMORY.md (the recall lever) and also write chat-history
 * as a faithful archive.
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  CanonicalItem,
  CanonicalSession,
  SESSION_SCHEMA_VERSION,
  SessionAdapter,
  SessionListEntry,
  SessionListOptions,
  SessionReadOptions,
  SessionWriteOptions,
  SessionWriteResult,
} from './canonical.js';

function requireDir(dir: string | undefined, verb: string): string {
  if (!dir) throw new Error(`gitagent ${verb} requires --agent <dir> (the agent directory)`);
  return dir;
}

function historyDir(agentDir: string): string {
  return join(agentDir, '.gitagent', 'chat-history');
}
function sanitizeBranch(branch: string): string {
  return branch.replace(/\//g, '__');
}
function unsanitizeBranch(file: string): string {
  return file.replace(/\.jsonl$/, '').replace(/__/g, '/');
}
function historyPath(agentDir: string, branch: string): string {
  return join(historyDir(agentDir), sanitizeBranch(branch) + '.jsonl');
}
function memoryPath(agentDir: string): string {
  return join(agentDir, 'memory', 'MEMORY.md');
}

/** Run git in the agent dir; returns raw stdout, or undefined on any failure. */
function gitOut(agentDir: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: agentDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return undefined;
  }
}

/** Path of a branch's history file, relative to the repo root (for `git show`). */
function historyRelPath(branch: string): string {
  return `.gitagent/chat-history/${sanitizeBranch(branch)}.jsonl`;
}

function listGitagent(opts?: SessionListOptions): SessionListEntry[] {
  const agentDir = requireDir(opts?.dir, 'list');
  const ids = new Set<string>();
  // Working-tree history files (non-git repos, `main`, and uncommitted chats).
  const dir = historyDir(agentDir);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) if (f.endsWith('.jsonl')) ids.add(unsanitizeBranch(f));
  }
  // Every `chat/*` git branch is a session — each commits its own history on its
  // own branch, so this matches what the gitagent voice UI lists (branches, not
  // just the files present on the checked-out branch).
  const out = gitOut(agentDir, ['branch', '--list', 'chat/*', '--format=%(refname:short)']);
  if (out) for (const b of out.split('\n').map(s => s.trim()).filter(Boolean)) ids.add(b);
  return [...ids].map(id => ({ id }));
}

function readGitagent(opts: SessionReadOptions): CanonicalSession {
  const agentDir = requireDir(opts.dir, 'read');
  // Accept the branch as listed, or its `chat/`-prefixed form (write prefixes it).
  const candidates = opts.sessionId.startsWith('chat/')
    ? [opts.sessionId]
    : [opts.sessionId, `chat/${opts.sessionId}`];

  // Prefer a working-tree file; otherwise read the history committed on that
  // branch even when it isn't checked out (`git show <branch>:<path>`).
  let content: string | undefined;
  for (const b of candidates) {
    const p = historyPath(agentDir, b);
    if (existsSync(p)) {
      content = readFileSync(p, 'utf-8');
      break;
    }
  }
  if (content === undefined) {
    for (const b of candidates) {
      const got = gitOut(agentDir, ['show', `${b}:${historyRelPath(b)}`]);
      if (got !== undefined) {
        content = got;
        break;
      }
    }
  }
  if (content === undefined) throw new Error(`gitagent session not found: ${opts.sessionId}`);

  const items: CanonicalItem[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const m = entry.msg;
    if (!m) continue;
    switch (m.type) {
      case 'transcript':
        if (m.text?.trim()) items.push({ type: 'message', role: m.role, text: m.text });
        break;
      case 'agent_done':
        if (m.result?.trim()) items.push({ type: 'message', role: 'assistant', text: m.result });
        break;
      case 'tool_call':
        items.push({ type: 'tool_call', name: m.toolName, args: m.args ?? {} });
        break;
      case 'tool_result':
        items.push({ type: 'tool_result', content: m.content ?? '', is_error: m.isError === true });
        break;
      case 'agent_thinking':
        if (m.text?.trim()) items.push({ type: 'reasoning', text: m.text });
        break;
      default:
        break;
    }
  }

  const memFile = memoryPath(agentDir);
  const memory = existsSync(memFile)
    ? [{ kind: 'memory', text: readFileSync(memFile, 'utf-8').trim() }]
    : undefined;

  return {
    schema_version: SESSION_SCHEMA_VERSION,
    source: 'gitagent',
    session_id: opts.sessionId,
    cwd: agentDir,
    items,
    memory,
  };
}

/** Distill a canonical session into a MEMORY.md section (mechanical, no LLM). */
function distillMemory(session: CanonicalSession, nowIso: string, marker = ''): string {
  const userMsgs = session.items
    .filter((i): i is Extract<CanonicalItem, { type: 'message' }> => i.type === 'message' && i.role === 'user')
    .map(i => i.text.trim())
    .filter(Boolean);
  const toolsUsed = [
    ...new Set(
      session.items
        .filter((i): i is Extract<CanonicalItem, { type: 'tool_call' }> => i.type === 'tool_call')
        .map(i => i.name),
    ),
  ];

  const lines: string[] = [];
  lines.push(`## Imported Session (${session.source}${session.session_id ? ` · ${session.session_id}` : ''}) — ${nowIso}`);
  if (marker) lines.push(marker);
  lines.push('');
  if (userMsgs.length) {
    lines.push('**What the user asked / said:**');
    for (const t of userMsgs.slice(0, 20)) lines.push(`- ${t.replace(/\n+/g, ' ').slice(0, 300)}`);
    lines.push('');
  }
  if (toolsUsed.length) {
    lines.push(`**Tools used:** ${toolsUsed.join(', ')}`);
    lines.push('');
  }
  // carry any distilled memory facts from the source
  const facts = (session.memory ?? []).map(m => m.text.trim()).filter(Boolean);
  if (facts.length) {
    lines.push('**Carried memory:**');
    for (const f of facts) lines.push(f);
    lines.push('');
  }
  return lines.join('\n');
}

/** Map canonical items → gitagent ServerMessage `{ts, msg}` JSONL lines. */
function toChatHistory(session: CanonicalSession, startTs: number): string {
  // Resolve tool names for tool_results via their matching tool_call id.
  const nameById = new Map<string, string>();
  for (const it of session.items) {
    if (it.type === 'tool_call' && it.id) nameById.set(it.id, it.name);
  }
  const out: string[] = [];
  let ts = startTs;
  for (const it of session.items) {
    let msg: Record<string, unknown> | null = null;
    if (it.type === 'message') {
      if (it.role === 'system') continue; // gitagent transcript is user|assistant only
      msg = { type: 'transcript', role: it.role, text: it.text };
    } else if (it.type === 'tool_call') {
      msg = { type: 'tool_call', toolName: it.name, args: it.args ?? {} };
    } else if (it.type === 'tool_result') {
      const name = (it.id && nameById.get(it.id)) || 'tool';
      msg = { type: 'tool_result', toolName: name, content: it.content, isError: it.is_error === true };
    } else {
      continue; // reasoning is dropped (gitagent skips agent_thinking)
    }
    out.push(JSON.stringify({ ts: ts++, msg }));
  }
  return out.length ? out.join('\n') + '\n' : '';
}

function writeGitagent(session: CanonicalSession, opts: SessionWriteOptions): SessionWriteResult {
  const agentDir = requireDir(opts.dir, 'write');
  const nowIso = new Date().toISOString();

  // Branch name matches the `chat/*` pattern the voice UI lists.
  const branch = opts.sessionId
    ? opts.sessionId.startsWith('chat/')
      ? opts.sessionId
      : `chat/${opts.sessionId}`
    : `chat/${session.source}-${(session.session_id ?? 'session').slice(0, 12)}`;

  // Stable marker so re-importing the same session doesn't duplicate memory.
  const importMarker = `<!-- opengap-import:${session.source}:${session.session_id ?? ''} -->`;

  // Writes MEMORY.md (append, the CLI recall lever) + the chat-history file.
  const writeFiles = (): string[] => {
    const out: string[] = [];
    const memFile = memoryPath(agentDir);
    mkdirSync(join(agentDir, 'memory'), { recursive: true });
    const existing = existsSync(memFile) ? readFileSync(memFile, 'utf-8').trimEnd() : '# Memory';
    if (!existing.includes(importMarker)) {
      writeFileSync(memFile, `${existing}\n\n${distillMemory(session, nowIso, importMarker)}`, 'utf-8');
    }
    out.push(memFile);
    const chatBody = toChatHistory(session, Date.parse(session.created_at ?? nowIso) || Date.now());
    if (chatBody) {
      mkdirSync(historyDir(agentDir), { recursive: true });
      writeFileSync(historyPath(agentDir, branch), chatBody, 'utf-8');
      out.push(historyPath(agentDir, branch));
    }
    return out;
  };

  // Run git with an argument array (no shell) — avoids injection via branch/msg.
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: agentDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  const tryGit = (args: string[]): boolean => {
    try {
      git(args);
      return true;
    } catch {
      return false;
    }
  };
  const isRepo = tryGit(['rev-parse', '--git-dir']);
  // "git-native" = a git repo that tracks .gitagent (commits state per branch,
  // like voice). check-ignore exits 0 when the path IS ignored.
  const gitIgnored = isRepo && tryGit(['check-ignore', '.gitagent']);
  const gitNative = isRepo && !gitIgnored;

  // Non-git-native: just write files (+ best-effort branch for listing).
  if (!gitNative) {
    const paths = writeFiles();
    let note = '';
    if (isRepo) {
      if (!tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])) {
        if (tryGit(['branch', branch])) note = ` (branch "${branch}")`;
      } else {
        note = ` (branch "${branch}")`;
      }
    }
    return {
      paths,
      resumeHint: `cd ${agentDir} && gitagent   # imported context loaded from memory/MEMORY.md${note}`,
    };
  }

  // Git-native: commit the history ON the branch so `gitagent --voice` restores
  // it when the branch is checked out (mirrors how voice creates a chat).
  let orig = 'main';
  try {
    orig = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch {
    /* keep default */
  }
  let paths: string[] = [];
  try {
    // Commit any pending work on the current branch (voice does this too).
    tryGit(['add', '-A']);
    tryGit(['commit', '-m', 'auto-save before session import', '--allow-empty']);
    // Create or switch to the chat branch. If neither works, DON'T write on the
    // wrong branch — fail loudly (the finally still restores the original branch).
    if (!tryGit(['checkout', '-b', branch]) && !tryGit(['checkout', branch])) {
      throw new Error(`Could not switch to branch "${branch}" — is the working tree clean / index unlocked?`);
    }
    // Write files on this branch and commit them.
    paths = writeFiles();
    tryGit(['add', '-A']);
    const msg = `Import ${session.source} session ${session.session_id ?? ''}`.trim();
    tryGit(['commit', '-m', msg]);
  } finally {
    // Always return to the original branch, whatever happened.
    tryGit(['checkout', orig]);
  }

  const resumeHint = `Imported as committed branch "${branch}". Open it in \`gitagent --voice\` — the session list shows it and replays the conversation.`;

  return { paths, resumeHint };
}

export const gitagentAdapter: SessionAdapter = {
  name: 'gitagent',
  list: listGitagent,
  read: readGitagent,
  write: writeGitagent,
};
