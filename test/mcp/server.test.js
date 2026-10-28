import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';

import { callArgs, createServer, inlineResult, INLINE_TAIL_BYTES, MAX_MESSAGE_BYTES, POLICY_SCHEMA, readPolicy, serveStdio, toolList } from '../../src/mcp/server.js';
import { checkPathForm, checkPathInCopy } from '../../src/mcp/args.js';
import { machineSlot, repoLock, waitFor } from '../../src/tests/slots.js';
import { personalMaxParallel } from '../../src/config/load.js';
import { writeToken } from '../../src/sign/token.js';

// Unit 14d: MIRAI's MCP server, without Docker or a model (the executor is a stand-in; 14c's
// tests cover it). The real runs are test/probes/mcp-probes.js and the sample app.

const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const tempDir = (name) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `mirai-14d-${name}-`)));
  temps.push(d);
  return d;
};
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// A trust root as verifyTrustRoot reads it: one file and a manifest, read-only.
function trustRoot() {
  const dir = join(tempDir('trust'), 'abc');
  mkdirSync(join(dir, 'tree'), { recursive: true });
  writeFileSync(join(dir, 'tree', 'x.txt'), 'x\n');
  const text = `${JSON.stringify({ schema_version: 1, format: 3, base_sha: 'b'.repeat(40), branch: 'main', files: [{ path: 'tree/x.txt', sha256: sha256('x\n') }] })}\n`;
  writeFileSync(join(dir, 'manifest.json'), text);
  chmodSync(join(dir, 'tree', 'x.txt'), 0o444);
  chmodSync(join(dir, 'manifest.json'), 0o444);
  return { dir, manifestSha256: sha256(text) };
}

// Policy 2 (unit 15a): the tools and their settings under `tools`.
function policyFor({ levels = ['unit', 'e2e'], checks = ['lint'], ...extra } = {}) {
  const t = trustRoot();
  return {
    schema: POLICY_SCHEMA, kind: 'headless', checkout: tempDir('checkout'), trust_dir: t.dir, manifest_sha256: t.manifestSha256, home: tempDir('home'),
    repo_state: 'a'.repeat(64), launch_id: '20261027120000-0123abcd', launch_dir: tempDir('launch'), item: null,
    tools: { ...(levels.length ? { run_tests: { levels } } : {}), ...(checks.length ? { run_check: { checks } } : {}) }, ...extra,
  };
}

const passResult = (over = {}) => ({
  id: 't-20261027-120000-abcdef', name: 'unit', kind: 'level', outcome: 'pass', exit_code: 0, duration_ms: 4200, path: null,
  output: { tail: 'ok\n', truncated: false }, out_files: [{ path: 'junit.xml', size: 10 }], isolated_binds: [], tree: { hash: 'f'.repeat(64) },
  dir: '/Users/x/Library/Application Support/mirai/r/store/tests/t-1', base_sha: 'b'.repeat(40), ...over,
});

// A server driven in-process: `rpc(method, params)` resolves the reply.
function harness({ policy = policyFor(), runTest = async () => passResult(), repoState = () => policy.repo_state, progressMs } = {}) {
  const sent = [];
  const waiting = new Map();
  const send = (msg) => {
    sent.push(msg);
    if (msg.id !== undefined && waiting.has(msg.id)) waiting.get(msg.id)(msg);
  };
  const server = createServer({ policy, send, deps: { runTest, repoState, progressMs } });
  let next = 1;
  const rpc = (method, params) => {
    const id = next++;
    const p = new Promise((done) => waiting.set(id, done));
    server.handle({ jsonrpc: '2.0', id, method, params });
    return p;
  };
  const body = (reply) => JSON.parse(reply.result.content[0].text);
  return { server, rpc, sent, body, policy };
}

