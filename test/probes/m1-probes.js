#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';

import { m1, m1Line } from '../../src/reports/m1.js';
import { hostFor } from '../../src/ship/host.js';
import { branchKeys } from '../../src/sign/keys.js';
import { remotes } from '../../src/store/git.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { snapshot, trustedConfig } from '../../src/trust/snapshot.js';

// Unit 29a's P1: M1 on REAL pull requests in your mirai-sample-app on GitHub (your OK, 2026-11-14).
// No model runs: M1 doesn't depend on Kai, it depends on what GitHub does with a merge. So the
// probe makes MIRAI's side itself (a branch with one code commit carrying the Mirai-Ticket trailer,
// pushed, a PR opened, the journal facts MIRAI would write) and your side on GitHub, then runs
// MIRAI's own M1 code (src/reports/m1.js) with the host as `mirai report --m1` uses it.
//   edited: a hand-made code commit pushed to the PR's branch, then merged → edited
//   closed: the PR closed without merge → closed
//   update: opened first; after "edited" merges, GitHub's "Update branch", then merged → merged as is
//   plus SAMPLE-3 and SAMPLE-4 from your real journal → merged as is (their heads read from GitHub)
// Expected: M1: 3 of 4 merged as is (75%) · 1 edited · 1 closed (SAMPLE-3/4, edited, update).
// Leaves on GitHub's main: two merges, each adding one file under probes/29a/. The closed PR's
// branch and every merged branch are deleted. A temporary clone; your sample app is only read.
//   node test/probes/m1-probes.js --yes [--app <sample app>] [--repo owner/name]

