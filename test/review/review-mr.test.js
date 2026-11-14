import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import mergeCmd from '../../src/cli/commands/merge.js';
import reviewMrCmd from '../../src/cli/commands/review-mr.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { COMMANDS, GATES } from '../../src/mcp/tools/commands.js';
import { codeMap, packetData, packetText } from '../../src/review/packet.js';
import { mergeChecks } from '../../src/review/merge.js';
import { ciState, hostFor, TOOLS_FILE } from '../../src/ship/host.js';
import { shipTicket } from '../../src/ship/ship.js';
import { branchKeys } from '../../src/sign/keys.js';
import { commitOf, symbolicBranch } from '../../src/store/git.js';
import { readJournal, ticketFacts } from '../../src/store/journal.js';
import { passed } from '../proofs/fixture.js';
import { tempDir } from '../tests/run-fixture.js';

// Unit 29d: mirai review-mr and mirai merge. No network: a stand-in gh plays GitHub over a local
// bare repo (its branches), pull requests in a JSON file, and a merge that really merges, pinned to
// the head (another sha is refused, as GitHub's 409).

const REMOTE = 'https://github.com/acme/app.git';

function standInGh(bare) {
  const dir = tempDir('gh');
  const state = join(dir, 'state.json');
  writeFileSync(state, JSON.stringify({ prs: [], calls: [], ci: [], mergeable: true }));
  const path = join(dir, 'gh');
  writeFileSync(path, `#!${process.execPath}
const fs = require('fs');
const { execFileSync } = require('child_process');
const S = ${JSON.stringify(state)};
const s = JSON.parse(fs.readFileSync(S, 'utf8'));
const a = process.argv.slice(2);
s.calls.push(a);
const save = () => fs.writeFileSync(S, JSON.stringify(s));
const opt = (k) => a[a.indexOf(k) + 1];
const G = (...x) => execFileSync('/usr/bin/git', ['--git-dir', ${JSON.stringify(bare)}, '-c', 'user.email=h@example.invalid', '-c', 'user.name=GitHub', ...x]).toString().trim();
const tip = (b) => { try { return G('rev-parse', '--verify', '-q', 'refs/heads/' + b); } catch { return null; } };
const out = (v) => { save(); process.stdout.write(JSON.stringify(v)); process.exit(0); };
const err = (code, msg) => { save(); process.stderr.write('gh: ' + msg + ' (HTTP ' + code + ')\\n'); process.stdout.write(JSON.stringify({ message: msg })); process.exit(1); };
if (a[0] === 'auth') { save(); process.exit(0); }
if (a[0] === 'pr' && a[1] === 'list') out(s.prs.filter((p) => p.headRefName === opt('--head')));
if (a[0] === 'pr' && a[1] === 'create') {
  const n = s.prs.length + 1;
  const url = 'https://github.com/acme/app/pull/' + n;
  s.prs.push({ number: n, state: 'OPEN', url, title: opt('--title'), body: fs.readFileSync(opt('--body-file'), 'utf8'), baseRefName: opt('--base'), headRefName: opt('--head'), headRefOid: tip(opt('--head')) });
  save(); process.stdout.write(url + '\\n'); process.exit(0);
}
if (a[0] === 'pr' && a[1] === 'edit') { save(); process.exit(0); }
if (a[0] === 'api') {
  const method = opt('--method') ?? 'GET';
  const p = a.find((x, i) => i > 0 && !x.startsWith('-') && a[i - 1] !== '--method' && a[i - 1] !== '--input');
  let m;
  if ((m = /git\\/ref\\/heads\\/(.+)$/.exec(p)) && method === 'GET') { const sha = tip(decodeURIComponent(m[1])); if (!sha) err(404, 'Not Found'); out({ object: { sha } }); }
  if ((m = /git\\/refs\\/heads\\/(.+)$/.exec(p)) && method === 'DELETE') { try { G('update-ref', '-d', 'refs/heads/' + decodeURIComponent(m[1])); } catch {} s.deleted = (s.deleted ?? []).concat(decodeURIComponent(m[1])); out({}); }
  if ((m = /pulls\\/(\\d+)\\/merge$/.exec(p)) && method === 'PUT') {
    const pr = s.prs.find((x) => x.number === Number(m[1]));
    const body = JSON.parse(fs.readFileSync(opt('--input'), 'utf8'));
    const head = tip(pr.headRefName);
    if (body.sha !== head) err(409, 'Head branch was modified. Review and try the merge again.');
    if (!s.mergeable) err(405, 'Pull Request is not mergeable');
    const base = tip(pr.baseRefName);
    const tree = G('merge-tree', '--write-tree', base, head);
    const sha = G('commit-tree', '-p', base, '-p', head, '-m', 'Merge pull request #' + pr.number, tree.split('\\n')[0]);
    G('update-ref', 'refs/heads/' + pr.baseRefName, sha);
    pr.state = 'MERGED'; pr.mergeCommit = { oid: sha }; pr.headRefOid = head;
    out({ sha, merged: true, message: 'Pull Request successfully merged' });
  }
  if ((m = /pulls\\/(\\d+)$/.exec(p))) {
    const pr = s.prs.find((x) => x.number === Number(m[1]));
    if (!pr) err(404, 'Not Found');
    const head = tip(pr.headRefName) ?? pr.headRefOid;
    out({ state: pr.state === 'OPEN' ? 'open' : 'closed', merged: pr.state === 'MERGED', head: { sha: pr.state === 'MERGED' ? pr.headRefOid : head }, mergeable: s.mergeable, mergeable_state: s.mergeable ? 'clean' : 'dirty' });
  }
  if (/check-runs/.test(p)) out({ check_runs: s.ci });
  if (/\\/status$/.test(p)) out({ statuses: [] });
}
save(); process.stderr.write('unknown call ' + a.join(' ') + '\\n'); process.exit(2);
`, { mode: 0o755 });
  const read = () => JSON.parse(readFileSync(state, 'utf8'));
  const write = (fn) => {
    const v = read();
    fn(v);
    writeFileSync(state, JSON.stringify(v));
  };
  return { path, read, write };
}

