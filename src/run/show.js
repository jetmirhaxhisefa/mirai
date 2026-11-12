import { existsSync, readFileSync } from 'node:fs';

import { buildRecordPath } from '../agent/build.js';
import { planApproval, planPath, readPlanLint } from '../agent/plan.js';
import { readDisputes, reviewsOf } from '../agent/review.js';
import { ROUND_DEFAULTS, readLoop } from '../loop/guard.js';
import { readFrontmatter } from '../lint/frontmatter.js';
import { branchKeys } from '../sign/keys.js';
import { blobAt, commitOf } from '../store/git.js';
import { openStore } from '../store/home.js';
import { readJournal, ticketFacts } from '../store/journal.js';
import { readTicketStatus } from '../store/tickets.js';
import { plain } from '../status/text.js';
import { snapshot, trustedConfig } from '../trust/snapshot.js';

// `mirai show <ticket>` (unit 28, decision 7; D-29, Q9): one ticket's page from the store, never
// committed, never written. Every value an agent or a file could have written is escaped (`plain`).

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

// The page's data (also `--json`).
export function showData({ cwd, env, ticket }) {
  const store = openStore({ cwd, env });
  const status = readTicketStatus(store, ticket)?.status ?? null;
  let trust = null;
  let config = {};
  try {
    trust = snapshot({ cwd, env });
    config = trustedConfig(trust);
  } catch {
    trust = null;
  }
  const docsRoot = config.docs?.root ?? 'docs/mirai';
  let title = null;
  if (trust) {
    try {
      const text = blobAt(store.checkout, trust.baseSha, `${docsRoot}/tickets/${ticket}.md`, store.gitEnv)?.toString('utf8') ?? '';
      title = /^#[ \t]+(.+)$/m.exec(text.replace(/^---\n[^]*?\n---\n/, ''))?.[1]?.trim() ?? null;
    } catch {
      title = null;
    }
  }
  const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
  const planText = existsSync(planPath(store, ticket)) ? readFileSync(planPath(store, ticket), 'utf8') : null;
  let planFm = null;
  try {
    planFm = planText ? readFrontmatter(planText)?.value ?? null : null;
  } catch {
    planFm = null;
  }
  const approvals = readJournal(store).events.filter((e) => e.type === 'approval' && e.kind === 'plan' && e.item === ticket);
  const lastApproval = approvals.at(-1) ?? null;
  const build = readJson(buildRecordPath(store, ticket));
  const head = build?.branch ? commitOf(store.checkout, `refs/heads/${build.branch}`, store.gitEnv) : null;
  const reviews = reviewsOf(store, ticket).map(({ n, record }) => ({
    n, outcome: record.outcome ?? null, why: record.why ?? null, at: record.at ?? null, commit: record.commit ?? null, risk: record.risk ?? null, complete: record.complete === true,
    blocking: (record.findings ?? []).filter((f) => f.severity === 'blocking').map(({ id, file, line, claim, category }) => ({ id, file, line, claim, category })),
    followups: (record.followups ?? []).map((f) => (typeof f === 'string' ? { id: f } : { id: f.id, claim: f.claim ?? null })),
    findings: record.findings ?? [],
  }));
  const loop = readLoop(store, ticket);
  const risk = planFm?.risk ?? reviews.at(-1)?.risk ?? null;
  const rounds = (risk === 'high' ? config.loop?.rounds_high_risk ?? ROUND_DEFAULTS.rounds_high_risk : config.loop?.rounds ?? ROUND_DEFAULTS.rounds) + (loop.granted ?? 0);
  const facts = ticketFacts(readJournal(store).events, ticket);
  let disputes = [];
  try {
    disputes = readDisputes(store, ticket) ?? [];
  } catch {
    disputes = [];
  }
  return {
    ticket, title, state: status?.state ?? null, park_reason: status?.park_reason ?? null, note: status?.note ?? null, risk,
    plan_lint: status?.state === 'blocked' && status?.park_reason === 'bad-plan' ? readPlanLint(store, ticket, planText) : null,
    branch: build?.branch ?? null, head,
    plan: planText === null ? null : { round: planFm?.round ?? 1, approved: planApproval(store, ticket, keys).ok, decision: lastApproval?.decision ?? null, at: lastApproval?.ts ?? null, key_id: lastApproval?.signature?.key_id ?? null, text: planText },
    build: build ? { outcome: build.outcome ?? null, why: build.why ?? null, at: build.at ?? null, launch: build.launch ?? null, tests: (build.tests?.runs ?? []).map((t) => ({ name: t.name, verdict: t.verdict })) } : null,
    reviews,
    disputes,
    mr: facts.mr === 'none' ? null : { state: facts.mr, url: facts.url ?? null, head: facts.head ?? null, proofs_at_head: facts.proofsValidAtHead === true && facts.head === head },
    rounds: { used: loop.rounds_used, of: rounds, replans: loop.replans_used, replans_of: 1 },
    usage: { turns: loop.budget.turns, tokens: loop.budget.tokens + loop.budget.tokens_cached, minutes: Math.round(loop.budget.minutes * 10) / 10 },
  };
}

