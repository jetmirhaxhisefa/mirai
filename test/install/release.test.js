import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { installCommand, packageInfo, tagProblem } from '../../src/install/release.js';

// Unit 12c: MIRAI installed with one command from a GitHub tag (Jet's decisions 1 and 2).
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const temp = (name) => realpathSync(mkdtempSync(join(tmpdir(), `mirai-12c-${name}-`)));
const npm = (args, opts = {}) => execFileSync('npm', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

test('12c T1: the package holds only what runs MIRAI, with no install-time script and no dependency', () => {
  const [packed] = JSON.parse(npm(['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT }));
  const tops = new Set(packed.files.map((f) => f.path.split('/')[0]));
  assert.deepEqual([...tops].sort(), ['LICENSE', 'README.md', 'bin', 'package.json', 'registry', 'src']);
  for (const f of packed.files) assert.doesNotMatch(f.path, /^(test|implementation|design|docs|\.github|tools)\//, f.path);
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'postpack', 'preuninstall', 'uninstall', 'postuninstall']) {
    assert.equal(PKG.scripts?.[hook], undefined, `no ${hook} script: installing MIRAI runs none of its code`);
  }
  for (const deps of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies']) assert.equal(PKG[deps], undefined, deps);
  assert.deepEqual(PKG.bin, { mirai: 'bin/launch.js' });
  assert.equal(packageInfo().source, 'github:jetmirhaxhisefa/mirai');
  assert.equal(installCommand('0.2.0'), 'npm install -g github:jetmirhaxhisefa/mirai#v0.2.0');
  assert.throws(() => installCommand('latest'), /not a release version/);
});

test('12c T2: installed from the package into an empty prefix, mirai is on the PATH, sets up a fresh repo, and uninstalls to nothing', () => {
  const work = temp('t2');
  const prefix = join(work, 'prefix');
  const home = join(work, 'home');
  mkdirSync(home);
  const env = { ...process.env, HOME: home, npm_config_cache: join(work, 'npm-cache'), npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' };
  const tgz = npm(['pack', '--ignore-scripts', '--pack-destination', work], { cwd: ROOT, env }).trim().split('\n').pop();
  npm(['install', '-g', '--prefix', prefix, '--ignore-scripts', '--offline', join(work, tgz)], { env });
  const bin = join(prefix, 'bin');
  assert.ok(existsSync(join(bin, 'mirai')), 'the mirai link is in the prefix\'s bin');
  const onPath = { ...env, PATH: `${bin}:${process.env.PATH}` };
  const run = (cwd, ...args) => spawnSync('mirai', args, { cwd, env: onPath, encoding: 'utf8' });
  assert.equal(run(home, '--version').stdout.trim(), PKG.version);
  assert.match(run(home, 'which').stdout, /why: not inside a git repository/);
  const repo = join(work, 'app');
  mkdirSync(repo);
  const git = (...a) => execFileSync('git', a, { cwd: repo, env: onPath, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '# app\n');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@e', 'commit', '-qm', 'first');
  const init = run(repo, 'init', '--branch', 'main');
  assert.equal(init.status, 0, init.stderr);
  assert.match(init.stdout, new RegExp(`teammates install MIRAI ${PKG.version.replace(/\./g, '\\.')} with: npm install -g github:jetmirhaxhisefa/mirai#v${PKG.version.replace(/\./g, '\\.')}`));
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@e', 'commit', '-qm', 'Install MIRAI');
  assert.match(run(repo, 'which').stdout, /why: the copy committed on main/);
  assert.equal(run(repo, 'status').status, 0);
  npm(['uninstall', '-g', '--prefix', prefix, 'mirai'], { env });
  assert.equal(existsSync(join(bin, 'mirai')), false, 'no mirai left on the PATH');
  const left = existsSync(join(prefix, 'lib', 'node_modules')) ? readdirSync(join(prefix, 'lib', 'node_modules')) : [];
  assert.deepEqual(left, [], 'nothing of MIRAI\'s left in the prefix');
});

test('12c T4: the release check takes only a tag that is package.json\'s version', () => {
  assert.equal(tagProblem('v0.2.0', '0.2.0'), null);
  assert.match(tagProblem('v0.3.0', '0.2.0'), /isn't v0\.2\.0, package\.json's version: bump the version in a PR first/);
  assert.match(tagProblem('0.2.0', '0.2.0'), /isn't v0\.2\.0/);
  assert.match(tagProblem('v0.2.0', '0.2'), /isn't X\.Y\.Z/);
  const ok = spawnSync(process.execPath, [join(ROOT, 'tools/release-check.js'), `v${PKG.version}`], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const bad = spawnSync(process.execPath, [join(ROOT, 'tools/release-check.js'), 'v99.0.0'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^release check: the tag "v99\.0\.0" isn't v/);
});

test('12c T5: the release workflow runs only on v* tags, pinned and read-only, with no secret', () => {
  const yml = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
  assert.match(yml, /^on:\n {2}push:\n {4}tags: \['v\*'\]\n\n/m);
  const uses = [...yml.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(uses.length >= 2);
  for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, u);
  assert.match(yml, /^permissions:\n {2}contents: read$/m);
  assert.doesNotMatch(yml, /pull_request_target|secrets\.|npm publish/);
  assert.match(yml, /node tools\/release-check\.js "\$TAG"/);
});
