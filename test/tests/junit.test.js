import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadRegistry } from '../../src/config/registry.js';
import { junitCases, JUNIT_LIMITS, readJunit } from '../../src/tests/junit.js';
import { serviceMounts } from '../../src/tests/paths.js';
import { testResults } from '../../src/tests/results.js';
import { redact } from '../../src/tests/run.js';
import { parseXml } from '../../src/tests/xml.js';

// Unit 16a T2: JUnit cases and what a run returns, on the reports the sample app's runners wrote
// in probes J1–J4 (test/tests/corpus/, research/12) and hand-made ones.

const CORPUS = new URL('./corpus/', import.meta.url).pathname;
const corpus = (name) => readFileSync(join(CORPUS, name));
const adapters = loadRegistry(new URL('../../registry/', import.meta.url).pathname).testAdapters;
const COPY = '/c';
// The sample app's services, as the frozen compose file mounts the copy.
const SERVICES = {
  phpunit: { mounts: serviceMounts({ volumes: [{ type: 'bind', source: '/c/backend', target: '/var/www/html' }, { type: 'volume', target: '/var/www/html/vendor' }] }, COPY), base: '/var/www/html' },
  vitest: { mounts: serviceMounts({ volumes: [{ type: 'bind', source: '/c/frontend', target: '/app' }, { type: 'volume', target: '/app/node_modules' }] }, COPY), base: '/app' },
  playwright: { mounts: serviceMounts({ volumes: [{ type: 'bind', source: '/c/e2e', target: '/e2e' }, { type: 'volume', target: '/e2e/node_modules' }] }, COPY), base: '/e2e/tests' },
};
const results = (runner, file, opts = {}) => testResults({ adapter: adapters[runner], report: { bytes: corpus(file) }, exitCode: 1, output: '', ...SERVICES[runner], ...opts });

test('16a T2: every report in the corpus reads', () => {
  const files = readdirSync(CORPUS).filter((f) => f.endsWith('.xml'));
  assert.ok(files.length >= 10);
  for (const f of files) assert.equal(readJunit(corpus(f), { file: f.startsWith('phpunit') ? 'file' : 'classname' }).report, 'ok', f);
});

test('16a T2: PHPUnit: nested suites, data sets, failure versus error, the message after the Class::method line', () => {
  const r = results('phpunit', 'phpunit-level.xml', { exitCode: 2 });
  assert.equal(r.report, 'ok');
  assert.deepEqual(r.tests, { total: 21, passed: 17, failed: 2, errors: 1, skipped: 1, outside: 0 });
  assert.deepEqual(r.failing, [
    { id: 'backend/tests/Unit/ProbeShapesTest.php::test_fails', outcome: 'fail', kind: 'assertion', message: 'probe assertion' },
    { id: 'backend/tests/Unit/ProbeShapesTest.php::test_throws', outcome: 'error', kind: 'error', message: 'RuntimeException: probe error' },
    { id: 'backend/tests/Feature/KnownFailureSeedTest.php::test_known_failure_seed', outcome: 'fail', kind: 'assertion', message: 'Seeded known failure (see README).' },
  ]);
  const cases = junitCases(parseXml(corpus('phpunit-level.xml')));
  assert.ok(cases.some((c) => c.name === 'test_data with data set "x y "q""'));
  // One test by its ID: exactly that case.
  const one = results('phpunit', 'phpunit-test.xml', { exitCode: 0, asked: { path: 'backend/tests/Unit/ProbeShapesTest.php', name: 'test_a_b' } });
  assert.deepEqual([one.tests.passed, one.tests.total, one.failing.length, one.not_found], [1, 1, 0, false]);
  // A name that isn't there: an empty report, not-found.
  const none = results('phpunit', 'phpunit-none.xml', { asked: { path: 'backend/tests/Unit/ProbeShapesTest.php', name: 'test_nope' } });
  assert.equal(none.not_found, true);
  assert.equal(none.failing[0].kind, 'not-found');
  // A file that doesn't parse: exit 255, an empty report, the output's line.
  const load = testResults({ adapter: adapters.phpunit, report: { bytes: Buffer.alloc(0) }, exitCode: 255, output: 'An error occurred inside PHPUnit.\n\nMessage:  syntax error, unexpected token "}"\n', ...SERVICES.phpunit });
  assert.equal(load.load, true);
  assert.equal(load.report, 'malformed');
  assert.deepEqual(load.failing[0], { id: null, outcome: 'error', kind: 'load', message: 'An error occurred inside PHPUnit.' });
});

