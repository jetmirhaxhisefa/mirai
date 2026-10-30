import { posix } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { catBlobs, lsTree } from '../store/git.js';

// The files setup detection reads (unit 17a): the integration branch's commit, from git objects,
// never the work tree. So only tracked files count (build output, dependencies and your .env
// aren't there), a link is a link (its target is never followed), and what detection describes
// is what the config will run against. A nested repo or submodule is a gitlink: listed, never
// entered. MIRAI's own folder (.mirai/) isn't the project's, and is left out.

export const WALK_LIMITS = Object.freeze({ paths: 200_000, fileBytes: 1024 * 1024, readBytes: 32 * 1024 * 1024 });

export const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
export const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);
export const besides = (dir, name) => (dir ? `${dir}/${name}` : name);
export const shownDir = (dir) => (dir ? `${dir}/` : 'the top folder');

// { files: Map(path -> { sha, mode, size }), links: [path], nested: [path], folders: Set(path) }.
export function readTree(root, ref, env, { limits = WALK_LIMITS } = {}) {
  let entries;
  try {
    // Sizes need every blob's header: a large repo gets a minute, not git calls' usual 10 s.
    entries = lsTree(root, ref, '.', env, { recursive: true, sizes: true, maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });
  } catch (err) {
    if (err.code === 'git-output-too-large') throw new StoreError(`the integration branch has more files than detection reads (${limits.paths})`, { code: 'detect-too-large' });
    if (err.code === 'git-timeout') throw new StoreError('listing the integration branch\'s files took longer than a minute', { code: 'detect-too-large' });
    throw err;
  }
  if (entries === null) throw new StoreError('git ls-tree failed on the integration branch', { code: 'git-failed' });
  if (entries.length > limits.paths) throw new StoreError(`the integration branch has more than ${limits.paths} files, more than detection reads`, { code: 'detect-too-large' });
  const files = new Map();
  const links = [];
  const nested = [];
  const folders = new Set(['']);
  for (const e of entries) {
    if (e.path === '.mirai' || e.path.startsWith('.mirai/')) continue;
    if (e.type === 'commit') nested.push(e.path);
    else if (e.type === 'blob' && e.mode === '120000') links.push(e.path);
    else if (e.type === 'blob') files.set(e.path, { sha: e.sha, mode: e.mode, size: e.size });
    for (let d = dirOf(e.path); d && !folders.has(d); d = dirOf(d)) folders.add(d);
  }
  return { files, links: links.sort(), nested: nested.sort(), folders };
}

// The blobs of tracked files, read in batches and kept: get(path) is a Buffer, or null for a
// file that isn't tracked, is a link, or is larger than `fileBytes`. Reads stop at `readBytes` in
// all (a file asked for after that is null, and `capped` says so).
export function blobReader(root, tree, env, { limits = WALK_LIMITS } = {}) {
  const cache = new Map();
  let total = 0;
  let capped = false;
  // Only files within `fileBytes` are asked for (their sizes come from the tree), in batches of
  // at most 8 MiB, so git's output never holds a large file.
  const fetch = (paths) => {
    const want = [];
    for (const p of new Set(paths)) {
      if (cache.has(p)) continue;
      const f = tree.files.get(p);
      if (!f || !(f.size <= limits.fileBytes)) cache.set(p, null);
      else if (total + f.size > limits.readBytes) {
        capped = true;
        cache.set(p, null);
      } else {
        total += f.size;
        want.push(p);
      }
    }
    const BATCH = 8 * 1024 * 1024;
    for (let i = 0; i < want.length;) {
      const batch = [];
      for (let size = 0; i < want.length && (batch.length === 0 || size + tree.files.get(want[i]).size <= BATCH); i++) {
        size += tree.files.get(want[i]).size;
        batch.push(want[i]);
      }
      const blobs = catBlobs(root, batch.map((p) => tree.files.get(p).sha), env, { maxBytes: limits.fileBytes, maxTotal: BATCH + limits.fileBytes });
      for (const p of batch) cache.set(p, blobs.get(tree.files.get(p).sha) ?? null);
    }
  };
  return {
    prefetch: (paths) => fetch(paths),
    get(path) {
      if (!cache.has(path)) fetch([path]);
      return cache.get(path);
    },
    text(path) {
      const b = this.get(path);
      return b === null ? null : b.toString('utf8');
    },
    // A JSON object, or null (missing, unreadable, or not an object).
    json(path) {
      const t = this.text(path);
      if (t === null) return null;
      try {
        const v = JSON.parse(t);
        return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
      } catch {
        return null;
      }
    },
    get capped() {
      return capped;
    },
  };
}

// The tracked files named `name` (a file name, or the end of a path such as
// ".github/copilot-instructions.md") at any depth, sorted.
export function filesNamed(tree, name) {
  const out = [];
  for (const p of tree.files.keys()) if (p === name || p.endsWith(`/${name}`)) out.push(p);
  return out.sort();
}

// The tracked files under folder `folder` (a name or a path, matched at any depth), sorted.
export function filesUnderFolder(tree, folder) {
  const out = [];
  for (const p of tree.files.keys()) {
    if (p.startsWith(`${folder}/`) || p.includes(`/${folder}/`)) out.push(p);
  }
  return out.sort();
}

// `rel` joined to `dir`, normalised, or null when it climbs out of the repo.
export function joinIn(dir, rel) {
  const p = posix.normalize(besides(dir, rel));
  return p === '..' || p.startsWith('../') || p.startsWith('/') ? null : p;
}
