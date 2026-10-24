import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

import { init } from '../../src/install/init.js';
import { readLock } from '../../src/install/lock.js';
import { openStore } from '../../src/store/home.js';
import { KEEP_SNAPSHOTS, openTrustRoot, snapshot, trustedConfig, trustedFile, trustedRegistry, verifyTrustRoot } from '../../src/trust/snapshot.js';
import { changeOf, classify, protectionRules } from '../../src/trust/protected.js';
import { main, COMMANDS } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';

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

// A repo with MIRAI installed and committed on main; `commit: false` leaves the install
// uncommitted.
function installed({ commit = true } = {}) {
  const root = tempDir('trust');
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), '# App\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'first');
  const env = { PATH: process.env.PATH, HOME: tempDir('home') };
  init({ cwd: root, env, branch: 'main' });
  if (commit) {
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'Install MIRAI');
  }
  return { root, env };
}
const trustHome = (r) => join(openStore({ cwd: r.root, env: r.env }).repoHome, 'trust');
const snapshots = (r) => (existsSync(trustHome(r)) ? readdirSync(trustHome(r)) : []);
const edit = (path, change) => {
  chmodSync(path, 0o644);
  writeFileSync(path, change(readFileSync(path, 'utf8')));
};

test('T5: the snapshot comes from the base commit, not the work tree', () => {
  const r = installed();
  const committedConfig = readFileSync(join(r.root, '.mirai/config.toml'), 'utf8');
  writeFileSync(join(r.root, '.mirai/framework/src/cli/main.js'), '// edited, not committed\n');
  writeFileSync(join(r.root, '.mirai/config.toml'), `${committedConfig}\n[docs]\nroot = "elsewhere"\n`);
  writeFileSync(join(r.root, '.mirai/context/untracked.md'), 'x\n');
  const t = snapshot({ cwd: r.root, env: r.env });
  assert.equal(t.baseSha, git(r.root, 'rev-parse', 'main'));
  assert.equal(t.reused, false);
  assert.equal(trustedFile(t, '.mirai/framework/src/cli/main.js').toString(), git(r.root, 'show', 'HEAD:.mirai/framework/src/cli/main.js') + '\n');
  assert.equal(trustedFile(t, '.mirai/config.toml').toString(), committedConfig);
  assert.equal(trustedConfig(t).docs.root, 'docs/mirai');
  assert.throws(() => trustedFile(t, '.mirai/context/untracked.md'), (err) => err.code === 'not-trusted');
  assert.ok(t.manifest.files.some((f) => f.path === 'tree/AGENTS.md') && t.manifest.files.some((f) => f.path === 'tree/CLAUDE.md'));
  // Its own plugin folder, matching what the base lock records.
  assert.deepEqual(t.manifest.bundles, readLock(r.root).bundles);
  assert.ok(existsSync(join(t.dir, 'plugins/claude-code/skills/mirai-docs/SKILL.md')));
  // Read-only, and outside the project.
  assert.ok(!t.dir.startsWith(r.root));
  assert.throws(() => writeFileSync(join(t.dir, 'tree/.mirai/config.toml'), 'x'), (err) => err.code === 'EACCES');
});

test('T6: a tampered trust-root file is detected; an untouched one is reused', () => {
  const r = installed();
  const t = snapshot({ cwd: r.root, env: r.env });
  assert.equal(snapshot({ cwd: r.root, env: r.env }).reused, true);
  assert.equal(openTrustRoot({ cwd: r.root, env: r.env }).manifestSha256, t.manifestSha256);
  const tampered = (fn, re) => {
    chmodSync(t.dir, 0o755);
    fn();
    assert.throws(() => verifyTrustRoot(t), (err) => err.code === 'trust-tampered' && re.test(err.message), String(re));
    assert.throws(() => snapshot({ cwd: r.root, env: r.env }), (err) => err.code === 'trust-tampered');
  };
  const file = join(t.dir, 'tree/.mirai/framework/registry/protected-paths/core.toml');
  const before = readFileSync(file);
  tampered(() => edit(file, (s) => s.replace('".github/workflows/**", ', '')), /core\.toml changed/);
  writeFileSync(file, before);
  chmodSync(file, 0o444);
  verifyTrustRoot(t);
  chmodSync(join(t.dir, 'tree'), 0o755);
  tampered(() => writeFileSync(join(t.dir, 'tree/extra.md'), 'x'), /tree\/extra\.md was added/);
  rmSync(join(t.dir, 'tree/extra.md'));
  const skill = join(t.dir, 'plugins/claude-code/skills/mirai-docs/SKILL.md');
  const skillBytes = readFileSync(skill);
  chmodSync(join(t.dir, 'plugins/claude-code/skills/mirai-docs'), 0o755);
  tampered(() => rmSync(skill), /SKILL\.md is missing/);
  writeFileSync(skill, skillBytes);
  chmodSync(skill, 0o444);
  verifyTrustRoot(t);
  tampered(() => edit(join(t.dir, 'manifest.json'), (s) => s.replace('"schema_version": 1', '"schema_version": 1 ')), /manifest changed/);

  // At most KEEP_SNAPSHOTS stay.
  const p = installed();
  for (let i = 0; i < KEEP_SNAPSHOTS + 2; i++) {
    snapshot({ cwd: p.root, env: p.env });
    writeFileSync(join(p.root, 'README.md'), `# App ${i}\n`);
    git(p.root, 'commit', '-qam', `change ${i}`);
  }
  const head = snapshot({ cwd: p.root, env: p.env });
  assert.equal(snapshots(p).filter((n) => !n.startsWith('.')).length, KEEP_SNAPSHOTS);
  assert.ok(snapshots(p).includes(head.baseSha));
});

