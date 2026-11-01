import { createHash } from 'node:crypto';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { atomicWrite, ensurePrivateDir, readPrivateFile } from '../store/files.js';
import { parseJsonStrict } from '../findings/schema.js';
import { signObject, verifySigned } from '../sign/sign.js';
import { branchKeys } from '../sign/keys.js';
import { changedParts, keyOf } from './key.js';

// Red-team results (unit 18a): `<store>/redteam/<key>.json`, one per key (src/redteam/key.js),
// signed with your key, so a result can't be written or edited by anything without that key:
// agents can't reach the store or the key, though your own unsandboxed session could (unit 18e). The last KEEP_RESULTS are kept.
//
// States: `green` (every case passed its runs, and the no-model checks hold), `red` (a case
// failed, or a check found something new), `blocker` (a case of V1's condition failed: G18 or an
// escape), `incomplete` (inconclusive cases, unknown checks, or the run stopped). redTeamStatus
// adds `stale` (results exist, none for the current key) and `none`.

const blockerId = (r) => createHash('sha256').update(`${r.key}\n${r.created_at}`).digest('hex').slice(0, 24);
const blockerContext = (repoId) => `mirai/redteam-blocker/1:${repoId}`;
export const KEEP_RESULTS = 20;
export const RESULT_SCHEMA_VERSION = 1;
export const RESULT_FOLDER = 'redteam';
export const STATES = Object.freeze(['green', 'red', 'blocker', 'incomplete']);
const KEY = /^[0-9a-f]{64}$/;

export const resultContext = (repoId) => `mirai/redteam/1:${repoId}`;

// Unit 18e's own results for your sessions sit in a folder of their own, under their own signing
// context, so one can never stand for a headless result.
export const SESSIONS = Object.freeze({ folder: join(RESULT_FOLDER, 'sessions'), context: (repoId) => `mirai/redteam-sessions/1:${repoId}` });
const HEADLESS = Object.freeze({ folder: RESULT_FOLDER, context: resultContext });

export function resultPath(store, key, kind = HEADLESS) {
  if (!KEY.test(key)) throw new StoreError('not a red-team key', { code: 'bad-key' });
  return join(store.dir, kind.folder, `${key}.json`);
}

