import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

import { EXIT } from '../../src/cli/exit-codes.js';
import { createStore, openStore } from '../../src/store/home.js';
import { atomicWrite } from '../../src/store/files.js';
import { appendEvent, readJournal, withSeq } from '../../src/store/journal.js';
import { buildRunLine, readRunLog, RUN_EVENTS } from '../../src/store/run-log.js';
import { newRunId, readRunState, recordProgress, runStateMatchesLog, startRun, writeHeartbeat, writeRunState } from '../../src/store/run.js';
import { clearBranch, lookupBranch, pushScope, registerBranch } from '../../src/store/branches.js';
import { acquireRunLock, appendUsage, beginRun, globalPaths, runLockHolder, usageSince } from '../../src/store/global.js';
import { cli, deadPid, HERE, mode, refused, setup, unchangedAsync } from './helpers.js';

const SHA = (c) => c.repeat(40);
const launched = (over = {}) => ({
  item: 'T-12', event: 'agent_run', launch_id: 'L-7', step: 'build', role: 'developer', round: 1, tier: 'deep', model: 'claude-opus-5-5',
  tokens_in: 120_000, tokens_out: 8_000, turns: 31, minutes: 12.5, limit_share: 1.75, limit_share_source: 'measured', verdict: 'pass', ...over,
});

function storeOf(options) {
  const s = setup(options);
  return { ...s, store: createStore({ cwd: s.repo, env: s.env }) };
}

