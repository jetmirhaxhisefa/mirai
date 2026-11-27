#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { parseArgs } from 'node:util';

import { mintLaunchToken } from '../../src/agent/requests.js';
import { exitCodeOf, formatError } from '../../src/cli/errors.js';
import { main } from '../../src/cli/main.js';
import { readFrontmatter } from '../../src/lint/frontmatter.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { contentHash } from '../../src/sign/sign.js';
import { loadSigner } from '../../src/sign/signer.js';
import { readToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { appendEvent, readJournal } from '../../src/store/journal.js';
import { readVerifyResults } from '../../src/store/verify-results.js';
import { runDesign } from '../../src/design/run.js';
import { decisionsForYou } from '../../src/design/sitting.js';
import { parseDocument } from '../../src/lint/lint.js';
import { adrSettings, listAdrs, workTreeReader } from '../../src/adr/adr.js';
import { designStateLines } from '../../src/design/state.js';
import { seedPrdChecks, tessHome } from './tess-probes.js';
import { FAKE_CLAUDE, fakeReader } from '../helpers/reader.js';
import { runReaderTest } from '../../src/write/reader.js';

// Unit 64's probes (spec "Probes (real)"): Arlo on real models, in a probe home (34's setupHome, the
// sample app, your token), the red-team gate stubbed green (a probe home has no red-team result; P4
// is the red team itself, on the runner).
// - P1 + P2 (one run of Arlo, `full`, the `design` step on the deep tier, then `lld`): the
//   owner-only due dates (44's PRD, which fits the sample app) on `full`, in a home that also holds
//   P2's plants: a backend convention (every validation refusal from a Form Request class), an
//   accepted ADR of an earlier initiative that settles "today" (the browser's zone), and a decoy (a
//   legacy controller that validates inline and returns its own error shape, marked "don't copy").
//   Checks: the run ends done; the HLD and its ADRs and the LLD lint clean; the HLD follows the
//   accepted ADR (links it, proposes no new ADR on the same question), cites the convention, and
//   never builds on the decoy. Vera's findings are printed for you to judge.
// - P3 (`standard`, the `tech-note` step): the owner-only due dates as they are (44's PRD): a
//   lint-clean technical note.
//
//   node test/probes/design-probes.js --yes --probe p1 | --probe p3

const D = 'docs/mirai/due-dates';
const FIX = new URL('../fixtures/sample-due-dates/', import.meta.url).pathname;
const OUT = new URL('../../implementation/units/64-arlo/', import.meta.url).pathname;
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const git = (home, ...a) => spawnSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: home.root, env: { PATH: '/usr/bin:/bin', HOME: home.home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, encoding: 'utf8' });
const commit = (home, m) => {
  git(home, 'add', '-A');
  if (git(home, 'status', '--porcelain').stdout.trim()) git(home, 'commit', '-qm', m, '--no-verify');
};
async function term(home, argv, answers) {
  let out = '';
  let err = '';
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: home.env, cwd: home.root });
  return { code, out, err };
}
const put = (home, rel, text) => {
  mkdirSync(dirname(join(home.root, rel)), { recursive: true });
  writeFileSync(join(home.root, rel), text);
};
const idOf = (home, rel) => readFrontmatter(readFileSync(join(home.root, rel)))?.value?.id;

