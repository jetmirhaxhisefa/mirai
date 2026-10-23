import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { PLAN } from '../config/config-schema.js';
import { PRESETS, STEPS } from '../config/defaults.js';
import { validate } from '../config/schema.js';
import { RUN } from '../status/machines.js';
import { appendLine, checkPrivateDir, ensurePrivateDir, jsonLine, lastJsonLine, readJsonLines, readPrivateFile } from './files.js';

// The run log (unit 05b; 03 "Run log"): one file per run, `store/runs/<run-id>.jsonl`, written
// only by the orchestrator. Every line carries `{ schema_version, run_id, seq, ts, item, by,
// event }`, with `seq` from the store-wide counter (journal.js `withSeq`), and the metric fields
// from day one. It lives only in the store and is never committed (U3, Q9).
// This file imports nothing from the journal, so the journal can write run lines in one step.

export const RUN_LOG_SCHEMA_VERSION = 1;
export const RUN_ID = /^r-\d{8}-\d{6}-[0-9a-f]{4}$/;
const ITEM = /^[A-Za-z0-9][A-Za-z0-9._/@-]{0,127}$/;
const HEX64 = /^[0-9a-f]{64}$/;

const count = { type: 'integer', min: 0 };
const text = { type: 'string', pattern: /\S/, patternHint: 'some text' };
const name = { type: 'string', pattern: /^[a-z0-9][a-z0-9-]{0,63}$/, patternHint: 'a lower-case name' };
// Percent of the weekly usage limit (D-57).
const share = { type: 'number', min: 0, max: 100 };
// A file inside the store: relative, no `..`, no backslashes.
const storeRef = {
  type: 'string',
  pattern: /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,256}$/,
  patternHint: 'a path inside the store, such as "tickets/T-12/review-r1.md"',
};

// The run-log event types, fixed in code (a test pins the list).
export const RUN_EVENTS = Object.freeze({
  run_started: { preset: { type: 'enum', values: Object.keys(PRESETS) }, plan: { type: 'string', pattern: PLAN, patternHint: 'a plan name such as "max-20x"' } },
  run_state: { from: { type: 'enum', values: RUN.states }, to: { type: 'enum', values: RUN.states } },
  // One agent launch, written when it ends (its numbers are end-of-launch numbers).
  agent_run: {
    launch_id: { type: 'string', pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, patternHint: 'a launch id' },
    step: { type: 'enum', values: STEPS },
    role: name,
    round: count,
    // The verifier rung (D-14), for verifier launches.
    rung: { type: 'integer', min: 1, max: 3 },
    tier: { type: 'enum', values: ['light', 'standard', 'deep'] },
    // Any model may be on any tier (D-58), so it isn't checked against a list.
    model: { type: 'string', pattern: /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/, patternHint: 'a model id' },
    tokens_in: count,
    tokens_out: count,
    turns: count,
    minutes: { type: 'number', min: 0 },
    // Measured from the launch, entered by hand from /status (D-38), or unknown (then absent).
    limit_share: share,
    limit_share_source: { type: 'enum', values: ['measured', 'manual', 'unknown'] },
    // The dollar estimate (03 "Agent launcher"): optional, because a subscription run may not
    // report one.
    cost_usd: { type: 'number', min: 0 },
    verdict: { type: 'enum', values: ['pass', 'fail', 'blocked', 'needs-human', 'error'] },
  },
  checks: {
    // The setting (auto/on/off) and what it resolved to for this ticket (D-23).
    tdd: { type: 'enum', values: ['auto', 'first', 'after'] },
    tdd_applied: { type: 'enum', values: ['first', 'after'] },
    tests_policy: { type: 'enum', values: ['required', 'optional'] },
    tests: { type: 'table', fields: { passed: count, failed: count, skipped: count }, required: ['passed', 'failed', 'skipped'] },
    named: {
      type: 'array',
      items: { type: 'table', fields: { name, result: { type: 'enum', values: ['pass', 'fail', 'skip'] } }, required: ['name', 'result'] },
      uniqueBy: 'name',
    },
  },
  // The structured part of a review finding, kept (D-46); its text is a store file (Q9).
  finding: {
    id: { type: 'string', pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, patternHint: 'a finding id' },
    round: count,
    severity: { type: 'enum', values: ['blocking', 'should-fix', 'nit'] },
    category: name,
    // Downgraded from blocking because it couldn't be resolved against its basis (L1).
    downgraded: { type: 'boolean' },
    line: { type: 'integer', min: 1 },
    // What the finding rests on (the spec, an AC, a rule): part of its fingerprint (L4).
    basis_ref: { type: 'string', pattern: /^[A-Za-z0-9][A-Za-z0-9._/#:@-]{0,255}$/, patternHint: 'a reference such as "AC-12.3" or "docs/prd.md#scope"' },
    file: { type: 'string', pattern: /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\u0000-\u001f\u007f\\]{1,512}$/, patternHint: 'a relative path in the repo, without ..' },
    symbol: text,
    fingerprint: { type: 'string', pattern: HEX64, patternHint: 'a SHA-256 in hex' },
    // Bulky text lives in a store file; the line only points at it (Q9).
    text_ref: { type: 'table', fields: { ref: storeRef, sha256: { type: 'string', pattern: HEX64 } }, required: ['ref', 'sha256'] },
  },
  // What became of a finding, later in the ticket.
  finding_outcome: {
    id: { type: 'string', pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, patternHint: 'a finding id' },
    outcome: { type: 'enum', values: ['fixed', 'disputed'] },
  },
  template_gap: { template: text, section: text, message: text },
  // The run's whole share. (The usage ledger holds the same total as deltas: global.js.)
  run_finished: { tickets_done: count, tickets_parked: count, limit_share: share },
});
const OPTIONAL = {
  finding: ['symbol', 'line', 'basis_ref', 'downgraded'],
  agent_run: ['rung', 'cost_usd', 'limit_share'],
};
// Rules across fields, per event.
const CHECKS = {
  agent_run(line, report) {
    const unknown = line.limit_share_source === 'unknown';
    if (unknown && line.limit_share !== undefined) report('limit_share', 'limit_share is left out when its source is unknown');
    if (!unknown && line.limit_share === undefined) report('limit_share', 'limit_share is required unless its source is unknown');
  },
};

export function runLogPath(store, runId) {
  if (typeof runId !== 'string' || !RUN_ID.test(runId)) throw new TypeError('not a run id');
  return join(store.dir, 'runs', `${runId}.jsonl`);
}

function lineProblems(line) {
  const fields = RUN_EVENTS[line.event];
  if (!fields) return [`unknown run-log event ${JSON.stringify(String(line.event)).slice(0, 40)}`];
  const node = {
    type: 'table',
    fields: {
      schema_version: { type: 'integer', min: 1, max: RUN_LOG_SCHEMA_VERSION },
      run_id: { type: 'string', pattern: RUN_ID },
      seq: { type: 'integer', min: 1 },
      ts: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/ },
      item: { type: 'string', pattern: ITEM, patternHint: 'a ticket, a document or "run"' },
      by: { type: 'enum', values: ['script'] },
      event: { type: 'enum', values: Object.keys(RUN_EVENTS) },
      ...fields,
    },
    required: ['schema_version', 'run_id', 'seq', 'ts', 'item', 'by', 'event',
      ...Object.keys(fields).filter((k) => !(OPTIONAL[line.event] ?? []).includes(k))],
    check: CHECKS[line.event] ? (value, _path, report) => CHECKS[line.event](value, (key, reason) => report(key, reason)) : undefined,
  };
  const at = { source: 'run log', line: 1, column: 1 };
  return validate(line, node, () => at).map((p) => p.reason);
}

