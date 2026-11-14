#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { main } from '../../src/cli/main.js';
import { installHooks } from '../../src/hooks/install.js';
import { init } from '../../src/install/init.js';
import { TOOLS_FILE } from '../../src/ship/host.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { startRun, writeRunState } from '../../src/store/run.js';

// Unit 29c's probes (your OK, 2026-11-14). No model, nothing outside a temporary folder.
//   P1: mirai doctor on your sample app as it is (reads only).
//   P2: a throwaway clone of it with its own MIRAI home, seeded with faults: the hook's Node gone,
//       gh pointed at a missing path, a dead process's lock and breaker, the run state and the
//       branch registry deleted. doctor names each red with its hint; --fix repairs the lock, the
//       breaker, the run state and the registry, and leaves the hook and gh red, named. Then one
//       journal line broken: doctor names the file, and --fix leaves its bytes as they were.
// A stand-in login token in the probe's home (never yours); the folder is deleted at the end.
//   node test/probes/doctor-probes.js [--app <sample app>]

const { values } = parseArgs({ options: { app: { type: 'string' } } });
const app = resolve(values.app ?? join(process.env.HOME, 'Projects', 'mirai-sample-app'));
const LAUNCHER = fileURLToPath(new URL('../../bin/launch.js', import.meta.url));
const STANDIN = `sk-ant-oat01-${'Pr0be_'.repeat(14)}`;
let ok = true;
const check = (what, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${!cond && detail ? `\n      ${detail.split('\n').join('\n      ')}` : ''}`);
  if (!cond) ok = false;
};
const doctor = async (argv, io) => {
  let out = '';
  let err = '';
  const code = await main(['doctor', ...argv], { stdin: { isTTY: false }, stdout: { isTTY: false, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, ...io });
  return { code, out, err };
};
const line = (out, title) => out.split('\n').find((l) => l.slice(8).startsWith(title)) ?? '';

// P1
const p1 = await doctor([], { cwd: app, env: process.env });
console.log(p1.out);
check('P1: green on the sample app but for yellows (exit 0, no red)', p1.code === 0 && /^doctor: \d+ ok, \d+ yellow, 0 red$/m.test(p1.out), p1.out.slice(-400));
check('P1: every yellow has its hint under "to do"', (p1.out.match(/^yellow/gm) ?? []).length === (p1.out.split('to do:')[1]?.match(/^  \S/gm) ?? []).length);

// P2
const workdir = realpathSync(mkdtempSync(join(tmpdir(), 'mirai-doctor-probe-')));
try {
  const root = join(workdir, 'repo');
  mkdirSync(join(workdir, 'home'), { recursive: true, mode: 0o700 });
  const home = realpathSync(join(workdir, 'home'));
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: root, env: gitEnv }).toString();
  execFileSync('/usr/bin/git', ['clone', '--quiet', '--no-local', '--branch', 'main', app, root], { env: gitEnv });
  git('remote', 'remove', 'origin');
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USER: process.env.USER, LANG: 'C' };
  init({ cwd: root, env, refresh: true });
  const key = createKeyPair(env);
  writePublicKeyFile(root, key.keyId, key.publicPem);
  git('add', '-A');
  git('commit', '-qm', 'probe: refresh and a key (unit 29c)');
  writeToken(env, STANDIN);
  const store = openStore({ cwd: root, env });
  // A run that finished, so there's a run log and a run state.
  startRun(store, { preset: 'supervised' });
  writeRunState(store, 'finished');
  // The hook, with a Node that's then removed.
  const node = join(workdir, 'node');
  copyFileSync(process.execPath, node);
  installHooks({ store, env, node, launcher: LAUNCHER });
  const io = { cwd: root, env };
  const before = await doctor([], io);
  check('P2: before the faults, store, registry and hook are ok', ['Store', 'Branch registry', 'Hook\'s Node'].every((t) => line(before.out, t).startsWith('ok')), before.out);

  // The faults.
  rmSync(node);
  writeFileSync(join(store.dir, TOOLS_FILE), JSON.stringify({ schema_version: 1, github: join(workdir, 'gone', 'gh') }));
  const dead = 4_194_000;
  for (const p of [join(store.dir, 'locks', 'tests.lock'), join(store.dir, 'locks', 'journal.lock.break')]) writeFileSync(p, `${JSON.stringify({ pid: dead, host: 'probe', purpose: 'probe', started_at: new Date().toISOString() })}\n`, { mode: 0o600 });
  rmSync(join(store.dir, 'state.json'));
  rmSync(join(store.dir, 'branches.json'));
  const seeded = await doctor([], io);
  console.log(seeded.out);
  check('P2: exit 5 (needs you) with red items', seeded.code === 5);
  check('P2: the hook\'s Node named red', /^red +Hook's Node .*isn't there: every push fails/m.test(seeded.out), line(seeded.out, 'Hook\'s Node'));
  check('P2: gh named red', /^red +Host CLIs .*gone\/gh isn't there/m.test(seeded.out), line(seeded.out, 'Host CLIs'));
  check('P2: the dead locks named red', /^red +Store .*left by a process that's gone \(pid 4194000/m.test(seeded.out), line(seeded.out, 'Store'));
  check('P2: the registry named red', /^red +Branch registry .*missing/m.test(seeded.out), line(seeded.out, 'Branch registry'));

  // One --fix: it checks again after each repair (the run state hides behind the locks).
  const f1 = await doctor(['--fix'], io);
  console.log(f1.out.split('\n').filter((l) => /^(fixed|not fixed)/.test(l)).join('\n'));
  const fixedAll = f1.out;
  check('P2: --fix removed the dead lock and breaker', /^fixed locks: removed 2/m.test(fixedAll) && !existsSync(join(store.dir, 'locks', 'tests.lock')) && !existsSync(join(store.dir, 'locks', 'journal.lock.break')));
  check('P2: --fix rebuilt the registry', /^fixed registry: rebuilt/m.test(fixedAll) && existsSync(join(store.dir, 'branches.json')));
  check('P2: --fix rebuilt the run state from its log', /^fixed run-state: rebuilt from run r-\S+'s log: finished/m.test(fixedAll) && existsSync(join(store.dir, 'state.json')));
  const after = await doctor([], io);
  check('P2: after --fix, store and registry ok', line(after.out, 'Store').startsWith('ok') && line(after.out, 'Branch registry').startsWith('ok'), after.out);
  check('P2: after --fix, the hook and gh still red, named (not --fix\'s to repair)', line(after.out, 'Hook\'s Node').startsWith('red') && line(after.out, 'Host CLIs').startsWith('red'));

  // Damaged history: one journal line broken.
  const journal = join(store.dir, 'journal.jsonl');
  writeFileSync(journal, `${readFileSync(journal, 'utf8')}{"seq": 999, "broken": \n`);
  const broken = readFileSync(journal);
  const h1 = await doctor([], io);
  const h2 = await doctor(['--fix'], io);
  console.log(h1.out);
  check('P2: the broken journal named red, with its file', /^red +Store .*journal\.jsonl/m.test(h1.out) && h1.code === 5, h1.out);
  check('P2: the hint says MIRAI never rewrites history', /never rewrites its history/.test(h1.out));
  check('P2: --fix left the journal\'s bytes as they were', Buffer.compare(readFileSync(journal), broken) === 0 && h2.code === 5);
} catch (err) {
  check(`P2 stopped: ${err.message}`, false, err.stack ?? '');
} finally {
  // MIRAI keeps its trust trees read-only: writable again first, so they can be deleted.
  execFileSync('/bin/chmod', ['-R', 'u+w', workdir]);
  rmSync(workdir, { recursive: true, force: true });
  check('clean-up: the probe folder (with its stand-in token) is deleted', !existsSync(workdir));
}
console.log(ok ? 'P1, P2: PASS' : 'P1, P2: FAIL');
process.exitCode = ok ? 0 : 1;
