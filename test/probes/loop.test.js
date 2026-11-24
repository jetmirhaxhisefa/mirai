import { test } from 'node:test';
import assert from 'node:assert/strict';

import { probeLoop, waitForConfirmed } from './loop.js';

// `--probe loop` (Jet, 2026-11-24, "A"): test tooling only, checked with a fake run and a fake
// clock (no model, no wait).
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

test('probe loop: a pause, your confirmed interview, then a run that ends done', async () => {
  const c = clock();
  const ends = [{ state: 'paused', question_id: 'Q-9', question: 'A new lead\'s pins' }, { state: 'done' }];
  // The interview: paused for 3 polls, then confirmed with a lint problem, then confirmed clean.
  const states = [{ state: 'paused', errors: 0, stamp: 'a' }, { state: 'paused', errors: 0, stamp: 'a' }, { state: 'paused', errors: 0, stamp: 'b' }, { state: 'confirmed', errors: 1, stamp: 'c' }];
  let polls = 0;
  const interview = () => states[polls++] ?? { state: 'confirmed', errors: 0, stamp: 'd' };
  const commits = [];
  const lines = [];
  let runs = 0;
  const r = await probeLoop({ runOnce: async () => ends[runs++], interview, commit: (m) => commits.push(m), resumeMessage: (e) => `resume at ${e.question_id}`, log: (l) => lines.push(l), pollMs: 1000, settleMs: 3000, sleep: c.sleep, now: c.now });
  assert.equal(r.state, 'done');
  assert.equal(r.runs, 2);
  assert.deepEqual(commits, ['probe: the interview after Q-9, as the session left it']);
  const out = lines.join('\n');
  assert.match(out, /PAUSED on Q-9: A new lead's pins/);
  assert.match(out, /resume at Q-9/);
  assert.match(out, /waiting: interview.md is paused/);
  assert.match(out, /waiting: interview.md has 1 lint problem/);
});

test('probe loop: a failed run ends the loop at once; the cap stops endless pauses', async () => {
  const c = clock();
  const ok = { state: 'confirmed', errors: 0, stamp: 'x' };
  const r1 = await probeLoop({ runOnce: async () => ({ state: 'failed', why: 'x' }), interview: () => ok, commit: () => {}, resumeMessage: () => '', log: () => {}, sleep: c.sleep, now: c.now });
  assert.deepEqual([r1.state, r1.runs], ['failed', 1]);
  let n = 0;
  const r2 = await probeLoop({ runOnce: async () => ({ state: 'paused', question_id: `Q-${++n}` }), interview: () => ({ ...ok, stamp: `s${n}` }), commit: () => {}, resumeMessage: () => '', log: () => {}, maxRuns: 3, pollMs: 1000, settleMs: 2000, sleep: c.sleep, now: c.now });
  assert.deepEqual([r2.state, r2.runs], ['stopped', 3]);
});

test('probe loop: waits for the file to settle, and gives up after the wait', async () => {
  const c = clock();
  // Confirmed but still changing: not ready until two polls see the same bytes for settleMs.
  let k = 0;
  const changing = () => ({ state: 'confirmed', errors: 0, stamp: k < 3 ? `v${k++}` : 'final' });
  const w = await waitForConfirmed({ interview: changing, log: () => {}, pollMs: 1000, settleMs: 2000, waitMs: 60000, sleep: c.sleep, now: c.now });
  assert.equal(w.ok, true);
  assert.ok(c.now() >= 5000);
  const c2 = clock();
  const g = await waitForConfirmed({ interview: () => ({ state: 'paused', errors: 0, stamp: 'p' }), log: () => {}, pollMs: 1000, settleMs: 2000, waitMs: 10000, sleep: c2.sleep, now: c2.now });
  assert.equal(g.ok, false);
  assert.match(g.why, /no confirmed interview/);
});
