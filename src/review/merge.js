import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { buildRecordPath } from '../agent/build.js';
import { codeHash } from '../proofs/hash.js';
import { checkProofs } from '../proofs/check.js';
import { hostFor } from '../ship/host.js';
import { projectWords, wordsOfHost } from '../ship/words.js';
import { branchKeys } from '../sign/keys.js';
import { commitOf, fetchBranch, isAncestor, mergeBase, remotes, resetTo, switchBranch, symbolicBranch, workTreeChanges } from '../store/git.js';
import { openStore } from '../store/home.js';
import { appendEvent, readJournal, ticketFacts } from '../store/journal.js';
import { protectionRules } from '../trust/protected.js';
import { snapshot, trustedConfig, trustedRegistry } from '../trust/snapshot.js';
import { readFileSync } from 'node:fs';

// `mirai merge <ticket>` (unit 29d, Jet's decisions 2 and 3; D-34: your merge is the gate). In a
// real terminal only, with the ticket key typed (the command checks both before calling this).
// Each refusal before anything changes:
//   1. the MR MIRAI opened is open on the host, and its head is MIRAI's last push (what you
//      reviewed);
//   2. the proofs are valid at that head;
//   3. the host can merge it, and CI isn't failing or pending;
// then your decision, signed (`approval`, kind `merge`), the merge with a merge commit pinned to
// that head (the host refuses if it moved), `mr_merged` with the head and the merge commit, the
// branch deleted on the host, and your checkout on the integration branch, fast-forwarded (only
// with a clean work tree; else said). Returns { ticket, mr, head, mergeSha, notes }.

const fail = (message, code, hint, exitCode = EXIT.BLOCKED) => Object.assign(new MiraiError(message, exitCode), { code, ...(hint ? { hint } : {}) });

// The checks only, for the decision's prompt: { store, host, facts, live, head, branch, codeHash }.
export function mergeChecks({ cwd, env, ticket, hostOf = hostFor }) {
  const store = openStore({ cwd, env });
  const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
  const facts = ticketFacts(readJournal(store, { keys }).events, ticket);
  const pw = () => projectWords({ cwd, env, store });
  if (facts.mr === 'merged') throw fail(`${ticket}'s ${pw().long} is merged already`, 'mr-merged', 'nothing to merge: it\'s done');
  if (facts.mr === 'closed') throw fail(`${ticket}'s ${pw().long} is closed`, 'mr-closed', `reopen it on the host and run mirai ship ${ticket}, or drop the ticket: mirai drop ${ticket}`);
  if (facts.mr !== 'open' || !facts.number) throw fail(`${ticket} has no ${pw().long} MIRAI opened`, 'no-mr', `mirai run ${ticket} (or mirai ship ${ticket})`);
  const trust = snapshot({ cwd, env });
  const config = trustedConfig(trust);
  const host = hostOf({ config, remoteUrl: remotes(store.checkout, store.gitEnv).get('origin') ?? null, store, env, root: store.checkout });
  const w = wordsOfHost(host);
  host.checkAuth();
  const live = host.mrState(facts.number);
  if (live.state === 'merged') {
    appendEvent(store, { type: 'mr_merged', by: 'script', ticket, target: 'integration', head: live.head });
    throw fail(`${ticket}'s ${w.short} ${facts.url ?? ''} was merged on the host`, 'mr-merged', 'nothing to merge: it\'s done');
  }
  if (live.state !== 'open') {
    appendEvent(store, { type: 'mr_closed', by: 'script', ticket });
    throw fail(`${ticket}'s ${w.short} ${facts.url ?? ''} is ${live.state}`, 'mr-closed', `reopen it on the host and run mirai ship ${ticket}, or mirai drop ${ticket}`);
  }
  const head = live.head;
  if (head !== facts.lastPush) throw fail(`the ${w.long}'s head ${head.slice(0, 7)} isn't what MIRAI pushed (${String(facts.lastPush).slice(0, 7)}): someone pushed after MIRAI`, 'mr-head-moved', `look at it: mirai review-mr ${ticket}; MIRAI merges only what it pushed and you reviewed`);
  if (!commitOf(store.checkout, head, store.gitEnv)) throw fail(`${head.slice(0, 7)} isn't in this clone`, 'not-in-clone', 'git fetch origin, then run it again');
  const codePaths = config.gate?.code_paths ?? ['**'];
  const proofs = checkProofs({ root: store.checkout, env: store.gitEnv, ticket, commit: head, integration: trust.baseSha, codePaths, keys, repoId: store.repoId, rules: protectionRules(trustedRegistry(trust), config).rules, docsRoot: config.docs?.root });
  if (proofs.outcome !== 'pass') throw fail(`${ticket}: the proofs are ${proofs.outcome} at ${head.slice(0, 7)}`, 'proofs', `mirai gate record ${ticket}, after the review`);
  if (live.mergeable === null) throw fail(`the host is still working out whether it can merge ${ticket}'s ${w.long}`, 'mr-checking', 'run it again in a minute');
  if (live.mergeable !== true) throw fail(`the host can't merge ${ticket}'s ${w.long}${live.why ? `: ${live.why}` : ''}`, 'mr-not-mergeable', `see the ${w.long} on the host`);
  if (live.ci.state === 'failed') throw fail(`CI failed on ${head.slice(0, 7)} (${live.ci.checks.filter((c) => c.state === 'failed').map((c) => c.name).join(', ')})`, 'ci-failed', 'see the checks on the host');
  if (live.ci.state === 'pending') throw fail(`CI is still running on ${head.slice(0, 7)}`, 'ci-pending', 'run it again when it\'s done');
  const base = mergeBase(store.checkout, head, trust.baseSha, store.gitEnv);
  const hash = base ? codeHash({ root: store.checkout, env: store.gitEnv, base, head, codePaths }).hash : null;
  let branch = null;
  try {
    branch = JSON.parse(readFileSync(buildRecordPath(store, ticket), 'utf8')).branch ?? null;
  } catch {
    branch = null;
  }
  return { store, host, words: w, facts, live, head, branch, codeHash: hash, integration: config.git?.integration_branch ?? store.branch };
}

