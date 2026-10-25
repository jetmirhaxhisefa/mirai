import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { checkConfig, readConfigFile } from '../config/load.js';
import { loadRegistry } from '../config/registry.js';
import { catBlobs, commitOf, isAncestor, lsTree, remotes } from '../store/git.js';
import { matches } from '../util/glob.js';
import { openStore } from '../store/home.js';
import { atomicWrite, ensurePrivateDir, readPrivateFile } from '../store/files.js';
import { parseJsonStrict } from '../findings/schema.js';
import { buildBundle } from '../adapters/bundle.js';
import { ADAPTER, renderAgent, writePluginDir } from '../adapters/claude-code.js';
import { filesUnder, parseLock, sha256 } from '../install/lock.js';
import { strictTemplates, templateText } from '../launch/strict.js';
import { INSTRUCTION_FILES, importClosure } from './imports.js';

// The trust root (unit 12; D-15, D-47, R2-C1). At run start, MIRAI's files are read from the
// integration branch's commit (git objects, never the work tree), checked against that commit's
// own lock, and written outside the project as a read-only snapshot with a manifest. The
// manifest's hash goes into the store, which agents can't read. Before every launch (unit 19)
// the snapshot is hashed again; hooks and gates read MIRAI's files only from it.
//
// <repo-home>/trust/<base-sha>/
//   manifest.json   { schema_version, format, base_sha, branch, mirai_version, bundles, files }
//                   (no time in it, so the same base always gives the same manifest hash)
//   tree/           MIRAI's files and the instruction files from the base commit, byte for byte;
//                   each listed with its git blob id, so it can be checked against the commit
//   plugins/<tool>/ the headless plugin folder, rendered from tree/ (never the committed .claude/)
//   strict/<name>.json  the strict bundle's templates (unit 13b): one per agent and one per
//                   access mode, rendered from tree/'s registry and config; a framework copy
//                   from before unit 13b has none

export const TRUST_FOLDER = 'trust';
export const KEEP_SNAPSHOTS = 10;
export const LIMITS = Object.freeze({ fileBytes: 2 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, files: 5000 });
const MANIFEST = 'manifest.json';
// What a snapshot holds changes as units add to it (13b: strict/, 14: compose inputs); a
// snapshot of an older format is built again, not reused.
export const SNAPSHOT_FORMAT = 2;
const TMP_MAX_AGE_MS = 60 * 60 * 1000;
const RECORD = 'trust.json';
// MIRAI's files read from the base commit (folders are read whole). The signing keys aren't
// here: unit 06 reads them from the base's git objects, and so do gates and hooks.
const PARTS = Object.freeze(['.mirai/framework', '.mirai/mirai.lock', '.mirai/config.toml', '.mirai/.gitignore', '.mirai/.gitattributes', '.mirai/context', '.mirai/custom']);
// What reaches an agent's context besides them (R3-M9; unit 24's reviewer reads these from
// here): instruction files at any depth, the tool's own instruction files and rules, project
// skills, and everything they @-import.
const INSTRUCTION_PATHS = Object.freeze(['.claude/CLAUDE.md', '.claude/rules/**', '.claude/skills/**', '.agents/skills/**']);

export class TrustError extends MiraiError {
  constructor(message, { code, hint, exitCode = EXIT.BLOCKED } = {}) {
    super(message, exitCode);
    this.name = 'TrustError';
    this.code = code;
    this.hint = hint;
  }
}

