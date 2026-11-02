import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ConfigError, MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { loadCustomRoles } from '../config/registry.js';
import { configValue, hiddenFromStatus, ignoredNames, workTreeChanges } from '../store/git.js';
import { trustedRegistry } from '../trust/snapshot.js';
import { included } from '../util/glob.js';

// What a run may have changed (unit 19b; D-37, TL2-6). Roles are data, from the trust root: the
// registry's and the project's own (.mirai/custom/roles/), so a branch can't widen one. After a
// run, every changed path is checked against its role: tracked and new files from pinned git
// against `may_write.paths`, and ignored files, from a fingerprint taken just before the launch,
// against `may_write.ignored` (empty by default, for every role: 19b's R1 showed a read-write
// agent's Bash writing node_modules/.bin, which git never shows and which runs later). `!`
// excludes, as everywhere in MIRAI's globs. Nothing is undone: the files stay for you to look at
// (unit 22 reverts).

export const IGNORED_ENTRY_BUDGET = 200_000;

export function trustedRoles(trust) {
  const core = trustedRegistry(trust).roles ?? {};
  try {
    return { ...core, ...loadCustomRoles(join(trust.dir, 'tree', '.mirai', 'custom'), core) };
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    const first = (err.errors ?? []).slice(0, 3).map((e) => `${e.source}:${e.line}: ${e.reason}`).join('; ');
    throw Object.assign(new MiraiError(`${err.message}: ${first}`, EXIT.CONFIG), { code: 'bad-role' });
  }
}

export function findRole(roles, name) {
  if (Object.hasOwn(roles, name)) return roles[name];
  throw Object.assign(new MiraiError(`there's no role ${JSON.stringify(String(name).slice(0, 40))}; roles: ${Object.keys(roles).sort().join(', ')}`, EXIT.USAGE), { code: 'unknown-role' });
}

// Tracked files git doesn't look at (assume-unchanged, skip-worktree) would hide a change from the
// check, so a launch with any is refused. A sparse checkout marks every file outside it so.
export function checkNothingHidden(root, env) {
  if (configValue(root, 'core.sparseCheckout', env) === 'true') {
    throw Object.assign(new MiraiError('this checkout is sparse, so git doesn\'t look at most files and a change there couldn\'t be seen', EXIT.BLOCKED), { code: 'sparse-checkout', hint: 'agent runs need a full checkout' });
  }
  const hidden = hiddenFromStatus(root, env);
  if (hidden.length) {
    throw Object.assign(new MiraiError(`${hidden.length} tracked file(s) are marked so git doesn't look at them (such as ${hidden[0]}), so a change there couldn't be seen`, EXIT.BLOCKED), { code: 'hidden-files', hint: 'git update-index --no-assume-unchanged --no-skip-worktree <file>' });
  }
}

// Every ignored file and link of the work tree, by size, inode and times, at most
// IGNORED_ENTRY_BUDGET entries; past it the look is `partial`, and a launch refuses before it
// starts. Stat only: the sample app's 8,952 ignored files took about half a second, 52,000 about
// 0.7 s. A folder that can't be read is named as such, and refuses a launch too: an edit inside it
// changes nothing that can be seen from outside.
export function ignoredState(root, env) {
  const budget = { left: IGNORED_ENTRY_BUDGET, over: false };
  // No prototype: a file named __proto__ is a file like any other.
  const state = Object.create(null);
  const walk = (rel) => {
    if (--budget.left < 0) {
      budget.over = true;
      return;
    }
    let st;
    try {
      st = lstatSync(join(root, rel));
    } catch {
      return;
    }
    if (st.isSymbolicLink()) {
      state[rel] = `link:${readlinkSync(join(root, rel))}`;
      return;
    }
    if (!st.isDirectory()) {
      state[rel] = `${st.mode}:${st.size}:${st.ino}:${st.mtimeMs}:${st.ctimeMs}`;
      return;
    }
    let names;
    try {
      names = readdirSync(join(root, rel));
    } catch {
      state[rel] = `unreadable:${st.mode}:${st.mtimeMs}:${st.ctimeMs}`;
      return;
    }
    for (const name of names) walk(`${rel}/${name}`);
  };
  for (const entry of ignoredNames(root, env)) walk(entry.replace(/\/$/, ''));
  return { state, over: budget.over };
}

