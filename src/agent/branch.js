import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { BRANCH_NAME, commitOf, commitsBetween, switchBranch, symbolicBranch, workTreeChanges } from '../store/git.js';

// A ticket's branch (unit 21b; D-24: one checkout, switching branches). Named by the project's
// `git.branch_pattern` ({ticket}, {slug} from the ticket's title), made from the integration
// branch's commit, the trust root's own. Nothing commits on it before unit 22, so an existing one
// is used only while it holds no commits of its own; it's moved to that commit. Registering the
// branch and its branch.json are unit 22's.

const refuse = (message, code, hint) => Object.assign(new MiraiError(message, EXIT.BLOCKED), { code, hint });

// The slug from the ticket's first heading: lower-case ASCII words joined by "-", at most 40
// characters, or "ticket" when there's nothing to use.
export function ticketSlug(text) {
  const title = /^#[ \t]+(.+)$/m.exec(String(text).replace(/^---\n[^]*?\n---\n/, ''))?.[1] ?? '';
  const words = title.normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let slug = '';
  for (const w of words) {
    const next = slug ? `${slug}-${w}` : w;
    if (next.length > 40) break;
    slug = next;
  }
  return slug || 'ticket';
}

export function branchName(pattern, ticket, slug) {
  // The ticket's key must be in it, so a pattern can't name a branch that isn't a ticket's (21b review).
  if (!String(pattern).includes('{ticket}')) throw refuse(`the branch pattern ${JSON.stringify(pattern)} doesn't name the ticket ({ticket})`, 'bad-branch', 'fix [git] branch_pattern in .mirai/config.toml');
  const name = String(pattern).replaceAll('{ticket}', ticket).replaceAll('{slug}', slug);
  if (!BRANCH_NAME.test(name)) throw refuse(`the branch pattern ${JSON.stringify(pattern)} gives ${JSON.stringify(name.slice(0, 80))}, which isn't a branch name MIRAI uses`, 'bad-branch', 'fix [git] branch_pattern in .mirai/config.toml');
  return name;
}

// Puts the checkout on the ticket's branch at the integration commit `base`. Returns
// { branch, created }. Refused: the integration branch itself, a branch with commits of its own,
// or a change in the tree (switching would carry it over).
export function ensureBranch({ root, env, base, integration, pattern, ticket, ticketText }) {
  const branch = branchName(pattern ?? 'feature/{ticket}-{slug}', ticket, ticketSlug(ticketText));
  if (branch === integration) throw refuse(`the branch pattern names the integration branch (${branch})`, 'bad-branch', 'fix [git] branch_pattern in .mirai/config.toml');
  const head = commitOf(root, `refs/heads/${branch}`, env);
  if (head !== null) {
    const own = commitsBetween(root, base, `refs/heads/${branch}`, env);
    if (own !== 0) throw refuse(`${branch} has ${own ?? 'some'} commit(s) of its own; until unit 22 a build starts from the integration branch's commit`, 'branch-has-commits', `look at it, then delete it yourself: git branch -D ${branch}`);
  }
  if (symbolicBranch(root, 'HEAD', env) === branch && commitOf(root, 'HEAD', env) === base) return { branch, created: false };
  const changes = workTreeChanges(root, env);
  if (changes.length) throw refuse(`the work tree has ${changes.length} uncommitted change(s), which switching to ${branch} would carry over`, 'dirty-tree', 'commit or stash them first');
  switchBranch(root, branch, base, env);
  return { branch, created: head === null };
}
