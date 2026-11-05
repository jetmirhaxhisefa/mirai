import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { atomicWrite, ensurePrivateDir } from '../store/files.js';

// A launch's Claude Code session, kept for the next round (unit 21c; design/01 §7, R-M4: fix rounds
// resume the same session). Every launch gets a fresh config folder (CLAUDE_CONFIG_DIR), removed
// at its end, so after the process is gone its session files (*.jsonl under the folder's
// `projects/`) are copied into the store, which agents can't write. The next round copies them
// into its own fresh folder and starts with --resume; nothing else carries over. A session that
// can't be kept or restored whole is no session: the round starts fresh. A kept session names the
// launch that made it, and is resumed only by a round that names that launch (21c review): an older
// session is never picked up because a newer one couldn't be kept.

// Files: the transcript, and the large tool results Claude Code writes beside it (21d).
export const SESSION_LIMITS = Object.freeze({ files: 64, bytes: 32 * 1024 * 1024, depth: 6 });
const ID = /^[0-9a-f-]{8,64}$/i;

// The files under `dir`/`start` (relative to `dir`): { files, links }. Regular files only; a link
// or anything else is named in `links`, never followed (the start too), and so is a folder past
// the depth cap (21d review: never a session kept in part and called whole).
function filesUnder(dir, start) {
  const files = [];
  const links = [];
  try {
    if (!lstatSync(join(dir, start)).isDirectory()) return { files, links: [start] };
  } catch {
    return { files, links };
  }
  const walk = (rel, depth) => {
    if (depth > SESSION_LIMITS.depth) {
      links.push(rel);
      return;
    }
    let entries;
    try {
      entries = readdirSync(join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = join(rel, e.name);
      if (e.isDirectory()) walk(r, depth + 1);
      else if (e.isFile()) files.push(r);
      else links.push(r);
    }
  };
  walk(start, 0);
  return { files, links };
}

// A session's files in a config folder: its transcript `projects/<cwd>/<id>.jsonl`, and the folder
// beside it, `projects/<cwd>/<id>/`, where Claude Code keeps large tool results (21d; else a
// resumed session points at files that are gone). { files, links }.
function sessionFiles(dir, sessionId) {
  const all = filesUnder(dir, 'projects');
  const transcripts = all.files.filter((r) => r.split(sep).pop() === `${sessionId}.jsonl`);
  const beside = transcripts.map((r) => join(dirname(r), sessionId));
  // The folder itself, or anything under it (a link that is the folder counts: 21d review).
  const mine = (r) => beside.some((b) => r === b || r.startsWith(b + sep));
  return { files: [...new Set([...transcripts, ...all.files.filter(mine)])], links: all.links.filter((r) => r === 'projects' || r.split(sep).pop() === `${sessionId}.jsonl` || mine(r)) };
}

// A regular file's bytes, never through a link (21c review: the file is looked at and read as one).
function readRegular(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(fd).isFile()) throw new Error(`${path} isn't a regular file`);
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

// Copies the session `sessionId` out of a launch's config folder into `dest`. What was there is
// forgotten first, whatever happens next. Returns { kept, sessionId, files, bytes } or { kept: false, why }.
export function keepSession({ configHome, dest, sessionId, launchId }) {
  forgetSession(dest);
  if (!ID.test(sessionId ?? '')) return { kept: false, why: 'the run named no session' };
  const { files, links } = sessionFiles(configHome, sessionId);
  if (links.length) return { kept: false, why: `the session has a link or a special file (${links[0]})` };
  if (!files.some((r) => r.endsWith('.jsonl'))) return { kept: false, why: 'its session file wasn\'t found' };
  if (files.length > SESSION_LIMITS.files) return { kept: false, why: `the session has too many files to keep (${files.length})` };
  ensurePrivateDir(dest);
  let bytes = 0;
  for (const r of files) {
    // Measured as copied, so a file that grows in between can't pass the cap.
    const data = readRegular(join(configHome, r));
    bytes += data.length;
    if (bytes > SESSION_LIMITS.bytes) {
      forgetSession(dest);
      return { kept: false, why: `the session is too large to keep (over ${SESSION_LIMITS.bytes / 1024 / 1024} MiB)` };
    }
    mkdirSync(join(dest, 'files', dirname(r)), { recursive: true, mode: 0o700 });
    writeFileSync(join(dest, 'files', r), data, { mode: 0o600 });
  }
  atomicWrite(join(dest, 'session.json'), `${JSON.stringify({ session_id: sessionId, launch_id: launchId ?? null, files, bytes }, null, 2)}\n`);
  return { kept: true, sessionId, files, bytes };
}

// The kept session's id, or null when there's none or it isn't whole.
export function keptSession(dir) {
  try {
    const meta = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
    if (!ID.test(meta.session_id ?? '') || !Array.isArray(meta.files) || !meta.files.length) return null;
    for (const r of meta.files) {
      if (typeof r !== 'string' || r.split(sep).includes('..') || !r.startsWith(`projects${sep}`)) return null;
      if (!lstatSync(join(dir, 'files', r)).isFile()) return null;
    }
    return meta;
  } catch {
    return null;
  }
}

// Puts the session kept from launch `launchId` into a launch's fresh config folder. Returns the
// session id, or null (none, another launch's, or it couldn't be copied whole): the round starts fresh.
export function restoreSession({ src, configHome, launchId }) {
  const meta = keptSession(src);
  if (!meta || !launchId || meta.launch_id !== launchId) return null;
  try {
    for (const r of meta.files) {
      const to = join(configHome, r);
      if (relative(configHome, to).split(sep).includes('..')) return null;
      mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
      writeFileSync(to, readRegular(join(src, 'files', r)), { mode: 0o600 });
    }
  } catch {
    return null;
  }
  return meta.session_id;
}

export const forgetSession = (dir) => rmSync(dir, { recursive: true, force: true });

// Where a ticket's agent session is kept in the store (not the MCP server's sessions, src/mcp/session.js).
export const agentSessionDir = (store, ticket) => join(store.dir, 'tickets', ticket, 'session');
