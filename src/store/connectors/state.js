import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { readApprovedFile } from '../../cli/human-move.js';
import { briefFiles, documentApproval, epicApproval } from '../../cli/commands/approve.js';
import { contentHash } from '../../sign/sign.js';
import { readJournal } from '../journal.js';
import { readTicketFolder } from '../../lint/lint.js';
import { ticketsOf } from '../../lint/graph.js';
import { fieldsOf } from './common.js';

// The state of a store's documents (unit 38): for `query`, `mirai show <initiative>` and a docs
// merge request's description, from your signed approvals in the journal (D-34), and the gaps that
// keep a docs merge request from merging (Scope 4). Nothing here reads a store's own status: that
// is advisory (D-36).

// An initiative's documents in the store, each with its type, id, state and full path (unit 32's
// `mirai show <initiative>`, now through the store): [{ file, type, id, track, state, path, rel,
// tickets? }]. An epic is approved with its tickets (unit 33); an interview has its own state (35).
export function documentRows({ store, conn, initiative }) {
  const base = conn.base;
  const dir = conn.dir(initiative);
  const rels = `${conn.docsRoot}/${initiative}`;
  const docs = [];
  let names = [];
  try {
    if (lstatSync(dir).isDirectory()) names = readdirSync(dir).filter((f) => /\.md$/i.test(f)).sort();
  } catch {
    names = [];
  }
  for (const file of names) {
    const rel = `${rels}/${file}`;
    let value = {};
    let bytes = null;
    try {
      bytes = readApprovedFile(base, base, rel).bytes;
      value = fieldsOf(bytes);
    } catch {
      value = {};
    }
    const id = typeof value.id === 'string' ? value.id : null;
    let tickets = null;
    if (value.type === 'epic' && id) {
      tickets = [];
      for (const t of ticketsOf(readTicketFolder(dir, { root: base }).all, id)) {
        try {
          tickets.push({ path: `${rels}/${t.path}`, ...readApprovedFile(base, base, `${rels}/${t.path}`) });
        } catch {
          tickets.push({ path: `${rels}/${t.path}`, bytes: Buffer.alloc(0) });
        }
      }
    }
    const a = !id || !bytes ? { approved: false, stale: false } : tickets ? epicApproval(store, id, bytes, tickets) : documentApproval(store, id, bytes, value.type === 'brief' ? briefFiles(base, rel, bytes) : undefined);
    const interview = value.type === 'interview';
    docs.push({
      file, rel, type: typeof value.type === 'string' ? value.type : null, id, track: typeof value.track === 'string' ? value.track : null,
      state: bytes === null ? 'unreadable' : interview ? (typeof value.state === 'string' ? value.state : 'no state') : a.approved ? 'approved' : a.stale ? 'changed since approval' : 'not approved',
      path: join(dir, file),
      ...(tickets ? { tickets: tickets.length } : {}),
    });
  }
  return docs;
}

// The store's own state name for a row's state (the status map's keys).
export const storeStateOf = (state) => (state === 'approved' ? 'approved' : state === 'changed since approval' ? 'changed_since_approval' : 'not_approved');

