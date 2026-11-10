import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { coverageLines } from '../../src/proofs/coverage-text.js';
import { isBinary } from '../../src/review/diff.js';
import { blobAt, changedLines } from '../../src/store/git.js';
import { combinedCoverage, gateChanges, lineRanges } from '../../src/tests/diff-coverage.js';
import { parseDiff } from '../../src/tests/diff.js';
import { COV_CONFIG, PASSED, coveringRun, passed, tty } from './fixture.js';

// Unit 26b: the diff-coverage warning. The combining rules (no git), exact renames (real git),
// and `gate record` signing `diff_coverage` into the gate proof, read back by `gate check`.

const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
function repo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mirai-26b-')));
  temps.push(root);
  const env = { PATH: '/usr/bin:/bin', HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], { cwd: root, env }).toString().trim();
  git('init', '-q', '-b', 'main');
  return { root, env, git };
}
const lines = (n, tag = 'line') => `${Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join('\n')}\n`;
const changes = (root, env, base) => gateChanges({ root, env, base, head: 'HEAD', changedLines, blobAt, isBinary });

test('26b: line ranges', () => {
  assert.deepEqual(lineRanges([]), []);
  assert.deepEqual(lineRanges([1, 2, 3, 7, 9, 10]), ['1-3', '7', '9-10']);
});

test('26b: a line counts when any level ran it; scope from coverage_paths or the baseline; outside, binary, code_paths', () => {
  const file = (path, added, extra = {}) => ({ path, status: 'modified', added, removed: [], binary: false, ...extra });
  const changed = {
    files: [
      file('app/A.php', [1, 2, 3, 4]),
      file('app/Hidden.php', [1, 2]),
      file('app/Old.php', [5]),
      file('web/x.ts', [1]),
      file('routes/api.php', [3]),
      file('docs/mirai/t.md', [1]),
      file('app/logo.png', [], { binary: true }),
      file('app/moved.php', [], { status: 'renamed', from: 'lib/moved.php' }),
      file('app/gone.php', [], { status: 'deleted' }),
    ],
  };
  const unit = { name: 'unit', coverage: { files: { 'app/A.php': { 1: 2, 2: 0, 3: 0 }, 'app/Old.php': { 5: 0 } } }, scope: { kind: 'coverage_paths', paths: ['app/**'] } };
  const api = { name: 'api', coverage: { files: { 'app/A.php': { 2: 1 } } }, scope: { kind: 'baseline', files: ['app/A.php'] } };
  const web = { name: 'frontend', coverage: { files: {} }, scope: { kind: 'baseline', files: ['web/x.ts'] } };
  const c = combinedCoverage(changed, [unit, api, web], { codePaths: ['**', '!docs/mirai/**'] });
  const by = Object.fromEntries(c.files.map((f) => [f.path, f]));
  // A.php: lines 1–3 measurable (4 isn't listed), 1 by unit, 2 by api, 3 by none.
  assert.deepEqual(by['app/A.php'], { path: 'app/A.php', changed: 4, measurable: 3, covered: 2, uncovered: ['3'] });
  // Hidden.php: inside unit's coverage_paths, listed by no level (the branch's runner config left it out).
  assert.deepEqual(by['app/Hidden.php'], { path: 'app/Hidden.php', changed: 2, measurable: 2, covered: 0, uncovered: ['1-2'], why: 'not-measured' });
  assert.deepEqual(by['app/Old.php'].uncovered, ['5']);
  // web/x.ts: the frontend's baseline measured it, this run doesn't list it.
  assert.equal(by['web/x.ts'].why, 'not-measured');
  // routes/api.php: no level's scope; docs: outside code_paths; the png: binary; the move: nothing.
  assert.deepEqual(c.apart, [{ path: 'app/logo.png', why: 'binary' }, { path: 'routes/api.php', why: 'outside', changed: 1 }]);
  assert.equal(by['docs/mirai/t.md'], undefined);
  assert.equal(by['app/moved.php'], undefined);
  assert.deepEqual(c.total, { changed: 8, measurable: 7, covered: 2 });
  assert.equal(c.uncovered_files, 4);
  assert.match(c.changed_sha256, /^[0-9a-f]{64}$/);
  // A level that gave no coverage this run: its scope's files are not run, and it's named.
  const silent = combinedCoverage({ files: [file('app/B.php', [1])] }, [{ ...unit, coverage: null }], { codePaths: ['**'] });
  assert.deepEqual(silent.files[0].why, 'no-coverage: unit');
  assert.equal(silent.total.covered, 0);
  // The same lines, the same hash; another line, another.
  assert.equal(combinedCoverage(changed, [unit], { codePaths: ['**'] }).changed_sha256, combinedCoverage(changed, [api], { codePaths: ['**'] }).changed_sha256);
  assert.notEqual(combinedCoverage({ files: [file('app/A.php', [1])] }, [], { codePaths: ['**'] }).changed_sha256, combinedCoverage({ files: [file('app/A.php', [2])] }, [], { codePaths: ['**'] }).changed_sha256);
});

