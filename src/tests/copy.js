import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

import { lsFiles } from '../store/git.js';
import { TestRunError } from './docker.js';

// The copied tree (unit 14c; 14a's finding: masks over files leak on a case-insensitive Mac).
// Test containers never mount your checkout. Each run gets a fresh copy of the files git lists
// (tracked, plus new ones not ignored), without `.git` and without any `.env*` file but the
// committed dummy ones (`keep`, written from the base commit's blobs, never the work tree).
//
// Nothing is ever followed (14c review: a chain of links that stays inside on paper led out):
// - a path whose folders include a link is refused;
// - a file is read through a descriptor opened without following links, and must have one name
//   on disk (a hard link would bring another file's content under a harmless name);
// - a link is copied as a link only when its target is relative and has no `..`, so it can only
//   point further down inside its own folder. Docker Desktop follows an absolute link given as a
//   mount source (probed in 14c), and the copy must never hold one.

export const COPY_LIMITS = Object.freeze({ files: 100_000, bytes: 2 * 1024 ** 3 });

// Whether a repo-relative path is an env file: any part named `.env*`, in any case.
export const isEnvPath = (path) => path.split('/').some((part) => part.toLowerCase().startsWith('.env'));
const isGitPath = (path) => path.split('/').some((part) => part.toLowerCase() === '.git');

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const refuse = (message, code, hint) => new TestRunError(message, { code, hint });

// Copies `root` (a checkout) into `dest` (which must not exist). `keep`: Map from a committed
// dummy env file's path to its bytes on the base commit. Returns { files, bytes, treeHash, left }
// where `left` lists the env files left out.
export function copyTree({ root, env, dest, keep = new Map(), limits = COPY_LIMITS }) {
  const names = lsFiles(root, ['.'], env);
  if (names === null) throw refuse('git couldn\'t list the project\'s files', 'copy-list');
  mkdirSync(dest, { mode: 0o700 });
  const entries = [];
  const left = [];
  const realFolders = new Set(['']);
  let bytes = 0;
  // Every folder on the way to `name` is a real folder of the checkout, not a link.
  const folderChecked = (name) => {
    const parts = name.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const rel = parts.slice(0, i).join('/');
      if (realFolders.has(rel)) continue;
      let info;
      try {
        info = lstatSync(join(root, rel));
      } catch {
        return false; // gone meanwhile: nothing to copy under it
      }
      if (info.isSymbolicLink()) throw refuse(`${rel} is a link, and ${name} is under it`, 'copy-link', 'test runs copy nothing through a link; make it a folder');
      if (!info.isDirectory()) return false;
      realFolders.add(rel);
    }
    return true;
  };
  const write = (name, body, mode) => {
    bytes += body.length;
    if (entries.length + 1 > limits.files || bytes > limits.bytes) {
      throw refuse(`the project is larger than a test run copies (${limits.files} files, ${Math.round(limits.bytes / 1024 ** 2)} MiB)`, 'copy-too-large', 'ignore build output and dependencies in .gitignore; they come from the images');
    }
    const to = join(dest, name);
    mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
    writeFileSync(to, body, { mode, flag: 'wx' });
    entries.push(`${name}\0${mode.toString(8)}\0${sha256(body)}`);
  };
  try {
    for (const name of names.sort()) {
      if (isGitPath(name)) continue;
      if (isEnvPath(name)) {
        if (keep.has(name) && folderChecked(name)) write(name, keep.get(name), 0o644);
        else left.push(name);
        continue;
      }
      if (!folderChecked(name)) continue;
      const src = join(root, name);
      let info;
      try {
        info = lstatSync(src);
      } catch (err) {
        if (err.code === 'ENOENT') continue; // a tracked file deleted in the work tree: not there to test
        throw err;
      }
      if (info.isSymbolicLink()) {
        const target = readlinkSync(src);
        if (target.startsWith('/') || target.split('/').includes('..') || isGitPath(target) || target === '') {
          throw refuse(`${name} is a link to ${target}`, 'copy-link', 'test runs copy a link only when it points further down in its own folder (no "/" at the start, no ".."); make it a file or a relative link');
        }
        mkdirSync(dirname(join(dest, name)), { recursive: true, mode: 0o700 });
        symlinkSync(target, join(dest, name));
        entries.push(`${name}\0link\0${target}`);
        continue;
      }
      if (!info.isFile()) throw refuse(`${name} is neither a file nor a link`, 'copy-type');
      let fd;
      try {
        fd = openSync(src, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (err) {
        if (err.code === 'ELOOP') throw refuse(`${name} became a link while it was copied`, 'copy-link');
        throw err;
      }
      try {
        const st = fstatSync(fd);
        if (!st.isFile()) throw refuse(`${name} is neither a file nor a link`, 'copy-type');
        if (st.nlink > 1) throw refuse(`${name} has another name on disk (a hard link)`, 'copy-hardlink', 'a hard link could bring another file\'s content into the test run; make it a copy');
        write(name, readFileSync(fd), st.mode & 0o111 ? 0o755 : 0o644);
      } finally {
        closeSync(fd);
      }
    }
  } catch (err) {
    rmSync(dest, { recursive: true, force: true });
    throw err;
  }
  return { files: entries.length, bytes, treeHash: sha256(entries.join('\n')), left };
}

export function removeCopy(dest) {
  rmSync(normalize(dest), { recursive: true, force: true });
}