// The integration branch's commit: the local branch, which must match its remote-tracking branch
// when there is one (no fetch: MIRAI's own commands never use the network). A branch that exists
// only on the remote is used from there.
export function baseCommit(root, branch, env) {
  const all = remotes(root, env);
  const remote = all.has('origin') ? 'origin' : all.size === 1 ? [...all.keys()][0] : null;
  const local = commitOf(root, `refs/heads/${branch}`, env);
  const tracked = remote ? commitOf(root, `refs/remotes/${remote}/${branch}`, env) : null;
  if (local && tracked && local !== tracked) {
    // Only what's on both sides counts; this never fetches, so two refs that are both behind
    // the host still agree (run `git fetch` yourself first for the latest).
    const hint = isAncestor(root, tracked, local, env) ? `${branch} has commits ${remote} doesn't: push them (git push ${remote} ${branch})`
      : isAncestor(root, local, tracked, env) ? `${remote}/${branch} has commits your ${branch} doesn't: pull them (git pull, or git fetch ${remote} ${branch}:${branch} from another branch)`
        : `${branch} and ${remote}/${branch} have both moved on: bring them together first`;
    throw new TrustError(`${branch} here (${local.slice(0, 12)}) and ${remote}/${branch} (${tracked.slice(0, 12)}) differ`, { code: 'base-not-pushed', hint });
  }
  const base = local ?? tracked;
  if (!base) throw new TrustError(`the integration branch ${branch} has no commit here`, { code: 'no-base' });
  return base;
}

// Builds the trust root for the integration branch's commit, or reuses the one that exists for
// it (after hashing it again). Returns the trust object: { dir, baseSha, branch, manifest,
// manifestSha256, reused }.
// `keep`: base commits whose snapshots a running run still uses (unit 19 passes its own), never
// pruned.
export function snapshot({ cwd, env, now = () => new Date(), keep = [] }) {
  const store = openStore({ cwd, env });
  return withLock(join(store.dir, 'trust.lock'), () => build(store, { env, now, keep }));
}

function build(store, { env, now, keep }) {
  const root = store.checkout;
  const base = baseCommit(root, store.branch, env);
  const home = join(store.repoHome, TRUST_FOLDER);
  ensurePrivateDir(home);
  const record = readRecord(store);
  const dir = join(home, base);
  if (record.snapshots[base] && existsSync(dir)) {
    const trust = verifyTrustRoot({ dir, manifestSha256: record.snapshots[base].manifest_sha256 });
    if (trust.manifest.format === SNAPSHOT_FORMAT) {
      checkAgainstBase(trust, root, env);
      return { ...trust, reused: true };
    }
  }

  const tree = readBase(root, base, env);
  const tmp = join(home, `.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    for (const [path, bytes] of tree) {
      const to = join(tmp, 'tree', path);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, bytes, { flag: 'wx', mode: 0o600 });
    }
    // The plugin folder is rendered from the snapshot's own registry and config, and must be
    // what the base lock recorded (unit 11): a config change committed without `mirai render`
    // is refused, not silently re-rendered.
    const treeRoot = join(tmp, 'tree');
    const registry = loadRegistry(join(treeRoot, '.mirai/framework/registry'));
    const config = loadTreeConfig(treeRoot);
    const lock = parseLock(tree.get('.mirai/mirai.lock').toString('utf8'));
    const bundles = {};
    for (const [name, profile] of Object.entries(registry.adapters)) {
      if (name !== ADAPTER) continue;
      const bundle = buildBundle(registry, { models: config.models, renderAgent });
      if (lock.bundles[name] !== bundle.sharedHash) {
        throw new TrustError(`the ${name} files on ${store.branch} aren't what its lock records (the lock says ${lock.bundles[name]?.slice(0, 12) ?? 'nothing'}, the framework renders ${bundle.sharedHash.slice(0, 12)})`, { code: 'stale-bundle', hint: 'run mirai render (or mirai init --refresh), then commit on the integration branch' });
      }
      writePluginDir(bundle, profile, join(tmp, 'plugins', name));
      bundles[name] = bundle.sharedHash;
    }
    if (registry.adapters[ADAPTER]?.strict) {
      mkdirSync(join(tmp, 'strict'));
      for (const [name, template] of strictTemplates({ registry, config })) writeFileSync(join(tmp, 'strict', `${name}.json`), templateText(template), { flag: 'wx', mode: 0o600 });
    }
    const blobOf = new Map([...tree.keys()].map((p) => [`tree/${p}`, tree.blobs.get(p)]));
    const files = filesUnder(tmp, '.').map((p) => p.slice(2)).map((path) => ({ path, sha256: sha256(readFileSync(join(tmp, path))), ...(blobOf.has(path) ? { blob: blobOf.get(path) } : {}) }));
    const manifest = { schema_version: 1, format: SNAPSHOT_FORMAT, base_sha: base, branch: store.branch, mirai_version: lock.miraiVersion, bundles, skipped: tree.skipped, files };
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    writeFileSync(join(tmp, MANIFEST), text, { flag: 'wx', mode: 0o600 });
    readOnly(tmp);
    if (existsSync(dir)) removeTree(dir); // left over from a snapshot the record lost, or an older format
    renameSync(tmp, dir);
    const manifestSha256 = sha256(text);
    record.snapshots[base] = { manifest_sha256: manifestSha256, created_at: now().toISOString() };
    prune(home, record, new Set([base, ...keep]));
    atomicWrite(join(store.dir, RECORD), `${JSON.stringify(record, null, 2)}\n`);
    return { dir, baseSha: base, branch: store.branch, manifest, manifestSha256, reused: false };
  } catch (err) {
    if (existsSync(tmp)) removeTree(tmp);
    throw err;
  }
}