test('T6b: the anchor is the base commit; snapshots are pinned, built one at a time, and the same twice', async () => {
  const r = installed();
  const t = snapshot({ cwd: r.root, env: r.env });
  // Rewriting a file, the manifest and the store's record together is still caught: a reused
  // snapshot is checked against the commit's own blobs.
  const store = openStore({ cwd: r.root, env: r.env });
  chmodSync(join(t.dir, 'tree/.mirai'), 0o755);
  const file = join(t.dir, 'tree/.mirai/config.toml');
  edit(file, (s) => `${s}\n[gate]\nprotected = []\n`);
  chmodSync(file, 0o444);
  chmodSync(t.dir, 0o755);
  const manifest = JSON.parse(readFileSync(join(t.dir, 'manifest.json'), 'utf8'));
  manifest.files.find((f) => f.path === 'tree/.mirai/config.toml').sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  edit(join(t.dir, 'manifest.json'), () => text);
  chmodSync(join(t.dir, 'manifest.json'), 0o444);
  const record = JSON.parse(readFileSync(join(store.dir, 'trust.json'), 'utf8'));
  record.snapshots[t.baseSha].manifest_sha256 = createHash('sha256').update(text).digest('hex');
  writeFileSync(join(store.dir, 'trust.json'), JSON.stringify(record));
  assert.throws(() => snapshot({ cwd: r.root, env: r.env }), (err) => err.code === 'trust-tampered' && /config\.toml differs from the base commit/.test(err.message));

  // A file made writable, or a folder added, counts as a change too.
  const p = installed();
  const u = snapshot({ cwd: p.root, env: p.env });
  chmodSync(join(u.dir, 'tree'), 0o755);
  chmodSync(join(u.dir, 'tree/AGENTS.md'), 0o644);
  assert.throws(() => verifyTrustRoot(u), /AGENTS\.md was made writable/);
  chmodSync(join(u.dir, 'tree/AGENTS.md'), 0o444);
  chmodSync(u.dir, 0o755);
  mkdirSync(join(u.dir, 'planted'));
  assert.throws(() => verifyTrustRoot(u), /planted\/ was added/);
  rmSync(join(u.dir, 'planted'), { recursive: true });

  // The same base gives the same manifest: no time in it.
  const again = installed();
  const a = snapshot({ cwd: again.root, env: again.env });
  makeWritable(a.dir);
  rmSync(a.dir, { recursive: true });
  const b = snapshot({ cwd: again.root, env: again.env });
  assert.equal(b.manifestSha256, a.manifestSha256);
  assert.equal(b.manifest.created_at, undefined);

  // A run's own base stays, and is opened by its id after main moves on.
  writeFileSync(join(again.root, 'README.md'), '# moved\n');
  git(again.root, 'commit', '-qam', 'moved');
  assert.equal(openTrustRoot({ cwd: again.root, env: again.env }), null);
  assert.equal(openTrustRoot({ cwd: again.root, env: again.env, baseSha: b.baseSha }).manifestSha256, b.manifestSha256);

  // Three processes building at once: one builds, the others wait and reuse it.
  const script = `import { snapshot } from ${JSON.stringify(new URL('../../src/trust/snapshot.js', import.meta.url).href)};
    try { console.log(snapshot({ cwd: process.argv[1], env: { PATH: process.env.PATH, HOME: process.env.HOME } }).manifestSha256); } catch (e) { console.log('ERR', e.code, e.message); }`;
  const run = () => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, again.root], { env: { PATH: process.env.PATH, HOME: again.env.HOME } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => resolve(out.trim()));
  });
  const results = await Promise.all([run(), run(), run()]);
  assert.equal(new Set(results).size, 1, results.join(' | '));
  assert.match(results[0], /^[0-9a-f]{64}$/);
  assert.match(execFileSync(process.execPath, [join(again.root, '.mirai/framework/bin/mirai.js'), 'trust', 'check'], { cwd: again.root, env: again.env }).toString(), /unchanged/);

  // Instruction files that aren't MIRAI's: a CLAUDE.md linking to AGENTS.md is skipped, not
  // refused, and nested ones and their imports are in the snapshot.
  const linked = installed();
  rmSync(join(linked.root, 'CLAUDE.md'));
  symlinkSync('AGENTS.md', join(linked.root, 'CLAUDE.md'));
  mkdirSync(join(linked.root, 'packages/api'), { recursive: true });
  writeFileSync(join(linked.root, 'packages/api/CLAUDE.md'), 'See @rules.md\n');
  writeFileSync(join(linked.root, 'packages/api/rules.md'), 'Run the tests.\n');
  init({ cwd: linked.root, env: linked.env, refresh: true });
  git(linked.root, 'add', '-A');
  git(linked.root, 'commit', '-qm', 'link and nested');
  const l = snapshot({ cwd: linked.root, env: linked.env });
  assert.deepEqual(l.manifest.skipped, ['CLAUDE.md']);
  assert.equal(trustedFile(l, 'packages/api/CLAUDE.md').toString(), 'See @rules.md\n');
  assert.equal(trustedFile(l, 'packages/api/rules.md').toString(), 'Run the tests.\n');
});

