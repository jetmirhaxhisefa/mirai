import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { progressPrinter } from '../progress.js';
import { requireTtyOrSession } from '../tty.js';
import { plain } from '../../status/text.js';
import { mintLaunchToken } from '../../agent/requests.js';
import { agentNamer, fullName } from '../../agent/names.js';
import { requireHooks } from '../../hooks/install.js';
import { documentLine } from '../../store/connectors/links.js';
import { openStore } from '../../store/home.js';
import { readJournal } from '../../store/journal.js';
import { VERIFY_AGENT } from '../../verify/gate.js';
import { readDoc, runTess, TESS_AGENT } from '../../tess/run.js';
import { tessStateLines } from '../../tess/state.js';
import { readTicketFolder } from '../../lint/lint.js';
import { readApprovedFile } from '../human-move.js';

// mirai tickets <initiative> [--one] (unit 42; Jet's decisions 1–3 and his re-check answers Q1–Q3
// "A", 2026-11-24): the ticket planner cuts the initiative's approved PRD into an epic and its
// tickets (or, with --one, writes the one ticket its short interview asks for), in the background,
// and MIRAI renders the epic and runs the lint and Vera between her launches until the set is
// ready for your approval, she asks you something (paused), or the rounds run out. It signs
// nothing, so it runs from your session too (/mirai tickets <initiative>, and /mirai ticket "<one
// line>" after its short interview). The output ends with her state, as `mirai show <initiative>`
// prints it, and each document's full path and link.

