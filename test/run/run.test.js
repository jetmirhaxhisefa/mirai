import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { runBuild } from '../../src/agent/build.js';
import { runFix } from '../../src/agent/fix.js';
import { writeBaseline } from '../../src/baseline/store.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { recordProofs } from '../../src/proofs/record.js';
import { afterStep, driveTicket, nextStep, STEPS, stayAwake } from '../../src/run/drive.js';
import { nextClock, waitForReset } from '../../src/run/pause.js';
import { showData, showText } from '../../src/run/show.js';
import { loadSigner } from '../../src/sign/signer.js';
import { branchKeys } from '../../src/sign/keys.js';
import { commitOf, symbolicBranch } from '../../src/store/git.js';
import { openStore } from '../../src/store/home.js';
import { appendEvent, readJournal } from '../../src/store/journal.js';
import { readLoop } from '../../src/loop/guard.js';
import { readRunLog } from '../../src/store/run-log.js';
import { readRunState, recordProgress, startRun, writeRunState } from '../../src/store/run.js';
import { readTicketStatus } from '../../src/store/tickets.js';
import { snapshot, trustedConfig } from '../../src/trust/snapshot.js';
import { approvedTicket, claudeWith, done, PASSED, passed, passing, PLAN_TEXT, tty, watch } from '../proofs/fixture.js';
import { buildRecordPath } from '../../src/agent/build.js';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installHooks } from '../../src/hooks/install.js';

// Unit 28: `mirai run`, supervised, one ticket. The real steps with a stand-in claude and test
// run; stand-ins only for the baseline refresh, the host (ship) and the usage probe.

const MR_URL = 'https://github.com/acme/app/pull/7';
// MIRAI's ship as far as the journal knows it: the push with its proofs, the MR.
async function fakeShip({ cwd, env, ticket }) {
  const store = openStore({ cwd, env });
  const branch = JSON.parse(readFileSync(buildRecordPath(store, ticket), 'utf8')).branch;
  const head = commitOf(store.checkout, `refs/heads/${branch}`, store.gitEnv);
  appendEvent(store, { type: 'pushed', by: 'script', ticket, branch, sha: head, proofs: 'pass' });
  appendEvent(store, { type: 'mr_opened', by: 'script', ticket, head, target: 'main', number: 7, url: MR_URL });
  return { ticket, outcome: 'opened', mr: { number: 7, url: MR_URL }, head, pushed: true, branch };
}
const awake = () => {
  const s = { started: 0, stopped: 0 };
  return { s, fn: () => { s.started++; return { stop: () => { s.stopped++; }, note: null }; } };
};
const steps = (extra = {}) => ({
  ...STEPS,
  probeUsage: async () => ({ outcome: 'ok' }),
  recordBaseline: async () => ({ baseline: { complete: true }, reused: true }),
  runBuild: (o) => runBuild({ ...o, testRun: passing }),
  runFix: (o) => runFix({ ...o, testRun: passing }),
  recordProofs: (o) => recordProofs({ ...o, run: passing }),
  shipTicket: fakeShip,
  ...extra,
});
const baselineFor = (f) => {
  const store = openStore(f.io);
  writeBaseline(store, { schema_version: 1, sha: snapshot(f.io).baseSha, levels: { unit: PASSED, feature: PASSED } }, loadSigner(f.env, store));
};
const drive = (f, o = {}) => driveTicket({ cwd: f.root, env: f.env, ticket: 'PMT-31', caffeinate: o.caffeinate ?? awake().fn, steps: o.steps ?? steps(), launchOptions: o.launchOptions ?? {}, ...o.extra });

