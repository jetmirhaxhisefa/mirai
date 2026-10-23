import { EXIT } from '../exit-codes.js';
import { StatusError, UsageError } from '../errors.js';
import { deriveTicketState } from '../../status/derive.js';
import { escapeInvisible, shown } from '../../status/text.js';
import { TICKET_ID } from '../../status/ticket-file.js';
import { openStore } from '../../store/home.js';
import { allTicketFacts, readJournal, ticketsInJournal } from '../../store/journal.js';
import { readTicketStatus, ticketsInStore } from '../../store/tickets.js';

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

    const rows = ids.map((ticket) => {
      const read = readTicketStatus(store, ticket);
      const status = read?.status ?? null;
      const base = { ticket, written: status?.state ?? null, seq: status?.seq ?? null, park_reason: status?.park_reason ?? null, note: status?.note ?? null, migrated_from: read?.migratedFrom ?? null };
      try {
        const { state, source, why } = deriveTicketState(status, facts.get(ticket) ?? { mr: 'none' });
        return { ...base, state, source, why: status === null && source === 'written' ? 'no status file yet' : why, error: null };
      } catch (err) {
        if (!(err instanceof StatusError)) throw err;
        return { ...base, state: null, source: null, why: null, error: err.message };
      }
    });
    const failed = rows.some((r) => r.error !== null);

    if (args.values.json) {
      const out = { repo_id: store.repoId, torn_lines: torn, tickets: rows };
      if (only !== undefined) out.events = events.filter((e) => e.ticket === only);
      io.stdout.write(`${escapeInvisible(JSON.stringify(out, null, 2))}\n`);
      return failed ? EXIT.BLOCKED : EXIT.OK;
    }

    io.stdout.write(`repo: ${store.repoId}\n`);
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
  if (r.source === 'written' && r.note) parts.push(shown(r.note));
  if (r.migrated_from !== null) parts.push(`(written by an older MIRAI, schema ${r.migrated_from})`);
  return parts.join('  ');
}

const FIELDS = ['state', 'park_reason', 'branch', 'sha', 'head', 'target'];

function eventLine(e) {
  const fields = FIELDS.filter((k) => e[k] !== undefined).map((k) => `${k}=${shown(e[k])}`);
  return [`seq ${e.seq}`, e.ts, e.type, ...fields].join('  ');
}
