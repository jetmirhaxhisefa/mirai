import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, unlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { atomicWrite, ensurePrivateDir, readPrivateFile } from '../store/files.js';

// The Claude login token (unit 13a; research/09 §5, G5). `claude setup-token` prints a one-year
// OAuth token; headless launches (unit 19) pass it as CLAUDE_CODE_OAUTH_TOKEN. MIRAI keeps it in
//   ~/.config/mirai/claude-token   the token and a newline (0600; yours only, denied to agents)
// next to the signing key. It's personal: never in a project, never in the store's journal,
// never printed. Only its fingerprint is shown. The file's change time is when it was set;
// setup tokens last a year, so `status` warns from day 330 on.
// What keeps agents away from it isn't this file's mode (agents run as you): it's 13b's sandbox
// and permission denies on ~/.config/mirai.

export const RENEW_AFTER_DAYS = 330;

export const TOKEN_SHAPE = /^sk-ant-oat[0-9]{2}-[A-Za-z0-9_-]{20,500}$/;

export function tokenPath(env) {
  if (!env.HOME || !isAbsolute(env.HOME)) throw new StoreError('HOME is not set to an absolute path', { code: 'no-home' });
  return join(env.HOME, '.config', 'mirai', 'claude-token');
}

// The first 12 hex characters of the token's SHA-256: enough to tell two tokens apart, nothing
// to log in with.
export const tokenFingerprint = (token) => createHash('sha256').update(token).digest('hex').slice(0, 12);

export function writeToken(env, token) {
  if (!TOKEN_SHAPE.test(token)) throw new StoreError('that doesn\'t look like a token from claude setup-token', { code: 'bad-token', hint: 'it starts with sk-ant-oat and is one line; run claude setup-token again' });
  const path = tokenPath(env);
  mkdirSync(join(env.HOME, '.config'), { recursive: true, mode: 0o700 });
  ensurePrivateDir(join(env.HOME, '.config', 'mirai'));
  atomicWrite(path, `${token}\n`);
  return tokenFingerprint(token);
}

// The token, or null when none is set. The file gets the store's checks (real file, yours,
// 0600); a file that doesn't hold a token is an error, never passed on.
export function readToken(env) {
  const path = tokenPath(env);
  const text = readPrivateFile(path, { maxBytes: 1024, optional: true });
  if (text === null) return null;
  const token = text.replace(/\n$/, '');
  if (!TOKEN_SHAPE.test(token)) throw new StoreError(`${path}: doesn't hold a token`, { path, code: 'bad-token', hint: 'set it again: mirai token set' });
  return token;
}

// When the token was set, from its file (null when none is set).
export function tokenSetAt(env) {
  try {
    return lstatSync(tokenPath(env)).mtime;
  } catch {
    return null;
  }
}

// Removes the token; false when there was none. An exposed file (too open, or a link) is
// exactly when you want this to work, so only a folder in its place is refused; a link is
// removed, never followed.
export function clearToken(env) {
  const path = tokenPath(env);
  let info;
  try {
    info = lstatSync(path);
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw new StoreError(`${path}: can't be read (${err.code})`, { path, code: 'unreadable' });
  }
  if (info.isDirectory()) throw new StoreError(`${path}: is a folder, not the token file`, { path, code: 'not-file', hint: 'remove it yourself' });
  unlinkSync(path);
  return true;
}
