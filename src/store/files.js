import {
  closeSync, constants, fstatSync, fsyncSync, ftruncateSync, linkSync, lstatSync, mkdirSync, openSync,
  readSync, renameSync, unlinkSync, writeSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { StoreError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';

// The safe file primitives of the store (unit 05a): private folders and files, atomic writes,
// append-only JSON lines and lock files. Everything is synchronous, so a write is finished
// before the next step starts.

export const LINE_MAX_BYTES = 16 * 1024;
export const STRING_MAX = 4096;
const READ_MAX_BYTES = 64 * 1024 * 1024;
const { O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_EXCL, O_APPEND, O_NOFOLLOW } = constants;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const myUid = () => process.getuid();

function storeError(path, message, code, hint) {
  return new StoreError(`${path}: ${message}`, { path, code, hint });
}

// The owner and mode rule for everything in the MIRAI home: yours, and nobody else's.
function checkPrivate(path, info, kind) {
  if (info.uid !== myUid()) throw storeError(path, `is not owned by you`, 'owner', `MIRAI's ${kind}s must belong to your user`);
  if ((info.mode & 0o077) !== 0) {
    const mode = (info.mode & 0o777).toString(8);
    throw storeError(path, `can be used by other users (mode ${mode})`, 'mode', `run: chmod ${kind === 'folder' ? 700 : 600} "${path}"`);
  }
}

// Checks a folder: real (not a symbolic link), yours, private. Returns false when it's missing.
export function checkPrivateDir(path) {
  let info;
  try {
    info = lstatSync(path);
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw storeError(path, `can't be read (${err.code})`, 'unreadable');
  }
  if (info.isSymbolicLink()) throw storeError(path, 'is a symbolic link', 'symlink', "MIRAI's folders must be real folders");
  if (!info.isDirectory()) throw storeError(path, 'is not a folder', 'not-folder');
  checkPrivate(path, info, 'folder');
  return true;
}

// Creates a private folder (0700) if it's missing, then checks it.
export function ensurePrivateDir(path) {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (err) {
    if (err.code !== 'EEXIST') throw storeError(path, `can't be created (${err.code})`, 'unwritable');
  }
  checkPrivateDir(path);
}

// Checks a file: real (not a symbolic link), yours, private. Returns false when it's missing.
export function checkPrivateFile(path) {
  let info;
  try {
    info = lstatSync(path);
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw storeError(path, `can't be read (${err.code})`, 'unreadable');
  }
  if (info.isSymbolicLink()) throw storeError(path, 'is a symbolic link', 'symlink', "MIRAI's files must be real files");
  if (!info.isFile()) throw storeError(path, 'is not a file', 'not-file');
  checkPrivate(path, info, 'file');
  return true;
}

// Opens a store file without following a symbolic link and checks it's a private regular file.
function openPrivate(path, flags, kind = 'file') {
  let fd;
  try {
    fd = openSync(path, flags | O_NOFOLLOW, 0o600);
  } catch (err) {
    if (err.code === 'ELOOP') throw storeError(path, 'is a symbolic link', 'symlink', "MIRAI's files must be real files");
    throw err;
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) throw storeError(path, 'is not a file', 'not-file');
    checkPrivate(path, info, kind);
    return { fd, info };
  } catch (err) {
    closeSync(fd);
    throw err;
  }
}

// Reads a private file as UTF-8 text; null when it's missing and `optional`.
export function readPrivateFile(path, { maxBytes = READ_MAX_BYTES, optional = false } = {}) {
  let opened;
  try {
    opened = openPrivate(path, O_RDONLY);
  } catch (err) {
    if (err.code === 'ENOENT') {
      if (optional) return null;
      throw storeError(path, 'is missing', 'missing', 'run: mirai doctor');
    }
    if (err instanceof StoreError) throw err;
    throw storeError(path, `can't be read (${err.code})`, 'unreadable');
  }
  const { fd, info } = opened;
  try {
    if (info.size > maxBytes) throw storeError(path, `is larger than ${maxBytes} bytes`, 'too-large', 'run: mirai doctor');
    const buf = Buffer.alloc(info.size);
    let got = 0;
    while (got < info.size) {
      const n = readSync(fd, buf, got, info.size - got, got);
      if (n === 0) break;
      got += n;
    }
    try {
      return utf8.decode(buf.subarray(0, got));
    } catch {
      throw storeError(path, 'is not valid UTF-8', 'encoding', 'run: mirai doctor');
    }
  } finally {
    closeSync(fd);
  }
}

// Replaces a file atomically: a private temp file in the same folder, fsync, rename, fsync of
// the folder. A reader sees the old file or the new one, never half of one.
export function atomicWrite(path, text) {
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
  const fd = openSync(tmp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600);
  try {
    writeAll(fd, Buffer.from(text, 'utf8'));
    fsyncSync(fd);
  } catch (err) {
    closeSync(fd);
    unlinkQuiet(tmp);
    throw err;
  }
  closeSync(fd);
  try {
    renameSync(tmp, path);
  } catch (err) {
    unlinkQuiet(tmp);
    throw err;
  }
  syncDir(dirname(path));
}

function writeAll(fd, buf) {
  let done = 0;
  while (done < buf.length) done += writeSync(fd, buf, done, buf.length - done);
}

function syncDir(path) {
  const fd = openSync(path, O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function unlinkQuiet(path) {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
}

// Serializes one JSON line and checks the limits: 16 KB a line, 4096 characters a string.
// Bulky text never goes into a line; it's a file in the store, referenced by { ref, sha256 }.
export function jsonLine(value) {
  const long = findLongString(value);
  if (long !== null) throw new RangeError(`${long || 'the value'} is longer than ${STRING_MAX} characters; store bulky text as a file and reference it`);
  const text = `${JSON.stringify(value)}\n`;
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > LINE_MAX_BYTES) throw new RangeError(`the line is ${bytes} bytes, more than ${LINE_MAX_BYTES}`);
  return text;
}

function findLongString(value, path = '') {
  if (typeof value === 'string') return value.length > STRING_MAX ? path : null;
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const found = findLongString(v, path ? `${path}.${k}` : k);
      if (found !== null) return found;
    }
  }
  return null;
}

