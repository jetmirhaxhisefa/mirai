import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { atomicWrite, ensurePrivateDir, readPrivateFile } from '../store/files.js';
import { parseJsonStrict } from '../findings/schema.js';
import { signObject, verifySigned } from '../sign/sign.js';
import { branchKeys } from '../sign/keys.js';
import { changedParts, keyOf } from './key.js';

// Red-team results (unit 18a): `<store>/redteam/<key>.json`, one per key (src/redteam/key.js),
// signed with your key, so a result can't be written or edited by anything but `mirai redteam
// run`; agents can't reach the store at all. The last KEEP_RESULTS are kept.
//
// States: `green` (every case passed its runs, and the no-model checks hold), `red` (a case
// failed, or a check found something new), `blocker` (a case of V1's condition failed: G18 or an
// escape), `incomplete` (inconclusive cases, unknown checks, or the run stopped). redTeamStatus
// adds `stale` (results exist, none for the current key) and `none`.

export const KEEP_RESULTS = 20;
export const RESULT_SCHEMA_VERSION = 1;
export const RESULT_FOLDER = 'redteam';
export const STATES = Object.freeze(['green', 'red', 'blocker', 'incomplete']);
const KEY = /^[0-9a-f]{64}$/;

export const resultContext = (repoId) => `mirai/redteam/1:${repoId}`;

export function resultPath(store, key) {
  if (!KEY.test(key)) throw new StoreError('not a red-team key', { code: 'bad-key' });
  return join(store.dir, RESULT_FOLDER, `${key}.json`);
}

// Signs and writes a result; keeps the last KEEP_RESULTS. Returns the signed object.
export function writeResult(store, result, signer, { now = () => new Date() } = {}) {
  if (keyOf(result.parts) !== result.key) throw new StoreError('the result\'s key doesn\'t match its parts', { code: 'bad-key' });
  const dir = join(store.dir, RESULT_FOLDER);
  ensurePrivateDir(dir);
  const signed = signObject(result, signer, { context: resultContext(store.repoId), now });
  atomicWrite(resultPath(store, result.key), `${JSON.stringify(signed, null, 2)}\n`);
  const all = listResults(store);
  for (const old of all.slice(KEEP_RESULTS)) rmSync(join(dir, `${old}.json`), { force: true });
  return signed;
}

// The keys of stored results, newest first.
export function listResults(store) {
  const dir = join(store.dir, RESULT_FOLDER);
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
export function readResult(store, key, { keys = null } = {}) {
  const text = readPrivateFile(resultPath(store, key), { optional: true, maxBytes: 16 * 1024 * 1024 });
  if (text === null) return null;
  const bad = (why) => new StoreError(`the red-team result ${key.slice(0, 12)} ${why}`, { code: 'redteam-invalid', hint: 'run it again: mirai redteam run' });
  let value;
  try {
    value = parseJsonStrict(String(text));
  } catch (err) {
    throw bad(`can't be read: ${err.message}`);
  }
  const check = verifySigned(value, keys ?? branchKeys(store.checkout, store.branch, store.gitEnv), { context: resultContext(store.repoId) });
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
  const blocker = others.find((r) => r.state === 'blocker' && same(r));
  const blocker_seen = blocker ? { key: blocker.key, created_at: blocker.created_at } : null;
  const result = readResult(store, key, { keys });
  if (result) return { state: result.state, key, parts, result, changed: [], blocker_seen };
  if (others.length) {
    const ref = others.find((r) => r.state === 'green') ?? others[0];
    return { state: 'stale', key, parts, result: others[0], changed: changedParts(ref.parts, parts), blocker_seen };
  }
  return { state: 'none', key, parts, result: null, changed: [], blocker_seen };
}
