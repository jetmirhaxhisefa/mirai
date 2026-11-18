import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWrite, ensurePrivateDir } from '../store/files.js';

// The build runner's proof (unit 29e; design/10): you start the runner in a real terminal and say
// yes once, "run the fixed jobs in my name until you stop it". The runner writes this record in the
// sample app's store, and a command it starts finds it through MIRAI_BUILD_RUNNER and its own
// parent chain. Like a session's worker record (21f), it stands in for a terminal only for the
// commands it names (the red team's runs), never for a gate: requireTty doesn't read it.
// What it doesn't stop: anything running as you outside the sandbox could write the record and
// start a command under it, as it could drive a terminal through `script` (D-17's honest limit).

export const RUNNER_ID = /^b-\d{14}-[0-9a-f]{8}$/;
// The commands a runner's record may cover: the red team's runs, nothing else.
export const RUNNER_COMMANDS = Object.freeze(['redteam run', 'redteam run --sessions']);

const dir = (store) => join(store.dir, 'build-runner');
const file = (store, id) => {
  if (!RUNNER_ID.test(id ?? '')) throw Object.assign(new Error('not a build runner id'), { code: 'bad-runner-id' });
  return join(dir(store), `${id}.json`);
};

export function newRunnerId(now = new Date()) {
  return `b-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomBytes(4).toString('hex')}`;
}

export function writeRunnerRecord(store, { id, pid, commands, now = new Date() }) {
  const bad = commands.filter((c) => !RUNNER_COMMANDS.includes(c));
  if (bad.length) throw new Error(`a build runner can't cover ${bad.join(', ')}`);
  ensurePrivateDir(dir(store));
  atomicWrite(file(store, id), `${JSON.stringify({ id, pid, commands, started_at: now.toISOString() })}\n`);
}

export function readRunnerRecord(store, id) {
  try {
    return JSON.parse(readFileSync(file(store, id), 'utf8'));
  } catch (err) {
    if (err.code === 'bad-runner-id') throw err;
    return null;
  }
}

export function removeRunnerRecord(store, id) {
  try {
    rmSync(file(store, id), { force: true });
  } catch {
    // gone already
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

// The parent of `pid`, or null.
function parentOf(pid) {
  try {
    const out = execFileSync('/bin/ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000 }).trim();
    const n = Number(out);
    return Number.isInteger(n) && n > 1 ? n : null;
  } catch {
    return null;
  }
}

// This process's parent chain, nearest first, at most `depth` long: the runner starts MIRAI's
// launcher, which starts the trust root's copy (bin/launch.js spawns bin/mirai.js).
export function parentChain({ ppid = process.ppid, depth = 3, parent = parentOf } = {}) {
  const chain = [];
  let p = ppid;
  while (p && chain.length < depth) {
    chain.push(p);
    p = parent(p);
  }
  return chain;
}

// True when `command` was started by a live build runner whose record covers it.
export function fromRunner({ env, openStore, command, chain = parentChain, isAlive = alive }) {
  const id = env?.MIRAI_BUILD_RUNNER;
  if (typeof id !== 'string' || !RUNNER_ID.test(id)) return false;
  try {
    const record = readRunnerRecord(openStore(), id);
    if (!record || !Number.isInteger(record.pid) || !Array.isArray(record.commands)) return false;
    if (!record.commands.includes(command) || !RUNNER_COMMANDS.includes(command)) return false;
    if (!isAlive(record.pid)) return false;
    return chain().includes(record.pid);
  } catch {
    return false;
  }
}
