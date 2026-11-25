#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';

import { mintLaunchToken } from '../../src/agent/requests.js';
import { main } from '../../src/cli/main.js';
import { readFrontmatter } from '../../src/lint/frontmatter.js';
import { driveTicket, STEPS } from '../../src/run/drive.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { findCli, hostFor, TOOLS_FILE } from '../../src/ship/host.js';
import { readToken } from '../../src/sign/token.js';
import { pushBranch } from '../../src/store/git.js';
import { openStore } from '../../src/store/home.js';
import { appendEvent } from '../../src/store/journal.js';
import { traceDocuments } from '../../src/trace/documents.js';
import { traceTicket } from '../../src/trace/ticket.js';
import { snapshot, trustedRegistry } from '../../src/trust/snapshot.js';
import { passVera } from '../helpers/vera.js';
import { setup } from './fix-probes.js';
import { autoApprove, CASES, tessHome } from './tess-probes.js';

// Unit 43's probes: `mirai trace` on real models and the real host. Each runs in its own probe home
// under your home folder (its own MIRAI store, your token copied in), with the red-team gate stubbed
// green (a probe home has no red-team result). Every approval and signature in a home is made with
// the probe home's own key, never yours, through `mirai approve` with a stand-in terminal (as unit
// 28's r1 and 42's --auto do); a journal note says so after each one.
//
// - P1 (Sonnet: Kai plans and builds, Rex reviews; about 40 min): the sample app's SAMPLE-1 cut to
//   two ACs. `mirai run` plans; the probe approves the plan; `mirai run` again records the baseline,
//   builds, reviews, records the proofs (trace runs on the gate's own results) and opens one PR on
//   your GitHub sample app, on a throwaway base branch (as 27a's P1). Clean-up: the PR closed, the
//   branches deleted.
// - P2 (as P1, plus a fix round): before the gate, the probe takes AC-SAMPLE-1.2's test out by hand
//   (its name loses the ID, so it no longer proves the AC) and commits it; Rex reviews that commit;
//   the gate's trace stops the ship and sends Kai the must-fix naming AC-SAMPLE-1.2; his fix round
//   names the test again; Rex, the gate, and the PR.
// - P3 (no model): 42's example epic and its seven tickets on a P1 home of unit 42 (the PRD approved
//   with the probe key), with SAMPLE-53's AC-FR-4.5 taken out of its covers_ac. `mirai approve` of
//   the epic refuses, naming AC-FR-4.5; `mirai trace due-dates` names it with where to fix it.
//
//   node test/probes/trace-probes.js --check                              (no model, no network: builds each home in a temp folder with a stand-in token, checks it, deletes it)
//   node test/probes/trace-probes.js --yes --probe p1|p2 [--repo owner/name] [--app <sample app>]   (runs with no typing)
//   node test/probes/trace-probes.js --probe p3                           (no model: makes the home, prints your steps)
//   node test/probes/trace-probes.js --probe p3 --auto                    (no model, no typing: the same steps, by the probe)

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const MIRAI = join(ROOT, 'bin', 'mirai.js');
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const STANDIN = `sk-ant-oat01-${'Probe_u43_ck'.repeat(4)}`;
const TICKET_FILE = 'docs/mirai/tickets/SAMPLE-1.md';
export const REMOVED = 'SAMPLE-1.2-taken-out-by-the-probe';

