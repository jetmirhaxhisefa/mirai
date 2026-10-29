#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { init } from '../../src/install/init.js';
import { createStore } from '../../src/store/home.js';
import { runTest } from '../../src/tests/run.js';
import { DOCKER } from '../../src/tests/docker.js';

// Unit 16a, J1–J4: how each test runner of the sample app writes JUnit XML into the run's
// output folder, runs one file or one test, and reports a test that doesn't exist or a file that
// won't load. On a throwaway clone of the sample app under your home folder (its origin removed,
// a temporary MIRAI home), through MIRAI's own runTest: one commit on the clone's main adds
// probe-only levels; the probe test files are written to the work tree only (the copy takes new
// files). The sample app's own images only, never pulled; nothing is pushed anywhere; every
// container, network and volume of a run is checked gone afterwards.
//
// The m- scenarios run the shipped adapters themselves (J2 through MIRAI): the clone's MIRAI is
// refreshed from this checkout first (mirai init --refresh, committed in the clone), as you'd
// refresh the sample app.
//
//   node test/probes/adapter-probes.js --yes [--app <sample app>] [--workdir <dir>] [--only id,id] [--keep]

export const LOCAL_IMAGES = Object.freeze(['mirai-sample/app:dev', 'mirai-sample/frontend:dev', 'mirai-sample/e2e:dev', 'mysql:8.4', 'nginx:1.27-alpine']);
const OUT = '/mirai/out/junit.xml';

// Probe-only test files: passing, failing (an assertion), erroring (a throw), skipped, names
// that share a prefix or a suffix, names with regex characters, and nesting. The files that don't
// load (BROKEN) are written only for the scenario that names them: one stops a whole PHPUnit run.
export const FILES = Object.freeze({
  'backend/tests/Unit/ProbeShapesTest.php': `<?php

namespace Tests\\Unit;

use PHPUnit\\Framework\\Attributes\\DataProvider;
use PHPUnit\\Framework\\TestCase;

class ProbeShapesTest extends TestCase
{
    public function test_a_b(): void { $this->assertTrue(true); }
    public function test_a_bc(): void { $this->assertTrue(true); }
    public function test_fails(): void { $this->assertSame(1, 2, "probe assertion\\nsecond line"); }
    public function test_throws(): void { throw new \\RuntimeException('probe error'); }
    public function test_skipped(): void { $this->markTestSkipped('probe skip'); }
    public static function cases(): array { return ['x y "q"' => [1], 'plain' => [2]]; }
    #[DataProvider('cases')]
    public function test_data(int $n): void { $this->assertGreaterThan(0, $n); }
}
`,
  'frontend/src/probe-shapes.test.ts': `describe('probe', () => {
  it('a b', () => {});
  it('regex (x)+ "q" [y]', () => {});
  it('regex (x)+ "q" [y] more', () => {});
  it('fails', () => { expect(1, 'probe assertion').toBe(2); });
  it('throws', () => { throw new Error('probe error'); });
  it.skip('skipped', () => {});
  describe('inner', () => {
    it('regex (x)+ "q" [y]', () => {});
  });
});
it('top level', () => {});
`,
  'frontend/src/probe-shapes.test.tsx': `it('tsx twin', () => {});
`,
  'e2e/tests/probe-shapes.spec.ts': `import { expect, test } from '@playwright/test';

test.describe('probe', () => {
  test('a b', async () => {});
  test('regex (x)+ "q" [y]', async () => {});
  test('regex (x)+ "q" [y] more', async () => {});
  test('fails', async () => { expect(1, 'probe assertion').toBe(2); });
  test('throws', async () => { throw new Error('probe error'); });
  test.skip('skipped', async () => {});
  test.describe('inner', () => {
    test('regex (x)+ "q" [y]', async () => {});
  });
});
test('top level', async () => {});
`,
  'e2e/tests/probe-shapes.spec.tsx': `import { test } from '@playwright/test';

test('tsx twin', async () => {});
`,
});

export const BROKEN = Object.freeze({
  'e2e/tests/probe-broken.spec.ts': `import { test } from '@playwright/test';
import { nope } from './probe-does-not-exist';

test('x', async () => { nope(); });
`,
  'frontend/src/probe-broken.test.ts': `import { nope } from './probe-does-not-exist';
it('x', () => { nope(); });
`,
  'backend/tests/Unit/ProbeBrokenTest.php': `<?php

namespace Tests\\Unit;

class ProbeBrokenTest extends \\PHPUnit\\Framework\\TestCase
{
    public function test_x(): void { $this->assertTrue(true) }
}
`,
});

