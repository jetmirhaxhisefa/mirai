import { plain } from '../status/text.js';
import { move } from '../status/move.js';
import { TICKET } from '../status/machines.js';
import { readTicketStatus, writeTicketStatus } from '../store/tickets.js';

// Parking notes (unit 20; D-18): a fixed note per reason, naming the evidence by path, written by
// the script. Rewording one on the light tier is unit 28's. A ticket parks through unit 04's state
// machine: `blocked`, with its park reason.

const SAYS = Object.freeze({
  cap: 'Its rounds are used up.',
  budget: 'A budget would be crossed.',
  repeat: 'The same problem came back after a re-plan.',
  'no-progress': 'It isn\'t getting closer: the open problems didn\'t drop, or a file went back to an earlier version.',
  environment: 'Environment faults kept stopping it.',
  scope: 'A run changed files its role may not; they were left as they are.',
  'bad-plan': 'The same problem came back: the plan needs another look.',
  'rebase-conflict': 'Its branch no longer rebases cleanly.',
  disputed: 'Kai disputes a review finding: yours to settle (mirai unpark <ticket> --retry: the finding stands; --accept <finding-id>: it\'s dropped).',
  'high-risk-review': 'The review passed, but the change touches a protected path (instruction files, hooks, auto-run config), which always waits for you.',
  'bad-verdict': 'Rex\'s verdict didn\'t come back as valid structured output.',
});

export function parkingNote({ reason, why = null, evidence = [] }) {
  const lines = [SAYS[reason] ?? 'Parked.', ...(why ? [plain(String(why)).slice(0, 300)] : [])];
  if (evidence.length) lines.push(`Evidence: ${evidence.slice(0, 5).map((p) => plain(String(p))).join(', ')}`);
  // One line, as the status file's note takes it (at most 500 characters).
  return [...lines.join(' ')].slice(0, 500).join('');
}

// Parks the ticket: `blocked`, with the reason and the note. Refused by 04's machine where that
// move isn't allowed.
export function parkTicket(store, ticket, park) {
  const current = readTicketStatus(store, ticket)?.status ?? null;
  if (!current) throw new TypeError(`no status for ${ticket}`);
  // Already parked (a retry after a crash between the two writes): nothing to do.
  if (current.state === 'blocked') return current.seq;
  const note = parkingNote(park);
  move(TICKET, current.state, 'blocked', { by: 'script', item: ticket, park_reason: park.reason, note });
  // The re-plan count goes with it (04: one per ticket, whatever happens).
  return writeTicketStatus(store, { ticket, state: 'blocked', park_reason: park.reason, note, ...(current.replans !== undefined ? { replans: current.replans } : {}) }, { expectSeq: current.seq });
}