test('T11: run log: a line with tier, model and limit_share validates; bad lines are refused; the event list is pinned', () => {
  const { store } = storeOf();
  const run = startRun(store, { preset: 'supervised', plan: 'max-20x' });
  withSeq(store, ({ take, runLine }) => runLine(run.run_id, take(), launched()));
  const { lines, torn } = readRunLog(store, run.run_id);
  assert.equal(torn, 0);
  assert.deepEqual(lines.map((l) => l.event), ['run_started', 'agent_run']);
  const line = lines[1];
  assert.deepEqual([line.tier, line.model, line.limit_share, line.by, line.run_id], ['deep', 'claude-opus-5-5', 1.75, 'script', run.run_id]);
  assert.equal(mode(join(store.dir, 'runs', `${run.run_id}.jsonl`)), 0o600);

  // Any model on any tier is allowed (D-58); it's recorded, not checked against a list.
  buildRunLine(run.run_id, 9, launched({ tier: 'deep', model: 'claude-haiku-5-5' }));

  const bad = [
    [launched({ tier: 'huge' }), /tier must be one of/],
    [launched({ limit_share: 100.5 }), /limit_share must be between 0 and 100/],
    [launched({ turns: -1 }), /turns must be between 0/],
    [launched({ tokens_in: 1.5 }), /tokens_in must be a whole number/],
    [launched({ extra: 1 }), /unknown key extra/],
    [{ item: 'run', event: 'run_exploded' }, /unknown run-log event/],
    [{ item: 'T-1', event: 'finding', id: 'F-1', round: 1, severity: 'blocking', category: 'correctness', file: 'src/a.js', fingerprint: 'a'.repeat(64), text_ref: { ref: '../../etc/passwd', sha256: 'b'.repeat(64) } }, /ref is not valid/],
    [{ item: 'T-1', event: 'template_gap', template: 'story', section: 'x'.repeat(5000), message: 'm' }, /longer than 4096/],
    [{ item: 'T-1', event: 'checks', tdd: 'auto', tdd_applied: 'on', tests_policy: 'required', tests: { passed: 1, failed: 0, skipped: 0 }, named: Array.from({ length: 500 }, (_, i) => ({ name: `check-${i}`, result: 'pass' })) }, /more than 16384/],
  ];
  for (const [l, why] of bad) assert.throws(() => buildRunLine(run.run_id, 9, l), why);
  // A refused line takes no number: checked before the counter moves.
  writeRunState(store, 'stopped');
  const before = readFileSync(join(store.dir, 'seq'), 'utf8');
  assert.throws(() => startRun(store, { preset: 'nope' }), /preset must be one of/);
  assert.throws(() => startRun(store, { preset: 'supervised', runId: 'bad' }), /run_id is not valid/);
  assert.throws(() => startRun(store, { preset: 'supervised', plan: 'x'.repeat(40) }), /plan is not valid/);
  assert.equal(readFileSync(join(store.dir, 'seq'), 'utf8'), before, 'a refused line takes no number');
  // The optional cost estimate; a finding's file can't climb out of the repo.
  buildRunLine(run.run_id, 9, launched({ cost_usd: 0.42 }));
  assert.throws(() => buildRunLine(run.run_id, 9, launched({ cost_usd: -1 })), /cost_usd/);
  assert.throws(() => buildRunLine(run.run_id, 9, { item: 'T-1', event: 'finding', id: 'F-1', round: 1, severity: 'nit', category: 'style', file: '../x.js', fingerprint: 'a'.repeat(64), text_ref: { ref: 'a.md', sha256: 'b'.repeat(64) } }), /file is not valid/);

  // A finding keeps bulky text out of the line, by reference.
  buildRunLine(run.run_id, 9, { item: 'T-1', event: 'finding', id: 'F-1', round: 2, severity: 'should-fix', category: 'security', downgraded: true, file: 'src/a.js', line: 42, symbol: 'save', basis_ref: 'AC-12.3', fingerprint: 'a'.repeat(64), text_ref: { ref: 'tickets/T-1/review-r1.md', sha256: 'b'.repeat(64) } });

  assert.deepEqual(Object.keys(RUN_EVENTS), ['run_started', 'run_state', 'agent_run', 'checks', 'finding', 'finding_outcome', 'template_gap', 'run_finished']);

  // limit_share: measured or entered by hand (D-38), or left out when unknown.
  buildRunLine(run.run_id, 9, launched({ limit_share_source: 'manual' }));
  const { limit_share: _share, ...noShare } = launched({ limit_share_source: 'unknown' });
  buildRunLine(run.run_id, 9, noShare);
  assert.throws(() => buildRunLine(run.run_id, 9, launched({ limit_share_source: 'unknown' })), /left out when its source is unknown/);
  assert.throws(() => buildRunLine(run.run_id, 9, { ...noShare, limit_share_source: 'measured' }), /required unless its source is unknown/);
  buildRunLine(run.run_id, 9, launched({ step: 'review', role: 'reviewer', rung: 3 }));
  assert.throws(() => buildRunLine(run.run_id, 9, launched({ rung: 4 })), /rung must be between 1 and 3/);

  // Checks log the setting and what it resolved to, and the tests policy (D-23).
  buildRunLine(run.run_id, 9, { item: 'T-1', event: 'checks', tdd: 'auto', tdd_applied: 'off', tests_policy: 'required', tests: { passed: 4, failed: 0, skipped: 1 }, named: [{ name: 'lint', result: 'pass' }] });
  assert.throws(() => buildRunLine(run.run_id, 9, { item: 'T-1', event: 'checks', tdd: 'auto', tdd_applied: 'auto', tests_policy: 'required', tests: { passed: 0, failed: 0, skipped: 0 }, named: [] }), /tdd_applied must be one of: on, off/);
  // A finding's outcome comes later.
  buildRunLine(run.run_id, 9, { item: 'T-1', event: 'finding_outcome', id: 'F-1', outcome: 'disputed' });
  assert.match(newRunId(new Date('2026-10-23T22:14:05Z')), /^r-20261023-221405-[0-9a-f]{4}$/);
});

