import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { checkTicketArg } from '../human-move.js';
import { showData, showText } from '../../run/show.js';

// mirai show <ticket> (unit 28, decision 7; design/03 "mirai show"): the ticket's page from the
// store: its plan, build, review rounds with every blocking finding, the MR, rounds, usage and why
// it's parked. Read-only, so it's safe from your session too (/mirai show).
export default {
  name: 'show',
  summary: 'Print one ticket\'s page: plan, build, reviews, MR, rounds, usage, parking',
  usage: 'mirai show <ticket> [--full | --json]',
  positionals: { min: 1, max: 1 },
  options: {
    full: { type: 'boolean', description: 'every finding\'s text, the plan, and the parking note whole' },
    json: { type: 'boolean', description: 'the page as JSON, for scripts' },
  },
  async run(args, io) {
    const [ticket] = args.positionals;
    checkTicketArg(ticket);
    if (args.values.full && args.values.json) throw new UsageError('--full and --json don\'t go together', 'pick one');
    const d = showData({ cwd: io.cwd, env: io.env, ticket });
    if (d.state === null && !d.plan && !d.build) throw Object.assign(new UsageError(`${ticket} has nothing in MIRAI yet`, `approve it first: mirai approve ${ticket} --file <path>`), { code: 'unknown-ticket' });
    if (args.values.json) {
      const { plan, ...rest } = d;
      io.stdout.write(`${JSON.stringify({ ...rest, plan: plan ? { ...plan, text: undefined } : null }, null, 2)}\n`);
    } else io.stdout.write(showText(d, { full: Boolean(args.values.full) }));
    return EXIT.OK;
  },
};