test('14d T1: the protocol: initialize, tools/list with the configured names, ping, unknown methods, oversized or broken input ends it', async () => {
  const h = harness();
  const init = await h.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
  assert.equal((await h.rpc('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-11-25');
  const tools = (await h.rpc('tools/list')).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['run_tests', 'run_check']);
  assert.deepEqual(tools[0].inputSchema.properties.level.enum, ['unit', 'e2e']);
  assert.deepEqual(tools[1].inputSchema.properties.name.enum, ['lint']);
  assert.ok(tools.every((t) => t.inputSchema.additionalProperties === false));
  assert.deepEqual(toolList({ tools: { run_check: { checks: ['lint'] } } }).map((t) => t.name), ['run_check']);
  assert.deepEqual((await h.rpc('ping')).result, {});
  assert.equal((await h.rpc('resources/list')).error.code, -32601);
  assert.equal((await h.rpc('tools/call', { name: 'Bash', arguments: {} })).error.code, -32602);
  // Notifications get no answer.
  assert.equal(h.server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);

  // Over stdio: a broken line or one over the cap ends the connection.
  for (const bad of ['not json\n', `${'x'.repeat(MAX_MESSAGE_BYTES + 10)}`]) {
    const input = new PassThrough();
    const output = new PassThrough();
    const ended = new Promise((done) => serveStdio({ policy: h.policy, input, output, exit: done }));
    input.write(bad);
    assert.equal(await ended, 1);
  }
  const input = new PassThrough();
  const output = new PassThrough();
  let out = '';
  output.on('data', (d) => (out += d));
  const ended = new Promise((done) => serveStdio({ policy: h.policy, input, output, exit: done }));
  input.write('{"jsonrpc":"2.0","id":7,"method":"ping"}\n');
  input.end();
  assert.equal(await ended, 0);
  assert.deepEqual(JSON.parse(out), { jsonrpc: '2.0', id: 7, result: {} });
});

test('14d T2: the argument rules: names from the list, no extra fields, the path form and the path in the copy', async () => {
  const p = policyFor();
  assert.deepEqual(callArgs(p, 'run_tests', { level: 'unit' }), { name: 'unit', path: null });
  assert.deepEqual(callArgs(p, 'run_tests', { level: 'unit', path: 'tests/Unit' }), { name: 'unit', path: 'tests/Unit' });
  assert.deepEqual(callArgs(p, 'run_check', { name: 'lint' }), { name: 'lint', path: null });
  for (const [tool, args, re] of [
    ['run_tests', { level: 'nope' }, /configured: unit, e2e/], ['run_tests', { level: 'lint' }, /isn't a configured test level/], ['run_check', { name: 'unit' }, /configured: lint/],
    ['run_tests', { level: 'unit', script: 'x' }, /takes no script/], ['run_check', { name: 'lint', path: 'a' }, /takes no path/], ['run_tests', { level: 'unit', path: 5 }, /must be a string/],
    ['run_tests', [], /must be an object/], ['run_tests', { level: 'unit', extra: 1, more: 2 }, /extra, more/],
  ]) assert.match(callArgs(p, tool, args).refused, re, JSON.stringify(args));
  for (const bad of ['-x', '--filter=x', '/etc/passwd', '../x', 'a/../b', './a', 'a/./b', 'a//b', 'a b', 'a;b', '$(id)', '`id`', 'a|b', 'a\nb', "a'b", 'a"b', 'a:b', 'x'.repeat(513), '']) {
    assert.throws(() => checkPathForm(bad), (e) => e.code === 'bad-path', JSON.stringify(bad));
  }
  assert.equal(checkPathForm('tests/Unit/'), 'tests/Unit');
  assert.equal(checkPathForm('src/@scope/a.test.ts'), 'src/@scope/a.test.ts');
  // Against the copy: there, plain, no link along it.
  const copy = tempDir('copy');
  mkdirSync(join(copy, 'tests', 'Unit'), { recursive: true });
  writeFileSync(join(copy, 'tests', 'Unit', 'a.php'), '');
  symlinkSync('Unit', join(copy, 'tests', 'link'));
  checkPathInCopy(copy, 'tests/Unit');
  checkPathInCopy(copy, 'tests/Unit/a.php');
  for (const bad of ['tests/link', 'tests/link/a.php', 'tests/missing', 'tests/Unit/a.php/x']) assert.throws(() => checkPathInCopy(copy, bad), (e) => e.code === 'bad-path', bad);
  // Refusals through the server never run anything.
  let ran = 0;
  const h = harness({ runTest: async () => { ran++; return passResult(); } });
  for (const args of [{ level: 'unit', path: '; rm -rf ~' }, { level: 'unit', path: '-x' }, { level: 'deploy' }]) {
    const r = await h.rpc('tools/call', { name: 'run_tests', arguments: args });
    assert.deepEqual([h.body(r).code, r.result.isError], ['bad-arguments', true], JSON.stringify(args));
  }
  assert.equal(ran, 0);
  assert.match(callArgs(p, 'run_tests', { level: 'unit', path: 'a b' }).refused, /character test runs don't take/);
});

test('14d T3: every call hashes the trust root again and checks .git before and after; a change stops the server', async () => {
  let state = 'a'.repeat(64);
  let ran = 0;
  const h = harness({ repoState: () => state, runTest: async (o) => { ran++; assert.equal(o.by, 'agent'); assert.equal(o.trust.manifestSha256, h.policy.manifest_sha256); return passResult(); } });
  assert.equal(h.body(await h.rpc('tools/call', { name: 'run_tests', arguments: { level: 'unit' } })).outcome, 'pass');
  // .git changed before a call: refused, and the server stops.
  state = 'c'.repeat(64);
  const r = await h.rpc('tools/call', { name: 'run_tests', arguments: { level: 'unit' } });
  assert.deepEqual([h.body(r).outcome, h.body(r).code], ['refused', 'repo-changed']);
  state = 'a'.repeat(64);
  assert.equal(h.body(await h.rpc('tools/call', { name: 'run_check', arguments: { name: 'lint' } })).code, 'stopped');
  assert.equal(ran, 1);
  // .git changed during a run: refused, and stopped.
  let s2 = 'a'.repeat(64);
  const h2 = harness({ repoState: () => s2, runTest: async () => { s2 = 'd'.repeat(64); return passResult(); } });
  assert.equal(h2.body(await h2.rpc('tools/call', { name: 'run_tests', arguments: { level: 'unit' } })).code, 'repo-changed');
  assert.equal(h2.body(await h2.rpc('tools/call', { name: 'run_tests', arguments: { level: 'unit' } })).code, 'stopped');
  // A changed trust root: refused, nothing runs, and the server stops (review fix).
  let ran3 = 0;
  const h3 = harness({ runTest: async () => { ran3++; return passResult(); } });
  chmodSync(join(h3.policy.trust_dir, 'tree', 'x.txt'), 0o644);
  writeFileSync(join(h3.policy.trust_dir, 'tree', 'x.txt'), 'changed\n');
  const r3 = await h3.rpc('tools/call', { name: 'run_tests', arguments: { level: 'unit' } });
  assert.deepEqual([h3.body(r3).outcome, h3.body(r3).code, ran3], ['refused', 'trust-tampered', 0]);
  assert.equal(h3.body(await h3.rpc('tools/call', { name: 'run_tests', arguments: { level: 'unit' } })).code, 'stopped');
  // .git changed while the run waited for its turn: the executor's onTurn refuses it before any
  // git call, and the server stops (review fix).
  let s4 = 'a'.repeat(64);
  let gitCalls = 0;
  const h4 = harness({ repoState: () => s4, runTest: async (o) => { s4 = 'e'.repeat(64); o.onTurn(); gitCalls++; return passResult(); } });
  const r4 = await h4.rpc('tools/call', { name: 'run_tests', arguments: { level: 'unit' } });
  assert.deepEqual([h4.body(r4).code, gitCalls], ['repo-changed', 0]);
  assert.equal(h4.body(await h4.rpc('tools/call', { name: 'run_tests', arguments: { level: 'unit' } })).code, 'stopped');
  // .git changed during a run that then failed without a result (Docker down, …): still caught.
  let s5 = 'a'.repeat(64);
  const h5 = harness({ repoState: () => s5, runTest: async () => { s5 = 'f'.repeat(64); throw Object.assign(new Error('Docker Desktop isn\'t running'), { code: 'docker-down' }); } });
  assert.equal(h5.body(await h5.rpc('tools/call', { name: 'run_tests', arguments: { level: 'unit' } })).code, 'repo-changed');
  // The launch id goes with every agent run.
  let seen = null;
  const h6 = harness({ runTest: async (o) => { seen = o.launchId; return passResult(); } });
  await h6.rpc('tools/call', { name: 'run_tests', arguments: { level: 'unit' } });
  assert.equal(seen, h6.policy.launch_id);
});

test('14d T4: the policy: its hash, its shape; nothing from the environment but the policy\'s HOME', async () => {
  const dir = tempDir('policy');
  const p = policyFor();
  const file = join(dir, 'mcp-policy.json');
  const body = `${JSON.stringify(p)}\n`;
  writeFileSync(file, body);
  assert.equal(readPolicy(file, sha256(body)).checkout, p.checkout);
  assert.throws(() => readPolicy(file, 'f'.repeat(64)), /doesn't match its hash/);
  assert.throws(() => readPolicy(file, undefined), /doesn't match its hash/);
  assert.throws(() => readPolicy(join(dir, 'missing.json'), sha256(body)), /can't be read/);
  for (const bad of [{ schema: 'x' }, { checkout: 'relative' }, { repo_state: 'short' }, { tools: { run_tests: { levels: 'unit' } } }, { docker_socket: 'rel/sock' }]) {
    const b = `${JSON.stringify({ ...p, ...bad })}\n`;
    writeFileSync(file, b);
    assert.throws(() => readPolicy(file, sha256(b)), /isn't one this server reads|isn't an absolute path|needs its levels/, JSON.stringify(bad));
  }
  // The executor gets exactly { HOME } from the policy.
  let env;
  const h = harness({ runTest: async (o) => { env = o.env; return passResult(); } });
  await h.rpc('tools/call', { name: 'run_tests', arguments: { level: 'unit' } });
  assert.deepEqual(env, { HOME: h.policy.home });
  // bin/mcp.js refuses to start on a wrong hash, and says so without detail.
  writeFileSync(file, body);
  const child = spawn(process.execPath, [new URL('../../bin/mcp.js', import.meta.url).pathname, file, 'f'.repeat(64)], { env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => (err += d));
  const code = await new Promise((done) => child.on('close', done));
  assert.equal(code, 2);
  assert.match(err, /won't start: the policy file doesn't match its hash/);
});

test('14d T5: results inline: the fields, the 32 KiB tail, no store paths, isError per outcome, redacted errors', async () => {
  const big = `${'x'.repeat(40 * 1024)}END`;
  const r = inlineResult(passResult({ output: { tail: big, truncated: false } }));
  assert.equal(r.output_truncated, true);
  assert.ok(Buffer.byteLength(r.output_tail) <= INLINE_TAIL_BYTES && r.output_tail.endsWith('END'));
  assert.equal(JSON.stringify(r).includes('Application Support'), false, 'no store paths');
  assert.deepEqual(Object.keys(r), ['id', 'outcome', 'exit_code', 'duration_s', 'level', 'path', 'output_tail', 'output_truncated', 'out_files', 'isolated_binds', 'tree_hash']);
  assert.equal(inlineResult(passResult({ kind: 'check', name: 'lint' })).check, 'lint');
  for (const [outcome, isError] of [['pass', false], ['fail', false], ['timeout', true], ['env-fault', true], ['refused', true]]) {
    const h = harness({ runTest: async () => passResult({ outcome }) });
    const reply = await h.rpc('tools/call', { name: 'run_tests', arguments: { level: 'unit' } });
    assert.equal(reply.result.isError, isError, outcome);
  }
  // A thrown run with a stored result comes back as that result; without one, as an error,
  // redacted (the token's exact value).
  const typed = harness({ runTest: async () => { throw Object.assign(new Error('stack down'), { code: 'stack-down', result: passResult({ outcome: 'env-fault', code: 'stack-down', message: 'stack down' }) }); } });
  assert.equal(typed.body(await typed.rpc('tools/call', { name: 'run_tests', arguments: { level: 'unit' } })).code, 'stack-down');
  const p = policyFor();
  const token = `sk-ant-oat01-${'Zx9_-q'.repeat(16)}`;
  writeToken({ HOME: p.home }, token);
  const leaky = harness({ policy: p, runTest: async () => { throw Object.assign(new Error(`docker said ${token}`), { code: 'docker-down', hint: `try ${token}` }); } });
  const body = leaky.body(await leaky.rpc('tools/call', { name: 'run_tests', arguments: { level: 'unit' } }));
  assert.equal(JSON.stringify(body).includes(token), false);
  assert.match(body.message, /<redacted:login-token>/);
  // No paths into the MIRAI home (store, trust root) in an error an agent sees (review fix).
  const store = join(p.home, 'Library', 'Application Support', 'mirai', 'r', 'locks', 'tests.lock');
  const pathy = harness({ policy: p, runTest: async () => { throw Object.assign(new Error(`EACCES: permission denied, open '${store}' (trust ${p.trust_dir})`), { code: 'EACCES' }); } });
  const pb = pathy.body(await pathy.rpc('tools/call', { name: 'run_tests', arguments: { level: 'unit' } }));
  assert.equal(pb.message.includes('Application Support') || pb.message.includes(p.trust_dir), false, pb.message);
  assert.match(pb.message, /<mirai home>\/r\/locks\/tests\.lock.*<trust root>/);
});

test('14d T6: one call at a time; cancelling a call or closing stdin aborts the run, which still finishes cleaning up; progress', async () => {
  let release;
  let seen;
  const slow = async (o) => {
    seen = o.signal;
    await new Promise((done) => {
      release = done;
      o.signal.addEventListener('abort', () => setTimeout(done, 20));
    });
    return passResult({ outcome: o.signal.aborted ? 'env-fault' : 'pass', code: o.signal.aborted ? 'cancelled' : undefined });
  };
  const h = harness({ runTest: slow, progressMs: 10 });
  const first = h.rpc('tools/call', { name: 'run_tests', arguments: { level: 'unit' }, _meta: { progressToken: 'p1' } });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(h.body(await h.rpc('tools/call', { name: 'run_check', arguments: { name: 'lint' } })).code, 'busy');
  assert.equal((await h.rpc('ping')).result !== undefined, true, 'ping is answered during a run');
  const progress = h.sent.filter((m) => m.method === 'notifications/progress');
  assert.ok(progress.length >= 1 && progress[0].params.progressToken === 'p1' && /running unit/.test(progress[0].params.message));
  h.server.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } });
  const done = await first;
  assert.equal(seen.aborted, true);
  assert.equal(h.body(done).code, 'cancelled');
  // A cancel for another request id does nothing.
  const h2 = harness({ runTest: slow });
  const p2 = h2.rpc('tools/call', { name: 'run_tests', arguments: { level: 'unit' } });
  await new Promise((r) => setTimeout(r, 20));
  h2.server.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 99 } });
  assert.equal(seen.aborted, false);
  release();
  assert.equal(h2.body(await p2).outcome, 'pass');
  // stdin closing: the run is aborted, and exit waits for it to finish.
  const input = new PassThrough();
  const output = new PassThrough();
  let finished = false;
  const policy = policyFor();
  const exited = new Promise((done) => serveStdio({ policy, input, output, deps: { repoState: () => policy.repo_state, runTest: async (o) => { await slow(o); finished = true; return passResult(); } }, exit: done }));
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_tests', arguments: { level: 'unit' } } })}\n`);
  await new Promise((r) => setTimeout(r, 30));
  input.end();
  assert.equal(await exited, 0);
  assert.equal(finished, true, 'the run finished (cleanup) before exit');
  // Claude Code gone: its end of stdout closed (EPIPE), then stdin ends mid-run. A progress note
  // due during cleanup must not kill the server: cleanup finishes and it exits 0 (review fix).
  const input2 = new PassThrough();
  const broken = new Writable({ write(_c, _e, cb) { cb(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })); } });
  let cleaned = false;
  const policy2 = policyFor();
  const slowClean = async (o) => {
    await new Promise((done) => o.signal.addEventListener('abort', done));
    await new Promise((r) => setTimeout(r, 60)); // cleanup, while progress would be due
    cleaned = true;
    return passResult({ outcome: 'env-fault', code: 'cancelled' });
  };
  const exited2 = new Promise((done) => serveStdio({ policy: policy2, input: input2, output: broken, deps: { repoState: () => policy2.repo_state, runTest: slowClean, progressMs: 5 }, exit: done }));
  input2.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_tests', arguments: { level: 'unit' }, _meta: { progressToken: 'p' } } })}\n`);
  await new Promise((r) => setTimeout(r, 30));
  input2.end();
  assert.equal(await exited2, 0);
  assert.equal(cleaned, true);
  // Progress says "waiting" while the run waits, and "running" once its turn comes (review fix).
  let turn;
  const h3 = harness({ progressMs: 5, runTest: async (o) => {
    o.onWait();
    await new Promise((r) => setTimeout(r, 25));
    o.onTurn();
    await new Promise((r) => { turn = r; setTimeout(r, 25); });
    return passResult();
  } });
  await h3.rpc('tools/call', { name: 'run_tests', arguments: { level: 'unit' }, _meta: { progressToken: 'q' } });
  const notes = h3.sent.filter((m) => m.method === 'notifications/progress').map((m) => m.params.message);
  assert.ok(notes.some((n) => /^waiting/.test(n)) && /^running unit/.test(notes.at(-1)), notes.join(' | '));
  assert.ok(turn);
});

