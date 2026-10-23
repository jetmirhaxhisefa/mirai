import { StatusError } from '../cli/errors.js';
import { shown } from './text.js';

// Derived ticket states (unit 04; D-06, D-07, design/02 view (h)). `built`, `integrated` and
// `done` are computed from facts and never written; derived states win over the status file.
//
// Order is decided by the store journal's sequence numbers (D-06: "the latest event by seq
// wins"), never by clocks, so time differences between your machine and the git host can't
// flip a result.

// The written states that may take over from `built` while the MR is open, when written after
// the latest push: a fix round (in-progress, in-review), a stacked wait, a parked ticket.
const TAKES_OVER_OPEN_MR = new Set(['in-progress', 'in-review', 'waiting', 'blocked']);

// `status`: the ticket's status file ({ state, seq, … }), or null.
// `facts`: what git and the MR say (units 22, 25 and 27 provide them):
//   mr: 'none' | 'open' | 'merged' | 'closed'
//   mergedInto: 'integration' | 'epic'     required when merged
//   epicMerged: boolean                    feature/<epic> is merged into the integration branch
//   proofsValidAtHead: boolean             signed proofs match the MR head the orchestrator shipped
//   pushSeq: journal seq of the latest push of the MR head (required when open)
//   closeSeq: journal seq of the MR closing (required when closed)
// Returns { state, source: 'derived' | 'written', why }. Malformed facts throw: a merged
// ticket must never fall back to a written state by accident.
export function deriveTicketState(status, facts = {}) {
  const written = status?.state ?? 'draft';
  const writtenSeq = status?.seq ?? -1;
  const f = checkFacts(facts, status?.ticket);

  if (f.mr === 'merged') {
    if (f.mergedInto === 'integration' || f.epicMerged) {
      return { state: 'done', source: 'derived', why: f.mergedInto === 'integration' ? 'merged into the integration branch' : 'its epic branch is merged' };
    }
    return { state: 'integrated', source: 'derived', why: 'merged into feature/<epic>' };
  }
  if (f.mr === 'open') {
    if (writtenSeq > f.pushSeq) {
      if (TAKES_OVER_OPEN_MR.has(written)) return { state: written, source: 'written', why: 'written after the latest push' };
      throw bad(status?.ticket, `the status ${shown(written)} can't be written while its MR is open`);
    }
    if (f.proofsValidAtHead) return { state: 'built', source: 'derived', why: 'MR open with valid proofs at its head' };
    return { state: written, source: 'written', why: 'MR open, but no valid proofs at its head' };
  }
  if (f.mr === 'closed') {
    // Your decision comes next: send it back or drop it (moves from `built`).
    if (writtenSeq > f.closeSeq) return { state: written, source: 'written', why: 'your decision after the MR closed' };
    return { state: 'built', source: 'derived', why: 'MR closed, waiting for your decision (send back or drop)' };
  }
  return { state: written, source: 'written', why: 'no MR yet' };
}

function bad(ticket, why) {
  return new StatusError(`${shown(ticket ?? 'ticket')}: ${why}`, { machine: 'ticket', item: ticket, code: 'bad-facts' });
}

function checkFacts(facts, ticket) {
  const f = facts ?? {};
  const mr = f.mr ?? 'none';
  if (!['none', 'open', 'merged', 'closed'].includes(mr)) throw bad(ticket, 'facts.mr must be none, open, merged or closed');
  for (const key of ['epicMerged', 'proofsValidAtHead']) {
    if (f[key] !== undefined && typeof f[key] !== 'boolean') throw bad(ticket, `facts.${key} must be true or false`);
  }
  if (mr === 'merged' && !['integration', 'epic'].includes(f.mergedInto)) throw bad(ticket, 'a merged MR needs facts.mergedInto: integration or epic');
  if (mr === 'open' && !Number.isSafeInteger(f.pushSeq)) throw bad(ticket, 'an open MR needs facts.pushSeq (the journal seq of the latest push)');
  if (mr === 'closed' && !Number.isSafeInteger(f.closeSeq)) throw bad(ticket, 'a closed MR needs facts.closeSeq (the journal seq of the close)');
  return { mr, mergedInto: f.mergedInto, epicMerged: f.epicMerged === true, proofsValidAtHead: f.proofsValidAtHead === true, pushSeq: f.pushSeq, closeSeq: f.closeSeq };
}

// Whether a ticket's `after` dependency lets it start: `done` always; `integrated` only inside
// the same `release: together` epic, so that epic can't deadlock (D-07, R2-M5).
export function isDependencySatisfied(dependencyState, { sameTogetherEpic = false } = {}) {
  if (dependencyState === 'done') return true;
  return dependencyState === 'integrated' && sameTogetherEpic === true;
}
