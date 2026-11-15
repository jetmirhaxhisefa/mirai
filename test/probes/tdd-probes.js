#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { floorGuard, markersOf, redCheck } from '../../src/agent/tdd.js';
import { init } from '../../src/install/init.js';
import { trustedAdapters } from '../../src/tests/adapters.js';
import { runTest } from '../../src/tests/run.js';
import { snapshot, trustedConfig } from '../../src/trust/snapshot.js';

// Unit 23's R2, the seeded half on real runners (no model): a throwaway clone of your sample app
// with its own MIRAI home, its tests run in Docker as MIRAI runs them. It checks what the stand-in
// tests can't: that real PHPUnit and Vitest reports tell the red check's verdicts apart.
//   1. PHPUnit: a test calling a method that doesn't exist: the wrong reason (an error);
//   2. PHPUnit: the same test with a stub returning a wrong value: red, by an assertion;
//   3. PHPUnit: a test that passes already: refused;
//   4. PHPUnit: a file that doesn't parse: the wrong reason (load);
//   5. Vitest: an expect() that fails: red; a TypeError: the wrong reason;
//   6. the floor guard on the clone's git: a weakened existing test, a new markTestSkipped, an
//      added test (fine).
// Docker Desktop must be running. The clone is deleted at the end.
//   node test/probes/tdd-probes.js [--app <sample app>]

const { values } = parseArgs({ options: { app: { type: 'string' } } });
const app = resolve(values.app ?? join(process.env.HOME, 'Projects', 'mirai-sample-app'));
let ok = true;
const check = (what, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${!cond && detail ? `\n      ${String(detail).split('\n').join('\n      ')}` : ''}`);
  if (!cond) ok = false;
};
const workdir = realpathSync(mkdtempSync(join(tmpdir(), 'mirai-tdd-probe-')));
try {
  const root = join(workdir, 'repo');
  mkdirSync(join(workdir, 'home'), { recursive: true, mode: 0o700 });
  const home = realpathSync(join(workdir, 'home'));
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: root, env: gitEnv }).toString().trim();
  execFileSync('/usr/bin/git', ['clone', '--quiet', '--no-local', '--branch', 'main', app, root], { env: gitEnv });
  git('remote', 'remove', 'origin');
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin`, HOME: home, USER: process.env.USER, LANG: 'C' };
  init({ cwd: root, env, refresh: true });
  git('add', '-A');
  git('commit', '-qm', 'probe: refresh (unit 23)');
  const base = git('rev-parse', 'HEAD');
  const trust = snapshot({ cwd: root, env });

  const T = 'backend/tests/Unit/RedProbeTest.php';
  const php = (body) => `<?php\n\nnamespace Tests\\Unit;\n\nuse App\\Models\\Task;\nuse Tests\\TestCase;\n\nclass RedProbeTest extends TestCase\n{\n${body}\n}\n`;
  const write = (p, text) => {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  };
  const row = (id, kind = 'red', level = 'unit') => {
    const sep = id.indexOf('::');
    return { id, path: sep >= 0 ? id.slice(0, sep) : id, name: sep >= 0 ? id.slice(sep + 2) : null, level, kind };
  };
  // Docker's real socket, given to the runner as the other probes do (the probe home has none).
  const socket = join(process.env.HOME, '.docker', 'run', 'docker.sock');
  const red = async (rows) => redCheck({ rows, run: (o) => runTest({ ...o, docker: { socket } }), cwd: root, env, trust });

  // 1–3. One file: a missing method, then the stub, then a test that passes already.
  write(T, php('    public function test_priority(): void\n    {\n        $this->assertSame(2, (new Task)->probePriority());\n    }\n\n    public function test_already(): void\n    {\n        $this->assertTrue(true);\n    }'));
  let c = await red([row(`${T}::test_priority`), row(`${T}::test_already`)]);
  check('1: PHPUnit, a missing method: the wrong reason', c.rows[0].verdict === 'wrong-reason', JSON.stringify(c.rows[0]));
  check('3: PHPUnit, a test that passes already: refused', c.rows[1].verdict === 'passes', JSON.stringify(c.rows[1]));
  const model = 'backend/app/Models/Task.php';
  const before = readFileSync(join(root, model), 'utf8');
  writeFileSync(join(root, model), before.replace(/\}\s*$/, '\n    public function probePriority(): int\n    {\n        return 0;\n    }\n}\n'));
  c = await red([row(`${T}::test_priority`)]);
  check('2: PHPUnit, with a stub returning a wrong value: red, by an assertion', c.rows[0].verdict === 'ok' && /Failed asserting/.test(c.rows[0].message ?? ''), JSON.stringify(c.rows[0]));
  writeFileSync(join(root, model), before);

  // 4. A file that doesn't parse.
  write(T, php('    public function test_broken(): void\n    {\n        $this->assertSame(2, ;\n    }'));
  c = await red([row(T)]);
  check('4: PHPUnit, a file that doesn\'t parse: the wrong reason', c.rows[0].verdict === 'wrong-reason', JSON.stringify(c.rows[0]));
  rmSync(join(root, T));

  // 5. Vitest.
  const V = 'frontend/src/red-probe.test.ts';
  write(V, "import { describe, expect, it } from 'vitest';\n\ndescribe('red probe', () => {\n  it('asserts', () => {\n    expect(1 + 1).toBe(3);\n  });\n  it('throws', () => {\n    const o: any = undefined;\n    expect(o.x).toBe(1);\n  });\n});\n");
  c = await red([row(`${V}::red probe > asserts`, 'red', 'frontend'), row(`${V}::red probe > throws`, 'red', 'frontend')]);
  check('5: Vitest, a failing expect(): red', c.rows[0].verdict === 'ok', JSON.stringify(c.rows[0]));
  check('5: Vitest, a TypeError: the wrong reason', c.rows[1].verdict === 'wrong-reason', JSON.stringify(c.rows[1]));
  rmSync(join(root, V));

  // 6. The floor guard, with the adapters' own markers.
  const markers = markersOf(trustedConfig(trust), trustedAdapters(trust));
  const existing = 'backend/tests/Feature/TaskApiTest.php';
  const text = readFileSync(join(root, existing), 'utf8');
  const guard = () => floorGuard({ root, env: gitEnv, base, testFiles: [existing], markers });
  writeFileSync(join(root, existing), text.replace(/\}\s*$/, '\n    public function test_probe_added(): void\n    {\n        $this->assertTrue(true);\n    }\n}\n'));
  check('6: an existing test file with a test added: fine', guard().length === 0, JSON.stringify(guard()));
  writeFileSync(join(root, existing), text.replace('assertCreated()', 'assertOk()'));
  check('6: an existing test weakened: stopped', guard().some((s) => /an existing test changed/.test(s.why)), JSON.stringify(guard()));
  writeFileSync(join(root, existing), text.replace(/(public function test_[a-z_]+\(\): void\n\s*\{\n)/, '$1        $this->markTestSkipped(\'later\');\n'));
  check('6: a new markTestSkipped: stopped', guard().some((s) => /skips or focuses/.test(s.why)), JSON.stringify(guard()));
  writeFileSync(join(root, existing), text);
} catch (err) {
  check(`R2 stopped: ${err.message}`, false, err.stack);
} finally {
  try {
    execFileSync('/bin/chmod', ['-R', 'u+w', workdir]);
  } catch {
    // gone already
  }
  rmSync(workdir, { recursive: true, force: true });
  check('clean-up: the probe folder is deleted', !existsSync(workdir));
}
console.log(ok ? 'R2: PASS' : 'R2: FAIL');
process.exitCode = ok ? 0 : 1;
