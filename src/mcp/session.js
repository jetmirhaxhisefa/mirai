import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { accessSync, chmodSync, constants, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, sep } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { atomicWrite, ensurePrivateDir } from '../store/files.js';
import { ignoredPaths } from '../store/git.js';
import { REGISTRATION_ID } from '../store/journal.js';
import { mcpPolicyTools, MODES } from '../launch/strict.js';
import { trustedStrict } from '../trust/snapshot.js';
import { POLICY_SCHEMA, TOOLS } from './server.js';

// MIRAI's MCP server in your own Claude Code sessions (unit 15b; D-53). It's registered at
// Claude Code's local scope (yours, this project only, never in the repo) through Claude Code's
// own CLI: MIRAI never edits Claude Code's config files. The server runs from the trust root it
// was registered with (`mirai render` registers an existing registration again when the
// integration branch moves; until then the old rules hold), with its policy read-only in
// <repo-home>/session/. Registering is your choice: only `mirai session-server install` makes a
// registration, and `remove` takes it away for good.
//
// Each policy file is named by its own hash (mcp-policy-<sha>.json), so writing a new one never
// breaks the registration that's running; older ones are removed once the new registration is
// in place. Pruning keeps every trust root a policy file here names.
//
// The allow rules for the tools go into the project's .claude/settings.local.json (yours, kept
// out of git), not the committed settings: committed rules would also let a look-alike `mirai`
// server from a branch's .mcp.json run its tools without asking, for anyone who never
// registered (review). Only the entries MIRAI added are ever taken out again.
//
// The session probes (research/10, S1–S5): a local-scope entry is keyed by the project's path (a
// moved folder loses it); it beats a committed .mcp.json server of the same name, even with
// enableAllProjectMcpServers; a server that can't start shows as "failed" and the session goes on
// without its tools; a folder you never trusted ignores the project's allow rules.

export const SERVER_NAME = 'mirai';
// Your session's caps: per registration and UTC day (open point 3).
export const SESSION_LOG_CAPS = Object.freeze({ max_events: 200, max_message: 4000 });
export const LOCAL_SETTINGS = '.claude/settings.local.json';
const POLICY_FILE = /^mcp-policy-([0-9a-f]{64})\.json$/;

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

class SessionError extends MiraiError {
  constructor(message, { code, hint, exitCode = EXIT.BLOCKED } = {}) {
    super(message, exitCode);
    this.name = 'SessionError';
    this.code = code;
    this.hint = hint;
  }
}

export const sessionDir = (store) => join(store.repoHome, 'session');

// The tools your session's server offers, as Claude Code names them: the interactive entries of
// the tool table.
export const sessionToolNames = () => TOOLS.filter((t) => t.contexts.includes('interactive')).map((t) => `mcp__${SERVER_NAME}__${t.name}`);

// The registration's id: made once per repo, kept. Every session of yours on this repo shares it
// (and its daily cap); unit 19's session runs get their own run ids next to it.
export function registrationId(store) {
  const dir = sessionDir(store);
  ensurePrivateDir(dir);
  const file = join(dir, 'id');
  if (existsSync(file)) {
    const id = readFileSync(file, 'utf8').trim();
    if (REGISTRATION_ID.test(id)) return id;
  }
  const id = `s-${randomBytes(6).toString('hex')}`;
  atomicWrite(file, `${id}\n`);
  return id;
}

// The policy files written here: [{ file, sha, base }].
export function policyFiles(store) {
  const dir = sessionDir(store);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((name) => POLICY_FILE.exec(name)).filter(Boolean).map((m) => {
    const file = join(dir, m[0]);
    let base = null;
    try {
      base = basename(JSON.parse(readFileSync(file, 'utf8')).trust_dir);
    } catch {
      // unreadable: no base to keep
    }
    return { file, sha: m[1], base };
  });
}

function writeReadOnly(path, text) {
  if (existsSync(path)) return; // named by its hash: the same content
  writeFileSync(path, text, { flag: 'wx', mode: 0o400 });
  chmodSync(path, 0o400);
}

