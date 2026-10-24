import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, symlinkSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

import { init, FRAMEWORK_PARTS, PACKAGE_ROOT } from '../../src/install/init.js';
import { render } from '../../src/install/render.js';
import { readLock, checkLock, sha256, frameworkDigest, LOCK_FILE } from '../../src/install/lock.js';
import { blockOf, withBlock, localInstructions, BLOCK_BEGIN, BLOCK_END } from '../../src/install/agents-block.js';
import { openStore } from '../../src/store/home.js';
import { main, COMMANDS } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const tempDir = (name) => {
  const d = mkdtempSync(join(tmpdir(), `mirai-${name}-`));
  temps.push(d);
  return d;
};

// A temporary repo with one commit on `branch`, and a temporary HOME for the MIRAI home.
function repo({ branch = 'main', commit = true, files = {} } = {}) {
  const root = tempDir('init');
  git(root, 'init', '-q', '-b', branch);
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(root, p, '..'), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  if (commit) {
    if (Object.keys(files).length === 0) writeFileSync(join(root, 'README.md'), '# App\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'first');
  }
  const home = tempDir('home');
  return { root, home, env: { PATH: process.env.PATH, HOME: home } };
}

// Every file and folder under `dir` with its size, modification time and mode.
function snapshot(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const s = statSync(p);
      out.push(`${p.slice(dir.length)}${e.isDirectory() ? '/' : ''} ${s.size} ${s.mtimeMs} ${s.mode}`);
      if (e.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out.sort();
}

const run = (root, env, ...args) => spawnSync(process.execPath, [join(root, '.mirai/framework/bin/mirai.js'), ...args], { cwd: root, encoding: 'utf8', env });

test('T1: a fresh install writes the framework copy, its git rules, config, context, AGENTS.md, the lock and the store; the copy runs', () => {
  const { root, env } = repo();
  const r = init({ cwd: root, env, branch: 'main' });
  assert.deepEqual([r.branch, r.branchFrom], ['main', '--branch']);
  for (const p of ['.mirai/framework/bin/mirai.js', '.mirai/framework/src/cli/main.js', '.mirai/framework/registry/document-types/story.toml', '.mirai/framework/package.json', '.mirai/framework/LICENSE', '.mirai/.gitignore', '.mirai/.gitattributes', '.mirai/config.toml', '.mirai/context/agents-local.md', 'AGENTS.md', LOCK_FILE]) {
    assert.ok(existsSync(join(root, p)), p);
  }
  // Not tests, design or research.
  for (const p of ['.mirai/framework/test', '.mirai/framework/design', '.mirai/framework/research', '.mirai/framework/implementation']) assert.ok(!existsSync(join(root, p)), p);
  assert.match(readFileSync(join(root, '.mirai/config.toml'), 'utf8'), /^\[git\]\nintegration_branch = "main"$/m);
  assert.match(readFileSync(join(root, '.mirai/.gitignore'), 'utf8'), /^!\*$/m);
  assert.match(readFileSync(join(root, '.mirai/.gitattributes'), 'utf8'), /^\* -text$/m);
  // The store exists, with the integration branch pinned.
  assert.equal(openStore({ cwd: root, env }).meta.integration_branch, 'main');
  // The copy runs on its own, without the package: version, lint and status.
  const v = run(root, env, 'version');
  assert.equal(v.status, 0, v.stderr);
  assert.equal(v.stdout.trim(), JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version);
  for (const cmd of ['lint', 'status']) {
    const c = run(root, env, cmd);
    assert.equal(c.status, 0, `${cmd}: ${c.stderr}`);
  }
  // Ordinary permissions: readable files, executable only where MIRAI's are.
  assert.equal(statSync(join(root, '.mirai/framework/src/cli/main.js')).mode & 0o777, 0o644);
  assert.equal(statSync(join(root, '.mirai/config.toml')).mode & 0o777, 0o644);
  // Nothing staged is left behind, and git sees every new file (none ignored).
  assert.deepEqual(readdirSync(join(root, '.mirai')).filter((n) => n.startsWith('.init-')), []);
  assert.deepEqual(git(root, 'status', '--porcelain').split('\n').sort(), ['?? .claude/', '?? .mirai/', '?? AGENTS.md', '?? CLAUDE.md']);
});

test('T2: the lock lists every file with its mark; checkLock reports what changed', () => {
  const { root, env } = repo();
  init({ cwd: root, env, branch: 'main' });
  const lock = readLock(root);
  assert.equal(lock.source, 'local'); // this test runs from a MIRAI working copy
  const framework = [...lock.files.values()].filter((f) => f.mark === 'framework');
  assert.equal(lock.frameworkSha256, frameworkDigest(framework));
  // Every file of the framework copy, and the git rules, are in the lock with their hash.
  const copied = [];
  const walk = (d) => {
    for (const e of readdirSync(join(root, d), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${d}/${e.name}`);
      else copied.push(`${d}/${e.name}`);
    }
  };
  walk('.mirai/framework');
  assert.deepEqual(framework.map((f) => f.path).sort(), [...copied, '.mirai/.gitattributes', '.mirai/.gitignore'].sort());
  for (const f of framework) assert.equal(f.sha256, sha256(readFileSync(join(root, f.path))), f.path);
  // AGENTS.md is rendered: the block's hash, and what it was rendered from.
  const at = (p) => sha256(readFileSync(join(root, p)));
  assert.deepEqual(JSON.parse(JSON.stringify(lock.files.get('AGENTS.md'))), {
    path: 'AGENTS.md', mark: 'rendered', block: 'mirai', sha256: sha256(blockOf(readFileSync(join(root, 'AGENTS.md'), 'utf8'))),
    from: ['.mirai/config.toml', '.mirai/context/agents-local.md', '.mirai/framework/registry/templates/agents-block.md'].map((p) => ({ path: p, sha256: at(p) })),
  });
  assert.deepEqual({ ...lock.files.get('.mirai/config.toml') }, { path: '.mirai/config.toml', mark: 'project' });
  assert.deepEqual({ ...lock.files.get('.mirai/context/agents-local.md') }, { path: '.mirai/context/agents-local.md', mark: 'project' });
  const paths = JSON.parse(readFileSync(join(root, LOCK_FILE), 'utf8')).files.map((f) => f.path);
  assert.deepEqual(paths, [...paths].sort());

  assert.deepEqual(checkLock(root), { changed: [], missing: [], added: [] });
  // Your own files change freely; MIRAI's are reported.
  writeFileSync(join(root, '.mirai/config.toml'), `${readFileSync(join(root, '.mirai/config.toml'), 'utf8')}\n[docs]\nroot = "docs"\n`);
  writeFileSync(join(root, 'AGENTS.md'), `${readFileSync(join(root, 'AGENTS.md'), 'utf8')}\n# Mine\n`);
  assert.deepEqual(checkLock(root), { changed: [], missing: [], added: [] });
  writeFileSync(join(root, '.mirai/framework/src/cli/main.js'), '// edited\n');
  rmSync(join(root, '.mirai/framework/registry/README.md'));
  writeFileSync(join(root, '.mirai/framework/src/extra.js'), 'x');
  writeFileSync(join(root, 'AGENTS.md'), readFileSync(join(root, 'AGENTS.md'), 'utf8').replace('## MIRAI', '## MIRAI (edited)'));
  assert.deepEqual(checkLock(root), { changed: ['.mirai/framework/src/cli/main.js', 'AGENTS.md'].sort(), missing: ['.mirai/framework/registry/README.md'], added: ['.mirai/framework/src/extra.js'] });

  // checkLock never follows a symbolic link out of the repo.
  const elsewhere = tempDir('elsewhere');
  execFileSync('cp', ['-R', join(root, '.mirai/framework/registry'), join(elsewhere, 'registry')]);
  rmSync(join(root, '.mirai/framework/registry'), { recursive: true });
  symlinkSync(join(elsewhere, 'registry'), join(root, '.mirai/framework/registry'));
  assert.throws(() => checkLock(root), (err) => err.code === 'lock-symlink' && /registry is a symbolic link/.test(err.message));

  // A broken lock is refused; one from a newer MIRAI has its own code.
  const text = readFileSync(join(root, LOCK_FILE), 'utf8');
  writeFileSync(join(root, LOCK_FILE), text.replace(/"framework_sha256": "[0-9a-f]+"/, `"framework_sha256": "${'0'.repeat(64)}"`));
  assert.throws(() => readLock(root), (err) => err.code === 'lock-invalid' && /framework_sha256/.test(err.message));
  writeFileSync(join(root, LOCK_FILE), '{"schema_version": 2, "anything": true}');
  assert.throws(() => readLock(root), (err) => err.code === 'lock-newer' && err.exitCode === EXIT.CONFIG && /newer MIRAI/.test(err.message));
  writeFileSync(join(root, LOCK_FILE), '{"schema_version": 1, "schema_version": 2}');
  assert.throws(() => readLock(root), (err) => err.code === 'lock-invalid' && /can't be read/.test(err.message));
});

test('T3: AGENTS.md\'s MIRAI block is rendered, first; the rest of the file stays yours, byte for byte', () => {
  const mine = '# Our agents\n\nAlways run the linter.\n\n```md\n<!-- mirai:begin -->\nan example\n<!-- mirai:end -->\n```\n';
  const { root, env } = repo({ files: { 'AGENTS.md': mine, '.mirai/context/agents-local.md': '# Ours\n\n<!-- a note -->\nNever touch the billing schema.\n\n# Data\n\n```\n<!-- kept in a fence -->\n```\n' } });
  init({ cwd: root, env, branch: 'main' });
  const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  // The block goes first; the markers in your fenced example aren't taken for it.
  assert.ok(agents.startsWith(`${BLOCK_BEGIN}\n## MIRAI\n`));
  assert.ok(agents.endsWith(`${BLOCK_END}\n\n${mine}`));
  const block = blockOf(agents);
  assert.match(block, /Never touch the billing schema\./);
  assert.match(block, /# Data/); // only the first line is the title
  assert.match(block, /<!-- kept in a fence -->/);
  assert.doesNotMatch(block, /a note|# Ours|an example/);
  assert.match(block, /Documents live in `docs\/mirai\/`/);
  assert.match(block, /Agents never edit `\.mirai\/`, `AGENTS\.md` or `CLAUDE\.md`/);
  // Your own instructions file is kept as it was.
  assert.match(readFileSync(join(root, '.mirai/context/agents-local.md'), 'utf8'), /^# Ours\n\n<!-- a note -->/);
  // Rendering again replaces only the block, where it is.
  assert.equal(withBlock(agents, 'new body'), `${BLOCK_BEGIN}\nnew body\n${BLOCK_END}\n\n${mine}`);
  assert.equal(withBlock(`# Top\n\n${BLOCK_BEGIN}\nold\n${BLOCK_END}\ntail\n`, 'new'), `# Top\n\n${BLOCK_BEGIN}\nnew\n${BLOCK_END}\ntail\n`);
  // A CRLF file gets a CRLF block, and its hash is the same as the LF one; a byte-order mark stays first.
  const crlf = withBlock('# Ours\r\n\r\ntext\r\n', 'a\nb');
  assert.equal(crlf, `${BLOCK_BEGIN}\r\na\r\nb\r\n${BLOCK_END}\r\n\r\n# Ours\r\n\r\ntext\r\n`);
  assert.equal(blockOf(crlf), 'a\nb');
  assert.equal(withBlock('﻿# Ours\n', 'a'), `﻿${BLOCK_BEGIN}\na\n${BLOCK_END}\n\n# Ours\n`);
  // A marker indented, or not alone on its line, is your text.
  assert.equal(blockOf(`  ${BLOCK_BEGIN}\nx ${BLOCK_END}\n`), null);
  assert.equal(localInstructions('\n\n# Title\ntext <!-- gone --> kept\n'), 'text  kept');
  // A file with broken markers is refused, not guessed at.
  assert.throws(() => blockOf(`${BLOCK_BEGIN}\nx\n${BLOCK_BEGIN}\n${BLOCK_END}\n`), /broken MIRAI block/);
  const r2 = repo({ files: { 'AGENTS.md': `${BLOCK_END}\n${BLOCK_BEGIN}\n` } });
  assert.throws(() => init({ cwd: r2.root, env: r2.env, branch: 'main' }), /broken MIRAI block/);
  assert.ok(!existsSync(join(r2.root, '.mirai')));
  // The docs root is shown as it is ($ patterns are plain text); a backtick in it is refused.
  const dollar = repo({ files: { '.mirai/config.toml': 'schema_version = 1\n[git]\nintegration_branch = "main"\n[docs]\nroot = "docs/$&x"\n' } });
  init({ cwd: dollar.root, env: dollar.env });
  assert.match(blockOf(readFileSync(join(dollar.root, 'AGENTS.md'), 'utf8')), /Documents live in `docs\/\$&x\/`/);
  const tick = repo({ files: { '.mirai/config.toml': 'schema_version = 1\n[git]\nintegration_branch = "main"\n[docs]\nroot = "docs/a`b"\n' } });
  assert.throws(() => init({ cwd: tick.root, env: tick.env }), (err) => err.code === 'docs-root-backtick');
  assert.ok(!existsSync(join(tick.root, LOCK_FILE)));
});

test('T3b: the block\'s size: at most 8 KiB; a warning when AGENTS.md is over 32 KiB', () => {
  const big = repo({ files: { '.mirai/context/agents-local.md': `${'x'.repeat(9000)}\n` } });
  assert.throws(() => init({ cwd: big.root, env: big.env, branch: 'main' }), (err) => err.code === 'block-too-large' && err.exitCode === EXIT.BLOCKED);
  assert.ok(!existsSync(join(big.root, 'AGENTS.md')) && !existsSync(join(big.root, LOCK_FILE)));
  const long = repo({ files: { 'AGENTS.md': `# Ours\n\n${'y'.repeat(33 * 1024)}\n` } });
  const r = init({ cwd: long.root, env: long.env, branch: 'main' });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /AGENTS\.md is \d+ bytes; some tools read only the first 32768/);
});

test('T4: nothing is written under .git/', () => {
  const { root, env } = repo();
  const before = snapshot(join(root, '.git'));
  init({ cwd: root, env, branch: 'main' });
  assert.deepEqual(snapshot(join(root, '.git')), before);
});

test('T5: refusals, each with nothing written in the repo or the MIRAI home', () => {
  const refused = (r, opts, code) => {
    const before = snapshot(r.root);
    assert.throws(() => init({ cwd: r.root, env: r.env, ...opts }), (err) => err.code === code, code);
    assert.deepEqual(snapshot(r.root), before, `${code}: the repo is unchanged`);
    assert.deepEqual(readdirSync(r.env.HOME), [], `${code}: HOME is empty`);
  };

  const plain = tempDir('plain');
  refused({ root: plain, env: { PATH: process.env.PATH, HOME: tempDir('home') } }, {}, 'not-git');
  refused(repo({ commit: false }), { branch: 'main' }, 'no-commit');
  const full = repo();
  git(full.root, 'commit', '-q', '--allow-empty', '-m', 'second');
  const shallow = tempDir('shallow');
  git(shallow, 'clone', '-q', '--depth', '1', `file://${full.root}`, 'c');
  refused({ root: join(shallow, 'c'), env: full.env }, {}, 'shallow');

  const linked = repo();
  symlinkSync(tempDir('elsewhere'), join(linked.root, '.mirai'));
  refused(linked, { branch: 'main' }, 'symlink');
  const linkedAgents = repo({ files: { 'CLAUDE.md': '# Ours\n' } });
  symlinkSync('CLAUDE.md', join(linkedAgents.root, 'AGENTS.md'));
  assert.throws(() => init({ cwd: linkedAgents.root, env: linkedAgents.env, branch: 'main' }), (err) => err.code === 'symlink' && /CLAUDE\.md the link/.test(err.hint));
  const readOnly = repo({ files: { 'AGENTS.md': '# Ours\n' } });
  chmodSync(join(readOnly.root, 'AGENTS.md'), 0o444);
  refused(readOnly, { branch: 'main' }, 'not-writable');
  const latin1 = repo({ files: { 'AGENTS.md': Buffer.from([0x23, 0x20, 0xe9, 0x0a]) } });
  refused(latin1, { branch: 'main' }, 'not-utf8');
  refused(repo({ files: { '.mirai/.gitignore': 'secret\n' } }), { branch: 'main' }, 'git-rules');

  const installed = repo();
  init({ cwd: installed.root, env: installed.env, branch: 'main' });
  const lockBefore = readFileSync(join(installed.root, LOCK_FILE), 'utf8');
  assert.throws(() => init({ cwd: installed.root, env: installed.env, branch: 'main' }), (err) => err.code === 'installed' && /mirai render/.test(err.hint));
  assert.equal(readFileSync(join(installed.root, LOCK_FILE), 'utf8'), lockBefore);
  refused(repo({ files: { '.mirai/framework/x.js': 'x' } }), { branch: 'main' }, 'stray-framework');
  refused(repo(), { branch: 'release' }, 'no-branch');
  refused(repo(), { branch: 'bad..name' }, 'bad-branch');
});

test('T6: the integration branch: --branch, the config\'s, the remote\'s default; never just the current one', () => {
  // No --branch and no remote: refused, even though the repo sits on a branch.
  const trunk = repo({ branch: 'trunk' });
  assert.throws(() => init({ cwd: trunk.root, env: trunk.env }), (err) => err.code === 'no-branch' && /--branch main/.test(err.hint));
  // origin's default branch, in a clone that sits on another branch.
  const upstream = repo({ branch: 'develop' });
  const clone = tempDir('clone');
  git(clone, 'clone', '-q', `file://${upstream.root}`, 'c');
  git(join(clone, 'c'), 'checkout', '-q', '-b', 'feature/x');
  const r = init({ cwd: join(clone, 'c'), env: upstream.env });
  assert.deepEqual([r.branch, r.branchFrom], ['develop', 'origin/HEAD']);
  // The only remote, when it isn't called origin.
  const other = tempDir('other');
  git(other, 'clone', '-q', '-o', 'upstream', `file://${upstream.root}`, 'c');
  const r2 = init({ cwd: join(other, 'c'), env: { PATH: process.env.PATH, HOME: tempDir('home') } });
  assert.deepEqual([r2.branch, r2.branchFrom], ['develop', 'upstream/HEAD']);
  // A branch name with TOML's special characters is written so it reads back the same.
  const odd = repo();
  git(odd.root, 'branch', 'we"ird#x');
  assert.equal(init({ cwd: odd.root, env: odd.env, branch: 'we"ird#x' }).branch, 'we"ird#x');
  assert.match(readFileSync(join(odd.root, '.mirai/config.toml'), 'utf8'), /^integration_branch = "we\\"ird#x"$/m);
  assert.equal(openStore({ cwd: odd.root, env: odd.env }).meta.integration_branch, 'we"ird#x');
  // An existing valid config is kept as it is, and names the branch; a broken one, or one naming
  // another branch than --branch, is refused.
  const config = 'schema_version = 1\n\n[git]\nintegration_branch = "main"\n\n[docs]\nroot = "documentation"\n';
  const kept = repo({ files: { '.mirai/config.toml': config } });
  const r3 = init({ cwd: kept.root, env: kept.env });
  assert.deepEqual([r3.branch, r3.branchFrom], ['main', '.mirai/config.toml']);
  assert.equal(readFileSync(join(kept.root, '.mirai/config.toml'), 'utf8'), config);
  assert.match(blockOf(readFileSync(join(kept.root, 'AGENTS.md'), 'utf8')), /Documents live in `documentation\/`/);
  const broken = repo({ files: { '.mirai/config.toml': 'schema_version = 1\n[git]\nintegration_branch = "main"\n[docs]\nroot = "../x"\n' } });
  assert.throws(() => init({ cwd: broken.root, env: broken.env }), (err) => err.exitCode === EXIT.CONFIG);
  assert.ok(!existsSync(join(broken.root, LOCK_FILE)) && !existsSync(join(broken.root, '.mirai/framework')));
  const mismatch = repo({ files: { '.mirai/config.toml': 'schema_version = 1\n[git]\nintegration_branch = "main"\n' } });
  git(mismatch.root, 'branch', 'release');
  assert.throws(() => init({ cwd: mismatch.root, env: mismatch.env, branch: 'release' }), (err) => err.code === 'branch-mismatch');
});

test('T7: a failure partway undoes everything; an existing store is reused, but not for another branch', () => {
  // A .gitignore rule hides .mirai/: found after the files are in place, so all of it is undone,
  // and your AGENTS.md gets its bytes and mode back.
  const agents = Buffer.from('# Ours\r\n\r\nkept\r\n');
  const hidden = repo({ files: { '.gitignore': '.mirai/\n', 'AGENTS.md': agents } });
  chmodSync(join(hidden.root, 'AGENTS.md'), 0o640);
  const before = snapshot(hidden.root);
  assert.throws(() => init({ cwd: hidden.root, env: hidden.env, branch: 'main' }), (err) => err.code === 'ignored' && /git ignores MIRAI's files \(\.mirai\//.test(err.message));
  assert.ok(!existsSync(join(hidden.root, '.mirai')));
  assert.deepEqual(readFileSync(join(hidden.root, 'AGENTS.md')), agents);
  assert.equal(statSync(join(hidden.root, 'AGENTS.md')).mode & 0o777, 0o640);
  const others = (lines) => lines.filter((l) => !l.startsWith('/AGENTS.md') && !l.startsWith('/ '));
  assert.deepEqual(others(snapshot(hidden.root)), others(before));
  assert.deepEqual(readdirSync(hidden.home), []);
  // A rule that matches MIRAI's files by name, not .mirai/ itself, is undone by MIRAI's own rules.
  const named = repo({ files: { '.gitignore': '*.lock\n*.toml\n' } });
  init({ cwd: named.root, env: named.env, branch: 'main' });
  assert.match(git(named.root, 'status', '--porcelain', '--untracked-files=all'), /\?\? \.mirai\/mirai\.lock/);
  // The store can't be made (HOME isn't absolute): the new AGENTS.md is removed again.
  const noHome = repo();
  assert.throws(() => init({ cwd: noHome.root, env: { PATH: process.env.PATH, HOME: 'relative' }, branch: 'main' }));
  assert.ok(!existsSync(join(noHome.root, '.mirai')) && !existsSync(join(noHome.root, 'AGENTS.md')));
  // Installing again after the files were removed reuses this repo's store.
  const again = repo();
  init({ cwd: again.root, env: again.env, branch: 'main' });
  const store = openStore({ cwd: again.root, env: again.env }).repoHome;
  for (const p of ['.mirai', '.claude', 'AGENTS.md', 'CLAUDE.md']) rmSync(join(again.root, p), { recursive: true });
  git(again.root, 'branch', 'release');
  assert.throws(() => init({ cwd: again.root, env: again.env, branch: 'release' }), (err) => /set up for main/.test(err.message));
  assert.ok(!existsSync(join(again.root, '.mirai')) && existsSync(store));
  assert.equal(init({ cwd: again.root, env: again.env, branch: 'main' }).store, store);
});

test('T7b: mirai init through the CLI', async () => {
  const { root, env } = repo();
  let out = '';
  let err = '';
  const io = { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd: root };
  assert.equal(await main(['init', '--branch', 'main'], io, COMMANDS), EXIT.OK, err);
  assert.match(out, /^MIRAI \d+\.\d+\.\d+ is installed in /);
  assert.match(out, /integration branch: main \(from --branch\)/);
  assert.match(out, /commit them on main/);
  assert.match(out, /mirai key new/);
  err = '';
  assert.equal(await main(['init'], io, COMMANDS), EXIT.BLOCKED);
  assert.match(err, /already installed/);
  assert.equal(await main(['init', 'extra'], io, COMMANDS), EXIT.USAGE);
  // The framework parts are what the package ships.
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  for (const part of FRAMEWORK_PARTS) assert.ok(part === 'package.json' || pkg.files.includes(part), part);
});

test('T9: mirai render renders the block again from the installed copy and your files, and updates the lock', async () => {
  const agentsOf = (r) => r.files.filter((f) => f.path === 'AGENTS.md');
  const { root, env } = repo({ files: { 'AGENTS.md': '# Ours\n' } });
  init({ cwd: root, env, branch: 'main' });
  assert.deepEqual(agentsOf(render({ cwd: root, env })), [{ path: 'AGENTS.md', changed: false, edited: false }]);
  const lockBefore = readFileSync(join(root, LOCK_FILE), 'utf8');
  // Your instructions and the docs root change; render puts them in, and only the block changes.
  writeFileSync(join(root, '.mirai/context/agents-local.md'), 'Use pnpm, never npm.\n');
  writeFileSync(join(root, '.mirai/config.toml'), 'schema_version = 1\n\n[git]\nintegration_branch = "main"\n\n[docs]\nroot = "documentation"\n');
  assert.deepEqual(agentsOf(render({ cwd: root, env })), [{ path: 'AGENTS.md', changed: true, edited: false }]);
  const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  assert.match(blockOf(agents), /Use pnpm, never npm\.$/);
  assert.match(blockOf(agents), /Documents live in `documentation\/`/);
  assert.ok(agents.endsWith(`${BLOCK_END}\n\n# Ours\n`));
  const entry = readLock(root).files.get('AGENTS.md');
  assert.equal(entry.sha256, sha256(blockOf(agents)));
  assert.deepEqual({ ...entry.from.find((f) => f.path === '.mirai/context/agents-local.md') }, { path: '.mirai/context/agents-local.md', sha256: sha256('Use pnpm, never npm.\n') });
  assert.notEqual(readFileSync(join(root, LOCK_FILE), 'utf8'), lockBefore);
  assert.deepEqual(checkLock(root), { changed: [], missing: [], added: [] });
  // A block edited by hand is rendered again, and said so.
  writeFileSync(join(root, 'AGENTS.md'), agents.replace('## MIRAI', '## MIRAI, mine now'));
  assert.deepEqual(agentsOf(render({ cwd: root, env })), [{ path: 'AGENTS.md', changed: true, edited: true }]);
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), agents);
  // The template must be the framework's own.
  writeFileSync(join(root, '.mirai/framework/registry/templates/agents-block.md'), '## Mine\n');
  assert.throws(() => render({ cwd: root, env }), (err) => err.code === 'framework-changed');
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), agents);
  // Not installed: refused.
  const bare = repo();
  assert.throws(() => render({ cwd: bare.root, env: bare.env }), (err) => err.code === 'no-lock');
  // Through the CLI.
  const fresh = repo();
  init({ cwd: fresh.root, env: fresh.env, branch: 'main' });
  writeFileSync(join(fresh.root, '.mirai/context/agents-local.md'), 'Short.\n');
  let out = '';
  const io = { stdout: { write: (s) => (out += s) }, stderr: { write: () => {} }, env: fresh.env, cwd: fresh.root };
  assert.equal(await main(['render'], io, COMMANDS), EXIT.OK);
  assert.match(out, /^AGENTS\.md: rendered again\nCLAUDE\.md: unchanged\n(?:.*: unchanged\n)+Review and commit the change, with \.mirai\/mirai\.lock\.\n$/);
});
