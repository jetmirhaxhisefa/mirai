import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { INPUT_LIMITS } from '../launch/strict.js';
import { sameKey } from '../lint/checks.js';
import { readFrontmatter } from '../lint/frontmatter.js';
import { TICKET_ID } from '../status/ticket-file.js';
import { catBlobs, lsTree } from '../store/git.js';

// The input folder for a ticket's launch (unit 21a; R3-C3, 15a). Everything comes from one commit
// of the integration branch, the trust root's own (D-54), never the work tree: a branch can't plant
// an input, and an edit you haven't merged isn't one. What's given, in order, until the cap:
// the ticket, the plan template, its epic, the ADRs it's governed by, the documents that define
// what it covers (an FR or AC id in their text), the project's conventions, and the plans of its
// epic's other tickets, from the store. `index.json` names every file, where it came from and what
// was left out: past 15a's cap (32 files, 4 MiB) a file is left out whole and named, never cut.

const DOC_MAX = 1024 * 1024;
const SCAN_MAX = 5000;
const SCAN_BYTES = 64 * 1024 * 1024;
// What a ticket's own fields may hold here: anything else is left out, and named (21a review).
const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const AC_ID = /^AC-[A-Za-z0-9][A-Za-z0-9._-]{0,63}?\.[0-9]+$/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ids = (v) => (Array.isArray(v) ? v : []).filter((x) => typeof x === 'string');
const TICKET_TYPES = ['story', 'bug'];
const CONVENTIONS = ['CONTRIBUTING.md', 'CONVENTIONS.md'];

const fail = (message, code, hint) => Object.assign(new MiraiError(message, EXIT.BLOCKED), { code, hint });

// An input file's name from a document id: lower-case, the characters 15a allows.
const fileName = (prefix, id) => `${prefix}-${String(id).toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 50)}.md`;

// The documents under the docs root at `commit`: [{ path, sha, text, fm }] (fm null when it has
// none or it can't be read). Links and large files are left out, as the lint leaves them.
function documentsAt(root, commit, docsRoot, env) {
  const entries = (lsTree(root, commit, docsRoot, env, { recursive: true, sizes: true }) ?? [])
    .filter((e) => e.type === 'blob' && e.mode !== '120000' && e.path.endsWith('.md') && e.size !== null && e.size <= DOC_MAX);
  const total = entries.reduce((n, e) => n + e.size, 0);
  // Past the scan's budget, refused rather than read in part: a ticket must never go unseen.
  if (entries.length > SCAN_MAX || total > SCAN_BYTES) throw fail(`${docsRoot}/ holds ${entries.length} documents (${Math.round(total / 1024 / 1024)} MiB); MIRAI reads at most ${SCAN_MAX} (${SCAN_BYTES / 1024 / 1024} MiB) to find a ticket's inputs`, 'docs-too-large');
  const blobs = catBlobs(root, entries.map((e) => e.sha), env, { maxBytes: DOC_MAX, maxTotal: total + 1024 });
  return entries.flatMap((e) => {
    const bytes = blobs.get(e.sha);
    if (!bytes) return [];
    const text = bytes.toString('utf8');
    let fm = null;
    try {
      fm = readFrontmatter(text)?.value ?? null;
    } catch {
      fm = null;
    }
    return [{ path: e.path, sha: e.sha, bytes, text, fm }];
  });
}

// The ticket's own ACs (AC-<id>.n, bullets in its body) then its covers_ac: what the plan proves.
export function ticketAcs(ticket) {
  const own = [];
  const id = ticket.fm.id;
  const bullet = new RegExp(`^\\s*[-*]\\s+(AC-${escapeRe(String(id))}\\.[0-9]+)\\b`, 'gim');
  for (const m of ticket.text.matchAll(bullet)) if (AC_ID.test(m[1]) && !own.includes(m[1])) own.push(m[1]);
  // Only well-formed ids: they go into the plan's frontmatter, which your approval covers.
  const covered = ids(ticket.fm.covers_ac).filter((ac) => AC_ID.test(ac) && !own.includes(ac));
  return [...own, ...covered];
}

