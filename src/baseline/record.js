import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { StoreError, UsageError } from '../cli/errors.js';
import { RUNNING_VERSION } from '../install/lock.js';
import { loadSigner } from '../sign/signer.js';
import { acquireLock, ensurePrivateDir } from '../store/files.js';
import { openStore } from '../store/home.js';
import { snapshot, trustedConfig } from '../trust/snapshot.js';
import { findAdapter, trustedAdapters } from '../tests/adapters.js';
import { gateCheck, gateRecheck } from '../tests/gate.js';
import { runTest, findTarget } from '../tests/run.js';
import { TestRunError } from '../tests/docker.js';
import { addRerun, fileOf, outcomesOf, RERUN_LIMITS, stateOf } from './flaky.js';
import { BASELINE_FOLDER, BASELINE_SCHEMA_VERSION, latestOther, readBaseline, writeBaseline } from './store.js';

// Recording the test baseline (unit 17b; D-45, R2-M7, AR3-11). Every configured named check and
// test level of the integration branch's commit runs whole, as a gate run (a clean tree, HEAD on
// the integration branch at its commit, checked before, during and after; each result signed
// with your key), a level with coverage where its adapter has it. A level's failing tests are then
// run again by their file until each has passed and failed (flaky) or failed every time
// (failing), within RERUN_LIMITS (src/baseline/flaky.js). The baseline is signed and stored once
// per commit (src/baseline/store.js).
//
// What it promises its readers (units 25, 26, 28, 52, 54; docs/test-baseline.md):
// - a known failure is `scope: 'test'` (one test ID: only that ID failing again is known) or
//   `scope: 'level'` with its `kind` (load, not-found, error, no-ids, unmapped): only the same
//   level-wide outcome is known; a failing test ID on a branch is new;
// - an environment fault or refusal is never a known failure: that level is `env-fault` or
//   `refused`, the baseline `complete: false`, and knownFailures() gives null for it ("can't
//   tell");
// - `growth` lists the known failures added since the previous baseline (AR3-11: the list may
//   only shrink automatically); `refuseGrowth` makes an automatic refresh stop on any.

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const resultHash = (dir) => sha256(readFileSync(join(dir, 'result.json')));
const readCases = (dir) => (existsSync(join(dir, 'cases.json')) ? JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8')).cases ?? [] : null);

// Refusals that mean the tree or HEAD changed under the baseline: it stops, nothing is written.
const ABORT = new Set(['gate-branch', 'gate-dirty', 'repo-changed']);
// The level-wide kinds a run's own failing list has (src/tests/results.js), with no test ID.
const LEVEL_KINDS = new Set(['load', 'not-found', 'error']);

// One run, as the baseline records it: { result, error }. A refusal of the tree or HEAD is
// thrown; another refusal or an environment fault comes back as the error (with its result, if
// the run got far enough to leave one).
async function oneRun(runner, opts) {
  try {
    return { result: await runner(opts), error: null };
  } catch (err) {
    if (ABORT.has(err.code)) throw err;
    if (!(err instanceof TestRunError) && !err.result) throw err;
    return { result: err.result ?? null, error: err };
  }
}

// What a level or check that ran adds up to, before reruns.
function summarize(kind, r, now) {
  const entry = {
    kind, state: r.outcome === 'pass' ? 'pass' : r.outcome === 'fail' ? 'fail' : 'env-fault', duration_ms: r.duration_ms,
    recorded_at: now().toISOString(), mirai_version: RUNNING_VERSION, run: { id: r.id, result_sha256: resultHash(r.dir) },
  };
  if (r.outcome !== 'pass' && r.outcome !== 'fail') entry.code = r.outcome;
  if (r.tests) Object.assign(entry, { tests: r.tests, cases_sha256: r.cases_sha256 });
  if (r.coverage) {
    entry.coverage = r.coverage;
    if (r.coverage.state === 'ok') {
      const files = Object.keys(JSON.parse(readFileSync(join(r.dir, 'coverage.json'), 'utf8')).files).sort();
      entry.measured = { files, sha256: sha256(JSON.stringify(files)) };
    }
  }
  return entry;
}

// A known failure's key, for comparing two baselines.
const keyOf = (name, k) => `${name}\0${k.scope}\0${k.scope === 'test' ? k.id : k.kind}`;

// Records the baseline. Options: `levels` (names to run, merged into the commit's baseline),
// `force` (run everything again, even over a baseline that doesn't verify), `refuseGrowth` (stop
// with `baseline-grew` when a known failure was added since the previous baseline: for an
// automatic refresh), `limits`, `onEvent(text)`, and for tests `docker`, `run` (runTest's
// stand-in), `now`. Returns { baseline, reused }.
export async function recordBaseline({ cwd, env, levels: only = null, force = false, refuseGrowth = false, limits = RERUN_LIMITS, docker = {}, run = runTest, now = () => new Date(), onEvent = () => {} }) {
  const store = openStore({ cwd, env });
  const trust = snapshot({ cwd, env });
  const config = trustedConfig(trust);
  const signer = loadSigner(env, store);
  const gate = { ...gateCheck(store.checkout, trust.branch, env), signer };
  const sameCommit = () => {
    if (gate.head !== trust.baseSha) throw new TestRunError(`HEAD (${gate.head.slice(0, 12)}) isn't ${trust.branch}'s commit (${trust.baseSha.slice(0, 12)})`, { code: 'gate-branch', hint: `the baseline is ${trust.branch}'s: pull or push it so the two agree` });
  };
  sameCommit();
  const names = [...Object.keys(config.checks ?? {}), ...(config.testing?.levels ?? []).map((l) => l.name)];
  if (only) {
    const unknown = only.filter((n) => !names.includes(n));
    if (unknown.length) throw new UsageError(`${unknown.join(', ')} ${unknown.length === 1 ? 'isn\'t a level or check' : 'aren\'t levels or checks'} in the config`, `known: ${names.join(', ')}`);
  }
  // One recording per repo at a time: two would lose each other's levels in the merge.
  ensurePrivateDir(join(store.dir, BASELINE_FOLDER));
  let lock;
  try {
    lock = acquireLock(join(store.dir, BASELINE_FOLDER, 'record.lock'), 'recording the test baseline', { waitMs: 0 });
  } catch (err) {
    throw new StoreError('another test baseline is being recorded for this repo', { code: 'baseline-busy', hint: 'wait for it to finish', cause: err });
  }
  try {
    // --force runs everything again, over a baseline that doesn't verify too; --level merges into
    // one that does.
    const existing = force && !only ? null : readBaseline(store, trust.baseSha);
    if (existing?.complete && !force && !only) return { baseline: existing, reused: true };
    // An incomplete baseline is completed: only its missing, faulted or refused levels run again.
    const todo = only ?? (existing ? names.filter((n) => !['pass', 'fail'].includes(existing.levels?.[n]?.state)) : names);
    const adapters = trustedAdapters(trust);
    const runner = (opts) => run({ cwd, env, gate, trust, docker, now, ...opts });
    const budget = { reruns: limits.reruns };
    const entries = existing ? { ...existing.levels } : {};
    const gaps = (existing?.gaps ?? []).filter((g) => g.level !== null && names.includes(g.level) && !todo.includes(g.level));
    const gap = (level, code, text) => gaps.push({ level, code, text });
    for (const name of names) {
      if (!todo.includes(name)) continue;
      const target = findTarget(config, name);
      const adapter = target.adapter ? findAdapter(adapters, target.adapter) : null;
      const coverage = Boolean(adapter?.coverage);
      onEvent(`${name}: running${coverage ? ' with coverage' : ''}…`);
      const first = await oneRun(runner, { name, coverage });
      if (!first.result?.dir || first.error) {
        const refused = first.result?.outcome === 'refused';
        entries[name] = {
          kind: target.kind, state: refused ? 'refused' : 'env-fault', code: first.error?.code ?? 'error', message: String(first.error?.message ?? '').slice(0, 300),
          recorded_at: now().toISOString(), mirai_version: RUNNING_VERSION, ...(first.result?.id ? { run: { id: first.result.id } } : {}), known_failures: [],
        };
        continue;
      }
      const entry = summarize(target.kind, first.result, now);
      entry.known_failures = [];
      entries[name] = entry;
      const cases = entry.tests ? readCases(first.result.dir) : null;
      const { outcomes, duplicates } = outcomesOf(cases ?? []);
      if (duplicates) gap(name, 'duplicate-ids', `${duplicates} test IDs appear more than once in a run (a runner's several projects?): one failing case fails the ID`);
      if (entry.state !== 'fail') continue;
      if (!adapter || !entry.tests) {
        entry.known_failures.push({ id: null, scope: 'level', kind: 'no-ids', state: 'unchecked', runs: 1, failed: 1, reason: 'no test IDs: the whole level or check fails' });
        continue;
      }
      // The run's own level-wide failures: it didn't load, it ran nothing, or it exited non-zero
      // with nothing failing in its report. Only those are the whole level's.
      const failingCases = entry.tests.failed + entry.tests.errors;
      const wide = (first.result.failing ?? []).filter((f) => f.id === null && LEVEL_KINDS.has(f.kind) && (f.kind !== 'error' || failingCases === 0));
      for (const f of wide) entry.known_failures.push({ id: null, scope: 'level', kind: f.kind, state: 'unchecked', runs: 1, failed: 1, reason: `the whole level: ${f.kind}${f.message ? ` (${String(f.message).slice(0, 200)})` : ''}` });
      const unmapped = (cases ?? []).filter((c) => c.id === null && (c.outcome === 'fail' || c.outcome === 'error')).length;
      if (unmapped) entry.known_failures.push({ id: null, scope: 'level', kind: 'unmapped', state: 'unchecked', runs: 1, failed: unmapped, reason: `${unmapped} failing cases whose file isn't a project path` });
      const histories = new Map([...outcomes].filter(([, o]) => o === 'fail').map(([id]) => [id, { runs: 1, passed: 0, failed: 1 }]));
      for (const [id, h] of histories) if (fileOf(id) === null) h.stop = 'its ID names no file';
      const files = [...new Set([...histories.keys()].map(fileOf).filter(Boolean))].sort();
      entry.reruns = [];
      for (const [i, file] of files.entries()) {
        let pending = [...histories.keys()].filter((id) => fileOf(id) === file);
        if (i >= limits.filesPerLevel) {
          for (const id of pending) histories.get(id).stop = 'rerun limit (files per level)';
          continue;
        }
        for (let n = 1; n < limits.runsPerFile && pending.length; n++) {
          if (budget.reruns <= 0) {
            for (const id of pending) histories.get(id).stop = 'rerun limit (reruns per baseline)';
            break;
          }
          budget.reruns--;
          onEvent(`${name}: running ${file} again (${n + 1} of up to ${limits.runsPerFile})…`);
          const again = await oneRun(runner, { name, path: file });
          const ran = again.result?.dir && !again.error && (again.result.outcome === 'pass' || again.result.outcome === 'fail') && again.result.tests;
          if (again.result?.id) entry.reruns.push({ file, id: again.result.id, outcome: again.error ? (again.result.outcome ?? 'env-fault') : again.result.outcome, ...(again.result.dir ? { result_sha256: resultHash(again.result.dir) } : {}) });
          const rerunCases = ran ? readCases(again.result.dir) : null;
          if (!rerunCases) {
            // A rerun that timed out, faulted or was refused tells nothing about its tests.
            for (const id of pending) histories.get(id).stop = `a rerun of its file was an environment fault (${again.error?.code ?? again.result?.outcome ?? 'error'})`;
            break;
          }
          pending = addRerun(histories, { first: outcomes, rerun: outcomesOf(rerunCases).outcomes, file, pending });
        }
      }
      for (const [id, h] of [...histories].sort(([a], [b]) => a.localeCompare(b))) {
        const s = stateOf(h, limits);
        entry.known_failures.push({ id, scope: 'test', ...s, runs: h.runs, failed: h.failed, ...(h.first === 'pass' ? { first: 'pass' } : {}) });
      }
    }

    // Gaps: reported, never turned into tickets (D-45 point 7).
    for (const name of names) {
      const target = findTarget(config, name);
      const e = entries[name];
      if (target.kind !== 'level' || !e || !todo.includes(name)) continue;
      if (!target.adapter) gap(name, 'no-adapter', 'no test adapter: no counts, no test IDs, no known failures by test');
      else if (!findAdapter(adapters, target.adapter).coverage) gap(name, 'no-coverage', `the ${target.adapter} adapter has no coverage`);
      if (e.tests?.skipped) gap(name, 'skipped', `${e.tests.skipped} tests skipped`);
      if (e.coverage && e.coverage.state !== 'ok') gap(name, 'coverage-missing', `no coverage from this run (${e.coverage.state})`);
    }
    const levels = config.testing?.levels ?? [];
    // A name or a requirement, not a stack: the end-to-end level is whichever you called that.
    if (!levels.some((l) => /e2e/.test(l.name) || (l.required_for ?? []).includes('critical-journeys'))) gap(null, 'no-e2e', 'no end-to-end level (named e2e, or required for critical journeys)');

    const ordered = Object.fromEntries(names.filter((n) => entries[n]).map((n) => [n, entries[n]]));
    // Growth since the previous baseline (AR3-11: the known-failure list may only shrink
    // automatically): what's known now that wasn't then.
    const prev = latestOther(store, trust.baseSha);
    const before = new Set(prev ? Object.entries(prev.baseline.levels ?? {}).flatMap(([n, e]) => (e.known_failures ?? []).map((k) => keyOf(n, k))) : []);
    const added = prev ? Object.entries(ordered).flatMap(([n, e]) => e.known_failures.filter((k) => !before.has(keyOf(n, k))).map((k) => ({ level: n, scope: k.scope, ...(k.scope === 'test' ? { id: k.id } : { kind: k.kind }) }))) : [];
    if (refuseGrowth && added.length) throw new StoreError(`${added.length} known failure${added.length === 1 ? '' : 's'} appeared since the previous baseline (${prev.baseline.sha.slice(0, 12)})`, { code: 'baseline-grew', hint: 'a test broke on the integration branch: look at it, then record the baseline yourself (mirai baseline)' });
    // The tree and HEAD once more before signing.
    gateRecheck(store.checkout, gate, env);
    sameCommit();
    const baseline = {
      schema_version: BASELINE_SCHEMA_VERSION, sha: trust.baseSha, branch: trust.branch, created_at: now().toISOString(),
      mirai_version: RUNNING_VERSION, trust_manifest_sha256: trust.manifestSha256 ?? null,
      config: { checks: Object.keys(config.checks ?? {}), levels: levels.map((l) => l.name) },
      complete: names.every((n) => ordered[n] && ['pass', 'fail'].includes(ordered[n].state)),
      limits: { ...limits }, levels: ordered, gaps,
      growth: prev ? { previous: { sha: prev.baseline.sha, sha256: prev.sha256 }, added } : { previous: null, added: [] },
    };
    const signed = writeBaseline(store, baseline, signer, { now });
    return { baseline: signed, reused: false };
  } finally {
    lock.release();
  }
}
