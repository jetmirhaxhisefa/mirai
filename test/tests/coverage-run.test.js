import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runTest } from '../../src/tests/run.js';
import { inlineResult, runTests } from '../../src/mcp/tools/tests.js';
import { main } from '../../src/cli/main.js';
import { COMMANDS } from '../../src/cli/commands/index.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { fakeDocker, installed, resolvedApp, tempDir } from './run-fixture.js';

// Unit 16b T6 and T7: runs with coverage, through 14c's fake docker (which also leaves a coverage
// file), run_tests' coverage, and mirai test --coverage --against.

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
command = ["run-tests"]
service = "app"

[[testing.levels]]
name = "e2e"
command = ["run-e2e"]
service = "app"
adapter = "playwright"

[[testing.levels]]
name = "front"
command = ["run-front"]
service = "app"
workdir = "/w"
adapter = "vitest"
`;
const SRC = 'class A {\n  one() {}\n  two() {}\n}\n';
const repo = () => installed({ config: CONFIG, files: { 'tests/ATest.php': '<?php\n', 'src/A.php': SRC } });
const REPORT = '<testsuites><testcase name="test_a" file="/w/tests/ATest.php"/></testsuites>';
const COB = (lines) => `<?xml version="1.0"?>
<!DOCTYPE coverage SYSTEM "http://cobertura.sourceforge.net/xml/coverage-04.dtd">
<coverage><sources><source>/w/src</source></sources><packages><package><classes>
<class filename="A.php"><lines>${lines}</lines></class>
<class filename="/usr/lib/php/Lib.php"><lines><line number="1" hits="1"/></lines></class>
</classes></package></packages></coverage>`;
const LINES = '<line number="2" hits="3"/><line number="3" hits="0"/>';
const run = (r, opts) => runTest({ cwd: r.root, env: r.env, ...opts });
const execArgs = (f) => {
  const call = f.calls().map((c) => c.args).find((a) => a.includes('exec'));
  return call.slice(call.indexOf('exec'));
};

test('16b T6: a run with coverage: the adapter\'s arguments, coverage.json and its hashes, the summary', async () => {
  const r = repo();
  const cob = COB(LINES);
  const f = fakeDocker({ resolved: resolvedApp(), report: REPORT, coverage: { name: 'cobertura.xml', text: cob } });
  const res = await run(r, { name: 'unit', coverage: true, docker: f.docker });
  assert.deepEqual(execArgs(f).slice(3), ['run-tests', '--log-junit', '/mirai/out/junit.xml', '--coverage-cobertura', '/mirai/out/coverage/cobertura.xml']);
  assert.equal(res.outcome, 'pass');
  assert.equal(res.with_coverage, true);
  const text = readFileSync(join(res.dir, 'coverage.json'), 'utf8');
  assert.deepEqual(JSON.parse(text), { schema_version: 1, files: { 'src/A.php': { 2: 3, 3: 0 } }, unmapped: 1 });
  assert.deepEqual(res.coverage, {
    state: 'ok', format: 'cobertura', files: 1, lines: 2, covered: 1, unmapped: 1,
    sha256: createHash('sha256').update(text).digest('hex'), file_sha256: createHash('sha256').update(cob).digest('hex'),
  });
  // Without coverage, nothing about it changes.
  const g = fakeDocker({ resolved: resolvedApp(), report: REPORT });
  const plain = await run(r, { name: 'unit', docker: g.docker });
  assert.deepEqual(execArgs(g).slice(3), ['run-tests', '--log-junit', '/mirai/out/junit.xml']);
  assert.equal('coverage' in plain, false);
});

test('16b T6: no coverage file, a broken one, or a coverage folder the container swapped for a link is bad-coverage; no [coverage] is no-coverage', async () => {
  const r = repo();
  const outside = tempDir('outside');
  writeFileSync(join(outside, 'cobertura.xml'), COB(LINES));
  for (const [coverage, re] of [[null, /no coverage file/], [{ name: 'cobertura.xml', text: '<report/>' }, /not <coverage>/], [{ name: 'cobertura.xml', text: COB(LINES).replace('SYSTEM "http://cobertura.sourceforge.net/xml/coverage-04.dtd"', '[<!ENTITY x "y">]') }, /DOCTYPE/], [{ swapDir: outside }, /isn't a folder/]]) {
    await assert.rejects(run(r, { name: 'unit', coverage: true, docker: fakeDocker({ resolved: resolvedApp(), report: REPORT, coverage }).docker }), (e) => {
      assert.equal(e.code, 'bad-coverage', e.message);
      assert.match(e.message, re);
      assert.equal(e.result.outcome, 'env-fault');
      assert.notEqual(e.result.coverage.state, 'ok');
      return true;
    }, JSON.stringify(coverage));
  }
  // A load failure stays a load failure: there was nothing to measure.
  const load = await run(r, { name: 'unit', coverage: true, docker: fakeDocker({ resolved: resolvedApp(), execCode: 255, execOut: 'An error occurred inside PHPUnit.\n', report: '' }).docker }).catch((e) => e.result);
  assert.deepEqual([load.outcome, load.failing[0].kind, 'coverage' in load], ['fail', 'load', false]);
  // A failing run without coverage stays failing, and records it; with no report either, it's the
  // report's fault that's named.
  const failing = await run(r, { name: 'unit', coverage: true, docker: fakeDocker({ resolved: resolvedApp(), execCode: 1, report: '<testsuites><testcase name="test_a" file="/w/tests/ATest.php"><failure>x</failure></testcase></testsuites>' }).docker }).catch((e) => e.result);
  assert.deepEqual([failing.outcome, failing.coverage], ['fail', { state: 'missing' }]);
  await assert.rejects(run(r, { name: 'unit', coverage: true, docker: fakeDocker({ resolved: resolvedApp() }).docker }), (e) => e.code === 'bad-report');
  // Vitest's own load failure (one case named after its file) needs no coverage either.
  const vload = await run(r, { name: 'front', coverage: true, docker: fakeDocker({ resolved: resolvedApp(), execCode: 1, report: '<testsuites><testsuite><testcase classname="tests/ATest.php" name="tests/ATest.php"><failure message="Failed to resolve import">x</failure></testcase></testsuite></testsuites>' }).docker }).catch((e) => e.result);
  assert.deepEqual([vload.outcome, vload.failing[0].kind, 'coverage' in vload], ['fail', 'load', false]);
  for (const name of ['plain', 'e2e']) {
    await assert.rejects(run(r, { name, coverage: true, docker: fakeDocker({ resolved: resolvedApp() }).docker }), (e) => e.code === 'no-coverage' && e.exitCode === EXIT.USAGE, name);
  }
});

test('16b T7: run_tests takes coverage and returns the summary, never per-line data; mirai test --coverage --against prints diff coverage', async () => {
  const policy = { tools: { run_tests: { levels: ['unit'] } } };
  assert.deepEqual(runTests.check({ level: 'unit', coverage: true }, policy), { args: { name: 'unit', path: null, coverage: true } });
  assert.deepEqual(runTests.check({ level: 'unit', path: 'src', coverage: false }, policy), { args: { name: 'unit', path: 'src' } });
  assert.match(runTests.check({ level: 'unit', coverage: 'yes' }, policy).refused, /true or false/);
  assert.equal(runTests.schema(policy).properties.coverage.type, 'boolean');
  const inline = inlineResult({ id: 't', outcome: 'pass', kind: 'level', name: 'unit', output: { tail: '' }, coverage: { state: 'ok', format: 'cobertura', files: 1, lines: 2, covered: 1, unmapped: 0, sha256: 'x', file_sha256: 'y' } });
  assert.deepEqual(inline.coverage, { state: 'ok', files: 1, lines: 2, covered: 1, unmapped: 0 });

  const r = repo();
  // The work tree adds two methods: one covered, one not; and a file no test loads.
  writeFileSync(join(r.root, 'src/A.php'), 'class A {\n  one() {}\n  two() {}\n  three() {}\n  four() {}\n}\n');
  mkdirSync(join(r.root, 'src/new'), { recursive: true });
  writeFileSync(join(r.root, 'src/new/B.php'), 'class B {}\n');
  const out = [];
  const err = [];
  const io = { cwd: r.root, env: r.env, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, docker: fakeDocker({ resolved: resolvedApp(), report: REPORT, coverage: { name: 'cobertura.xml', text: COB('<line number="2" hits="1"/><line number="4" hits="2"/><line number="5" hits="0"/>') } }).docker };
  assert.equal(await main(['test', 'unit', '--coverage', '--against', 'main'], io, COMMANDS), EXIT.OK, err.join(''));
  const text = out.join('');
  assert.match(text, /coverage: 2 of 3 lines ran, in 1 files \(1 files outside the project left out\)/);
  assert.match(text, /diff coverage since the merge base with main: 1 of 2 changed lines that can run ran \(50%\); 3 lines added, 1 of them in files the coverage doesn't list/);
  assert.match(text, /src\/A\.php: 1\/2, not run: 5/);
  assert.match(text, /src\/new\/B\.php: not measured \(1 lines added/);
  const usage = async (args, re) => {
    const e2 = [];
    const code = await main(args, { ...io, stderr: { write: (s) => e2.push(s) }, stdout: { write: () => {} } }, COMMANDS);
    assert.equal(code, EXIT.USAGE, args.join(' '));
    assert.match(e2.join(''), re);
  };
  await usage(['test', 'unit', '--against', 'main'], /goes with --coverage/);
  await usage(['test', 'unit', '--coverage', '--against', 'main', '--path', 'src'], /whole level/);
  await usage(['test', 'unit', '--coverage', '--against', '--x'], /ambiguous/);
  await usage(['test', 'unit', '--coverage', '--against=-x'], /branch, tag or commit/);
  await usage(['test', 'unit', '--coverage', '--against', 'nope'], /shares a history/);
});
