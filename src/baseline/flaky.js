// Flaky versus failing (unit 17b; unit 02 review's P7): a test the baseline saw fail is run again,
// by its file, until it has both passed and failed, or has failed every time up to a bound. This
// is the bookkeeping, apart from the runs: a test's history, and what it adds up to.

export const RERUN_LIMITS = Object.freeze({ runsPerFile: 10, reruns: 50, filesPerLevel: 50 });

// A test's state from its history { runs, passed, failed, stop? }:
//   flaky      passed and failed;
//   failing    failed in every run, `runsPerFile` of them;
//   unchecked  anything else, with the reason (a bound, a rerun that didn't run it, a fault).
export function stateOf(h, { runsPerFile = RERUN_LIMITS.runsPerFile } = {}) {
  if (h.passed > 0 && h.failed > 0) return { state: 'flaky' };
  if (h.failed === h.runs && h.runs >= runsPerFile) return { state: 'failing' };
  return { state: 'unchecked', reason: h.stop ?? 'rerun limit' };
}

// A run's outcome for each test ID in its cases (from cases.json): 'pass', 'fail' (fail or
// error), or 'skip'. A test ID listed more than once (a runner's several projects) fails when
// any of its cases fails; `duplicates` counts such IDs.
export function outcomesOf(cases) {
  const out = new Map();
  let duplicates = 0;
  const seen = new Set();
  for (const c of cases) {
    if (typeof c?.id !== 'string') continue;
    const o = c.outcome === 'fail' || c.outcome === 'error' ? 'fail' : c.outcome === 'pass' ? 'pass' : 'skip';
    if (seen.has(c.id)) {
      if (!out.has(`\0dup:${c.id}`)) duplicates++;
      out.set(`\0dup:${c.id}`, true);
    }
    seen.add(c.id);
    const before = out.get(c.id);
    out.set(c.id, before === 'fail' || o === 'fail' ? 'fail' : before === 'pass' || o === 'pass' ? 'pass' : 'skip');
  }
  for (const k of [...out.keys()]) if (k.startsWith('\0dup:')) out.delete(k);
  return { outcomes: out, duplicates };
}

// The file part of a test ID (`<path>::<name>`), or null for an ID without one.
export const fileOf = (id) => (id.indexOf('::') > 0 ? id.slice(0, id.indexOf('::')) : null);

// Adds one rerun of a file to the histories. `first` is the first run's outcomes; `pending` the
// IDs still being decided in this file. A pending test the rerun didn't run stops (it can't be
// rerun by its file: a loader's other name for it, say); a test that passed in the first run
// and fails now is added, as flaky. Returns the IDs still pending.
export function addRerun(histories, { first, rerun, file, pending }) {
  const still = [];
  for (const id of pending) {
    const h = histories.get(id);
    const o = rerun.get(id);
    if (o === undefined || o === 'skip') {
      h.stop = o === 'skip' ? 'skipped when its file ran again' : 'a rerun of its file didn\'t run it';
      continue;
    }
    h.runs++;
    if (o === 'pass') h.passed++;
    else h.failed++;
    if (!(h.passed > 0 && h.failed > 0)) still.push(id);
  }
  for (const [id, o] of rerun) {
    if (o !== 'fail' || histories.has(id) || first.get(id) !== 'pass' || fileOf(id) !== file) continue;
    histories.set(id, { runs: 2, passed: 1, failed: 1, first: 'pass' });
  }
  return still;
}