test('16a T2: Vitest: the file from classname, nested titles, assertion by type or by an expect( message, a file that won\'t load', () => {
  const r = results('vitest', 'vitest-level.xml');
  const byId = Object.fromEntries(r.failing.map((f) => [f.id, f]));
  assert.equal(byId['frontend/src/probe-shapes.test.ts::probe > fails'].kind, 'assertion');
  assert.equal(byId['frontend/src/probe-shapes.test.ts::probe > fails'].message, 'probe assertion: expected 1 to be 2 // Object.is equality');
  assert.equal(byId['frontend/src/probe-shapes.test.ts::probe > throws'].kind, 'error');
  // Testing Library's matcher throws a plain Error; its message is an expect(…), colour leftovers gone.
  const matcher = byId['frontend/src/components/AddTaskForm.test.tsx::AddTaskForm > shows an error when saving fails'];
  assert.deepEqual([matcher.kind, matcher.message], ['assertion', 'expect(element).toHaveValue(Buy milk)']);
  assert.equal(byId['frontend/src/components/AddTaskForm.test.tsx::AddTaskForm > adds a trimmed title and clears the field'].kind, 'error');
  assert.equal(r.tests.skipped, 1);
  // -t: the asked test ran; the rest of the file and its .tsx twin are skipped and outside.
  const one = results('vitest', 'vitest-test.xml', { exitCode: 0, asked: { path: 'frontend/src/probe-shapes.test.ts', name: 'probe > regex (x)+ "q" [y]' } });
  assert.deepEqual([one.tests.total, one.tests.passed, one.tests.outside, one.not_found], [1, 1, 8, false]);
  // A file: its twin is outside what was asked.
  const file = results('vitest', 'vitest-file.xml', { asked: { path: 'frontend/src/probe-shapes.test.ts' } });
  assert.deepEqual([file.tests.total, file.tests.outside], [8, 1]);
  // -t matching nothing exits 0 with everything skipped: not-found, never a pass.
  const none = results('vitest', 'vitest-none.xml', { exitCode: 0, asked: { path: 'frontend/src/probe-shapes.test.ts', name: 'probe > nope' } });
  assert.equal(none.not_found, true);
  const load = results('vitest', 'vitest-load.xml', { asked: { path: 'frontend/src/probe-broken.test.ts' } });
  assert.deepEqual(load.failing.map((f) => [f.kind, f.message]), [['load', 'Failed to resolve import "./probe-does-not-exist" from "src/probe-broken.test.ts". Does the file exist?']]);
});

test('16a T2: Playwright: the file from classname under report_root, " › " titles, failure versus error, not found versus won\'t load', () => {
  const r = results('playwright', 'playwright-level.xml');
  const byId = Object.fromEntries(r.failing.map((f) => [f.id, f]));
  assert.deepEqual(byId['e2e/tests/probe-shapes.spec.ts::probe › fails'], { id: 'e2e/tests/probe-shapes.spec.ts::probe › fails', outcome: 'fail', kind: 'assertion', message: 'probe assertion' });
  assert.equal(byId['e2e/tests/probe-shapes.spec.ts::probe › throws'].kind, 'error');
  assert.equal(byId['e2e/tests/smoke.spec.ts::log in, add a task and complete it'].message, 'Test timeout of 30000ms exceeded.');
  assert.deepEqual(r.tests, { total: 10, passed: 6, failed: 1, errors: 2, skipped: 1, outside: 0 });
  const one = results('playwright', 'playwright-test.xml', { exitCode: 0, asked: { path: 'e2e/tests/probe-shapes.spec.ts', name: 'probe › regex (x)+ "q" [y]' } });
  assert.deepEqual([one.tests.total, one.tests.passed, one.not_found], [1, 1, false]);
  // The file run's .tsx twin (an unanchored filter) is outside what was asked.
  assert.equal(results('playwright', 'playwright-file.xml', { asked: { path: 'e2e/tests/probe-shapes.spec.ts' } }).tests.outside, 1);
  const none = results('playwright', 'playwright-none.xml', { output: 'Error: No tests found.\nMake sure that arguments are regular expressions matching test files.\n', asked: { path: 'e2e/tests/probe-shapes.spec.ts', name: 'probe › nope' } });
  assert.deepEqual([none.load, none.not_found, none.failing[0].kind], [false, true, 'not-found']);
  const load = results('playwright', 'playwright-load.xml', { output: "Error: Cannot find module './probe-does-not-exist'\nRequire stack:\n\nError: No tests found.\n", asked: { path: 'e2e/tests/probe-broken.spec.ts' } });
  assert.deepEqual([load.load, load.not_found, load.failing[0].kind, load.failing[0].message], [true, false, 'load', "Error: Cannot find module './probe-does-not-exist'"]);
});

test('16a T2: messages are redacted and cut; the failing list is capped and counted', () => {
  const token = `sk-ant-oat01-${'Zz9_'.repeat(20)}`;
  const many = `<testsuites>${Array.from({ length: 70 }, (_, i) => `<testcase name="t${i}" file="/var/www/html/tests/A.php"><failure>Tests\\A::t${i}\n${token} ghp_${'a1B2'.repeat(9)} ${'x'.repeat(500)}</failure></testcase>`).join('')}</testsuites>`;
  const clean = (t) => redact(t, { token, secrets: Object.values(loadRegistry(new URL('../../registry/', import.meta.url).pathname).secrets).flatMap((d) => d.patterns) });
  const r = testResults({ adapter: adapters.phpunit, report: { bytes: Buffer.from(many) }, exitCode: 1, output: '', ...SERVICES.phpunit, clean });
  // All of them here (and in cases.json); the caps are the stored result's and the reply's.
  assert.equal(r.failing.length, 70);
  assert.equal(r.cases.length, 70);
  assert.match(r.failing[0].message, /^<redacted:login-token> <redacted:[a-z-]+> x+…$/);
  assert.equal(r.failing[0].message.length, 300);
  assert.throws(() => junitCases(parseXml(`<testsuites>${'<testcase name="a"/>'.repeat(5)}</testsuites>`), { limits: { ...JUNIT_LIMITS, cases: 4 } }), /more than 4 test cases/);
  assert.equal(readJunit(Buffer.from('<testsuites><testcase/></testsuites>')).report, 'malformed');
});

