import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  blobAt, catBlobs, changedNames, commitOf, configValue, envFiles, ignoredNames, ignoredPaths, isAncestor, isShallow, lsFiles, lsTree, mergeBase,
  refExists, remotes, rootCommits, setGitBinaryForTests, symbolicBranch, topLevel, treeId,
} from '../../src/store/git.js';
import { repoGuard, repoState } from '../../src/store/repo-state.js';
import { classifyRepoKey, allowEntryProblem } from '../../src/config/git-repo-keys.js';

// Unit 14b: pinned host git, the repo check and the integrity hash. Real git on temporary repos;
// nothing touches your real home or repos.

const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const tempDir = (name) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `mirai-14b-${name}-`)));
  temps.push(d);
  return d;
};
// Test-side git: never MIRAI's, with nothing from your config.
const tgit = (cwd, ...args) => execFileSync('/usr/bin/git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
  cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', HOME: '/var/empty', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
}).toString().trim();

function repo(files = { 'README.md': '# x\n' }) {
  const root = tempDir('repo');
  tgit(root, 'init', '-q', '-b', 'main');
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(root, p, '..'), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  tgit(root, 'add', '-A');
  tgit(root, 'commit', '-qm', 'first');
  const home = tempDir('home');
  return { root, env: { HOME: home, PATH: process.env.PATH, MIRAI_TEST_SECRET: 'canary-14b' } };
}

const refusal = (code, pattern) => (err) => err.code === code && (!pattern || pattern.test(err.message));

// A fake git that records each call (arguments and environment), then runs the real one.
function recordingGit() {
  const dir = tempDir('fake');
  const fake = join(dir, 'git');
  writeFileSync(fake, `#!/bin/sh\nf=$(/usr/bin/mktemp "${dir}/call.XXXXXX")\nprintf '%s\\n' "$@" > "$f"\n/usr/bin/env > "$f.env"\nexec /usr/bin/git "$@"\n`, { mode: 0o755 });
  const calls = () => readdirSync(dir).filter((n) => n.startsWith('call.') && !n.endsWith('.env')).map((n) => ({
    args: readFileSync(join(dir, n), 'utf8').split('\n').slice(0, -1),
    env: Object.fromEntries(readFileSync(join(dir, `${n}.env`), 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])),
  }));
  const reset = () => {
    for (const n of readdirSync(dir)) if (n.startsWith('call.')) rmSync(join(dir, n));
  };
  return { fake, calls, reset };
}

