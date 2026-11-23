#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { mintLaunchToken } from '../../src/agent/requests.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { readToken } from '../../src/sign/token.js';
import { normal } from '../../src/verify/findings.js';
import { handoffText } from '../../src/verify/gate.js';
import { runVerify } from '../../src/verify/run.js';
import { render } from '../../src/install/render.js';
import { runReaderTest } from '../../src/write/reader.js';
import { setupHome } from './reader-probes.js';

// Unit 40's probes: Vera on real models. Each tier works in its own probe home (its own MIRAI store,
// its own kept copy of your PATH's Claude Code, your token copied in), as 34's reader probes do, so
// nothing is reused across tiers and nothing touches your real store. Vera runs the way `mirai
// verify` runs her (runVerify: MIRAI's launcher, the read-only template, the verify step's model),
// with the red-team gate stubbed green: a probe home has no red-team result of its own (24a's
// probes do the same). Before each check the home commits the document, as a launch needs.
//
// P1 (sets the default, decision 4): the set below, each document clean and each with one seeded
// defect per layer, on `standard` and on `deep`. Pass when at least one tier raises every seeded
// defect as a must-fix on its layer, quoting the seeded line, and raises no must-fix on a clean
// document. The cheapest such tier becomes the default ([models.steps] verify in defaults.js).
//   node test/probes/verify-probes.js --seeds-only           (no model: the set, each seed checked)
//   node test/probes/verify-probes.js --yes --probe p1       (36 runs: 18 Sonnet, 18 Opus)
// P2 (your read): Vera's findings on 34's P3 PRD, unseeded, on the default tier. You judge each
// must-fix: "would have sent it back", or "wrong".
//   node test/probes/verify-probes.js --yes --probe p2       (1 Sonnet run)
// P3 (the loop): a probe home with 31's P2 brief and the context; a fresh Claude Code session
// writes prd.md beside the brief with the mirai-write skill (as 34's P3); then:
//   node test/probes/verify-probes.js --probe p3-home                    (no model: makes the home, prints its path)
//   node test/probes/verify-probes.js --yes --probe p3-verify --home <dir>  (1 run: commits prd.md, Vera checks it, prints the hand-off)
//   node test/probes/verify-probes.js --yes --probe p3-final --home <dir>   (lint and 1 reader-test run)

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const SAMPLE = join(ROOT, 'test', 'fixtures', 'sample-app');
export const TIERS = Object.freeze([{ tier: 'standard', name: 'Sonnet' }, { tier: 'deep', name: 'Opus' }]);

// The project's context in each home: a team task app whose business rules the clean documents
// keep, and whose "signed-in members only" rule the context seed breaks.
export const PROBE_BUSINESS = `---
id: probe-business
type: business
template: business@v1
owner: product-owner
updated: "2026-11-23"
---
# Business context: the team task list

## What the product does

- Teams keep their tasks in one shared list. Members add tasks, assign them and tick them off (S-1).

## Who it's for

- Users: the signed-in members of small teams (S-1).
- Customers: the team leads, who run their team's list (S-1).

## Business model and goals

- Free while it finds its first 20 teams. A paid plan per team comes after, priced later (S-1).
- Goal: 20 teams use the app every week by the end of March 2027 (S-1).

## What this repo is responsible for

- The whole product: the web app, the API and the email it sends (S-1).

## Business rules

- Only signed-in members of a team see its tasks, or anything added to them. There are no guest accounts and no public links (S-1).
- A task belongs to one team, and to nobody outside it (S-1).

## Glossary

- Team: the people who share one task list (S-1).
- Team lead: the one person per team, set in the team's settings, who assigns its tasks (S-1).

## Constraints

- Hosted in the EU. Personal data stays there, under GDPR (S-1).

## Sources

| ID | Source | Where | Date |
|---|---|---|---|
| S-1 | The product owner, for this probe | you said | 2026-11-23 |
`;

