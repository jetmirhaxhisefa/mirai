#!/usr/bin/env node
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { mintLaunchToken } from '../../src/agent/requests.js';
import { documentApproval } from '../../src/cli/commands/approve.js';
import { exitCodeOf, formatError, MiraiError } from '../../src/cli/errors.js';
import { render } from '../../src/install/render.js';
import { lintText, projectOf } from '../../src/lint/lint.js';
import { readFrontmatter } from '../../src/lint/frontmatter.js';
import { runNora } from '../../src/nora/run.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { readToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { runTess } from '../../src/tess/run.js';
import { tessStateLines } from '../../src/tess/state.js';
import { snapshot, trustedConfig, trustedRegistry } from '../../src/trust/snapshot.js';
import { runReaderTest } from '../../src/write/reader.js';
import { BRIEF_READY, INTERVIEW, PRD_READY } from '../helpers/docs-fixtures.js';
import { FAKE_CLAUDE, fakeReader } from '../helpers/reader.js';
import { passVera } from '../helpers/vera.js';
import { probeLoop } from './loop.js';
import { setupHome } from './reader-probes.js';

// Unit 42's probes: Tess on real models, each in its own probe home under your home folder (its own
// MIRAI store, its own kept copy of your PATH's Claude Code, your token copied in), as 41's are. Her
// run is started from your Terminal by this script, exactly as `mirai tickets` runs it (runTess:
// MIRAI's launcher, her role, the tickets step's model, the epic rendered, the lint and Vera between
// her launches), with the red-team gate stubbed green (a probe home has no red-team result).
//
// The PRD is the probes' input, not what they test: the home holds 33's example brief, interview and
// PRD (due dates on tasks, for the sample app), and the PRD's own checks (Vera's pass, a reader
// test) are seeded with no model, so your approval of it in Terminal is the one step before her.
// P3 (one ticket by hand) has no PRD: your session's short interview is its input.
//
// A probe home has no session server, so the session there has no /mirai: the steps give it the
// probe's own commands, with HOME set to the probe's home.
//
//   node test/probes/tess-probes.js --check                          (no model: builds each case's home in a temp folder, lints its documents, deletes it)
//   node test/probes/tess-probes.js --probe home --case p1|p2|p3|p4  (no model: makes the home, prints the steps)
//   node test/probes/tess-probes.js --yes --probe loop --home <dir>  (her run; after a pause, Nora brings the PRD in line, you approve it again, and her run starts again)
//   node test/probes/tess-probes.js --probe show --home <dir>        (no model: her state, the documents, the ready tickets)

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SAMPLE = join(ROOT, 'test', 'fixtures', 'sample-app');
const MIRAI = join(ROOT, 'bin', 'mirai.js');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// P2's seed: one AC of the PRD made untestable (the roadmap's "an AC nobody could test").
const UNTESTABLE = 'reminders are sent reliably';
function prdWithGap(prd) {
  const m = /^( *- AC-FR-4\.1: [^\n]*\n)((?: {2,}- [^\n]*\n)+)/m.exec(prd);
  if (!m) throw new Error('the example PRD has no AC-FR-4.1 to seed');
  return prd.replace(m[0], `${m[1]}  - ${UNTESTABLE}\n`);
}

// P4: your work's ticket types. Edit the descriptions to yours before her run (step 2 says how).
const WORK_TYPES = `
[[tickets.types]]
name = "Task"
description = "Work to build or change: code and its tests, user-facing or technical."
runs_as = "change"

[[tickets.types]]
name = "Bug"
description = "Something that works wrongly in production today: reproduce it, then fix it."
runs_as = "bug"

[[tickets.types]]
name = "Investigation"
description = "A question the team must answer before building: research and a written finding, no code."
runs_as = "investigation"
`;

export const CASES = Object.freeze({
  p1: { initiative: 'due-dates', what: 'a real PRD into tickets' },
  p2: { initiative: 'due-dates', what: 'a gap: one AC made untestable', gap: true },
  p3: { initiative: 'log-format', what: 'a technical ticket by hand', one: true, line: 'the log format in GCP should change to the new structure' },
  p4: { initiative: 'due-dates', what: 'your work\'s ticket types', types: true },
});

