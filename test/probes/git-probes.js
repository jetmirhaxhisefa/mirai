#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { pinArgs, pinEnv } from '../../src/store/git-pins.js';
import * as mirai from '../../src/store/git.js';
import { buildComposeFixture, gitProbeDir, gitTemplate, removeComposeFixture, startServer } from './compose-fixture.js';
import { GIT_STEPS, gitProbes, markText, workChanges } from './compose-probes.js';

// Unit 14a: the git probes (G15, G23). Each probe plants one hostile key in a fresh copy of a
// fixture repo, then runs MIRAI's git commands twice: as control (repo config only, no system or
// global file) and with the pin set from src/store/git-pins.js. A key that fired in the control
// and not with the pins is neutralised; one that fired in both is not pinnable, and only D-54's
// integrity hash can catch it. No network: remotes are local folders or a server on 127.0.0.1.
//
// With --mirai (unit 14b), the second run is MIRAI's own calls (every export of
// src/store/git.js, called as MIRAI calls them) instead of the pinned command lines: a probe passes
// when MIRAI refused the repo before git ran (the repo check), or git ran and no marker appeared.
//
//   node test/probes/git-probes.js --yes [--mirai] [--workdir <dir>] [--only id,id] [--keep]

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
    env = clean({ ...pinEnv({ top: d.repo }), ...IDENTITY, ...(probe.pinnedEnv?.(d) ?? {}) });
    // A probe of a pin behind the protocol allowlist lets that one protocol through, so the pin
    // itself is what's tested.
    if (protos.length) env.GIT_ALLOW_PROTOCOL = ['file', 'https', ...protos].join(':');
    prefix = [...pinArgs(), ...protos.flatMap((p) => ['-c', `protocol.${p}.allow=always`])];
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

// MIRAI's calls, in the order a command makes them; each takes the checkout and the env.
export const MIRAI_STEPS = Object.freeze([
  ['topLevel', (root) => mirai.topLevel(root)],
  ['commitOf', (root, env) => mirai.commitOf(root, 'HEAD', env)],
  ['isShallow', (root, env) => mirai.isShallow(root, env)],
  ['rootCommits', (root, env) => mirai.rootCommits(root, 'main', env)],
  ['refExists', (root, env) => mirai.refExists(root, 'refs/heads/main', env)],
  ['configValue', (root, env) => mirai.configValue(root, 'core.hooksPath', env)],
  ['remotes', (root, env) => mirai.remotes(root, env)],
  ['lsTree', (root, env) => mirai.lsTree(root, 'HEAD', '.', env, { recursive: true })],
  ['treeId', (root, env) => mirai.treeId(root, 'HEAD', 'a.txt', env)],
  ['catBlobs', (root, env) => mirai.catBlobs(root, (mirai.lsTree(root, 'HEAD', 'a.txt', env) ?? []).map((e) => e.sha), env)],
  ['blobAt', (root, env) => mirai.blobAt(root, 'HEAD', 'a.txt', env)],
  ['commitAndBlob', (root, env) => mirai.commitAndBlob(root, 'main', 'a.txt', env)],
  ['lsFiles', (root, env) => mirai.lsFiles(root, ['.'], env)],
  ['envFiles', (root, env) => mirai.envFiles(root, env)],
  ['symbolicBranch', (root, env) => mirai.symbolicBranch(root, 'HEAD', env)],
  ['ignoredPaths', (root, env) => mirai.ignoredPaths(root, ['new.txt'], env)],
  ['changedNames-worktree', (root, env) => mirai.changedNames(root, 'HEAD', null, env)],
  ['changedNames-commits', (root, env) => mirai.changedNames(root, 'main', 'side', env)],
  ['ignoredNames', (root, env) => mirai.ignoredNames(root, env)],
  ['mergeBase', (root, env) => mirai.mergeBase(root, 'main', 'side', env)],
  ['isAncestor', (root, env) => mirai.isAncestor(root, 'main', 'side', env)],
]);
const REFUSALS = new Set(['repo-config', 'repo-shape', 'repo-nested', 'repo-lfs', 'git-file']);

