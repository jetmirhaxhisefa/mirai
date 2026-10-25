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

// The token from a given token file (the hook, unit 13c, gets the path from its policy): the
// same checks as readToken.
export function readTokenAt(path) {
  const text = readPrivateFile(path, { maxBytes: 1024, optional: true });
  if (text === null) return null;
  const token = text.replace(/\n$/, '');
  if (!TOKEN_SHAPE.test(token)) throw new StoreError(`${path}: doesn't hold a token`, { path, code: 'bad-token', hint: 'set it again: mirai token set' });
  return token;
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

const WINDOW = 16;

// Every form of the token a leak would use (unit 13a's harness, moved here for the hook, 13c): the
// token and its URL encoding; base64 and base64url at all three offsets, so a token inside a
// longer encoded string is caught too; hex in either case; and any 16-character piece of it.
export function tokenForms(token) {
  const forms = new Set([token, encodeURIComponent(token)]);
  const hex = Buffer.from(token).toString('hex');
  forms.add(hex);
  forms.add(hex.toUpperCase());
  for (let pad = 0; pad < 3; pad++) {
    const b64 = Buffer.concat([Buffer.alloc(pad, 0x20), Buffer.from(token)]).toString('base64');
    // Drop the characters that depend on what's around the token.
    const middle = b64.slice(pad === 0 ? 0 : 4, -4);
    forms.add(middle);
    forms.add(middle.replace(/\+/g, '-').replace(/\//g, '_'));
  }
  const pieces = [];
  for (let i = 0; i + WINDOW <= token.length; i++) pieces.push(token.slice(i, i + WINDOW));
  return { whole: [...forms].sort((a, b) => b.length - a.length), pieces };
}

// The text with every form of the token replaced by <token>.
export function redactToken(text, token) {
  if (!token) return text;
  const { whole, pieces } = tokenForms(token);
  let s = text;
  for (const f of whole) s = s.split(f).join('<token>');
  for (const p of pieces) s = s.split(p).join('<token>');
  return s;
}

// True when any form of the token is in the text.
export const containsToken = (text, token) => Boolean(token) && redactToken(text, token) !== text;
