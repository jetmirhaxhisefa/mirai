import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, basename, isAbsolute, join, sep } from 'node:path';

import { ConfigError, StoreError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { hasTokenShape } from '../config/credentials.js';
import { BRANCH } from '../config/config-schema.js';
import { readConfigFile, PROJECT_CONFIG } from '../config/load.js';
import { atomicWrite, checkPrivateDir, ensurePrivateDir, readPrivateFile } from './files.js';
import { isShallow, refExists, remotes, rootCommits, topLevel } from './git.js';
import { appendEvent, checkCounter } from './journal.js';
import { EMPTY_REGISTRY } from './branches.js';

// The MIRAI home and the store of one repo (unit 05a; D-47). The home is in your user's
// Application Support, outside every project:
//   <home>/<repo-id>/store.json   which repo and checkout this store belongs to
//   <home>/<repo-id>/store/       the orchestrator store (journal, status files, …)
// `HOME` comes from the CLI's env, so tests use a temporary one. There is deliberately no
// MIRAI_HOME override: it would let MIRAI be pointed at a store someone else wrote.

export const STORE_SCHEMA_VERSION = 1;
export function miraiHome(env) {
  if (!env.HOME || !isAbsolute(env.HOME)) {
    throw new StoreError('HOME is not set to an absolute path', { code: 'no-home', hint: 'MIRAI keeps its store under ~/Library/Application Support/mirai' });
  }
  return join(env.HOME, 'Library', 'Application Support', 'mirai');
}

// git@github.com:o/r.git, ssh://git@github.com/o/r and https://github.com/o/r are all
// "github.com/o/r". User info (and so any credential) is dropped; the host is lowercased, the
// ssh port 22 dropped, and GitHub paths lowercased (GitHub ignores their case). A local or
// relative path remote is kept as written, as `local:<path>`.
export function normalizeRemote(url) {
  const decode = (text) => {
    try {
      return decodeURIComponent(text);
    } catch {
      throw new StoreError('the git remote has a broken %-escape', { code: 'bad-remote' });
    }
  };
  let host;
  let path;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    let u;
    try {
      u = new URL(url);
    } catch {
      throw new StoreError('the git remote is not a valid URL', { code: 'bad-remote' });
    }
    if (u.protocol === 'file:') return `local:${decode(u.pathname).replace(/\/+$/, '').replace(/\.git$/, '')}`;
    host = u.hostname.toLowerCase() + (u.port && !(u.port === '22' && /ssh/.test(u.protocol)) ? `:${u.port}` : '');
    path = decode(u.pathname);
  } else {
    const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(url);
    if (!scp || url.startsWith('/') || url.startsWith('.')) return `local:${url.replace(/\/+$/, '').replace(/\.git$/, '')}`;
    host = scp[1].toLowerCase();
    path = scp[2];
  }
  path = path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '');
  if (host === 'github.com') path = path.toLowerCase();
  const normal = `${host}/${path}`;
  if (hasTokenShape(normal)) {
    throw new StoreError('the git remote URL looks like it contains a credential', { code: 'credential', hint: 'use a remote without a token in it; log in through git or gh instead' });
  }
  return normal;
}

// The readable part of the id: the repo's name from the remote, or "local" without one. It
// never comes from the folder name, so moving or renaming the checkout keeps the id.
function nameOf(remote) {
  const last = remote ? remote.split(/[/:]/).pop() : 'local';
  const name = last.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return name || 'repo';
}

export function repoIdOf({ roots, remote }) {
  const hash = createHash('sha256').update(`mirai-repo-id/1\n${roots.join('\n')}\n${remote ?? ''}`).digest('hex').slice(0, 12);
  return `${nameOf(remote)}-${hash}`;
}

// The integration branch from the project file, read on its own: the store must be found
// before the personal per-repo layer can join the config. A branch can change this file, so a
// changed value must never lead to a fresh store: see findRelatedStore.
function integrationBranch(checkout) {
  const file = readConfigFile(join(checkout, PROJECT_CONFIG), { trust: 'project', source: PROJECT_CONFIG, within: checkout, optional: true });
  if (file === null) {
    throw new StoreError('MIRAI isn\'t set up for this repo', { code: 'no-store', hint: 'set it up with: mirai init' });
  }
  const branch = file.value.git?.integration_branch;
  if (typeof branch !== 'string' || !BRANCH.test(branch)) {
    throw new ConfigError(`${PROJECT_CONFIG}: git.integration_branch is missing or not a branch name`, { source: PROJECT_CONFIG, code: 'required', hint: 'add integration_branch = "main" under [git]' });
  }
  return branch;
}

