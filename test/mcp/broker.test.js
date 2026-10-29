import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkPolicy, createServer, POLICY_SCHEMA, PolicyError, readPolicy, toolList, TOOLS } from '../../src/mcp/server.js';
import { checkEvent, JOURNAL_SCHEMA_VERSION, LOG_TYPES, readJournal } from '../../src/store/journal.js';
import { LOG_TYPES as CLI_LOG_TYPES } from '../../src/cli/commands/log.js';
import { createStore } from '../../src/store/home.js';
import { writeToken } from '../../src/sign/token.js';
import { setup } from '../store/helpers.js';

// Unit 15a: the broker's core. The tools as data, log_event and policy 2, without Docker or a
// model. The launch wiring and the input folder are in test/launch/strict.test.js (15a T7, T8);
// the real runs are test/probes/broker-probes.js.

const temps = [];
after(() => {
  for (const d of temps) {
    try {
      chmodSync(d, 0o755);
    } catch {
      // gone
    }
    rmSync(d, { recursive: true, force: true });
  }
});
const tempDir = (name) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `mirai-15a-${name}-`)));
  temps.push(d);
  return d;
};
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const LAUNCH = '20261028120000-0123abcd';
const TOKEN = `sk-ant-oat01-${'Mb4_-y'.repeat(16)}`;

function trustRoot() {
  const dir = join(tempDir('trust'), 'abc');
  mkdirSync(join(dir, 'tree'), { recursive: true });
  writeFileSync(join(dir, 'tree', 'x.txt'), 'x\n');
  const text = `${JSON.stringify({ schema_version: 1, format: 5, base_sha: 'b'.repeat(40), branch: 'main', files: [{ path: 'tree/x.txt', sha256: sha256('x\n') }] })}\n`;
  writeFileSync(join(dir, 'manifest.json'), text);
  chmodSync(join(dir, 'tree', 'x.txt'), 0o444);
  chmodSync(join(dir, 'manifest.json'), 0o444);
  return { dir, manifestSha256: sha256(text) };
}

// A real store (05a), so log_event writes a real journal.
function withStore() {
  const { env, repo } = setup();
  const store = createStore({ cwd: repo, env });
  return { env, repo, store };
}

const SECRETS = [{ name: 'aws-access-key', regex: '\\bAKIA[0-9A-Z]{16}\\b' }];
const logTool = (over = {}) => ({ types: ['note', 'template_gap'], max_events: 50, max_message: 4000, secrets: SECRETS, ...over });

function policyFor({ store, tools, ...extra } = {}) {
  const t = trustRoot();
  const s = store ?? withStore().store;
  return {
    schema: POLICY_SCHEMA, kind: 'headless', checkout: tempDir('checkout'), trust_dir: t.dir, manifest_sha256: t.manifestSha256, home: tempDir('home'),
    repo_state: 'a'.repeat(64), launch_id: LAUNCH, launch_dir: tempDir('launch'), item: 'T-7', store: { dir: s.dir, repo_id: s.repoId },
    tools: tools ?? { run_tests: { levels: ['unit'] }, run_check: { checks: ['lint'] }, log_event: logTool() },
    ...extra,
  };
}

function harness({ policy, lockWaitMs, runTest = async () => ({ id: 't-1', name: 'unit', kind: 'level', outcome: 'pass', exit_code: 0, duration_ms: 1, output: { tail: '' }, tree: { hash: 'f'.repeat(64) } }), repoState } = {}) {
  const p = policy ?? policyFor();
  const waiting = new Map();
  let gitCalls = 0;
  const send = (msg) => {
    if (msg.id !== undefined && waiting.has(msg.id)) waiting.get(msg.id)(msg);
  };
  const server = createServer({ policy: p, send, deps: { runTest, lockWaitMs, repoState: repoState ?? (() => { gitCalls += 1; return p.repo_state; }) } });
  let next = 1;
  const rpc = (method, params) => {
    const id = next++;
    const done = new Promise((r) => waiting.set(id, r));
    server.handle({ jsonrpc: '2.0', id, method, params });
    return done;
  };
  const call = async (name, args) => {
    const m = await rpc('tools/call', { name, arguments: args });
    return m.result ? { ...JSON.parse(m.result.content[0].text), isError: m.result.isError } : { rpcError: m.error };
  };
  return { server, rpc, call, policy: p, gitCalls: () => gitCalls };
}