// Inserts `lines` at the end of the part under `heading` (an exact heading line), before the
// blank lines that end it.
function appendTo(text, heading, lines) {
  const all = text.split('\n');
  const at = all.indexOf(heading);
  if (at < 0) throw new Error(`no "${heading}"`);
  const level = heading.match(/^#+/)[0].length;
  let end = all.findIndex((l, i) => i > at && /^#+ /.test(l) && l.match(/^#+/)[0].length <= level);
  if (end < 0) end = all.length;
  while (end > at + 1 && all[end - 1].trim() === '') end--;
  return [...all.slice(0, end), ...lines, ...all.slice(end)].join('\n');
}
const inSummary = (text, bullet) => appendTo(text, '### What changes', [bullet]);

// The three seeds, per kind of document. `in`: the file the seeded detail goes in (relative to the
// document's folder); `summary`: a bullet added to the top part too, so the defect is the layer's
// own and not also a hidden one. `hide`: a summary bullet taken out instead, its detail lines
// (`marks`, line prefixes) left in place: the top part hides them, and nothing else is wrong.
// `layer`: where Vera must raise it.
// P1's first run (2026-11-23): an added push notice contradicted each PRD's own channel decision
// (the example's A-1 "email only", the P3 PRD's NG-6), so it was two defects in one, raised on
// the checklist layer; a PRD's and a brief's top-vs-detail seed hides an existing requirement now.
// The brief's BR-9 repeated its own BR-3 and an open Q-1; it's a requirement with no outcome now.
const SEEDS = {
  prd: (detail, d) => [
    { key: 'checklist', layer: 'checklist', what: 'an FR with no "when"', summary: '- The app reminds assignees about their dated tasks (FR-90).', detail: [detail, '- FR-90: The app sends the assignee a reminder about a dated task.'] },
    { key: 'top-vs-detail', layer: 'top-vs-detail', what: `a requirement in the detail, its summary bullet taken out (${d.hide.marks.join(', ')})`, hide: d.hide },
    { key: 'context', layer: 'context', what: 'guests may comment, against business.md\'s signed-in members only', summary: '- Guests without an account can comment on any task through a shared link (FR-92).', detail: [detail, '- FR-92: Guests without an account can comment on any task through a shared link.'] },
  ],
  brief: (_detail, d) => [
    { key: 'checklist', layer: 'checklist', what: 'a business requirement with no outcome', summary: '- The discussion of a task works well for everyone (BR-9)', detail: ['## Business requirements', '- BR-9: The discussion of a task works well for everyone. Source: the request from the team, 2026-11-19.'] },
    { key: 'top-vs-detail', layer: 'top-vs-detail', what: `a requirement in the detail, its summary bullet taken out (${d.hide.marks.join(', ')})`, hide: d.hide },
    { key: 'context', layer: 'context', what: 'guests may comment, against business.md\'s signed-in members only', summary: '- Guests without an account can read and add comments through a shared link (BR-11).', detail: ['## Business requirements', '- BR-11: Guests without an account can read and add comments through a shared link.'] },
  ],
  epic: () => [
    { key: 'checklist', layer: 'checklist', what: 'an AC delivered "for now", wired later', in: 'tickets/SAMPLE-53.md', detail: ['## Acceptance criteria', '- AC-SAMPLE-53.9: Reminders go by email for now; the in-app version is wired later'] },
    { key: 'top-vs-detail', layer: 'top-vs-detail', what: 'a push notice in a ticket, missing from the epic\'s summary', in: 'tickets/SAMPLE-53.md', detail: ['## Acceptance criteria', '- AC-SAMPLE-53.10: When a task becomes overdue, its assignee also gets a push notice on their phone'] },
    { key: 'context', layer: 'context', what: 'guests may comment, against business.md\'s signed-in members only', summary: '- Guests without an account can comment on a task through a shared link (SAMPLE-53).', in: 'tickets/SAMPLE-53.md', detail: ['## Acceptance criteria', '- AC-SAMPLE-53.11: Guests without an account can comment on a task through a shared link'] },
  ],
  business: () => [
    { key: 'checklist', layer: 'checklist', what: 'a claim whose cited source doesn\'t say it (36\'s P2 finding)', detail: ['## Business model and goals', '- Price: 12 EUR per member per month from April 2027 (S-1).'] },
  ],
};

// The P1 set. Each entry: its folder's files ({ name: repo file }), the document checked, its kind
// and the heading its seeded detail goes under. 36's business.md is checked in place of the probe's
// context, with the sample app's files its sources name; it is the context, so it has the checklist
// seed only (it has no summary, and nothing else to contradict).
export const DOCUMENTS = Object.freeze([
  { key: 'example-prd', kind: 'prd', doc: 'prd.md', files: { 'prd.md': 'registry/examples/prd.md', 'brief.md': 'registry/examples/brief.md', 'interview.md': 'registry/examples/interview.md' }, detail: '### Triggers and states', hide: { bullet: '- A team lead sees every overdue task of the team on one page (FR-2).', marks: ['- FR-2:'] } },
  { key: 'example-epic', kind: 'epic', doc: 'epic-due-dates.md', files: { 'epic-due-dates.md': 'registry/examples/epic.md', 'prd.md': 'registry/examples/prd.md', ...Object.fromEntries(['51', '52', '53', '54', '55', '56', '57'].map((n) => [`tickets/SAMPLE-${n}.md`, `registry/examples/tickets/SAMPLE-${n}.md`])) } },
  // 31's P2 brief, an agent's draft, as P1's first run found it, with its real gaps fixed here (the
  // file itself is 31's record): the ask stated its assumptions as settled, the summary and R-1
  // answered the open Q-1, R-2 added a staged rollout nothing else named, and BR-4 was missing
  // from the summary.
  { key: 'p2-brief', kind: 'brief', doc: 'brief.md', files: { 'brief.md': 'implementation/units/31-brief/p2-agent-brief.md' }, fixes: [
    ['Approve a four-week build of task comments, so that 60% of task changes carry a written reason in the app (SM-1).', 'Approve an assumed four-week build of task comments, aiming for 60% of task changes to carry a written reason within 3 months (SM-1).'],
    ['- The owner and assignee of a task are told when someone comments (BR-3)\n', '- The people responsible for a task are told when someone comments; who exactly is decision 1 (BR-3, Q-1)\n- Only people who can already see a task can read or write its discussion (BR-4)\n'],
    ['Handled by limiting alerts to the owner and assignee (Q-1).', 'Handled by the answer to Q-1, who is told.'],
    ['Handled by a release to one team first, then a check of SM-1 after 1 month before wider release.', 'Handled by counting SM-1 from the app\'s own data.'],
  ], hide: { bullet: '- Only people who can already see a task can read or write its discussion (BR-4)', marks: ['- BR-4:'] } },
  { key: 'p3-prd', kind: 'prd', doc: 'prd.md', files: { 'prd.md': 'implementation/units/34-write/p3/prd.md', 'brief.md': 'implementation/units/34-write/p3/brief.md' }, detail: '### Triggers and states', hide: { bullet: '- Comments are permanent while the task exists. Nobody can edit or delete one (FR-14)', marks: ['- FR-14:'] } },
  { key: 'business', kind: 'business', context: true, doc: 'business.md', files: { 'business.md': 'registry/examples/context/business.md' } },
]);

// The set: [{ name, doc, kind, files: { rel: text }, check: rel, seed, layer, lines: { rel: [n] } }].
// `lines`: where the seeded text is, per file, for the match. Each seed is checked: it changes the
// files, and its text is where it says.
export function buildSet() {
  const out = [];
  for (const d of DOCUMENTS) {
    const folder = d.context ? '.mirai/context' : `docs/mirai/${d.key}`;
    const base = Object.fromEntries(Object.entries(d.files).map(([n, src]) => [`${folder}/${n}`, read(src)]));
    const check = `${folder}/${d.doc}`;
    for (const [from, to] of d.fixes ?? []) {
      if (!base[check].includes(from)) throw new Error(`${d.key}: no ${JSON.stringify(from.slice(0, 60))} to fix`);
      base[check] = base[check].replace(from, to);
    }
    out.push({ name: d.key, kind: 'clean', type: d.kind, files: base, check, seed: null, layer: null, lines: {}, context: Boolean(d.context) });
    for (const s of SEEDS[d.kind](d.detail, d)) {
      const files = { ...base };
      const marks = {};
      if (s.hide) {
        const lines = files[check].split('\n');
        const at = lines.indexOf(s.hide.bullet);
        if (at < 0) throw new Error(`${d.key} ${s.key}: no summary bullet ${JSON.stringify(s.hide.bullet)}`);
        lines.splice(at, 1);
        files[check] = lines.join('\n');
        const hit = files[check].split('\n').map((l, i) => (s.hide.marks.some((m) => l.startsWith(m)) ? i + 1 : 0)).filter(Boolean);
        if (hit.length) marks[check] = hit;
      } else {
        const into = `${folder}/${s.in ?? d.doc}`;
        const [heading, ...lines] = s.detail;
        files[into] = appendTo(files[into], heading, lines);
        if (s.summary) files[check] = inSummary(files[check], s.summary);
        for (const [rel, text] of Object.entries(files)) {
          const seeded = [...lines, ...(s.summary && rel === check ? [s.summary] : [])];
          const at = text.split('\n').map((l, i) => (seeded.includes(l) ? i + 1 : 0)).filter(Boolean);
          if (at.length) marks[rel] = at;
        }
      }
      if (!Object.keys(marks).length || Object.entries(files).every(([rel, t]) => t === base[rel])) throw new Error(`${d.key} ${s.key}: the seeding changed nothing`);
      out.push({ name: `${d.key}/${s.key}`, kind: 'seeded', type: d.kind, files, check, seed: s.what, layer: s.layer, lines: marks, context: Boolean(d.context) });
    }
  }
  return out;
}

// A probe home for `tier`: 34's setupHome (MIRAI, a key, your token, a kept Claude Code), the
// verify step's tier committed, the sample app's files, and the probe's business.md.
async function verifyHome({ workdir, tier, claude, token }) {
  const home = await setupHome({ workdir, tier: 'standard', claude, token });
  cpSync(SAMPLE, home.root, { recursive: true, filter: (src) => !src.endsWith('AGENTS.md') });
  const cfg = join(home.root, '.mirai', 'config.toml');
  const text = readFileSync(cfg, 'utf8');
  if (!text.includes('\n[models.steps]\nreader-test = "standard"\n')) throw new Error('the probe home\'s config isn\'t as setupHome writes it');
  writeFileSync(cfg, text.replace('\n[models.steps]\nreader-test = "standard"\n', `\n[models.steps]\nreader-test = "standard"\nverify = "${tier}"\n`));
  // The step's tier is the model in Vera's rendered agent file (.claude/agents/mirai-verifier.md),
  // so a tier other than the default changes the bundle: render it, as `mirai render` does, and
  // commit, or every launch is refused as stale-bundle (P1's first run, every deep check).
  render({ cwd: home.root, env: home.env });
  put(home.root, '.mirai/context/business.md', PROBE_BUSINESS);
  commit(home, `probe: the sample app, the context, verify on ${tier}`);
  return home;
}

function put(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}
function commit(home, message) {
  const env = { PATH: '/usr/bin:/bin', HOME: home.home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => spawnSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: home.root, env, encoding: 'utf8' });
  git('add', '-A');
  const st = git('status', '--porcelain');
  if (st.stdout.trim()) {
    const r = git('commit', '-qm', message);
    if (r.status !== 0) throw new Error(`git commit: ${r.stderr}`);
  }
}

const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });

