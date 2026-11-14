import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { readBaseline } from '../baseline/store.js';
import { redTeamStatus } from '../redteam/run.js';
import { showData } from '../run/show.js';
import { branchKeys } from '../sign/keys.js';
import { atomicWrite, checkPrivateDir, ensurePrivateDir, readPrivateFile } from '../store/files.js';
import { openStore } from '../store/home.js';
import { allTicketFacts, readJournal } from '../store/journal.js';
import { readRunLog, runIds } from '../store/run-log.js';
import { snapshot, trustedConfig } from '../trust/snapshot.js';
import { classifyTicket } from './m1.js';
import { renderRunReport } from './render.js';

// The run report (unit 29a, Jet's decision 4; PM2-17; the Milestone A exit evidence): one run's
// tickets, each with its whole path so far (an earlier run's steps marked), its rounds of the cap,
// its MR and M1 class and your feedback; the run's usage and limit share; the red team's state.
// Read from the run logs, the journal, the loop counters and the baseline; saved once in
// `<store>/reports/<run-id>.md` and `.json`, and printed by `mirai report`.

export const REPORTS = 'reports';
const RUN_ID = /^r-\d{8}-\d{6}-[0-9a-f]{4}$/;
const baselineShas = (store) => {
  const dir = join(store.dir, 'baseline');
  if (!checkPrivateDir(dir)) return [];
  return readdirSync(dir).map((f) => /^([0-9a-f]{40})\.json$/.exec(f)?.[1]).filter(Boolean);
};
const reportPaths = (store, runId) => ({ md: join(store.dir, REPORTS, `${runId}.md`), json: join(store.dir, REPORTS, `${runId}.json`) });
const sum = (xs, k) => xs.reduce((t, x) => t + (typeof x[k] === 'number' ? x[k] : 0), 0);
const round1 = (n) => Math.round(n * 10) / 10;
const iso = (ts) => (typeof ts === 'string' ? ts : undefined);
const tokensOf = (l) => (l.tokens_in ?? 0) + (l.tokens_out ?? 0) + (l.tokens_cached ?? 0);
const VERDICT_TEXT = { pass: 'pass', fail: 'fail', blocked: 'blocked', 'needs-human': 'needs you', error: 'error' };

// The step's name as you read it: Kai's plan, Kai's build, Rex's review, …
function launchText(l) {
  const who = l.agent === 'mirai-reviewer' ? 'Rex' : l.agent === 'mirai-developer' ? 'Kai' : l.role ?? 'an agent';
  const what = { plan: 'plan', replan: 're-plan', build: 'build', fix: 'fix', review: 'review', 'review-high-risk': 'high-risk review', verify: 'check', qa: 'QA' }[l.step] ?? l.step ?? 'launch';
  return `${who}'s ${what}`;
}

