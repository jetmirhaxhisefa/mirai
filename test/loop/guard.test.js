import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterRound, beforeLaunch, countingFindings, grantRounds, parkLoop, readLoop, recordFault, settleLaunch } from '../../src/loop/guard.js';
import { parkingNote, parkTicket } from '../../src/loop/park.js';
import { latestWeekly, rateLimits, recordReadings, usageCheck, usageLimit } from '../../src/loop/ledger.js';
import { findingFingerprint } from '../../src/findings/findings.js';
import { appendUsage } from '../../src/store/global.js';
import { openStore } from '../../src/store/home.js';
import { readTicketStatus, writeTicketStatus } from '../../src/store/tickets.js';
import { installed, tempDir } from '../tests/run-fixture.js';

// Unit 20: the loop guard, the budget ledger and the usage check. No model.

const store = () => {
  const f = installed();
  return { f, store: openStore({ cwd: f.root, env: f.env }) };
};
const finding = (file, symbol, ref, severity = 'blocking') => ({ file, symbol, severity, basis: { kind: 'ac', ref } });
const caps = { night_max: 15, week_max: 60, reserve: 40, ticket_estimate: 2 };
const RUN = 'r-20261102-000000-abcd';
const REPO = 'local-0123456789ab';

test('T1: rounds run out at 2, or 3 for high risk; a session launch uses none; a fault or a usage limit gives its round back', () => {
  const { store: s } = store();
  assert.equal(beforeLaunch(s, 'T-1', { round: false }).go, true, 'the developer\'s own session');
  const a = beforeLaunch(s, 'T-1', { round: true });
  settleLaunch(s, 'T-1', { launch: a.launch, outcome: 'env-fault', refundable: true });
  const b = beforeLaunch(s, 'T-1', { round: true });
  assert.equal(settleLaunch(s, 'T-1', { launch: b.launch, outcome: 'usage-limit', refundable: true }).refunded, true);
  const c = beforeLaunch(s, 'T-1', { round: true });
  assert.equal(settleLaunch(s, 'T-1', { launch: c.launch, outcome: 'env-fault', refundable: false }).refunded, false, 'a fault in what the agent did keeps its round');
  assert.equal(settleLaunch(s, 'T-1', { launch: c.launch, outcome: 'env-fault', refundable: true }).ignored, true, 'settled once');
  assert.equal(readLoop(s, 'T-1').rounds_used, 1, 'only the last one used a round');
  for (let i = 0; i < 1; i++) {
    const l = beforeLaunch(s, 'T-1', { round: true });
    settleLaunch(s, 'T-1', { launch: l.launch, outcome: 'ok' });
  }
  const third = beforeLaunch(s, 'T-1', { round: true });
  assert.deepEqual([third.go, third.park.reason], [false, 'cap']);
  assert.deepEqual(third.park.evidence, ['loop/T-1.json']);
  for (let i = 0; i < 3; i++) assert.equal(beforeLaunch(s, 'T-2', { round: true, risk: 'high' }).go, true);
  assert.equal(beforeLaunch(s, 'T-2', { round: true, risk: 'high' }).go, false);
  // A crash: no settle, the round stays used.
  beforeLaunch(s, 'T-8', { round: true });
  assert.equal(readLoop(s, 'T-8').rounds_used, 1);
});

test('T2: the same finding or failure in a later round routes to re-plan (the status\'s one), then parks', () => {
  const { store: s } = store();
  writeTicketStatus(s, { ticket: 'T-3', state: 'in-progress' });
  const f1 = finding('src/a.js', 'save', 'AC-T-3.1');
  assert.equal(afterRound(s, 'T-3', { round: 1, findings: [f1] }).next, 'fix');
  assert.equal(afterRound(s, 'T-3', { round: 2, findings: [f1], delta: ['src/b.js'] }).next, 'replan', 'a repeat outside the delta still counts');
  // The caller moves the ticket back to planning; its status keeps the count.
  // A status write that drops the count can't give a second re-plan: the guard keeps its own.
  writeTicketStatus(s, { ticket: 'T-3', state: 'in-review' }, { expectSeq: readTicketStatus(s, 'T-3').status.seq });
  assert.equal(afterRound(s, 'T-3', { round: 3, findings: [f1] }).next, 'park');
  assert.equal(readLoop(s, 'T-3').parked.reason, 'repeat');
  const fail = { test: 'a.test.js::x', message: 'expected 4, got 0 at 12:01:33' };
  assert.equal(afterRound(s, 'T-4', { round: 1, failures: [fail] }).next, 'fix');
  assert.equal(afterRound(s, 'T-4', { round: 2, failures: [{ ...fail, message: 'expected 4, got 0 at 12:09:01' }] }).next, 'replan', 'a time in the message doesn\'t hide a repeat');
});

