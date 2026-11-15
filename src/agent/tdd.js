import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readFrontmatter } from '../lint/frontmatter.js';
import { symbolsIn, tableIn } from '../lint/checks.js';
import { scanMarkdown } from '../lint/markdown.js';
import { changedLines, lsTree } from '../store/git.js';

// Test-first, proven (unit 23; Q7, Q8, R2-M7; Jet's decisions 2026-11-15):
// 1. a red handover: Kai writes the plan's tests and a stub for each new symbol, MIRAI commits it
//    and runs every `red` row, which must fail by an assertion, and every `characterization` row,
//    which must pass; then Kai makes them green, and the tests are locked;
// 2. a test file that existed at the baseline, or one the red commit wrote, only grows: a removed
//    or changed line in it stops the ticket unless the plan declares a `test-change` for that file
//    (the baseline's files only: nothing unlocks a red test but a new plan); a new skip or focus
//    marker stops it either way;
// 3. the plan's two `tdd: auto` rules are the lint's (src/lint/checks.js).
// Which files are tests is MIRAI's own run's word: a file that holds a case of a level's run.

export const MAX_RED_ROUNDS = 2;

// The plan's test list as rows: { test, id, path, name, symbols, acs, level, kind, reason }.
// kind: 'red' | 'after' | 'characterization', or null for a no-test row; `after: <reason>` is an
// after row with its reason. `id` is the Test ID as written: a project path, or `<path>::<name>`.
export function testRows(plan) {
  let fm = null;
  try {
    fm = readFrontmatter(plan);
  } catch {
    fm = null;
  }
  const body = fm ? fm.body : plan;
  const table = tableIn({ scan: scanMarkdown(body, { firstLine: fm?.bodyLine ?? 1 }) }, 'Test list');
  const rows = [];
  for (const r of table?.rows ?? []) {
    const cell = (k) => String(r.cells[k] ?? '').trim();
    const raw = cell('kind');
    const m = /^(red|after|characterization)\b(?::\s*(.*))?$/i.exec(raw);
    const id = cell('test id').replace(/`/g, '').trim().replace(/^\.\//, '');
    const sep = id.indexOf('::');
    rows.push({
      test: cell('test'), id, path: sep >= 0 ? id.slice(0, sep) : id, name: sep >= 0 ? id.slice(sep + 2) : null,
      symbols: symbolsIn(r.raw?.symbol ?? ''),
      acs: cell('ac').split(',').map((x) => x.trim()).filter(Boolean), level: cell('level'),
      kind: m ? m[1].toLowerCase() : null, reason: m?.[2]?.trim() || null, line: r.line,
    });
  }
  return rows;
}

// The ticket's effective tdd: the plan's frontmatter (MIRAI wrote it from the ticket and config).
export const tddOf = (fm, config) => (['auto', 'first', 'after'].includes(fm?.tdd) ? fm.tdd : ['auto', 'first', 'after'].includes(config?.testing?.tdd) ? config.testing.tdd : 'auto');

// The rows the red check runs: red and characterization ones with a Test ID. With `tdd: after`, none.
export const redRows = (rows, tdd) => (tdd === 'after' ? [] : rows.filter((r) => (r.kind === 'red' || r.kind === 'characterization') && r.id !== ''));

// One row's verdict from MIRAI's run of its Test ID (src/tests/results.js's result):
// - red: at least one case of it fails by an assertion, and none fails any other way (an error, a
//   load failure, nothing found: the wrong reason; all passing: "passes already");
// - characterization: it ran, and every case passes.
// `known`: test IDs the baseline already knows as failing, left out.
export function rowVerdict(row, result, known = new Set()) {
  const failing = (Array.isArray(result?.failing) ? result.failing : []).filter((f) => !(f.id && known.has(f.id)));
  const first = (list) => (list[0]?.message ? String(list[0].message).slice(0, 300) : null);
  if (!result || ['timeout', 'env-fault', 'refused'].includes(result.outcome)) return { verdict: 'unknown', message: result?.message ? String(result.message).slice(0, 300) : `the run ended ${result?.outcome ?? 'without a result'}` };
  const wrong = failing.filter((f) => f.kind !== 'assertion');
  if (row.kind === 'characterization') {
    if (failing.length === 0 && (result.tests?.passed ?? 0) > 0) return { verdict: 'ok', message: null };
    return { verdict: 'fails', message: first(failing) ?? 'it ran no test' };
  }
  if (wrong.length) return { verdict: 'wrong-reason', kind: wrong[0].kind, message: first(wrong) };
  const asserted = failing.filter((f) => f.kind === 'assertion');
  if (asserted.length) return { verdict: 'ok', message: first(asserted) };
  return { verdict: 'passes', message: null };
}

const WHY = {
  passes: 'passes already, before the code: it proves nothing yet',
  'wrong-reason': (v) => `fails with ${v.kind === 'load' ? 'a load or compile error' : v.kind === 'not-found' ? 'no test found' : 'an error'}, not an assertion${v.message ? `: ${v.message}` : ''} (a stub for each new symbol makes it fail by its check)`,
  fails: (v) => `a characterization test must pass on today's code, and fails${v.message ? `: ${v.message}` : ''}`,
  unknown: (v) => `couldn't be judged: ${v.message}`,
};
export const rowWhy = (v) => (typeof WHY[v.verdict] === 'function' ? WHY[v.verdict](v) : WHY[v.verdict] ?? v.verdict);

// The red check: each row's Test ID run at its level, through `run` (runTest's options). Returns
// { verdict: 'ok' | 'fail' | 'unknown', rows: [{ id, level, kind, verdict, message, run_id }], files }
// where `files` are the test files its runs saw (what the lock keeps).
export async function redCheck({ rows, run, cwd, env, store, trust, known = () => new Set(), signal = null, onCheck = null }) {
  const out = [];
  const files = new Set();
  for (const row of rows) {
    let result;
    try {
      onCheck?.({ kind: 'check', name: `red: ${row.id}`.slice(0, 120), state: 'running' });
    } catch {
      // a display only
    }
    try {
      result = await run({ cwd, env, name: row.level, ...(row.name === null ? { path: row.path } : { test: row.id }), store, trust, by: 'build', signal });
    } catch (err) {
      result = err.result ?? { outcome: 'env-fault', message: String(err.message).slice(0, 300) };
    }
    const v = rowVerdict(row, result, known(row.level));
    for (const f of result?.case_files ?? []) files.add(f);
    if (row.path) files.add(row.path);
    out.push({ id: row.id, level: row.level, kind: row.kind, verdict: v.verdict, message: v.message ?? null, ...(v.kind ? { failure_kind: v.kind } : {}), run_id: result?.id ?? null });
    try {
      onCheck?.({ kind: 'check', name: `red: ${row.id}`.slice(0, 120), state: v.verdict === 'ok' ? (row.kind === 'red' ? 'red, as it should be' : 'passes, as it should') : v.verdict });
    } catch {
      // a display only
    }
  }
  const verdict = out.some((r) => r.verdict === 'unknown') ? 'unknown' : out.every((r) => r.verdict === 'ok') ? 'ok' : 'fail';
  return { verdict, rows: out, files: [...files].sort() };
}

// The red check's word for Kai, when it fails: one line per row that isn't right yet.
export const redProblems = (check) => check.rows.filter((r) => r.verdict !== 'ok').map((r) => ({ test: r.id, level: r.level, kind: r.kind, problem: rowWhy({ verdict: r.verdict, kind: r.failure_kind ?? null, message: r.message }) }));

// The test files: every file a level's run saw a case in (case_files), across the runs given.
export function testFilesOf(runs) {
  const files = new Set();
  for (const r of runs ?? []) for (const f of r?.case_files ?? []) files.add(f);
  return files;
}

const exists = (root, ref, path, env) => (lsTree(root, ref, path, env) ?? []).some((e) => e.path === path);

// The floor guard (decision 2, and the lock of decision 1) on the work tree, from git's own diff:
// - `base`: the branch's base commit; a test file there only grows, unless `declared` names it;
// - `red`: { commit, files } once the red check passed: those files only grow from then on, declared
//   or not (and from a fix round, the same);
// - `testFiles`: the files MIRAI's runs saw cases in, now;
// - `markers`: regexes for a skip or focus marker; a new line matching one in any test file stops.
// Returns [{ path, why }].
export function floorGuard({ root, env, base, red = null, testFiles, declared = [], markers = [] }) {
  const stops = [];
  const seen = new Set();
  const diff = (from) => {
    try {
      return changedLines(root, from, null, env).files;
    } catch {
      return null;
    }
  };
  const fromBase = diff(base);
  if (fromBase === null) return [{ path: '.', why: 'git couldn\'t show what changed, so the tests couldn\'t be checked' }];
  const tests = new Set(testFiles);
  for (const f of fromBase) {
    if (!tests.has(f.path) && !(red?.files ?? []).includes(f.path)) continue;
    if (exists(root, base, f.path, env) && (f.removed?.length ?? 0) > 0 && !declared.includes(f.path)) {
      stops.push({ path: f.path, why: `an existing test changed (${f.removed.length} line(s) removed or changed); only new lines may go in, unless the plan declares a test-change for it` });
      seen.add(f.path);
    }
    // New lines that skip or focus a test.
    if (markers.length && (f.added?.length ?? 0) > 0) {
      let lines = [];
      try {
        lines = readFileSync(join(root, f.path), 'utf8').split('\n');
      } catch {
        lines = [];
      }
      const hit = f.added.map((n) => lines[n - 1] ?? '').find((l) => markers.some((re) => re.test(l)));
      if (hit !== undefined) stops.push({ path: f.path, why: `a new line skips or focuses a test: ${hit.trim().slice(0, 120)}` });
    }
  }
  if (red?.commit) {
    for (const f of diff(red.commit) ?? []) {
      if (seen.has(f.path) || !(red.files ?? []).includes(f.path)) continue;
      if ((f.removed?.length ?? 0) > 0) stops.push({ path: f.path, why: `a test from the red commit changed (${f.removed.length} line(s)); the tests are locked once red is confirmed (a new plan unlocks them)` });
    }
  }
  return stops;
}

// The skip and focus markers of the levels' adapters (their `classify.skip_markers`).
export function markersOf(config, adapters) {
  const out = [];
  for (const l of config?.testing?.levels ?? []) {
    for (const r of adapters?.[l.adapter]?.classify?.skip_markers ?? []) {
      try {
        out.push(new RegExp(r, 'u'));
      } catch {
        // the registry's schema checked it
      }
    }
  }
  return out;
}

// The counts a report shows: { red, after, characterization, no_test }.
export function rowCounts(rows) {
  const c = { red: 0, after: 0, characterization: 0, no_test: 0 };
  for (const r of rows) c[r.kind ?? 'no_test']++;
  return c;
}
