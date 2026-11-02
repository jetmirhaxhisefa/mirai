import { join } from 'node:path';

import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { shown } from '../../status/text.js';
import { openStore } from '../../store/home.js';
import { ensurePrivateDir } from '../../store/files.js';
import { RUN_ID } from '../../store/run-log.js';
import { sessionDir } from '../../mcp/session.js';
import { endSession, startSession } from '../../mcp/tools/sessions.js';

// mirai session start --skill <name> [--item <id>] | end <run id> [--note <text>] (unit 19c; R-M3):
// a run id for authoring, from your terminal, the same as your session's session_start/end.
export default {
  name: 'session',
  summary: 'Give an authoring session a run id, or end it',
  usage: 'mirai session start --skill <name> [--item <id>] | mirai session end <run id> [--note <text>]',
  positionals: { min: 1, max: 2 },
  options: {
    skill: { type: 'string', description: 'with start: the skill' },
    item: { type: 'string', description: 'with start: the ticket or document' },
    note: { type: 'string', description: 'with end: one line' },
  },
  run(args, io) {
    const [action, id] = args.positionals;
    const store = openStore({ cwd: io.cwd, env: io.env });
    const state = join(sessionDir(store), 'state');
    ensurePrivateDir(sessionDir(store));
    ensurePrivateDir(state);
    if (action === 'start') {
      if (id !== undefined) throw new UsageError('start takes no run id');
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(args.values.skill ?? '')) throw new UsageError('--skill names the skill');
      if (args.values.item !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(args.values.item)) throw new UsageError(`${shown(args.values.item)} is not a ticket or document id`);
      const r = startSession(store, state, { skill: args.values.skill, item: args.values.item ?? null });
      io.stdout.write(`${r.run_id}\n`);
      if (r.closed) io.stderr.write(`note: the session ${r.closed} was still open; it's closed now\n`);
      return EXIT.OK;
    }
    if (action === 'end') {
      if (!RUN_ID.test(id ?? '')) throw new UsageError('end names the run id start gave');
      const note = args.values.note;
      if (note !== undefined && !/^[^\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]{1,500}$/.test(note)) throw new UsageError('--note is one line of plain text');
      const r = endSession(store, state, { id, note: note ?? null });
      if (!r) throw new UsageError('no session is open here');
      if (r.mismatch) throw new UsageError(`the open session is ${r.mismatch}, not ${id}`);
      io.stdout.write(`ended ${r.run_id}\n`);
      return EXIT.OK;
    }
    throw new UsageError(`unknown action ${shown(action)}`, 'see: mirai session --help');
  },
};
