import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import doctorCmd from '../../src/cli/commands/doctor.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { lockFiles, machoCpu, runChecks, summary } from '../../src/doctor/checks.js';
import { installHooks, hooksState } from '../../src/hooks/install.js';
import { COMMANDS } from '../../src/mcp/tools/commands.js';
import { TOOLS_FILE } from '../../src/ship/host.js';
import { acquireRunLock } from '../../src/store/global.js';
import { openStore } from '../../src/store/home.js';
import { passed } from '../proofs/fixture.js';
import { tempDir } from '../tests/run-fixture.js';

// Unit 29c: mirai doctor. A real store (a ticket planned, built and reviewed, so it has a branch
// in the registry, run logs and a run state), the red team and the session server stood in.

const LAUNCHER = fileURLToPath(new URL('../../bin/launch.js', import.meta.url));
const stubs = { redTeam: async () => ({ state: 'green', result: { created_at: '2026-11-14T10:00:00.000Z' }, parts: { claude_code: { version: '2.1.319' } } }), session: () => ({ state: 'current' }) };
const item = (items, id) => items.find((i) => i.id === id);
const run = async (f, args = {}) => {
  let out = '';
  const code = await doctorCmd.run({ positionals: [], values: args }, { cwd: f.root, env: f.env, stdout: { write: (s) => (out += s) }, doctor: stubs });
  return { code, out };
};
const deadPid = () => {
  // A pid nobody has: high and checked.
  for (let p = 4_000_000; p < 4_100_000; p++) {
    try {
      process.kill(p, 0);
    } catch (err) {
      if (err.code === 'ESRCH') return p;
    }
  }
  throw new Error('no free pid');
};

test('29c: the checks on a healthy store; the yellows that are always there; exit codes', async () => {
  const f = await passed();
  const store = openStore(f.io);
  installHooks({ store, env: f.env, node: process.execPath, launcher: LAUNCHER });
  const items = await runChecks({ cwd: f.root, env: f.env, ...stubs });
  assert.deepEqual(items.map((i) => i.id), ['login', 'strict', 'redteam', 'trust', 'registry', 'merge-gate', 'usage', 'store', 'hook', 'host-cli', 'cpu', 'key', 'session', 'baseline']);
  for (const id of ['login', 'redteam', 'registry', 'store', 'hook', 'key', 'session']) assert.equal(item(items, id).state, 'ok', `${id}: ${item(items, id).detail}`);
  assert.equal(item(items, 'merge-gate').state, 'yellow');
  assert.match(item(items, 'merge-gate').detail, /local-only/);
  assert.equal(item(items, 'host-cli').state, 'yellow', 'no gh or glab recorded in the fixture');
  for (const i of items) if (i.state !== 'ok') assert.ok(i.hint, `${i.id} has a hint`);
  assert.equal(summary([{ state: 'ok' }, { state: 'yellow' }, { state: 'red' }]), 'doctor: 1 ok, 1 yellow, 1 red');
  const r = await run(f);
  assert.equal(r.code, EXIT.OK, r.out);
  assert.match(r.out, /^to do:$/m);
  assert.match(r.out, /^doctor: \d+ ok, \d+ yellow, 0 red$/m);
  const j = JSON.parse((await run(f, { json: true })).out);
  assert.equal(j.items.length, 14);
  // On the session list, with its flags (decision 3).
  assert.deepEqual(COMMANDS.doctor.argv({ fix: true, json: true }), ['doctor', '--fix', '--json']);
  assert.equal(COMMANDS.doctor.quick, true);
});

