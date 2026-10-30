import { createHash } from 'node:crypto';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { atomicWrite, ensurePrivateDir, readPrivateFile } from '../store/files.js';
import { parseJsonStrict } from '../findings/schema.js';
import { signObject, verifySigned } from '../sign/sign.js';
import { branchKeys } from '../sign/keys.js';

// The test baseline's one home (unit 17b; AR3-11): `<store>/baseline/<sha>.json`, one per
// integration-branch commit, signed with your key, so a change to it shows. Only `mirai
// baseline` (and the orchestrator, through it) writes it; agents can't reach the store. The last
// KEEP_BASELINES are kept.

export const KEEP_BASELINES = 10;
export const BASELINE_SCHEMA_VERSION = 1;
export const BASELINE_FOLDER = 'baseline';
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

// The signature's context: what it's for, and the repo.
export const baselineContext = (repoId) => `mirai/test-baseline/1:${repoId}`;

export const baselinePath = (store, sha) => {
  if (!SHA.test(sha)) throw new StoreError('not a commit id', { code: 'bad-sha' });
  return join(store.dir, BASELINE_FOLDER, `${sha}.json`);
};

// Signs and writes a baseline; keeps the last KEEP_BASELINES. Returns the signed object.
export function writeBaseline(store, baseline, signer, { now = () => new Date() } = {}) {
  const dir = join(store.dir, BASELINE_FOLDER);
  ensurePrivateDir(dir);
  const signed = signObject(baseline, signer, { context: baselineContext(store.repoId), now });
  atomicWrite(baselinePath(store, baseline.sha), `${JSON.stringify(signed, null, 2)}\n`);
  const all = readdirSync(dir).filter((n) => /^[0-9a-f]{40,64}\.json$/.test(n)).map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs })).sort((a, b) => a.t - b.t || a.n.localeCompare(b.n));
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BASELINES))) rmSync(join(dir, old.n), { force: true });
  return signed;
}

// The baseline for `sha`, checked: null when there is none; a baseline whose signature doesn't
// verify with the integration branch's keys, or that isn't for `sha`, is refused (`baseline-invalid`),
// never read as "no known failures".
export function readBaseline(store, sha, { keys = null } = {}) {
  const text = readPrivateFile(baselinePath(store, sha), { optional: true, maxBytes: 64 * 1024 * 1024 });
  if (text === null) return null;
  let value;
  try {
    value = parseJsonStrict(String(text));
  } catch (err) {
    throw new StoreError(`the baseline for ${sha.slice(0, 12)} can't be read: ${err.message}`, { code: 'baseline-invalid', hint: 'record it again: mirai baseline --force' });
  }
  const check = verifySigned(value, keys ?? branchKeys(store.checkout, store.branch, store.gitEnv), { context: baselineContext(store.repoId) });
  if (!check.ok) throw new StoreError(`the baseline for ${sha.slice(0, 12)} doesn't verify: ${check.reason}`, { code: 'baseline-invalid', hint: 'record it again: mirai baseline --force' });
  if (value.sha !== sha || value.schema_version !== BASELINE_SCHEMA_VERSION) throw new StoreError(`the baseline file for ${sha.slice(0, 12)} isn't for that commit`, { code: 'baseline-invalid', hint: 'record it again: mirai baseline --force' });
  return value;
}

// A level's or check's known failures: [{ id, scope, kind?, state, runs, failed, reason? }].
// null means "can't tell", never "none": no baseline, a level it doesn't have (added to the config
// since, or left out by a partial run), or one that was an environment fault or refused. Whoever
// reads it checks `complete` too.
export function knownFailures(baseline, name) {
  const e = baseline?.levels?.[name];
  if (!e || (e.state !== 'pass' && e.state !== 'fail')) return null;
  return e.known_failures ?? [];
}

// The most recent other commit's baseline that verifies: { baseline, sha256 } (the hash of its
// file), or null. For a baseline's growth: what it knows that the previous one didn't.
export function latestOther(store, sha) {
  const dir = join(store.dir, BASELINE_FOLDER);
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const others = names.filter((n) => /^[0-9a-f]{40,64}\.json$/.test(n) && n !== `${sha}.json`).map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t || b.n.localeCompare(a.n));
  for (const { n } of others) {
    try {
      const baseline = readBaseline(store, n.slice(0, -5));
      if (baseline) return { baseline, sha256: createHash('sha256').update(readPrivateFile(join(dir, n), { maxBytes: 64 * 1024 * 1024 })).digest('hex') };
    } catch {
      // One that doesn't verify isn't a previous baseline.
    }
  }
  return null;
}
