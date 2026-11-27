import { EXIT } from '../exit-codes.js';
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
import { listAdrs, workTreeReader } from '../../adr/adr.js';
import { ARLO_AGENT, readDoc, runDesign } from '../../design/run.js';
import { designStateLines } from '../../design/state.js';

// mirai design <initiative> (unit 64; Jet's decisions 1–5, 2026-11-26): the architect writes the
// initiative's design from its approved PRD and the code, in the background: on `full` the HLD and
// its ADRs, then the LLD when the HLD says it's required; on `standard` the technical note. MIRAI
// runs the lint and Vera between his launches until each document is ready for your approval, he
// asks you something (paused), or the rounds run out. It signs nothing, so it runs from your session
// too (/mirai design <initiative>). Until unit 65 you approve each document with mirai approve.

const WORD = { hld: 'the HLD', lld: 'the LLD', 'tech-note': 'the technical note' };

export function createDesignCommand({ launch = null, verifyLaunch = null } = {}) {
  return {
    name: 'design',
    summary: `Have ${fullName(ARLO_AGENT)} write an initiative's design (the HLD and its ADRs, the LLD, or the technical note) from its approved PRD and the code`,
    usage: 'mirai design <initiative>',
    positionals: { min: 1, max: 1 },
    options: {},
    async run(args, io, { now = () => new Date() } = {}) {
      const initiative = args.positionals[0];
      requireTtyOrSession(io, 'mirai design', 'design');
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
          if (e.kind === 'launch') say(`${who(ARLO_AGENT)}: ${e.step} ${WORD[e.doc]} (round ${e.round}): ${e.outcome === 'ok' ? 'handed over' : e.outcome}`);
          else if (e.kind === 'lint') say(`lint, ${WORD[e.doc]}: ${e.errors ? `${e.errors} problem${e.errors === 1 ? '' : 's'}` : 'clean'}`);
          else if (e.kind === 'verify') say(`${who(VERIFY_AGENT)}, ${plain(e.file)}: round ${e.round}, ${e.must_fix} must-fix${e.reused ? ' (unchanged since that check)' : ''}`);
        };
        const r = await runDesign({ cwd: io.cwd, env: io.env, initiative, nextToken: () => mintLaunchToken(), launchOptions, onStep, now, ...(launch ? { launch } : {}), ...(verifyLaunch ? { verifyLaunch } : {}) });
        progress.stop();
        const s = r.subject;
        const out = [...designStateLines(readJournal(s.store).events, initiative, { who })];
        if (r.commits.length) out.push(`committed on your branch: ${r.commits.map((c) => c.slice(0, 12)).join(', ')} (MIRAI's commit${r.commits.length === 1 ? '' : 's'}, you as author)`);
        const line = (d) => documentLine({ store: s.store, config: s.config, conn: s.conn, abs: d.abs, rel: d.shown, bytes: d.bytes });
        const approve = [];
        for (const t of ['hld', 'tech-note', 'lld']) {
          const d = readDoc(s, t);
          if (!d) continue;
          out.push(line(d));
          if (r.written.includes(t)) approve.push(`mirai approve ${plain(String(d.value.id ?? '<id>'))} --file ${plain(d.shown)}`);
        }
        const own = listAdrs(workTreeReader(s.store.checkout), s.adr).filter((a) => a.mirai && a.initiative === initiative && a.status === 'proposed');
        for (const a of own) out.push(`ADR ${plain(a.id)} (proposed): ${plain(a.path)}; accepting the document that links it accepts it too`);
        if (r.state === 'done') out.push(approve.length ? `next: read ${approve.length === 1 ? 'it' : 'them'} (the summary is the page you approve from), then approve in order: ${approve.join(', then ')}` : 'next: nothing to write: the design is approved as it is now');
        else if (r.state === 'paused') out.push(`next: answer the question in your session (it resumes the interview); your answer changes the PRD, so /mirai write ${plain(initiative)} brings it in line and you approve the PRD again; then start him again: /mirai design ${plain(initiative)}`);
        else out.push(`next: look at why, then start him again: mirai design ${plain(initiative)}`);
        io.stdout.write(`${out.join('\n')}\n`);
        return r.state === 'done' ? EXIT.OK : r.state === 'paused' ? EXIT.NEEDS_HUMAN : EXIT.FAILURE;
      } finally {
        progress?.stop();
        for (const sig of SIGNALS) process.removeListener(sig, onInt);
      }
    },
  };
}

export default createDesignCommand();