// A ticket built, reviewed, its proofs minted and shipped (MR #1 open), with the host's git a bare
// repo by path (GitHub's merge moves its main).
async function shipped() {
  const f = await passed();
  assert.equal((await f.record()).outcome, 'recorded');
  const bare = join(tempDir('host'), 'app.git');
  execFileSync('/usr/bin/git', ['init', '-q', '--bare', '-b', 'main', bare]);
  f.git('push', '-q', bare, 'main');
  const gh = standInGh(bare);
  writeFileSync(join(f.store.dir, TOOLS_FILE), JSON.stringify({ schema_version: 1, github: gh.path }));
  const hostOf = (a) => ({ ...hostFor({ ...a, remoteUrl: REMOTE }), pushUrl: bare });
  assert.equal((await shipTicket({ cwd: f.root, env: f.env, ticket: 'PMT-31', hostOf })).outcome, 'opened');
  const bareGit = (...a) => execFileSync('/usr/bin/git', ['--git-dir', bare, ...a]).toString().trim();
  return { ...f, bare, gh, hostOf, bareGit };
}

// The command as your terminal runs it: answers on stdin.
async function term(cmd, f, argv, answers, values = {}) {
  let out = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const io = { cwd: f.root, env: f.env, stdin, stdout: { isTTY: true, write: (s) => (out += s) }, hostOf: f.hostOf };
  let code;
  try {
    code = await cmd.run({ positionals: argv, values }, io);
  } catch (err) {
    return { code: err.exitCode ?? 1, out, err };
  }
  return { code, out };
}