test('T12: run state: legal moves are saved with a run_state line of the same seq; illegal and human moves are refused', async () => {
  const { store, repo, env } = storeOf();
  const run = startRun(store, { preset: 'supervised' });
  assert.equal(run.state, 'running');
  const paused = writeRunState(store, 'paused', { ticket: 'T-3', step: 'build' });
  const lines = readRunLog(store, run.run_id).lines;
  assert.deepEqual([lines[1].event, lines[1].from, lines[1].to, lines[1].seq, lines[1].item], ['run_state', 'running', 'paused', paused.seq, 'T-3']);
  assert.equal(readRunState(store).seq, paused.seq);

  assert.throws(() => writeRunState(store, 'finished'), /paused → finished is not allowed/);
  assert.equal(refused(() => writeRunState(store, 'running', { by: 'human' }), 'unsigned').exitCode, EXIT.BLOCKED);
  assert.equal(refused(() => startRun(store, { preset: 'supervised' }), 'run-active').exitCode, EXIT.BLOCKED);
  writeRunState(store, 'running');
  writeRunState(store, 'finished');
  assert.throws(() => writeRunState(store, 'running'), /not allowed/, 'finished is final');
  const second = startRun(store, { preset: 'autonomous', plan: 'max-20x' });
  assert.equal(readRunLog(store, second.run_id).lines[0].plan, 'max-20x');

  // Heartbeat: fresh, then stale after 5 minutes; mirai status says so.
  // Progress is recorded without a move, and the position survives a pause and a resume.
  recordProgress(store, { ticket: 'T-4', step: 'review' });
  writeRunState(store, 'paused');
  const resumed = writeRunState(store, 'running');
  assert.deepEqual([resumed.ticket, resumed.step], ['T-4', 'review']);
  assert.deepEqual([writeRunState(store, 'paused', { clear: true }).ticket], [undefined]);
  writeRunState(store, 'running');
  assert.equal(runStateMatchesLog(store), true);

  // Heartbeat: fresh (its ticket and step are shown), stale after 5 minutes, or from the future.
  writeHeartbeat(store, { runId: second.run_id, ticket: 'T-4', step: 'review' });
  let r = await cli(['status'], { cwd: repo, env });
  assert.match(r.out, /\nrun: r-\S+ {2}running {2}ticket T-4 \(review\) {2}heartbeat \d+ s ago\n/);
  writeHeartbeat(store, { runId: second.run_id, now: () => new Date(Date.now() - 7 * 60_000) });
  r = await cli(['status'], { cwd: repo, env });
  assert.match(r.out, /heartbeat 7 min ago — the run may have died \(mirai resume checks it\)/);
  writeHeartbeat(store, { runId: second.run_id, now: () => new Date(Date.now() + 60 * 60_000) });
  r = await cli(['status'], { cwd: repo, env });
  assert.match(r.out, /heartbeat dated in the future/);
  // A damaged heartbeat is shown, not fatal.
  atomicWrite(join(store.dir, 'heartbeat.json'), 'not json');
  r = await cli(['status'], { cwd: repo, env });
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /heartbeat unreadable \(run: mirai doctor\)/);
  assert.throws(() => writeHeartbeat(store, { runId: second.run_id, ticket: '../x' }), /not a ticket key/);

  // The config's "07:00" is not a stop time; it's refused before anything is written.
  writeRunState(store, 'finished');
  assert.throws(() => startRun(store, { preset: 'supervised', stopBy: '07:00' }), /stopBy is a UTC time/);
  assert.equal(readRunState(store).state, 'finished', 'state.json is still readable');

  // A crash between the run-log line and state.json is detected.
  const third = startRun(store, { preset: 'supervised' });
  withSeq(store, ({ take, runLine }) => runLine(third.run_id, take(), { item: 'run', event: 'run_state', from: 'running', to: 'paused' }));
  assert.equal(runStateMatchesLog(store), false);
});