test('14b T1: every git.js call is pinned: binary, -c pins, the repo named, MIRAI\'s empty config and HOME, nothing from the caller; diffs carry the flags', () => {
  const r = repo({ 'README.md': '# x\n', 'sub/a.txt': 'a\n' });
  tgit(r.root, 'remote', 'add', 'origin', 'https://example.com/o/r.git');
  writeFileSync(join(r.root, 'new.txt'), 'n\n');
  const rec = recordingGit();
  const before = setGitBinaryForTests(rec.fake);
  try {
    const head = commitOf(r.root, 'HEAD', r.env);
    isShallow(r.root, r.env);
    rootCommits(r.root, 'main', r.env);
    refExists(r.root, 'refs/heads/main', r.env);
    configValue(r.root, 'core.bare', r.env);
    remotes(r.root, r.env);
    const tree = lsTree(r.root, 'main', 'README.md', r.env);
    treeId(r.root, 'main', 'sub', r.env);
    catBlobs(r.root, [tree[0].sha], r.env);
    lsFiles(r.root, ['.'], r.env);
    envFiles(r.root, r.env);
    symbolicBranch(r.root, 'HEAD', r.env);
    ignoredPaths(r.root, ['x.log'], r.env);
    changedNames(r.root, head, null, r.env);
    changedNames(r.root, head, head, r.env);
    ignoredNames(r.root, r.env);
    mergeBase(r.root, head, head, r.env);
    isAncestor(r.root, head, head, r.env);
    blobAt(r.root, 'main', 'README.md', r.env);
    const calls = rec.calls();
    const repoCalls = calls.filter((c) => !c.args.includes('--global'));
    assert.ok(repoCalls.length >= 20, `only ${repoCalls.length} calls`);
    for (const c of repoCalls) {
      const where = c.args.join(' ');
      assert.equal(c.args[0], '--no-replace-objects', where);
      for (const pin of ['core.hooksPath=/dev/null', 'core.fsmonitor=false', 'credential.helper=', 'protocol.ext.allow=never', 'gpg.ssh.program=/usr/bin/false']) {
        assert.ok(c.args.includes(pin), `${pin} missing: ${where}`);
      }
      assert.equal(c.env.GIT_CONFIG_NOSYSTEM, '1', where);
      assert.equal(c.env.GIT_CONFIG_GLOBAL, '/dev/null', where);
      assert.equal(c.env.HOME, '/var/empty', where);
      assert.equal(c.env.PATH, '/usr/bin:/bin', where);
      assert.equal(c.env.MIRAI_TEST_SECRET, undefined, where);
      // A call on the repo names it outright; reading one config file names none.
      if (c.args.includes('--list') && c.args.includes('--file')) assert.equal(c.env.GIT_DIR, undefined, where);
      else assert.deepEqual([c.env.GIT_DIR, c.env.GIT_WORK_TREE], [join(r.root, '.git'), r.root], where);
      if (c.args.includes('diff')) for (const f of ['--no-ext-diff', '--no-textconv', '--no-color']) assert.ok(c.args.includes(f), `${f}: ${where}`);
    }
    // The excludes path is read from your global config with your HOME, and nothing else of yours.
    const global = calls.filter((c) => c.args.includes('--global'));
    assert.equal(global.length, 1, 'read once per process');
    assert.deepEqual(global[0].args, ['config', '--global', '--type=path', '--get', 'core.excludesFile']);
    assert.equal(global[0].env.HOME, r.env.HOME);
    assert.equal(global[0].env.MIRAI_TEST_SECRET, undefined);
    // Nothing is written for the pins: no MIRAI home appears.
    assert.deepEqual(readdirSync(r.env.HOME), []);
  } finally {
    setGitBinaryForTests(before);
  }
});

test('14b T2: the pins need no folder: /dev/null and /var/empty; MIRAI refuses to run another git, and says where it looks', () => {
  const r = repo();
  const before = setGitBinaryForTests('/nonexistent/git');
  try {
    assert.throws(() => commitOf(r.root, 'HEAD', r.env), refusal('no-git', /not installed at \/nonexistent\/git/));
  } finally {
    setGitBinaryForTests(before);
  }
  assert.equal(commitOf(r.root, 'HEAD', r.env).length, 40);
  assert.ok(existsSync('/var/empty') && readdirSync('/var/empty').length === 0);
});

test('14b T3: the top folder is found by walking up, never by git; a .git file is refused; core.worktree moves nothing', () => {
  const r = repo({ 'README.md': '# x\n', 'a/b/c.txt': 'c\n' });
  assert.equal(topLevel(join(r.root, 'a', 'b')), r.root);
  assert.equal(topLevel(tempDir('plain')), null);
  // A worktree's .git is a file pointing at the main repo.
  const wt = join(tempDir('wt'), 'w');
  tgit(r.root, 'worktree', 'add', '-q', wt);
  assert.throws(() => topLevel(join(wt)), refusal('git-file', /is a file, not a folder/));
  tgit(r.root, 'worktree', 'remove', '--force', wt);
  // core.worktree pointing elsewhere: the walk doesn't read config, and the repo check refuses it.
  const elsewhere = tempDir('elsewhere');
  tgit(r.root, 'config', 'core.worktree', elsewhere);
  assert.equal(topLevel(join(r.root, 'a')), r.root);
  assert.throws(() => lsFiles(r.root, ['.'], r.env), refusal('repo-config', /core\.worktree, which moves the work tree/));
});