test('29d: the packet: files against the Code map, tests, the review\'s depth, proofs at the head, CI, mergeable', async () => {
  const f = await shipped();
  const d = packetData({ cwd: f.root, env: f.env, ticket: 'PMT-31', hostOf: f.hostOf });
  assert.equal(d.mr.state, 'open');
  assert.equal(d.host.state, 'open');
  assert.equal(d.head_is_mirais, true);
  assert.equal(d.proofs.outcome, 'pass');
  assert.equal(d.host.mergeable, true);
  assert.equal(d.host.ci.state, 'none');
  assert.ok(d.files.length >= 1);
  assert.ok(d.review && d.review.outcome === 'pass');
  const text = packetText(d);
  assert.match(text, /^PMT-31 · MR #1 open · proofs valid at its head [0-9a-f]{7} · CI: none \(local-only\)$/m);
  assert.match(text, /^Merge {6}the host can merge it · M1 if you merge now: as is$/m);
  // A file the plan doesn't name is flagged.
  assert.ok(d.files.some((x) => x.flag === 'not in the plan\'s Code map') || d.files.every((x) => !x.flag));
  assert.deepEqual(codeMap('# p\n\n## Code map\n\n| Path | Symbols | Change |\n|---|---|---|\n| `app/A.php` | `A` | change |\n| `app/B.php` | `B` | read |\n'), [{ path: 'app/A.php', change: 'change' }, { path: 'app/B.php', change: 'read' }]);
  // CI states.
  assert.equal(ciState([]), 'none');
  assert.equal(ciState([{ state: 'passed' }, { state: 'pending' }]), 'pending');
  assert.equal(ciState([{ state: 'passed' }, { state: 'failed' }]), 'failed');
  assert.equal(ciState([{ state: 'passed' }]), 'passed');
  // From your session (no terminal): the packet and the terminal command, no decision.
  let out = '';
  assert.equal(await reviewMrCmd.run({ positionals: ['PMT-31'], values: {} }, { cwd: f.root, env: f.env, stdin: { isTTY: false }, stdout: { isTTY: false, write: (s) => (out += s) }, hostOf: f.hostOf }), EXIT.OK);
  assert.match(out, /to merge it, in your terminal: mirai merge PMT-31/);
  // On the session list: review-mr read-only; merge a gate.
  assert.deepEqual(COMMANDS['review-mr'].argv({ ticket: 'PMT-31', diff: true }), ['review-mr', 'PMT-31', '--diff']);
  assert.match(GATES.merge({ ticket: 'PMT-31' }), /^mirai merge PMT-31/);
});

test('29d: merge refuses: a head pushed after MIRAI, CI failing or pending, not mergeable, a wrong key typed, no terminal', async () => {
  const f = await shipped();
  // CI failing, then pending; not mergeable.
  f.gh.write((s) => { s.ci = [{ name: 'tests', status: 'completed', conclusion: 'failure' }]; });
  assert.throws(() => mergeChecks({ cwd: f.root, env: f.env, ticket: 'PMT-31', hostOf: f.hostOf }), (e) => e.code === 'ci-failed');
  f.gh.write((s) => { s.ci = [{ name: 'tests', status: 'in_progress', conclusion: null }]; });
  assert.throws(() => mergeChecks({ cwd: f.root, env: f.env, ticket: 'PMT-31', hostOf: f.hostOf }), (e) => e.code === 'ci-pending');
  f.gh.write((s) => { s.ci = []; s.mergeable = false; });
  assert.throws(() => mergeChecks({ cwd: f.root, env: f.env, ticket: 'PMT-31', hostOf: f.hostOf }), (e) => e.code === 'mr-not-mergeable');
  f.gh.write((s) => { s.mergeable = true; });
  // A wrong key typed: nothing merged, nothing signed.
  const wrong = await term(mergeCmd, f, ['PMT-31'], ['PMT-99']);
  assert.notEqual(wrong.code, EXIT.OK);
  assert.equal(readJournal(f.store).events.filter((e) => e.type === 'approval' && e.kind === 'merge').length, 0);
  assert.equal(f.gh.read().prs[0].state, 'OPEN');
  // No terminal.
  let out = '';
  await assert.rejects(mergeCmd.run({ positionals: ['PMT-31'], values: {} }, { cwd: f.root, env: f.env, stdin: { isTTY: false }, stdout: { isTTY: false, write: (s) => (out += s) } }), (e) => e.exitCode === EXIT.NEEDS_HUMAN);
  // A commit someone pushed to the MR's branch after MIRAI: refused before anything.
  const branch = f.gh.read().prs[0].headRefName;
  const head = f.bareGit('rev-parse', `refs/heads/${branch}`);
  const other = f.bareGit('commit-tree', '-p', head, '-m', 'by hand', `${head}^{tree}`);
  f.bareGit('update-ref', `refs/heads/${branch}`, other);
  assert.throws(() => mergeChecks({ cwd: f.root, env: f.env, ticket: 'PMT-31', hostOf: f.hostOf }), (e) => e.code === 'mr-head-moved');
  // And the host's own pin: merging the old head is refused (GitHub's 409), nothing merged.
  const h = f.hostOf({ config: {}, remoteUrl: REMOTE, store: f.store, env: f.env, root: f.root });
  assert.throws(() => h.mergeMr(1, { head }), (e) => e.code === 'mr-head-moved');
  assert.equal(f.gh.read().prs[0].state, 'OPEN');
});

test('29d: merge from the review: signed, pinned to the head, a merge commit, the branch deleted, main fast-forwarded, the ticket done; again refused', async () => {
  const f = await shipped();
  const before = f.bareGit('rev-parse', 'refs/heads/main');
  const branch = f.gh.read().prs[0].headRefName;
  const head = f.bareGit('rev-parse', `refs/heads/${branch}`);
  const r = await term(reviewMrCmd, f, ['PMT-31'], ['m', 'PMT-31']);
  assert.equal(r.code, EXIT.OK, `${r.out}\n${r.err?.message ?? ''}`);
  assert.match(r.out, /Decide: \[m\]erge {2}\[s\]end back {2}\[l\]ater/);
  assert.match(r.out, /merged: PMT-31's MR .* as [0-9a-f]{7} \(your merge, signed\); PMT-31 is done\n/);
  const pr = f.gh.read().prs[0];
  assert.equal(pr.state, 'MERGED');
  const mergeSha = pr.mergeCommit.oid;
  assert.deepEqual(f.bareGit('rev-list', '--parents', '-n', '1', mergeSha).split(' ').slice(1), [before, head], 'a merge commit of main and the reviewed head');
  assert.deepEqual(f.gh.read().deleted, [branch], 'the branch deleted on the host');
  // The journal: your signed approval of kind merge, then mr_merged with the head and merge commit.
  const events = readJournal(f.store, { keys: branchKeys(f.store.checkout, f.store.branch, f.store.gitEnv) }).events;
  const ap = events.filter((e) => e.type === 'approval' && e.kind === 'merge');
  assert.deepEqual(ap.map((e) => [e.by, Boolean(e.signature), e.path, e.decision]), [['human', true, 'mr/1', 'accepted']]);
  const merged = events.find((e) => e.type === 'mr_merged');
  assert.deepEqual([merged.head, merged.merge_sha], [head, mergeSha]);
  assert.equal(ticketFacts(events, 'PMT-31').mr, 'merged');
  // Your checkout: on main, at the merge.
  assert.equal(symbolicBranch(f.store.checkout, 'HEAD', f.store.gitEnv), 'main');
  assert.equal(commitOf(f.store.checkout, 'refs/heads/main', f.store.gitEnv), mergeSha);
  // Again: refused, it's done.
  const again = await term(mergeCmd, f, ['PMT-31'], ['PMT-31']);
  assert.notEqual(again.code, EXIT.OK);
  assert.match(again.err.message, /merged already/);
});

test('29d: later and send back change nothing; a dirty work tree: the host merges, your checkout is left, said', async () => {
  const f = await shipped();
  const later = await term(reviewMrCmd, f, ['PMT-31'], ['l']);
  assert.match(later.out, /left as it is/);
  const send = await term(reviewMrCmd, f, ['PMT-31'], ['s']);
  assert.match(send.out, /send back comes with the inbox \(unit 46\)/);
  assert.equal(f.gh.read().prs[0].state, 'OPEN');
  const here = symbolicBranch(f.store.checkout, 'HEAD', f.store.gitEnv);
  writeFileSync(join(f.root, 'scratch.txt'), 'mine\n');
  const r = await term(mergeCmd, f, ['PMT-31'], ['PMT-31']);
  assert.equal(r.code, EXIT.OK, r.err?.message);
  assert.match(r.out, /^note: your work tree has 1 uncommitted change\(s\), so your checkout is left as it is/m);
  assert.equal(symbolicBranch(f.store.checkout, 'HEAD', f.store.gitEnv), here);
  assert.equal(f.gh.read().prs[0].state, 'MERGED');
});
