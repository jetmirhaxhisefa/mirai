import { EXIT } from '../exit-codes.js';
import { MiraiError, UsageError } from '../errors.js';
import { checkTicketArg, confirmByTyping, ticketNow } from '../human-move.js';
import { createPrompter, requireTty } from '../tty.js';
import { readLoop } from '../../loop/guard.js';
import { plain } from '../../status/text.js';
import { openStore } from '../../store/home.js';
import { signHumanMove } from '../../store/tickets.js';
import { decisionSigner } from '../../sign/signer.js';
import { branchKeys } from '../../sign/keys.js';
import { acceptDispute, openDisputes, readDisputes, upholdDisputes } from '../../agent/review.js';
import { readPending, writeAccepted } from '../../agent/install.js';
import { agentNamer } from '../../agent/names.js';

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
  usage: 'mirai unpark <ticket> --retry | --accept <finding-id>[,<finding-id>…] | --accept-deps',
  positionals: { min: 1, max: 1 },
  options: {
    retry: { type: 'boolean', description: 'back to in-progress, as it is; for a disputed park, the disputed findings stand' },
    accept: { type: 'string', description: 'for a disputed park: drop these findings (comma-separated ids); any other open dispute stands' },
    'accept-deps': { type: 'boolean', description: 'for a deps-review park (unit 30b): accept exactly the package change MIRAI showed; the next build installs it only if it is identical' },
  },
  async run(args, io) {
    const [ticket] = args.positionals;
    checkTicketArg(ticket);
    const retry = args.values.retry === true;
    const acceptIds = args.values.accept === undefined ? null : String(args.values.accept).split(',').map((s) => s.trim()).filter(Boolean);
    const acceptDeps = args.values['accept-deps'] === true;
    if ([retry, acceptIds !== null, acceptDeps].filter(Boolean).length !== 1) throw new UsageError('say what to do: --retry, --accept <finding-id> for a disputed finding, or --accept-deps for a package install (re-plan and drop come with unit 46)');
    if (acceptIds && (acceptIds.length === 0 || !acceptIds.every((id) => ID.test(id)))) throw new UsageError('--accept takes finding ids, comma-separated, as the parking note names them');
    requireTty(io, 'mirai unpark');
    const store = openStore({ cwd: io.cwd, env: io.env });
    const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
    const current = ticketNow(store, ticket, keys);
    if (current.state !== 'blocked') throw new MiraiError(`${ticket} is ${current.state}, not parked`, EXIT.BLOCKED);
    if (readLoop(store, ticket).parked) throw new MiraiError(`${ticket} was parked by the loop guard (${plain(readLoop(store, ticket).parked.reason)}): it needs rounds granted, which unit 46's unpark does`, EXIT.BLOCKED);
    if (acceptDeps) return await acceptInstall(io, store, ticket, current);
    const disputed = current.status?.park_reason === 'disputed';
    const open = disputed ? openDisputes(readDisputes(store, ticket)) : [];
    if (acceptIds) {
      if (!disputed) throw new MiraiError(`${ticket} isn't parked for a disputed finding (${plain(current.status?.park_reason ?? '?')}); --accept is only for that`, EXIT.BLOCKED);
      const unknown = acceptIds.filter((id) => !open.some((x) => x.id === id));
      if (unknown.length) throw new MiraiError(`${unknown.join(', ')} ${unknown.length === 1 ? 'isn\'t an open disputed finding' : 'aren\'t open disputed findings'} of ${ticket} (open: ${open.map((x) => x.id).join(', ') || 'none'})`, EXIT.BLOCKED);
    }
    io.stdout.write(`ticket: ${ticket} (parked: ${plain(current.status?.park_reason ?? '?')})\nwhy:    ${plain(current.status?.note ?? '')}\n`);
    const who = agentNamer();
    for (const x of open) io.stdout.write(`  disputed ${plain(x.id)}: ${plain(x.finding?.claim ?? '')} (${plain(x.finding?.file ?? '?')}:${x.finding?.line ?? '?'})\n    ${who('mirai-developer')}: ${plain(x.reason ?? '')}\n`);
    const stand = acceptIds ? open.filter((x) => !acceptIds.includes(x.id)) : open;
    // Unit 30c (F23): a plan that failed the lint twice goes back for a re-plan, with your note as
    // a review note Kai reads; in-progress would be a dead end (`mirai plan` starts from
    // ready-for-dev).
    const badPlan = current.status?.park_reason === 'bad-plan';
    const to = badPlan ? 'ready-for-dev' : acceptIds && stand.length === 0 ? 'in-review' : 'in-progress';
    if (badPlan) io.stdout.write(`then: ready-for-dev, for a re-plan that reads your note (mirai plan ${ticket})\n`);
    if (disputed) io.stdout.write(`${acceptIds ? `dropped: ${acceptIds.join(', ')}\n` : ''}${stand.length ? `stand (${who('mirai-developer')} fixes them next): ${stand.map((x) => x.id).join(', ')}\n` : ''}then: ${to === 'in-review' ? `in-review, for ${who('mirai-reviewer')}'s next round (mirai review ${ticket})` : `in-progress, for ${who('mirai-developer')} (mirai fix ${ticket})`}\n`);
    const prompter = createPrompter(io);
    try {
      const note = await prompter.ask(`note (one line, required: why it can go on${badPlan ? `; ${who('mirai-developer')} reads it` : ''}): `);
      if (!/\S/.test(note)) throw new UsageError('a note is required: your signed reason why the ticket can go on; nothing was written', 'run it again and write one line');
      if (note.length > 500) throw new UsageError('the note is one line of at most 500 characters; nothing was written');
      const signer = await decisionSigner(io, store, { prompter, ticket, confirm: confirmByTyping });
      const choice = to === 'in-review' ? 'accept' : to === 'ready-for-dev' ? 're-plan' : 'retry';
      const seq = signHumanMove(store, signer, { ticket, state: to, note, ...(current.status?.replans !== undefined ? { replans: current.status.replans } : {}) }, { expectSeq: current.seq, move: { choice, note } });
      // The rulings, after your signed move: what you dropped, then what stands.
      if (disputed) {
        for (const id of acceptIds ?? []) acceptDispute(store, ticket, id);
        upholdDisputes(store, ticket);
      }
      io.stdout.write(`unparked: ${ticket} is ${to} again (${choice}; signed with ${signer.keyId}, seq ${seq})${to === 'ready-for-dev' ? `; next: mirai plan ${ticket}` : ''}\n`);
      return EXIT.OK;
    } finally {
      prompter.close();
    }
  },
};

