import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runTest } from '../../src/tests/run.js';
import { inlineResult, INLINE_TAIL_BYTES, runTests } from '../../src/mcp/tools/tests.js';
import { writeToken } from '../../src/sign/token.js';
import { main } from '../../src/cli/main.js';
import { COMMANDS } from '../../src/cli/commands/index.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { COMPOSE, fakeDocker, installed, resolvedApp } from './run-fixture.js';

// Unit 16a T5 and T6: levels with a test adapter, through 14c's fake docker (which leaves the
// report in the output folder as the runner would): the argv, the report read, the new fields,
// a missing or broken report, a level without an adapter as before, and run_tests' reply.

const MINE = `kind = "test-adapter"
schema_version = 1
name = "mine"
description = "a project's own runner, reporting by an environment variable"

[report]
format = "junit"
env = { MINE_REPORT = "{report}" }
file = "classname"
separator = " / "

[select]
file = ["--file", "{path}"]
test = ["--file", "{path}", "--grep", "^{name:regex}$"]
join = " "
`;
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
name = "own"
command = ["own-runner"]
service = "app"
run = "oneoff"
adapter = "mine"
report_root = "spec"

[[testing.levels]]
name = "nope"
command = ["x"]
service = "app"
adapter = "worktree-only"
`;
const repo = () => installed({ config: CONFIG, files: { 'tests/ATest.php': '<?php\n', 'spec/a.spec': 'x\n', '.mirai/custom/test-adapters/mine.toml': MINE } });

const PHP = (cases) => `<?xml version="1.0" encoding="UTF-8"?>
<testsuites><testsuite name="all"><testsuite name="Tests\\ATest" file="/w/tests/ATest.php">${cases}</testsuite></testsuite></testsuites>`;
const CASES = `
<testcase name="test_a_b" file="/w/tests/ATest.php" class="Tests\\ATest"/>
<testcase name="test_fails" file="/w/tests/ATest.php"><failure type="PHPUnit\\Framework\\ExpectationFailedException">Tests\\ATest::test_fails
probe assertion
second line</failure></testcase>
<testcase name="test_throws" file="/w/tests/ATest.php"><error type="RuntimeException">Tests\\ATest::test_throws
RuntimeException: probe error</error></testcase>
<testcase name="test_skipped" file="/w/tests/ATest.php"><skipped/></testcase>
<testcase name="test_elsewhere" file="/usr/lib/x/BTest.php"><failure>outside</failure></testcase>`;

const execArgs = (f) => {
  const call = f.calls().map((c) => c.args).find((a) => a.includes('exec') || (a.includes('run') && a.includes('-d')));
  const at = call.includes('exec') ? call.indexOf('exec') : call.indexOf('run');
  return call.slice(at);
};
const run = (r, opts) => runTest({ cwd: r.root, env: r.env, ...opts });

test('16a T5: a level with an adapter: the report argument, the cases by test ID, kinds and messages, the counts', async () => {
  const r = repo();
  const f = fakeDocker({ resolved: resolvedApp(), execCode: 2, report: PHP(CASES) });
  const res = await run(r, { name: 'unit', docker: f.docker }).catch((e) => e.result);
  assert.deepEqual(execArgs(f), ['exec', '-T', 'app', 'run-tests', '--log-junit', '/mirai/out/junit.xml']);
  assert.equal(res.outcome, 'fail');
  assert.equal(res.report, 'ok');
  assert.equal(res.adapter, 'phpunit');
  assert.deepEqual(res.tests, { total: 5, passed: 1, failed: 2, errors: 1, skipped: 1, outside: 0 });
  assert.deepEqual(res.failing, [
    { id: 'tests/ATest.php::test_fails', outcome: 'fail', kind: 'assertion', message: 'probe assertion' },
    { id: 'tests/ATest.php::test_throws', outcome: 'error', kind: 'error', message: 'RuntimeException: probe error' },
    { id: null, name: 'test_elsewhere', outcome: 'fail', kind: 'assertion', message: 'outside' },
  ]);
  assert.equal(res.failing_total, 3);
});

test('16a T5: one file and one test ID: the service\'s path, the escaped filter; the asked test alone is counted', async () => {
  const r = repo();
  const f = fakeDocker({ resolved: resolvedApp(), report: PHP(CASES) });
  const file = await run(r, { name: 'unit', path: 'tests/ATest.php', docker: f.docker }).catch((e) => e.result);
  assert.deepEqual(execArgs(f).slice(3), ['run-tests', '--log-junit', '/mirai/out/junit.xml', '/w/tests/ATest.php']);
  assert.equal(file.tests.total, 4);
  assert.equal(file.tests.outside, 1);
  const g = fakeDocker({ resolved: resolvedApp(), report: PHP('<testcase name="test_a_b" file="/w/tests/ATest.php"/>') });
  const one = await run(r, { name: 'unit', test: 'tests/ATest.php::test_a_b', docker: g.docker });
  assert.deepEqual(execArgs(g).slice(3), ['run-tests', '--log-junit', '/mirai/out/junit.xml', '--filter', '/::test_a_b(?: with data set .*)?$/', '/w/tests/ATest.php']);
  assert.equal(one.outcome, 'pass');
  assert.equal(one.test, 'tests/ATest.php::test_a_b');
  assert.equal(one.path, 'tests/ATest.php');
  assert.deepEqual(one.tests, { total: 1, passed: 1, failed: 0, errors: 0, skipped: 0, outside: 0 });
});

test('16a T5: not found (nothing ran, or all of it skipped, even at exit 0) and load errors fail with their kind', async () => {
  const r = repo();
  const none = await run(r, { name: 'unit', test: 'tests/ATest.php::test_nope', docker: fakeDocker({ resolved: resolvedApp(), execCode: 1, report: '<testsuites/>' }).docker }).catch((e) => e.result);
  assert.equal(none.outcome, 'fail');
  assert.deepEqual(none.failing, [{ id: 'tests/ATest.php::test_nope', outcome: 'error', kind: 'not-found', message: 'the runner ran no test by that name in that file' }]);
  const skipped = await run(r, { name: 'unit', test: 'tests/ATest.php::test_a_b', docker: fakeDocker({ resolved: resolvedApp(), report: PHP('<testcase name="test_a_b" file="/w/tests/ATest.php"><skipped/></testcase>') }).docker }).catch((e) => e.result);
  assert.equal(skipped.outcome, 'fail');
  assert.equal(skipped.failing[0].kind, 'not-found');
  assert.match(skipped.failing[0].message, /1 skipped/);
  const load = await run(r, { name: 'unit', docker: fakeDocker({ resolved: resolvedApp(), execCode: 255, execOut: 'An error occurred inside PHPUnit.\n\nMessage:  syntax error\n', report: '' }).docker }).catch((e) => e.result);
  assert.equal(load.outcome, 'fail');
  assert.equal(load.report, 'malformed');
  assert.deepEqual(load.failing, [{ id: null, outcome: 'error', kind: 'load', message: 'An error occurred inside PHPUnit.' }]);
  // Exit 0 with a failing case in the report is a failing run.
  const lied = await run(r, { name: 'unit', docker: fakeDocker({ resolved: resolvedApp(), report: PHP(CASES) }).docker }).catch((e) => e.result);
  assert.equal(lied.exit_code, 0);
  assert.equal(lied.outcome, 'fail');
});

test('16a T5: a missing, broken or linked report is an environment fault (bad-report), whatever the exit code; stored all the same', async () => {
  const r = repo();
  for (const [report, state, re] of [[null, 'missing', /no report/], ['<!DOCTYPE x><x/>', 'malformed', /DOCTYPE/], ['<testsuites>', 'malformed', /isn't closed/], ['<html/>', 'malformed', /not <testsuites>/], [{ link: '/etc/hosts' }, 'malformed', /a link/]]) {
    await assert.rejects(run(r, { name: 'unit', docker: fakeDocker({ resolved: resolvedApp(), report }).docker }), (e) => {
      assert.equal(e.code, 'bad-report');
      assert.equal(e.exitCode, EXIT.NEEDS_HUMAN);
      assert.match(e.message, re);
      assert.equal(e.result.outcome, 'env-fault');
      assert.equal(e.result.report, state);
      assert.equal(e.result.exit_code, 0);
      return true;
    }, JSON.stringify(report));
  }
});

test('16a T5: a project adapter from the trust root: env for the report, a oneoff run, report_root; one only in the work tree doesn\'t count', async () => {
  const r = repo();
  const report = '<testsuite name="s"><testcase classname="a.spec" name="outer / inner / it works"/></testsuite>';
  const f = fakeDocker({ resolved: resolvedApp(), report });
  const res = await run(r, { name: 'own', test: 'spec/a.spec::outer / inner / it works', docker: f.docker });
  assert.deepEqual(execArgs(f), ['run', '-d', '--no-deps', '--pull', 'never', '-e', 'MINE_REPORT=/mirai/out/junit.xml', 'app', 'own-runner', '--file', '/w/spec/a.spec', '--grep', '^outer inner it works$']);
  assert.equal(res.outcome, 'pass');
  assert.equal(res.tests.passed, 1);
  mkdirSync(join(r.root, '.mirai', 'custom', 'test-adapters'), { recursive: true });
  writeFileSync(join(r.root, '.mirai', 'custom', 'test-adapters', 'worktree-only.toml'), MINE.replace('"mine"', '"worktree-only"'));
  await assert.rejects(run(r, { name: 'nope', docker: fakeDocker({ resolved: resolvedApp() }).docker }), (e) => e.code === 'unknown-adapter' && /phpunit.*, mine$/.test(e.hint) && !/worktree-only/.test(e.hint));
});

test('16a T5: without an adapter, a level runs as before (the path now the service\'s); a test ID is refused; a path the service doesn\'t mount is refused', async () => {
  const r = repo();
  const f = fakeDocker({ resolved: resolvedApp(), report: PHP(CASES) });
  const plain = await run(r, { name: 'plain', path: 'tests/ATest.php', docker: f.docker });
  assert.deepEqual(execArgs(f).slice(3), ['run-tests', '--', '/w/tests/ATest.php']);
  assert.equal(plain.outcome, 'pass');
  for (const k of ['report', 'tests', 'failing', 'adapter']) assert.equal(k in plain, false, k);
  await assert.rejects(run(r, { name: 'plain', test: 'tests/ATest.php::x', docker: f.docker }), (e) => e.code === 'no-adapter' && e.exitCode === EXIT.USAGE);
  await assert.rejects(run(r, { name: 'unit', path: 'tests/ATest.php', test: 'tests/ATest.php::x', docker: f.docker }), (e) => e.code === 'bad-path');
  const sub = installed({ compose: COMPOSE.replace('./:/w', './tests:/t'), config: CONFIG, files: { 'tests/ATest.php': '<?php\n', 'spec/a.spec': 'x\n', '.mirai/custom/test-adapters/mine.toml': MINE } });
  const resolved = resolvedApp({ volumes: [{ type: 'bind', source: '@COPY@/tests', target: '/t', bind: {} }] });
  await assert.rejects(run(sub, { name: 'unit', path: 'spec/a.spec', docker: fakeDocker({ resolved }).docker }), (e) => e.code === 'bad-path' && /isn't in what app mounts/.test(e.message) && e.result.outcome === 'refused');
  const g = fakeDocker({ resolved, report: PHP('<testcase name="test_a_b" file="/t/ATest.php"/>') });
  const mapped = await run(sub, { name: 'unit', test: 'tests/ATest.php::test_a_b', docker: g.docker });
  assert.equal(execArgs(g).at(-1), '/t/ATest.php');
  assert.equal(mapped.outcome, 'pass');
});

test('16a T5: report text is redacted: the login token and secret shapes, colour leftovers removed, cut to one line', async () => {
  const r = repo();
  const token = `sk-ant-oat01-${'Ab1_'.repeat(20)}`;
  writeToken(r.env, token);
  const gh = `ghp_${'a1B2'.repeat(9)}`;
  const cases = `<testcase name="test_leak" file="/w/tests/ATest.php"><failure message="[2mexpect([22m${token} and ${gh} ${'x'.repeat(400)}">x</failure></testcase>`;
  const res = await run(r, { name: 'unit', docker: fakeDocker({ resolved: resolvedApp(), execCode: 1, report: PHP(cases) }).docker }).catch((e) => e.result);
  const m = res.failing[0].message;
  assert.ok(!m.includes(token) && !m.includes(gh), m);
  assert.match(m, /^expect\(<redacted:login-token> and <redacted:[a-z-]+> x+…$/);
  assert.equal(m.length, 300);
});

test('16a T6: run_tests: test IDs checked before anything runs; the counts and failing list inline within one budget; no store paths', async () => {
  const policy = { tools: { run_tests: { levels: ['unit'] } } };
  assert.deepEqual(runTests.check({ level: 'unit', test: 'tests/A.php::test_x' }, policy), { args: { name: 'unit', path: null, test: 'tests/A.php::test_x' } });
  assert.match(runTests.check({ level: 'unit', test: 'tests/A.php' }, policy).refused, /<file>::<test name>/);
  assert.match(runTests.check({ level: 'unit', test: '/etc/x::y' }, policy).refused, /character/);
  assert.match(runTests.check({ level: 'unit', path: 'a', test: 'a::b' }, policy).refused, /not both/);
  assert.ok(runTests.schema(policy).properties.test);
  const failing = Array.from({ length: 50 }, (_, i) => ({ id: `tests/${'d/'.repeat(100)}A${i}.php::${'n'.repeat(200)}`, outcome: 'fail', kind: 'assertion', message: 'm'.repeat(300) }));
  const big = { id: 't-1', outcome: 'fail', exit_code: 1, duration_ms: 1000, kind: 'level', name: 'unit', path: null, report: 'ok', tests: { total: 60, passed: 10, failed: 50, errors: 0, skipped: 0, outside: 0 }, failing, failing_total: 70, output: { tail: 'o'.repeat(64 * 1024), truncated: false }, out_files: [], tree: { hash: 'h' }, dir: '/store/tests/t-1' };
  const inline = inlineResult(big);
  assert.ok(Buffer.byteLength(JSON.stringify(inline)) < INLINE_TAIL_BYTES + 2048, `${Buffer.byteLength(JSON.stringify(inline))}`);
  assert.ok(inline.failing.length > 0 && inline.failing.length < 50);
  assert.equal(inline.failing_total, 70);
  assert.equal(inline.output_truncated, true);
  assert.equal(JSON.stringify(inline).includes('/store/'), false);
  const small = inlineResult({ ...big, failing: failing.slice(0, 2).map((f) => ({ ...f, id: 'a::b', message: 'm' })), failing_total: 2, output: { tail: 'short', truncated: false } });
  assert.equal(small.failing.length, 2);
  assert.equal(small.output_tail, 'short');
  assert.equal('report' in inlineResult({ ...big, report: undefined }), false);
});

test('16a T5: mirai test --test: the counts and the failing tests by ID, kind and message', async () => {
  const r = repo();
  const out = [];
  const err = [];
  const io = { cwd: r.root, env: r.env, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, docker: fakeDocker({ resolved: resolvedApp(), execCode: 1, report: PHP(CASES) }).docker };
  const code = await main(['test', 'unit', '--path', 'tests/ATest.php'], io, COMMANDS);
  assert.equal(code, EXIT.FAILURE);
  const text = out.join('');
  assert.match(text, /tests: 4 \(1 passed, 1 failed, 1 errors, 1 skipped\); 1 more ran outside what was asked/);
  assert.match(text, /assertion tests\/ATest\.php::test_fails\n {12}probe assertion/);
  assert.match(text, /error {5}tests\/ATest\.php::test_throws/);
  const io2 = { ...io, stdout: { write: () => {} }, stderr: { write: (s) => err.push(s) } };
  assert.equal(await main(['test', 'unit', '--test', 'tests/ATest.php::test_a_b', '--gate', '--branch', 'main'], io2, COMMANDS), EXIT.USAGE);
  assert.match(err.join(''), /no --path or --test/);
});

test('16a review: every case goes to cases.json, its hash and the report\'s in the result; a folder isn\'t a test ID; a broken project adapter is refused', async () => {
  const r = repo();
  const report = PHP(CASES);
  const res = await run(r, { name: 'unit', docker: fakeDocker({ resolved: resolvedApp(), execCode: 2, report }).docker }).catch((e) => e.result);
  const casesText = readFileSync(join(res.dir, 'cases.json'), 'utf8');
  assert.equal(res.cases_sha256, createHash('sha256').update(casesText).digest('hex'));
  assert.equal(res.report_sha256, createHash('sha256').update(report).digest('hex'));
  const { cases } = JSON.parse(casesText);
  assert.equal(cases.length, 5);
  assert.deepEqual(cases[0], { id: 'tests/ATest.php::test_a_b', outcome: 'pass' });
  assert.deepEqual(cases[1], { id: 'tests/ATest.php::test_fails', outcome: 'fail', kind: 'assertion' });
  await assert.rejects(run(r, { name: 'unit', test: 'tests::test_a_b', docker: fakeDocker({ resolved: resolvedApp() }).docker }), (e) => e.code === 'bad-path' && /folder/.test(e.message));
  const b = installed({ config: CONFIG, files: { 'tests/ATest.php': '<?php\n', '.mirai/custom/test-adapters/mine.toml': MINE.replace('format = "junit"', 'format = "tap"') } });
  await assert.rejects(run(b, { name: 'unit', docker: fakeDocker({ resolved: resolvedApp() }).docker }), (e) => e.code === 'bad-adapter' && /mine\.toml/.test(e.message) && e.exitCode === EXIT.USAGE);
});

test('16a review: the reply\'s budget holds as JSON is sent, whatever the output holds', () => {
  for (const ch of ['o', '"', '\u0001', '\\']) {
    const r = { id: 't-1', outcome: 'fail', kind: 'level', name: 'unit', output: { tail: ch.repeat(64 * 1024), truncated: false }, out_files: [], tree: { hash: 'h' } };
    const sent = JSON.stringify(inlineResult(r), null, 2);
    assert.ok(Buffer.byteLength(sent) < INLINE_TAIL_BYTES + 2048, `${JSON.stringify(ch)}: ${Buffer.byteLength(sent)}`);
  }
});
