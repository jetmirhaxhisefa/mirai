#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { mintLaunchToken } from '../../src/agent/requests.js';
import { runReview } from '../../src/agent/review.js';
import { checkProofs } from '../../src/proofs/check.js';
import { recordProofs } from '../../src/proofs/record.js';
import { branchKeys } from '../../src/sign/keys.js';
import { openStore } from '../../src/store/home.js';
import { protectionRules } from '../../src/trust/protected.js';
import { snapshot, trustedConfig, trustedRegistry } from '../../src/trust/snapshot.js';
import { seeded, setup, showReview } from './review-probes.js';

// Unit 25a's P1, in a sample-app clone with a probe home (as 24a's probes; your token copied in, the
// red-team gate stubbed green, Docker Desktop running): the walkthrough code built green without
// the seeded bug, Rex's real review (Sonnet, 1 run), then:
//   1. `gate record` (every check and level in Docker, signed) and `gate check`: pass;
//   2. main moves in another part of a file the ticket touched, and the branch is rebased onto it
//      (by git, as a person would): `gate check` still passes, with no new proof;
//   3. one whitespace change on the branch: `gate check` says `stale`.
//   node test/probes/gate-probes.js --yes [--app <sample app>]

const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });

async function p1(ctx) {
  const s = await seeded(ctx, { clean: true });
  if (!s.ok) return;
  const r = await runReview({ cwd: ctx.root, env: ctx.env, ticket: 'SAMPLE-1', launchToken: mintLaunchToken(), launchOptions: { claude: ctx.claude, status: green } });
  showReview(ctx.log, s.store, r, s.canary, 'p1-review');
  if (r.outcome !== 'pass') {
    ctx.log('p1: the review didn\'t pass, so there\'s nothing to prove; stopped');
    return;
  }
  const started = Date.now();
  const rec = await recordProofs({ cwd: ctx.root, env: ctx.env, ticket: 'SAMPLE-1' });
  ctx.log(`p1-record: ${rec.outcome}${rec.why ? ` (${String(rec.why).slice(0, 300)})` : ''} in ${Math.round((Date.now() - started) / 1000)} s`);
  for (const t of rec.tests?.runs ?? []) ctx.log(`  ${t.name}: ${t.outcome} → ${t.verdict}`);
  if (rec.outcome !== 'recorded') return;
  ctx.log(`  code ${rec.hash.slice(7, 19)}, ${rec.files.length} files: ${rec.files.join(', ')}`);
  for (const w of rec.written) ctx.log(`  wrote ${w}`);
  const io = { cwd: ctx.root, env: ctx.env };
  const store = openStore(io);
  const check = (label) => {
    const trust = snapshot(io);
    const config = trustedConfig(trust);
    const c = checkProofs({ root: store.checkout, env: store.gitEnv, ticket: 'SAMPLE-1', commit: 'HEAD', integration: trust.baseSha, codePaths: config.gate.code_paths, keys: branchKeys(store.checkout, store.branch, store.gitEnv), repoId: store.repoId, rules: protectionRules(trustedRegistry(trust), config).rules, docsRoot: config.docs.root });
    ctx.log(`${label}: ${c.outcome}; code ${c.hash.slice(7, 19)} since ${c.base.slice(0, 12)}; review ${c.matched.review?.path ?? '-'}; gate ${c.matched.gate?.path ?? '-'}${c.bad.length ? `; bad ${JSON.stringify(c.bad)}` : ''}`);
    return c;
  };
  check('p1-check');
  // 2. main moves at the top of a touched file whose first change is further down; then a rebase.
  const branch = ctx.git('branch', '--show-current').trim();
  const file = rec.files.find((f) => {
    const first = /^@@ -(\d+)/m.exec(ctx.git('diff', '-U0', 'main', branch, '--', f));
    return first && Number(first[1]) > 8;
  });
  if (!file) {
    ctx.log('p1-rebase: no touched file whose first change is below line 8; skipped');
  } else {
    ctx.git('switch', '-q', 'main');
    const text = readFileSync(join(ctx.root, file), 'utf8').split('\n');
    text.splice(1, 0, '// probe: main moved here (unit 25a)');
    writeFileSync(join(ctx.root, file), text.join('\n'));
    ctx.git('commit', '-qam', 'probe: main moves in a file the ticket touches');
    ctx.git('switch', '-q', branch);
    const rb = spawnSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', 'rebase', '-q', 'main'], { cwd: ctx.root, env: { PATH: '/usr/bin:/bin', HOME: ctx.home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, encoding: 'utf8' });
    ctx.log(`p1-rebase onto main (moved in ${file}): ${rb.status === 0 ? 'clean' : `failed: ${rb.stderr.slice(0, 200)}`}`);
    if (rb.status === 0) check('p1-check-after-rebase');
  }
  // 3. One whitespace change in the code.
  const code = rec.files.find((f) => f.endsWith('TaskController.php')) ?? rec.files[0];
  writeFileSync(join(ctx.root, code), readFileSync(join(ctx.root, code), 'utf8').replace(/;\n/, '; \n'));
  ctx.git('commit', '-qam', 'probe: one trailing space');
  check('p1-check-after-whitespace');
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, app: { type: 'string' } } });
  if (!values.yes) {
    process.stderr.write('--yes: it uses your Claude subscription (Sonnet, 1 run) and Docker (a baseline and two gate runs)\n');
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
