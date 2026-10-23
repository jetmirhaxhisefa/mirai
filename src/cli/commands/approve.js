import { EXIT } from '../exit-codes.js';
import { MiraiError, UsageError } from '../errors.js';
import { checkTicketArg, confirmByTyping, readApprovedFile, ticketNow } from '../human-move.js';
import { createPrompter, requireTty } from '../tty.js';
import { TICKET } from '../../status/machines.js';
import { move } from '../../status/move.js';
import { openStore } from '../../store/home.js';
import { checkEvent, withSeq } from '../../store/journal.js';
import { checkTicketStatusWrite, writeTicketStatusIn } from '../../store/tickets.js';
import { contentHash } from '../../sign/sign.js';
import { loadSigner } from '../../sign/signer.js';

// mirai approve <ticket> --file <path> (unit 06; D-17, D-34). In a real terminal only. Signs your
// decision on the file's exact bytes ("accepted as is / edited / rejected", with an optional
// one-line reason, R-M18) and, unless rejected, moves the ticket draft → ready-for-dev, signed,
// in one step.
const DECISIONS = { a: 'accepted', e: 'edited', r: 'rejected' };

export default {
  name: 'approve',
  summary: 'Approve a ticket, signed, in a real terminal',
  usage: 'mirai approve <ticket> --file <path>',
  positionals: { min: 1, max: 1 },
  options: {
    file: { type: 'string', description: 'the ticket file you approve' },
  },
  async run(args, io, { now = () => new Date() } = {}) {
    const [ticket] = args.positionals;
    checkTicketArg(ticket);
    requireTty(io, 'mirai approve');
    const store = openStore({ cwd: io.cwd, env: io.env });
    const signer = loadSigner(io.env, store);
    const file = readApprovedFile(store.checkout, io.cwd, args.values.file);
    const current = ticketNow(store, ticket, signer.keys);
    move(TICKET, current.state, 'ready-for-dev', { by: 'human', item: ticket }); // refused unless draft
    const hash = contentHash(file.bytes);

    io.stdout.write(`ticket: ${ticket} (${current.state})\nfile:   ${file.path}\nhash:   ${hash}\nkey:    ${signer.keyId}\n`);
    const prompter = createPrompter(io);
    try {
      const asked = now().getTime();
      const answer = (await prompter.ask('accepted as is / edited / rejected? [a/e/r] ')).toLowerCase();
      const decision = DECISIONS[answer];
      if (!decision) throw new UsageError(`${JSON.stringify(answer.slice(0, 10))} is not a, e or r; nothing was written`, 'run it again');
      const answeredAfter = Math.round((now().getTime() - asked) / 100) / 10;
      let reason;
      if (decision !== 'accepted') {
        reason = await prompter.ask('reason (optional, one line): ');
        if (reason.length > 500) throw new UsageError('the reason is longer than 500 characters; nothing was written', 'keep it to one line');
        if (reason === '') reason = undefined;
      }
      await confirmByTyping(prompter, ticket);
      // What you approved is what was shown: the file must not have changed while you answered.
      if (contentHash(readApprovedFile(store.checkout, io.cwd, args.values.file).bytes) !== hash) {
        throw new MiraiError(`${file.path} changed while you were answering; nothing was written`, EXIT.FAILURE);
      }

      const approval = checkEvent({
        type: 'approval', by: 'human', item: ticket, kind: 'ticket', path: file.path, content_hash: hash, decision,
        ...(reason ? { reason } : {}), answered_after_s: answeredAfter,
      });
      const moveTo = { ticket, state: 'ready-for-dev', written_by: 'human' };
      const seq = withSeq(store, (ctx) => {
        // The move's checks come first, so a refused move leaves no approval behind.
        if (decision !== 'rejected') checkTicketStatusWrite(store, moveTo, { expectSeq: current.seq, signer });
        const n = ctx.take();
        ctx.event(n, approval, { signer });
        if (decision !== 'rejected') writeTicketStatusIn(ctx, store, moveTo, { expectSeq: current.seq, signer });
        return n;
      });
      io.stdout.write(decision === 'rejected'
        ? `recorded: ${ticket} rejected (signed with ${signer.keyId}, seq ${seq}); it stays draft\n`
        : `approved: ${ticket} is ready-for-dev (${decision}; signed with ${signer.keyId}, seq ${seq})\n`);
      return EXIT.OK;
    } finally {
      prompter.close();
    }
  },
};
