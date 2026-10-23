import { join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { BRANCH } from '../config/config-schema.js';
import { TICKET_ID } from '../status/ticket-file.js';
import { atomicWrite, readPrivateFile } from './files.js';
import { withSeq } from './journal.js';

// The branch registry (unit 05b; D-15): the store's local index of branches MIRAI registered,
// keyed by (branch, creation_sha). `createStore` writes it empty, so a missing file means it
// was lost, not "never used", and pushes of trailer branches are blocked until `doctor`
// rebuilds it from the branch records (TL3-22).

export const BRANCHES_SCHEMA_VERSION = 1;
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
export const EMPTY_REGISTRY = `${JSON.stringify({ schema_version: BRANCHES_SCHEMA_VERSION, entries: [] }, null, 2)}\n`;

const file = (store) => join(store.dir, 'branches.json');

function corrupt(path, why) {
  return new StoreError(`${path}: ${why}`, { path, code: 'registry', hint: 'run: mirai doctor (it rebuilds the registry from the branch records)' });
}

// The registry's entries. A missing or unreadable file is a StoreError with code `registry`.
export function readRegistry(store) {
  const path = file(store);
  const text = readPrivateFile(path, { maxBytes: 4 * 1024 * 1024, optional: true });
  if (text === null) throw corrupt(path, 'the MIRAI branch registry is missing');
  let r;
  try {
    r = JSON.parse(text);
  } catch {
    throw corrupt(path, 'the MIRAI branch registry is not readable');
  }
  if (r?.schema_version > BRANCHES_SCHEMA_VERSION) {
    throw new StoreError(`${path}: written by a newer MIRAI`, { path, code: 'version', hint: 'update MIRAI before using this store' });
  }
  const valid = (e) => e && BRANCH.test(e.branch) && SHA.test(e.creation_sha) && TICKET_ID.test(e.ticket) && SHA.test(e.base_sha) && Number.isSafeInteger(e.seq);
  if (!(r && r.schema_version === BRANCHES_SCHEMA_VERSION && Array.isArray(r.entries) && r.entries.every(valid))) {
    throw corrupt(path, 'the MIRAI branch registry is not valid');
  }
  return r.entries.map((e) => Object.freeze({ ...e }));
}

function writeRegistry(store, entries) {
  atomicWrite(file(store), `${JSON.stringify({ schema_version: BRANCHES_SCHEMA_VERSION, entries }, null, 2)}\n`);
}

function check({ branch, creation_sha: sha, ticket }) {
  if (!BRANCH.test(branch ?? '')) throw new TypeError('not a branch name');
  if (!SHA.test(sha ?? '')) throw new TypeError('creation_sha is not a full commit id');
  if (!TICKET_ID.test(ticket ?? '')) throw new TypeError('not a ticket key');
}

// Registers a branch MIRAI created: the index and its `branch_registered` event, one seq.
export function registerBranch(store, { branch, creation_sha, ticket, base_sha }) {
  check({ branch, creation_sha, ticket });
  if (!SHA.test(base_sha ?? '')) throw new TypeError('base_sha is not a full commit id');
  return withSeq(store, ({ take, event }) => {
    const entries = readRegistry(store);
    if (entries.some((e) => e.branch === branch && e.creation_sha === creation_sha)) {
      throw new StoreError(`${branch} is already registered`, { code: 'registered', exitCode: EXIT.BLOCKED });
    }
    const seq = take();
    writeRegistry(store, [...entries, { branch, creation_sha, ticket, base_sha, seq }]);
    event(seq, { type: 'branch_registered', by: 'script', branch, creation_sha, ticket });
    return seq;
  });
}

// Clears a branch on merge or delete: the index and its `branch_cleared` event, one seq.
export function clearBranch(store, { branch, creation_sha }) {
  if (!BRANCH.test(branch ?? '') || !SHA.test(creation_sha ?? '')) throw new TypeError('a branch and its creation_sha');
  return withSeq(store, ({ take, event }) => {
    const entries = readRegistry(store);
    const found = entries.find((e) => e.branch === branch && e.creation_sha === creation_sha);
    if (!found) throw new StoreError(`${branch} is not registered`, { code: 'not-registered', exitCode: EXIT.BLOCKED });
    const seq = take();
    writeRegistry(store, entries.filter((e) => e !== found));
    event(seq, { type: 'branch_cleared', by: 'script', branch, creation_sha, ticket: found.ticket });
    return seq;
  });
}

// The registered entries for a branch name (any creation commit).
export function lookupBranch(store, branch) {
  return readRegistry(store).filter((e) => e.branch === branch);
}

// Whether the gates apply to a push (D-15), for the pre-push hook (unit 26):
// - 'in-scope': any commit has the trailer, a branch.json record exists, the committer is
//   MIRAI's identity, or the branch is in the index;
// - 'blocked': the index is missing or unreadable and the branch shows any MIRAI sign (the
//   trailer, a record, MIRAI's committer): fail closed, because the index can't be consulted;
// - 'untouched': a human branch.
// `isAncestor(sha)` (optional, from the hook's git) says whether a registry entry's creation
// commit is in the pushed history, so a stale entry for a deleted branch doesn't capture a
// later human branch with the same name. Without it, every entry for the name counts (fail
// closed).
// Returns { scope, reasons, registered, entries, error? }: every reason that applies (unit 26
// checks, for example, that a registered branch has the trailer on every commit), and the
// StoreError to raise when blocked (exit 4).
export function pushScope(store, { branch, hasTrailer = false, hasBranchRecord = false, miraiCommitter = false, isAncestor }) {
  let entries = [];
  let indexError = null;
  try {
    entries = lookupBranch(store, branch).filter((e) => (isAncestor ? isAncestor(e.creation_sha) === true : true));
  } catch (err) {
    if (!(err instanceof StoreError) || !['registry', 'missing', 'unreadable', 'encoding', 'too-large', 'symlink', 'mode', 'owner', 'not-file'].includes(err.code)) throw err;
    indexError = err;
  }
  const reasons = [
    ...(hasTrailer ? ['a commit has the Mirai-Ticket trailer'] : []),
    ...(hasBranchRecord ? ['a branch.json record exists'] : []),
    ...(miraiCommitter ? ["the committer is MIRAI's git identity"] : []),
    ...(entries.length > 0 ? ['the branch is in the registry'] : []),
  ];
  const registered = entries.length > 0;
  if (indexError && reasons.length > 0) {
    const error = new StoreError('the MIRAI branch registry is missing or corrupt, so this MIRAI branch can\'t be pushed', {
      path: indexError.path,
      code: 'registry-blocked',
      exitCode: EXIT.BLOCKED,
      hint: 'run: mirai doctor to rebuild it from the branch records',
    });
    return { scope: 'blocked', reasons: ['the registry is missing or corrupt', ...reasons], registered: false, entries: [], error };
  }
  if (reasons.length > 0) return { scope: 'in-scope', reasons, registered, entries };
  return { scope: 'untouched', reasons: ['a human branch'], registered: false, entries: [] };
}