// The policy and the server's entry for your sessions, from an open trust root. Writes the
// policy file (read-only, named by its hash, beside any older one) unless `write` is false;
// returns { policyFile, policySha256, entry, policy }.
export function sessionServer({ store, trust, env, write = true }) {
  if (!env.HOME || !isAbsolute(env.HOME)) throw new SessionError('HOME is not set to an absolute path', { code: 'no-home' });
  const checkout = realpathSync(store.checkout);
  const trustDir = realpathSync(trust.dir);
  const mcpScript = join(trustDir, 'tree', '.mirai', 'framework', 'bin', 'mcp.js');
  if (!existsSync(mcpScript)) throw new SessionError('the trust root has no MCP server (a framework copy from before unit 14d)', { code: 'no-mcp', hint: 'run: mirai init --refresh, and commit it' });
  const node = realpathSync(process.execPath);
  if (node === checkout || node.startsWith(`${checkout}${sep}`)) throw new SessionError(`node (${node}) is inside the project`, { code: 'bad-node' });
  // The same tools a read-write agent run gets (what the trust root's config offers), plus lint;
  // the caps are your session's.
  const tools = mcpPolicyTools(trustedStrict(trust, MODES[0]));
  if (tools.log_event) Object.assign(tools.log_event, SESSION_LOG_CAPS);
  tools.lint = {};
  const dir = sessionDir(store);
  ensurePrivateDir(dir);
  ensurePrivateDir(join(dir, 'state'));
  const policy = {
    schema: POLICY_SCHEMA, kind: 'interactive', checkout, trust_dir: trustDir, manifest_sha256: trust.manifestSha256, home: realpathSync(env.HOME),
    registration_id: registrationId(store), state_dir: realpathSync(join(dir, 'state')), store: { dir: realpathSync(store.dir), repo_id: store.repoId }, tools,
  };
  const body = `${JSON.stringify(policy, null, 2)}\n`;
  const policySha256 = sha256(body);
  const policyFile = join(realpathSync(dir), `mcp-policy-${policySha256}.json`);
  if (write) writeReadOnly(policyFile, body);
  const entry = { type: 'stdio', command: '/usr/bin/env', args: ['-i', `HOME=${policy.home}`, 'PATH=/usr/bin:/bin', node, mcpScript, policyFile, policySha256], env: {} };
  return { policyFile, policySha256, entry, policy };
}

// Removes every policy file but `keep` (a sha, or null for all).
function prunePolicies(store, keep) {
  for (const p of policyFiles(store)) {
    if (p.sha === keep) continue;
    chmodSync(p.file, 0o600);
    rmSync(p.file, { force: true });
  }
}

// Claude Code's own CLI on your PATH, or null. A folder, or a `claude`, that resolves inside the
// project doesn't count: a branch could put one there.
export function findClaude(env, checkout) {
  const inside = (p) => p === checkout || p.startsWith(`${checkout}${sep}`);
  for (const d of (env.PATH ?? '').split(delimiter)) {
    if (!isAbsolute(d)) continue;
    const p = join(d, 'claude');
    try {
      const real = realpathSync(p);
      if (inside(realpathSync(d)) || inside(real) || !statSync(real).isFile()) continue;
      accessSync(real, constants.X_OK);
      return p;
    } catch {
      // not here
    }
  }
  return null;
}

