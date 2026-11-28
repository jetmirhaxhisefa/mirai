#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { mintLaunchToken } from '../../src/agent/requests.js';
import { exitCodeOf, formatError } from '../../src/cli/errors.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { readToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { approveQuestions, runResearch } from '../../src/design/research.js';
import { answersOf, decide, exploreState } from '../../src/design/explore.js';
import { decisionProblems, decisionsIn } from '../../src/design/decisions.js';
import { designSubject, readDoc } from '../../src/design/run.js';
import { adrSettings, listAdrs, workTreeReader } from '../../src/adr/adr.js';
import { tessHome } from './tess-probes.js';
import { arlo, commit, note, put, setup, term } from './design-probes.js';

// Unit 65b's probes (spec "Probes (real)"), in a probe home (the sample app, your token), the
// red-team gate stubbed green (a probe home has no red-team result; P2 is the red team itself, on
// the runner):
// - P1, the whole `full` flow: the owner-only due dates on `full`; two real design questions for
//   the sample app (Laravel 11 on MySQL 8); the question list approved; a real research run (real
//   web search, the research template, the fetch gate); research.md through its lint with the run's
//   evidence; your decisions recorded with the probe key (Q-1 the research's pick, marked hard to
//   reverse; Q-2 left to Arlo); Arlo's run 1 following them, through the lint and Vera's checks.
//   Checks: the research is done and its quotes check out; the HLD cites the pick, an ADR is written
//   from the hard one, and the decisions' mechanical check is clean.
// - P3, `standard` with --explore on one question: the research run, one decision, the technical
//   note citing it.
//
//   node test/probes/research-probes.js --yes --probe p1 | --probe p3

const D = 'docs/mirai/due-dates';
const OUT = new URL('../../implementation/units/65b-design-research/', import.meta.url).pathname;
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });

const questions = (items) => `---
id: due-dates-research-questions
type: research-questions
template: research-questions@v1
owner: you
created: "2026-11-28"
initiative: due-dates
---
# Design questions: due dates on tasks

## Stack summary

Laravel 11 on PHP 8.3 with MySQL 8, a React front end calling a JSON API; one app server.

## Questions

${items.map((q, i) => `### Q-${i + 1}: ${q.q}\n\nWhy it matters: ${q.why}\n`).join('\n')}`;

const Q_DATE = { q: 'Should a task\'s due date be stored as a MySQL DATE column or a DATETIME (or TIMESTAMP) column in Laravel 11?', why: 'it decides the migration, how "overdue" is compared, and whether a time of day can be added later without a data migration.' };
const Q_RULE = { q: 'Should the API validate a due date with Laravel\'s built-in date rules (such as after_or_equal:today) or with a custom rule that uses the browser\'s time zone?', why: 'the built-in "today" is the server\'s, which can be a day off for the user.' };

async function research(home, log, items) {
  put(home, `${D}/research-questions.md`, questions(items));
  commit(home, 'probe: the design questions');
  const a = approveQuestions({ cwd: home.root, env: home.env, initiative: 'due-dates' });
  note(home, `probe --auto: the ${a.questions.length} design question(s) approved, as you would in your session`);
  log(`questions approved: ${a.questions.map((q) => q.id).join(', ')}`);
  const onStep = (e) => log(e.kind === 'launch' ? `research: ${e.step} (round ${e.round}): ${e.outcome}` : `lint, research.md: ${e.problems ? `${e.problems} problem(s)` : 'clean'}`);
  const started = Date.now();
  const r = await runResearch({ cwd: home.root, env: home.env, initiative: 'due-dates', nextToken: () => mintLaunchToken(), launchOptions: { status: green }, onStep });
  log(`research: ${r.state}${r.why ? `: ${r.why}` : ''}; ${r.searches} search(es), ${r.fetches} page(s) read, ${r.launches} launch(es), ${Math.round((Date.now() - started) / 60000)} min`);
  for (const p of (r.problems ?? []).slice(0, 8)) log(`  lint: line ${p.line}: ${p.code}: ${p.reason}`);
  const last = readJournal(openStore({ cwd: home.root, env: home.env })).events.filter((e) => e.type === 'design_research').at(-1);
  log(`journal: design_research ${last?.state}, suspicious pages: ${last?.suspicious ?? '-'}`);
  return r;
}

function decideAll(home, log, plan) {
  const st = exploreState({ cwd: home.root, env: home.env, initiative: 'due-dates' });
  log(`explore phase: ${st.phase}`);
  for (const a of answersOf(st.research)) {
    const how = plan[a.id] ?? { pick: 'arlo', hard: 'no' };
    const pick = how.pick === 'research' ? a.pick?.letter ?? a.options[0]?.letter : how.pick;
    const d = decide({ cwd: home.root, env: home.env, initiative: 'due-dates', question: a.id, pick, reason: how.reason ?? '', hard: how.hard });
    log(`decided ${a.id}: ${d.decision.pick}${d.decision.hard ? ' (hard to reverse)' : ''}${d.problems.length ? `; lint: ${d.problems.map((p) => p.reason).join('; ')}` : ''}`);
  }
  commit(home, 'probe: the design decisions');
  note(home, 'probe --auto: the design decisions recorded, as you would in your session');
  return exploreState({ cwd: home.root, env: home.env, initiative: 'due-dates' });
}

