import { execFileSync } from 'node:child_process';
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { globalConfigPath, personalRepoConfigAllow } from '../config/load.js';
import { DIFF_FLAGS, excludesFor, pinArgs, pinEnv } from './git-pins.js';
import { checkConfig, checkLfs, checkNested, checkShape, configSignature, gitFileError, parseConfigList } from './repo-check.js';
import { checkGuards } from './repo-state.js';
import { parseDiff } from '../tests/diff.js';

// The git calls MIRAI makes on your machine. Since unit 14b every one is pinned (D-54;
// src/store/git-pins.js, probed in unit 14a): `/usr/bin/git` only, never a shell, the repo
// named outright (GIT_DIR/GIT_WORK_TREE), MIRAI's empty global config, hooks folder and HOME,
// the `-c` pins, replace refs off, a time and output limit. Before the first call on a checkout
// (and again when its config changes) the repo check runs (src/store/repo-check.js): keys the
// pins can't switch off are refused before git ever reads them. While a run's guard is active
// (src/store/repo-state.js), each call first checks that `.git` hasn't changed.
//
// Calls used: `rev-parse`, `rev-list`, `config --file`, (unit 06) `ls-tree` / `cat-file`,
// (unit 07b) `ls-files`, (unit 10) `symbolic-ref` and `check-ignore`, (unit 12) `diff
// --name-only` and `merge-base`, (unit 13b) `ls-files` for `.env*` files, (unit 16b) `diff -U0`,
// (unit 17a) `for-each-ref` and `log`. A new call needs its own probe (test/probes/git-probes.js
// --mirai).

const TIMEOUT_MS = 10_000;
const MAX_OUTPUT = 1024 * 1024;

// The only git binary MIRAI runs (14b, your decision): the one 14a probed. Tests swap it.
let gitBinary = '/usr/bin/git';
export function setGitBinaryForTests(path) {
  const before = gitBinary;
  gitBinary = path;
  checked.clear();
  return before;
}

// Checkouts whose repo check passed in this process, with what it depended on.
const checked = new Map();