// SAMPLE-1 with two ACs: its third (the 404) taken out.
export function twoAcs(ticket) {
  const out = ticket.replace(/- AC-SAMPLE-1\.3:[^]*?(?=\n## |\n*$)/, '').replace(/\n{3,}/g, '\n\n');
  if (/AC-SAMPLE-1\.3/.test(out) || !/AC-SAMPLE-1\.2/.test(out)) throw new Error('SAMPLE-1 isn\'t the ticket this probe expects');
  return `${out.replace(/\n+$/, '')}\n`;
}

// P2's hand edit: every test file the branch changed loses AC-SAMPLE-1.2 from its test names, so no
// test proves it any more (as a test taken out or renamed would). Returns the files changed.
export function takeOutTest({ root, git }) {
  const files = git('diff', '--name-only', 'main...HEAD').split('\n').filter((p) => /(^|\/)tests?\/|\.(test|spec)\.[a-z]+$|Test\.php$/.test(p));
  const changed = [];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(join(root, f), 'utf8');
    } catch {
      continue;
    }
    if (!text.includes('AC-SAMPLE-1.2')) continue;
    writeFileSync(join(root, f), text.replaceAll('AC-SAMPLE-1.2', REMOVED));
    changed.push(f);
  }
  return changed;
}

// A terminal for `mirai <argv>` in the home: typed answers, its output kept.
async function term(argv, { cwd, env }, answers = []) {
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  let out = '';
  let err = '';
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (t) => (out += t) }, stderr: { write: (t) => (err += t) }, env, cwd });
  return { code, out, err };
}
const note = (io, message) => appendEvent(openStore(io), { type: 'note', by: 'script', message });

// The P1/P2 home: 21c's (the sample app, MIRAI, a key, your token or the stand-in), SAMPLE-1 with two ACs.
function ticketHome({ app, workdir, token }) {
  const ctx = setup({ app, workdir, token });
  const text = twoAcs(readFileSync(join(ctx.root, TICKET_FILE), 'utf8'));
  writeFileSync(join(ctx.root, TICKET_FILE), text);
  // The sample app's planted flaky test out of the clone (as 24a's and 28's probes): not this probe's.
  ctx.git('rm', '-q', '--ignore-unmatch', 'frontend/src/flaky-seed.test.ts');
  // The sample app's own overlays (37's P2: Rex with Bash) are approved with your key, which a probe
  // home doesn't have, so they'd refuse Rex's launch (P2's first run): out of the clone.
  ctx.git('rm', '-r', '-q', '--ignore-unmatch', '.mirai/custom');
  ctx.git('add', '-A');
  ctx.git('commit', '-qm', 'probe: SAMPLE-1 with two ACs (unit 43)');
  return { ...ctx, ticket: text };
}

// What --check says of a P1/P2 home: SAMPLE-1 has two ACs, trace (before any gate run) names both,
// and no overlay is left that the probe key didn't approve. (A person's lone ticket isn't linted at
// approval, 42's answer 4, so its lint isn't checked here: SAMPLE-1 is the older v1 form.)
function checkTicketHome(ctx) {
  const t = traceTicket({ ticket: { path: TICKET_FILE, fm: readFrontmatter(ctx.ticket).value, text: ctx.ticket }, cases: [], ranGate: false });
  return { missing: t.missing.map((m) => m.id), overlays: ctx.git('ls-files', '.mirai/custom').trim().split('\n').filter(Boolean) };
}

// Whether P1 or P2 passed, from what the run did: { pass, why }. `gates`: each gate's result in
// order; `fixes`: each fix's; `check`: the gate check's outcome word; `mr`: the PR's URL or null.
export function shipVerdict({ p2, gates, fixes = [], check, mr }) {
  const both = (r) => ['AC-SAMPLE-1.1', 'AC-SAMPLE-1.2'].every((ac) => r?.trace?.links?.some((l) => l.from === ac && l.state === 'pass'));
  const last = gates.at(-1);
  if (p2) {
    const first = gates[0];
    if (!first) return { pass: false, why: 'the ticket never reached the gate' };
    if (first.outcome !== 'trace-failed' || !first.trace?.missing?.some((m) => m.id === 'AC-SAMPLE-1.2')) return { pass: false, why: `the first gate was ${first.outcome}, not a trace failure naming AC-SAMPLE-1.2` };
    if (!fixes.some((f) => f.outcome === 'handed-over')) return { pass: false, why: 'no fix round handed over after the trace failure' };
  }
  if (!last || last.outcome !== 'recorded') return { pass: false, why: last ? `the last gate was ${last.outcome}${last.why ? `: ${String(last.why).slice(0, 200)}` : ''}` : 'the ticket never reached the gate' };
  if (last.trace?.result !== 'pass' || !both(last)) return { pass: false, why: 'the proofs\' trace isn\'t a pass with both AC links' };
  if (check !== 'pass') return { pass: false, why: `the gate check says ${check ?? 'nothing'}` };
  if (!mr) return { pass: false, why: 'no PR was opened' };
  return { pass: true, why: null };
}

