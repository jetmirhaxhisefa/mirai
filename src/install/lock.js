import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, lstatSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { compileSchema, parseJsonStrict } from '../findings/schema.js';
import { blockOf } from './agents-block.js';

// The lock, `.mirai/mirai.lock` (unit 10; D-02, D-37). It lists every file MIRAI put into the
// project, with its mark:
// - `framework`: MIRAI's own file, as it is; with its hash;
// - `rendered`: generated from framework plus project data (the AGENTS.md block, later the
//   tool files); with the hash of what MIRAI owns (for AGENTS.md, the block only);
// - `project`: yours; no hash, it changes freely.
// The trust root (unit 12) and `mirai doctor` (unit 29) check the files against it.

export const LOCK_FILE = '.mirai/mirai.lock';
export const LOCK_SCHEMA_VERSION = 1;
const PATH = '^(?!/)(?!(?:.*/)?\\.{1,2}(?:/|$))[A-Za-z0-9._/@+-]{1,512}$';
const HASH = { type: 'string', maxLength: 64, pattern: '^[0-9a-f]{64}$' };
const VERSION = '[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?';
const validate = compileSchema({
  type: 'object', additionalProperties: false, required: ['schema_version', 'mirai_version', 'source', 'framework_sha256', 'files'],
  properties: {
    schema_version: { const: LOCK_SCHEMA_VERSION },
    mirai_version: { type: 'string', maxLength: 64, pattern: `^${VERSION}$` },
    // Where the framework copy came from: a MIRAI working copy (`local`), or a released version.
    source: { type: 'string', maxLength: 64, pattern: `^(?:local|v${VERSION})$` },
    // One hash for the whole framework copy, over its entries (frameworkDigest).
    framework_sha256: HASH,
    // Each tool's launch bundle (unit 11): its shared hash, which unit 12's snapshot and unit
    // 19's launch check compare against. A new tool adds its key.
    bundles: { type: 'object', additionalProperties: false, properties: { 'claude-code': HASH } },
    files: { type: 'array', maxItems: 20000, items: { $ref: '#/$defs/file' } },
  },
  $defs: {
    file: {
      type: 'object', additionalProperties: false, required: ['path', 'mark'],
      properties: {
        path: { type: 'string', maxLength: 512, pattern: PATH },
        mark: { enum: ['framework', 'rendered', 'project'] },
        block: { enum: ['mirai'] },
        sha256: HASH,
        // For a rendered file: what it was rendered from, with each input's hash then.
        from: {
          type: 'array', maxItems: 64,
          items: { type: 'object', additionalProperties: false, required: ['path', 'sha256'], properties: { path: { type: 'string', maxLength: 512, pattern: PATH }, sha256: HASH } },
        },
      },
    },
  },
});

export class LockError extends MiraiError {
  constructor(message, { code, hint } = {}) {
    super(message, EXIT.CONFIG);
    this.name = 'LockError';
    this.code = code;
    this.hint = hint;
  }
}

export const sha256 = (bytes, encoding) => createHash('sha256').update(bytes, encoding).digest('hex');

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

// The hash of the framework copy as a whole: over each framework entry's path and hash, in path
// order. Two installs of the same MIRAI have the same digest.
export function frameworkDigest(files) {
  const lines = files.filter((f) => f.mark === 'framework').sort(byPath).map((f) => `${f.sha256} ${f.path}\n`);
  return sha256(lines.join(''));
}

// The lock's text: entries sorted by path, so the same install always gives the same bytes.
export function lockText({ miraiVersion, source, bundles, files }) {
  const sorted = [...files].sort(byPath);
  const lock = { schema_version: LOCK_SCHEMA_VERSION, mirai_version: miraiVersion, source, framework_sha256: frameworkDigest(sorted), ...(bundles && Object.keys(bundles).length ? { bundles } : {}), files: sorted };
  const problems = validate(JSON.parse(JSON.stringify(lock)));
  if (problems.length) throw new LockError(`the lock MIRAI built is not valid (${problems[0].path})`, { code: 'lock-invalid' });
  checkEntries(sorted, 'the lock MIRAI built');
  return `${JSON.stringify(lock, null, 2)}\n`;
}

