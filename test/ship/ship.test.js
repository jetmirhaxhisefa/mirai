import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { MR_MARKER } from '../../src/reports/render.js';
import { hostConfig, hostFor, remoteHost, repoPath, TOOLS_FILE } from '../../src/ship/host.js';
import { describeTicket, section } from '../../src/ship/describe.js';
import { shipTicket } from '../../src/ship/ship.js';
import { pushBranch } from '../../src/store/git.js';
import { readJournal, ticketFacts } from '../../src/store/journal.js';
import { passed, tty } from '../proofs/fixture.js';
import { tempDir } from '../tests/run-fixture.js';

// Unit 27a: `mirai ship`. No network: a stand-in `gh` plays GitHub (its branches are a local bare
// repo's, its pull requests a JSON file), and the push goes to that bare repo by path.

const REMOTE = 'https://github.com/acme/app.git';

// The stand-in gh: auth status, api …/git/ref/heads/<b> (from the bare repo), pr list / create /
// edit (in state.json); every call is recorded.
function standInGh(bare) {
  const dir = tempDir('gh');
  const state = join(dir, 'state.json');
  writeFileSync(state, JSON.stringify({ prs: [], calls: [], loggedIn: true }));
  const path = join(dir, 'gh');
  writeFileSync(path, `#!${process.execPath}
const fs = require('fs');
const { execFileSync } = require('child_process');
const S = ${JSON.stringify(state)};
const s = JSON.parse(fs.readFileSync(S, 'utf8'));
const a = process.argv.slice(2);
s.calls.push({ args: a, env: { GH_CONFIG_DIR: process.env.GH_CONFIG_DIR, GH_HOST: process.env.GH_HOST } });
const save = () => fs.writeFileSync(S, JSON.stringify(s));
const opt = (k) => a[a.indexOf(k) + 1];
const tip = (b) => { try { return execFileSync('/usr/bin/git', ['--git-dir', ${JSON.stringify(bare)}, 'rev-parse', '--verify', '-q', 'refs/heads/' + b]).toString().trim(); } catch { return null; } };
if (a[0] === 'auth') { save(); process.exit(s.loggedIn ? 0 : 1); }
if (a[0] === 'api') {
  save();
  const b = decodeURIComponent(a.at(-1).replace(/^repos\\/[^/]+\\/[^/]+\\/git\\/ref\\/heads\\//, ''));
  const sha = tip(b);
  if (!sha) { process.stderr.write('gh: Not Found (HTTP 404)\\n'); process.exit(1); }
  process.stdout.write(JSON.stringify({ object: { sha } }));
  process.exit(0);
}
if (a[0] === 'pr' && a[1] === 'list') { save(); process.stdout.write(JSON.stringify(s.prs.filter((p) => p.headRefName === opt('--head')))); process.exit(0); }
if (a[0] === 'pr' && a[1] === 'create') {
  const n = s.prs.length + 1;
  const url = 'https://github.com/acme/app/pull/' + n;
  s.prs.push({ number: n, state: 'OPEN', url, title: opt('--title'), body: fs.readFileSync(opt('--body-file'), 'utf8'), baseRefName: opt('--base'), headRefName: opt('--head'), headRefOid: tip(opt('--head')) });
  save(); process.stdout.write(url + '\\n'); process.exit(0);
}
if (a[0] === 'pr' && a[1] === 'edit') {
  const p = s.prs.find((x) => x.number === Number(a[2]));
  p.title = opt('--title'); p.body = fs.readFileSync(opt('--body-file'), 'utf8');
  save(); process.exit(0);
}
save(); process.stderr.write('unknown call\\n'); process.exit(2);
`, { mode: 0o755 });
  const read = () => JSON.parse(readFileSync(state, 'utf8'));
  const write = (fn) => {
    const v = read();
    fn(v);
    writeFileSync(state, JSON.stringify(v));
  };
  return { path, read, write };
}

// A ticket Kai built and Rex passed (25a's fixture), its proofs minted, an origin on GitHub, the
// stand-in gh recorded, and a bare repo holding main as the host's git.
async function shippable({ record = true } = {}) {
  const f = await passed();
  if (record) assert.equal((await f.record()).outcome, 'recorded');
  const bare = join(tempDir('host'), 'app.git');
  execFileSync('/usr/bin/git', ['init', '-q', '--bare', bare]);
  f.git('push', '-q', bare, 'main');
  const gh = standInGh(bare);
  writeFileSync(join(f.store.dir, TOOLS_FILE), JSON.stringify({ schema_version: 1, github: gh.path }));
  // The store's id names no remote (the fixture has none), so the remote is the host's input here.
  const hostOf = (a) => ({ ...hostFor({ ...a, remoteUrl: REMOTE }), pushUrl: bare });
  const ship = () => shipTicket({ cwd: f.root, env: f.env, ticket: 'PMT-31', hostOf });
  const bareGit = (...a) => execFileSync('/usr/bin/git', ['--git-dir', bare, ...a]).toString().trim();
  return { ...f, bare, gh, ship, bareGit, hostOf };
}

