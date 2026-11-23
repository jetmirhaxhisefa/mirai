import { join } from 'node:path';

import { EXIT } from '../exit-codes.js';
import { MiraiError } from '../errors.js';
import { progressPrinter } from '../progress.js';
import { requireTtyOrSession } from '../tty.js';
import { plain } from '../../status/text.js';
import { OUTCOME_EXIT } from '../../agent/run.js';
import { mintLaunchToken } from '../../agent/requests.js';
import { agentNamer, fullName } from '../../agent/names.js';
import { requireHooks } from '../../hooks/install.js';
import { documentLine } from '../../store/connectors/links.js';
import { openStore } from '../../store/home.js';
import { subjectHash, verifyResultFor } from '../../store/verify-results.js';
import { findingLines, mustFix, suggestions } from '../../verify/findings.js';
import { handoffText, resultState, runsOf, VERIFY_AGENT } from '../../verify/gate.js';
import { runVerify, verifySubject } from '../../verify/run.js';

// mirai verify <file> (unit 40, Scope 4): the verifier checks one document (a brief, a PRD, an epic
// with its tickets, or a context file you approve) and MIRAI records the result by its content
// hash, with its round. A rerun on unchanged text reuses the result and costs no run. The output
// ends with the must-fix count, then each finding, then the document's full path. It signs nothing
// and changes no file, so it runs from your session too (/mirai verify <file>, 21f).
// `--handoff` (Scope 9): the must-fix findings of the result for the document as it is now, fenced
// as the author's next run takes them, with "fix these, then run mirai verify again". No run.

export function createVerifyCommand({ launch = null } = {}) {
  return {
    name: 'verify',
    summary: `Have ${fullName(VERIFY_AGENT)} check a document before you approve it`,
    usage: 'mirai verify <file> [--handoff]',
    positionals: { min: 1, max: 1 },
    options: {
      handoff: { type: 'boolean', description: 'print the must-fix findings as the author\'s next run gets them; no run' },
    },
    async run(args, io, { now = () => new Date() } = {}) {
      const [file] = args.positionals;
      const who = agentNamer();
      if (args.values.handoff) {
        const subject = verifySubject({ cwd: io.cwd, env: io.env, file });
        const entry = verifyResultFor(subject.store, subject.id, subjectHash(subject.bytes, subject.files));
        if (!entry) throw Object.assign(new MiraiError(`${subject.path} has no result from ${fullName(VERIFY_AGENT)} for it as it is now`, EXIT.BLOCKED), { code: 'no-verify', hint: `run: mirai verify ${subject.path}` });
        io.stdout.write(`${handoffText(entry, { file: subject.path })}\n`);
        return mustFix(entry.findings ?? []).length ? EXIT.FAILURE : EXIT.OK;
      }
      requireTtyOrSession(io, 'mirai verify', 'verify');
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
        const launchOptions = { who, signal: abort.signal, hardSignal: hard.signal, onProgress: progress.onProgress, onCheck: progress.onCheck, ...(io.claude ? { claude: io.claude } : {}), ...(io.redTeamStatus ? { status: io.redTeamStatus } : {}) };
        const r = await runVerify({ cwd: io.cwd, env: io.env, file, launchToken: mintLaunchToken(), launchOptions, ...(launch ? { launch } : {}), now });
        progress.stop();
        const s = r.subject;
        const name = who(VERIFY_AGENT);
        if (!r.entry) {
          io.stdout.write(`${name}: ${plain(s.path)} (${s.type} ${plain(s.id)}): ${r.outcome}${r.why ? `: ${plain(r.why).slice(0, 400)}` : ''}\n`);
          io.stdout.write(`nothing was recorded: run it again (mirai verify ${plain(s.path)})\n`);
          return OUTCOME_EXIT[r.outcome] ?? EXIT.FAILURE;
        }
        const e = r.entry;
        const runs = runsOf(s.config, 'verify');
        const out = [];
        out.push(`${name} checked ${plain(s.path)} (${s.type} ${plain(s.id)})`);
        // P3's run: a round past the last says so, and a result for text that changed during the check
        // says it isn't the file's now (it never reads as a fresh check of the current text).
        out.push(r.reused
          ? `it hasn't changed since round ${e.round}: that result, with no new run (model ${plain(e.model)})`
          : `round ${e.round}${e.round <= runs ? ` of ${runs}` : `, after the last of ${runs} rounds`}, model ${plain(e.model)}, tier ${plain(e.tier)}${e.rung ? `, rung ${e.rung}` : ''}`);
        if (r.changed) out.push(`the file changed while she checked it: this result is for the text as it was committed, not as it is now; run mirai verify ${plain(s.path)} again for the current text`);
        // Scope 2: a dropped finding is logged, never counted or shown as a finding; it's listed apart
      // with what it said, so a lost must-fix is visible (P2's second run).
      if (e.dropped?.length) {
        out.push(`dropped, not counted: ${e.dropped.length} finding${e.dropped.length === 1 ? '' : 's'} MIRAI couldn't check`);
        for (const d of e.dropped) out.push(`  dropped  ${plain(d.id)}  ${plain(d.why)}`, ...(d.what ? [`        ${plain(d.what)}`] : []));
      }
        const state = resultState(e, s.config);
        if (state === 'pass') out.push(`result: passed (${e.suggestions} suggestion${e.suggestions === 1 ? '' : 's'}); recorded as ${e.hash}`);
        else {
          out.push(`result: ${e.must_fix} must-fix finding${e.must_fix === 1 ? '' : 's'} open; recorded as ${e.hash}`);
          out.push(state === 'last'
            ? `that was the last of the author's rounds: at approval it shows as "${who(VERIFY_AGENT)}: ${e.must_fix} finding${e.must_fix === 1 ? '' : 's'} open", each listed; you approve anyway, reject with a note, or fix the document and check it again`
            : `fix them, then run mirai verify ${plain(s.path)} again (the author's next run gets them with: mirai verify ${plain(s.path)} --handoff)`);
        }
        out.push(`must-fix: ${e.must_fix}`);
        for (const f of [...mustFix(e.findings ?? []), ...suggestions(e.findings ?? [])]) out.push(...findingLines(f).map(plain));
        out.push(documentLine({ store: s.store, config: s.config, conn: s.conn, abs: join(s.base, s.path), rel: s.path, bytes: s.bytes }));
        io.stdout.write(`${out.join('\n')}\n`);
        return state === 'pass' ? EXIT.OK : EXIT.FAILURE;
      } finally {
        progress?.stop();
        for (const sig of SIGNALS) process.removeListener(sig, onInt);
      }
    },
  };
}

export default createVerifyCommand();
