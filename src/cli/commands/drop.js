import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { checkTicketArg, confirmByTyping, ticketNow } from '../human-move.js';
import { createPrompter, requireTty } from '../tty.js';
import { TICKET } from '../../status/machines.js';
import { move } from '../../status/move.js';
import { openStore } from '../../store/home.js';
import { writeTicketStatus } from '../../store/tickets.js';
import { loadSigner } from '../../sign/signer.js';

// mirai drop <ticket> [--note <text>] (unit 06; D-17). In a real terminal only. A signed move to
// `dropped`, from the states where unit 04 allows it: draft, ready-for-dev, built.
export default {
  name: 'drop',
  summary: 'Drop a ticket, signed, in a real terminal',
  usage: 'mirai drop <ticket> [--note <text>]',
  positionals: { min: 1, max: 1 },
  options: {
    note: { type: 'string', description: 'why, in one line' },
  },
  async run(args, io) {
    const [ticket] = args.positionals;
    const { note } = args.values;
    checkTicketArg(ticket);
    if (note !== undefined && !/^[^\u0000-\u001f\u007f]{1,500}$/.test(note)) throw new UsageError('--note is one line of up to 500 characters', 'see: mirai drop --help');
    requireTty(io, 'mirai drop');
    const store = openStore({ cwd: io.cwd, env: io.env });
    const signer = loadSigner(io.env, store);
    const current = ticketNow(store, ticket, signer.keys);
    move(TICKET, current.state, 'dropped', { by: 'human', item: ticket, note }); // exit 4 when not allowed

    io.stdout.write(`ticket: ${ticket} (${current.state})\nkey:    ${signer.keyId}\n`);
    const prompter = createPrompter(io);
    try {
      await confirmByTyping(prompter, ticket);
      const seq = writeTicketStatus(store, { ticket, state: 'dropped', written_by: 'human', ...(note ? { note } : {}) }, { expectSeq: current.seq, signer });
      io.stdout.write(`dropped: ${ticket} (signed with ${signer.keyId}, seq ${seq})\n`);
      return EXIT.OK;
    } finally {
      prompter.close();
    }
  },
};
