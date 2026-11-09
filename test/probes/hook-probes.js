#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { mintLaunchToken } from '../../src/agent/requests.js';
import { runReview } from '../../src/agent/review.js';
import { setUpHooks } from '../../src/cli/commands/init.js';
import { hooksDir } from '../../src/hooks/install.js';
import { PACKAGE_ROOT } from '../../src/install/parts.js';
import { recordProofs } from '../../src/proofs/record.js';
import { writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { seeded, setup, showReview } from './review-probes.js';

// Unit 26a's P1, in a sample-app clone with a probe home (as 25a's P1; your token copied in for
// Rex, the red-team gate stubbed green, Docker Desktop running): the walkthrough code built green
// without the seeded bug, Rex's real review (Sonnet, 1 run), `gate record`, then MIRAI's hooks
// installed and real `git push`es to a bare repo in the probe folder (nothing reaches GitHub):
//   1. the MIRAI branch with its proofs: pass;
//   2. from that tip, each on its own: a commit without the trailer (trailer-mix); a code change
//      after the proofs (stale); a fake AWS key (secret); a stand-in token's base64 (secret; your
//      real token is swapped out of the probe home first); one byte added to the hook (hooks-changed);
//   3. a human branch: a plain commit (pass), the fake key (secret).
//   node test/probes/hook-probes.js --yes [--app <sample app>]

const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const STANDIN = `sk-ant-oat01-${'Pr0be_'.repeat(14)}`;
const AWS = `AKIA${'P7'.repeat(8)}`;

async function p1(ctx) {
  const s = await seeded(ctx, { clean: true });
  if (!s.ok) return;
  const r = await runReview({ cwd: ctx.root, env: ctx.env, ticket: 'SAMPLE-1', launchToken: mintLaunchToken(), launchOptions: { claude: ctx.claude, status: green } });
  showReview(ctx.log, s.store, r, s.canary, 'p1-review');
  if (r.outcome !== 'pass') {
    ctx.log('p1: the review didn\'t pass, so there\'s nothing to push; stopped');
    return;
  }
  const started = Date.now();
  const rec = await recordProofs({ cwd: ctx.root, env: ctx.env, ticket: 'SAMPLE-1' });
  ctx.log(`p1-record: ${rec.outcome}${rec.why ? ` (${String(rec.why).slice(0, 300)})` : ''} in ${Math.round((Date.now() - started) / 1000)} s`);
  if (rec.outcome !== 'recorded') return;
  ctx.log(`  code ${rec.hash.slice(7, 19)}, ${rec.files.length} files`);
  // No model from here on: the real token leaves the probe home.
  writeToken(ctx.env, STANDIN);

  const io = { cwd: ctx.root, env: ctx.env, stdout: { write: () => {} }, stderr: { write: () => {} } };
  const launcher = join(PACKAGE_ROOT, 'bin', 'launch.js');
  const h = await setUpHooks(io, ctx.root, { node: process.execPath, launcher });
  ctx.log(`p1-install: ${h.installed ? `installed in ${h.dir}` : `not installed: ${h.why}`}`);
  if (!h.installed) return;
  const bare = join(ctx.workdir, 'remote.git');
  execFileSync('/usr/bin/git', ['init', '-q', '--bare', bare]);
  ctx.git('push', '-q', '--no-verify', bare, 'main');
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: ctx.home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const push = (label, ref) => {
    const t = Date.now();
    const p = spawnSync('/usr/bin/git', ['push', bare, ref], { cwd: ctx.root, env: gitEnv, encoding: 'utf8' });
    const lines = `${p.stderr}${p.stdout}`.split('\n').filter((l) => l.startsWith('mirai') || l.startsWith('  ')).join(' | ');
    ctx.log(`${label}: ${p.status === 0 ? 'PUSHED' : 'REFUSED'} in ${((Date.now() - t) / 1000).toFixed(1)} s; ${lines.slice(0, 600)}`);
  };
  const branch = ctx.git('branch', '--show-current').trim();
  const tip = ctx.git('rev-parse', 'HEAD').trim();
  const reset = () => ctx.git('reset', '-q', '--hard', tip);
  push('p1-push', branch);

  const code = rec.files.find((f) => f.endsWith('TaskController.php')) ?? rec.files[0];
  writeFileSync(join(ctx.root, 'NOTES.md'), 'by hand\n');
  ctx.git('add', 'NOTES.md');
  ctx.git('commit', '-qm', 'probe: a commit without the trailer');
  push('p1-no-trailer', branch);
  reset();
  writeFileSync(join(ctx.root, code), `${readFileSync(join(ctx.root, code), 'utf8')}\n// probe: changed after the proofs\n`);
  ctx.git('commit', '-qam', 'probe: a code change\n\nMirai-Ticket: SAMPLE-1');
  push('p1-code-change', branch);
  reset();
  writeFileSync(join(ctx.root, 'backend/.aws-probe'), `key=${AWS}\n`);
  ctx.git('add', '-f', 'backend/.aws-probe');
  ctx.git('commit', '-qm', 'probe: a fake AWS key\n\nMirai-Ticket: SAMPLE-1');
  push('p1-aws-key', branch);
  reset();
  writeFileSync(join(ctx.root, 'token.b64'), `${Buffer.from(STANDIN).toString('base64')}\n`);
  ctx.git('add', 'token.b64');
  ctx.git('commit', '-qm', 'probe: the token, base64\n\nMirai-Ticket: SAMPLE-1');
  push('p1-token-base64', branch);
  reset();
  const store = openStore(io);
  const hook = join(hooksDir(store), 'pre-push');
  const before = readFileSync(hook);
  appendFileSync(hook, ' ');
  push('p1-hook-edited', branch);
  writeFileSync(hook, before);

  ctx.git('switch', '-q', '-c', 'human/probe', 'main');
  writeFileSync(join(ctx.root, 'HUMAN.md'), 'a person\'s change\n');
  ctx.git('add', 'HUMAN.md');
  ctx.git('commit', '-qm', 'probe: a human commit');
  push('p1-human', 'human/probe');
  writeFileSync(join(ctx.root, 'HUMAN.md'), `aws ${AWS}\n`);
  ctx.git('commit', '-qam', 'probe: a human commit with a fake key');
  push('p1-human-aws-key', 'human/probe');
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, app: { type: 'string' } } });
  if (!values.yes) {
    process.stderr.write('--yes: it uses your Claude subscription (Sonnet, 1 run) and Docker (a baseline and a gate run)\n');
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
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
