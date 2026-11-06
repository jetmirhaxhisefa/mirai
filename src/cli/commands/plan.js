import { EXIT } from '../exit-codes.js';
import { progressPrinter } from '../progress.js';
import { requireTty } from '../tty.js';
import { checkTicketArg } from '../human-move.js';
import { plain } from '../../status/text.js';
import { OUTCOME_EXIT } from '../../agent/run.js';
import { runPlan } from '../../agent/plan.js';
import { mintLaunchToken } from '../../agent/requests.js';

// mirai plan <ticket> (unit 21a; design/01 §6). Kai writes the ticket's plan from its inputs on the
// integration branch; MIRAI stores it, lints it, gives it one fix launch, and stops at your gate.
// Your terminal only for now (unit 28's orchestrator runs it at night). Refused unless the red team
// is green, as every launch is.
// A path as one shell word: its folder is under "Application Support" (21a's walkthrough).
const shellQuote = (p) => `'${String(p).replace(/'/g, "'\\''")}'`;
const PLAN_EXIT = Object.freeze({ waiting: EXIT.OK, parked: EXIT.BLOCKED, 'bad-plan': EXIT.BLOCKED });

export default {
  name: 'plan',
  summary: 'Have Kai write a ticket\'s plan, then stop at your gate',
  usage: 'mirai plan <ticket>',
  positionals: { min: 1, max: 1 },
  options: {},
  async run(args, io) {
    const [ticket] = args.positionals;
    checkTicketArg(ticket);
    requireTty(io, 'mirai plan');
    const abort = new AbortController();
    const hard = new AbortController();
    const onInt = () => (abort.signal.aborted ? hard.abort() : abort.abort());
    const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    for (const sig of SIGNALS) process.on(sig, onInt);
    let progress = null;
    try {
      // What's happening as it happens (unit 21e), on stderr.
      progress = progressPrinter(io, io.progressTiming ?? {});
      const launchOptions = { signal: abort.signal, hardSignal: hard.signal, onProgress: progress.onProgress, onCheck: progress.onCheck, ...(io.claude ? { claude: io.claude } : {}), ...(io.redTeamStatus ? { status: io.redTeamStatus } : {}) };
      // Your terminal mints them (D-14): the launch and its one fix launch.
      const r = await runPlan({ cwd: io.cwd, env: io.env, ticket, launchTokens: [mintLaunchToken(), mintLaunchToken()], launchOptions, ...(io.planVia ? { via: io.planVia } : {}) });
      if (r.warn) io.stdout.write(`note: ${plain(r.warn)}\n`);
      if (r.tookOver) io.stdout.write(`note: ${plain(r.tookOver)}\n`);
      const left = r.inputs.left_out;
      io.stdout.write(`inputs from ${r.inputs.commit.slice(0, 12)}: ${r.inputs.files.map((f) => f.name).join(', ')}${left.length ? `\n  left out: ${left.map((x) => `${plain(x.path ?? x.id)} (${plain(x.why)})`).join('; ')}` : ''}\n`);
      for (const l of r.launches) io.stdout.write(`launch ${l.id}: ${l.outcome}${l.why ? `: ${plain(l.why)}` : ''}; ${l.line?.turns ?? 0} turns, ${l.line?.minutes ?? 0} min, ${plain(l.line?.model_used ?? l.line?.model ?? '')}\n`);
      if (r.outcome === 'waiting') {
        io.stdout.write(`\nplan for ${ticket}: passes the lint, and waits at the plan gate (${r.gate.why.map(plain).join('; ')})\n  read it: less ${shellQuote(r.path)}\n  then: mirai approve ${ticket} --plan\n`);
      } else {
        io.stdout.write(`\nplan for ${ticket}: ${r.outcome}${r.why ? `: ${plain(r.why)}` : ''}\n`);
        for (const p of r.problems.slice(0, 20)) io.stdout.write(`  line ${p.line}: ${plain(p.reason)}\n`);
      }
      return PLAN_EXIT[r.outcome] ?? OUTCOME_EXIT[r.outcome] ?? EXIT.FAILURE;
    } finally {
      progress?.stop();
      for (const sig of SIGNALS) process.removeListener(sig, onInt);
    }
  },
};
