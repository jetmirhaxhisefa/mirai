import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseDiff } from '../../src/tests/diff.js';
import { reviewDiff } from '../../src/review/diff.js';

// Unit 24a: the diff Rex reads, built by MIRAI with its pinned git (TL3-12, TL2-23).

const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
function repo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mirai-24a-diff-')));
  temps.push(root);
  const env = { PATH: '/usr/bin:/bin', HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], { cwd: root, env }).toString().trim();
  git('init', '-q', '-b', 'main');
  return { root, env, git };
}
const lines = (n, word = 'line') => Array.from({ length: n }, (_, i) => `${word} ${i + 1}`).join('\n').concat('\n');

test('24a: a .gitattributes -diff or binary rule can\'t hide a changed text file from the review diff', () => {
  const { root, env, git } = repo();
  writeFileSync(join(root, 'hidden.js'), lines(3));
  writeFileSync(join(root, 'plain.js'), lines(3));
  git('add', '-A');
  git('commit', '-qm', 'one');
  const base = git('rev-parse', 'HEAD');
  // The branch marks both files binary for diffs, then changes them.
  writeFileSync(join(root, '.gitattributes'), 'hidden.js -diff\nplain.js binary\n');
  writeFileSync(join(root, 'hidden.js'), 'line 1\nevil()\nline 3\n');
  writeFileSync(join(root, 'plain.js'), 'line 1\nline 2\nline 3\nmore()\n');
  git('add', '-A');
  git('commit', '-qm', 'two');
  // Plain git, as the branch would have it, hides them.
  assert.match(execFileSync('/usr/bin/git', ['diff', `${base}..HEAD`, '--', 'hidden.js'], { cwd: root, env }).toString(), /Binary files/);
  const d = reviewDiff({ root, env, from: base, to: 'HEAD' });
  assert.match(d.patch, /\+evil\(\)/);
  assert.match(d.patch, /\+more\(\)/);
  assert.deepEqual(d.changedLines['hidden.js'], [2]);
  assert.deepEqual(d.changedLines['plain.js'], [4]);
  assert.equal(d.files.find((f) => f.path === 'hidden.js').binary, false);
});

test('24a: a real binary file is listed with a note, never as a patch, and has no changed lines', () => {
  const { root, env, git } = repo();
  writeFileSync(join(root, 'a.txt'), lines(2));
  git('add', '-A');
  git('commit', '-qm', 'one');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'img.bin'), Buffer.from([0x89, 0x50, 0, 1, 2, 0x0a, 3]));
  git('add', '-A');
  git('commit', '-qm', 'two');
  const d = reviewDiff({ root, env, from: base, to: 'HEAD' });
  const img = d.files.find((f) => f.path === 'img.bin');
  assert.equal(img.binary, true);
  assert.match(img.note, /binary/);
  assert.match(d.patch, /# MIRAI: added, not shown: a binary file/);
  assert.equal(d.changedLines['img.bin'], undefined);
});

test('24a: a removal marks the lines beside it as changed, so a finding about deleted code can cite it', () => {
  const { root, env, git } = repo();
  writeFileSync(join(root, 'a.js'), lines(5));
  git('add', '-A');
  git('commit', '-qm', 'one');
  const base = git('rev-parse', 'HEAD');
  // Line 3 removed, nothing added.
  writeFileSync(join(root, 'a.js'), 'line 1\nline 2\nline 4\nline 5\n');
  git('add', '-A');
  git('commit', '-qm', 'two');
  const d = reviewDiff({ root, env, from: base, to: 'HEAD' });
  assert.deepEqual(d.changedLines['a.js'], [2, 3]);
  // parseDiff's `near` on its own: a replacement marks its first new line.
  const p = parseDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -2 +2 @@\n-old\n+new\n', undefined, { near: true });
  assert.deepEqual(p.files[0].near, [2]);
  // Without `near`, parseDiff's result is as before (unit 16b's callers).
  assert.equal(parseDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -2 +2 @@\n-old\n+new\n').files[0].near, undefined);
});

test('24a: a diff larger than the review takes is refused, never cut short; no change gives an empty diff', () => {
  const { root, env, git } = repo();
  writeFileSync(join(root, 'a.txt'), lines(2));
  git('add', '-A');
  git('commit', '-qm', 'one');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'a.txt'), lines(400, 'changed'));
  git('add', '-A');
  git('commit', '-qm', 'two');
  assert.throws(() => reviewDiff({ root, env, from: base, to: 'HEAD', maxBytes: 1024 }), (e) => e.code === 'diff-too-large' && /never reviews part/.test(e.message));
  const same = reviewDiff({ root, env, from: 'HEAD', to: 'HEAD' });
  assert.equal(same.patch, '');
  assert.deepEqual(same.files, []);
});

test('24a: each hunk line carries the file\'s own line number, never its place in the diff (probe r3)', () => {
  const { root, env, git } = repo();
  writeFileSync(join(root, 'a.js'), lines(40));
  writeFileSync(join(root, 'b.js'), lines(3));
  git('add', '-A');
  git('commit', '-qm', 'one');
  const base = git('rev-parse', 'HEAD');
  // a.js: line 10 replaced, and two lines added after line 30, so the diff's own count is far off.
  const a = lines(40).split('\n');
  a[9] = 'ten()';
  a.splice(30, 0, 'added_one()', '--- looks like a header');
  writeFileSync(join(root, 'a.js'), a.join('\n'));
  writeFileSync(join(root, 'b.js'), 'line 1\nline 3\n');
  git('add', '-A');
  git('commit', '-qm', 'two');
  const d = reviewDiff({ root, env, from: base, to: 'HEAD' });
  const file = readFileSync(join(root, 'a.js'), 'utf8').split('\n');
  let numbered = 0;
  for (const l of d.patch.split('\n')) {
    const m = /^ {0,5}(\d+) ([ +])(.*)$/.exec(l);
    if (!m) continue;
    numbered++;
    // b.js's lines are checked below; here a.js's (b.js has only lines 1-2).
    if (Number(m[1]) > 2) assert.equal(file[Number(m[1]) - 1], m[3], l);
  }
  assert.ok(numbered > 10);
  assert.match(d.patch, /^ {4}31 \+added_one\(\)$/m);
  assert.match(d.patch, /^ {4}32 \+--- looks like a header$/m);
  assert.match(d.patch, /^ {6} -line 10$/m);
  assert.match(d.patch, /^ {6} -line 2$/m);
  assert.match(d.patch, /^ {5}1  line 1$/m);
  assert.match(d.patch, /^\+\+\+ b\/a\.js$/m);
  assert.match(d.patch, /^@@ /m);
  // What triage cites is the same numbers.
  assert.ok(d.changedLines['a.js'].includes(31) && d.changedLines['a.js'].includes(10));
});
