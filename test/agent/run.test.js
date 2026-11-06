import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkRedTeam, runAgent, LONG_OUTPUTS } from '../../src/agent/run.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { endProcesses, processTable, runInGroup, Tracker } from '../../src/agent/process.js';
import { keyOf } from '../../src/redteam/key.js';
import { RESULT_SCHEMA_VERSION, statusFor, writeDecision, writeResult } from '../../src/redteam/store.js';
import { loadSigner } from '../../src/sign/signer.js';
import { runHook } from '../../src/launch/hook.js';
import { prepareLaunch, removeLaunch } from '../../src/launch/strict.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { writeToken } from '../../src/sign/token.js';
import { readRunState } from '../../src/store/run.js';
import { readRunLog } from '../../src/store/run-log.js';
import { openStore } from '../../src/store/home.js';
import { snapshot, trustedStrict } from '../../src/trust/snapshot.js';
import { installed, tempDir } from '../tests/run-fixture.js';

// Unit 19a: the launch, with a stand-in `claude` and no model.

const TOKEN = `sk-ant-oat01-${'Ag3_-k'.repeat(16)}`;
const INIT = '{"type":"system","subtype":"init","permissionMode":"dontAsk"}';
const RESULT = '{"type":"result","subtype":"success","is_error":false,"result":"done","num_turns":2,"usage":{"input_tokens":5,"output_tokens":6}}';
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const noInitProblems = () => [];

function repo() {
  const f = installed();
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  writeToken(f.env, TOKEN);
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  return f;
}