// P2's plants.
const CONVENTION = '- A validation refusal comes from a Form Request class and answers 422 with Laravel\'s `{ message, errors }` body; a controller never validates inline (judgment).\n  Example: `StoreTaskRequest` holds the title\'s rules for `TaskController::store`.\n';
const ACCEPTED_ADR = `---
id: ADR-0001
type: adr
template: adr@v1
status: accepted
date: "2026-11-10"
decision_makers: [the product owner, the architect]
confidence: high
gate: [cross-cutting]
components: [the task API]
owner: mirai-architect
created: "2026-11-10"
---
# Judge "today" in the time zone the browser sends with each request

## Summary

In the context of dates the app judges as past or late, facing a server that knows no user's time zone, we decided for the browser sending its zone with each request to achieve a "today" that matches the user's own day, accepting that a request without the header is judged in UTC.

## Context and problem

The calendar view needs the user's own day: a task due today must not flip at midnight UTC for a user in Berlin. The app stores no time zone per user.

## Options considered

### The browser sends its zone with each request

- Good, because the browser always knows it, and nothing new needs keeping.
- Bad, because a request without the header is judged in UTC.

### A time zone stored on each user

- Good, because the server knows it without the browser.
- Bad, because a setting goes stale when a user travels, and nobody keeps it right.

## Decision

We chose the browser's zone with each request, because it is always right where the user is and needs no setting.

## Consequences

- Good, because no setting can go stale.
- Bad, because a request without the header is judged in UTC.
- Neutral, because the header name, \`X-Time-Zone\`, is the API's to keep.

## Confirmation

review: each change that judges a date as past or late takes "today" from the \`X-Time-Zone\` header, or UTC without one.

## Revisit when

- Users ask for reminders sent while their browser is closed.
`;
const DECOY = `<?php

namespace App\\Http\\Controllers;

use Illuminate\\Http\\JsonResponse;
use Illuminate\\Http\\Request;

// Legacy: kept for the old reports page only. Don't copy this pattern: it validates inline and
// returns its own error shape, which the conventions replaced with Form Request classes.
class LegacyReportController extends Controller
{
    public function export(Request $request): JsonResponse
    {
        if (! $request->has('from')) {
            return response()->json(['error' => ['code' => 'from_required', 'text' => 'from is required']], 400);
        }

        return response()->json(['rows' => []]);
    }
}
`;

async function setup(home, log, { track, offer = false }) {
  for (const n of ['interview.md']) put(home, `${D}/${n}`, readFileSync(join(FIX, n), 'utf8'));
  const brief = readFileSync(join(FIX, 'brief.md'), 'utf8');
  put(home, `${D}/brief.md`, track === 'full' ? brief.replace(/^track: standard$/m, 'track: full').replace(/Track: standard[^\n]*/, 'Track: full, because the design is reviewed before the tickets are cut.') : brief);
  const prd = readFileSync(join(FIX, 'prd.md'), 'utf8');
  put(home, `${D}/prd.md`, track === 'full' ? prd.replace('track: standard', 'track: full') : prd);
  put(home, '.mirai/context/business.md', readFileSync(join(FIX, 'business.md'), 'utf8'));
  if (track === 'full') {
    // P2's plants: the convention, the accepted ADR (with your signed line), the decoy.
    const conv = join(home.root, '.mirai/context/conventions-backend.md');
    const before = existsSync(conv) ? readFileSync(conv, 'utf8') : readFileSync(new URL('../../registry/examples/context/conventions-backend.md', import.meta.url), 'utf8');
    put(home, '.mirai/context/conventions-backend.md', before.replace('## Rules\n\n', `## Rules\n\n${CONVENTION}`));
    put(home, 'docs/decisions/ADR-0001-browser-time-zone.md', ACCEPTED_ADR);
    put(home, 'backend/app/Http/Controllers/LegacyReportController.php', DECOY);
    const idx = await term(home, ['adr', 'index'], []);
    if (idx.code !== 0) throw new Error(`mirai adr index: ${idx.err.trim()}`);
  }
  commit(home, `probe: the owner-only due dates on ${track}${track === 'full' ? ', with P2\'s plants' : ''}`);
  if (track === 'full') {
    const store = openStore({ cwd: home.root, env: home.env });
    appendEvent(store, { type: 'approval', by: 'human', item: 'ADR-0001', kind: 'adr', path: 'docs/decisions/ADR-0001-browser-time-zone.md', content_hash: contentHash(Buffer.from(ACCEPTED_ADR)), decision: 'accepted', answered_after_s: 1 }, { signer: loadSigner(home.env, store) });
    note(home, 'probe --auto: ADR-0001 (calendar-view) accepted with the probe home\'s key, as an earlier initiative\'s');
  }
  await seedPrdChecks(home, `${D}/prd.md`);
  if (track === 'full') {
    // On full the brief is approved on its own, from its own summary: its reader test, seeded too.
    const r = fakeReader();
    await runReaderTest({ cwd: home.root, env: home.env, file: `${D}/brief.md`, launch: r.launch, claude: FAKE_CLAUDE });
    const briefId = idOf(home, `${D}/brief.md`);
    const b = await term(home, ['approve', briefId, '--file', `${D}/brief.md`], ['a', briefId, 'n']);
    if (b.code !== 0) throw new Error(`the brief's approval: ${b.err.trim()}`);
  }
  const prdId = idOf(home, `${D}/prd.md`);
  const a = await term(home, ['approve', prdId, '--file', `${D}/prd.md`], ['a', prdId, 'n']);
  if (offer) home.offerOut = a.out;
  if (a.code !== 0) throw new Error(`the PRD's approval: ${a.err.trim()}`);
  note(home, `probe --auto: the brief and ${prdId} approved with the probe home's key`);
  log(`the home: ${track}, PRD ${prdId} approved`);
}
const note = (home, message) => appendEvent(openStore({ cwd: home.root, env: home.env }), { type: 'note', by: 'script', message });

