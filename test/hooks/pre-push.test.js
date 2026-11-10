import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { setUpHooks } from '../../src/cli/commands/init.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { hooksDir, hooksState, requireHooks } from '../../src/hooks/install.js';
import { parseUpdates, prePushCheck, trailerValues } from '../../src/hooks/pre-push.js';
import { parseLog } from '../../src/hooks/secrets.js';
import { PACKAGE_ROOT } from '../../src/install/parts.js';
import { openStore } from '../../src/store/home.js';
import { COV_CONFIG, TOKEN, coveringRun, passed } from '../proofs/fixture.js';
import { installed, tempDir } from '../tests/run-fixture.js';

// Unit 26a: MIRAI's pre-push hook, through real `git push`es to a bare repo (no model, no Docker,
// no network). The push goes to the bare repo's path, so the repo keeps no remote (its id, and so
// its store, stay as they were).

const LAUNCHER = join(PACKAGE_ROOT, 'bin', 'launch.js');
const AWS = `AKIA${'Q7'.repeat(8)}`;
const gitEnv = (home) => ({ PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
const quiet = (env, cwd, extra = {}) => ({ cwd, env, stdout: { write: () => {} }, stderr: { write: () => {} }, ...extra });

// A bare repo with main pushed (before any hook), and MIRAI's hooks installed.
async function withRemote(f, { forwardAnswer = null } = {}) {
  const bare = join(tempDir('bare'), 'b.git');
  execFileSync('/usr/bin/git', ['init', '-q', '--bare', bare]);
  f.git('push', '-q', bare, 'main');
  let io = quiet(f.env, f.root);
  if (forwardAnswer !== null) {
    const stdin = Readable.from([`${forwardAnswer}\n`]);
    stdin.isTTY = true;
    io = { ...io, stdin, stdout: { isTTY: true, write: () => {} } };
  }
  const h = await setUpHooks(io, f.root, { node: process.execPath, launcher: LAUNCHER });
  const push = (...args) => {
    const r = spawnSync('/usr/bin/git', ['push', bare, ...args], { cwd: f.root, env: gitEnv(f.home), encoding: 'utf8' });
    return { code: r.status, err: `${r.stderr}${r.stdout}` };
  };
  return { ...f, bare, hooks: h, push };
}

test('26a: the pieces: git\'s stdin lines, trailers, the log parser', () => {
  const z = '0'.repeat(40);
  const a = 'a'.repeat(40);
  assert.deepEqual(parseUpdates(`refs/heads/x ${a} refs/heads/x ${z}\n`), [{ localRef: 'refs/heads/x', localSha: a, remoteRef: 'refs/heads/x', remoteSha: z }]);
  assert.throws(() => parseUpdates('refs/heads/x nope refs/heads/x nope\n'));
  assert.deepEqual(trailerValues('S\n\nbody\n\nMirai-Ticket: PMT-1\n', 'Mirai-Ticket'), ['PMT-1']);
  assert.deepEqual(trailerValues('S\n\nMirai-Ticket: PMT-1\n\nlast paragraph\n', 'Mirai-Ticket'), [], 'only the last paragraph holds trailers');
  const m = 'MIRAI-SCAN-0123456789abcdef';
  const log = [`${m} ${a}`, 'subject', '', 'body', m, '', 'diff --git a/f.txt b/f.txt', 'index 1..2 100644', '--- a/f.txt', '+++ b/f.txt', '@@ -1 +1 @@', '-old', '+new', '+++not a header', 'diff --git a/g b/g', 'deleted file mode 100644', '--- a/g', '+++ /dev/null', '@@ -1 +0,0 @@', '-gone'].join('\n');
  const [c] = parseLog(log, m);
  assert.equal(c.sha, a);
  assert.equal(c.message, 'subject\n\nbody');
  assert.deepEqual([...c.added], [['f.txt', ['new', '++not a header']]]);
});

test('26a: a MIRAI branch with its proofs pushes; after a code change it\'s stale; a commit without the trailer is a mix; a merge commit is refused', async () => {
  const f0 = await passed();
  const rec = await f0.record();
  assert.equal(rec.outcome, 'recorded', rec.why);
  const f = await withRemote(f0);
  assert.equal(f.hooks.installed, true);
  const branch = f.git('rev-parse', '--abbrev-ref', 'HEAD');
  const tip = f.git('rev-parse', 'HEAD');
  let r = f.push(branch);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /mirai pre-push: .*: pass: PMT-31: the review and gate proofs match/);
  // Unit 26b: the gate proof's diff coverage (no level here measures app/Team.php).
  assert.match(r.err, /diff coverage: no changed lines to measure/);

  // A code change after the proofs, made as MIRAI would (its trailer): stale.
  writeFileSync(join(f.root, 'app/Team.php'), `${readFileSync(join(f.root, 'app/Team.php'), 'utf8')}// more\n`);
  f.git('commit', '-qam', 'more\n\nMirai-Ticket: PMT-31');
  r = f.push(branch);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /blocked \(stale\)/);
  assert.match(r.err, /mirai gate record PMT-31/);

  // A commit without the trailer: a mix (whatever the proofs say).
  f.git('reset', '-q', '--hard', tip);
  writeFileSync(join(f.root, 'notes.txt'), 'by hand\n');
  f.git('add', 'notes.txt');
  f.git('commit', '-qm', 'by hand');
  r = f.push(branch);
  assert.match(r.err, /blocked \(trailer-mix\)/);
  assert.notEqual(r.code, 0);

  // A merge commit: refused.
  f.git('reset', '-q', '--hard', tip);
  f.git('checkout', '-q', '-b', 'side', 'main');
  writeFileSync(join(f.root, 'side.txt'), 'side\n');
  f.git('add', 'side.txt');
  f.git('commit', '-qm', 'side\n\nMirai-Ticket: PMT-31');
  f.git('checkout', '-q', branch);
  f.git('merge', '-q', '--no-ff', '-m', 'merge\n\nMirai-Ticket: PMT-31', 'side');
  r = f.push(branch);
  assert.match(r.err, /blocked \(merge-commit\)/);
  f.git('reset', '-q', '--hard', tip);

  // Deleting a branch passes; pushing main ahead of the remote passes (only the scan).
  assert.equal(f.push(`:${branch}`).code, 0);
  f.git('checkout', '-q', 'main');
  writeFileSync(join(f.root, 'README.md'), '# r\n\nmore\n');
  f.git('commit', '-qam', 'readme');
  r = f.push('main');
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /main: pass: the integration branch/);
});

