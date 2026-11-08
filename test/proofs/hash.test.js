import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { codeHash, normalizePatch } from '../../src/proofs/hash.js';
import { git, setup } from '../store/helpers.js';

// Unit 25a: the code hash (D-16, G14).

const CODE = ['**', '!docs/mirai/**', '!.mirai/**'];
const LINES = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);

// A repo whose main has app.js (40 lines) and a ticket branch that changes line 30.
function repo() {
  const { home, env, repo: dir } = setup();
  const g = (...a) => git(dir, a, home);
  writeFileSync(join(dir, 'app.js'), `${LINES.join('\n')}\n`);
  g('add', '.');
  g('commit', '-q', '-m', 'app');
  g('switch', '-q', '-c', 'ticket');
  const changed = [...LINES];
  changed[29] = 'line 30 changed';
  writeFileSync(join(dir, 'app.js'), `${changed.join('\n')}\n`);
  g('commit', '-q', '-am', 'change');
  const sha = (ref) => g('rev-parse', ref);
  const hash = (ref = 'ticket', base = null) => codeHash({ root: dir, env, base: base ?? g('merge-base', 'main', ref), head: sha(ref), codePaths: CODE }).hash;
  return { home, env, dir, g, sha, hash, changed };
}

test('25a: a clean rebase onto a base that changed other lines of a touched file keeps the hash', () => {
  const r = repo();
  const before = r.hash();
  r.g('switch', '-q', 'main');
  const moved = [...LINES];
  moved[2] = 'line 3 on main';
  writeFileSync(join(r.dir, 'app.js'), `${moved.join('\n')}\n`);
  r.g('commit', '-q', '-am', 'main moves');
  r.g('switch', '-q', 'ticket');
  r.g('rebase', '-q', 'main');
  assert.equal(r.hash(), before);
});

test('25a: any change to the code changes the hash: a line, a context line, whitespace only, a mode, a binary file', () => {
  const r = repo();
  const first = r.hash();
  const seen = new Set([first]);
  const step = (fn, what) => {
    fn();
    r.g('add', '-A');
    r.g('commit', '-q', '--allow-empty', '-m', what);
    const h = r.hash();
    assert.ok(!seen.has(h), `${what} kept a hash seen before`);
    seen.add(h);
  };
  step(() => writeFileSync(join(r.dir, 'app.js'), `${r.changed.join('\n')}\nline 41\n`), 'a new line');
  // A context line: on the base and the branch alike, inside the hunk's 3 lines.
  step(() => {
    r.g('switch', '-q', 'main');
    const m = [...LINES];
    m[26] = 'line 27 on main';
    writeFileSync(join(r.dir, 'app.js'), `${m.join('\n')}\n`);
    r.g('commit', '-q', '-am', 'context');
    r.g('switch', '-q', 'ticket');
    r.g('rebase', '-q', 'main');
  }, 'a context line');
  step(() => writeFileSync(join(r.dir, 'app.js'), `${r.g('show', 'HEAD:app.js').replace('line 30 changed', 'line 30 changed ')}\n`), 'whitespace only');
  step(() => chmodSync(join(r.dir, 'app.js'), 0o755), 'a mode');
  step(() => writeFileSync(join(r.dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])), 'a binary file');
  step(() => writeFileSync(join(r.dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 4])), 'one byte of the binary file');
});

test('25a: the records folder and paths outside code_paths are never in the hash; nothing changed is an empty patch', () => {
  const r = repo();
  const before = r.hash();
  mkdirSync(join(r.dir, '.mirai', 'records', 'T-1'), { recursive: true });
  writeFileSync(join(r.dir, '.mirai', 'records', 'T-1', 'review-r1-abc.json'), '{}\n');
  mkdirSync(join(r.dir, 'docs', 'mirai'), { recursive: true });
  writeFileSync(join(r.dir, 'docs', 'mirai', 'status.md'), 'x\n');
  r.g('add', '-A');
  r.g('commit', '-q', '-m', 'records');
  assert.equal(r.hash(), before);
  // Even when code_paths would include them.
  const all = codeHash({ root: r.dir, env: r.env, base: r.g('merge-base', 'main', 'ticket'), head: r.sha('ticket'), codePaths: ['**'] });
  assert.ok(!all.files.some((f) => f.startsWith('.mirai/records/')));
  const none = codeHash({ root: r.dir, env: r.env, base: r.sha('ticket'), head: r.sha('ticket'), codePaths: CODE });
  assert.deepEqual(none.files, []);
});

test('25a, G14: the hash is the same under a hostile repo git config; the settings the repo check refuses never reach it', () => {
  const r = repo();
  r.g('switch', '-q', 'ticket');
  writeFileSync(join(r.dir, 'b.js'), 'one\n\ntwo\nthree\n');
  writeFileSync(join(r.dir, 'ä file.js'), 'x\n');
  r.g('add', '-A');
  r.g('commit', '-q', '-m', 'more');
  const before = r.hash();
  for (const [k, v] of [['diff.algorithm', 'patience'], ['diff.renames', 'copies'], ['core.quotePath', 'false']]) r.g('config', k, v);
  writeFileSync(join(r.dir, '.git', 'info', 'attributes'), '*.js diff=fancy\n*.js -diff\n');
  assert.equal(r.hash(), before);
  // MIRAI's repo check (14b) refuses to run git at all on these, so they can't change a hash.
  for (const [k, v] of [['diff.context', '10'], ['diff.interHunkContext', '20'], ['diff.indentHeuristic', 'false'], ['diff.suppressBlankEmpty', 'true'], ['diff.orderFile', '/dev/null'], ['diff.srcPrefix', 'x/']]) {
    r.g('config', k, v);
    assert.throws(() => r.hash(), (err) => err.code === 'repo-config', k);
    r.g('config', '--unset', k);
  }
  assert.equal(r.hash(), before);
});

test('25a: the normalization drops index lines, hunk line numbers and labels, and sorts sections; a binary line is refused', () => {
  const a = 'diff --git a/z b/z\nindex 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644\n--- a/z\n+++ b/z\n@@ -1,3 +1,3 @@ function z()\n x\n-y\n+Y\n';
  const b = 'diff --git a/a b/a\nindex 3333333333333333333333333333333333333333..4444444444444444444444444444444444444444 100644\n--- a/a\n+++ b/a\n@@ -9,3 +9,3 @@\n p\n-q\n+Q\n';
  const out = normalizePatch(`${a}${b}`).toString();
  assert.equal(out, 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@\n p\n-q\n+Q\ndiff --git a/z b/z\n--- a/z\n+++ b/z\n@@\n x\n-y\n+Y\n');
  assert.throws(() => normalizePatch('diff --git a/p b/p\nBinary files /dev/null and b/p differ\n'), (err) => err.code === 'bad-patch');
});