test('28: one ticket to its MR: the run stops at the plan gate; after your approval it builds, reviews, signs the proofs and opens the MR under one lock; again, it changes nothing', async () => {
  const f = await approvedTicket();
  const a = awake();
  const r1 = await drive(f, { caffeinate: a.fn, launchOptions: watch(claudeWith([{ plan: PLAN_TEXT }])) });
  assert.equal(r1.outcome, 'stopped');
  assert.equal(r1.stop.kind, 'gate-plan');
  assert.match(r1.stop.next, /mirai approve PMT-31 --plan/);
  assert.deepEqual(r1.steps.map((s) => [s.step, s.outcome]), [['plan', 'waiting']]);
  const store = openStore(f.io);
  assert.equal(readRunState(store).state, 'stopped');
  assert.deepEqual([a.s.started, a.s.stopped], [1, 1], 'caffeinate for the run, ended with it');
  // The gate is yours: the run never approves.
  assert.equal(readTicketStatus(store, 'PMT-31').status.state, 'in-progress');
  const again = await drive(f);
  assert.equal(again.stop.kind, 'gate-plan', 'still waiting, nothing launched');
  assert.deepEqual(again.steps, []);

  assert.equal((await tty(['approve', 'PMT-31', '--plan'], f.io, ['a', 'PMT-31'])).code, EXIT.OK);
  baselineFor(f);
  const events = [];
  const claude = claudeWith([done, { verdict: 'pass', findings: [] }], ['printf "// renamed\\n" >> app/Team.php']);
  const r2 = await drive(f, { launchOptions: watch(claude), extra: { onEvent: (e) => events.push(e) } });
  assert.equal(r2.outcome, 'finished', JSON.stringify(r2.stop));
  assert.deepEqual(r2.steps.map((s) => [s.step, s.outcome]), [['build', 'handed-over'], ['review', 'pass'], ['proofs', 'recorded'], ['ship', 'opened']]);
  assert.equal(r2.mr, MR_URL);
  assert.ok(events.some((e) => e.type === 'step' && e.step === 'baseline'), 'the baseline before the build');
  // One run for every step: its id on each launch line, and the run finished.
  const log = readRunLog(store, r2.runId).lines;
  assert.equal(log.filter((l) => l.event === 'run_started').length, 1);
  assert.equal(log.filter((l) => l.event === 'agent_run').length, 2);
  assert.ok(log.some((l) => l.event === 'run_finished' && l.tickets_done === 1));
  assert.equal(readRunState(store).state, 'finished');
  assert.equal(symbolicBranch(store.checkout, 'HEAD', store.gitEnv), snapshot(f.io).branch, 'back on the integration branch');

  const r3 = await drive(f);
  assert.equal(r3.outcome, 'finished');
  assert.deepEqual(r3.steps, [], 'built: nothing to do');
  assert.equal(r3.mr, MR_URL);
});

test('28: from your session the run stops before the proofs, with the terminal command; the terminal then signs and ships', async () => {
  const f = await passed();
  const s = await drive(f, { extra: { via: 'session' } });
  assert.equal(s.outcome, 'stopped');
  assert.equal(s.stop.kind, 'gate-proofs');
  assert.match(s.stop.next, /in your terminal: mirai gate record PMT-31; then \/mirai run PMT-31/);
  assert.deepEqual(s.steps, [], 'nothing signed');
  const t = await drive(f);
  assert.deepEqual(t.steps.map((x) => [x.step, x.outcome]), [['proofs', 'recorded'], ['ship', 'opened']]);
});