function exec(cwd, args, env, { timeout = TIMEOUT_MS, raw = false, input, maxBuffer = MAX_OUTPUT } = {}) {
  try {
    const out = execFileSync(gitBinary, args, {
      cwd,
      env,
      encoding: raw ? 'buffer' : 'utf8',
      timeout,
      maxBuffer,
      ...(input !== undefined ? { input } : {}),
      stdio: [input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: raw ? out : out.trim() };
  } catch (err) {
    if (err.code === 'ENOENT') {
      if (!existsSync(gitBinary)) throw new StoreError(`git is not installed at ${gitBinary}`, { code: 'no-git', hint: 'MIRAI runs only that git (on macOS: xcode-select --install)' });
      throw new StoreError(`${cwd} doesn't exist`, { path: cwd, code: 'no-folder' });
    }
    if (err.code === 'ENOBUFS') throw new StoreError(`git ${args.find((a) => !a.startsWith('-') && !a.includes('=')) ?? ''} wrote more than MIRAI reads at once`, { code: 'git-output-too-large' });
    if (err.signal) throw new StoreError(`git took longer than ${timeout / 1000} s`, { code: 'git-timeout' });
    return { ok: false, status: err.status, out: String(err.stdout ?? '').trim() };
  }
}

// A pinned call outside any repo (reading one config file): no GIT_DIR, run in `/`.
function pinnedNoRepo(args, opts) {
  return exec('/', ['--no-replace-objects', ...pinArgs(), ...args], pinEnv(), opts);
}

// One pinned call on the checkout `root` (its top folder).
function pinned(root, args, env, opts) {
  const { path: excludesFile } = excludesFor(env, root, gitBinary);
  return exec(root, ['--no-replace-objects', ...pinArgs({ excludesFile }), ...args], pinEnv({ top: root }), opts);
}

// The repo check for `root`: the shape on every call (a few lstats), the config and LFS check
// when what they read has changed.
export function checkRepo(root, env) {
  checkShape(root);
  const sig = `${configSignature(root)}|${statSignature(globalConfigPath(env.HOME ?? '/nonexistent'))}`;
  if (checked.get(root) === sig) return;
  const listConfig = (file) => {
    const r = pinnedNoRepo(['config', '--file', file, '--list', '--null'], { raw: true });
    if (!r.ok) throw new StoreError(`${file}: git can't read it`, { path: file, code: 'repo-config', hint: 'check the file with: git config --file <it> --list' });
    return parseConfigList(r.out);
  };
  checkConfig(root, { listConfig, allow: personalRepoConfigAllow(env.HOME) });
  checkLfs(root, {
    attributeFiles: () => {
      const r = pinned(root, ['ls-files', '-z', '--cached', '--', ':(glob)**/.gitattributes'], env, { raw: true, maxBuffer: 16 * MAX_OUTPUT });
      if (!r.ok) throw new StoreError('git ls-files failed', { code: 'git-failed' });
      return nulList(r.out);
    },
  });
  checked.set(root, sig);
}

// What `mirai trust` shows about MIRAI's git on a checkout whose repo check passed.
export function pinnedGitInfo(root, env) {
  checkRepo(root, env);
  return { binary: gitBinary, excludes: excludesFor(env, root, gitBinary) };
}

function statSignature(path) {
  try {
    const s = statSync(path);
    return `${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
  } catch {
    return '-';
  }
}

function git(root, args, env, opts) {
  // The guard first: a change during a run is reported as one (repo-changed).
  checkGuards(root);
  checkRepo(root, env);
  return pinned(root, args, env, opts);
}

// The checkout's top folder (its real path), or null when `cwd` is not inside one: the first
// folder up from `cwd` holding `.git`. Found without git, so a `core.worktree` can't move it;
// a `.git` that is a file (a worktree, a submodule, a link to another repo) is refused.
export function topLevel(cwd) {
  let dir;
  try {
    dir = realpathSync(cwd);
  } catch {
    return null;
  }
  for (;;) {
    let info = null;
    try {
      info = lstatSync(join(dir, '.git'));
    } catch {
      // not here
    }
    if (info?.isDirectory()) return dir;
    if (info?.isFile()) throw gitFileError(join(dir, '.git'));
    if (info?.isSymbolicLink()) throw new StoreError(`${join(dir, '.git')} is a symbolic link`, { path: join(dir, '.git'), code: 'git-file', exitCode: EXIT.BLOCKED, hint: 'MIRAI runs in the main checkout of a repo, whose .git is a real folder' });
    if (info) return null; // something else: not a checkout MIRAI runs in
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function isShallow(root, env) {
  const r = git(root, ['rev-parse', '--is-shallow-repository'], env);
  return r.ok && r.out === 'true';
}

// The root commits of `ref`, sorted; null when the ref doesn't exist or has no commits. This
// walks the whole history, so it gets more time than the other calls.
export function rootCommits(root, ref, env) {
  const r = git(root, ['rev-list', '--max-parents=0', ref, '--'], env, { timeout: 60_000 });
  if (!r.ok || r.out === '') return null;
  const roots = r.out.split('\n').sort();
  if (!roots.every((sha) => /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha))) {
    throw new StoreError('git returned something that is not a commit id', { code: 'git-output' });
  }
  return roots;
}

export function refExists(root, ref, env) {
  return git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], env).ok;
}

// One config value from the repo's own config files (config.worktree first, as git reads it
// when that file is in use), or null. Read by file, so a pin never hides the repo's value (unit
// 14b); includes are refused by the repo check anyway.
export function configValue(root, key, env) {
  for (const file of ['config.worktree', 'config']) {
    if (file === 'config.worktree' && !existsSync(join(root, '.git', file))) continue;
    const r = git(root, ['config', '--file', join(root, '.git', file), '--get', key], env);
    if (r.ok && r.out !== '') return r.out;
  }
  return null;
}

// The remotes with a URL, from the repo's own config file: a Map from name to its (first) URL.
export function remotes(root, env) {
  const r = git(root, ['config', '--file', join(root, '.git', 'config'), '--null', '--get-regexp', '^remote\\..*\\.url$'], env);
  const found = new Map();
  if (!r.ok) return found;
  for (const entry of r.out.split('\0')) {
    const nl = entry.indexOf('\n');
    if (nl === -1) continue;
    const name = entry.slice(0, nl).replace(/^remote\./, '').replace(/\.url$/, '');
    if (!found.has(name)) found.set(name, entry.slice(nl + 1));
  }
  return found;
}

// The entries of a tree path on a ref: [{ mode, type, sha, path }], plus each blob's `size`
// with `sizes` (unit 17a). Null when the ref or path is missing. Used to read committed public
// keys from the integration branch (unit 06).
export function lsTree(root, ref, path, env, { recursive = false, sizes = false, maxBuffer = 16 * MAX_OUTPUT, timeout = TIMEOUT_MS } = {}) {
  // Literal pathspecs: a path is a path, never a pattern (`:(glob)…`), wherever it came from.
  const r = git(root, ['--literal-pathspecs', 'ls-tree', '-z', ...(recursive ? ['-r'] : []), ...(sizes ? ['-l'] : []), `${ref}^{tree}`, '--', path], env, { maxBuffer, timeout });
  if (!r.ok) return null;
  return r.out.split('\0').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    const [mode, type, sha, size] = line.slice(0, tab).split(/ +/);
    return { mode, type, sha, path: line.slice(tab + 1), ...(sizes ? { size: size === '-' ? null : Number(size) } : {}) };
  });
}

// The id of a tree path on a ref (to cache what was read from it), or null.
export function treeId(root, ref, path, env) {
  const r = git(root, ['rev-parse', '--verify', '--quiet', `${ref}:${path}`], env);
  return r.ok && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(r.out) ? r.out : null;
}

// Several blobs' exact bytes in one git call (cat-file --batch): a Map from id to a Buffer, or
// to null when the blob is missing or larger than `maxBytes`.
export function catBlobs(root, shas, env, { maxBytes = 16 * 1024, maxTotal = MAX_OUTPUT } = {}) {
  const found = new Map();
  if (shas.length === 0) return found;
  for (const sha of shas) {
    if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) throw new StoreError('not a blob id', { code: 'git-output' });
  }
  const r = git(root, ['cat-file', '--batch'], env, { raw: true, input: Buffer.from(`${shas.join('\n')}\n`), maxBuffer: maxTotal + shas.length * 128 });
  if (!r.ok) throw new StoreError('git cat-file failed', { code: 'git-output' });
  const out = r.out;
  let at = 0;
  for (const sha of shas) {
    const nl = out.indexOf(0x0a, at);
    if (nl === -1) throw new StoreError('git cat-file returned less than asked', { code: 'git-output' });
    const head = out.subarray(at, nl).toString('latin1');
    at = nl + 1;
    const m = /^([0-9a-f]+) (\w+) (\d+)$/.exec(head);
    if (!m) {
      found.set(sha, null); // "<sha> missing"
      continue;
    }
    const size = Number(m[3]);
    const body = out.subarray(at, at + size);
    at += size + 1; // the content, then a newline
    found.set(sha, m[2] === 'blob' && size <= maxBytes ? Buffer.from(body) : null);
  }
  return found;
}

// The files git knows under `paths` (repo-relative; '.' for all): tracked ones plus new ones
// that .gitignore doesn't exclude (unit 07b). Relative paths with "/", or null when git fails.
// A nested repo there is refused (unit 14b: `add -A` would run its config).
export function lsFiles(root, paths, env) {
  // The index once, with modes (a gitlink is a nested repo), then the new files.
  const staged = git(root, ['ls-files', '-z', '--stage', '--', ...paths], env, { raw: true, timeout: 60_000, maxBuffer: 256 * 1024 * 1024 });
  const others = git(root, ['ls-files', '-z', '--others', '--exclude-standard', '--', ...paths], env, { raw: true, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (!staged.ok || !others.ok) return null;
  const untracked = nulList(others.out);
  checkNested(staged.out, untracked);
  const cached = nulList(staged.out).map((line) => line.slice(line.indexOf('\t') + 1));
  return [...new Set([...cached, ...untracked])];
}

// `ls-files --stage` output for `paths`, for the nested-repo check (a gitlink has mode 160000).
function stageOf(root, paths, env) {
  const r = git(root, ['ls-files', '-z', '--stage', '--', ...paths], env, { raw: true, timeout: 60_000, maxBuffer: 256 * 1024 * 1024 });
  if (!r.ok) throw new StoreError('git ls-files failed', { code: 'git-failed' });
  return r.out;
}

// The checkout's `.env*` files at any depth, whatever their case: tracked, untracked and ignored
// (unit 13b: each real one is denied to agents by exact path, besides the `.env*` glob deny).
// Only those names are output, though git still walks ignored folders to apply the pathspec.
// Files inside nested repos and submodules aren't listed: the glob denies cover them.
export function envFiles(root, env) {
  const spec = ':(glob,icase)**/.env*';
  const out = new Set();
  for (const args of [['--cached', '--others', '--exclude-standard'], ['--others', '--ignored', '--exclude-standard']]) {
    const r = git(root, ['ls-files', '-z', ...args, '--', spec], env, { raw: true, timeout: 60_000, maxBuffer: 16 * MAX_OUTPUT });
    if (!r.ok) throw new StoreError('git ls-files failed', { code: 'git-failed' });
    for (const n of r.out.toString('utf8').split('\0').filter(Boolean)) out.add(n);
  }
  return [...out].sort();
}

// The branch a symbolic ref points at (`refs/remotes/origin/HEAD` -> "main"; `HEAD` -> the
// current branch), or null when it isn't a symbolic ref (a detached HEAD, no origin/HEAD).
export function symbolicBranch(root, ref, env) {
  const r = git(root, ['symbolic-ref', '--quiet', ref], env);
  // The exact prefix, not --short: a short name can be ambiguous (a tag or a remote with a
  // slash in its name).
  const prefix = ref === 'HEAD' ? 'refs/heads/' : ref.replace(/HEAD$/, '');
  if (!r.ok || !r.out.startsWith(prefix) || r.out.length === prefix.length) return null;
  return r.out.slice(prefix.length);
}

// The paths git would ignore, of `paths` (relative to `root`), given every ignore rule: the
// repo's .gitignore files, .git/info/exclude and the user's global excludes (unit 10).
export function ignoredPaths(root, paths, env) {
  if (paths.length === 0) return [];
  const r = git(root, ['check-ignore', '--stdin', '-z'], env, { input: `${paths.join('\0')}\0` });
  if (r.ok) return r.out.split('\0').filter(Boolean);
  if (r.status === 1) return [];
  throw new StoreError('git check-ignore failed', { code: 'git-failed' });
}

// Diffs as data (unit 12): no external diff driver, no textconv, no rename detection (a rename
// counts as both paths), whatever the repo's config says. Submodule changes count; a nested repo
// in the work tree is refused before the diff looks into it (unit 14b).
const DIFF_ARGS = ['diff', '--name-only', '-z', '--no-renames', ...DIFF_FLAGS, '--ignore-submodules=none'];

// The paths that differ between two commits, or between a commit and the work tree (`to`
// omitted), sorted. With the work tree, untracked files git doesn't ignore count too.
export function changedNames(root, from, to, env) {
  let untracked = [];
  if (!to) {
    const u = git(root, ['ls-files', '-z', '--others', '--exclude-standard'], env, { raw: true, maxBuffer: 16 * MAX_OUTPUT });
    if (!u.ok) throw new StoreError('git ls-files failed', { code: 'git-failed' });
    untracked = nulList(u.out);
    checkNested(stageOf(root, ['.'], env), untracked);
  }
  // Raw output: trimming would eat a leading space of the first path.
  const r = git(root, [...DIFF_ARGS, from, ...(to ? [to] : []), '--'], env, { raw: true, maxBuffer: 16 * MAX_OUTPUT });
  if (!r.ok) throw new StoreError(`git diff ${from}${to ? `..${to}` : ''} failed`, { code: 'git-failed' });
  const names = new Set(nulList(r.out));
  for (const n of untracked) names.add(n);
  return [...names].sort();
}

const nulList = (bytes) => bytes.toString('utf8').split('\0').filter(Boolean);

// The lines a change touched (unit 16b), for diff coverage: `git diff -U0` from a commit to a
// commit or to the work tree, with DIFF_ARGS' pins, the default prefixes and a fixed algorithm
// whatever the repo's config says, read by src/tests/diff.js. With the work tree, an untracked
// file git doesn't ignore is wholly added (a binary one has no lines). Renames are off, so a moved
// file is wholly added (a known limit for units 26 and 54). Returns parseDiff's { files }.
const UNIFIED_ARGS = ['diff', '-U0', '--no-renames', ...DIFF_FLAGS, '--ignore-submodules=none', '--src-prefix=a/', '--dst-prefix=b/', '--diff-algorithm=myers', '--no-relative'];
export const UNTRACKED_MAX_BYTES = 4 * 1024 * 1024;
export function changedLines(root, from, to, env) {
  // With the work tree, a nested repo is refused before the diff looks into it (as changedNames).
  let untracked = [];
  if (!to) {
    const u = git(root, ['ls-files', '-z', '--others', '--exclude-standard'], env, { raw: true, maxBuffer: 16 * MAX_OUTPUT });
    if (!u.ok) throw new StoreError('git ls-files failed', { code: 'git-failed' });
    untracked = nulList(u.out);
    checkNested(stageOf(root, ['.'], env), untracked);
  }
  const r = git(root, [...UNIFIED_ARGS, from, ...(to ? [to] : []), '--'], env, { raw: true, maxBuffer: 64 * MAX_OUTPUT, timeout: 120_000 });
  if (!r.ok) throw new StoreError(`git diff ${from}${to ? `..${to}` : ''} failed`, { code: 'git-failed' });
  const { files } = parseDiff(r.out);
  for (const path of untracked) files.push(untrackedFile(root, path));
  return { files };
}

// An untracked file as a diff would show it: every line added. Read without following a link
// (a link is one line, its target, as git would store it), and never opened as anything but a
// regular file. Larger than UNTRACKED_MAX_BYTES: `too_large`, its lines not counted.
function untrackedFile(root, path) {
  const abs = join(root, path);
  const file = { path, status: 'added', added: [], removed: [], binary: false };
  if (lstatSync(abs).isSymbolicLink()) return { ...file, added: [1] };
  let fd;
  try {
    fd = openSync(abs, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return file;
  }
  let bytes;
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) return file;
    if (info.size > UNTRACKED_MAX_BYTES) return { ...file, too_large: true };
    bytes = Buffer.alloc(info.size);
    readSync(fd, bytes, 0, info.size, 0);
  } finally {
    closeSync(fd);
  }
  // Git's own test: a NUL in the first 8,000 bytes.
  if (bytes.subarray(0, 8000).includes(0)) return { ...file, binary: true };
  const text = bytes.toString('utf8');
  const count = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  return { ...file, added: Array.from({ length: count }, (_, i) => i + 1) };
}

// The work tree's files that git ignores (unit 12): ignored folders come as one entry ending in
// "/", not their contents.
export function ignoredNames(root, env) {
  const r = git(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'], env, { raw: true, maxBuffer: 16 * MAX_OUTPUT });
  if (!r.ok) throw new StoreError('git ls-files failed', { code: 'git-failed' });
  // git lists a folder whose contents are all ignored both as "x/" and file by file: keep the
  // files then, and the folder only when its contents aren't listed.
  const all = nulList(r.out);
  return all.filter((n) => !n.endsWith('/') || !all.some((m) => m !== n && m.startsWith(n)));
}

// What `git status` shows in the work tree (unit 14d's gate): changed, staged and new files that
// aren't ignored, at any depth, as porcelain v2 entries. Empty means clean. No optional locks, so
// it never rewrites the index.
export function workTreeChanges(root, env) {
  const r = git(root, ['--no-optional-locks', 'status', '--porcelain=v2', '--untracked-files=all', '--ignore-submodules=none', '-z'], env, { raw: true, timeout: 60_000, maxBuffer: 16 * MAX_OUTPUT });
  if (!r.ok) throw new StoreError('git status failed', { code: 'git-failed' });
  return nulList(r.out);
}

// Tracked files `git status` doesn't look at: marked assume-unchanged (a lowercase tag in
// `ls-files -v`) or skip-worktree (`S`). Their work-tree edits never show as changes.
export function hiddenFromStatus(root, env) {
  const r = git(root, ['ls-files', '-v', '-z'], env, { raw: true, timeout: 60_000, maxBuffer: 16 * MAX_OUTPUT });
  if (!r.ok) throw new StoreError('git ls-files failed', { code: 'git-failed' });
  return nulList(r.out).filter((e) => /^([a-z]|S) /.test(e)).map((e) => e.slice(2));
}

// The names of the local and remote-tracking branches (unit 17a, for the branch pattern): full ref
// names, at most `max`, sorted; a remote's HEAD isn't one.
export function branchRefs(root, env, { max = 2000 } = {}) {
  const r = git(root, ['for-each-ref', `--count=${max}`, '--format=%(refname)', 'refs/heads/', 'refs/remotes/'], env, { maxBuffer: 16 * MAX_OUTPUT });
  if (!r.ok) throw new StoreError('git for-each-ref failed', { code: 'git-failed' });
  return r.out.split('\n').filter((n) => n !== '' && !n.endsWith('/HEAD')).sort();
}

// The full messages of the last `max` commits on `ref` that aren't merges (unit 17a, for the
// commit format), newest first, as UTF-8 text. No signature check, no notes, no mailmap.
export function commitMessages(root, ref, env, { max = 200 } = {}) {
  const r = git(root, ['log', '-z', '--no-merges', `--max-count=${max}`, '--no-show-signature', '--no-notes', '--no-decorate', '--no-color', '--encoding=UTF-8', '--format=%B', `${ref}^{commit}`, '--'], env, { raw: true, maxBuffer: 16 * MAX_OUTPUT });
  if (!r.ok) throw new StoreError(`git log ${ref} failed`, { code: 'git-failed' });
  return r.out.toString('utf8').split('\0').filter((m) => m.trim() !== '');
}

// The commit a ref points at, or null.
export function commitOf(root, ref, env) {
  const r = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], env);
  return r.ok && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(r.out) ? r.out : null;
}

// The best common ancestor of two commits, or null (unit 12: a change is measured from where its
// branch left the base, so later commits on the base don't count as the branch's).
export function mergeBase(root, a, b, env) {
  const r = git(root, ['merge-base', a, b], env);
  return r.ok && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(r.out) ? r.out : null;
}

// Whether commit `a` is an ancestor of (or equal to) commit `b`.
export function isAncestor(root, a, b, env) {
  return git(root, ['merge-base', '--is-ancestor', a, b], env).ok;
}

// The bytes at `rev:path` in one git call, or null (a missing ref or path, not a blob, or larger
// than `maxBytes`). For the launcher (unit 12b), which runs on every command.
export function blobAt(root, rev, path, env, { maxBytes = 4 * 1024 * 1024 } = {}) {
  let r;
  try {
    r = git(root, ['cat-file', '--batch'], env, { raw: true, input: Buffer.from(`${rev}:${path}\n`), maxBuffer: maxBytes + 1024 });
  } catch (err) {
    if (err.code === 'git-output-too-large') return null;
    throw err;
  }
  if (!r.ok) return null;
  const nl = r.out.indexOf(0x0a);
  const m = /^[0-9a-f]+ (\w+) (\d+)$/.exec(r.out.subarray(0, nl).toString('latin1'));
  if (!m || m[1] !== 'blob' || Number(m[2]) > maxBytes) return null;
  return Buffer.from(r.out.subarray(nl + 1, nl + 1 + Number(m[2])));
}

// A ref's commit id and the bytes at `ref:path`, in one git call: { commit, bytes } (each null
// when missing). For the launcher, which runs on every command (unit 12b).
export function commitAndBlob(root, ref, path, env, { maxBytes = 4 * 1024 * 1024 } = {}) {
  let r;
  try {
    r = git(root, ['cat-file', '--batch'], env, { raw: true, input: Buffer.from(`${ref}^{commit}\n${ref}:${path}\n`), maxBuffer: 2 * maxBytes + 4096 });
  } catch (err) {
    if (err.code === 'git-output-too-large') return { commit: null, bytes: null };
    throw err;
  }
  if (!r.ok) return { commit: null, bytes: null };
  const out = r.out;
  const read = (at) => {
    const nl = out.indexOf(0x0a, at);
    if (nl === -1) return null;
    const m = /^([0-9a-f]+) (\w+) (\d+)$/.exec(out.subarray(at, nl).toString('latin1'));
    if (!m) return { id: null, type: null, body: null, next: nl + 1 };
    const size = Number(m[3]);
    return { id: m[1], type: m[2], body: out.subarray(nl + 1, nl + 1 + size), next: nl + 1 + size + 1 };
  };
  const first = read(0);
  const second = first ? read(first.next) : null;
  return {
    commit: first?.type === 'commit' ? first.id : null,
    bytes: second?.type === 'blob' && second.body.length <= maxBytes ? Buffer.from(second.body) : null,
  };
}
