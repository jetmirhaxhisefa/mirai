import { execFileSync } from 'node:child_process';

import { StoreError } from '../cli/errors.js';

// The read-only git calls the store needs (unit 05a): never a shell, a fixed environment, no
// fsmonitor, a time and output limit. Pinned, integrity-checked host git comes with unit 22
// (D-54). Only `rev-parse`, `rev-list` and `config --get` / `--get-regexp` are used, with
// replace refs off, so `refs/replace` can't change which commits count as the roots.

const TIMEOUT_MS = 10_000;
const MAX_OUTPUT = 1024 * 1024;

function git(cwd, args, env, { timeout = TIMEOUT_MS } = {}) {
  try {
    const out = execFileSync('git', ['--no-replace-objects', '-c', 'core.fsmonitor=false', ...args], {
      cwd,
      env: { PATH: env.PATH ?? '/usr/bin:/bin', HOME: env.HOME ?? '/nonexistent', GIT_CONFIG_NOSYSTEM: '1' },
      encoding: 'utf8',
      timeout,
      maxBuffer: MAX_OUTPUT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: out.trim() };
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
