#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { mintLaunchToken } from '../../src/agent/requests.js';
import { runReview } from '../../src/agent/review.js';
import { setUpHooks } from '../../src/cli/commands/init.js';
import { main } from '../../src/cli/main.js';
import { PACKAGE_ROOT } from '../../src/install/parts.js';
import { coverageLines } from '../../src/proofs/coverage-text.js';
import { recordProofs } from '../../src/proofs/record.js';
import { isBinary } from '../../src/review/diff.js';
import { writeToken } from '../../src/sign/token.js';
import { blobAt, changedLines } from '../../src/store/git.js';
import { gateChanges } from '../../src/tests/diff-coverage.js';
import { seeded, setup, showReview } from './review-probes.js';

// Unit 26b's P1, in a sample-app clone with a probe home (as 26a's P1; your token copied in for
// Rex, the red-team gate stubbed green, Docker Desktop running). The clone's main first gets the
// sample app's coverage_paths (unit: backend/app/**, frontend: frontend/src/**). Then the
// walkthrough code built green without the seeded bug, Rex's real review (Sonnet, 1 run),
// `gate record` with coverage (PHPUnit's through its adapter, end to end: G7's open item), the
// numbers in the gate proof, and a real `git push` to a bare repo that prints them. Then, no model:
//   - a new public method no test calls, in the work tree: `mirai test unit --coverage --against main`;
//   - a pure `git mv` of a file, committed: no changed lines with exact renames.
//   node test/probes/coverage-probes.js --yes [--app <sample app>]

const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const STANDIN = `sk-ant-oat01-${'Pr0be_'.repeat(14)}`;

async function cli(argv, { cwd, env }) {
  const stdin = Readable.from(['\n']);
  stdin.isTTY = true;
  let out = '';
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (t) => (out += t) }, stderr: { write: (t) => (out += t) }, env, cwd });
  return { code, out };
}

function withCoveragePaths(text) {
  const add = (level, paths) => {
    const at = text.indexOf(`name = "${level}"\n`);
    if (at < 0) throw new Error(`the sample app's config has no ${level} level`);
    const end = text.indexOf('\n\n', at);
    const cut = end < 0 ? text.length : end;
    text = `${text.slice(0, cut)}\ncoverage_paths = ${JSON.stringify(paths)}${text.slice(cut)}`;
  };
  add('unit', ['backend/app/**']);
  add('frontend', ['frontend/src/**']);
  return text;
}

