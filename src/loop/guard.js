import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { canonicalPath, failureSignature, findingFingerprint } from '../findings/findings.js';
import { atomicWrite, ensurePrivateDir, withLock } from '../store/files.js';
import { readJournal } from '../store/journal.js';
import { RUN_ID } from '../store/run-log.js';
import { readTicketStatus } from '../store/tickets.js';

// The loop guard (unit 20; D-18, R-C7, design/01 §9): one library every fix loop uses. Fixed rules,
// never an AI deciding whether to go on:
// - one shared round budget per ticket across checks, review and QA (2, or 3 for high risk). The
//   round is the fix launch that sends work back, whatever triggered it. The developer's own
//   session isn't one, and a launch that ends in an environment fault or a usage limit gives its
//   round back (R-M5); a launch that never reports (a crash) keeps it;
// - L2: from round 2 a finding not seen before counts only if it's blocking and on a file the
//   delta changed (by file, not by line: a deviation from design/01, recorded in the spec); a
//   finding seen before always counts, and is L4's;
// - L4: the same finding (file + symbol + basis) or the same test failure in a later round is a
//   plan problem: the ticket's one re-plan (its status file's count, unit 04), then park;
// - L5: the open blocking count must strictly drop each round, and a file going back to an
//   earlier version is churn: either parks. Disputed findings (L3, unit 24) are left out.
// Counters live in the store, change under a lock, are written before each launch, and only you
// can add rounds (grantRounds); nothing lowers them, so a restart can't grant new ones.

export const LOOP_SCHEMA = 1;
export const ROUND_DEFAULTS = Object.freeze({ rounds: 2, rounds_high_risk: 3 });
const TICKET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const COUNTERS = ['rounds_used', 'reviews', 'launches', 'granted', 'replans_used', 'last_settled'];
const BUDGET = ['turns', 'tokens', 'tokens_cached', 'minutes', 'cost_usd', 'limit_share'];

const pathOf = (store, ticket) => {
  if (!TICKET.test(ticket ?? '')) throw new TypeError('not a ticket key');
  return join(store.dir, 'loop', `${ticket}.json`);
};
const lockOf = (store, ticket) => join(store.dir, 'loop', `${ticket}.lock`);

