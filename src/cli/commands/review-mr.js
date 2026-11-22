import { EXIT } from '../exit-codes.js';
import { checkTicketArg } from '../human-move.js';
import { createPrompter } from '../tty.js';
import { UsageError } from '../errors.js';
import { packetData, packetText } from '../../review/packet.js';
import { mergeDecided } from './merge.js';
import { fullName } from '../../agent/names.js';
import { hostWords, projectWords } from '../../ship/words.js';
import { openStore } from '../../store/home.js';

// mirai review-mr <ticket> [--diff] [--json] (unit 29d; D-34's update): the ticket's MR on one
// screen (files against the plan's Code map, tests against the baseline, Rex's review and its depth,
// the proofs at the head, CI, whether the host can merge it, the diff). In a real terminal it ends
// with your decision: merge (as mirai merge), send back (unit 46), or later. From your session
// (/mirai review-mr) it only shows, and names the terminal command.
export default {
  name: 'review-mr',
  summary: `Review a ticket's ${hostWords(null).long} here, then merge it or leave it (the merge in your terminal)`,
  usage: 'mirai review-mr <ticket> [--diff] [--json]',
  positionals: { min: 1, max: 1 },
  options: {
    diff: { type: 'boolean', description: 'the whole diff of the code, after the packet' },
    json: { type: 'boolean', description: 'the packet as JSON, for scripts (no decision)' },
  },
  async run(args, io) {
    const [ticket] = args.positionals;
    checkTicketArg(ticket);
    const d = packetData({ cwd: io.cwd, env: io.env, ticket, ...(io.hostOf ? { hostOf: io.hostOf } : {}) });
    const words = d.words ?? projectWords({ cwd: io.cwd, env: io.env, store: openStore({ cwd: io.cwd, env: io.env }) });
    if (!d.mr) throw Object.assign(new UsageError(`${ticket} has no ${words.long} yet`, `mirai run ${ticket}`), { code: 'no-mr' });
    if (args.values.json) {
      const { diff, ...rest } = d;
      io.stdout.write(`${JSON.stringify({ ...rest, diff: diff ? { ...diff, patch: args.values.diff ? diff.patch : undefined } : null }, null, 2)}\n`);
      return EXIT.OK;
    }
    io.stdout.write(packetText(d, { diff: Boolean(args.values.diff), words }));
    const open = (d.host?.state ?? d.mr.state) === 'open';
    const terminal = io.stdin?.isTTY === true && io.stdout?.isTTY === true;
    if (!open) return EXIT.OK;
    if (!terminal) {
      io.stdout.write(`\nto merge it, in your terminal: mirai merge ${ticket}   (or mirai review-mr ${ticket} there, and answer m)\n`);
      return EXIT.OK;
    }
    const p = createPrompter(io);
    try {
      const a = (await p.ask('\nDecide: [m]erge  [s]end back  [l]ater ')).toLowerCase();
      if (a === 'm' || a === 'merge') return await mergeDecided(ticket, io, { prompter: p });
      if (a === 's' || a === 'send back') {
        io.stdout.write(`send back comes with the inbox (unit 46): your note as a finding for ${fullName('mirai-developer')}'s next round. Until then: comment on the ${words.long}, or drop the ticket: mirai drop ${ticket}\n`);
        return EXIT.OK;
      }
      io.stdout.write('left as it is: decide later with mirai review-mr or mirai merge\n');
      return EXIT.OK;
    } finally {
      p.close();
    }
  },
};
