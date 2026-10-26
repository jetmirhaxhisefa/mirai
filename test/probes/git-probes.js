#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { pinArgs, pinEnv } from '../../src/store/git-pins.js';
import { buildComposeFixture, gitProbeDir, gitTemplate, removeComposeFixture, startServer } from './compose-fixture.js';
import { GIT_STEPS, gitProbes, markText, workChanges } from './compose-probes.js';

// Unit 14a: the git probes (G15, G23). Each probe plants one hostile key in a fresh copy of a
// fixture repo, then runs MIRAI's git commands twice: as control (repo config only, no system or
// global file) and with the pin set from src/store/git-pins.js. A key that fired in the control
// and not with the pins is neutralised; one that fired in both is not pinnable, and only D-54's
// integrity hash can catch it. No network: remotes are local folders or a server on 127.0.0.1.
//
//   node test/probes/git-probes.js --yes [--workdir <dir>] [--only id,id] [--keep]

const IDENTITY = {
  GIT_AUTHOR_NAME: 'Probe', GIT_AUTHOR_EMAIL: 'probe@example.invalid',
  GIT_COMMITTER_NAME: 'Probe', GIT_COMMITTER_EMAIL: 'probe@example.invalid',
};
const CONTROL_ENV = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', ...IDENTITY };

const clean = (env) => Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined));

// One mode of one probe: a fresh repo with the key planted, MIRAI's commands, did it fire.
function runMode(probe, ctx, x, template, mode, git) {
  const d = gitProbeDir(ctx, template, probe.id, mode);
  probe.plant(d, x);
  workChanges(d);
  probe.before?.(d);
  const pinDir = join(d.dir, 'pin');
  const protos = probe.allowProto ?? [];
  let env;
  let prefix;
  if (mode === 'control') {
    env = clean({ ...CONTROL_ENV, HOME: join(pinDir, 'home'), ...(probe.controlEnv?.(d) ?? {}) });
    prefix = [];
  } else {
    env = clean({ ...pinEnv(pinDir, { top: d.repo }), ...IDENTITY, ...(probe.pinnedEnv?.(d) ?? {}) });
    // A probe of a pin behind the protocol allowlist lets that one protocol through, so the pin
    // itself is what's tested.
    if (protos.length) env.GIT_ALLOW_PROTOCOL = ['file', 'https', ...protos].join(':');
    prefix = [...pinArgs(pinDir), ...protos.flatMap((p) => ['-c', `protocol.${p}.allow=always`])];
  }
  const run = (args, input) => spawnSync(git, [...prefix, ...args], { cwd: d.repo, env, input, encoding: 'utf8', timeout: 20_000 });
  const steps = {};
  const failed = [];
  for (const [name, args, input] of GIT_STEPS) {
    const push = mode === 'control' && probe.controlPush ? probe.controlPush(d) : probe.push(d);
    const r = run(args(mode === 'pinned', push), input);
    steps[name] = `${r.stdout ?? ''}`;
    if (r.status !== 0) failed.push(name);
  }
  const marks = markText(d);
  const fired = probe.hit ? Boolean(probe.hit(d, run, steps)) : marks !== '';
  return { fired, marks: marks.split('\n').filter(Boolean).map((l) => l.replace(d.dir, '<dir>')).slice(0, 6), failed };
}

export function classify(control, pinned) {
  if (control && !pinned) return 'neutralised';
  if (control && pinned) return 'not pinnable';
  if (!control && !pinned) return 'inert';
  return 'fires only pinned';
}

export async function runGitProbes({ workdir, only = null, keep = false, git = 'git', log = () => {} }) {
  const ctx = buildComposeFixture(workdir);
  const server = await startServer({ body: ctx.canaries.http, hitsFile: join(ctx.root, 'out', 'server-hits') });
  const auth = await startServer({ status: 401, hitsFile: join(ctx.root, 'out', 'auth-hits') });
  const x = { server, authPort: auth.port };
  const report = {
    git: spawnSync(git, ['--version'], { encoding: 'utf8' }).stdout.trim(), startedAt: new Date().toISOString(),
    conditions: 'one fresh repo per probe and mode; control = repo config only (no system or global file); pinned = src/store/git-pins.js; MIRAI\'s commands in GIT_STEPS',
    results: [],
  };
  try {
    const template = gitTemplate(ctx);
    let probes = gitProbes(x);
    if (only) probes = probes.filter((p) => only.includes(p.id));
    for (const probe of probes) {
      const control = runMode(probe, ctx, x, template, 'control', git);
      const pinned = runMode(probe, ctx, x, template, 'pinned', git);
      const kind = classify(control.fired, pinned.fired);
      const outcome = probe.expect ? (kind === probe.expect ? 'pass' : 'FAIL') : 'fact';
      const res = {
        id: probe.id, fact: probe.fact, title: probe.title, kind, outcome,
        control: { fired: control.fired, marks: control.marks, failedSteps: control.failed },
        pinned: { fired: pinned.fired, marks: pinned.marks, failedSteps: pinned.failed },
      };
      report.results.push(res);
      log(`${probe.id}: ${outcome} (${kind})`);
    }
    return report;
  } finally {
    await server.close();
    await auth.close();
    writeFileSync(join(ctx.root, 'out', 'git-results.json'), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(ctx.root, 'out', 'git-results.md'), `${gitMarkdown(report)}\n`);
    if (!keep) removeComposeFixture(ctx);
  }
}

function gitMarkdown(report) {
  const cell = (s) => String(s).replace(/\|/g, '\\|');
  return [
    '# git probes (unit 14a)',
    '',
    `${report.git}, ${report.startedAt}. ${report.conditions}.`,
    '',
    '| Probe | Fact | Outcome | Kind | Control: fired, marks | Pinned: fired, marks | Steps that failed (control / pinned) |',
    '|---|---|---|---|---|---|---|',
    ...report.results.map((r) => `| ${r.id} | ${r.fact} | **${r.outcome}** | ${r.kind} | ${r.control.fired ? 'yes' : 'no'}: ${cell(r.control.marks.join('; '))} | ${r.pinned.fired ? 'yes' : 'no'}: ${cell(r.pinned.marks.join('; '))} | ${r.control.failedSteps.join(',') || '-'} / ${r.pinned.failedSteps.join(',') || '-'} |`),
  ].join('\n');
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, workdir: { type: 'string' }, only: { type: 'string' }, keep: { type: 'boolean' } } });
  if (!values.yes) {
    process.stderr.write('this plants hostile git config in a throwaway fixture under your home folder; add --yes to run\n');
    return 2;
  }
  const workdir = values.workdir ? resolve(values.workdir) : mkdtempSync(join(process.env.HOME, '.mirai-probes-'));
  const report = await runGitProbes({ workdir, only: values.only?.split(',') ?? null, keep: values.keep === true, log: (l) => process.stdout.write(`${l}\n`) });
  process.stdout.write(`\nreports: ${join(workdir, 'out')}\n`);
  return report.results.some((r) => r.outcome === 'FAIL') ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