test('28: the next step is read from the ticket: review, proofs, ship; refused states; a park stops with the unpark command', async () => {
  const f = await passed({ reviewed: false });
  const store = openStore(f.io);
  const ctx = () => {
    const trust = snapshot(f.io);
    return { store, ticket: 'PMT-31', trust, config: trustedConfig(trust), keys: branchKeys(store.checkout, store.branch, store.gitEnv) };
  };
  assert.equal(nextStep(ctx()).step, 'review');
  const g = await passed();
  const gs = openStore(g.io);
  const gctx = () => {
    const trust = snapshot(g.io);
    return { store: gs, ticket: 'PMT-31', trust, config: trustedConfig(trust), keys: branchKeys(gs.checkout, gs.branch, gs.gitEnv) };
  };
  assert.equal(nextStep(gctx()).step, 'proofs');
  assert.equal((await g.record()).outcome, 'recorded');
  assert.equal(nextStep(gctx()).step, 'ship');
  // An unknown ticket, and the states a run refuses.
  assert.throws(() => nextStep({ ...gctx(), ticket: 'PMT-99' }), (e) => e.code === 'unknown-ticket');
  // The outcome words: what goes on and what stops.
  assert.deepEqual(afterStep('build', { outcome: 'checks-failed' }, 'T-1'), { go: true });
  assert.deepEqual(afterStep('review', { outcome: 'changes' }, 'T-1'), { go: true });
  assert.deepEqual(afterStep('fix', { outcome: 'replan' }, 'T-1'), { go: true });
  assert.deepEqual(afterStep('build', { outcome: 'env-fault' }, 'T-1'), { go: true }, 'a fault runs the step again; the breaker stops the run');
  assert.equal(afterStep('build', { outcome: 'needs-you', why: 'a protected path' }, 'T-1').stop.kind, 'needs-you');
  assert.equal(afterStep('fix', { outcome: 'parked' }, 'T-1').stop.kind, 'parked');
  assert.match(afterStep('fix', { outcome: 'parked' }, 'T-1').stop.next, /mirai unpark T-1 --retry$/);
  assert.match(afterStep('plan', { outcome: 'bad-plan' }, 'T-1').stop.next, /mirai unpark T-1 --retry$/);
  assert.equal(afterStep('build', { outcome: 'killed' }, 'T-1').stop.kind, 'interrupted');
  assert.deepEqual(afterStep('plan', { outcome: 'usage-limit' }, 'T-1'), { limit: true });
  assert.equal(afterStep('ship', { outcome: 'unchanged' }, 'T-1').shipped, true);
});

test('28: the breaker stops the run after loop.breaker environment faults in a row; a good launch in between resets it', async () => {
  const f = await passed({ reviewed: false });
  // An agent failure stops on its own; so the good launch's reset is shown with an ok review after it.
  const seq = ['env-fault', 'env-fault', 'pass-ok'];
  let m = 0;
  const flaky = async () => {
    const o = seq[m++];
    if (o === 'pass-ok') return { outcome: 'agent-failed', why: 'stop here', launch: { outcome: 'ok' } };
    return { outcome: 'env-fault', why: 'Docker isn\'t answering', launch: { outcome: 'env-fault', why: 'Docker isn\'t answering' } };
  };
  const r0 = await drive(f, { steps: steps({ runReview: flaky }) });
  assert.equal(r0.stop.kind, 'needs-you', 'two faults then a good launch: no breaker');
  assert.equal(r0.steps.length, 3);
  const r = await drive(f, { steps: steps({ runReview: async () => ({ outcome: 'env-fault', why: 'Docker isn\'t answering', launch: { outcome: 'env-fault', why: 'Docker isn\'t answering' } }) }) });
  assert.equal(r.stop.kind, 'breaker');
  assert.equal(r.steps.length, 3, 'loop.breaker defaults to 3');
  assert.match(r.stop.why, /3 environment faults in a row/);
  assert.equal(readRunState(openStore(f.io)).state, 'stopped');
});

