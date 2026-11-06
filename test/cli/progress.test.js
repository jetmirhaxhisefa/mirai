import { test } from 'node:test';
import assert from 'node:assert/strict';

import { main } from '../../src/cli/main.js';
import { progressPrinter } from '../../src/cli/progress.js';
import { openStore } from '../../src/store/home.js';
import { newRunId, startRun, writeHeartbeat } from '../../src/store/run.js';
import { installed } from '../tests/run-fixture.js';

// Unit 21e: what a step prints while it runs, and what `mirai status` shows from another terminal.

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

test('21e T2: a line per tool call at most every 5 s, a "still working" line after 15 s of quiet, each check as it starts and ends', async () => {
  let t = 0;
  const out = [];
  const p = progressPrinter({ stderr: { write: (s) => out.push(s.trimEnd()) } }, { now: () => t, tickMs: 2 });
  p.onProgress({ kind: 'started', agent: 'Kai', model: 'claude-sonnet-5-5', turns: 0, minutes: 0 });
  p.onProgress({ kind: 'tool', agent: 'Kai', model: 'claude-sonnet-5-5', turns: 1, minutes: 0.1, tool: 'Edit', target: 'app/A.php' });
  t = 2_000;
  p.onProgress({ kind: 'tool', agent: 'Kai', model: 'claude-sonnet-5-5', turns: 2, minutes: 0.2, tool: 'Edit', target: 'app/B.php' });
  t = 6_000;
  p.onProgress({ kind: 'tool', agent: 'Kai', model: 'claude-sonnet-5-5', turns: 3, minutes: 0.3, tool: 'run_tests', target: 'unit' });
  assert.deepEqual(out, ['Kai (Sonnet): started', 'Kai (Sonnet): 1 turn, 0.1 min — Edit app/A.php', 'Kai (Sonnet): 3 turns, 0.3 min — run_tests unit'], 'the second call fell inside 5 s');
  t = 22_000;
  await sleep(20);
  assert.match(out.at(-1), /^Kai \(Sonnet\): 3 turns, [\d.]+ min — still working \(last: run_tests unit\)$/);
  p.onProgress({ kind: 'ended', agent: 'Kai', model: 'claude-sonnet-5-5', turns: 9, minutes: 8.9, outcome: 'handed over' });
  p.onCheck({ kind: 'check', name: 'unit', state: 'running' });
  t = 40_000;
  await sleep(20);
  assert.match(out.at(-1), /^MIRAI's checks: unit still running \(18 s\)$/);
  p.onCheck({ kind: 'check', name: 'unit', state: 'pass, only known failures', seconds: 56 });
  p.stop();
  assert.ok(out.includes("MIRAI's checks: unit running…"));
  assert.equal(out.at(-1), "MIRAI's checks: unit pass, only known failures (56 s)");
});

test('21e T3: mirai status names the running step and its last progress line, from the heartbeat', async () => {
  const f = installed();
  const store = openStore({ cwd: f.root, env: f.env });
  const runId = newRunId();
  startRun(store, { runId, preset: 'supervised' });
  writeHeartbeat(store, { runId, ticket: 'SAMPLE-2', step: 'build', progress: 'Kai (Sonnet): 7 turns, 5.3 min — run_tests unit' });
  let out = '';
  const code = await main(['status'], { stdin: { isTTY: false }, stdout: { isTTY: false, write: (s) => (out += s) }, stderr: { write: () => {} }, env: f.env, cwd: f.root });
  assert.ok([0, 2, 3, 4].includes(code));
  assert.match(out, /ticket SAMPLE-2 \(build\)/);
  assert.match(out, /— Kai \(Sonnet\): 7 turns, 5\.3 min — run_tests unit/);
  // A line with a control character is refused, never written.
  assert.throws(() => writeHeartbeat(store, { runId, progress: 'a\u001b[2Jb' }), /progress/);
});

test('21e review: one "preparing" line per step, and "still preparing" while it lasts', async () => {
  let t = 0;
  const out = [];
  const p = progressPrinter({ stderr: { write: (s) => out.push(s.trimEnd()) } }, { now: () => t, tickMs: 2 });
  p.onProgress({ kind: 'preparing', agent: 'Kai', model: null, turns: 0, minutes: 0 });
  p.onProgress({ kind: 'preparing', agent: 'Kai', model: null, turns: 0, minutes: 0 });
  t = 16_000;
  await sleep(20);
  p.stop();
  assert.deepEqual(out, ["Kai: preparing the launch (MIRAI's checks and the red team's gate)", 'Kai: still preparing the launch']);
});

test('21e review: init --refresh names the baseline step', async () => {
  const f = installed();
  let out = '';
  const code = await main(['init', '--refresh'], { stdin: { isTTY: false }, stdout: { isTTY: false, write: (s) => (out += s) }, stderr: { write: () => {} }, env: f.env, cwd: f.root });
  assert.equal(code, 0, out);
  assert.match(out, /mirai baseline\s+\(on the integration branch, after the commit: a build is judged against it\)/);
});
