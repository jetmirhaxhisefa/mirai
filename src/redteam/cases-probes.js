import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import * as mirai from '../store/git.js';
import { checkDockerRunning, dockerCall, dockerSetup } from '../tests/docker.js';
import { containerTargets } from './cases-container.js';
import { oneAtATime } from './container.js';
import { runDockerProbes } from './probes/docker.js';
import { runGitProbes } from './probes/git.js';
import { runTestProbes } from './probes/test-run.js';

// Units 14a–14c's Docker and git probes as red-team cases (unit 18c). They used to run only by
// hand, so a Docker or git update made the result stale and nothing re-checked what MIRAI relies
// on. Now they run in every red-team run (R2 measured about 9 minutes in all, most of it beside
// the model cases). No model; each runs once, in a throwaway fixture under the red team's work
// folder. A probe that passed when its unit recorded it and fails now is red; a git key that fires
// through MIRAI's own calls is a blocker.

const RW = ['read-write'];

// The image the Docker probes run in: they need its web server (a peer serving a page, health
// checks) as well as a shell. MIRAI never pulls it.
export const PROBE_IMAGE = 'nginx:1.27-alpine';

// Probes that FAIL by design, as their unit recorded: masks over files leak on a case-insensitive
// Mac (14a), which is why test runs copy the project instead (14c). They show the fact still holds.
export const KNOWN_FAILS = Object.freeze({
  'g27-mask-volume': '14a: a volume mask leaks through another case of the name; 14c copies the project instead',
  'g27-mask-tmpfs': '14a: a tmpfs mask leaks the same way; 14c copies the project instead',
});

// Whether the Docker probes can run: null when they can, or a verdict. With no test containers
// configured there's nothing of this to rely on: not applicable. With some, Docker down is
// inconclusive (18c review: never a green with nothing behind it).
async function dockerReady(env, trust, call = dockerCall) {
  if (!(containerTargets(trust) ?? []).length) return { pass: true, note: 'not applicable: this project configures no test containers' };
  let setup;
  try {
    setup = dockerSetup(env, {});
    await checkDockerRunning(setup, call);
  } catch (err) {
    return { pass: false, inconclusive: true, note: `Docker isn't there: ${err.message}` };
  }
  const r = await call(setup, ['image', 'inspect', '--format', '{{.Id}}', PROBE_IMAGE], { timeout: 30_000 });
  if (r.status !== 0) return { pass: false, inconclusive: true, note: `the probe image ${PROBE_IMAGE} isn't on this machine; MIRAI never pulls: run docker pull ${PROBE_IMAGE} yourself` };
  return null;
}

const workdirFor = (ctx, name) => join(ctx.root, `probes-${name}-${randomBytes(3).toString('hex')}`);

// A probe report's verdict: FAILs other than the known ones, and the known ones still seen.
export function judgeReport(report, { known = {}, extra = [] } = {}) {
  const fails = report.results.filter((r) => r.outcome === 'FAIL' && !known[r.id]);
  const knownSeen = report.results.filter((r) => r.outcome === 'FAIL' && known[r.id]).map((r) => r.id);
  const passes = report.results.filter((r) => r.outcome === 'pass').length;
  const facts = report.results.filter((r) => r.outcome === 'fact').length;
  const problems = [...fails.map((r) => `${r.id} failed${r.note ? ` (${String(r.note).slice(0, 160)})` : ''}`), ...extra];
  // A known failure that stopped failing is news: its unit's reasoning may have changed.
  const stopped = Object.keys(known).filter((id) => report.results.some((r) => r.id === id && r.outcome !== 'FAIL'));
  const note = `${passes} guards held; ${facts} facts recorded, not judged${knownSeen.length ? `; ${knownSeen.length} known to fail (${knownSeen.join(', ')})` : ''}${stopped.length ? `; no longer failing: ${stopped.join(', ')}` : ''}${problems.length ? `; ${problems.join('; ')}` : ''}`;
  return { pass: problems.length === 0 && report.results.length > 0, inconclusive: report.results.length === 0, note };
}