test('T3: a count that doesn\'t drop parks; churn parks; disputed findings are left out', () => {
  const { store: s } = store();
  assert.equal(afterRound(s, 'T-5', { round: 1, findings: [finding('a', 'x', 'AC-T-5.1'), finding('b', 'y', 'AC-T-5.2')] }).next, 'fix');
  const r = afterRound(s, 'T-5', { round: 2, findings: [finding('c', 'z', 'AC-T-5.3'), finding('d', 'w', 'AC-T-5.4')], delta: ['c', 'd'] });
  assert.deepEqual([r.next, r.reason], ['park', 'no-progress']);
  assert.equal(afterRound(s, 'T-6', { round: 1, findings: [finding('a', 'x', 'AC-T-6.1'), finding('b', 'y', 'AC-T-6.2')], blobs: { 'src/a.js': 'h1' } }).next, 'fix');
  assert.equal(afterRound(s, 'T-6', { round: 2, findings: [finding('e', 'q', 'AC-T-6.3')], blobs: { 'src/a.js': 'h2' }, delta: ['e'] }).next, 'fix');
  const churn = afterRound(s, 'T-6', { round: 3, failures: [{ test: 't', message: 'm' }], blobs: { './src/a.js': 'h1' } });
  assert.match(churn.why, /earlier version: src\/a\.js/);
  const d = finding('z', 'z', 'AC-T-7.1');
  assert.equal(afterRound(s, 'T-7', { round: 1, findings: [d], disputed: [findingFingerprint(d)] }).next, 'done', 'disputed goes to your inbox, not the count (L3)');
});

test('T4: L2: from round 2 a new finding counts only if blocking and on the delta; a known one always counts; duplicates once', () => {
  const fs = [finding('a.js', 'x', 'AC-1.1', 'non-blocking'), finding('b.js', 'y', 'AC-1.2'), finding('c.js', 'z', 'AC-1.3'), finding('b.js', 'y', 'AC-1.2')];
  assert.equal(countingFindings(fs, { round: 1 }).length, 3);
  assert.deepEqual(countingFindings(fs, { round: 2, delta: ['./b.js'] }).map((f) => f.file), ['b.js']);
  assert.deepEqual(countingFindings(fs, { round: 2, delta: [], seen: { [findingFingerprint(fs[2])]: 1 } }).map((f) => f.file), ['c.js'], 'an unfixed one isn\'t dropped');
});

test('T5: counters only go up; a hand-edited or broken file refuses; a replayed round refuses; only you grant rounds', () => {
  const { store: s } = store();
  const l = beforeLaunch(s, 'T-9', { round: true });
  settleLaunch(s, 'T-9', { launch: l.launch, outcome: 'ok', line: { turns: 5, tokens_in: 10, tokens_out: 3, tokens_cached: 100, minutes: 1.5, limit_share: 1 } });
  settleLaunch(s, 'T-9', { launch: 99, outcome: 'ok', line: { turns: -9, minutes: Number.NaN } });
  assert.deepEqual(readLoop(s, 'T-9').budget, { turns: 5, tokens: 13, tokens_cached: 100, minutes: 1.5, cost_usd: 0, limit_share: 1 });
  afterRound(s, 'T-9', { round: 1, findings: [finding('a', 'b', 'AC-9.1')] });
  assert.throws(() => afterRound(s, 'T-9', { round: 1, findings: [] }), (e) => e.code === 'round-replayed');
  assert.throws(() => afterRound(s, 'T-9', { findings: [] }), (e) => e.code === 'round-replayed', 'the round is required');
  const file = join(s.dir, 'loop', 'T-9.json');
  const good = JSON.parse(String(readLoop(s, 'T-9') && JSON.stringify(readLoop(s, 'T-9'))));
  writeFileSync(file, JSON.stringify({ ...good, rounds_used: -50 }));
  assert.throws(() => beforeLaunch(s, 'T-9', { round: true }), (e) => e.code === 'loop-unreadable');
  writeFileSync(file, JSON.stringify({ ...good, round_open: 'x' }));
  assert.throws(() => readLoop(s, 'T-9'), (e) => e.code === 'loop-unreadable');
  writeFileSync(file, JSON.stringify(good));
  parkLoop(s, 'T-9', { reason: 'cap', why: 'x' });
  assert.throws(() => grantRounds(s, 'T-9', { rounds: 10, proof: 1 }), (e) => e.code === 'no-grant-proof', 'no signed move of yours, no rounds');
  assert.equal(readLoop(s, 'T-9').granted, 0);
});