async function arlo(home, log) {
  const onStep = (e) => log(e.kind === 'launch' ? `Arlo: ${e.step} ${e.doc} (round ${e.round}): ${e.outcome}` : e.kind === 'lint' ? `lint, ${e.doc}: ${e.errors ? `${e.errors} problem(s)` : 'clean'}` : `Vera, ${e.file}: round ${e.round}, ${e.must_fix} must-fix${e.reused ? ' (reused)' : ''}`);
  const r = await runDesign({ cwd: home.root, env: home.env, initiative: 'due-dates', nextToken: () => mintLaunchToken(), launchOptions: { status: green }, onStep });
  const store = openStore({ cwd: home.root, env: home.env });
  for (const l of designStateLines(readJournal(store).events, 'due-dates')) log(l);
  if (r.why) log(`why: ${r.why}`);
  // Vera's findings, for you to judge (about the design, not the format).
  const files = [...['hld', 'lld', 'tech-note'].map((t) => `${D}/${t}.md`), ...(existsSync(join(home.root, 'docs/decisions')) ? readdirSync(join(home.root, 'docs/decisions')).filter((n) => /^ADR-\d+/.test(n)).map((n) => `docs/decisions/${n}`) : [])].filter((p) => existsSync(join(home.root, p)));
  for (const rel of files) {
    const id = idOf(home, rel);
    let results = [];
    try {
      results = readVerifyResults(store, id);
    } catch {
      results = [];
    }
    for (const v of results) for (const f of v.findings ?? []) log(`  Vera ${id} r${v.round}: ${f.grade} ${f.kind}${f.decision_type ? `/${f.decision_type}` : ''}: ${f.what}`);
  }
  return r;
}

function keep(home, dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [from, to] of files) if (existsSync(join(home.root, from))) cpSync(join(home.root, from), join(dir, to));
}

export async function p1(home, log) {
  const checks = {};
  await setup(home, log, { track: 'full' });
  const r = await arlo(home, log);
  checks.done = r.state === 'done';
  checks.hld = (r.written ?? []).includes('hld');
  const hld = existsSync(join(home.root, D, 'hld.md')) ? readFileSync(join(home.root, D, 'hld.md'), 'utf8') : '';
  const lld = hld && /^lld: required$/m.test(hld);
  if (lld) checks.lld = (r.written ?? []).includes('lld');
  // His documents and any ADR he wrote (the planted ADR-0001 is the probe's own fixture).
  const own = readdirSync(join(home.root, 'docs/decisions')).filter((n) => /^ADR-\d+/.test(n) && n !== 'ADR-0001-browser-time-zone.md').map((n) => `docs/decisions/${n}`);
  const lint = await term(home, ['lint', D, ...own], []);
  log(lint.out.trim().split('\n').filter((l) => !/hint:|warning:/.test(l)).slice(-8).join('\n'));
  checks.lintClean = lint.code === 0;
  // P2: follows the accepted ADR, cites the convention, never builds on the decoy.
  const adrs = readdirSync(join(home.root, 'docs/decisions')).filter((n) => /^ADR-\d+/.test(n));
  const newOnToday = adrs.filter((n) => n !== 'ADR-0001-browser-time-zone.md').filter((n) => /zone|today|time/i.test(readFileSync(join(home.root, 'docs/decisions', n), 'utf8').split('\n').find((l) => l.startsWith('# ')) ?? ''));
  log(`ADRs now: ${adrs.join(', ')}; new ones on "today": ${newOnToday.join(', ') || 'none'}`);
  checks.followsAdr = /ADR-0001-browser-time-zone\.md/.test(hld) && newOnToday.length === 0;
  checks.citesConvention = /Form Request|conventions-backend/i.test(hld);
  checks.noDecoy = !/LegacyReportController/.test(hld) || /don't copy|legacy/i.test(hld.split('\n').find((l) => /LegacyReportController/.test(l)) ?? '');
  keep(home, join(OUT, 'p1'), [[`${D}/hld.md`, 'hld.md'], [`${D}/lld.md`, 'lld.md'], ...adrs.map((n) => [`docs/decisions/${n}`, n])]);
  return checks;
}