test('26b: exact renames: a pure move adds no lines, a move with an edit is wholly added, a binary file has none', () => {
  const { root, env, git } = repo();
  mkdirSync(join(root, 'lib'));
  writeFileSync(join(root, 'lib/a.php'), lines(5));
  writeFileSync(join(root, 'lib/b.php'), lines(4, 'b'));
  writeFileSync(join(root, 'old name.php'), lines(2, 'q'));
  git('add', '-A');
  git('commit', '-qm', 'one');
  const base = git('rev-parse', 'HEAD');
  mkdirSync(join(root, 'app'));
  git('mv', 'lib/a.php', 'app/a.php');
  git('mv', 'lib/b.php', 'app/b.php');
  writeFileSync(join(root, 'app/b.php'), `${lines(4, 'b')}more\n`);
  git('mv', 'old name.php', 'new näme.php');
  writeFileSync(join(root, 'img.bin'), Buffer.from([0, 1, 2, 0, 5]));
  git('add', '-A');
  git('commit', '-qm', 'two');
  const by = Object.fromEntries(changes(root, env, base).files.map((f) => [f.path, f]));
  assert.deepEqual(by['app/a.php'], { path: 'app/a.php', status: 'renamed', from: 'lib/a.php', added: [], removed: [], binary: false });
  assert.deepEqual(by['new näme.php'].from, 'old name.php');
  // Edited while moved: git with 100% finds no rename, so the new file is wholly added.
  assert.equal(by['app/b.php'].status, 'added');
  assert.deepEqual(by['app/b.php'].added, [1, 2, 3, 4, 5]);
  assert.equal(by['lib/b.php'].status, 'deleted');
  assert.equal(by['img.bin'].binary, true);
  assert.deepEqual(by['img.bin'].added, []);
  // Without the option, a rename is still refused (16b's pins); the work tree takes no renames.
  assert.throws(() => parseDiff('diff --git a/x b/y\nsimilarity index 100%\nrename from x\nrename to y\n'), /renames are off/);
  assert.throws(() => changedLines(root, base, undefined, env, { renames: 'exact' }), /between two commits/);
});