// Signs and writes a result; keeps the last KEEP_RESULTS. Returns the signed object.
export function writeResult(store, result, signer, { now = () => new Date(), kind = HEADLESS } = {}) {
  if (keyOf(result.parts) !== result.key) throw new StoreError('the result\'s key doesn\'t match its parts', { code: 'bad-key' });
  ensurePrivateDir(join(store.dir, RESULT_FOLDER));
  const dir = join(store.dir, kind.folder);
  ensurePrivateDir(dir);
  const signed = signObject(result, signer, { context: kind.context(store.repoId), now });
  atomicWrite(resultPath(store, result.key, kind), `${JSON.stringify(signed, null, 2)}\n`);
  // A blocker stays on record whatever happens to its result: a later green under the same key
  // overwrites that, and old results rotate out (unit 19a).
  if (kind === HEADLESS && result.state === 'blocker') {
    ensurePrivateDir(join(store.dir, RESULT_FOLDER, 'blockers'));
    const id = blockerId(result);
    const record = signObject({ id, key: result.key, created_at: result.created_at, claude_code: result.parts?.claude_code?.sha256 ?? null, macos: result.parts?.macos ?? null, result }, signer, { context: blockerContext(store.repoId), now });
    atomicWrite(join(store.dir, RESULT_FOLDER, 'blockers', `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  }
  const all = listResults(store, kind);
  for (const old of all.slice(KEEP_RESULTS)) rmSync(join(dir, `${old}.json`), { force: true });
  return signed;
}

// The keys of stored results, newest first.
export function listResults(store, kind = HEADLESS) {
  const dir = join(store.dir, kind.folder);
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => /^[0-9a-f]{64}\.json$/.test(n)).map((n) => ({ k: n.slice(0, -5), t: statSync(join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t || b.k.localeCompare(a.k)).map((x) => x.k);
}

// The result for `key`, checked: null when there is none; one that doesn't verify with the
// integration branch's keys, or that names another key, is refused (`redteam-invalid`), never
// read as "none".
export function readResult(store, key, { keys = null, kind = HEADLESS } = {}) {
  const text = readPrivateFile(resultPath(store, key, kind), { optional: true, maxBytes: 16 * 1024 * 1024 });
  if (text === null) return null;
  const bad = (why) => new StoreError(`the red-team result ${key.slice(0, 12)} ${why}`, { code: 'redteam-invalid', hint: kind === SESSIONS ? 'run it again: mirai redteam run --sessions' : 'run it again: mirai redteam run' });
  let value;
  try {
    value = parseJsonStrict(String(text));
  } catch (err) {
    throw bad(`can't be read: ${err.message}`);
  }
  const check = verifySigned(value, keys ?? branchKeys(store.checkout, store.branch, store.gitEnv), { context: kind.context(store.repoId) });
  if (!check.ok) throw bad(`doesn't verify: ${check.reason}`);
  if (value.key !== key || keyOf(value.parts) !== key || value.schema_version !== RESULT_SCHEMA_VERSION || !STATES.includes(value.state)) throw bad('isn\'t for that key');
  return value;
}

// Where the red team stands for the current key's `parts`: { state, key, parts, result, changed,
// blocker_seen }. `changed`: for `stale`, the parts that differ from the newest green result (or the
// newest result when none was green). `blocker_seen`: the newest `blocker` result for the same
// Claude Code binary and macOS build, if any: a later green doesn't make that finding go away, so
// it's shown (V1 is your decision, unit 19).
export function statusFor(store, parts, { keys = null } = {}) {
  const key = keyOf(parts);
  const others = [];
  for (const k of listResults(store)) {
    try {
      const r = k === key ? null : readResult(store, k, { keys });
      if (r) others.push(r);
    } catch {
      // one that doesn't verify counts for nothing
    }
  }
  const same = (r) => r.parts?.claude_code?.sha256 === parts.claude_code?.sha256 && r.parts?.macos === parts.macos;
  const blockers = listBlockers(store, { keys }).filter((b) => b.claude_code === parts.claude_code?.sha256 && b.macos === parts.macos);
  // A blocker result from before these records (or under the current key) counts the same.
  const known = new Set(blockers.map((b) => b.id));
  let current = null;
  try {
    current = readResult(store, key, { keys });
  } catch {
    // the read below says so
  }
  for (const r of [...others, ...(current ? [current] : [])]) {
    if (r.state === 'blocker' && same(r) && !known.has(blockerId(r))) blockers.push({ id: blockerId(r), key: r.key, created_at: r.created_at });
  }
  blockers.sort((a, b) => b.created_at.localeCompare(a.created_at));
  // The newest with no decision of yours, else the newest: status shows it either way.
  const blocker = blockers.find((b) => !readDecision(store, b.id, { keys })) ?? blockers[0] ?? null;
  const blocker_seen = blocker ? { id: blocker.id, key: blocker.key, created_at: blocker.created_at } : null;
  const result = readResult(store, key, { keys });
  if (result) return { state: result.state, key, parts, result, changed: [], blocker_seen };
  if (others.length) {
    const ref = others.find((r) => r.state === 'green') ?? others[0];
    return { state: 'stale', key, parts, result: others[0], changed: changedParts(ref.parts, parts), blocker_seen };
  }
  return { state: 'none', key, parts, result: null, changed: [], blocker_seen };
}

// The blockers on record, verified, newest first.
export function listBlockers(store, { keys = null } = {}) {
  const dir = join(store.dir, RESULT_FOLDER, 'blockers');
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const verifying = keys ?? branchKeys(store.checkout, store.branch, store.gitEnv);
  // One that can't be read or verified is refused, as a result is: never read as "no blocker".
  return names.filter((n) => /^[0-9a-f]{24}\.json$/.test(n)).map((n) => {
    const bad = (why) => new StoreError(`the blocker record ${n.slice(0, 12)} ${why}`, { code: 'redteam-invalid', hint: 'look at it, then remove it yourself if you know why' });
    let value;
    try {
      value = parseJsonStrict(String(readPrivateFile(join(dir, n), { maxBytes: 16 * 1024 * 1024 })));
    } catch (err) {
      throw bad(`can't be read: ${err.message}`);
    }
    if (!verifySigned(value, verifying, { context: blockerContext(store.repoId) }).ok || `${value.id}.json` !== n) throw bad('doesn\'t verify');
    return value;
  }).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// Your decision on a blocker (V1; unit 19a): a later green doesn't clear one by itself, so a launch
// refuses until you've signed that you've read this result and accept it.
const decisionContext = (repoId) => `mirai/redteam-decision/1:${repoId}`;
const decisionPath = (store, id) => {
  if (!/^[0-9a-f]{24}$/.test(id)) throw new StoreError('not a blocker id', { code: 'bad-key' });
  return join(store.dir, RESULT_FOLDER, 'decisions', `${id}.json`);
};
export function writeDecision(store, id, note, signer, { now = () => new Date() } = {}) {
  ensurePrivateDir(join(store.dir, RESULT_FOLDER));
  ensurePrivateDir(join(store.dir, RESULT_FOLDER, 'decisions'));
  const signed = signObject({ id, note, decided_at: now().toISOString() }, signer, { context: decisionContext(store.repoId), now });
  atomicWrite(decisionPath(store, id), `${JSON.stringify(signed, null, 2)}\n`);
  return signed;
}
// The signed decision on a blocker, or null; one that doesn't verify counts for nothing.
export function readDecision(store, id, { keys = null } = {}) {
  const text = readPrivateFile(decisionPath(store, id), { optional: true, maxBytes: 64 * 1024 });
  if (text === null) return null;
  try {
    const value = parseJsonStrict(String(text));
    const check = verifySigned(value, keys ?? branchKeys(store.checkout, store.branch, store.gitEnv), { context: decisionContext(store.repoId) });
    return check.ok && value.id === id ? value : null;
  } catch {
    return null;
  }
}