// The throwaway base on GitHub and a host that opens the PR against it (27a's P1, 28's r1).
function githubHost(ctx, store, repo) {
  const gh = findCli('gh', process.env, ctx.root);
  if (!gh) return { problem: 'no gh on your PATH' };
  writeFileSync(join(store.dir, TOOLS_FILE), JSON.stringify({ schema_version: 1, github: gh }), { mode: 0o600 });
  const base = `mirai-probe/base-${randomBytes(3).toString('hex')}`;
  const remoteUrl = `https://github.com/${repo}.git`;
  const real = (a) => hostFor({ ...a, remoteUrl, cliHome: process.env.HOME });
  const ghRun = (...args) => spawnSync(gh, args, { env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }, encoding: 'utf8' });
  const last = ghRun('api', `repos/${repo}/pulls?state=all&per_page=1&sort=created&direction=desc`, '--jq', '.[0].number // 0');
  const before = Number(String(last.stdout).trim()) || 0;
  const hostOf = (a) => {
    const h = real(a);
    const ours = (mr) => (mr && Number(/\/pull\/(\d+)/.exec(mr.url ?? '')?.[1] ?? 0) > before ? mr : null);
    return { ...h, branchTip: (b) => h.branchTip(b === 'main' ? base : b), openMr: (o) => h.openMr({ ...o, base }), findMr: (b) => ours(h.findMr(b)) };
  };
  const host = real({ config: { git: { integration_branch: 'main' } }, store, env: ctx.env, root: ctx.root });
  const pb = pushBranch(ctx.root, host.pushUrl, base, ctx.git('rev-parse', 'main').trim(), store.gitEnv, { helper: host.helper });
  return { hostOf, base, pushed: pb, ghRun };
}

const events = (log, label) => (e) => {
  if (e.type === 'step') log(`${label}: [${e.step}]`);
  else if (e.type === 'step-done') log(`${label}: [${e.step}] ${e.outcome}${e.why ? `: ${String(e.why).slice(0, 300)}` : ''}`);
};
const traceLog = (log, label, r) => {
  if (!r?.trace) return;
  log(`${label}: trace ${r.trace.result}, ${r.trace.links.filter((l) => l.state === 'pass').length} link(s)`);
  for (const l of r.trace.links) log(`${label}:   ${l.state === 'pass' ? `ok       ${l.from} → ${l.to}` : `missing  ${l.what}`}`);
};

