import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { RUN } from '../status/machines.js';
import { move } from '../status/move.js';
import { atomicWrite, readPrivateFile } from './files.js';
import { buildRunLine, readRunLog, RUN_ID } from './run-log.js';
import { withSeq } from './journal.js';

// Run state and heartbeat (unit 05b). `state.json` holds the current run's state (unit 04's run
// machine); every change takes a `seq` and writes a `run_state` line with the same number to
// the run log. `heartbeat.json` is written by the running orchestrator so a dead run shows.
//
// Write order: the run-log line first, then state.json. The log is the history and stays a
// superset: after a crash between the two, state.json is one move behind, and
// `runStateMatchesLog` sees it, so `mirai resume` (unit 28) and `doctor` (unit 29) can rebuild
// the state from the log. (Ticket status is the other way round, because there the status
// file is the one home and the journal event records it.)
//
// A run begins with global.js `beginRun`, which takes the global run lock and then calls
// `startRun` with the same id.

export const RUN_STATE_SCHEMA_VERSION = 1;
export const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const STEP = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TICKET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
// A heartbeat from more than a minute in the future (a clock jump) is treated as stale.
const FUTURE_TOLERANCE_MS = 60 * 1000;

const statePath = (store) => join(store.dir, 'state.json');
const heartbeatPath = (store) => join(store.dir, 'heartbeat.json');
const iso = (d) => d.toISOString();

// A new run id: r-YYYYMMDD-HHMMSS-<4 hex>, in UTC, so ids sort by start time.
export function newRunId(now = new Date()) {
  const t = iso(now).replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `r-${t}-${randomBytes(2).toString('hex')}`;
}

function bad(file, why) {
  return new StoreError(`${file}: ${why}`, { path: file, code: 'corrupt', hint: 'run: mirai doctor' });
}

// The current run's state, or null when there has been no run.
export function readRunState(store) {
  const file = statePath(store);
  const text = readPrivateFile(file, { maxBytes: 16 * 1024, optional: true });
  if (text === null) return null;
  let s;
  try {
    s = JSON.parse(text);
  } catch {
    throw bad(file, 'is not readable');
  }
  if (s?.schema_version > RUN_STATE_SCHEMA_VERSION) {
    throw new StoreError(`${file}: written by a newer MIRAI`, { path: file, code: 'version', hint: 'update MIRAI before using this store' });
  }
  const ok = s !== null && typeof s === 'object' && s.schema_version === RUN_STATE_SCHEMA_VERSION
    && RUN_ID.test(s.run_id) && RUN.states.includes(s.state) && ISO.test(s.started_at) && Number.isSafeInteger(s.seq)
    && (s.ticket === undefined || TICKET.test(s.ticket)) && (s.step === undefined || STEP.test(s.step))
    && (s.stop_by === undefined || ISO.test(s.stop_by));
  if (!ok) throw bad(file, 'is not a valid run state');
  return Object.freeze(s);
}

function writeState(store, state) {
  atomicWrite(statePath(store), `${JSON.stringify(state, null, 2)}\n`);
}

// Starts a run: `running`, with a `run_started` line. `plan` comes from your global config
// (D-57), `unknown` when it isn't set. Refused while the last run isn't finished or stopped.
// Starting over a `stopped` run gives that run up: it can no longer be resumed.
export function startRun(store, { runId = newRunId(), preset, plan = 'unknown', stopBy, now = () => new Date() }) {
  if (stopBy !== undefined && !ISO.test(stopBy)) throw new TypeError('stopBy is a UTC time');
  const line = { item: 'run', event: 'run_started', preset, plan };
  buildRunLine(runId, 1, line); // checked before a number is taken
  return withSeq(store, ({ take, runLine }) => {
    const current = readRunState(store);
    if (current && !['finished', 'stopped'].includes(current.state)) {
      throw new StoreError(`run ${current.run_id} is still ${current.state}`, {
        code: 'run-active',
        exitCode: EXIT.BLOCKED,
        hint: 'if it crashed, mirai resume checks its heartbeat and takes it over (unit 28)',
      });
    }
    const seq = take();
    runLine(runId, seq, line);
    const state = { schema_version: RUN_STATE_SCHEMA_VERSION, run_id: runId, state: RUN.initial, started_at: iso(now()), seq, ...(stopBy ? { stop_by: stopBy } : {}) };
    writeState(store, state);
    return Object.freeze(state);
  });
}