// Unit 30b (Jet, 2026-11-16): a big or odd install waits for you. You see exactly what would change,
// and your signed acceptance covers exactly that change: the next build installs only if the update
// comes out identical (its hash); anything else parks again.
async function acceptInstall(io, store, ticket, current) {
  if (current.status?.park_reason !== 'deps-review') throw new MiraiError(`${ticket} isn't parked for a package install (${plain(current.status?.park_reason ?? '?')}); --accept-deps is only for that`, EXIT.BLOCKED);
  const pending = readPending(store, ticket);
  if (!pending) throw new MiraiError(`${ticket} has no install waiting for you (it may have been cleared); build it again to see it`, EXIT.BLOCKED);
  io.stdout.write(`ticket: ${ticket} (parked: deps-review)\npackages: ${pending.rows.map(plain).join(', ')}\nwhat needs you:\n${pending.problems.map((p) => `  - ${plain(p)}`).join('\n')}\nadded to the locks (${pending.added?.length ?? 0}): ${(pending.added ?? []).slice(0, 40).map(plain).join(', ')}${(pending.added?.length ?? 0) > 40 ? ', …' : ''}\nthen: in-progress; the next build installs exactly this change (mirai build ${ticket})\n`);
  const prompter = createPrompter(io);
  try {
    const note = await prompter.ask('note (one line, why this change is fine): ');
    if (!/\S/.test(note) || note.length > 500) throw new UsageError('the note is one line of at most 500 characters; nothing was written');
    const signer = await decisionSigner(io, store, { prompter, ticket, confirm: confirmByTyping });
    writeAccepted(store, ticket, pending, signer);
    const seq = signHumanMove(store, signer, { ticket, state: 'in-progress', note, ...(current.status?.replans !== undefined ? { replans: current.status.replans } : {}) }, { expectSeq: current.seq, move: { choice: 'retry', note } });
    io.stdout.write(`unparked: ${ticket} is in-progress again; the package change ${pending.hash.slice(0, 12)} is accepted (signed with ${signer.keyId}, seq ${seq})\n`);
    return EXIT.OK;
  } finally {
    prompter.close();
  }
}
