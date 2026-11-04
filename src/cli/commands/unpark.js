import { EXIT } from '../exit-codes.js';
import { MiraiError, UsageError } from '../errors.js';
import { checkTicketArg, confirmByTyping, ticketNow } from '../human-move.js';
import { createPrompter, requireTty } from '../tty.js';
import { readLoop } from '../../loop/guard.js';
import { plain } from '../../status/text.js';
import { openStore } from '../../store/home.js';
import { signHumanMove } from '../../store/tickets.js';
import { loadSigner } from '../../sign/signer.js';

// mirai unpark <ticket> --retry (a minimal one, 2026-11-04; unit 46 brings the inbox and the other
// choices, re-plan and drop): a parked ticket back to in-progress, signed, in your terminal, with a
// one-line note and the ticket's key typed back. Only a park of the ticket's status (a build's
// scope stop, 21b): a park by the loop guard (rounds used) needs a grant of rounds, which this
// doesn't give.
export default {
  name: 'unpark',
  summary: 'Send a parked ticket back to work (retry), signed',
  usage: 'mirai unpark <ticket> --retry',
  positionals: { min: 1, max: 1 },
  options: {
    retry: { type: 'boolean', description: 'back to in-progress, as it is (the only choice so far)' },
  },
  async run(args, io) {
    const [ticket] = args.positionals;
    checkTicketArg(ticket);
    if (!args.values.retry) throw new UsageError('say what to do: --retry (re-plan and drop come with unit 46)');
    requireTty(io, 'mirai unpark');
    const store = openStore({ cwd: io.cwd, env: io.env });
    const signer = loadSigner(io.env, store);
    const current = ticketNow(store, ticket, signer.keys);
    if (current.state !== 'blocked') throw new MiraiError(`${ticket} is ${current.state}, not parked`, EXIT.BLOCKED);
    if (readLoop(store, ticket).parked) throw new MiraiError(`${ticket} was parked by the loop guard (${plain(readLoop(store, ticket).parked.reason)}): it needs rounds granted, which unit 46's unpark does`, EXIT.BLOCKED);
    io.stdout.write(`ticket: ${ticket} (parked: ${plain(current.status?.park_reason ?? '?')})\nwhy:    ${plain(current.status?.note ?? '')}\nkey:    ${signer.keyId}\n`);
    const prompter = createPrompter(io);
    try {
      const note = await prompter.ask('note (one line, why it can go on): ');
      if (!/\S/.test(note) || note.length > 500) throw new UsageError('the note is one line of at most 500 characters; nothing was written');
      await confirmByTyping(prompter, ticket);
      const seq = signHumanMove(store, signer, { ticket, state: 'in-progress', note, ...(current.status?.replans !== undefined ? { replans: current.status.replans } : {}) }, { expectSeq: current.seq, move: { choice: 'retry', note } });
      io.stdout.write(`unparked: ${ticket} is in-progress again (retry; signed with ${signer.keyId}, seq ${seq})\n`);
      return EXIT.OK;
    } finally {
      prompter.close();
    }
  },
};