export async function p3(home, log) {
  const checks = {};
  await setup(home, log, { track: 'standard' });
  const r = await arlo(home, log);
  checks.done = r.state === 'done';
  checks.note = (r.written ?? []).includes('tech-note');
  const lint = await term(home, ['lint', D], []);
  log(lint.out.trim().split('\n').filter((l) => !/hint:|warning:/.test(l)).slice(-6).join('\n'));
  checks.lintClean = lint.code === 0;
  const adrs = existsSync(join(home.root, 'docs/decisions')) ? readdirSync(join(home.root, 'docs/decisions')).filter((n) => /^ADR-\d+/.test(n)) : [];
  keep(home, join(OUT, 'p3'), [[`${D}/tech-note.md`, 'tech-note.md'], ...adrs.map((n) => [`docs/decisions/${n}`, n])]);
  return checks;
}

// ---- Unit 65's probes ---------------------------------------------------------------------------
// - P1: the whole `full` flow: the PRD's approval offers Arlo (answered n here; the run is started
//   as `mirai design` starts it); his runs (an early pause on a hard-to-reverse ADR answered with his
//   own guess, as you might); the set check; the sitting with the probe home's key (every answer as
//   written); Tess offered.
// - P2 (the same home, after P1): two tickets citing every LLD item, one merged; a change through
//   `--change`; the impact names both (one to re-cut, one flagged).

