import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { checkTicketArg } from '../human-move.js';
import { requireTty } from '../tty.js';
import { loadSigner } from '../../sign/signer.js';
import { openStore } from '../../store/home.js';
import { appendEvent } from '../../store/journal.js';
import { readTicketStatus } from '../../store/tickets.js';

// mirai feedback <ticket> "<text>" (unit 29a, Jet's decision 3): your words on how the work with an
// agent went, kept in the ticket's journal (the retention rule's "kept" class) and shown by
// `mirai show` and `mirai report`. From your terminal it's signed with your key; your session's
// form is the `feedback` tool on MIRAI's server, which marks the line as your session's.
export const FEEDBACK_MAX = 2000;
const ONE_LINE = /^[^\n\r]+$/;

export default {
  name: 'feedback',
  summary: 'Record your words on how the work with an agent went, for one ticket',
  usage: 'mirai feedback <ticket> "<text>"',
  positionals: { min: 2, max: 2 },
  options: {},
  async run(args, io) {
    const [ticket, raw] = args.positionals;
    checkTicketArg(ticket);
    const text = String(raw).trim();
    if (text === '') throw new UsageError('the feedback is empty', 'say what went well or badly, in one line');
    if (!ONE_LINE.test(text)) throw new UsageError('feedback is one line', 'put it on one line');
    if ([...text].length > FEEDBACK_MAX) throw new UsageError(`feedback is at most ${FEEDBACK_MAX} characters`, 'shorten it');
    requireTty(io, 'mirai feedback');
    const store = openStore({ cwd: io.cwd, env: io.env });
    if (!readTicketStatus(store, ticket)?.status) throw Object.assign(new UsageError(`${ticket} has nothing in MIRAI yet`, `approve it first: mirai approve ${ticket} --file <path>`), { code: 'unknown-ticket' });
    const signer = loadSigner(io.env, store);
    const seq = appendEvent(store, { type: 'feedback', by: 'human', item: ticket, ticket, text }, { signer });
    io.stdout.write(`recorded: your feedback on ${ticket} (signed with ${signer.keyId}, seq ${seq})\n`);
    return EXIT.OK;
  },
};
