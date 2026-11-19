import { sameKey } from '../lint/checks.js';

// Your notes on a ticket's plans (unit 30c, F21): every plan rejection's reason and every note you
// gave when unparking the ticket, oldest first, from the journal. Human lines there are verified
// against your keys when read (readJournal fails closed), so a note no one signed never shows up.
// A re-plan and its fix launch get them as review-notes.md: before 30c, no note reached Kai.

const MAX_NOTES = 40;
const MAX_BYTES = 16 * 1024;

export function reviewNotes(events, ticket) {
  const notes = [];
  for (const e of events) {
    if (e.by !== 'human') continue;
    if (e.type === 'approval' && e.kind === 'plan' && e.decision === 'rejected' && sameKey(e.item, ticket) && typeof e.reason === 'string' && e.reason.trim()) {
      notes.push({ at: e.ts ?? null, kind: 'plan rejected', text: e.reason.trim() });
    } else if (e.type === 'status_written' && sameKey(e.ticket, ticket) && typeof e.note === 'string' && e.note.trim()) {
      notes.push({ at: e.ts ?? null, kind: `unparked to ${e.state}`, text: e.note.trim() });
    }
  }
  return notes.slice(-MAX_NOTES);
}

export function renderNotes(ticket, notes) {
  if (!notes.length) return null;
  const head = [
    `# Your reviewer's notes on ${ticket}'s plans, oldest first`,
    '',
    'Each note still holds unless a later note or the ticket says otherwise. If a note and the',
    'approved ticket disagree, follow the ticket, and say so in the plan\'s Design notes.',
    '',
  ];
  const body = notes.map((n, i) => `${i + 1}. ${n.at ? `${String(n.at).slice(0, 16).replace('T', ' ')} ` : ''}(${n.kind}): ${n.text.replace(/\s+/g, ' ')}`);
  let text = `${[...head, ...body].join('\n')}\n`;
  if (Buffer.byteLength(text) > MAX_BYTES) text = `${text.slice(0, MAX_BYTES - 40)}\n(older notes cut)\n`;
  return text;
}

// A note that names a version or code value the approved ticket names differently: the ticket
// wins, so you're told at the reject to edit the ticket instead (F21: BKT-49's 10.2.16/10.4.6).
export function noteAgainstTicket(note, ticketText) {
  const values = (s) => new Set([...String(s).matchAll(/\b\d+\.\d+(?:\.\d+){0,2}\b/g)].map((m) => m[0]));
  const inNote = [...values(note)];
  const inTicket = values(ticketText);
  if (!inNote.length || !inTicket.size) return null;
  const missing = inNote.filter((v) => !inTicket.has(v));
  return missing.length ? { note: missing, ticket: [...inTicket].slice(0, 5) } : null;
}