// One check, as `mirai verify` makes it: { entry, outcome, why }.
async function check(home, file) {
  try {
    const r = await runVerify({ cwd: home.root, env: home.env, file, launchToken: mintLaunchToken(), launchOptions: { status: green } });
    return { entry: r.entry, outcome: r.outcome, why: r.why ?? null };
  } catch (err) {
    return { entry: null, outcome: 'error', why: `${err.code ?? ''} ${err.message}${err.hint ? ` (${err.hint})` : ''}`.trim() };
  }
}

// Whether a seeded item was caught: a must-fix finding on its layer whose line is a seeded line
// (the spec's rule). `anyLayer`: on any layer, reported beside it.
export function caught(item, entry, { anyLayer = false } = {}) {
  return (entry?.findings ?? []).some((f) => f.grade === 'must-fix' && (anyLayer || f.layer === item.layer) && (item.lines[f.where.path] ?? []).includes(f.where.line));
}
export function judge(rows) {
  const misses = rows.filter((r) => (r.kind === 'clean' ? !(r.entry && r.entry.must_fix === 0) : !caught(r, r.entry)));
  return { ok: misses.length === 0, misses };
}

async function runTier({ home, tier, set, log }) {
  const rows = [];
  // The context documents last: 36's business.md replaces the probe's context.
  for (const item of [...set.filter((s) => !s.context), ...set.filter((s) => s.context)]) {
    for (const [rel, text] of Object.entries(item.files)) put(home.root, rel, text);
    commit(home, `probe: ${item.name}`);
    const r = await check(home, item.check);
    rows.push({ ...item, ...r });
    const e = r.entry;
    log(`  ${tier.padEnd(8)} ${item.name.padEnd(28)} ${item.kind.padEnd(7)} ${e ? `${e.must_fix} must-fix, ${e.suggestions} suggestions${e.dropped?.length ? `, ${e.dropped.length} dropped` : ''}${item.kind === 'seeded' ? (caught(item, e) ? ' — caught' : ' — MISSED') : ''}` : `${r.outcome}: ${r.why}`}`);
  }
  return { tier, rows };
}

