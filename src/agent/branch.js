import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { branchRecordText, recordPath, signBranchRecord, verifyBranchAt } from '../store/branch-record.js';
import { lookupBranch, registerBranch } from '../store/branches.js';
import { BRANCH_NAME, commitOf, commitsBetween, commitsSince, isAncestor, switchBranch, symbolicBranch, workTreeChanges } from '../store/git.js';
import { commitFormat, commitStep, identity } from './commit.js';

// A ticket's branch (units 21b, 22; D-24: one checkout, switching branches). Named by the
// project's `git.branch_pattern` ({ticket}, {slug} from the ticket's title), made from the
// integration branch's commit, the trust root's own. Its first commit is its signed record
// (.mirai/records/<ticket>/branch.json, D-15), and it's registered in the store with that commit (05b). An existing branch
// is used only when it's registered, its record verifies, and every commit beyond its base is
// MIRAI's (the trailer and MIRAI's committer); one with no commits at all (21b's) is started again.

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

// The ticket's branch, ready for a step (unit 22): made with its signed record and registered, or
// an existing MIRAI branch checked and checked out as it is. Returns { branch, base, created, head,
// creationSha }. `signer()`: your key (loadSigner), asked for only when a branch is made, and from
// your terminal only (open point 5: night runs need 29b's key).
export function prepareBranch({ store, env, trust, config, keys, signer, ticket, ticketText, unattended = false, now = () => new Date() }) {
  const root = store.checkout;
  const genv = store.gitEnv;
  // The ticket's key names refs and a records folder: git's ref rules apply (unit 22 review).
  if (/\.\.|\.$|\.lock$/i.test(ticket)) throw refuse(`${ticket} can't name a git ref (no "..", no ending in "." or ".lock")`, 'bad-ticket');
  // What a commit needs, before anything is switched or written: a refusal here leaves nothing behind.
  identity(env, config);
  commitFormat({ config, store });
  const branch = branchName(config.git?.branch_pattern ?? 'feature/{ticket}-{slug}', ticket, ticketSlug(ticketText));
  if (branch === trust.branch) throw refuse(`the branch pattern names the integration branch (${branch})`, 'bad-branch', 'fix [git] branch_pattern in .mirai/config.toml');
  const head = commitOf(root, `refs/heads/${branch}`, genv);
  const trailer = config.git?.trailer ?? 'Mirai-Ticket';
  if (head !== null) {
    const own = commitsBetween(root, trust.baseSha, `refs/heads/${branch}`, genv);
    const v = verifyBranchAt({ root, env: genv, branch, keys, repoId: store.repoId });
    let entry = lookupBranch(store, branch).filter((e) => isAncestor(root, e.creation_sha, `refs/heads/${branch}`, genv)).at(-1) ?? null;
    if (!entry && own === 0) {
      // 21b's kind: never registered, nothing on it. Started again below.
    } else {
      if (!v.ok) throw refuse(`${branch} isn't a MIRAI branch MIRAI can build on: ${v.reason}`, 'branch-not-mirai', `look at it, then rename or delete it yourself: git branch -m ${branch} <other>`);
      if (v.record.ticket !== ticket) throw refuse(`${branch}'s record is for ${v.record.ticket}, not ${ticket}`, 'branch-not-mirai');
      if (entry && entry.creation_sha !== v.creationSha) throw refuse(`${branch}'s record isn't the one registered for it`, 'branch-not-mirai');
      // Every commit after the record is MIRAI's: its committer and the trailer in the last
      // paragraph. Anything that can't be read, or too many to read, refuses (fails closed).
      const MAX = 500;
      const commits = commitsSince(root, v.creationSha, `refs/heads/${branch}`, genv, { max: MAX + 1 });
      if (commits === null || commits.length > MAX) throw refuse(`${branch}'s commits can't all be checked`, 'branch-not-mirai');
      const committer = identity(env, config).committer.email;
      const ours = (c) => c.committerEmail === committer && c.message.trim().split(/\n[ \t]*\n/).at(-1).split('\n').includes(`${trailer}: ${ticket}`);
      const foreign = commits.filter((c) => !ours(c));
      if (foreign.length) throw refuse(`${branch} has ${foreign.length} commit(s) MIRAI didn't make (such as ${foreign[0].sha.slice(0, 12)})`, 'branch-not-mirai', 'a MIRAI branch takes MIRAI\'s commits only; take it over by hand (unit 46) or start again');
      // A crash between the record's commit and its registration: the record is this ticket's,
      // where it should be, and every commit after it is MIRAI's, so the branch is registered now,
      // last, after every check (unit 22 re-review).
      if (!entry) registerBranch(store, { branch, creation_sha: v.creationSha, ticket, base_sha: v.record.base_sha });
      if (symbolicBranch(root, 'HEAD', genv) !== branch) {
        const changes = workTreeChanges(root, genv);
        if (changes.length) throw refuse(`the work tree has ${changes.length} uncommitted change(s), which switching to ${branch} would carry over`, 'dirty-tree', 'commit or stash them first');
        switchBranch(root, branch, null, genv);
      }
      return { branch, base: v.record.base_sha, created: false, head: commitOf(root, 'HEAD', genv), creationSha: v.creationSha };
    }
  }
  // A new branch is signed with your key: from your terminal only.
  if (unattended) throw refuse(`making ${branch} needs your key, and nothing unattended signs before row 29b`, 'needs-terminal');
  const key = signer();
  const changes = workTreeChanges(root, genv);
  if (changes.length) throw refuse(`the work tree has ${changes.length} uncommitted change(s), which switching to ${branch} would carry over`, 'dirty-tree', 'commit or stash them first');
  switchBranch(root, branch, trust.baseSha, genv);
  const record = signBranchRecord({ ticket, branch, baseSha: trust.baseSha, signer: key, repoId: store.repoId, now });
  mkdirSync(join(root, '.mirai', 'records', ticket), { recursive: true });
  writeFileSync(join(root, recordPath(ticket)), branchRecordText(record));
  const sha = commitStep({ store, env, config, ticket, what: 'branch record' });
  registerBranch(store, { branch, creation_sha: sha, ticket, base_sha: trust.baseSha });
  return { branch, base: trust.baseSha, created: true, head: sha, creationSha: sha };
}