// Appends one line with a single write on an O_APPEND descriptor. The caller MUST hold the
// file's lock: cutting a torn tail is only safe while nobody else writes. A torn tail (a crash mid-write) is cut off first: it's the one line a crashed writer
// never finished, and its number is a gap. So a crash costs that line, never the next one too
// (bmad-loop's concern; it heals with a newline, but here a broken line in the middle fails
// closed, so the fragment must not stay).
export function appendLine(path, text) {
  if (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1) throw new RangeError('one line, ending with a newline');
  const { fd, info } = openPrivate(path, O_RDWR | O_APPEND | O_CREAT);
  try {
    if (info.size > 0) cutTornTail(path, fd, info.size);
    writeAll(fd, Buffer.from(text, 'utf8'));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// The fragment is kept in `<file>.torn` (one per line), so doctor has the evidence.
function cutTornTail(path, fd, size) {
  const span = Math.min(size, LINE_MAX_BYTES + 1);
  const buf = Buffer.alloc(span);
  readSync(fd, buf, 0, span, size - span);
  if (buf[span - 1] === 0x0a) return;
  const nl = buf.lastIndexOf(0x0a);
  if (nl === -1 && span < size) {
    throw new StoreError(`${path}: ends with a fragment longer than any line`, { path, code: 'corrupt-line', hint: 'run: mirai doctor' });
  }
  const fragment = buf.subarray(nl + 1);
  const kept = openPrivate(`${path}.torn`, O_WRONLY | O_APPEND | O_CREAT);
  try {
    writeAll(kept.fd, Buffer.concat([fragment, Buffer.from('\n')]));
    fsyncSync(kept.fd);
  } finally {
    closeSync(kept.fd);
  }
  ftruncateSync(fd, size - span + nl + 1);
}

// The last complete line of a JSON-lines file, parsed; null when there is none. Reads only the
// tail, so checks that need the newest entry don't parse the whole file.
export function lastJsonLine(path) {
  const { fd, info } = openPrivate(path, O_RDONLY);
  try {
    const span = Math.min(info.size, 2 * LINE_MAX_BYTES + 2);
    const buf = Buffer.alloc(span);
    readSync(fd, buf, 0, span, info.size - span);
    let end = buf.lastIndexOf(0x0a);
    if (end === -1) return null;
    const start = buf.lastIndexOf(0x0a, end - 1) + 1;
    if (start === 0 && span < info.size) throw storeError(path, 'has a line longer than allowed', 'corrupt-line', 'run: mirai doctor');
    try {
      return JSON.parse(utf8.decode(buf.subarray(start, end)));
    } catch {
      throw storeError(path, 'the last line is not readable', 'corrupt-line', 'run: mirai doctor');
    }
  } finally {
    closeSync(fd);
  }
}

// Reads a JSON-lines file. A torn last line (no newline: the trace of a crash) is skipped and
// counted. Any other line that isn't a JSON object fails closed, with its line number: a lost
// event could change a derived state.
export function readJsonLines(path, { optional = true } = {}) {
  const text = readPrivateFile(path, { optional });
  if (text === null) return { entries: [], torn: 0 };
  const lines = text.split('\n');
  const tail = lines.pop(); // '' when the file ends with a newline
  const entries = [];
  lines.forEach((line, i) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      value = undefined;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new StoreError(`${path}:${i + 1}: the line is not readable`, { path, line: i + 1, code: 'corrupt-line', hint: 'run: mirai doctor' });
    }
    entries.push({ line: i + 1, value });
  });
  return { entries, torn: tail === '' ? 0 : 1 };
}

// ---- Locks --------------------------------------------------------------------------------
// Node has no flock, so a lock is a file created with O_EXCL holding { pid, host, purpose,
// started_at }. A lock whose holder is dead is broken, but only under a second O_EXCL
// "breaker" file and after reading the lock again, so two processes can't both break it and
// one delete the other's fresh lock. A reused pid makes a dead holder look alive; that fails
// safe (the lock is refused, and the message names the pid).