const { values } = parseArgs({ options: { yes: { type: 'boolean' }, app: { type: 'string' }, repo: { type: 'string' } } });
const app = resolve(values.app ?? join(process.env.HOME, 'Projects', 'mirai-sample-app'));
const repo = values.repo ?? 'jetmirhaxhisefa/mirai-sample-app';
if (!values.yes) {
  console.log(`This opens 3 real PRs on ${repo}, merges 2 of them into main and closes 1. Run it again with --yes.`);
  process.exit(2);
}
const log = (s) => console.log(s);
const id = randomBytes(3).toString('hex');
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mirai-m1-probe-')));
// gh runs outside any repo (the probe's own folder), so it never touches a local branch.
const gh = (...a) => {
  const r = spawnSync('gh', a, { encoding: 'utf8', cwd: dir });
  if (r.status !== 0) throw new Error(`gh ${a.slice(0, 3).join(' ')} failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return r.stdout.trim();
};
// GitHub works out whether a PR can merge a few seconds after a push: tried again for a minute.
const mergePr = (number) => {
  for (let i = 0; ; i++) {
    try {
      return gh('pr', 'merge', String(number), '--repo', repo, '--merge', '--delete-branch');
    } catch (err) {
      if (i >= 20) throw err;
      execFileSync('/bin/sleep', ['3']);
    }
  }
};
const clone = join(dir, 'app');
const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1' };
const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=probe@example.invalid', '-c', 'user.name=probe 29a', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', ...a], { cwd: clone, env: GIT_ENV, encoding: 'utf8' }).trim();
const opened = [];
let ok = true;
const check = (what, cond) => {
  log(`${cond ? 'PASS' : 'FAIL'}  ${what}`);
  if (!cond) ok = false;
};

try {
  gh('repo', 'clone', repo, clone, '--', '--quiet');
  const events = [];
  let seq = 1000;
  // MIRAI's side: a branch from main with one code commit (the trailer as MIRAI writes it), pushed,
  // and its PR; the journal facts MIRAI would write (pushed with proofs, mr_opened).
  const mirai = (kase) => {
    const ticket = `PROBE-29A-${kase.toUpperCase()}-${id}`;
    const branch = `probe/29a-${kase}-${id}`;
    git('switch', '-q', '-c', branch, 'origin/main');
    mkdirSync(join(clone, 'probes', '29a'), { recursive: true });
    writeFileSync(join(clone, 'probes', '29a', `${kase}-${id}.txt`), `MIRAI's change for the 29a probe (${kase})\n`);
    git('add', '-A');
    git('commit', '-q', '-m', `${ticket}: probe 29a (${kase})\n\nMirai-Ticket: ${ticket}`);
    const sha = git('rev-parse', 'HEAD');
    git('push', '-q', 'origin', `${branch}`);
    const url = gh('pr', 'create', '--repo', repo, '--head', branch, '--base', 'main', '--title', `probe 29a: M1 (${kase})`, '--body', 'Unit 29a\'s M1 probe (test/probes/m1-probes.js). Merged or closed by the probe.');
    const number = Number(/\/pull\/(\d+)/.exec(url)[1]);
    opened.push({ number, branch });
    events.push({ seq: seq++, type: 'pushed', ticket, branch, sha, proofs: 'pass' });
    events.push({ seq: seq++, type: 'mr_opened', ticket, head: sha, target: 'main', number, url });
    log(`opened ${url} (${kase}) at ${sha.slice(0, 7)}`);
    return { ticket, branch, sha, number, url };
  };
  // What `ship` records once it sees a merge (the PR's final head and merge commit).
  const merged = (p, { recordHead = true } = {}) => {
    const v = JSON.parse(gh('pr', 'view', String(p.number), '--repo', repo, '--json', 'state,headRefOid,mergeCommit'));
    if (v.state !== 'MERGED') throw new Error(`#${p.number} is ${v.state}, not merged`);
    events.push({ seq: seq++, type: 'mr_merged', ticket: p.ticket, target: 'integration', ...(recordHead ? { head: v.headRefOid, merge_sha: v.mergeCommit?.oid } : {}) });
    return v;
  };

  const update = mirai('update');
  const edited = mirai('edited');
  const closed = mirai('closed');

  // edited: your hand-made code commit on the PR's branch, then the merge.
  git('switch', '-q', edited.branch);
  writeFileSync(join(clone, 'probes', '29a', `edited-${id}.txt`), `MIRAI's change for the 29a probe (edited)\nand a line by hand\n`);
  git('commit', '-q', '-am', 'by hand');
  git('push', '-q', 'origin', edited.branch);
  mergePr(edited.number);
  merged(edited);
  log(`merged #${edited.number} (edited)`);

  // closed: closed without merge.
  gh('pr', 'close', String(closed.number), '--repo', repo, '--delete-branch');
  events.push({ seq: seq++, type: 'mr_closed', ticket: closed.ticket });
  log(`closed #${closed.number}`);

  // update: main has moved (the edited merge); GitHub's "Update branch", then the merge. Its head
  // is left out of the journal on purpose: M1 reads it from refs/pull/<n>/head, as for a merge
  // recorded before unit 29a.
  try {
    gh('api', '-X', 'PUT', `repos/${repo}/pulls/${update.number}/update-branch`, '-f', `expected_head_sha=${update.sha}`);
    log(`"Update branch" on #${update.number}, through GitHub's API`);
  } catch (err) {
    // What the button does: main merged into the PR's branch. Said, so the result is read right.
    log(`GitHub refused "Update branch" (${err.message.slice(0, 160)}); doing what it does: main merged into the branch`);
    git('fetch', '-q', 'origin', 'main');
    git('switch', '-q', update.branch);
    git('merge', '-q', '--no-ff', '-m', `Merge branch 'main' into ${update.branch}`, 'origin/main');
    git('push', '-q', 'origin', update.branch);
  }
  let head = update.sha;
  for (let i = 0; i < 30 && head === update.sha; i++) {
    execFileSync('/bin/sleep', ['2']);
    head = JSON.parse(gh('pr', 'view', String(update.number), '--repo', repo, '--json', 'headRefOid')).headRefOid;
  }
  check(`"Update branch" moved #${update.number}'s head (${update.sha.slice(0, 7)} → ${head.slice(0, 7)})`, head !== update.sha);
  mergePr(update.number);
  merged(update, { recordHead: false });
  log(`merged #${update.number} (update)`);

  // MIRAI's M1, with the host as mirai report --m1 has it, over the clone fetched up to date.
  git('fetch', '-q', 'origin', 'main');
  git('switch', '-q', '--detach', 'origin/main');
  const store = openStore({ cwd: app, env: process.env });
  const config = trustedConfig(snapshot({ cwd: app, env: process.env }));
  const h = hostFor({ config, remoteUrl: remotes(store.checkout, store.gitEnv).get('origin'), store, env: process.env, root: store.checkout });
  const host = { name: h.name, pushUrl: h.pushUrl, helper: h.helper ?? null, ca: h.ca ?? null };
  const probe = m1({ root: clone, env: GIT_ENV, events, codePaths: config.gate.code_paths, integration: 'origin/main', host });
  for (const r of probe.rows) log(`  ${r.ticket}: ${r.class}${r.why ? ` (${r.why})` : ''}`);
  const cls = (t) => probe.rows.find((r) => r.ticket === t)?.class;
  check('a hand-made code commit, then merged → edited', cls(edited.ticket) === 'edited');
  check('closed without merge → closed', cls(closed.ticket) === 'closed');
  check('"Update branch", then merged, its head read from refs/pull/<n>/head → merged as is', cls(update.ticket) === 'as-is');
  // SAMPLE-3 and SAMPLE-4, from your real journal, in your sample app (pulled).
  const real = m1({ root: store.checkout, env: store.gitEnv, events: readJournal(store, { keys: branchKeys(store.checkout, store.branch, store.gitEnv) }).events, codePaths: config.gate.code_paths, integration: config.git.integration_branch, host, tickets: ['SAMPLE-3', 'SAMPLE-4'] });
  check('SAMPLE-3 and SAMPLE-4 → merged as is', real.rows.length === 2 && real.rows.every((r) => r.class === 'as-is'));
  const all = [...real.rows, ...probe.rows];
  const { m1Rate } = await import('../../src/reports/m1.js');
  const line = m1Line(m1Rate(all));
  log(line);
  check('the rate: M1: 3 of 4 merged as is (75%) · 1 edited · 1 closed', line === 'M1: 3 of 4 merged as is (75%) · 1 edited · 1 closed');
} catch (err) {
  ok = false;
  log(`FAIL  ${err.message}`);
} finally {
  // Clean-up: any PR still open is closed, and every probe branch deleted on GitHub.
  for (const p of opened) {
    try {
      const v = JSON.parse(gh('pr', 'view', String(p.number), '--repo', repo, '--json', 'state'));
      if (v.state === 'OPEN') gh('pr', 'close', String(p.number), '--repo', repo, '--delete-branch');
    } catch {
      // reported below if a branch is left
    }
    spawnSync('gh', ['api', '-X', 'DELETE', `repos/${repo}/git/refs/heads/${p.branch}`], { encoding: 'utf8', cwd: dir });
  }
  const left = opened.filter((p) => spawnSync('gh', ['api', `repos/${repo}/git/refs/heads/${p.branch}`], { encoding: 'utf8', cwd: dir }).status === 0);
  log(left.length ? `FAIL  branches left on GitHub: ${left.map((p) => p.branch).join(', ')}` : 'clean-up: every probe branch deleted on GitHub');
  rmSync(dir, { recursive: true, force: true });
  log(ok && !left.length ? 'P1: PASS' : 'P1: FAIL');
  process.exitCode = ok && !left.length ? 0 : 1;
}
