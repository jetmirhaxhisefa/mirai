import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { verifyBranchRecord } from '../store/branch-record.js';
import { blobAt, commitOf, lsTree, mergeBase } from '../store/git.js';
import { codeHash, codePathsHide } from './hash.js';
import { PROOF_NAME, RECORDS_DIR, readProof } from './records.js';

// Checking a ticket's proofs at a commit (unit 25a; D-16): what `mirai gate check` runs, and what
// the pre-push hook (unit 26) and CI (unit 54) will. It needs no store and no private key: the
// commit, the integration branch's commit (its `gate.code_paths` and its public keys come from
// the caller, read from there), and the repo id.
// - The code hash is recomputed here, from merge-base(integration, commit)..commit; a hash written
//   in a file never counts by itself.
// - Every file in `.mirai/records/<ticket>/` must be the branch record or a proof that verifies:
//   anything else there is `bad-record` (Jet's default: a record alone doesn't make an MR high-risk,
//   so nothing else may sit beside them).
// - It passes when a `review` proof and a `gate` proof both carry that hash.
// Returns { outcome: 'pass' | 'no-proof' | 'stale' | 'bad-record' | 'nothing-to-prove', hash,
// files, base, matched: { review, gate }, missing, bad, others }.
export function checkProofs({ root, env, ticket, commit, integration, codePaths, keys, repoId, rules = null, docsRoot = null }) {
  // A code_paths that leaves a protected path out would let a change there pass unproven.
  const hidden = rules ? codePathsHide(codePaths, rules, docsRoot) : [];
  if (hidden.length) throw Object.assign(new MiraiError(`gate.code_paths leaves protected paths out of the proof hash (${hidden.slice(0, 3).map((h) => h.path).join(', ')})`, EXIT.CONFIG), { code: 'code-paths-hide', hint: 'only .mirai/** and the docs root may be excluded: fix [gate] code_paths on the integration branch' });
  const head = commitOf(root, commit, env);
  if (!head) throw Object.assign(new MiraiError(`${String(commit).slice(0, 64)} isn't a commit here`, EXIT.USAGE), { code: 'no-commit' });
  const base = mergeBase(root, integration, head, env);
  if (!base) throw Object.assign(new MiraiError(`${head.slice(0, 12)} shares no history with the integration branch`, EXIT.BLOCKED), { code: 'no-base' });
  const { hash, files } = codeHash({ root, env, base, head, codePaths });
  const out = { ticket, commit: head, base, hash, files, matched: { review: null, gate: null }, missing: [], bad: [], others: [] };
  const folder = `${RECORDS_DIR}/${ticket}`;
  const entries = lsTree(root, head, `${folder}/`, env, { recursive: true }) ?? [];
  for (const e of entries) {
    const rel = e.path.slice(folder.length + 1);
    const bad = (reason) => out.bad.push({ path: e.path, reason });
    if (e.type !== 'blob' || e.mode !== '100644' || rel.includes('/')) {
      bad('not a plain file in the ticket\'s records folder');
      continue;
    }
    const bytes = blobAt(root, head, e.path, env, { maxBytes: 256 * 1024 });
    if (!bytes) {
      bad('too large or unreadable');
      continue;
    }
    if (rel === 'branch.json') {
      let named = null;
      try {
        named = JSON.parse(bytes.toString('utf8'))?.branch;
      } catch {
        named = null;
      }
      const v = typeof named === 'string' ? verifyBranchRecord(bytes, { branch: named, keys, repoId }) : { ok: false, reason: 'the branch record isn\'t JSON' };
      if (!v.ok || v.record.ticket !== ticket) bad(v.ok ? 'a branch record for another ticket' : v.reason);
      continue;
    }
    if (!PROOF_NAME.test(rel)) {
      bad('not a record MIRAI writes');
      continue;
    }
    const r = readProof(bytes, { name: rel, ticket, keys, repoId });
    if (!r.ok) {
      bad(r.reason);
      continue;
    }
    const p = { path: e.path, kind: r.proof.kind, round: r.proof.round, keyId: r.keyId, codeHash: r.proof.code_hash, ...(r.proof.kind === 'gate' ? { diffCoverage: r.proof.diff_coverage ?? null } : {}) };
    if (r.proof.code_hash === hash && (r.proof.kind === 'review' || r.proof.kind === 'gate')) {
      // The newest round or attempt of each kind for this hash.
      if (!out.matched[r.proof.kind] || out.matched[r.proof.kind].round < p.round) out.matched[r.proof.kind] = p;
    } else out.others.push(p);
  }
  out.missing = ['review', 'gate'].filter((k) => !out.matched[k]);
  out.outcome = out.bad.length ? 'bad-record'
    : files.length === 0 ? 'nothing-to-prove'
      : out.missing.length === 0 ? 'pass'
        : out.others.length ? 'stale' : 'no-proof';
  return out;
}