export function createTicketsCommand({ launch = null, verifyLaunch = null } = {}) {
  return {
    name: 'tickets',
    summary: `Have ${fullName(TESS_AGENT)} cut an approved PRD into an epic and its tickets, write one ticket from its short interview, or fix a lone ticket from the verifier's findings`,
    usage: 'mirai tickets <initiative> [--one] | mirai tickets fix <ticket> [--answer <text>]',
    positionals: { min: 1, max: 2 },
    options: {
      one: { type: 'boolean', description: 'one lone ticket from the folder\'s short interview (for: ticket), with no epic' },
      answer: { type: 'string', description: 'with fix: your answer to an open point in the ticket\'s Notes; she settles that point with it' },
    },
    async run(args, io, { now = () => new Date() } = {}) {
      // Jet's answer 3 (2026-11-24): `mirai tickets fix <KEY>`, an existing lone ticket fixed from
      // the verifier's findings on it.
      const fix = args.positionals.length === 2 ? args.positionals[1] : null;
      if (args.positionals.length === 2 && args.positionals[0] !== 'fix') throw new UsageError(`mirai tickets takes one initiative, or fix and a ticket key`, 'mirai tickets <initiative> [--one], or mirai tickets fix <ticket>');
      if (fix && args.values.one) throw new UsageError('--one is for a ticket asked for by hand, not a fix', `mirai tickets fix ${fix}`);
      if (!fix && args.values.answer !== undefined) throw new UsageError('--answer goes with fix', 'mirai tickets fix <ticket> --answer "<your answer>"');
      const initiative = fix ?? args.positionals[0];
      const one = Boolean(args.values.one) || Boolean(fix);
      requireTtyOrSession(io, 'mirai tickets', 'tickets');
      requireHooks({ store: openStore({ cwd: io.cwd, env: io.env }), env: io.env });
      const who = agentNamer();
      const abort = new AbortController();
      const hard = new AbortController();
      const onInt = () => (abort.signal.aborted ? hard.abort() : abort.abort());
      const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
      for (const sig of SIGNALS) process.on(sig, onInt);
      let progress = null;
      try {
        progress = progressPrinter(io, io.progressTiming ?? {});
        const launchOptions = { who, signal: abort.signal, hardSignal: hard.signal, onProgress: progress.onProgress, onCheck: progress.onCheck, ...(io.claude ? { claude: io.claude } : {}), ...(io.redTeamStatus ? { status: io.redTeamStatus } : {}) };
        const say = (line) => {
          progress.stop();
          io.stdout.write(`${line}\n`);
        };
        const what = one ? 'the ticket' : 'the set';
        const onStep = (e) => {
          if (e.kind === 'launch') say(`${who(TESS_AGENT)}: ${e.step === 'notes' ? 'change' : e.step} ${what} (round ${e.round}): ${e.outcome === 'ok' ? 'handed over' : e.outcome}`);
          else if (e.kind === 'render') say(`epic render: ${e.problem ? plain(e.problem) : `${e.changed ? 'rendered' : 'already up to date'} from ${e.tickets} ticket${e.tickets === 1 ? '' : 's'}`}`);
          else if (e.kind === 'lint') say(`lint, ${what}: ${e.errors ? `${e.errors} problem${e.errors === 1 ? '' : 's'}` : 'clean'}${e.trace ? `; trace: ${e.trace === 'pass' ? 'every link there' : `${e.missing} missing link${e.missing === 1 ? '' : 's'}`}` : ''}`);
          else if (e.kind === 'verify') say(`${who(VERIFY_AGENT)}, ${what}: round ${e.round}, ${e.must_fix} must-fix${e.reused ? ' (unchanged since that check)' : ''}`);
        };
        const r = await runTess({
          cwd: io.cwd, env: io.env, ...(fix ? { fix, ...(args.values.answer !== undefined ? { answer: args.values.answer } : {}) } : { initiative, one }), nextToken: () => mintLaunchToken(), launchOptions, onStep, now,
          ...(launch ? { launch } : {}), ...(verifyLaunch ? { verifyLaunch } : {}),
        });
        progress.stop();
        const s = r.subject;
        const out = [...(s.notBuilt ? [`inputs: ${s.notBuilt}`] : []), ...tessStateLines(readJournal(s.store).events, initiative, { who })];
        if (r.commits.length) out.push(`committed on your branch: ${r.commits.map((c) => c.slice(0, 12)).join(', ')} (MIRAI's commit${r.commits.length === 1 ? '' : 's'}, you as author)`);
        const line = (abs, bytes) => documentLine({ store: s.store, config: s.config, conn: s.conn, abs, rel: s.conn.relOf(abs) ?? abs, bytes });
        const interview = fix ? s.interview : readDoc(s, 'interview');
        if (interview) out.push(line(interview.abs, interview.bytes));
        let approve = null;
        if (one) {
          if (r.ticket) {
            const bytes = readApprovedFile(s.conn.base, s.conn.base, r.ticket).bytes;
            out.push(line(r.ticket, bytes));
            approve = `mirai approve ${plain(r.ticket.split('/').at(-1).replace(/\.md$/, ''))} --file ${plain(s.conn.relOf(r.ticket) ?? r.ticket)}`;
          }
        } else {
          const epic = readDoc(s, 'epic');
          if (epic) {
            out.push(line(epic.abs, epic.bytes));
            approve = `mirai approve ${plain(String(epic.value.id ?? '<epic-id>'))} --file ${plain(epic.shown)}`;
          }
          let tickets = [];
          try {
            tickets = readTicketFolder(s.dir, { root: s.conn.base }).all;
          } catch {
            tickets = [];
          }
          for (const t of tickets) {
            const abs = `${s.dir}/${t.path}`;
            try {
              out.push(line(abs, readApprovedFile(s.conn.base, s.conn.base, abs).bytes));
            } catch {
              // unreadable: the lint said so
            }
          }
        }
        if (r.state === 'done') out.push(`next: read ${one ? 'it' : 'the epic (its summary is the page you approve from)'}, then approve${one ? ' it on its own' : ' the set'}: ${approve ?? 'mirai approve <id> --file <path>'}`);
        else if (r.state === 'paused') out.push(`next: answer the question in your session (it resumes the interview); your answer changes the PRD, so /mirai write ${plain(initiative)} brings it in line and you approve the PRD again; then start her again: /mirai tickets ${plain(initiative)}`);
        else out.push(`next: look at why, then start her again: mirai tickets ${plain(initiative)}${one ? ' --one' : ''}`);
        io.stdout.write(`${out.join('\n')}\n`);
        return r.state === 'done' ? EXIT.OK : r.state === 'paused' ? EXIT.NEEDS_HUMAN : EXIT.FAILURE;
      } finally {
        progress?.stop();
        for (const sig of SIGNALS) process.removeListener(sig, onInt);
      }
    },
  };
}

export default createTicketsCommand();
