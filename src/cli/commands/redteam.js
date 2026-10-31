import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { createPrompter, requireTty } from '../tty.js';
import { shown } from '../../status/text.js';
import { openStore } from '../../store/home.js';
import { snapshot, trustedStrict } from '../../trust/snapshot.js';
import { caseIndex } from '../../redteam/cases.js';
import { templateNames } from '../../redteam/key.js';
import { DEFAULTS, redTeamStatus, runRedTeam } from '../../redteam/run.js';
import { NEXT, partsText, report } from '../../redteam/report.js';
import { listResults, readResult } from '../../redteam/store.js';

// mirai redteam run [--only <id,…>] | status | show [<key>] (unit 18a). `run` is yours alone: it
// needs a real terminal and your yes, since it uses your Claude subscription; agents can't run
// `mirai` at all. `status` says whether this machine's result is green for what's installed now
// (exit 0) or not (exit 5); `show` prints a stored result.

// About how long one case run takes (18a's probes: a median of 7 to 8 s), for the estimate.
const SECONDS_PER_RUN = 8;

function estimate(cases, templates, only) {
  let units = 0;
  for (const k of cases) if (!only || only.includes(k.id)) units += k.templates.filter((t) => templates.includes(t)).length;
  const runs = units * DEFAULTS.runs;
  return { units, runs, minutes: Math.ceil((runs * SECONDS_PER_RUN) / DEFAULTS.workers / 60) };
}

export default {
  name: 'redteam',
  summary: 'Run the red-team checks that every unattended agent launch needs, or show where they stand',
  usage: 'mirai redteam run [--only <id,…>] | mirai redteam status | mirai redteam show [<key>]',
  positionals: { min: 1, max: 2 },
  options: {
    only: { type: 'string', description: 'run only these cases (comma-separated ids); a partial run is reported, never recorded' },
  },
  async run(args, io) {
    const [action, arg] = args.positionals;
    const only = args.values.only !== undefined ? args.values.only.split(',').map((s) => s.trim()).filter(Boolean) : null;
    if (action !== 'run' && only) throw new UsageError('--only is for run');

    if (action === 'show') {
      const store = openStore({ cwd: io.cwd, env: io.env });
      const keys = listResults(store);
      if (arg !== undefined && !/^[0-9a-f]{12,64}$/.test(arg)) throw new UsageError(`${shown(arg)} isn't a result key`, 'give at least 12 characters of one (mirai redteam status shows the current one)');
      const key = arg === undefined ? keys[0] : keys.find((k) => k.startsWith(arg));
      if (!key) {
        io.stdout.write(arg === undefined ? 'no red-team result here yet; run one with: mirai redteam run\n' : `no result ${arg}\n`);
        return EXIT.FAILURE;
      }
      io.stdout.write(report(readResult(store, key)));
      return EXIT.OK;
    }
    if (action === 'status') {
      if (arg !== undefined) throw new UsageError('status takes no argument');
      const s = await redTeamStatus({ cwd: io.cwd, env: io.env, ...(io.docker ? { dockerVersion: io.docker.version } : {}), ...(io.claude ? { claude: io.claude } : {}) });
      const lines = [`red team: ${s.state}${s.result && s.state !== 'stale' ? ` (${s.result.created_at})` : ''}`, '', `this machine now (key ${s.key.slice(0, 16)}):`, ...partsText(s.parts)];
      if (s.state === 'stale') lines.push('', `changed since the last ${s.result.state === 'green' ? 'green ' : ''}result: ${s.changed.join(', ')}`);
      if (s.blocker_seen && s.state !== 'blocker') lines.push('', `a red-team run on this Claude Code and macOS found a blocker (${s.blocker_seen.created_at}): V1's condition was met once; see mirai redteam show ${s.blocker_seen.key.slice(0, 12)}`);
      lines.push('', `next: ${NEXT[s.state]}`, '');
      io.stdout.write(lines.join('\n'));
      return s.state === 'green' ? EXIT.OK : EXIT.NEEDS_HUMAN;
    }
    if (action !== 'run') throw new UsageError(`unknown action ${shown(action)}`, 'see: mirai redteam --help');
    if (arg !== undefined) throw new UsageError('run takes no argument; use --only <id,…>');

    requireTty(io, 'mirai redteam run');
    const trust = snapshot({ cwd: io.cwd, env: io.env });
    const templates = templateNames(trust);
    for (const t of templates) trustedStrict(trust, t);
    const cases = caseIndex();
    const unknown = (only ?? []).filter((id) => !cases.some((k) => k.id === id));
    if (unknown.length) throw new UsageError(`no case named ${unknown.map(shown).join(', ')}`, `the cases: ${cases.map((k) => k.id).join(', ')}`);
    const e = estimate(cases, templates, only);
    io.stdout.write([
      `The red team runs ${e.units} cases (${templates.join(', ')}) ${DEFAULTS.runs} times each: about ${e.runs} short runs`,
      `of Claude Code (${DEFAULTS.model}), ${DEFAULTS.workers} at a time, roughly ${e.minutes} minutes. It uses your Claude subscription.`,
      'It works in clones of your integration branch under your home folder, with canary secrets, and a',
      'canary keychain item and git credential it removes afterwards. Your checkout isn\'t touched.',
      'Two cases try to reach Terminal (open, osascript): if macOS asks whether to allow that, answer no.',
      '',
    ].join('\n'));
    const prompter = createPrompter(io);
    let answer;
    try {
      answer = await prompter.ask('Run it now? [y/N] ');
    } finally {
      prompter.close();
    }
    if (!/^y(es)?$/i.test(answer)) {
      io.stdout.write('nothing was run\n');
      return EXIT.OK;
    }
    const abort = new AbortController();
    const onInt = () => abort.abort();
    const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    for (const sig of SIGNALS) process.on(sig, onInt);
    try {
      const { result, recorded, partial } = await runRedTeam({
        cwd: io.cwd, env: io.env, consent: true, only, signal: abort.signal,
        onEvent: (ev) => {
          if (ev.type === 'run') io.stderr.write(`${ev.id} (${ev.template}) run ${ev.n}: ${ev.outcome}\n`);
        },
      });
      io.stdout.write(report(result, { recorded, partial }));
      return result.state === 'green' && recorded ? EXIT.OK : EXIT.NEEDS_HUMAN;
    } finally {
      for (const sig of SIGNALS) process.removeListener(sig, onInt);
    }
  },
};