test('29c: red items with their hints: the hook\'s Node gone, a host CLI gone, the token and the key; status says the hook isn\'t ok', async () => {
  const f = await passed();
  const store = openStore(f.io);
  const node = join(tempDir('node'), 'node');
  writeFileSync(node, '#!/bin/sh\n', { mode: 0o755 });
  installHooks({ store, env: f.env, node, launcher: LAUNCHER });
  assert.equal(hooksState({ store, env: f.env }).state, 'ok');
  rmSync(node);
  assert.equal(hooksState({ store, env: f.env }).state, 'changed', 'status stops saying ok');
  writeFileSync(join(store.dir, TOOLS_FILE), JSON.stringify({ schema_version: 1, github: '/nonexistent/gh' }));
  const items = await runChecks({ cwd: f.root, env: f.env, ...stubs });
  assert.equal(item(items, 'hook').state, 'red');
  assert.match(item(items, 'hook').detail, /isn't there: every push fails/);
  assert.match(item(items, 'hook').hint, /mirai init --refresh/);
  assert.equal(item(items, 'host-cli').state, 'red');
  assert.match(item(items, 'host-cli').detail, /\/nonexistent\/gh/);
  const r = await run(f);
  assert.equal(r.code, EXIT.NEEDS_HUMAN);
  // A red team that isn't green; a newer Claude Code installed.
  const stale = await runChecks({ cwd: f.root, env: f.env, ...stubs, redTeam: async () => ({ state: 'stale', parts: { claude_code: { version: '2.1.319' } } }) });
  assert.equal(item(stale, 'redteam').state, 'red');
  const newer = await runChecks({ cwd: f.root, env: f.env, ...stubs, redTeam: async () => ({ state: 'green', parts: { claude_code: { version: '2.1.319' } }, installed: { version: '2.1.325' } }) });
  assert.equal(item(newer, 'redteam').state, 'yellow');
  // An old token; no token.
  const tokenFile = join(f.home, '.config', 'mirai', 'claude-token');
  const { utimesSync } = await import('node:fs');
  const old = new Date(Date.now() - 340 * 86_400_000);
  utimesSync(tokenFile, old, old);
  assert.equal(item(await runChecks({ cwd: f.root, env: f.env, ...stubs }), 'login').state, 'yellow');
  rmSync(tokenFile);
  assert.equal(item(await runChecks({ cwd: f.root, env: f.env, ...stubs }), 'login').state, 'red');
  // The session server missing or foreign.
  assert.equal(item(await runChecks({ cwd: f.root, env: f.env, ...stubs, session: () => ({ state: 'missing' }) }), 'session').state, 'yellow');
  assert.equal(item(await runChecks({ cwd: f.root, env: f.env, ...stubs, session: () => ({ state: 'foreign' }) }), 'session').state, 'red');
});

test('29c: --fix repairs a dead process\'s lock and breaker, the run state and the registry; a live lock, a running run and a broken journal line are left alone', async () => {
  const f = await passed();
  const store = openStore(f.io);
  installHooks({ store, env: f.env, node: process.execPath, launcher: LAUNCHER });
  const dead = deadPid();
  const lock = join(store.dir, 'locks', 'tests.lock');
  const breaker = join(store.dir, 'locks', 'journal.lock.break');
  const live = join(store.dir, 'locks', 'mine.lock');
  for (const [p, pid] of [[lock, dead], [breaker, dead], [live, process.pid]]) writeFileSync(p, `${JSON.stringify({ pid, host: 'h', purpose: 'test', started_at: new Date().toISOString() })}\n`, { mode: 0o600 });
  assert.equal(lockFiles(store, f.env).filter((l) => !l.holder.alive).length, 2);
  rmSync(join(store.dir, 'state.json'));
  rmSync(join(store.dir, 'branches.json'));
  let items = await runChecks({ cwd: f.root, env: f.env, ...stubs });
  assert.equal(item(items, 'store').state, 'red');
  assert.equal(item(items, 'store').fix, 'locks');
  assert.equal(item(items, 'registry').state, 'red');
  assert.equal(item(items, 'registry').fix, 'registry');

  const r = await run(f, { fix: true });
  assert.match(r.out, /^fixed locks: removed 2/m);
  assert.ok(!existsSync(lock) && !existsSync(breaker), 'the dead ones are gone');
  assert.ok(existsSync(live), 'a live process\'s lock stays');
  assert.match(r.out, /^fixed registry: rebuilt: 1 entry/m);
  // The run state was hidden behind the locks: the same --fix checks again and rebuilds it.
  assert.match(r.out, /^fixed run-state: rebuilt from run r-/m);
  rmSync(live);
  items = await runChecks({ cwd: f.root, env: f.env, ...stubs });
  assert.equal(item(items, 'store').state, 'ok', item(items, 'store').detail);
  assert.equal(item(items, 'registry').state, 'ok', item(items, 'registry').detail);

  // While a run holds the run lock, the run state is left as it is.
  rmSync(join(store.dir, 'state.json'));
  const held = acquireRunLock(store, 'r-20261114-000000-abcd', f.env);
  try {
    const r3 = await run(f, { fix: true });
    assert.match(r3.out, /^not fixed run-state: a run holds the run lock/m);
  } finally {
    held.release?.();
  }

  // A broken journal line: named red, never fixed, the bytes unchanged.
  const journal = join(store.dir, 'journal.jsonl');
  const before = readFileSync(journal);
  writeFileSync(journal, Buffer.concat([before, Buffer.from('{"broken": \n')]));
  const broken = readFileSync(journal);
  const r4 = await run(f, { fix: true });
  assert.equal(r4.code, EXIT.NEEDS_HUMAN);
  assert.match(r4.out, /^red {5}Store/m);
  assert.deepEqual(readFileSync(journal), broken, 'history is never rewritten');
  writeFileSync(journal, before);
});

test('29c: the agents\' binary CPU from its Mach-O header', () => {
  const dir = tempDir('macho');
  const write = (name, hex) => {
    const p = join(dir, name);
    writeFileSync(p, Buffer.from(hex, 'hex'));
    chmodSync(p, 0o755);
    return p;
  };
  assert.equal(machoCpu(write('arm', 'cffaedfe0c000001')), 'arm64');
  assert.equal(machoCpu(write('intel', 'cffaedfe07000001')), 'x64');
  assert.equal(machoCpu(write('fat', 'cafebabe00000002')), 'universal');
  assert.equal(machoCpu(write('script', '23212f62696e2f73')), null);
  assert.equal(machoCpu(join(dir, 'none')), null);
});
