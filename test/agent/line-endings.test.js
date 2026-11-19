import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { endings, keepLineEndings } from '../../src/agent/line-endings.js';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_NOSYSTEM: '1' };

test('30c T7: a CRLF file written back as LF gets its CRLF; mixed is left and named; LF and new files stay', () => {
  const root = mkdtempSync(join(tmpdir(), 'mirai-30c-eol-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, env, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
  writeFileSync(join(root, 'readme.md'), 'one\r\ntwo\r\nthree\r\n');
  writeFileSync(join(root, 'mixed.md'), 'one\r\ntwo\r\n');
  writeFileSync(join(root, 'plain.js'), 'a\nb\n');
  writeFileSync(join(root, 'bin.dat'), Buffer.from([0, 13, 10, 1]));
  git('add', '-A');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  // The agent's editor: LF everywhere it wrote.
  writeFileSync(join(root, 'readme.md'), 'one\ntwo changed\nthree\nfour\n');
  writeFileSync(join(root, 'mixed.md'), 'one\r\ntwo\nthree\n');
  writeFileSync(join(root, 'plain.js'), 'a\nb\nc\n');
  writeFileSync(join(root, 'new.md'), 'x\ny\n');
  writeFileSync(join(root, 'bin.dat'), Buffer.from([0, 10, 2]));
  const r = keepLineEndings({ root, env, base });
  assert.deepEqual(r, { converted: ['readme.md'], mixed: ['mixed.md'] });
  assert.equal(readFileSync(join(root, 'readme.md'), 'utf8'), 'one\r\ntwo changed\r\nthree\r\nfour\r\n');
  assert.equal(readFileSync(join(root, 'plain.js'), 'utf8'), 'a\nb\nc\n');
  assert.equal(readFileSync(join(root, 'new.md'), 'utf8'), 'x\ny\n');
  // The diff is only the real change.
  const stat = git('diff', '--numstat', base, '--', 'readme.md').trim();
  assert.equal(stat, '2\t1\treadme.md');
  assert.equal(endings('a\r\nb\n'), 'mixed');
  assert.equal(endings('no break'), 'none');
});