// The merge, after the checks and your typed key. `signer`: your key; `answeredAfterS`: how long
// you took (the approval line carries it, as approve's).
export function mergeTicket({ cwd, env, ticket, signer, answeredAfterS = 0, checks = null, hostOf = hostFor }) {
  const c = checks ?? mergeChecks({ cwd, env, ticket, hostOf });
  const { store, host, facts, head } = c;
  if (!c.codeHash) throw fail(`${ticket}'s code hash can't be taken`, 'no-hash');
  // Your decision, signed, before the host is asked.
  appendEvent(store, { type: 'approval', by: 'human', item: ticket, kind: 'merge', path: `mr/${facts.number}`, content_hash: c.codeHash, decision: 'accepted', answered_after_s: Math.max(0, Math.round(answeredAfterS)) }, { signer });
  const { mergeSha } = host.mergeMr(facts.number, { head });
  appendEvent(store, { type: 'mr_merged', by: 'script', ticket, target: 'integration', head, merge_sha: mergeSha });
  const notes = [];
  if (c.branch) {
    try {
      host.deleteBranch(c.branch);
    } catch (err) {
      notes.push(`the branch ${c.branch} wasn't deleted on the host (${String(err.message).slice(0, 160)}); delete it there`);
    }
  }
  // Your checkout: on the integration branch, fast-forwarded, only with a clean work tree.
  try {
    const changes = workTreeChanges(store.checkout, store.gitEnv);
    if (changes.length) notes.push(`your work tree has ${changes.length} uncommitted change(s), so your checkout is left as it is: pull ${c.integration} yourself`);
    else {
      const tip = fetchBranch(store.checkout, host.pushUrl, c.integration, store.gitEnv, { helper: host.helper ?? null, ca: host.ca ?? null });
      if (symbolicBranch(store.checkout, 'HEAD', store.gitEnv) !== c.integration) switchBranch(store.checkout, c.integration, null, store.gitEnv);
      const local = commitOf(store.checkout, `refs/heads/${c.integration}`, store.gitEnv);
      if (tip && local && isAncestor(store.checkout, local, tip, store.gitEnv)) resetTo(store.checkout, tip, store.gitEnv);
      else notes.push(`your ${c.integration} has commits the host's doesn't, so it wasn't moved: pull it yourself`);
    }
  } catch (err) {
    notes.push(`your checkout wasn't updated (${String(err.message).slice(0, 160)}): git switch ${c.integration} && git pull`);
  }
  return { ticket, mr: { number: facts.number, url: facts.url ?? null }, head, mergeSha, notes };
}
