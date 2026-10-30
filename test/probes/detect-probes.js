#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { init } from '../../src/install/init.js';
import { detect } from '../../src/detect/detect.js';
import { report } from '../../src/cli/commands/detect.js';

// Unit 17a: `mirai detect` on a throwaway clone of the sample app under your home folder (its
// origin removed, a temporary MIRAI home), with this checkout's MIRAI (mirai init --refresh,
// committed in the clone only). Docker resolves the compose file; no container starts, nothing is
// pulled or pushed. The report, the draft and the facts are kept in <workdir>/out/.
// (Probe D1, the PHPUnit suite levels, is in adapter-probes.js: the d- scenarios.)
//
//   node test/probes/detect-probes.js --yes [--app <sample app>] [--workdir <dir>] [--keep]

export async function runDetectProbe({ app, workdir, keep = false, socket = join(process.env.HOME, '.docker', 'run', 'docker.sock') }) {
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
    git('add', '-A');
    git('commit', '-qm', 'refresh MIRAI (unit 17a probe)');
    const r = await detect({ cwd: root, env, docker: { socket } });
    writeFileSync(join(outDir, 'report.txt'), report(r));
    writeFileSync(join(outDir, 'config.draft.toml'), r.text);
    writeFileSync(join(outDir, 'facts.json'), `${JSON.stringify({ facts: r.facts, differences: r.differences }, null, 2)}\n`);
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
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, app: { type: 'string' }, workdir: { type: 'string' }, keep: { type: 'boolean' } } });
  if (!values.yes) {
    process.stderr.write('this clones the sample app under your home folder and runs mirai detect on it (docker compose config only); add --yes to run\n');
    return 2;
  }
  const app = resolve(values.app ?? join(process.env.HOME, 'Projects', 'mirai-sample-app'));
  const workdir = values.workdir ? resolve(values.workdir) : mkdtempSync(join(process.env.HOME, '.mirai-probes-'));
  const r = await runDetectProbe({ app, workdir, keep: values.keep === true });
  process.stdout.write(`${report(r)}\nkept: ${join(workdir, 'out')}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
