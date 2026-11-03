import { EXIT } from '../exit-codes.js';
import { requireTty } from '../tty.js';
import { checkTicketArg } from '../human-move.js';
import { plain } from '../../status/text.js';
import { OUTCOME_EXIT } from '../../agent/run.js';
import { runBuild } from '../../agent/build.js';
import { mintLaunchToken } from '../../agent/requests.js';

// mirai build <ticket> (unit 21b; design/01 §7). Kai builds the ticket from the plan you approved,
// on the ticket's own branch, and hands over; MIRAI then checks protected paths, new dependencies
// and its own test run against your baseline. Nothing is committed (unit 22). Your terminal only
// for now (unit 28's orchestrator runs it at night). Refused unless the red team is green.
const BUILD_EXIT = Object.freeze({ 'handed-over': EXIT.OK, 'checks-failed': EXIT.FAILURE, 'needs-you': EXIT.NEEDS_HUMAN, blocked: EXIT.NEEDS_HUMAN, parked: EXIT.BLOCKED });

export default {
  name: 'build',
  summary: 'Have Kai build a ticket from its approved plan',
  usage: 'mirai build <ticket> [--recheck]',
  positionals: { min: 1, max: 1 },
  options: {
    recheck: { type: 'boolean', description: 'no agent: run MIRAI\'s checks again on exactly the tree the last build left (after you fixed a baseline, Docker, a timeout)' },
  },
  async run(args, io) {
    const [ticket] = args.positionals;
    checkTicketArg(ticket);
    requireTty(io, 'mirai build');
    const abort = new AbortController();
    const hard = new AbortController();
    const onInt = () => (abort.signal.aborted ? hard.abort() : abort.abort());
    const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    for (const sig of SIGNALS) process.on(sig, onInt);
    try {
      const launchOptions = { signal: abort.signal, hardSignal: hard.signal, ...(io.claude ? { claude: io.claude } : {}), ...(io.redTeamStatus ? { status: io.redTeamStatus } : {}) };
      const recheck = Boolean(args.values.recheck);
      // Your terminal mints it (D-14); a recheck launches nothing.
      const r = await runBuild({ cwd: io.cwd, env: io.env, ticket, recheck, launchToken: recheck ? null : mintLaunchToken(), launchOptions, ...(io.testRun ? { testRun: io.testRun } : {}) });
      if (r.warn) io.stdout.write(`note: ${plain(r.warn)}\n`);
      if (r.tookOver) io.stdout.write(`note: ${plain(r.tookOver)}\n`);
      io.stdout.write(`branch: ${r.branch}\n`);
      if (r.launch) io.stdout.write(`launch ${r.launch.id}: ${r.launch.outcome}${r.launch.why ? `: ${plain(r.launch.why)}` : ''}; ${r.launch.line?.turns ?? 0} turns, ${r.launch.line?.minutes ?? 0} min, ${plain(r.launch.line?.model_used ?? r.launch.line?.model ?? '')}\n`);
      if (r.handover) io.stdout.write(`Kai's handover (${r.handover.status}): ${plain(r.handover.summary).slice(0, 2000)}\n`);
      const p = r.protectedPaths;
      if (p?.instructionFiles?.length) io.stdout.write(`  instruction files it changed (they reach an agent's context): ${p.instructionFiles.map(plain).join(', ')}\n`);
      if (r.dependencies?.lockOnly?.length) io.stdout.write(`  lock files it changed with no manifest change beside them: ${r.dependencies.lockOnly.map(plain).join(', ')}\n`);
      if (r.dependencies?.added?.length || r.dependencies?.changedSpecs?.length) io.stdout.write(`  dependencies added or changed (declared): ${[...r.dependencies.added, ...r.dependencies.changedSpecs].map((d) => plain(d.dependency)).join(', ')}\n`);
      for (const t of r.tests?.runs ?? []) io.stdout.write(`  ${t.name}: ${t.verdict}${t.why ? ` (${plain(t.why)})` : ''}${t.fresh.length ? `; new: ${t.fresh.slice(0, 10).map(plain).join(', ')}` : ''}\n`);
      io.stdout.write(`\nbuild of ${ticket}: ${r.outcome}${r.why ? `: ${plain(r.why)}` : ''}\n`);
      if (r.outcome === 'handed-over') io.stdout.write(`  the ticket is in-review; the changes are uncommitted on ${r.branch} (commits are unit 22): git diff\n`);
      else if (r.launch?.outcome === 'ok' || r.rechecked) io.stdout.write(`  the changes are left as they are on ${r.branch} for you to look at: git status\n  once you've fixed what stopped it outside the tree (a baseline, Docker): mirai build ${ticket} --recheck\n`);
      return BUILD_EXIT[r.outcome] ?? OUTCOME_EXIT[r.outcome] ?? EXIT.FAILURE;
    } finally {
      for (const sig of SIGNALS) process.removeListener(sig, onInt);
    }
  },
};
