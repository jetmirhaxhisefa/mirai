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
import { renderMrDescription } from '../../src/reports/render.js';
import { glabConfigDir, projectPath } from '../../src/ship/gitlab.js';
import { cleanTitle, findCli, hostFor, TOOLS_FILE } from '../../src/ship/host.js';
import { shipTicket } from '../../src/ship/ship.js';
import { writeToken } from '../../src/sign/token.js';
import { pushBranch } from '../../src/store/git.js';
import { openStore } from '../../src/store/home.js';
import { readJournal, ticketFacts } from '../../src/store/journal.js';
import { seeded, setup, showReview } from './review-probes.js';

// Unit 27b's P1 (gitlab.com) and P2 (a local GitLab CE with a self-signed certificate authority),
// in a sample-app clone with a probe home (as 27a's P1: your Claude token copied in for Rex, the
// red-team gate stubbed green, Docker Desktop running). Against a REAL GitLab project you own:
// it pushes branches and opens merge requests there; its last step deletes them.
//
// The clone's main holds probe commits the host's main doesn't, so the probe pushes it to a
// throwaway `mirai-probe/base-<id>` (through MIRAI's own push and glab's helper) and points the
// host's integration branch there. Everything else is real: the helper, the push, the API.
//   1. SAMPLE-1 built, Rex's review (Sonnet, 1 run), `gate record`;
//   2. `mirai ship` → opened; again → unchanged; the description edited on GitLab → updated;
//      the MR closed on GitLab → mr-closed;
//   3. a poisoned MR (quick actions, @all, every reference form, a Draft: title), rendered by
//      MIRAI and opened through the host: still open, not a draft, nothing linked, no system note;
//   4. your GitLab token and refresh token: in no file of the probe folder (only counts logged);
//   5. clean-up: both MRs and every probe branch deleted.
//   node test/probes/gitlab-probes.js --yes --repo <group/project> [--host gitlab.mirai.test] [--app <sample app>]

const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const STANDIN = `sk-ant-oat01-${'Pr0be_'.repeat(14)}`;
const HAZARDS = ['/merge', '/close', '/approve', '/label ~mirai-probe', '/assign @all', '@all', '#1', '!1', '~bug', '%v1', '&1', '$1', '^alert#1', '*iteration:1', '[[_TOC_]]', '[TOC]', '[issue:1]', ':tada:'];

function glabRunner(glab, hostUrl) {
  const home = process.env.HOME;
  const env = { PATH: '/usr/bin:/bin', HOME: home, GLAB_CONFIG_DIR: glabConfigDir(process.env, home), GITLAB_HOST: hostUrl, GLAB_CHECK_UPDATE: 'false', GLAB_SEND_TELEMETRY: 'false', GLAB_SHOW_WHATS_NEW: 'false', GLAB_NO_PROMPT: '1', NO_COLOR: '1' };
  const host = new URL(hostUrl).host;
  const run = (args, input) => spawnSync(glab, args, { cwd: '/', env, encoding: 'utf8', ...(input !== undefined ? { input } : {}) });
  const api = (method, path, fields = {}) => {
    const r = run(['api', '--hostname', host, '--method', method, ...Object.entries(fields).flatMap(([k, v]) => ['--raw-field', `${k}=${v}`]), path]);
    let json = null;
    try {
      json = JSON.parse(r.stdout || 'null');
    } catch {
      json = null;
    }
    return { status: r.status, json, err: String(r.stderr ?? '').trim().slice(0, 300) };
  };
  return { run, api, host };
}