test('27a: the host from config and the remote', () => {
  assert.equal(remoteHost('git@gitlab.example.com:g/s/r.git'), 'gitlab.example.com');
  assert.equal(remoteHost('https://github.com/a/b'), 'github.com');
  assert.equal(remoteHost('http://github.com/a/b'), null);
  assert.equal(repoPath('https://github.com/a/b.git'), 'a/b');
  assert.equal(repoPath('git@gitlab.com:group/sub/repo.git'), 'group/sub/repo');
  assert.throws(() => repoPath('https://github.com/a'), /doesn't name a repo/);
  assert.throws(() => repoPath('https://github.com/a/../b'), /doesn't name a repo/);
  assert.deepEqual(hostConfig({ git: {} }, REMOTE), { name: 'github', hostUrl: 'https://github.com', repo: 'acme/app' });
  assert.deepEqual(hostConfig({ git: {} }, 'https://gitlab.com/g/s/r.git'), { name: 'gitlab', hostUrl: 'https://gitlab.com', repo: 'g/s/r' });
  assert.deepEqual(hostConfig({ git: { host: 'gitlab', host_url: 'https://git.acme.io' } }, 'git@git.acme.io:team/app.git'), { name: 'gitlab', hostUrl: 'https://git.acme.io', repo: 'team/app' });
  assert.throws(() => hostConfig({ git: {} }, 'https://git.acme.io/team/app.git'), (e) => e.code === 'no-host');
  assert.throws(() => hostConfig({ git: { host: 'github' } }, 'https://evil.example/acme/app.git'), (e) => e.code === 'wrong-host');
  assert.throws(() => hostFor({ config: { git: { host: 'gitlab' } }, remoteUrl: 'https://gitlab.com/g/r.git', store: null, env: {}, root: '/' }), (e) => e.code === 'host-not-built');
});

test('27a: the description: the review line, short follow-ups, nothing citing a file', async () => {
  assert.deepEqual(section('# T\n\n## Tasks\n\n- [ ] a\n```\n## not\n```\n- b\n\n## Next\n- c\n', 'Tasks'), ['', '- [ ] a', '- b', '']);
  const f = await passed();
  const head = f.git('rev-parse', 'HEAD');
  const { data, title } = describeTicket({ store: f.store, ticket: 'PMT-31', head, ticketPath: 'docs/mirai/tickets/PMT-31.md' });
  assert.equal(title, 'PMT-31: Renaming a team hides its members');
  assert.equal(data.review.rounds, 1);
  assert.ok(data.what_changed.length > 0);
  assert.deepEqual(data.files, [{ label: 'Ticket', path: 'docs/mirai/tickets/PMT-31.md' }]);
  assert.equal(Object.hasOwn(data, 'findings'), false);
  // The plan's code spans arrive as plain text (27a's P1: passed through, they rendered garbled).
  assert.ok(data.what_changed.every((l) => !l.includes('`')), JSON.stringify(data.what_changed));
});

test('27a: ship opens one MR, a second run changes nothing, an edited description is put back', async () => {
  const f = await shippable();
  const r = await f.ship();
  assert.equal(r.outcome, 'opened');
  assert.equal(r.mr.url, 'https://github.com/acme/app/pull/1');
  const head = f.git('rev-parse', 'HEAD');
  const branch = f.git('rev-parse', '--abbrev-ref', 'HEAD');
  assert.equal(f.bareGit('rev-parse', `refs/heads/${branch}`), head);
  const pr = f.gh.read().prs[0];
  assert.equal(pr.baseRefName, 'main');
  assert.equal(pr.headRefName, branch);
  assert.equal(pr.title, 'PMT-31: Renaming a team hides its members');
  assert.ok(pr.body.startsWith(MR_MARKER));
  assert.match(pr.body, /Review: PASS after 1 round \(MIRAI\)/);
  assert.match(pr.body, /QA hasn't run/);
  // The CLI's environment: your gh config folder and the host, nothing else of the project's.
  assert.ok(f.gh.read().calls.every((c) => c.env.GH_CONFIG_DIR === join(f.home, '.config', 'gh') && c.env.GH_HOST === 'github.com'));
  // The journal: the push with its checked proofs, the MR with its address; status says built.
  const facts = ticketFacts(readJournal(f.store).events, 'PMT-31');
  assert.deepEqual({ mr: facts.mr, head: facts.head, proofs: facts.proofsValidAtHead, url: facts.url }, { mr: 'open', head, proofs: true, url: r.mr.url });
  const st = await tty(['status'], f.io);
  assert.match(st.out, /PMT-31\s+built\s+derived\s+MR open with valid proofs at its head\s+https:\/\/github\.com\/acme\/app\/pull\/1/);

  // Again: one MR, nothing pushed or edited.
  const again = await f.ship();
  assert.equal(again.outcome, 'unchanged');
  assert.equal(f.gh.read().prs.length, 1);
  assert.equal(f.gh.read().calls.filter((c) => c.args[1] === 'create').length, 1);

  // Someone edited MIRAI's description: put back, the same MR.
  f.gh.write((s) => {
    s.prs[0].body = 'hand-edited';
  });
  const back = await f.ship();
  assert.equal(back.outcome, 'updated');
  assert.ok(f.gh.read().prs[0].body.startsWith(MR_MARKER));
  assert.equal(f.gh.read().prs.length, 1);
});

test('27a: ship refuses before anything leaves: no proofs, gh missing or logged out, the base not on the host', async () => {
  const f = await shippable({ record: false });
  await assert.rejects(f.ship(), (e) => e.code === 'no-proof');
  assert.equal(f.gh.read().calls.length, 0, 'the host isn\'t asked before the proofs pass');
  assert.equal((await f.record()).outcome, 'recorded');
  f.gh.write((s) => {
    s.loggedIn = false;
  });
  await assert.rejects(f.ship(), (e) => e.code === 'gh-auth');
  f.gh.write((s) => {
    s.loggedIn = true;
  });
  // The host's main behind the branch's base: the MR would carry unpushed commits.
  const first = f.git('rev-list', '--max-parents=0', 'main');
  f.bareGit('update-ref', 'refs/heads/main', first);
  await assert.rejects(f.ship(), (e) => e.code === 'base-not-pushed');
  f.bareGit('update-ref', 'refs/heads/main', f.git('rev-parse', 'main'));
  writeFileSync(join(f.store.dir, TOOLS_FILE), JSON.stringify({ schema_version: 1 }));
  await assert.rejects(f.ship(), (e) => e.code === 'no-gh');
  assert.equal(f.gh.read().prs.length, 0);
});

test('27a: a branch someone else moved, a closed MR, a merged one: refused, never forced or reopened', async () => {
  const f = await shippable();
  assert.equal((await f.ship()).outcome, 'opened');
  const branch = f.git('rev-parse', '--abbrev-ref', 'HEAD');
  const head = f.git('rev-parse', 'HEAD');
  // A commit MIRAI didn't push, on the host's branch.
  const other = f.git('commit-tree', '-p', head, '-m', 'by hand', `${head}^{tree}`);
  f.git('push', '-q', f.bare, `${other}:refs/heads/${branch}`);
  await assert.rejects(f.ship(), (e) => e.code === 'remote-moved');
  assert.equal(f.bareGit('rev-parse', `refs/heads/${branch}`), other, 'never overwritten');
  f.bareGit('update-ref', `refs/heads/${branch}`, head);
  // Closed by you: refused, recorded, not reopened.
  f.gh.write((s) => {
    s.prs[0].state = 'CLOSED';
  });
  await assert.rejects(f.ship(), (e) => e.code === 'mr-closed');
  assert.equal(ticketFacts(readJournal(f.store).events, 'PMT-31').mr, 'closed');
  assert.equal(f.gh.read().prs[0].state, 'CLOSED');
  f.gh.write((s) => {
    s.prs[0].state = 'MERGED';
  });
  await assert.rejects(f.ship(), (e) => e.code === 'mr-merged');
  assert.equal(ticketFacts(readJournal(f.store).events, 'PMT-31').mr, 'merged');
});

test('27a: pushBranch: to a bare repo by path, a lease that no longer holds is refused, bad names refused', async () => {
  const f = await passed();
  const bare = join(tempDir('push'), 'p.git');
  execFileSync('/usr/bin/git', ['init', '-q', '--bare', bare]);
  const head = f.git('rev-parse', 'HEAD');
  const main = f.git('rev-parse', 'main');
  assert.equal(pushBranch(f.root, bare, 'feature/x', main, f.env).ok, true);
  assert.equal(pushBranch(f.root, bare, 'feature/x', head, f.env, { lease: head }).ok, false, 'the branch isn\'t at the lease');
  assert.equal(pushBranch(f.root, bare, 'feature/x', head, f.env, { lease: main }).ok, true);
  assert.equal(execFileSync('/usr/bin/git', ['--git-dir', bare, 'rev-parse', 'refs/heads/feature/x']).toString().trim(), head);
  assert.throws(() => pushBranch(f.root, 'origin', 'feature/x', head, f.env), (e) => e.code === 'bad-url');
  assert.throws(() => pushBranch(f.root, 'https://u:p@github.com/a/b.git', 'feature/x', head, f.env), (e) => e.code === 'bad-url');
  assert.throws(() => pushBranch(f.root, bare, '../x', head, f.env), (e) => e.code === 'bad-branch');
  assert.throws(() => pushBranch(f.root, bare, 'feature/x', head, f.env, { helper: { command: 'gh', home: '/h', configDir: '/c', configVar: 'GH_CONFIG_DIR' } }), (e) => e.code === 'bad-helper');
});