// One snapshot is built at a time, across processes: a lock file holding the builder's pid. A
// lock whose process is gone is taken over; otherwise this waits up to 60 s.
function withLock(path, fn) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      writeFileSync(path, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let pid = NaN;
      let age = 0;
      try {
        pid = Number.parseInt(readFileSync(path, 'utf8'), 10);
        age = Date.now() - lstatSync(path).mtimeMs;
      } catch {
        continue; // released meanwhile
      }
      // A lock with no pid yet is one being taken this instant: it counts as held (for 10 s).
      let alive = !Number.isInteger(pid) && age < 10_000;
      if (Number.isInteger(pid)) {
        try {
          process.kill(pid, 0);
          alive = true;
        } catch (e) {
          alive = e.code === 'EPERM';
        }
      }
      if (!alive) { rmSync(path, { force: true }); continue; }
      if (Date.now() > deadline) throw new TrustError('another MIRAI is building the trust root', { code: 'trust-busy', hint: 'try again when it\'s done' });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(path, { force: true });
  }
}

// MIRAI's files on the base commit, checked: { path -> bytes }. Refuses a missing lock, a
// symbolic link or submodule among them, a blob over the limits, and a framework copy that isn't
// what the base's own lock lists.
function readBase(root, base, env) {
  const entries = [];
  for (const part of PARTS) entries.push(...(lsTree(root, base, part, env, { recursive: true }) ?? []));
  const all = lsTree(root, base, '.', env, { recursive: true }) ?? [];
  const instruction = (p) => INSTRUCTION_FILES.some((f) => f.toLowerCase() === p.split('/').pop().toLowerCase()) || INSTRUCTION_PATHS.some((g) => matches(g, p));
  // The instruction files aren't MIRAI's, so a link or a huge file among them isn't refused:
  // it's left out, and listed in the manifest as skipped (a link such as CLAUDE.md -> AGENTS.md
  // is common, and its target is in the snapshot anyway).
  const skipped = [];
  const lenient = (e) => {
    if (e.type === 'blob' && e.mode !== '120000') return true;
    skipped.push(e.path);
    return false;
  };
  entries.push(...all.filter((e) => instruction(e.path) && !entries.some((x) => x.path === e.path) && lenient(e)));
  const lockEntry = entries.find((e) => e.path === '.mirai/mirai.lock');
  if (!lockEntry) throw new TrustError(`the integration branch's commit ${base.slice(0, 12)} has no .mirai/mirai.lock`, { code: 'no-base-lock', hint: 'commit the MIRAI install on the integration branch first' });
  const own = entries.filter((e) => !instruction(e.path) || e.path.startsWith('.mirai/'));
  const theirs = entries.filter((e) => !own.includes(e));
  const blobs = new Map([...readBlobs(root, own, env, base), ...readBlobs(root, theirs, env, base, { lenient: true })]);
  for (const e of theirs) if (!blobs.get(e.sha)) skipped.push(e.path);
  const kept = entries.filter((e) => blobs.get(e.sha));
  const tree = new Map(kept.map((e) => [e.path, blobs.get(e.sha)]));
  tree.blobs = new Map(kept.map((e) => [e.path, e.sha]));
  // Every file the instruction files @-import, R3-M9.
  const text = (path) => (tree.has(path) ? tree.get(path).toString('utf8') : null);
  const byPath = new Map(all.map((e) => [e.path, e]));
  importClosure(entries.filter((e) => instruction(e.path) && e.path.endsWith('.md')).map((e) => e.path), (path) => {
    if (tree.has(path)) return text(path);
    const found = byPath.get(path);
    if (!found || !lenient(found)) return null;
    const more = readBlobs(root, [found], env, base, { lenient: true });
    if (!more.get(found.sha)) { skipped.push(path); return null; }
    tree.set(path, more.get(found.sha));
    tree.blobs.set(path, found.sha);
    return text(path);
  });

  const lock = parseLock(tree.get('.mirai/mirai.lock').toString('utf8'));
  const problems = [];
  for (const f of lock.files.values()) {
    if (f.mark !== 'framework') continue;
    if (!tree.has(f.path)) problems.push(`${f.path} is missing`);
    else if (sha256(tree.get(f.path)) !== f.sha256) problems.push(`${f.path} changed`);
  }
  for (const path of tree.keys()) {
    if (path.startsWith('.mirai/framework/') && lock.files.get(path)?.mark !== 'framework') problems.push(`${path} isn't in the lock`);
  }
  if (problems.length) {
    throw new TrustError(`the framework copy on the integration branch isn't MIRAI's as its lock lists (${problems.slice(0, 3).join('; ')}${problems.length > 3 ? '; …' : ''})`, { code: 'base-framework-changed', hint: 'restore it with mirai init --refresh on the integration branch, and commit' });
  }
  tree.skipped = [...new Set(skipped)].sort();
  return tree;
}