test('T13: registry: register, look up, clear with their events; a missing or corrupt registry blocks trailer branches', () => {
  const { store } = storeOf();
  const entry = { branch: 'feature/T-1-login', creation_sha: SHA('a'), ticket: 'T-1', base_sha: SHA('b') };
  const seq = registerBranch(store, entry);
  assert.deepEqual(lookupBranch(store, entry.branch).map((e) => [e.ticket, e.seq]), [['T-1', seq]]);
  assert.equal(refused(() => registerBranch(store, entry), 'registered').exitCode, EXIT.BLOCKED);
  assert.equal(pushScope(store, { branch: entry.branch }).scope, 'in-scope', 'registered, even with no trailer seen');
  const both = pushScope(store, { branch: entry.branch, hasTrailer: true });
  assert.deepEqual([both.registered, both.reasons.length, both.entries[0].ticket], [true, 2, 'T-1'], 'every reason is kept');
  // A stale entry whose creation commit isn't in the pushed history doesn't capture the branch.
  assert.equal(pushScope(store, { branch: entry.branch, isAncestor: () => false }).scope, 'untouched');
  assert.equal(pushScope(store, { branch: entry.branch, isAncestor: (sha) => sha === SHA('a') }).scope, 'in-scope');
  clearBranch(store, entry);
  assert.deepEqual(lookupBranch(store, entry.branch), []);
  assert.deepEqual(readJournal(store).events.map((e) => [e.type, e.branch]), [['branch_registered', entry.branch], ['branch_cleared', entry.branch]]);

  assert.deepEqual(pushScope(store, { branch: 'jet/experiment' }), { scope: 'untouched', reasons: ['a human branch'], registered: false, entries: [] });
  assert.equal(pushScope(store, { branch: 'x', hasTrailer: true }).scope, 'in-scope');
  assert.equal(pushScope(store, { branch: 'x', hasBranchRecord: true }).scope, 'in-scope');
  assert.equal(pushScope(store, { branch: 'x', miraiCommitter: true }).scope, 'in-scope');

  // The roadmap's test: deleting the registry blocks a trailer branch, with the doctor hint.
  const file = join(store.dir, 'branches.json');
  rmSync(file);
  let scope = pushScope(store, { branch: 'feature/T-2-x', hasTrailer: true });
  assert.equal(scope.scope, 'blocked');
  assert.equal(scope.error.exitCode, EXIT.BLOCKED);
  assert.match(scope.error.hint, /mirai doctor/);
  assert.equal(pushScope(store, { branch: 'jet/experiment' }).scope, 'untouched', 'a human branch still pushes');
  assert.equal(pushScope(store, { branch: 'x', hasBranchRecord: true }).scope, 'blocked', 'any MIRAI sign blocks while the index is lost');
  refused(() => registerBranch(store, { ...entry, creation_sha: SHA('c') }), 'registry');

  atomicWrite(file, '{"schema_version":1,"entries":[{"branch":"x"}]}\n');
  scope = pushScope(store, { branch: 'feature/T-2-x', hasTrailer: true });
  assert.equal(scope.scope, 'blocked', 'a corrupt registry blocks too');
});

