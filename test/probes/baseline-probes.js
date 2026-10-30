#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { init } from '../../src/install/init.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { openStore } from '../../src/store/home.js';
import { recordBaseline } from '../../src/baseline/record.js';
import { report } from '../../src/cli/commands/baseline.js';

// Unit 17b: the test baseline of a throwaway clone of the sample app under your home folder (its
// origin removed, a temporary MIRAI home and a signing key made there, never yours), with this
// checkout's MIRAI (init --refresh) and the adapter lines 16a recommends, committed in the clone
// only. The sample app's own images, never pulled; nothing pushed. It must find
// KnownFailureSeedTest failing and flaky-seed.test.ts flaky. The flaky seed fails in the first run
// only about half the time: if it passed, `frontend` runs once more (within MAX_RUNS).
//
//   node test/probes/baseline-probes.js --yes [--app <sample app>] [--workdir <dir>] [--keep]

export const MAX_RUNS = 24;
const ADAPTER_LINES = [
  [/(name = "unit"\ncommand = \["php", "artisan", "test"\]\nservice = "app")/, '$1\nadapter = "phpunit"'],
  [/name = "frontend"\ncommand = \["npm", "test"\]\nservice = "frontend"/, 'name = "frontend"\ncommand = ["npm", "test", "--"]\nservice = "frontend"\nadapter = "vitest"'],
  [/(name = "e2e"\ncommand = \["npx", "playwright", "test"\]\nservice = "playwright")/, '$1\nadapter = "playwright"\nreport_root = "e2e/tests"'],
];

export async function runBaselineProbe({ app, workdir, keep = false, socket = join(process.env.HOME, '.docker', 'run', 'docker.sock'), log = () => {} }) {
  const root = join(workdir, 'repo');
  const home = join(workdir, 'home');
  const outDir = join(workdir, 'out');
  mkdirSync(home, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: root, env: gitEnv }).toString();
  execFileSync('/usr/bin/git', ['clone', '--quiet', '--no-local', app, root], { env: gitEnv });
  git('remote', 'remove', 'origin');
  const env = { PATH: '/usr/bin:/bin', HOME: home };
  try {
    init({ cwd: root, env, refresh: true });
    const cfg = join(root, '.mirai', 'config.toml');
    let text = readFileSync(cfg, 'utf8');
    for (const [re, to] of ADAPTER_LINES) {
      if (!re.test(text)) throw new Error(`the clone's config doesn't have the level ${re}`);
      text = text.replace(re, to);
    }
    writeFileSync(cfg, text);
    const key = createKeyPair(env);
    writePublicKeyFile(root, key.keyId, key.publicPem);
    git('add', '-A');
    git('commit', '-qm', 'probe: MIRAI refresh, adapters, a probe key (unit 17b)');
    const store = openStore({ cwd: root, env });
    const runs = () => readdirSync(join(store.dir, 'tests', 'gate')).length;
    const opts = { cwd: root, env, docker: { socket }, onEvent: log };
    let { baseline } = await recordBaseline(opts);
    const flaky = () => baseline.levels.frontend?.known_failures.find((k) => k.id?.endsWith('flaky-seed.test.ts::flaky seed > passes about half the time'));
    let attempts = 1;
    while (!flaky() && runs() < MAX_RUNS - 4 && attempts < 3) {
      log(`the flaky seed passed in frontend's run (${runs()} runs so far): frontend again`);
      ({ baseline } = await recordBaseline({ ...opts, levels: ['frontend'] }));
      attempts++;
    }
    const again = await recordBaseline(opts);
    const result = { runs: runs(), reused_second_time: again.reused, frontend_attempts: attempts, baseline };
    writeFileSync(join(outDir, 'baseline.json'), `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(join(outDir, 'report.txt'), report(baseline));
    return result;
  } finally {
    if (!keep) {
      spawnSync('/bin/chmod', ['-R', 'u+rwX', root, home]);
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, app: { type: 'string' }, workdir: { type: 'string' }, keep: { type: 'boolean' } } });
  if (!values.yes) {
    process.stderr.write(`this runs the sample app's containers on a throwaway clone under your home folder (at most ${MAX_RUNS} runs); add --yes to run\n`);
    return 2;
  }
  const app = resolve(values.app ?? join(process.env.HOME, 'Projects', 'mirai-sample-app'));
  const workdir = values.workdir ? resolve(values.workdir) : mkdtempSync(join(process.env.HOME, '.mirai-probes-'));
  const r = await runBaselineProbe({ app, workdir, keep: values.keep === true, log: (l) => process.stdout.write(`${l}\n`) });
  process.stdout.write(`\n${report(r.baseline)}\nruns: ${r.runs}; second baseline reused: ${r.reused_second_time}\nkept: ${join(workdir, 'out')}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
