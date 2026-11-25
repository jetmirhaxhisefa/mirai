import { blocksCount, byKey } from '../lint/graph.js';
import { readTicketFolder } from '../lint/lint.js';
import { deriveTicketState } from '../status/derive.js';
import { plain } from '../status/text.js';
import { ticketFacts } from '../store/journal.js';
import { readTicketStatus } from '../store/tickets.js';

// The run's pick (unit 42, decision 5; Jet, 2026-11-21: "mainly what is blocking each other").
// Among the ready tickets (approved, not done, every `after` ticket done), first the one that
// blocks the most other tickets (counted through the whole `after` chain, done ones left out),
// then the highest priority (high, normal, low; normal when unset), then the epic's order (a
// ticket with none after those with one), then the earliest approval, then the key. The build
// loop's "next ready ticket" and the night run (55) take them in this order; `mirai show
// <initiative>` lists them so.

export const PRIORITIES = Object.freeze(['high', 'normal', 'low']);
const rank = (p) => {
  const i = PRIORITIES.indexOf(p ?? 'normal');
  return i < 0 ? 1 : i;
};

// `tickets`: [{ value: { id, after, priority, order }, state, approvedAt? }], every ticket the
// pick knows (ready or not: the blocked ones count in the chain). `state`: the store's ticket
// state; `done` and `dropped` count as done for the chain. Returns the ready ones, in pick order,
// each with its `blocks` count.
export function runPick(tickets) {
  const isDone = (t) => t.state === 'done' || t.state === 'dropped';
  const done = new Set(tickets.filter(isDone).map((t) => String(t.value.id).toLowerCase()));
  const blocks = blocksCount(tickets, { done });
  // An `after` naming a ticket the pick doesn't know isn't done: the ticket waits.
  const ready = tickets.filter((t) => t.state === 'ready-for-dev' && (Array.isArray(t.value.after) ? t.value.after : []).every((a) => typeof a === 'string' && done.has(a.toLowerCase())));
  const at = (t) => (t.approvedAt ? Date.parse(t.approvedAt) || Infinity : Infinity);
  const ord = (t) => (Number.isInteger(t.value.order) ? t.value.order : Infinity);
  return ready
    .map((t) => ({ ...t, blocks: blocks.get(String(t.value.id)) ?? 0 }))
    .sort((a, b) => b.blocks - a.blocks || rank(a.value.priority) - rank(b.value.priority) || ord(a) - ord(b) || at(a) - at(b) || byKey(String(a.value.id), String(b.value.id)));
}

// The ready tickets of an initiative's folder (its tickets/), in the run's pick order, for `mirai
// show <initiative>`: the lines to print, or none when nothing is ready. `events`: the journal.
export function readyLines({ store, dir, base, events }) {
  let all = [];
  try {
    all = readTicketFolder(dir, { root: base }).all;
  } catch {
    all = [];
  }
  const tickets = all.filter((t) => typeof t.value.id === 'string').map((t) => {
    const key = t.value.id;
    let state = 'draft';
    try {
      state = deriveTicketState(readTicketStatus(store, key)?.status ?? null, ticketFacts(events, key)).state;
    } catch {
      state = 'unknown';
    }
    const approvedAt = events.filter((e) => e.type === 'approval' && e.by === 'human' && e.decision !== 'rejected' && (e.item === key || (e.kind === 'epic' && e.item === t.value.epic))).at(-1)?.ts ?? null;
    return { value: t.value, state, approvedAt };
  });
  const picked = runPick(tickets);
  if (!picked.length) return [];
  const why = (t) => [t.blocks ? `blocks ${t.blocks}` : null, t.value.priority === 'high' || t.value.priority === 'low' ? t.value.priority : null, Number.isInteger(t.value.order) ? `order ${t.value.order}` : null].filter(Boolean).join(', ') || 'normal';
  return [`ready, in the run's pick order: ${picked.map((t) => `${plain(String(t.value.id))} (${why(t)})`).join(', ')}`];
}