test('T14: global: one run at a time across repos; a dead holder is broken and logged; the ledger sums across repos', () => {
  const a = storeOf({ remote: 'https://github.com/acme/a' });
  const b = setup({ remote: 'https://github.com/acme/b' });
  b.env.HOME = a.env.HOME; // the same user: one MIRAI home, two repos
  const storeB = createStore({ cwd: b.repo, env: a.env });

  const runA = newRunId();
  const lockA = acquireRunLock(a.store, runA, a.env);
  assert.equal(mode(globalPaths(a.env).dir), 0o700);
  // A second MIRAI process, for the other repo.
  const second = spawnSync(process.execPath, [join(HERE, 'fixtures', 'run-lock-worker.mjs'), b.repo, a.env.HOME], { encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr);
  const err = JSON.parse(second.stdout);
  assert.deepEqual([err.code, err.exitCode], ['locked', EXIT.BLOCKED]);
  assert.match(err.message, new RegExp(`a MIRAI run is already going in ${a.store.repoId} \\(run ${runA}, pid ${process.pid}\\); one run at a time across all projects \\(D-57\\)`));

  // Release only removes our own lock: a lock rewritten by someone else stays.
  const lockFile = globalPaths(a.env).runLock;
  const other = JSON.stringify({ repo_id: storeB.repoId, run_id: newRunId(), pid: process.pid, host: hostname(), purpose: 'run', started_at: new Date().toISOString() });
  writeFileSync(lockFile, other, { mode: 0o600 });
  lockA.release();
  assert.equal(readFileSync(lockFile, 'utf8'), other);

  // A dead holder's lock is broken, and the break goes to this repo's journal.
  const dead = deadPid();
  writeFileSync(lockFile, JSON.stringify({ repo_id: a.store.repoId, run_id: runA, pid: dead, host: hostname(), purpose: 'run', started_at: new Date().toISOString() }), { mode: 0o600 });
  const lockB = acquireRunLock(storeB, newRunId(), a.env);
  assert.deepEqual(readJournal(storeB).events.map((e) => [e.type, e.lock, e.pid]), [['lock_broken', 'global-run', dead]]);
  lockB.release();

  // beginRun ties the lock to the run, and releases it when the run can't start.
  const begun = beginRun(storeB, a.env, { preset: 'supervised' });
  assert.equal(runLockHolder(a.env).run_id, begun.state.run_id);
  begun.release();
  assert.throws(() => beginRun(storeB, a.env, { preset: 'nope' }), /preset/);
  assert.equal(runLockHolder(a.env), null, 'released after a failed start');

  // A run that can't record breaking a dead lock doesn't keep the lock.
  writeFileSync(lockFile, JSON.stringify({ repo_id: a.store.repoId, run_id: runA, pid: deadPid(), host: hostname(), purpose: 'run', started_at: new Date().toISOString() }), { mode: 0o600 });
  const journalB = join(storeB.dir, 'journal.jsonl');
  chmodSync(journalB, 0o644);
  refused(() => acquireRunLock(storeB, newRunId(), a.env), 'mode');
  chmodSync(journalB, 0o600);
  assert.equal(runLockHolder(a.env), null);
  const again = acquireRunLock(storeB, newRunId(), a.env); // no "already holds" in this process
  again.release();

  // The ledger: shares from two repos add up since a time; older lines don't count.
  const t0 = new Date('2026-10-20T00:00:00Z');
  appendUsage(a.env, { repoId: a.store.repoId, runId: runA, plan: 'max-20x', limitShare: 9, kind: 'ticket', ticket: 'T-1', uptoSeq: 4, now: () => t0 });
  appendUsage(a.env, { repoId: a.store.repoId, runId: runA, plan: 'max-20x', limitShare: 2.5, kind: 'ticket', ticket: 'T-2', uptoSeq: 9, now: () => new Date('2026-10-23T22:00:00Z') });
  const runB = newRunId();
  appendUsage(a.env, { repoId: storeB.repoId, runId: runB, plan: 'max-20x', limitShare: 3, kind: 'run', uptoSeq: 2, now: () => new Date('2026-10-23T23:00:00Z') });
  // Written again after a resume: a line at or below what the run already covers is skipped.
  assert.equal(appendUsage(a.env, { repoId: a.store.repoId, runId: runA, plan: 'max-20x', limitShare: 2.5, kind: 'ticket', ticket: 'T-2', uptoSeq: 9 }), false);
  assert.throws(() => appendUsage(a.env, { repoId: a.store.repoId, runId: runA, limitShare: 1, kind: 'ticket', uptoSeq: 10 }), /names its ticket/);
  assert.throws(() => appendUsage(a.env, { repoId: a.store.repoId, runId: runA, limitShare: 1, kind: 'run', ticket: 'T-3', uptoSeq: 10 }), /names none/);
  const since = new Date('2026-10-23T00:00:00Z');
  assert.equal(usageSince(a.env, since), 5.5);
  assert.equal(usageSince(a.env, since, { kind: 'ticket' }), 2.5);
  assert.equal(usageSince(a.env, t0), 14.5);
  assert.throws(() => appendUsage(a.env, { repoId: a.store.repoId, runId: runA, limitShare: 101, kind: 'ticket', ticket: 'T-4', uptoSeq: 20 }), /percent/);
  assert.throws(() => usageSince(a.env, new Date('garbage')), /valid Date/, 'a bad window never reads as no usage');
  assert.equal(mode(globalPaths(a.env).ledger), 0o600);
});

test('T15: mirai log: notes are unverified; MIRAI\'s own events are refused; bad input is a usage error', async () => {
  const { store, repo, env } = storeOf();
  let r = await unchangedAsync(repo, () => cli(['log', 'note', '--message', 'checked the login flow by hand', '--item', 'T-12'], { cwd: repo, env }));
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /logged note \(seq 1\)/);
  r = await cli(['log', 'template_gap', '--template', 'story', '--section', 'Rollback', '--message', 'no place for the rollback plan'], { cwd: repo, env });
  assert.equal(r.code, EXIT.OK, r.err);
  const events = readJournal(store).events;
  assert.deepEqual(events.map((e) => [e.type, e.by, e.item ?? null]), [['note', 'unverified', 'T-12'], ['template_gap', 'unverified', null]]);

  r = await cli(['log', 'mr_merged', '--message', 'x'], { cwd: repo, env });
  assert.equal(r.code, EXIT.BLOCKED);
  assert.match(r.err, /mr_merged is written only by MIRAI itself \(D-17\)/);
  r = await cli(['log', 'nite', '--message', 'x'], { cwd: repo, env });
  assert.equal(r.code, EXIT.USAGE);
  assert.match(r.err, /did you mean "note"\?/);
  for (const argv of [
    ['log', 'template_gap', '--template', 'story', '--message', 'x'],
    ['log', 'note', '--message', 'x'.repeat(5000)],
    ['log', 'note'],
    ['log', 'note', '--message', 'x', '--item', '../etc'],
    ['log', 'note', '--message', 'x', '--section', 's'],
    ['log', 'template_gap', '--template', '漢'.repeat(4096), '--section', '漢'.repeat(4096), '--message', '漢'.repeat(4096)],
  ]) {
    r = await cli(argv, { cwd: repo, env });
    assert.equal(r.code, EXIT.USAGE, argv.join(' '));
  }
  assert.equal(readJournal(store).events.length, 2, 'nothing else was written');
  assert.equal(readFileSync(join(store.dir, 'seq'), 'utf8'), '2\n', 'and no number was used up');
});

