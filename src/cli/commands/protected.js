import { realpathSync } from 'node:fs';

import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { shown } from '../../status/text.js';
import { commitOf, topLevel } from '../../store/git.js';
import { snapshot, trustedConfig, trustedRegistry } from '../../trust/snapshot.js';
import { changeOf, classify, protectionRules } from '../../trust/protected.js';

// mirai protected [<base>..<head>] (unit 12; D-15). Lists the protected paths a change touches,
// with their class and rule, using the rules from the trust root (never the work tree's). The
// default change is your work tree against where it left the integration branch's commit.
export default {
  name: 'protected',
  summary: 'List the protected paths a change touches',
  usage: 'mirai protected [<base>..<head> | <base>...<head>]',
  positionals: { min: 0, max: 1 },
  options: {},
  run(args, io) {
    const trust = snapshot({ cwd: io.cwd, env: io.env });
    const root = trustedRoot(io);
    let base = trust.baseSha;
    let head;
    if (args.positionals[0] !== undefined) {
      // Both forms measure the branch from where it left the base (as `git diff a...b`).
      const m = /^([^.\s][^\s]*?)\.\.\.?([^.\s][^\s]*)$/.exec(args.positionals[0]);
      if (!m) throw new UsageError(`${shown(args.positionals[0])} is not a range such as main..my-branch`, 'see: mirai protected --help');
      base = commitOf(root, m[1], io.env);
      head = commitOf(root, m[2], io.env);
      if (!base || !head) throw new UsageError(`${shown(!base ? m[1] : m[2])} is not a commit here`, 'see: mirai protected --help');
    }
    const rules = protectionRules(trustedRegistry(trust), trustedConfig(trust));
    const result = classify({ change: changeOf({ root, env: io.env, base, head, rules }), rules });
    // Ignored files under protected paths aren't part of any branch, so they're shown apart.
    const ignored = result.ignoredPresent.length ? `ignored by git, under protected paths (not part of the change): ${result.ignoredPresent.map(shown).join(', ')}\n` : '';
    if (!result.touched.length) {
      io.stdout.write(`no protected paths touched\n${ignored}`);
      return EXIT.OK;
    }
    for (const t of result.touched) io.stdout.write(`${t.class.padEnd(9)}  ${shown(t.path)}  (${t.rules.join(', ')})\n`);
    io.stdout.write(`risk: high${result.autoRun.length ? `; ${result.autoRun.length} run by themselves: read them on the host before you open the branch in your IDE` : ''}\n${ignored}`);
    return EXIT.OK;
  },
};

// The repo's top folder (snapshot() already refused a folder outside a repo).
const trustedRoot = (io) => realpathSync(topLevel(io.cwd, io.env));
