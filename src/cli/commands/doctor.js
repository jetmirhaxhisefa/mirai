import { EXIT } from '../exit-codes.js';
import { fixAll } from '../../doctor/fix.js';
import { runChecks, summary } from '../../doctor/checks.js';
import { plain } from '../../status/text.js';

// mirai doctor [--fix] [--json] (unit 29c; design/03's mirai-doctor, row 29's minimal one): each
// item ok, yellow or red, with a fix hint for every yellow and red. `--fix` repairs only the safe
// kinds (a dead process's lock, the run state from its log, the branch registry from the signed
// records) and checks again; damaged history is never written. Also /mirai doctor [--fix].
const MARK = { ok: 'ok    ', yellow: 'yellow', red: 'red   ' };

export default {
  name: 'doctor',
  summary: 'Check MIRAI\'s setup here, with a fix for each problem (--fix repairs the safe ones)',
  usage: 'mirai doctor [--fix] [--json]',
  positionals: { min: 0, max: 0 },
  options: {
    fix: { type: 'boolean', description: 'repair what\'s safe: a dead process\'s locks, the run state, the branch registry' },
    json: { type: 'boolean', description: 'the items as JSON, for scripts' },
  },
  async run(args, io) {
    let items = await runChecks({ cwd: io.cwd, env: io.env, ...(io.doctor ?? {}) });
    let fixed = [];
    if (args.values.fix) {
      // One item can hide the next (the Store item shows its first problem), so it checks again
      // after each round and repairs what's newly red, each kind of repair at most once.
      const tried = new Set();
      for (;;) {
        const wanted = new Set(items.filter((i) => i.state === 'red' && i.fix && !tried.has(i.fix)).map((i) => i.fix));
        if (!wanted.size) break;
        for (const w of wanted) tried.add(w);
        fixed.push(...fixAll({ cwd: io.cwd, env: io.env, wanted }));
        items = await runChecks({ cwd: io.cwd, env: io.env, ...(io.doctor ?? {}) });
      }
    }
    const red = items.some((i) => i.state === 'red');
    if (args.values.json) {
      io.stdout.write(`${JSON.stringify({ items, ...(args.values.fix ? { fixed } : {}) }, null, 2)}\n`);
      return red ? EXIT.NEEDS_HUMAN : EXIT.OK;
    }
    const lines = [];
    for (const f of fixed) lines.push(`${f.done ? 'fixed' : 'not fixed'} ${f.fix}: ${plain(f.detail)}`);
    if (fixed.length) lines.push('');
    for (const i of items) lines.push(`${MARK[i.state]}  ${i.title.padEnd(16)} ${plain(i.detail)}`);
    const todo = items.filter((i) => i.state !== 'ok');
    if (todo.length) {
      lines.push('', 'to do:');
      for (const i of todo) lines.push(`  ${i.title}: ${plain(i.hint ?? '')}`);
    }
    if (args.values.fix && !fixed.length && items.some((i) => i.state === 'red')) lines.push('', 'nothing --fix can repair here: the red items above need the step named');
    lines.push('', summary(items));
    io.stdout.write(`${lines.join('\n')}\n`);
    return red ? EXIT.NEEDS_HUMAN : EXIT.OK;
  },
};