const agentLines = (store) => readJournal(store).events.filter((e) => e.by === 'agent');

test('15a T1: tools as data: tools/list comes from the table and the policy; a tool not enabled is unknown', async () => {
  for (const t of TOOLS) {
    assert.deepEqual(Object.keys(t).sort(), ['check', 'contexts', 'description', 'enabled', 'exclusive', 'name', 'run', 'schema'], t.name);
    assert.ok(t.contexts.length > 0 && t.contexts.every((c) => ['headless', 'interactive'].includes(c)), t.name);
    assert.ok(Object.isFrozen(t), t.name);
  }
  assert.deepEqual(TOOLS.map((t) => [t.name, t.exclusive, [...t.contexts]]), [['run_tests', true, ['headless', 'interactive']], ['run_check', true, ['headless', 'interactive']],
    ['log_event', false, ['headless', 'interactive']], ['lint', false, ['interactive']]]);
  const all = policyFor();
  assert.deepEqual(toolList(all).map((t) => t.name), ['run_tests', 'run_check', 'log_event']);
  const log = toolList(all).find((t) => t.name === 'log_event');
  assert.deepEqual(log.inputSchema.properties.type.enum, ['note', 'template_gap']);
  assert.equal(log.inputSchema.properties.message.maxLength, 4000);
  assert.equal(log.inputSchema.additionalProperties, false);
  assert.ok(!('item' in log.inputSchema.properties), 'the agent never names the item');
  // Only log_event: the test tools are unknown, not refused.
  const h = harness({ policy: policyFor({ tools: { log_event: logTool({ types: ['note'], max_events: 5, max_message: 100 }) } }) });
  assert.deepEqual((await h.rpc('tools/list')).result.tools.map((t) => t.name), ['log_event']);
  assert.equal((await h.call('run_tests', { level: 'unit' })).rpcError.code, -32602);
  assert.equal((await h.call('start_agent', {})).rpcError.code, -32602);
});

test('15a T2: the shared checks: extra keys and __proto__ refused, a stopped server refuses every tool, the trust root on every call', async () => {
  const h = harness();
  for (const args of [{ type: 'note', message: 'x', item: 'OTHER-1' }, { type: 'note', message: 'x', by: 'script' }, JSON.parse('{"type":"note","message":"x","__proto__":{"a":1}}'), [], null, 'note']) {
    const r = await h.call('log_event', args);
    assert.equal(r.code, 'bad-arguments', JSON.stringify(args));
  }
  assert.match((await h.call('log_event', { type: 'note', message: 'x', item: 'OTHER-1' })).message, /log_event takes no item/);
  // A .git change under a test tool stops the server; log_event is refused after it.
  let same = true;
  const s = harness({ repoState: () => (same ? 'a'.repeat(64) : 'b'.repeat(64)) });
  same = false;
  assert.equal((await s.call('run_tests', { level: 'unit' })).code, 'repo-changed');
  const after = await s.call('log_event', { type: 'note', message: 'after the stop' });
  assert.equal(after.code, 'stopped');
  assert.equal(agentLines({ dir: s.policy.store.dir, repoId: s.policy.store.repo_id }).length, 0);
  // A changed trust root, seen on a log call, stops the server too.
  const t = harness();
  const file = join(t.policy.trust_dir, 'tree', 'x.txt');
  chmodSync(file, 0o644);
  writeFileSync(file, 'changed\n');
  assert.equal((await t.call('log_event', { type: 'note', message: 'x' })).code, 'trust-tampered');
  assert.equal((await t.call('log_event', { type: 'note', message: 'x' })).code, 'stopped');
});

