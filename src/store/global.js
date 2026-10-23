import { join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { acquireLock, appendLine, ensurePrivateDir, isAlive, jsonLine, lockHolder, readJsonLines, withLock } from './files.js';
import { miraiHome } from './home.js';
import { appendEvent } from './journal.js';
import { PLAN } from '../config/config-schema.js';
import { RUN_ID } from './run-log.js';
import { newRunId, startRun } from './run.js';

// The global folder (unit 05b; D-57): `<mirai-home>/global/`, shared by all your projects and
// private like the store. It holds the usage ledger (one usage budget across projects) and the
// global run lock (one MIRAI run at a time across projects).

export const LEDGER_SCHEMA_VERSION = 1;
const REPO_ID = /^[a-z0-9][a-z0-9-]{0,39}-[0-9a-f]{12}$/;
const LEDGER_KEYS = ['schema_version', 'ts', 'repo_id', 'run_id', 'plan', 'limit_share', 'kind', 'ticket', 'upto_seq'];
const TICKET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function globalPaths(env) {
  const dir = join(miraiHome(env), 'global');
  return { dir, ledger: join(dir, 'usage.jsonl'), runLock: join(dir, 'run.lock'), ledgerLock: join(dir, 'locks', 'ledger.lock') };
}

// Creates the global folder (0700) if it's missing, and checks it.
export function ensureGlobal(env) {
  const g = globalPaths(env);
  ensurePrivateDir(miraiHome(env));
  ensurePrivateDir(g.dir);
  ensurePrivateDir(join(g.dir, 'locks'));
  return g;
}

// Appends one ledger line. Every line is a delta, a percent of the weekly limit:
// - `kind: "ticket"`: a finished ticket's share, with its `ticket`;
// - `kind: "run"`: the run's overhead since its last line (planning, reports, work between
//   tickets), written at each ticket boundary and at the end, so the cap check before the next
//   ticket sees it.
// `uptoSeq` is the run-log seq the line covers up to. Lines of one run must go up in it, and a
// line at or below the last one recorded for that run is skipped, so a resume (unit 28) or
// doctor (unit 29) can write the ledger again from the run log without counting twice.
// Returns true when the line was written, false when it was already there.
export function appendUsage(env, { repoId, runId, plan = 'unknown', limitShare, kind, ticket, uptoSeq, now = () => new Date() }) {
  if (!['ticket', 'run'].includes(kind)) throw new TypeError('kind is "ticket" or "run"');
  if (kind === 'ticket' ? !TICKET.test(ticket ?? '') : ticket !== undefined) throw new TypeError('a ticket line names its ticket; a run line names none');
  if (!Number.isSafeInteger(uptoSeq) || uptoSeq < 1) throw new TypeError('uptoSeq is the run-log seq the line covers');
  if (!RUN_ID.test(runId ?? '')) throw new TypeError('not a run id');
  if (typeof repoId !== 'string' || !REPO_ID.test(repoId)) throw new TypeError('not a repo id');
  if (!PLAN.test(plan)) throw new TypeError('not a plan name');
  if (typeof limitShare !== 'number' || !Number.isFinite(limitShare) || limitShare < 0 || limitShare > 100) throw new TypeError('limit_share is a percent from 0 to 100');
  const g = ensureGlobal(env);
  const line = jsonLine({ schema_version: LEDGER_SCHEMA_VERSION, ts: now().toISOString(), repo_id: repoId, run_id: runId, plan, limit_share: limitShare, kind, ...(ticket ? { ticket } : {}), upto_seq: uptoSeq });
  return withLock(g.ledgerLock, 'ledger', () => {
    const covered = readUsage(env).filter((u) => u.run_id === runId).reduce((max, u) => Math.max(max, u.upto_seq), 0);
    if (uptoSeq <= covered) return false;
    appendLine(g.ledger, line);
    return true;
  });
}

// The ledger's lines, checked; a torn last line is skipped, a broken middle line fails closed.
export function readUsage(env) {
  const g = globalPaths(env);
  const { entries } = readJsonLines(g.ledger, { optional: true });
  return entries.map(({ line, value: v }) => {
    const ok = v.schema_version === LEDGER_SCHEMA_VERSION && Object.keys(v).every((k) => LEDGER_KEYS.includes(k))
      && typeof v.ts === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(v.ts) && !Number.isNaN(Date.parse(v.ts))
      && REPO_ID.test(v.repo_id) && RUN_ID.test(v.run_id) && PLAN.test(v.plan)
      && typeof v.limit_share === 'number' && v.limit_share >= 0 && v.limit_share <= 100 && ['ticket', 'run'].includes(v.kind)
      && (v.kind === 'ticket' ? TICKET.test(v.ticket ?? '') : v.ticket === undefined) && Number.isSafeInteger(v.upto_seq) && v.upto_seq >= 1;
    if (!ok) throw new StoreError(`${g.ledger}:${line}: not a valid usage line`, { path: g.ledger, line, code: 'corrupt-line', hint: 'run: mirai doctor' });
    return Object.freeze(v);
  });
}

// The share of the weekly limit MIRAI used since `from`, across all repos. Unit 20 picks the
// windows (night, week) and checks the caps before each ticket. Every line is a delta, so the
// lines add up and nothing counts twice. `kind` sums one kind only.
export function usageSince(env, from, { kind } = {}) {
  // A bad window must never read as "no usage" (fail closed for unit 20's caps).
  if (!(from instanceof Date) || !Number.isFinite(from.getTime())) throw new TypeError('from must be a valid Date');
  if (kind !== undefined && !['ticket', 'run'].includes(kind)) throw new TypeError('kind is "ticket" or "run"');
  const since = from.getTime();
  return readUsage(env)
    .filter((u) => Date.parse(u.ts) >= since && (kind === undefined || u.kind === kind))
    .reduce((sum, u) => sum + u.limit_share, 0);
}

// Takes the global run lock for this repo's run. Never waits: while another live run holds it,
// a run in any repo is refused (exit 4). A dead holder's lock is broken and logged in this
// repo's journal. Returns { release }.
export function acquireRunLock(store, runId, env) {
  if (!RUN_ID.test(runId ?? '')) throw new TypeError('not a run id');
  const g = ensureGlobal(env);
  const { release, broken } = acquireLock(g.runLock, 'run', {
    waitMs: 0,
    extra: { repo_id: store.repoId, run_id: runId },
    describe: (h) => {
      if (!h) return 'the global run lock is unreadable (run: mirai doctor)';
      if (!isAlive(h.pid)) return `the global run lock left by a dead run (pid ${h.pid}) is being cleared by another process; try again`;
      return `a MIRAI run is already going in ${h.repo_id === store.repoId ? 'this repo' : h.repo_id} (run ${h.run_id}, pid ${h.pid}); one run at a time across all projects (D-57)`;
    },
  });
  if (broken) {
    try {
      appendEvent(store, { type: 'lock_broken', by: 'script', lock: 'global-run', pid: broken.pid });
    } catch (err) {
      release(); // a run that can't record the break must not keep the lock
      throw err;
    }
  }
  return { release };
}

// Takes the global run lock, then starts the run with the same id: the one way a run should
// begin (D-57: one run at a time across projects). Returns { state, release }; the lock is
// released again if the run can't start.
export function beginRun(store, env, options = {}) {
  const runId = options.runId ?? newRunId();
  const { release } = acquireRunLock(store, runId, env);
  try {
    return { state: startRun(store, { ...options, runId }), release };
  } catch (err) {
    release();
    throw err;
  }
}

// Who holds the global run lock, for `mirai status`: null when it's free.
export function runLockHolder(env) {
  return lockHolder(globalPaths(env).runLock);
}