test('28: a 5-hour usage limit pauses and the same step runs again after the reset, no round used; on_limit "stop", max_wait_minutes, stop_by and a weekly limit stop', async () => {
  const f = await passed({ reviewed: false });
  const store = openStore(f.io);
  const reset = new Date('2026-11-12T12:00:00Z');
  let clock = new Date('2026-11-12T10:00:00Z').getTime();
  const now = () => new Date(clock);
  const sleep = async (ms) => { clock += ms; };
  let calls = 0;
  const lines = [];
  const runReview = async () => {
    calls++;
    if (calls === 1) return { outcome: 'usage-limit', why: 'limit', launch: { outcome: 'usage-limit', line: { limit_window: 'five_hour', resets_at: reset.toISOString() } } };
    return { outcome: 'agent-failed', why: 'stop here', launch: { outcome: 'ok' } };
  };
  const roundsBefore = readLoop(store, 'PMT-31').rounds_used;
  const r = await drive(f, { steps: steps({ runReview }), extra: { now, sleep, onEvent: (e) => { if (e.line) lines.push(e.line); } } });
  assert.equal(calls, 2, 'the same step again after the reset');
  assert.ok(clock >= reset.getTime() + 60_000, 'waited past the reset, with the grace');
  assert.ok(lines.some((l) => /^paused: usage limit until \d\d:\d\d \(in 2 h \d+ min\)\. Ctrl-C stops; mirai resume continues later$/.test(l)), lines.join('\n'));
  const moves = readRunLog(store, r.runId).lines.filter((l) => l.event === 'run_state').map((l) => `${l.from}>${l.to}`);
  assert.ok(moves.includes('running>paused') && moves.includes('paused>running'), moves.join(' '));
  assert.equal(readLoop(store, 'PMT-31').rounds_used, roundsBefore);

  // The settings that stop instead.
  const line = { limit_window: 'five_hour', resets_at: reset.toISOString() };
  const at = () => new Date('2026-11-12T10:00:00Z');
  startRun(store, { preset: 'supervised' });
  const base = { store, runId: readRunState(store).run_id, ticket: 'PMT-31', step: 'review', line, now: at, sleep: async () => {} };
  assert.match((await waitForReset({ ...base, config: { run: { on_limit: 'stop' } } })).stop.why, /run.on_limit is "stop"/);
  assert.match((await waitForReset({ ...base, config: { run: { max_wait_minutes: 60 } } })).stop.why, /longer than run.max_wait_minutes \(60\)/);
  const stopBy = `${String(new Date('2026-11-12T11:00:00Z').getHours()).padStart(2, '0')}:00`;
  assert.match((await waitForReset({ ...base, config: { run: { stop_by: stopBy } } })).stop.why, /after run.stop_by/);
  assert.match((await waitForReset({ ...base, line: { limit_window: 'seven_day', resets_at: reset.toISOString() }, config: {} })).stop.why, /weekly limit/);
  // Ctrl-C while paused: stopped, resumable.
  const ac = new AbortController();
  ac.abort();
  const stopped = await waitForReset({ ...base, config: {}, signal: ac.signal });
  assert.equal(stopped.stop.kind, 'interrupted');
  assert.equal(readRunState(store).state, 'stopped');
  assert.equal(nextClock('06:30', new Date(2026, 10, 12, 7, 0)).getDate(), 13, 'the next 06:30 after 07:00 is tomorrow');
});

