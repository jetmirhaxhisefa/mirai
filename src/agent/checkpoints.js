import { join } from 'node:path';

import { atomicWrite, ensurePrivateDir, readPrivateFile } from '../store/files.js';
import { commitOf, setRef } from '../store/git.js';

// Checkpoints (unit 22; design/01 §7 step 1, R-M6): before every step, a ref at the commit it
// starts from, `refs/mirai/checkpoints/<ticket>/<n>`, so "redo the step" is a reset to it. The
// first, the branch record's commit, is the ticket's `baseline_revision` for unit 23's red check;
// refs are only ever created, never moved. They're listed in the store with the step and time.
// Refs under refs/mirai/ are never pushed (unit 46 pushes branches by name).

const file = (store, ticket) => join(store.dir, 'tickets', ticket, 'checkpoints.json');

export function checkpoints(store, ticket) {
  const text = readPrivateFile(file(store, ticket), { optional: true, maxBytes: 1024 * 1024 });
  if (text === null) return [];
  const list = JSON.parse(String(text));
  if (!Array.isArray(list)) throw new TypeError('checkpoints.json is not a list');
  return list;
}

// The checkpoints of one branch, by its record's commit (`creationSha`): a branch made again for
// the ticket starts a list of its own, and never resets to the old one's commits (unit 22 review).
const ofBranch = (store, ticket, creationSha) => checkpoints(store, ticket).filter((c) => !creationSha || c.creation_sha === creationSha);
export const lastCheckpoint = (store, ticket, creationSha = null) => ofBranch(store, ticket, creationSha).at(-1) ?? null;
export const baselineRevision = (store, ticket, creationSha = null) => ofBranch(store, ticket, creationSha)[0]?.sha ?? null;

// Adds one: the ref (created, never moved) and its line. Returns { n, ref, sha }. The number is past
// every ref already there, so a crash between the ref and its line, or a lost list, never jams it.
export function addCheckpoint(store, ticket, { step, sha, creationSha = null, now = () => new Date() }) {
  const list = checkpoints(store, ticket);
  let n = Math.max(0, ...list.map((c) => c.n)) + 1;
  while (commitOf(store.checkout, `refs/mirai/checkpoints/${ticket}/${n}`, store.gitEnv) !== null) n++;
  const ref = `refs/mirai/checkpoints/${ticket}/${n}`;
  setRef(store.checkout, ref, sha, store.gitEnv, { create: true });
  ensurePrivateDir(join(store.dir, 'tickets'));
  ensurePrivateDir(join(store.dir, 'tickets', ticket));
  atomicWrite(file(store, ticket), `${JSON.stringify([...list, { n, step, sha, ref, creation_sha: creationSha, at: now().toISOString() }], null, 2)}\n`);
  return { n, ref, sha };
}
