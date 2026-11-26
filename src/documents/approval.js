import { contentHash } from '../sign/sign.js';
import { readJournal } from '../store/journal.js';

// Whether a document is approved as it is now (unit 31 on; moved here by unit 62b so the agents'
// input code, which the red team's cage holds, needn't import the approve command).

// The document types approved with --file that aren't tickets: each on its exact bytes.
export const DOCUMENTS = new Set(['brief', 'prd', 'epic', 'tech-note', 'hld']);

const fileHashes = (files) => files.map((f) => ({ path: f.path, content_hash: contentHash(f.bytes) }));
const signatureOf = (list) => list.map((f) => `${f.path} ${f.content_hash}`).sort().join('\n');

// Whether `bytes` are the document `id` as you last approved it: { approved, stale, seq }.
// Only your signed lines count (readJournal verifies them); your last decision on the document
// is the one that holds. `files` (unit 35: a brief's interview) are the other files its line binds,
// as they are now, [{ path, bytes }]: the same paths with the same bytes, or it's stale. Left out,
// only the document's own bytes are compared.
export function documentApproval(store, id, bytes, files) {
  const last = readJournal(store).events.filter((e) => e.type === 'approval' && e.by === 'human' && DOCUMENTS.has(e.kind) && e.kind !== 'epic' && e.item === id).at(-1);
  if (!last || last.decision === 'rejected') return { approved: false, stale: false, seq: last?.seq ?? null };
  const same = last.content_hash === contentHash(bytes) && (files === undefined || signatureOf(last.files ?? []) === signatureOf(fileHashes(files)));
  return { approved: same, stale: !same, seq: last.seq };
}
