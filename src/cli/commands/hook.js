import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { EXIT } from '../exit-codes.js';
import { UsageError, formatError } from '../errors.js';
import { plain } from '../../status/text.js';
import { readHooksRecord } from '../../hooks/install.js';
import { parseUpdates, prePushCheck } from '../../hooks/pre-push.js';
import { coverageLines } from '../../proofs/coverage-text.js';
import { openStore } from '../../store/home.js';

// mirai hook pre-push <remote> <url> (unit 26a): what MIRAI's pre-push script runs, from the
// integration branch's sealed copy (the launcher's `hook` rule). git passes the remote and its
// URL, and one line per ref on stdin. The repo's own pre-push, when MIRAI forwards to it (Jet's
// decision 7), runs first with the same input; then the push check (src/hooks/pre-push.js). Exit
// 0 lets the push go; anything else refuses it. When the check can't run, the push is refused
// (decision 6). No colour, no network, no store writes.

const STDIN_MAX = 1024 * 1024;
const NO_VERIFY = 'the push wasn\'t checked, so it\'s refused; to push anyway: git push --no-verify';

async function readAll(stream) {
  const chunks = [];
  let size = 0;
  for await (const c of stream) {
    size += c.length;
    if (size > STDIN_MAX) throw new UsageError('more on stdin than git gives a pre-push hook');
    chunks.push(Buffer.from(c));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default {
  name: 'hook',
  summary: 'Run a git hook\'s check (git runs it; you don\'t need to)',
  usage: 'mirai hook pre-push <remote> <url>',
  positionals: { min: 1, max: 3 },
  options: {},
  async run(args, io) {
    const [kind, remote = '', url = ''] = args.positionals;
    if (kind !== 'pre-push') throw new UsageError(`${plain(kind).slice(0, 40)} isn't a hook MIRAI runs`, 'git runs: mirai hook pre-push <remote> <url>');
    let input;
    let updates;
    try {
      input = await readAll(io.stdin);
      updates = parseUpdates(input);
    } catch (err) {
      io.stderr.write(`mirai pre-push: ${plain(err.message).slice(0, 300)}\nmirai pre-push: ${NO_VERIFY}\n`);
      return EXIT.BLOCKED;
    }
    try {
      // The repo's own pre-push first, as before MIRAI (decision 7).
      const record = readHooksRecord(openStore({ cwd: io.cwd, env: io.env }));
      if (record?.hooks.includes('pre-push')) {
        const old = join(record.forwarded_from, 'pre-push');
        const r = spawnSync(old, [remote, url], { cwd: io.cwd, env: io.env, input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
        if (r.stdout) io.stdout.write(r.stdout);
        if (r.stderr) io.stderr.write(r.stderr);
        if (r.error || r.status !== 0) {
          io.stderr.write(`mirai pre-push: your own pre-push (${old}) refused the push${r.error ? ` (${r.error.code})` : ''}\n`);
          return EXIT.FAILURE;
        }
      }
      const result = prePushCheck({ cwd: io.cwd, env: io.env, remote, updates });
      for (const x of result.refs) {
        const name = x.remoteRef.replace(/^refs\/heads\//, '');
        io.stderr.write(`mirai pre-push: ${plain(name).slice(0, 200)}: ${x.outcome === 'pass' ? 'pass' : `blocked (${x.outcome})`}: ${plain(x.why ?? '').slice(0, 400)}\n`);
        if (x.outcome !== 'pass' && x.hint) io.stderr.write(`  ${plain(x.hint).slice(0, 400)}\n`);
        if (x.outcome === 'pass' && Object.hasOwn(x, 'diffCoverage')) for (const l of coverageLines(x.diffCoverage, { files: 5, ticket: x.ticket })) io.stderr.write(`${l}\n`);
        for (const f of (x.findings ?? []).slice(1, 10)) io.stderr.write(`  also: ${f.pattern} in ${f.file === null ? 'the message' : plain(f.file).slice(0, 200)} (${f.commit.slice(0, 12)})\n`);
      }
      return result.ok ? EXIT.OK : EXIT.BLOCKED;
    } catch (err) {
      io.stderr.write(formatError(err, io.env).replace(/^mirai: /, 'mirai pre-push: '));
      io.stderr.write(`mirai pre-push: ${NO_VERIFY}\n`);
      return EXIT.BLOCKED;
    }
  },
};
