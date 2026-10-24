import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { EXIT } from '../cli/exit-codes.js';
import { blobAt, commitAndBlob, commitOf, mergeBase, remotes, symbolicBranch, topLevel } from '../store/git.js';
import { miraiHome, readStoreMeta, repoIdentity } from '../store/home.js';
import { atomicWrite, checkPrivateDir, readPrivateFile } from '../store/files.js';
import { LOCK_FILE, filesUnder, frameworkDigest, newer, noLinks, parseLock, sha256 } from '../install/lock.js';
import { parseJsonStrict } from '../findings/schema.js';
import { FRAMEWORK_PARTS, PACKAGE_ROOT } from '../install/parts.js';

// The `mirai` launcher (unit 12b; D-03, D-15). It finds the repo you're in and decides which MIRAI
// may run there:
// - outside a repo, or in one without MIRAI: only `init`, `--version` and `--help`, from the
//   launcher's own code;
// - `init` (and `init --refresh`, later `update`): always the launcher's own code;
// - any other command in an installed repo: the repo's pinned version, but only when the work
//   tree's copy is exactly
//   (A) a copy committed on the integration branch (the branch pinned in the store, never the
//       work tree's config): its tip, its remote's tip, or where your branch left it. Then the
//       launcher runs a sealed copy of that commit, built from git objects outside the work tree
//       (runtime.js), never the work-tree files an agent could swap after the check; or
//   (B) the launcher's own copy (right after `mirai init --refresh`): it then runs its own code.
//       The commands that sign or start agents need (A): an uncommitted refresh isn't enough.
//   A branch can edit the copy and its lock together, so a copy that's neither is refused:
//   running it is your explicit choice, by its path.
// The launcher only reads the store (its record, store.json) and the commits' locks, read
// tolerantly (only what it needs), and never writes to the store except its sealed copies.

const FRAMEWORK = '.mirai/framework';
const OUTSIDE = new Set(['init', '--version', '--help', '-h', 'help', undefined]);
const SELF = new Set(['init', 'update']);
// Commands that sign or start agents: they need a committed copy, (A).
const NEEDS_COMMITTED = new Set(['approve', 'drop', 'key', 'run', 'agent', 'handover', 'unpark', 'resume']);
const LAUNCHER_VERSION = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
const REPO_ID = /^[a-z0-9][a-z0-9._-]{0,80}-[0-9a-f]{12}$/;
const CACHE = 'launcher.json';

