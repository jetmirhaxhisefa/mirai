import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildRecordPath } from '../agent/build.js';
import { planInputs } from '../agent/inputs.js';
import { planApproval } from '../agent/plan.js';
import { readApprovedFile } from '../cli/human-move.js';
import { readTicketFolder } from '../lint/lint.js';
import { branchKeys } from '../sign/keys.js';
import { blobAt, commitOf } from '../store/git.js';
import { trustedConfig } from '../trust/snapshot.js';
import { traceDocuments } from './documents.js';
import { gateCases, keptGateResults, traceTicket } from './ticket.js';

// `mirai trace <initiative|ticket>` and the broker tool `trace(item)` (unit 43, Scope 5 and 6):
// one item, either scope, read-only. An initiative is a folder under the docs root; anything else
// is a ticket key. A ticket is read as the integration branch has it (the trust root's base, as its
// build reads it), with its approved plan and the newest signed gate results for its branch's head
// (the store's kept gate results: never the work tree, never an agent's own run).

export const ITEM = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const JOURNEYS = '.mirai/context/journeys.md';

const isDir = (p) => {
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
};

// An initiative's documents in the repo (the repo store), read as files: traceDocuments' result.
export function traceInitiativeIn({ checkout, docsRoot, initiative, registry }) {
  const dir = join(checkout, docsRoot, initiative);
  const read = (name) => {
    try {
      return { path: `${docsRoot}/${initiative}/${name}`, text: readApprovedFile(checkout, checkout, `${docsRoot}/${initiative}/${name}`).bytes.toString('utf8') };
    } catch {
      return null;
    }
  };
  let folder = [];
  try {
    folder = readTicketFolder(dir, { root: checkout }).all;
  } catch {
    folder = [];
  }
  return traceDocuments({ initiative, registry, brief: read('brief.md'), prd: read('prd.md'), epic: read(`epic-${initiative}.md`), interview: read('interview.md'), tickets: folder.map((t) => read(t.path)).filter(Boolean) });
}

// A ticket's code scope, as it stands: the newest signed gate run of its branch's head, or none yet.
export function traceTicketIn({ store, trust, ticket }) {
  const config = trustedConfig(trust);
  const keys = branchKeys(store.checkout, trust.branch, store.gitEnv);
  const approved = planApproval(store, ticket, keys);
  const plan = approved.ok ? approved.text : null;
  const given = planInputs({ root: store.checkout, env: store.gitEnv, commit: trust.baseSha, ticketId: ticket, config, store, plan });
  let last = null;
  try {
    last = JSON.parse(readFileSync(buildRecordPath(store, ticket), 'utf8'));
  } catch {
    last = null;
  }
  const branch = typeof last?.branch === 'string' ? last.branch : null;
  const head = branch ? commitOf(store.checkout, `refs/heads/${branch}`, store.gitEnv) : null;
  const results = branch && head ? keptGateResults(store, { branch, head, keys }) : [];
  const { cases, problems } = gateCases(results);
  const journeys = blobAt(store.checkout, trust.baseSha, JOURNEYS, store.gitEnv);
  const t = traceTicket({ ticket: given.ticket, plan, cases, problems, journeys: journeys ? journeys.toString('utf8') : null, config, ranGate: results.length > 0 });
  return { ...t, branch, head, gate_run: results.length > 0, ...(results.length ? {} : { note: branch ? `no gate run of ${branch} at its head yet: the links show what the gate's run must hold (mirai gate record ${ticket})` : `${ticket} has no branch MIRAI built yet: the links show what its tests must be named` }) };
}

// Either scope, by the item's name: an initiative folder first, else a ticket.
export function traceItem({ store, trust, registry, item }) {
  if (!ITEM.test(item ?? '')) throw Object.assign(new Error(`${String(item).slice(0, 70)} isn't an initiative's folder name or a ticket key`), { code: 'bad-item' });
  const config = trustedConfig(trust);
  const docsRoot = config.docs?.root ?? 'docs/mirai';
  if (/^[a-z0-9][a-z0-9._-]{0,63}$/.test(item) && isDir(join(store.checkout, docsRoot, item))) return traceInitiativeIn({ checkout: store.checkout, docsRoot, initiative: item, registry });
  return traceTicketIn({ store, trust, ticket: item });
}

// The trace as lines for a person: the result, each link, the notes.
export function traceLines(t) {
  const out = [`trace ${t.item} (${t.scope === 'ticket' ? 'the code' : 'the documents'}): ${t.result}${t.why ? `: ${t.why}` : ''}`];
  for (const l of t.links) out.push(l.state === 'pass' ? `  ok       ${l.from} → ${l.to}${l.where ? ` (${l.where})` : ''}` : `  missing  ${l.what} (fix in: ${l.where})`);
  if (t.scope === 'ticket' && t.result !== 'n/a') out.push(`  qa: ${t.qa}`);
  for (const n of [...(t.notes ?? []), ...(t.note ? [t.note] : [])]) out.push(`  note: ${n}`);
  return out;
}
