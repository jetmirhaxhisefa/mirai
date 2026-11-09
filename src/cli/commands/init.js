import { join as joinPath } from 'node:path';

import { EXIT } from '../exit-codes.js';
import { alreadyForwarded, existingHooks, installHooks } from '../../hooks/install.js';
import { init } from '../../install/init.js';
import { PACKAGE_ROOT } from '../../install/parts.js';
import { openStore } from '../../store/home.js';
import { join, joinPlan } from '../../install/join.js';
import { UsageError } from '../errors.js';
import { createPrompter, requireTty } from '../tty.js';

// mirai init [--branch <name>] [--refresh] (units 10, 11). Installs MIRAI into this repo: the
// framework copy and its git rules, the config and context stub, the rendered files (MIRAI's
// blocks in AGENTS.md and CLAUDE.md, its skills and agents under .claude/), the lock, and the
// store in the MIRAI home. `--refresh` gives an installed repo this MIRAI's framework copy and
// renders everything again. Then (unit 26a) MIRAI's git hooks: the hooks folder in the MIRAI home
// and `core.hooksPath` in .git/config, the only thing it writes under .git/. It never commits and
// never uses the network.
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
      io.stdout.write(`joined: this machine's store for ${r.root} is ${r.store}\n`);
      await reportHooks(io, r.root);
      io.stdout.write('Next: mirai key new   (once per machine; commit the public key it writes)\n');
      return EXIT.OK;
    }
    const r = init({ cwd: io.cwd, env: io.env, branch: args.values.branch, refresh: Boolean(args.values.refresh) });
    for (const w of r.warnings) io.stderr.write(`warning: ${w}\n`);
    const hooks = await setUpHooks(io, r.root, io.hookPaths ?? {});
    io.stdout.write([
      r.previous ? `MIRAI ${r.version} is refreshed in ${r.root} (${r.previous !== r.version ? `was ${r.previous}` : r.sameCopy ? 'the framework copy was already this one' : 'same version, a different framework copy'})` : `MIRAI ${r.version} is installed in ${r.root}`,
      `  integration branch: ${r.branch} (from ${r.branchFrom})`,
      `  wrote: ${r.wrote.join(', ')} (${r.files} files in the lock)`,
      `  store: ${r.store}`,
      ...(hooks.installed ? [hooksLine(hooks)] : []),
      '',
      'Next:',
      `  1. Review these files and commit them on ${r.branch} (MIRAI never commits).`,
      ...(r.previous ? ['  2. mirai lint', '  3. mirai baseline   (on the integration branch, after the commit: a build is judged against it)', '  4. mirai session-server install   (after the commit: MIRAI\'s tools in your own Claude Code sessions)']
        : ['  2. mirai key new   (once per machine; commit the public key it writes)', '  3. mirai lint', '  4. mirai session-server install   (after the commit: MIRAI\'s tools in your own Claude Code sessions)']),
      '',
    ].join('\n'));
    if (!hooks.installed) io.stderr.write(hooksWarning(hooks));
    return EXIT.OK;
  },
};

// MIRAI's hooks (unit 26a): installed, forwarding to the repo's own hooks after your yes (Jet's
// decision 7). A no, or no terminal to ask in, leaves them off: MIRAI then starts no agents
// (hooks-off) until `mirai init --refresh` installs them.
export async function setUpHooks(io, root, { node = process.execPath, launcher = joinPath(PACKAGE_ROOT, 'bin', 'launch.js') } = {}) {
  const store = openStore({ cwd: root, env: io.env });
  const found = existingHooks({ store, env: io.env });
  let forward = null;
  if (found.names.length) {
    forward = { from: found.from, names: found.names };
    if (!alreadyForwarded(found)) {
      const list = `${found.names.join(', ')} (in ${found.from})`;
      if (!(io.stdin?.isTTY === true && io.stdout?.isTTY === true)) return { installed: false, why: `this repo has its own git hooks: ${list}; forwarding them needs your yes, in a terminal` };
      io.stdout.write(`This repo has its own git hooks: ${list}.\nMIRAI's hooks folder replaces the repo's (core.hooksPath), so MIRAI would forward each of these to it and they run as before; your pre-push runs first, then MIRAI's check.\n`);
      const prompter = createPrompter(io);
      let answer;
      try {
        answer = await prompter.ask('Type yes to forward them: ');
      } finally {
        prompter.close();
      }
      if (answer !== 'yes') return { installed: false, why: 'you didn\'t say yes to forwarding the repo\'s own hooks' };
    }
  }
  const r = installHooks({ store, env: io.env, node, launcher, forward });
  return { installed: true, dir: r.dir, forwarded: forward?.names ?? [] };
}

const hooksLine = (h) => `  hooks: pre-push in ${h.dir} (core.hooksPath)${h.forwarded.length ? `; forwarding ${h.forwarded.join(', ')}` : ''}`;
const hooksWarning = (h) => `warning: MIRAI's pre-push hook isn't installed: ${h.why}. MIRAI starts no agents until it is: run mirai init --refresh in a terminal\n`;

async function reportHooks(io, root) {
  const h = await setUpHooks(io, root, io.hookPaths ?? {});
  if (h.installed) io.stdout.write(`${hooksLine(h)}\n`);
  else io.stderr.write(hooksWarning(h));
}
