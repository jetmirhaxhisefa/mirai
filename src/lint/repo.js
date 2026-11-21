import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

// The repo's code, read for the context lints (unit 36): whether a path exists, a file's text,
// and the source files under some folders. Paths are from the repo's top folder, written with /;
// one that climbs out (..), starts with /, or resolves outside the repo through a link reads as
// missing, so a context file can't tell what exists outside the repo. Nothing is written.

export const LIMITS = Object.freeze({ fileBytes: 512 * 1024, sourceFiles: 5000 });
// Folders that hold installed or built code, never the project's own.
const SKIP = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', 'coverage', '.mirai', '.next', '.nuxt', 'target', '__pycache__', '.venv', 'venv']);
// The files a screen's handles and routes are written in.
const SOURCE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|html?|php|twig|py|rb|erb|haml|slim|go|rs|java|kt|swift|cs|cshtml|razor|dart|ex|exs|heex|elm)$/i;
// Tests name handles too, so a handle found only in a test isn't in the code.
const TEST = /(?:^|\/)(?:__tests__|tests?|e2e|spec)\/|\.(?:test|spec|stories)\.[a-z]+$/i;

// A repo path as written in a context file, normalized, or null when it isn't one.
export function repoPath(text) {
  const t = String(text ?? '').trim().replace(/\/+$/, '');
  if (t === '' || t === '.') return '.';
  if (t.startsWith('/') || t.includes('\\') || t.includes('\0')) return null;
  const n = posix.normalize(t);
  if (n === '..' || n.startsWith('../')) return null;
  return n;
}

export function repoReader(root) {
  const real = realpathSync.native(root);
  const cache = new Map();
  const inside = (p) => p === real || p.startsWith(real + sep);
  // The real path of a repo path, or null (missing, outside).
  const locate = (rel) => {
    const n = repoPath(rel);
    if (n === null) return null;
    const full = n === '.' ? real : join(real, n);
    try {
      lstatSync(full);
      const r = realpathSync.native(full);
      return inside(r) ? r : null;
    } catch {
      return null;
    }
  };
  const exists = (rel) => {
    const at = locate(rel);
    if (!at) return null;
    try {
      const s = lstatSync(at);
      return s.isDirectory() ? 'dir' : s.isFile() ? 'file' : null;
    } catch {
      return null;
    }
  };
  const text = (rel) => {
    const at = locate(rel);
    if (!at) return null;
    let fd;
    try {
      fd = openSync(at, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const s = fstatSync(fd);
      if (!s.isFile() || s.size > LIMITS.fileBytes) return null;
      return readFileSync(fd).toString('utf8');
    } catch {
      return null;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };
  // The source files under `dirs` (repo paths): [{ path, text }], tests and installed code left
  // out, at most LIMITS.sourceFiles in all.
  const sources = (dirs) => {
    const key = JSON.stringify(dirs);
    if (cache.has(key)) return cache.get(key);
    const out = [];
    const seen = new Set();
    const visit = (rel) => {
      if (out.length >= LIMITS.sourceFiles) return;
      const at = locate(rel);
      if (!at || seen.has(at)) return;
      seen.add(at);
      let s;
      try {
        s = lstatSync(at);
      } catch {
        return;
      }
      if (s.isDirectory()) {
        let names = [];
        try {
          names = readdirSync(at).sort();
        } catch {
          return;
        }
        for (const name of names) if (!SKIP.has(name)) visit(rel === '.' ? name : `${rel}/${name}`);
      } else if (s.isFile() && SOURCE.test(rel) && !TEST.test(rel)) {
        const t = text(rel);
        if (t !== null && !t.includes('\0')) out.push({ path: rel, text: t });
      }
    };
    for (const d of dirs) {
      const n = repoPath(d);
      if (n !== null) visit(n);
    }
    cache.set(key, out);
    return out;
  };
  return { root: real, exists, text, sources };
}
