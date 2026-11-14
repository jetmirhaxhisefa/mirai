#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';

import { mergeChecks, mergeTicket } from '../../src/review/merge.js';
import { packetData, packetText } from '../../src/review/packet.js';
import { findCli, hostFor, TOOLS_FILE } from '../../src/ship/host.js';
import { shipTicket } from '../../src/ship/ship.js';
import { loadSigner } from '../../src/sign/signer.js';
import { pushBranch } from '../../src/store/git.js';
import { readJournal, ticketFacts } from '../../src/store/journal.js';
import { passed } from '../proofs/fixture.js';

// Unit 29d's P1 (GitHub) and P2 (GitLab), your OK 2026-11-14. No model: each case is the unit
// tests' fixture (a ticket planned, built and reviewed by a stand-in claude, its proofs signed with
// a probe key), pushed to the REAL host on a throwaway base branch `mirai-probe/base-<id>` that its
// MR targets, so nothing lands on your main. Then MIRAI's real review-mr and merge code:
//   a: the packet (open, proofs valid, the host can merge it, CI none); merged: a merge commit of
//      the base and the reviewed head, mr_merged with both, the branch deleted on the host;
//   b: a commit pushed to the MR's branch after MIRAI: merge refuses (head moved), and the host's
//      own pin refuses the old head too; nothing merged;
//   c (GitHub only): a closed MR: the packet says closed, merge refuses.
// Every probe branch and MR is deleted or closed at the end.
//   node test/probes/merge-probes.js --yes --host github [--repo jetmirhaxhisefa/mirai-sample-app]
//   node test/probes/merge-probes.js --yes --host gitlab [--repo jettmir.h/mirai-sample-app]

const { values } = parseArgs({ options: { yes: { type: 'boolean' }, host: { type: 'string' }, repo: { type: 'string' } } });
const kind = values.host ?? 'github';
const repo = values.repo ?? (kind === 'gitlab' ? 'jettmir.h/mirai-sample-app' : 'jetmirhaxhisefa/mirai-sample-app');
const remoteUrl = `https://${kind === 'gitlab' ? 'gitlab.com' : 'github.com'}/${repo}.git`;
if (!values.yes) {
  console.log(`This opens MRs on ${remoteUrl} against throwaway base branches, merges one and closes the rest. Run it again with --yes.`);
  process.exit(2);
}
const cli = findCli(kind === 'gitlab' ? 'glab' : 'gh', process.env, process.cwd());
if (!cli) {
  console.log(`FAIL  no ${kind === 'gitlab' ? 'glab' : 'gh'} on your PATH`);
  process.exit(1);
}
let ok = true;
const check = (what, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${!cond && detail ? `\n      ${String(detail).split('\n').join('\n      ')}` : ''}`);
  if (!cond) ok = false;
};
const cleanups = [];
// Every raw call names its server: glab's own default host may be another GitLab (a work server
// on this laptop), and the probe must never reach it. `api` calls get --hostname, and GITLAB_HOST
// is set too; anything else is refused here.
const HOSTNAME = kind === 'gitlab' ? 'gitlab.com' : 'github.com';
// A glab config folder of its own (GLAB_CONFIG_DIR), so a work GitLab's config isn't even read.
const GLAB_DIR = kind === 'gitlab' ? process.env.GLAB_CONFIG_DIR ?? null : null;
if (kind === 'gitlab' && !GLAB_DIR) {
  console.log('FAIL  set GLAB_CONFIG_DIR to the folder you logged glab in to gitlab.com with, so no other GitLab config is read');
  process.exit(1);
}
const raw = (...a) => {
  if (kind === 'gitlab' && a[0] !== 'api') throw new Error(`the probe runs only glab api, with --hostname ${HOSTNAME}`);
  const args = kind === 'gitlab' ? ['api', '--hostname', HOSTNAME, ...a.slice(1)] : a;
  return spawnSync(cli, args, { encoding: 'utf8', cwd: '/', env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, ...(GLAB_DIR ? { GLAB_CONFIG_DIR: GLAB_DIR } : {}), GH_HOST: 'github.com', GITLAB_HOST: `https://${HOSTNAME}`, GH_PROMPT_DISABLED: '1', GLAB_CHECK_UPDATE: 'false', GLAB_SEND_TELEMETRY: 'false', NO_COLOR: '1' } });
};
const projectApi = (path) => (kind === 'gitlab' ? `projects/${encodeURIComponent(repo)}/${path}` : `repos/${repo}/${path}`);

