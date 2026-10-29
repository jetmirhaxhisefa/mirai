import { EXIT } from '../exit-codes.js';
import { init } from '../../install/init.js';
import { join, joinPlan } from '../../install/join.js';
import { UsageError } from '../errors.js';
import { createPrompter, requireTty } from '../tty.js';

// mirai init [--branch <name>] [--refresh] (units 10, 11). Installs MIRAI into this repo: the
// framework copy and its git rules, the config and context stub, the rendered files (MIRAI's
// blocks in AGENTS.md and CLAUDE.md, its skills and agents under .claude/), the lock, and the
// store in the MIRAI home. `--refresh` gives an installed repo this MIRAI's framework copy and
// renders everything again. It never commits, never writes under .git/ and never uses the
// network.
export default {
  name: 'init',
  summary: 'Install MIRAI into this repo',
  usage: 'mirai init [--branch <name>] [--refresh | --join]',
  positionals: { min: 0, max: 0 },
  options: {
    branch: { type: 'string', description: 'the integration branch (default: the one .mirai/config.toml names, else the remote\'s default branch)' },
    refresh: { type: 'boolean', description: 'replace an installed framework copy with this MIRAI\'s, and render everything again' },
    join: { type: 'boolean', description: 'set up only this machine\'s store, for a repo where MIRAI is already committed; the repo isn\'t changed' },
  },
  async run(args, io) {
    if (args.values.join) {
      if (args.values.refresh) throw new UsageError('--join and --refresh don\'t go together', 'see: mirai init --help');
      // Joining pins the integration branch on this machine for good (the trust anchor for
      // signing keys), so you say yes to it, in a real terminal.
      const plan = joinPlan({ cwd: io.cwd, env: io.env, branch: args.values.branch });
      requireTty(io, 'mirai init --join');
      io.stdout.write(`This machine will trust ${plan.branch} as the integration branch of ${plan.root}\n  (from ${plan.from}).\n`);
      const prompter = createPrompter(io);
      let answer;
      try {
        answer = await prompter.ask('Type yes to set it up: ');
      } finally {
        prompter.close();
      }
      if (answer !== 'yes') {
        io.stdout.write('Nothing was set up.\n');
        return EXIT.NEEDS_HUMAN;
      }
      const r = join({ cwd: io.cwd, env: io.env, branch: plan.branch });
      io.stdout.write(`joined: this machine's store for ${r.root} is ${r.store}\nNext: mirai key new   (once per machine; commit the public key it writes)\n`);
      return EXIT.OK;
    }
    const r = init({ cwd: io.cwd, env: io.env, branch: args.values.branch, refresh: Boolean(args.values.refresh) });
    for (const w of r.warnings) io.stderr.write(`warning: ${w}\n`);
    io.stdout.write([
      r.previous ? `MIRAI ${r.version} is refreshed in ${r.root} (${r.previous !== r.version ? `was ${r.previous}` : r.sameCopy ? 'the framework copy was already this one' : 'same version, a different framework copy'})` : `MIRAI ${r.version} is installed in ${r.root}`,
      `  integration branch: ${r.branch} (from ${r.branchFrom})`,
      `  wrote: ${r.wrote.join(', ')} (${r.files} files in the lock)`,
      `  store: ${r.store}`,
      '',
      'Next:',
      `  1. Review these files and commit them on ${r.branch} (MIRAI never commits).`,
      ...(r.previous ? ['  2. mirai lint', '  3. mirai session-server install   (after the commit: MIRAI\'s tools in your own Claude Code sessions)']
        : ['  2. mirai key new   (once per machine; commit the public key it writes)', '  3. mirai lint', '  4. mirai session-server install   (after the commit: MIRAI\'s tools in your own Claude Code sessions)']),
      '',
    ].join('\n'));
    return EXIT.OK;
  },
};