// The gaps between an initiative's documents as they are (`docs`: [{ rel, bytes }], every file of
// the folder at the docs merge request's head) and your signed approvals: [{ path, gap, hint }].
// Empty means every document is approved as it is, and the epic's approval covers the ticket set
// (Scope 4; decision 1). Only your signed lines count (readJournal verifies them).
export function approvalGaps({ store, docs, events = null }) {
  const all = (events ?? readJournal(store).events).filter((e) => e.type === 'approval' && e.by === 'human');
  const last = (kind, id) => all.filter((e) => e.kind === kind && e.item === id).at(-1) ?? null;
  const byRel = new Map(docs.map((d) => [d.rel, d]));
  const hashOf = (rel) => (byRel.has(rel) ? contentHash(byRel.get(rel).bytes) : null);
  const gaps = [];
  const parsed = docs.map((d) => ({ ...d, fm: /\.md$/i.test(d.rel) ? fieldsOf(d.bytes) : null }));
  const covered = new Set();
  const epics = parsed.filter((d) => d.fm?.type === 'epic');
  for (const d of parsed) {
    if (!d.fm) {
      gaps.push({ path: d.rel, gap: 'isn\'t a document: a docs merge request carries the initiative\'s Markdown documents only', hint: 'remove it from the folder, then publish again' });
      continue;
    }
    const { type } = d.fm;
    const id = typeof d.fm.id === 'string' ? d.fm.id : null;
    if (type === 'brief' || type === 'prd' || type === 'epic') {
      const a = id ? last(type, id) : null;
      if (!a) gaps.push({ path: d.rel, gap: `a missing approval: the ${type} ${id ?? '(no id)'} has none${type === 'epic' ? ', so there is no ticket-set approval' : ''}`, hint: `mirai approve ${id ?? '<id>'} --file ${d.rel}` });
      else if (a.decision === 'rejected') gaps.push({ path: d.rel, gap: `the ${type} ${id} was rejected`, hint: `fix it, then mirai approve ${id} --file ${d.rel}` });
      else if (a.content_hash !== contentHash(d.bytes) || a.path !== d.rel) gaps.push({ path: d.rel, gap: `changed after its approval: the ${type} ${id} isn't the file you approved`, hint: `mirai approve ${id} --file ${d.rel}` });
      else {
        for (const f of a.files ?? []) {
          if (hashOf(f.path) !== f.content_hash) gaps.push({ path: f.path, gap: `changed after its approval: it was signed with the ${type} ${id}, and isn't that file now`, hint: `mirai approve ${id} --file ${d.rel}` });
          else covered.add(f.path);
        }
        if (type === 'epic') {
          const mine = parsed.filter((t) => (t.fm?.type === 'story' || t.fm?.type === 'bug') && t.fm.epic === id).map((t) => t.rel).sort();
          const signed = (a.files ?? []).map((f) => f.path).sort();
          const extra = mine.filter((p) => !signed.includes(p));
          if (extra.length) gaps.push({ path: d.rel, gap: `no ticket-set approval for ${extra.join(', ')}: the epic ${id}'s approval doesn't cover ${extra.length === 1 ? 'it' : 'them'}`, hint: `mirai approve ${id} --file ${d.rel}` });
        }
      }
      continue;
    }
    if (type === 'story' || type === 'bug') continue; // below, once every epic is read
    if (type === 'interview') continue; // below: its brief's approval binds it
    gaps.push({ path: d.rel, gap: `a ${type ?? 'document with no type'} has no approval MIRAI checks before a docs merge`, hint: 'keep it out of the initiative\'s folder' });
  }
  for (const d of parsed.filter((x) => x.fm && (x.fm.type === 'story' || x.fm.type === 'bug' || x.fm.type === 'interview'))) {
    if (covered.has(d.rel)) continue;
    if (d.fm.type === 'interview') {
      gaps.push({ path: d.rel, gap: 'a missing approval: the interview isn\'t bound by its brief\'s approval as it is now', hint: 'link it from the brief ("Interview:" line), then approve the brief again' });
      continue;
    }
    const epic = epics.find((e) => e.fm.id === d.fm.epic);
    // A changed or uncovered ticket under an epic already has its gap on the epic's line.
    if (epic && gaps.some((g) => g.path === epic.rel || g.path === d.rel)) continue;
    gaps.push({ path: d.rel, gap: `no ticket-set approval: the ticket ${d.fm.id ?? ''} isn't covered by an epic's signed approval`.replace('  ', ' '), hint: epic ? `mirai approve ${epic.fm.id} --file ${epic.rel}` : 'its epic, approved with its tickets (mirai approve <epic-id> --file <epic.md>)' });
  }
  if (!epics.length) gaps.unshift({ path: '(the initiative)', gap: 'no ticket-set approval: the initiative has no epic approved with its tickets yet, and the docs merge request merges after it (decision 1)', hint: 'write the epic and its tickets, publish again, then mirai approve <epic-id> --file <epic.md>' });
  return gaps;
}

// Where the repo store's document is in the docs merge request flow, from the journal: the last
// docs_published line for the initiative that lists the file with these bytes, and a docs_merged
// after it. { state: 'in_docs_mr' | 'merged', branch } or null.
export function publishedState(events, initiative, rel, hash) {
  let state = null;
  for (const e of events) {
    if (e.item !== initiative) continue;
    if (e.type === 'docs_published') state = (e.files ?? []).some((f) => f.path === rel && f.content_hash === hash) ? { state: 'in_docs_mr', branch: e.branch } : null;
    if (e.type === 'docs_merged' && state) state = { state: 'merged', branch: null };
  }
  return state;
}