test('T6: the usage check stops before a cap and names it; anything it can\'t tell refuses unattended and warns in a terminal', () => {
  const { f } = store();
  const env = f.env;
  assert.equal(usageCheck({ env, caps }).cap, 'unknown');
  assert.equal(usageCheck({ env, caps, unattended: false }).go, true);
  const resets = Math.floor(Date.now() / 1000) + 3 * 86_400;
  recordReadings(env, [{ window: 'seven_day', utilization: 0.2, resets_at: resets, status: 'allowed' }], { repoId: REPO, runId: RUN });
  assert.equal(usageCheck({ env, caps }).go, true);
  appendUsage(env, { repoId: REPO, runId: RUN, limitShare: 14, kind: 'run', uptoSeq: 1 });
  const night = usageCheck({ env, caps });
  assert.deepEqual([night.go, night.cap], [false, 'night_max']);
  assert.match(night.why, /MIRAI's 14% in the last 12 hours with about 2%/);
  assert.equal(usageCheck({ env, caps: { ...caps, night_max: 100, reserve: 79 } }).cap, 'reserve');
  appendUsage(env, { repoId: REPO, runId: RUN, limitShare: 45, kind: 'run', uptoSeq: 2 });
  assert.equal(usageCheck({ env, caps: { ...caps, night_max: 100, reserve: 0 } }).cap, 'week_max');
  assert.equal(usageCheck({ env, caps: { error: 'line 3: bad' } }).cap, 'unknown', 'broken caps aren\'t swapped for defaults');
  // A reading whose week has reset is out of date.
  recordReadings(env, [{ window: 'seven_day', utilization: 0.1, resets_at: Math.floor(Date.now() / 1000) - 60, status: 'allowed' }], { repoId: REPO, runId: RUN });
  const old = usageCheck({ env, caps });
  assert.deepEqual([old.cap, old.probe], ['stale', true], 'a tiny launch refreshes it (unit 28)');
  assert.equal(latestWeekly(env).utilization, 0.1);
});

test('T7: rate_limit_event readings; only "rejected" is a limit', () => {
  const ok = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 1793865600, rateLimitType: 'seven_day', unifiedWindows: { seven_day: { utilization: 0.11, resetsAt: 1793865600, status: 'allowed' } } } });
  assert.deepEqual(rateLimits(`x\n${ok}\nnot json rate_limit_event\n`), [{ window: 'seven_day', utilization: 0.11, resets_at: 1793865600, status: 'allowed' }]);
  const hit = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1793800000, rateLimitType: 'five_hour', unifiedWindows: {} } });
  assert.equal(usageLimit(rateLimits(hit)).window, 'five_hour');
  const warn = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: 1793800000, rateLimitType: 'five_hour', unifiedWindows: { five_hour: { utilization: 0.95, status: 'allowed_warning' } } } });
  assert.equal(usageLimit(rateLimits(warn)), null, 'a warning is no limit');
  assert.deepEqual(rateLimits('{"type":"rate_limit_event","rate_limit_info":{"unifiedWindows":{"x;rm":{"utilization":9}}}}'), []);
});

test('T8: the circuit breaker trips after N faults in a row, resets on a success, and an unreadable file trips it', () => {
  const { store: s } = store();
  assert.equal(recordFault(s, RUN, { fault: true }).trip, false);
  assert.equal(recordFault(s, RUN, { fault: true }).trip, false);
  assert.equal(recordFault(s, RUN, { fault: false }).count, 0);
  for (let i = 0; i < 2; i++) recordFault(s, RUN, { fault: true });
  assert.equal(recordFault(s, RUN, { fault: true }).trip, true);
  writeFileSync(join(s.dir, 'loop', 'breakers', 'r-20261102-000000-ffff.json'), 'nope');
  assert.throws(() => recordFault(s, '../../escaped', { fault: true }));
  assert.equal(recordFault(s, 'r-20261102-000000-ffff', { fault: true }).trip, true);
});