// A short lock (journal, counter, ledger) is held for one write with its disk flushes, about
// 40 ms on macOS. 30 s of waiting covers a busy moment; past that, something is stuck.
export const SHORT_LOCK_WAIT_MS = 30_000;

const sleeper = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => Atomics.wait(sleeper, 0, 0, ms);

export function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function readLock(path) {
  let text;
  try {
    text = readPrivateFile(path, { maxBytes: 4096, optional: true });
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  if (text === null) return null;
  try {
    const holder = JSON.parse(text);
    const ok = holder !== null && typeof holder === 'object' && Number.isSafeInteger(holder.pid) && holder.pid > 0;
    return { text, holder: ok ? holder : null };
  } catch {
    return { text, holder: null }; // damaged
  }
}

// Creates the lock with its content in one step: a private temp file, hard-linked into place.
// link() fails with EEXIST like O_EXCL, and nobody ever sees an empty lock file, not even
// after a crash between create and write.
function tryCreate(path, content) {
  const tmp = join(dirname(path), `.${basename(path)}.new-${process.pid}-${randomBytes(4).toString('hex')}`);
  const fd = openSync(tmp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600);
  try {
    writeAll(fd, Buffer.from(content, 'utf8'));
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(tmp, path);
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw storeError(path, `can't be created (${err.code})`, 'unwritable');
  } finally {
    unlinkQuiet(tmp);
  }
}

// The host is recorded for you to read, not compared: macOS renames the host when the network
// changes, and the store lives on one machine (D-52).
const holderDead = (lock) => Boolean(lock?.holder) && !isAlive(lock.holder.pid);

// The locks this process holds. Locks are not re-entrant: taking one twice would wait on
// ourselves, so it's refused at once.
const heldHere = new Set();

// Takes a lock. `waitMs` 0 never waits. Returns { release, broken }: `broken` is the dead
// holder's record when a stale lock was broken on the way, so the caller can log it.
export function acquireLock(path, purpose, { waitMs = SHORT_LOCK_WAIT_MS, describe } = {}) {
  const content = `${JSON.stringify({ pid: process.pid, host: hostname(), purpose, started_at: new Date().toISOString() })}\n`;
  if (heldHere.has(path)) throw new Error(`this process already holds ${path} (locks are not re-entrant)`);
  const deadline = Date.now() + waitMs;
  let broken = null;
  let unreadable = null; // { text, since }: the same damaged content seen for over 1 s
  for (;;) {
    if (tryCreate(path, content)) {
      heldHere.add(path);
      return { release: () => { heldHere.delete(path); releaseLock(path, content); }, broken };
    }
    const lock = readLock(path);
    if (lock === null) continue; // released between our two calls
    if (holderDead(lock)) {
      const done = breakLock(path, lock.text);
      if (done) {
        broken = lock.holder;
        continue;
      }
    } else if (lock.holder === null) {
      if (unreadable?.text !== lock.text) unreadable = { text: lock.text, since: Date.now() };
      else if (Date.now() - unreadable.since > 1000) {
        throw storeError(path, 'is not a readable lock', 'bad-lock', 'run: mirai doctor');
      }
    } else {
      unreadable = null;
    }
    if (Date.now() >= deadline) {
      const h = lock.holder;
      const who = h ? `pid ${h.pid}${h.purpose ? `, ${h.purpose}` : ''}` : 'another process';
      throw new StoreError(describe ? describe(h) : `${path}: held by ${who}`, { path, code: 'locked', exitCode: EXIT.BLOCKED, hint: h ? `if pid ${h.pid} isn't a MIRAI process, run: mirai doctor` : undefined });
    }
    sleep(5 + Math.floor(Math.random() * 20));
  }
}

// Breaks a dead holder's lock under the breaker file. Returns true when this process broke it.
function breakLock(path, seenText) {
  const breaker = `${path}.break`;
  const mine = `${JSON.stringify({ pid: process.pid, host: hostname(), purpose: 'break', started_at: new Date().toISOString() })}\n`;
  if (!tryCreate(breaker, mine)) {
    const other = readLock(breaker);
    if (holderDead(other)) {
      throw storeError(breaker, 'was left behind by a crash while a stale lock was being broken', 'stale-breaker', 'run: mirai doctor');
    }
    return false; // someone else is breaking it; try again
  }
  try {
    const again = readLock(path);
    if (again === null || again.text !== seenText) return false; // already replaced
    unlinkSync(path);
    return true;
  } finally {
    unlinkQuiet(breaker);
  }
}

// Removes the lock only while it's still ours.
function releaseLock(path, content) {
  const lock = readLock(path);
  if (lock !== null && lock.text === content) unlinkSync(path);
}

export function withLock(path, purpose, fn, options) {
  const { release, broken } = acquireLock(path, purpose, options);
  try {
    return fn({ broken });
  } finally {
    release();
  }
}
