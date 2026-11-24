// `--probe loop` (Jet, 2026-11-24, "A", from 41's P4: faster, with the same checks): one command a
// probe. It runs the agent's run; on a pause it prints the question and the message to paste into
// your session, waits until your session has confirmed the interview again (interview.md's state
// `confirmed`, lint clean, the file unchanged for a few seconds), commits it, and starts the run
// again. Test tooling only: every check (the lint, Vera, the reader test, the pause itself) runs
// inside the run as it does from `--probe write`; the loop only saves you retyping the command.
//
// Shared by 41's probes (Nora) and 42's (Tess): the caller passes how to run once, how to read the
// interview, and how to commit.
//
//   runOnce()      -> { state: 'done' | 'paused' | 'failed', question_id?, question? }
//   interview()    -> { state, errors, stamp } | null   (stamp: anything that changes when the file does)
//   commit(msg)    -> commits what the session left (a no-op on a clean tree)
//   resumeMessage(end) -> the line to paste into your session after a pause

export const LOOP_DEFAULTS = Object.freeze({ maxRuns: 8, pollMs: 5000, settleMs: 5000, waitMs: 3 * 60 * 60 * 1000 });

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Waits for the confirmed interview: { ok: true } or { ok: false, why }.
export async function waitForConfirmed({ interview, log, pollMs, settleMs, waitMs, sleep = realSleep, now = Date.now }) {
  const start = now();
  let seen = null;
  let since = null;
  let lastWhy = '';
  for (;;) {
    const i = interview();
    const ready = i && i.state === 'confirmed' && i.errors === 0;
    if (ready) {
      if (seen !== i.stamp) {
        seen = i.stamp;
        since = now();
      } else if (now() - since >= settleMs) return { ok: true };
    } else {
      seen = null;
      const why = !i ? 'interview.md isn\'t there' : i.state !== 'confirmed' ? `interview.md is ${i.state}` : `interview.md has ${i.errors} lint problem(s)`;
      if (why !== lastWhy) log(`waiting: ${why} (your session confirms it when you've answered)`);
      lastWhy = why;
    }
    if (now() - start >= waitMs) return { ok: false, why: `no confirmed interview after ${Math.round(waitMs / 60000)} minutes` };
    await sleep(pollMs);
  }
}

// The loop: { state, runs, ends } with the last run's state ('done', 'failed', 'paused' when the
// wait ran out, or 'stopped' at maxRuns).
export async function probeLoop({ runOnce, interview, commit, resumeMessage, log, maxRuns = LOOP_DEFAULTS.maxRuns, pollMs = LOOP_DEFAULTS.pollMs, settleMs = LOOP_DEFAULTS.settleMs, waitMs = LOOP_DEFAULTS.waitMs, sleep, now }) {
  const ends = [];
  for (let run = 1; run <= maxRuns; run += 1) {
    log(`--- run ${run} of at most ${maxRuns} ---`);
    const end = await runOnce();
    ends.push(end);
    if (end.state !== 'paused') return { state: end.state, runs: run, ends };
    log('');
    log(`PAUSED on ${end.question_id}: ${end.question ?? ''}`);
    log('Paste this into your session (one message):');
    log('');
    log(`   ${resumeMessage(end)}`);
    log('');
    log('Answer it there and confirm the restatement; the loop starts the run again by itself (Ctrl-C stops it).');
    const w = await waitForConfirmed({ interview, log, pollMs, settleMs, waitMs, sleep, now });
    if (!w.ok) {
      log(`stopped: ${w.why}. Start it again with the same command once you've confirmed.`);
      return { state: 'paused', runs: run, ends };
    }
    commit(`probe: the interview after ${end.question_id}, as the session left it`);
    log(`interview confirmed and committed; run ${run + 1} starts.`);
  }
  log(`stopped after ${maxRuns} runs, still paused: look at the pauses above.`);
  return { state: 'stopped', runs: maxRuns, ends };
}