test('26b: a rename that isn\'t exact, or a malformed one, is refused', () => {
  const opts = [undefined, { renames: 'exact' }];
  assert.throws(() => parseDiff('diff --git a/x b/y\nsimilarity index 90%\nrename from x\nrename to y\n', ...opts), /isn't exact/);
  assert.throws(() => parseDiff('diff --git a/x b/y\nrename from x\nrename to y\n', ...opts), /rename from/);
  assert.throws(() => parseDiff('diff --git a/x b/y\nsimilarity index 100%\nrename from x\n', ...opts), /without its/);
  assert.throws(() => parseDiff('diff --git a/x b/y\nsimilarity index 100%\nrename from x\nrename to y\n--- a/x\n+++ b/y\n@@ -1 +1 @@\n-a\n+b\n', ...opts), /changes after it/);
  assert.deepEqual(parseDiff('diff --git a/x b/y\nold mode 100644\nnew mode 100755\nsimilarity index 100%\nrename from x\nrename to y\n', ...opts).files, [{ path: 'y', status: 'renamed', from: 'x', added: [], removed: [], binary: false }]);
});

test('26b: the text: a warning with the files, all ran, none in an older proof, more files, a level without coverage', () => {
  const dc = (files, total, extra = {}) => ({ total, files, apart: [], levels: { unit: { coverage: 'ok' } }, uncovered_files: files.filter((f) => f.uncovered.length).length, ...extra });
  assert.deepEqual(coverageLines(null), ['  diff coverage: none in this proof (recorded before unit 26b)']);
  assert.deepEqual(coverageLines(dc([{ path: 'a.php', uncovered: [] }], { changed: 3, measurable: 2, covered: 2 })), ['  diff coverage: all 2 changed lines that can run ran (3 added)']);
  const many = Array.from({ length: 7 }, (_, i) => ({ path: `f${i}.php`, uncovered: ['1-2'] }));
  const out = coverageLines(dc(many, { changed: 14, measurable: 14, covered: 0 }, { levels: { unit: { coverage: 'missing' } } }), { files: 5, ticket: 'PMT-31' });
  assert.equal(out[0], '  warning: diff coverage 0 of 14 changed lines ran (0%); no test ran these lines:');
  assert.equal(out[1], '    f0.php 1-2');
  assert.equal(out[6], '    and 2 more file(s): mirai gate check PMT-31');
  assert.match(out[7], /unit: no coverage from this run \(missing\)/);
});

test('26b: gate record runs the levels with coverage and signs diff_coverage; gate check prints the warning', async () => {
  const f = await passed({ config: COV_CONFIG });
  // The build appended line 4 of app/Team.php; unit lists it with no hit.
  const { run, seen } = coveringRun({ unit: { 'app/Team.php': { 2: 1, 4: 0 } } });
  const rec = await f.record({ run });
  assert.equal(rec.outcome, 'recorded', rec.why);
  assert.deepEqual(seen.filter((s) => s.name !== 'lint'), [{ name: 'unit', coverage: true }, { name: 'feature', coverage: true }]);
  const dc = rec.diffCoverage;
  assert.deepEqual(dc.total, { changed: 1, measurable: 1, covered: 0 });
  assert.deepEqual(dc.files, [{ path: 'app/Team.php', changed: 1, measurable: 1, covered: 0, uncovered: ['4'] }]);
  assert.equal(dc.base_sha, rec.base);
  assert.equal(dc.renames, 'exact');
  assert.deepEqual(dc.levels.unit, { coverage: 'ok', coverage_sha256: 'c-unit', scope: 'coverage_paths', coverage_paths: ['app/**'], measured_sha256: null });
  assert.equal(dc.levels.feature.scope, null);
  // Signed into the gate proof, and read back from it.
  const c = f.check();
  assert.equal(c.outcome, 'pass');
  assert.deepEqual(JSON.parse(JSON.stringify(c.matched.gate.diffCoverage)), JSON.parse(JSON.stringify(dc)));
  const out = await tty(['gate', 'check', 'PMT-31'], f.io);
  assert.match(out.out, /warning: diff coverage 0 of 1 changed lines ran \(0%\)/);
  assert.match(out.out, /app\/Team\.php 4/);
});

test('26b: a changed file the branch\'s coverage leaves out counts as not run; all ran → no warning', async () => {
  const f = await passed({ config: COV_CONFIG, baseline: { unit: PASSED, feature: PASSED } });
  const none = await f.record({ run: coveringRun({ unit: {} }).run });
  assert.equal(none.outcome, 'recorded', none.why);
  assert.deepEqual(none.diffCoverage.files, [{ path: 'app/Team.php', changed: 1, measurable: 1, covered: 0, uncovered: ['4'], why: 'not-measured' }]);
  const g = await passed({ config: COV_CONFIG });
  const all = await g.record({ run: coveringRun({ feature: { 'app/Team.php': { 4: 3 } } }).run });
  assert.deepEqual(all.diffCoverage.total, { changed: 1, measurable: 1, covered: 1 });
  assert.deepEqual(coverageLines(all.diffCoverage), ['  diff coverage: all 1 changed lines that can run ran']);
});
