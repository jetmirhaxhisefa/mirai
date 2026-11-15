import { EXIT } from '../exit-codes.js';
import { checkTicketArg, confirmByTyping } from '../human-move.js';
import { createPrompter, requireTty } from '../tty.js';
import { mergeChecks, mergeTicket } from '../../review/merge.js';
import { decisionSigner } from '../../sign/signer.js';
import { plain } from '../../status/text.js';

// mirai merge <ticket> (unit 29d; D-34: your merge is the gate): the ticket's MR merged from MIRAI,
// with a merge commit pinned to the head you reviewed. Yours only: a real terminal and the ticket
// key typed, never from a session (/mirai merge answers with this command). `mirai review-mr`
// shows the packet first and ends with the same decision.
export async function mergeDecided(ticket, io, { now = () => new Date(), checks = null, prompter = null } = {}) {
  const c = checks ?? mergeChecks({ cwd: io.cwd, env: io.env, ticket, ...(io.hostOf ? { hostOf: io.hostOf } : {}) });
  io.stdout.write(`merge ${ticket}'s MR #${c.facts.number} at ${c.head.slice(0, 7)} into ${c.integration}, with a merge commit, signed with your key\n`);
  const p = prompter ?? createPrompter(io);
  const asked = now().getTime();
  let signer;
  try {
    signer = await decisionSigner(io, c.store, { prompter: p, ticket, confirm: confirmByTyping });
  } finally {
    if (!prompter) p.close();
  }
  const r = mergeTicket({ cwd: io.cwd, env: io.env, ticket, signer, answeredAfterS: (now().getTime() - asked) / 1000, checks: c, ...(io.hostOf ? { hostOf: io.hostOf } : {}) });
  io.stdout.write(`merged: ${ticket}'s MR${r.mr.url ? ` ${plain(r.mr.url)}` : ''} as ${r.mergeSha.slice(0, 7)} (your merge, signed); ${ticket} is done\n`);
  for (const n of r.notes) io.stdout.write(`note: ${plain(n)}\n`);
  return EXIT.OK;
}

export default {
  name: 'merge',
  summary: 'Merge a ticket\'s MR from MIRAI, pinned to the head you reviewed (yours: a real terminal)',
  usage: 'mirai merge <ticket>',
  positionals: { min: 1, max: 1 },
  options: {},
  async run(args, io) {
    const [ticket] = args.positionals;
    checkTicketArg(ticket);
    requireTty(io, 'mirai merge');
    return mergeDecided(ticket, io);
  },
};