test('16a review: a data provider\'s method by name covers its data sets; a Vitest file that won\'t load is load on a test ID too', () => {
  // H1: the method alone, against the real report: both data sets, in scope.
  const method = results('phpunit', 'phpunit-level.xml', { asked: { path: 'backend/tests/Unit/ProbeShapesTest.php', name: 'test_data' } });
  assert.deepEqual([method.tests.total, method.tests.passed, method.not_found], [2, 2, false]);
  // A prefix of another method's name isn't a variant.
  const prefix = results('phpunit', 'phpunit-level.xml', { asked: { path: 'backend/tests/Unit/ProbeShapesTest.php', name: 'test_a' } });
  assert.equal(prefix.not_found, true);
  // M1: Vitest's one case named after the file is in scope for any test of that file.
  const load = results('vitest', 'vitest-load.xml', { asked: { path: 'frontend/src/probe-broken.test.ts', name: 'probe > works' } });
  assert.deepEqual([load.not_found, load.failing.map((f) => f.kind)], [false, ['load']]);
  assert.match(load.failing[0].message, /^Failed to resolve import/);
});

test('16a review: "load" from the output or exit code only when no test ran; PHPUnit\'s bare exit 255 isn\'t load', () => {
  // M3: real failures plus an output line that looks like a load error: no load entry.
  const r = results('playwright', 'playwright-file.xml', { output: 'Error: logged by a test\n', asked: { path: 'e2e/tests/probe-shapes.spec.ts' } });
  assert.deepEqual([r.load, r.failing.map((f) => f.kind)], [false, ['assertion', 'error']]);
  // A passing run's output can say anything.
  const pass = results('phpunit', 'phpunit-test.xml', { exitCode: 0, output: 'An error occurred inside PHPUnit.\n' });
  assert.deepEqual([pass.load, pass.failing.length], [false, 0]);
  // Exit 255 without PHPUnit's line, and an empty report: not load (it's left to bad-report).
  const bare = testResults({ adapter: adapters.phpunit, report: { bytes: Buffer.alloc(0) }, exitCode: 255, output: 'PHP Fatal error: Allowed memory size exhausted\n', ...SERVICES.phpunit });
  assert.deepEqual([bare.load, bare.report], [false, 'malformed']);
});

test('16a review: a whole level that ran nothing is not-found; a failed run always lists something', () => {
  // M2: exit 0, nothing ran.
  const none = testResults({ adapter: adapters.vitest, report: { bytes: corpus('vitest-missing.xml') }, exitCode: 0, output: '', ...SERVICES.vitest });
  assert.deepEqual([none.not_found, none.failing[0].kind, none.failing[0].message], [true, 'not-found', 'the runner ran no test at all']);
  const skipped = testResults({ adapter: adapters.vitest, report: { bytes: corpus('vitest-none.xml') }, exitCode: 0, output: '', ...SERVICES.vitest });
  assert.equal(skipped.not_found, true);
  // A non-zero exit with only passing cases: one error entry.
  const warn = testResults({ adapter: adapters.phpunit, report: { bytes: corpus('phpunit-test.xml') }, exitCode: 1, output: '', ...SERVICES.phpunit });
  assert.deepEqual(warn.failing, [{ id: null, outcome: 'error', kind: 'error', message: 'the runner exited with 1 with no failing test in its report' }]);
});

test('16a review: the worst result wins in a case; an empty title is (unnamed); colour leftovers need digits; cuts keep characters whole', () => {
  const both = junitCases(parseXml('<testsuite><testcase name="t" file="/var/www/html/a"><skipped/><failure>x</failure></testcase><testcase name=""/></testsuite>'));
  assert.equal(both[0].outcome, 'fail');
  assert.equal(both[1].name, '(unnamed)');
  const msg = (m) => testResults({ adapter: adapters.vitest, report: { bytes: Buffer.from(`<testsuite><testcase classname="src/a.test.ts" name="t"><failure message="${m}"/></testcase></testsuite>`) }, exitCode: 1, output: '', ...SERVICES.vitest }).failing[0].message;
  assert.equal(msg('expected [m] got [1m]x[22m'), 'expected [m] got ]x');
  const long = msg(`${'a'.repeat(298)}\u{1F600}\u{1F600}\u{1F600}`);
  assert.equal(Array.from(long).length, 300);
  assert.equal(long, `${'a'.repeat(298)}\u{1F600}…`);
  assert.throws(() => parseXml(`<${'a'.repeat(201)}/>`), /longer than 200/);
});
