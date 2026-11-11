import { EXIT } from '../exit-codes.js';
import { checkTicketArg } from '../human-move.js';
import { plain } from '../../status/text.js';
import { shipTicket } from '../../ship/ship.js';

// mirai ship <ticket> (unit 27a; Jet's decision 2): push a reviewed ticket's branch and open or
// update its one MR against the integration branch. It signs nothing, so it runs from your
// terminal or unattended; unit 28's `mirai run` calls the same function. No human step: your
// merge is the gate.

export default {
  name: 'ship',
  summary: 'Push a reviewed ticket\'s branch and open or update its MR',
  usage: 'mirai ship <ticket>',
  positionals: { min: 1, max: 1 },
  options: {},
  async run(args, io) {
    const [ticket] = args.positionals;
    checkTicketArg(ticket);
    const r = await shipTicket({ cwd: io.cwd, env: io.env, ticket });
    io.stdout.write(`ship ${ticket}: ${r.outcome}\n`);
    io.stdout.write(`  ${r.pushed ? `pushed ${r.head.slice(0, 12)} to ${plain(r.branch)}` : `${plain(r.branch)} was already at ${r.head.slice(0, 12)} on the host`}\n`);
    io.stdout.write(`  MR ${r.mr.number}: ${plain(r.mr.url)}\n`);
    io.stdout.write('  your merge is the gate: review it on the host\n');
    return EXIT.OK;
  },
};