const gitEnvOf = (home) => ({ PATH: '/usr/bin:/bin', HOME: home.home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
const git = (home, ...a) => spawnSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: home.root, env: gitEnvOf(home), encoding: 'utf8' });
function put(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}
function commit(home, message) {
  git(home, 'add', '-A');
  if (git(home, 'status', '--porcelain').stdout.trim()) {
    const r = git(home, 'commit', '-qm', message);
    if (r.status !== 0) throw new Error(`git commit: ${r.stderr}`);
  }
}
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const branchOf = (key) => `probe-${key}`;

// A probe home for one case: 34's setupHome (MIRAI, a key, your token, a kept Claude Code), the
// sample app, the examples' context files, the ticket key prefix (and P4's types), you as the
// commits' author, and a branch of its own (MIRAI never commits on the integration branch). P1, P2
// and P4 hold the brief, the interview and the PRD, with the PRD's checks seeded (no model).
export async function tessHome({ workdir, key, c, claude, token }) {
  const home = await setupHome({ workdir, tier: 'standard', claude, token });
  home.home = join(workdir, 'home');
  cpSync(SAMPLE, home.root, { recursive: true, filter: (src) => !src.endsWith('AGENTS.md') });
  render({ cwd: home.root, env: home.env });
  for (const f of ['business.md', 'journeys.md']) put(home.root, `.mirai/context/${f}`, read(`registry/examples/context/${f}`));
  appendFileSync(join(home.root, '.mirai', 'config.toml'), `\n[tickets]\nkey_prefix = "SAMPLE"\n${c.types ? WORK_TYPES : ''}`);
  mkdirSync(join(home.home, '.config', 'mirai'), { recursive: true });
  writeFileSync(join(home.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "Probe Author"\nauthor_email = "probe@example.invalid"\n', { mode: 0o600 });
  if (!c.one) {
    const d = `docs/mirai/${c.initiative}`;
    put(home.root, `${d}/interview.md`, INTERVIEW);
    put(home.root, `${d}/brief.md`, BRIEF_READY);
    put(home.root, `${d}/prd.md`, c.gap ? prdWithGap(PRD_READY) : PRD_READY);
  }
  commit(home, `probe: the sample app, the context and the documents for ${key}`);
  if (!c.one) await seedPrdChecks(home, `docs/mirai/${c.initiative}/prd.md`);
  const sw = git(home, 'switch', '-q', '-c', branchOf(key));
  if (sw.status !== 0) throw new Error(`git switch: ${sw.stderr}`);
  return home;
}

// The PRD's own checks, seeded with no model: Vera's pass (and the brief's, approved with it on
// standard) and a reader test with a stand-in reader. Your approval stays yours, in Terminal.
async function seedPrdChecks(home, file) {
  const f = { root: home.root, env: home.env };
  passVera(f, file.replace(/prd\.md$/, 'brief.md'));
  passVera(f, file);
  const r = fakeReader();
  await runReaderTest({ cwd: home.root, env: home.env, file, launch: r.launch, claude: FAKE_CLAUDE });
}

// What --check prints: the documents' and the context's lint in a home (no model).
function homeProblems(home, c) {
  const trust = snapshot({ cwd: home.root, env: home.env });
  const registry = trustedRegistry(trust);
  const out = [];
  const rels = ['.mirai/context/business.md', '.mirai/context/journeys.md', ...(c.one ? [] : ['interview', 'brief', 'prd'].map((t) => `docs/mirai/${c.initiative}/${t}.md`))];
  for (const rel of rels) {
    const linked = {};
    for (const n of ['interview.md', 'brief.md']) if (existsSync(join(home.root, dirname(rel), n))) linked[n] = readFileSync(join(home.root, dirname(rel), n), 'utf8');
    for (const p of lintText(readFileSync(join(home.root, rel), 'utf8'), { source: rel, registry, project: projectOf(trustedConfig(trust)), linked, repo: home.root }).filter((x) => x.severity === 'error')) out.push(`${rel}:${p.line}: ${p.reason}`);
  }
  return out;
}

const homeOf = (dir) => {
  const workdir = realpathSync(dir);
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(workdir, 'home'), USER: process.env.USER, LANG: 'C' };
  return { workdir, root: join(workdir, 'repo'), home: join(workdir, 'home'), env };
};
const caseOf = (home) => {
  const branch = git(home, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
  const key = Object.keys(CASES).find((k) => branchOf(k) === branch);
  if (!key) throw new Error(`the home's repo is on ${branch}, not a probe case's branch`);
  return { key, c: CASES[key] };
};

function steps(home, key, c, log) {
  const mirai = `HOME=${home.home} node ${MIRAI}`;
  const loop = `cd ${ROOT} && caffeinate -i node test/probes/tess-probes.js --yes --probe loop --home ${home.workdir} | tee ~/mirai-u42-${key}.txt`;
  log(`the probe home: ${home.workdir}`);
  log(`  its repo: ${home.root} (branch ${branchOf(key)})`);
  log('');
  if (c.one) {
    log('1. In a new Terminal window:');
    log(`   cd ${home.root} && claude`);
    log('2. Paste this into that session (one message):');
    log('');
    log(`   Use the mirai-interview skill, its part "One ticket by hand", for this one line: "${c.line}". The interview's folder is ${c.initiative}: write docs/mirai/${c.initiative}/interview.md with for: ticket. This is a probe home: there is no /mirai here. To lint, run: cd ${home.root} && ${mirai} lint docs/mirai/${c.initiative}/interview.md . When I've confirmed the restatement, stop: don't commit, and don't start Tess; the probe does both.`);
    log('');
    log('3. Answer its questions in that session (at most 3) until you confirm the restatement.');
    log('4. Back in your first Terminal window (the probe commits the interview, then starts Tess for one ticket):');
    log(`   ${loop}`);
    log('   You see one line per step (her launch, the lint, Vera), then her state and the ticket\'s full path.');
    log('5. P3 passes when the session asked at most 3 questions, the run ends "done", and the ticket\'s ACs describe the system and a reviewer could test each one.');
  } else {
    log('1. Approve the PRD (its checks are seeded: the PRD is the probe\'s input). In your first Terminal window:');
    log(`   cd ${home.root} && ${mirai} approve due-dates-prd --file docs/mirai/${c.initiative}/prd.md`);
    log('   You see the brief and the PRD, "one decision approves both", Vera passed and the reader test passed. Answer a, then type the id.');
    if (c.types) {
      log('2. Put your work\'s descriptions in: open the [[tickets.types]] lines in this file, change each description to how your team uses Task, Bug and Investigation, save, then commit:');
      log(`   open -e ${join(home.root, '.mirai', 'config.toml')}`);
      log(`   cd ${home.root} && git add .mirai/config.toml && git commit -m "probe: our ticket types"`);
      log('   (The probe commits it for you too, before her run.)');
    }
    log(`${c.types ? 3 : 2}. Start her (one command; on a pause it prints her question and the message for your session):`);
    log(`   ${loop}`);
    log('   You see one line per step (her launches, the epic render, the lint, Vera), then her state, the epic\'s and each ticket\'s full path.');
    if (c.gap) {
      log('3. When it says "PAUSED": in a new Terminal window, cd into the repo and start claude, paste the printed message, answer her question and confirm.');
      log('   The loop then commits the interview, runs Nora to bring the PRD in line (Opus launches), and prints the approval command: run it, read only the changed lines, answer a.');
      log('   The loop sees your approval and starts Tess again by itself.');
      log('4. P2 passes when she paused with a question that names AC-FR-4.1 ("reliably"), and after your answer and the PRD\'s update the next run ends "done".');
    } else if (c.types) {
      log('4. P4 passes when each ticket\'s ticket_type is the one you would have chosen, and the set lints clean (the run ends "done").');
    } else {
      log('3. P1 passes when the run ends "done" after at most one fixing round, every FR, NFR and AC is in the epic\'s Coverage table, only the reminder-email ticket has e2e: true, and you would approve the set.');
    }
  }
  log(`Any time: cd ${ROOT} && node test/probes/tess-probes.js --probe show --home ${home.workdir}`);
  log(`At the end, delete the home: chmod -R u+w ${home.workdir} && rm -rf ${home.workdir}`);
}

// One Tess run as `mirai tickets` runs it, after committing what the session left.
async function tessOnce(home, c, log) {
  commit(home, `probe: the work tree for ${c.initiative}, as the session left it`);
  const onStep = (e) => log(e.kind === 'launch' ? `Tess: ${e.step} (round ${e.round}): ${e.outcome}` : e.kind === 'render' ? `epic render: ${e.problem ?? `${e.changed ? 'rendered' : 'up to date'} from ${e.tickets} ticket(s)`}` : e.kind === 'lint' ? `lint: ${e.errors ? `${e.errors} problem(s)` : 'clean'}` : `Vera: round ${e.round}, ${e.must_fix} must-fix${e.reused ? ' (reused)' : ''}`);
  const r = await runTess({ cwd: home.root, env: home.env, initiative: c.initiative, one: Boolean(c.one), nextToken: () => mintLaunchToken(), launchOptions: { status: green }, onStep });
  const store = openStore({ cwd: home.root, env: home.env });
  for (const l of tessStateLines(readJournal(store).events, c.initiative)) log(l);
  const dir = join(home.root, 'docs', 'mirai', c.one ? 'tickets' : c.initiative);
  for (const n of existsSync(dir) ? readdirSync(dir).filter((x) => x.endsWith('.md')) : []) log(join(dir, n));
  if (!c.one && existsSync(join(dir, 'tickets'))) for (const n of readdirSync(join(dir, 'tickets'))) log(join(dir, 'tickets', n));
  log(`commits: ${r.commits.map((s) => s.slice(0, 12)).join(', ') || 'none'}`);
  return r;
}

// After a pause (P2's gap): Nora brings the PRD in line with your answer, then you approve the PRD
// again in Terminal (it shows only what changed); this waits for that approval.
async function afterPause(home, c, log, { pollMs = 5000, waitMs = 3 * 60 * 60 * 1000 } = {}) {
  const file = `docs/mirai/${c.initiative}/prd.md`;
  const approved = () => {
    const store = openStore({ cwd: home.root, env: home.env });
    const bytes = readFileSync(join(home.root, file));
    const id = readFrontmatter(bytes)?.value?.id;
    return documentApproval(store, id, bytes).approved;
  };
  log('Nora brings the PRD in line with your answer (her continue step, Opus):');
  const n = await runNora({ cwd: home.root, env: home.env, initiative: c.initiative, nextToken: () => mintLaunchToken(), launchOptions: { status: green }, onStep: (e) => log(`  Nora: ${e.kind} ${e.type ?? ''} ${e.step ?? ''} ${e.round ?? ''} ${e.outcome ?? e.result ?? (e.must_fix !== undefined ? `${e.must_fix} must-fix` : '')}`) });
  log(`Nora: ${n.state}${n.why ? `: ${n.why}` : ''}`);
  if (n.state !== 'done') return false;
  log('Now approve the PRD again, in another Terminal window (it shows only the lines that changed since your approval):');
  log(`   cd ${home.root} && HOME=${home.home} node ${MIRAI} approve due-dates-prd --file ${file}`);
  const start = Date.now();
  while (!approved()) {
    if (Date.now() - start > waitMs) return false;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  log('the PRD is approved again; Tess starts again.');
  return true;
}

// interview.md as the loop waits on it: its state, its lint errors, and its bytes as the stamp.
function interviewNow(home, c) {
  const rel = `docs/mirai/${c.initiative}/interview.md`;
  const abs = join(home.root, rel);
  if (!existsSync(abs)) return null;
  const text = readFileSync(abs, 'utf8');
  let state = null;
  try {
    state = readFrontmatter(text, { source: rel })?.value?.state ?? null;
  } catch {
    state = 'unreadable';
  }
  const trust = snapshot({ cwd: home.root, env: home.env });
  const errors = lintText(text, { source: rel, registry: trustedRegistry(trust), project: projectOf(trustedConfig(trust)), repo: home.root }).filter((p) => p.severity === 'error').length;
  return { state: String(state), errors, stamp: text };
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, check: { type: 'boolean' }, probe: { type: 'string' }, case: { type: 'string' }, home: { type: 'string' } } });
  const log = (l) => process.stdout.write(`${l}\n`);
  if (values.check) {
    let bad = 0;
    for (const [key, c] of Object.entries(CASES)) {
      const workdir = realpathSync(mkdtempSync(join(tmpdir(), 'mirai-u42-check-')));
      try {
        const home = await tessHome({ workdir, key, c, claude: null, token: `sk-ant-oat01-${'Probe_check_'.repeat(4)}` });
        const problems = homeProblems(home, c);
        const clean = git(home, 'status', '--porcelain').stdout.trim() === '';
        log(`${key} ${c.what}: home built, branch ${branchOf(key)}, tree ${clean ? 'clean' : 'NOT clean'}, documents ${problems.length ? `${problems.length} lint problem(s)` : 'lint clean'}`);
        for (const p of problems) log(`  ${p}`);
        if (problems.length || !clean) bad += 1;
      } finally {
        spawnSync('/bin/chmod', ['-R', 'u+rwX', workdir]);
        rmSync(workdir, { recursive: true, force: true });
      }
    }
    return bad ? 1 : 0;
  }
  const probe = values.probe;
  if (!['home', 'loop', 'show'].includes(probe)) {
    process.stderr.write('--probe home --case p1|p2|p3|p4 | loop --home <dir> | show --home <dir>; or --check, no model\n');
    return 2;
  }
  if (probe === 'home') {
    const c = CASES[values.case];
    if (!c) throw new Error('--case p1, p2, p3 or p4');
    const token = readToken(process.env);
    if (!token) throw new Error('no Claude login token: mirai token set');
    const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
    const home = await tessHome({ workdir, key: values.case, c, claude: resolveClaude(process.env), token });
    steps({ ...home, workdir }, values.case, c, log);
    return 0;
  }
  if (!values.home || !existsSync(join(values.home, 'repo'))) throw new Error('--home <dir>: the folder --probe home printed');
  const home = homeOf(values.home);
  const { c } = caseOf(home);
  if (probe === 'show') {
    const r = spawnSync(process.execPath, [MIRAI, 'show', c.initiative], { cwd: home.root, env: home.env, encoding: 'utf8' });
    log(`${r.stdout}${r.stderr}`);
    return r.status ?? 1;
  }
  if (!values.yes) {
    process.stderr.write('--yes: Tess\'s run on your Claude subscription: her launches on Sonnet (the tickets step is standard), Vera on each version (Sonnet); after a pause, Nora\'s continue step (Opus)\n');
    return 2;
  }
  let pausedBefore = false;
  const r = await probeLoop({
    runOnce: async () => {
      if (pausedBefore && !(await afterPause(home, c, log))) return { state: 'failed', why: 'the PRD wasn\'t brought in line and approved again' };
      const end = await tessOnce(home, c, log);
      pausedBefore = end.state === 'paused';
      return end;
    },
    interview: () => interviewNow(home, c),
    commit: (m) => commit(home, m),
    resumeMessage: (end) => `Tess paused on ${end.question_id}; resume the interview at her question in docs/mirai/${c.initiative}/interview.md, then confirm the restatement. Don't commit and don't start anyone: the probe does both.`,
    log,
  });
  log(`loop: ${r.state} after ${r.runs} run(s)`);
  return r.state === 'done' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    if (err instanceof MiraiError) {
      process.stderr.write(formatError(err, process.env));
      process.exit(exitCodeOf(err));
    }
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
