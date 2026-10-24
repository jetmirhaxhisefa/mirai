import { EXIT } from '../exit-codes.js';
import { init } from '../../install/init.js';

// mirai init [--branch <name>] (unit 10). Installs MIRAI into this repo: the framework copy and
// its git rules, the config and context stub, MIRAI's block in AGENTS.md, the lock, and the
// store in the MIRAI home. It never commits, never writes under .git/ and never uses the network.
export default {
  name: 'init',
  summary: 'Install MIRAI into this repo',
  usage: 'mirai init [--branch <name>]',
  positionals: { min: 0, max: 0 },
  options: {
    branch: { type: 'string', description: 'the integration branch (default: the one .mirai/config.toml names, else the remote\'s default branch)' },
  },
  run(args, io) {
    const r = init({ cwd: io.cwd, env: io.env, branch: args.values.branch });
    for (const w of r.warnings) io.stderr.write(`warning: ${w}\n`);
    io.stdout.write([
      `MIRAI ${r.version} is installed in ${r.root}`,
      `  integration branch: ${r.branch} (from ${r.branchFrom})`,
      `  wrote: ${r.wrote.join(', ')} (${r.files} files in the lock)`,
      `  store: ${r.store}`,
      '',
      'Next:',
      `  1. Review these files and commit them on ${r.branch} (MIRAI never commits).`,
      '  2. mirai key new   (once per machine; commit the public key it writes)',
      '  3. mirai lint',
      '',
    ].join('\n'));
    return EXIT.OK;
  },
};
