import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { escapeInvisible, shown } from '../../status/text.js';
import { recordBaseline } from '../../baseline/record.js';
import { readBaseline } from '../../baseline/store.js';
import { openStore } from '../../store/home.js';
import { baseCommit } from '../../trust/snapshot.js';

// mirai baseline [--level <name>]… [--force] | mirai baseline show [<commit>] (unit 17b): records
// the test baseline of the integration branch's commit (src/baseline/record.js), or prints a
// stored one. For you, on a clean tree with HEAD on the integration branch; the orchestrator
// refreshes it through the same library.

// Text from test names, escaped (nothing reaches the terminal as an escape sequence).
const plain = (text) => escapeInvisible(String(text).replace(/[\x00-\x1f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));
const secs = (ms) => (typeof ms === 'number' ? `${Math.round(ms / 1000)} s` : '-');
const SHOWN = 30;

export function report(b, { reused = false } = {}) {
  const out = [`test baseline for ${plain(b.branch)} at ${b.sha.slice(0, 12)}${reused ? ' (recorded already; --force runs it again)' : ''}${b.complete ? '' : ': INCOMPLETE (an environment fault; read it as "can\'t tell")'}`, ''];
  for (const [name, e] of Object.entries(b.levels)) {
    const t = e.tests ? `, ${e.tests.total} tests (${e.tests.passed} passed, ${e.tests.failed} failed, ${e.tests.errors} errors, ${e.tests.skipped} skipped)` : '';
    const cov = e.coverage?.state === 'ok' ? `, coverage ${e.coverage.covered} of ${e.coverage.lines} lines in ${e.measured.files.length} files` : '';
    out.push(`${plain(name)} (${e.kind}): ${e.state}${e.code ? ` (${plain(e.code)})` : ''} in ${secs(e.duration_ms)}${t}${cov}`);
    if (e.message) out.push(`  ${plain(e.message)}`);
    const by = (s) => e.known_failures.filter((k) => k.state === s);
    for (const s of ['failing', 'flaky', 'unchecked']) {
      const list = by(s);
      for (const k of list.slice(0, SHOWN)) out.push(`  ${s.padEnd(9)} ${plain(k.id ?? `(the whole level: ${k.kind})`)} — failed ${k.failed} of ${k.runs}${k.reason ? `; ${plain(k.reason)}` : ''}`);
      if (list.length > SHOWN) out.push(`  … and ${list.length - SHOWN} more ${s}`);
    }
  }
  const added = b.growth?.added ?? [];
  if (added.length) {
    out.push('', `NEW known failures since the previous baseline (${b.growth.previous.sha.slice(0, 12)}): ${added.length}; something broke on ${plain(b.branch)}`);
    for (const a of added.slice(0, SHOWN)) out.push(`  ${plain(a.level)}: ${plain(a.id ?? `(the whole level: ${a.kind})`)}`);
    if (added.length > SHOWN) out.push(`  … and ${added.length - SHOWN} more`);
  }
  if (b.gaps.length) out.push('', `gaps (reported, never tickets): ${b.gaps.length}`, ...b.gaps.map((g) => `  - ${g.level ? `${plain(g.level)}: ` : ''}${plain(g.text)}`));
  out.push('', `signed with ${b.signature.key_id}`, '');
  return out.join('\n');
}

export default {
  name: 'baseline',
  summary: 'Record or show the test baseline: known failing and flaky tests on the integration branch',
  usage: 'mirai baseline [--level <name>]… [--force] | mirai baseline show [<commit>]',
  positionals: { min: 0, max: 2 },
  options: {
    level: { type: 'string', multiple: true, description: 'only this level or check (repeatable), merged into the commit\'s baseline' },
    force: { type: 'boolean', description: 'run it again even if this commit has a baseline' },
  },
  async run(args, io) {
    const [action, sha] = args.positionals;
    if (action === 'show') {
      if (args.values.level || args.values.force) throw new UsageError('show takes no --level or --force');
      const store = openStore({ cwd: io.cwd, env: io.env });
      if (sha !== undefined && !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) throw new UsageError(`${shown(sha)} isn't a full commit id`, 'give the 40-character id, or none for the integration branch\'s');
      const commit = sha ?? baseCommit(store.checkout, store.branch, io.env);
      const b = readBaseline(store, commit);
      if (!b) {
        io.stdout.write(`no baseline for ${store.branch} at ${commit.slice(0, 12)}; record it with: mirai baseline\n`);
        return EXIT.FAILURE;
      }
      io.stdout.write(report(b));
      return EXIT.OK;
    }
    if (action !== undefined) throw new UsageError(`unknown action ${shown(action)}`, 'see: mirai baseline --help');
    const { baseline, reused } = await recordBaseline({
      cwd: io.cwd, env: io.env, levels: args.values.level ?? null, force: args.values.force === true,
      // `io.docker`: a test's stand-in for Docker Desktop (never set by the CLI itself).
      ...(io.docker ? { docker: io.docker } : {}),
      onEvent: (text) => io.stderr.write(`${text}\n`),
    });
    io.stdout.write(report(baseline, { reused }));
    return baseline.complete ? EXIT.OK : EXIT.NEEDS_HUMAN;
  },
};
