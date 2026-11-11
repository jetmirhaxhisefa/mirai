#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';

import { mintLaunchToken } from '../../src/agent/requests.js';
import { runReview } from '../../src/agent/review.js';
import { recordProofs } from '../../src/proofs/record.js';
import { findCli, hostFor, TOOLS_FILE } from '../../src/ship/host.js';
import { shipTicket } from '../../src/ship/ship.js';
import { writeToken } from '../../src/sign/token.js';
import { pushBranch } from '../../src/store/git.js';
import { openStore } from '../../src/store/home.js';
import { readJournal, ticketFacts } from '../../src/store/journal.js';
import { seeded, setup, showReview } from './review-probes.js';

// Unit 27a's P1, in a sample-app clone with a probe home (as 26b's P1: your token copied in for
// Rex, the red-team gate stubbed green, Docker Desktop running), against the REAL GitHub repo
// (your private mirai-sample-app): it pushes branches and opens a PR there, and its last step
// closes the PR and deletes both branches.
//
// The clone's main holds probe commits GitHub's main doesn't have, so ship would rightly refuse
// (`base-not-pushed`). The probe never touches GitHub's main: it pushes the clone's main to
// `mirai-probe/base-<id>` (through MIRAI's own push and gh's credential helper) and points the
// host's integration branch there. Everything else is real: gh's helper, the push, the PR.
//   1. SAMPLE-1 built, Rex's review (Sonnet, 1 run), `gate record`;
//   2. `mirai ship` → opened; again → unchanged; the description edited on GitHub → updated;
//      the PR closed on GitHub → mr-closed;
//   3. no token in the probe folder;
//   4. clean-up: the PR closed, both branches deleted.
//   node test/probes/ship-probes.js --yes [--app <sample app>] [--repo owner/name]

const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const STANDIN = `sk-ant-oat01-${'Pr0be_'.repeat(14)}`;

