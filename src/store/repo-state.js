import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';

// D-54's integrity hash of a repo's `.git` (unit 14b; research/11, "What this means for 14b"):
// what can make git run code or read from elsewhere, plus the local refs. Read with lstat and
// plain reads, never git. Each part has its own digest, so a mismatch names what changed.
//
// The local branches are hashed by value (name -> commit, loose or packed), so `git gc` and
// `pack-refs` moving them between files change nothing (14b review).
//
// Not hashed, on purpose: the index and the objects (every status refresh and commit changes
// them), tags, `refs/remotes/**` and `FETCH_HEAD` (an editor's background fetch brings them; MIRAI
// never trusts a remote-tracking ref alone), and the data files gc writes (`info/refs`,
// objects/info's `packs` and commit-graphs).

const MAX_ENTRIES = 20_000;
// objects/info's data files, rewritten by gc and repack; everything else there is hashed.
const OBJECT_INFO_DATA = new Set(['packs', 'commit-graph', 'commit-graphs']);
const INFO_DATA = new Set(['refs']);

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function entry(path) {
  let info;
  try {
    info = lstatSync(path);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return '-';
    throw new StoreError(`${path}: can't be read (${err.code})`, { path, code: 'unreadable' });
  }
  if (info.isSymbolicLink()) return `link:${readlinkSync(path)}`;
  if (info.isFile()) return `file:${(info.mode & 0o777).toString(8)}:${sha256(readFileSync(path))}`;
  if (info.isDirectory()) return 'dir';
  return 'other';
}

// Every name below `dir` with its entry, sorted: { 'a/b': 'file:644:<sha>' }. `skip(name, rel)`
// leaves an entry out; `depth` 1 lists the top level only (names and kinds, no content).
function tree(dir, { skip = () => false, depth = Infinity } = {}) {
  const out = [];
  const walk = (abs, rel, level) => {
    let names;
    try {
      names = readdirSync(abs).sort();
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return;
      throw new StoreError(`${abs}: can't be read (${err.code})`, { path: abs, code: 'unreadable' });
    }
    for (const name of names) {
      const r = rel ? `${rel}/${name}` : name;
      if (skip(name, r)) continue;
      if (out.length >= MAX_ENTRIES) throw new StoreError(`${dir}: has more than ${MAX_ENTRIES} entries`, { path: dir, code: 'repo-shape' });
      const p = join(abs, name);
      const e = level >= depth ? kind(p) : entry(p);
      out.push(`${r}\0${e}`);
      if (e === 'dir' && level < depth) walk(p, r, level + 1);
    }
  };
  walk(dir, '', 1);
  return out.join('\n');
}

const kind = (path) => {
  const info = lstatSync(path);
  return info.isSymbolicLink() ? 'link' : info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other';
};

// The local branches by value: "refs/heads/x <sha>" lines, sorted, with a loose ref winning over
// its packed line (as in git); and whether any replace ref exists, loose or packed.
function localBranches(git) {
  const refs = new Map();
  let replace = false;
  let text = '';
  try {
    text = readFileSync(join(git, 'packed-refs'), 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw new StoreError(`${git}/packed-refs: can't be read (${err.code})`, { path: join(git, 'packed-refs'), code: 'unreadable' });
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.startsWith('^')) continue;
    const [sha, ref = ''] = line.split(' ');
    if (ref.startsWith('refs/heads/')) refs.set(ref, sha);
    if (ref.startsWith('refs/replace/')) replace = true;
  }
  const walk = (abs, ref) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return;
      throw new StoreError(`${abs}: can't be read (${err.code})`, { path: abs, code: 'unreadable' });
    }
    for (const e of entries) {
      const p = join(abs, e.name);
      if (e.isDirectory()) walk(p, `${ref}/${e.name}`);
      else if (ref.startsWith('refs/heads')) refs.set(`${ref}/${e.name}`, e.isFile() ? readFileSync(p, 'utf8').trim() : `?${entry(p)}`);
      else replace = true;
    }
  };
  walk(join(git, 'refs', 'heads'), 'refs/heads');
  walk(join(git, 'refs', 'replace'), 'refs/replace');
  return { local: [...refs].map(([r, sha]) => `${r} ${sha}`).sort().join('\n'), replace };
}

