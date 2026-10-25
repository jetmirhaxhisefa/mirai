import { execFileSync } from 'node:child_process';

import { StoreError } from '../cli/errors.js';

// The read-only git calls the store needs (unit 05a): never a shell, a fixed environment, no
// fsmonitor, a time and output limit. Pinned, integrity-checked host git comes with unit 22
// (D-54). Only `rev-parse`, `rev-list`, `config --get` / `--get-regexp`, (unit 06) `ls-tree`
// / `cat-file`, (unit 07b) `ls-files` and (unit 10) `symbolic-ref` and `check-ignore`, (unit 12) `diff --name-only` with pinned options and `merge-base`, (unit 13b) `ls-files` for `.env*` files are used, with replace refs off, so `refs/replace` can't change which commits
// count as the roots or which keys are committed.

const TIMEOUT_MS = 10_000;
const MAX_OUTPUT = 1024 * 1024;

// `raw: true` returns the output as bytes, untouched; `input` is written to git's stdin.
function git(cwd, args, env, { timeout = TIMEOUT_MS, raw = false, input, maxBuffer = MAX_OUTPUT } = {}) {
  try {
    const out = execFileSync('git', ['--no-replace-objects', '-c', 'core.fsmonitor=false', ...args], {
      cwd,
      env: { PATH: env.PATH ?? '/usr/bin:/bin', HOME: env.HOME ?? '/nonexistent', GIT_CONFIG_NOSYSTEM: '1' },
      encoding: raw ? 'buffer' : 'utf8',
      timeout,
      maxBuffer,
      ...(input !== undefined ? { input } : {}),
      stdio: [input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: raw ? out : out.trim() };
  } catch (err) {
    if (err.code === 'ENOENT') throw new StoreError('git is not installed or not on PATH', { code: 'no-git' });
    if (err.code === 'ENOBUFS') throw new StoreError(`git ${args[0]} wrote more than MIRAI reads at once`, { code: 'git-output-too-large' });
    if (err.signal) throw new StoreError(`git ${args[0]} took longer than ${timeout / 1000} s`, { code: 'git-timeout' });
    return { ok: false, status: err.status, out: String(err.stdout ?? '').trim() };
  }
}

// The checkout's top folder, or null when `cwd` is not inside a git work tree.
export function topLevel(cwd, env) {
  const r = git(cwd, ['rev-parse', '--show-toplevel'], env);
  return r.ok && r.out !== '' ? r.out : null;
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

// One config value as git reads it in this checkout (repo config included), or null.
export function configValue(root, key, env) {
  const r = git(root, ['config', '--get', key], env);
  return r.ok && r.out !== '' ? r.out : null;
}

// The remotes with a URL: a Map from name to its (first) URL.
export function remotes(root, env) {
  const r = git(root, ['config', '--null', '--get-regexp', '^remote\\..*\\.url$'], env);
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

// The entries of a tree path on a ref: [{ mode, type, sha, path }]. Null when the ref or path
// is missing. Used to read committed public keys from the integration branch (unit 06).
export function lsTree(root, ref, path, env, { recursive = false } = {}) {
  // Literal pathspecs: a path is a path, never a pattern (`:(glob)…`), wherever it came from.
  const r = git(root, ['--literal-pathspecs', 'ls-tree', '-z', ...(recursive ? ['-r'] : []), `${ref}^{tree}`, '--', path], env, { maxBuffer: 16 * MAX_OUTPUT });
  if (!r.ok) return null;
  return r.out.split('\0').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    const [mode, type, sha] = line.slice(0, tab).split(' ');
    return { mode, type, sha, path: line.slice(tab + 1) };
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
export function lsFiles(root, paths, env) {
  const r = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...paths], env, { raw: true, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (!r.ok) return null;
  return [...new Set(r.out.toString('utf8').split('\0').filter(Boolean))];
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
// counts as both paths), whatever the repo's config says.
const DIFF_PINS = ['-c', 'diff.external=', '-c', 'core.quotePath=false', '-c', 'core.attributesFile=/dev/null', 'diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--no-color', '--ignore-submodules=none'];

// The paths that differ between two commits, or between a commit and the work tree (`to`
// omitted), sorted. With the work tree, untracked files git doesn't ignore count too.
export function changedNames(root, from, to, env) {
  // Raw output: trimming would eat a leading space of the first path.
  const r = git(root, [...DIFF_PINS, from, ...(to ? [to] : []), '--'], env, { raw: true, maxBuffer: 16 * MAX_OUTPUT });
  if (!r.ok) throw new StoreError(`git diff ${from}${to ? `..${to}` : ''} failed`, { code: 'git-failed' });
  const names = new Set(nulList(r.out));
  if (!to) {
    const u = git(root, ['-c', 'core.attributesFile=/dev/null', 'ls-files', '-z', '--others', '--exclude-standard'], env, { raw: true, maxBuffer: 16 * MAX_OUTPUT });
    if (!u.ok) throw new StoreError('git ls-files failed', { code: 'git-failed' });
    for (const n of nulList(u.out)) names.add(n);
  }
  return [...names].sort();
}

const nulList = (bytes) => bytes.toString('utf8').split('\0').filter(Boolean);

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