// Moves the current run to `to` through unit 04's run machine, with a `run_state` line carrying
// the same seq. `by: 'human'` (`mirai resume`) waits for signatures (unit 06).
// The ticket and step carry over unless given (or cleared with `clear: true`), so a pause
// resumes that exact step (D-18).
export function writeRunState(store, to, { by = 'script', ticket, step, clear = false } = {}) {
  if (by === 'human') {
    throw new StoreError('a human run move needs a signature, which unit 06 adds', { code: 'unsigned', exitCode: EXIT.BLOCKED });
  }
  if (ticket !== undefined && !TICKET.test(ticket)) throw new TypeError('not a ticket key');
  if (step !== undefined && !STEP.test(step)) throw new TypeError('not a step name');
  return withSeq(store, ({ take, runLine }) => {
    const current = readRunState(store);
    if (current === null) throw new StoreError('there is no run to move', { code: 'no-run', exitCode: EXIT.BLOCKED });
    move(RUN, current.state, to, { by, item: current.run_id });
    const line = { item: ticket ?? 'run', event: 'run_state', from: current.state, to };
    buildRunLine(current.run_id, 1, line); // checked before a number is taken
    const seq = take();
    runLine(current.run_id, seq, line);
    const { ticket: oldTicket, step: oldStep, ...rest } = current;
    const keep = clear ? {} : { ...(oldTicket ? { ticket: oldTicket } : {}), ...(oldStep ? { step: oldStep } : {}) };
    const next = { ...rest, ...keep, state: to, seq, ...(ticket ? { ticket } : {}), ...(step ? { step } : {}) };
    writeState(store, next);
    return Object.freeze(next);
  });
}

// Records where the running run is (its ticket and step) without a state move: the run machine
// has no running → running move, and resume (unit 28) reads the position from state.json.
export function recordProgress(store, { ticket, step }) {
  if (ticket !== undefined && !TICKET.test(ticket)) throw new TypeError('not a ticket key');
  if (step !== undefined && !STEP.test(step)) throw new TypeError('not a step name');
  return withSeq(store, () => {
    const current = readRunState(store);
    if (current === null || !['running', 'paused'].includes(current.state)) {
      throw new StoreError('there is no running run to record progress for', { code: 'no-run', exitCode: EXIT.BLOCKED });
    }
    const { ticket: _t, step: _s, ...rest } = current;
    const next = { ...rest, ...(ticket ? { ticket } : {}), ...(step ? { step } : {}) };
    writeState(store, next);
    return Object.freeze(next);
  });
}

// The orchestrator's heartbeat: atomic, no seq (it orders nothing).
export function writeHeartbeat(store, { runId, ticket, step, now = () => new Date() }) {
  if (!RUN_ID.test(runId)) throw new TypeError('not a run id');
  if (ticket !== undefined && !TICKET.test(ticket)) throw new TypeError('not a ticket key');
  if (step !== undefined && !STEP.test(step)) throw new TypeError('not a step name');
  const beat = { schema_version: RUN_STATE_SCHEMA_VERSION, run_id: runId, pid: process.pid, ts: iso(now()), ...(ticket ? { ticket } : {}), ...(step ? { step } : {}) };
  atomicWrite(heartbeatPath(store), `${JSON.stringify(beat)}\n`);
  return beat;
}

// Whether state.json agrees with the run log: its seq is the seq of the log's last
// run_started / run_state line, and its state is where that line leads. False after a crash
// between the two writes; resume (unit 28) and doctor (unit 29) rebuild it from the log.
export function runStateMatchesLog(store) {
  const state = readRunState(store);
  if (state === null) return true;
  const moves = readRunLog(store, state.run_id).lines.filter((l) => l.event === 'run_started' || l.event === 'run_state');
  const last = moves[moves.length - 1];
  if (!last) return false;
  const leadsTo = last.event === 'run_started' ? RUN.initial : last.to;
  return last.seq === state.seq && leadsTo === state.state;
}

// The heartbeat with its age: `{ ...beat, ageMs, stale }`, or null when there is none. A
// heartbeat dated more than a minute ahead is stale too (`future: true`): a clock jump must not
// make a dead run look alive forever.
export function readHeartbeat(store, { now = () => new Date() } = {}) {
  const file = heartbeatPath(store);
  const text = readPrivateFile(file, { maxBytes: 4096, optional: true });
  if (text === null) return null;
  let b;
  try {
    b = JSON.parse(text);
  } catch {
    throw bad(file, 'is not readable');
  }
  const ok = b && RUN_ID.test(b.run_id) && Number.isSafeInteger(b.pid) && ISO.test(b.ts)
    && (b.ticket === undefined || TICKET.test(b.ticket)) && (b.step === undefined || STEP.test(b.step));
  if (!ok) throw bad(file, 'is not a valid heartbeat');
  const ageMs = now().getTime() - Date.parse(b.ts);
  const future = ageMs < -FUTURE_TOLERANCE_MS;
  return Object.freeze({ ...b, ageMs, future, stale: future || ageMs > HEARTBEAT_STALE_MS });
}
