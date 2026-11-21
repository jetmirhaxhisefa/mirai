import { join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { parseJsonStrict } from '../findings/schema.js';
import { contentHash } from '../sign/sign.js';
import { atomicWrite, ensurePrivateDir, readPrivateFile, withLock } from './files.js';

// The reader test's results (unit 34), one file per document in the store:
// `reader-tests/<document id>.json`, { schema_version, id, results: [entry …] }, oldest first.
// Each entry is one summary as it was tested, keyed by the summary's hash, with its round:
//   { summary_hash, round, result: 'pass' | 'fail', failed: [question …], answers: { <question>:
//     { answer, quote, ok, why } }, model, tier, path, at, hash }
// `hash` is the entry's own content hash (over every other field), which an approval line records.
// The round is 1 for the first summary tested, and one more for each changed summary after it; a
// summary tested before keeps its entry and its round (a rerun on it costs no run).

export const READER_DIR = 'reader-tests';
export const READER_SCHEMA = 1;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;

const pathOf = (store, id) => {
  if (!ID.test(String(id ?? ''))) throw new StoreError(`${JSON.stringify(String(id).slice(0, 40))} isn't a document id the store can keep a reader test for`, { code: 'bad-id' });
  return join(store.dir, READER_DIR, `${id}.json`);
};

// The hash an entry is recorded under: its content without `hash`, keys in a fixed order.
export function entryHash(entry) {
  const { hash: _drop, ...rest } = entry;
  return contentHash(Buffer.from(JSON.stringify(sorted(rest))));
}
function sorted(v) {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]));
  return v;
}

// Every result for the document, oldest first. An entry whose hash doesn't match is refused
// outright: never read as "no result", which would hide a changed record.
export function readReaderTests(store, id) {
  const text = readPrivateFile(pathOf(store, id), { optional: true, maxBytes: 1024 * 1024 });
  if (text === null) return [];
  const bad = (why) => new StoreError(`the reader-test record for ${id} ${why}`, { code: 'reader-test-invalid', hint: `look at it; if you know why, remove ${pathOf(store, id)} and run mirai reader-test again` });
  let value;
  try {
    value = parseJsonStrict(String(text));
  } catch {
    throw bad('can\'t be read');
  }
  if (value?.schema_version !== READER_SCHEMA || value.id !== id || !Array.isArray(value.results)) throw bad('isn\'t one MIRAI wrote');
  for (const e of value.results) {
    if (!HASH.test(e?.summary_hash ?? '') || !HASH.test(e?.hash ?? '') || entryHash(e) !== e.hash) throw bad('was changed after it was written');
  }
  return value.results;
}

// The result for this exact summary, or null.
export const readerResultFor = (store, id, summaryHash) => readReaderTests(store, id).filter((e) => e.summary_hash === summaryHash).at(-1) ?? null;

// The round a new summary of this document would be.
export const nextRound = (store, id) => readReaderTests(store, id).reduce((n, e) => Math.max(n, e.round), 0) + 1;

// Records one result (without `hash`; it's added). Under the store's lock for the file, so two
// tests of one document never lose each other's line. Returns the entry as recorded.
export function recordReaderTest(store, id, entry) {
  const file = pathOf(store, id);
  ensurePrivateDir(join(store.dir, READER_DIR));
  return withLock(`${file}.lock`, `reader test of ${id}`, () => {
    const results = readReaderTests(store, id);
    const full = { ...entry, hash: null };
    full.hash = entryHash(full);
    atomicWrite(file, `${JSON.stringify({ schema_version: READER_SCHEMA, id, results: [...results, full] }, null, 2)}\n`);
    return full;
  });
}
