import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { claimRequest, createRequest, mintLaunchToken, readStatus } from '../../src/agent/requests.js';
import { launchInRun, runAgent } from '../../src/agent/run.js';
import { runWorker } from '../../src/agent/worker.js';
import { checkArgs, toolNamed, TOOLS } from '../../src/mcp/tools.js';
import { checkPolicy } from '../../src/mcp/server.js';
import { sessionServer, sessionToolNames, startAgentAllowedIn } from '../../src/mcp/session.js';
import { endSession, startSession } from '../../src/mcp/tools/sessions.js';
import { acquireRunLock } from '../../src/store/global.js';
import { openStore } from '../../src/store/home.js';
import { readRunLog } from '../../src/store/run-log.js';
import { newRunId, readRunState, startRun } from '../../src/store/run.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { writeToken } from '../../src/sign/token.js';
import { snapshot } from '../../src/trust/snapshot.js';
import { installed, tempDir } from '../tests/run-fixture.js';

// Unit 19c: starting agents from your session, the one-time token, session run ids. No model.

const TOKEN = `sk-ant-oat01-${'Ag3_-k'.repeat(16)}`;
const INIT = '{"type":"system","subtype":"init","permissionMode":"dontAsk"}';
const RESULT = '{"type":"result","subtype":"success","is_error":false,"result":"done","num_turns":1}';
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });

function repo() {
  const f = installed();
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  writeToken(f.env, TOKEN);
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  return f;
}
function claude() {
  const path = join(realpathSync(tempDir()), 'claude');
  writeFileSync(path, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.316 (Claude Code)"; exit 0; fi\necho '${INIT}'; echo '${RESULT}'\n`, { mode: 0o755 });
  return path;
}
const policyFor = (f) => sessionServer({ store: openStore({ cwd: f.root, env: f.env }), trust: snapshot({ cwd: f.root, env: f.env }), env: { ...f.env, PATH: `${join(claude(), '..')}:/usr/bin:/bin` } }).policy;

test('T1: the new tools exist only in your session\'s server', () => {
  for (const name of ['start_agent', 'agent_status', 'session_start', 'session_end']) {
    assert.deepEqual(TOOLS.find((t) => t.name === name).contexts, ['interactive'], name);
  }
  const f = repo();
  const policy = policyFor(f);
  assert.ok(policy.tools.start_agent?.claude, 'the interactive policy offers start_agent');
  assert.throws(() => checkPolicy({ ...policy, kind: 'headless', launch_dir: '/x', repo_state: 'a'.repeat(64), launch_id: '20260101000000-deadbeef', item: null, registration_id: undefined, state_dir: undefined }), /never has|isn't one/);
});

test('T2: no launch without a one-time token; a token used twice is refused; a request claimed once', async () => {
  const f = repo();
  const o = { cwd: f.root, env: f.env, role: 'reviewer', prompt: 'x', claude: claude(), status: green, check: () => [] };
  await assert.rejects(runAgent(o), (e) => e.code === 'no-launch-token');
  await assert.rejects(runAgent({ ...o, launchToken: { launch: 'forged' } }), (e) => e.code === 'no-launch-token');
  const t = mintLaunchToken();
  assert.equal((await runAgent({ ...o, launchToken: t })).outcome, 'ok');
  await assert.rejects(runAgent({ ...o, launchToken: t }), (e) => e.code === 'no-launch-token', 'used once');
  const store = openStore({ cwd: f.root, env: f.env });
  const { id, token } = createRequest(store, { role: 'reviewer', prompt: 'x' });
  assert.throws(() => claimRequest(store, id, 'wrong'), (e) => e.code === 'bad-launch-token');
  assert.throws(() => claimRequest(store, id, token), (e) => e.code === 'request-used', 'a wrong try uses it up');
  const second = createRequest(store, { role: 'reviewer', prompt: 'x' });
  assert.deepEqual(claimRequest(store, second.id, second.token), { role: 'reviewer', prompt: 'x' });
  assert.throws(() => claimRequest(store, second.id, second.token), (e) => e.code === 'request-used');
  assert.equal(readFileSync(join(store.dir, 'agent-requests', `${second.id}.claimed`), 'utf8').includes(second.token), false, 'only its hash is stored');
});

test('T3: start_agent answers at once; the worker runs every check and its outcome reaches agent_status', async () => {
  const f = repo();
  const policy = policyFor(f);
  const store = openStore({ cwd: f.root, env: f.env });
  let spawned = null;
  const fakeSpawn = (cmd, args, opts) => {
    spawned = { cmd, args, opts, input: '' };
    return { stdin: { on() {}, end: (t) => { spawned.input = t; } }, unref() {} };
  };
  const start = toolNamed(policy, 'start_agent');
  const ctx = { policy, env: f.env, deps: { spawn: fakeSpawn }, token: () => TOKEN };
  const out = await start.run(start.check({ role: 'reviewer', prompt: 'Summarise README.md' }).args, ctx);
  assert.equal(out.isError, false);
  const id = out.body.request;
  assert.equal(spawned.cmd, '/usr/bin/env');
  assert.equal(spawned.args[0], '-i');
  assert.ok(spawned.opts.detached, 'its own session, so it outlives yours');
  assert.equal(spawned.args.includes(spawned.input.trim()), false, 'the token is never an argument');
  assert.equal(readStatus(store, id).state, 'queued');
  // The worker, with the real gate: this clone has no red-team result, so it's refused, and says so.
  await runWorker({ checkout: f.root, id, claude: claude(), token: spawned.input.trim(), env: f.env });
  const status = await toolNamed(policy, 'agent_status').run({ request: id }, ctx);
  assert.equal(status.body.state, 'done');
  assert.equal(status.body.outcome, 'refused');
  assert.match(status.body.why, /red team/);
  // A prompt holding the login token never starts anything.
  const leak = await start.run({ role: 'reviewer', prompt: `here: ${TOKEN}` }, ctx);
  assert.equal(leak.body.code, 'secret');
});

test('T4: hostile arguments are refused before anything starts', () => {
  const f = repo();
  const policy = policyFor(f);
  const start = toolNamed(policy, 'start_agent');
  for (const bad of [{ role: 'Reviewer!', prompt: 'x' }, { role: 'reviewer', prompt: '' }, { role: 'reviewer', prompt: 'x'.repeat(200_001) }, { role: 'reviewer', prompt: 'a\0b' },
    { role: 'reviewer', prompt: 'x', item: '../etc' }, { role: 'reviewer', prompt: 'x', step: 'nope' }, { role: 'reviewer', prompt: 'x', risk: 'low' }, { role: 'reviewer', prompt: 'x', verifies: 'x' },
    { role: 'reviewer', prompt: 'x', model: 'claude-opus-5-5' }, { role: 'reviewer', prompt: 'x', __proto__: { polluted: 1 }, launchToken: 'x' }]) {
    assert.ok(checkArgs(policy, start, JSON.parse(JSON.stringify(bad))).refused, JSON.stringify(bad).slice(0, 80));
  }
});

test('T5: agent_status refuses an unknown or malformed id, and escapes its reply', async () => {
  const f = repo();
  const policy = policyFor(f);
  const st = toolNamed(policy, 'agent_status');
  assert.ok(checkArgs(policy, st, { request: '../x' }).refused);
  assert.equal((await st.run({ request: 'q-20260101000000-deadbeef' }, { policy })).body.code, 'unknown-request');
  const store = openStore({ cwd: f.root, env: f.env });
  const { id } = createRequest(store, { role: 'reviewer', prompt: 'x' });
  writeFileSync(join(store.dir, 'agent-requests', `${id}.status`), JSON.stringify({ id, state: 'done', text: 'a\u001b[2Jb‮' }));
  const out = JSON.stringify((await st.run({ request: id }, { policy })).body);
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(out.replace(/\\\\u[0-9a-f]{4}/g, ''), /\u001b|‮/);
});

test('T6: session_start and session_end write their lines; one left open is closed by the next', () => {
  const f = repo();
  const store = openStore({ cwd: f.root, env: f.env });
  const state = realpathSync(tempDir());
  const a = startSession(store, state, { skill: 'mirai-docs', item: 'PROJ-1' });
  const b = startSession(store, state, { skill: 'mirai-docs' });
  assert.equal(b.closed, a.run_id);
  assert.deepEqual(endSession(store, state, { id: a.run_id }), { mismatch: b.run_id });
  assert.deepEqual(endSession(store, state, { id: b.run_id, note: 'done' }), { run_id: b.run_id });
  assert.equal(endSession(store, state, { id: b.run_id }), null);
  const linesA = readRunLog(store, a.run_id).lines.map((l) => l.event);
  assert.deepEqual(linesA, ['session_started', 'session_ended']);
  assert.equal(readRunLog(store, b.run_id).lines.at(-1).note, 'done');
});

test('T7: install adds no allow rule for start_agent, and status warns when one covers it', () => {
  assert.ok(!sessionToolNames().includes('mcp__mirai__start_agent'));
  assert.ok(sessionToolNames().includes('mcp__mirai__agent_status'));
  const f = repo();
  const store = openStore({ cwd: f.root, env: f.env });
  assert.deepEqual(startAgentAllowedIn(store, f.env), []);
  writeFileSync(join(f.root, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['mcp__mirai__*'] } }));
  assert.equal(startAgentAllowedIn(store, f.env).length, 1);
});

