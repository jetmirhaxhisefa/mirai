import { join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { parseJsonStrict } from '../findings/schema.js';
import { contentHash } from '../sign/sign.js';
import { atomicWrite, ensurePrivateDir, readPrivateFile, withLock } from './files.js';

// Vera's results (unit 40, Scope 4), one file per document in the store, as 34's reader-test
// results are: `verify/<document id>.json`, { schema_version, id, results: [entry …] }, oldest
// first. Each entry is one version of the document as Vera checked it, keyed by its subject hash
// (the document's bytes, and an epic's ticket files with it: subjectHash), with its round:
//   { subject_hash, content_hash, files: [{ path, content_hash }], round, result: 'pass' | 'open',
//     must_fix, suggestions, findings: [finding …], dropped: [{ id, why, quote }], type, path,
//     model, tier, rung?, launch_id, at, hash }
// `hash` is the entry's own content hash (over every other field), which an approval line records.
// The round is 1 for the first version checked, and one more for each changed version after it; a
// version checked before keeps its entry and its round (a rerun on it costs no run).

export const VERIFY_DIR = 'verify';
export const VERIFY_SCHEMA = 1;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;

const pathOf = (store, id) => {
  if (!ID.test(String(id ?? ''))) throw new StoreError(`${JSON.stringify(String(id).slice(0, 40))} isn't a document id the store can keep a verifier result for`, { code: 'bad-id' });
  return join(store.dir, VERIFY_DIR, `${id}.json`);
};

function sorted(v) {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]));
  return v;
}

// The hash an entry is recorded under: its content without `hash`, keys in a fixed order.
export function entryHash(entry) {
  const { hash: _drop, ...rest } = entry;
  return contentHash(Buffer.from(JSON.stringify(sorted(rest))));
}

// What one check covers: the document's bytes, and for an epic each ticket file ([{ path, bytes }]).
// The same bytes give the same hash, whatever order the files come in.
export function subjectHash(bytes, files = []) {
  const parts = [`document ${contentHash(bytes)}`, ...files.map((f) => `${f.path} ${contentHash(f.bytes)}`).sort()];
  return contentHash(Buffer.from(parts.join('\n')));
}

// Every result for the document, oldest first. An entry whose hash doesn't match is refused
// outright: never read as "no result", which would hide a changed record.
export function readVerifyResults(store, id) {
  const text = readPrivateFile(pathOf(store, id), { optional: true, maxBytes: 4 * 1024 * 1024 });
  if (text === null) return [];
  const bad = (why) => new StoreError(`the verifier's record for ${id} ${why}`, { code: 'verify-invalid', hint: `look at it; if you know why, remove ${pathOf(store, id)} and run mirai verify again` });
  let value;
  try {
    value = parseJsonStrict(String(text), { maxBytes: 4 * 1024 * 1024 });
  } catch {
    throw bad('can\'t be read');
  }
  if (value?.schema_version !== VERIFY_SCHEMA || value.id !== id || !Array.isArray(value.results)) throw bad('isn\'t one MIRAI wrote');
  for (const e of value.results) {
    if (!HASH.test(e?.subject_hash ?? '') || !HASH.test(e?.hash ?? '') || entryHash(e) !== e.hash) throw bad('was changed after it was written');
  }
  return value.results;
}

// The result for this exact version, or null.
export const verifyResultFor = (store, id, subject) => readVerifyResults(store, id).filter((e) => e.subject_hash === subject).at(-1) ?? null;

// The round a new version of this document would be.
export const nextVerifyRound = (store, id) => readVerifyResults(store, id).reduce((n, e) => Math.max(n, e.round), 0) + 1;

// Records one result (without `hash`; it's added), under the store's lock for the file.
export function recordVerifyResult(store, id, entry) {
  const file = pathOf(store, id);
  ensurePrivateDir(join(store.dir, VERIFY_DIR));
  return withLock(`${file}.lock`, `the verifier's result for ${id}`, () => {
    const results = readVerifyResults(store, id);
    const full = { ...entry, hash: null };
    full.hash = entryHash(full);
    atomicWrite(file, `${JSON.stringify({ schema_version: VERIFY_SCHEMA, id, results: [...results, full] }, null, 2)}\n`);
    return full;
  });
}