function checkEntries(files, what) {
  const seen = new Set();
  for (const f of files) {
    if (seen.has(f.path)) throw new LockError(`${what} lists ${f.path} twice`, { code: 'lock-invalid' });
    seen.add(f.path);
    if (f.mark !== 'project' && !f.sha256) throw new LockError(`${what}: ${f.path} is ${f.mark}, so it needs its hash`, { code: 'lock-invalid' });
    if (f.mark === 'project' && (f.sha256 || f.block || f.from)) throw new LockError(`${what}: ${f.path} is yours, so it has no hash`, { code: 'lock-invalid' });
    if (f.mark !== 'rendered' && (f.block || f.from)) throw new LockError(`${what}: only a rendered file has a block or inputs (${f.path})`, { code: 'lock-invalid' });
  }
}

// Reads and checks the lock in `root`. Returns { miraiVersion, source, frameworkSha256,
// files: Map(path -> entry) }, or null when there is no lock. A lock from a newer MIRAI is
// refused with its own code, `lock-newer`.
export function readLock(root) {
  let text;
  try {
    noLinks(root, LOCK_FILE);
    text = readFileSync(join(root, LOCK_FILE), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  return parseLock(text);
}

// A lock's text, checked as readLock checks the file (unit 12 reads a committed one).
export function parseLock(text) {
  let value;
  try {
    value = parseJsonStrict(text);
  } catch (err) {
    throw new LockError(`${LOCK_FILE} can't be read: ${err.message}`, { code: 'lock-invalid' });
  }
  const version = value?.schema_version;
  if (Number.isInteger(version) && version > LOCK_SCHEMA_VERSION) {
    throw new LockError(`${LOCK_FILE} was written by a newer MIRAI (lock schema ${version}; this one reads ${LOCK_SCHEMA_VERSION})`, { code: 'lock-newer', hint: 'run the MIRAI version the lock names, or update this one' });
  }
  const problems = validate(value);
  if (problems.length) {
    // Fields are only ever added within a schema version, so a lock this MIRAI can't read but
    // a newer one wrote is the newer one's (unit 11).
    if (typeof value?.mirai_version === 'string' && newer(value.mirai_version, RUNNING_VERSION)) {
      throw new LockError(`${LOCK_FILE} was written by a newer MIRAI (${value.mirai_version}; this is ${RUNNING_VERSION})`, { code: 'lock-newer', hint: 'run the MIRAI version the lock names, or update this one' });
    }
    throw new LockError(`${LOCK_FILE} is not valid (${problems[0].path} ${problems[0].code})`, { code: 'lock-invalid' });
  }
  checkEntries(value.files, LOCK_FILE);
  if (frameworkDigest(value.files) !== value.framework_sha256) {
    throw new LockError(`${LOCK_FILE}: its framework_sha256 doesn't match its framework entries`, { code: 'lock-invalid' });
  }
  return { miraiVersion: value.mirai_version, source: value.source, frameworkSha256: value.framework_sha256, bundles: { ...(value.bundles ?? {}) }, files: new Map(value.files.map((f) => [f.path, f])) };
}

// Puts new entries into the lock (by path; an existing entry is replaced), takes out the
// `remove` paths, and writes it in one step. Used by `mirai render` for the rendered files.
export function updateLock(root, entries, { remove = [], bundles = {} } = {}) {
  const lock = readLock(root);
  if (!lock) throw new LockError('MIRAI is not installed here (no lock)', { code: 'no-lock', hint: 'run: mirai init' });
  for (const path of remove) lock.files.delete(path);
  for (const e of entries) lock.files.set(e.path, e);
  const text = lockText({ miraiVersion: lock.miraiVersion, source: lock.source, bundles: { ...lock.bundles, ...bundles }, files: [...lock.files.values()] });
  replaceFile(join(root, LOCK_FILE), text);
  return text;
}

// Writes a file in one step: a new file beside it, then a rename over it (a symbolic link is
// replaced, never followed). `mode` defaults to the old file's, else 0644.
export function replaceFile(path, data, mode) {
  let keep = 0o644;
  try {
    const info = lstatSync(path);
    if (info.isFile()) keep = info.mode & 0o777;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const tmp = join(dirname(path), `.${basename(path)}.mirai-${process.pid}-${randomBytes(4).toString('hex')}`);
  writeFileSync(tmp, data, { flag: 'wx', mode: 0o600 });
  try {
    chmodSync(tmp, mode ?? keep);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

// Refuses a symbolic link anywhere on the way to `rel` (inside `root`), so a check never reads
// files from outside the repo.
export function noLinks(root, rel) {
  let p = root;
  for (const part of rel.split('/')) {
    p = join(p, part);
    let info;
    try {
      info = lstatSync(p);
    } catch (err) {
      if (err.code === 'ENOENT') return;
      if (err.code === 'ENOTDIR') throw new LockError(`${relative(root, dirname(p)).split(sep).join('/')} is not a folder`, { code: 'not-folder' });
      throw err;
    }
    if (info.isSymbolicLink()) throw new LockError(`${relative(root, p).split(sep).join('/')} is a symbolic link`, { code: 'lock-symlink', hint: 'MIRAI\'s files are real files and folders' });
  }
}

// What MIRAI owns, as it is now in `root`: { changed, missing, added } (paths). `added` are files
// under .mirai/framework/ that the lock doesn't list. Project files are never checked. A
// symbolic link on the way to a listed file is refused; a listed file that is itself a link (or
// not a regular file) counts as missing.
export function checkLock(root) {
  const lock = readLock(root);
  if (!lock) throw new LockError('MIRAI is not installed here (no lock)', { code: 'no-lock', hint: 'run: mirai init' });
  const out = { changed: [], missing: [], added: [] };
  noLinks(root, '.mirai/framework');
  const dirs = new Set();
  for (const f of lock.files.values()) {
    if (f.mark === 'project') continue;
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    if (dir && !dirs.has(dir)) { noLinks(root, dir); dirs.add(dir); }
    let bytes;
    try {
      const info = lstatSync(join(root, f.path));
      if (!info.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
      bytes = readFileSync(join(root, f.path));
    } catch (err) {
      if (err.code === 'ENOENT') { out.missing.push(f.path); continue; }
      throw err;
    }
    const hash = f.block ? blockHash(bytes.toString('utf8'), f.path) : f.mark === 'rendered' ? renderedHash(bytes) : sha256(bytes);
    if (hash !== f.sha256) out.changed.push(f.path);
  }
  for (const path of filesUnder(root, '.mirai/framework')) {
    if (!lock.files.has(path)) out.added.push(path);
  }
  return out;
}

// The hash of a file's MIRAI block, or null when it has none.
export function blockHash(text, file) {
  const block = blockOf(text, { file });
  return block === null ? null : sha256(block);
}

// The hash of a whole rendered file, with CRLF read as LF: git may convert line endings in a
// teammate's checkout (core.autocrlf), and that isn't an edit (unit 11). MIRAI writes LF.
export const renderedHash = (bytes) => sha256(Buffer.from(bytes).toString('latin1').replace(/\r\n/g, '\n'), 'latin1');

// The version of the running MIRAI, and whether `a` is a newer version than `b`.
export const RUNNING_VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
export function newer(a, b) {
  const parts = (v) => v.split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

// Every regular file and symbolic link under `rel`, as paths relative to `root`.
export function filesUnder(root, rel) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(rel);
  return out;
}