// The levels the m- scenarios run: the sample app's own, with an adapter.
const M = {
  unit: { mirai: 'unit-a', service: 'app', command: ['php', 'artisan', 'test'], adapter: 'phpunit' },
  front: { mirai: 'frontend-a', service: 'frontend', command: ['npm', 'test', '--'], adapter: 'vitest' },
  e2e: { mirai: 'e2e-a', service: 'playwright', run: 'oneoff', command: ['npx', 'playwright', 'test'], adapter: 'playwright', report_root: 'e2e/tests' },
};

const SPECIAL = String.raw`(?:^| )probe regex \(x\)\+ "q" \[y\]$`;
const php = (...a) => ({ service: 'app', command: ['php', 'artisan', 'test', '--log-junit', OUT, ...a] });
const vitest = (...a) => ({ service: 'frontend', command: ['npm', 'test', '--', '--reporter=default', '--reporter=junit', `--outputFile.junit=${OUT}`, ...a] });
const pw = (...a) => ({ service: 'playwright', run: 'oneoff', command: ['env', `PLAYWRIGHT_JUNIT_OUTPUT_FILE=${OUT}`, 'npx', 'playwright', 'test', ...a] });

// Each scenario: a probe level (named by its id), or `level` (one of the
// sample app's own) with `path`. Facts are recorded, not judged: the report has each run's exit
// code, the end of its output and its JUnit file.
export function scenarios() {
  return [
    { id: 'pj-level', j: 'J1', title: 'PHPUnit through artisan: JUnit for the whole level', ...php() },
    { id: 'pj-test', j: 'J2', title: 'PHPUnit: one test by an anchored --filter, in one file (test_a_b, not test_a_bc)', ...php('--filter', '/::test_a_b(?: with data set .*)?$/', 'tests/Unit/ProbeShapesTest.php') },
    { id: 'pj-file', j: 'J2', title: 'PHPUnit: one file (the seeded known failure)', ...php('tests/Feature/KnownFailureSeedTest.php') },
    { id: 'pj-none', j: 'J3', title: 'PHPUnit: a test name that doesn\'t exist', ...php('--filter', '/::test_nope(?: with data set .*)?$/', 'tests/Unit/ProbeShapesTest.php') },
    { id: 'pj-load', j: 'J3', title: 'PHPUnit: a file that doesn\'t parse', broken: 'backend/tests/Unit/ProbeBrokenTest.php', ...php('tests/Unit/ProbeBrokenTest.php') },
    { id: 'pj-load-level', j: 'J3', title: 'PHPUnit: the whole level with a file that doesn\'t parse', broken: 'backend/tests/Unit/ProbeBrokenTest.php', ...php() },
    { id: 'pj-missing', j: 'J3', title: 'PHPUnit: a file that doesn\'t exist', ...php('tests/Unit/ProbeNopeTest.php') },
    { id: 'pj-path', j: 'J4', title: '14d\'s path, from the project\'s top, on the sample app\'s own level (no report asked for)', level: 'unit', path: 'backend/tests/Unit' },
    { id: 'vj-level', j: 'J1', title: 'Vitest through npm test: JUnit for the whole level', ...vitest() },
    { id: 'vj-test', j: 'J2', title: 'Vitest: one test by -t, regex characters escaped, in one file (not its "more" twin, the inner one or the .tsx file)', ...vitest('src/probe-shapes.test.ts', '-t', SPECIAL) },
    { id: 'vj-file', j: 'J2', title: 'Vitest: one file (not its .tsx twin)', ...vitest('src/probe-shapes.test.ts') },
    { id: 'vj-none', j: 'J3', title: 'Vitest: a test name that doesn\'t exist', ...vitest('src/probe-shapes.test.ts', '-t', '(?:^| )probe nope$') },
    { id: 'vj-load', j: 'J3', title: 'Vitest: a file that doesn\'t load (a missing import)', broken: 'frontend/src/probe-broken.test.ts', ...vitest('src/probe-broken.test.ts') },
    { id: 'vj-missing', j: 'J3', title: 'Vitest: a file that doesn\'t exist', ...vitest('src/probe-nope.test.ts') },
    { id: 'wj-level', j: 'J1', title: 'Playwright: JUnit for the whole level, by its environment variable', ...pw() },
    { id: 'wj-test', j: 'J2', title: 'Playwright: one test by -g, regex characters escaped, in one file (not its "more" twin, the inner one or the .tsx file)', ...pw('tests/probe-shapes.spec.ts', '-g', SPECIAL) },
    { id: 'wj-file', j: 'J2', title: 'Playwright: one file (not its .tsx twin)', ...pw('tests/probe-shapes.spec.ts') },
    { id: 'wj-none', j: 'J3', title: 'Playwright: a test name that doesn\'t exist', ...pw('tests/probe-shapes.spec.ts', '-g', '(?:^| )probe nope$') },
    { id: 'wj-load', j: 'J3', title: 'Playwright: a file that doesn\'t load (a missing import)', broken: 'e2e/tests/probe-broken.spec.ts', ...pw('tests/probe-broken.spec.ts') },
    { id: 'wj-missing', j: 'J3', title: 'Playwright: a file that doesn\'t exist', ...pw('tests/probe-nope.spec.ts') },
    { id: 'm-unit', j: 'J2', title: 'through the phpunit adapter: the whole level, the failing list', ...M.unit },
    { id: 'm-unit-test', j: 'J2', title: 'through the phpunit adapter: one data-set test by its ID', ...M.unit, test: 'backend/tests/Unit/ProbeShapesTest.php::test_data with data set "x y "q""' },
    { id: 'm-unit-none', j: 'J3', title: 'through the phpunit adapter: a test ID that isn\'t there is not-found', ...M.unit, test: 'backend/tests/Unit/ProbeShapesTest.php::test_nope' },
    { id: 'm-front-file', j: 'J2', title: 'through the vitest adapter (npm test --): one file, kinds', ...M.front, path: 'frontend/src/probe-shapes.test.ts' },
    { id: 'm-front-test', j: 'J2', title: 'through the vitest adapter: one nested test with regex characters by its ID', ...M.front, test: 'frontend/src/probe-shapes.test.ts::probe > regex (x)+ "q" [y]' },
    { id: 'm-e2e-file', j: 'J2', title: 'through the playwright adapter: one file, its .tsx twin not run', ...M.e2e, path: 'e2e/tests/probe-shapes.spec.ts' },
    { id: 'm-e2e-test', j: 'J2', title: 'through the playwright adapter: one test with regex characters by its ID', ...M.e2e, test: 'e2e/tests/probe-shapes.spec.ts::probe › regex (x)+ "q" [y]' },
    { id: 'm-e2e-level', j: 'J1', title: 'through the playwright adapter: the whole level (the smoke test, on a quiet machine)', ...M.e2e },
  ];
}