test('T7: the snapshot refuses a bad base, writing nothing', () => {
  const refused = (r, code) => {
    const before = snapshots(r);
    assert.throws(() => snapshot({ cwd: r.root, env: r.env }), (err) => err.code === code, code);
    assert.deepEqual(snapshots(r), before, `${code}: nothing written`);
  };
  refused(installed({ commit: false }), 'no-base-lock');
  const changed = installed();
  writeFileSync(join(changed.root, '.mirai/framework/src/cli/main.js'), '// committed edit\n');
  git(changed.root, 'commit', '-qam', 'edit the framework');
  refused(changed, 'base-framework-changed');
  const stale = installed();
  // A lock whose bundle hash isn't what the committed framework and config render (as after a
  // [models] change committed without mirai render, once an agent ships).
  const lock = JSON.parse(readFileSync(join(stale.root, '.mirai/mirai.lock'), 'utf8'));
  lock.bundles['claude-code'] = '0'.repeat(64);
  writeFileSync(join(stale.root, '.mirai/mirai.lock'), `${JSON.stringify(lock, null, 2)}\n`);
  git(stale.root, 'commit', '-qam', 'a lock out of date');
  refused(stale, 'stale-bundle');
  const linked = installed();
  symlinkSync('../../README.md', join(linked.root, '.mirai/context/link.md'));
  git(linked.root, 'add', '-A');
  git(linked.root, 'commit', '-qm', 'a link');
  refused(linked, 'base-symlink');
  // A local branch that isn't what its remote has: push or pull first.
  const upstream = installed();
  const clone = join(tempDir('clone'), 'c');
  git(upstream.root, 'clone', '-q', `file://${upstream.root}`, clone);
  const c = { root: clone, env: { PATH: process.env.PATH, HOME: tempDir('home') } };
  init({ cwd: clone, env: c.env, refresh: true });
  writeFileSync(join(clone, 'README.md'), '# Local only\n');
  git(clone, 'commit', '-qam', 'not pushed');
  refused(c, 'base-not-pushed');
});

