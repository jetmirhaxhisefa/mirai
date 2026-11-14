import { join } from 'node:path';
import { readFileSync, unlinkSync } from 'node:fs';

import { branchKeys } from '../sign/keys.js';
import { readRegistry } from '../store/branches.js';
import { atomicWrite, isAlive, withLock } from '../store/files.js';
import { runLockHolder } from '../store/global.js';
import { openStore } from '../store/home.js';
import { readJournal } from '../store/journal.js';
import { readRunState, runStateMatchesLog } from '../store/run.js';
import { lockFiles, registryFromRecords, runStateFromLog } from './checks.js';

// `mirai doctor --fix` (unit 29c, Jet's decision 1): the three safe repairs, each from what MIRAI
// trusts, in order: a dead process's leftovers (a lock or a lock breaker), the run state (from the
// run log), the branch registry (from the journal and the signed branch records). Each runs only
// when its check is red. Damaged history (journal or run-log lines, the counter, signatures) is
// never written. Returns [{ fix, done, detail }].

const BRANCHES = 'branches.json';
const STATE = 'state.json';

export function fixAll({ cwd, env, wanted }) {
  const store = openStore({ cwd, env });
  const out = [];
  const step = (fix, fn) => {
    if (!wanted.has(fix)) return;
    try {
      out.push({ fix, done: true, detail: fn() });
    } catch (err) {
      out.push({ fix, done: false, detail: String(err.message ?? err).slice(0, 300) });
    }
  };
  step('locks', () => {
    const removed = [];
    for (const l of lockFiles(store, env)) {
      if (l.holder.unreadable || l.holder.alive) continue;
      // Gone only while it's still the same dead holder's (read again just before).
      let text;
      try {
        text = JSON.parse(readFileSync(l.path, 'utf8'));
      } catch {
        continue;
      }
      if (text?.pid !== l.holder.pid || isAlive(text.pid)) continue;
      unlinkSync(l.path);
      removed.push(`${l.path} (pid ${l.holder.pid})`);
    }
    return removed.length ? `removed ${removed.length}: ${removed.join(', ')}` : 'none left';
  });
  step('run-state', () => {
    const holder = runLockHolder(env);
    if (holder && holder.alive) throw new Error(`a run holds the run lock (pid ${holder.pid}); the run state is left as it is`);
    let current = null;
    try {
      current = readRunState(store);
    } catch {
      current = null;
    }
    if (current && runStateMatchesLog(store)) return 'already matches its log';
    const rebuilt = runStateFromLog(store, current?.run_id ?? null);
    if (!rebuilt) throw new Error('there is no run log to rebuild it from');
    atomicWrite(join(store.dir, STATE), `${JSON.stringify(rebuilt, null, 2)}\n`);
    return `rebuilt from run ${rebuilt.run_id}'s log: ${rebuilt.state}`;
  });
  step('registry', () => {
    // Under the journal's lock, so no branch is registered while it's rebuilt.
    return withLock(join(store.dir, 'locks', 'journal.lock'), 'rebuilding the branch registry', () => {
      const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
      const events = readJournal(store, { keys }).events;
      let current = null;
      try {
        current = readRegistry(store);
      } catch {
        current = null;
      }
      const r = registryFromRecords(store, { events, keys, current });
      atomicWrite(join(store.dir, BRANCHES), `${JSON.stringify({ schema_version: 1, entries: r.entries }, null, 2)}\n`);
      return `rebuilt: ${r.entries.length} entr${r.entries.length === 1 ? 'y' : 'ies'}${r.skipped.length ? `; left out ${r.skipped.length} that don't verify (${r.skipped.map((x) => `${x.branch}: ${x.why}`).join('; ').slice(0, 200)})` : ''}`;
    }, { waitMs: 5000 });
  });
  return out;
}
