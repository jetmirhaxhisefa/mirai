import { readFileSync } from 'node:fs';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { buildRecordPath } from '../agent/build.js';
import { prePushCheck } from '../hooks/pre-push.js';
import { checkProofs } from '../proofs/check.js';
import { renderMrDescription } from '../reports/render.js';
import { branchKeys } from '../sign/keys.js';
import { commitOf, isAncestor, mergeBase, pushBranch, remotes } from '../store/git.js';
import { openStore } from '../store/home.js';
import { appendEvent, readJournal, ticketFacts } from '../store/journal.js';
import { readTicketStatus } from '../store/tickets.js';
import { gateCheck } from '../tests/gate.js';
import { protectionRules } from '../trust/protected.js';
import { snapshot, trustedConfig, trustedRegistry } from '../trust/snapshot.js';
import { describeTicket } from './describe.js';
import { cleanTitle, hostFor } from './host.js';

// `mirai ship <ticket>` (unit 27a; design/01 §11; Jet's decisions 1–5): MIRAI, never an agent,
// pushes a reviewed ticket's branch and opens or updates its one MR against the integration
// branch. No human step: your merge is the gate (D-34). In order, each refusal before anything
// leaves the machine:
//   1. the ticket in review; an MR MIRAI opened already that is now merged or closed → recorded
//      and refused, from any branch (the merge makes the gate check below find nothing to prove);
//      then HEAD on its branch, a clean tree;
//   2. `gate check` passes at HEAD (the review and gate proofs for this code);
//   3. the host (config + remote), its CLI and your login;
//   4. the push check (26a's `prePushCheck`, the hook's own check);
//   5. the base is on the host's integration branch (else the MR would carry your unpushed main);
//   6. the MR: merged or closed → refused, never reopened; locked (GitLab merging it) → refused,
//      try again; the host's branch at a commit MIRAI
//      didn't push → refused, never forced;
//   7. push (when the host's branch isn't at HEAD), then open or update the MR; the journal records
//      both (`pushed` with `proofs: "pass"`, `mr_opened` with its number and URL).
// Returns { ticket, outcome: 'opened' | 'updated' | 'unchanged', mr: { number, url }, head, pushed }.

const fail = (message, code, hint, exitCode = EXIT.BLOCKED) => Object.assign(new MiraiError(message, exitCode), { code, ...(hint ? { hint } : {}) });

// A merged or closed MR: recorded once in the journal (merged derives `done`), then refused.
function endedMr(store, ticket, mr, known) {
  if (mr?.state === 'merged') {
    const sha = (x) => (typeof x === 'string' && /^[0-9a-f]{40}$/.test(x) ? x : undefined);
    if (known !== 'merged') appendEvent(store, { type: 'mr_merged', by: 'script', ticket, target: 'integration', ...(sha(mr.head) ? { head: mr.head } : {}), ...(sha(mr.mergeSha) ? { merge_sha: mr.mergeSha } : {}) });
    throw fail(`${ticket}'s MR ${mr.url} is merged`, 'mr-merged', 'nothing to ship: it\'s done');
  }
  if (mr?.state === 'closed') {
    if (known !== 'closed') appendEvent(store, { type: 'mr_closed', by: 'script', ticket });
    throw fail(`${ticket}'s MR ${mr.url} is closed`, 'mr-closed', `closing it was your decision, and MIRAI never reopens it: drop the ticket (mirai drop ${ticket}), or reopen the MR yourself and run it again`);
  }
}

