import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join as joinPath } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { PROJECT_CONFIG } from '../config/load.js';
import { parseToml } from '../config/toml.js';
import { blobAt, commitOf, remotes, topLevel } from '../store/git.js';
import { createStore, openStore } from '../store/home.js';
import { LOCK_FILE } from './lock.js';

// `mirai init --join` (unit 12b): sets up this machine's store for a repo where MIRAI is already
// installed and committed (a teammate's fresh clone, or your new machine), without touching the
// repo. The integration branch is what the config committed on that branch names; the command
// shows it to you for a yes first (the same first trust step `init` takes), and the store then
// pins it for good.

const CONFIG_FILE = PROJECT_CONFIG.split('\\').join('/');

// What joining would pin, without doing it: { root, branch, from }.
export function joinPlan({ cwd, env, branch: wanted }) {
  const top = topLevel(cwd, env);
  if (!top) throw new MiraiError('this folder is not inside a git repository', EXIT.BLOCKED);
  const root = realpathSync(top);
  if (!existsSync(joinPath(root, LOCK_FILE))) throw Object.assign(new MiraiError('MIRAI isn\'t installed in this repo, so there is nothing to join', EXIT.BLOCKED), { code: 'not-installed', hint: 'run: mirai init' });
  if (openStore({ cwd: root, env, optional: true })) throw Object.assign(new MiraiError('this machine already has a MIRAI store for this repo', EXIT.BLOCKED), { code: 'joined', hint: 'nothing to do' });
  const local = readBranch(joinPath(root, CONFIG_FILE));
  const branch = wanted ?? local;
  if (!branch) throw Object.assign(new MiraiError(`${CONFIG_FILE} names no integration branch`, EXIT.CONFIG), { code: 'no-branch' });
  // The branch's own committed config must name it: a branch can't nominate itself.
  const all = remotes(root, env);
  const remote = all.has('origin') ? 'origin' : all.size === 1 ? [...all.keys()][0] : null;
  const ref = commitOf(root, `refs/heads/${branch}`, env) ? `refs/heads/${branch}` : remote && commitOf(root, `refs/remotes/${remote}/${branch}`, env) ? `refs/remotes/${remote}/${branch}` : null;
  if (!ref) throw Object.assign(new MiraiError(`there is no branch "${branch}" here${remote ? ` or on ${remote}` : ''}`, EXIT.BLOCKED), { code: 'no-branch', hint: 'fetch it first: git fetch' });
  const committed = blobAt(root, ref, CONFIG_FILE, env);
  const named = committed ? readBranch(null, committed.toString('utf8')) : null;
  if (named !== branch) {
    throw Object.assign(new MiraiError(`the config committed on ${branch} names ${named ? `"${named}"` : 'no branch'} as the integration branch, not "${branch}"`, EXIT.BLOCKED), { code: 'branch-mismatch', hint: 'join on the branch the committed config names' });
  }
  if (local !== branch) {
    throw Object.assign(new MiraiError(`your work tree's ${CONFIG_FILE} names "${local}", not "${branch}"`, EXIT.BLOCKED), { code: 'branch-mismatch', hint: `check out ${branch} (or a branch whose config names it), then join` });
  }
  return { root, branch, from: `${CONFIG_FILE} committed on ${ref.replace(/^refs\/(heads|remotes)\//, '')}` };
}

// Creates the store the plan describes. Returns { root, branch, store }.
export function join({ cwd, env, branch, now = () => new Date() }) {
  const plan = joinPlan({ cwd, env, branch });
  const store = createStore({ cwd: plan.root, env, now });
  return { ...plan, store: store.repoHome };
}

// The integration branch a config names (from its file, or its text), or null.
function readBranch(path, text) {
  try {
    const source = text ?? (existsSync(path) ? readFileSync(path, 'utf8') : '');
    const b = parseToml(source, { source: CONFIG_FILE })?.git?.integration_branch;
    return typeof b === 'string' ? b : null;
  } catch {
    return null;
  }
}