// One case: a fixture shipped to the real host, against its own base branch.
// `floor`: every case's ticket has the same branch name, so a case sees only MRs newer than the
// last case's (as unit 28's probe ignored an earlier probe's PR).
async function shippedCase(label, floor = 0) {
  const f = await passed();
  // MIRAI's glab gets the same separate config folder (it honours GLAB_CONFIG_DIR).
  if (GLAB_DIR) f.env.GLAB_CONFIG_DIR = GLAB_DIR;
  if ((await f.record()).outcome !== 'recorded') throw new Error(`${label}: the proofs weren't recorded`);
  writeFileSync(join(f.store.dir, TOOLS_FILE), JSON.stringify({ schema_version: 1, [kind]: cli }), { mode: 0o600 });
  const base = `mirai-probe/base-${randomBytes(3).toString('hex')}`;
  const real = (a) => hostFor({ ...a, config: { ...(a.config ?? {}), git: { ...(a.config?.git ?? {}), host: kind } }, remoteUrl, cliHome: process.env.HOME });
  // The host as MIRAI sees it, its integration branch the probe's base branch.
  const hostOf = (a) => {
    const h = real(a);
    return { ...h, branchTip: (b) => h.branchTip(b === 'main' ? base : b), openMr: (o) => h.openMr({ ...o, base }), findMr: (b) => { const m = h.findMr(b); return m && m.number > floor ? m : null; } };
  };
  const h = real({ config: {}, store: f.store, env: f.env, root: f.root });
  h.checkAuth();
  const pb = pushBranch(f.root, h.pushUrl, base, f.git('rev-parse', 'main').trim(), f.store.gitEnv, { helper: h.helper, ca: h.ca ?? null });
  if (!pb.ok) throw new Error(`${label}: the base branch wasn't pushed: ${pb.why}`);
  cleanups.push(() => raw('api', '--method', 'DELETE', projectApi(kind === 'gitlab' ? `repository/branches/${encodeURIComponent(base)}` : `git/refs/heads/${base}`)));
  const s = await shipTicket({ cwd: f.root, env: f.env, ticket: 'PMT-31', hostOf });
  const branch = f.git('branch', '--show-current').trim();
  cleanups.push(() => raw('api', '--method', 'DELETE', projectApi(kind === 'gitlab' ? `repository/branches/${encodeURIComponent(branch)}` : `git/refs/heads/${branch}`)));
  cleanups.unshift(() => (kind === 'gitlab' ? raw('api', '--method', 'PUT', projectApi(`merge_requests/${s.mr.number}?state_event=close`)) : raw('pr', 'close', String(s.mr.number), '--repo', repo)));
  console.log(`${label}: ${s.outcome} ${s.mr.url} (${branch} → ${base})`);
  return { f, hostOf, real, base, branch, mr: s.mr, h };
}

// The newest MR number on the host now: earlier runs' MRs (same branch name) are left out.
const newest = () => {
  const r = kind === 'gitlab' ? raw('api', projectApi('merge_requests?state=all&order_by=created_at&sort=desc&per_page=1')) : raw('pr', 'list', '--repo', repo, '--state', 'all', '--limit', '1', '--json', 'number');
  try {
    const list = JSON.parse(r.stdout || '[]');
    return Number(list[0]?.number ?? list[0]?.iid ?? 0);
  } catch {
    return 0;
  }
};

