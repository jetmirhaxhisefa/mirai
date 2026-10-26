import { join } from 'node:path';

// The pinned host git (unit 14a; D-54, research/09 §8 G15/G23): what MIRAI sets on every git
// call it makes on your machine, so a hostile `.git/config` (or one a test container wrote) can't
// run code through git. Unit 14a only defines it and probes it (test/probes/git-probes.js); 14b
// wires it into src/store/git.js. Keys the pins can't switch off are caught by D-54's integrity
// hash instead (research/11 lists which).
//
// No pin takes a value from the repo: every value is fixed here or is a path MIRAI owns.
// `dir` is a MIRAI-owned folder holding an empty `hooks/` folder and an empty `gitconfig` file.

export const PIN_DIRS = Object.freeze({ hooks: 'hooks', globalFile: 'gitconfig', home: 'home' });

// The `-c` pins, in the order git gets them (command-line config is read last, so it wins over
// every config file for a single-valued key; an empty value resets a list such as
// credential.helper).
export function pinArgs(dir) {
  const pins = [
    ['core.hooksPath', join(dir, PIN_DIRS.hooks)],
    ['core.fsmonitor', 'false'],
    ['core.sshCommand', '/usr/bin/false'],
    ['core.askPass', ''],
    ['core.pager', 'cat'],
    ['core.editor', '/usr/bin/false'],
    ['sequence.editor', '/usr/bin/false'],
    ['core.excludesFile', ''],
    ['core.attributesFile', '/dev/null'],
    ['credential.helper', ''],
    // The plain key only: a URL-scoped `http.<url>.proxy` in the repo config still wins (14a
    // review), so 14b refuses `http.*` in the repo config.
    ['http.proxy', ''],
    // Empty: a plain `git diff` then fails ("cannot run"), so DIFF_FLAGS are mandatory on every
    // diff, show and log -p.
    ['diff.external', ''],
    ['protocol.allow', 'never'],
    ['protocol.file.allow', 'always'],
    ['protocol.https.allow', 'always'],
    ['protocol.ext.allow', 'never'],
    ['commit.gpgSign', 'false'],
    ['tag.gpgSign', 'false'],
    ['push.gpgSign', 'false'],
    ['gpg.program', '/usr/bin/false'],
    // Git picks the verifier from the signature block, not from gpg.format (14a review: an ssh
    // signature on a merged commit ran gpg.ssh.program).
    ['gpg.openpgp.program', '/usr/bin/false'],
    ['gpg.ssh.program', '/usr/bin/false'],
    ['gpg.x509.program', '/usr/bin/false'],
    ['merge.verifySignatures', 'false'],
    ['log.showSignature', 'false'],
    // Nested repos: an outer status or diff would otherwise look inside them, with their own
    // config (filters) (14a review).
    ['diff.ignoreSubmodules', 'all'],
    ['submodule.recurse', 'false'],
    ['push.recurseSubmodules', 'no'],
    ['fetch.recurseSubmodules', 'no'],
    ['status.submoduleSummary', 'false'],
    // Output MIRAI reads: every untracked file listed, plain diffs (14a review: a repo could
    // hide new files from status or colour and re-prefix diffs).
    ['status.showUntrackedFiles', 'all'],
    ['color.ui', 'never'],
    ['diff.noprefix', 'false'],
    ['diff.mnemonicPrefix', 'false'],
    ['diff.relative', 'false'],
    ['core.quotePath', 'false'],
  ];
  return pins.flatMap(([k, v]) => ['-c', `${k}=${v}`]);
}

// The environment for every host git call: nothing inherited but what's named here. With `top`
// (the checkout's top folder, from MIRAI's own record), the repo is named outright, so a
// `core.worktree` in its config can't move the work tree. It doesn't stop a `.git` that is a file
// pointing elsewhere, or a `.git/commondir`: git follows both (14a review), so 14b checks them.
export function pinEnv(dir, { path = '/usr/bin:/bin', top = null } = {}) {
  return {
    ...(top ? { GIT_DIR: join(top, '.git'), GIT_WORK_TREE: top } : {}),
    PATH: path,
    HOME: join(dir, PIN_DIRS.home),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(dir, PIN_DIRS.globalFile),
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_ATTR_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/usr/bin/false',
    SSH_ASKPASS: '/usr/bin/false',
    GIT_SSH_COMMAND: '/usr/bin/false',
    GIT_EDITOR: '/usr/bin/false',
    GIT_SEQUENCE_EDITOR: '/usr/bin/false',
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    GIT_ALLOW_PROTOCOL: 'file:https',
    GIT_PROTOCOL_FROM_USER: '0',
    LANG: 'C',
    LC_ALL: 'C',
  };
}

// Flags for the commands that would otherwise run a diff driver or a textconv filter.
export const DIFF_FLAGS = Object.freeze(['--no-ext-diff', '--no-textconv', '--no-color']);