// The decision for `argv` in `cwd`: { run: 'self', why } | { run: 'sealed', commit, files,
// storeDir, why } | { refuse, code, hint, exitCode }.
export function decide({ cwd, env, argv, packageRoot = PACKAGE_ROOT }) {
  const first = argv[0];
  const top = topLevel(cwd, env);
  // A lock that's there in any form (even a dangling link) means installed: the checks below
  // then refuse what isn't right, instead of offering a fresh init.
  const installed = top !== null && present(join(top, LOCK_FILE));
  if (SELF.has(first)) return { run: 'self', why: `${first} always runs this launcher's MIRAI` };
  if (!installed) {
    if (OUTSIDE.has(first)) return { run: 'self', why: top ? 'MIRAI isn\'t installed in this repo' : 'not inside a git repository' };
    return refuse(top ? 'MIRAI isn\'t installed in this repo' : 'this folder is not inside a git repository', 'not-installed', 'run: mirai init');
  }
  const root = realpathSync(top);
  try {
    noLinks(root, FRAMEWORK);
  } catch {
    return refuse(`${FRAMEWORK} is a symbolic link, or inside one`, 'untrusted-copy', 'MIRAI\'s copy is real files; restore it: git checkout -- .mirai');
  }
  const here = hashes(root, FRAMEWORK, (rel) => rel);
  if (here.size === 0) return refuse(`${FRAMEWORK} is missing`, 'no-copy', 'restore it: git checkout -- .mirai');

  // (A) The integration branch's copy.
  let store;
  try {
    store = storeOf(root, env);
  } catch (err) {
    if (err.code === 'version') return refuse(`this repo's store was written by a newer MIRAI than this launcher (${LAUNCHER_VERSION})`, 'launcher-old', 'update the launcher (git pull in MIRAI\'s repo, or reinstall it)');
    return refuse(`this repo's MIRAI store can't be read (${err.message})`, err.code ?? 'store', err.hint ?? 'see the message');
  }
  // Without this machine's store nothing in the repo can run yet (the integration branch is
  // unknown); --version and --help still answer from the launcher.
  if (!store) {
    if (OUTSIDE.has(first)) return { run: 'self', why: 'this machine has no MIRAI store for this repo yet' };
    return refuse('this machine has no MIRAI store for this repo, so the integration branch is unknown', 'no-store', noStoreHint(root));
  }
  {
    for (const { ref, label, lock } of candidates(root, store.branch, env)) {
      const listed = lockAt(root, ref, env, lock);
      if (listed && same(here, listed)) return { run: 'sealed', commit: ref, files: listed, storeDir: store.dir, why: `the copy committed on ${label} (${ref.slice(0, 12)}), run sealed from the store` };
    }
  }
  // (B) The launcher's own copy.
  const own = new Map();
  for (const part of FRAMEWORK_PARTS) {
    for (const [rel, hash] of hashes(packageRoot, part, (r) => r)) own.set(`${FRAMEWORK}/${rel}`, hash);
  }
  if (same(here, own)) {
    if (NEEDS_COMMITTED.has(first)) return refuse(`${first} needs MIRAI's copy as committed on the integration branch; this one is only this launcher's (an uncommitted refresh)`, 'needs-committed-copy', 'commit the refresh on the integration branch first');
    return { run: 'self', why: 'the same files as this launcher\'s MIRAI (as after mirai init --refresh), so it runs its own code' };
  }

  const onBranch = symbolicBranch(root, 'HEAD', env) === store.branch;
  return refuse(`${FRAMEWORK} isn't the copy committed on ${store.branch}, nor this launcher's`, 'untrusted-copy', onBranch
    ? 'it was edited here; restore it: git checkout -- .mirai'
    : `this branch changed MIRAI's copy: read that change on the host first; to run it anyway: node ${FRAMEWORK}/bin/mirai.js${argv.map((a) => ` ${shellWord(a)}`).join('')}`);
}

const present = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

const refuse = (message, code, hint) => ({ refuse: message, code, hint, exitCode: EXIT.BLOCKED });

