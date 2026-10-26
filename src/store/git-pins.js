import { execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';

// The pinned host git (unit 14a; D-54, research/09 §8 G15/G23): what MIRAI sets on every git
// call it makes on your machine, so a hostile `.git/config` (or one a test container wrote) can't
// run code through git. Unit 14a defined and probed it (test/probes/git-probes.js); since unit
// 14b every call in src/store/git.js uses it. Keys the pins can't switch off are refused by the
// repo check (src/store/repo-check.js) and watched by D-54's integrity hash
// (src/store/repo-state.js); research/11 lists which.
//
// No pin takes a value from the repo: every value is fixed here or (the excludes file) is your
// own global setting. Nothing is written for them: the hooks path and the global config are
// /dev/null (no hook can be found in it, and it reads as empty), and HOME is /var/empty, a folder
// macOS keeps empty and only root can write (unit 14b; 14a probed MIRAI-owned empty folders,
// which needed writes into the MIRAI home on every read-only command).

export const PINNED = Object.freeze({ hooks: '/dev/null', globalConfig: '/dev/null', home: '/var/empty' });

// The `-c` pins, in the order git gets them (command-line config is read last, so it wins over
// every config file for a single-valued key; an empty value resets a list such as
// credential.helper). `excludesFile` is your global excludes file (excludesFor), or empty.
export function pinArgs({ excludesFile = '' } = {}) {
  const pins = [
    ['core.hooksPath', PINNED.hooks],
    ['core.fsmonitor', 'false'],
    ['core.sshCommand', '/usr/bin/false'],
    ['core.askPass', ''],
    ['core.pager', 'cat'],
    ['core.editor', '/usr/bin/false'],
    ['sequence.editor', '/usr/bin/false'],
    ['core.excludesFile', excludesFile],
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
export function pinEnv({ path = '/usr/bin:/bin', top = null } = {}) {
  return {
    ...(top ? { GIT_DIR: join(top, '.git'), GIT_WORK_TREE: top } : {}),
    PATH: path,
    HOME: PINNED.home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: PINNED.globalConfig,
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

// Your global excludes file (`core.excludesFile` in your global git config, or git's default
// ~/.config/git/ignore), for the excludes pin: unit 10's ignore checks and MIRAI's file lists
// keep honouring it. It holds patterns only, so it runs nothing. Read once per process with your
// HOME and nothing pinned but the system config. Returns { path, problem }: path is '' when there
// is none or it can't be used (not absolute, not a file, or inside the checkout `top`).
const excludesCache = new Map();

export function excludesFor(env, top, gitBinary) {
  const key = `${env.HOME}\0${env.XDG_CONFIG_HOME ?? ''}`;
  if (!excludesCache.has(key)) excludesCache.set(key, readExcludesPath(env, gitBinary));
  const found = excludesCache.get(key);
  if (!found.path) return found;
  let real;
  try {
    if (!statSync(found.path).isFile()) return { path: '', problem: `${found.path} is not a file` };
    real = realpathSync.native(found.path);
  } catch {
    return { path: '', problem: null }; // none there: nothing to honour
  }
  // The disk's own spelling of both, so another case of the same folder can't pass (14b review).
  const topReal = realpathSync.native(top);
  if (real.toLowerCase() === topReal.toLowerCase() || real.toLowerCase().startsWith((topReal + sep).toLowerCase())) return { path: '', problem: `${found.path} is inside the checkout, so MIRAI doesn't use it` };
  return { path: real, problem: null };
}

function readExcludesPath(env, gitBinary) {
  const xdg = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : null;
  let configured = '';
  try {
    configured = execFileSync(gitBinary, ['config', '--global', '--type=path', '--get', 'core.excludesFile'], {
      cwd: '/',
      env: { PATH: '/usr/bin:/bin', HOME: env.HOME, GIT_CONFIG_NOSYSTEM: '1', ...(xdg ? { XDG_CONFIG_HOME: xdg } : {}) },
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    configured = ''; // not set (exit 1), or no global config
  }
  const path = configured || join(xdg ?? join(env.HOME, '.config'), 'git', 'ignore');
  if (!isAbsolute(path)) return { path: '', problem: `core.excludesFile (${configured}) is not an absolute path` };
  return { path, problem: null };
}
