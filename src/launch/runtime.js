import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { catBlobs, lsTree } from '../store/git.js';
import { ensurePrivateDir } from '../store/files.js';
import { filesUnder, sha256 } from '../install/lock.js';

// The sealed copy (unit 12b): the launcher never runs MIRAI's code from the work tree, which an
// agent working in the same checkout could change between a check and a run. It builds the
// trusted commit's framework copy from git objects into a private, read-only folder in the store
// (`<repo-home>/store/runtime/<digest>/`, once per version), checks it against that commit's
// lock, and runs that. A folder that no longer matches is built again.

const FRAMEWORK = '.mirai/framework';
const LIMITS = Object.freeze({ files: 5000, totalBytes: 64 * 1024 * 1024 });

// The digest of a framework copy: over each file's hash and path (relative to the copy).
export function copyDigest(files) {
  return sha256([...files].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([p, h]) => `${h} ${p}\n`).join(''));
}

// The sealed copy for `commit`, whose lock lists `files` (Map: `.mirai/framework/…` path ->
// sha256): its folder, built if needed. Returns { dir, built }.
export function sealedCopy({ root, env, storeDir, commit, files }) {
  const digest = copyDigest(files);
  const home = join(storeDir, 'runtime');
  ensurePrivateDir(home);
  const dir = join(home, digest);
  if (existsSync(dir) && intact(dir, files)) return { dir, built: false };

  const entries = lsTree(root, commit, FRAMEWORK, env, { recursive: true }) ?? [];
  const listed = new Map(entries.map((e) => [e.path, e]));
  if (entries.length > LIMITS.files || listed.size !== files.size || [...files.keys()].some((p) => !listed.has(p))) {
    throw new MiraiError(`the framework copy on ${commit.slice(0, 12)} isn't what its lock lists`, EXIT.BLOCKED);
  }
  for (const e of entries) {
    if (e.type !== 'blob' || (e.mode !== '100644' && e.mode !== '100755')) throw new MiraiError(`${e.path} on ${commit.slice(0, 12)} is not a regular file`, EXIT.BLOCKED);
  }
  const blobs = catBlobs(root, [...new Set(entries.map((e) => e.sha))], env, { maxBytes: LIMITS.totalBytes, maxTotal: LIMITS.totalBytes });
  const tmp = join(home, `.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    for (const e of entries) {
      const bytes = blobs.get(e.sha);
      if (!bytes || sha256(bytes) !== files.get(e.path)) throw new MiraiError(`${e.path} on ${commit.slice(0, 12)} doesn't match its lock`, EXIT.BLOCKED);
      const to = join(tmp, e.path.slice(FRAMEWORK.length + 1));
      mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
      writeFileSync(to, bytes, { flag: 'wx', mode: 0o600 });
      chmodSync(to, e.mode === '100755' ? 0o555 : 0o444);
    }
    readOnlyFolders(tmp);
    if (existsSync(dir)) removeTree(dir);
    renameSync(tmp, dir);
  } catch (err) {
    if (existsSync(tmp)) removeTree(tmp);
    throw err;
  }
  return { dir, built: true };
}

// Whether a sealed folder still holds exactly `files`, read-only.
function intact(dir, files) {
  const found = filesUnder(dir, '.').map((p) => p.slice(2));
  if (found.length !== files.size) return false;
  for (const p of found) {
    const info = lstatSync(join(dir, p));
    if (!info.isFile() || info.mode & 0o222) return false;
    if (sha256(readFileSync(join(dir, p))) !== files.get(`${FRAMEWORK}/${p}`)) return false;
  }
  return true;
}

function readOnlyFolders(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) readOnlyFolders(join(dir, e.name));
  chmodSync(dir, 0o500);
}

function removeTree(dir) {
  const writable = (d) => {
    chmodSync(d, 0o700);
    for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) writable(join(d, e.name));
  };
  writable(dir);
  rmSync(dir, { recursive: true, force: true });
}