// Who this repo is: { checkout, branch, roots, remote, repoId }. Roots come from the
// integration branch, not HEAD, so an orphan branch such as gh-pages can't change the id; when
// the branch exists only on the remote, its remote-tracking branch is used.
export function repoIdentity({ cwd, env }) {
  const top = topLevel(cwd, env);
  if (top === null) throw new StoreError('this folder is not inside a git repository', { code: 'not-git' });
  const checkout = realpathSync(top);
  const branch = integrationBranch(checkout);
  if (isShallow(checkout, env)) {
    throw new StoreError('this is a shallow clone, so its first commit is unknown', { code: 'shallow', hint: 'run: git fetch --unshallow' });
  }

  const all = remotes(checkout, env);
  let remoteName = null;
  if (all.has('origin')) remoteName = 'origin';
  else if (all.size === 1) [remoteName] = all.keys();
  else if (all.size > 1) {
    throw new StoreError('this repo has several remotes and none is called origin', { code: 'remotes', hint: 'rename the main one: git remote rename <name> origin' });
  }
  const remote = remoteName ? normalizeRemote(all.get(remoteName)) : null;

  let ref = `refs/heads/${branch}`;
  if (!refExists(checkout, ref, env) && remoteName) ref = `refs/remotes/${remoteName}/${branch}`;
  const roots = rootCommits(checkout, ref, env);
  if (roots === null) {
    throw new StoreError(`the integration branch ${branch} has no commits here`, { code: 'no-commits', hint: 'make the first commit first' });
  }
  return { checkout, branch, roots, remote, repoId: repoIdOf({ roots, remote }) };
}

function storePaths(home, repoId) {
  const repoHome = join(home, repoId);
  return { home, repoHome, metaFile: join(repoHome, 'store.json'), dir: join(repoHome, 'store') };
}

// The store's real path must not be inside the checkout (an odd HOME could put it there).
// Checked before anything is created, through the nearest folder that exists.
function checkOutside(path, checkout) {
  let base = path;
  let rest = '';
  while (!existsSync(base)) {
    rest = join(basename(base), rest);
    base = dirname(base);
  }
  const real = join(realpathSync(base), rest).replace(/\/$/, '');
  if (real === checkout || real.startsWith(checkout + sep)) {
    throw new StoreError('the MIRAI home is inside the repo checkout', { path: real, code: 'inside-work-tree', hint: 'the store must live outside the project; check HOME' });
  }
}

function readMeta(file) {
  const text = readPrivateFile(file, { maxBytes: 64 * 1024 });
  let meta;
  try {
    meta = JSON.parse(text);
  } catch {
    meta = null;
  }
  const ok = meta !== null && typeof meta === 'object' && Number.isInteger(meta.schema_version)
    && typeof meta.repo_id === 'string' && Array.isArray(meta.roots) && typeof meta.checkout === 'string'
    && (meta.remote === null || typeof meta.remote === 'string') && typeof meta.integration_branch === 'string' && BRANCH.test(meta.integration_branch);
  if (!ok) throw new StoreError(`${file}: is not a valid store file`, { path: file, code: 'corrupt', hint: 'run: mirai doctor' });
  if (meta.schema_version > STORE_SCHEMA_VERSION) {
    throw new StoreError(`${file}: written by a newer MIRAI (store schema ${meta.schema_version})`, { path: file, code: 'version', hint: 'update MIRAI before using this store' });
  }
  return meta;
}

// Whether `path` is still a checkout of this repo: a git work tree at that path whose
// integration branch shares a root commit. An unrelated folder now at the old path is not.
function sameRepoAt(path, id, env) {
  try {
    const top = topLevel(path, env);
    if (top === null || realpathSync(top) !== path) return false;
    const roots = rootCommits(path, `refs/heads/${id.branch}`, env) ?? [];
    return roots.some((r) => id.roots.includes(r));
  } catch {
    return false;
  }
}

// A store that belongs to this checkout under another id: the same checkout path, or shared
// roots with a checkout that no longer exists. It means the id changed (an edited
// integration_branch, a renamed remote, a merged unrelated history), and a fresh store would
// reset rounds and parking, so callers refuse instead (D-47). A fork checked out elsewhere
// shares roots but has its own live checkout, so it doesn't count.
function findRelatedStore(home, id, env) {
  let names;
  try {
    names = readdirSync(home);
  } catch {
    return null;
  }
  for (const name of names) {
    if (name === id.repoId || name === 'global') continue;
    let meta;
    try {
      meta = readMeta(join(home, name, 'store.json'));
    } catch {
      continue; // not a store, or one doctor must repair; it isn't this repo's evidence
    }
    if (meta.checkout === id.checkout) return meta;
    if (meta.roots.some((r) => id.roots.includes(r)) && !sameRepoAt(meta.checkout, id, env)) return meta;
  }
  return null;
}

function identityChanged(related, id) {
  return new StoreError(`this checkout has a MIRAI store under another id (${related.repo_id}, now ${id.repoId})`, {
    code: 'identity-changed',
    exitCode: EXIT.BLOCKED,
    hint: 'the integration branch, the remote or the first commits changed; run: mirai doctor (don\'t run mirai init: a new store would lose this one\'s state)',
  });
}