// `hostOf` (tests): the host for { config, remoteUrl, store, env, root }; hostFor by default.
export async function shipTicket({ cwd, env, ticket, now = () => new Date(), hostOf = hostFor }) {
  const store = openStore({ cwd, env });
  const status = readTicketStatus(store, ticket)?.status ?? null;
  if (!status) throw fail(`${ticket} has no status in MIRAI`, 'unknown-ticket', null, EXIT.USAGE);
  if (status.state !== 'in-review') throw fail(`${ticket} is ${status.state}, not in-review: MIRAI ships a ticket after its review passed and its proofs are minted`, 'not-reviewed', `mirai review ${ticket}, then mirai gate record ${ticket}`);
  let last;
  try {
    last = JSON.parse(readFileSync(buildRecordPath(store, ticket), 'utf8'));
  } catch {
    last = null;
  }
  const branch = last?.branch;
  if (typeof branch !== 'string') throw fail(`${ticket} has no branch MIRAI built`, 'no-branch', `mirai build ${ticket}`);

  // 1b. An MR MIRAI opened already: its state first, from any branch. Once you merge it, the
  // integration branch holds the code, so the gate check finds nothing to prove and would hide the
  // merge; and you are on main by then, not on the ticket's branch.
  const known = ticketFacts(readJournal(store, { keys: branchKeys(store.checkout, store.branch, store.gitEnv) }).events, ticket);
  if (known.mr === 'merged') throw fail(`${ticket}'s MR is merged`, 'mr-merged', 'nothing to ship: it\'s done');
  if (known.mr === 'open') {
    const config = trustedConfig(snapshot({ cwd, env, now }));
    const host = hostOf({ config, remoteUrl: remotes(store.checkout, store.gitEnv).get('origin') ?? null, store, env, root: store.checkout });
    host.checkAuth();
    endedMr(store, ticket, host.findMr(branch), 'open');
  }
  let gate;
  try {
    gate = gateCheck(store.checkout, branch, store.gitEnv);
  } catch (err) {
    throw fail(err.message, err.code === 'gate-branch' ? 'wrong-branch' : 'dirty', err.hint);
  }
  const head = gate.head;

  // 2. The proofs, with the integration branch's config and keys only.
  const trust = snapshot({ cwd, env, now });
  const config = trustedConfig(trust);
  const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
  const proofs = checkProofs({ root: store.checkout, env: store.gitEnv, ticket, commit: head, integration: trust.baseSha, codePaths: config.gate?.code_paths, keys, repoId: store.repoId, rules: protectionRules(trustedRegistry(trust), config).rules, docsRoot: config.docs?.root });
  if (proofs.outcome !== 'pass') throw fail(`${ticket}: gate check is ${proofs.outcome} at ${head.slice(0, 12)}`, proofs.outcome, `mint the proofs after the review: mirai gate record ${ticket}`);

  // 3. The host.
  const remoteUrl = remotes(store.checkout, store.gitEnv).get('origin') ?? null;
  const host = hostOf({ config, remoteUrl, store, env, root: store.checkout });
  host.checkAuth();
  const remoteSha = host.branchTip(branch);

  // 4. The push check: the same one the hook runs (26a, decision 5).
  const zero = '0'.repeat(40);
  const check = prePushCheck({ cwd, env, remote: 'origin', updates: [{ localRef: `refs/heads/${branch}`, localSha: head, remoteRef: `refs/heads/${branch}`, remoteSha: remoteSha ?? zero }], checkHooks: false });
  const ref = check.refs[0];
  if (!check.ok) throw fail(`the push check refused ${branch}: ${ref?.outcome} (${ref?.why ?? ''})`, ref?.outcome ?? 'push-check', ref?.hint);

  // 5. The base on the host.
  const integration = config.git.integration_branch;
  const base = mergeBase(store.checkout, trust.baseSha, head, store.gitEnv);
  const tip = host.branchTip(integration);
  if (!tip) throw fail(`the host has no ${integration} branch`, 'base-not-pushed', `push ${integration} first`);
  if (!commitOf(store.checkout, tip, store.gitEnv)) throw fail(`the host's ${integration} has commits this clone doesn't`, 'fetch-first', `git fetch origin ${integration}, then run it again`);
  if (!base || !isAncestor(store.checkout, base, tip, store.gitEnv)) throw fail(`${branch} starts from ${base ? base.slice(0, 12) : 'nothing'}, which isn't on the host's ${integration}: the MR would carry those commits`, 'base-not-pushed', `push ${integration} first: git push origin ${integration}`);

  // 6. The MR and the host's branch.
  const { events } = readJournal(store, { keys });
  const facts = ticketFacts(events, ticket);
  const lastPushed = [...events].reverse().find((e) => e.type === 'pushed' && e.ticket === ticket && e.branch === branch)?.sha ?? null;
  const mr = host.findMr(branch);
  endedMr(store, ticket, mr, facts.mr);
  if (mr?.state === 'locked') throw fail(`${ticket}'s MR ${mr.url} is locked: GitLab is merging it`, 'mr-locked', 'run it again in a minute');
  let lease = null;
  if (remoteSha && remoteSha !== head) {
    const forward = commitOf(store.checkout, remoteSha, store.gitEnv) && isAncestor(store.checkout, remoteSha, head, store.gitEnv);
    if (!forward) {
      if (remoteSha !== lastPushed) throw fail(`${branch} on the host is at ${remoteSha.slice(0, 12)}, a commit MIRAI didn't push`, 'remote-moved', 'someone pushed to the branch: look at it on the host; MIRAI never overwrites it');
      lease = remoteSha; // MIRAI's own branch, rebased since it last pushed it
    }
  }

  // 7. Push, then the MR.
  let pushed = false;
  if (remoteSha !== head) {
    const p = pushBranch(store.checkout, host.pushUrl, branch, head, store.gitEnv, { helper: host.helper, lease, ca: host.ca ?? null });
    if (!p.ok) throw fail(`the push of ${branch} was refused: ${p.why}`, 'push-refused', 'look at the branch on the host, then run it again');
    pushed = true;
  }
  if (pushed || facts.head !== head) appendEvent(store, { type: 'pushed', by: 'script', ticket, branch, sha: head, proofs: 'pass' });
  const { data, title: rawTitle } = describeTicket({ store, ticket, head, ticketPath: `${config.docs?.root ?? 'docs/mirai'}/tickets/${ticket}.md` });
  const title = cleanTitle(rawTitle);
  const body = renderMrDescription(data, { host: host.renderAs, root: store.checkout, home: env.HOME });
  if (!mr) {
    const made = host.openMr({ base: integration, head: branch, title, body });
    appendEvent(store, { type: 'mr_opened', by: 'script', ticket, head, target: integration, number: made.number, url: made.url });
    return { ticket, outcome: 'opened', mr: made, head, pushed, branch };
  }
  const same = (a, b) => String(a ?? '').replace(/\r\n/g, '\n').trim() === String(b ?? '').replace(/\r\n/g, '\n').trim();
  const edited = !same(mr.body, body) || !same(mr.title, title);
  if (edited) host.updateMr(mr.number, { title, body });
  if (facts.mr !== 'open' || facts.url !== mr.url) appendEvent(store, { type: 'mr_opened', by: 'script', ticket, head, target: integration, number: mr.number, url: mr.url });
  return { ticket, outcome: pushed || edited ? 'updated' : 'unchanged', mr: { number: mr.number, url: mr.url }, head, pushed, branch };
}