test('28: resume after a crash: the dead run is taken over, your signed move continues the same ticket, rounds unchanged; --abandon; another ticket waits while a run is open', async () => {
  const f = await passed({ reviewed: false });
  const store = openStore(f.io);
  // A run that crashed mid-review: its state still says running, nobody holds the lock.
  startRun(store, { preset: 'supervised' });
  recordProgress(store, { ticket: 'PMT-31', step: 'review' });
  const crashed = readRunState(store).run_id;
  const loopBefore = readLoop(store, 'PMT-31');
  installHooks({ store, env: f.env, node: process.execPath, launcher: fileURLToPath(new globalThis.URL('../../bin/launch.js', import.meta.url)) });
  const io = { ...f.io, runSteps: steps({ runReview: async () => ({ outcome: 'pass', launch: { outcome: 'ok' } }), shipTicket: fakeShip }), caffeinate: awake().fn };
  const res = await tty(['resume'], io);
  assert.match(res.out, new RegExp(`last run: ${crashed}, running \\(its process is gone: it crashed\\)`));
  assert.match(res.out, /note: an earlier run .* had crashed/, `${res.code} ${res.err}`);
  assert.match(res.out, /in progress: PMT-31/);
  const ev = readJournal(store).events.filter((e) => e.type === 'run_resumed');
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].by, ev[0].via, ev[0].run_id], ['human', 'terminal', crashed]);
  assert.ok(ev[0].signature?.key_id, 'signed with your key');
  assert.equal(readRunState(store).run_id, crashed, 'the same run');
  const after = readLoop(store, 'PMT-31');
  assert.deepEqual([after.rounds_used, after.replans_used, after.granted], [loopBefore.rounds_used, loopBefore.replans_used, loopBefore.granted]);

  // A crash that left uncommitted work: the takeover stops the run, the dirty tree refuses, and the
  // run keeps its ticket, so the next `mirai resume` (after mirai discard) continues it (R2).
  const h = await passed({ reviewed: false });
  const hs = openStore(h.io);
  startRun(hs, { preset: 'supervised' });
  recordProgress(hs, { ticket: 'PMT-31', step: 'review' });
  const crashedH = readRunState(hs).run_id;
  installHooks({ store: hs, env: h.env, node: process.execPath, launcher: fileURLToPath(new globalThis.URL('../../bin/launch.js', import.meta.url)) });
  const hio = { ...h.io, runSteps: steps({ runReview: async () => ({ outcome: 'pass', launch: { outcome: 'ok' } }), shipTicket: fakeShip }), caffeinate: awake().fn };
  writeFileSync(join(h.root, 'half-done.txt'), 'a step cut short\n');
  const refused = await tty(['resume'], hio);
  assert.notEqual(refused.code, EXIT.OK);
  assert.match(refused.err, /uncommitted changes/);
  assert.deepEqual([readRunState(hs).state, readRunState(hs).ticket, readRunState(hs).run_id], ['stopped', 'PMT-31', crashedH], 'the taken-over run keeps its ticket');
  rmSync(join(h.root, 'half-done.txt'));
  const again = await tty(['resume'], hio);
  assert.match(again.out, /in progress: PMT-31/, `${again.code} ${again.err}`);
  assert.equal(readJournal(hs).events.filter((e) => e.type === 'run_resumed' && e.run_id === crashedH).length, 1);

  // --abandon: given up, recorded; nothing to resume after.
  const g = await passed({ reviewed: false });
  const gs = openStore(g.io);
  startRun(gs, { preset: 'supervised' });
  writeRunState(gs, 'stopped', { ticket: 'PMT-31' });
  // `mirai run` of another ticket waits for an open stopped run.
  await assert.rejects(driveTicket({ cwd: g.root, env: g.env, ticket: 'PMT-99', caffeinate: awake().fn, steps: steps() }), (e) => e.code === 'run-open' && /mirai resume/.test(e.hint));
  const ab = await tty(['resume', '--abandon'], { ...g.io });
  assert.equal(ab.code, EXIT.OK, ab.out + ab.err);
  assert.match(ab.out, /given up/);
  assert.equal(readRunState(gs).abandoned, true);
  assert.equal(readJournal(gs).events.filter((e) => e.type === 'run_resumed' && e.abandon === true).length, 1);
  assert.notEqual((await tty(['resume'], { ...g.io })).code, EXIT.OK);
});

test('28: mirai show prints the ticket\'s page from the store and writes nothing; --json; --full', async () => {
  const f = await passed();
  const store = openStore(f.io);
  const before = readJournal(store).events.length;
  const d = showData({ cwd: f.root, env: f.env, ticket: 'PMT-31' });
  assert.equal(d.state, 'in-review');
  assert.equal(d.title, 'Renaming a team hides its members');
  assert.equal(d.plan.approved, true);
  assert.equal(d.reviews.length, 1);
  assert.equal(d.reviews[0].outcome, 'pass');
  const text = showText(d);
  for (const re of [/^PMT-31: Renaming a team hides its members\s+in-review/m, /^Plan\s+round 1, approved by you/m, /^Build\s+handed-over/m, /^Review 1\s+PASS/m, /^Rounds\s+0 of 2 used · re-plans 0 of 1$/m, /^Parked\s+—$/m, /^QA\s+not yet \(unit 51\)$/m]) assert.match(text, re);
  const j = await tty(['show', 'PMT-31', '--json'], f.io);
  assert.equal(j.code, EXIT.OK);
  const parsed = JSON.parse(j.out);
  assert.equal(parsed.ticket, 'PMT-31');
  assert.equal(parsed.plan.text, undefined, 'the plan text only with --full');
  const full = await tty(['show', 'PMT-31', '--full'], f.io);
  assert.match(full.out, /--- plan ---/);
  assert.equal(readJournal(store).events.length, before, 'show writes nothing');
  assert.notEqual((await tty(['show', 'PMT-31', '--full', '--json'], f.io)).code, EXIT.OK);
});

