import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { shown } from '../../status/text.js';
import { openTrustRoot, snapshot, TrustError } from '../../trust/snapshot.js';
import { pinnedGitInfo, topLevel } from '../../store/git.js';

// MIRAI's own git on this checkout (unit 14b): which git, and the excludes file it honours.
function gitLines(io) {
  const g = pinnedGitInfo(topLevel(io.cwd), io.env);
  const excludes = g.excludes.path ? g.excludes.path : `none${g.excludes.problem ? ` (${g.excludes.problem})` : ''}`;
  return [`  git: ${g.binary}, pinned; repo config checked`, `  your global excludes: ${excludes}`];
}

// mirai trust snapshot | check (unit 12; D-15). `snapshot` builds the trust root from the
// integration branch's commit (or reuses it); `check` hashes it again, as every launch will.
export default {
  name: 'trust',
  summary: 'Build or check the trust root (MIRAI\'s files from the integration branch)',
  usage: 'mirai trust <snapshot|check>',
  positionals: { min: 1, max: 1 },
  options: {},
  run(args, io) {
    const [action] = args.positionals;
    if (!['snapshot', 'check'].includes(action)) throw new UsageError(`unknown action ${shown(action)}`, 'see: mirai trust --help');
    if (action === 'snapshot') {
      const t = snapshot({ cwd: io.cwd, env: io.env });
      io.stdout.write([
        `trust root for ${t.branch} at ${t.baseSha.slice(0, 12)}${t.reused ? ' (already made; hashed again)' : ''}`,
        `  folder: ${t.dir}`,
        `  files: ${t.manifest.files.length}, manifest ${t.manifestSha256.slice(0, 12)}`,
        ...gitLines(io),
        '',
      ].join('\n'));
      return EXIT.OK;
    }
    const t = openTrustRoot({ cwd: io.cwd, env: io.env });
    if (!t) throw new TrustError('there is no trust root for the integration branch\'s current commit', { code: 'no-trust-root', hint: 'run: mirai trust snapshot' });
    io.stdout.write([`trust root for ${t.branch} at ${t.baseSha.slice(0, 12)}: unchanged (${t.manifest.files.length} files)`, ...gitLines(io), ''].join('\n'));
    return EXIT.OK;
  },
};