async function sitting(home, log) {
  const hld = readFileSync(join(home.root, D, 'hld.md'), 'utf8');
  const doc = parseDocument(hld, 'hld.md');
  const decisions = decisionsForYou(doc);
  const proposed = listAdrs(workTreeReader(home.root), adrSettings({})).filter((a) => a.mirai && a.initiative === 'due-dates' && a.status === 'proposed');
  const r = fakeReader();
  await runReaderTest({ cwd: home.root, env: home.env, file: `${D}/hld.md`, launch: r.launch, claude: FAKE_CLAUDE });
  const id = idOf(home, `${D}/hld.md`);
  const answers = [...decisions.map(() => ''), ...proposed.map(() => 'y'), 'a', id, 'n'];
  const out = await term(home, ['approve', id, '--file', `${D}/hld.md`], answers);
  note(home, `probe --auto: the design set ${id} approved at its sitting with the probe home's key (every answer as written)`);
  log(out.out.split('\n').filter((l) => /^(HLD|LLD|ADR|approved|accepted|Decision|Arlo's call|Start|tickets|nothing)/.test(l)).join('\n'));
  if (out.code !== 0) log(out.err.trim());
  return { code: out.code, out: out.out, decisions: decisions.length, adrs: proposed.length };
}

export async function p65(home, log) {
  const checks = {};
  await setup(home, log, { track: 'full', offer: true });
  checks.offer = /Start Arlo \(mirai-architect\) on the design now\? \[y\/N\]/.test(home.offerOut ?? '');
  let r = await arlo(home, log);
  if (r.state === 'paused' && r.question_id) {
    const p = join(home.root, D, 'interview.md');
    const t = readFileSync(p, 'utf8');
    const guess = new RegExp(`### ${r.question_id}:[^]*?Guess: ([A-D])`).exec(t)?.[1] ?? 'A';
    writeFileSync(p, t.replace('state: paused', 'state: confirmed').replace(new RegExp(`(### ${r.question_id}:[^]*?Answer:)\\n`), `$1 ${guess}.\n`));
    commit(home, `probe: ${r.question_id} answered ${guess} (his own guess)`);
    log(`the early pause on ${r.question_id} answered ${guess}`);
    checks.hardPause = Boolean(readJournal(openStore({ cwd: home.root, env: home.env })).events.filter((e) => e.type === 'design_run').some((e) => e.hard));
    r = await arlo(home, log);
  }
  checks.done = r.state === 'done';
  const sit = await sitting(home, log);
  const ev = readJournal(openStore({ cwd: home.root, env: home.env })).events;
  const kinds = ev.filter((e) => e.type === 'approval' && ['hld', 'lld', 'adr'].includes(e.kind) && e.item !== 'ADR-0001').map((e) => e.kind);
  log(`signed at the sitting: ${kinds.join(', ')}; your answers: ${ev.filter((e) => e.type === 'design_decision').length}`);
  checks.signed = sit.code === 0 && kinds.includes('hld') && (!/^lld: required$/m.test(readFileSync(join(home.root, D, 'hld.md'), 'utf8')) || kinds.includes('lld'));
  checks.tessOffered = /Start Tess \(mirai-ticket-planner\) on the ticket set now\?/.test(sit.out);
  keep(home, join(OUT, '..', '65-design-workflow', 'p1'), [[`${D}/hld.md`, 'hld.md'], [`${D}/lld.md`, 'lld.md']]);
  return checks;
}

export async function p65change(home, log, { resumed = false } = {}) {
  const checks = {};
  if (resumed) {
    // The home after P1 (and a first P2 run that paused on a change of requirements): undo that
    // pause's commit, and approve the unchanged PRD again so his paused run is behind you.
    const last = git(home, 'log', '-1', '--format=%s').stdout.trim();
    if (/ask|round 1/.test(last)) git(home, 'reset', '-q', '--hard', 'HEAD~1');
    const prdId = idOf(home, `${D}/prd.md`);
    await seedPrdChecks(home, `${D}/prd.md`);
    const a = await term(home, ['approve', prdId, '--file', `${D}/prd.md`], ['a', prdId, 'n']);
    log(`the PRD approved again (unchanged): ${a.code === 0 ? 'ok' : a.err.trim()}`);
  }
  const lld = readFileSync(join(home.root, D, 'lld.md'), 'utf8');
  const items = [...new Set([...lld.matchAll(/^ *\| *`?([CS]-[0-9]+)`? *\|/gm)].map((m) => m[1]))];
  if (!existsSync(join(home.root, D, 'tickets', 'SAMPLE-91.md'))) {
  const ticket = (key, title) => readFileSync(new URL('../../registry/examples/tickets/SAMPLE-51.md', import.meta.url), 'utf8').replaceAll('SAMPLE-51', key).replace(/^# .*$/m, `# ${title}`).replace(/^type: story$/m, `type: story\nuses: [${items.join(', ')}]`);
  put(home, `${D}/tickets/SAMPLE-91.md`, ticket('SAMPLE-91', 'Not built yet'));
  put(home, `${D}/tickets/SAMPLE-92.md`, ticket('SAMPLE-92', 'Built and merged'));
  commit(home, 'probe: two tickets citing every LLD item');
  appendEvent(openStore({ cwd: home.root, env: home.env }), { type: 'mr_merged', by: 'script', ticket: 'SAMPLE-92', target: 'integration' });
  }
  log(`tickets SAMPLE-91 (unbuilt) and SAMPLE-92 (merged) cite ${items.join(', ')}`);
  const onStep = (e) => log(e.kind === 'launch' ? `Arlo: ${e.step} ${e.doc} (round ${e.round}): ${e.outcome}` : e.kind === 'lint' ? `lint, ${e.doc}: ${e.errors ? `${e.errors} problem(s)` : 'clean'}` : `Vera, ${e.file}: round ${e.round}, ${e.must_fix} must-fix`);
  // A design-only change (the first P2 run asked for a due time, a change of requirements, and he
  // rightly paused to send it through the PRD): the zone travels as a query parameter.
  const r = await runDesign({ cwd: home.root, env: home.env, initiative: 'due-dates', change: 'The browser sends its time zone as a `tz` query parameter on each write instead of the X-Time-Zone header, because the company proxy strips unknown headers. What the owner sees and every rule stay as they are.', nextToken: () => mintLaunchToken(), launchOptions: { status: green }, onStep });
  log(`his change run: ${r.state}${r.why ? `: ${r.why}` : ''}`);
  checks.done = r.state === 'done';
  if (r.impact) log(`impact: changed ${[...r.impact.ids.decisions, ...r.impact.ids.adrs, ...r.impact.ids.items].join(', ') || 'nothing cited'}; re-cut: ${r.impact.unbuilt.map((x) => x.id).join(', ') || 'none'}; flagged: ${r.impact.built.map((x) => x.id).join(', ') || 'none'}`);
  checks.impact = Boolean(r.impact) && r.impact.unbuilt.some((x) => x.id === 'SAMPLE-91') && r.impact.built.some((x) => x.id === 'SAMPLE-92');
  const hld = readFileSync(join(home.root, D, 'hld.md'), 'utf8');
  checks.changelog = /^changelog:/m.test(hld) || /^changelog:/m.test(readFileSync(join(home.root, D, 'lld.md'), 'utf8'));
  const lint = await term(home, ['lint', D], []);
  checks.lintClean = lint.code === 0;
  log(lint.out.trim().split('\n').filter((l) => !/hint:|warning:/.test(l)).slice(-4).join('\n'));
  keep(home, join(OUT, '..', '65-design-workflow', 'p2'), [[`${D}/hld.md`, 'hld.md'], [`${D}/lld.md`, 'lld.md']]);
  return checks;
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, probe: { type: 'string' }, home: { type: 'string' } } });
  const log = (l) => process.stdout.write(`${l}\n`);
  if (!values.yes || !['p1', 'p3', 'p65', 'p65change'].includes(values.probe) || (values.probe === 'p65change' && !values.home)) {
    process.stderr.write('--yes --probe p1 (full, with P2\'s plants; deep then standard) | --yes --probe p3 (standard)\n');
    return 2;
  }
  const token = readToken(process.env);
  if (!token) throw new Error('no Claude login token: mirai token set');
  let home;
  if (values.home) {
    const workdir = realpathSync(values.home);
    home = { workdir, root: join(workdir, 'repo'), home: join(workdir, 'home'), env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(workdir, 'home'), USER: process.env.USER, LANG: 'C' } };
  } else {
    const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
    home = { ...(await tessHome({ workdir, key: values.probe, c: { initiative: 'due-dates' }, claude: resolveClaude(process.env), token })), workdir, home: join(workdir, 'home') };
  }
  log(`the probe home: ${home.workdir}`);
  let checks;
  try {
    if (values.probe === 'p65change') checks = Object.fromEntries(Object.entries(await p65change(home, log, { resumed: true })).map(([k, v]) => [`p2.${k}`, v]));
    else if (values.probe === 'p65') {
      const a = await p65(home, log);
      const b = Object.values(a).every(Boolean) ? await p65change(home, log) : { change: false };
      checks = { ...Object.fromEntries(Object.entries(a).map(([k, v]) => [`p1.${k}`, v])), ...Object.fromEntries(Object.entries(b).map(([k, v]) => [`p2.${k}`, v])) };
    } else checks = values.probe === 'p1' ? await p1(home, log) : await p3(home, log);
  } catch (err) {
    log(`stopped: ${formatError(err, process.env).trim()}`);
    checks = { ran: false };
  }
  const pass = Object.values(checks).every(Boolean);
  if (pass) {
    spawnSync('/bin/chmod', ['-R', 'u+rwX', home.workdir]);
    rmSync(home.workdir, { recursive: true, force: true });
    log('the home is deleted');
  } else log(`the home is kept: ${home.workdir}`);
  for (const [k, v] of Object.entries(checks)) log(`${v ? 'pass' : 'FAIL'}  ${k}`);
  log(`${values.probe}: ${pass ? 'PASS' : 'FAIL'}`);
  return pass ? 0 : 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url).pathname)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(formatError(err, process.env));
    process.exit(exitCodeOf(err));
  });
}
