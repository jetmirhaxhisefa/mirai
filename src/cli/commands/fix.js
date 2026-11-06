import { EXIT } from '../exit-codes.js';
import { progressPrinter } from '../progress.js';
import { requireTty } from '../tty.js';
import { checkTicketArg } from '../human-move.js';
import { plain } from '../../status/text.js';
import { OUTCOME_EXIT } from '../../agent/run.js';
import { runFix } from '../../agent/fix.js';
import { mintLaunchToken } from '../../agent/requests.js';

// mirai fix <ticket> (unit 21c; design/01 §7, D-18): fix rounds after a build whose own test run
// found new failures. Kai gets those failures, from MIRAI's run, and fixes them, round by round,
// under the loop guard: until green (in-review), a re-plan, a park, a stop for you, or Ctrl-C.
// Each round resumes Kai's session when it can. Your terminal only for now (unit 28 runs it at night).
const FIX_EXIT = Object.freeze({ 'handed-over': EXIT.OK, replan: EXIT.NEEDS_HUMAN, parked: EXIT.BLOCKED, 'needs-you': EXIT.NEEDS_HUMAN, blocked: EXIT.NEEDS_HUMAN, 'checks-failed': EXIT.FAILURE });

export default {
  name: 'fix',
  summary: 'Have Kai fix what MIRAI\'s tests found, round by round',
  usage: 'mirai fix <ticket>',
  positionals: { min: 1, max: 1 },
  options: {},
  async run(args, io) {
    const [ticket] = args.positionals;
    checkTicketArg(ticket);
    requireTty(io, 'mirai fix');
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
      // Your terminal mints each round's token (D-14).
      const r = await runFix({ cwd: io.cwd, env: io.env, ticket, nextToken: () => mintLaunchToken(), launchOptions, ...(io.testRun ? { testRun: io.testRun } : {}) });
      if (r.warn) io.stdout.write(`note: ${plain(r.warn)}\n`);
      if (r.tookOver) io.stdout.write(`note: ${plain(r.tookOver)}\n`);
      io.stdout.write(`branch: ${r.branch}\n`);
      for (const x of r.rounds) {
        io.stdout.write(`round ${x.round}: ${x.outcome}${x.decision ? ` → ${x.decision}` : ''}${x.why ? ` (${plain(x.why).slice(0, 300)})` : ''}; ${x.line?.turns ?? 0} turns, ${x.line?.minutes ?? 0} min, ${x.resumed ? 'resumed Kai\'s session' : 'a fresh session'}\n`);
        for (const t of x.tests?.runs ?? []) io.stdout.write(`  ${t.name}: ${t.verdict}${t.fresh?.length ? `; new: ${t.fresh.slice(0, 8).map(plain).join(', ')}` : ''}\n`);
      }
      io.stdout.write(`\nfix of ${ticket}: ${r.outcome}${r.why ? `: ${plain(r.why)}` : ''}\n`);
      if (r.outcome === 'handed-over') io.stdout.write('  the ticket is in-review, with MIRAI\'s commits on its branch: git log main..\n');
      if (r.outcome === 'replan') io.stdout.write(`  the same failure came back: the ticket is ready-for-dev for its one re-plan: mirai plan ${ticket}\n`);
      return FIX_EXIT[r.outcome] ?? OUTCOME_EXIT[r.outcome] ?? EXIT.FAILURE;
    } finally {
      progress?.stop();
      for (const sig of SIGNALS) process.removeListener(sig, onInt);
    }
  },
};
