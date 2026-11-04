import { signObject, verifySigned } from '../sign/sign.js';
import { blobAt, changedNames, commitOf, isAncestor, lsTree, revList } from './git.js';

// A ticket branch's record (unit 22; D-15, design/01 §11, R3-M10, AR3-4):
// `.mirai/records/<ticket>/branch.json`, the branch's first commit, signed with your key, so CI and
// the pre-push hook can see the branch is MIRAI's even without the store. It names the ticket, the
// branch and the commit it started from. A path per ticket (D-15): two branches never add the same
// file, and agents are denied `.mirai/records/` (D-17). A record counts only where it sits: added
// by the first commit after its base, whose parent is that base, so an old record can't be
// replayed onto another branch of the same name.

export const recordPath = (ticket) => `.mirai/records/${ticket}/branch.json`;
export const BRANCH_RECORD_SCHEMA = 'mirai-branch-record/1';
export const branchRecordContext = (repoId) => `mirai/branch-record/1:${repoId}`;

export function signBranchRecord({ ticket, branch, baseSha, signer, repoId, now = () => new Date() }) {
  const record = { schema: BRANCH_RECORD_SCHEMA, ticket, branch, base_sha: baseSha, created_at: now().toISOString() };
  return signObject(record, signer, { context: branchRecordContext(repoId), now });
}

export const branchRecordText = (record) => `${JSON.stringify(record, null, 2)}\n`;

// Whether `bytes` is a valid record for `branch`, signed by a key on the integration branch:
// { ok, keyId?, record?, reason? }.
export function verifyBranchRecord(bytes, { branch, keys, repoId }) {
  let record;
  try {
    record = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes));
  } catch {
    return { ok: false, reason: 'the record isn\'t JSON' };
  }
  if (record?.schema !== BRANCH_RECORD_SCHEMA) return { ok: false, reason: 'not a branch record' };
  const v = verifySigned(record, keys, { context: branchRecordContext(repoId) });
  if (!v.ok) return v;
  if (record.branch !== branch) return { ok: false, reason: `the record is for ${String(record.branch).slice(0, 80)}, not ${branch}` };
  return { ok: true, keyId: v.keyId, record };
}

// The branch's record, checked where it sits: { ok, keyId?, record?, creationSha?, reason? }. The
// record at the tip naming this branch, signed; its base an ancestor; the first commit after the
// base adds exactly that record, with the base as its parent.
export function verifyBranchAt({ root, env, branch, keys, repoId }) {
  const ref = `refs/heads/${branch}`;
  const entries = (lsTree(root, ref, '.mirai/records', env, { recursive: true }) ?? []).filter((e) => e.type === 'blob' && e.mode !== '120000' && /^\.mirai\/records\/[^/]+\/branch\.json$/.test(e.path));
  let found = null;
  for (const e of entries) {
    const bytes = blobAt(root, ref, e.path, env, { maxBytes: 64 * 1024 });
    const v = bytes ? verifyBranchRecord(bytes, { branch, keys, repoId }) : { ok: false };
    if (v.ok && e.path === recordPath(v.record.ticket)) {
      found = { ...v, path: e.path };
      break;
    }
  }
  if (!found) return { ok: false, reason: entries.length ? 'no record there verifies for this branch' : 'it has no record' };
  const base = found.record.base_sha;
  if (typeof base !== 'string' || !commitOf(root, base, env) || !isAncestor(root, base, ref, env)) return { ok: false, reason: 'the record\'s base isn\'t in the branch\'s history' };
  const first = (revList(root, `${base}..${ref}`, env, { reverse: true, max: 1, firstParent: true }) ?? [])[0];
  if (!first || commitOf(root, `${first}^1`, env) !== base) return { ok: false, reason: 'the branch doesn\'t start at the record\'s base' };
  const added = changedNames(root, base, first, env) ?? [];
  if (added.length !== 1 || added[0] !== found.path) return { ok: false, reason: 'the record isn\'t the branch\'s first commit' };
  // The record at the tip is the one the first commit added, never another signed one swapped in.
  const blob = (rev) => (lsTree(root, rev, found.path, env) ?? []).find((e) => e.path === found.path)?.sha ?? null;
  if (blob(first) === null || blob(first) !== blob(ref)) return { ok: false, reason: 'the record at the tip isn\'t the one the branch started with' };
  return { ...found, creationSha: first };
}
