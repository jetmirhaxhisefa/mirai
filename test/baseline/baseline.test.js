import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { recordBaseline } from '../../src/baseline/record.js';
import { readBaseline, knownFailures, baselinePath, KEEP_BASELINES } from '../../src/baseline/store.js';
import { addRerun, fileOf as fileOfGuard, outcomesOf, stateOf } from '../../src/baseline/flaky.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { openStore } from '../../src/store/home.js';
import { main } from '../../src/cli/main.js';
import { COMMANDS } from '../../src/cli/commands/index.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { fakeDocker, installed, resolvedApp, tempDir } from '../tests/run-fixture.js';

// Unit 17b: the test baseline. Runs go through 14c's fake docker (T1, T2, T6), or through a
// stand-in for runTest that writes a run folder with scripted cases, so flaky and failing tests
// can be scripted run by run (T3–T5).

const CONFIG = `
[compose]
files = ["compose.yml"]
env_file = ".env.test"

[[testing.levels]]
name = "unit"
command = ["run-tests"]
service = "app"
adapter = "phpunit"

[[testing.levels]]
name = "plain"
command = ["run-plain"]
service = "app"

[checks]
lint = { command = ["lint-it"], service = "app" }
`;
const REPORT = '<testsuites><testcase name="test_ok" file="/w/tests/ATest.php"/><testcase name="test_bad" file="/w/tests/ATest.php"><failure>no</failure></testcase></testsuites>';

// A repo with MIRAI installed, the levels above, and your key committed on main.
function repo({ config = CONFIG } = {}) {
  const r = installed({ config, files: { 'tests/ATest.php': '<?php\n' } });
  const key = createKeyPair(r.env);
  writePublicKeyFile(r.root, key.keyId, key.publicPem);
  r.git('add', '-A');
  r.git('commit', '-qm', 'key');
  return { ...r, key };
}

// A stand-in for runTest: `script(name, path, n)` gives the cases of the n-th run of that name and
// path (n from 0), or { outcome } for a whole-run outcome, or throws.
function scripted(script) {
  const counts = new Map();
  const calls = [];
  const runner = async ({ name, path = null, coverage = false }) => {
    const key = `${name}\0${path}`;
    const n = counts.get(key) ?? 0;
    counts.set(key, n + 1);
    calls.push({ name, path, coverage });
    const got = script(name, path, n);
    const dir = tempDir('run');
    const id = `t-20261030-000000-${String(calls.length).padStart(6, '0')}`;
    const cases = got.cases ?? [];
    const casesText = `${JSON.stringify({ schema_version: 1, cases })}\n`;
    writeFileSync(join(dir, 'cases.json'), casesText);
    const failed = cases.filter((c) => c.outcome === 'fail').length;
    const tests = got.noTests ? undefined : { total: cases.length, passed: cases.filter((c) => c.outcome === 'pass').length, failed, errors: 0, skipped: cases.filter((c) => c.outcome === 'skip').length, outside: 0 };
    const result = { id, name, outcome: got.outcome ?? (failed ? 'fail' : 'pass'), duration_ms: 1000 * (n + 1), ...(tests ? { tests, cases_sha256: 'c'.repeat(64), failing: got.failing ?? cases.filter((c) => c.outcome === 'fail').map((c) => ({ id: c.id, outcome: 'fail', kind: 'assertion' })) } : {}) };
    if (got.coverage) {
      writeFileSync(join(dir, 'coverage.json'), JSON.stringify({ schema_version: 1, files: got.coverage, unmapped: 0 }));
      result.coverage = { state: 'ok', format: 'cobertura', files: Object.keys(got.coverage).length, lines: 3, covered: 2, unmapped: 0, sha256: 'd'.repeat(64), file_sha256: 'e'.repeat(64) };
    }
    writeFileSync(join(dir, 'result.json'), JSON.stringify(result));
    if (got.fault) throw Object.assign(new Error(got.fault), { code: got.fault, result: { ...result, outcome: got.refused ? 'refused' : 'env-fault', dir } });
    return { ...result, dir };
  };
  return { runner, calls };
}
const T = (id, outcome) => ({ id, outcome });