test('T9: parking notes name the reason and evidence, escape what they quote; parking keeps the re-plan count and can be retried', () => {
  const { store: s } = store();
  const note = parkingNote({ reason: 'scope', why: 'src/x.js\u001b[2J', evidence: ['agent-runs/2026.scope.json'] });
  assert.match(note, /changed files its role may not/);
  assert.match(note, /agent-runs\/2026\.scope\.json/);
  assert.doesNotMatch(note, /\u001b/);
  writeTicketStatus(s, { ticket: 'T-9', state: 'in-progress', replans: 1 });
  parkLoop(s, 'T-9', { reason: 'scope', why: 'x', evidence: ['e'] });
  parkTicket(s, 'T-9', readLoop(s, 'T-9').parked);
  parkTicket(s, 'T-9', readLoop(s, 'T-9').parked);
  const st = readTicketStatus(s, 'T-9').status;
  assert.deepEqual([st.state, st.park_reason, st.replans], ['blocked', 'scope', 1]);
});

test('T10: a launch logs a measured share from its own stream, and a usage limit only on a run that didn\'t succeed', async () => {
  const { runAgent } = await import('../../src/agent/run.js');
  const { mintLaunchToken } = await import('../../src/agent/requests.js');
  const { createKeyPair, writePublicKeyFile } = await import('../../src/sign/keys.js');
  const { writeToken } = await import('../../src/sign/token.js');
  const f = installed();
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  writeToken(f.env, `sk-ant-oat01-${'Ag3_-k'.repeat(16)}`);
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  const ev = (u, status = 'allowed') => JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status, resetsAt: Math.floor(Date.now() / 1000) + 86_400, rateLimitType: 'seven_day', unifiedWindows: { seven_day: { utilization: u, resetsAt: Math.floor(Date.now() / 1000) + 86_400, status } } } });
  const claude = (lines) => {
    const p = join(realpathSync(tempDir()), 'claude');
    writeFileSync(p, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.316 (Claude Code)"; exit 0; fi\n${lines.map((l) => `echo '${l}'`).join('\n')}\n`, { mode: 0o755 });
    return p;
  };
  const INIT = '{"type":"system","subtype":"init","permissionMode":"dontAsk"}';
  const OK = '{"type":"result","subtype":"success","is_error":false,"result":"done","num_turns":1}';
  const run = (lines) => runAgent({ launchToken: mintLaunchToken(), cwd: f.root, env: f.env, role: 'reviewer', prompt: 'x', claude: claude(lines), status: async () => ({ state: 'green', blocker_seen: null, changed: [] }), check: () => [] });
  const measured = await run([INIT, ev(0.21), ev(0.24), OK]);
  assert.deepEqual([measured.line.limit_share_source, measured.line.limit_share], ['measured', 3]);
  const warned = await run([INIT, ev(0.24, 'rejected'), OK]);
  assert.equal(warned.outcome, 'ok', 'a run that succeeded stays ok');
  const stopped = await run([INIT, ev(0.24, 'rejected'), '{"type":"result","subtype":"error_during_execution","is_error":true}']);
  assert.deepEqual([stopped.outcome, stopped.line.limit_window], ['usage-limit', 'seven_day']);
});

test('review: your signed unpark gives rounds once; the move\'s proof can\'t be reused', async () => {
  const { createKeyPair, writePublicKeyFile } = await import('../../src/sign/keys.js');
  const { loadSigner } = await import('../../src/sign/signer.js');
  const { signHumanMove } = await import('../../src/store/tickets.js');
  const f = installed();
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  const s = openStore({ cwd: f.root, env: f.env });
  writeTicketStatus(s, { ticket: 'T-11', state: 'in-progress' });
  parkLoop(s, 'T-11', { reason: 'cap', why: 'rounds used' });
  parkTicket(s, 'T-11', readLoop(s, 'T-11').parked);
  const seq = signHumanMove(s, loadSigner(f.env, s), { ticket: 'T-11', state: 'in-progress', note: 'one more try' }, { expectSeq: readTicketStatus(s, 'T-11').status.seq, move: { choice: 'retry', note: 'one more try' } });
  grantRounds(s, 'T-11', { rounds: 1, note: 'one more try', proof: seq });
  const after = readLoop(s, 'T-11');
  assert.deepEqual([after.parked, after.granted, after.grants[0].proof], [null, 1, seq]);
  assert.throws(() => grantRounds(s, 'T-11', { rounds: 5, proof: seq }), (e) => e.code === 'grant-used');
});