async function p1(ctx, { hostUrl, repo }) {
  const id = randomBytes(3).toString('hex');
  const remoteUrl = `${hostUrl}/${repo}.git`;
  const enc = projectPath(repo);
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

  const glab = findCli('glab', process.env, ctx.root);
  if (!glab) {
    ctx.log('p1: no glab on your PATH; stopped');
    return;
  }
  const g = glabRunner(glab, hostUrl);
  const store = openStore({ cwd: ctx.root, env: ctx.env });
  writeFileSync(join(store.dir, TOOLS_FILE), JSON.stringify({ schema_version: 1, gitlab: glab }), { mode: 0o600 });
  const base = `mirai-probe/base-${id}`;
  const gitConf = { host: 'gitlab', ...(hostUrl !== 'https://gitlab.com' ? { host_url: hostUrl } : {}) };
  const real = (a) => hostFor({ ...a, config: { ...a.config, git: { ...a.config.git, ...gitConf } }, remoteUrl, cliHome: process.env.HOME });
  const hostOf = (a) => {
    const h = real(a);
    return Object.defineProperties({
      ...h,
      branchTip: (b) => h.branchTip(b === 'main' ? base : b),
      openMr: (o) => h.openMr({ ...o, base }),
    }, { ca: { get: () => h.ca } });
  };
  const cleanups = [];
  const delBranch = (b) => () => g.api('DELETE', `projects/${enc}/repository/branches/${encodeURIComponent(b)}`);
  const delMr = (iid) => () => g.api('DELETE', `projects/${enc}/merge_requests/${iid}`);
  try {
    const host = real({ config: { git: { integration_branch: 'main' } }, store, env: ctx.env, root: ctx.root });
    const t0 = Date.now();
    try {
      host.checkAuth();
      ctx.log(`p1-auth: glab logged in to ${g.host}, ca ${host.ca ?? 'none (system trust)'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    } catch (err) {
      ctx.log(`p1-auth: REFUSED ${err.code}: ${err.message}`);
      return;
    }
    const mainSha = ctx.git('rev-parse', 'main').trim();
    const t = Date.now();
    const pb = pushBranch(ctx.root, host.pushUrl, base, mainSha, store.gitEnv, { helper: host.helper, ca: host.ca });
    cleanups.push(delBranch(base));
    ctx.log(`p1-base: pushed ${base} through glab's credential helper: ${pb.ok ? 'ok' : `REFUSED ${pb.why}`} in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    if (!pb.ok) return;

    const ship = async (label) => {
      const ts = Date.now();
      try {
        const x = await shipTicket({ cwd: ctx.root, env: ctx.env, ticket: 'SAMPLE-1', hostOf });
        ctx.log(`${label}: ${x.outcome}; MR !${x.mr.number} ${x.mr.url}; pushed ${x.pushed} in ${((Date.now() - ts) / 1000).toFixed(1)} s`);
        return x;
      } catch (err) {
        ctx.log(`${label}: REFUSED ${err.code ?? ''}: ${String(err.message).slice(0, 300)}`);
        return null;
      }
    };
    const first = await ship('p1-ship');
    const branch = ctx.git('branch', '--show-current').trim();
    cleanups.push(delBranch(branch));
    if (!first) return;
    cleanups.unshift(delMr(first.mr.number));
    const view = g.api('GET', `projects/${enc}/merge_requests/${first.mr.number}`).json;
    ctx.log(`p1-mr: "${view.title}", ${view.source_branch} → ${view.target_branch}, draft ${view.draft}, ${view.state}`);
    ctx.log(`p1-body: marker ${view.description.startsWith('<!-- mirai:mr-description@v1 -->')}; review line ${/Review: PASS after \d+ rounds? \(MIRAI\)/.test(view.description)}; cites a file:line ${/\S+\.[A-Za-z0-9]{1,8}:\d+/.test(view.description)}`);
    for (const l of view.description.split('\n').filter((x) => x.trim()).slice(0, 40)) ctx.log(`  body| ${l.slice(0, 160)}`);
    const facts = ticketFacts(readJournal(store).events, 'SAMPLE-1');
    ctx.log(`p1-journal: mr ${facts.mr}, proofs at head ${facts.proofsValidAtHead}, url ${facts.url}`);

    await ship('p1-again');
    g.api('PUT', `projects/${enc}/merge_requests/${first.mr.number}`, { description: 'edited on GitLab by the probe' });
    await ship('p1-edited');
    g.api('PUT', `projects/${enc}/merge_requests/${first.mr.number}`, { state_event: 'close' });
    await ship('p1-closed');

    // The poisoned MR: MIRAI's renderer and title cleaner, the real host's openMr.
    const poisonBranch = `mirai-probe/poison-${id}`;
    const head = ctx.git('rev-parse', 'HEAD').trim();
    const pp = pushBranch(ctx.root, host.pushUrl, poisonBranch, head, store.gitEnv, { helper: host.helper, ca: host.ca });
    cleanups.push(delBranch(poisonBranch));
    if (!pp.ok) {
      ctx.log(`p1-poison: the branch push was refused: ${pp.why}`);
    } else {
      const todosBefore = g.api('GET', 'todos?state=pending&per_page=100').json?.length ?? -1;
      const text = HAZARDS.join(' ');
      const data = {
        ticket: { id: 'SAMPLE-1', title: text }, why: text, what_changed: HAZARDS.slice(0, 20), review: { rounds: 1 },
        followups: [...HAZARDS.slice(0, 9), HAZARDS.slice(9).join(' ')], risk: { level: 'high', reason: text }, links: [],
        files: [{ label: 'Ticket', path: 'docs/mirai/tickets/SAMPLE-1.md' }],
      };
      const title = cleanTitle(`Draft: [WIP] SAMPLE-1: ${text}`);
      const body = renderMrDescription(data, { host: 'gitlab', root: ctx.root, home: ctx.env.HOME });
      const made = host.openMr({ base, head: poisonBranch, title, body });
      cleanups.unshift(delMr(made.number));
      await new Promise((res) => { setTimeout(res, 20_000); }); // GitLab's background jobs (todos, notes)
      const mr = g.api('GET', `projects/${enc}/merge_requests/${made.number}?render_html=true`).json;
      const notes = g.api('GET', `projects/${enc}/merge_requests/${made.number}/notes?per_page=100`).json ?? [];
      const todosAfter = g.api('GET', 'todos?state=pending&per_page=100').json?.length ?? -1;
      const gfm = [...String(mr.description_html ?? '').matchAll(/class="[^"]*\bgfm-([a-z_]+)/g)].map((m) => m[1]);
      const titleGfm = [...String(mr.title_html ?? '').matchAll(/class="[^"]*\bgfm-([a-z_]+)/g)].map((m) => m[1]);
      ctx.log(`p1-poison: MR !${made.number}: state ${mr.state}, draft ${mr.draft}, labels ${JSON.stringify(mr.labels)}, assignees ${(mr.assignees ?? []).length}, approvals ${mr.merge_status ?? '-'}; title "${mr.title}"`);
      ctx.log(`p1-poison: links in the description: ${gfm.length ? gfm.join(', ') : 'none'}; in the title: ${titleGfm.length ? titleGfm.join(', ') : 'none'}; notes ${notes.length} (system ${notes.filter((n) => n.system).length}: ${notes.filter((n) => n.system).map((n) => String(n.body).slice(0, 60)).join(' | ') || '-'}); your pending to-dos ${todosBefore} → ${todosAfter}`);
      ctx.log(`p1-poison: has description_html ${typeof mr.description_html === 'string'}`);
    }

    // P2 only (a self-hosted server): certificate checks turned off in glab's config → tls-off;
    // ca_cert removed → glab can't reach the server (system trust doesn't know the probe's CA).
    // glab's config is put back after each.
    if (hostUrl !== 'https://gitlab.com') {
      const ca = host.ca;
      g.run(['config', 'set', 'skip_tls_verify', 'true', '--host', g.host]);
      await ship('p2-tls-off');
      g.run(['config', 'set', 'skip_tls_verify', 'false', '--host', g.host]);
      g.run(['config', 'set', 'ca_cert', '', '--host', g.host]);
      await ship('p2-no-ca');
      g.run(['config', 'set', 'ca_cert', ca, '--host', g.host]);
      await ship('p2-ca-back');
    }

    // Your login's secrets in the probe folder: taken from glab's helper in this process, searched
    // for, never logged (only the counts).
    const cred = g.run(['auth', 'git-credential', 'get'], `protocol=https\nhost=${g.host}\n\n`);
    const secrets = String(cred.stdout ?? '').split('\n').filter((l) => /^(password|oauth_refresh_token)=/.test(l)).map((l) => l.slice(l.indexOf('=') + 1)).filter((v) => v.length >= 16);
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
            const text = readFileSync(p, 'latin1');
            if (secrets.some((v) => text.includes(v)) || /\bgl(?:pat|oas|rt|dt|ft|soat)-[A-Za-z0-9_-]{16,}/.test(text)) found.push(p.slice(ctx.workdir.length));
          } catch {
            // unreadable
          }
        }
      }
    };
    walk(ctx.workdir);
    secrets.length = 0;
    ctx.log(`p1-token: your GitLab secrets (helper gave ${cred.status === 0 ? 'them' : `exit ${cred.status}`}) or token shapes in the probe folder: ${found.length ? found.slice(0, 5).join(', ') : 'none'}`);
  } finally {
    for (const c of cleanups) {
      const x = c();
      ctx.log(`p1-cleanup: ${x.status === 0 ? 'ok' : `exit ${x.status} ${x.err}`}`);
    }
  }
}

async function run() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, app: { type: 'string' }, repo: { type: 'string' }, host: { type: 'string' } } });
  if (!values.yes || !values.repo) {
    process.stderr.write('--yes --repo <group/project>: it uses your Claude subscription (Sonnet, 1 run), Docker, and opens then deletes real merge requests and branches on that GitLab project\n');
    return 2;
  }
  const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
  const log = (l) => process.stdout.write(`${l}\n`);
  try {
    const ctx = setup({ app: resolve(values.app ?? join(process.env.HOME, 'Projects', 'mirai-sample-app')), workdir });
    await p1({ ...ctx, log, workdir }, { hostUrl: `https://${values.host ?? 'gitlab.com'}`, repo: values.repo });
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