function keep(home, dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [from, to] of files) if (existsSync(join(home.root, from))) cpSync(join(home.root, from), join(dir, to));
}

function followed(home, doc) {
  const s = designSubject({ cwd: home.root, env: home.env, initiative: 'due-dates', clean: false });
  const decisions = decisionsIn((t) => readDoc(s, t));
  const adrs = listAdrs(workTreeReader(home.root), adrSettings({})).filter((a) => a.mirai && a.initiative === 'due-dates');
  return { problems: decisionProblems(decisions, readDoc(s, doc), adrs), decisions, adrs };
}

export async function p1(home, log) {
  const checks = {};
  await setup(home, log, { track: 'full', offer: true });
  checks.offer = /Next: the design questions, in your session: \/mirai design --explore due-dates/.test(home.offerOut ?? '');
  const waits = await term(home, ['design', 'due-dates'], []);
  checks.arloWaits = waits.code !== 0 && /design questions aren't settled yet/.test(waits.err);
  const r = await research(home, log, [Q_DATE, Q_RULE]);
  checks.research = r.state === 'done';
  if (!checks.research) return checks;
  const st = decideAll(home, log, { 'Q-1': { pick: 'research', reason: 'the research run\'s pick fits: a due date has no time of day here', hard: 'yes' }, 'Q-2': { pick: 'arlo', hard: 'no' } });
  checks.decided = st.phase === 'done';
  const d = await arlo(home, log);
  checks.design = d.state === 'done';
  const f = followed(home, 'hld');
  for (const p of f.problems) log(`  decisions: ${p.reason}`);
  checks.followsPicks = checks.design && f.problems.length === 0;
  checks.adrFromHardPick = f.adrs.some((a) => /design-decisions\.md[^\n]*Q-1/.test(a.text));
  checks.noSecondPause = !readJournal(openStore({ cwd: home.root, env: home.env })).events.some((e) => e.type === 'design_run' && e.hard === true);
  const lint = await term(home, ['lint', D], []);
  log(lint.out.trim().split('\n').filter((l) => !/hint:|warning:/.test(l)).slice(-6).join('\n'));
  checks.lintClean = lint.code === 0;
  keep(home, join(OUT, 'p1'), [[`${D}/research-questions.md`, 'research-questions.md'], [`${D}/research.md`, 'research.md'], [`${D}/design-decisions.md`, 'design-decisions.md'], [`${D}/hld.md`, 'hld.md'], [`${D}/lld.md`, 'lld.md'], ...f.adrs.map((a) => [a.path, a.path.split('/').at(-1)])]);
  return checks;
}

export async function p3(home, log) {
  const checks = {};
  await setup(home, log, { track: 'standard' });
  const st0 = exploreState({ cwd: home.root, env: home.env, initiative: 'due-dates' });
  checks.standardDoesntWait = st0.track === 'standard';
  const r = await research(home, log, [Q_DATE]);
  checks.research = r.state === 'done';
  if (!checks.research) return checks;
  const st = decideAll(home, log, { 'Q-1': { pick: 'research', reason: 'a due date here is a day, with no time', hard: 'no' } });
  checks.decided = st.phase === 'done';
  const d = await arlo(home, log);
  checks.note = d.state === 'done' && (d.written ?? []).includes('tech-note');
  const f = followed(home, 'tech-note');
  for (const p of f.problems) log(`  decisions: ${p.reason}`);
  checks.followsPick = checks.note && f.problems.length === 0;
  keep(home, join(OUT, 'p3'), [[`${D}/research-questions.md`, 'research-questions.md'], [`${D}/research.md`, 'research.md'], [`${D}/design-decisions.md`, 'design-decisions.md'], [`${D}/tech-note.md`, 'tech-note.md']]);
  return checks;
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, probe: { type: 'string' } } });
  const log = (l) => process.stdout.write(`${l}\n`);
  if (!values.yes || !['p1', 'p3'].includes(values.probe)) {
    process.stderr.write('--yes --probe p1 (full: research, decisions, Arlo) | --yes --probe p3 (standard, one question)\n');
    return 2;
  }
  const token = readToken(process.env);
  if (!token) throw new Error('no Claude login token: mirai token set');
  const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
  const home = { ...(await tessHome({ workdir, key: `65b-${values.probe}`, c: { initiative: 'due-dates' }, claude: resolveClaude(process.env), token })), workdir, home: join(workdir, 'home') };
  log(`the probe home: ${home.workdir}`);
  let checks;
  try {
    checks = values.probe === 'p1' ? await p1(home, log) : await p3(home, log);
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
