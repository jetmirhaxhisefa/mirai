import { EXIT } from '../exit-codes.js';
import { StatusError, StoreError, UsageError } from '../errors.js';
import { deriveTicketState } from '../../status/derive.js';
import { escapeInvisible, shown } from '../../status/text.js';
import { TICKET_ID } from '../../status/ticket-file.js';
import { openStore } from '../../store/home.js';
import { allTicketFacts, readJournal, ticketsInJournal } from '../../store/journal.js';
import { checkStatusAgainstJournal, readTicketStatus, ticketsInStore } from '../../store/tickets.js';
import { loadSigningKey } from '../../sign/keys.js';
import { readHeartbeat, readRunState } from '../../store/run.js';
import { runLockHolder } from '../../store/global.js';

// mirai status [<ticket>] [--json] (unit 05a, moved from unit 04). Reads the ticket status
// files and the journal from the store, and shows each ticket's effective state: derived from
// the journal's facts where they decide it, written otherwise. It changes nothing, except
// recording a moved checkout when opening the store notices one.
export default {
  name: 'status',
  summary: 'Show the state of every ticket, or of one',
  usage: 'mirai status [<ticket>] [--json]',
  positionals: { min: 0, max: 1 },
  options: {
    json: { type: 'boolean', description: 'print the result as JSON' },
  },
  run(args, io) {
    const [only] = args.positionals;
    if (only !== undefined && !TICKET_ID.test(only)) {
      throw new UsageError(`${shown(only)} is not a ticket key`, 'a ticket key looks like "PROJ-123"');
    }
    const store = openStore({ cwd: io.cwd, env: io.env });
    const { events, torn } = readJournal(store);
    const known = [...new Set([...ticketsInStore(store), ...ticketsInJournal(events)])].sort();
    if (only !== undefined && !known.includes(only)) {
      throw new UsageError(`no ticket ${shown(only)} in this repo's store`, 'see all tickets: mirai status');
    }
    const ids = only !== undefined ? [only] : known;
    const facts = allTicketFacts(events);
    const mine = myKeyId(io.env);

    const rows = ids.map((ticket) => {
      const read = readTicketStatus(store, ticket);
      const status = read?.status ?? null;
      // The status is checked against the journal's latest line for it (unit 06); a signed line
      // was verified by readJournal.
      let line = null;
      let mismatch = null;
      try {
        line = status ? checkStatusAgainstJournal(status, events) : null;
      } catch (err) {
        if (!(err instanceof StoreError)) throw err;
        mismatch = `${err.message.replace(/^ticket \S+: /, '')} (run: mirai doctor)`;
      }
      const signedBy = status?.written_by === 'human' && line ? line.signature.key_id : null;
      const base = { ticket, written: status?.state ?? null, seq: status?.seq ?? null, park_reason: status?.park_reason ?? null, note: status?.note ?? null, migrated_from: read?.migratedFrom ?? null, signed_by: signedBy, signed_by_you: signedBy !== null && signedBy === mine };
      if (mismatch) return { ...base, state: null, source: null, why: null, error: mismatch };
      try {
        const { state, source, why } = deriveTicketState(status, facts.get(ticket) ?? { mr: 'none' });
        return { ...base, state, source, why: status === null && source === 'written' ? 'no status file yet' : why, error: null };
      } catch (err) {
        if (!(err instanceof StatusError)) throw err;
        return { ...base, state: null, source: null, why: null, error: err.message };
      }
    });
    const failed = rows.some((r) => r.error !== null);
    const run = runInfo(store);
    const lock = lockInfo(store, runLockHolder(io.env));

    if (args.values.json) {
      const out = { repo_id: store.repoId, torn_lines: torn, run, global_lock: lock, tickets: rows };
      if (only !== undefined) out.events = events.filter((e) => e.ticket === only);
      io.stdout.write(`${escapeInvisible(JSON.stringify(out, null, 2))}\n`);
      return failed ? EXIT.BLOCKED : EXIT.OK;
    }

    io.stdout.write(`repo: ${store.repoId}\n`);
    io.stdout.write(`${runLine(run)}\n`);
    io.stdout.write(`global lock: ${lockLine(lock)}\n`);
    if (torn > 0) io.stdout.write('warning: the journal ends with a half-written line (a crash); it was skipped\n');
    if (rows.length === 0) io.stdout.write('\nno tickets yet\n');
    else io.stdout.write('\n');
    const width = Math.max(...rows.map((r) => shown(r.ticket).length), 0);
    for (const r of rows) io.stdout.write(`${line(r, width)}\n`);
    if (only !== undefined) {
      const mine = events.filter((e) => e.ticket === only);
      io.stdout.write(mine.length === 0 ? '\nno journal events\n' : '\n');
      for (const e of mine) io.stdout.write(`${eventLine(e)}\n`);
    }
    return failed ? EXIT.BLOCKED : EXIT.OK;
  },
};

