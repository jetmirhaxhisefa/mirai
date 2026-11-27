import { posix } from 'node:path';

import { REGISTRY_DIR } from '../cli/commands/lint.js';
import { loadRegistry } from '../config/registry.js';
import { readFrontmatter } from '../lint/frontmatter.js';
import { verifyBranchRecord } from '../store/branch-record.js';
import { blobAt, lsTree, workTreeChanges } from '../store/git.js';
import { readJournal } from '../store/journal.js';
import { contentHash } from '../sign/sign.js';
import { PROOF_NAME, RECORDS_DIR, readProof } from '../proofs/records.js';
import { nextDraftName } from '../status/documents.js';
import { versionOf } from '../loop/docs.js';
import { signedHashes, typoFixOnly } from '../adr/adr.js';

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

// The number of the initiative's tickets (its tickets/ folder in HEAD) when every one is merged
// into the integration branch (its `mr_merged` line); 0 when there are none, or one isn't.
function shippedTickets({ root, env, dir, events }) {
  let entries;
  try {
    entries = lsTree(root, 'HEAD', `${dir}/tickets/`, env) ?? [];
  } catch {
    return 0;
  }
  const ids = [];
  for (const e of entries.filter((x) => x.type === 'blob' && /\.md$/i.test(x.path))) {
    let v = null;
    try {
      v = readFrontmatter(blobAt(root, 'HEAD', e.path, env, { maxBytes: MAX }) ?? Buffer.alloc(0))?.value ?? null;
    } catch {
      v = null;
    }
    if (v && typeof v.id === 'string' && v.type !== 'epic') ids.push(v.id);
  }
  if (!ids.length) return 0;
  const merged = new Set(events.filter((e) => e.type === 'mr_merged' && e.target === 'integration').map((e) => e.ticket));
  return ids.every((id) => merged.has(id)) ? ids.length : 0;
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
    // Unit 61 (Jet's "A"): an ADR keeps its status in the file, written only by MIRAI at your
    // signature; a person or an agent writes only `proposed`, and an accepted ADR takes typo and
    // link fixes only.
    if (def.name === 'adr') {
      const why = adrCommitProblem({ root, env, path, bytes, value, events: journal() });
      if (why) {
        refused.push({ path, line: fm.positions?.get('status')?.line ?? 1, ...why });
        continue;
      }
    }
    if ((def.status ?? 'required') === 'forbidden' && Object.hasOwn(value, 'status')) {
      refused.push({ path, line: fm.positions?.get('status')?.line ?? 1, why: `a ${def.name} keeps no status in its frontmatter (status: ${String(value.status).slice(0, 40)}): its state comes from your signed approvals in MIRAI's journal`, hint: `take the status line out; approve it with: mirai approve ${typeof value.id === 'string' ? value.id : '<id>'} --file ${path}` });
      continue;
    }
    // Unit 63 (Scope 9): a shipped initiative's LLD is frozen: once every ticket of the initiative
    // is merged into the integration branch, the code owns the shapes.
    if (def.name === 'lld' && store) {
      const shipped = shippedTickets({ root, env, dir: posix.dirname(path), events: journal() });
      if (shipped) {
        refused.push({ path, line: 1, why: `a shipped initiative's LLD is frozen: all ${shipped} of its tickets are merged, so the code owns these shapes`, hint: `write the change into a new initiative's LLD; unstage this one: git restore --staged ${path}` });
        continue;
      }
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

// Why a staged ADR can't be committed, or null: { why, hint }. Bytes you signed (MIRAI wrote the
// status at your approval or review) always pass. Otherwise its status must be `proposed`, and an
// ADR accepted in HEAD takes only typo and link fixes (its status unchanged).
export function adrCommitProblem({ root, env, path, bytes, value, events }) {
  const signed = signedHashes(events, path);
  const hash = contentHash(bytes);
  if (signed.some((x) => x.hash === hash)) return null;
  const head = blobAt(root, 'HEAD', path, env, { maxBytes: MAX });
  let before = null;
  try {
    before = head ? readFrontmatter(head)?.value ?? null : null;
  } catch {
    before = null;
  }
  const id = typeof value.id === 'string' ? value.id : '<id>';
  if (before && before.type === 'adr' && before.status && before.status !== 'proposed') {
    const fix = typoFixOnly(head.toString('utf8'), bytes.toString('utf8'));
    if (fix.ok) return null;
    return { why: `the ADR ${id} is ${before.status} in HEAD, and this changes it beyond typo and link fixes (${fix.why})`, hint: before.status === 'accepted' ? `an accepted decision is final: supersede it, with a new ADR that has supersedes: ${id} (mirai adr new <slug>); unstage this change: git restore --staged ${path}` : `a ${before.status} ADR stays as it is; unstage this change: git restore --staged ${path}` };
  }
  if (value.status !== 'proposed') return { why: `an ADR's status is written only by MIRAI, at your signature (status: ${String(value.status).slice(0, 40)})`, hint: `write status: proposed, then approve it: mirai approve ${id} --file ${path}` };
  return null;
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