test('17b T1: only on a clean tree with HEAD on the integration branch; not installed; your key must be committed', async () => {
  const r = repo();
  const docker = () => fakeDocker({ resolved: resolvedApp(), report: REPORT }).docker;
  writeFileSync(join(r.root, 'new.txt'), 'x');
  await assert.rejects(recordBaseline({ cwd: r.root, env: r.env, docker: docker() }), (e) => e.code === 'gate-dirty');
  r.git('add', '-A');
  r.git('commit', '-qm', 'new');
  r.git('checkout', '-qb', 'side');
  await assert.rejects(recordBaseline({ cwd: r.root, env: r.env, docker: docker() }), (e) => e.code === 'gate-branch');
  r.git('checkout', '-q', 'main');
  const bare = installed({ config: CONFIG });
  await assert.rejects(recordBaseline({ cwd: bare.root, env: bare.env, docker: docker() }), (e) => e.code === 'no-signing-key' || e.code === 'key-not-committed' || /key/.test(e.message));
  const notGit = tempDir('plain');
  await assert.rejects(recordBaseline({ cwd: notGit, env: r.env }), (e) => e.code === 'not-git' || e.code === 'no-store');
});

test('17b T2: every check and level runs whole as a signed gate run, checks first; failing tests rerun by file; stored once per commit, reused, --force, --level merges', { timeout: 180_000 }, async () => {
  const r = repo();
  const f = fakeDocker({ resolved: resolvedApp(), report: REPORT, execCode: 1 });
  const events = [];
  const { baseline, reused } = await recordBaseline({ cwd: r.root, env: r.env, docker: f.docker, onEvent: (t) => events.push(t), limits: { runsPerFile: 3, reruns: 50, filesPerLevel: 50 } });
  assert.equal(reused, false);
  assert.deepEqual(Object.keys(baseline.levels), ['lint', 'unit', 'plain'], 'checks first, then levels in config order');
  assert.equal(baseline.sha, r.git('rev-parse', 'HEAD'));
  const unit = baseline.levels.unit;
  assert.deepEqual([unit.kind, unit.state, unit.tests.total, unit.tests.failed], ['level', 'fail', 2, 1]);
  assert.deepEqual(unit.known_failures, [{ id: 'tests/ATest.php::test_bad', scope: 'test', state: 'failing', runs: 3, failed: 3 }]);
  assert.equal(events.filter((e) => /running tests\/ATest\.php again/.test(e)).length, 2, 'one rerun per file per round');
  // Each run was a signed gate run on this commit; the reruns ran the file.
  const store = openStore({ cwd: r.root, env: r.env });
  const gate = readdirSync(join(store.dir, 'tests', 'gate'));
  assert.equal(gate.length, 5, 'lint, unit, plain and two reruns');
  const unitRun = JSON.parse(readFileSync(join(store.dir, 'tests', unit.run.id, 'result.json'), 'utf8'));
  assert.equal(unitRun.gate.head, baseline.sha);
  assert.equal(unit.run.result_sha256, createHash('sha256').update(readFileSync(join(store.dir, 'tests', unit.run.id, 'result.json'))).digest('hex'));
  // Checks and levels without an adapter fail whole.
  assert.deepEqual(baseline.levels.lint.known_failures, [{ id: null, scope: 'level', kind: 'no-ids', state: 'unchecked', runs: 1, failed: 1, reason: 'no test IDs: the whole level or check fails' }]);
  assert.ok(baseline.gaps.some((g) => g.level === 'plain' && /no test adapter/.test(g.text)));
  assert.ok(baseline.gaps.some((g) => g.level === null && /no end-to-end level/.test(g.text)));
  assert.equal(baseline.complete, true);
  // Signed, and read back checked.
  assert.equal(baseline.signature.key_id, r.key.keyId);
  assert.deepEqual(JSON.parse(JSON.stringify(readBaseline(store, baseline.sha).levels.unit)), unit);
  assert.deepEqual(knownFailures(baseline, 'unit').map((k) => k.state), ['failing']);
  // The same commit: reused, no container. --force runs again. --level merges.
  const g = fakeDocker({ resolved: resolvedApp(), report: REPORT, execCode: 1 });
  const again = await recordBaseline({ cwd: r.root, env: r.env, docker: g.docker });
  assert.equal(again.reused, true);
  assert.equal(g.calls().length, 0);
  const h = fakeDocker({ resolved: resolvedApp(), report: REPORT, execCode: 1 });
  const one = await recordBaseline({ cwd: r.root, env: r.env, docker: h.docker, levels: ['lint'] });
  assert.deepEqual(Object.keys(one.baseline.levels), ['lint', 'unit', 'plain']);
  assert.notEqual(one.baseline.levels.lint.run.id, baseline.levels.lint.run.id);
  assert.equal(one.baseline.levels.unit.run.id, baseline.levels.unit.run.id);
  await assert.rejects(recordBaseline({ cwd: r.root, env: r.env, docker: h.docker, levels: ['nope'] }), /nope isn't a level or check/);
});

test('17b T3: flaky versus failing, by file: always failing, fail-then-pass, a passing test that fails on a rerun, a test a rerun doesn\'t run, the bounds; a load failure is the whole level', async () => {
  const r = repo();
  const A = 'tests/ATest.php';
  const B = 'tests/BTest.php';
  const C = 'tests/CTest.php';
  const { runner, calls } = scripted((name, path, n) => {
    if (name !== 'unit') return { cases: [], noTests: true };
    if (path === null) return { cases: [T(`${A}::always`, 'fail'), T(`${A}::flip`, 'fail'), T(`${A}::steady`, 'pass'), T(`${B}::renamed`, 'fail'), T(`${C}::x`, 'fail')] };
    if (path === A) return { cases: [T(`${A}::always`, 'fail'), T(`${A}::flip`, n === 0 ? 'fail' : 'pass'), T(`${A}::steady`, n === 1 ? 'fail' : 'pass')] };
    if (path === B) return { cases: [T(`${B}::renamed (1)`, 'fail')] };
    return { cases: [T(`${C}::x`, 'fail')] };
  });
  const { baseline } = await recordBaseline({ cwd: r.root, env: r.env, run: runner, limits: { runsPerFile: 4, reruns: 5, filesPerLevel: 50 } });
  const k = Object.fromEntries(knownFailures(baseline, 'unit').map((x) => [x.id, x]));
  assert.deepEqual(k[`${A}::always`], { id: `${A}::always`, scope: 'test', state: 'failing', runs: 4, failed: 4 });
  assert.deepEqual(k[`${A}::flip`], { id: `${A}::flip`, scope: 'test', state: 'flaky', runs: 3, failed: 2 });
  assert.deepEqual(k[`${A}::steady`], { id: `${A}::steady`, scope: 'test', state: 'flaky', runs: 2, failed: 1, first: 'pass' }, 'passed first, failed when its file ran again');
  assert.deepEqual(k[`${B}::renamed`], { id: `${B}::renamed`, scope: 'test', state: 'unchecked', runs: 1, failed: 1, reason: 'a rerun of its file didn\'t run it' });
  assert.equal(k[`${C}::x`].state, 'unchecked');
  assert.match(k[`${C}::x`].reason, /reruns per baseline/);
  // A's three reruns, B's one: the budget of 5 leaves C one.
  assert.deepEqual(calls.filter((c) => c.path).map((c) => c.path), [A, A, A, B, C]);
  assert.equal(calls.filter((c) => c.path === null && c.name === 'unit')[0].coverage, true, 'the phpunit adapter has coverage');

  // Files per level; a load failure is the whole level, not rerun.
  const r2 = repo();
  const two = scripted((name, path) => (name !== 'unit' ? { cases: [], noTests: true } : path === null ? { cases: [T(`${A}::a`, 'fail'), T(`${B}::b`, 'fail')] } : { cases: [T(`${A}::a`, 'fail')] }));
  const capped = await recordBaseline({ cwd: r2.root, env: r2.env, run: two.runner, limits: { runsPerFile: 2, reruns: 50, filesPerLevel: 1 } });
  assert.match(knownFailures(capped.baseline, 'unit').find((x) => x.id === `${B}::b`).reason, /files per level/);
  const r3 = repo();
  const load = scripted((name) => (name !== 'unit' ? { cases: [], noTests: true } : { cases: [], outcome: 'fail', failing: [{ id: null, outcome: 'error', kind: 'load', message: 'PHP Parse error' }] }));
  const loaded = await recordBaseline({ cwd: r3.root, env: r3.env, run: load.runner });
  assert.deepEqual(knownFailures(loaded.baseline, 'unit'), [{ id: null, scope: 'level', kind: 'load', state: 'unchecked', runs: 1, failed: 1, reason: 'the whole level: load (PHP Parse error)' }]);
  assert.equal(load.calls.filter((c) => c.path).length, 0);
});

test('17b T3: the bookkeeping on its own', () => {
  assert.deepEqual(stateOf({ runs: 10, passed: 0, failed: 10 }), { state: 'failing' });
  assert.deepEqual(stateOf({ runs: 9, passed: 0, failed: 9 }), { state: 'unchecked', reason: 'rerun limit' });
  assert.deepEqual(stateOf({ runs: 2, passed: 1, failed: 1 }), { state: 'flaky' });
  const { outcomes, duplicates } = outcomesOf([T('a::x', 'pass'), T('a::x', 'fail'), T('a::y', 'error'), T('a::z', 'skip'), { id: null, outcome: 'fail' }]);
  assert.deepEqual([...outcomes], [['a::x', 'fail'], ['a::y', 'fail'], ['a::z', 'skip']]);
  assert.equal(duplicates, 1);
  const h = new Map([['a::x', { runs: 1, passed: 0, failed: 1 }]]);
  const left = addRerun(h, { first: new Map([['a::x', 'fail'], ['a::y', 'pass']]), rerun: new Map([['a::x', 'skip'], ['a::y', 'fail'], ['b::q', 'fail']]), file: 'a', pending: ['a::x'] });
  assert.deepEqual(left, []);
  assert.equal(h.get('a::x').stop, 'skipped when its file ran again');
  assert.deepEqual(h.get('a::y'), { runs: 2, passed: 1, failed: 1, first: 'pass' });
  assert.equal(h.has('b::q'), false, 'another file\'s test isn\'t this rerun\'s');
});

test('17b T4 and T5: an environment fault is never a known failure and makes the baseline incomplete; the file: coverage, measured files, gaps, signature, ten kept', async () => {
  const r = repo();
  const { runner } = scripted((name, path) => {
    if (name === 'lint') return { cases: [], noTests: true, fault: 'timeout' };
    if (name === 'plain') return { cases: [], noTests: true };
    return path === null ? { cases: [T('tests/ATest.php::a', 'pass'), T('tests/ATest.php::s', 'skip')], coverage: { 'src/B.php': { 1: 1 }, 'src/A.php': { 1: 0, 2: 3 } } } : { cases: [] };
  });
  const { baseline } = await recordBaseline({ cwd: r.root, env: r.env, run: runner });
  assert.equal(baseline.complete, false);
  assert.deepEqual([baseline.levels.lint.state, baseline.levels.lint.code, baseline.levels.lint.known_failures], ['env-fault', 'timeout', []]);
  assert.equal(knownFailures(baseline, 'lint'), null, 'an environment fault is "can\'t tell", never "none"');
  assert.equal(knownFailures(baseline, 'nope'), null);
  assert.equal(knownFailures(null, 'unit'), null);
  assert.deepEqual(knownFailures(baseline, 'unit'), []);
  const unit = baseline.levels.unit;
  assert.deepEqual(unit.measured, { files: ['src/A.php', 'src/B.php'], sha256: createHash('sha256').update(JSON.stringify(['src/A.php', 'src/B.php'])).digest('hex') });
  assert.ok(baseline.gaps.some((g) => g.level === 'unit' && /1 tests skipped/.test(g.text)));
  assert.equal(typeof baseline.trust_manifest_sha256, 'string');
  assert.deepEqual(baseline.config, { checks: ['lint'], levels: ['unit', 'plain'] });
  // An edited file doesn't verify, and is refused, never read as "no known failures".
  const store = openStore({ cwd: r.root, env: r.env });
  const path = baselinePath(store, baseline.sha);
  const text = readFileSync(path, 'utf8');
  writeFileSync(path, text.replace('"complete": false', '"complete": true'));
  assert.throws(() => readBaseline(store, baseline.sha), (e) => e.code === 'baseline-invalid' && /doesn't verify/.test(e.message));
  writeFileSync(path, text);
  assert.ok(readBaseline(store, baseline.sha));
  assert.equal(readBaseline(store, '0'.repeat(40)), null);
  // Ten commits' baselines are kept.
  for (let i = 0; i < KEEP_BASELINES + 1; i++) {
    r.git('commit', '-q', '--allow-empty', '-m', `c${i}`);
    await recordBaseline({ cwd: r.root, env: r.env, run: scripted(() => ({ cases: [], noTests: true })).runner });
  }
  assert.equal(readdirSync(join(store.dir, 'baseline')).filter((n) => n.endsWith('.json')).length, KEEP_BASELINES);
});

test('17b T6: mirai baseline and show; test names escaped; an incomplete baseline exits for you to look', { timeout: 180_000 }, async () => {
  const r = repo();
  const io = (docker) => {
    const o = [];
    const e = [];
    return { o, e, io: { cwd: r.root, env: r.env, stdout: { write: (s) => o.push(s) }, stderr: { write: (s) => e.push(s) }, docker } };
  };
  const none = io();
  assert.equal(await main(['baseline', 'show'], none.io, COMMANDS), EXIT.FAILURE);
  assert.match(none.o.join(''), /no baseline for main at [0-9a-f]{12}; record it with: mirai baseline/);
  // Characters XML allows but a terminal acts on or hides: a C1 control and a bidi override.
  const evil = '<testsuites><testcase name="test_\u0085red\u202e" file="/w/tests/ATest.php"><failure>x</failure></testcase></testsuites>';
  const a = io(fakeDocker({ resolved: resolvedApp(), report: evil, execCode: 1 }).docker);
  assert.equal(await main(['baseline'], a.io, COMMANDS), EXIT.OK, a.e.join(''));
  const text = a.o.join('');
  assert.match(text, /^test baseline for main at [0-9a-f]{12}\n/);
  assert.match(text, /unit \(level\): fail in \d+ s, 1 tests \(0 passed, 1 failed, 0 errors, 0 skipped\)/);
  assert.match(text, /failing {3}tests\/ATest\.php::test_\\u0085red\\u202e \u2014 failed 10 of 10/);
  assert.equal(/[\u0085\u202e]/.test(text), false);
  assert.match(a.e.join(''), /unit: running with coverage…/);
  const s = io();
  assert.equal(await main(['baseline', 'show', r.git('rev-parse', 'HEAD')], s.io, COMMANDS), EXIT.OK);
  assert.match(s.o.join(''), /signed with k-[0-9a-f]{16}/);
  for (const [args, re] of [[['baseline', 'show', 'main'], /isn't a full commit id/], [['baseline', 'redo'], /unknown action/], [['baseline', 'show', '--force'], /show takes no/]]) {
    const u = io();
    assert.equal(await main(args, u.io, COMMANDS), EXIT.USAGE, args.join(' '));
    assert.match(u.e.join(''), re);
  }
  // An environment fault: the baseline is stored, incomplete, and the exit says look.
  r.git('commit', '-q', '--allow-empty', '-m', 'next');
  const bad = io(fakeDocker({ resolved: resolvedApp(), report: '' }).docker);
  assert.equal(await main(['baseline'], bad.io, COMMANDS), EXIT.NEEDS_HUMAN);
  assert.match(bad.o.join(''), /INCOMPLETE/);
});

test('17b T7: the baseline probe stays local: a clone with its origin removed, the sample app\'s images only, a key made in its own home, only with --yes', () => {
  const src = readFileSync(new URL('../probes/baseline-probes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src.replace("'.docker', 'run', 'docker.sock'", ''), /['"](?:pull|push|build)['"]/);
  assert.match(src, /'remote', 'remove', 'origin'/);
  assert.match(src, /add --yes to run/);
  assert.match(src, /createKeyPair\(env\)/);
  assert.doesNotMatch(src, /\.config\/mirai/);
  mkdirSync(tempDir('x'), { recursive: true });
});

test('17b review fixes: a rerun that times out; refusals stop the baseline; an incomplete baseline is completed, not reused; --force over a bad file; file-level load and unmapped cases; duplicates on a passing level; growth', async () => {
  const A = 'tests/ATest.php';
  // A rerun that comes back timed out (runTest returns it, with no cases.json).
  const r = repo();
  const timeout = scripted((name, path, n) => {
    if (name !== 'unit') return { cases: [], noTests: true };
    if (path === null) return { cases: [T(`${A}::a`, 'fail')] };
    return n === 0 ? { cases: [], noTests: true, outcome: 'timeout' } : { cases: [T(`${A}::a`, 'fail')] };
  });
  const out = await recordBaseline({ cwd: r.root, env: r.env, run: timeout.runner });
  const k = knownFailures(out.baseline, 'unit')[0];
  assert.deepEqual([k.state, k.reason], ['unchecked', 'a rerun of its file was an environment fault (timeout)']);
  assert.deepEqual(out.baseline.levels.unit.reruns.map((x) => [x.file, x.outcome]), [[A, 'timeout']], 'each rerun is kept, with its hash');
  assert.match(out.baseline.levels.unit.reruns[0].result_sha256, /^[0-9a-f]{64}$/);

  // A refusal of the tree or HEAD stops everything, and nothing is written; another refusal is
  // recorded as refused, and the baseline is incomplete.
  const r2 = repo();
  const moved = scripted((name) => {
    if (name === 'unit') throw Object.assign(new Error('HEAD moved during the run'), { code: 'gate-dirty' });
    return { cases: [], noTests: true };
  });
  await assert.rejects(recordBaseline({ cwd: r2.root, env: r2.env, run: moved.runner }), (e) => e.code === 'gate-dirty');
  const store2 = openStore({ cwd: r2.root, env: r2.env });
  assert.equal(readBaseline(store2, r2.git('rev-parse', 'HEAD')), null);
  const refused = scripted((name) => (name === 'plain' ? { cases: [], noTests: true, fault: 'no-image', refused: true } : { cases: [], noTests: true }));
  const withRefusal = await recordBaseline({ cwd: r2.root, env: r2.env, run: refused.runner });
  assert.equal(withRefusal.baseline.complete, false);

  // An incomplete baseline is completed: only the faulted level runs again.
  const fixed = scripted(() => ({ cases: [], noTests: true }));
  const completed = await recordBaseline({ cwd: r2.root, env: r2.env, run: fixed.runner });
  assert.equal(completed.reused, false);
  assert.deepEqual(fixed.calls.map((c) => c.name), ['plain']);
  assert.equal(completed.baseline.complete, true);
  assert.equal((await recordBaseline({ cwd: r2.root, env: r2.env, run: fixed.runner })).reused, true);

  // --force records over a baseline that doesn't verify; --level refuses it.
  const path = baselinePath(store2, completed.baseline.sha);
  writeFileSync(path, readFileSync(path, 'utf8').replace('"complete": true', '"complete": false'));
  await assert.rejects(recordBaseline({ cwd: r2.root, env: r2.env, run: fixed.runner }), (e) => e.code === 'baseline-invalid');
  await assert.rejects(recordBaseline({ cwd: r2.root, env: r2.env, run: fixed.runner, levels: ['plain'] }), (e) => e.code === 'baseline-invalid');
  const forced = await recordBaseline({ cwd: r2.root, env: r2.env, run: fixed.runner, force: true });
  assert.ok(readBaseline(store2, forced.baseline.sha));

  // A file that doesn't load and a case with no project path don't wipe the level's other
  // failures; duplicates are found on a passing level too.
  const r3 = repo();
  const mixed = scripted((name, path) => {
    if (name !== 'unit') return { cases: [], noTests: true };
    if (path === null) return { cases: [T(`${A}::a`, 'fail'), T('tests/B.php::tests/B.php', 'fail'), { id: null, outcome: 'fail' }], failing: [{ id: `${A}::a`, kind: 'assertion' }, { id: 'tests/B.php::tests/B.php', kind: 'load' }, { id: null, kind: 'assertion' }] };
    return { cases: [T(`${A}::a`, 'fail'), T('tests/B.php::tests/B.php', 'fail')] };
  });
  const m = await recordBaseline({ cwd: r3.root, env: r3.env, run: mixed.runner, limits: { runsPerFile: 2, reruns: 50, filesPerLevel: 50 } });
  const known = knownFailures(m.baseline, 'unit').map((x) => [x.scope, x.id ?? x.kind, x.state]);
  assert.deepEqual(known, [['level', 'unmapped', 'unchecked'], ['test', `${A}::a`, 'failing'], ['test', 'tests/B.php::tests/B.php', 'failing']]);
  const r4 = repo();
  const dup = scripted((name) => (name !== 'unit' ? { cases: [], noTests: true } : { cases: [T(`${A}::a`, 'pass'), T(`${A}::a`, 'pass')] }));
  const d = await recordBaseline({ cwd: r4.root, env: r4.env, run: dup.runner });
  assert.ok(d.baseline.gaps.some((g) => g.level === 'unit' && g.code === 'duplicate-ids'));
  // A --level merge keeps the other levels' gaps.
  const merged = await recordBaseline({ cwd: r4.root, env: r4.env, run: scripted(() => ({ cases: [], noTests: true })).runner, levels: ['lint'] });
  assert.ok(merged.baseline.gaps.some((g) => g.level === 'unit' && g.code === 'duplicate-ids'));

  // Growth: a known failure added since the previous commit's baseline is listed; an automatic
  // refresh (refuseGrowth) stops on it.
  r4.git('commit', '-q', '--allow-empty', '-m', 'broke');
  const broke = scripted((name) => (name !== 'unit' ? { cases: [], noTests: true } : { cases: [T(`${A}::a`, 'fail')] }));
  await assert.rejects(recordBaseline({ cwd: r4.root, env: r4.env, run: broke.runner, refuseGrowth: true, limits: { runsPerFile: 2, reruns: 5, filesPerLevel: 5 } }), (e) => e.code === 'baseline-grew');
  const grew = await recordBaseline({ cwd: r4.root, env: r4.env, run: broke.runner, limits: { runsPerFile: 2, reruns: 5, filesPerLevel: 5 } });
  assert.equal(grew.baseline.growth.previous.sha, d.baseline.sha);
  assert.deepEqual(grew.baseline.growth.added, [{ level: 'unit', scope: 'test', id: `${A}::a` }]);
  assert.equal(fileOfGuard('weird'), null);
});