function table(result, log) {
  log(`\n${result.tier}: ${result.rows.find((r) => r.entry)?.entry.model ?? 'no model'}`);
  log('| Document | Clean or seeded (what) | Must-fix | Suggestions | Caught on its layer | On any layer |');
  log('|---|---|---|---|---|---|');
  for (const r of result.rows) log(`| ${r.name} | ${r.kind === 'clean' ? 'clean' : `seeded: ${r.seed}`} | ${r.entry?.must_fix ?? r.outcome} | ${r.entry?.suggestions ?? '—'} | ${r.kind === 'seeded' ? (caught(r, r.entry) ? 'yes' : 'no') : '—'} | ${r.kind === 'seeded' ? (caught(r, r.entry, { anyLayer: true }) ? 'yes' : 'no') : '—'} |`);
  const j = judge(result.rows);
  log(j.ok ? 'every seeded defect caught on its layer, no must-fix on a clean document' : `${j.misses.length} miss(es): ${j.misses.map((m) => m.name).join(', ')}`);
  // Each must-fix on a clean document, and what Vera said on each missed seed, for the write-up.
  for (const m of j.misses) {
    if (!m.entry) log(`  ${m.name}: ${m.outcome}: ${m.why}`);
    for (const f of (m.entry?.findings ?? []).filter((x) => x.grade === 'must-fix' || m.kind === 'seeded')) log(`  ${m.name} ${f.id} ${f.grade} ${f.layer}/${f.kind}: "${normal(f.where.quote).slice(0, 120)}" — ${f.what}`);
  }
}