// Builds and checks a line, without writing it: `{ item, event, ...fields }`. Throws a
// TypeError naming the problems (a RangeError when too long). Callers check a line with it
// before taking its number, so a bad line never uses one up.
export function buildRunLine(runId, seq, line) {
  const { schema_version: _v, run_id: _r, seq: _s, ts: _t, by: _b, ...rest } = line;
  const full = { schema_version: RUN_LOG_SCHEMA_VERSION, run_id: runId, seq, ts: new Date().toISOString(), by: 'script', ...rest };
  const problems = lineProblems(full);
  if (problems.length > 0) throw new TypeError(`run-log line ${String(line.event)}: ${problems.join('; ')}`);
  return jsonLine(full); // also checks the 16 KB line and 4096-character string limits
}

// Appends a checked line. The caller holds the journal lock (journal.js `withSeq`).
export function appendRunLineRaw(store, runId, seq, line) {
  const text = buildRunLine(runId, seq, line);
  ensurePrivateDir(join(store.dir, 'runs'));
  appendLine(runLogPath(store, runId), text);
}

// Reads a run log, checked. A torn last line is skipped and counted; a broken or out-of-order
// line in the middle fails closed.
export function readRunLog(store, runId) {
  const path = runLogPath(store, runId);
  const { entries, torn } = readJsonLines(path, { optional: true });
  let last = 0;
  const lines = entries.map(({ line, value }) => {
    if (value.schema_version > RUN_LOG_SCHEMA_VERSION) {
      throw new StoreError(`${path}:${line}: written by a newer MIRAI`, { path, line, code: 'version', hint: 'update MIRAI before using this store' });
    }
    const problems = lineProblems(value);
    if (problems.length > 0 || value.run_id !== runId) {
      throw new StoreError(`${path}:${line}: not a valid run-log line (${problems[0] ?? 'another run\'s id'})`, { path, line, code: 'corrupt-line', hint: 'run: mirai doctor' });
    }
    if (value.seq <= last) {
      throw new StoreError(`${path}:${line}: seq ${value.seq} is not after ${last}`, { path, line, code: 'order', hint: 'run: mirai doctor' });
    }
    last = value.seq;
    return Object.freeze(value);
  });
  return { lines, torn };
}

// The run ids that have a log, sorted (ids start with their UTC time, so last is newest).
export function runIds(store) {
  const dir = join(store.dir, 'runs');
  if (!checkPrivateDir(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)).filter((id) => RUN_ID.test(id)).sort();
}

// The highest seq at the end of the newest run logs: the run named in state.json, and the one
// whose id sorts last (in case state.json is gone). For the counter check (05a review note).
export function newestRunLogSeq(store) {
  const ids = new Set();
  const sorted = runIds(store);
  if (sorted.length > 0) ids.add(sorted[sorted.length - 1]);
  const state = readPrivateFile(join(store.dir, 'state.json'), { maxBytes: 16 * 1024, optional: true });
  if (state !== null) {
    try {
      const id = JSON.parse(state).run_id;
      if (typeof id === 'string' && RUN_ID.test(id) && sorted.includes(id)) ids.add(id);
    } catch {
      // a broken state.json is reported by readRunState; here it only can't name a run
    }
  }
  let highest = 0;
  for (const id of ids) {
    const last = lastJsonLine(runLogPath(store, id));
    if (Number.isSafeInteger(last?.seq) && last.seq > highest) highest = last.seq;
  }
  return highest;
}
