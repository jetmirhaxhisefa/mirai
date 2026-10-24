import { EXIT } from '../exit-codes.js';
import { init } from '../../install/init.js';

// mirai init [--branch <name>] [--refresh] (units 10, 11). Installs MIRAI into this repo: the
// framework copy and its git rules, the config and context stub, the rendered files (MIRAI's
// blocks in AGENTS.md and CLAUDE.md, its skills and agents under .claude/), the lock, and the
// store in the MIRAI home. `--refresh` gives an installed repo this MIRAI's framework copy and
// renders everything again. It never commits, never writes under .git/ and never uses the
// network.
export default {
  name: 'init',
  summary: 'Install MIRAI into this repo',
  usage: 'mirai init [--branch <name>] [--refresh]',
  positionals: { min: 0, max: 0 },
  options: {
    branch: { type: 'string', description: 'the integration branch (default: the one .mirai/config.toml names, else the remote\'s default branch)' },
    refresh: { type: 'boolean', description: 'replace an installed framework copy with this MIRAI\'s, and render everything again' },
  },
  run(args, io) {
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
      ...(r.previous ? ['  2. mirai lint'] : ['  2. mirai key new   (once per machine; commit the public key it writes)', '  3. mirai lint']),
      '',
    ].join('\n'));
    return EXIT.OK;
  },
};
