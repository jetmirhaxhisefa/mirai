import { EXIT } from '../exit-codes.js';
import { progressPrinter } from '../progress.js';
import { requireTtyOrSession } from '../tty.js';
import { plain } from '../../status/text.js';
import { mintLaunchToken } from '../../agent/requests.js';
import { agentNamer, fullName } from '../../agent/names.js';
import { requireHooks } from '../../hooks/install.js';
import { documentLine } from '../../store/connectors/links.js';
import { openStore } from '../../store/home.js';
import { VERIFY_AGENT } from '../../verify/gate.js';
import { NORA_AGENT, readDoc, runNora } from '../../nora/run.js';
import { noraStateLines } from '../../nora/state.js';
import { readJournal } from '../../store/journal.js';

// mirai write <initiative> (unit 41; Jet's decisions 1 and 4, and his re-check answers A1, B1, C1):
// Nora writes the initiative's brief, then its PRD, from your confirmed interview, in the
// background, and MIRAI runs the lint, Vera and the reader test between her launches until each
// document is ready for your approval, she asks you something (paused), or the rounds run out.
// It signs nothing, so it runs from your session too (/mirai write <initiative>, 39's list), which
// is how the interview hands over to her. The output ends with her state, as `mirai show
// <initiative>` prints it, and each document's full path and link.

export function createWriteCommand({ launch = null, verifyLaunch = null, readerLaunch = null, readerClaude = null } = {}) {
  return {
    name: 'write',
    summary: `Have ${fullName(NORA_AGENT)} write an initiative's brief and PRD from your confirmed interview`,
    usage: 'mirai write <initiative>',
    positionals: { min: 1, max: 1 },
    options: {},
    async run(args, io, { now = () => new Date() } = {}) {
      const [initiative] = args.positionals;
      requireTtyOrSession(io, 'mirai write', 'write');
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
        const onStep = (e) => {
          if (e.kind === 'launch') say(`${who(NORA_AGENT)}: ${e.step} the ${e.type} (round ${e.round}): ${e.outcome === 'ok' ? 'handed over' : e.outcome}`);
          else if (e.kind === 'lint') say(`lint, the ${e.type}: ${e.errors ? `${e.errors} problem${e.errors === 1 ? '' : 's'}` : 'clean'}`);
          else if (e.kind === 'verify') say(`${who(VERIFY_AGENT)}, the ${e.type}: round ${e.round}, ${e.must_fix} must-fix${e.reused ? ' (unchanged since that check)' : ''}`);
          else if (e.kind === 'reader') say(`reader test, the ${e.type}: ${e.result}, round ${e.round}${e.reused ? ' (unchanged since that test)' : ''}`);
        };
        const r = await runNora({
          cwd: io.cwd, env: io.env, initiative, nextToken: () => mintLaunchToken(), launchOptions, onStep, now,
          ...(launch ? { launch } : {}), ...(verifyLaunch ? { verifyLaunch } : {}), ...(readerLaunch ? { readerLaunch } : {}), ...(readerClaude ? { readerClaude } : {}),
        });
        progress.stop();
        const s = r.subject;
        const out = [];
        // The same lines `mirai show <initiative>` prints (Scope 7: your session tells you from these).
        out.push(...noraStateLines(readJournal(s.store).events, initiative, { who }));
        if (r.commits.length) out.push(`committed on your branch: ${r.commits.map((c) => c.slice(0, 12)).join(', ')} (MIRAI's commit${r.commits.length === 1 ? '' : 's'}, you as author)`);
        for (const type of ['interview', 'brief', 'prd']) {
          const d = readDoc(s, type);
          if (d) out.push(documentLine({ store: s.store, config: s.config, conn: s.conn, abs: d.abs, rel: s.conn.relOf(d.abs) ?? d.shown, bytes: d.bytes }));
        }
        if (r.state === 'done') out.push(`next: read them, then approve: mirai approve ${plain(String(readDoc(s, 'prd')?.value.id ?? '<prd-id>'))} --file ${plain(readDoc(s, 'prd')?.shown ?? 'prd.md')}`);
        else if (r.state === 'paused') out.push('next: answer the question in your session (it resumes the interview), commit interview.md, then start her again: /mirai write ' + plain(initiative));
        else out.push(`next: look at why, then start her again: mirai write ${plain(initiative)}`);
        io.stdout.write(`${out.join('\n')}\n`);
        return r.state === 'done' ? EXIT.OK : r.state === 'paused' ? EXIT.NEEDS_HUMAN : EXIT.FAILURE;
      } finally {
        progress?.stop();
        for (const sig of SIGNALS) process.removeListener(sig, onInt);
      }
    },
  };
}

export default createWriteCommand();