test('T18: several numbers in one step: consecutive seqs across the journal and a run log; an unused number is a gap', () => {
  const { store, repo, env } = storeOf();
  const run = startRun(store, { preset: 'supervised' }); // seq 1
  const [x, y] = withSeq(store, ({ take, event, runLine }) => {
    const first = take();
    runLine(run.run_id, first, { item: 'T-1', event: 'template_gap', template: 'plan', section: 'Rollback', message: 'no rollback section' });
    const second = take();
    event(second, { type: 'note', by: 'script', message: 'with the run line' });
    take(); // taken, never used
    return [first, second];
  });
  assert.deepEqual([x, y], [2, 3]);
  assert.equal(appendEvent(store, { type: 'note', by: 'script', message: 'next' }), 5, 'number 4 stays a gap');
  assert.deepEqual(readRunLog(store, run.run_id).lines.map((l) => l.seq), [1, 2]);
  assert.deepEqual(readJournal(store).events.map((e) => e.seq), [3, 5]);

  // Numbers not taken, used twice, or out of order in one file are refused before writing.
  assert.throws(() => withSeq(store, ({ event }) => event(999, { type: 'note', by: 'script', message: 'x' })), /not taken/);
  assert.throws(() => withSeq(store, ({ take, event }) => {
    const n = take();
    event(n, { type: 'note', by: 'script', message: 'once' });
    event(n, { type: 'note', by: 'script', message: 'twice' });
  }), /already used/);
  assert.throws(() => withSeq(store, ({ take, event }) => {
    const a = take();
    const b = take();
    event(b, { type: 'note', by: 'script', message: 'b' });
    event(a, { type: 'note', by: 'script', message: 'a' });
  }), /not after/);
  assert.ok(readJournal(store).events.length > 0, 'the journal is still readable');
  assert.ok(openStore({ cwd: repo, env }), 'and the store opens: no number was written out of turn');
});

