import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DIFF_LIMITS, parseDiff } from '../../src/tests/diff.js';
import { changedLines } from '../../src/store/git.js';

// Unit 16b T3 and T4: the unified diff parser, on git's own output from a fixture repo, and
// changedLines with MIRAI's pinned git.

const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
function repo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mirai-16b-diff-')));
  temps.push(root);
  const env = { PATH: '/usr/bin:/bin', HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], { cwd: root, env }).toString();
  git('init', '-q', '-b', 'main');
  return { root, env, git };
}
const lines = (n, f = (i) => `line ${i}`) => `${Array.from({ length: n }, (_, i) => f(i + 1)).join('\n')}\n`;

test('16b T3/T4: added, removed and changed lines; new, deleted and binary files; no newline at the end; odd paths', () => {
  const { root, env, git } = repo();
  writeFileSync(join(root, 'a.txt'), lines(10));
  writeFileSync(join(root, 'gone.txt'), lines(3));
  writeFileSync(join(root, 'bin.dat'), Buffer.from([0, 1, 2, 3]));
  writeFileSync(join(root, 'tail.txt'), 'x\ny');
  git('add', '-A');
  git('commit', '-qm', 'one');
  const base = git('rev-parse', 'HEAD').trim();
  // a.txt: line 2 changed, line 5 removed, two lines added after 8.
  writeFileSync(join(root, 'a.txt'), lines(10, (i) => (i === 2 ? 'changed' : `line ${i}`)).replace('line 5\n', '').replace('line 8\n', 'line 8\nnew a\nnew b\n'));
  unlinkSync(join(root, 'gone.txt'));
  writeFileSync(join(root, 'bin.dat'), Buffer.from([0, 9, 9, 9]));
  writeFileSync(join(root, 'tail.txt'), 'x\nz');
  writeFileSync(join(root, 'with space.txt'), 'one\ntwo\n');
  writeFileSync(join(root, 'tab\there "q" é.txt'), 'one\n');
  git('add', '-A');
  git('commit', '-qm', 'two');
  const { files } = changedLines(root, base, 'HEAD', env);
  const by = Object.fromEntries(files.map((f) => [f.path, f]));
  assert.deepEqual(by['a.txt'], { path: 'a.txt', status: 'modified', added: [2, 8, 9], removed: [2, 5], binary: false });
  assert.deepEqual(by['gone.txt'], { path: 'gone.txt', status: 'deleted', added: [], removed: [1, 2, 3], binary: false });
  assert.deepEqual(by['bin.dat'], { path: 'bin.dat', status: 'modified', added: [], removed: [], binary: true });
  assert.deepEqual(by['tail.txt'].added, [2]);
  assert.deepEqual(by['with space.txt'], { path: 'with space.txt', status: 'added', added: [1, 2], removed: [], binary: false });
  assert.deepEqual(by['tab\there "q" é.txt'].added, [1]);
  // Nothing changed: no files.
  assert.deepEqual(changedLines(root, 'HEAD', 'HEAD', env).files, []);
});

test('16b T4: against the work tree, untracked files are wholly added; a rename is two paths; a repo with a diff driver is refused', () => {
  const { root, env, git } = repo();
  writeFileSync(join(root, 'a.txt'), lines(3));
  writeFileSync(join(root, '.gitattributes'), '*.txt diff=evil\n');
  git('add', '-A');
  git('commit', '-qm', 'one');
  git('mv', 'a.txt', 'b.txt');
  writeFileSync(join(root, 'new.txt'), 'one\ntwo\nthree');
  writeFileSync(join(root, 'blob.bin'), Buffer.from([1, 0, 1]));
  symlinkSync('a.txt', join(root, 'link'));
  const { files } = changedLines(root, 'HEAD', undefined, env);
  const by = Object.fromEntries(files.map((f) => [f.path, f]));
  assert.equal(by['a.txt'].status, 'deleted');
  assert.deepEqual(by['b.txt'].added, [1, 2, 3]);
  assert.deepEqual(by['new.txt'].added, [1, 2, 3]);
  assert.equal(by['blob.bin'].binary, true);
  assert.deepEqual(by.link.added, [1]);
  // A driver the attributes name but no config defines does nothing; one the repo's config
  // defines makes MIRAI refuse the repo (unit 14b), before any diff.
  const marker = join(root, 'ran');
  git('config', 'diff.evil.textconv', `touch ${marker}; cat`);
  assert.throws(() => changedLines(root, 'HEAD', undefined, env), (e) => /diff\.evil\.textconv/.test(e.message));
  assert.throws(() => execFileSync('/bin/ls', [marker], { stdio: 'ignore' }), 'a diff driver ran');
});