// The paths in `git status --porcelain=v2 -z` entries: a rename's original path is the entry right
// after its `2 ` line, taken whole whatever it looks like.
export function changedPaths(entries) {
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.startsWith('2 ')) {
      out.push(e.split(' ').slice(9).join(' '));
      if (i + 1 < entries.length) out.push(entries[++i]);
    } else if (e.startsWith('1 ')) out.push(e.split(' ').slice(8).join(' '));
    else if (e.startsWith('u ')) out.push(e.split(' ').slice(10).join(' '));
    else if (e.startsWith('? ') || e.startsWith('! ')) out.push(e.slice(2));
  }
  return out;
}

// Before a launch: the ignored files must be checkable, whole.
export function checkIgnoredCheckable(before) {
  if (before.over) throw Object.assign(new MiraiError(`there are more than ${IGNORED_ENTRY_BUDGET} ignored files and links, so what a run changes in them couldn't all be checked`, EXIT.BLOCKED), { code: 'too-many-ignored', hint: 'remove what you don\'t need (old build output, caches), or run agents in a smaller checkout' });
  const unreadable = Object.keys(before.state).filter((p) => before.state[p].startsWith('unreadable:'));
  if (unreadable.length) throw Object.assign(new MiraiError(`an ignored folder can't be read (${unreadable[0]}), so a change inside it couldn't be seen`, EXIT.BLOCKED), { code: 'unreadable-ignored', hint: 'chmod u+rx it, or remove it' });
}

// A refused run's ignored files stay; the next launch fingerprints them as they are, so they'd never
// be named again. So they're kept on record, and a launch refuses while any is still there.
const pendingFile = (store) => join(store.dir, 'agent-runs', 'ignored-pending.json');
export function recordPendingIgnored(store, paths) {
  if (!paths.length) return;
  mkdirSync(join(store.dir, 'agent-runs'), { recursive: true, mode: 0o700 });
  writeFileSync(pendingFile(store), `${JSON.stringify({ paths })}\n`, { mode: 0o600 });
}
export function checkPendingIgnored(store) {
  let paths;
  try {
    ({ paths } = JSON.parse(readFileSync(pendingFile(store), 'utf8')));
  } catch {
    return;
  }
  const left = (paths ?? []).filter((p) => {
    try {
      lstatSync(join(store.checkout, p));
      return true;
    } catch {
      return false;
    }
  });
  if (!left.length) {
    rmSync(pendingFile(store), { force: true });
    return;
  }
  throw Object.assign(new MiraiError(`an earlier run changed ignored files its role may not, and they're still there: ${left.slice(0, 10).join(', ')}${left.length > 10 ? ` and ${left.length - 10} more` : ''}`, EXIT.BLOCKED), { code: 'ignored-pending', hint: 'look at them and remove them; the launch after that goes ahead' });
}

// After the run: { violations, ignored, ignoredViolations, partial }. `before`: ignoredState() from just before the
// launch (the tree was clean, 19a).
export function scopeViolations({ root, env, role, before }) {
  const after = ignoredState(root, env);
  const tracked = changedPaths(workTreeChanges(root, env));
  const ignored = [];
  for (const p of new Set([...Object.keys(before.state), ...Object.keys(after.state)])) if (before.state[p] !== after.state[p]) ignored.push(p);
  const paths = role.may_write.paths ?? [];
  const ignoredOk = role.may_write.ignored ?? [];
  const violations = [
    ...tracked.filter((p) => p && !included(paths, p)),
    ...ignored.filter((p) => !included(ignoredOk, p)),
  ];
  return { violations: [...new Set(violations)].sort(), ignored: ignored.sort(), ignoredViolations: ignored.filter((p) => !included(ignoredOk, p)).sort(), partial: before.over || after.over };
}
