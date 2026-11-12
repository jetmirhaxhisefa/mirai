import { EXIT } from '../exit-codes.js';
import { MiraiError } from '../errors.js';
import { progressPrinter } from '../progress.js';
import { viaOf } from '../tty.js';
import { plain } from '../../status/text.js';
import { driveTicket } from '../../run/drive.js';
import { requireHooks } from '../../hooks/install.js';
import { loadSigner } from '../../sign/signer.js';
import { runLockHolder } from '../../store/global.js';
import { openStore } from '../../store/home.js';
import { readHeartbeat, readRunState, resumeRun, writeRunState } from '../../store/run.js';
import { readTicketStatus } from '../../store/tickets.js';
import { eventPrinter, exitOf, runSummary, withSignals } from './run.js';

// mirai resume [--abandon] (unit 28, decision 6; design/01 §14): your last run, continued. It says
// what was in progress, what's parked and what waits for you; a crashed run is taken over; then
// the same ticket goes on from where it is. Round counters and budgets are never reset. Your move
// (stopped → running) is signed from your terminal; from your session, the store confirms the
// request (21f). `--abandon` gives the run up, so `mirai run` of another ticket can start.

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export default {
  name: 'resume',
  summary: 'Continue your last run from where it stopped (or give it up: --abandon)',
  usage: 'mirai resume [--abandon]',
  positionals: { min: 0, max: 0 },
  options: {
    abandon: { type: 'boolean', description: 'give the stopped run up: nothing runs, and mirai run of another ticket may start' },
  },
  async run(args, io) {
    const via = viaOf(io, 'mirai resume', 'resume');
    const store = openStore({ cwd: io.cwd, env: io.env });
    let s = readRunState(store);
    if (!s) throw Object.assign(new MiraiError('there\'s no run to resume', EXIT.BLOCKED), { code: 'no-run', hint: 'start one: mirai run <ticket>' });
    if (s.state === 'finished') throw Object.assign(new MiraiError(`the last run (${s.run_id}) finished; there's nothing to resume`, EXIT.BLOCKED), { code: 'finished', hint: 'start one: mirai run <ticket>' });
    if (s.abandoned) throw Object.assign(new MiraiError(`the last run (${s.run_id}) was given up`, EXIT.BLOCKED), { code: 'abandoned', hint: 'start one: mirai run <ticket>' });
    // A live run is never taken over: its lock holder is still there.
    const holder = runLockHolder(io.env);
    if (holder && holder.run_id === s.run_id && alive(holder.pid) && holder.pid !== process.pid) throw Object.assign(new MiraiError(`run ${s.run_id} is still going (pid ${holder.pid})`, EXIT.BLOCKED), { code: 'run-active', hint: 'mirai status shows it; Ctrl-C in its terminal stops it' });
    // A paused run whose process is gone (a restart while it waited) is stopped first.
    if (s.state === 'paused') s = writeRunState(store, 'stopped', { ticket: s.ticket });
    const ticket = s.ticket;
    if (!ticket) throw Object.assign(new MiraiError(`run ${s.run_id} has no ticket on record`, EXIT.BLOCKED), { code: 'no-ticket', hint: 'start one: mirai run <ticket>' });
    // What's where, before anything moves.
    const t = readTicketStatus(store, ticket)?.status ?? null;
    const beat = readHeartbeat(store);
    io.stdout.write(`last run: ${s.run_id}, ${s.state}${s.state === 'running' ? ' (its process is gone: it crashed)' : ''}\n`);
    io.stdout.write(`  in progress: ${ticket}${s.step ? `, ${s.step}` : ''}${beat?.progress ? ` (last: ${plain(beat.progress)})` : ''}\n`);
    io.stdout.write(`  ${ticket} is ${t?.state ?? 'unknown'}${t?.state === 'blocked' ? `, parked: ${plain(t.park_reason ?? '')}${t.note ? `: ${plain(t.note)}` : ''}` : ''}\n`);
    const signer = via === 'terminal' ? loadSigner(io.env, store) : null;
    const request = via === 'session' ? io.env.MIRAI_SESSION_REQUEST : null;
    if (args.values.abandon) {
      if (s.state !== 'stopped') throw Object.assign(new MiraiError(`run ${s.run_id} is ${s.state}: run mirai resume to take it over first`, EXIT.BLOCKED), { code: 'not-stopped' });
      resumeRun(store, { runId: s.run_id, via, request, signer, abandon: true });
      io.stdout.write(`\ngiven up: run ${s.run_id}. ${ticket} is ${t?.state ?? 'unknown'}, as it was; mirai run <ticket> starts a new run\n`);
      return EXIT.OK;
    }
    requireHooks({ store, env: io.env });
    return await withSignals(async (abort, hard) => {
      const progress = progressPrinter(io, io.progressTiming ?? {});
      try {
        const launchOptions = { signal: abort.signal, hardSignal: hard.signal, onProgress: progress.onProgress, onCheck: progress.onCheck, ...(io.claude ? { claude: io.claude } : {}), ...(io.redTeamStatus ? { status: io.redTeamStatus } : {}), ...(io.hostOf ? { hostOf: io.hostOf } : {}) };
        const move = (st) => resumeRun(st, { runId: s.run_id, via, request, signer });
        const r = await driveTicket({ cwd: io.cwd, env: io.env, ticket, via, resume: { runId: s.run_id, move }, launchOptions, onEvent: eventPrinter(io), ...(io.runSteps ? { steps: io.runSteps } : {}), ...(io.caffeinate ? { caffeinate: io.caffeinate } : {}), ...(io.sleep ? { sleep: io.sleep } : {}), ...(io.now ? { now: io.now } : {}) });
        io.stdout.write(runSummary(r, ticket));
        return exitOf(r);
      } finally {
        progress.stop();
      }
    });
  },
};
