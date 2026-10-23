import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { deriveTicketState } from '../status/derive.js';
import { parseStatusFile, serializeStatusFile, STATUS_FILE_MAX_BYTES, STATUS_SCHEMA_VERSION, TICKET_ID } from '../status/ticket-file.js';
import { atomicWrite, checkPrivateDir, ensurePrivateDir, readPrivateFile } from './files.js';
import { appendEvent, readJournal, ticketFacts } from './journal.js';

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
// Under the journal lock it checks, before writing:
// - `expectSeq` (when given): the seq of the status the caller read, or null for none. A
//   different one means someone else wrote in between, and the write is refused (exit 4);
// - that the new status can be read together with the journal's facts (unit 04's derive), so a
//   write can't leave the ticket unreadable, e.g. `ready-for-dev` while its MR is open.
// The move rules themselves (unit 04's move()) are the callers' (units 06, 28).
// Returns the seq.
export function writeTicketStatus(store, status, { now = () => new Date(), expectSeq } = {}) {
  const dir = ticketDir(store, status.ticket);
  checkCase(store, status.ticket);
  const by = status.written_by ?? 'script';
  return appendEvent(store, {
    type: 'status_written',
    by,
    ticket: status.ticket,
    state: status.state,
    ...(status.park_reason !== undefined ? { park_reason: status.park_reason } : {}),
  }, {
    before(seq) {
      if (expectSeq !== undefined) {
        const current = readTicketStatus(store, status.ticket)?.status.seq ?? null;
        if (current !== expectSeq) {
          throw new StoreError(`ticket ${status.ticket}: its status changed since it was read (seq ${current ?? 'none'}, expected ${expectSeq ?? 'none'})`, { code: 'stale-write', exitCode: EXIT.BLOCKED, hint: 'read the status again and retry' });
        }
      }
      const candidate = { ...status, seq };
      deriveTicketState(candidate, ticketFacts(readJournal(store).events, status.ticket));
      const text = serializeStatusFile({
        ...status,
        schema_version: STATUS_SCHEMA_VERSION,
        written_by: by,
        seq,
        written_at: now().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      });
      ensurePrivateDir(dir);
      atomicWrite(join(dir, 'status.json'), text);
    },
  });
}

// Reads a ticket's status: `{ status, migratedFrom }`, or null when it has none.
export function readTicketStatus(store, ticket, { migrations = STATUS_MIGRATIONS } = {}) {
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
