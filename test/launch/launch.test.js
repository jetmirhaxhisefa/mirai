import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

import { init, FRAMEWORK_PARTS, PACKAGE_ROOT } from '../../src/install/init.js';
import { join as joinStore, joinPlan } from '../../src/install/join.js';
import { lockText, readLock, sha256 } from '../../src/install/lock.js';
import { loadRegistry } from '../../src/config/registry.js';
import { changeOf, classify, protectionRules } from '../../src/trust/protected.js';

const LAUNCHER = join(PACKAGE_ROOT, 'bin/launch.js');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const temps = [];
after(() => {
  for (const d of temps) {
    makeWritable(d);
    rmSync(d, { recursive: true, force: true });
  }
});
function makeWritable(d) {
  try {
    chmodSync(d, 0o755);
    for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) makeWritable(join(d, e.name)); else chmodSync(join(d, e.name), 0o644);
  } catch { /* gone */ }
}
const tempDir = (name) => {
  const d = mkdtempSync(join(tmpdir(), `mirai-${name}-`));
  temps.push(d);
  return d;
};

// A copy of MIRAI's package with another version.
function fakePackage(version) {
  const dir = tempDir('pkg');
  for (const part of FRAMEWORK_PARTS) cpSync(join(PACKAGE_ROOT, part), join(dir, part), { recursive: true });
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
  return dir;
}

// A repo with MIRAI installed from `packageRoot` and committed on main.
function installed(packageRoot = PACKAGE_ROOT, home = tempDir('home')) {
  const root = tempDir('launch');
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), '# App\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'first');
  const env = { PATH: process.env.PATH, HOME: home };
  init({ cwd: root, env, branch: 'main', packageRoot });
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'Install MIRAI');
  return { root, env };
}

const mirai = (cwd, env, ...args) => spawnSync(process.execPath, [LAUNCHER, ...args], { cwd, env, encoding: 'utf8' });
const OLD = fakePackage('0.0.9');
const CURRENT = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;

test('T1: each repo runs its own pinned copy', () => {
  const old = installed(OLD);
  const now = installed();
  assert.equal(mirai(old.root, old.env, 'version').stdout.trim(), '0.0.9');
  assert.equal(mirai(now.root, now.env, 'version').stdout.trim(), CURRENT);
  const status = mirai(old.root, old.env, 'status');
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /^repo: /);
});