const levelName = (s) => s.mirai ?? s.id;
const toml = (v) => JSON.stringify(v);
export function probeLevels(list) {
  const seen = new Set();
  return list.filter((s) => !s.level && !seen.has(levelName(s)) && seen.add(levelName(s))).map((s) => [
    '[[testing.levels]]', `name = ${toml(levelName(s))}`, `command = ${toml(s.command)}`, `service = ${toml(s.service)}`,
    ...(s.run ? [`run = ${toml(s.run)}`] : []), ...(s.adapter ? [`adapter = ${toml(s.adapter)}`] : []), ...(s.report_root ? [`report_root = ${toml(s.report_root)}`] : []), 'timeout_minutes = 10',
  ].join('\n')).join('\n\n');
}

export async function runAdapterProbes({ app, workdir, only = null, keep = false, socket = join(process.env.HOME, '.docker', 'run', 'docker.sock'), log = () => {} }) {
  mkdirSync(workdir, { recursive: true });
  const root = join(workdir, 'repo');
  const home = join(workdir, 'home');
  const outDir = join(workdir, 'out');
  mkdirSync(home, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: root, env: gitEnv }).toString();
  const docker = (...a) => spawnSync(DOCKER.client, a, { env: { PATH: '/usr/bin:/bin', HOME: home, DOCKER_HOST: `unix://${socket}` }, encoding: 'utf8' });
  for (const image of LOCAL_IMAGES) if (docker('image', 'inspect', image).status !== 0) throw new Error(`${image} isn't a local image; build the sample app's images first (never pulled here)`);
  execFileSync('/usr/bin/git', ['clone', '--quiet', '--no-local', app, root], { env: gitEnv });
  git('remote', 'remove', 'origin');
  let list = scenarios();
  if (only) list = list.filter((s) => only.includes(s.id));
  const cfgPath = join(root, '.mirai', 'config.toml');
  writeFileSync(cfgPath, `${readFileSync(cfgPath, 'utf8')}\n# Probe levels (unit 16a), this clone only.\n${probeLevels(list)}\n`);
  const env = { PATH: '/usr/bin:/bin', HOME: home };
  // The adapters ship with this MIRAI: the clone's framework copy is refreshed from it.
  if (list.some((s) => s.mirai)) init({ cwd: root, env, refresh: true });
  git('add', '-A');
  git('commit', '-qm', 'probe levels (unit 16a)');
  if (!list.some((s) => s.mirai)) createStore({ cwd: root, env });
  for (const [p, body] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  const report = { docker: docker('version', '--format', '{{.Server.Version}}').stdout.trim(), startedAt: new Date().toISOString(), base: git('rev-parse', 'HEAD').trim(), results: [] };
  try {
    for (const s of list) {
      if (s.broken) writeFileSync(join(root, s.broken), BROKEN[s.broken]);
      let r = null;
      let error = null;
      try {
        r = await runTest({ cwd: root, env, name: s.level ?? levelName(s), path: s.path ?? null, test: s.test ?? null, docker: { socket } });
      } catch (err) {
        error = { code: err.code, message: err.message };
        r = err.result ?? null;
      } finally {
        if (s.broken) rmSync(join(root, s.broken), { force: true });
      }
      const junitFile = r ? join(r.dir, 'out', 'junit.xml') : null;
      const junit = junitFile && existsSync(junitFile) ? readFileSync(junitFile, 'utf8') : null;
      if (junit !== null) writeFileSync(join(outDir, `${s.id}.junit.xml`), junit);
      const leftovers = [
        ...['ps', 'network', 'volume'].flatMap((k) => docker(...(k === 'ps' ? ['ps', '-aq'] : [k, 'ls', '-q']), '--filter', 'label=mirai.repo').stdout.split(/\s+/).filter(Boolean)),
        ...(r ? ['network', 'volume'].flatMap((k) => docker(k, 'ls', '-q', '--filter', `name=${r.project}`).stdout.split(/\s+/).filter(Boolean)) : []),
      ];
      const res = {
        id: s.id, j: s.j, title: s.title, command: s.command ?? null, path: s.path ?? null,
        outcome: r?.outcome ?? null, exit_code: r?.exit_code ?? null, error, tail: r?.output?.tail.slice(-3000) ?? null,
        out_files: r?.out_files ?? [], junit_bytes: junit === null ? null : Buffer.byteLength(junit), leftovers,
        ...(r?.report ? { report: r.report, tests: r.tests, failing: r.failing, failing_total: r.failing_total, test: r.test ?? null, added_args: r.added_args, added_env: r.added_env } : {}),
      };
      report.results.push(res);
      writeFileSync(join(outDir, 'adapter-results.json'), `${JSON.stringify(report, null, 2)}\n`);
      log(`${s.id}: ${r?.outcome ?? 'no result'}, exit ${r?.exit_code ?? '-'}${error ? ` (${error.code})` : ''}, junit ${junit === null ? 'none' : `${res.junit_bytes} bytes`}${leftovers.length ? `, LEFTOVERS ${leftovers.length}` : ''}`);
    }
    return report;
  } finally {
    writeFileSync(join(outDir, 'adapter-results.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (!keep) {
      // The trust root is read-only on purpose; open it up to remove it.
      spawnSync('/bin/chmod', ['-R', 'u+rwX', root, home]);
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, app: { type: 'string' }, workdir: { type: 'string' }, only: { type: 'string' }, keep: { type: 'boolean' } } });
  if (!values.yes) {
    process.stderr.write('this runs the sample app\'s containers on a throwaway clone under your home folder; add --yes to run\n');
    return 2;
  }
  const app = resolve(values.app ?? join(process.env.HOME, 'Projects', 'mirai-sample-app'));
  const workdir = values.workdir ? resolve(values.workdir) : mkdtempSync(join(process.env.HOME, '.mirai-probes-'));
  const report = await runAdapterProbes({ app, workdir, only: values.only?.split(',') ?? null, keep: values.keep === true, log: (l) => process.stdout.write(`${l}\n`) });
  process.stdout.write(`\nreport: ${join(workdir, 'out', 'adapter-results.json')}\n`);
  return report.results.some((r) => r.leftovers.length) ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