// A stand-in claude: `body` is shell, after the version answer.
function claudeWith(body) {
  const path = join(realpathSync(tempDir()), 'claude');
  writeFileSync(path, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.316 (Claude Code)"; exit 0; fi\n${body}\n`, { mode: 0o755 });
  return path;
}
const okBody = `echo '${INIT}'; echo '${RESULT}'`;
const run = (f, o = {}) => runAgent({ launchToken: mintLaunchToken(), cwd: f.root, env: f.env, role: 'author', prompt: 'do it', claude: claudeWith(okBody), status: green, check: noInitProblems, ...o });

test('T1: each red-team state refuses with its own code; a blocker seen needs your signed decision', async () => {
  const store = {};
  for (const state of ['red', 'blocker', 'incomplete', 'stale', 'none']) {
    assert.throws(() => checkRedTeam({ state, changed: [] }, store), (e) => e.code === `redteam-${state}` && e.exitCode === EXIT.BLOCKED, state);
  }
  const seen = { state: 'green', blocker_seen: { id: 'b'.repeat(24), key: 'a'.repeat(64), created_at: 'x' } };
  assert.throws(() => checkRedTeam(seen, store, () => null), (e) => e.code === 'redteam-blocker-seen');
  assert.doesNotThrow(() => checkRedTeam(seen, store, () => ({ key: 'a'.repeat(64) })));
  assert.doesNotThrow(() => checkRedTeam({ state: 'green', blocker_seen: null }, store));

  const f = repo();
  await assert.rejects(run(f, { status: async () => ({ state: 'stale', changed: ['framework'], blocker_seen: null }) }), (e) => e.code === 'redteam-stale');
  assert.equal(readRunState(openStore({ cwd: f.root, env: f.env })), null, 'refused before a run began');
});

test('T2: a wrong init event kills the run, and nothing reads as ok', async () => {
  const f = repo();
  const r = await run(f, { claude: claudeWith(`echo '${INIT}'; sleep 30; echo '${RESULT}'`), check: () => ['the mode is wrong'], timeoutMs: 60_000 });
  assert.equal(r.outcome, 'refused');
  assert.match(r.why, /the mode is wrong/);
  assert.notEqual(r.line.verdict, 'pass');
});

test('T3: a background process is gone after the run, and a verdict file means nothing', async () => {
  const f = repo();
  const marker = `4${Math.floor(Math.random() * 90000) + 10000}`;
  const r = await run(f, { claude: claudeWith(`echo '{"verdict":"pass"}' > verdict.json; (nohup sleep ${marker} >/dev/null 2>&1 &) ; (exec sleep ${marker}1 >/dev/null 2>&1 &) ; sleep 1; echo '${INIT}'; echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"no"}'`) });
  assert.equal(r.outcome, 'agent-failed', 'the stream decides, not verdict.json');
  assert.equal(r.line.verdict, 'fail');
  const left = spawnSync('/bin/ps', ['-axww', '-o', 'command='], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l.startsWith(`sleep ${marker}`));
  assert.deepEqual(left, []);
  assert.deepEqual(r.processes.survivors, []);
});

test('T4: an interrupt and a timeout end in the same cleanup', async () => {
  for (const how of ['interrupt', 'timeout']) {
    const f = repo();
    const abort = new AbortController();
    const running = run(f, { claude: claudeWith(`echo '${INIT}'; sleep 300`), signal: abort.signal, timeoutMs: how === 'timeout' ? 1500 : 60_000 });
    if (how === 'interrupt') setTimeout(() => abort.abort(), 1500);
    const r = await running;
    assert.equal(r.outcome, 'killed', how);
    const store = openStore({ cwd: f.root, env: f.env });
    assert.equal(readRunState(store).state, 'stopped', 'the run is closed, as cut off');
    assert.deepEqual(readdirSync(join(store.repoHome, 'launches')), [], 'the launch folder is gone');
    await run(f); // the lock was released, or this would refuse
  }
});

test('T5: the token is on fd 3 only, and nowhere it could be logged', async () => {
  const f = repo();
  const seenFile = join(realpathSync(tempDir()), 'seen');
  const r = await run(f, { claude: claudeWith(`env > ${seenFile}; cat <&3 > ${seenFile}.fd; ${okBody}`) });
  assert.equal(readFileSync(`${seenFile}.fd`, 'utf8'), TOKEN, 'the stand-in reads it from fd 3');
  assert.doesNotMatch(readFileSync(seenFile, 'utf8'), /sk-ant-oat/);
  assert.equal(readFileSync(seenFile, 'utf8').includes('DISABLE_AUTOUPDATER=1'), true);
  assert.equal(JSON.stringify(r).includes(TOKEN), false);
  const leaked = await run(f, { claude: claudeWith(`echo '${INIT}'; echo '{"type":"result","subtype":"success","is_error":false,"result":"${TOKEN}"}'`) });
  assert.equal(leaked.outcome, 'refused');
  assert.equal(leaked.text.includes(TOKEN), false);
  const store = openStore({ cwd: f.root, env: f.env });
  for (const n of readdirSync(join(store.dir, 'agent-runs'))) assert.equal(readFileSync(join(store.dir, 'agent-runs', n), 'utf8').includes(TOKEN), false);
});

test('T6: a changed .git during the run fails it; a changed trust root refuses it', async () => {
  const f = repo();
  const r = await run(f, { claude: claudeWith(`echo x > .git/mirai-planted-hook; git config --local core.hooksPath /tmp/x; ${okBody}`) });
  assert.equal(r.outcome, 'refused');
  assert.match(r.why, /chang/i);
  const g = repo();
  const trust = snapshot({ cwd: g.root, env: g.env });
  const file = join(trust.dir, 'tree', '.mirai', 'framework', 'package.json');
  spawnSync('/bin/chmod', ['u+w', file]);
  writeFileSync(file, `${readFileSync(file, 'utf8')}\n`);
  await assert.rejects(run(g), /trust root|tamper|changed/i);
});

test('T7: one run-log line with every field; the prompt and rules reach the launch', async () => {
  const f = repo();
  let args = null;
  const launch = (c, o, x) => {
    ({ args } = o);
    return runInGroup(c, o, x);
  };
  const r = await run(f, { launch, tier: 'deep', item: 'PROJ-1', maxTurns: 7 });
  assert.equal(r.outcome, 'ok');
  assert.equal(r.text, 'done');
  assert.equal(args[args.indexOf('--max-turns') + 1], '7');
  assert.equal(args[args.indexOf('--append-system-prompt') + 1], LONG_OUTPUTS);
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
  const store = openStore({ cwd: f.root, env: f.env });
  const lines = readRunLog(store, readRunState(store).run_id);
  const line = (lines.lines ?? lines).find((l) => l.event === 'agent_run');
  assert.equal(line.launch_id, r.launchId);
  assert.equal(line.item, 'PROJ-1');
  assert.equal(line.tier, 'deep');
  assert.equal(line.turns, 2);
  assert.equal(line.tokens_out, 6);
  assert.equal(line.limit_share_source, 'unknown');
  assert.match(line.settings_sha256, /^[0-9a-f]{64}$/);
  assert.match(line.token_fingerprint, /^[0-9a-f]{12}$/);
});

test('T8: a dirty tree and a non-terminal refuse', async () => {
  const f = repo();
  writeFileSync(join(f.root, 'dirty.txt'), 'x');
  await assert.rejects(run(f), (e) => e.code === 'dirty-tree');
  let err = '';
  const code = await main(['agent', 'run', '--role', 'reviewer', '--prompt-file', 'x'], { cwd: f.root, env: f.env, stdin: { isTTY: false }, stdout: { write() {}, isTTY: false }, stderr: { write: (t) => { err += t; } } });
  assert.equal(code, EXIT.NEEDS_HUMAN);
  assert.match(err, /real terminal/);
});

test('T9: the hook checks a fingerprint, and still refuses a trust root changed later', () => {
  const f = repo();
  const trust = snapshot({ cwd: f.root, env: f.env });
  const plan = prepareLaunch({ trust, template: trustedStrict(trust, 'read-write'), checkout: f.root, env: f.env });
  try {
    const settings = JSON.parse(readFileSync(join(plan.launchDir, 'input', 'settings.json'), 'utf8'));
    const m = /"([^"]+hook-policy\.json)" ([0-9a-f]{64})/.exec(settings.hooks.PreToolUse[0].hooks[0].command);
    const call = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: join(f.root, 'README.md') }, cwd: f.root });
    const started = Date.now();
    assert.equal(runHook({ policyFile: m[1], policySha: m[2], stdin: call }).allow, true);
    assert.ok(Date.now() - started < 1500, 'it doesn\'t hash every file');
    const file = join(trust.dir, 'tree', '.mirai', 'framework', 'package.json');
    spawnSync('/bin/chmod', ['u+w', file]);
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n`);
    const d = runHook({ policyFile: m[1], policySha: m[2], stdin: call });
    assert.equal(d.allow, false);
    assert.match(d.reason, /trust root changed/);
  } finally {
    plan.guard?.release();
    removeLaunch(plan.launchDir, plan.scratchDir);
  }
});

test('review: only a checked init and a real success read ok', async () => {
  const f = repo();
  const bad = () => ['nope'];
  const printfInit = (json, rest = '') => `printf '%s' '${json}'; ${rest}`;
  const cases = [
    ['no newline', claudeWith(printfInit('{"type":"system","subtype":"init"}')), bad],
    ['a space', claudeWith(`echo '{"type":"system","subtype": "init"}'; echo '${RESULT}'`), bad],
    ['a second init', claudeWith(`echo '${INIT}'; echo '{"type":"system","subtype":"init","model":"x"}'; echo '${RESULT}'`), (ev) => (ev.model ? ['second'] : [])],
    ['a check that throws', claudeWith(`echo '${INIT}'; echo '${RESULT}'`), () => { throw new TypeError('boom'); }],
  ];
  for (const [name, claude, check] of cases) {
    const r = await run(f, { claude, check });
    assert.notEqual(r.outcome, 'ok', name);
    assert.notEqual(r.line.verdict, 'pass', name);
  }
  assert.equal((await run(f, { claude: claudeWith(`echo '${RESULT}'`) })).outcome, 'env-fault', 'no init');
  assert.equal((await run(f, { claude: claudeWith(`echo '{"type":"assistant"}'; sleep 20; echo '${INIT}'; echo '${RESULT}'`), timeoutMs: 30_000 })).outcome, 'refused', 'acted before init');
  assert.equal((await run(f, { claude: claudeWith(`echo '${INIT}'`) })).outcome, 'agent-failed', 'no result');
  assert.equal((await run(f, { claude: claudeWith(`echo '${INIT}'; echo '{"type":"result","subtype":"error_max_turns","is_error":false}'`) })).outcome, 'agent-failed', 'max turns');
  const fine = await run(f, { claude: claudeWith(`echo '${INIT}'; echo '{"type":"result","subtype":"success","is_error":false,"result":"Fixed the 401 handler","num_turns":"x","total_cost_usd":-1}'`) });
  assert.equal(fine.outcome, 'ok', 'an agent may talk about a 401, and odd numbers lose nothing');
  const started = Date.now();
  const silent = await run(f, { claude: claudeWith('sleep 20'), initDeadlineMs: 500, timeoutMs: 30_000 });
  assert.equal(silent.outcome, 'env-fault', 'silence hits the deadline');
  assert.ok(Date.now() - started < 15_000);
});

test('review: an interrupt before the start, a survivor, a crash', async () => {
  const f = repo();
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(run(f, { signal: abort.signal }), (e) => e.code === 'interrupted');
  const survivor = await run(f, { launch: async (c, o, x) => ({ ...(await runInGroup(c, o, x)), processes: { killed: 0, survivors: [12345], suspects: [], unproven: [], unverified: false } }) });
  assert.equal(survivor.outcome, 'refused');
  assert.equal(survivor.line.survivors, 1);
  const unverified = await run(f, { launch: async (c, o, x) => ({ ...(await runInGroup(c, o, x)), processes: { killed: 0, survivors: [], suspects: [], unproven: [], unverified: true } }) });
  assert.equal(unverified.outcome, 'env-fault', 'ps failing isn\'t clean');
  // A real crash: a mirai killed mid-run, its lock held by a dead pid, and an agent that dirtied the
  // tree. The next run isn't wedged, and the agent is gone.
  const word = `5${Math.floor(Math.random() * 90000) + 10000}`;
  const stub = claudeWith(`echo x > left-behind.txt; echo '${INIT}'; exec sleep ${word}`);
  const script = join(realpathSync(tempDir()), 'crash.mjs');
  const here = new URL('../../src/agent/run.js', import.meta.url).href;
  writeFileSync(script, `import { runAgent } from ${JSON.stringify(here)};\nimport { mintLaunchToken } from ${JSON.stringify(here.replace('run.js', 'requests.js'))};\nawait runAgent({ launchToken: mintLaunchToken(), cwd: ${JSON.stringify(f.root)}, env: ${JSON.stringify(f.env)}, role: 'author', prompt: 'x', claude: ${JSON.stringify(stub)}, status: async () => ({ state: 'green', blocker_seen: null, changed: [] }), check: () => [], timeoutMs: 120000 });\n`);
  const crashing = spawn(process.execPath, [script], { stdio: 'ignore' });
  const alive = async () => (await processTable()).some((p) => p.command === `sleep ${word}`);
  for (let i = 0; i < 100 && !(await alive()); i++) await new Promise((d) => setTimeout(d, 200));
  assert.equal(await alive(), true, 'the agent started');
  crashing.kill('SIGKILL');
  await new Promise((d) => crashing.on('close', d));
  assert.equal(await alive(), true, 'it outlives mirai');
  await assert.rejects(run(f), (e) => e.code === 'dirty-tree', 'its dirty tree still refuses');
  assert.equal(await alive(), false, 'but the agent is ended first');
  rmSync(join(f.root, 'left-behind.txt'));
  const after = await run(f);
  assert.equal(after.outcome, 'ok', 'and the next run goes');
});

test('second review: a reused group, a failed ps, a second Ctrl-C', async () => {
  const row = (pid, ppid, pgid, startedText) => ({ pid, ppid, pgid, started: 0, startedText, command: 'x' });
  let now = [row(100, 1, 100, 'A'), row(101, 100, 777, 'A')];
  const t = new Tracker(100, async () => now);
  await t.poll();
  assert.ok(t.groups.has(777));
  now = [row(100, 1, 100, 'A')];
  await t.poll();
  assert.equal(t.groups.has(777), false, 'a group with nobody of ours left');
  now = [row(100, 1, 100, 'A'), row(900, 50, 777, 'B')];
  await t.poll();
  assert.equal(t.seen.has(900), false, 'a stranger in a reused group');

  const stranger = spawn('/bin/sleep', ['46'], { detached: true, stdio: 'ignore' });
  stranger.unref();
  const failing = new Tracker(stranger.pid, async () => null);
  failing.groups.add(stranger.pid);
  const out = await endProcesses(failing, { table: async () => null, graceMs: 0 });
  assert.equal(out.unverified, true);
  assert.ok((await processTable()).some((p) => p.pid === stranger.pid), 'no table, no group signalled');
  process.kill(stranger.pid, 'SIGKILL');

  const soft = new AbortController();
  const hard = new AbortController();
  const stubborn = claudeWith("trap '' TERM; (trap '' TERM; exec sleep 44) & sleep 44");
  setTimeout(() => soft.abort(), 500);
  setTimeout(() => hard.abort(), 2500);
  const started = Date.now();
  await runInGroup(stubborn, { args: ['x'], env: { PATH: '/usr/bin:/bin' }, cwd: '/' }, { signal: soft.signal, hardAbort: hard.signal });
  assert.ok(Date.now() - started < 12_000, `a second Ctrl-C ended the wait (${Date.now() - started} ms)`);
});

test('review: a blocker can\'t clear itself, and your decision is tied to it', () => {
  const f = repo();
  const store = openStore({ cwd: f.root, env: f.env });
  const signer = loadSigner(f.env, store);
  const parts = { claude_code: { version: '1', sha256: 'a' }, bundles: {}, framework: 'f', docker: 'd', git: 'g', macos: 'm', node: 'n', project_rules: 'r', host_controls: {}, compose: {} };
  const result = (state, at) => ({ schema_version: RESULT_SCHEMA_VERSION, key: keyOf(parts), parts, state, created_at: at, cases: [] });
  writeResult(store, result('blocker', '2026-11-01T10:00:00.000Z'), signer);
  writeResult(store, result('green', '2026-11-01T11:00:00.000Z'), signer);
  const s = statusFor(store, parts);
  assert.equal(s.state, 'green');
  assert.ok(s.blocker_seen, 'a green under the same key doesn\'t clear it');
  assert.throws(() => checkRedTeam(s, store), (e) => e.code === 'redteam-blocker-seen');
  writeDecision(store, s.blocker_seen.id, 'read it', signer);
  assert.doesNotThrow(() => checkRedTeam(statusFor(store, parts), store));
  writeResult(store, result('blocker', '2026-11-01T12:00:00.000Z'), signer);
  assert.throws(() => checkRedTeam(statusFor(store, parts), store), (e) => e.code === 'redteam-blocker', 'that key\'s own result is a blocker now');
  assert.ok(!statusFor(store, parts).blocker_seen.id.startsWith(s.blocker_seen.id), 'and it needs its own decision');
  const records = join(store.dir, 'redteam', 'blockers');
  const file = join(records, readdirSync(records)[0]);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).result.state, 'blocker', 'the record keeps what you need to read');
  writeFileSync(file, 'broken');
  assert.throws(() => statusFor(store, parts), (e) => e.code === 'redteam-invalid', 'a corrupt record isn\'t "no blocker"');
});

test('processes: a process it saw is killed; an orphan outside the project is reported, not killed', async () => {
  // A process of "yours": started during the run, orphaned, its folder elsewhere.
  const since = Date.now();
  const yours = spawn('/bin/sleep', ['47'], { detached: true, stdio: 'ignore', cwd: '/' });
  yours.unref();
  await new Promise((d) => setTimeout(d, 300));
  const tree = spawn('/bin/sh', ['-c', '(exec sleep 48) & wait'], { detached: true, stdio: 'ignore' });
  const tracker = new Tracker(tree.pid, processTable);
  await new Promise((d) => setTimeout(d, 300));
  await tracker.poll();
  const table = async () => (await processTable()).map((p) => (p.pid === yours.pid ? { ...p, ppid: 1 } : p));
  const out = await endProcesses(tracker, { killRoots: ['/nonexistent-root'], since, table, graceMs: 1000 });
  assert.deepEqual(out.survivors, []);
  assert.equal((await processTable()).some((p) => p.command === 'sleep 48'), false);
  assert.ok(out.unproven.some((u) => u.startsWith(`${yours.pid} `)), JSON.stringify(out));
  assert.equal((await processTable()).some((p) => p.pid === yours.pid), true, 'yours is left alone');
  process.kill(yours.pid, 'SIGKILL');
});

test('processes: an orphan in your project is a suspect, not killed; in the launch\'s scratch, killed; a reused pid or group is never followed', async () => {
  const dir = realpathSync(tempDir());
  const scratch = realpathSync(tempDir());
  const inProject = spawn('/bin/sleep', ['49'], { detached: true, stdio: 'ignore', cwd: dir });
  const inScratch = spawn('/bin/sleep', ['50'], { detached: true, stdio: 'ignore', cwd: scratch });
  inProject.unref();
  inScratch.unref();
  const since = Date.now() - 2000;
  await new Promise((d) => setTimeout(d, 300));
  const table = async () => (await processTable()).map((p) => ([inProject.pid, inScratch.pid].includes(p.pid) ? { ...p, ppid: 1 } : p));
  const tracker = new Tracker(999999, table);
  const out = await endProcesses(tracker, { killRoots: [scratch], reportRoots: [dir], since, table, graceMs: 100 });
  assert.ok(out.suspects.some((u) => u.startsWith(`${inProject.pid} `)), JSON.stringify(out));
  const rows = await processTable();
  assert.equal(rows.some((p) => p.pid === inProject.pid), true, 'yours is left alone');
  assert.equal(rows.some((p) => p.pid === inScratch.pid), false);
  process.kill(inProject.pid, 'SIGKILL');

  const row = (pid, ppid, pgid, startedText) => ({ pid, ppid, pgid, started: 0, startedText, command: 'x' });
  let now = [row(100, 1, 100, 'A'), row(101, 100, 100, 'A')];
  const t = new Tracker(100, async () => now);
  await t.poll();
  assert.equal(t.seen.size, 2);
  // 100 dies, and its pid and group come back as a stranger with a child.
  now = [row(100, 1, 400, 'B'), row(200, 100, 300, 'B')];
  await t.poll();
  assert.equal(t.seen.has(200), false, 'a child of a reused pid');
  assert.equal(t.groups.has(300), false, 'its group');
});

// Unit 18g: the Claude Code agents run is the one the red team tested, kept by MIRAI.
test('18g T2: a launch runs the kept copy, not the PATH link, also after an update; a changed copy refuses', async () => {
  const { keepTested, readTested, testedRoot } = await import('../../src/redteam/tested.js');
  const { binaryHash } = await import('../../src/redteam/key.js');
  const { statSync, appendFileSync, chmodSync } = await import('node:fs');
  const f = repo();
  const store = openStore({ cwd: f.root, env: f.env });
  const tested = claudeWith(okBody);
  const sha256 = await binaryHash(join(store.dir, 'redteam'), tested);
  const { stageTested } = await import('../../src/redteam/tested.js');
  const staged = await stageTested({ env: f.env, claude: { real: tested, version: '2.1.316' }, allowScript: true });
  assert.equal(staged.sha256, sha256);
  keepTested({ env: f.env, store, staged, signer: loadSigner(f.env, store) });
  const kept = readTested(store).current;
  assert.equal(kept.path, join(testedRoot(f.env), sha256, 'claude'));
  assert.equal(statSync(kept.path).mode & 0o777, 0o500, 'read-only');
  // An "update": a newer claude first on PATH. The launch and the gate still use the kept copy.
  const bin = realpathSync(tempDir('path'));
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.399 (Claude Code)"; exit 0; fi\nexit 9\n', { mode: 0o755 });
  const env = { ...f.env, PATH: `${bin}:${f.env.PATH}` };
  const seen = [];
  const status = async (o) => {
    seen.push(o.claude);
    return green();
  };
  const r = await runAgent({ launchToken: mintLaunchToken(), cwd: f.root, env, role: 'author', prompt: 'do it', status, check: noInitProblems });
  assert.equal(r.outcome, 'ok', r.why);
  assert.deepEqual(seen, [kept.path], 'the gate judged the kept copy');
  // The broker's worker passes the claude your session server found: only a fall back (18g review).
  const r2 = await runAgent({ launchToken: mintLaunchToken(), cwd: f.root, env, role: 'author', prompt: 'do it', fallbackClaude: join(bin, 'claude'), status, check: noInitProblems });
  assert.equal(r2.outcome, 'ok', r2.why);
  assert.deepEqual(seen, [kept.path, kept.path], 'start_agent runs the kept copy too'); 
  // A changed copy: refused, never a fall back to the PATH one.
  chmodSync(join(testedRoot(f.env), sha256), 0o700);
  chmodSync(kept.path, 0o700);
  appendFileSync(kept.path, '# changed\n');
  await assert.rejects(runAgent({ launchToken: mintLaunchToken(), cwd: f.root, env, role: 'author', prompt: 'do it', status, check: noInitProblems }), (e) => e.code === 'tested-claude-changed');
});

// Unit 21e: progress while a launch runs, from its own stream, filtered.
test('21e T1: progress events carry the tool, a relative path or level, turns and minutes, and nothing the agent wrote', async () => {
  const { progressLine } = await import('../../src/agent/progress.js');
  const f = repo();
  const secret = 'sk-ant-oat01-PLANTEDsecretPLANTEDsecretPLANTEDsecret';
  const ev = (o) => `echo '${JSON.stringify(o).replaceAll("'", "'\\''")}'`;
  const body = [
    `echo '${INIT}'`,
    ev({ type: 'assistant', message: { content: [{ type: 'text', text: `planted ${secret} \u001b[31mred` }, { type: 'tool_use', id: 'a', name: 'Edit', input: { file_path: `${realpathSync(f.root)}/app/Team.php`, old_string: secret, new_string: 'x' } }] } }),
    ev({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: `echo ${secret}; printf '\u001b[2J'` } }] } }),
    ev({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'c', name: 'mcp__mirai__run_tests', input: { level: 'unit' } }] } }),
    ev({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'd', name: 'Read', input: { file_path: '/etc/hosts' } }] } }),
    `echo '${RESULT}'`,
  ].join('\n');
  const seen = [];
  const r = await run(f, { claude: claudeWith(body), onProgress: (p) => seen.push(p), progressLabel: 'Kai' });
  assert.equal(r.outcome, 'ok', r.why);
  const tools = seen.filter((p) => p.kind === 'tool').map((p) => [p.tool, p.target]);
  assert.deepEqual(tools, [['Edit', 'app/Team.php'], ['Bash', null], ['run_tests', 'unit'], ['Read', 'outside the project']]);
  assert.deepEqual(seen.slice(0, 2).map((p) => p.kind), ['preparing', 'started'], 'a sign of life before the launch, then its start');
  assert.equal(seen.at(-1).kind, 'ended');
  assert.deepEqual(seen.filter((p) => p.kind === 'tool').map((p) => p.turns), [1, 2, 3, 4]);
  const all = `${JSON.stringify(seen)}\n${seen.map(progressLine).join('\n')}`;
  assert.equal(all.includes('PLANTED'), false, 'nothing the agent wrote');
  assert.equal(/\u001b/.test(all), false, 'no terminal escapes');
  assert.match(progressLine(seen[2]), /^Kai \(Sonnet\): 1 turn, [\d.]+ min — Edit app\/Team\.php$/);
});

test('21e review: malformed events never throw; made-up tools, padded and secret-looking paths are hidden; turns count messages; a heartbeat for a non-ticket item still lands', async () => {
  const { describeTool, progressTracker } = await import('../../src/agent/progress.js');
  const root = '/p';
  const t = progressTracker({ root, agent: 'Kai', tools: ['Edit', 'Read', 'mcp__mirai__run_tests'], levels: ['unit'] });
  for (const content of ['x', 1, {}, null]) assert.doesNotThrow(() => t.seen({ type: 'assistant', message: { id: 'm0', content } }));
  // One message in three events (Claude Code sends one per block): one turn. A subagent's: none.
  t.seen({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'x' }] } });
  t.seen({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/p/a.php' } }] } });
  const third = t.seen({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/p/b.php' } }] } });
  t.seen({ type: 'assistant', parent_tool_use_id: 'x', message: { id: 'm9', content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/p/c.php' } }] } });
  assert.equal(third.turns, 2, 'm0 and m1');
  const tools = { tools: ['Edit', 'mcp__mirai__run_tests'], levels: ['unit'] };
  assert.equal(describeTool({ name: 'MIRAI_checks_all_pass', input: {} }, root, tools).tool, 'a tool');
  assert.equal(describeTool({ name: 'Edit', input: { file_path: `/p/a/${' '.repeat(70)}MIRAI's checks: unit pass (56 s)` } }, root, tools).target, 'a file');
  assert.equal(describeTool({ name: 'Edit', input: { file_path: '/p/sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' } }, root, tools).target, 'a file');
  assert.equal(describeTool({ name: 'Edit', input: { file_path: '/p/ok/‮hp.php' } }, root, tools).target, 'a file');
  assert.equal(describeTool({ name: 'Edit', input: { file_path: '..\\..\\x' } }, root, tools).target, 'outside the project');
  assert.equal(describeTool({ name: 'mcp__mirai__run_tests', input: { level: 'all_pass' } }, root, tools).target, null, 'not a level of the project');
  assert.equal(describeTool({ name: 'Edit', input: { file_path: `/p/${'d/'.repeat(80)}f.php` } }, root, tools).target.endsWith('…'), true, 'the head, not the tail');
  // A launch for an item the heartbeat can't carry as a ticket (your session's start_agent) still beats.
  const { readHeartbeat } = await import('../../src/store/run.js');
  const f = repo();
  const r = await run(f, { item: 'docs/prd.md', onProgress: () => {} });
  assert.equal(r.outcome, 'ok', r.why);
  const beat = readHeartbeat(openStore({ cwd: f.root, env: f.env }));
  assert.ok(beat, 'a heartbeat');
  assert.equal(beat.ticket, undefined);
  assert.match(beat.progress, /handed over/);
});