test('T2: a copy that is neither the integration branch\'s nor the launcher\'s is refused', () => {
  const r = installed(OLD);
  // An agent's branch edits a framework file and the lock together: they agree, and are refused.
  git(r.root, 'checkout', '-q', '-b', 'agent/x');
  const file = '.mirai/framework/src/cli/commands/version.js';
  writeFileSync(join(r.root, file), `${readFileSync(join(r.root, file), 'utf8')}\nprocess.stdout.write('agent code ran\\n');\n`);
  const lock = readLock(r.root);
  lock.files.set(file, { ...lock.files.get(file), sha256: sha256(readFileSync(join(r.root, file))) });
  writeFileSync(join(r.root, '.mirai/mirai.lock'), lockText({ miraiVersion: lock.miraiVersion, source: lock.source, bundles: lock.bundles, files: [...lock.files.values()] }));
  git(r.root, 'commit', '-qam', 'agent edits MIRAI');
  const refused = mirai(r.root, r.env, 'version');
  assert.equal(refused.status, 4);
  assert.doesNotMatch(refused.stdout, /agent code ran/);
  assert.match(refused.stderr, /isn't the copy committed on main, nor this launcher's\nthis branch changed MIRAI's copy: read that change on the host first; to run it anyway: node \.mirai\/framework\/bin\/mirai\.js version/);
  // Running it by its path stays your explicit choice.
  const direct = spawnSync(process.execPath, [join(r.root, '.mirai/framework/bin/mirai.js'), 'version'], { cwd: r.root, env: r.env, encoding: 'utf8' });
  assert.match(direct.stdout, /agent code ran/);
  // On main, an edited (uncommitted) copy is refused too.
  git(r.root, 'checkout', '-q', 'main');
  writeFileSync(join(r.root, file), '// edited\n');
  const edited = mirai(r.root, r.env, 'status');
  assert.equal(edited.status, 4);
  assert.match(edited.stderr, /it was edited here; restore it: git checkout -- \.mirai/);
  git(r.root, 'checkout', '--', '.mirai');
  assert.equal(mirai(r.root, r.env, 'status').status, 0);
});

test('T3: right after init --refresh, before the commit, the copy is the launcher\'s own', () => {
  const r = installed(OLD);
  const refresh = mirai(r.root, r.env, 'init', '--refresh');
  assert.equal(refresh.status, 0, refresh.stderr);
  assert.match(refresh.stdout, /refreshed .* \(was 0\.0\.9\)/);
  const which = mirai(r.root, r.env, 'which');
  assert.match(which.stdout, /why: the same files as this launcher's MIRAI/);
  assert.equal(mirai(r.root, r.env, 'version').stdout.trim(), CURRENT);
  git(r.root, 'add', '-A');
  git(r.root, 'commit', '-qm', 'refresh');
  assert.match(mirai(r.root, r.env, 'which').stdout, /why: the copy committed on main/);
});

test('T4: outside a repo, and in a repo without MIRAI, only init, --version and --help', () => {
  const plain = tempDir('plain');
  const env = { PATH: process.env.PATH, HOME: tempDir('home') };
  assert.equal(mirai(plain, env, '--version').stdout.trim(), CURRENT);
  assert.match(mirai(plain, env, '--help').stdout, /mirai/);
  const status = mirai(plain, env, 'status');
  assert.equal(status.status, 4);
  assert.match(status.stderr, /not inside a git repository\nrun: mirai init/);
  const bare = tempDir('bare');
  git(bare, 'init', '-q', '-b', 'main');
  writeFileSync(join(bare, 'README.md'), '# x\n');
  git(bare, 'add', '-A');
  git(bare, 'commit', '-qm', 'first');
  assert.match(mirai(bare, env, 'lint').stderr, /MIRAI isn't installed in this repo\nrun: mirai init/);
  const done = mirai(bare, env, 'init', '--branch', 'main');
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /is installed in/);
});

test('T5: arguments, output and exit codes pass through', () => {
  const r = installed();
  const usage = mirai(r.root, r.env, 'lint', '--no-such-flag');
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /unknown option/);
  const ok = mirai(r.root, r.env, 'config', 'check');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^config OK/);
  const spaced = mirai(r.root, r.env, 'lint', 'no such file.md');
  assert.notEqual(spaced.status, 0);
  assert.match(spaced.stderr, /no such file\.md/);
  assert.equal(mirai(r.root, r.env, 'trust', 'check').status, 4); // no snapshot yet: refused, code passed on
});