test('14b T4: known keys pass: the sample app\'s set, husky\'s hooksPath, gh and VS Code entries, the pinned ones', () => {
  const r = repo();
  for (const [k, v] of [['remote.origin.url', 'https://example.com/o/r.git'], ['remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'],
    ['branch.main.remote', 'origin'], ['branch.main.merge', 'refs/heads/main'], ['branch.main.vscode-merge-base', 'origin/main'],
    ['remote.origin.gh-resolved', 'base'], ['core.hooksPath', '.husky/_'], ['core.fsmonitor', 'true'], ['credential.helper', 'osxkeychain'],
    ['credential.https://example.com.username', 'me'], ['user.name', 'Me'], ['pull.rebase', 'true'], ['gpg.format', 'ssh'], ['commit.gpgSign', 'true'],
    ['diff.external', 'x'], ['color.ui', 'always'], ['status.showUntrackedFiles', 'no'], ['alias.co', '!echo hi'], ['gc.auto', '0'], ['http.proxy', 'http://p']]) {
    tgit(r.root, 'config', k, v);
  }
  assert.ok(lsFiles(r.root, ['.'], r.env).includes('README.md'));
  // The repo's own value, not the pin's (strict.js reads core.hooksPath to deny writes to it).
  assert.equal(configValue(r.root, 'core.hooksPath', r.env), '.husky/_');
  assert.deepEqual([...remotes(r.root, r.env)], [['origin', 'https://example.com/o/r.git']]);
  // The pins still win: a status that the repo would hide new files from lists them.
  writeFileSync(join(r.root, 'new.txt'), 'n\n');
  assert.ok(changedNames(r.root, 'HEAD', null, r.env).includes('new.txt'));
});

test('14b T5: never keys are refused before git runs on the repo, naming the file and the key (not its value)', () => {
  const r = repo();
  const rec = recordingGit();
  const before = setGitBinaryForTests(rec.fake);
  try {
    const never = [['include.path', '/nonexistent/x'], ['includeIf.gitdir:/x/.path', '/nonexistent/x'], ['filter.x.clean', 'touch /tmp/m'], ['merge.x.driver', 'touch /tmp/m'],
      ['diff.x.textconv', 'touch /tmp/m'], ['url.https://evil.example/.insteadOf', 'https://example.com/'], ['http.https://example.com/.proxy', 'http://evil'],
      ['core.worktree', '/tmp'], ['core.bare', 'true'], ['core.gitProxy', 'touch'], ['core.alternateRefsCommand', 'touch'],
      ['remote.origin.uploadpack', 'touch'], ['remote.origin.receivepack', 'touch'], ['remote.origin.proxy', 'http://evil'], ['remote.origin.vcs', 'x'],
      ['remote.origin.promisor', 'true'], ['remote.origin.partialCloneFilter', 'blob:none'], ['extensions.partialClone', 'origin'],
      ['protocol.allow', 'always'], ['uploadpack.packObjectsHook', 'touch'], ['receive.denyCurrentBranch', 'ignore'], ['submodule.x.url', '/nonexistent/x']];
    for (const [k, v] of never) {
      tgit(r.root, 'config', k, v);
      rec.reset();
      assert.throws(() => commitOf(r.root, 'HEAD', r.env), (err) => err.code === 'repo-config' && err.message.toLowerCase().includes(`.git/config sets ${k.toLowerCase()}`)
        && (v.length < 7 || !err.message.includes(v)), k);
      assert.deepEqual(rec.calls().filter((c) => c.env.GIT_DIR), [], `${k}: git ran on the repo`);
      if (k === 'core.bare') tgit(r.root, 'config', 'core.bare', 'false');
      else tgit(r.root, 'config', '--unset-all', k);
    }
    assert.equal(commitOf(r.root, 'HEAD', r.env).length, 40);
  } finally {
    setGitBinaryForTests(before);
  }
  // A credential in a key's URL is never printed, in the message or the hint (14b review).
  tgit(r.root, 'config', 'url.https://user:ghp_SECRET1234@github.com/.insteadOf', 'https://github.com/');
  assert.throws(() => commitOf(r.root, 'HEAD', r.env), (err) => err.code === 'repo-config' && !`${err.message}${err.hint}`.includes('ghp_SECRET1234')
    && err.message.includes('url.https://<redacted>@github.com/.insteadof'));
  tgit(r.root, 'config', '--remove-section', 'url.https://user:ghp_SECRET1234@github.com/');
  // A key with no value ([core] bare) counts as true.
  writeFileSync(join(r.root, '.git', 'config'), readFileSync(join(r.root, '.git', 'config'), 'utf8').replace(/\tbare = false\n/, '\tbare\n'));
  assert.throws(() => commitOf(r.root, 'HEAD', r.env), refusal('repo-config', /core\.bare/));
});

