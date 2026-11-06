import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, copyFileSync, existsSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { parseJsonStrict } from '../findings/schema.js';
import { signObject, verifySigned } from '../sign/sign.js';
import { branchKeys } from '../sign/keys.js';
import { atomicWrite, ensurePrivateDir, readPrivateFile } from '../store/files.js';
import { miraiHome } from '../store/mirai-home.js';
import { binaryHash, hashFile, resolveClaude } from './key.js';
import { RESULT_FOLDER } from './store.js';

// The Claude Code agents run (unit 18g): the binary the repo's last green red-team result tested,
// kept by MIRAI, never the `claude` link on your PATH that the updater moves. A red-team run first
// copies the binary it will test into MIRAI's home (`claude-code/<sha256>/claude`, private,
// read-only) and tests that copy, so what agents run is exactly what was tested, wherever it sits
// (18g review). A green result names it in a signed record in the store; launches use it, and the
// gate works out the red team's status for it, so a copy that changed can't match a green result.
// Your own Claude Code keeps updating; MIRAI moves to a new version when a run on it is green.

export const TESTED_FILE = 'tested-claude.json';
const SHA = /^[0-9a-f]{64}$/;
// A copy younger than this is never pruned unless named in `drop`: a safety margin (runs are one at a
// time on this machine, under the red team's lock, so no other run is about to name it).
const YOUNG_MS = 15 * 60 * 1000;
const context = (repoId) => `mirai/tested-claude/1:${repoId}`;
export const testedRoot = (env) => join(miraiHome(env), 'claude-code');
const copyPath = (env, sha256) => join(testedRoot(env), sha256, 'claude');
const recordPath = (store) => join(store.dir, RESULT_FOLDER, TESTED_FILE);
const writable = (p) => {
  try {
    chmodSync(p, 0o700);
  } catch {
    // gone already
  }
};

// The signed record: { current: { version, sha256, path }, previous }, or null when there's none.
// One that's there but doesn't verify throws: never read as "none", which would mean your PATH's.
export function readTested(store, { keys = null } = {}) {
  const text = readPrivateFile(recordPath(store), { optional: true, maxBytes: 64 * 1024 });
  if (text === null) return null;
  const bad = (why) => new StoreError(`MIRAI's record of the Claude Code agents run ${why}`, { code: 'tested-claude-invalid', hint: 'run the red team again: mirai redteam run' });
  let value;
  try {
    value = parseJsonStrict(String(text));
  } catch {
    throw bad('can\'t be read');
  }
  const check = verifySigned(value, keys ?? branchKeys(store.checkout, store.branch, store.gitEnv), { context: context(store.repoId) });
  if (!check.ok || !SHA.test(value.current?.sha256 ?? '')) throw bad(`doesn't verify${check.ok ? '' : `: ${check.reason}`}`);
  return value;
}

// A native Claude Code is one Mach-O file (18g re-review: an allow list, by its first bytes). A
// JavaScript install needs the files beside it, and a version manager's shim runs whatever is newest,
// so a copy of either wouldn't be what was tested. `allowScript`: MIRAI's own tests, whose stand-ins
// are shell scripts; never from the CLI.
const MACHO = new Set(['cffaedfe', 'feedfacf', 'cafebabe', 'bebafeca']);
export function nativeCheck(path, { allowScript = false } = {}) {
  const head = Buffer.alloc(4);
  let fd = null;
  try {
    fd = openSync(path, 'r');
    readSync(fd, head, 0, 4, 0);
  } catch {
    // unreadable: refused below
  } finally {
    if (fd !== null) closeSync(fd);
  }
  if (MACHO.has(head.toString('hex'))) return;
  if (allowScript && head.toString('latin1', 0, 2) === '#!' && !/\.(?:c|m)?js$/.test(path)) return;
  throw new StoreError(`${path} isn't a native Claude Code (a JavaScript install, or a version manager's shim); MIRAI keeps and runs only the native one`, { code: 'claude-not-native', hint: 'install Claude Code with its native installer (claude install), then run the red team' });
}