test('T8: launchInRun launches inside a run that already holds the lock', async () => {
  const f = repo();
  const store = openStore({ cwd: f.root, env: f.env });
  const runId = newRunId();
  const { release } = acquireRunLock(store, runId, f.env);
  try {
    startRun(store, { runId, preset: 'supervised' });
    const o = { cwd: f.root, env: f.env, runId, role: 'reviewer', prompt: 'x', claude: claude(), status: green, check: () => [] };
    await assert.rejects(launchInRun(o), (e) => e.code === 'no-launch-token', 'no token, no launch, here too');
    await assert.rejects(launchInRun({ ...o, runId: newRunId(), launchToken: mintLaunchToken() }), (e) => e.code === 'no-run-lock', 'another run\'s id');
    const r = await launchInRun({ ...o, launchToken: mintLaunchToken() });
    assert.equal(r.outcome, 'ok');
    assert.equal(readRunState(store).state, 'running', 'the run is its owner\'s to end');
    assert.equal((await launchInRun({ ...o, launchToken: mintLaunchToken() })).outcome, 'ok', 'and a second launch in it goes');
    await assert.rejects(runAgent({ launchToken: mintLaunchToken(), cwd: f.root, env: f.env, role: 'reviewer', prompt: 'x', claude: claude(), status: green, check: () => [] }), /already going|already holds|one run at a time/i);
  } finally {
    release();
  }
});

test('review: a worker re-checks its request, says when it was lost, and its key matches your terminal\'s', async () => {
  const f = repo();
  const store = openStore({ cwd: f.root, env: f.env });
  // A forged record can't move the launch elsewhere: only start_agent's keys pass.
  const { id, token } = createRequest(store, { role: 'reviewer', prompt: 'x', cwd: '/nonexistent', maxTurns: 999 });
  const r = await runWorker({ checkout: f.root, id, claude: claude(), token, env: f.env });
  assert.equal(r.refused, 'redteam-none', 'it ran here, by the gate\'s rules, not in /nonexistent');
  assert.match(readStatus(store, id).why, /red team/);
  // A worker that died while running.
  const lost = createRequest(store, { role: 'reviewer', prompt: 'x' });
  writeFileSync(join(store.dir, 'agent-requests', `${lost.id}.status`), JSON.stringify({ id: lost.id, state: 'running', pid: 999999 }));
  const policy = policyFor(f);
  assert.equal((await toolNamed(policy, 'agent_status').run({ request: lost.id }, { policy })).body.state, 'lost');
  // The worker's empty environment gives the same host controls as yours (macOS's ssh-agent).
  const { hostFacts } = await import('../../src/redteam/host.js');
  const home = realpathSync(tempDir());
  assert.equal(hostFacts({ HOME: home, PATH: '/usr/bin:/bin' }, { launchd: () => '/tmp/agent.sock' }).sshAuthSock, '/tmp/agent.sock', 'launchd fills in what the empty environment lacks');
  assert.equal(hostFacts({ HOME: home, SSH_AUTH_SOCK: '/a' }, { launchd: () => '/b' }).sshAuthSock, '/a', 'yours first');
  // A branch's settings file that's a link to /dev/zero can't hang status.
  const g = repo();
  const { symlinkSync, rmSync } = await import('node:fs');
  rmSync(join(g.root, '.claude', 'settings.json'), { force: true });
  symlinkSync('/dev/zero', join(g.root, '.claude', 'settings.json'));
  assert.deepEqual(startAgentAllowedIn(openStore({ cwd: g.root, env: g.env }), g.env), []);
});

// Unit 28: the run (run/drive.js) mints one per launch of its steps; it runs only from `mirai run`
// and `mirai resume`, in your terminal or for your session's confirmed request.
test('review: only your terminal (agent, plan, build, fix, review, run) and the worker mint launch tokens', () => {
  const src = new URL('../../src/', import.meta.url).pathname;
  const users = execFileSync('/usr/bin/grep', ['-rl', 'mintLaunchToken', src], { encoding: 'utf8' }).trim().split('\n').map((p) => p.slice(src.length)).sort();
  assert.deepEqual(users, ['agent/requests.js', 'agent/worker.js', 'cli/commands/agent.js', 'cli/commands/build.js', 'cli/commands/fix.js', 'cli/commands/plan.js', 'cli/commands/review.js', 'run/drive.js']);
});