function findingsReport(entry) {
  const out = [];
  for (const f of entry.findings ?? []) {
    out.push(`- **${f.id}** ${f.grade}, ${f.layer}, ${f.kind}${f.decision_type ? ` (${f.decision_type})` : ''}, ${f.where.path}:${f.where.line}`);
    out.push(`  - quote: "${normal(f.where.quote)}"`);
    if (f.against) out.push(`  - against: ${f.against.path}${f.against.line ? `:${f.against.line}` : ''}${f.against.source ? ` (${f.against.source})` : ''}`);
    out.push(`  - what: ${f.what}`, `  - fix: ${f.fix}`, '  - your call: would have sent it back / wrong');
  }
  return out.join('\n');
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, 'seeds-only': { type: 'boolean' }, probe: { type: 'string' }, home: { type: 'string' } } });
  const log = (l) => process.stdout.write(`${l}\n`);
  const set = buildSet();
  if (values['seeds-only']) {
    log(`P1's set: ${set.filter((s) => s.kind === 'clean').length} clean documents and ${set.filter((s) => s.kind === 'seeded').length} seeded ones (each seed checked)`);
    for (const s of set) log(`  ${s.name.padEnd(28)} ${s.kind}${s.seed ? `: ${s.seed} (${s.layer}; ${Object.entries(s.lines).map(([f, l]) => `${f}:${l.join(',')}`).join(' ')})` : ''}`);
    return 0;
  }
  const probe = values.probe;
  if (!['p1', 'p2', 'p3-home', 'p3-verify', 'p3-final'].includes(probe)) {
    process.stderr.write('--probe p1 | p2 | p3-home | p3-verify --home <dir> | p3-final --home <dir>; or --seeds-only, no model\n');
    return 2;
  }
  if (probe !== 'p3-home' && !values.yes) {
    process.stderr.write(`--yes: ${probe === 'p1' ? '36 runs on your Claude subscription (18 Sonnet, 18 Opus)' : probe === 'p3-final' ? 'one reader-test run' : 'one Sonnet run'}\n`);
    return 2;
  }
  const token = readToken(process.env);
  if (!token) throw new Error('no Claude login token: mirai token set');
  const claude = resolveClaude(process.env);
  if (probe === 'p3-verify' || probe === 'p3-final') {
    if (!values.home || !existsSync(join(values.home, 'repo'))) throw new Error('--home <dir>: the folder p3-home printed');
    const workdir = realpathSync(values.home);
    const home = { root: join(workdir, 'repo'), home: join(workdir, 'home'), env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(workdir, 'home'), USER: process.env.USER, LANG: 'C' } };
    const file = 'docs/mirai/p3/prd.md';
    if (!existsSync(join(home.root, file))) throw new Error(`${join(home.root, file)} isn't there yet: the session writes it first`);
    commit(home, 'probe: the PRD as the agent left it');
    if (probe === 'p3-verify') {
      const r = await check(home, file);
      if (!r.entry) throw new Error(`Vera didn't record a result: ${r.outcome}: ${r.why}`);
      const e = r.entry;
      log(`round ${e.round}: ${e.must_fix} must-fix, ${e.suggestions} suggestions (model ${e.model})`);
      log(findingsReport(e));
      log(e.must_fix ? `\nThe hand-off for the session (paste it in as it is):\n\n${handoffText(e, { file })}` : '\nNo must-fix finding: run p3-final.');
      return 0;
    }
    const lint = spawnSync(process.execPath, [join(ROOT, 'bin', 'mirai.js'), 'lint', file], { cwd: home.root, env: home.env, encoding: 'utf8' });
    log(`lint (exit ${lint.status}):\n${lint.stdout}${lint.stderr}`);
    const rt = await runReaderTest({ cwd: home.root, env: home.env, file });
    log(`reader test: ${rt.entry.result}${rt.entry.failed.length ? ` (${rt.entry.failed.join(', ')})` : ''}, round ${rt.entry.round}`);
    return lint.status === 0 && rt.entry.result === 'pass' ? 0 : 1;
  }
  const keep = probe === 'p3-home';
  const workdirs = [];
  try {
    if (probe === 'p3-home') {
      const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
      workdirs.push(workdir);
      const home = await verifyHome({ workdir, tier: 'standard', claude, token });
      put(home.root, 'docs/mirai/p3/brief.md', read('implementation/units/31-brief/p2-agent-brief.md'));
      commit(home, 'probe: 31\'s P2 brief');
      log(`the P3 home: ${workdir}\n  its repo: ${home.root}\n  the brief: ${join(home.root, 'docs/mirai/p3/brief.md')}\n  the PRD goes beside it: ${join(home.root, 'docs/mirai/p3/prd.md')}`);
      return 0;
    }
    if (probe === 'p2') {
      const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
      workdirs.push(workdir);
      const home = await verifyHome({ workdir, tier: 'standard', claude, token });
      const item = set.find((s) => s.name === 'p3-prd');
      for (const [rel, text] of Object.entries(item.files)) put(home.root, rel, text);
      commit(home, 'probe: 34\'s P3 PRD');
      const r = await check(home, item.check);
      if (!r.entry) throw new Error(`Vera didn't record a result: ${r.outcome}: ${r.why}`);
      log(`P2: Vera on 34's P3 PRD (model ${r.entry.model}): ${r.entry.must_fix} must-fix, ${r.entry.suggestions} suggestions${r.entry.dropped.length ? `, ${r.entry.dropped.length} dropped (${r.entry.dropped.map((d) => d.why).join('; ')})` : ''}\n`);
      log(findingsReport(r.entry));
      return 0;
    }
    log(`P1: ${set.length} documents per tier. Claude Code on your PATH: ${claude.version}; each probe home keeps its own copy of it`);
    const homes = [];
    for (const t of TIERS) {
      const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
      workdirs.push(workdir);
      homes.push({ ...t, home: await verifyHome({ workdir, tier: t.tier, claude, token }) });
    }
    const results = await Promise.all(homes.map((h) => runTier({ home: h.home, tier: h.tier, set, log })));
    for (const r of results) table(r, log);
    const ok = Object.fromEntries(results.map((r) => [r.tier, judge(r.rows).ok]));
    const recommended = ok.standard ? 'standard' : ok.deep ? 'deep' : null;
    log(`\nverdict: ${recommended ? 'PASS' : 'FAIL'} (standard ${ok.standard ? 'clean' : 'missed some'}, deep ${ok.deep ? 'clean' : 'missed some'})`);
    log(`recommended default for [models.steps] verify: ${recommended ?? 'none (neither tier is clean)'}`);
    return recommended ? 0 : 1;
  } finally {
    if (!keep) {
      for (const w of workdirs) {
        spawnSync('/bin/chmod', ['-R', 'u+rwX', w]);
        rmSync(w, { recursive: true, force: true });
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