test('14b T6: unknown keys are refused unless you allow them; a never key can\'t be allowed; config.worktree is checked too', () => {
  const r = repo();
  tgit(r.root, 'config', 'difftool.x.cmd', 'touch /tmp/m');
  tgit(r.root, 'config', 'gitlens.something', 'x');
  assert.throws(() => commitOf(r.root, 'HEAD', r.env), (err) => err.code === 'repo-config' && /difftool\.x\.cmd, gitlens\.something, which MIRAI doesn't know/.test(err.message)
    && /allow_repo_config/.test(err.hint));
  const personal = join(r.env.HOME, '.config', 'mirai');
  mkdirSync(personal, { recursive: true });
  writeFileSync(join(personal, 'config.toml'), 'schema_version = 1\n[git]\nallow_repo_config = ["difftool.*", "GitLens.something"]\n');
  assert.equal(commitOf(r.root, 'HEAD', r.env).length, 40);
  // A change to your personal file makes the check run again.
  writeFileSync(join(personal, 'config.toml'), 'schema_version = 1\n[git]\nallow_repo_config = ["difftool.*", "filter.*"]\n');
  assert.throws(() => commitOf(r.root, 'HEAD', r.env), refusal('repo-config', /filter\.\* can never be allowed/));
  writeFileSync(join(personal, 'config.toml'), 'schema_version = 1\n[git]\nallow_repo_config = ["difftool.*", "gitlens.something"]\n');
  // config.worktree is checked whenever it exists, whatever extensions.worktreeConfig says: git
  // reads it with the bare key or any non-zero number too (14b review: a filter ran that way).
  writeFileSync(join(r.root, '.git', 'config.worktree'), '[filter "y"]\n\tclean = touch /tmp/m\n');
  assert.throws(() => commitOf(r.root, 'HEAD', r.env), refusal('repo-config', /\.git\/config\.worktree sets filter\.y\.clean/));
  for (const on of ['\tworktreeConfig\n', '\tworktreeConfig = 2\n']) {
    const w = repo({ 'README.md': '# x\n', '.gitattributes': '* filter=evil\n' });
    const mark = join(w.root, '..', 'wt-marker');
    tgit(w.root, 'config', 'core.repositoryformatversion', '1');
    writeFileSync(join(w.root, '.git', 'config'), `${readFileSync(join(w.root, '.git', 'config'), 'utf8')}[extensions]\n${on}`);
    writeFileSync(join(w.root, '.git', 'config.worktree'), `[filter "evil"]\n\tclean = sh -c 'echo x >> ${mark}; cat'\n`);
    writeFileSync(join(w.root, 'README.md'), '# changed\n');
    assert.throws(() => changedNames(w.root, 'HEAD', null, w.env), refusal('repo-config', /config\.worktree sets filter\.evil\.clean/), on);
    assert.equal(existsSync(mark), false, `the filter ran (${on.trim()})`);
  }
  // The classes themselves.
  assert.deepEqual(['branch.Feature/X.description', 'remote.up.pushurl', 'core.quotepath', 'init.defaultbranch'].map((k) => classifyRepoKey(k, 'x').cls), ['known', 'known', 'known', 'known']);
  assert.deepEqual(['lfs.url', 'filter.lfs.clean', 'svn-remote.svn.url', 'commit.template'].map((k) => classifyRepoKey(k, 'x').cls), ['lfs', 'lfs', 'unknown', 'unknown']);
  assert.deepEqual(['core.sparsecheckout', 'index.sparse', 'remote.pushdefault', 'maintenance.auto', 'diff.algorithm', 'gui.wmstate'].map((k) => classifyRepoKey(k, 'x').cls), Array(6).fill('known'));
  assert.deepEqual(['trailer.sign.command', 'trailer.sign.cmd', 'gpg.ssh.defaultkeycommand'].map((k) => classifyRepoKey(k, 'x').cls), ['never', 'never', 'never']);
  assert.deepEqual(['remote.*.url', 'difftool.x.cmd', 'diff.*', 'url.*', 'lfs.*', 'merge.x.driver', 'nodot', 'trailer.*', 'trailer.x.cmd'].map(allowEntryProblem),
    [null, null, 'diff.* is too wide: name the exact keys', 'url.* can never be allowed', 'lfs.* can never be allowed', 'merge.x.driver can never be allowed', 'use an exact key or a section such as "difftool.*"',
      'trailer.* is too wide: name the exact keys', 'trailer.x.cmd can never be allowed']);
});