async function p1(ctx) {
  const cfg = join(ctx.root, '.mirai', 'config.toml');
  writeFileSync(cfg, withCoveragePaths(readFileSync(cfg, 'utf8')));
  ctx.git('add', '.mirai/config.toml');
  ctx.git('commit', '-qm', 'probe: coverage_paths for unit and frontend (unit 26b)');
  const s = await seeded(ctx, { clean: true });
  if (!s.ok) return;
  const r = await runReview({ cwd: ctx.root, env: ctx.env, ticket: 'SAMPLE-1', launchToken: mintLaunchToken(), launchOptions: { claude: ctx.claude, status: green } });
  showReview(ctx.log, s.store, r, s.canary, 'p1-review');
  if (r.outcome !== 'pass') {
    ctx.log('p1: the review didn\'t pass, so there\'s nothing to record; stopped');
    return;
  }
  const started = Date.now();
  const rec = await recordProofs({ cwd: ctx.root, env: ctx.env, ticket: 'SAMPLE-1' });
  ctx.log(`p1-record: ${rec.outcome}${rec.why ? ` (${String(rec.why).slice(0, 300)})` : ''} in ${Math.round((Date.now() - started) / 1000)} s`);
  if (rec.outcome !== 'recorded') return;
  const dc = rec.diffCoverage;
  ctx.log(`  code ${rec.hash.slice(7, 19)}, ${rec.files.length} files; diff coverage total ${JSON.stringify(dc.total)}, changed lines ${dc.changed_sha256.slice(0, 12)}`);
  for (const [name, l] of Object.entries(dc.levels)) ctx.log(`  level ${name}: coverage ${l.coverage}, scope ${l.scope}${l.coverage_paths ? ` ${JSON.stringify(l.coverage_paths)}` : ''}`);
  for (const f of dc.files) ctx.log(`  file ${f.path}: ${f.covered}/${f.measurable} of ${f.changed} added${f.uncovered.length ? `, not run ${f.uncovered.join(', ')}` : ''}${f.why ? ` (${f.why})` : ''}`);
  for (const a of dc.apart) ctx.log(`  apart ${a.path}: ${a.why}`);
  for (const l of coverageLines(dc, { files: 20, ticket: 'SAMPLE-1' })) ctx.log(`  text:${l}`);
  // No model from here on: the real token leaves the probe home.
  writeToken(ctx.env, STANDIN);

  const io = { cwd: ctx.root, env: ctx.env, stdout: { write: () => {} }, stderr: { write: () => {} } };
  const h = await setUpHooks(io, ctx.root, { node: process.execPath, launcher: join(PACKAGE_ROOT, 'bin', 'launch.js') });
  ctx.log(`p1-install: ${h.installed ? 'installed' : `not installed: ${h.why}`}`);
  if (!h.installed) return;
  const bare = join(ctx.workdir, 'remote.git');
  execFileSync('/usr/bin/git', ['init', '-q', '--bare', bare]);
  ctx.git('push', '-q', '--no-verify', bare, 'main');
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: ctx.home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const branch = ctx.git('branch', '--show-current').trim();
  const t = Date.now();
  const p = spawnSync('/usr/bin/git', ['push', bare, branch], { cwd: ctx.root, env: gitEnv, encoding: 'utf8' });
  const lines = `${p.stderr}${p.stdout}`.split('\n').filter((l) => l.startsWith('mirai') || l.startsWith('  '));
  ctx.log(`p1-push: ${p.status === 0 ? 'PUSHED' : 'REFUSED'} in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  for (const l of lines) ctx.log(`  push:${l}`);

  // A new public method no test calls, left in the work tree.
  const ctl = join(ctx.root, 'backend/app/Http/Controllers/TaskController.php');
  const before = readFileSync(ctl, 'utf8');
  const at = before.lastIndexOf('}');
  writeFileSync(ctl, `${before.slice(0, at)}\n    public function probeUntested(int $n): int\n    {\n        $twice = $n * 2;\n        return $twice + 1;\n    }\n${before.slice(at)}`);
  const u = await cli(['test', 'unit', '--coverage', '--against', 'main'], { cwd: ctx.root, env: ctx.env });
  ctx.log(`p1-untested: mirai test unit --coverage --against main → exit ${u.code}`);
  for (const l of u.out.split('\n').filter((x) => /coverage|TaskController|not run|ran/.test(x)).slice(0, 12)) ctx.log(`  test:${l}`);
  writeFileSync(ctl, before);

  // A pure move, committed: exact renames give it no lines.
  const head = ctx.git('rev-parse', 'HEAD').trim();
  ctx.git('mv', 'backend/app/Policies/TaskPolicy.php', 'backend/app/Policies/MovedTaskPolicy.php');
  ctx.git('commit', '-qm', 'probe: a pure move\n\nMirai-Ticket: SAMPLE-1');
  const moved = gateChanges({ root: ctx.root, env: gitEnv, base: head, head: 'HEAD', changedLines, blobAt, isBinary }).files;
  ctx.log(`p1-move: ${JSON.stringify(moved.map((f) => ({ path: f.path, status: f.status, from: f.from ?? null, added: f.added.length })))}`);
  ctx.git('reset', '-q', '--hard', head);
}

async function run() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, app: { type: 'string' } } });
  if (!values.yes) {
    process.stderr.write('--yes: it uses your Claude subscription (Sonnet, 1 run) and Docker (a baseline, a gate run, a unit run)\n');
    return 2;
  }
  const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
  const log = (l) => process.stdout.write(`${l}\n`);
  try {
    const ctx = setup({ app: resolve(values.app ?? join(process.env.HOME, 'Projects', 'mirai-sample-app')), workdir });
    await p1({ ...ctx, log, workdir });
  } finally {
    spawnSync('/bin/chmod', ['-R', 'u+rwX', workdir]);
    rmSync(workdir, { recursive: true, force: true });
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
