import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { UnsupportedSystem, appDataDir, appDataDirTilde, pathFold, sandboxName, systemOf } from '../../src/os/index.js';
import { miraiHome } from '../../src/store/mirai-home.js';
import { leftOutText, needs, needsTest, readLeftOut } from '../helpers/needs.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

test('30a T1: a marked test is skipped with its reason where the need is missing, and runs where it is there', () => {
  const none = { docker: () => false, cage: () => true };
  assert.equal(needs('docker', 'runs the sample image', { detect: none }), 'needs docker: runs the sample image');
  assert.equal(needs('cage', 'runs sandbox-exec', { detect: none }), false);
  assert.throws(() => needs('gpu', 'x', { detect: none }), /unknown need "gpu"/);
  assert.throws(() => needs('docker', '', { detect: none }), /takes a reason/);
});

test('30a T2: the left-out list groups skipped tests by need; none prints "left out: none"', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'mirai-30a-')), 'left-out.jsonl');
  const env = { MIRAI_LEFT_OUT: file };
  const missing = { docker: () => false, claude: () => false };
  needsTest('docker', 'runs the sample image', { detect: missing, env, file: 'test/a.test.js', register: () => {} })('T9: images', () => {});
  needsTest('claude', 'a real agent', { detect: missing, env, file: 'test/b.test.js', register: () => {} })('T3: launch', () => {});
  const text = leftOutText(readLeftOut(file));
  assert.match(text, /^left out \(2\):\n {2}claude \(1\):\n {4}test\/b\.test\.js: T3: launch \(a real agent\)\n {2}docker \(1\):\n {4}test\/a\.test\.js: T9: images \(runs the sample image\)\n$/);
  assert.equal(leftOutText(readLeftOut(join(tmpdir(), 'mirai-30a-none.jsonl'))), 'left out: none\n');
});

test('30a T3: the module gives today\'s macOS answers, and "not supported yet" elsewhere, never a guess', () => {
  assert.equal(appDataDir('/Users/x', 'darwin'), '/Users/x/Library/Application Support');
  assert.equal(join(appDataDir('/Users/x', 'darwin'), 'mirai'), miraiHome({ HOME: '/Users/x' }));
  assert.equal(appDataDirTilde('darwin'), '~/Library/Application Support');
  assert.equal(sandboxName('darwin'), 'sandbox-exec');
  assert.equal(pathFold('darwin')('/A/Café'.normalize('NFD')), '/a/café'.normalize('NFC'));
  assert.deepEqual(systemOf('darwin'), { platform: 'darwin', supported: true });
  assert.deepEqual(systemOf('linux'), { platform: 'linux', supported: false });
  for (const ask of [() => appDataDir('/home/x', 'linux'), () => appDataDirTilde('linux'), () => sandboxName('linux'), () => pathFold('linux')]) {
    assert.throws(ask, (e) => e instanceof UnsupportedSystem && /^not supported yet: linux \(/.test(e.message) && /P01/.test(e.hint));
  }
});

test('30a T5: the workflow is pinned, read-only, never pull_request_target, and holds no secret', () => {
  const yml = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const uses = [...yml.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(uses.length >= 2);
  for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, u);
  assert.match(yml, /^permissions:\n {2}contents: read$/m);
  assert.doesNotMatch(yml, /pull_request_target/);
  assert.doesNotMatch(yml, /secrets\./);
  assert.match(yml, /os: \[macos-latest, ubuntu-latest\]/);
});
