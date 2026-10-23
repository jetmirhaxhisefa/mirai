import { StatusError } from '../cli/errors.js';
import { PARK_REASONS, REPLAN_REASONS } from './machines.js';
import { shown } from './text.js';

// Checks one status move and returns `{ state, record }` (unit 04). Pure: the caller adds the
// time and sequence number and writes the record (the store, unit 05); unit 06 signs human
// moves by wrapping the record.
//
// `context`: { by: 'human' | 'script' | 'agent', item, reason, note, park_reason, choice,
// replans, extra }. It is copied once, so later reads can't differ from what was checked.
// Agents never move a status; the orchestrator does it as `script`.
// Conditions outside the status itself (for example "the MR is closed" for built → dropped)
// are checked by the caller that has the facts (units 27 and 46).
export function move(machine, from, to, context = {}) {
  const c = {
    by: context.by,
    item: context.item ?? machine.name,
    reason: context.reason,
    note: context.note,
    park_reason: context.park_reason,
    choice: context.choice,
    replans: context.replans ?? 0,
    extra: context.extra,
  };
  const fail = (code, why) => {
    throw new StatusError(`${shown(c.item)}: ${shown(from)} → ${shown(to)} ${why}`, { machine: machine.name, item: c.item, from, to, code });
  };

  for (const state of [from, to]) {
    if (!machine.states.includes(state)) fail('unknown-state', `is not possible (unknown state in the ${machine.name} machine)`);
  }
  if (machine.derived.includes(to)) fail('derived', `is not allowed (${to} is derived from facts, never written)`);

  const candidates = machine.moves.filter((m) => m.from === from && m.to === to);
  if (candidates.length === 0) fail('not-allowed', `is not allowed in the ${machine.name} machine`);

  // Unpark moves carry the choice that selects them (one rule per from/to pair).
  const rule = candidates.find((m) => m.choice === undefined || m.choice === c.choice) ?? candidates[0];

  if (typeof c.by !== 'string' || !rule.by.includes(c.by)) {
    if (rule.by.length === 1 && rule.by[0] === 'human') fail('human-only', 'needs a human (D-17)');
    fail('not-allowed', `can't be made by ${typeof c.by === 'string' ? shown(c.by) : 'an unnamed mover'}`);
  }

  for (const need of rule.needs) {
    const value = c[need];
    if (typeof value !== 'string' || value.trim() === '') fail('missing', `needs a ${need.replace('_', ' ')}`);
  }
  if (rule.needs.includes('park_reason') && !PARK_REASONS.includes(c.park_reason)) {
    fail('missing', `needs a park reason, one of: ${PARK_REASONS.join(', ')}`);
  }
  if (rule.needs.includes('choice') && rule.choice !== c.choice) fail('missing', `needs the choice "${rule.choice}"`);
  if (rule.needs.includes('reason') && !REPLAN_REASONS.includes(c.reason)) {
    fail('missing', `needs a reason, one of: ${REPLAN_REASONS.join(', ')}`);
  }
  // The orchestrator gets one re-plan per ticket, whatever the reason; after that the ticket
  // is parked (D-07, loop rule L4). You can always reject a plan.
  if (machine.name === 'ticket' && from === 'in-progress' && to === 'ready-for-dev' && c.by === 'script' && c.replans >= 1) {
    fail('replan-limit', 'is not allowed: the orchestrator gets one re-plan, then the ticket is parked');
  }

  const record = { machine: machine.name, item: c.item, from, to, by: c.by, why: rule.why };
  for (const key of ['reason', 'note', 'park_reason', 'choice']) if (c[key] !== undefined) record[key] = c[key];
  if (c.extra !== undefined) record.extra = Object.freeze({ ...c.extra });
  return { state: to, record: Object.freeze(record) };
}

// The moves the given mover could make from a state, for menus like `mirai inbox`.
export function movesFrom(machine, from, by) {
  return machine.moves.filter((m) => m.from === from && m.by.includes(by));
}