test('14b T7: the shape: commondir, alternates, http-alternates, grafts, a linked config or info/hooks entry are each refused', () => {
  const r = repo();
  const g = join(r.root, '.git');
  for (const rel of ['commondir', 'objects/info/alternates', 'objects/info/http-alternates', 'info/grafts']) {
    writeFileSync(join(g, rel), '/elsewhere\n');
    assert.throws(() => commitOf(r.root, 'HEAD', r.env), refusal('repo-shape', new RegExp(`\\.git/${rel}`)), rel);
    rmSync(join(g, rel));
  }
  const target = join(tempDir('t'), 'x');
  writeFileSync(target, '');
  for (const rel of ['info/linked', 'hooks/pre-commit']) {
    symlinkSync(target, join(g, rel));
    assert.throws(() => commitOf(r.root, 'HEAD', r.env), refusal('repo-shape', /is a symbolic link/), rel);
    rmSync(join(g, rel));
  }
  // Whole folders linked elsewhere: objects or refs read from another repo (14b review).
  for (const rel of ['info', 'hooks', 'objects', 'refs']) {
    const moved = join(tempDir('moved'), rel);
    execFileSync('/bin/mv', [join(g, rel), moved]);
    symlinkSync(moved, join(g, rel));
    assert.throws(() => commitOf(r.root, 'HEAD', r.env), refusal('repo-shape', new RegExp(`\\.git/${rel} is a symbolic link`)), rel);
    rmSync(join(g, rel));
    execFileSync('/bin/mv', [moved, join(g, rel)]);
  }
  assert.equal(commitOf(r.root, 'HEAD', r.env).length, 40);
  const real = join(tempDir('cfg'), 'config');
  writeFileSync(real, readFileSync(join(g, 'config')));
  rmSync(join(g, 'config'));
  symlinkSync(real, join(g, 'config'));
  assert.throws(() => commitOf(r.root, 'HEAD', r.env), refusal('repo-shape', /config is not a file/));
});