// The report's data for `runId` (the newest run when null).
export async function runReportData({ cwd, env, runId = null, host = null, redTeam = redTeamStatus }) {
  const store = openStore({ cwd, env });
  const ids = runIds(store);
  if (ids.length === 0) throw Object.assign(new MiraiError('no run here yet', EXIT.FAILURE), { code: 'no-run', hint: 'mirai run <ticket>' });
  const id = runId ?? ids.at(-1);
  if (!RUN_ID.test(id) || !ids.includes(id)) throw Object.assign(new MiraiError(`no run ${String(id).slice(0, 40)}`, EXIT.USAGE), { code: 'no-run', hint: 'mirai report, for the last run' });
  const lines = readRunLog(store, id).lines;
  const started = lines.find((l) => l.event === 'run_started');
  const states = lines.filter((l) => l.event === 'run_state').map((l) => l.to);
  const ended = lines.some((l) => l.event === 'run_finished');
  const last = states.at(-1);
  if (!ended && (last === 'running' || last === undefined)) throw Object.assign(new MiraiError(`run ${id} is still going`, EXIT.BLOCKED), { code: 'run-going', hint: 'mirai status' });
  const state = ['finished', 'stopped', 'paused'].includes(last) ? last : 'stopped';
  const startSeq = started?.seq ?? lines[0]?.seq ?? 0;
  const endSeq = lines.at(-1)?.seq ?? startSeq;
  const endTs = lines.at(-1)?.ts ?? null;
  const touched = [...new Set(lines.map((l) => l.item).filter((x) => x && x !== 'run'))];

  let config = {};
  try {
    config = trustedConfig(snapshot({ cwd, env }));
  } catch {
    config = {};
  }
  const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
  const events = readJournal(store, { keys }).events;
  const facts = allTicketFacts(events);
  // Every run's launch lines, for each ticket's whole path (earlier runs' marked).
  const launches = [];
  for (const rid of ids) {
    if (rid > id) continue;
    let ls;
    try {
      ls = readRunLog(store, rid).lines;
    } catch {
      continue;
    }
    for (const l of ls) if (l.event === 'agent_run' && touched.includes(l.item)) launches.push({ ...l, run: rid });
  }

  const tickets = [];
  const usage = [];
  const done = [];
  const parked = [];
  const followups = [];
  const inbox = [];
  for (const ticket of touched) {
    let page = null;
    try {
      page = showData({ cwd, env, ticket });
    } catch {
      page = null;
    }
    const steps = [];
    for (const l of launches.filter((x) => x.item === ticket)) {
      steps.push({
        seq: l.seq, kind: 'launch', earlier: l.run !== id, ...(iso(l.ts) ? { at: l.ts } : {}), text: launchText(l), ...(l.step ? { step: l.step } : {}),
        ...(Number.isInteger(l.round) ? { round: l.round } : {}), ...(l.model ? { model: l.model } : {}), ...(l.model_used ? { model_used: l.model_used } : {}),
        turns: l.turns ?? 0, tokens: tokensOf(l), minutes: round1(l.minutes ?? 0), ...(typeof l.limit_share === 'number' ? { limit_share: l.limit_share } : {}),
        ...(l.verdict ? { verdict: VERDICT_TEXT[l.verdict] ?? l.verdict } : l.outcome && l.outcome !== 'ok' ? { verdict: l.outcome } : {}),
      });
    }
    for (const e of events) {
      if ((e.ticket ?? e.item) !== ticket) continue;
      const at = iso(e.ts) ? { at: e.ts } : {};
      const earlier = e.seq < startSeq;
      const later = e.seq > endSeq ? { later: true } : {};
      if (e.type === 'approval') steps.push({ seq: e.seq, kind: 'approval', earlier, ...later, ...at, text: `${e.kind === 'plan' ? 'plan' : 'ticket'} ${e.decision === 'accepted' ? 'approved' : e.decision} by you${e.by === 'human' ? ', signed' : ''}` });
      else if (e.type === 'pushed') steps.push({ seq: e.seq, kind: 'push', earlier, ...later, ...at, text: `${e.proofs === 'pass' ? 'proofs checked, ' : ''}pushed ${e.sha.slice(0, 7)}` });
      else if (e.type === 'mr_opened') steps.push({ seq: e.seq, kind: 'mr', earlier, ...later, ...at, text: `MR ${e.number ? `#${e.number} ` : ''}opened` });
      else if (e.type === 'mr_merged') steps.push({ seq: e.seq, kind: 'mr', earlier, ...later, ...at, text: `MR merged into ${e.target === 'epic' ? `feature/${e.epic}` : 'the integration branch'}` });
      else if (e.type === 'mr_closed') steps.push({ seq: e.seq, kind: 'mr', earlier, ...later, ...at, text: 'MR closed without merge' });
    }
    steps.sort((a, b) => a.seq - b.seq);
    const f = facts.get(ticket) ?? { mr: 'none' };
    let mr;
    if (f.mr !== 'none') {
      const cls = config.gate?.code_paths && config.git?.integration_branch ? classifyTicket({ root: store.checkout, env: store.gitEnv, ticket, facts: f, codePaths: config.gate.code_paths, integration: config.git.integration_branch, host }) : null;
      mr = { state: f.mr, ...(f.url ? { url: f.url } : {}), ...(cls ? { m1: cls.class, ...(cls.why ? { m1_why: cls.why.slice(0, 300) } : {}) } : {}) };
    }
    const feedback = events.filter((e) => e.type === 'feedback' && e.ticket === ticket).map((e) => ({ by: e.by === 'human' ? 'you' : 'your session', ...(iso(e.ts) ? { at: e.ts } : {}), text: e.text }));
    const title = page?.title ?? '(no title)';
    tickets.push({
      ticket, title, state: page?.state ?? 'unknown', ...(page?.risk ? { risk: page.risk } : {}),
      rounds: { used: page?.rounds.used ?? 0, of: page?.rounds.of ?? 0, replans: page?.rounds.replans ?? 0, replans_of: page?.rounds.replans_of ?? 1 },
      steps: steps.map(({ seq: _seq, ...s }) => s), ...(mr ? { mr } : {}), feedback,
    });
    const mine = launches.filter((x) => x.item === ticket && x.run === id);
    if (mine.length) {
      const shares = mine.filter((x) => typeof x.limit_share === 'number');
      usage.push({ ticket, turns: sum(mine, 'turns'), tokens: mine.reduce((t, l) => t + tokensOf(l), 0), minutes: round1(sum(mine, 'minutes')), ...(shares.length === mine.length ? { limit_share: round1(sum(shares, 'limit_share')) } : {}), ...(mine.every((x) => typeof x.cost_usd === 'number') ? { cost_usd: sum(mine, 'cost_usd') } : {}) });
    }
    // Done: an MR this run opened, whatever became of it since.
    const opened = events.filter((e) => e.type === 'mr_opened' && e.ticket === ticket && e.seq >= startSeq && e.seq <= endSeq && e.url).at(-1);
    if (opened) done.push({ ticket, title, mr: opened.url });
    if (page?.state === 'blocked') parked.push({ ticket, reason: page.park_reason ?? 'parked', note: String(page.note ?? 'no note').slice(0, 500) });
    if (page?.state === 'in-progress' && page.plan && !page.plan.approved) inbox.push({ kind: 'plan', item: ticket, text: `the plan waits for your approval: mirai approve ${ticket} --plan` });
    for (const r of page?.reviews?.slice(-1) ?? []) for (const fu of r.followups) followups.push({ ticket, text: String(fu.claim ?? fu.id).slice(0, 200) });
  }

  // The red team's state for the Claude Code agents run.
  let red = { state: 'unknown' };
  try {
    const s = await redTeam({ cwd, env });
    red = { state: s.state, ...(s.result?.created_at ? { at: s.result.created_at } : {}), ...(s.parts?.claude_code?.version ? { claude_code: s.parts.claude_code.version } : {}) };
  } catch (err) {
    red = { state: 'unknown', note: String(err.message ?? err).replace(/\s+/g, ' ').slice(0, 300) };
  }
  // The known failures the run was judged against: the newest signed baseline recorded before it
  // ended (the integration branch may have moved since).
  const known = [];
  let baseline = null;
  for (const sha of baselineShas(store)) {
    try {
      const b = readBaseline(store, sha, { keys });
      if (b && (!endTs || b.created_at <= endTs) && (!baseline || b.created_at > baseline.created_at)) baseline = b;
    } catch {
      // one that doesn't verify is never used
    }
  }
  for (const [level, v] of Object.entries(baseline?.levels ?? {})) for (const k of v.known_failures ?? []) known.push(`${level}: ${String(k.id).slice(0, 200)} (${k.state})`);
  const templateGaps = events.filter((e) => e.type === 'template_gap' && e.seq >= startSeq).map((e) => ({ template: e.template.slice(0, 80), section: e.section.slice(0, 120), message: e.message.slice(0, 300) }));
  return {
    run: { id, date: `${id.slice(2, 6)}-${id.slice(6, 8)}-${id.slice(8, 10)}`, preset: started?.preset ?? 'supervised', state },
    tickets, done, parked, paused: [], followups: followups.slice(0, 500), usage, inbox, template_gaps: templateGaps.slice(0, 100), known_failures: known.slice(0, 200), branch_warnings: [], clean_due: false, red_team: red,
  };
}

// Saves the report (Markdown, every value escaped, and the data as JSON). Returns the paths.
export function saveRunReport(store, data) {
  const p = reportPaths(store, data.run.id);
  ensurePrivateDir(join(store.dir, REPORTS));
  atomicWrite(p.md, renderRunReport(data, { format: 'markdown' }));
  atomicWrite(p.json, `${JSON.stringify(data, null, 2)}\n`);
  return p;
}

// The saved report's data, or null.
export function readSavedReport(store, runId) {
  if (!checkPrivateDir(join(store.dir, REPORTS))) return null;
  const text = readPrivateFile(reportPaths(store, runId).json, { optional: true, maxBytes: 8 * 1024 * 1024 });
  if (text === null) return null;
  try {
    return JSON.parse(String(text));
  } catch {
    return null;
  }
}

// Builds and saves a run's report (at a run's end; a failure is a note, never the run's).
export async function writeRunReport({ cwd, env, runId, redTeam }) {
  const store = openStore({ cwd, env });
  const data = await runReportData({ cwd, env, runId, ...(redTeam ? { redTeam } : {}) });
  return saveRunReport(store, data);
}