test('26a: no proofs → no-proof; the registry lost → blocked; a human branch passes, built on merged MIRAI work too', async () => {
  const f0 = await passed();
  const f = await withRemote(f0);
  const branch = f.git('rev-parse', '--abbrev-ref', 'HEAD');
  let r = f.push(branch);
  assert.match(r.err, /blocked \(no-proof\)/);
  assert.notEqual(r.code, 0);

  // A human branch from main: pushes.
  f.git('checkout', '-q', '-b', 'human', 'main');
  writeFileSync(join(f.root, 'h.txt'), 'h\n');
  f.git('add', 'h.txt');
  f.git('commit', '-qm', 'human work');
  r = f.push('human');
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /human: pass: a human branch/);

  // Merge the MIRAI branch into main (your merge), then a human branch on top: still human.
  f.git('checkout', '-q', 'main');
  f.git('merge', '-q', '--ff-only', branch);
  f.git('checkout', '-q', '-b', 'human2');
  writeFileSync(join(f.root, 'h2.txt'), 'h2\n');
  f.git('add', 'h2.txt');
  f.git('commit', '-qm', 'more human work');
  r = f.push('human2');
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /human2: pass: a human branch/);

  // The registry lost: a trailer branch is blocked (fail closed), a human one isn't.
  rmSync(join(openStore(f.io).dir, 'branches.json'));
  // A MIRAI-looking branch (a trailer commit of its own) next to main.
  f.git('checkout', '-q', '-b', 'mirai-like', 'main');
  writeFileSync(join(f.root, 'm.txt'), 'm\n');
  f.git('add', 'm.txt');
  f.git('commit', '-qm', 'm\n\nMirai-Ticket: PMT-31');
  r = f.push('mirai-like');
  assert.match(r.err, /blocked \(registry\)/);
  r = f.push('human');
  assert.equal(r.code, 0, r.err);
});

