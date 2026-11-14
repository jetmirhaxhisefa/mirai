import { codeHash } from '../proofs/hash.js';
import { commitOf, fetchObjects, firstParentsWithParents, mergeBase, remoteRef } from '../store/git.js';
import { allTicketFacts } from '../store/journal.js';

// M1, the acceptance rate (unit 29a, Jet's decision 2; D-38): of the MRs MIRAI opened, how many you
// merged as they were. It compares the code, not the commits: the MR's final head and MIRAI's last
// push each get the proofs' code hash (unit 25a), taken from where each meets the integration
// branch as it was just before the merge. GitHub's "Update branch" and a clean rebase keep the
// hash; a change only outside `gate.code_paths` (docs, records) isn't an edit.
//   merged as is: merged, the same code hash as MIRAI's last push
//   edited:       merged, a different code hash
//   closed:       closed without merge
//   unknown:      merged, but the MR's head or merge commit can't be read (named, left out of the rate)

export const M1_CLASSES = Object.freeze(['as-is', 'edited', 'closed', 'unknown']);
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

// An MR's head ref on the host, for a merge recorded before unit 29a.
export const mrHeadRef = (hostName, number) => (hostName === 'gitlab' ? `refs/merge-requests/${number}/head` : `refs/pull/${number}/head`);

// One ticket's class: { ticket, class, why?, mr? }. `facts`: allTicketFacts's for the ticket.
// `host` (optional): { name, pushUrl, helper, ca } to read a head the journal doesn't have.
export function classifyTicket({ root, env, ticket, facts, codePaths, integration, host = null }) {
  const mr = facts.url ? { number: facts.number ?? null, url: facts.url } : facts.number ? { number: facts.number, url: null } : null;
  const out = (cls, why) => ({ ticket, class: cls, ...(why ? { why } : {}), ...(mr ? { mr } : {}) });
  if (facts.mr === 'closed') return out('closed');
  if (facts.mr !== 'merged') return null;
  if (facts.mergedInto === 'epic') return out('unknown', 'merged into an epic branch: M1 for epics comes with unit 53');
  const pushed = facts.lastPush;
  if (!pushed || !SHA.test(pushed)) return out('unknown', 'MIRAI has no push of its own on record for it');
  let head = facts.finalHead ?? null;
  if (!head && host && facts.number) {
    try {
      head = remoteRef(root, host.pushUrl, mrHeadRef(host.name, facts.number), env, { helper: host.helper ?? null, ca: host.ca ?? null });
    } catch {
      head = null;
    }
  }
  if (!head) return out('unknown', host ? 'the host doesn\'t name the MR\'s final head' : 'the MR\'s final head isn\'t on record; mirai report --m1 reads it from the host');
  // The quick answer: the MR merged exactly what MIRAI pushed.
  if (head === pushed) return out('as-is');
  if (!commitOf(root, head, env) && host && facts.number) {
    try {
      fetchObjects(root, host.pushUrl, mrHeadRef(host.name, facts.number), env, { helper: host.helper ?? null, ca: host.ca ?? null });
    } catch {
      // stays missing; said below
    }
  }
  if (!commitOf(root, head, env)) return out('unknown', `the MR's head ${head.slice(0, 7)} isn't in this clone${host ? '' : '; mirai report --m1 fetches it'}`);
  if (!commitOf(root, pushed, env)) return out('unknown', `MIRAI's push ${pushed.slice(0, 7)} isn't in this clone`);
  // The merge commit: the host's, or the integration branch's merge whose parents include the head.
  let merged = facts.mergeSha && commitOf(root, facts.mergeSha, env) ? facts.mergeSha : null;
  if (!merged) {
    const list = firstParentsWithParents(root, `${head}..${integration}`, env) ?? [];
    merged = list.find((c) => c.parents.slice(1).includes(head))?.sha ?? null;
  }
  if (!merged) return out('unknown', facts.mergeSha ? `the merge commit ${facts.mergeSha.slice(0, 7)} isn't in this clone: pull ${integration}` : `no merge of ${head.slice(0, 7)} on ${integration} here: pull ${integration}, or it was squashed before MIRAI recorded merges (unit 29a)`);
  const before = commitOf(root, `${merged}^1`, env);
  if (!before) return out('unknown', `${merged.slice(0, 7)} has no parent`);
  const hashOf = (tip) => {
    const base = mergeBase(root, tip, before, env);
    return base ? codeHash({ root, env, base, head: tip, codePaths }).hash : null;
  };
  const a = hashOf(pushed);
  const b = hashOf(head);
  if (!a || !b) return out('unknown', 'the code hash couldn\'t be taken (no common history with the integration branch)');
  return out(a === b ? 'as-is' : 'edited');
}

// Every ticket with a merged or closed MR, classified, and the rate.
export function m1({ root, env, events, codePaths, integration, host = null, tickets = null }) {
  const facts = allTicketFacts(events);
  const rows = [];
  for (const [ticket, f] of facts) {
    if (tickets && !tickets.includes(ticket)) continue;
    const r = classifyTicket({ root, env, ticket, facts: f, codePaths, integration, host });
    if (r) rows.push(r);
  }
  rows.sort((x, y) => (x.ticket < y.ticket ? -1 : x.ticket > y.ticket ? 1 : 0));
  return { rows, rate: m1Rate(rows) };
}

// { merged, asIs, edited, closed, unknown, rate } — rate is as-is of merged (unknown left out), or null.
export function m1Rate(rows) {
  const n = (c) => rows.filter((r) => r.class === c).length;
  const asIs = n('as-is');
  const edited = n('edited');
  const merged = asIs + edited;
  return { merged, asIs, edited, closed: n('closed'), unknown: n('unknown'), rate: merged ? asIs / merged : null };
}

export function m1Line(rate) {
  if (rate.merged === 0 && rate.closed === 0) return `M1: no merged or closed MR yet${rate.unknown ? ` (${rate.unknown} unknown)` : ''}`;
  const pct = rate.rate === null ? '' : ` (${Math.round(rate.rate * 100)}%)`;
  return `M1: ${rate.asIs} of ${rate.merged} merged as is${pct} · ${rate.edited} edited · ${rate.closed} closed${rate.unknown ? ` · ${rate.unknown} unknown` : ''}`;
}