// A word as a shell would need it typed.
const shellWord = (word) => (/^[A-Za-z0-9._\/=:@%+-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`);

function noStoreHint(root) {
  let pinned = null;
  try {
    pinned = parseLock(readFileSync(join(root, LOCK_FILE), 'utf8')).miraiVersion;
  } catch {
    // The hint stays general.
  }
  if (pinned && newer(pinned, LAUNCHER_VERSION)) return `this repo pins MIRAI ${pinned}, newer than this launcher (${LAUNCHER_VERSION}): update the launcher first`;
  return 'run: mirai init --join (it sets up this machine\'s store, without changing the repo)';
}

// The regular files under `rel` in `root` (a file or a folder), by path: Map(path -> sha256). A
// symbolic link, or anything else that isn't a regular file, gets a mark no hash can equal, so a
// copy holding one is never trusted.
function hashes(root, rel, name) {
  const out = new Map();
  let paths;
  try {
    paths = lstatSync(join(root, rel)).isDirectory() ? filesUnder(root, rel) : [rel];
  } catch {
    return out;
  }
  for (const p of paths) {
    let mark;
    try {
      const info = lstatSync(join(root, p));
      mark = info.isFile() ? sha256(readFileSync(join(root, p))) : info.isSymbolicLink() ? 'symlink' : 'not-a-file';
    } catch {
      mark = 'unreadable';
    }
    out.set(name(p), mark);
  }
  return out;
}

// This checkout's store, read only: { branch } (the integration branch pinned in its record),
// or null when this machine has none. The store's folder is found by the repo's id; finding the
// id costs several git calls, so the launcher keeps a cache in the MIRAI home from checkout to
// id, and checks the record before using it: a private folder in the MIRAI home, for that id,
// for this checkout.
function storeOf(root, env) {
  const home = miraiHome(env);
  const cacheFile = join(home, CACHE);
  let cache = { schema_version: 1, checkouts: {} };
  try {
    const text = readPrivateFile(cacheFile, { optional: true });
    if (text !== null) {
      const value = JSON.parse(text);
      if (value?.schema_version === 1 && value.checkouts && typeof value.checkouts === 'object') cache = value;
    }
  } catch {
    // A broken cache is rebuilt.
  }
  const fromCache = cache.checkouts[root];
  if (typeof fromCache === 'string' && REPO_ID.test(fromCache)) {
    const meta = metaOf(home, fromCache);
    if (meta && meta.checkout === root) return { branch: meta.integration_branch, dir: join(home, fromCache, 'store') };
  }
  const id = repoIdentity({ cwd: root, env }).repoId;
  const meta = metaOf(home, id);
  if (!meta) return null;
  try {
    atomicWrite(cacheFile, `${JSON.stringify({ ...cache, checkouts: { ...cache.checkouts, [root]: id } }, null, 2)}\n`);
  } catch {
    // Only a cache.
  }
  return { branch: meta.integration_branch, dir: join(home, id, 'store') };
}

// A store's record, if the store for `id` is a private folder in the MIRAI home whose record
// names that id; null when there's none. A record from a newer MIRAI throws (code `version`).
function metaOf(home, id) {
  const repoHome = join(home, id);
  if (!existsSync(repoHome) || !checkPrivateDir(repoHome)) return null;
  const meta = readStoreMeta(repoHome);
  return meta.repo_id === id ? meta : null;
}

// The commits whose copy may be trusted, in order: the integration branch here, on its remote
// (origin, or the only remote, as the repo id picks), and where this checkout's HEAD left it.
// Lazy: each costs git calls, and the first usually matches.
function* candidates(root, branch, env) {
  const seen = new Set();
  // The common case in one git call: the local branch's commit and its lock.
  const first = commitAndBlob(root, `refs/heads/${branch}`, LOCK_FILE, env);
  const local = first.commit;
  if (local) { seen.add(local); yield { ref: local, label: branch, lock: first.bytes }; }
  const all = remotes(root, env);
  const remote = all.has('origin') ? 'origin' : all.size === 1 ? [...all.keys()][0] : null;
  const tracked = remote ? commitOf(root, `refs/remotes/${remote}/${branch}`, env) : null;
  if (tracked && !seen.has(tracked)) { seen.add(tracked); yield { ref: tracked, label: `${remote}/${branch}` }; }
  const tip = local ?? tracked;
  const left = tip ? mergeBase(root, 'HEAD', tip, env) : null;
  if (left && !seen.has(left)) yield { ref: left, label: `${branch}, where this branch left it` };
}

// The framework entries of the lock committed at `ref`: Map(path -> sha256), or null. Read
// tolerantly: only the entries' path, mark and hash, and the lock's own digest of them, so a
// lock a newer MIRAI wrote (more fields, a higher schema) still works here.
function lockAt(root, ref, env, known) {
  const bytes = known === undefined ? blobAt(root, ref, LOCK_FILE, env) : known;
  if (!bytes) return null;
  let value;
  try {
    value = parseJsonStrict(bytes.toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(value?.files)) return null;
  const framework = value.files.filter((f) => f && f.mark === 'framework');
  if (framework.some((f) => typeof f.path !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256 ?? ''))) return null;
  if (typeof value.framework_sha256 === 'string' && frameworkDigest(framework) !== value.framework_sha256) return null;
  const out = new Map();
  for (const f of framework) if (f.path.startsWith(`${FRAMEWORK}/`)) out.set(f.path, f.sha256);
  return out;
}

function same(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

export { LAUNCHER_VERSION };
