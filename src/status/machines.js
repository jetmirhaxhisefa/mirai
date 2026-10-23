// The four state machines (unit 04; D-07, design/02 view (h)). Hard-coded in Milestone A;
// unit 37 can move them into registry definitions (D-37).
//
// A move: { from, to, by: ['human'] | ['script'] | both, needs: [...], why }
// - `by`: who may make it. Agents never move a status themselves; the orchestrator (a
//   script) does, and human moves need you (signed in unit 06, D-17).
// - `needs`: what the move must carry: `park_reason`, `note`, `choice`, `reason`.
// `derived` states are computed from facts and can never be written.

const human = ['human'];
const script = ['script'];
const either = ['human', 'script'];

function machine(name, { states, initial, derived = [], final = [], moves }) {
  return Object.freeze({
    name,
    states: Object.freeze(states),
    initial,
    derived: Object.freeze(derived),
    final: Object.freeze(final),
    moves: Object.freeze(moves.map((m) => Object.freeze({ needs: [], ...m }))),
  });
}

export const DOCUMENT = machine('document', {
  states: ['draft', 'in-review', 'changes-requested', 'approved', 'superseded', 'obsolete', 'dropped'],
  initial: 'draft',
  final: ['superseded', 'obsolete', 'dropped'],
  moves: [
    { from: 'draft', to: 'in-review', by: script, why: 'author done and lint passes' },
    { from: 'in-review', to: 'changes-requested', by: either, why: 'verifier blocking findings, or you request changes' },
    { from: 'changes-requested', to: 'draft', by: script, why: 'the author picks it up' },
    { from: 'in-review', to: 'approved', by: human, why: 'verifier pass and your approval' },
    { from: 'approved', to: 'superseded', by: human, why: 'a newer version is approved' },
    { from: 'approved', to: 'obsolete', by: human, why: 'no longer relevant, not replaced' },
    { from: 'draft', to: 'dropped', by: human, why: 'you drop it' },
    { from: 'in-review', to: 'dropped', by: human, why: 'you drop it' },
    { from: 'changes-requested', to: 'dropped', by: human, why: 'you drop it' },
  ],
});

// Why a ticket is parked (D-07: `blocked` always carries one).
export const PARK_REASONS = Object.freeze(['cap', 'budget', 'repeat', 'no-progress', 'environment', 'rebase-conflict', 'bad-plan']);

// Why a ticket goes back to planning: you rejected the plan, or the same failure repeated
// (a bad plan). The orchestrator gets one re-plan per ticket, whatever the reason.
export const REPLAN_REASONS = Object.freeze(['plan-rejected', 'bad-plan']);

// `mirai unpark` choices and where each one leads (three, decided 2026-10-23).
export const UNPARK_CHOICES = Object.freeze({ 're-plan': 'ready-for-dev', retry: 'in-progress', drop: 'dropped' });

export const TICKET = machine('ticket', {
  states: ['draft', 'ready-for-dev', 'in-progress', 'in-review', 'built', 'waiting', 'integrated', 'done', 'blocked', 'dropped'],
  initial: 'draft',
  derived: ['built', 'integrated', 'done'],
  final: ['done', 'dropped'],
  moves: [
    { from: 'draft', to: 'ready-for-dev', by: human, why: 'ticket set approved' },
    { from: 'ready-for-dev', to: 'in-progress', by: script, why: 'plan written' },
    { from: 'in-progress', to: 'ready-for-dev', by: either, needs: ['reason'], why: 're-plan: plan rejected, or a bad plan (at most once)' },
    { from: 'in-progress', to: 'in-review', by: script, why: 'handover, checks green' },
    { from: 'in-review', to: 'in-progress', by: script, why: 'blocking finding or QA fail (uses a round)' },
    { from: 'built', to: 'in-progress', by: human, needs: ['note'], why: 'MR comments or red CI: you grant a new budget' },
    { from: 'built', to: 'waiting', by: script, why: 'a stacked parent got change requests' },
    { from: 'built', to: 'ready-for-dev', by: human, needs: ['note'], why: 'MR closed, you send it back' },
    { from: 'built', to: 'dropped', by: human, why: 'MR closed, you drop it' },
    { from: 'in-progress', to: 'blocked', by: script, needs: ['park_reason'], why: 'parked' },
    { from: 'in-review', to: 'blocked', by: script, needs: ['park_reason'], why: 'parked' },
    { from: 'waiting', to: 'blocked', by: script, needs: ['park_reason'], why: 'rebase conflict' },
    ...Object.entries(UNPARK_CHOICES).map(([choice, to]) => (
      { from: 'blocked', to, by: human, needs: ['note', 'choice'], choice, why: `unpark: ${choice}` })),
    { from: 'draft', to: 'dropped', by: human, why: 'you drop it' },
    { from: 'ready-for-dev', to: 'dropped', by: human, why: 'you drop it' },
  ],
});

export const RUN = machine('run', {
  states: ['running', 'paused', 'stopped', 'finished'],
  initial: 'running',
  final: ['finished'],
  moves: [
    { from: 'running', to: 'paused', by: script, why: 'usage limit hit' },
    { from: 'paused', to: 'running', by: script, why: 'limit reset, resume from checkpoint' },
    { from: 'paused', to: 'stopped', by: script, why: 'reset after run.stop_by, or the weekly limit' },
    { from: 'running', to: 'stopped', by: either, why: 'circuit breaker, cut-off, or you' },
    { from: 'stopped', to: 'running', by: human, why: 'mirai resume' },
    { from: 'running', to: 'finished', by: script, why: 'queue empty' },
  ],
});

export const EPIC = machine('epic', {
  states: ['open', 'integrating', 'final-e2e', 'final-e2e-failed', 'ready-to-merge', 'done'],
  initial: 'open',
  final: ['done'],
  moves: [
    { from: 'open', to: 'integrating', by: script, why: 'first ticket integrated' },
    { from: 'integrating', to: 'final-e2e', by: script, why: 'all tickets integrated' },
    { from: 'final-e2e', to: 'ready-to-merge', by: script, why: 'final E2E passes' },
    { from: 'final-e2e', to: 'final-e2e-failed', by: script, why: 'final E2E fails' },
    { from: 'final-e2e-failed', to: 'integrating', by: human, why: 'you pick the bug ticket for the fix' },
    { from: 'ready-to-merge', to: 'done', by: human, why: 'you merge feature/<epic> into the integration branch' },
  ],
});

export const MACHINES = Object.freeze({ document: DOCUMENT, ticket: TICKET, run: RUN, epic: EPIC });
