import { EXIT } from '../exit-codes.js';
import { plain } from '../../status/text.js';
import { failedLabels, resultLines, runReaderTest } from '../../write/reader.js';

// mirai reader-test <file> (unit 34, Scope 4). A fresh agent reads only the document's summary for
// approval and answers what is built, for whom, what is left out and what you decide, quoting the
// summary; MIRAI checks the quotes. The result is recorded in the store by the summary's hash, so
// `mirai approve` shows it, and a rerun on an unchanged summary costs no run. It signs nothing and
// changes no file, so it runs from your session too (/mirai reader-test <file>, 21f).

export function createReaderTestCommand({ launch, claude = null } = {}) {
  return {
    name: 'reader-test',
    summary: 'Check that a fresh agent can tell, from a document\'s summary alone, what you are approving',
    usage: 'mirai reader-test <file>',
    positionals: { min: 1, max: 1 },
    options: {},
    async run(args, io, { now = () => new Date() } = {}) {
      const [file] = args.positionals;
      const r = await runReaderTest({ cwd: io.cwd, env: io.env, file, now, ...(launch ? { launch } : {}), ...(claude ? { claude } : {}) });
      const e = r.entry;
      const out = [];
      out.push(`reader test: ${plain(r.document.path)} (${r.document.type} ${plain(r.document.id)})`);
      out.push(r.reused
        ? `the summary hasn't changed since round ${e.round}: its result, with no new run (model ${plain(e.model)})`
        : `round ${e.round}${e.round <= r.runs ? ` of ${r.runs}` : ''}, model ${plain(e.model)}`);
      for (const l of resultLines(e)) out.push(plain(l));
      if (e.result === 'pass') out.push(`result: pass; recorded as ${e.hash}`);
      else {
        out.push(`result: fail (${failedLabels(e).join(', ')}); recorded as ${e.hash}`);
        out.push(e.round >= r.runs
          ? 'that was the last of the author\'s rounds: at approval it shows as "reader test failed", with the gap; you approve anyway, reject with a note, or fix the summary and test it again'
          : 'fix the summary, then run the reader test again');
      }
      io.stdout.write(`${out.join('\n')}\n`);
      return e.result === 'pass' ? EXIT.OK : EXIT.FAILURE;
    },
  };
}

export default createReaderTestCommand();
