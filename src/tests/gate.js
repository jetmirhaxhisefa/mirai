import { commitOf, hiddenFromStatus, symbolicBranch, workTreeChanges } from '../store/git.js';
import { TestRunError } from './docker.js';

// A gate run's preconditions (mirai test --gate, unit 14d): HEAD on the named branch, and a work
// tree that `git status` shows clean, with no tracked file it skips (assume-unchanged,
// skip-worktree). Checked before the run, again right after the copy and again before signing,
// so the tree that ran is HEAD's files (plus the base commit's dummy env files, as every run).
// Returns { branch, head }, or throws a refusal.
export function gateCheck(checkout, branch, env) {
  const on = symbolicBranch(checkout, 'HEAD', env);
  if (on !== branch) throw new TestRunError(`HEAD is on ${on ?? 'no branch (detached)'}, not ${branch}`, { code: 'gate-branch', hint: `check out ${branch} first` });
  const changes = workTreeChanges(checkout, env);
  if (changes.length) {
    throw new TestRunError(`the work tree isn't clean (${changes.length} changed, staged or new file${changes.length === 1 ? '' : 's'})`, { code: 'gate-dirty', hint: 'commit or stash them: a gate run tests exactly a commit' });
  }
  const hidden = hiddenFromStatus(checkout, env);
  if (hidden.length) {
    throw new TestRunError(`${hidden.length} tracked file${hidden.length === 1 ? ' is' : 's are'} marked assume-unchanged or skip-worktree, so git status doesn't check ${hidden.length === 1 ? 'it' : 'them'}`, { code: 'gate-dirty', hint: `clear the marks: git update-index --no-assume-unchanged --no-skip-worktree -- ${hidden[0]}` });
  }
  const head = commitOf(checkout, 'HEAD', env);
  if (!head) throw new TestRunError('HEAD has no commit', { code: 'gate-branch' });
  return { branch, head };
}

// The same check, and that HEAD hasn't moved since `gate.head`.
export function gateRecheck(checkout, gate, env) {
  const now = gateCheck(checkout, gate.branch, env);
  if (now.head !== gate.head) throw new TestRunError(`HEAD moved during the run (${gate.head.slice(0, 12)} → ${now.head.slice(0, 12)})`, { code: 'gate-dirty', hint: 'run it again on a checkout nothing else changes' });
  return now;
}
