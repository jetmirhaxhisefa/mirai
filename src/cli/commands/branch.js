import { EXIT } from '../exit-codes.js';
import { MiraiError, UsageError } from '../errors.js';
import { shown } from '../../status/text.js';
import { verifyBranchAt } from '../../store/branch-record.js';
import { BRANCH_NAME, symbolicBranch } from '../../store/git.js';
import { openStore } from '../../store/home.js';
import { branchKeys } from '../../sign/keys.js';

// mirai branch verify [<branch>] (unit 22; R3-M10): checks a branch's record
// (.mirai/records/<ticket>/branch.json) with the integration branch's public keys, and that it's the
// branch's first commit after its base, as CI will. The current branch by default.
export default {
  name: 'branch',
  summary: 'Check a MIRAI branch\'s signed record',
  usage: 'mirai branch verify [<branch>]',
  positionals: { min: 1, max: 2 },
  options: {},
  run(args, io) {
    const [action, given] = args.positionals;
    if (action !== 'verify') throw new UsageError(`unknown action ${shown(action)}`, 'see: mirai branch --help');
    const store = openStore({ cwd: io.cwd, env: io.env });
    const branch = given ?? symbolicBranch(store.checkout, 'HEAD', store.gitEnv);
    if (!branch) throw new UsageError('HEAD is on no branch: name one');
    if (!BRANCH_NAME.test(branch)) throw new UsageError(`${shown(branch)} isn't a branch name MIRAI uses`);
    const v = verifyBranchAt({ root: store.checkout, env: store.gitEnv, branch, keys: branchKeys(store.checkout, store.branch, store.gitEnv), repoId: store.repoId });
    if (!v.ok) throw new MiraiError(`${branch}'s record doesn't verify: ${v.reason}`, EXIT.FAILURE);
    io.stdout.write(`${branch}: MIRAI's branch for ${v.record.ticket}, from ${v.record.base_sha.slice(0, 12)}, signed with ${v.keyId}\n`);
    return EXIT.OK;
  },
};