test('T19: the counter check reads the newest run log too', () => {
  const { store, repo, env } = storeOf();
  const run = startRun(store, { preset: 'supervised' });
  writeRunState(store, 'paused');
  writeRunState(store, 'running'); // seq 3, only in the run log
  appendEvent(store, { type: 'note', by: 'script', message: 'n' }); // seq 4
  withSeq(store, ({ take, runLine }) => runLine(run.run_id, take(), { item: 'run', event: 'run_finished', tickets_done: 1, tickets_parked: 0, limit_share: 4 }));
  // The journal ends at 4, the run log at 5: a counter of 4 is behind the run log.
  atomicWrite(join(store.dir, 'seq'), '4\n');
  const err = refused(() => openStore({ cwd: repo, env }), 'counter-behind');
  assert.match(err.message, /behind the newest run log \(5\)/);
  // Without state.json, the newest run log by name still counts.
  rmSync(join(store.dir, 'state.json'));
  refused(() => openStore({ cwd: repo, env }), 'counter-behind');
  atomicWrite(join(store.dir, 'seq'), '5\n');
  assert.ok(openStore({ cwd: repo, env }));

  // state.json names a run that doesn't sort last (an older id), and only its log is ahead.
  const later = startRun(store, { preset: 'supervised', runId: 'r-29991231-235959-ffff' }); // seq 6
  writeRunState(store, 'stopped'); // seq 7
  const older = startRun(store, { preset: 'supervised', runId: 'r-20000101-000000-0000' }); // seq 8
  writeRunState(store, 'paused'); // seq 9, in the older run's log only
  assert.equal(readRunState(store).run_id, older.run_id);
  assert.ok(later.run_id > older.run_id);
  atomicWrite(join(store.dir, 'seq'), '8\n');
  assert.match(refused(() => openStore({ cwd: repo, env }), 'counter-behind').message, /newest run log \(9\)/);
});

test('T20: mirai status shows the run and the global lock, in text and JSON', async () => {
  const { store, repo, env } = storeOf();
  let r = await cli(['status'], { cwd: repo, env });
  assert.match(r.out, /\nrun: none\nglobal lock: free\n/);

  const run = startRun(store, { preset: 'supervised' });
  writeRunState(store, 'paused', { ticket: 'T-12', step: 'build' });
  writeRunState(store, 'running', { ticket: 'T-12', step: 'build' });
  writeHeartbeat(store, { runId: run.run_id, ticket: 'T-12', step: 'build' });
  const lock = acquireRunLock(store, run.run_id, env);
  r = await cli(['status'], { cwd: repo, env });
  assert.match(r.out, new RegExp(`\\nrun: ${run.run_id} {2}running {2}ticket T-12 \\(build\\) {2}heartbeat \\d+ s ago\\n`));
  assert.match(r.out, new RegExp(`\\nglobal lock: held by this repo \\(run ${run.run_id}, pid ${process.pid}\\)\\n`));

  r = await cli(['status', '--json'], { cwd: repo, env });
  const data = JSON.parse(r.out);
  assert.deepEqual([data.run.run_id, data.run.state, data.run.ticket, data.run.heartbeat.stale], [run.run_id, 'running', 'T-12', false]);
  assert.deepEqual([data.global_lock.held, data.global_lock.this_repo, data.global_lock.alive], [true, true, true]);
  lock.release();

  // Held by another repo, then left by a dead run.
  const lockFile = globalPaths(env).runLock;
  writeFileSync(lockFile, JSON.stringify({ repo_id: 'other-0123456789ab', run_id: run.run_id, pid: process.pid, host: hostname(), purpose: 'run', started_at: new Date().toISOString() }), { mode: 0o600 });
  r = await cli(['status'], { cwd: repo, env });
  assert.match(r.out, /global lock: held by other-0123456789ab \(run r-\S+, pid \d+\)/);
  const dead = deadPid();
  writeFileSync(lockFile, JSON.stringify({ repo_id: 'other-0123456789ab', run_id: run.run_id, pid: dead, host: hostname(), purpose: 'run', started_at: new Date().toISOString() }), { mode: 0o600 });
  r = await cli(['status'], { cwd: repo, env });
  assert.match(r.out, new RegExp(`global lock: left by a dead run of other-0123456789ab \\(run r-\\S+, pid ${dead}\\); the next run breaks it`));
});