function readBlobs(root, entries, env, base, { lenient = false } = {}) {
  for (const e of entries) {
    if (e.mode === '120000') throw new TrustError(`${e.path} is a symbolic link on ${base.slice(0, 12)}`, { code: 'base-symlink', hint: 'MIRAI\'s files are real files' });
    if (e.type !== 'blob') throw new TrustError(`${e.path} is a ${e.type} on ${base.slice(0, 12)}, not a file`, { code: 'base-not-file' });
  }
  if (entries.length > LIMITS.files) throw new TrustError(`MIRAI's files on the integration branch are too many (${entries.length})`, { code: 'base-too-large' });
  const blobs = catBlobs(root, [...new Set(entries.map((e) => e.sha))], env, { maxBytes: LIMITS.fileBytes, maxTotal: LIMITS.totalBytes });
  for (const e of entries) {
    if (!blobs.get(e.sha) && !lenient) throw new TrustError(`${e.path} can't be read from ${base.slice(0, 12)} (missing, or over ${LIMITS.fileBytes} bytes)`, { code: 'base-blob' });
  }
  return blobs;
}

function loadTreeConfig(treeRoot) {
  const path = join(treeRoot, '.mirai/config.toml');
  if (!existsSync(path)) throw new TrustError('the integration branch has no .mirai/config.toml', { code: 'no-base-config' });
  return checkConfig([{ kind: 'project', file: readConfigFile(path, { trust: 'project', source: '.mirai/config.toml', within: treeRoot }) }]).config;
}