function line(r, width) {
  const id = shown(r.ticket).padEnd(width);
  if (r.error) return `${id}  error: ${r.error}`;
  const state = `${r.state}${r.source === 'written' && r.park_reason ? ` (${r.park_reason})` : ''}`;
  const detail = r.source === 'derived' ? r.why : r.seq !== null ? `seq ${r.seq}` : r.why;
  const parts = [id, state.padEnd(22), r.source.padEnd(8), detail];
  if (r.source === 'written' && r.signed_by) parts.push(r.signed_by_you ? `by you (signed, ${r.signed_by})` : `signed by ${r.signed_by}`);
  if (r.source === 'written' && r.note) parts.push(shown(r.note));
  if (r.migrated_from !== null) parts.push(`(written by an older MIRAI, schema ${r.migrated_from})`);
  return parts.join('  ');
}

const FIELDS = ['state', 'park_reason', 'branch', 'sha', 'head', 'target'];

function eventLine(e) {
  const fields = FIELDS.filter((k) => e[k] !== undefined).map((k) => `${k}=${shown(e[k])}`);
  return [`seq ${e.seq}`, e.ts, e.type, ...fields].join('  ');
}

// The current run, its heartbeat (only when it belongs to this run), or null (unit 05b).
// The ticket and step come from the heartbeat when it belongs to this run (it's updated as the
// run goes), else from state.json. A damaged heartbeat is shown, not fatal: status is where
// you look when something is wrong.
function runInfo(store) {
  const state = readRunState(store);
  if (state === null) return null;
  let beat = null;
  let unreadable = false;
  try {
    beat = readHeartbeat(store);
  } catch (err) {
    if (!(err instanceof StoreError)) throw err;
    unreadable = true;
  }
  const live = ['running', 'paused'].includes(state.state);
  const mine = beat && beat.run_id === state.run_id && live ? beat : null;
  const heartbeat = unreadable ? { unreadable: true } : mine ? { age_ms: mine.ageMs, stale: mine.stale, future: mine.future } : null;
  return { run_id: state.run_id, state: state.state, ticket: mine?.ticket ?? state.ticket ?? null, step: mine?.step ?? state.step ?? null, heartbeat };
}

function lockInfo(store, holder) {
  if (holder === null) return { held: false };
  if (holder.unreadable) return { held: true, unreadable: true };
  return { held: true, repo_id: holder.repo_id ?? null, run_id: holder.run_id ?? null, pid: holder.pid, alive: holder.alive, this_repo: holder.repo_id === store.repoId };
}

const age = (ms) => (ms < 90_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);

function runLine(run) {
  if (run === null) return 'run: none';
  const parts = [`run: ${run.run_id}`, run.state];
  if (run.ticket) parts.push(`ticket ${run.ticket}${run.step ? ` (${run.step})` : ''}`);
  if (run.heartbeat?.unreadable) {
    parts.push('heartbeat unreadable (run: mirai doctor)');
  } else if (run.heartbeat?.future) {
    parts.push('heartbeat dated in the future (a clock change?) — the run may have died (mirai resume checks it)');
  } else if (run.heartbeat) {
    parts.push(run.heartbeat.stale
      ? `heartbeat ${age(run.heartbeat.age_ms)} ago — the run may have died (mirai resume checks it)`
      : `heartbeat ${age(run.heartbeat.age_ms)} ago`);
  } else if (['running', 'paused'].includes(run.state)) {
    parts.push('no heartbeat — the run may have died (mirai resume checks it)');
  }
  return parts.join('  ');
}

function lockLine(lock) {
  if (!lock.held) return 'free';
  if (lock.unreadable) return 'unreadable (run: mirai doctor)';
  const who = lock.this_repo ? 'this repo' : shown(lock.repo_id ?? 'another repo');
  const detail = `run ${shown(lock.run_id ?? '?')}, pid ${lock.pid}`;
  return lock.alive ? `held by ${who} (${detail})` : `left by a dead run of ${who} (${detail}); the next run breaks it`;
}

// This machine's key id, to say "by you" only for your own signatures; null without a key.
function myKeyId(env) {
  try {
    return loadSigningKey(env).keyId;
  } catch {
    return null;
  }
}
