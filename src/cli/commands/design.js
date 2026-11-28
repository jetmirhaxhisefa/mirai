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
import { approveQuestions, RESEARCH_AGENT, runResearch, skipResearch } from '../../design/research.js';
import { decide, exploreBrief, exploreSettled, exploreState } from '../../design/explore.js';
import { UsageError } from '../errors.js';
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
    usage: 'mirai design <initiative> [--change "<what changes>"] [--explore | --approve-questions | --research | --no-explore | --decide Q-n --pick <letter|arlo> --reason "<why>" --hard <yes|no>]',
    positionals: { min: 1, max: 1 },
    options: {
      // Unit 65 (decision 4): a change to the approved design.
      change: { type: 'string', description: 'a change to the approved design, in your words: a superseding ADR where a decision changes, the HLD (and LLD) amended with a changelog line' },
      // Unit 65b: the design explore step (research and your decisions before Arlo's run 1).
      explore: { type: 'boolean', description: 'where the design questions stand, and the brief for the conversation in your session (unit 65b)' },
      'approve-questions': { type: 'boolean', description: 'approve the design questions (research-questions.md) as they are now, for the research run' },
      research: { type: 'boolean', description: 'run the design research: the approved questions answered from the web, in research.md' },
      'no-explore': { type: 'boolean', description: 'no open design questions: skip the research (recorded) and start the architect' },
      decide: { type: 'string', description: 'with --pick, --reason and --hard: record your decision on one question (Q-n) in design-decisions.md' },
      pick: { type: 'string', description: 'with --decide: the option\'s letter, or "arlo" to leave it to him' },
      reason: { type: 'string', description: 'with --decide: your reason, in your words' },
      hard: { type: 'string', description: 'with --decide: yes or no, whether it is hard to reverse' },
    },
    async run(args, io, { now = () => new Date() } = {}) {
      const initiative = args.positionals[0];
      const v = args.values;
      const modes = ['explore', 'approve-questions', 'research', 'decide'].filter((k) => v[k] !== undefined && v[k] !== false);
      if (modes.length > 1 || (modes.length && (v.change !== undefined || v['no-explore']))) throw new UsageError(`--${modes[0]} goes alone (not with ${modes[1] ? `--${modes[1]}` : v.change !== undefined ? '--change' : '--no-explore'})`);
      if (v.decide === undefined && (v.pick !== undefined || v.reason !== undefined || v.hard !== undefined)) throw new UsageError('--pick, --reason and --hard go with --decide Q-n');
      // Unit 65b: the steps that don't launch an agent print and return.
      if (v.explore) {
        const st = exploreState({ cwd: io.cwd, env: io.env, initiative });
        io.stdout.write(exploreBrief(st, { initiative }));
        return EXIT.OK;
      }
      if (v['approve-questions']) {
        const r = approveQuestions({ cwd: io.cwd, env: io.env, initiative });
        io.stdout.write(`approved: ${plain(r.shown)} (${r.questions.length} question${r.questions.length === 1 ? '' : 's'})${r.commit ? `; committed on your branch: ${r.commit.slice(0, 12)}` : ''}\nnext: the research run, in the background: mirai design ${plain(initiative)} --research (/mirai design research in your session)\n`);
        return EXIT.OK;
      }
      if (v.decide !== undefined) {
        if (!/^Q-[0-9]{1,4}$/.test(v.decide)) throw new UsageError('--decide names a question: Q-n');
        const r = decide({ cwd: io.cwd, env: io.env, initiative, question: v.decide, pick: v.pick ?? '', reason: v.reason ?? '', hard: v.hard ?? '', now });
        const lines = [`recorded: ${r.decision.id} → ${r.decision.pick === 'arlo' ? 'Arlo\'s call' : r.decision.pick}${r.decision.hard ? ' (hard to reverse: it becomes a draft ADR)' : ''}, in ${plain(r.path)}`];
        for (const p of r.problems.slice(0, 5)) lines.push(`  lint: line ${p.line}: ${plain(p.reason)}`);
        lines.push(r.open.length ? `next: ${r.open[0]}${r.open.length > 1 ? ` (${r.open.length} still open)` : ''}` : `next: every question is decided; start the architect: mirai design ${plain(initiative)}`);
        io.stdout.write(`${lines.join('\n')}\n`);
        return r.problems.length ? EXIT.FAILURE : EXIT.OK;
      }
      requireTtyOrSession(io, 'mirai design', 'design');
      if (v['no-explore']) skipResearch({ cwd: io.cwd, env: io.env, initiative });
      // Unit 65b (decision 5): on `full` the design waits for the explore step, or its skip.
      if (!v.research && v.change === undefined) {
        const st = exploreState({ cwd: io.cwd, env: io.env, initiative });
        if (!exploreSettled(st)) {
          io.stderr.write(`${initiative} is on the full track, and its design questions aren't settled yet (${st.phase})\nnext: /mirai design --explore ${plain(initiative)} in your session; or, with no open questions: mirai design ${plain(initiative)} --no-explore\n`);
          return EXIT.NEEDS_HUMAN;
        }
      }
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
        if (v.research) {
          const onResearch = (e) => {
            if (e.kind === 'launch') say(`${who(RESEARCH_AGENT)}: ${e.step} research.md (round ${e.round}): ${e.outcome === 'ok' ? 'handed over' : e.outcome}`);
            else if (e.kind === 'lint') say(`lint, research.md: ${e.problems ? `${e.problems} problem${e.problems === 1 ? '' : 's'}` : 'clean'}`);
          };
          const rr = await runResearch({ cwd: io.cwd, env: io.env, initiative, nextToken: () => mintLaunchToken(), launchOptions, onStep: onResearch, now, ...(launch ? { launch } : {}) });
          progress.stop();
          const out = [`research: ${rr.state}${rr.why ? `: ${plain(rr.why)}` : ''} (${rr.searches} search${rr.searches === 1 ? '' : 'es'}, ${rr.fetches} page${rr.fetches === 1 ? '' : 's'} read${rr.state === 'done' ? `, ${rr.suspicious} suspicious page${rr.suspicious === 1 ? '' : 's'}` : ''})`];
          for (const p of (rr.problems ?? []).slice(0, 5)) out.push(`  lint: line ${p.line}: ${plain(p.reason)}`);
          if (rr.commits.length) out.push(`committed on your branch: ${rr.commits.map((c) => c.slice(0, 12)).join(', ')} (MIRAI's commit, you as author)`);
          out.push(rr.state === 'done' ? `next: decide the questions in your session: /mirai design --explore ${plain(initiative)}` : `next: look at why, then run it again: mirai design ${plain(initiative)} --research`);
          io.stdout.write(`${out.join('\n')}\n`);
          return rr.state === 'done' ? EXIT.OK : EXIT.FAILURE;
        }
        const r = await runDesign({ cwd: io.cwd, env: io.env, initiative, ...(args.values.change !== undefined ? { change: args.values.change } : {}), nextToken: () => mintLaunchToken(), launchOptions, onStep, now, ...(launch ? { launch } : {}), ...(verifyLaunch ? { verifyLaunch } : {}) });
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
