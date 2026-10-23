import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { MiraiError, UsageError } from './errors.js';
import { EXIT } from './exit-codes.js';
import { deriveTicketState } from '../status/derive.js';
import { shown } from '../status/text.js';
import { TICKET_ID } from '../status/ticket-file.js';
import { readJournal, ticketFacts } from '../store/journal.js';
import { readTicketStatus } from '../store/tickets.js';

// Shared by mirai approve and mirai drop (unit 06): the ticket's effective state, the file being
// approved, and the typed confirmation.

export function checkTicketArg(ticket) {
  if (!TICKET_ID.test(ticket ?? '')) throw new UsageError(`${shown(ticket)} is not a ticket key`, 'a ticket key looks like "PROJ-123"');
}

// The ticket's written status (or null) and its effective state, from the store and the journal;
// the status is checked against the journal first.
export function ticketNow(store, ticket, keys) {
  const { events } = readJournal(store, { keys });
  const status = readTicketStatus(store, ticket, { events })?.status ?? null;
  const { state } = deriveTicketState(status, ticketFacts(events, ticket));
  return { status, state, seq: status?.seq ?? null };
}

const FILE_MAX = 1024 * 1024;

// Reads the file being approved: a regular file inside the checkout (no symbolic link, no
// folder on the way leading out), at most 1 MB. Returns { path (repo-relative), bytes }.
export function readApprovedFile(checkout, cwd, arg) {
  if (typeof arg !== 'string' || arg === '') throw new UsageError('--file names the file you approve', 'for example --file tickets/T-12.md');
  const full = isAbsolute(arg) ? arg : resolve(cwd, arg);
  let info;
  try {
    info = lstatSync(full);
  } catch {
    throw new UsageError(`${shown(arg)} doesn't exist`, 'name the ticket file, relative to here');
  }
  if (info.isSymbolicLink() || !info.isFile()) throw new UsageError(`${shown(arg)} is not a regular file`, 'name the file itself, not a link');
  const real = realpathSync(full);
  if (!real.startsWith(checkout + sep)) throw new UsageError(`${shown(arg)} is outside this repo`, 'approve files in the repo only');
  if (relative(checkout, real).split(sep)[0] === '.git') throw new UsageError(`${shown(arg)} is inside .git`, 'approve files in the work tree');
  // O_NONBLOCK: a file swapped for a FIFO between the checks can't hang the open.
  const fd = openSync(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw new UsageError(`${shown(arg)} changed while it was being read`, 'try again');
    const { size } = opened;
    if (size > FILE_MAX) throw new UsageError(`${shown(arg)} is larger than 1 MB`, 'approve the ticket file, not a bundle');
    const bytes = Buffer.alloc(size);
    let got = 0;
    while (got < size) {
      const n = readSync(fd, bytes, got, size - got, got);
      if (n === 0) break;
      got += n;
    }
    return { path: relative(checkout, real).split(sep).join('/'), bytes: bytes.subarray(0, got) };
  } finally {
    closeSync(fd);
  }
}

// You type the ticket key back. Anything else cancels, with nothing written (exit 1).
export async function confirmByTyping(prompter, ticket) {
  const typed = await prompter.ask(`type ${ticket} to confirm: `);
  if (typed !== ticket) throw new MiraiError('not confirmed: cancelled, nothing was written', EXIT.FAILURE);
}