const quote = (s) => (/^[A-Za-z0-9_./=-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);
// The command for you to run yourself: from the checkout, since local scope is keyed by the folder.
export const commandText = (checkout, args) => `cd ${quote(checkout)} && ${['claude', ...args].map(quote).join(' ')}`;
export const addArgs = (entry) => ['mcp', 'add-json', SERVER_NAME, JSON.stringify(entry), '--scope', 'local'];
export const removeArgs = () => ['mcp', 'remove', SERVER_NAME, '--scope', 'local'];

// Runs Claude Code's CLI in the checkout (local scope is keyed by its path). `run` is for tests.
function claudeRun(claude, args, { cwd, env, run = spawnSync, timeout = 60_000 }) {
  const r = run(claude, args, { cwd, env, encoding: 'utf8', timeout });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

// What Claude Code has registered as `mirai` here: { found, ours, entry text }. Ours means its
// command line names a policy file of this repo's session folder.
function registered(claude, store, { env, run, timeout }) {
  const r = claudeRun(claude, ['mcp', 'get', SERVER_NAME], { cwd: realpathSync(store.checkout), env, run, timeout });
  if (r.code !== 0) return { found: !/No MCP server named/i.test(r.out) ? null : false, out: r.out };
  const dir = realpathSync(sessionDir(store));
  const m = new RegExp(`${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/mcp-policy-([0-9a-f]{64})\\.json`).exec(r.out);
  return { found: true, ours: Boolean(m), sha: m?.[1] ?? null, out: r.out };
}

// The allow rules in your .claude/settings.local.json: added (only those missing) or taken out
// (only those MIRAI added, as recorded in session/allows.json). Never through a link, and only
// when git ignores the file. Returns a note when it can't.
function localAllows(store, env, add) {
  const checkout = realpathSync(store.checkout);
  const file = join(checkout, LOCAL_SETTINGS);
  const record = join(sessionDir(store), 'allows.json');
  let mine = [];
  try {
    mine = JSON.parse(readFileSync(record, 'utf8'));
  } catch {
    // none recorded
  }
  if (existsSync(file) && !lstatSync(file).isFile()) return `${LOCAL_SETTINGS} isn't a plain file, so the tools will ask before they run`;
  if (existsSync(join(checkout, '.claude')) && !lstatSync(join(checkout, '.claude')).isDirectory()) return '.claude isn\'t a folder, so the tools will ask before they run';
  if (add && ignoredPaths(checkout, [LOCAL_SETTINGS], { PATH: env.PATH, HOME: env.HOME }).length === 0) {
    return `git doesn't ignore ${LOCAL_SETTINGS}, so MIRAI didn't add the tools' allow rules there (they'd be shared); add it to .gitignore and run install again, or let the tools ask`;
  }
  let value = {};
  if (existsSync(file)) {
    try {
      value = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      return `${LOCAL_SETTINGS} isn't valid JSON, so MIRAI left it alone; the tools will ask before they run`;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value) || (value.permissions !== undefined && (typeof value.permissions !== 'object' || value.permissions === null))
      || (value.permissions?.allow !== undefined && !Array.isArray(value.permissions.allow))) {
      return `${LOCAL_SETTINGS} isn't shaped as Claude Code reads it, so MIRAI left it alone`;
    }
  } else if (!add) {
    rmSync(record, { force: true });
    return null;
  }
  const allow = value.permissions?.allow ?? [];
  let next;
  if (add) {
    const missing = sessionToolNames().filter((t) => !allow.includes(t));
    next = [...allow, ...missing];
    atomicWrite(record, `${JSON.stringify([...new Set([...mine, ...missing])])}\n`);
  } else {
    next = allow.filter((t) => !mine.includes(t));
    rmSync(record, { force: true });
  }
  if (JSON.stringify(next) === JSON.stringify(allow)) return null;
  if (!existsSync(dirname(file))) ensurePrivateDir(dirname(file));
  writeFileSync(file, `${JSON.stringify({ ...value, permissions: { ...(value.permissions ?? {}), allow: next } }, null, 2)}\n`, { mode: 0o600 });
  return null;
}

// Registers (or registers again) your sessions' server. Without `claude` on your PATH, nothing
// changes in Claude Code: the command to run is returned instead. A `mirai` server that isn't
// MIRAI's is never replaced.
export function install({ store, trust, env, run, timeout }) {
  const server = sessionServer({ store, trust, env });
  const checkout = realpathSync(store.checkout);
  const claude = findClaude(env, checkout);
  const args = addArgs(server.entry);
  if (!claude) return { ...server, done: false, command: commandText(checkout, args) };
  const now = registered(claude, store, { env, run, timeout });
  if (now.found === null) throw new SessionError(`claude mcp get failed: ${now.out.slice(0, 300)}`, { code: 'claude-failed', exitCode: EXIT.FAILURE });
  if (now.found && !now.ours) {
    throw new SessionError('Claude Code already has a server named mirai for this project that MIRAI didn\'t register', {
      code: 'not-ours', hint: 'see: claude mcp get mirai; remove it yourself (claude mcp remove mirai --scope local) if you want MIRAI\'s',
    });
  }
  if (now.found) claudeRun(claude, removeArgs(), { cwd: checkout, env, run, timeout });
  const added = claudeRun(claude, args, { cwd: checkout, env, run, timeout });
  if (added.code !== 0) {
    throw new SessionError(`claude mcp add-json failed: ${added.out.slice(0, 300)}`, {
      code: 'claude-failed', exitCode: EXIT.FAILURE,
      hint: `${now.found ? 'the earlier registration was removed; ' : ''}run it yourself: ${commandText(checkout, args)}`,
    });
  }
  prunePolicies(store, server.policySha256);
  const note = localAllows(store, env, true);
  return { ...server, done: true, command: commandText(checkout, args), note };
}

// Removes MIRAI's registration (never a `mirai` server that isn't MIRAI's), its allow rules and
// its policy files.
export function remove({ store, env, run, timeout }) {
  const checkout = realpathSync(store.checkout);
  const claude = findClaude(env, checkout);
  if (!claude) return { done: false, command: commandText(checkout, removeArgs()) };
  const now = registered(claude, store, { env, run, timeout });
  if (now.found === null) throw new SessionError(`claude mcp get failed: ${now.out.slice(0, 300)}`, { code: 'claude-failed', exitCode: EXIT.FAILURE });
  if (now.found && !now.ours) throw new SessionError('the server named mirai for this project isn\'t MIRAI\'s, so MIRAI left it', { code: 'not-ours', hint: 'see: claude mcp get mirai' });
  let done = false;
  if (now.found) {
    const r = claudeRun(claude, removeArgs(), { cwd: checkout, env, run, timeout });
    if (r.code !== 0) throw new SessionError(`claude mcp remove failed: ${r.out.slice(0, 300)}`, { code: 'claude-failed', exitCode: EXIT.FAILURE });
    done = true;
  }
  prunePolicies(store, null);
  const note = localAllows(store, env, false);
  return { done, absent: !now.found, note };
}

// What Claude Code has for this project, against the entry MIRAI would register now:
// - `current`: MIRAI's, exactly this entry (the same node, script, policy and hash), connected;
// - `stale`: MIRAI's, but for an older trust root or policy, or it can't start (a moved node, a
//   removed trust root);
// - `missing`: none for this project folder; `foreign`: a `mirai` server that isn't MIRAI's;
// - `unknown`: no claude on PATH, or claude failed.
export function status({ store, env, trust = null, run, timeout }) {
  const checkout = realpathSync(store.checkout);
  const claude = findClaude(env, checkout);
  if (!claude) return { state: 'unknown' };
  const now = registered(claude, store, { env, run, timeout });
  if (now.found === null) return { state: 'unknown', out: now.out };
  if (!now.found) return { state: 'missing' };
  if (!now.ours) return { state: 'foreign' };
  const policy = policyFiles(store).find((p) => p.sha === now.sha);
  const base = policy?.base ?? null;
  const behind = Boolean(trust && base && trust.baseSha !== base);
  const connected = /Connected/.test(now.out) && !/Failed|failed/.test(now.out);
  let same = Boolean(policy);
  if (same && trust && !behind) {
    // The exact entry MIRAI would write now: every part of the command line, the node included.
    const want = sessionServer({ store, trust, env, write: false }).entry;
    same = want.args.every((a) => now.out.includes(a));
  }
  return { state: same && !behind && connected ? 'current' : 'stale', base, behind, connected };
}
