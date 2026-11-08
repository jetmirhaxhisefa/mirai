import { EXIT } from '../exit-codes.js';
import { MiraiError, UsageError } from '../errors.js';
import { checkTicketArg, confirmByTyping, ticketNow } from '../human-move.js';
import { createPrompter, requireTty } from '../tty.js';
import { readLoop } from '../../loop/guard.js';
import { plain } from '../../status/text.js';
import { openStore } from '../../store/home.js';
import { signHumanMove } from '../../store/tickets.js';
import { loadSigner } from '../../sign/signer.js';
import { acceptDispute, openDisputes, readDisputes, upholdDisputes } from '../../agent/review.js';

// mirai unpark <ticket> --retry | --accept <finding-id>[,<finding-id>…] (a minimal one, 2026-11-04;
// unit 46 brings the inbox and the other choices, re-plan and drop): a parked ticket back to work,
// signed, in your terminal, with a one-line note and the ticket's key typed back. Only a park of
// the ticket's status (a build's scope stop, 21b; a review's, 24a): a park by the loop guard (rounds
// used) needs a grant of rounds, which this doesn't give.
// A disputed finding (unit 24a; decision 3) is yours to settle: `--retry` says every open dispute
// stands, and the ticket goes back to Kai (in-progress, then `mirai fix`); `--accept` drops the
// findings you name (logged as the reviewer's false positives) and the others stand. When none
// stand, the ticket goes back to in-review for Rex's next round.
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export default {
  name: 'unpark',
  summary: 'Send a parked ticket back to work, or settle a disputed finding, signed',
  usage: 'mirai unpark <ticket> --retry | --accept <finding-id>[,<finding-id>…]',
  positionals: { min: 1, max: 1 },
  options: {
    retry: { type: 'boolean', description: 'back to in-progress, as it is; for a disputed park, the disputed findings stand' },
    accept: { type: 'string', description: 'for a disputed park: drop these findings (comma-separated ids); any other open dispute stands' },
  },
  async run(args, io) {
    const [ticket] = args.positionals;
    checkTicketArg(ticket);
    const retry = args.values.retry === true;
    const acceptIds = args.values.accept === undefined ? null : String(args.values.accept).split(',').map((s) => s.trim()).filter(Boolean);
    if (retry === (acceptIds !== null)) throw new UsageError('say what to do: --retry, or --accept <finding-id> for a disputed finding (re-plan and drop come with unit 46)');
    if (acceptIds && (acceptIds.length === 0 || !acceptIds.every((id) => ID.test(id)))) throw new UsageError('--accept takes finding ids, comma-separated, as the parking note names them');
    requireTty(io, 'mirai unpark');
    const store = openStore({ cwd: io.cwd, env: io.env });
    const signer = loadSigner(io.env, store);
    const current = ticketNow(store, ticket, signer.keys);
    if (current.state !== 'blocked') throw new MiraiError(`${ticket} is ${current.state}, not parked`, EXIT.BLOCKED);
    if (readLoop(store, ticket).parked) throw new MiraiError(`${ticket} was parked by the loop guard (${plain(readLoop(store, ticket).parked.reason)}): it needs rounds granted, which unit 46's unpark does`, EXIT.BLOCKED);
    const disputed = current.status?.park_reason === 'disputed';
    const open = disputed ? openDisputes(readDisputes(store, ticket)) : [];
    if (acceptIds) {
      if (!disputed) throw new MiraiError(`${ticket} isn't parked for a disputed finding (${plain(current.status?.park_reason ?? '?')}); --accept is only for that`, EXIT.BLOCKED);
      const unknown = acceptIds.filter((id) => !open.some((x) => x.id === id));
      if (unknown.length) throw new MiraiError(`${unknown.join(', ')} ${unknown.length === 1 ? 'isn\'t an open disputed finding' : 'aren\'t open disputed findings'} of ${ticket} (open: ${open.map((x) => x.id).join(', ') || 'none'})`, EXIT.BLOCKED);
    }
    io.stdout.write(`ticket: ${ticket} (parked: ${plain(current.status?.park_reason ?? '?')})\nwhy:    ${plain(current.status?.note ?? '')}\nkey:    ${signer.keyId}\n`);
    for (const x of open) io.stdout.write(`  disputed ${plain(x.id)}: ${plain(x.finding?.claim ?? '')} (${plain(x.finding?.file ?? '?')}:${x.finding?.line ?? '?'})\n    Kai: ${plain(x.reason ?? '')}\n`);
    const stand = acceptIds ? open.filter((x) => !acceptIds.includes(x.id)) : open;
    const to = acceptIds && stand.length === 0 ? 'in-review' : 'in-progress';
    if (disputed) io.stdout.write(`${acceptIds ? `dropped: ${acceptIds.join(', ')}\n` : ''}${stand.length ? `stand (Kai fixes them next): ${stand.map((x) => x.id).join(', ')}\n` : ''}then: ${to === 'in-review' ? `in-review, for Rex's next round (mirai review ${ticket})` : `in-progress, for Kai (mirai fix ${ticket})`}\n`);
    const prompter = createPrompter(io);
    try {
      const note = await prompter.ask('note (one line, why it can go on): ');
      if (!/\S/.test(note) || note.length > 500) throw new UsageError('the note is one line of at most 500 characters; nothing was written');
      await confirmByTyping(prompter, ticket);
      const choice = to === 'in-review' ? 'accept' : 'retry';
      const seq = signHumanMove(store, signer, { ticket, state: to, note, ...(current.status?.replans !== undefined ? { replans: current.status.replans } : {}) }, { expectSeq: current.seq, move: { choice, note } });
      // The rulings, after your signed move: what you dropped, then what stands.
      if (disputed) {
        for (const id of acceptIds ?? []) acceptDispute(store, ticket, id);
        upholdDisputes(store, ticket);
      }
      io.stdout.write(`unparked: ${ticket} is ${to} again (${choice}; signed with ${signer.keyId}, seq ${seq})\n`);
      return EXIT.OK;
    } finally {
      prompter.close();
    }
  },
};