test('15a T3: log_event: the types, the fields per type, the journal line (by agent, the launch, the policy\'s item), the caps, no git', async () => {
  const { store } = withStore();
  const h = harness({ policy: policyFor({ store, tools: { log_event: logTool({ max_events: 3, max_message: 50 }) } }) });
  const refusals = [
    [{ type: 'approval', message: 'x' }, /isn't a type agents may log; types: note, template_gap/],
    [{ type: 'status_written', message: 'x' }, /isn't a type agents may log/],
    [{ type: 'note' }, /message must be text of 1 to 50/],
    [{ type: 'note', message: ' \n ' }, /message must be text/],
    [{ type: 'note', message: '\u200b\u200b' }, /message must be text/],
    [{ type: 'note', message: 'clear\u001b[2Jscreen' }, /control, bidi or broken character/],
    [{ type: 'note', message: 'a\u202egnp.exe' }, /control, bidi or broken character/],
    [{ type: 'note', message: 'lone \ud800 half' }, /control, bidi or broken character/],
    [{ type: 'note', message: 'bell\u0007' }, /control, bidi or broken character/],
    [{ type: 'note', message: 'x'.repeat(51) }, /1 to 50 characters/],
    [{ type: 'note', message: 42 }, /message must be text/],
    [{ type: 'note', message: 'x', template: 't' }, /template is for template_gap/],
    [{ type: 'template_gap', message: 'x', template: 't' }, /template_gap needs section/],
    [{ type: 'template_gap', message: 'x', template: 't'.repeat(201), section: 's' }, /template_gap needs template/],
  ];
  for (const [args, re] of refusals) {
    const r = await h.call('log_event', args);
    assert.equal(r.code, 'bad-arguments', JSON.stringify(args));
    assert.match(r.message, re, JSON.stringify(args));
  }
  assert.equal(agentLines(store).length, 0, 'a refusal writes nothing');
  const note = await h.call('log_event', { type: 'note', message: 'the plan misses the rollback step' });
  assert.equal(note.isError, false);
  assert.equal(note.logged, 'note');
  const gap = await h.call('log_event', { type: 'template_gap', template: 'plan', section: 'Risks', message: 'no place for risks' });
  const lines = agentLines(store);
  assert.deepEqual(lines.map((l) => [l.seq, l.type, l.by, l.item, l.launch_id, l.schema_version]), [
    [note.seq, 'note', 'agent', 'T-7', LAUNCH, JOURNAL_SCHEMA_VERSION], [gap.seq, 'template_gap', 'agent', 'T-7', LAUNCH, JOURNAL_SCHEMA_VERSION]]);
  assert.deepEqual([lines[1].template, lines[1].section, lines[1].message], ['plan', 'Risks', 'no place for risks']);
  // Newlines and tabs are fine.
  assert.equal((await h.call('log_event', { type: 'note', message: 'line one\n\tline two' })).logged, 'note');
  // The cap: per launch, kept in the launch folder: a restarted server doesn't start again at 0.
  const full = await h.call('log_event', { type: 'note', message: 'four' });
  assert.deepEqual([full.code, full.isError], ['log-full', true]);
  assert.match(full.message, /logged 3 events/);
  assert.equal(agentLines(store).length, 3);
  assert.equal(readFileSync(join(h.policy.launch_dir, 'log-events'), 'utf8'), '3\n');
  const restarted = harness({ policy: h.policy });
  assert.equal((await restarted.call('log_event', { type: 'note', message: 'after a restart' })).code, 'log-full');
  assert.equal(agentLines(store).length, 3);
  // No git: D-54's check is for the test tools only, and the store comes from the policy. The
  // checkout isn't a git repo at all, so opening the store through git would have failed.
  assert.equal(h.gitCalls(), 0);
  assert.equal(existsSync(join(h.policy.checkout, '.git')), false);
  // No item: the line has none.
  const { store: s2 } = withStore();
  const h2 = harness({ policy: policyFor({ store: s2, item: null }) });
  await h2.call('log_event', { type: 'note', message: 'no item' });
  assert.equal(agentLines(s2)[0].item, undefined);
  // A store that's gone: env-fault, and the reply names no store path.
  const { store: s3 } = withStore();
  const h3 = harness({ policy: policyFor({ store: s3 }) });
  chmodSync(s3.dir, 0o755);
  const gone = await h3.call('log_event', { type: 'note', message: 'x' });
  chmodSync(s3.dir, 0o700);
  assert.deepEqual([gone.outcome, gone.code], ['env-fault', 'no-store']);
  assert.ok(!JSON.stringify(gone).includes(s3.dir));
  // Secrets are refused, never written: the template's shapes and the login token, in any field.
  const { env: e4, store: s4 } = withStore();
  writeToken(e4, TOKEN);
  const h4 = harness({ policy: policyFor({ store: s4, home: e4.HOME }) });
  for (const args of [{ type: 'note', message: 'key AKIAABCDEFGHIJKLMNOP here' }, { type: 'note', message: `token ${TOKEN}` },
    { type: 'template_gap', template: 'plan', section: `S ${Buffer.from(TOKEN).toString('base64')}`, message: 'x' }]) {
    const r = await h4.call('log_event', args);
    assert.deepEqual([r.code, r.isError], ['secret', true], JSON.stringify(args).slice(0, 60));
    assert.ok(!JSON.stringify(r).includes(TOKEN));
  }
  assert.equal(agentLines(s4).length, 0);
  assert.equal(existsSync(join(h4.policy.launch_dir, 'log-events')), false, 'a refusal doesn\'t count');
  // A busy journal: a short wait, a clear refusal, and the call isn't counted.
  const { store: s5 } = withStore();
  const h5 = harness({ policy: policyFor({ store: s5 }), lockWaitMs: 100 });
  // Another process holds the journal lock (a lock isn't re-entrant within one).
  const files = new URL('../../src/store/files.js', import.meta.url).href;
  const holder = spawn(process.execPath, ['--input-type=module', '-e',
    `import { acquireLock } from ${JSON.stringify(files)}; acquireLock(${JSON.stringify(join(s5.dir, 'locks', 'journal.lock'))}, 'journal', { waitMs: 0 }); process.stdout.write('held\\n'); setInterval(() => {}, 1000);`], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((done) => holder.stdout.once('data', done));
  const begun = Date.now();
  let busy;
  try {
    busy = await h5.call('log_event', { type: 'note', message: 'while locked' });
  } finally {
    holder.kill('SIGKILL');
    await new Promise((done) => holder.on('close', done));
    rmSync(join(s5.dir, 'locks', 'journal.lock'), { force: true });
  }
  assert.deepEqual([busy.outcome, busy.code], ['env-fault', 'journal-busy']);
  assert.ok(Date.now() - begun < 5000, 'waited the CLI\'s 30 seconds');
  assert.equal(existsSync(join(h5.policy.launch_dir, 'log-events')), false);
  assert.equal((await h5.call('log_event', { type: 'note', message: 'after' })).logged, 'note');
  // mirai log and log_event take the same list.
  assert.equal(CLI_LOG_TYPES, LOG_TYPES);
});

test('15a T4: log_event is answered while a test runs; a second test call is still busy', async () => {
  let release;
  const running = new Promise((r) => (release = r));
  const h = harness({ runTest: async () => {
    await running;
    return { id: 't-1', name: 'unit', kind: 'level', outcome: 'pass', exit_code: 0, duration_ms: 1, output: { tail: '' }, tree: { hash: 'f'.repeat(64) } };
  } });
  const test1 = h.call('run_tests', { level: 'unit' });
  await new Promise((r) => setImmediate(r));
  assert.equal(h.server.busy, true);
  assert.equal((await h.call('log_event', { type: 'note', message: 'while testing' })).logged, 'note');
  assert.equal((await h.call('run_check', { name: 'lint' })).code, 'busy');
  assert.equal(h.server.busy, true, 'log_event doesn\'t take or free the test slot');
  release();
  assert.equal((await test1).outcome, 'pass');
  assert.equal(h.server.busy, false);
});

test('15a T5: the journal: by agent for the log types only, always with its launch; older lines still read', () => {
  assert.equal(JOURNAL_SCHEMA_VERSION, 4);
  assert.doesNotThrow(() => checkEvent({ type: 'note', by: 'agent', launch_id: LAUNCH, message: 'x' }));
  assert.throws(() => checkEvent({ type: 'note', by: 'agent', message: 'x' }), /names its launch/);
  assert.throws(() => checkEvent({ type: 'note', by: 'unverified', launch_id: LAUNCH, message: 'x' }), /only an agent line carries a launch_id/);
  assert.throws(() => checkEvent({ type: 'note', by: 'agent', launch_id: 'nope', message: 'x' }), /launch_id is not valid/);
  for (const type of ['mr_closed', 'approval', 'status_written']) {
    assert.throws(() => checkEvent({ type, by: 'agent', launch_id: LAUNCH, ticket: 'T-1' }), /written only by MIRAI itself/, type);
  }
  // A version-2 line (before this unit) still reads.
  const { store } = withStore();
  appendFileSync(join(store.dir, 'journal.jsonl'), `${JSON.stringify({ schema_version: 2, seq: 1, ts: '2026-10-27T10:00:00.000Z', type: 'note', by: 'unverified', message: 'old' })}\n`);
  writeFileSync(join(store.dir, 'seq'), '1\n');
  assert.deepEqual(readJournal(store).events.map((e) => [e.schema_version, e.message]), [[2, 'old']]);
});

test('15a T6: policy 2: its hash, its shape, the caps; a policy 1 is refused with a clear message', () => {
  const dir = tempDir('policy');
  const p = policyFor();
  const file = join(dir, 'mcp-policy.json');
  const body = `${JSON.stringify(p)}\n`;
  writeFileSync(file, body);
  assert.equal(readPolicy(file, sha256(body)).launch_id, LAUNCH);
  assert.throws(() => readPolicy(file, 'f'.repeat(64)), /doesn't match its hash/);
  const le = p.tools.log_event;
  const bad = [
    [{ launch_id: undefined }, /isn't one this server reads/],
    [{ launch_id: 'r-1' }, /isn't one this server reads/],
    [{ item: '../x' }, /isn't one this server reads/],
    [{ item: undefined }, /isn't one this server reads/],
    [{ tools: null }, /isn't one this server reads/],
    [{ tools: { ...p.tools, start_agent: {} } }, /tools this server doesn't have \(start_agent\)/],
    [{ tools: { run_tests: { levels: [] } } }, /run_tests needs its levels/],
    [{ tools: { run_check: {} } }, /run_check needs its checks/],
    [{ tools: { log_event: { ...le, types: ['note', 'approval'] } } }, /log_event needs types agents may log/],
    [{ tools: { log_event: { ...le, max_events: 0 } } }, /its caps/],
    [{ tools: { log_event: { ...le, max_message: 100_000 } } }, /its caps/],
    [{ tools: { log_event: { ...le, secrets: undefined } } }, /secret shapes/],
    [{ tools: { log_event: { ...le, secrets: [{ name: 'x', regex: '(' }] } } }, /secret shapes/],
    [{ kind: undefined }, /isn't one this server reads/],
    [{ kind: 'interactive' }, /isn't one this server reads/],
    [{ launch_dir: 'relative' }, /isn't one this server reads/],
    [{ store: undefined }, /log_event needs the store/],
    [{ store: { dir: 'relative', repo_id: p.store.repo_id } }, /log_event needs the store/],
  ];
  for (const [change, re] of bad) assert.throws(() => checkPolicy({ ...p, ...change }), (err) => err instanceof PolicyError && re.test(err.message), JSON.stringify(change));
  // No log_event: no store needed.
  assert.doesNotThrow(() => checkPolicy({ ...p, store: undefined, tools: { run_check: { checks: ['lint'] } } }));
  assert.throws(() => checkPolicy({ ...p, schema: 'mirai-mcp-policy/1' }), /from an older MIRAI \(mirai-mcp-policy\/1\); start the launch again/);
});

test('15a T9: the broker probes stay canary-only and local, and the model is always Haiku', async () => {
  const { PROBES } = await import('../probes/broker-probes.js');
  assert.deepEqual(PROBES.map((p) => p.id), ['b1-log', 'b2-input', 'b2c-bash', 'b3-cli']);
  for (const p of PROBES) {
    if (p.secret) assert.ok(!p.prompt.includes('{canary}') && Object.values(p.inputs).every((v) => v.includes('{canary}')), `${p.id}: the canary only in the file`);
    else assert.match(p.prompt, /\{canary\}/, `${p.id} carries a canary`);
    assert.ok(!/curl|wget|http|ssh|~\/|\$HOME|\.config|keychain|token/i.test(p.prompt), p.id);
  }
  const text = readFileSync(new URL('../probes/broker-probes.js', import.meta.url), 'utf8');
  for (const m of text.matchAll(/'--model', ([^,\]]+)/g)) assert.equal(m[1].trim(), "'haiku'");
  assert.ok(!/claude-opus|claude-sonnet|'opus'|'sonnet'/.test(text));
  assert.ok(!/DOCKER|docker\.sock|tests\/docker\.js/.test(text), 'the broker probes need no Docker');
  assert.match(text, /mkdtempSync\(join\(process\.env\.HOME, '\.mirai-probes-'\)\)/, 'the fixture is under your home folder');
});