// Hashes a trust root again: the manifest against the store's record, and every file against
// the manifest, with nothing added or missing. Returns the trust object, or throws
// `trust-tampered` naming what differs.
export function verifyTrustRoot({ dir, manifestSha256 }) {
  let text;
  try {
    text = readFileSync(join(dir, MANIFEST), 'utf8');
  } catch {
    throw new TrustError(`the trust root ${dir} has no manifest`, { code: 'trust-tampered', hint: 'run: mirai trust snapshot (after removing the folder)' });
  }
  if (sha256(text) !== manifestSha256) throw new TrustError('the trust root\'s manifest changed since it was made', { code: 'trust-tampered', hint: 'stop the run; see what wrote to the MIRAI home' });
  const manifest = parseJsonStrict(text);
  const listed = new Map(manifest.files.map((f) => [f.path, f.sha256]));
  const problems = [];
  const onDisk = new Set();
  const folders = new Set(['.']);
  for (const p of listed.keys()) for (let d = dirname(p); d !== '.'; d = dirname(d)) folders.add(d);
  const walkDirs = (rel) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = rel === '.' ? e.name : `${rel}/${e.name}`;
      if (!folders.has(p)) problems.push(`${p}/ was added`);
      else walkDirs(p);
    }
  };
  walkDirs('.');
  for (const p of filesUnder(dir, '.').map((x) => x.slice(2))) {
    if (p === MANIFEST) continue;
    onDisk.add(p);
    const info = lstatSync(join(dir, p));
    if (!info.isFile()) problems.push(`${p} is not a file`);
    else if (!listed.has(p)) problems.push(`${p} was added`);
    else if (sha256(readFileSync(join(dir, p))) !== listed.get(p)) problems.push(`${p} changed`);
    else if (info.mode & 0o222) problems.push(`${p} was made writable`);
  }
  for (const p of listed.keys()) if (!onDisk.has(p)) problems.push(`${p} is missing`);
  if (problems.length) {
    throw new TrustError(`the trust root was changed (${problems.slice(0, 3).join('; ')}${problems.length > 3 ? '; …' : ''})`, { code: 'trust-tampered', hint: 'stop the run; see what wrote to the MIRAI home' });
  }
  return { dir, baseSha: manifest.base_sha, branch: manifest.branch, manifest, manifestSha256 };
}

// The trust root for the integration branch's current commit, hashed again; null when there is
// none yet.
// `baseSha`: the run's own base (units 19 and 26 pass it, so a pull or a merge during a run
// doesn't switch them to another snapshot).
export function openTrustRoot({ cwd, env, baseSha }) {
  const store = openStore({ cwd, env });
  const base = baseSha ?? baseCommit(store.checkout, store.branch, env);
  const entry = readRecord(store).snapshots[base];
  if (!entry) return null;
  return verifyTrustRoot({ dir: join(store.repoHome, TRUST_FOLDER, base), manifestSha256: entry.manifest_sha256 });
}

// A file of the snapshot's tree (repo-relative path), as bytes. Gates and hooks read MIRAI's
// files only this way.
// The bytes are hashed against the manifest on every read, so nothing can change them between
// the check and the read.
export function trustedFile(trust, path) {
  const listed = trust.manifest.files.find((f) => f.path === `tree/${path}`);
  if (!listed) throw new TrustError(`${path} isn't in the trust root`, { code: 'not-trusted' });
  const bytes = readFileSync(join(trust.dir, 'tree', path));
  if (sha256(bytes) !== listed.sha256) throw new TrustError(`the trust root was changed (tree/${path} changed)`, { code: 'trust-tampered', hint: 'stop the run; see what wrote to the MIRAI home' });
  return bytes;
}

// A strict template (unit 13b), hashed against the manifest on the read, like trustedFile.
export function trustedStrict(trust, name) {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(name)) throw new TrustError(`${name} isn't a strict template name`, { code: 'not-trusted' });
  const path = `strict/${name}.json`;
  const listed = trust.manifest.files.find((f) => f.path === path);
  if (!listed) throw new TrustError(`the trust root has no strict template for ${name}`, { code: 'not-trusted', hint: 'a framework copy from before unit 13b has none: mirai init --refresh, then commit' });
  const bytes = readFileSync(join(trust.dir, path));
  if (sha256(bytes) !== listed.sha256) throw new TrustError(`the trust root was changed (${path} changed)`, { code: 'trust-tampered', hint: 'stop the run; see what wrote to the MIRAI home' });
  return parseJsonStrict(bytes.toString('utf8'));
}