const fresh = (ticket) => ({
  schema: LOOP_SCHEMA, ticket, rounds_used: 0, reviews: 0, launches: 0, granted: 0, replans_used: 0, last_settled: 0, pending: null, round_open: [], fingerprints: {}, signatures: {}, blobs: {},
  budget: Object.fromEntries(BUDGET.map((k) => [k, 0])), parked: null, grants: [],
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v) => Number.isSafeInteger(v) && v >= 0;
function wellFormed(v, ticket) {
  return v?.schema === LOOP_SCHEMA && v.ticket === ticket && COUNTERS.every((k) => count(v[k])) && isObject(v.budget) && BUDGET.every((k) => typeof v.budget[k] === 'number' && v.budget[k] >= 0)
    && Array.isArray(v.round_open) && v.round_open.every(count) && isObject(v.fingerprints) && Object.values(v.fingerprints).every(count) && isObject(v.signatures) && Object.values(v.signatures).every(count)
    && isObject(v.blobs) && Object.values(v.blobs).every((b) => Array.isArray(b) && b.every((x) => typeof x === 'string')) && Array.isArray(v.grants)
    && (v.parked === null || (isObject(v.parked) && typeof v.parked.reason === 'string')) && (v.pending === null || isObject(v.pending));
}

// The ticket's counters: fresh if there are none; anything else that isn't whole refuses, never resets.
export function readLoop(store, ticket) {
  let text;
  try {
    text = readFileSync(pathOf(store, ticket), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return fresh(ticket);
    throw err;
  }
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    v = null;
  }
  if (!wellFormed(v, ticket)) throw Object.assign(new MiraiError(`the loop counters for ${ticket} can't be read; they're never reset by guessing`, EXIT.BLOCKED), { code: 'loop-unreadable', hint: 'run: mirai doctor' });
  return v;
}

// One change to a ticket's counters, under its lock: read, change, write.
function change(store, ticket, fn) {
  ensurePrivateDir(join(store.dir, 'loop'));
  return withLock(lockOf(store, ticket), 'the loop counters', () => {
    const state = readLoop(store, ticket);
    const { next, result } = fn(state);
    if (next) atomicWrite(pathOf(store, ticket), `${JSON.stringify(next, null, 2)}\n`);
    return result;
  });
}

export function roundsAllowed(state, risk, caps = {}) {
  const normal = caps.rounds ?? ROUND_DEFAULTS.rounds;
  const high = Math.max(caps.rounds_high_risk ?? ROUND_DEFAULTS.rounds_high_risk, normal);
  return (risk === 'high' ? high : normal) + state.granted;
}

const evidenceOf = (ticket) => [`loop/${ticket}.json`];

// Before a launch, written before it starts: { go: true, launch } or { go: false, park }. `round`:
// a fix launch after handover. The launch is pending until settleLaunch says how it ended.
export function beforeLaunch(store, ticket, { round = false, risk = null, caps = {} } = {}) {
  return change(store, ticket, (state) => {
    if (state.parked) return { result: { go: false, park: state.parked } };
    if (round && state.rounds_used >= roundsAllowed(state, risk, caps)) {
      const park = { reason: 'cap', why: `its ${roundsAllowed(state, risk, caps)} rounds are used`, evidence: evidenceOf(ticket) };
      return { next: { ...state, parked: park }, result: { go: false, park } };
    }
    const launch = state.launches + 1;
    return { next: { ...state, launches: launch, rounds_used: state.rounds_used + (round ? 1 : 0), pending: { launch, round } }, result: { go: true, launch } };
  });
}

// After a launch: what it used, and how it ended. `refundable` (runAgent's): a fault decided before
// the agent could act, or a usage limit, gives its round back (R-M5); a pause resumes the same step
// with the same counters. Each launch is settled once.
export function settleLaunch(store, ticket, { launch, outcome, refundable = false, line = {} }) {
  return change(store, ticket, (state) => {
    if (!Number.isSafeInteger(launch) || launch < 1 || launch > state.launches || launch <= state.last_settled) return { result: { refunded: false, ignored: true } };
    const add = (k, v) => (Number.isFinite(v) && v > 0 ? state.budget[k] + v : state.budget[k]);
    const budget = {
      turns: add('turns', line.turns), tokens: add('tokens', (line.tokens_in ?? 0) + (line.tokens_out ?? 0)), tokens_cached: add('tokens_cached', line.tokens_cached),
      minutes: add('minutes', line.minutes), cost_usd: add('cost_usd', line.cost_usd), limit_share: add('limit_share', line.limit_share),
    };
    const mine = state.pending?.launch === launch;
    const refund = mine && state.pending.round && refundable && ['env-fault', 'usage-limit'].includes(outcome);
    return { next: { ...state, budget, last_settled: launch, pending: mine ? null : state.pending, rounds_used: state.rounds_used - (refund ? 1 : 0) }, result: { refunded: refund } };
  });
}

// L2, for one round: { counted, fresh } where a finding seen in an earlier round always counts.
export function countingFindings(findings, { round, delta = [], seen = {} }) {
  const touched = new Set(delta.map(canonicalPath));
  const counted = [];
  const fps = new Set();
  for (const f of findings) {
    const fp = findingFingerprint(f);
    if (fps.has(fp)) continue; // the same finding twice in one round counts once
    fps.add(fp);
    const known = seen[fp] !== undefined;
    if (round <= 1 || known || (f.severity === 'blocking' && touched.has(canonicalPath(f.file)))) counted.push(f);
  }
  return counted;
}

// After a round's review and checks: { next: 'fix' | 'replan' | 'done' | 'park', reason, why,
// evidence, counted }. The round is the next one by the counters (a replay is refused).
// `findings`: triaged (09a's triage, L1); `failures`: [{ test, message }]; `blobs`: { file: blob }
// of the files this round changed; `delta`: those files; `disputed`: fingerprints left out (L3).
export function afterRound(store, ticket, { findings = [], failures = [], blobs: given = {}, delta = [], disputed = [], root = null, round: claimed }) {
  return change(store, ticket, (state) => {
    if (state.parked) return { result: { next: 'park', ...state.parked, counted: [] } };
    // One re-plan per ticket (04), counted here and in the status file: the larger counts, so a
    // status write that drops the field can't give a second one.
    const replans = Math.max(state.replans_used, readTicketStatus(store, ticket)?.status?.replans ?? 0);
    const round = state.reviews + 1;
    if (claimed !== round) throw Object.assign(new MiraiError(`round ${claimed} was already recorded for ${ticket} (next is ${round})`, EXIT.BLOCKED), { code: 'round-replayed' });
    const blobs = Object.fromEntries(Object.entries(given).map(([k, v]) => [canonicalPath(k), v]));
    const counted = countingFindings(findings, { round, delta, seen: state.fingerprints }).filter((f) => !disputed.includes(findingFingerprint(f)));
    const blocking = counted.filter((f) => f.severity === 'blocking');
    const fps = blocking.map((f) => findingFingerprint(f));
    const sigs = [...new Set(failures.map((f) => failureSignature(f, { root })))];
    const repeats = [...fps.filter((x) => state.fingerprints[x] !== undefined), ...sigs.filter((x) => state.signatures[x] !== undefined)];
    const churn = Object.entries(blobs).filter(([file, sha]) => (state.blobs[file] ?? []).slice(0, -1).includes(sha)).map(([file]) => file);
    const open = blocking.length + sigs.length;
    const previous = state.round_open.at(-1);
    const next = {
      ...state,
      reviews: round,
      fingerprints: { ...state.fingerprints, ...Object.fromEntries(fps.filter((x) => state.fingerprints[x] === undefined).map((x) => [x, round])) },
      signatures: { ...state.signatures, ...Object.fromEntries(sigs.filter((x) => state.signatures[x] === undefined).map((x) => [x, round])) },
      blobs: { ...state.blobs, ...Object.fromEntries(Object.entries(blobs).map(([f, sha]) => [f, [...(state.blobs[f] ?? []), sha]])) },
      round_open: [...state.round_open, open],
    };
    let decision;
    if (open === 0) decision = { next: 'done' };
    else if (repeats.length) {
      decision = replans < 1
        ? { next: 'replan', reason: 'bad-plan', why: 'the same problem came back: a plan problem (L4)' }
        : { next: 'park', reason: 'repeat', why: 'the same problem came back after a re-plan (L4)' };
    } else if (churn.length) decision = { next: 'park', reason: 'no-progress', why: `a file went back to an earlier version: ${churn.join(', ')} (L5, churn)` };
    else if (previous !== undefined && open >= previous) decision = { next: 'park', reason: 'no-progress', why: `the open blocking count didn't drop (${previous} → ${open}) (L5)` };
    else decision = { next: 'fix' };
    const evidence = decision.next === 'park' || decision.next === 'replan' ? evidenceOf(ticket) : [];
    // A re-plan starts the progress count again: the new plan's first review isn't held to the old one.
    if (decision.next === 'replan') Object.assign(next, { replans_used: replans + 1, round_open: [] });
    if (decision.next === 'park') next.parked = { reason: decision.reason, why: decision.why, evidence };
    return { next, result: { ...decision, evidence, counted, round } };
  });
}

// Parks a ticket's loop for a reason found elsewhere (a scope violation, a budget).
export function parkLoop(store, ticket, { reason, why, evidence = [] }) {
  return change(store, ticket, (state) => (state.parked ? { result: state.parked } : { next: { ...state, parked: { reason, why, evidence } }, result: { reason, why, evidence } }));
}

// You give a parked ticket more rounds (D-07: unpark retry, a grant after an MR): its park is cleared,
// the grant is kept, and no counter goes down. `proof`: the seq of your signed move for this ticket
// in the journal (unit 06; a `status_written` line by you, its signature verified when the journal
// is read). One move gives one grant.
export function grantRounds(store, ticket, { rounds, note, proof, now = () => new Date() }) {
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 10) throw new TypeError('rounds is a whole number from 1 to 10');
  const move = readJournal(store).events.find((e) => e.seq === proof);
  if (!move || move.type !== 'status_written' || move.by !== 'human' || move.ticket !== ticket || !move.signature) {
    throw Object.assign(new MiraiError(`rounds are yours to give: no signed move of yours for ${ticket} at seq ${proof}`, EXIT.BLOCKED), { code: 'no-grant-proof' });
  }
  return change(store, ticket, (state) => {
    if (state.grants.some((g) => g.proof === proof)) throw Object.assign(new MiraiError('that move already gave its rounds', EXIT.BLOCKED), { code: 'grant-used' });
    return { next: { ...state, granted: state.granted + rounds, parked: null, grants: [...state.grants, { at: now().toISOString(), rounds, proof, note: String(note ?? '').slice(0, 300), was: state.parked }] }, result: { granted: state.granted + rounds } };
  });
}

// The circuit breaker (D-18): environment faults in a row, per run. Returns { trip, count }. A file
// it can't read trips it: never a fresh count by guessing.
export const BREAKER_DEFAULT = 3;
export function recordFault(store, runId, { fault, limit = BREAKER_DEFAULT }) {
  if (!RUN_ID.test(runId ?? '')) throw new TypeError('not a run id');
  ensurePrivateDir(join(store.dir, 'loop'));
  ensurePrivateDir(join(store.dir, 'loop', 'breakers'));
  const file = join(store.dir, 'loop', 'breakers', `${runId}.json`);
  let n = 0;
  try {
    n = JSON.parse(readFileSync(file, 'utf8')).count;
    if (!count(n)) n = limit;
  } catch (err) {
    n = err.code === 'ENOENT' ? 0 : limit;
  }
  n = fault ? n + 1 : 0;
  atomicWrite(file, `${JSON.stringify({ count: n })}\n`);
  return { trip: n >= limit, count: n };
}