// { inputs: { name: text }, index, ticket: { id, path, fm, text, bytes }, commit }. `config`: the trust
// root's; `store`: where sibling plans are; `template`: the plan template's text.
// `approved(id)`: whether a sibling's plan carries your approval; only those are given.
export function planInputs({ root, env, commit, ticketId, config, store, template, limits = INPUT_LIMITS, approved = () => false }) {
  const docsRoot = config.docs?.root ?? 'docs/mirai';
  const docs = documentsAt(root, commit, docsRoot, env);
  const byId = (id) => docs.filter((d) => d.fm && sameKey(d.fm.id, id));
  const found = byId(ticketId).filter((d) => TICKET_TYPES.includes(d.fm.type));
  if (found.length === 0) throw fail(`there's no ticket ${ticketId} under ${docsRoot}/ on the integration branch (${commit.slice(0, 12)})`, 'no-ticket', 'merge the approved ticket into the integration branch first');
  if (found.length > 1) throw fail(`${found.length} documents on the integration branch have the id ${ticketId}: ${found.map((d) => d.path).join(', ')}`, 'duplicate-ticket');
  const ticket = found[0];

  // Candidates in order of need; each { name, path, why, text }. One file per path; two paths
  // whose names clean up the same get a number, never one lost.
  const wanted = [];
  const want = (name, path, why, text) => {
    if (wanted.some((w) => w.path === path)) return;
    let n = name;
    for (let i = 2; wanted.some((w) => w.name === n); i++) n = name.replace(/\.md$/, `-${i}.md`);
    wanted.push({ name: n, path, why, text });
  };
  want('ticket.md', ticket.path, 'the ticket', ticket.text);
  want('plan-template.md', 'MIRAI: templates/plan.md', 'the plan template to fill', template);
  const missing = [];
  const fm = ticket.fm;
  for (const key of ['epic', 'governed_by', 'covers_fr', 'covers_ac']) {
    const v = fm[key];
    const bad = v === undefined ? [] : key === 'epic' ? (typeof v === 'string' && DOC_ID.test(v) ? [] : [v]) : Array.isArray(v) ? v.filter((x) => typeof x !== 'string' || !(key === 'covers_ac' ? AC_ID : DOC_ID).test(x)) : [v];
    for (const b of bad) missing.push({ id: String(b).slice(0, 80), why: `the ticket's ${key} holds something that isn't an id` });
  }
  const epicId = typeof fm.epic === 'string' && DOC_ID.test(fm.epic) ? fm.epic : null;
  if (epicId) {
    const epic = byId(epicId)[0];
    if (epic) want('epic.md', epic.path, `its epic, ${epicId}`, epic.text);
    else missing.push({ id: epicId, why: 'its epic is not on the integration branch' });
  }
  for (const adr of ids(fm.governed_by).filter((x) => DOC_ID.test(x))) {
    const d = byId(adr)[0];
    if (d) want(fileName('adr', adr), d.path, `governed_by ${adr}`, d.text);
    else missing.push({ id: adr, why: 'governed_by names a document that is not on the integration branch' });
  }
  for (const ref of [...ids(fm.covers_fr).filter((x) => DOC_ID.test(x)), ...ids(fm.covers_ac).filter((x) => AC_ID.test(x))]) {
    const word = new RegExp(`(^|[^A-Za-z0-9-])${escapeRe(ref)}($|[^A-Za-z0-9])`);
    const d = docs.find((x) => x !== ticket && x.fm && !TICKET_TYPES.includes(x.fm.type) && x.fm.type !== 'plan' && word.test(x.text));
    if (d) want(fileName('doc', d.fm.id ?? d.path), d.path, `defines ${ref}`, d.text);
    else missing.push({ id: ref, why: 'no document on the integration branch defines it' });
  }
  const conventions = lsTree(root, commit, '.', env, { sizes: true }) ?? [];
  for (const name of CONVENTIONS) {
    const e = conventions.find((x) => x.path === name && x.type === 'blob' && x.mode !== '120000' && x.size <= DOC_MAX);
    if (e) {
      const bytes = catBlobs(root, [e.sha], env, { maxBytes: DOC_MAX, maxTotal: DOC_MAX + 1024 }).get(e.sha);
      if (bytes) want(fileName('conventions', name.replace(/\.md$/, '')), name, 'the project\'s conventions', bytes.toString('utf8'));
    }
  }
  if (epicId) {
    // Only ids that are store folder names (an id comes from a document, not from MIRAI), and only
    // plans you approved: a rejected or parked one is no example.
    const siblings = docs.filter((d) => d !== ticket && d.fm && TICKET_TYPES.includes(d.fm.type) && sameKey(d.fm.epic, epicId) && TICKET_ID.test(d.fm.id ?? '')).map((d) => d.fm.id).sort();
    for (const id of siblings.filter((x) => approved(x))) {
      let text;
      try {
        text = readFileSync(join(store.dir, 'tickets', id, 'plan.md'), 'utf8');
      } catch {
        continue;
      }
      want(fileName('plan', id), `store: tickets/${id}/plan.md`, `the plan of ${id}, in the same epic`, text);
    }
  }

  // Fill to the cap, index.json included: what doesn't fit is left out whole, and named.
  const inputs = {};
  const given = [];
  const leftOut = [...missing];
  let bytes = 0;
  const reserve = 16 * 1024;
  for (const w of wanted) {
    const size = Buffer.byteLength(w.text);
    if (given.length + 1 >= limits.files || bytes + size + reserve > limits.bytes) {
      if (w.name === 'ticket.md' || w.name === 'plan-template.md') throw fail(`the ticket's inputs are larger than a launch takes (${limits.bytes / 1024 / 1024} MiB)`, 'inputs-too-large');
      leftOut.push({ path: w.path, why: `over the input cap (${limits.files} files, ${limits.bytes / 1024 / 1024} MiB)`, bytes: size });
      continue;
    }
    inputs[w.name] = w.text;
    given.push({ name: w.name, from: w.path, why: w.why, bytes: size });
    bytes += size;
  }
  const index = { schema: 'mirai-inputs/1', ticket: ticket.fm.id, commit, files: given, left_out: leftOut };
  inputs['index.json'] = `${JSON.stringify(index, null, 2)}\n`;
  return { inputs, index, ticket: { id: ticket.fm.id, path: ticket.path, fm: ticket.fm, text: ticket.text, bytes: ticket.bytes }, commit };
}