// The config and registry as gates read them: the whole trust root is hashed again first,
// since they're read from many files.
export function trustedConfig(trust) {
  verifyTrustRoot(trust);
  return loadTreeConfig(join(trust.dir, 'tree'));
}
export function trustedRegistry(trust) {
  verifyTrustRoot(trust);
  return loadRegistry(join(trust.dir, 'tree', '.mirai/framework/registry'));
}

// A reused snapshot is checked against the base commit itself, not only against the store's
// record: every file of tree/ must be the blob the commit has at that path, and the commit
// mustn't have MIRAI files the snapshot lacks.
function checkAgainstBase(trust, root, env) {
  const fresh = readBase(root, trust.baseSha, env);
  // The blob id is computed from the bytes on disk, so rewriting the manifest and the store's
  // record together still doesn't hide a changed file.
  const listed = new Set(trust.manifest.files.filter((f) => f.path.startsWith('tree/')).map((f) => f.path.slice(5)));
  const problems = [];
  for (const [path, blob] of fresh.blobs) {
    if (!listed.has(path)) problems.push(`${path} is missing`);
    else if (gitBlobId(readFileSync(join(trust.dir, 'tree', path)), blob.length) !== blob) problems.push(`${path} differs from the base commit`);
  }
  for (const path of listed) if (!fresh.blobs.has(path)) problems.push(`${path} isn't on the base commit`);
  if (problems.length) throw new TrustError(`the trust root doesn't match ${trust.baseSha.slice(0, 12)} (${problems.slice(0, 3).join('; ')})`, { code: 'trust-tampered', hint: 'stop the run; see what wrote to the MIRAI home' });
}

function readRecord(store) {
  const text = readPrivateFile(join(store.dir, RECORD), { optional: true });
  if (text === null) return { schema_version: 1, snapshots: {} };
  const value = parseJsonStrict(text);
  if (value?.schema_version !== 1 || typeof value.snapshots !== 'object' || value.snapshots === null) {
    throw new TrustError(`${RECORD} in the store is not valid`, { code: 'trust-record', hint: 'run: mirai doctor' });
  }
  return value;
}

// At most KEEP_SNAPSHOTS snapshots stay, newest first; the one in use always stays.
function prune(home, record, keep) {
  const byAge = Object.entries(record.snapshots).sort((a, b) => (a[1].created_at < b[1].created_at ? 1 : -1)).map(([sha]) => sha);
  const kept = new Set([...keep, ...byAge.filter((s) => !keep.has(s)).slice(0, Math.max(0, KEEP_SNAPSHOTS - keep.size))]);
  for (const sha of Object.keys(record.snapshots)) {
    if (kept.has(sha)) continue;
    delete record.snapshots[sha];
    if (existsSync(join(home, sha))) removeTree(join(home, sha));
  }
  for (const name of readdirSync(home)) {
    if (/^[0-9a-f]{40,64}$/.test(name) && !kept.has(name)) removeTree(join(home, name));
    // A temp folder left by a run that was killed while building one.
    if (name.startsWith('.tmp-') && Date.now() - lstatSync(join(home, name)).mtimeMs > TMP_MAX_AGE_MS) removeTree(join(home, name));
  }
}

function readOnly(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) readOnly(p);
    else chmodSync(p, 0o444);
  }
  chmodSync(dir, 0o555);
}

function removeTree(dir) {
  const writable = (d) => {
    chmodSync(d, 0o755);
    for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) writable(join(d, e.name));
  };
  writable(dir);
  rmSync(dir, { recursive: true, force: true });
}

// The id git gives a blob with these bytes (SHA-1, or SHA-256 in a repo that uses it).
function gitBlobId(bytes, length) {
  const header = Buffer.from(`blob ${bytes.length}\0`, 'latin1');
  return createHash(length === 64 ? 'sha256' : 'sha1').update(header).update(bytes).digest('hex');
}