try {
  // a: review, then merge.
  const a = await shippedCase('a', newest());
  const d = packetData({ cwd: a.f.root, env: a.f.env, ticket: 'PMT-31', hostOf: a.hostOf });
  console.log(packetText(d).split('\n').map((l) => `  | ${l}`).join('\n'));
  check('a: the packet: open, proofs valid at the head, MIRAI\'s head', d.host?.state === 'open' && d.proofs.outcome === 'pass' && d.head_is_mirais, JSON.stringify({ host: d.host, proofs: d.proofs, err: d.host_error }));
  check('a: the host can merge it; CI none', d.host?.mergeable === true && d.host?.ci.state === 'none', JSON.stringify(d.host));
  const checks = mergeChecks({ cwd: a.f.root, env: a.f.env, ticket: 'PMT-31', hostOf: a.hostOf });
  // The fixture's integration branch stands for the probe's base branch here, so the checkout's
  // fast-forward is checked against the real host too.
  a.f.git('branch', a.base, 'main');
  checks.integration = a.base;
  const signer = loadSigner(a.f.env, checks.store);
  const r = mergeTicket({ cwd: a.f.root, env: a.f.env, ticket: 'PMT-31', signer, answeredAfterS: 1, checks, hostOf: a.hostOf });
  console.log(`a: merged as ${r.mergeSha.slice(0, 7)}; notes: ${r.notes.join(' | ') || 'none'}`);
  const after = a.h.mrState(a.mr.number);
  check('a: the host says merged', after.state === 'merged', JSON.stringify(after));
  const events = readJournal(a.f.store).events;
  const merged = events.find((e) => e.type === 'mr_merged');
  check('a: mr_merged has the reviewed head and the merge commit; your approval of kind merge is signed', merged?.head === checks.head && merged?.merge_sha === r.mergeSha && events.some((e) => e.type === 'approval' && e.kind === 'merge' && e.signature));
  check('a: the ticket is done', ticketFacts(events, 'PMT-31').mr === 'merged');
  check('a: your checkout is on the base branch, fast-forwarded to the merge', a.f.git('branch', '--show-current').trim() === a.base && a.f.git('rev-parse', 'HEAD').trim() === r.mergeSha, r.notes.join(' | '));
  const tip = a.h.branchTip(a.base);
  check('a: the base branch on the host is at the merge commit', tip === r.mergeSha, `${tip} vs ${r.mergeSha}`);
  // The merge commit's parents, from the host.
  const parents = kind === 'gitlab'
    ? JSON.parse(raw('api', projectApi(`repository/commits/${r.mergeSha}`)).stdout || '{}').parent_ids
    : JSON.parse(raw('api', projectApi(`commits/${r.mergeSha}`)).stdout || '{}').parents?.map((p) => p.sha);
  check('a: a merge commit of the base and the reviewed head', Array.isArray(parents) && parents.length === 2 && parents[1] === checks.head, JSON.stringify(parents));
  for (let i = 0; i < 10 && a.h.branchTip(a.branch); i++) spawnSync('/bin/sleep', ['2']);
  check('a: the MR\'s branch is deleted on the host', a.h.branchTip(a.branch) === null);

  // b: a push after MIRAI.
  const b = await shippedCase('b', a.mr.number);
  const pushedHead = b.f.git('rev-parse', 'HEAD').trim();
  b.f.git('commit', '-q', '--allow-empty', '-m', 'by hand, after MIRAI');
  const other = b.f.git('rev-parse', 'HEAD').trim();
  const pushed = pushBranch(b.f.root, b.h.pushUrl, b.branch, other, b.f.store.gitEnv, { helper: b.h.helper, ca: b.h.ca ?? null, lease: pushedHead });
  check('b: a commit pushed to the MR\'s branch by hand', pushed.ok, pushed.why);
  let head = pushedHead;
  for (let i = 0; i < 15 && head === pushedHead; i++) {
    spawnSync('/bin/sleep', ['2']);
    head = b.h.mrState(b.mr.number).head;
  }
  let refused = null;
  try {
    mergeChecks({ cwd: b.f.root, env: b.f.env, ticket: 'PMT-31', hostOf: b.hostOf });
  } catch (err) {
    refused = err.code;
  }
  check('b: mirai merge refuses: the head isn\'t what MIRAI pushed', refused === 'mr-head-moved', refused);
  let pin = null;
  try {
    b.h.mergeMr(b.mr.number, { head: pushedHead });
  } catch (err) {
    pin = err.code;
  }
  check(`b: the host's own pin refuses the old head (${kind})`, pin === 'mr-head-moved', pin);
  check('b: nothing merged', b.h.mrState(b.mr.number).state === 'open');
  // b's MR closed and its branch deleted now: c's branch has the same name.
  if (kind === 'github') raw('pr', 'close', String(b.mr.number), '--repo', repo);
  else raw('api', '--method', 'PUT', projectApi(`merge_requests/${b.mr.number}?state_event=close`));
  raw('api', '--method', 'DELETE', projectApi(kind === 'gitlab' ? `repository/branches/${encodeURIComponent(b.branch)}` : `git/refs/heads/${b.branch}`));

  // c: a closed MR (GitHub; GitLab's close is covered by 27b).
  if (kind === 'github') {
    const c = await shippedCase('c', b.mr.number);
    raw('pr', 'close', String(c.mr.number), '--repo', repo);
    const dc = packetData({ cwd: c.f.root, env: c.f.env, ticket: 'PMT-31', hostOf: c.hostOf });
    check('c: the packet says closed', dc.host?.state === 'closed', JSON.stringify(dc.host));
    let closed = null;
    try {
      mergeChecks({ cwd: c.f.root, env: c.f.env, ticket: 'PMT-31', hostOf: c.hostOf });
    } catch (err) {
      closed = err.code;
    }
    check('c: mirai merge refuses a closed MR', closed === 'mr-closed', closed);
  }
} catch (err) {
  check(`stopped: ${err.message}`, false, err.stack);
} finally {
  for (const c of cleanups) c();
  console.log('clean-up: the probe MRs closed and their branches deleted on the host');
  console.log(ok ? `${kind === 'gitlab' ? 'P2' : 'P1'}: PASS` : `${kind === 'gitlab' ? 'P2' : 'P1'}: FAIL`);
  process.exitCode = ok ? 0 : 1;
}
