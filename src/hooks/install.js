import { chmodSync, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { atomicWrite, ensurePrivateDir, readPrivateFile } from '../store/files.js';
import { configValue, setHooksPath } from '../store/git.js';

// The hooks folder (unit 26a; D-15, R-C2, R2-C1, TL3-18): `<mirai-home>/<repo-id>/hooks/`, beside
// the store, outside the project and denied to agents (13b). `core.hooksPath` in the repo's own
// .git/config points at it, so your pushes run MIRAI's `pre-push`. Its files are fixed text: the
// `pre-push` script, which runs the `mirai` launcher's `hook pre-push` (the integration branch's
// sealed copy, Jet's decision 2), and a forward for each hook the repo already had (decision 7).
// What they should hold is recorded in the store (`hooks.json`), and every push checks the folder
// against it (`hooksState`): an edit, an extra file or a moved `core.hooksPath` blocks the push.

export const HOOKS_FOLDER = 'hooks';
const STATE_FILE = 'hooks.json';
const SCHEMA_VERSION = 1;
// Git's client-side hooks: the ones a forward is made for.
export const HOOK_NAMES = Object.freeze(['applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-commit', 'pre-merge-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit',
  'pre-rebase', 'post-checkout', 'post-merge', 'pre-push', 'pre-auto-gc', 'post-rewrite', 'sendemail-validate', 'fsmonitor-watchman', 'post-index-change', 'reference-transaction']);

export const hooksDir = (store) => join(store.repoHome, HOOKS_FOLDER);
const statePath = (store) => join(store.dir, STATE_FILE);

// A word quoted for sh.
export const shQuote = (s) => `'${String(s).replace(/'/g, '\'\\\'\'')}'`;

export function hookScript({ node, launcher }) {
  return [
    '#!/bin/sh',
    '# MIRAI pre-push (unit 26a). Written by mirai init; checked at every push. Don\'t edit it:',
    '# run `mirai init --refresh` instead. `git push --no-verify` skips it.',
    `exec ${shQuote(node)} ${shQuote(launcher)} hook pre-push "$@"`,
    '',
  ].join('\n');
}

export function forwardScript(path) {
  return [
    '#!/bin/sh',
    '# MIRAI forwards this hook to the one the repo had before (unit 26a). Written by mirai init.',
    `exec ${shQuote(path)} "$@"`,
    '',
  ].join('\n');
}

// The files the folder should hold: Map(name -> text).
export function plannedFiles(state) {
  const files = new Map([['pre-push', hookScript(state)]]);
  for (const name of state.hooks ?? []) if (name !== 'pre-push') files.set(name, forwardScript(join(state.forwarded_from, name)));
  return files;
}

// The store's record of the folder, or null when the hooks were never installed.
export function readHooksRecord(store) {
  const text = readPrivateFile(statePath(store), { maxBytes: 64 * 1024, optional: true });
  if (text === null) return null;
  let r;
  try {
    r = JSON.parse(text);
  } catch {
    throw new StoreError(`${statePath(store)}: not readable`, { path: statePath(store), code: 'hooks-record', hint: 'run: mirai init --refresh' });
  }
  const ok = r && r.schema_version === SCHEMA_VERSION && typeof r.node === 'string' && isAbsolute(r.node) && typeof r.launcher === 'string' && isAbsolute(r.launcher)
    && Array.isArray(r.hooks) && r.hooks.every((h) => HOOK_NAMES.includes(h)) && (r.forwarded_from === null || (typeof r.forwarded_from === 'string' && isAbsolute(r.forwarded_from)))
    && (r.hooks.length === 0 || r.forwarded_from !== null);
  if (!ok) throw new StoreError(`${statePath(store)}: not a valid hooks record`, { path: statePath(store), code: 'hooks-record', hint: 'run: mirai init --refresh' });
  return r;
}

const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

// The folder core.hooksPath names here, resolved as git does (relative to the work tree, `~/`
// from HOME), or null when it's unset.
function configuredHooksPath(root, env) {
  const v = configValue(root, 'core.hooksPath', env);
  if (v === null) return null;
  if (v.startsWith('~/')) return join(env.HOME ?? '/nonexistent', v.slice(2));
  return isAbsolute(v) ? v : resolve(root, v);
}

const executable = (path) => {
  try {
    const s = statSync(path);
    return s.isFile() && (s.mode & 0o111) !== 0;
  } catch {
    return false;
  }
};

// The hooks the repo has besides MIRAI's (decision 7): { from, names, recorded }. `from`: the
// folder they're in (an existing core.hooksPath, else .git/hooks), or the one MIRAI already
// forwards to; `names`: git hook names with the executable bit there (never `*.sample`);
// `recorded`: the store's record, if any.
export function existingHooks({ store, env }) {
  const root = store.checkout;
  const recorded = readHooksRecord(store);
  const mine = real(hooksDir(store));
  const configured = configuredHooksPath(root, store.gitEnv ?? env);
  let from;
  if (configured && real(configured) === mine) from = recorded?.forwarded_from ?? null;
  else from = configured ?? join(root, '.git', 'hooks');
  if (from && real(from) === mine) from = null;
  let names = [];
  if (from && existsSync(from)) {
    try {
      names = readdirSync(from).filter((n) => HOOK_NAMES.includes(n) && executable(join(from, n))).sort();
    } catch {
      names = [];
    }
  }
  return { from: names.length ? real(from) : null, names, recorded };
}

// Whether `found` (existingHooks) is what the store already forwards, so nothing needs asking.
export const alreadyForwarded = (found) => Boolean(found.recorded) && found.names.length === found.recorded.hooks.length
  && found.names.every((n, i) => n === [...found.recorded.hooks].sort()[i]) && (found.names.length === 0 || found.from === found.recorded.forwarded_from);

// Writes the folder whole and points core.hooksPath at it. `forward`: { from, names } to forward,
// or null. Returns { dir, files }.
export function installHooks({ store, env, node, launcher, forward = null }) {
  if (!isAbsolute(node ?? '') || !isAbsolute(launcher ?? '')) throw new TypeError('node and launcher are absolute paths');
  const names = forward?.names ?? [];
  const state = { schema_version: SCHEMA_VERSION, node, launcher, forwarded_from: names.length ? forward.from : null, hooks: [...names].sort() };
  const files = plannedFiles(state);
  const dir = hooksDir(store);
  const tmp = join(store.repoHome, `.hooks-${process.pid}-${randomBytes(4).toString('hex')}`);
  ensurePrivateDir(tmp);
  try {
    for (const [name, text] of files) {
      writeFileSync(join(tmp, name), text, { flag: 'wx', mode: 0o755 });
      chmodSync(join(tmp, name), 0o755);
    }
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    renameSync(tmp, dir);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  atomicWrite(statePath(store), `${JSON.stringify(state, null, 2)}\n`);
  setHooksPath(store.checkout, dir, store.gitEnv ?? env);
  return { dir, files: [...files.keys()] };
}

// The folder's state: { state: 'ok' | 'off' | 'changed', why, record }.
export function hooksState({ store, env }) {
  let record;
  try {
    record = readHooksRecord(store);
  } catch (err) {
    return { state: 'changed', why: err.message, record: null };
  }
  if (!record) return { state: 'off', why: 'MIRAI\'s hooks aren\'t installed on this machine', record: null };
  // Unit 29c: the hook runs the Node it recorded; one that's gone (a moved machine, an nvm or brew
  // upgrade) fails every push, so the hooks aren't ok.
  if (!executable(record.node)) return { state: 'changed', why: `the pre-push hook runs ${record.node}, which isn't there, so every push fails`, record };
  const dir = hooksDir(store);
  const configured = configuredHooksPath(store.checkout, store.gitEnv ?? env);
  if (!configured || real(configured) !== real(dir)) {
    return { state: 'off', why: configured ? `core.hooksPath points at ${configured}, not MIRAI's hooks folder` : 'core.hooksPath isn\'t set', record };
  }
  const want = plannedFiles(record);
  let names;
  try {
    names = readdirSync(dir).sort();
  } catch {
    return { state: 'changed', why: `${dir} can't be read`, record };
  }
  const problems = [];
  for (const n of names) if (!want.has(n)) problems.push(`${n} was added`);
  for (const [n, text] of want) {
    const p = join(dir, n);
    let info;
    try {
      info = lstatSync(p);
    } catch {
      problems.push(`${n} is missing`);
      continue;
    }
    if (!info.isFile()) problems.push(`${n} isn't a plain file`);
    else if ((info.mode & 0o111) === 0) problems.push(`${n} isn't executable`);
    else if (readFileSync(p, 'utf8') !== text) problems.push(`${n} was changed`);
  }
  if (problems.length) return { state: 'changed', why: `MIRAI's hooks folder isn't as MIRAI wrote it: ${problems.slice(0, 5).join(', ')}`, record };
  return { state: 'ok', why: 'MIRAI\'s hooks are installed', record };
}

// For a refusal: the hooks aren't right.
export function hooksError(s) {
  return new StoreError(s.why, { code: s.state === 'off' ? 'hooks-off' : 'hooks-changed', exitCode: EXIT.BLOCKED, hint: 'run: mirai init --refresh (in a terminal)' });
}

// Before agents start (unit 26a's default): MIRAI's hooks must be on, or MIRAI's work could be
// pushed unchecked. `mirai build`, `mirai fix` and `mirai review` call it.
export function requireHooks({ store, env }) {
  const s = hooksState({ store, env });
  if (s.state !== 'ok') throw hooksError(s);
}