test('14b T8: nested repos: a gitlink and an untracked nested repo are refused by lsFiles and changedNames; an ignored one is not', () => {
  const r = repo({ 'README.md': '# x\n', '.gitignore': 'vendor/\n' });
  const nested = join(r.root, 'vendor', 'pkg');
  mkdirSync(nested, { recursive: true });
  tgit(nested, 'init', '-q');
  assert.ok(lsFiles(r.root, ['.'], r.env).includes('README.md'));
  assert.deepEqual(changedNames(r.root, 'HEAD', null, r.env), []);
  const loose = join(r.root, 'tools', 'x');
  mkdirSync(loose, { recursive: true });
  tgit(loose, 'init', '-q');
  assert.throws(() => lsFiles(r.root, ['.'], r.env), refusal('repo-nested', /tools\/x is a nested git repo/));
  assert.throws(() => changedNames(r.root, 'HEAD', null, r.env), refusal('repo-nested'));
  rmSync(join(r.root, 'tools'), { recursive: true });
  tgit(r.root, 'update-index', '--add', '--cacheinfo', `160000,${commitOf(r.root, 'HEAD', r.env)},lib/sub`);
  assert.throws(() => lsFiles(r.root, ['.'], r.env), refusal('repo-nested', /lib\/sub is a submodule/));
  assert.throws(() => changedNames(r.root, 'HEAD', null, r.env), refusal('repo-nested'));
});

test('14b T9: Git LFS is refused, whichever way it shows', () => {
  const lfs = /Git LFS/;
  const a = repo({ 'README.md': '# x\n', '.gitattributes': '*.bin filter=lfs diff=lfs merge=lfs -text\n' });
  assert.throws(() => commitOf(a.root, 'HEAD', a.env), refusal('repo-lfs', /\.gitattributes names filter=lfs/));
  const b = repo({ 'README.md': '# x\n', 'assets/.gitattributes': '*.psd filter=lfs\n' });
  assert.throws(() => commitOf(b.root, 'HEAD', b.env), refusal('repo-lfs', /assets\/\.gitattributes/));
  const c = repo();
  writeFileSync(join(c.root, '.lfsconfig'), '[lfs]\n');
  assert.throws(() => commitOf(c.root, 'HEAD', c.env), refusal('repo-lfs', lfs));
  const d = repo();
  writeFileSync(join(d.root, '.git', 'info', 'attributes'), '*.zip filter=lfs\n');
  assert.throws(() => commitOf(d.root, 'HEAD', d.env), refusal('repo-lfs', /info\/attributes/));
  for (const [k, v] of [['lfs.url', 'https://example.com'], ['filter.lfs.clean', 'git-lfs clean -- %f']]) {
    const e = repo();
    tgit(e.root, 'config', k, v);
    assert.throws(() => commitOf(e.root, 'HEAD', e.env), refusal('repo-lfs', new RegExp(k.replace(/\./g, '\\.'))), k);
  }
  // Prose that mentions LFS isn't LFS.
  const f = repo({ 'README.md': '# x\n', '.gitattributes': '# we dropped filter=lfs-like tools\n*.sh text eol=lf\n' });
  assert.equal(commitOf(f.root, 'HEAD', f.env).length, 40);
});