const ago = (iso) => (iso ? String(iso).replace('T', ' ').slice(0, 16) : '');

// The page as text. `full`: every finding's text, the plan, and the parking note whole.
export function showText(d, { full = false } = {}) {
  const out = [];
  const built = d.mr?.state === 'open' && d.mr.proofs_at_head;
  out.push(`${d.ticket}: ${plain(d.title ?? '(no title)')}          ${built ? 'built' : d.state ?? 'unknown'}${d.mr?.url ? ` · MR ${plain(d.mr.url)}` : ''}`);
  out.push(`  ${d.branch ? `branch ${plain(d.branch)}${d.head ? ` at ${d.head.slice(0, 7)}` : ''}` : 'no branch yet'}${d.mr ? ` · proofs ${d.mr.proofs_at_head ? 'valid at head' : 'not at head'}` : ''} · ${d.risk ?? 'normal'} risk`);
  out.push('');
  const row = (k, v) => out.push(`${k.padEnd(11)}${v}`);
  row('Plan', d.plan ? `round ${d.plan.round}, ${d.plan.approved ? `approved by you ${ago(d.plan.at)}${d.plan.key_id ? ` (${d.plan.key_id.slice(0, 6)}…)` : ''}` : d.plan.decision === 'rejected' ? 'rejected by you' : 'waits for your approval'}` : 'not yet');
  row('Build', d.build ? `${d.build.outcome}${d.build.at ? ` ${ago(d.build.at)}` : ''}${d.build.tests.length ? ` · tests: ${d.build.tests.map((t) => `${plain(t.name)} ${t.verdict}`).join(', ')}` : ''}${d.build.why ? ` · ${plain(d.build.why).slice(0, 200)}` : ''}` : 'not yet');
  for (const r of d.reviews) {
    row(`Review ${r.n}`, `${String(r.outcome ?? 'incomplete').toUpperCase()}${r.blocking.length ? ` · ${r.blocking.length} blocking` : ''}${r.followups.length ? ` · ${r.followups.length} follow-up${r.followups.length === 1 ? '' : 's'}` : ''}${r.why ? ` · ${plain(r.why).slice(0, 200)}` : ''}`);
    for (const f of r.blocking) out.push(`  ${plain(f.id)} blocking  ${plain(f.file ?? '')}${f.line ? `:${f.line}` : ''}  ${plain(f.claim ?? '').slice(0, full ? 4000 : 100)}`);
    if (full) for (const f of r.findings.filter((x) => x.severity !== 'blocking')) out.push(`  ${plain(f.id)} ${f.severity}  ${plain(f.file ?? '')}${f.line ? `:${f.line}` : ''}  ${plain(f.claim ?? '')}`);
  }
  if (d.disputes.length) row('Disputes', `${d.disputes.length}`);
  row('MR', d.mr ? `${d.mr.state}${d.mr.url ? ` ${plain(d.mr.url)}` : ''}` : 'not yet');
  row('Rounds', `${d.rounds.used} of ${d.rounds.of} used · re-plans ${d.rounds.replans} of ${d.rounds.replans_of}`);
  row('Usage', `${d.usage.turns} turns · ${d.usage.tokens >= 1e6 ? `${(d.usage.tokens / 1e6).toFixed(1)} M` : `${Math.round(d.usage.tokens / 1000)} k`} tokens · ${d.usage.minutes} min`);
  row('Parked', d.state === 'blocked' ? `${plain(d.park_reason ?? '')}${d.note ? `: ${plain(d.note).slice(0, full ? 2000 : 200)}` : ''} · then: mirai unpark ${d.ticket}` : '—');
  // A bad plan's lint problems: what Kai's plan got wrong, so you can judge it.
  const lint = d.plan_lint ?? [];
  for (const p of lint.slice(0, full ? lint.length : 5)) out.push(`  plan.md${p.line ? `:${p.line}` : ''}  ${plain(p.reason)}${full && p.hint ? ` (${plain(p.hint)})` : ''}`);
  if (!full && lint.length > 5) out.push(`  … ${lint.length - 5} more: mirai show ${d.ticket} --full`);
  row('QA', 'not yet (unit 51)');
  if (full && d.plan?.text) out.push('', '--- plan ---', ...String(d.plan.text).split('\n').map(plain));
  return `${out.join('\n')}\n`;
}