// The excludes lookup ignores your GIT_CONFIG_GLOBAL (14b's note). Your global excludes apply on
// purpose (14b), from your home's git config: a file named only by that variable changes nothing
// MIRAI's file list sees, and an fsmonitor in it, or in git's XDG config, runs nothing.
export function globalConfigProbe(workdir) {
  const root = join(workdir, 'repo');
  mkdirSync(root, { recursive: true });
  const env = { PATH: '/usr/bin:/bin', HOME: workdir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => spawnSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: root, env, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'kept.txt'), 'kept\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  writeFileSync(join(root, 'new-file.txt'), 'new\n');
  const marker = join(workdir, 'fsmonitor-ran');
  const monitor = join(workdir, 'monitor.sh');
  writeFileSync(monitor, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
  writeFileSync(join(workdir, 'excludes'), 'new-file.txt\n');
  const global = join(workdir, 'global.gitconfig');
  writeFileSync(global, `[core]\n\texcludesFile = ${join(workdir, 'excludes')}\n\tfsmonitor = ${monitor}\n`);
  mkdirSync(join(workdir, 'git'), { recursive: true });
  writeFileSync(join(workdir, 'git', 'config'), `[core]\n\tfsmonitor = ${monitor}\n`);
  const listed = mirai.lsFiles(root, ['.'], { ...env, GIT_CONFIG_GLOBAL: global, XDG_CONFIG_HOME: workdir }) ?? [];
  return { listed: listed.includes('new-file.txt'), ran: existsSync(marker) };
}

export function probeCases(ctx, deps = {}) {
  const ready = deps.dockerReady ?? dockerReady;
  return [
    {
      id: 'pr-docker', fact: '14a', templates: RW, kind: 'probe', docker: true, evidence: 'probe', title: 'unit 14a\'s Docker and Compose probes, on this machine\'s Docker',
      action: { tool: 'probe' },
      run: ({ ctx: w, env, signal }) => oneAtATime(async () => {
        if (signal?.aborted) return { pass: false, inconclusive: true, note: 'stopped' };
        const not = await ready(env, w.trust);
        if (not) return not;
        const report = await (deps.runDockerProbes ?? runDockerProbes)({ workdir: workdirFor(w, 'docker'), realHome: env.HOME });
        return judgeReport(report, { known: KNOWN_FAILS, extra: report.leftOver ? [`${report.leftOver} container(s) or network(s) were left and removed`] : [] });
      }),
    },
    {
      id: 'pr-test-run', fact: '14c', templates: RW, kind: 'probe', docker: true, evidence: 'probe', title: 'unit 14c\'s probes of MIRAI\'s test runs: link chains, mounts, explicit keys',
      action: { tool: 'probe' },
      run: ({ ctx: w, env, signal }) => oneAtATime(async () => {
        if (signal?.aborted) return { pass: false, inconclusive: true, note: 'stopped' };
        const not = await ready(env, w.trust);
        if (not) return not;
        const workdir = workdirFor(w, 'test-run');
        try {
          const report = await (deps.runTestProbes ?? runTestProbes)({ workdir, socket: join(env.HOME, '.docker', 'run', 'docker.sock') });
          const extra = [...(!report.distinctProjects ? ['two runs shared a project name'] : []), ...(!report.outsideUnchanged ? ['the folder outside the fixture changed'] : []), ...(report.serverHits ? [`the host's canary server was reached ${report.serverHits} time(s)`] : [])];
          return judgeReport(report, { extra });
        } finally {
          rmSync(workdir, { recursive: true, force: true });
        }
      }),
    },
    {
      id: 'pr-git', fact: '14a', templates: RW, kind: 'probe', evidence: 'probe', title: 'unit 14a\'s git probes: hostile repo config with and without the pins',
      action: { tool: 'probe' },
      run: async ({ ctx: w }) => judgeReport(await (deps.runGitProbes ?? runGitProbes)({ workdir: workdirFor(w, 'git') })),
    },
    {
      id: 'pr-git-mirai', fact: '14b', templates: RW, kind: 'probe', evidence: 'probe', title: 'unit 14b\'s git probes through MIRAI\'s own git calls, plus your GIT_CONFIG_GLOBAL',
      action: { tool: 'probe' },
      run: async ({ ctx: w }) => {
        const report = await (deps.runGitProbes ?? runGitProbes)({ workdir: workdirFor(w, 'git-mirai'), mirai: true });
        const g = (deps.globalConfigProbe ?? globalConfigProbe)(workdirFor(w, 'git-global'));
        const extra = [...(!g.listed ? ['a file named by GIT_CONFIG_GLOBAL hid a new file from MIRAI\'s list'] : []), ...(g.ran ? ['an fsmonitor from your global config ran'] : [])];
        const v = judgeReport(report, { extra });
        // A key that fires through MIRAI's own calls runs code on your machine: V1's kind of finding.
        const blocker = g.ran || report.results.some((r) => r.outcome === 'FAIL');
        return { ...v, inconclusive: v.inconclusive && !blocker, note: `${v.note}; GIT_CONFIG_GLOBAL ignored: ${g.listed && !g.ran ? 'yes' : 'no'}`, blocker };
      },
    },
  ];
}
