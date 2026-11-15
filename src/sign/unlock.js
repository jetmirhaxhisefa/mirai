#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createPrivateKey, sign as edSign } from 'node:crypto';
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, createConnection } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { StoreError } from '../cli/errors.js';
import { globalConfigPath, readConfigFile } from '../config/load.js';
import { isAlive, readPrivateFile } from '../store/files.js';
import { keyPaths } from './keys.js';

// Your key, unlocked for a while (unit 29b, Jet's decision 3). `[signing] unlock` in your personal
// config (~/.config/mirai/config.toml, never a project's): "each" (the default) asks your
// passphrase for each decision; a duration ("8h", "3d", up to 30 days) keeps your key unlocked
// that long after you type it, in this small holder process: the decrypted key in its memory
// only, a socket in ~/.config/mirai (0600) that signs MIRAI-shaped payloads, a state file with its
// pid and when it ends. It exits on time, on `mirai key lock`, or when the machine restarts.
// The honest cost: while it runs, any program running as you can ask it to sign.

export const MAX_UNLOCK_MS = 30 * 86_400_000;
const UNIT = { m: 60_000, h: 3_600_000, d: 86_400_000 };
const HERE = fileURLToPath(import.meta.url);
const paths = (env) => ({ socket: join(keyPaths(env).dir, 'unlock.sock'), state: join(keyPaths(env).dir, 'unlock.json') });

// The setting in milliseconds (0 = "each"), from your global config only.
export function unlockSetting(env) {
  let v;
  try {
    v = readConfigFile(globalConfigPath(env.HOME), { trust: 'personal', optional: true })?.value?.signing?.unlock ?? 'each';
  } catch {
    v = 'each';
  }
  return parseUnlock(v);
}

export function parseUnlock(v) {
  if (v === 'each' || v === undefined) return 0;
  const m = /^([1-9][0-9]{0,4})([mhd])$/.exec(String(v));
  if (!m) throw new StoreError(`signing.unlock is "each" or a duration such as "8h", not ${JSON.stringify(String(v).slice(0, 20))}`, { code: 'bad-unlock' });
  const ms = Number(m[1]) * UNIT[m[2]];
  if (ms > MAX_UNLOCK_MS) throw new StoreError('signing.unlock is at most 30 days', { code: 'bad-unlock' });
  return ms;
}

// The holder now: { keyId, until (ms), pid } or null when your key isn't unlocked.
export function holderStatus(env, { now = Date.now() } = {}) {
  const p = paths(env);
  let s;
  try {
    s = JSON.parse(readPrivateFile(p.state, { maxBytes: 4096, optional: true }) ?? 'null');
  } catch {
    s = null;
  }
  if (!s || !Number.isSafeInteger(s.pid) || !isAlive(s.pid) || !(s.until > now)) return null;
  return { keyId: s.key_id, until: s.until, pid: s.pid };
}

// Starts the holder with your passphrase (given to it on a pipe, never in arguments or the
// environment) for `ms`. Returns its status once it listens.
export async function startHolder(env, { passphrase, keyId, ms }) {
  lockHolder(env);
  const p = paths(env);
  const child = spawn(process.execPath, [HERE, 'hold', p.socket, p.state, String(Date.now() + ms), keyPaths(env).privateKey, keyId], { detached: true, stdio: ['pipe', 'ignore', 'ignore'], env: { PATH: '/usr/bin:/bin', HOME: env.HOME } });
  child.stdin.end(passphrase);
  child.unref();
  // Waited for without blocking, so the passphrase on the pipe is sent meanwhile.
  for (let i = 0; i < 100; i++) {
    const s = holderStatus(env);
    if (s) return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new StoreError('MIRAI couldn\'t keep your key unlocked (the holder didn\'t start)', { code: 'holder-failed', hint: 'your decision still works: it asks your passphrase each time' });
}

// Signs `bytes` through the holder (a short client process, so the caller stays synchronous).
export function holderSign(env, bytes) {
  const r = spawnSync(process.execPath, [HERE, 'sign', paths(env).socket], { input: Buffer.from(bytes).toString('base64'), timeout: 10_000, env: { PATH: '/usr/bin:/bin', HOME: env.HOME } });
  const out = String(r.stdout ?? '').trim();
  if (r.status !== 0 || !/^[A-Za-z0-9+/]{86}==$/.test(out)) throw new StoreError('your unlocked key didn\'t sign (it may have just locked)', { code: 'holder-failed', hint: 'run it again: MIRAI asks your passphrase' });
  return Buffer.from(out, 'base64');
}

// Locks your key now: the holder ends, its files go.
export function lockHolder(env) {
  const p = paths(env);
  const s = holderStatus(env);
  if (s) {
    try {
      process.kill(s.pid, 'SIGTERM');
    } catch {
      // gone already
    }
  }
  rmSync(p.socket, { force: true });
  rmSync(p.state, { force: true });
  return Boolean(s);
}

// The holder process itself, and its signing client.
async function main(argv) {
  if (argv[0] === 'hold') {
    const [, socket, state, until, keyFile, keyId] = argv;
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const passphrase = Buffer.concat(chunks).toString('utf8');
    const key = createPrivateKey({ key: readFileSync(keyFile, 'utf8'), format: 'pem', passphrase });
    process.umask(0o077);
    rmSync(socket, { force: true });
    const server = createServer((conn) => {
      let data = '';
      conn.on('data', (d) => {
        data += d;
        if (data.length > 1_000_000) conn.destroy();
      });
      conn.on('end', () => {
        try {
          const bytes = Buffer.from(data.trim(), 'base64');
          // Only MIRAI's own payloads: canonical JSON whose signature record names a mirai/ context.
          const ctx = JSON.parse(bytes.toString('utf8'))?.signature?.context;
          if (typeof ctx !== 'string' || !/^mirai\/[a-z0-9-]+\/\d+:/.test(ctx)) throw new Error('not a MIRAI payload');
          conn.end(edSign(null, bytes, key).toString('base64'));
        } catch {
          conn.end('');
        }
      });
    });
    server.listen(socket, () => {
      chmodSync(socket, 0o600);
      writeFileSync(state, `${JSON.stringify({ pid: process.pid, key_id: keyId, until: Number(until) })}\n`, { mode: 0o600 });
    });
    const end = () => {
      server.close();
      rmSync(socket, { force: true });
      rmSync(state, { force: true });
      process.exit(0);
    };
    // A timer can't wait past about 24.8 days (2^31 ms), so the end is checked each minute.
    const tick = () => (Date.now() >= Number(until) ? end() : setTimeout(tick, Math.min(60_000, Math.max(0, Number(until) - Date.now()))));
    tick();
    process.on('SIGTERM', end);
    return;
  }
  if (argv[0] === 'sign') {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const conn = createConnection(argv[1]);
    let out = '';
    conn.on('data', (d) => (out += d));
    conn.on('end', () => {
      process.stdout.write(out);
      process.exit(out ? 0 : 1);
    });
    conn.on('error', () => process.exit(1));
    conn.end(Buffer.concat(chunks).toString('utf8'));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
