import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { acquireLock, ensurePrivateDir } from '../store/files.js';
import { miraiHome } from '../store/mirai-home.js';

// Waiting for a test run's turn (unit 14d). One run at a time per repo (14c's store lock), and at
// most `max_parallel` runs at once across all your projects (slots in
// <mirai-home>/locks/test-slots/, one lock file per slot). Waiting is async, so an MCP server
// keeps answering meanwhile, and gives up at `waitMs` or when `signal` aborts.

export const WAIT_MS = 30 * 60_000;
const POLL_MS = 1000;

// Takes one lock without waiting: its handle, or null while someone else holds it. A lock this
// process already holds counts as held (locks aren't re-entrant).
function tryLock(path, purpose) {
  try {
    return acquireLock(path, purpose, { waitMs: 0 });
  } catch (err) {
    if (err.code === 'locked' || /already holds/.test(err.message)) return null;
    throw err;
  }
}

// Waits until `take()` returns a handle. `onWait` is called once, when the first try fails.
// Resolves the handle, or null at the deadline or on abort.
export async function waitFor(take, { waitMs = WAIT_MS, signal, onWait = () => {}, pollMs = POLL_MS, now = Date.now } = {}) {
  const deadline = now() + waitMs;
  let told = false;
  for (;;) {
    const got = take();
    if (got) return got;
    if (!told) {
      told = true;
      onWait();
    }
    if (signal?.aborted || now() >= deadline) return null;
    try {
      await delay(pollMs, undefined, { signal });
    } catch {
      return null; // aborted
    }
  }
}

// The repo's test lock (14c's path).
export const repoLock = (storeDir) => () => tryLock(join(storeDir, 'locks', 'tests.lock'), 'test run');

// One of `max` machine-wide slots.
export function machineSlot(env, max) {
  const home = miraiHome(env);
  const dir = join(home, 'locks', 'test-slots');
  ensurePrivateDir(home);
  ensurePrivateDir(join(home, 'locks'));
  ensurePrivateDir(dir);
  return () => {
    for (let i = 0; i < max; i++) {
      const got = tryLock(join(dir, `${i}.lock`), 'test run');
      if (got) return got;
    }
    return null;
  };
}
