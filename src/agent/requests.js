import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { atomicWrite, ensurePrivateDir } from '../store/files.js';

// Launches started from your session's MIRAI server (unit 19c; D-53), and the depth guard's
// one-time token (D-12's recursion guard).
//
// The token, two ways:
// - **In a process:** `runAgent` refuses unless it's handed a token this process minted, used once.
//   Your terminal mints one after its terminal check; a worker mints one after claiming a request.
//   So no MIRAI code path launches without going through one of them.
// - **Between the broker and its worker:** the broker makes a request record holding only the
//   token's hash, and hands the worker the token down a pipe. The worker claims the record by
//   renaming it, once: a second claim finds nothing.
// What it doesn't stop: anything running as you without a sandbox: your own session, which could
// read the store or drive `mirai agent run` through `script`, and a branch's hook or look-alike
// `mirai` server (18e), which could write a request and start this worker itself. A sandboxed agent
// has neither the verb nor the store.

const minted = new WeakSet();
export function mintLaunchToken() {
  const token = Object.freeze({ launch: randomBytes(16).toString('hex') });
  minted.add(token);
  return token;
}
export function checkLaunchToken(token) {
  if (!token || !minted.has(token)) throw Object.assign(new MiraiError('a launch needs a one-time token from your terminal, MIRAI\'s server or the orchestrator', EXIT.BLOCKED), { code: 'no-launch-token' });
}
export function spendLaunchToken(token) {
  checkLaunchToken(token);
  minted.delete(token);
}

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

export const REQUEST_ID = /^q-\d{14}-[0-9a-f]{8}$/;
const KEEP = 50;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const dir = (store) => join(store.dir, 'agent-requests');
const file = (store, id, ext) => {
  if (!REQUEST_ID.test(id ?? '')) throw Object.assign(new MiraiError('not a launch request id', EXIT.USAGE), { code: 'bad-request-id' });
  return join(dir(store), `${id}.${ext}`);
};

// A new request: { id, token }. `args` are start_agent's, checked.
export function createRequest(store, args, { now = () => new Date() } = {}) {
  ensurePrivateDir(dir(store));
  const id = `q-${now().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomBytes(4).toString('hex')}`;
  const token = randomBytes(32).toString('hex');
  atomicWrite(file(store, id, 'json'), `${JSON.stringify({ id, created_at: now().toISOString(), token_sha256: sha256(token), args })}\n`);
  writeStatus(store, id, { state: 'queued' });
  prune(store);
  return { id, token };
}

// The worker's claim: the request's arguments, once, for the right token. Anything else refuses.
export function claimRequest(store, id, token) {
  const from = file(store, id, 'json');
  const to = file(store, id, 'claimed');
  try {
    renameSync(from, to);
  } catch {
    throw Object.assign(new MiraiError(`the launch request ${id} doesn't exist, or was used already`, EXIT.BLOCKED), { code: 'request-used' });
  }
  let record;
  try {
    record = JSON.parse(readFileSync(to, 'utf8'));
  } catch {
    writeStatus(store, id, { state: 'done', outcome: 'refused', why: 'the request couldn\'t be read' });
    throw Object.assign(new MiraiError('the launch request couldn\'t be read', EXIT.BLOCKED), { code: 'bad-request' });
  }
  if (typeof token !== 'string' || sha256(token) !== record.token_sha256) {
    writeStatus(store, id, { state: 'done', outcome: 'refused', why: 'the launch token didn\'t match' });
    throw Object.assign(new MiraiError('the launch token doesn\'t match its request', EXIT.BLOCKED), { code: 'bad-launch-token' });
  }
  return record.args;
}

export function writeStatus(store, id, status) {
  ensurePrivateDir(dir(store));
  atomicWrite(file(store, id, 'status'), `${JSON.stringify({ id, ...status, at: new Date().toISOString() })}\n`);
}

export function readStatus(store, id) {
  try {
    return JSON.parse(readFileSync(file(store, id, 'status'), 'utf8'));
  } catch (err) {
    if (err.code === 'bad-request-id') throw err;
    return null;
  }
}

function prune(store) {
  const ids = [...new Set(readdirSync(dir(store)).map((n) => /^(q-\d{14}-[0-9a-f]{8})\./.exec(n)?.[1]).filter(Boolean))];
  const aged = ids.map((id) => ({ id, t: statSync(file(store, id, 'status'), { throwIfNoEntry: false })?.mtimeMs ?? 0 })).sort((a, b) => b.t - a.t);
  for (const { id } of aged.slice(KEEP).filter((x) => { const st = readStatus(store, x.id); return !['queued', 'running'].includes(st?.state) || (Number.isInteger(st.pid) && !pidAlive(st.pid)); })) for (const ext of ['json', 'claimed', 'status']) rmSync(file(store, id, ext), { force: true });
}