test('14b T10: the integrity hash covers what can run code or redirect git, and the local refs; not fetches, the index or objects', () => {
  const changes = {
    config: (r) => tgit(r.root, 'config', 'user.name', 'x'),
    'config.worktree': (r, g) => writeFileSync(join(g, 'config.worktree'), '[user]\n'),
    info: (r, g) => writeFileSync(join(g, 'info', 'exclude'), '*.tmp\n'),
    'objects/info': (r, g) => writeFileSync(join(g, 'objects', 'info', 'alternates'), '/x\n'),
    commondir: (r, g) => writeFileSync(join(g, 'commondir'), '/x\n'),
    shallow: (r, g) => writeFileSync(join(g, 'shallow'), `${'a'.repeat(40)}\n`),
    hooks: (r, g) => writeFileSync(join(g, 'hooks', 'post-merge'), '#!/bin/sh\n'),
    HEAD: (r, g) => writeFileSync(join(g, 'HEAD'), 'ref: refs/heads/other\n'),
    refs: (r) => tgit(r.root, 'branch', 'side'),
    'refs/replace': (r, g) => {
      mkdirSync(join(g, 'refs', 'replace'), { recursive: true });
      writeFileSync(join(g, 'refs', 'replace', tgit(r.root, 'rev-parse', 'HEAD')), `${tgit(r.root, 'rev-parse', 'HEAD:README.md')}\n`);
    },
    worktrees: (r, g) => mkdirSync(join(g, 'worktrees', 'w'), { recursive: true }),
    modules: (r, g) => mkdirSync(join(g, 'modules', 'm'), { recursive: true }),
    remotes: (r, g) => writeFileSync(join(g, 'remotes', 'origin'), 'URL: /x\n', { flag: 'w' }),
  };
  for (const [part, change] of Object.entries(changes)) {
    const r = repo();
    if (part === 'remotes') mkdirSync(join(r.root, '.git', 'remotes'));
    const guard = repoGuard(r.root);
    change(r, join(r.root, '.git'));
    assert.throws(() => guard.check(), (err) => err.code === 'repo-changed' && /\(([^)]*)\)$/.exec(err.message)[1].split(', ').includes(part), part);
    guard.accept();
    guard.check();
    guard.release();
  }
  const r = repo();
  const g = join(r.root, '.git');
  // packed-refs: a local branch counts, a remote-tracking one doesn't.
  const before = repoState(r.root);
  const head = tgit(r.root, 'rev-parse', 'HEAD');
  writeFileSync(join(g, 'packed-refs'), `# pack-refs with: peeled fully-peeled sorted\n${head} refs/remotes/origin/main\n`);
  mkdirSync(join(g, 'refs', 'remotes', 'origin'), { recursive: true });
  writeFileSync(join(g, 'refs', 'remotes', 'origin', 'dev'), `${head}\n`);
  writeFileSync(join(g, 'FETCH_HEAD'), `${head}\t\tbranch 'main' of x\n`);
  writeFileSync(join(g, 'objects', 'info', 'packs'), 'P pack-x.pack\n');
  writeFileSync(join(r.root, 'README.md'), 'changed\n');
  tgit(r.root, 'add', 'README.md'); // the index and a new object
  assert.equal(repoState(r.root).hash, before.hash);
  writeFileSync(join(g, 'packed-refs'), `# pack-refs with: peeled fully-peeled sorted\n${head} refs/heads/packed\n`);
  assert.notEqual(repoState(r.root).parts.refs, before.parts.refs);
  // Routine git activity changes nothing: pack-refs, gc, a new tag (14b review).
  const q = repo();
  tgit(q.root, 'branch', 'feature');
  const quiet = repoGuard(q.root);
  try {
    tgit(q.root, 'pack-refs', '--all');
    quiet.check();
    tgit(q.root, 'tag', 'v1');
    tgit(q.root, 'gc', '--quiet');
    quiet.check();
    // A loose ref wins over its packed line, as in git.
    tgit(q.root, 'update-ref', 'refs/heads/feature', 'HEAD~0');
    quiet.check();
    writeFileSync(join(q.root, 'b.txt'), 'b\n');
    tgit(q.root, 'add', 'b.txt');
    tgit(q.root, 'commit', '-qm', 'second');
    tgit(q.root, 'update-ref', 'refs/heads/feature', 'HEAD');
    assert.throws(() => quiet.check(), refusal('repo-changed', /refs/));
  } finally {
    quiet.release();
  }
});