// One probe through MIRAI's own calls: refused (and where), or what ran and whether it fired.
function runMirai(probe, ctx, x, template) {
  const d = gitProbeDir(ctx, template, probe.id, 'mirai');
  probe.plant(d, x);
  workChanges(d);
  probe.before?.(d);
  const home = join(d.dir, 'home');
  mkdirSync(home, { recursive: true });
  const env = { HOME: home, PATH: '/usr/bin:/bin' };
  let refused = null;
  const failed = [];
  for (const [name, step] of MIRAI_STEPS) {
    try {
      step(d.repo, env);
    } catch (err) {
      if (REFUSALS.has(err.code)) {
        refused = { step: name, code: err.code, message: err.message.replaceAll(d.dir, '<dir>') };
        break;
      }
      failed.push(`${name}: ${err.code ?? err.message}`);
    }
  }
  const marks = markText(d);
  let fired = marks !== '';
  // Probes that look elsewhere than the marker (a server hit, a ref in another repo) count too;
  // one that needs to run git itself doesn't apply to MIRAI's calls.
  if (!fired && probe.hit) {
    try {
      fired = Boolean(probe.hit(d, () => { throw new Error('n/a'); }, {}));
    } catch {
      // n/a
    }
  }
  return { fired, refused, marks: marks.split('\n').filter(Boolean).map((l) => l.replace(d.dir, '<dir>')).slice(0, 6), failed };
}

export function classify(control, pinned) {
  if (control && !pinned) return 'neutralised';
  if (control && pinned) return 'not pinnable';
  if (!control && !pinned) return 'inert';
  return 'fires only pinned';
}

export async function runGitProbes({ workdir, only = null, keep = false, git = 'git', log = () => {}, mirai: miraiMode = false, probes: given = null }) {
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
    let probes = given ?? gitProbes(x);
    if (only) probes = probes.filter((p) => only.includes(p.id));
    if (miraiMode) report.conditions = 'one fresh repo per probe and mode; control = repo config only (no system or global file); mirai = every export of src/store/git.js (MIRAI_STEPS)';
    for (const probe of probes) {
      if (miraiMode) {
        const control = runMode(probe, ctx, x, template, 'control', git);
        const m = runMirai(probe, ctx, x, template);
        const outcome = m.fired ? 'FAIL' : 'pass';
        report.results.push({
          id: probe.id, fact: probe.fact, title: probe.title, kind: m.refused ? `refused (${m.refused.code})` : 'ran, nothing fired', outcome,
          control: { fired: control.fired, marks: control.marks, failedSteps: control.failed },
          pinned: { fired: m.fired, marks: m.marks, failedSteps: m.failed, refused: m.refused },
        });
        log(`${probe.id}: ${outcome} (${m.refused ? `refused at ${m.refused.step}: ${m.refused.code}` : 'ran'}; control ${control.fired ? 'fired' : 'inert'})`);
        continue;
      }
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
    const name = miraiMode ? 'git-mirai-results' : 'git-results';
    writeFileSync(join(ctx.root, 'out', `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(ctx.root, 'out', `${name}.md`), `${gitMarkdown(report, miraiMode)}\n`);
    if (!keep) removeComposeFixture(ctx);
  }
}

function gitMarkdown(report, miraiMode) {
  const cell = (s) => String(s).replace(/\|/g, '\\|');
  if (miraiMode) {
    return [
      '# git probes through MIRAI\'s own calls (unit 14b)',
      '',
      `${report.git}, ${report.startedAt}. ${report.conditions}.`,
      '',
      '| Probe | Fact | Outcome | MIRAI | Control: fired, marks | MIRAI: fired, marks | Refusal or failed steps |',
      '|---|---|---|---|---|---|---|',
      ...report.results.map((r) => `| ${r.id} | ${r.fact} | **${r.outcome}** | ${r.kind} | ${r.control.fired ? 'yes' : 'no'}: ${cell(r.control.marks.join('; '))} | ${r.pinned.fired ? 'yes' : 'no'}: ${cell(r.pinned.marks.join('; '))} | ${cell(r.pinned.refused ? `${r.pinned.refused.step}: ${r.pinned.refused.message}` : r.pinned.failedSteps.join('; ') || '-')} |`),
    ].join('\n');
  }
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
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, mirai: { type: 'boolean' }, workdir: { type: 'string' }, only: { type: 'string' }, keep: { type: 'boolean' } } });
  if (!values.yes) {
    process.stderr.write('this plants hostile git config in a throwaway fixture under your home folder; add --yes to run\n');
    return 2;
  }
  const workdir = values.workdir ? resolve(values.workdir) : mkdtempSync(join(process.env.HOME, '.mirai-probes-'));
  const report = await runGitProbes({ workdir, only: values.only?.split(',') ?? null, keep: values.keep === true, mirai: values.mirai === true, log: (l) => process.stdout.write(`${l}\n`) });
  process.stdout.write(`\nreports: ${join(workdir, 'out')}\n`);
  return report.results.some((r) => r.outcome === 'FAIL') ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
