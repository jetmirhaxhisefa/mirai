import { join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { BRANCH } from '../config/config-schema.js';
import { validate } from '../config/schema.js';
import { TICKET, PARK_REASONS } from '../status/machines.js';
import { TICKET_ID } from '../status/ticket-file.js';
import { appendLine, atomicWrite, jsonLine, lastJsonLine, readJsonLines, readPrivateFile, withLock } from './files.js';
import { appendRunLineRaw, newestRunLogSeq } from './run-log.js';

// The store journal (unit 05a; D-06): one append-only file of what happened in this repo, and
// one store-wide counter, `seq`, shared with the run logs (05b). Order comes from `seq` only;
// `ts` is for you to read. A number is taken under the journal lock, written to the counter,
// then the event is appended under the same lock, so file order is `seq` order. A crash in
// between leaves a gap, never a duplicate.

export const JOURNAL_SCHEMA_VERSION = 1;
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const ITEM = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

const f = {
  ticket: { type: 'string', pattern: TICKET_ID, patternHint: 'a ticket key' },
  state: { type: 'enum', values: TICKET.states.filter((s) => !TICKET.derived.includes(s)) },
  park_reason: { type: 'enum', values: PARK_REASONS },
  branch: { type: 'string', pattern: BRANCH, patternHint: 'a branch name' },
  sha: { type: 'string', pattern: SHA, patternHint: 'a full commit id' },
  target: { type: 'enum', values: ['integration', 'epic'] },
  text: { type: 'string', pattern: /\S/, patternHint: 'some text' },
  path: { type: 'string', pattern: /^\//, patternHint: 'an absolute path' },
  pid: { type: 'integer', min: 1 },
};

// The journal event types, fixed in code (a test pins the list). `privileged` types are
// written only by MIRAI itself; `mirai log` (05b) may write the others.
export const EVENT_TYPES = Object.freeze({
  status_written: { privileged: true, fields: { ticket: f.ticket, state: f.state, park_reason: f.park_reason }, required: ['ticket', 'state'] },
  pushed: { privileged: true, fields: { ticket: f.ticket, branch: f.branch, sha: f.sha }, required: ['ticket', 'branch', 'sha'] },
  mr_opened: { privileged: true, fields: { ticket: f.ticket, head: f.sha, target: f.branch }, required: ['ticket', 'head', 'target'] },
  // A merge into feature/<epic> names the epic, so `done` can be derived once the epic merges.
  mr_merged: {
    privileged: true,
    fields: { ticket: f.ticket, target: f.target, epic: f.ticket },
    required: ['ticket', 'target'],
    check(e, report) {
      if (e.target === 'epic' && e.epic === undefined) report('epic', 'a merge into an epic branch needs epic');
      if (e.target !== 'epic' && e.epic !== undefined) report('epic', 'epic is only for a merge into an epic branch');
    },
  },
  mr_closed: { privileged: true, fields: { ticket: f.ticket }, required: ['ticket'] },
  epic_merged: { privileged: true, fields: { epic: f.ticket }, required: ['epic'] },
  branch_registered: { privileged: true, fields: { branch: f.branch, creation_sha: f.sha, ticket: f.ticket }, required: ['branch', 'creation_sha', 'ticket'] },
  branch_cleared: { privileged: true, fields: { branch: f.branch, creation_sha: f.sha, ticket: f.ticket }, required: ['branch', 'creation_sha', 'ticket'] },
  checkout_moved: { privileged: true, fields: { from: f.path, to: f.path }, required: ['from', 'to'] },
  lock_broken: { privileged: true, fields: { lock: f.text, pid: f.pid }, required: ['lock', 'pid'] },
  note: { privileged: false, fields: { message: f.text }, required: ['message'] },
  template_gap: { privileged: false, fields: { template: f.text, section: f.text, message: f.text }, required: ['template', 'section', 'message'] },
});

// `human` needs a signature, which unit 06 adds; until then no line may claim it, written or
// read. A privileged type is only ever `script`: an `unverified` mr_merged must never derive
// `done` (D-17).
const BY = ['script', 'unverified'];
const ENVELOPE = ['schema_version', 'seq', 'ts', 'type', 'by', 'item'];

const paths = (store) => ({ counter: join(store.dir, 'seq'), journal: join(store.dir, 'journal.jsonl'), lock: join(store.dir, 'locks', 'journal.lock') });

function eventProblems(event) {
  const spec = EVENT_TYPES[event.type];
  if (!spec) return [`unknown event type ${JSON.stringify(String(event.type)).slice(0, 40)}`];
  if (spec.privileged && event.by !== 'script') return [`${event.type} is written only by MIRAI itself (by must be script)`];
  const node = {
    type: 'table',
    fields: {
      schema_version: { type: 'integer', min: 1, max: JOURNAL_SCHEMA_VERSION },
      seq: { type: 'integer', min: 1 },
      ts: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/ },
      type: { type: 'enum', values: Object.keys(EVENT_TYPES) },
      by: { type: 'enum', values: BY },
      item: { type: 'string', pattern: ITEM, patternHint: 'a ticket or document id' },
      ...spec.fields,
    },
    required: [...ENVELOPE.filter((k) => k !== 'item'), ...spec.required],
    check: spec.check ? (value, _path, report) => spec.check(value, (key, reason) => report(key, reason)) : undefined,
  };
  const at = { source: 'journal', line: 1, column: 1 };
  return validate(event, node, () => at).map((p) => p.reason);
}

function readCounter(file) {
  const text = readPrivateFile(file, { maxBytes: 64 });
  if (!/^(0|[1-9]\d{0,15})\n$/.test(text)) {
    throw new StoreError(`${file}: the counter is not readable`, { path: file, code: 'corrupt', hint: 'run: mirai doctor' });
  }
  return Number(text.slice(0, -1));
}

// Runs `fn({ take, event, runLine })` under the journal lock, so several lines can be written
// in one step (unit 05b):
// - `take()` takes the next store-wide number; call it again for more. A number taken and not
//   used stays a gap;
// - `event(seq, { type, by, ...fields })` appends a journal event;
// - `runLine(runId, seq, { item, event, ...fields })` appends a run-log line.
// Each file stays in `seq` order, because everything is written under this one lock. A number
// must have been taken here, used once, and be higher than the last one written to the same
// file; anything else is refused before it's written, because one out-of-order line would make
// the file unreadable (fail closed). Returns fn's result.
export function withSeq(store, fn) {
  const p = paths(store);
  return withLock(p.lock, 'journal', ({ broken }) => {
    let seq = readCounter(p.counter);
    const unused = new Set();
    const lastIn = new Map(); // file key → last number written to it in this step
    const take = () => {
      seq += 1;
      atomicWrite(p.counter, `${seq}\n`);
      unused.add(seq);
      return seq;
    };
    const use = (key, n) => {
      if (!unused.has(n)) throw new TypeError(`seq ${n} was not taken in this step, or is already used`);
      if (n <= (lastIn.get(key) ?? 0)) throw new TypeError(`seq ${n} is not after ${lastIn.get(key)} in the same file`);
      unused.delete(n);
      lastIn.set(key, n);
    };
    const event = (n, ev) => {
      use('journal', n);
      appendRaw(p, n, ev);
    };
    if (broken) event(take(), { type: 'lock_broken', by: 'script', lock: 'journal', pid: broken.pid });
    return fn({
      take,
      event,
      runLine: (runId, n, line) => {
        use(`run:${runId}`, n);
        appendRunLineRaw(store, runId, n, line);
      },
    });
  });
}

// Checks an event without writing it, including the line's size: `{ type, by, item?,
// ...fields }`. Throws a TypeError (bad fields) or a RangeError (too long). Used before a
// number is taken, so a bad event never uses one up.
export function checkEvent(event) {
  const { schema_version: _v, seq: _s, ts: _t, ...rest } = event;
  const line = { schema_version: JOURNAL_SCHEMA_VERSION, seq: 1, ts: new Date().toISOString(), ...rest };
  const problems = eventProblems(line);
  if (problems.length > 0) throw new TypeError(`journal event ${event.type}: ${problems.join('; ')}`);
  jsonLine(line);
  return rest;
}

function appendRaw(p, seq, event) {
  const line = { schema_version: JOURNAL_SCHEMA_VERSION, seq, ts: new Date().toISOString(), ...event };
  const problems = eventProblems(line);
  if (problems.length > 0) throw new TypeError(`journal event ${event.type}: ${problems.join('; ')}`);
  appendLine(p.journal, jsonLine(line));
}

// Appends one event: `{ type, by, item?, ...fields }`. `before(seq)` runs first, under the same
// lock, for a file that must carry the same number (a ticket status file); when it returns
// false, nothing is appended (the number stays a gap). Returns the seq, or null when skipped.
export function appendEvent(store, event, { before } = {}) {
  const rest = checkEvent(event); // before taking a number, so a bad event doesn't use one up
  return withSeq(store, ({ take, event: write }) => {
    const seq = take();
    if (before && before(seq) === false) return null;
    write(seq, rest);
    return seq;
  });
}

// Reads every event, checked. A torn last line is skipped and counted in `torn`.
export function readJournal(store) {
  const p = paths(store);
  const { entries, torn } = readJsonLines(p.journal, { optional: false });
  let last = 0;
  const events = entries.map(({ line, value }) => {
    if (value.schema_version > JOURNAL_SCHEMA_VERSION) {
      throw new StoreError(`${p.journal}:${line}: written by a newer MIRAI`, { path: p.journal, line, code: 'version', hint: 'update MIRAI before using this store' });
    }
    if (!Object.hasOwn(EVENT_TYPES, value.type)) {
      throw new StoreError(`${p.journal}:${line}: an event type this MIRAI doesn't know`, { path: p.journal, line, code: 'unknown-event', hint: 'a newer MIRAI may have written it: update MIRAI; otherwise run: mirai doctor' });
    }
    const problems = eventProblems(value);
    if (problems.length > 0) {
      throw new StoreError(`${p.journal}:${line}: not a valid event (${problems[0]})`, { path: p.journal, line, code: 'corrupt-line', hint: 'run: mirai doctor' });
    }
    if (value.seq <= last) {
      throw new StoreError(`${p.journal}:${line}: seq ${value.seq} is not after ${last}`, { path: p.journal, line, code: 'order', hint: 'run: mirai doctor' });
    }
    last = value.seq;
    return Object.freeze(value);
  });
  return { events, torn };
}

// The counter must be at least the highest seq in the journal; a lower one (a restored or
// edited counter) would hand out numbers twice. The run logs share the counter, so the newest
// run log's last line counts too (unit 05b). Reads only the last lines.
export function checkCounter(store) {
  const p = paths(store);
  const counter = readCounter(p.counter);
  const last = lastJsonLine(p.journal);
  const journalSeq = Number.isSafeInteger(last?.seq) ? last.seq : 0;
  const runSeq = newestRunLogSeq(store);
  const highest = Math.max(journalSeq, runSeq);
  if (counter < highest) {
    const where = runSeq > journalSeq ? 'the newest run log' : 'the journal';
    throw new StoreError(`${p.counter}: the counter (${counter}) is behind ${where} (${highest})`, { path: p.counter, code: 'counter-behind', hint: 'run: mirai doctor' });
  }
  return counter;
}

// Unit 04's facts for one ticket, from the journal (D-06: derived facts are journal
// observations).
// - A merge always wins (terminal), whatever comes after it; a merge into the integration
//   branch wins over one into the epic branch.
// - Otherwise the latest of mr_opened / mr_closed by seq decides open or closed.
// - `pushSeq` is the latest `pushed`. An MR opened without a logged push counts its opening as
//   the push, because opening it shipped that head.
// - `epicMerged`: an `epic_merged` event for the epic the ticket was merged into.
// - `proofsValidAtHead` stays false until proofs exist (unit 25): an MR without checked proofs
//   isn't built.
// - `head`: the head MIRAI last shipped (the latest pushed sha or opened head), so unit 25 can
//   hold `built` only while the MR's head equals it (D-06).
export function ticketFacts(events, ticket) {
  return allTicketFacts(events).get(ticket) ?? { mr: 'none' };
}

// The facts of every ticket in one pass over the journal: a Map from ticket to facts.
export function allTicketFacts(events) {
  const seen = new Map();
  const mergedEpics = new Set();
  for (const e of events) {
    if (e.type === 'epic_merged') mergedEpics.add(e.epic);
    if (e.ticket === undefined) continue;
    if (!seen.has(e.ticket)) seen.set(e.ticket, { merged: null, latestMr: null, pushSeq: undefined, openSeq: undefined, closeSeq: undefined, head: undefined });
    const t = seen.get(e.ticket);
    if (e.type === 'mr_merged' && (t.merged === null || e.target === 'integration')) t.merged = e;
    if (e.type === 'mr_opened' || e.type === 'mr_closed') t.latestMr = e;
    if (e.type === 'pushed') [t.pushSeq, t.head] = [e.seq, e.sha];
    if (e.type === 'mr_opened') [t.openSeq, t.head] = [e.seq, e.head];
    if (e.type === 'mr_closed') t.closeSeq = e.seq;
  }
  const facts = new Map();
  for (const [ticket, t] of seen) {
    if (t.merged) facts.set(ticket, { mr: 'merged', mergedInto: t.merged.target, epicMerged: t.merged.target === 'epic' && mergedEpics.has(t.merged.epic) });
    else if (t.latestMr?.type === 'mr_opened') facts.set(ticket, { mr: 'open', pushSeq: t.pushSeq ?? t.openSeq, head: t.head, proofsValidAtHead: false });
    else if (t.latestMr?.type === 'mr_closed') facts.set(ticket, { mr: 'closed', closeSeq: t.closeSeq });
    else facts.set(ticket, { mr: 'none', ...(t.head ? { head: t.head } : {}) });
  }
  return facts;
}

// Every ticket the journal mentions.
export function ticketsInJournal(events) {
  return [...new Set(events.map((e) => e.ticket).filter((t) => t !== undefined))];
}