test('26a: the secret scan blocks on every branch: a cloud key, the token in its encodings, in a message, in history; a removed line passes', async () => {
  const f0 = await passed();
  const f = await withRemote(f0);
  const fresh = (name) => {
    f.git('checkout', '-q', '-B', name, 'main');
  };
  const commit = (path, text, message = 'work') => {
    mkdirSync(join(f.root, path, '..'), { recursive: true });
    writeFileSync(join(f.root, path), text);
    f.git('add', '-A');
    f.git('commit', '-qm', message);
  };
  fresh('s1');
  commit('config/keys.txt', `aws = "${AWS}"\n`);
  let r = f.push('s1');
  assert.match(r.err, /blocked \(secret\): a secret \(aws-access-key\) in config\/keys\.txt/);
  assert.ok(!r.err.includes(AWS), 'the value is never printed');
  for (const [i, form] of [TOKEN, Buffer.from(TOKEN).toString('base64'), Buffer.from(TOKEN).toString('base64url'), Buffer.from(TOKEN).toString('hex'), [...TOKEN].reverse().join('')].entries()) {
    fresh(`t${i}`);
    commit('t.txt', `x = "${form}"\n`);
    r = f.push(`t${i}`);
    assert.match(r.err, /blocked \(secret\): a secret \(claude-login-token\)/, `form ${i}`);
    assert.ok(!r.err.includes(TOKEN.slice(15, 40)));
  }
  fresh('msg');
  commit('m.txt', 'm\n', `oops ${AWS}`);
  r = f.push('msg');
  assert.match(r.err, /blocked \(secret\): a secret \(aws-access-key\) in the message of/);
  // Added, then removed: the history carries it.
  fresh('hist');
  commit('h.txt', `${AWS}\n`);
  commit('h.txt', 'clean\n');
  r = f.push('hist');
  assert.match(r.err, /blocked \(secret\)/);
  // A binary file holding the token.
  fresh('bin');
  commit('blob.bin', Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(TOKEN), Buffer.from([0])]));
  r = f.push('bin');
  assert.match(r.err, /blocked \(secret\): a secret \(claude-login-token\) in blob\.bin/);
  // A secret only in a line a commit removes (it's on main already): passes.
  f.git('checkout', '-q', 'main');
  commit('old.txt', `${AWS}\n`);
  f.git('push', '-q', '--no-verify', f.bare, 'main');
  fresh('rm');
  commit('old.txt', 'gone\n');
  r = f.push('rm');
  assert.equal(r.code, 0, r.err);
});

test('26a: an edited hook blocks the push; core.hooksPath off is hooks-off for build; a missing launcher refuses with --no-verify', async () => {
  const f0 = await passed();
  const f = await withRemote(f0);
  const store = openStore(f.io);
  assert.equal(hooksState({ store, env: f.env }).state, 'ok');
  f.git('checkout', '-q', '-b', 'h', 'main');
  writeFileSync(join(f.root, 'h.txt'), 'h\n');
  f.git('add', 'h.txt');
  f.git('commit', '-qm', 'h');
  appendFileSync(join(hooksDir(store), 'pre-push'), '# edited\n');
  let r = f.push('h');
  assert.match(r.err, /blocked \(hooks-changed\): MIRAI's hooks folder isn't as MIRAI wrote it: pre-push was changed/);
  assert.notEqual(r.code, 0);
  writeFileSync(join(hooksDir(store), 'extra'), '#!/bin/sh\n', { mode: 0o755 });
  assert.match(hooksState({ store, env: f.env }).why, /extra was added/);
  // Unset: git runs no hook at all, and MIRAI won't start agents.
  f.git('config', '--unset', 'core.hooksPath');
  assert.equal(hooksState({ store, env: f.env }).state, 'off');
  assert.throws(() => requireHooks({ store, env: f.env }), (e) => e.code === 'hooks-off');
  // Installed again with a launcher that's gone: the push is refused, and says how to push anyway.
  await setUpHooks(quiet(f.env, f.root), f.root, { node: process.execPath, launcher: '/nonexistent/mirai/bin/launch.js' });
  r = f.push('h');
  assert.notEqual(r.code, 0);
  // The store gone: the launcher refuses, with the --no-verify note.
  await setUpHooks(quiet(f.env, f.root), f.root, { node: process.execPath, launcher: LAUNCHER });
  assert.equal(f.push('h').code, 0);
  // (Deleting the whole MIRAI home would take the hook script with it: git then runs no hook. A
  // known limit; build refuses with hooks-off.)
  rmSync(join(store.repoHome, 'store.json'));
  r = f.push('h');
  assert.notEqual(r.code, 0);
  assert.match(r.err, /git push --no-verify/);
});

