import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { requireTty } from '../tty.js';
import { globalConfigPath } from '../../config/load.js';
import { plain, shown } from '../../status/text.js';
import { DEFAULT_MAX_TURNS, OUTCOME_EXIT, runAgent } from '../../agent/run.js';

// mirai agent run --mode read-write|read-only --prompt-file <file> [--tier t] [--item id]
// [--max-turns n] (unit 19a; D-12). Starts one agent, unattended, in this checkout, in MIRAI's
// cage, using your subscription. Your terminal only for now: nothing sandboxed runs `mirai`, and
// the broker's way in is unit 19c. Refused unless the red team is green for that template.
export default {
  name: 'agent',
  summary: 'Start one agent in MIRAI\'s cage, in your terminal',
  usage: 'mirai agent run --mode <read-write|read-only> --prompt-file <file> [--tier <light|standard|deep>] [--item <id>] [--max-turns <n>]',
  positionals: { min: 1, max: 1 },
  options: {
    mode: { type: 'string', description: 'read-write or read-only' },
    'prompt-file': { type: 'string', description: 'the file holding what the agent is asked' },
    tier: { type: 'string', description: 'which of your configured models (default standard)' },
    item: { type: 'string', description: 'the ticket or document the run is for' },
    'max-turns': { type: 'string', description: `at most this many turns (default ${DEFAULT_MAX_TURNS})` },
  },
  async run(args, io) {
    const [action] = args.positionals;
    if (action !== 'run') throw new UsageError(`unknown action ${shown(action)}`, 'see: mirai agent --help');
    requireTty(io, 'mirai agent run');
    const { mode, tier = 'standard', item = null } = args.values;
    if (!['read-write', 'read-only'].includes(mode)) throw new UsageError('--mode is read-write or read-only');
    if (!['light', 'standard', 'deep'].includes(tier)) throw new UsageError('--tier is light, standard or deep');
    if (!args.values['prompt-file']) throw new UsageError('--prompt-file names what the agent is asked');
    const turns = args.values['max-turns'] === undefined ? DEFAULT_MAX_TURNS : Number(args.values['max-turns']);
    if (!Number.isInteger(turns) || turns < 1 || turns > 500) throw new UsageError('--max-turns is a whole number from 1 to 500');
    let prompt;
    try {
      prompt = readFileSync(resolve(io.cwd, args.values['prompt-file']), 'utf8');
    } catch {
      throw new UsageError(`can't read ${shown(args.values['prompt-file'])}`);
    }
    if (!/\S/.test(prompt) || prompt.length > 200_000 || prompt.includes('\0')) throw new UsageError('the prompt must be text of at most 200,000 characters');
    const abort = new AbortController();
    const hard = new AbortController();
    // A second Ctrl-C doesn't wait for cleanup.
    const onInt = () => (abort.signal.aborted ? hard.abort() : abort.abort());
    const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    for (const sig of SIGNALS) process.on(sig, onInt);
    try {
      const r = await runAgent({ cwd: io.cwd, env: io.env, mode, tier, item, prompt, maxTurns: turns, signal: abort.signal, hardSignal: hard.signal, plan: planFrom(io.env), ...(io.claude ? { claude: io.claude } : {}), ...(io.redTeamStatus ? { status: io.redTeamStatus } : {}) });
      if (r.text) io.stdout.write(`${plain(r.text).replace(/\\u000a/g, '\n')}\n`);
      io.stdout.write(`\nagent run ${r.launchId}: ${r.outcome}${r.why ? `: ${plain(r.why)}` : ''}\n  ${r.line.model}, ${r.line.turns} turns, ${r.line.minutes} min, ${r.line.tokens_in + r.line.tokens_out} tokens; stream kept in the store\n`);
      if (r.tookOver) io.stdout.write(`  note: ${plain(r.tookOver)}\n`);
      if (r.processes.survivors.length) io.stdout.write(`  WARNING: ${r.processes.survivors.length} of its processes outlived the end: ${r.processes.survivors.join(', ')}\n`);
      if (r.processes.suspects?.length) io.stdout.write(`  new processes working in your project, maybe the agent's, left alone: ${r.processes.suspects.map(plain).join(', ')}\n`);
      if (r.processes.unproven.length) io.stdout.write(`  new orphan processes during the run, not proven to be its, left alone: ${r.processes.unproven.map(plain).join(', ')}\n`);
      return OUTCOME_EXIT[r.outcome] ?? EXIT.FAILURE;
    } finally {
      for (const sig of SIGNALS) process.removeListener(sig, onInt);
    }
  },
};

// Your plan from your global config (D-57), for the record; `unknown` when it can't be read.
function planFrom(env) {
  try {
    const file = globalConfigPath(env.HOME);
    return /^\s*plan\s*=\s*"([a-z0-9][a-z0-9-]{0,31})"/m.exec(readFileSync(file, 'utf8'))?.[1] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
