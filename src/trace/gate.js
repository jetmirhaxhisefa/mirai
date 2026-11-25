import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { planInputs } from '../agent/inputs.js';
import { planApproval } from '../agent/plan.js';
import { afterRound, parkLoop, readLoop, roundsAllowed } from '../loop/guard.js';
import { parkTicket } from '../loop/park.js';
import { TICKET } from '../status/machines.js';
import { move } from '../status/move.js';
import { atomicWrite, ensurePrivateDir } from '../store/files.js';
import { blobAt, commitOf } from '../store/git.js';
import { readTicketStatus, writeTicketStatus } from '../store/tickets.js';
import { agentSessionDir, forgetSession } from '../agent/session.js';
import { gateCases, traceFindings, traceTicket } from './ticket.js';

// Trace at ship time (unit 43, Scope 4; Jet's decision 1): `mirai gate record` runs it after every
// check and level passed and before any proof is minted. A pass goes into the signed proofs. A fail
// mints nothing: one must-fix finding per missing link (09a's fields) goes back to Kai's fix loop,
// counted by the loop guard (unit 20) like a failing test (each missing link is one failure, so the
// same link missing again is L4's, and the count must drop, L5); when the ticket's rounds are used,
// it parks, with the trace result as its note.

export const TRACE_RECORD = 'trace.json';
export const traceRecordPath = (store, ticket) => join(store.dir, 'tickets', ticket, TRACE_RECORD);
const JOURNEYS = '.mirai/context/journeys.md';

// The ticket's trace from the gate's own results (`results`: the signed results of this gate run,
// each with its folder): traceTicket's result, with the ticket's risk.
export function traceAtGate({ store, trust, config, keys, ticket, results }) {
  const approved = planApproval(store, ticket, keys);
  const given = planInputs({ root: store.checkout, env: store.gitEnv, commit: trust.baseSha, ticketId: ticket, config, store, plan: approved.ok ? approved.text : null });
  const journeys = blobAt(store.checkout, trust.baseSha, JOURNEYS, store.gitEnv);
  const { cases, problems } = gateCases(results);
  const t = traceTicket({ ticket: given.ticket, plan: approved.ok ? approved.text : null, cases, problems, journeys: journeys ? journeys.toString('utf8') : null, config });
  return { ...t, risk: given.ticket.fm?.risk === 'high' ? 'high' : 'normal' };
}

export function readTraceRecord(store, ticket) {
  try {
    return JSON.parse(readFileSync(traceRecordPath(store, ticket), 'utf8'));
  } catch {
    return null;
  }
}

// A short line for a park note and the gate's output: the first missing links.
export const traceSummary = (t) => `trace: ${t.missing.slice(0, 3).map((m) => m.what).join('; ')}${t.missing.length > 3 ? `; and ${t.missing.length - 3} more` : ''}`;

// A failing trace's consequences: the record (what Kai's fix round reads), the loop guard's round,
// and the ticket's move: back to in-progress for a fix, to ready-for-dev for its one re-plan (L4),
// or parked (L4/L5, or its rounds used). Returns { next: 'fix' | 'replan' | 'park', why, findings }.
export function sendBack({ store, ticket, traced, head, config, now = () => new Date() }) {
  const prior = readTraceRecord(store, ticket);
  const findings = traceFindings(traced);
  const round = readLoop(store, ticket).reviews + 1;
  const failures = traced.missing.map((m) => ({ test: `trace:${m.id}:${m.kind}`, message: m.what }));
  // L5 compares this trace with the last one (like with like); the first is judged on its own.
  const decision = afterRound(store, ticket, { failures, round, previousOpen: prior?.result === 'fail' && Number.isInteger(prior.open) ? prior.open : null });
  ensurePrivateDir(join(store.dir, 'tickets', ticket));
  atomicWrite(traceRecordPath(store, ticket), `${JSON.stringify({ schema: 1, ticket, commit: head, result: traced.result, round, open: traced.missing.length, missing: traced.missing, findings, at: now().toISOString() }, null, 2)}\n`);
  const summary = traceSummary(traced);
  const current = readTicketStatus(store, ticket).status;
  const keepReplans = current.replans !== undefined ? { replans: current.replans } : {};
  const caps = { rounds: config.loop?.rounds, rounds_high_risk: config.loop?.rounds_high_risk };
  if (decision.next === 'fix') {
    const state = readLoop(store, ticket);
    if (state.rounds_used >= roundsAllowed(state, traced.risk, caps)) {
      const why = `its ${roundsAllowed(state, traced.risk, caps)} rounds are used; ${summary}`;
      parkLoop(store, ticket, { reason: 'cap', why, evidence: [`tickets/${ticket}/${TRACE_RECORD}`] });
      parkTicket(store, ticket, { reason: 'cap', why, evidence: [`tickets/${ticket}/${TRACE_RECORD}`] });
      return { next: 'park', why, findings };
    }
    move(TICKET, 'in-review', 'in-progress', { by: 'script', item: ticket });
    writeTicketStatus(store, { ticket, state: 'in-progress', ...keepReplans }, { expectSeq: current.seq });
    return { next: 'fix', why: summary, findings };
  }
  if (decision.next === 'replan') {
    move(TICKET, 'in-review', 'in-progress', { by: 'script', item: ticket });
    writeTicketStatus(store, { ticket, state: 'in-progress', ...keepReplans }, { expectSeq: current.seq });
    const mid = readTicketStatus(store, ticket).status;
    move(TICKET, 'in-progress', 'ready-for-dev', { by: 'script', item: ticket, reason: 'bad-plan', replans: mid.replans ?? 0 });
    writeTicketStatus(store, { ticket, state: 'ready-for-dev', replans: 1, note: `${decision.why}; ${summary}`.slice(0, 500) }, { expectSeq: mid.seq, move: { reason: 'bad-plan' } });
    forgetSession(agentSessionDir(store, ticket));
    return { next: 'replan', why: `${decision.why}; ${summary}`, findings };
  }
  const why = `${decision.why ?? 'parked'}; ${summary}`;
  parkTicket(store, ticket, { reason: decision.reason ?? 'no-progress', why, evidence: [`tickets/${ticket}/${TRACE_RECORD}`, ...(decision.evidence ?? [])] });
  return { next: 'park', why, findings };
}

// Where a fix round from a failing trace starts (fixFrom's last choice): the trace record of the
// ticket's branch as it is (its head: the handed-over commit, or a commit of yours on top that
// the gate ran on), or null.
export function traceStart(store, ticket, last) {
  if (last?.outcome !== 'handed-over' || typeof last.branch !== 'string') return null;
  const head = commitOf(store.checkout, `refs/heads/${last.branch}`, store.gitEnv);
  if (!head) return null;
  const r = readTraceRecord(store, ticket);
  if (r?.result !== 'fail' || r.commit !== head || !Array.isArray(r.findings) || !r.findings.length) return null;
  return { commit: head, branch: last.branch, plan_sha256: last.plan_sha256 ?? null, launch: last.launch ?? null, tests: null, trace: r.round, findings: r.findings };
}
