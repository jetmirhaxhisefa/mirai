import { lsTree, workTreeChanges } from '../store/git.js';
import { readLock } from '../install/lock.js';

// The safety net (unit 39, decision 6's third layer; Scope 9): MIRAI's `pre-commit` refuses a
// commit that adds a file under an agent folder that the lock doesn't mark `rendered`, and names
// the `mirai custom add` command for each. `mirai doctor` lists the same files once committed
// (`git commit --no-verify` skips the hook). Unit 44's human-only status check joins this hook.

export const AGENT_FOLDERS = Object.freeze(['.claude', '.cursor', '.codex']);

const under = (p) => AGENT_FOLDERS.some((f) => p.startsWith(`${f}/`) || p.includes(`/${f}/`));

// What `mirai custom add` takes for a file: a skill's folder, else the file itself.
export function itemRoot(path) {
  const m = /^(.*?(?:^|\/)\.(?:claude|cursor|codex|agents)\/skills\/[^/]+)\//.exec(path);
  return m ? m[1] : path;
}

// The files among `paths` under an agent folder that the lock doesn't mark rendered.
export function notRendered(paths, lock) {
  return paths.filter((p) => under(p) && lock?.files.get(p)?.mark !== 'rendered').sort();
}

// The paths a commit adds, from `git status --porcelain=v2 -z` (staged: X is A, C or R).
export function stagedAdditions(entries) {
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.startsWith('1 ')) {
      const f = e.split(' ');
      if (f[1][0] === 'A') out.push(f.slice(8).join(' '));
    } else if (e.startsWith('2 ')) {
      const f = e.split(' ');
      if ('RC'.includes(f[1][0])) out.push(f.slice(9).join(' '));
      i++;
    }
  }
  return out;
}

// The pre-commit check at `root`: { ok, refused: [{ path, root }] }.
export function preCommitCheck({ root, env }) {
  const lock = readLock(root);
  const refused = notRendered(stagedAdditions(workTreeChanges(root, env)), lock).map((p) => ({ path: p, root: itemRoot(p) }));
  return { ok: refused.length === 0, refused };
}

// The committed files under the agent folders at `ref` the lock doesn't mark rendered (doctor).
export function committedNotRendered({ root, env, ref = 'HEAD' }) {
  const lock = readLock(root);
  const paths = AGENT_FOLDERS.flatMap((f) => (lsTree(root, ref, f, env, { recursive: true }) ?? []).filter((e) => e.type === 'blob').map((e) => e.path));
  return notRendered(paths, lock);
}