test('14b T11: while a guard is active, every git call checks it first', () => {
  const r = repo();
  const guard = repoGuard(r.root);
  try {
    assert.equal(commitOf(r.root, 'HEAD', r.env).length, 40);
    tgit(r.root, 'config', 'user.email', 'someone@example.com'); // a known key: only the guard can catch it
    assert.throws(() => commitOf(r.root, 'HEAD', r.env), refusal('repo-changed', /\(config\)/));
  } finally {
    guard.release();
  }
  assert.equal(commitOf(r.root, 'HEAD', r.env).length, 40);
  // Two guards on one repo: releasing one leaves the other checking (14b review).
  const a = repoGuard(r.root);
  const b = repoGuard(r.root);
  b.release();
  writeFileSync(join(r.root, '.git', 'hooks', 'post-commit'), '#!/bin/sh\n');
  assert.throws(() => commitOf(r.root, 'HEAD', r.env), refusal('repo-changed', /hooks/));
  // Another spelling of the same checkout is the same checkout.
  const other = r.root.replace(/^\/private\/var\//, '/var/');
  assert.notEqual(other, r.root);
  assert.throws(() => commitOf(other, 'HEAD', r.env), refusal('repo-changed'));
  a.release();
  assert.equal(commitOf(r.root, 'HEAD', r.env).length, 40);
});

test('14b T12: today\'s behaviour is kept: your global excludes still apply (unless inside the checkout, in any case); configValue reads the repo\'s own files', () => {
  const r = repo({ 'README.md': '# x\n' });
  writeFileSync(join(r.root, 'x.local'), 'mine\n');
  writeFileSync(join(r.root, 'kept.txt'), 'new\n');
  // git's default place, ~/.config/git/ignore.
  mkdirSync(join(r.env.HOME, '.config', 'git'), { recursive: true });
  writeFileSync(join(r.env.HOME, '.config', 'git', 'ignore'), '*.local\n');
  assert.deepEqual(lsFiles(r.root, ['.'], r.env).sort(), ['README.md', 'kept.txt']);
  assert.deepEqual(changedNames(r.root, 'HEAD', null, r.env), ['kept.txt']);
  assert.deepEqual(ignoredPaths(r.root, ['x.local', 'kept.txt'], r.env), ['x.local']);
  // core.excludesFile in your global config (another process: the path is read once per process).
  const s = repo({ 'README.md': '# x\n' });
  writeFileSync(join(s.root, 'y.mine'), 'mine\n');
  writeFileSync(join(s.env.HOME, 'my-ignore'), '*.mine\n');
  writeFileSync(join(s.env.HOME, '.gitconfig'), '[core]\n\texcludesFile = ~/my-ignore\n');
  const script = `import { lsFiles } from ${JSON.stringify(new URL('../../src/store/git.js', import.meta.url).href)};
    process.stdout.write(JSON.stringify(lsFiles(${JSON.stringify(s.root)}, ['.'], ${JSON.stringify(s.env)})));`;
  const listed = (env) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env }).toString());
  assert.deepEqual(listed({ PATH: process.env.PATH }), ['README.md']);
  // An excludes file inside the checkout is not used: a branch could hide its own files with it.
  writeFileSync(join(s.env.HOME, '.gitconfig'), `[core]\n\texcludesFile = ${join(s.root, 'ignore-me')}\n`);
  writeFileSync(join(s.root, 'ignore-me'), '*.mine\n');
  assert.deepEqual(listed({ PATH: process.env.PATH }).sort(), ['README.md', 'ignore-me', 'y.mine']);
  // The same, written in another case (the Mac's disk ignores case; 14b review).
  const upper = join(s.root.slice(0, s.root.lastIndexOf('/')), s.root.slice(s.root.lastIndexOf('/') + 1).toUpperCase(), 'ignore-me');
  writeFileSync(join(s.env.HOME, '.gitconfig'), `[core]\n\texcludesFile = ${upper}\n`);
  assert.deepEqual(listed({ PATH: process.env.PATH }).sort(), ['README.md', 'ignore-me', 'y.mine']);
  // strict.js reads core.hooksPath to deny writes to it: the repo's value, also from config.worktree.
  const h = repo();
  tgit(h.root, 'config', 'core.hooksPath', '.husky/_');
  assert.equal(configValue(h.root, 'core.hooksPath', h.env), '.husky/_');
  writeFileSync(join(h.root, '.git', 'config.worktree'), '[core]\n\thooksPath = githooks\n');
  assert.equal(configValue(h.root, 'core.hooksPath', h.env), 'githooks');
});