test('T8: gates read the snapshot, not the work tree', () => {
  const r = installed();
  writeFileSync(join(r.root, '.mirai/config.toml'), `${readFileSync(join(r.root, '.mirai/config.toml'), 'utf8')}\n[gate]\nprotected = ["src/billing/**"]\n`);
  git(r.root, 'commit', '-qam', 'protect billing');
  const base = git(r.root, 'rev-parse', 'HEAD');
  const t = snapshot({ cwd: r.root, env: r.env });
  // The branch loosens the rules in the work tree: drops the addition, edits the core list.
  writeFileSync(join(r.root, '.mirai/config.toml'), readFileSync(join(r.root, '.mirai/config.toml'), 'utf8').replace(/\n\[gate\][^]*$/, '\n'));
  const builtin = join(r.root, '.mirai/framework/registry/protected-paths/core.toml');
  writeFileSync(builtin, readFileSync(builtin, 'utf8').replace('".github/workflows/**", ', ''));
  writeFileSync(join(r.root, 'src-billing.txt'), 'x');
  mkdirSync(join(r.root, 'src/billing'), { recursive: true });
  writeFileSync(join(r.root, 'src/billing/charge.js'), 'x\n');
  mkdirSync(join(r.root, '.github/workflows'), { recursive: true });
  writeFileSync(join(r.root, '.github/workflows/ci.yml'), 'x\n');
  const rules = protectionRules(trustedRegistry(t), trustedConfig(t));
  const v = classify({ change: changeOf({ root: r.root, env: r.env, base, rules }), rules });
  const paths = v.touched.map((x) => [x.path, x.rules.join(',')]);
  assert.ok(paths.some(([p, rule]) => p === 'src/billing/charge.js' && rule === 'project'), JSON.stringify(paths));
  assert.ok(paths.some(([p, rule]) => p === '.github/workflows/ci.yml' && rule === 'ci'), JSON.stringify(paths));
  assert.ok(paths.some(([p]) => p === '.mirai/config.toml') && paths.some(([p]) => p === '.mirai/framework/registry/protected-paths/core.toml'));
});

test('T11: mirai trust and mirai protected through the CLI', async () => {
  const r = installed();
  let out = '';
  let err = '';
  const io = { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: r.env, cwd: r.root };
  assert.equal(await main(['trust', 'check'], io, COMMANDS), EXIT.BLOCKED);
  assert.match(err, /run: mirai trust snapshot/);
  assert.equal(await main(['trust', 'snapshot'], io, COMMANDS), EXIT.OK, err);
  assert.match(out, /^trust root for main at [0-9a-f]{12}\n {2}folder: .*\/trust\/[0-9a-f]{40}\n {2}files: \d+, manifest [0-9a-f]{12}\n$/);
  out = '';
  assert.equal(await main(['trust', 'check'], io, COMMANDS), EXIT.OK, err);
  assert.match(out, /: unchanged \(\d+ files\)/);
  const t = openTrustRoot({ cwd: r.root, env: r.env });
  chmodSync(join(t.dir, 'tree'), 0o755);
  writeFileSync(join(t.dir, 'tree/planted.md'), 'x');
  err = '';
  assert.equal(await main(['trust', 'check'], io, COMMANDS), EXIT.BLOCKED);
  assert.match(err, /the trust root was changed \(tree\/planted\.md was added\)/);
  rmSync(join(t.dir, 'tree/planted.md'));
  assert.equal(await main(['trust', 'nope'], io, COMMANDS), EXIT.USAGE);

  // mirai protected: the work tree by default, or a range.
  out = '';
  assert.equal(await main(['protected'], io, COMMANDS), EXIT.OK, err);
  assert.equal(out, 'no protected paths touched\n');
  mkdirSync(join(r.root, '.vscode'));
  writeFileSync(join(r.root, '.vscode/tasks.json'), '{}\n');
  writeFileSync(join(r.root, 'Dockerfile'), 'FROM scratch\n');
  writeFileSync(join(r.root, 'eslint.config.js'), 'export default [];\n'); // no node pack here: ordinary code
  out = '';
  assert.equal(await main(['protected'], io, COMMANDS), EXIT.OK, err);
  assert.equal(out, 'auto-run   .vscode/tasks.json  (auto-run)\nprotected  Dockerfile  (containers-and-secrets)\nrisk: high; 1 run by themselves: read them on the host before you open the branch in your IDE\n');
  git(r.root, 'checkout', '-q', '-b', 'feature/x');
  git(r.root, 'add', '-A');
  git(r.root, 'commit', '-qm', 'touch configs');
  out = '';
  assert.equal(await main(['protected', 'main..feature/x'], io, COMMANDS), EXIT.OK, err);
  assert.match(out, /^auto-run {3}\.vscode\/tasks\.json/);
  assert.equal(await main(['protected', 'nonsense'], io, COMMANDS), EXIT.USAGE);
});
