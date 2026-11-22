import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { REGISTRY_DIR } from '../../src/cli/commands/lint.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { main } from '../../src/cli/main.js';
import { init } from '../../src/install/init.js';
import { hostFor, TOOLS_FILE } from '../../src/ship/host.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { docsMerge, docsPublish } from '../../src/store/connectors/publish.js';
import { gitIn, tempDir } from '../tests/run-fixture.js';
import { passReader } from '../helpers/reader.js';
import { fakeGh, fakeGlab } from '../helpers/fake-hosts.js';
import { BRIEF_READY, INTERVIEW, PRD_READY } from '../helpers/docs-fixtures.js';

// Unit 38 T4–T6, T8: the docs merge request of the repo store, through stand-in gh and glab over a
// local bare repo. Publish commits only the initiative's folder on docs/<initiative>, pushes it and
// opens one merge request; MIRAI merges it only after your signed approvals (the brief, the PRD,
// the epic over its tickets), pinned to the head it checked.

const read = (rel) => readFileSync(join(REGISTRY_DIR, rel), 'utf8');
const EPIC = read('examples/epic.md');
const TICKETS = Object.fromEntries(readdirSync(join(REGISTRY_DIR, 'examples', 'tickets')).sort().map((f) => [`tickets/${f}`, read(`examples/tickets/${f}`)]));
const D = 'docs/mirai/due-dates';
const REMOTES = { github: 'https://github.com/acme/app.git', gitlab: 'https://gitlab.com/acme/app.git' };

// A repo with a remote on the host, MIRAI installed, your key and your git name, the integration
// branch on the host (a bare repo), and the due-dates initiative written (not committed) in the
// docs root.
function project(hostName, { env: extraEnv = {} } = {}) {
  const root = join(tempDir('repo'), 'r');
  mkdirSync(root);
  const home = tempDir('home');
  const git = gitIn(root, home);
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', REMOTES[hostName]);
  writeFileSync(join(root, 'README.md'), '# r\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  const env = { PATH: '/usr/bin:/bin', HOME: home, ...extraEnv };
  init({ cwd: root, env, branch: 'main' });
  const key = createKeyPair(env);
  writePublicKeyFile(root, key.keyId, key.publicPem);
  git('add', '-A');
  git('commit', '-qm', 'mirai');
  mkdirSync(join(home, '.config', 'mirai'), { recursive: true });
  writeFileSync(join(home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "Test Author"\nauthor_email = "author@example.com"\n', { mode: 0o600 });
  const bare = join(tempDir('host'), 'app.git');
  execFileSync('/usr/bin/git', ['init', '-q', '--bare', '-b', 'main', bare]);
  git('push', '-q', bare, 'main');
  const host = hostName === 'github' ? fakeGh(bare) : fakeGlab(bare);
  const store = openStore({ cwd: root, env });
  writeFileSync(join(store.dir, TOOLS_FILE), JSON.stringify({ schema_version: 1, [hostName]: host.path }));
  const hostOf = (a) => {
    const h = hostFor(a);
    return Object.defineProperties({ ...h, pushUrl: bare }, { ca: { get: () => h.ca } });
  };
  const files = { 'brief.md': BRIEF_READY, 'interview.md': INTERVIEW, 'prd.md': PRD_READY, 'epic-due-dates.md': EPIC, ...TICKETS };
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(root, D, p, '..'), { recursive: true });
    writeFileSync(join(root, D, p), text);
  }
  const bareGit = (...a) => execFileSync('/usr/bin/git', ['--git-dir', bare, ...a]).toString().trim();
  const io = { cwd: root, env };
  const run = async (argv, answers = []) => {
    let out = '';
    let err = '';
    const stdin = Readable.from([`${answers.join('\n')}\n`]);
    stdin.isTTY = true;
    const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd: root, hostOf });
    return { code, out, err };
  };
  const publish = () => docsPublish({ cwd: root, env, initiative: 'due-dates', hostOf });
  const merge = () => docsMerge({ cwd: root, env, initiative: 'due-dates', hostOf });
  const at = (rel) => join(root, D, rel);
  // Your approvals, signed: the PRD with its brief (one decision), then the epic with its tickets.
  const approvePrd = async () => {
    await passReader({ root, env }, `${D}/prd.md`);
    const r = await run(['approve', 'due-dates-prd', '--file', `${D}/prd.md`], ['a', 'due-dates-prd']);
    assert.equal(r.code, EXIT.OK, r.err);
    return r;
  };
  const approveEpic = async () => {
    await passReader({ root, env }, `${D}/epic-due-dates.md`);
    const r = await run(['approve', 'SAMPLE-50', '--file', `${D}/epic-due-dates.md`], ['a', 'SAMPLE-50']);
    assert.equal(r.code, EXIT.OK, r.err);
    return r;
  };
  return { root, home, env, git, bare, bareGit, host, store, io, run, publish, merge, at, approvePrd, approveEpic, hostOf };
}

