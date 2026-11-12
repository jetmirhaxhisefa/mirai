import { EXIT } from '../exit-codes.js';
import { progressPrinter } from '../progress.js';
import { viaOf } from '../tty.js';
import { checkTicketArg } from '../human-move.js';
import { plain } from '../../status/text.js';
import { driveTicket } from '../../run/drive.js';
import { requireHooks } from '../../hooks/install.js';
import { openStore } from '../../store/home.js';

// mirai run <ticket> (unit 28; design/01 §14). One ticket from wherever it is to its merge request,
// stopping only where you're needed: the plan gate, a park, a step that needs you, a usage limit it
// can't wait out. Running it again does the next steps from there. From your session (/mirai run),
// it stops before the proofs, which your key signs in your terminal only (decision 2).

// What a stop's kind means as an exit code: finished 0; a gate or a stop for you 5; a park 4.
export const STOP_EXIT = Object.freeze({ 'gate-plan': EXIT.NEEDS_HUMAN, 'gate-proofs': EXIT.NEEDS_HUMAN, 'needs-you': EXIT.NEEDS_HUMAN, limit: EXIT.NEEDS_HUMAN, baseline: EXIT.NEEDS_HUMAN, breaker: EXIT.NEEDS_HUMAN, fault: EXIT.NEEDS_HUMAN, parked: EXIT.BLOCKED, refused: EXIT.BLOCKED, interrupted: EXIT.INTERRUPTED });

// The run's text, shared with `mirai resume`.
export function runSummary(r, ticket) {
  const out = [];
  for (const n of r.notes ?? []) out.push(`note: ${plain(n)}`);
  out.push('');
  for (const s of r.steps) out.push(`  ${s.step}: ${s.outcome}${s.why ? `: ${plain(s.why).slice(0, 300)}` : ''}`);
  if (r.outcome === 'finished') {
    out.push('', `${ticket}: built${r.mr ? `, MR ${plain(r.mr)}` : ''}`);
    out.push(`  next: review and merge the MR on the host; your merge is the gate (mirai show ${ticket})`);
  } else {
    out.push('', `${ticket}: stopped: ${plain(r.stop?.why ?? 'unknown')}`);
    if (r.here) out.push(`  you're on ${plain(r.here)}`);
    out.push(`  next: ${plain(r.stop?.next ?? `mirai show ${ticket}`)}`);
  }
  return `${out.join('\n')}\n`;
}

export function exitOf(r) {
  if (r.outcome === 'finished') return EXIT.OK;
  return r.stop?.exit ?? STOP_EXIT[r.stop?.kind] ?? EXIT.FAILURE;
}

// The run's events as lines on stderr, beside the steps' own progress.
export function eventPrinter(io) {
  return (e) => {
    try {
      if (e.type === 'step') io.stderr.write(`[run] ${e.step}…\n`);
      else if (e.type === 'step-done') io.stderr.write(`[run] ${e.step}: ${e.outcome}${e.why ? `: ${plain(e.why).slice(0, 200)}` : ''}\n`);
      else if (e.type === 'paused' || e.type === 'resumed') io.stderr.write(`[run] ${plain(e.line)}\n`);
    } catch {
      // a display only
    }
  };
}

// Ctrl-C once stops the step's agent and the run; twice, hard.
export function withSignals(fn) {
  const abort = new AbortController();
  const hard = new AbortController();
  const onInt = () => (abort.signal.aborted ? hard.abort() : abort.abort());
  const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const sig of SIGNALS) process.on(sig, onInt);
  return fn(abort, hard).finally(() => {
    for (const sig of SIGNALS) process.removeListener(sig, onInt);
  });
}

export default {
  name: 'run',
  summary: 'Take one ticket to its merge request, stopping only where you\'re needed',
  usage: 'mirai run <ticket>',
  positionals: { min: 1, max: 1 },
  options: {},
  async run(args, io) {
    const [ticket] = args.positionals;
    checkTicketArg(ticket);
    const via = viaOf(io, 'mirai run', 'run');
    // MIRAI's pre-push hook must be on before agents start (unit 26a).
    requireHooks({ store: openStore({ cwd: io.cwd, env: io.env }), env: io.env });
    return await withSignals(async (abort, hard) => {
      const progress = progressPrinter(io, io.progressTiming ?? {});
      try {
        const launchOptions = { signal: abort.signal, hardSignal: hard.signal, onProgress: progress.onProgress, onCheck: progress.onCheck, ...(io.claude ? { claude: io.claude } : {}), ...(io.redTeamStatus ? { status: io.redTeamStatus } : {}), ...(io.hostOf ? { hostOf: io.hostOf } : {}) };
        const r = await driveTicket({ cwd: io.cwd, env: io.env, ticket, via, launchOptions, onEvent: eventPrinter(io), ...(io.runSteps ? { steps: io.runSteps } : {}), ...(io.caffeinate ? { caffeinate: io.caffeinate } : {}), ...(io.sleep ? { sleep: io.sleep } : {}), ...(io.now ? { now: io.now } : {}) });
        io.stdout.write(runSummary(r, ticket));
        return exitOf(r);
      } finally {
        progress.stop();
      }
    });
  },
};