test('T6: mirai which says which copy runs, and why', () => {
  const r = installed();
  const which = mirai(r.root, r.env, 'which');
  assert.equal(which.status, 0);
  assert.match(which.stdout, /^runs: .*\/Library\/Application Support\/mirai\/[^/]+\/store\/runtime\/[0-9a-f]{64}\/bin\/mirai\.js\nwhy: the copy committed on main \([0-9a-f]{12}\), run sealed from the store\n$/);
  const outside = mirai(tempDir('plain'), r.env, 'which', 'init');
  assert.match(outside.stdout, /^runs: .*bin\/mirai\.js\nwhy: init always runs this launcher's MIRAI\n$/);
  writeFileSync(join(r.root, '.mirai/framework/src/cli/main.js'), '// edited\n');
  const none = mirai(r.root, r.env, 'which');
  assert.equal(none.status, 4);
  assert.match(none.stdout, /^none may run here: /);
});

test('T7: a change to MIRAI\'s own code is auto-run', () => {
  const r = installed();
  writeFileSync(join(r.root, '.mirai/framework/src/x.js'), 'x\n');
  writeFileSync(join(r.root, '.mirai/mirai.lock'), `${readFileSync(join(r.root, '.mirai/mirai.lock'), 'utf8')} `);
  git(r.root, 'add', '-A');
  git(r.root, 'commit', '-qm', 'touch MIRAI');
  const rules = protectionRules(loadRegistry(join(PACKAGE_ROOT, 'registry')), { gate: {}, testing: {} });
  const v = classify({ change: changeOf({ root: r.root, env: r.env, base: 'HEAD~1', head: 'HEAD' }), rules });
  assert.deepEqual(v.autoRun, ['.mirai/framework/src/x.js', '.mirai/mirai.lock']);
});

test('T6b: the launcher\'s store cache is checked, never trusted', () => {
  // Two repos under one HOME: a's cache entry is pointed at b's store, by b's id.
  const home = tempDir('home');
  const a = installed(PACKAGE_ROOT, home);
  const b = installed(PACKAGE_ROOT, home);
  assert.equal(mirai(a.root, a.env, 'status').status, 0);
  assert.equal(mirai(b.root, b.env, 'status').status, 0);
  const cacheFile = join(home, 'Library/Application Support/mirai/launcher.json');
  const cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
  const idA = cache.checkouts[realpathSync(a.root)];
  const idB = cache.checkouts[realpathSync(b.root)];
  assert.match(idA, /-[0-9a-f]{12}$/);
  assert.notEqual(idA, idB);
  writeFileSync(cacheFile, JSON.stringify({ schema_version: 1, checkouts: { [realpathSync(a.root)]: idB } }), { mode: 0o600 });
  // b's record names b's checkout, so the entry is ignored, a's store is found again, and the
  // cache is put right.
  assert.match(mirai(a.root, a.env, 'which').stdout, /why: the copy committed on main/);
  assert.equal(JSON.parse(readFileSync(cacheFile, 'utf8')).checkouts[realpathSync(a.root)], idA);
  // A path, or anything that isn't a repo id, is never used.
  writeFileSync(cacheFile, JSON.stringify({ schema_version: 1, checkouts: { [realpathSync(a.root)]: tempDir('forged') } }), { mode: 0o600 });
  assert.match(mirai(a.root, a.env, 'which').stdout, /why: the copy committed on main/);
  // A broken cache is rebuilt.
  writeFileSync(cacheFile, '{', { mode: 0o600 });
  assert.equal(mirai(a.root, a.env, 'status').status, 0);
});


test('T2b: links, a forged cache and a newer lock are refused with their own reasons', () => {
  // A symbolic link inside the copy, even to an identical file, is never trusted.
  const r = installed();
  const file = '.mirai/framework/src/cli/commands/version.js';
  const outside = join(tempDir('outside'), 'version.js');
  writeFileSync(outside, readFileSync(join(r.root, file)));
  rmSync(join(r.root, file));
  symlinkSync(outside, join(r.root, file));
  const linked = mirai(r.root, r.env, 'which');
  assert.equal(linked.status, 4);
  assert.match(linked.stdout, /^none may run here: \.mirai\/framework isn't the copy committed on main/);
  rmSync(join(r.root, file));
  git(r.root, 'checkout', '--', '.mirai');
  // The cache holds repo ids only: a path to a forged store record anywhere is ignored.
  const forged = tempDir('forged');
  writeFileSync(join(forged, 'store.json'), JSON.stringify({ schema_version: 1, repo_id: 'x', roots: [], remote: null, checkout: realpathSync(r.root), integration_branch: 'agent/x' }));
  writeFileSync(join(r.env.HOME, 'Library/Application Support/mirai/launcher.json'), JSON.stringify({ schema_version: 1, checkouts: { [realpathSync(r.root)]: forged } }), { mode: 0o600 });
  assert.match(mirai(r.root, r.env, 'which').stdout, /why: the copy committed on main/);
  // A lock on main from a newer MIRAI (a higher schema, a new field) is read tolerantly: only
  // the framework entries count.
  const lock = JSON.parse(readFileSync(join(r.root, '.mirai/mirai.lock'), 'utf8'));
  writeFileSync(join(r.root, '.mirai/mirai.lock'), JSON.stringify({ ...lock, schema_version: 2, future: true }));
  git(r.root, 'commit', '-qam', 'a newer lock');
  assert.equal(mirai(r.root, r.env, 'version').status, 0);
  // --version still answers when the copy may not run, from the launcher, saying why.
  writeFileSync(join(r.root, '.mirai/framework/src/x.js'), 'x\n');
  const version = mirai(r.root, r.env, '--version');
  assert.equal(version.stdout.trim(), CURRENT);
  assert.match(version.stderr, /this repo's copy may not run/);
});

test('T2c: the hint says what to do on the integration branch and on another branch, quoted for the shell', () => {
  const r = installed();
  writeFileSync(join(r.root, '.mirai/framework/src/cli/main.js'), '// edited\n');
  assert.match(mirai(r.root, r.env, 'status').stderr, /it was edited here; restore it: git checkout -- \.mirai\n$/);
  git(r.root, 'checkout', '-q', '-b', 'feature/x');
  git(r.root, 'commit', '-qam', 'edit MIRAI');
  assert.match(mirai(r.root, r.env, 'lint', 'docs/my file.md').stderr, /this branch changed MIRAI's copy: read that change on the host first; to run it anyway: node \.mirai\/framework\/bin\/mirai\.js lint 'docs\/my file\.md'\n$/);
});

test('T9: the sealed copy runs committed bytes, and is built again when changed', () => {
  const r = installed();
  const which = mirai(r.root, r.env, 'which').stdout;
  const entry = /^runs: (.*)$/m.exec(which)[1];
  assert.equal(mirai(r.root, r.env, 'version').status, 0);
  // Built once, read-only, outside the work tree.
  assert.ok(!entry.startsWith(realpathSync(r.root)));
  assert.throws(() => writeFileSync(entry, 'x'), (err) => err.code === 'EACCES');
  // Changed: built again from git before it runs.
  const versionFile = join(entry, '..', '..', 'src/cli/commands/version.js');
  chmodSync(join(versionFile, '..'), 0o700);
  chmodSync(versionFile, 0o644);
  writeFileSync(versionFile, "process.stdout.write('tampered\\n');\n");
  const after = mirai(r.root, r.env, 'version');
  assert.equal(after.stdout.trim(), CURRENT);
  // A lock-only edit on a branch: the files are still main's, so main's copy runs.
  git(r.root, 'checkout', '-q', '-b', 'lock-only');
  writeFileSync(join(r.root, '.mirai/mirai.lock'), `${readFileSync(join(r.root, '.mirai/mirai.lock'), 'utf8')} `);
  git(r.root, 'commit', '-qam', 'lock only');
  assert.match(mirai(r.root, r.env, 'which').stdout, /why: the copy committed on main/);
});

test('T10: older bases (where the branch left main, origin/main) count; signing needs a committed copy', () => {
  // A feature branch cut before a refresh merged into main: it left main at the old copy.
  const r = installed(OLD);
  git(r.root, 'checkout', '-q', '-b', 'feature/old');
  writeFileSync(join(r.root, 'feature.txt'), 'x\n');
  git(r.root, 'add', '-A');
  git(r.root, 'commit', '-qm', 'feature work');
  git(r.root, 'checkout', '-q', 'main');
  init({ cwd: r.root, env: r.env, refresh: true });
  git(r.root, 'add', '-A');
  git(r.root, 'commit', '-qm', 'refresh');
  git(r.root, 'checkout', '-q', 'feature/old');
  assert.match(mirai(r.root, r.env, 'which').stdout, /why: the copy committed on main, where this branch left it/);
  assert.equal(mirai(r.root, r.env, 'version').stdout.trim(), '0.0.9');
  // Local main behind origin/main, on a branch rebased onto origin/main: origin's copy counts.
  const upstream = installed(OLD);
  const clone = join(tempDir('clone'), 'c');
  git(upstream.root, 'clone', '-q', `file://${upstream.root}`, clone);
  const c = { root: clone, env: { PATH: process.env.PATH, HOME: upstream.env.HOME } };
  init({ cwd: upstream.root, env: upstream.env, refresh: true });
  git(upstream.root, 'add', '-A');
  git(upstream.root, 'commit', '-qm', 'refresh upstream');
  git(clone, 'fetch', '-q');
  git(clone, 'checkout', '-q', '-b', 'rebased', 'origin/main');
  // Through the CLI, joining needs a real terminal; the library call is what it runs after your yes.
  assert.equal(mirai(clone, c.env, 'init', '--join').status, 5);
  assert.equal(joinStore({ cwd: clone, env: c.env }).branch, 'main');
  assert.match(mirai(clone, c.env, 'which').stdout, /why: the copy committed on origin\/main/);
  // An uncommitted refresh is the launcher's own copy: it runs, but not for signing.
  const fresh = installed(OLD);
  assert.equal(mirai(fresh.root, fresh.env, 'init', '--refresh').status, 0);
  assert.equal(mirai(fresh.root, fresh.env, 'status').status, 0);
  const sign = mirai(fresh.root, fresh.env, 'key', 'show');
  assert.equal(sign.status, 4);
  assert.match(sign.stderr, /key needs MIRAI's copy as committed on the integration branch; .*\ncommit the refresh on the integration branch first/);
});

test('T11: links and added files in the copy are refused; arguments and signals pass through', async () => {
  const r = installed();
  // A symbolic link for .mirai itself.
  const elsewhere = tempDir('elsewhere');
  cpSync(join(r.root, '.mirai'), join(elsewhere, '.mirai'), { recursive: true });
  rmSync(join(r.root, '.mirai'), { recursive: true });
  symlinkSync(join(elsewhere, '.mirai'), join(r.root, '.mirai'));
  assert.match(mirai(r.root, r.env, 'status').stderr, /\.mirai\/framework is a symbolic link, or inside one/);
  rmSync(join(r.root, '.mirai'));
  git(r.root, 'checkout', '--', '.mirai');
  // bin/mirai.js as a link to identical bytes, next to planted code.
  const planted = tempDir('planted');
  cpSync(join(r.root, '.mirai/framework'), planted, { recursive: true });
  writeFileSync(join(planted, 'src/cli/commands/version.js'), "export default { name: 'version', summary: 'x', usage: 'x', positionals: { min: 0, max: 0 }, options: {}, run(a, io) { io.stdout.write('PWNED\\n'); return 0; } };\n");
  rmSync(join(r.root, '.mirai/framework/bin/mirai.js'));
  symlinkSync(join(planted, 'bin/mirai.js'), join(r.root, '.mirai/framework/bin/mirai.js'));
  const linked = mirai(r.root, r.env, 'version');
  assert.equal(linked.status, 4);
  assert.doesNotMatch(linked.stdout, /PWNED/);
  rmSync(join(r.root, '.mirai/framework/bin/mirai.js'));
  git(r.root, 'checkout', '--', '.mirai');
  // An added file.
  writeFileSync(join(r.root, '.mirai/framework/src/extra.js'), 'x\n');
  assert.equal(mirai(r.root, r.env, 'status').status, 4);
  rmSync(join(r.root, '.mirai/framework/src/extra.js'));
  // One argument with spaces stays one argument.
  mkdirSync(join(r.root, 'docs/mirai/a b'), { recursive: true });
  writeFileSync(join(r.root, 'docs/mirai/a b/note.md'), '# x\n');
  const spaced = mirai(r.root, r.env, 'lint', 'docs/mirai/a b');
  assert.doesNotMatch(spaced.stderr, /"docs\/mirai\/a"|unknown/);
  // SIGTERM to the launcher reaches the command and comes back as the same signal.
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [LAUNCHER, 'trust', 'snapshot'], { cwd: r.root, env: r.env, stdio: 'ignore' });
  await new Promise((resolve) => setTimeout(resolve, 600));
  child.kill('SIGTERM');
  const signal = await new Promise((resolve) => child.on('exit', (code, sig) => resolve(sig ?? code)));
  assert.ok(signal === 'SIGTERM' || signal === 0, String(signal));
});

test('T12: init --join sets up only this machine\'s store, for the branch the committed config names', () => {
  const upstream = installed();
  const clone = join(tempDir('clone'), 'c');
  git(upstream.root, 'clone', '-q', `file://${upstream.root}`, clone);
  const env = { PATH: process.env.PATH, HOME: tempDir('home') };
  // Before: no store on this machine, so the launcher points to --join.
  assert.match(mirai(clone, env, 'status').stderr, /run: mirai init --join/);
  const before = execFileSync('git', ['status', '--porcelain'], { cwd: clone }).toString();
  assert.deepEqual(joinPlan({ cwd: clone, env }).branch, 'main');
  joinStore({ cwd: clone, env });
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: clone }).toString(), before, 'the repo is unchanged');
  assert.match(mirai(clone, env, 'which').stdout, /why: the copy committed on (main|origin\/main)/);
  assert.throws(() => joinPlan({ cwd: clone, env }), /already has a MIRAI store/);
  // A branch whose work-tree config names itself can't be joined as the integration branch.
  const other = join(tempDir('clone'), 'c');
  git(upstream.root, 'clone', '-q', `file://${upstream.root}`, other);
  git(other, 'checkout', '-q', '-b', 'agent/x');
  writeFileSync(join(other, '.mirai/config.toml'), readFileSync(join(other, '.mirai/config.toml'), 'utf8').replace('integration_branch = "main"', 'integration_branch = "agent/x"'));
  git(other, 'commit', '-qam', 'nominate myself');
  assert.throws(() => joinPlan({ cwd: other, env: { PATH: process.env.PATH, HOME: tempDir('home') }, branch: 'main' }), (err) => err.code === 'branch-mismatch' && /work tree's .*names "agent\/x"/.test(err.message));
  // Not installed: nothing to join.
  const bare = tempDir('bare');
  git(bare, 'init', '-q', '-b', 'main');
  assert.throws(() => joinPlan({ cwd: bare, env }), (err) => err.code === 'not-installed');
});
