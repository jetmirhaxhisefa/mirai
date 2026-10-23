import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { StatusError, StoreError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { deriveTicketState } from '../status/derive.js';
import { TICKET } from '../status/machines.js';
import { move } from '../status/move.js';
import { parseStatusFile, serializeStatusFile, STATUS_FILE_MAX_BYTES, STATUS_SCHEMA_VERSION, TICKET_ID } from '../status/ticket-file.js';
import { atomicWrite, checkPrivateDir, ensurePrivateDir, readPrivateFile } from './files.js';
import { checkEvent, readJournal, ticketFacts, withSeq } from './journal.js';

// Ticket status files in the store (unit 05a; D-06: `store/tickets/<t>/status.json` is the
// only status home). The format is unit 04's. A write takes a journal `seq`, writes the file
// with it, and appends `status_written` with the same number.

// One step per schema version: STATUS_MIGRATIONS[n] turns a version-n file into version n+1.
// Empty, because version 1 is the only one. Reading migrates in memory; only `doctor`
// rewrites a file, after you see it (D-21).
export const STATUS_MIGRATIONS = Object.freeze({});

function ticketDir(store, ticket) {
  if (typeof ticket !== 'string' || !TICKET_ID.test(ticket)) throw new TypeError('not a ticket key');
  return join(store.dir, 'tickets', ticket);
}

// macOS folders ignore case, so PROJ-1 and proj-1 would share one folder. A key whose folder
// exists in another case is refused.
function checkCase(store, ticket) {
  const clash = readdirSync(join(store.dir, 'tickets')).find((name) => name !== ticket && name.toLowerCase() === ticket.toLowerCase());
  if (clash) {
    throw new StoreError(`ticket ${ticket} clashes with ${clash}: macOS doesn't tell them apart`, { code: 'case-clash', exitCode: EXIT.BLOCKED, hint: 'use the ticket key exactly as it is written' });
  }
}

// Writes a ticket's status: `{ ticket, state, park_reason?, replans?, note?, written_by? }`.
// Before a number is taken, under the journal lock, it checks:
// - `expectSeq` (when given): the seq of the status the caller read, or null for none. A
//   different one means someone else wrote in between, and the write is refused (exit 4);
// - the mover: a move only you may make (approve, drop, unpark, a grant after an MR) is refused
//   for `script`, and `dropped` always needs you. A `human` write must be an allowed move (unit
//   04's move(), with `move` as its context: note, choice, reason);
// - that the new status can be read together with the journal's facts (unit 04's derive), so a
//   write can't leave the ticket unreadable, e.g. `ready-for-dev` while its MR is open.
// `written_by: "human"` needs `signer` (unit 06): its status_written line is signed, and the
// status file's `seq` points at that signed line (readTicketStatus checks they agree).
// Returns the seq.
export function writeTicketStatus(store, status, options = {}) {
  const prepared = prepareStatus(store, status);
  return withSeq(store, (ctx) => writePrepared(store, prepared, ctx, options));
}

// The same write as one part of a larger step (for example an approval and its move, unit 06):
// `ctx` is withSeq's { take, event }.
export function writeTicketStatusIn(ctx, store, status, options = {}) {
  return writePrepared(store, prepareStatus(store, status), ctx, options);
}

// A signed move by you (unit 06): the API units 20, 28, 46 and 60 call for unpark, resume
// grants, handover and go/no-go moves.
export function signHumanMove(store, signer, status, options = {}) {
  return writeTicketStatus(store, { ...status, written_by: 'human' }, { ...options, signer });
}

// The checks of a write, without writing: call it inside withSeq before writing anything that
// belongs with the move (an approval), so a refused move leaves nothing behind.
export function checkTicketStatusWrite(store, status, options = {}) {
  checkPrepared(store, prepareStatus(store, status), options);
}

// Checks that need no lock, and the event, checked before a number is taken.
function prepareStatus(store, status) {
  const dir = ticketDir(store, status.ticket);
  checkCase(store, status.ticket);
  const by = status.written_by ?? 'script';
  const event = checkEvent({
    type: 'status_written',
    by,
    ticket: status.ticket,
    state: status.state,
    ...(status.park_reason !== undefined ? { park_reason: status.park_reason } : {}),
    ...(status.note !== undefined && status.note !== null ? { note: status.note } : {}),
  });
  return { dir, by, event, status };
}

function checkPrepared(store, { by, status }, { expectSeq, signer, move: moveContext = {} } = {}) {
  if (by === 'human' && !signer) throw new TypeError('a human status write needs your signing key');
  const current = readTicketStatus(store, status.ticket)?.status ?? null;
  if (expectSeq !== undefined && (current?.seq ?? null) !== expectSeq) {
    throw new StoreError(`ticket ${status.ticket}: its status changed since it was read (seq ${current?.seq ?? 'none'}, expected ${expectSeq ?? 'none'})`, { code: 'stale-write', exitCode: EXIT.BLOCKED, hint: 'read the status again and retry' });
  }
  const events = readJournal(store, signer ? { keys: signer.keys } : {}).events;
  const facts = ticketFacts(events, status.ticket);
  const from = deriveTicketState(current, facts).state;
  checkMover(status, from, by, moveContext);
  // The new status is newer than everything in the journal.
  deriveTicketState({ ...status, seq: Number.MAX_SAFE_INTEGER }, facts);
}

// Moves only you may make are never written by a script (D-17).
function checkMover(status, from, by, moveContext) {
  if (by === 'human') {
    move(TICKET, from, status.state, { by, item: status.ticket, note: status.note ?? undefined, park_reason: status.park_reason, ...moveContext });
    return;
  }
  const rules = TICKET.moves.filter((m) => m.from === from && m.to === status.state);
  const humanOnly = (rules.length > 0 && !rules.some((m) => m.by.includes(by))) || status.state === 'dropped';
  if (humanOnly) {
    throw new StatusError(`${status.ticket}: ${from} → ${status.state} needs you (a signed move: mirai approve, drop or unpark)`, { machine: 'ticket', item: status.ticket, from, to: status.state, code: 'human-only' });
  }
}

function writePrepared(store, prepared, { take, event }, options = {}) {
  checkPrepared(store, prepared, options);
  const { dir, by, event: ev, status } = prepared;
  const seq = take();
  const text = serializeStatusFile({
    ...status,
    schema_version: STATUS_SCHEMA_VERSION,
    written_by: by,
    seq,
    written_at: (options.now ?? (() => new Date()))().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
  ensurePrivateDir(dir);
  atomicWrite(join(dir, 'status.json'), text);
  event(seq, ev, { signer: options.signer });
  return seq;
}

// Whether a status file agrees with the journal (unit 06). The journal's latest status_written
// line for the ticket is the record; the file is its copy:
// - a human-written status must point at that line, which must be yours (signed: readJournal
//   verified it) and say the same state and park reason;
// - a script-written status must not be older than that line, or disagree with it at the same
//   seq (a file rolled back, or edited). A file newer than the journal is a write whose line a
//   crash lost; it reads, as in 05a.
// Throws a StoreError (code status-mismatch). Returns the matching line, or null.
export function checkStatusAgainstJournal(status, events) {
  let latest = null;
  for (const e of events) if (e.type === 'status_written' && e.ticket === status.ticket) latest = e;
  const same = latest && latest.state === status.state && (latest.park_reason ?? null) === (status.park_reason ?? null);
  const fail = (why) => {
    throw new StoreError(`ticket ${status.ticket}: ${why}`, { code: 'status-mismatch', exitCode: EXIT.BLOCKED, hint: 'run: mirai doctor' });
  };
  if (status.written_by === 'human') {
    if (!latest || latest.seq !== status.seq || latest.by !== 'human' || !same) fail(`the status says you wrote it, but seq ${status.seq} is not your latest signed line for it`);
    return latest;
  }
  if (latest && latest.seq > status.seq) fail(`the status file (seq ${status.seq}) is older than the journal (seq ${latest.seq})`);
  if (latest && latest.seq === status.seq && (latest.by !== 'script' || !same)) fail(`the status file disagrees with the journal at seq ${status.seq}`);
  return latest && latest.seq === status.seq ? latest : null;
}

// Reads a ticket's status: `{ status, migratedFrom }`, or null when it has none.
// With `events` (the journal), the status is also checked against it (checkStatusAgainstJournal).
export function readTicketStatus(store, ticket, { migrations = STATUS_MIGRATIONS, events } = {}) {
  const read = readStatusFile(store, ticket, migrations);
  if (read && events) checkStatusAgainstJournal(read.status, events);
  return read;
}

function readStatusFile(store, ticket, migrations) {
  const dir = ticketDir(store, ticket);
  if (!readdirSync(join(store.dir, 'tickets')).includes(ticket)) return null; // exact case only
  if (!checkPrivateDir(dir)) return null; // a real, private folder, or none
  const file = join(dir, 'status.json');
  const text = readPrivateFile(file, { maxBytes: STATUS_FILE_MAX_BYTES, optional: true });
  if (text === null) return null;
  const source = `tickets/${ticket}/status.json`;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  const version = raw?.schema_version;
  if (!Number.isInteger(version) || version >= STATUS_SCHEMA_VERSION) {
    return { status: checkTicket(parseStatusFile(text, { source }), ticket, file), migratedFrom: null };
  }
  let value = raw;
  for (let v = version; v < STATUS_SCHEMA_VERSION; v += 1) {
    if (typeof migrations[v] !== 'function') {
      throw new StoreError(`${file}: no migration from status schema ${v}`, { path: file, code: 'no-migration', hint: 'run: mirai doctor' });
    }
    value = { ...migrations[v](value), schema_version: v + 1 };
  }
  return { status: checkTicket(parseStatusFile(JSON.stringify(value, null, 2), { source }), ticket, file), migratedFrom: version };
}

function checkTicket(status, ticket, file) {
  if (status.ticket !== ticket) {
    throw new StoreError(`${file}: holds the status of ${status.ticket}, not ${ticket}`, { path: file, code: 'corrupt', hint: 'run: mirai doctor' });
  }
  return status;
}

// The tickets that have a folder in the store. A folder name that isn't a ticket key means
// someone else wrote there, so it fails closed. Finder's .DS_Store is the one exception.
export function ticketsInStore(store) {
  const names = readdirSync(join(store.dir, 'tickets'), { withFileTypes: true }).filter((e) => !(e.name === '.DS_Store' && e.isFile()));
  for (const entry of names) {
    if (!entry.isDirectory() || !TICKET_ID.test(entry.name)) {
      throw new StoreError(`${join(store.dir, 'tickets')}: holds something that isn't a ticket folder`, { path: join(store.dir, 'tickets'), code: 'corrupt', hint: 'run: mirai doctor' });
    }
  }
  return names.map((e) => e.name).sort();
}
