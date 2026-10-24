import { execFileSync } from 'node:child_process';

import { StoreError } from '../cli/errors.js';

// The read-only git calls the store needs (unit 05a): never a shell, a fixed environment, no
// fsmonitor, a time and output limit. Pinned, integrity-checked host git comes with unit 22
// (D-54). Only `rev-parse`, `rev-list`, `config --get` / `--get-regexp`, (unit 06) `ls-tree`
// / `cat-file` and (unit 07b) `ls-files` are used, with replace refs off, so `refs/replace` can't change which commits
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
export function lsTree(root, ref, path, env) {
  const r = git(root, ['ls-tree', '-z', `${ref}^{tree}`, '--', path], env);
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
export function catBlobs(root, shas, env, { maxBytes = 16 * 1024 } = {}) {
  const found = new Map();
  if (shas.length === 0) return found;
  for (const sha of shas) {
    if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) throw new StoreError('not a blob id', { code: 'git-output' });
  }
  const r = git(root, ['cat-file', '--batch'], env, { raw: true, input: Buffer.from(`${shas.join('\n')}\n`) });
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