// { hash, parts }: one digest per part, and the hash over all of them.
export function repoState(top) {
  const git = join(top, '.git');
  const branches = localBranches(git);
  const parts = {
    '.git': kind(git),
    config: entry(join(git, 'config')),
    'config.worktree': entry(join(git, 'config.worktree')),
    info: tree(join(git, 'info'), { skip: (name, rel) => rel === name && INFO_DATA.has(name) }),
    'objects/info': tree(join(git, 'objects', 'info'), { skip: (name, rel) => rel === name && OBJECT_INFO_DATA.has(name) }),
    commondir: entry(join(git, 'commondir')),
    shallow: entry(join(git, 'shallow')),
    hooks: tree(join(git, 'hooks')),
    HEAD: entry(join(git, 'HEAD')),
    refs: branches.local,
    'refs/replace': branches.replace ? 'present' : '-',
    // Remotes and branches defined the old way, by file: fetch and push by name read them.
    remotes: [tree(join(git, 'remotes')), tree(join(git, 'branches'))].join('\n--\n'),
    worktrees: [tree(join(git, 'worktrees'), { depth: 1 }), ...worktreeConfigs(git)].join('\n'),
    modules: tree(join(git, 'modules'), { depth: 1 }),
  };
  const digests = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, sha256(v)]));
  return { hash: sha256(Object.entries(digests).map(([k, v]) => `${k}=${v}`).join('\n')), parts: digests };
}

function worktreeConfigs(git) {
  let names = [];
  try {
    names = readdirSync(join(git, 'worktrees')).sort();
  } catch {
    return [];
  }
  return names.map((n) => `${n}/config.worktree\0${entry(join(git, 'worktrees', n, 'config.worktree'))}`);
}

// The guard (D-54): records the hash, then `check()` throws `repo-changed`, naming the parts,
// when it differs; `accept()` records it again after MIRAI's own writes (unit 22's commits);
// `release()` ends it. While any guard is active for a checkout (by its real path), every pinned
// git call on it checks them all first (src/store/git.js). Guards live in this process only:
// outside a run, the repo check (src/store/repo-check.js) is the control. A caller that starts
// one must release it in a `finally` (strict.js's finishLaunch does).
const active = new Map();
const realTop = (top) => {
  try {
    return realpathSync.native(top);
  } catch {
    return top;
  }
};

export function repoGuard(top) {
  const key = realTop(top);
  let state = repoState(top);
  const guard = {
    top,
    get hash() {
      return state.hash;
    },
    check() {
      const now = repoState(top);
      if (now.hash === state.hash) return;
      const changed = Object.keys(now.parts).filter((k) => now.parts[k] !== state.parts[k]);
      throw new StoreError(`the repo's .git changed while MIRAI was working on it (${changed.join(', ')})`, {
        path: join(top, '.git'),
        code: 'repo-changed',
        exitCode: EXIT.BLOCKED,
        hint: 'something other than MIRAI changed .git; check it (git config --list --show-origin, the hooks folder, your branches) before running MIRAI again',
      });
    },
    accept() {
      state = repoState(top);
    },
    release() {
      const set = active.get(key);
      set?.delete(guard);
      if (set?.size === 0) active.delete(key);
    },
  };
  if (!active.has(key)) active.set(key, new Set());
  active.get(key).add(guard);
  return guard;
}

// Checks every active guard on this checkout; nothing when there is none.
export function checkGuards(top) {
  if (active.size === 0) return;
  for (const g of active.get(realTop(top)) ?? []) g.check();
}