const refused = async (fn, code) => {
  try {
    await fn();
  } catch (err) {
    assert.equal(err.code, code, err.message);
    return err;
  }
  return assert.fail(`expected ${code}`);
};
// A commit on a branch, made with plain git and a private index (a teammate's code on the docs branch).
function commitOnBranch(p, branch, path, text) {
  const index = join(tempDir('index'), 'index');
  const g = (args, input) => execFileSync('/usr/bin/git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: p.root, env: { PATH: '/usr/bin:/bin', HOME: p.home, GIT_INDEX_FILE: index, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, input }).toString().trim();
  g(['read-tree', branch]);
  const blob = g(['hash-object', '-w', '--stdin'], text);
  g(['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`]);
  const sha = g(['commit-tree', g(['write-tree']), '-p', branch, '-m', 'code on the docs branch']);
  g(['update-ref', `refs/heads/${branch}`, sha]);
  return sha;
}

test('38 T4: the first publish makes docs/<initiative> from the integration branch with only that folder, pushes it and opens one merge request; a second updates it; a code path is refused before the push', async () => {
  const p = project('github');
  const first = await p.publish();
  assert.equal(first.outcome, 'opened');
  assert.equal(first.branch, 'docs/due-dates');
  assert.equal(first.pushed, true);
  assert.equal(p.bareGit('rev-parse', 'refs/heads/docs/due-dates'), first.head);
  assert.equal(p.bareGit('rev-parse', `${first.head}^`), p.bareGit('rev-parse', 'refs/heads/main'), 'made from the integration branch');
  const changed = p.bareGit('diff', '--name-only', 'main', first.head).split('\n');
  assert.equal(changed.length, 4 + Object.keys(TICKETS).length);
  assert.ok(changed.every((n) => n.startsWith(`${D}/`)), changed.join(', '));
  // The commit: author you, committer MIRAI; your work tree and branch untouched.
  assert.equal(p.bareGit('log', '-1', '--format=%an <%ae> / %cn', first.head), 'Test Author <author@example.com> / MIRAI');
  assert.equal(p.git('rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.equal(p.git('status', '--porcelain'), '?? docs/');
  // One merge request, its description naming each document with its approval state.
  const prs = p.host.read().prs;
  assert.equal(prs.length, 1);
  assert.equal(prs[0].title, 'Docs: due-dates');
  assert.match(prs[0].body, /\| `docs\/mirai\/due-dates\/prd\.md` \| prd \| due-dates-prd \| not approved \|/);
  assert.match(prs[0].body, /\| `docs\/mirai\/due-dates\/tickets\/SAMPLE-51\.md` \| ticket \| — \| with its epic \|/);
  const e = readJournal(p.store).events.filter((x) => x.type === 'docs_published').at(-1);
  assert.deepEqual([e.item, e.branch, e.head, e.number, e.url], ['due-dates', 'docs/due-dates', first.head, 1, 'https://github.com/acme/app/pull/1']);
  assert.ok(e.files.some((f) => f.path === `${D}/prd.md` && /^sha256:/.test(f.content_hash)));

  // A second publish after an edit: the same branch, one commit on top, the same merge request.
  writeFileSync(p.at('prd.md'), PRD_READY.replace('# Tasks with due dates', '# Tasks with due dates,'));
  const second = await p.publish();
  assert.equal(second.outcome, 'updated');
  assert.equal(second.mr.number, 1);
  assert.equal(p.bareGit('rev-parse', `${second.head}^`), first.head);
  assert.equal(p.host.read().prs.length, 1);
  assert.equal((await p.publish()).outcome, 'unchanged');

  // A teammate's code on the docs branch: refused before the push, naming the path.
  const before = p.bareGit('rev-parse', 'refs/heads/docs/due-dates');
  commitOnBranch(p, 'docs/due-dates', 'src/app.js', 'console.log(1);\n');
  writeFileSync(p.at('prd.md'), PRD_READY);
  const err = await refused(() => p.publish(), 'not-docs-only');
  assert.match(err.message, /a docs merge request carries documents only, and docs\/due-dates changes 1 path outside docs\/mirai\/due-dates\/: src\/app\.js; nothing was pushed/);
  assert.deepEqual(err.paths, ['src/app.js']);
  assert.equal(p.bareGit('rev-parse', 'refs/heads/docs/due-dates'), before, 'nothing left the machine');
});

test('38 T5 and T8 (GitHub): docs merge refuses each gap with nothing merged, waits for the host, then merges at the checked head; every line ends with the full path and, once pushed, the GitHub link', async () => {
  const p = project('github');
  const pub = await p.run(['docs', 'publish', 'due-dates']);
  assert.equal(pub.code, EXIT.OK, pub.err);
  // T8: each document's full path and its link on the docs branch; the folder last.
  const prdAbs = p.at('prd.md');
  assert.ok(pub.out.includes(`${prdAbs}   https://github.com/acme/app/blob/docs/due-dates/${D}/prd.md\n`), pub.out);
  assert.equal(pub.out.trimEnd().split('\n').at(-1), `${join(p.root, D)}   https://github.com/acme/app/tree/docs/due-dates/${D}`);
  const mergeSha = () => p.bareGit('rev-parse', 'refs/heads/main');
  const main0 = mergeSha();

  // No approvals: every document named, and no ticket-set approval.
  let err = await refused(() => p.merge(), 'docs-gaps');
  let gaps = err.gaps.map((g) => `${g.path}: ${g.gap}`).join('\n');
  assert.match(gaps, /no ticket-set approval/);
  assert.match(gaps, /docs\/mirai\/due-dates\/prd\.md: a missing approval: the prd due-dates-prd has none/);
  assert.match(gaps, /docs\/mirai\/due-dates\/brief\.md: a missing approval: the brief due-dates-brief has none/);
  assert.match(gaps, /docs\/mirai\/due-dates\/epic-due-dates\.md: a missing approval: the epic SAMPLE-50 has none/);
  assert.equal(mergeSha(), main0);
  // Through the CLI: the gaps listed, exit 4.
  const cli = await p.run(['docs', 'merge', 'due-dates']);
  assert.equal(cli.code, EXIT.BLOCKED);
  assert.match(cli.err, /^docs\/mirai\/due-dates\/prd\.md: a missing approval: the prd due-dates-prd has none\n {2}mirai approve due-dates-prd --file docs\/mirai\/due-dates\/prd\.md$/m);

  // The PRD and its brief approved (T8: approve's last line is the PRD's path and its link, since
  // the docs branch holds these bytes); the epic not yet: no ticket-set approval.
  const prdOk = await p.approvePrd();
  assert.equal(prdOk.out.trimEnd().split('\n').at(-1), `${prdAbs}   https://github.com/acme/app/blob/docs/due-dates/${D}/prd.md`);
  err = await refused(() => p.merge(), 'docs-gaps');
  gaps = err.gaps.map((g) => `${g.path}: ${g.gap}`).join('\n');
  assert.doesNotMatch(gaps, /prd\.md: a missing approval/);
  assert.match(gaps, /epic-due-dates\.md: a missing approval: the epic SAMPLE-50 has none/);
  assert.match(gaps, /no ticket-set approval/);
  assert.equal(mergeSha(), main0);

  // The epic approved with its tickets; then a ticket changed after it and published: refused.
  await p.approveEpic();
  const ticket = p.at('tickets/SAMPLE-55.md');
  writeFileSync(ticket, TICKETS['tickets/SAMPLE-55.md'].replace('size: S', 'size: M'));
  await p.publish();
  err = await refused(() => p.merge(), 'docs-gaps');
  assert.match(err.gaps.map((g) => `${g.path}: ${g.gap}`).join('\n'), /changed after its approval: it was signed with the epic SAMPLE-50, and isn't that file now/);
  assert.equal(mergeSha(), main0);
  writeFileSync(ticket, TICKETS['tickets/SAMPLE-55.md']);

  // A lint error: a stray file with no frontmatter in the folder.
  writeFileSync(p.at('notes.md'), '# notes\n');
  await p.publish();
  err = await refused(() => p.merge(), 'docs-gaps');
  assert.match(err.gaps.map((g) => `${g.path}: ${g.gap}`).join('\n'), /notes\.md:1: a lint error: /);
  assert.equal(mergeSha(), main0);
  execFileSync('/bin/rm', [p.at('notes.md')]);
  const clean = await p.publish();

  // A head that moved: someone pushed to the docs branch after MIRAI's publish.
  const pushedBySomeone = p.bareGit('commit-tree', '-p', clean.head, '-m', 'someone', `${clean.head}^{tree}`);
  p.bareGit('update-ref', 'refs/heads/docs/due-dates', pushedBySomeone);
  err = await refused(() => p.merge(), 'mr-head-moved');
  assert.match(err.message, /the docs merge request's head moved since MIRAI published it .*; nothing was merged/);
  assert.equal(mergeSha(), main0);
  p.bareGit('update-ref', 'refs/heads/docs/due-dates', clean.head);

  // The host holds it: checks running. MIRAI says what it waits for and leaves it open.
  p.host.write((s) => { s.ci = [{ name: 'docs-ci', status: 'in_progress', conclusion: null }]; });
  const waiting = await p.run(['docs', 'merge', 'due-dates']);
  assert.equal(waiting.code, EXIT.BLOCKED);
  assert.match(waiting.out, /waiting for: its checks are still running \(docs-ci\)\n {2}the merge request stays open/);
  assert.equal(mergeSha(), main0);
  // A required review holds it too.
  p.host.write((s) => { s.ci = []; s.mergeable = false; s.mergeableState = 'blocked'; });
  assert.match((await p.merge()).waitingFor, /a branch rule blocks it \(a review or a check it requires\)/);

  // A later run merges it at the checked head.
  p.host.write((s) => { s.ci = [{ name: 'docs-ci', status: 'completed', conclusion: 'success' }]; s.mergeable = true; s.mergeableState = 'clean'; });
  const done = await p.run(['docs', 'merge', 'due-dates']);
  assert.equal(done.code, EXIT.OK, done.err);
  assert.match(done.out, /^docs merge due-dates: merged https:\/\/github\.com\/acme\/app\/pull\/1 at [0-9a-f]{12} as [0-9a-f]{12} into main$/m);
  assert.ok(done.out.includes(`${prdAbs}   https://github.com/acme/app/blob/main/${D}/prd.md\n`), done.out);
  assert.notEqual(mergeSha(), main0);
  assert.equal(p.bareGit('show', `main:${D}/prd.md`), PRD_READY.trimEnd());
  const merged = readJournal(p.store).events.filter((x) => x.type === 'docs_merged');
  assert.deepEqual(merged.map((x) => [x.item, x.number, x.head, x.merge_sha]), [['due-dates', 1, clean.head, mergeSha()]]);
  // mirai show gives each document's link on main now.
  const show = await p.run(['show', 'due-dates']);
  assert.ok(show.out.split('\n').some((l) => /^ {2}prd\.md +prd +due-dates-prd +approved +/.test(l) && l.endsWith(`${prdAbs}   https://github.com/acme/app/blob/main/${D}/prd.md`)), show.out);
  assert.equal((await p.merge()).outcome, 'already-merged');
});

test('38 T6: GitLab: publish, update, the code-path refusal and the merge run through glab, every call with the GLAB_CONFIG_DIR given', async () => {
  const personal = join(tempDir('glab-personal'), 'glab-personal');
  mkdirSync(personal);
  const p = project('gitlab', { env: { GLAB_CONFIG_DIR: personal } });
  await p.approvePrd();
  await p.approveEpic();
  const first = await p.publish();
  assert.equal(first.outcome, 'opened');
  assert.equal(first.mr.url, 'https://gitlab.com/acme/app/-/merge_requests/1');
  writeFileSync(p.at('prd.md'), `${PRD_READY}\n`);
  assert.equal((await p.publish()).outcome, 'updated');
  assert.equal(p.host.read().mrs.length, 1);
  // A code path on the docs branch: refused before the push; the branch put back after.
  const kept = p.git('rev-parse', 'refs/heads/docs/due-dates');
  commitOnBranch(p, 'docs/due-dates', 'src/app.js', 'x\n');
  assert.match((await refused(() => p.publish(), 'not-docs-only')).message, /outside docs\/mirai\/due-dates\/: src\/app\.js; nothing was pushed/);
  p.git('update-ref', 'refs/heads/docs/due-dates', kept);
  // Changed after its approval: refused.
  assert.match((await refused(() => p.merge(), 'docs-gaps')).gaps.map((g) => g.gap).join('\n'), /changed after its approval: the prd due-dates-prd isn't the file you approved/);
  writeFileSync(p.at('prd.md'), PRD_READY);
  const pub = await p.run(['docs', 'publish', 'due-dates']);
  assert.equal(pub.code, EXIT.OK, pub.err);
  assert.ok(pub.out.includes(`${p.at('prd.md')}   https://gitlab.com/acme/app/-/blob/docs/due-dates/${D}/prd.md\n`), pub.out);
  assert.equal(pub.out.trimEnd().split('\n').at(-1), `${join(p.root, D)}   https://gitlab.com/acme/app/-/tree/docs/due-dates/${D}`);
  // Pipeline running: waiting; then merged.
  p.host.write((s) => { s.pipeline = 'running'; });
  assert.equal((await p.merge()).outcome, 'waiting');
  p.host.write((s) => { s.pipeline = 'success'; });
  const done = await p.merge();
  assert.equal(done.outcome, 'merged');
  assert.equal(p.bareGit('show', `main:${D}/prd.md`), PRD_READY.trimEnd());
  // Every glab call had the GLAB_CONFIG_DIR given, never glab's default config folder.
  const calls = p.host.read().calls;
  assert.ok(calls.length > 10);
  for (const c of calls) assert.equal(c.env.GLAB_CONFIG_DIR, personal, c.args.join(' '));
  assert.ok(calls.every((c) => !String(c.env.GLAB_CONFIG_DIR).includes('Library/Application Support/glab-cli')));
});