// P1 and P2: one ticket through `mirai run`, with no typing (the probe home's key approves).
async function ship(ctx, repo, { p2 }) {
  const label = p2 ? 'p2' : 'p1';
  const io = { cwd: ctx.root, env: ctx.env };
  const store = openStore(io);
  passVera({ root: ctx.root, env: ctx.env }, TICKET_FILE);
  const a = await term(['approve', 'SAMPLE-1', '--file', TICKET_FILE], io, ['a', 'SAMPLE-1']);
  if (a.code !== 0) throw new Error(`approve SAMPLE-1: ${a.err}`);
  note(io, 'probe (unit 43): SAMPLE-1 approved with the probe home\'s key, not yours');
  ctx.log(`AUTO: SAMPLE-1 approved with the probe key (two ACs: AC-SAMPLE-1.1, AC-SAMPLE-1.2)`);
  const opts = { claude: ctx.claude, status: green };
  const d1 = await driveTicket({ ...io, ticket: 'SAMPLE-1', launchOptions: opts, onEvent: events(ctx.log, `${label}-run1`) });
  if (d1.stop?.kind !== 'gate-plan') {
    ctx.log(`${label}: the run stopped before the plan gate: ${d1.stop?.why ?? d1.outcome}`);
    ctx.keep = true;
    return { pass: false, why: 'the run stopped before the plan gate' };
  }
  const ap = await term(['approve', 'SAMPLE-1', '--plan'], io, ['a', 'SAMPLE-1']);
  if (ap.code !== 0) throw new Error(`approve the plan: ${ap.err}`);
  note(io, 'probe (unit 43): SAMPLE-1\'s plan approved with the probe home\'s key, not yours');
  ctx.log('AUTO: the plan approved with the probe key');
  const plan = readFileSync(join(store.dir, 'tickets', 'SAMPLE-1', 'plan.md'), 'utf8');
  const named = (plan.match(/::(?:AC-SAMPLE-1\.[12]|test_ac_sample_1_[12]_)[^`|]*/g) ?? []).map((x) => x.slice(2).trim());
  ctx.log(`${label}-plan: test names carrying an AC: ${named.length ? named.join(' | ') : 'NONE (Kai\'s plan doesn\'t name its tests with the ACs)'}`);

  const gh = githubHost(ctx, store, repo);
  if (gh.problem) {
    ctx.log(`${label}: ${gh.problem}; stopped`);
    return { pass: false, why: gh.problem };
  }
  const cleanups = [() => gh.ghRun('api', '--method', 'DELETE', `repos/${repo}/git/refs/heads/${gh.base}`)];
  let taken = false;
  const gates = [];
  const fixes = [];
  const steps = {
    ...STEPS,
    recordProofs: async (o) => {
      // P2: the first time the ticket reaches the gate, its AC-SAMPLE-1.2 test is taken out by hand.
      if (p2 && !taken) {
        taken = true;
        const files = takeOutTest(ctx);
        if (!files.length) {
          ctx.log('p2: no test file of the branch names AC-SAMPLE-1.2, so there is nothing to take out (P1 would fail first)');
          return { outcome: 'needs-you', why: 'nothing to take out' };
        }
        ctx.git('add', '-A');
        ctx.git('commit', '-qm', 'probe: AC-SAMPLE-1.2\'s test taken out by hand (unit 43, P2)');
        ctx.log(`p2-hand: AC-SAMPLE-1.2 taken out of ${files.join(', ')}, committed; Rex reviews that commit first`);
        const rv = await STEPS.runReview({ cwd: o.cwd, env: o.env, ticket: 'SAMPLE-1', launchToken: mintLaunchToken(), launchOptions: opts });
        ctx.log(`p2-review: ${rv.outcome}${rv.why ? `: ${String(rv.why).slice(0, 300)}` : ''}${rv.blocking?.length ? `; blocking ${rv.blocking.join(', ')}` : ''}`);
        if (rv.outcome !== 'pass') {
          ctx.log('p2: Rex caught the missing test before the gate (his findings go to Kai): trace\'s own stop isn\'t exercised in this run');
          gates.push({ outcome: `review ${rv.outcome}` });
          return { outcome: rv.outcome === 'changes' ? 'trace-failed' : 'needs-you', why: `Rex: ${rv.outcome}` };
        }
      }
      const r = await STEPS.recordProofs(o);
      ctx.log(`${label}-gate: ${r.outcome}${r.why ? `: ${String(r.why).slice(0, 400)}` : ''}`);
      traceLog(ctx.log, `${label}-gate`, r);
      gates.push(r);
      return r;
    },
    runFix: async (o) => {
      const r = await STEPS.runFix(o);
      ctx.log(`${label}-fix: ${r.outcome}${r.why ? `: ${String(r.why).slice(0, 300)}` : ''}; rounds ${r.rounds?.length ?? 0}`);
      fixes.push(r);
      return r;
    },
  };
  try {
    ctx.log(`${label}-base: ${gh.base}: ${gh.pushed.ok ? 'pushed' : `REFUSED ${gh.pushed.why}`}`);
    if (!gh.pushed.ok) return { pass: false, why: `the base branch wasn't pushed: ${gh.pushed.why}` };
    const d2 = await driveTicket({ ...io, ticket: 'SAMPLE-1', steps, launchOptions: { ...opts, hostOf: gh.hostOf }, onEvent: events(ctx.log, `${label}-run2`) });
    ctx.log(`${label}-run2: ${d2.outcome}${d2.stop ? ` (${d2.stop.kind}): ${String(d2.stop.why).slice(0, 300)}` : ''}${d2.mr ? `; PR ${d2.mr}` : ''}`);
    const branch = JSON.parse(readFileSync(join(store.dir, 'tickets', 'SAMPLE-1', 'build.json'), 'utf8')).branch;
    cleanups.push(() => gh.ghRun('api', '--method', 'DELETE', `repos/${repo}/git/refs/heads/${branch}`));
    const pr = /\/pull\/(\d+)/.exec(d2.mr ?? '')?.[1];
    if (pr) cleanups.unshift(() => gh.ghRun('pr', 'close', pr, '--repo', repo));
    // CI's check of the proof: `mirai gate check` with the integration branch's keys only.
    const check = await term(['gate', 'check', 'SAMPLE-1', '--commit', ctx.git('rev-parse', branch).trim()], io);
    for (const l of check.out.split('\n').filter((x) => x.trim())) ctx.log(`${label}-check| ${l}`);
    const t = await term(['trace', 'SAMPLE-1'], io);
    for (const l of t.out.split('\n').filter((x) => x.trim())) ctx.log(`${label}-trace| ${l}`);
    if (d2.outcome !== 'finished') ctx.keep = true;
    const checked = /^gate check SAMPLE-1 at [0-9a-f]+: ([a-z-]+)/m.exec(check.out)?.[1] ?? null;
    const v = shipVerdict({ p2, gates, fixes, check: checked, mr: d2.mr ?? null });
    ctx.log(v.pass ? `${label}: PASS` : `${label}: FAIL: ${v.why}`);
    return v;
  } finally {
    for (const c of cleanups) {
      const x = c();
      ctx.log(`${label}-cleanup: ${x.status === 0 ? 'ok' : /Reference does not exist/.test(String(x.stderr)) ? 'ok (never pushed)' : `exit ${x.status} ${String(x.stderr).trim().slice(0, 160)}`}`);
    }
  }
}

// ---- P3 ------------------------------------------------------------------------------------------

const D = 'docs/mirai/due-dates';
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
export const P3_TICKET = (text) => {
  if (!text.includes('AC-FR-4.4, AC-FR-4.5,')) throw new Error('SAMPLE-53 isn\'t the example this probe expects');
  return text.replace('AC-FR-4.4, AC-FR-4.5,', 'AC-FR-4.4,');
};

// 42's P1 home (the sample app, the brief, the interview and the PRD, its checks seeded) with the
// example epic and its tickets, SAMPLE-53 without AC-FR-4.5, committed on the home's branch.
export async function setHome({ workdir, token, claude = null }) {
  const home = await tessHome({ workdir, key: 'p1', c: CASES.p1, claude, token });
  const files = { [`${D}/epic-due-dates.md`]: read('registry/examples/epic.md') };
  for (const f of ['51', '52', '53', '54', '55', '56', '57']) files[`${D}/tickets/SAMPLE-${f}.md`] = read(`registry/examples/tickets/SAMPLE-${f}.md`);
  files[`${D}/tickets/SAMPLE-53.md`] = P3_TICKET(files[`${D}/tickets/SAMPLE-53.md`]);
  for (const [rel, text] of Object.entries(files)) {
    spawnSync('/bin/mkdir', ['-p', dirname(join(home.root, rel))]);
    writeFileSync(join(home.root, rel), text);
  }
  const g = (...a) => spawnSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: home.root, env: { PATH: '/usr/bin:/bin', HOME: join(workdir, 'home'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, encoding: 'utf8' });
  g('add', '-A');
  g('commit', '-qm', 'probe: the example epic and its tickets, SAMPLE-53 without AC-FR-4.5 (unit 43, P3)');
  return { ...home, workdir, files };
}

export function setTrace(home) {
  const trust = snapshot({ cwd: home.root, env: home.env });
  const doc = (rel) => ({ path: rel, text: readFileSync(join(home.root, rel), 'utf8') });
  return traceDocuments({ initiative: 'due-dates', registry: trustedRegistry(trust), brief: doc(`${D}/brief.md`), prd: doc(`${D}/prd.md`), epic: doc(`${D}/epic-due-dates.md`), interview: doc(`${D}/interview.md`), tickets: Object.keys(home.files).filter((r) => r.includes('/tickets/')).map(doc) });
}

function p3Steps(home, log) {
  const mirai = `HOME=${home.home} node ${MIRAI}`;
  log(`the probe home: ${home.workdir}`);
  log(`  its repo: ${home.root} (branch probe-p1)`);
  log('');
  log('1. Approve the PRD (its checks are seeded: the PRD is the probe\'s input). In Terminal:');
  log(`   cd ${home.root} && ${mirai} approve due-dates-prd --file ${D}/prd.md`);
  log('   You see the brief and the PRD, "one decision approves both", Vera passed and the reader test passed. Answer a, then type due-dates-prd.');
  log('2. Approve the set (its SAMPLE-53 no longer covers AC-FR-4.5):');
  log(`   cd ${home.root} && ${mirai} approve SAMPLE-50 --file ${D}/epic-due-dates.md`);
  log('   You see it refused before any question: "AC-FR-4.5 (an AC of FR-4, Triggers and states) isn\'t covered by any ticket", and "nothing was written".');
  log('3. The chain, link by link:');
  log(`   cd ${home.root} && ${mirai} trace due-dates`);
  log('   You see "trace due-dates (the documents): fail", an ok line per link, and "missing  AC-FR-4.5 isn\'t covered by any ticket (fix in: docs/mirai/due-dates/tickets/ …)".');
  log('4. P3 passes when step 2 refuses naming AC-FR-4.5 and step 3 names it with where to fix it.');
  log(`At the end, delete the home: chmod -R u+w ${home.workdir} && rm -rf ${home.workdir}`);
}

// P3 with no typing: the probe home's key approves the PRD; the set's approval is asked for and must refuse.
export async function p3Auto(home, log) {
  await autoApprove(home, CASES.p1, log);
  const io = { cwd: home.root, env: home.env };
  const r = await term(['approve', 'SAMPLE-50', '--file', `${D}/epic-due-dates.md`], io, ['a', 'SAMPLE-50']);
  log(`AUTO: approve SAMPLE-50: exit ${r.code}`);
  for (const l of `${r.err}`.split('\n').filter((x) => x.trim())) log(`  approve| ${l}`);
  const t = await term(['trace', 'due-dates'], io);
  for (const l of t.out.split('\n').filter((x) => /fail|missing|pass/.test(x))) log(`  trace| ${l}`);
  const refused = r.code !== 0 && /AC-FR-4\.5/.test(r.err);
  const named = t.code !== 0 && /missing {2}AC-FR-4\.5 isn't covered by any ticket \(fix in: docs\/mirai\/due-dates\/tickets\//.test(t.out);
  log(`p3: ${refused && named ? 'PASS' : 'FAIL'}: the approval ${refused ? 'refused, naming AC-FR-4.5' : 'did NOT refuse naming AC-FR-4.5'}; mirai trace ${named ? 'names it with where to fix it' : 'does NOT name it'}`);
  return refused && named;
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, check: { type: 'boolean' }, auto: { type: 'boolean' }, probe: { type: 'string' }, app: { type: 'string' }, repo: { type: 'string' } } });
  const log = (l) => process.stdout.write(`${l}\n`);
  const app = resolve(values.app ?? join(process.env.HOME, 'Projects', 'mirai-sample-app'));
  if (values.check) {
    let bad = 0;
    const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'mirai-u43-check-')));
    const workdir = tmp();
    try {
      const ctx = ticketHome({ app, workdir, token: STANDIN });
      const c = checkTicketHome(ctx);
      const clean = ctx.git('status', '--porcelain').trim() === '';
      log(`p1/p2 SAMPLE-1 with two ACs: home built, tree ${clean ? 'clean' : 'NOT clean'}, overlays ${c.overlays.length ? c.overlays.join(', ') : 'none'}; trace before a gate run names ${c.missing.join(', ')}`);
      if (!clean || c.overlays.length || c.missing.join() !== 'AC-SAMPLE-1.1,AC-SAMPLE-1.2') bad += 1;
    } finally {
      spawnSync('/bin/chmod', ['-R', 'u+rwX', workdir]);
      rmSync(workdir, { recursive: true, force: true });
    }
    const w3 = tmp();
    try {
      const home = await setHome({ workdir: w3, token: STANDIN });
      const t = setTrace(home);
      log(`p3 the example set without AC-FR-4.5: home built, trace ${t.result}, missing ${t.missing.map((m) => m.id).join(', ') || 'none'}`);
      if (t.result !== 'fail' || t.missing.map((m) => m.id).join() !== 'AC-FR-4.5') bad += 1;
    } finally {
      spawnSync('/bin/chmod', ['-R', 'u+rwX', w3]);
      rmSync(w3, { recursive: true, force: true });
    }
    return bad ? 1 : 0;
  }
  if (values.probe === 'p3') {
    const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
    const home = await setHome({ workdir, token: STANDIN });
    if (!values.auto) {
      p3Steps(home, log);
      return 0;
    }
    try {
      return (await p3Auto(home, log)) ? 0 : 1;
    } finally {
      spawnSync('/bin/chmod', ['-R', 'u+rwX', workdir]);
      rmSync(workdir, { recursive: true, force: true });
    }
  }
  if (!['p1', 'p2'].includes(values.probe) || !values.yes) {
    process.stderr.write('--check (no model); --probe p3 [--auto] (no model); or --yes --probe p1|p2: your Claude subscription (Sonnet: Kai\'s plan and build, Rex\'s reviews; p2 adds a fix round and a second review), Docker, and a PR opened then closed on your GitHub sample-app repo\n');
    return 2;
  }
  const token = readToken(process.env);
  if (!token) throw new Error('no Claude login token: mirai token set');
  const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
  const ctx = { log, workdir, keep: false };
  let passed = false;
  try {
    Object.assign(ctx, ticketHome({ app, workdir, token }), { log, workdir, claude: resolveClaude(process.env).real });
    const v = await ship(ctx, values.repo ?? 'jetmirhaxhisefa/mirai-sample-app', { p2: values.probe === 'p2' });
    passed = Boolean(v?.pass);
    if (!v) log(`${values.probe}: FAIL: the probe ended early`);
  } finally {
    spawnSync('/bin/chmod', ['-R', 'u+rwX', workdir]);
    if (ctx.keep) log(`kept for a look: ${workdir} (delete it after: chmod -R u+w ${workdir} && rm -rf ${workdir})`);
    else rmSync(workdir, { recursive: true, force: true });
  }
  return passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
