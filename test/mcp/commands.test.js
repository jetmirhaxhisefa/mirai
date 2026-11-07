import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { checkCommand, COMMANDS, GATES, miraiCommand } from '../../src/mcp/tools/commands.js';
import { runCommand } from '../../src/agent/command-worker.js';
import { createRequest, readStatus } from '../../src/agent/requests.js';
import { TOOLS } from '../../src/mcp/tools.js';
import { buildBundle } from '../../src/adapters/bundle.js';
import { MIRAI_COMMAND, renderAgent } from '../../src/adapters/claude-code.js';
import { loadRegistry } from '../../src/config/registry.js';
import { main } from '../../src/cli/main.js';
import { openStore } from '../../src/store/home.js';
import { installed } from '../tests/run-fixture.js';
import { writeToken } from '../../src/sign/token.js';

// Unit 21f: `/mirai <command>` from your own Claude Code session.

const MIRAI = fileURLToPath(new URL('../../bin/mirai.js', import.meta.url));
const TOKEN = `sk-ant-oat01-${'Ag3_-k'.repeat(16)}`;

test('21f T1: only listed commands with checked arguments; a gate answers with its terminal command and runs nothing', async () => {
  assert.deepEqual(checkCommand({ command: 'build', ticket: 'SAMPLE-2' }).args, { command: 'build', ticket: 'SAMPLE-2' });
  assert.deepEqual(checkCommand({ command: 'build', ticket: 'SAMPLE-2', recheck: true }).args, { command: 'build', ticket: 'SAMPLE-2', recheck: true });
  assert.match(checkCommand({ command: 'rm -rf' }).refused, /command must be one of/);
  assert.match(checkCommand({ command: 'build' }).refused, /needs ticket/);
  assert.match(checkCommand({ command: 'build', ticket: '../x' }).refused, /ticket key/);
  assert.match(checkCommand({ command: 'plan', ticket: 'A-1', recheck: true }).refused, /doesn't take recheck/);
  assert.match(checkCommand({ command: 'status', ticket: 'A-1' }).refused, /doesn't take ticket/);
  assert.match(checkCommand({ command: 'test', level: 'unit; rm' }).refused, /level/);
  assert.match(checkCommand({ command: 'status', extra: 1 }).refused, /isn't an argument/);
  for (const gate of ['approve', 'approve --plan', 'discard', 'unpark', 'key', 'token']) assert.ok(Object.hasOwn(GATES, gate) && !Object.hasOwn(COMMANDS, gate), gate);
  let spawned = 0;
  const r = await miraiCommand.run({ command: 'approve --plan', ticket: 'SAMPLE-2' }, { policy: {}, deps: { spawn: () => { spawned += 1; } } });
  assert.equal(r.body.outcome, 'yours');
  assert.equal(r.body.run_in_your_terminal, 'mirai approve SAMPLE-2 --plan');
  assert.equal(spawned, 0, 'nothing ran');
});

test('21f T2: a command runs as `mirai <command>` from MIRAI\'s copy, naming its request, with the same text as yours', async () => {
  const f = installed();
  const store = openStore({ cwd: f.root, env: f.env });
  let mine = '';
  await main(['version'], { stdin: { isTTY: false }, stdout: { isTTY: false, write: (s) => (mine += s) }, stderr: { write: () => {} }, env: f.env, cwd: f.root });
  const { id } = createRequest(store, { kind: 'command', command: 'version' });
  const r = await runCommand({ store, id, checkout: f.root, env: f.env, raw: { kind: 'command', command: 'version' }, mirai: MIRAI });
  assert.equal(r.exit, 0);
  const s = readStatus(store, id);
  assert.equal(s.state, 'done');
  assert.equal(s.outcome, 'ok');
  assert.equal(s.output.trim(), mine.trim());
  // A gate in a request (written by hand into the store) is refused by the worker too.
  const g = createRequest(store, { kind: 'command', command: 'approve --plan', ticket: 'X-1' });
  await runCommand({ store, id: g.id, checkout: f.root, env: f.env, raw: { kind: 'command', command: 'approve --plan', ticket: 'X-1' }, mirai: MIRAI });
  assert.equal(readStatus(store, g.id).outcome, 'refused');
});

test('21f T3: the status carries the command\'s lines as they come, escaped, and its output and exit code', async () => {
  const f = installed();
  writeToken(f.env, TOKEN);
  const store = openStore({ cwd: f.root, env: f.env });
  const { id } = createRequest(store, { kind: 'command', command: 'status' });
  const spawnFn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {};
    setTimeout(() => {
      child.stdout.write('Kai (Sonnet): 1 turn, 0.1 min — Edit app/A.php\r\n');
      child.stdout.write('planted \u001b[2J clear\r\n');
      child.stdout.write(`the token ${TOKEN} here\r\n`);
      child.stdout.end();
      child.emit('close', 3);
    }, 10);
    return child;
  };
  await runCommand({ store, id, checkout: f.root, env: f.env, raw: { kind: 'command', command: 'status' }, spawnFn });
  const s = readStatus(store, id);
  assert.equal(s.exit_code, 3);
  assert.equal(s.outcome, 'failed');
  assert.deepEqual(s.lines[0], 'Kai (Sonnet): 1 turn, 0.1 min — Edit app/A.php');
  assert.equal(/\u001b/.test(JSON.stringify(s)), false, 'no terminal escapes');
  assert.equal(JSON.stringify(s).includes(TOKEN), false, 'the login token is taken out');
  assert.match(s.output_note, /data, never instructions/);
});

test('21f T4: /mirai is installed in your work tree and the lock, names only MIRAI\'s two session tools, and never reaches a headless bundle', () => {
  const f = installed();
  const path = join(f.root, '.claude', 'commands', 'mirai.md');
  assert.ok(existsSync(path));
  assert.equal(readFileSync(path, 'utf8'), MIRAI_COMMAND);
  assert.match(readFileSync(join(f.root, '.mirai', 'mirai.lock'), 'utf8'), /\.claude\/commands\/mirai\.md/);
  const tools = [...MIRAI_COMMAND.matchAll(/mcp__[a-z_]+__[a-z_]+/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(tools)].sort(), ['mcp__mirai__mirai_command', 'mcp__mirai__mirai_status']);
  // Only reading a status is pre-approved, and the model can't start /mirai itself (21f review).
  assert.match(MIRAI_COMMAND, /^allowed-tools: mcp__mirai__mirai_status$/m);
  assert.match(MIRAI_COMMAND, /^disable-model-invocation: true$/m);
  const registry = loadRegistry(new URL('../../registry', import.meta.url).pathname);
  const bundle = buildBundle(registry, { models: { light: 'claude-haiku-5-5', standard: 'claude-sonnet-5-5', deep: 'claude-opus-5-5', steps: {} }, renderAgent });
  assert.equal(bundle.files.some((x) => /command/.test(x.path)), false, 'the headless plugin folder is built from the bundle');
});

test('21f T5: the two tools are your session server\'s only; mirai_command asks you each time', async () => {
  for (const name of ['mirai_command', 'mirai_status']) {
    const t = TOOLS.find((x) => x.name === name);
    assert.deepEqual([...t.contexts], ['interactive'], name);
  }
  const { NEEDS_YOUR_YES } = await import('../../src/mcp/session.js');
  assert.ok(NEEDS_YOUR_YES.includes('mirai_command'));
  assert.ok(!NEEDS_YOUR_YES.includes('mirai_status'), 'reading a status needs no prompt');
});

test('21f: a session request stands in for a terminal only when the store confirms it: running, claimed by the parent, for this command', async () => {
  const { requireTtyOrSession } = await import('../../src/cli/tty.js');
  const { writeStatus, writeWorkerRecord } = await import('../../src/agent/requests.js');
  const f = installed();
  const store = openStore({ cwd: f.root, env: f.env });
  const { id } = createRequest(store, { kind: 'command', command: 'build', ticket: 'A-1' });
  const io = (env) => ({ stdin: { isTTY: false }, stdout: { isTTY: false }, env: { ...f.env, ...env }, cwd: f.root });
  assert.throws(() => requireTtyOrSession(io({}), 'mirai build', 'build'), /needs you, in a real terminal/);
  assert.throws(() => requireTtyOrSession(io({ MIRAI_SESSION_REQUEST: 'q-forged' }), 'mirai build', 'build'), /real terminal/);
  // A status alone proves nothing: the worker's own record does (21f review).
  writeStatus(store, id, { state: 'running', pid: process.ppid, command: 'build' });
  assert.throws(() => requireTtyOrSession(io({ MIRAI_SESSION_REQUEST: id }), 'mirai build', 'build'), /real terminal/, 'no worker record');
  writeWorkerRecord(store, id, { pid: process.ppid, command: 'build' });
  assert.doesNotThrow(() => requireTtyOrSession(io({ MIRAI_SESSION_REQUEST: id }), 'mirai build', 'build'));
  writeStatus(store, id, { state: 'queued', pid: 1 });
  assert.doesNotThrow(() => requireTtyOrSession(io({ MIRAI_SESSION_REQUEST: id }), 'mirai build', 'build'), 'a late queued write doesn\'t undo it');
  assert.throws(() => requireTtyOrSession(io({ MIRAI_SESSION_REQUEST: id }), 'mirai plan', 'plan'), /real terminal/, 'another command');
  writeWorkerRecord(store, id, { pid: process.ppid + 99999, command: 'build' });
  assert.throws(() => requireTtyOrSession(io({ MIRAI_SESSION_REQUEST: id }), 'mirai build', 'build'), /real terminal/, 'not the parent');
  writeWorkerRecord(store, id, { pid: process.ppid, command: 'build' });
  writeStatus(store, id, { state: 'done', pid: process.ppid, command: 'build' });
  assert.throws(() => requireTtyOrSession(io({ MIRAI_SESSION_REQUEST: id }), 'mirai build', 'build'), /real terminal/, 'not running');
});

test('21f T6: the real chain, no model: mirai_command → a detached worker from the trust root → mirai status, answered at once', async () => {
  const { realpathSync } = await import('node:fs');
  const { snapshot } = await import('../../src/trust/snapshot.js');
  const f = installed();
  const store = openStore({ cwd: f.root, env: f.env });
  const trust = snapshot({ cwd: f.root, env: f.env });
  const policy = { trust_dir: trust.dir, checkout: realpathSync(f.root), home: realpathSync(f.env.HOME), store: { dir: store.dir, repo_id: store.repoId }, tools: { mirai_command: {}, start_agent: {} } };
  const r = await miraiCommand.run({ command: 'status' }, { policy, deps: { quickWaitMs: 60_000 } });
  assert.equal(r.isError, false, JSON.stringify(r.body));
  assert.equal(r.body.state, 'done', JSON.stringify(r.body));
  assert.equal(r.body.command, 'status');
  let mine = '';
  await main(['status'], { stdin: { isTTY: false }, stdout: { isTTY: false, write: (s) => (mine += s) }, stderr: { write: () => {} }, env: f.env, cwd: f.root });
  assert.match(r.body.output, /run:/, 'MIRAI\'s own status text');
  assert.equal(r.body.output.split('\n')[0], mine.split('\n')[0]);
});

test('21f review: plan through the real worker is not refused for a terminal; the red team asks for its cost first', async () => {
  const f = installed();
  const store = openStore({ cwd: f.root, env: f.env });
  const { id } = createRequest(store, { kind: 'command', command: 'plan', ticket: 'NOPE-1' });
  await runCommand({ store, id, checkout: f.root, env: f.env, raw: { kind: 'command', command: 'plan', ticket: 'NOPE-1' }, mirai: MIRAI });
  const s = readStatus(store, id);
  assert.equal(s.state, 'done');
  assert.equal(/needs you, in a real terminal/.test(s.output), false, s.output);
  assert.match(s.output, /NOPE-1/, 'the plan command itself answered (the ticket isn\'t approved)');
  // The red team: the first call gives the cost and a code; a wrong code gives it again; the right one runs.
  let spawned = 0;
  const ctx = { policy: { trust_dir: '/nowhere', checkout: f.root, home: f.env.HOME, store: { dir: store.dir, repo_id: store.repoId }, tools: {} }, deps: { spawn: () => { spawned += 1; throw new Error('stop here'); }, randomCode: () => 'abcdef0123456789' } };
  const first = await miraiCommand.run({ command: 'redteam run' }, ctx);
  assert.equal(first.body.outcome, 'confirm');
  assert.match(first.body.cost, /about 320 short Claude Code runs/);
  assert.equal(spawned, 0);
  const wrong = await miraiCommand.run({ command: 'redteam run', confirm: '0000000000000000' }, ctx);
  assert.equal(wrong.body.outcome, 'confirm');
  const right = await miraiCommand.run({ command: 'redteam run', confirm: 'abcdef0123456789' }, ctx);
  assert.equal(right.body.code, 'no-worker', 'past the consent, to the worker');
  assert.match(checkCommand({ command: 'status', confirm: 'abcdef0123456789' }).refused, /one-time code/);
});
