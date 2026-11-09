import { EXIT } from '../exit-codes.js';
import { progressPrinter } from '../progress.js';
import { requireTtyOrSession } from '../tty.js';
import { checkTicketArg } from '../human-move.js';
import { plain } from '../../status/text.js';
import { OUTCOME_EXIT } from '../../agent/run.js';
import { runReview } from '../../agent/review.js';
import { mintLaunchToken } from '../../agent/requests.js';
import { requireHooks } from '../../hooks/install.js';
import { openStore } from '../../store/home.js';

// mirai review <ticket> (unit 24a; design/01 §9): Rex reviews the ticket's change after a green
// build or fix round, read-only, in a fresh session. MIRAI checks and triages his findings itself:
// a pass leaves the ticket in-review; blocking findings send it to in-progress for `mirai fix`.
// Your terminal, or your session through `/mirai review` (21f); units 28 and 55 run the same step
// at night through runReview().
const REVIEW_EXIT = Object.freeze({ pass: EXIT.OK, changes: EXIT.FAILURE, replan: EXIT.NEEDS_HUMAN, parked: EXIT.BLOCKED, 'needs-you': EXIT.NEEDS_HUMAN });

export default {
  name: 'review',
  summary: 'Have Rex review a ticket\'s change after its checks are green',
  usage: 'mirai review <ticket>',
  positionals: { min: 1, max: 1 },
  options: {},
  async run(args, io) {
    const [ticket] = args.positionals;
    checkTicketArg(ticket);
    requireTtyOrSession(io, 'mirai review', 'review');
    // MIRAI's pre-push hook must be on before agents start (unit 26a).
    requireHooks({ store: openStore({ cwd: io.cwd, env: io.env }), env: io.env });
    const abort = new AbortController();
    const hard = new AbortController();
    const onInt = () => (abort.signal.aborted ? hard.abort() : abort.abort());
    const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    for (const sig of SIGNALS) process.on(sig, onInt);
    let progress = null;
    try {
      progress = progressPrinter(io, io.progressTiming ?? {});
      const launchOptions = { signal: abort.signal, hardSignal: hard.signal, onProgress: progress.onProgress, onCheck: progress.onCheck, ...(io.claude ? { claude: io.claude } : {}), ...(io.redTeamStatus ? { status: io.redTeamStatus } : {}) };
      // Your terminal mints each launch's token (D-14): a high-risk review is several launches (24b).
      const r = await runReview({ cwd: io.cwd, env: io.env, ticket, nextToken: () => mintLaunchToken(), launchOptions });
      if (r.warn) io.stdout.write(`note: ${plain(r.warn)}\n`);
      if (r.tookOver) io.stdout.write(`note: ${plain(r.tookOver)}\n`);
      const line = r.launch?.line ?? {};
      io.stdout.write(`review ${r.review} of ${ticket} (round ${r.round}, ${r.risk} risk): ${r.outcome}${r.why ? `: ${plain(r.why).slice(0, 400)}` : ''}\n`);
      if (r.launches?.length > 1) {
        for (const l of r.launches) io.stdout.write(`  ${plain(l.label)}: ${l.outcome}, ${l.line?.turns ?? 0} turns, ${l.line?.minutes ?? 0} min\n`);
      } else if (r.launch) io.stdout.write(`  Rex: ${line.turns ?? 0} turns, ${line.minutes ?? 0} min\n`);
      if (r.blocking.length) io.stdout.write(`  blocking: ${r.blocking.map(plain).join(', ')}\n`);
      if (r.followups.length) io.stdout.write(`  follow-ups (not sent back): ${r.followups.length}\n`);
      io.stdout.write(`  the findings: ${plain(r.path)}\n`);
      if (r.outcome === 'pass') io.stdout.write('  the ticket stays in-review, with MIRAI\'s commits on its branch\n');
      if (r.outcome === 'changes') io.stdout.write(`  the ticket is in-progress again: mirai fix ${ticket}\n`);
      if (r.outcome === 'replan') io.stdout.write(`  the same finding came back: the ticket is ready-for-dev for its one re-plan: mirai plan ${ticket}\n`);
      if (r.outcome === 'agent-failed') io.stdout.write(`  nothing changed: run it again (mirai review ${ticket})\n`);
      return REVIEW_EXIT[r.outcome] ?? OUTCOME_EXIT[r.outcome] ?? EXIT.FAILURE;
    } finally {
      progress?.stop();
      for (const sig of SIGNALS) process.removeListener(sig, onInt);
    }
  },
};