test('16b T3: anything git wouldn\'t write is refused; the limits', () => {
  const ok = 'diff --git a/x b/x\nindex 1111111..2222222 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n';
  assert.deepEqual(parseDiff(ok).files, [{ path: 'x', status: 'modified', added: [1], removed: [1], binary: false }]);
  assert.deepEqual(parseDiff('').files, []);
  const refused = (text, re) => assert.throws(() => parseDiff(text), (e) => e.code === 'malformed-diff' && re.test(e.message), JSON.stringify(text.slice(0, 50)));
  refused('hello\n', /before the first/);
  refused(ok.replace('+b\n', ''), /ends inside a hunk/);
  refused(ok.replace('+b\n', '+b\n+c\n'), /git didn't write/);
  refused(ok.replace('@@ -1 +1 @@', '@@ -x +1 @@'), /hunk header/);
  refused(ok.replace('--- a/x\n+++ b/x\n', ''), /hunk header/);
  refused(ok.replace('+++ b/x', '+++ b/y'), /isn't the header's/);
  refused('diff --git a/x b/y\n', /two different paths/);
  refused('diff --git "a/x\\q" "b/x\\q"\n', /bad escape/);
  refused(ok.replace('index', 'similarity index 90%\nindex'), /git didn't write/);
  assert.throws(() => parseDiff('x'.repeat(100), { ...DIFF_LIMITS, bytes: 50 }), /larger than/);
  assert.throws(() => parseDiff(ok + ok.replaceAll('x', 'y'), { ...DIFF_LIMITS, files: 1 }), /more than 1 files/);
});

test('16b review: a nested repo is refused before the diff looks into it; characters beyond the BMP in quoted paths; a FIFO isn\'t listed; a -diff attribute shows as binary', () => {
  // H1: an inner repo as a gitlink, with its own filter; the outer diff must never run it.
  const { root, env, git } = repo();
  writeFileSync(join(root, 'a.txt'), 'a\n');
  git('add', '-A');
  git('commit', '-qm', 'one');
  const inner = join(root, 'inner');
  execFileSync('/bin/mkdir', [inner]);
  const ig = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], { cwd: inner, env });
  ig('init', '-q');
  writeFileSync(join(inner, 'x.txt'), 'x\n');
  ig('add', '-A');
  ig('commit', '-qm', 'inner');
  git('update-index', '--add', '--cacheinfo', `160000,${ig('rev-parse', 'HEAD').toString().trim()},inner`);
  const marker = join(root, 'filter-ran');
  writeFileSync(join(inner, '.gitattributes'), '* filter=evil\n');
  ig('config', 'filter.evil.clean', `touch ${marker}; cat`);
  writeFileSync(join(inner, 'x.txt'), 'changed\n');
  assert.throws(() => changedLines(root, 'HEAD', undefined, env), (e) => e.code === 'repo-nested' || /nested/.test(e.message));
  assert.throws(() => execFileSync('/bin/ls', [marker], { stdio: 'ignore' }), 'the nested repo\'s filter ran');

  const b = repo();
  writeFileSync(join(b.root, 'a.js'), 'x\n');
  writeFileSync(join(b.root, '.gitattributes'), '*.js -diff\n');
  b.git('add', '-A');
  b.git('commit', '-qm', 'one');
  writeFileSync(join(b.root, 'a.js'), 'x\ny\nz\n');
  writeFileSync(join(b.root, 'emoji\t\u{1F600}.txt'), 'one\n');
  execFileSync('/usr/bin/mkfifo', [join(b.root, 'pipe')]);
  const by = Object.fromEntries(changedLines(b.root, 'HEAD', undefined, b.env).files.map((f) => [f.path, f]));
  assert.equal(by['a.js'].binary, true);
  assert.deepEqual(by['emoji\t\u{1F600}.txt'].added, [1]);
  // Git lists no FIFO as untracked; untrackedFile opens files non-blocking all the same.
  assert.equal(by.pipe, undefined);
  b.git('add', 'emoji\t\u{1F600}.txt');
  b.git('commit', '-qm', 'two');
  assert.ok(changedLines(b.root, 'HEAD~1', 'HEAD', b.env).files.some((f) => f.path === 'emoji\t\u{1F600}.txt'));
});