// Before a red-team run: the binary it will test (`claude`: { real, version }), copied into MIRAI's
// home and hashed as copied; an existing copy under that hash that differs is replaced. Returns
// { path, real, version, sha256 } of the copy: the run tests it, and a green result keeps it.
export async function stageTested({ env, claude, allowScript = false }) {
  nativeCheck(claude.real, { allowScript });
  const root = testedRoot(env);
  ensurePrivateDir(root);
  const part = join(root, `.part-${randomUUID()}`);
  try {
    copyFileSync(claude.real, part);
    chmodSync(part, 0o500);
    const sha256 = await hashFile(part);
    const dest = copyPath(env, sha256);
    if (existsSync(dest) && await hashFile(dest) === sha256) {
      rmSync(part, { force: true });
    } else {
      ensurePrivateDir(join(root, sha256));
      writable(dest);
      rmSync(dest, { force: true });
      renameSync(part, dest);
    }
    const v = resolveClaude(env, dest);
    return { path: dest, real: dest, version: v.version, sha256 };
  } finally {
    rmSync(part, { force: true });
  }
}

// After a green run on the staged copy: the record names it, the old current kept as previous;
// copies no repo names any more go.
export function keepTested({ env, store, staged, signer, now = () => new Date() }) {
  if (!SHA.test(staged?.sha256 ?? '') || staged.path !== copyPath(env, staged.sha256)) throw new StoreError('not a staged Claude Code', { code: 'bad-hash' });
  let old = null;
  try {
    old = readTested(store);
  } catch {
    old = null;
  }
  const current = { version: staged.version, sha256: staged.sha256, path: staged.path };
  const previous = old && old.current.sha256 !== staged.sha256 ? old.current : old?.previous ?? null;
  ensurePrivateDir(join(store.dir, RESULT_FOLDER));
  const signed = signObject({ schema_version: 1, current, previous, kept_at: now().toISOString() }, signer, { context: context(store.repoId), now });
  atomicWrite(recordPath(store), `${JSON.stringify(signed, null, 2)}\n`);
  // The record has moved: a prune that fails is no reason to say the keep failed (18g re-review).
  try {
    pruneTested(env);
  } catch {
    // the next run prunes
  }
  return signed;
}

// The copies some repo's record still names (current or previous), read from every store under
// MIRAI's home, stay; so does any copy younger than YOUNG_MS, unless it's in `drop` (this run's own
// copy, after a run that wasn't green). Unverified reads only ever add names, so a forged record
// can keep a copy, never remove one.
export function pruneTested(env, { drop = [], now = Date.now() } = {}) {
  const home = miraiHome(env);
  const named = new Set();
  let repos = [];
  try {
    repos = readdirSync(home, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return;
  }
  for (const repo of repos) {
    try {
      const v = JSON.parse(readFileSync(join(home, repo, 'store', RESULT_FOLDER, TESTED_FILE), 'utf8'));
      for (const x of [v.current, v.previous]) if (SHA.test(x?.sha256 ?? '')) named.add(x.sha256);
    } catch {
      // no record there
    }
  }
  let entries = [];
  try {
    entries = readdirSync(testedRoot(env));
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(testedRoot(env), name);
    let young = true;
    try {
      young = now - statSync(p).mtimeMs < YOUNG_MS;
    } catch {
      continue;
    }
    if (name.startsWith('.part-') ? young : (!SHA.test(name) || named.has(name) || (young && !drop.includes(name)))) continue;
    writable(p);
    writable(join(p, 'claude'));
    rmSync(p, { recursive: true, force: true });
  }
}

// The binary a launch runs: { path, real, version, sha256 } of the kept copy, or null when there's
// no record yet (no green run since 18g: launches use your PATH's, as before). A record whose copy is
// gone or changed, or that doesn't verify, refuses: never a silent fall back to another binary.
export async function testedClaude({ env, store }) {
  let rec;
  try {
    rec = readTested(store);
  } catch (err) {
    if (err.code === 'tested-claude-invalid') throw err;
    throw new StoreError(`MIRAI's record of the Claude Code agents run can't be read (${err.message})`, { code: 'tested-claude-invalid', hint: 'run the red team again: mirai redteam run' });
  }
  if (!rec) return null;
  const { path, version, sha256 } = rec.current;
  const gone = () => new StoreError(`the Claude Code ${version} the red team tested isn't where MIRAI kept it, or changed`, { code: 'tested-claude-changed', hint: 'run the red team again: mirai redteam run' });
  if (path !== copyPath(env, sha256) || !existsSync(path)) throw gone();
  let now;
  try {
    now = await binaryHash(join(store.dir, RESULT_FOLDER), path);
  } catch {
    throw gone();
  }
  if (now !== sha256) throw gone();
  return { path, real: path, version, sha256 };
}