test('14d T7: waiting: the repo lock and the machine slots, max_parallel, a deadline, an abort', async () => {
  const home = tempDir('home');
  const env = { HOME: home };
  const store = tempDir('store');
  mkdirSync(join(store, 'locks'));
  const a = repoLock(store)();
  assert.ok(a);
  assert.equal(repoLock(store)(), null, 'one run per repo');
  let told = 0;
  assert.equal(await waitFor(repoLock(store), { waitMs: 50, pollMs: 10, onWait: () => told++ }), null);
  assert.equal(told, 1, 'told once');
  setTimeout(() => a.release(), 30);
  const b = await waitFor(repoLock(store), { waitMs: 2000, pollMs: 10 });
  assert.ok(b, 'taken once released');
  b.release();
  mkdirSync(join(home, 'Library', 'Application Support'), { recursive: true });
  const take = machineSlot(env, 2);
  const s1 = take();
  const s2 = take();
  assert.ok(s1 && s2);
  assert.equal(take(), null, 'max_parallel 2');
  assert.deepEqual(readdirSync(join(home, 'Library', 'Application Support', 'mirai', 'locks', 'test-slots')).sort(), ['0.lock', '1.lock']);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  assert.equal(await waitFor(take, { waitMs: 10_000, pollMs: 5, signal: controller.signal }), null, 'an abort ends the wait');
  s1.release();
  s2.release();
  // [tests] max_parallel: personal file only, 1–8, default 2.
  assert.equal(personalMaxParallel(home), 2);
  mkdirSync(join(home, '.config', 'mirai'), { recursive: true });
  writeFileSync(join(home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[tests]\nmax_parallel = 3\n');
  assert.equal(personalMaxParallel(home), 3);
  writeFileSync(join(home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[tests]\nmax_parallel = 9\n');
  assert.throws(() => personalMaxParallel(home), /1 to 8/);
  assert.equal(readFileSync(join(home, '.config', 'mirai', 'config.toml'), 'utf8').includes('9'), true);
});

test('14d T11: the MCP probes stay canary-only and local, and the model is always Haiku', async () => {
  const { PROBES } = await import('../probes/mcp-probes.js');
  assert.equal(PROBES.length, 6);
  for (const p of PROBES) {
    assert.match(p.prompt, /^Call the tool mcp__probe__probe_(facts|sleep) once/, p.id);
    assert.ok(!/Bash|Read|Write|Edit|curl|http/.test(p.prompt), p.id);
  }
  const read = (f) => readFileSync(new URL(`../probes/${f}`, import.meta.url), 'utf8');
  for (const f of ['mcp-probes.js', 'run-tests-probes.js']) {
    const text = read(f);
    for (const m of text.matchAll(/'--model', ([^,\]]+)/g)) assert.ok(["'haiku'", 'model'].includes(m[1].trim()), `${f}: --model ${m[1]}`);
    assert.ok(!/claude-opus|claude-sonnet|'opus'|'sonnet'/.test(text), f);
  }
  assert.match(read('mcp-probes.js'), /model = 'haiku'/);
  const e2e = read('run-tests-probes.js');
  assert.deepEqual([...new Set([...e2e.matchAll(/image: (\w+)/g)].map((m) => m[1]))], ['IMG']);
  assert.match(e2e, /const IMG = 'nginx:1\.27-alpine';/);
  assert.ok(!/--pull|docker pull|'pull'/.test(e2e));
});
