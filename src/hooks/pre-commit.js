import { posix } from 'node:path';

import { REGISTRY_DIR } from '../cli/commands/lint.js';
import { loadRegistry } from '../config/registry.js';
import { readFrontmatter } from '../lint/frontmatter.js';
import { verifyBranchRecord } from '../store/branch-record.js';
import { blobAt, workTreeChanges } from '../store/git.js';
import { readJournal } from '../store/journal.js';
import { contentHash } from '../sign/sign.js';
import { PROOF_NAME, RECORDS_DIR, readProof } from '../proofs/records.js';
import { nextDraftName } from '../status/documents.js';
import { versionOf } from '../loop/docs.js';

// The documents' part of MIRAI's pre-commit (unit 44, decision 9): a document's state comes from
// your signed lines in the journal, never from its frontmatter, and a change to the signed records
// needs a valid signature. On the staged files only:
// - refused: a document whose type keeps its status in the store (`status = "forbidden"`: a brief,
//   a PRD, an interview …) with a `status` field, naming the file and line;
// - refused: a staged change under .mirai/records/ that doesn't verify against the committed public
//   keys, as `mirai gate check` reads them (src/proofs/check.js);
// - warned, never refused: a change to a document whose last signed approval matches it as it is in
//   HEAD: that approval goes stale, with the two ways out.
// `git commit --no-verify` skips it, as with pre-push; CI (54) is the backstop.

const MAX = 1024 * 1024;

// The staged paths (added, copied, renamed, modified or type-changed; deletions aren't read):
// [{ path, x }] from `git status --porcelain=v2 -z`.
export function stagedChanges(entries) {
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.startsWith('1 ')) {
      const f = e.split(' ');
      if ('AMT'.includes(f[1][0])) out.push({ path: f.slice(8).join(' '), x: f[1][0] });
    } else if (e.startsWith('2 ')) {
      const f = e.split(' ');
      if ('RC'.includes(f[1][0])) out.push({ path: f.slice(9).join(' '), x: f[1][0] });
      i++;
    }
  }
  return out;
}

// { refused: [{ path, line, why, hint }], warnings: [{ path, why, hint }] }. `store`: MIRAI's store
// for the warning (the journal) and the records' check (the committed keys, the repo id); without
// one, a staged record can't be checked, so it's refused.
export function documentsPreCommit({ root, env, store = null, keys = null, registry = loadRegistry(REGISTRY_DIR) }) {
  const refused = [];
  const warnings = [];
  const staged = stagedChanges(workTreeChanges(root, env));
  let events = null;
  const journal = () => {
    if (events === null) {
      try {
        events = store ? readJournal(store).events : [];
      } catch {
        events = [];
      }
    }
    return events;
  };
  for (const { path } of staged) {
    if (path.startsWith(`${RECORDS_DIR}/`)) {
      const why = recordProblem({ root, env, path, store, keys });
      if (why) refused.push({ path, line: 1, why, hint: 'MIRAI writes these records, signed (mirai gate record, mirai ship); unstage it: git restore --staged ' + path });
      continue;
    }
    if (!/\.md$/i.test(path)) continue;
    const bytes = blobAt(root, '', path, env, { maxBytes: MAX });
    if (!bytes) continue;
    let fm;
    try {
      fm = readFrontmatter(bytes, { source: path, positions: true });
    } catch {
      continue;
    }
    const value = fm?.value ?? {};
    const def = typeof value.type === 'string' && Object.hasOwn(registry.documentTypes, value.type) ? registry.documentTypes[value.type] : null;
    if (!def) continue;
    if ((def.status ?? 'required') === 'forbidden' && Object.hasOwn(value, 'status')) {
      refused.push({ path, line: fm.positions?.get('status')?.line ?? 1, why: `a ${def.name} keeps no status in its frontmatter (status: ${String(value.status).slice(0, 40)}): its state comes from your signed approvals in MIRAI's journal`, hint: `take the status line out; approve it with: mirai approve ${typeof value.id === 'string' ? value.id : '<id>'} --file ${path}` });
      continue;
    }
    // The approval this commit makes stale: your last accepted one, for the file as it is in HEAD.
    if (!store || typeof value.id !== 'string') continue;
    const last = journal().filter((e) => e.type === 'approval' && e.by === 'human' && e.item === value.id && e.path === path).at(-1);
    if (!last || last.decision === 'rejected') continue;
    const head = blobAt(root, 'HEAD', path, env, { maxBytes: MAX });
    if (!head || contentHash(head) !== last.content_hash || contentHash(bytes) === last.content_hash) continue;
    let draft = null;
    try {
      draft = nextDraftName(path, versionOf(path) + 1);
    } catch {
      draft = null;
    }
    warnings.push({ path, why: `this commit makes your approval of the ${last.kind} ${value.id} (seq ${last.seq}) stale`, hint: `write a new draft beside it${draft ? ` (${posix.basename(draft)})` : ''}, or approve it again: mirai approve ${value.id} --file ${path}` });
  }
  return { refused, warnings };
}

// Why a staged file under .mirai/records/ isn't a record MIRAI signed, or null when it verifies.
function recordProblem({ root, env, path, store, keys }) {
  const m = /^\.mirai\/records\/([^/]+)\/([^/]+)$/.exec(path);
  if (!m) return 'it isn\'t a record MIRAI writes (a ticket\'s folder holds branch.json and its proofs)';
  if (!store || !keys) return 'it can\'t be checked here (no MIRAI store on this machine to read the repo\'s keys from)';
  const bytes = blobAt(root, '', path, env, { maxBytes: 256 * 1024 });
  if (!bytes) return 'it is too large, or can\'t be read';
  const [, ticket, name] = m;
  if (name === 'branch.json') {
    let named = null;
    try {
      named = JSON.parse(bytes.toString('utf8'))?.branch;
    } catch {
      named = null;
    }
    const v = typeof named === 'string' ? verifyBranchRecord(bytes, { branch: named, keys, repoId: store.repoId }) : { ok: false, reason: 'it isn\'t JSON' };
    if (!v.ok) return `its signature doesn't verify against the committed keys: ${v.reason}`;
    return v.record.ticket === ticket ? null : 'it is a branch record for another ticket';
  }
  if (!PROOF_NAME.test(name)) return 'it isn\'t a record MIRAI writes';
  const r = readProof(bytes, { name, ticket, keys, repoId: store.repoId });
  return r.ok ? null : `its signature doesn't verify against the committed keys: ${r.reason}`;
}