test('26a: the repo\'s own hooks are forwarded after a yes, and its pre-push runs first', async () => {
  const f = installed();
  const marks = tempDir('marks');
  const hooks = join(f.root, '.git', 'hooks');
  writeFileSync(join(hooks, 'pre-commit'), `#!/bin/sh\necho ran >> '${marks}/pre-commit'\n`, { mode: 0o755 });
  writeFileSync(join(hooks, 'pre-push'), `#!/bin/sh\ncat > '${marks}/pre-push.in'\nexit "$(cat '${marks}/code' 2>/dev/null || echo 0)"\n`, { mode: 0o755 });
  chmodSync(join(hooks, 'pre-push'), 0o755);
  // No terminal: not installed, and said so.
  const none = await setUpHooks(quiet(f.env, f.root), f.root, { node: process.execPath, launcher: LAUNCHER });
  assert.equal(none.installed, false);
  assert.match(none.why, /pre-commit, pre-push/);
  // A no: not installed.
  const g = await withRemote(f, { forwardAnswer: 'no' });
  assert.equal(g.hooks.installed, false);
  // A yes: forwarded.
  const h = await withRemote(f, { forwardAnswer: 'yes' });
  assert.equal(h.hooks.installed, true);
  assert.deepEqual(h.hooks.forwarded, ['pre-commit', 'pre-push']);
  writeFileSync(join(f.root, 'x.txt'), 'x\n');
  f.git('add', 'x.txt');
  f.git('-c', 'core.hooksPath=' + hooksDir(openStore({ cwd: f.root, env: f.env })), 'commit', '-qm', 'x');
  assert.equal(readFileSync(join(marks, 'pre-commit'), 'utf8'), 'ran\n');
  f.git('checkout', '-q', '-b', 'human');
  let r = h.push('human');
  assert.equal(r.code, 0, r.err);
  assert.match(readFileSync(join(marks, 'pre-push.in'), 'utf8'), /^refs\/heads\/human [0-9a-f]{40} refs\/heads\/human 0{40}\n$/);
  writeFileSync(join(marks, 'code'), '1');
  f.git('commit', '-q', '--allow-empty', '-m', 'y');
  r = h.push('human');
  assert.notEqual(r.code, 0);
  assert.match(r.err, /your own pre-push .* refused the push/);
  // A refresh with the same hooks doesn't ask again.
  const again = await setUpHooks(quiet(f.env, f.root), f.root, { node: process.execPath, launcher: LAUNCHER });
  assert.equal(again.installed, true);
  assert.deepEqual(again.forwarded, ['pre-commit', 'pre-push']);
});

test('26a: the commits a push adds are the ones the remote\'s tracking refs don\'t reach', async () => {
  const f0 = await passed();
  const f = await withRemote(f0);
  f.git('checkout', '-q', '-b', 'k', 'main');
  writeFileSync(join(f.root, 'k.txt'), `${AWS}\n`);
  f.git('add', 'k.txt');
  f.git('commit', '-qm', 'k');
  const sha = f.git('rev-parse', 'HEAD');
  const z = '0'.repeat(40);
  const updates = [{ localRef: 'refs/heads/k', localSha: sha, remoteRef: 'refs/heads/k', remoteSha: z }];
  assert.equal(prePushCheck({ cwd: f.root, env: f.env, remote: 'bk', updates }).refs[0].outcome, 'secret');
  // The remote already has that commit (its tracking ref): nothing new to scan.
  f.git('update-ref', 'refs/remotes/bk/k', sha);
  const r = prePushCheck({ cwd: f.root, env: f.env, remote: 'bk', updates });
  assert.equal(r.refs[0].outcome, 'pass', r.refs[0].why);
  assert.equal(EXIT.OK, 0);
});

test('26b: the push warns from the gate proof\'s diff coverage, and still pushes', async () => {
  const f0 = await passed({ config: COV_CONFIG });
  const rec = await f0.record({ run: coveringRun({ unit: { 'app/Team.php': { 4: 0 } } }).run });
  assert.equal(rec.outcome, 'recorded', rec.why);
  const f = await withRemote(f0);
  const r = f.push(f.git('rev-parse', '--abbrev-ref', 'HEAD'));
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /: pass: PMT-31: the review and gate proofs match/);
  assert.match(r.err, /\n {2}warning: diff coverage 0 of 1 changed lines ran \(0%\); no test ran these lines:\n {4}app\/Team\.php 4\n/);
});
