#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { init } from '../../src/install/init.js';
import { loadSigner } from '../../src/sign/signer.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { openStore } from '../../src/store/home.js';
import { redact } from '../../src/redteam/claude.js';
import { report } from '../../src/redteam/report.js';
import { DEFAULTS, runRedTeam } from '../../src/redteam/run.js';

// Unit 18a: the red team on a throwaway clone of the sample app under your home folder, for my
// probe runs (the CLI is `mirai redteam run`, which asks you in a terminal). The clone gets this
// checkout's MIRAI (init --refresh) and a signing key, both made in a temporary home, never yours,
// and committed in the clone only; its origin is removed, nothing is pushed. MIRAI's store and the
// result live in that temporary home; the launches use your real HOME (so the home deny is tested
// for real) and the login token from `mirai token set`, never printed.
//
//   node test/probes/redteam-probe.js --yes [--app <sample app>] [--workdir <dir>] [--only id,id]
//                                     [--workers 4] [--runs 3] [--fake] [--keep]
//
// --fake: a stand-in for claude that answers nothing (every case inconclusive), to try the whole
// path with no model and no subscription.

const fakeLaunch = async () => ({ exit: 1, stdout: '', stderr: 'fake: no model', timedOut: false });

export async function runRedTeamProbe({ app, workdir, only = null, workers = DEFAULTS.workers, runs = DEFAULTS.runs, fake = false, keep = false, log = () => {} }) {
  const root = join(workdir, 'repo');
  const home = join(workdir, 'home');
  const out = join(workdir, 'out');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(out, { recursive: true });
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: root, env: gitEnv }).toString();
  execFileSync('/usr/bin/git', ['clone', '--quiet', '--no-local', app, root], { env: gitEnv });
  git('remote', 'remove', 'origin');
  const storeEnv = { PATH: '/usr/bin:/bin', HOME: home };
  try {
    init({ cwd: root, env: storeEnv, refresh: true });
    const key = createKeyPair(storeEnv);
    writePublicKeyFile(root, key.keyId, key.publicPem);
    git('add', '-A');
    git('commit', '-qm', 'probe: MIRAI refresh and a probe key (unit 18a)');
    const signer = loadSigner(storeEnv, openStore({ cwd: root, env: storeEnv }));
    const r = await runRedTeam({
      cwd: root, env: process.env, storeEnv, consent: true, only, workers, runs, signer, workdir: join(workdir, 'rt'), keep,
      ...(fake ? { launch: fakeLaunch } : {}),
      onEvent: (ev) => {
        if (ev.type === 'run') log(`${ev.id} (${ev.template}) run ${ev.n}: ${ev.outcome}  ${ev.note}`);
        if (ev.type === 'static') for (const s of ev.checks) log(`${s.id}: ${s.state}  ${s.note}`);
      },
    });
    writeFileSync(join(out, 'result.json'), `${redact(JSON.stringify(r.result, null, 2), null)}\n`);
    writeFileSync(join(out, 'report.txt'), report(r.result, r));
    return r;
  } finally {
    if (!keep) {
      spawnSync('/bin/chmod', ['-R', 'u+rwX', root, home]);
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }
}

async function cli() {
  const { values } = parseArgs({
    options: {
      yes: { type: 'boolean' }, app: { type: 'string' }, workdir: { type: 'string' }, only: { type: 'string' },
      workers: { type: 'string' }, runs: { type: 'string' }, fake: { type: 'boolean' }, keep: { type: 'boolean' },
    },
  });
  if (!values.yes) {
    process.stderr.write('this runs the red team on a throwaway clone of the sample app, with your Claude subscription (Haiku) unless --fake; add --yes to run\n');
    return 2;
  }
  const app = resolve(values.app ?? join(process.env.HOME, 'Projects', 'mirai-sample-app'));
  const workdir = values.workdir ? resolve(values.workdir) : mkdtempSync(join(process.env.HOME, '.mirai-probes-'));
  const r = await runRedTeamProbe({
    app, workdir, only: values.only?.split(',') ?? null, workers: Number(values.workers ?? DEFAULTS.workers), runs: Number(values.runs ?? DEFAULTS.runs),
    fake: values.fake === true, keep: values.keep === true, log: (l) => process.stdout.write(`${redact(l, null)}\n`),
  });
  process.stdout.write(`\n${report(r.result, r)}\nkept: ${join(workdir, 'out')}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
