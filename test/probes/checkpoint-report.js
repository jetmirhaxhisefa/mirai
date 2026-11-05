#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { buildRecordPath } from '../../src/agent/build.js';
import { readLoop } from '../../src/loop/guard.js';
import { openStore } from '../../src/store/home.js';
import { readRunLog, runIds } from '../../src/store/run-log.js';
import { readTicketStatus } from '../../src/store/tickets.js';

// Unit 21d: the checkpoint's numbers for one ticket, read-only, from the store: every launch's
// run-log line across runs (step, round, tier, model, outcome, turns, tokens, minutes, limit
// share), MIRAI's checks lines, the last build.json, the loop counters and the ticket's state.
// `mirai report` is unit 29's; this is what the checkpoint needs, and what 29 should show.
//   node test/probes/checkpoint-report.js --ticket SAMPLE-2 [--cwd <the sample app>]

const num = (v) => (Number.isFinite(v) ? v : 0);

export function ticketReport(store, ticket) {
  const launches = [];
  const checks = [];
  const skipped = [];
  for (const runId of runIds(store)) {
    // A run whose log can't be read is named, never the whole report lost.
    let lines;
    try {
      lines = readRunLog(store, runId).lines;
    } catch (err) {
      skipped.push(`${runId}: ${String(err.message).slice(0, 120)}`);
      continue;
    }
    for (const l of lines) {
      if (l.item !== ticket) continue;
      if (l.event === 'agent_run') launches.push({ run: runId, ...l });
      else if (l.event === 'checks') checks.push({ run: runId, ...l });
    }
  }
  // A share Claude Code reported, or one you read by hand ('manual'), counts; the rest are unknown.
  const known = (l) => ['measured', 'manual'].includes(l.limit_share_source) && Number.isFinite(l.limit_share);
  const measured = launches.filter(known);
  const totals = {
    launches: launches.length,
    turns: launches.reduce((n, l) => n + num(l.turns), 0),
    tokens_in: launches.reduce((n, l) => n + num(l.tokens_in), 0),
    tokens_out: launches.reduce((n, l) => n + num(l.tokens_out), 0),
    tokens_cached: launches.reduce((n, l) => n + num(l.tokens_cached), 0),
    minutes: Math.round(launches.reduce((n, l) => n + num(l.minutes), 0) * 100) / 100,
    // A share is summed only over launches that measured one; the others are named.
    limit_share: measured.length ? measured.reduce((n, l) => n + num(l.limit_share), 0) : null,
    limit_share_unknown: launches.length - measured.length,
  };
  let build = null;
  try {
    build = JSON.parse(readFileSync(buildRecordPath(store, ticket), 'utf8'));
  } catch {
    build = null;
  }
  let loop = null;
  try {
    loop = readLoop(store, ticket);
  } catch {
    loop = null;
  }
  return { ticket, state: readTicketStatus(store, ticket)?.status?.state ?? null, launches, checks, totals, build, loop, skipped };
}

const cell = (v) => String(v ?? '–').replaceAll('|', '\\|');
export function renderReport(r) {
  const rows = r.launches.map((l) => `| ${[l.step, l.round, l.tier, l.model_used ?? l.model, l.outcome, l.turns, l.tokens_in, l.tokens_out, l.tokens_cached, l.minutes, ['measured', 'manual'].includes(l.limit_share_source) && Number.isFinite(l.limit_share) ? `${l.limit_share}${l.limit_share_source === 'manual' ? ' (manual)' : ''}` : 'unknown'].map(cell).join(' | ')} |`);
  const t = r.totals;
  return [
    `# ${r.ticket}: the checkpoint's numbers`,
    '',
    `State: ${r.state ?? 'unknown'}. Last step: ${r.build?.outcome ?? 'none'}${r.build?.round ? ` (fix round ${r.build.round})` : ''}.`,
    '',
    '| Step | Round | Tier | Model | Outcome | Turns | Tokens in | Tokens out | Cached | Minutes | Limit share |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
    `| **Total** | | | | ${t.launches} launches | ${t.turns} | ${t.tokens_in} | ${t.tokens_out} | ${t.tokens_cached} | ${t.minutes} | ${t.limit_share ?? 'unknown'}${t.limit_share_unknown ? ` (${t.limit_share_unknown} unknown)` : ''} |`,
    '',
    '**MIRAI\'s checks:**',
    ...(r.checks.length ? r.checks.map((c) => `- ${(c.named ?? []).map((n) => `${n.name} ${n.result}`).join(', ') || 'no levels named'}; tests passed ${c.tests?.passed ?? '?'}, failed ${c.tests?.failed ?? '?'}, skipped ${c.tests?.skipped ?? '?'}`) : ['- none']),
    '',
    ...(r.skipped.length ? ['', `**Runs that couldn't be read:** ${r.skipped.join('; ')}`] : []),
    '',
    `**Loop:** ${r.loop ? `rounds used ${r.loop.rounds_used}, reviews ${r.loop.reviews}, re-plans ${r.loop.replans_used}${r.loop.parked ? `, parked (${r.loop.parked.reason})` : ''}` : 'no state'}.`,
    '',
  ].join('\n');
}

async function cli() {
  const { values } = parseArgs({ options: { ticket: { type: 'string' }, cwd: { type: 'string' }, json: { type: 'boolean' } } });
  if (!values.ticket) {
    process.stderr.write('--ticket <id> [--cwd <project>] [--json]\n');
    return 2;
  }
  const store = openStore({ cwd: resolve(values.cwd ?? process.cwd()), env: process.env });
  const r = ticketReport(store, values.ticket);
  process.stdout.write(values.json ? `${JSON.stringify(r, null, 2)}\n` : renderReport(r));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