async function p1(ctx, repo) {
  const id = randomBytes(3).toString('hex');
  const remoteUrl = `https://github.com/${repo}.git`;
  const s = await seeded(ctx, { clean: true });
  if (!s.ok) return;
  const r = await runReview({ cwd: ctx.root, env: ctx.env, ticket: 'SAMPLE-1', launchToken: mintLaunchToken(), launchOptions: { claude: ctx.claude, status: green } });
  showReview(ctx.log, s.store, r, s.canary, 'p1-review');
  if (r.outcome !== 'pass') {
    ctx.log('p1: the review didn\'t pass; stopped');
    return;
  }
  const rec = await recordProofs({ cwd: ctx.root, env: ctx.env, ticket: 'SAMPLE-1' });
  ctx.log(`p1-record: ${rec.outcome}${rec.why ? ` (${String(rec.why).slice(0, 300)})` : ''}`);
  if (rec.outcome !== 'recorded') return;
  writeToken(ctx.env, STANDIN);

  const gh = findCli('gh', process.env, ctx.root);
  if (!gh) {
    ctx.log('p1: no gh on your PATH; stopped');
    return;
  }
  const store = openStore({ cwd: ctx.root, env: ctx.env });
  writeFileSync(join(store.dir, TOOLS_FILE), JSON.stringify({ schema_version: 1, github: gh }), { mode: 0o600 });
  const base = `mirai-probe/base-${id}`;
  const real = (a) => hostFor({ ...a, remoteUrl, cliHome: process.env.HOME });
  const hostOf = (a) => {
    const h = real(a);
    return {
      ...h,
      branchTip: (b) => h.branchTip(b === 'main' ? base : b),
      openMr: (o) => h.openMr({ ...o, base }),
    };
  };
  const cleanups = [];
  const ghRun = (...args) => spawnSync(gh, args, { env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }, encoding: 'utf8' });
  try {
    // The base branch, pushed through MIRAI's own push and gh's helper.
    const host = real({ config: { git: { integration_branch: 'main' } }, store, env: ctx.env, root: ctx.root });
    const mainSha = ctx.git('rev-parse', 'main').trim();
    const t = Date.now();
    const pb = pushBranch(ctx.root, host.pushUrl, base, mainSha, store.gitEnv, { helper: host.helper });
    cleanups.push(() => ghRun('api', '--method', 'DELETE', `repos/${repo}/git/refs/heads/${base}`));
    ctx.log(`p1-base: pushed ${base} through gh's credential helper: ${pb.ok ? 'ok' : `REFUSED ${pb.why}`} in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    if (!pb.ok) return;

    const ship = async (label) => {
      const t0 = Date.now();
      try {
        const x = await shipTicket({ cwd: ctx.root, env: ctx.env, ticket: 'SAMPLE-1', hostOf });
        ctx.log(`${label}: ${x.outcome}; MR ${x.mr.number} ${x.mr.url}; pushed ${x.pushed} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        return x;
      } catch (err) {
        ctx.log(`${label}: REFUSED ${err.code ?? ''}: ${String(err.message).slice(0, 300)}`);
        return null;
      }
    };
    const first = await ship('p1-ship');
    const branch = ctx.git('branch', '--show-current').trim();
    cleanups.push(() => ghRun('api', '--method', 'DELETE', `repos/${repo}/git/refs/heads/${branch}`));
    if (!first) return;
    cleanups.unshift(() => ghRun('pr', 'close', String(first.mr.number), '--repo', repo));
    const view = JSON.parse(ghRun('pr', 'view', String(first.mr.number), '--repo', repo, '--json', 'title,body,baseRefName,headRefName,isDraft,state').stdout);
    ctx.log(`p1-pr: "${view.title}", ${view.headRefName} → ${view.baseRefName}, draft ${view.isDraft}, ${view.state}`);
    ctx.log(`p1-body: marker ${view.body.startsWith('<!-- mirai:mr-description@v1 -->')}; review line ${/Review: PASS after \d+ rounds? \(MIRAI\)/.test(view.body)}; cites a file:line ${/\S+\.[A-Za-z0-9]{1,8}:\d+/.test(view.body)}`);
    for (const l of view.body.split('\n').filter((x) => x.trim()).slice(0, 40)) ctx.log(`  body| ${l.slice(0, 160)}`);
    const facts = ticketFacts(readJournal(store).events, 'SAMPLE-1');
    ctx.log(`p1-journal: mr ${facts.mr}, proofs at head ${facts.proofsValidAtHead}, url ${facts.url}`);

    await ship('p1-again');
    ghRun('pr', 'edit', String(first.mr.number), '--repo', repo, '--body', 'edited on GitHub by the probe');
    await ship('p1-edited');
    ghRun('pr', 'close', String(first.mr.number), '--repo', repo);
    await ship('p1-closed');

    // No token in the probe folder (the CLI kept it).
    const shapes = /\b(gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/;
    const found = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        let st;
        try {
          st = statSync(p);
        } catch {
          continue;
        }
        if (st.isDirectory()) walk(p);
        else if (st.isFile() && st.size < 8 * 1024 * 1024) {
          try {
            if (shapes.test(readFileSync(p, 'latin1'))) found.push(p.slice(ctx.workdir.length));
          } catch {
            // unreadable
          }
        }
      }
    };
    walk(ctx.workdir);
    ctx.log(`p1-token: GitHub token shapes in the probe folder: ${found.length ? found.slice(0, 5).join(', ') : 'none'}`);
  } finally {
    for (const c of cleanups) {
      const x = c();
      ctx.log(`p1-cleanup: ${x.status === 0 ? 'ok' : `exit ${x.status} ${String(x.stderr).trim().slice(0, 160)}`}`);
    }
  }
}

async function run() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, app: { type: 'string' }, repo: { type: 'string' } } });
  if (!values.yes) {
    process.stderr.write('--yes: it uses your Claude subscription (Sonnet, 1 run), Docker, and opens then closes a real PR on your GitHub sample-app repo\n');
    return 2;
  }
  const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
  const log = (l) => process.stdout.write(`${l}\n`);
  try {
    const ctx = setup({ app: resolve(values.app ?? join(process.env.HOME, 'Projects', 'mirai-sample-app')), workdir });
    await p1({ ...ctx, log, workdir }, values.repo ?? 'jetmirhaxhisefa/mirai-sample-app');
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