// Creates the store for this repo (called by `mirai init`, unit 10). Refuses an existing one,
// and refuses when this checkout already has a store under another id.
export function createStore({ cwd, env, now = () => new Date() }) {
  const id = repoIdentity({ cwd, env });
  const home = miraiHome(env);
  const p = storePaths(home, id.repoId);
  checkOutside(home, id.checkout);
  // ~/Library/Application Support is a normal macOS folder; only MIRAI's own folders are private.
  mkdirSync(join(env.HOME, 'Library', 'Application Support'), { recursive: true, mode: 0o700 });
  ensurePrivateDir(home);
  const related = findRelatedStore(home, id, env);
  if (related) throw identityChanged(related, id);
  try {
    mkdirSync(p.repoHome, { mode: 0o700 });
  } catch (err) {
    if (err.code === 'EEXIST') throw new StoreError(`a store already exists for ${id.repoId}`, { path: p.repoHome, code: 'exists' });
    throw err;
  }
  ensurePrivateDir(p.dir);
  ensurePrivateDir(join(p.dir, 'locks'));
  ensurePrivateDir(join(p.dir, 'tickets'));
  atomicWrite(join(p.dir, 'seq'), '0\n');
  atomicWrite(join(p.dir, 'journal.jsonl'), '');
  atomicWrite(join(p.dir, 'branches.json'), EMPTY_REGISTRY); // written now, so a missing one means lost
  // The integration branch is recorded here: it's the trust anchor for signing keys (unit 06),
  // so it must never come from the work tree's config, which any branch can edit.
  const meta = { schema_version: STORE_SCHEMA_VERSION, repo_id: id.repoId, roots: id.roots, remote: id.remote, integration_branch: id.branch, checkout: id.checkout, created_at: now().toISOString() };
  atomicWrite(p.metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  return openStore({ cwd, env, identity: id });
}

const writeMeta = (file, meta) => atomicWrite(file, `${JSON.stringify(meta, null, 2)}\n`);

// Opens this repo's store, checking it on the way: private folders, outside the work tree, the
// right checkout, a counter not behind the journal. Returns null when there is no store and
// `optional` (but a store under another id for this checkout is always refused). `identity`
// may be passed when the caller already has it. The store: { repoId, checkout, home, repoHome,
// dir, meta }.
export function openStore({ cwd, env, optional = false, identity }) {
  const id = identity ?? repoIdentity({ cwd, env });
  const home = miraiHome(env);
  const p = storePaths(home, id.repoId);
  const exists = checkPrivateDir(home) && checkPrivateDir(p.repoHome);
  if (!exists) {
    const related = existsSync(home) ? findRelatedStore(home, id, env) : null;
    if (related) throw identityChanged(related, id);
    if (optional) return null;
    throw new StoreError('MIRAI isn\'t set up for this repo', { code: 'no-store', hint: 'set it up with: mirai init' });
  }
  for (const dir of [p.dir, join(p.dir, 'locks'), join(p.dir, 'tickets')]) {
    if (!checkPrivateDir(dir)) throw new StoreError(`${dir}: a store folder is missing`, { path: dir, code: 'missing', hint: 'run: mirai doctor' });
  }
  checkOutside(p.dir, id.checkout);

  const meta = readMeta(p.metaFile);
  if (meta.repo_id !== id.repoId) throw new StoreError(`${p.metaFile}: belongs to ${meta.repo_id}, not ${id.repoId}`, { path: p.metaFile, code: 'corrupt', hint: 'run: mirai doctor' });
  if (meta.checkout !== id.checkout && sameRepoAt(meta.checkout, id, env)) {
    throw new StoreError(`this repo is also checked out at ${meta.checkout}; MIRAI uses one checkout per repo`, {
      code: 'second-checkout',
      exitCode: EXIT.BLOCKED,
      hint: `use ${meta.checkout}, or remove that checkout and run MIRAI here (D-52)`,
    });
  }
  // `branch` and `gitEnv` let the journal read the integration branch's public keys (unit 06).
  if (meta.integration_branch !== id.branch) {
    throw new StoreError(`${PROJECT_CONFIG} names ${id.branch} as the integration branch, but this store was set up for ${meta.integration_branch}`, {
      code: 'branch-changed',
      exitCode: EXIT.BLOCKED,
      hint: `put integration_branch = "${meta.integration_branch}" back; changing it is a setup change (run: mirai doctor)`,
    });
  }
  const opened = { repoId: id.repoId, checkout: id.checkout, branch: meta.integration_branch, gitEnv: Object.freeze({ PATH: env.PATH, HOME: env.HOME }), home, repoHome: p.repoHome, dir: p.dir };
  checkCounter(opened);
  if (meta.checkout !== id.checkout) {
    // A moved checkout: the new path and its event are written under the journal lock, and
    // only by the first process that sees the move.
    appendEvent(opened, { type: 'checkout_moved', by: 'script', from: meta.checkout, to: id.checkout }, {
      before() {
        const now = readMeta(p.metaFile);
        if (now.checkout === id.checkout) return false;
        writeMeta(p.metaFile, { ...now, checkout: id.checkout });
        return true;
      },
    });
  }
  return Object.freeze({ ...opened, meta: Object.freeze(readMeta(p.metaFile)) });
}