test('28: caffeinate watches the run\'s own process and ends with it', () => {
  const seen = [];
  const child = Object.assign(new EventEmitter(), { pid: 4242, unref() {}, kill(sig) { seen.push(['kill', sig]); } });
  const a = stayAwake({ path: '/bin/sh', spawnFn: (path, args) => { seen.push([path, ...args]); return child; } });
  assert.deepEqual(seen[0], ['/bin/sh', '-i', '-w', String(process.pid)]);
  a.stop();
  assert.deepEqual(seen[1], ['kill', 'SIGTERM']);
  assert.match(stayAwake({ path: '/nowhere/caffeinate' }).note, /may sleep/);
});

test('28: a launch\'s progress goes to the run log as a summary: each tool and how often, never each call', async () => {
  const { progressTracker } = await import('../../src/agent/progress.js');
  const t = progressTracker({ root: '/w', tools: ['Read', 'Edit', 'Bash'] });
  const msg = (id, ...names) => ({ type: 'assistant', message: { id, content: names.map((name) => ({ type: 'tool_use', name, input: { file_path: '/w/a.php' } })) } });
  t.seen(msg('m1', 'Read', 'Read'));
  t.seen(msg('m2', 'Edit'));
  t.seen(msg('m3', 'WebFetch'));
  assert.deepEqual(t.toolCalls(), [{ tool: 'Edit', n: 1 }, { tool: 'other', n: 1 }, { tool: 'Read', n: 2 }], 'a tool outside the launch\'s list is "other"; sorted by name');
  const { buildRunLine } = await import('../../src/store/run-log.js');
  assert.doesNotThrow(() => buildRunLine('r-20261112-000000-abcd', 1, { item: 'T-1', event: 'agent_run', launch_id: 'l1', step: 'build', role: 'developer', round: 1, tier: 'standard', model: 'm', tokens_in: 0, tokens_out: 0, turns: 1, minutes: 0, limit_share_source: 'unknown', verdict: 'pass', tool_calls: t.toolCalls() }));
});

test('28: a build killed before its record: the run names mirai discard; discard works from the registered branch; then the run builds again', async () => {
  const f = await passed({ reviewed: false });
  const store = openStore(f.io);
  // As if Kai was killed mid-build: no build record yet, his edit uncommitted, the ticket in progress.
  const { rmSync, appendFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { writeTicketStatus } = await import('../../src/store/tickets.js');
  rmSync(buildRecordPath(store, 'PMT-31'));
  appendFileSync(join(f.root, 'app', 'Team.php'), '// half done\n');
  const cur = readTicketStatus(store, 'PMT-31');
  writeTicketStatus(store, { ticket: 'PMT-31', state: 'in-progress' }, { expectSeq: cur.seq });
  await assert.rejects(drive(f), (e) => e.code === 'dirty-tree' && /mirai discard PMT-31; then mirai resume/.test(e.hint));
  const d = await tty(['discard', 'PMT-31'], f.io, ['PMT-31']);
  assert.equal(d.code, EXIT.OK, d.err);
  let built = 0;
  const r = await drive(f, { steps: steps({ runBuild: async () => { built++; return { outcome: 'needs-you', why: 'stop here' }; } }) });
  assert.equal(built, 1, 'the next step is the build again');
  assert.equal(r.stop.kind, 'needs-you');
});
