import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { MR_MARKER, renderMrDescription } from '../../src/reports/render.js';
import { GLAB_MIN, glabConfigDir, glabTls, olderThan, openRetry, projectPath } from '../../src/ship/gitlab.js';
import { cleanTitle, hostConfig, hostFor, TOOLS_FILE } from '../../src/ship/host.js';
import { shipTicket } from '../../src/ship/ship.js';
import { pushBranch } from '../../src/store/git.js';
import { readJournal, ticketFacts } from '../../src/store/journal.js';
import { passed } from '../proofs/fixture.js';
import { tempDir } from '../tests/run-fixture.js';

// Unit 27b: the GitLab host. No network: a stand-in `glab` plays GitLab's API (branches from a
// local bare repo, merge requests in a JSON file); the push goes to that bare repo by path.

const REMOTE = 'https://gitlab.com/acme/sub/app.git';

function standInGlab(bare, { version = '1.130.0' } = {}) {
  const dir = tempDir('glab');
  const state = join(dir, 'state.json');
  writeFileSync(state, JSON.stringify({ mrs: [], calls: [], loggedIn: true, version }));
  const path = join(dir, 'glab');
  writeFileSync(path, `#!${process.execPath}
const fs = require('fs');
const { execFileSync } = require('child_process');
const S = ${JSON.stringify(state)};
const s = JSON.parse(fs.readFileSync(S, 'utf8'));
const a = process.argv.slice(2);
const e = process.env;
s.calls.push({ args: a, env: { GLAB_CONFIG_DIR: e.GLAB_CONFIG_DIR, GITLAB_HOST: e.GITLAB_HOST, GLAB_CHECK_UPDATE: e.GLAB_CHECK_UPDATE, GLAB_SEND_TELEMETRY: e.GLAB_SEND_TELEMETRY, GLAB_SHOW_WHATS_NEW: e.GLAB_SHOW_WHATS_NEW, GITLAB_TOKEN: e.GITLAB_TOKEN, HOME: e.HOME } });
const save = () => fs.writeFileSync(S, JSON.stringify(s));
const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
const tip = (b) => { try { return execFileSync('/usr/bin/git', ['--git-dir', ${JSON.stringify(bare)}, 'rev-parse', '--verify', '-q', 'refs/heads/' + b]).toString().trim(); } catch { return null; } };
const out = (v) => { save(); process.stdout.write(JSON.stringify(v)); process.exit(0); };
const notFound = (what) => { save(); process.stdout.write(JSON.stringify({ message: '404 ' + what + ' Not Found' })); process.stderr.write('glab: 404 ' + what + ' Not Found (HTTP 404)\\n'); process.exit(1); };
if (a[0] === '--version') { save(); process.stdout.write('glab ' + s.version + ' (abc)\\n'); process.exit(0); }
if (a[0] === 'auth') { save(); process.exit(s.loggedIn ? 0 : 1); }
if (a[0] === 'api') {
  const method = opt('--method');
  const p = a.at(-1);
  const m = /^projects\\/([^/]+)\\/(.*)$/.exec(p);
  if (!m || m[1] !== 'acme%2Fsub%2Fapp') notFound('Project');
  const rest = m[2];
  const body = opt('--input') ? JSON.parse(fs.readFileSync(opt('--input'), 'utf8')) : null;
  const b = /^repository\\/branches\\/([^?]+)$/.exec(rest);
  if (b && method === 'GET') { const sha = tip(decodeURIComponent(b[1])); if (!sha) notFound('Branch'); out({ name: decodeURIComponent(b[1]), commit: { id: sha } }); }
  if (rest.startsWith('merge_requests?') && method === 'GET') { const q = new URLSearchParams(rest.split('?')[1]); out(s.mrs.filter((x) => x.source_branch === q.get('source_branch'))); }
  if (rest === 'merge_requests' && method === 'POST') {
    if (s.lateBranch > 0) { s.lateBranch -= 1; save(); process.stdout.write(JSON.stringify({ message: { source_branch: ['does not exist'] } })); process.stderr.write('glab: map[message:map[source_branch:[does not exist]]]\\n'); process.exit(1); }
    const iid = s.mrs.length + 1;
    const mr = { iid, state: 'opened', web_url: 'https://gitlab.com/acme/sub/app/-/merge_requests/' + iid, title: body.title, description: body.description, source_branch: body.source_branch, target_branch: body.target_branch, sha: tip(body.source_branch) };
    s.mrs.push(mr); out(mr);
  }
  const u = /^merge_requests\\/(\\d+)$/.exec(rest);
  if (u && method === 'PUT') { const mr = s.mrs.find((x) => x.iid === Number(u[1])); mr.title = body.title; mr.description = body.description; out(mr); }
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

async function shippable({ version } = {}) {
  const f = await passed();
  assert.equal((await f.record()).outcome, 'recorded');
  const bare = join(tempDir('host'), 'app.git');
  execFileSync('/usr/bin/git', ['init', '-q', '--bare', bare]);
  f.git('push', '-q', bare, 'main');
  const glab = standInGlab(bare, { version });
  writeFileSync(join(f.store.dir, TOOLS_FILE), JSON.stringify({ schema_version: 1, gitlab: glab.path }));
  const env = { ...f.env, GITLAB_TOKEN: 'glpat-from-the-project-env' };
  const hostOf = (a) => {
    const h = hostFor({ ...a, remoteUrl: REMOTE });
    return Object.defineProperties({ ...h, pushUrl: bare }, { ca: { get: () => h.ca } });
  };
  const ship = () => shipTicket({ cwd: f.root, env, ticket: 'PMT-31', hostOf });
  const bareGit = (...a) => execFileSync('/usr/bin/git', ['--git-dir', bare, ...a]).toString().trim();
  return { ...f, bare, glab, ship, bareGit };
}

test('27b: the GitLab host from config: cloud, self-hosted on its own address, a port or a path refused', () => {
  assert.deepEqual(hostConfig({ git: {} }, REMOTE), { name: 'gitlab', hostUrl: 'https://gitlab.com', repo: 'acme/sub/app' });
  assert.deepEqual(hostConfig({ git: { host: 'gitlab', host_url: 'https://gitlab.acme.com' } }, 'git@gitlab.acme.com:team/app.git'), { name: 'gitlab', hostUrl: 'https://gitlab.acme.com', repo: 'team/app' });
  assert.throws(() => hostConfig({ git: { host: 'gitlab', host_url: 'https://git.acme.com:8443' } }, 'https://git.acme.com:8443/team/app.git'), (e) => e.code === 'host-unsupported');
  assert.throws(() => hostConfig({ git: { host: 'gitlab', host_url: 'https://acme.com/gitlab' } }, 'https://acme.com/gitlab/team/app.git'), (e) => e.code === 'host-unsupported');
  assert.throws(() => hostConfig({ git: {} }, 'https://gitlab.acme.com/team/app.git'), (e) => e.code === 'no-host');
  assert.equal(projectPath('group/sub/repo'), 'group%2Fsub%2Frepo');
  assert.equal(olderThan([1, 124, 9], GLAB_MIN), true);
  assert.equal(olderThan([1, 125, 0], GLAB_MIN), false);
  assert.equal(olderThan([2, 0, 0], GLAB_MIN), false);
});

test('27b: glab\'s config folder is found as glab finds it; ca_cert and skip_tls_verify are read per host', () => {
  const home = tempDir('home');
  assert.equal(glabConfigDir({}, home, 'darwin'), join(home, 'Library', 'Application Support', 'glab-cli'));
  assert.equal(glabConfigDir({}, home, 'linux'), join(home, '.config', 'glab-cli'));
  assert.equal(glabConfigDir({ XDG_CONFIG_HOME: '/x' }, home, 'darwin'), '/x/glab-cli');
  assert.equal(glabConfigDir({ GLAB_CONFIG_DIR: '/g' }, home, 'darwin'), '/g');
  mkdirSync(join(home, '.config', 'glab-cli'), { recursive: true });
  assert.equal(glabConfigDir({}, home, 'darwin'), join(home, 'Library', 'Application Support', 'glab-cli'), 'an empty legacy folder isn\'t used (glab doesn\'t either)');
  writeFileSync(join(home, '.config', 'glab-cli', 'config.yml'), 'hosts:\n');
  assert.equal(glabConfigDir({}, home, 'darwin'), join(home, '.config', 'glab-cli'));

  const dir = tempDir('glabcfg');
  writeFileSync(join(dir, 'config.yml'), [
    '# glab config', 'ca_cert: /top/level/ignored.pem', 'hosts:', '    gitlab.com:', '        api_host: gitlab.com', '        ca_cert:', '        skip_tls_verify:',
    '    gitlab.acme.com:', '        ca_cert: "/etc/acme/ca.pem" # the company CA', '        skip_tls_verify: false', '    lax.acme.com:', '        skip_tls_verify: true', 'telemetry: false', '',
  ].join('\n'));
  assert.deepEqual(glabTls(dir, 'gitlab.com'), { caCert: null, skipTls: false });
  assert.deepEqual(glabTls(dir, 'gitlab.acme.com'), { caCert: '/etc/acme/ca.pem', skipTls: false });
  assert.deepEqual(glabTls(dir, 'lax.acme.com'), { caCert: null, skipTls: true });
  assert.deepEqual(glabTls(dir, 'other.example'), { caCert: null, skipTls: false });
  assert.deepEqual(glabTls(tempDir('none'), 'gitlab.com'), { caCert: null, skipTls: false });
});

test('27b: ship on GitLab opens one MR through the API, a rerun changes nothing, an edit is put back', async () => {
  const f = await shippable();
  const r = await f.ship();
  assert.equal(r.outcome, 'opened');
  assert.equal(r.mr.url, 'https://gitlab.com/acme/sub/app/-/merge_requests/1');
  const head = f.git('rev-parse', 'HEAD');
  const branch = f.git('rev-parse', '--abbrev-ref', 'HEAD');
  assert.equal(f.bareGit('rev-parse', `refs/heads/${branch}`), head);
  const mr = f.glab.read().mrs[0];
  assert.deepEqual({ source: mr.source_branch, target: mr.target_branch, title: mr.title }, { source: branch, target: 'main', title: 'PMT-31: Renaming a team hides its members' });
  assert.ok(mr.description.startsWith(MR_MARKER));
  assert.match(mr.description, /Review: PASS after 1 round \(MIRAI\)/);
  const calls = f.glab.read().calls;
  // Only --version, auth status and api: never `mr`, never anything that downloads or pushes.
  assert.ok(calls.every((c) => ['--version', 'auth', 'api'].includes(c.args[0])), JSON.stringify(calls.map((c) => c.args[0])));
  // glab's environment: its config folder as glab finds it, the host, quiet, no project token.
  for (const c of calls) {
    assert.equal(c.env.GLAB_CONFIG_DIR, glabConfigDir({}, f.home));
    assert.equal(c.env.GITLAB_HOST, 'https://gitlab.com');
    assert.deepEqual([c.env.GLAB_CHECK_UPDATE, c.env.GLAB_SEND_TELEMETRY, c.env.GLAB_SHOW_WHATS_NEW], ['false', 'false', 'false']);
    assert.equal(c.env.GITLAB_TOKEN, undefined);
  }
  assert.ok(calls.some((c) => c.args.at(-1).startsWith('projects/acme%2Fsub%2Fapp/repository/branches/')));
  const facts = ticketFacts(readJournal(f.store).events, 'PMT-31');
  assert.deepEqual({ mr: facts.mr, url: facts.url, proofs: facts.proofsValidAtHead }, { mr: 'open', url: r.mr.url, proofs: true });

  assert.equal((await f.ship()).outcome, 'unchanged');
  assert.equal(f.glab.read().mrs.length, 1);
  f.glab.write((s) => {
    s.mrs[0].description = 'edited on GitLab';
  });
  assert.equal((await f.ship()).outcome, 'updated');
  assert.ok(f.glab.read().mrs[0].description.startsWith(MR_MARKER));
  assert.equal(f.glab.read().mrs.length, 1);
});

test('27b: a branch GitLab hasn\'t registered yet: the MR is tried again, then given up on', async () => {
  const saved = openRetry.delaysMs;
  openRetry.delaysMs = [10, 10, 10];
  try {
    const f = await shippable();
    f.glab.write((s) => {
      s.lateBranch = 2;
    });
    assert.equal((await f.ship()).outcome, 'opened');
    const posts = f.glab.read().calls.filter((c) => c.args.includes('POST'));
    assert.equal(posts.length, 3, 'two refusals, then made');
    assert.equal(f.glab.read().mrs.length, 1);

    const g = await shippable();
    g.glab.write((s) => {
      s.lateBranch = 99;
    });
    await assert.rejects(g.ship(), (e) => e.code === 'host-failed' && /does not exist/.test(e.message));
    assert.equal(g.glab.read().calls.filter((c) => c.args.includes('POST')).length, 4, 'once, then three more');
    assert.equal(g.glab.read().mrs.length, 0);
  } finally {
    openRetry.delaysMs = saved;
  }
});

test('27b: refusals: an old glab, logged out, skip_tls_verify, a bad ca_cert, locked, closed, merged, a moved branch', async () => {
  const f = await shippable({ version: '1.120.0' });
  await assert.rejects(f.ship(), (e) => e.code === 'glab-old');
  f.glab.write((s) => {
    s.version = '1.125.0';
    s.loggedIn = false;
  });
  await assert.rejects(f.ship(), (e) => e.code === 'glab-auth');
  f.glab.write((s) => {
    s.loggedIn = true;
  });
  const cfg = glabConfigDir({}, f.home);
  mkdirSync(cfg, { recursive: true });
  writeFileSync(join(cfg, 'config.yml'), 'hosts:\n  gitlab.com:\n    skip_tls_verify: true\n');
  await assert.rejects(f.ship(), (e) => e.code === 'tls-off');
  writeFileSync(join(cfg, 'config.yml'), 'hosts:\n  gitlab.com:\n    ca_cert: relative/ca.pem\n');
  await assert.rejects(f.ship(), (e) => e.code === 'bad-ca');
  writeFileSync(join(cfg, 'config.yml'), 'hosts:\n  gitlab.com:\n    ca_cert: /nowhere/ca.pem\n');
  await assert.rejects(f.ship(), (e) => e.code === 'bad-ca');
  assert.equal(f.glab.read().mrs.length, 0, 'nothing opened before the refusals clear');
  writeFileSync(join(cfg, 'config.yml'), 'hosts:\n  gitlab.com:\n    ca_cert: /etc/ssl/cert.pem\n');
  assert.equal((await f.ship()).outcome, 'opened');

  const branch = f.git('rev-parse', '--abbrev-ref', 'HEAD');
  const head = f.git('rev-parse', 'HEAD');
  const other = f.git('commit-tree', '-p', head, '-m', 'by hand', `${head}^{tree}`);
  f.git('push', '-q', f.bare, `${other}:refs/heads/${branch}`);
  await assert.rejects(f.ship(), (e) => e.code === 'remote-moved');
  f.bareGit('update-ref', `refs/heads/${branch}`, head);
  for (const [state, code, mr] of [['locked', 'mr-locked', 'open'], ['closed', 'mr-closed', 'closed'], ['merged', 'mr-merged', 'merged']]) {
    f.glab.write((s) => {
      s.mrs[0].state = state;
    });
    await assert.rejects(f.ship(), (e) => e.code === code);
    assert.equal(ticketFacts(readJournal(f.store).events, 'PMT-31').mr, mr);
  }
  assert.equal(f.glab.read().mrs.length, 1, 'never reopened, never a second MR');
});

test('27b: the push names glab as the only helper, with its folder and quiet switches, and the CA file', async () => {
  const f = await passed();
  const bare = join(tempDir('push'), 'p.git');
  execFileSync('/usr/bin/git', ['init', '-q', '--bare', bare]);
  const main = f.git('rev-parse', 'main');
  const helper = { command: '/usr/local/bin/glab', home: '/Users/me', configDir: '/Users/me/Library/Application Support/glab-cli', configVar: 'GLAB_CONFIG_DIR', vars: { GLAB_CHECK_UPDATE: 'false' } };
  assert.equal(pushBranch(f.root, bare, 'feature/x', main, f.env, { helper, ca: '/etc/ssl/cert.pem' }).ok, true);
  assert.throws(() => pushBranch(f.root, bare, 'feature/y', main, f.env, { ca: 'rel/ca.pem' }), (e) => e.code === 'bad-ca');
  assert.throws(() => pushBranch(f.root, bare, 'feature/y', main, f.env, { helper: { ...helper, vars: { GLAB_CHECK_UPDATE: 'x; rm -rf /' } } }), (e) => e.code === 'bad-helper');
  assert.throws(() => pushBranch(f.root, bare, 'feature/y', main, f.env, { helper: { ...helper, vars: { 'A=B C': 'x' } } }), (e) => e.code === 'bad-helper');
});

test('27b: GitLab\'s markdown: quick actions and every reference form come out inert; draft markers leave the title', () => {
  const hazards = ['/close', '/merge', '/approve', '/assign @all', '@all', '#1', '!1', '~bug', '%v1', '&1', '$1', '^alert#1', '*iteration:1', '[[_TOC_]]', '[TOC]', '[issue:1]', 'GL-1'];
  const text = hazards.join(' ');
  const data = {
    ticket: { id: 'PMT-1', title: text }, why: text, what_changed: hazards, review: { rounds: 1 }, followups: [...hazards.slice(0, 9), hazards.slice(9).join(' ')],
    risk: { level: 'high', reason: text }, links: [], files: [{ label: 'Ticket', path: 'docs/mirai/tickets/PMT-1.md' }],
  };
  let body;
  try {
    body = renderMrDescription(data, { host: 'gitlab', root: '/r', home: '/h' });
  } catch (err) {
    assert.fail(`render: ${err.message} ${JSON.stringify(err.problems ?? [])}`);
  }
  for (const line of body.split('\n').filter((l) => l !== MR_MARKER)) {
    assert.doesNotMatch(line, /^\//, `a quick action at a line's start: ${line}`);
    // Outside code spans, no reference prefix survives unescaped.
    const outside = line.replace(/(`+)[\s\S]*?\1/g, '');
    assert.doesNotMatch(outside, /(^|[^\\])[@#!~%&$^][A-Za-z0-9_[]/, `a live reference: ${line}`);
    assert.doesNotMatch(outside, /\[\[?_?TOC|\[issue:|\*iteration:/i, `a live reference: ${line}`);
  }
  for (const t of ['Draft: x', '[Draft] x', '(draft) x', 'WIP: x', 'draft: [WIP] x']) assert.equal(cleanTitle(t), 'x', t);
  assert.equal(cleanTitle('PMT-1: Draft: notes'), 'PMT-1: Draft: notes', 'only a leading marker');
});
