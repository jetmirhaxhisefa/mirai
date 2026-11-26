import { readFrontmatter } from '../lint/frontmatter.js';
import { plain } from '../status/text.js';

// The ticket set's approval screen (unit 45, Scope 3; Jet's decisions 4 and 5): the pure parts.
// approve.js asks; these read the tickets, check a drop, and write the notes.

const fm = (bytes) => {
  try {
    return readFrontmatter(bytes)?.value ?? {};
  } catch {
    return {};
  }
};
const titleOf = (text) => (/^# (.+)$/m.exec(text)?.[1] ?? '').trim();
const list = (v) => (Array.isArray(v) ? v.map(String) : []);

// One row per ticket ([{ path, bytes, id }], as epicInputs reads them): key, type, priority, order,
// the tickets it blocks (theirs `after` names it), size, title; in the epic's order.
export function ticketRows(tickets) {
  const rows = tickets.map((t) => {
    const v = fm(t.bytes);
    return { key: String(v.id ?? t.id), path: t.path, type: String(v.ticket_type ?? v.type ?? '-'), priority: String(v.priority ?? 'normal'), order: Number.isInteger(v.order) ? v.order : null, size: String(v.size ?? '-'), after: list(v.after), covers: [...list(v.covers_fr), ...list(v.covers_ac), ...list(v.covers_nfr)], title: titleOf(t.bytes.toString('utf8')) };
  });
  for (const r of rows) r.blocks = rows.filter((o) => o.after.includes(r.key)).map((o) => o.key);
  return rows.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.key.localeCompare(b.key));
}

export function rowLine(r) {
  return `  ${plain(r.key).padEnd(12)} ${plain(r.type).padEnd(13)} ${plain(r.priority).padEnd(7)} order ${String(r.order ?? '-').padEnd(3)} ${plain(r.size).padEnd(2)} ${r.blocks.length ? `blocks ${plain(r.blocks.join(', '))}` : 'blocks none'}   ${plain(r.title)}`;
}

// A kept ticket whose `after` names a dropped one: [{ kept, dropped }]. Dropping it would leave the
// kept ticket waiting on nothing, so the drop is refused: change the kept ticket instead.
export function dependsOnDropped(rows, dropped) {
  const gone = new Set(dropped);
  return rows.filter((r) => !gone.has(r.key)).flatMap((r) => r.after.filter((a) => gone.has(a)).map((d) => ({ kept: r.key, dropped: d })));
}

// The IDs the tickets cover (covers_fr, covers_ac, covers_nfr): whether a drop changed the set's
// coverage decides whether the verifier's result still stands (Scope 3).
export const coverageOf = (rows) => [...new Set(rows.flatMap((r) => r.covers))].sort();

// The epic's release mode, as the ticket planner proposed it: the `release` field, and the first
// line of its "Release" section as the reason.
export function releaseOf(text) {
  const v = fm(Buffer.from(text, 'utf8'));
  const mode = v.release === 'together' ? 'together' : 'per-ticket';
  const m = /^## Release[^\n]*\n+([\s\S]*?)(?=\n## |\n?$)/m.exec(text.replace(/\r\n?/g, '\n'));
  const reason = (m?.[1] ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('<!--')).join(' ').slice(0, 300);
  return { mode, reason };
}

// ticket-notes.md as the screen writes it (registry/templates/ticket-notes.md).
export function notesText({ initiative, epic, round, notes, date }) {
  const one = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();
  return [
    '---',
    `id: ${initiative}-ticket-notes`,
    'type: ticket-notes',
    'template: ticket-notes@v1',
    'owner: you',
    `created: "${date}"`,
    `epic: ${epic}`,
    `round: ${round}`,
    '---',
    `# Ticket notes: ${initiative}'s ticket set`,
    '',
    '## Notes',
    '',
    ...notes.map((n) => `- ${n.ticket} (${n.decision}, ${date}): ${one(n.reason)}`),
    '',
  ].join('\n');
}

// The set's approval round: one more than the last round your ticket decisions on this epic had.
export function roundOf(events, epic) {
  const last = events.filter((e) => e.type === 'ticket_decision' && e.epic === epic).map((e) => e.round).reduce((a, b) => Math.max(a, b), 0);
  return last + 1;
}
