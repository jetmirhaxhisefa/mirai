import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { parseJsonStrict } from '../findings/schema.js';

// Checking a trust root (unit 12), on its own so the hook (unit 13c), which runs before every file
// tool call an agent makes, loads only this and not the rest of MIRAI: Node's built-ins and two
// small modules. snapshot.js builds trust roots and re-exports these.

const MANIFEST = 'manifest.json';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// The files under `rel` (relative to `root`), as "./a/b" paths, sorted. A copy of install/lock.js's
// filesUnder, kept here so the hook doesn't load lock.js; keep the two in step.
function filesUnder(root, rel) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const e of entries.sort((x, y) => (x.name < y.name ? -1 : 1))) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(rel);
  return out;
}

export class TrustError extends MiraiError {
  constructor(message, { code, hint, exitCode = EXIT.BLOCKED } = {}) {
    super(message, exitCode);
    this.name = 'TrustError';
    this.code = code;
    this.hint = hint;
  }
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
