#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { mintLaunchToken } from '../../src/agent/requests.js';
import { render } from '../../src/install/render.js';
import { lintText, projectOf } from '../../src/lint/lint.js';
import { runNora } from '../../src/nora/run.js';
import { noraStateLines } from '../../src/nora/state.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { readToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { snapshot, trustedConfig, trustedRegistry } from '../../src/trust/snapshot.js';
import { findingLines, mustFix } from '../../src/verify/findings.js';
import { runVerify } from '../../src/verify/run.js';
import { setupHome } from './reader-probes.js';
import { PROBE_BUSINESS } from './verify-probes.js';

// Unit 41's probes: Nora on real models, each in its own probe home under your home folder (its own
// MIRAI store, its own kept copy of your PATH's Claude Code, your token copied in), as 40's are.
// The interview runs in a Claude Code session of yours inside the home's repo; Nora's run is started
// from your Terminal by this script, exactly as `mirai write` runs it (runNora: MIRAI's launcher, her
// role, the prd step's model, Vera and the reader test between her launches), with the red-team
// gate stubbed green (a probe home has no red-team result; 24a's and 40's probes do the same).
//
// A probe home has no session server, so the session there can't use /mirai: the steps give it the
// probe's own commands, with HOME set to the probe's home (40's P3 finding: a plain `mirai lint`
// finds no store there). This script commits what the session left before it starts her: every
// launch needs a clean tree.
//
//   node test/probes/nora-probes.js --check                      (no model: builds a home of each case in a temp folder, lints its context, deletes it)
//   node test/probes/nora-probes.js --probe home --case p1|p2|p3|p4   (no model: makes the home, prints the steps)
//   node test/probes/nora-probes.js --yes --probe write --home <dir>  (Nora's run: Opus launches, Vera's checks, a reader test)
//   node test/probes/nora-probes.js --probe show --home <dir>         (no model: her state and the documents)
//   node test/probes/nora-probes.js --yes --probe drop --home <dir> --line REQ-n   (P4: one Vera run)

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SAMPLE = join(ROOT, 'test', 'fixtures', 'sample-app');
const MIRAI = join(ROOT, 'bin', 'mirai.js');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// P3's seed: a conventions rule the PRD would break only in its detail (how a task is removed).
// The example's "(enforced by …)" rules name checks a probe home's config doesn't have: left out.
const CONVENTIONS = `${read('registry/examples/context/conventions-backend.md').split('\n').filter((l) => !l.includes('(enforced by')).join('\n').trimEnd()}
- Nothing a person writes is ever deleted from the database: a removed task is marked removed and kept, and lists leave it out (judgment).
`;

// 40's probe business.md, with the stakeholder line its lint wants at approval (P2 approves a change
// to it).
const NORA_BUSINESS = PROBE_BUSINESS.replace('## Sources', '## Stakeholders\n\n- The product owner decides what\'s built and approves this file (S-1).\n\n## Sources');

// P4: 24 lines, as a product owner would paste them, for a small feature.
const P4_LIST = [
  'A task can have one due date, or none.',
  'The team lead and the task\'s creator can set the due date.',
  'The team lead and the task\'s creator can change or remove it.',
  'A due date is a calendar day, with no time.',
  'A due date in the past can\'t be set.',
  'The task list shows each task\'s due date beside its title.',
  'A task past its due date and not done is marked overdue.',
  'Overdue tasks show their mark to everyone who can see the task.',
  'A done task is never marked overdue.',
  'The team lead has one page with all of the team\'s overdue tasks.',
  'That page lists the most overdue first.',
  'The assignee gets one email the day before a task is due.',
  'That email lists every task of theirs due the next day.',
  'No email is sent for a task that is already done.',
  'An assignee can turn the reminder emails off, and on again.',
  'An assignee who leaves the team gets no more reminders.',
  'A failed email is retried once, an hour later.',
  'Tasks with no due date stay sorted as they are today.',
  'The overdue page opens in under 2 seconds for a team with 500 tasks.',
  'Recurring tasks are not part of this.',
  'Text-message reminders are not part of this.',
  'The task list\'s sort order doesn\'t change.',
  'Due dates show in the team\'s time zone.',
  'The feature ships to one team first, then to all.',
];

export const CASES = Object.freeze({
  p1: { initiative: 'pinned-tasks', request: 'Team leads want to pin up to three tasks to the top of their team\'s list.' },
  p2: { initiative: 'guest-comments', request: 'Let people outside the team leave a comment on a task through a shared link.' },
  p3: { initiative: 'delete-tasks', request: 'A team lead can delete a task for good, so it disappears from every list.', conventions: true },
  p4: { initiative: 'due-dates', request: 'Tasks need due dates: the list of what we need is in requirements-source.md.', list: true },
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

// A probe home for one case: 34's setupHome (MIRAI, a key, your token, a kept Claude Code), the
// sample app, the probe's business.md (signed-in members only, no public links), P3's conventions
// rule, P4's list, you as the commits' author, and a branch for the feature (MIRAI never commits
// her documents on the integration branch).
export async function noraHome({ workdir, c, claude, token }) {
  const home = await setupHome({ workdir, tier: 'standard', claude, token });
  home.home = join(workdir, 'home');
  cpSync(SAMPLE, home.root, { recursive: true, filter: (src) => !src.endsWith('AGENTS.md') });
  render({ cwd: home.root, env: home.env });
  put(home.root, '.mirai/context/business.md', NORA_BUSINESS);
  if (c.conventions) put(home.root, '.mirai/context/conventions-backend.md', CONVENTIONS);
  if (c.list) put(home.root, 'requirements-source.md', `${P4_LIST.map((l) => `- ${l}`).join('\n')}\n`);
  mkdirSync(join(home.home, '.config', 'mirai'), { recursive: true });
  writeFileSync(join(home.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "Probe Author"\nauthor_email = "probe@example.invalid"\n', { mode: 0o600 });
  commit(home, `probe: the sample app and the context for ${c.initiative}`);
  const sw = git(home, 'switch', '-q', '-c', `docs-${c.initiative}`);
  if (sw.status !== 0) throw new Error(`git switch: ${sw.stderr}`);
  return home;
}

// The context files' lint in a home (no model): what --check prints.
function contextProblems(home) {
  const trust = snapshot({ cwd: home.root, env: home.env });
  const registry = trustedRegistry(trust);
  const out = [];
  for (const rel of ['.mirai/context/business.md', '.mirai/context/conventions-backend.md']) {
    if (!existsSync(join(home.root, rel))) continue;
    for (const p of lintText(readFileSync(join(home.root, rel), 'utf8'), { source: rel, registry, project: projectOf(trustedConfig(trust)), repo: home.root }).filter((x) => x.severity === 'error')) out.push(`${rel}:${p.line}: ${p.reason}`);
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
  const c = Object.values(CASES).find((x) => `docs-${x.initiative}` === branch);
  if (!c) throw new Error(`the home's repo is on ${branch}, not a probe case's branch`);
  return c;
};

function steps(home, c, key, log) {
  const mirai = `HOME=${home.home} node ${MIRAI}`;
  const lint = `cd ${home.root} && ${mirai} lint docs/mirai/${c.initiative}/interview.md`;
  log(`the probe home: ${home.workdir}`);
  log(`  its repo: ${home.root} (branch docs-${c.initiative})`);
  log('');
  log('1. In a new Terminal window:');
  log(`   cd ${home.root} && claude`);
  log('2. Paste this into that session (one message):');
  log('');
  log(`   Use the mirai-interview skill to interview me about this request: "${c.request}". The initiative is ${c.initiative}: write docs/mirai/${c.initiative}/interview.md.${c.list ? ` I have my own list: it's in requirements-source.md; keep it with this command first: cd ${home.root} && ${mirai} requirements ${c.initiative} --from requirements-source.md` : ''} This is a probe home: there is no /mirai here. To lint, run: ${lint}${c.initiative === 'guest-comments' ? ` . If I choose to propose a change to business.md, write docs/mirai/${c.initiative}/business-change.md as the skill says, and give me the approval command with HOME set: cd ${home.root} && ${mirai} approve --file docs/mirai/${c.initiative}/business-change.md` : ''} When I've confirmed the restatement, stop: don't commit, and don't start Nora; the probe does both.`);
  log('');
  log('3. Answer its questions in that session until you confirm the restatement.');
  if (key === 'p2') {
    log('   P2 passes here when the first question names the contradiction with business.md (no public links) and offers "propose a change to business.md".');
    log('   Choose it; the session writes business-change.md and gives you the approval command. Run it in your first Terminal window,');
    log('   read the change, and answer a (or r). The output says which file changed.');
    log(`4. Delete the home: chmod -R u+w ${home.workdir} && rm -rf ${home.workdir}`);
    return;
  }
  log('4. Back in your first Terminal window (the probe commits what the session left, then starts Nora):');
  log(`   cd ${ROOT} && caffeinate -i node test/probes/nora-probes.js --yes --probe write --home ${home.workdir} | tee ~/mirai-u41-${key}.txt`);
  log('   You see one line per step (her launches, the lint, Vera, the reader test), then her state and each document\'s full path.');
  if (key === 'p3') {
    log('5. When it says "paused": the question is in interview.md. Go back to the session and say: "Nora paused; resume the interview at her question." Answer it, confirm, then repeat step 4.');
    log('   P3 passes when she paused on the deletion rule, the question is in interview.md, and the second run ends done.');
  } else if (key === 'p4') {
    log('5. When it says "done", seed a dropped line (no model for the first part; one Vera run):');
    log(`   cd ${ROOT} && node test/probes/nora-probes.js --yes --probe drop --home ${home.workdir} --line REQ-12`);
    log('   P4 passes when the interview asked only about gaps and contradictions, every REQ-n is cited in the PRD, and Vera raises the dropped line as a must-fix.');
  } else {
    log('5. P1 passes when it says "done", the brief and the PRD are linted clean, passed Vera and the reader test, and you would approve them.');
  }
  log(`Any time: cd ${ROOT} && node test/probes/nora-probes.js --probe show --home ${home.workdir}`);
  log(`At the end, delete the home: chmod -R u+w ${home.workdir} && rm -rf ${home.workdir}`);
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, check: { type: 'boolean' }, probe: { type: 'string' }, case: { type: 'string' }, home: { type: 'string' }, line: { type: 'string' } } });
  const log = (l) => process.stdout.write(`${l}\n`);
  if (values.check) {
    // No model and no token of yours: a stand-in token, no kept Claude Code, in a temp folder.
    let bad = 0;
    for (const [key, c] of Object.entries(CASES)) {
      const workdir = realpathSync(mkdtempSync(join(tmpdir(), 'mirai-u41-check-')));
      try {
        const home = await noraHome({ workdir, c, claude: null, token: `sk-ant-oat01-${'Probe_check_'.repeat(4)}` });
        const problems = contextProblems(home);
        const clean = git(home, 'status', '--porcelain').stdout.trim() === '';
        log(`${key} ${c.initiative}: home built, branch docs-${c.initiative}, tree ${clean ? 'clean' : 'NOT clean'}, context ${problems.length ? `${problems.length} lint problem(s)` : 'lints clean'}`);
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
  if (!['home', 'write', 'show', 'drop'].includes(probe)) {
    process.stderr.write('--probe home --case p1|p2|p3|p4 | write --home <dir> | show --home <dir> | drop --home <dir> --line REQ-n; or --check, no model\n');
    return 2;
  }
  if (probe === 'home') {
    const c = CASES[values.case];
    if (!c) throw new Error('--case p1, p2, p3 or p4');
    const token = readToken(process.env);
    if (!token) throw new Error('no Claude login token: mirai token set');
    const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
    const home = await noraHome({ workdir, c, claude: resolveClaude(process.env), token });
    steps({ ...home, workdir }, c, values.case, log);
    return 0;
  }
  if (!values.home || !existsSync(join(values.home, 'repo'))) throw new Error('--home <dir>: the folder --probe home printed');
  const home = homeOf(values.home);
  const c = caseOf(home);
  if (probe === 'show') {
    const r = spawnSync(process.execPath, [MIRAI, 'show', c.initiative], { cwd: home.root, env: home.env, encoding: 'utf8' });
    log(`${r.stdout}${r.stderr}`);
    return r.status ?? 1;
  }
  if (!values.yes) {
    process.stderr.write(`--yes: ${probe === 'write' ? 'Nora\'s run on your Claude subscription: her launches on Opus (the prd step is deep), Vera on each version (on her tier too: the verifier ladder), and a reader test (Sonnet)' : 'one Vera run'}\n`);
    return 2;
  }
  if (probe === 'write') {
    commit(home, `probe: the interview for ${c.initiative}, as the session left it`);
    const head = git(home, 'rev-parse', '--short', 'HEAD').stdout.trim();
    log(`committed what the session left: ${head}. Starting her run.`);
    const onStep = (e) => log(e.kind === 'launch' ? `Nora: ${e.step} the ${e.type} (round ${e.round}): ${e.outcome}` : e.kind === 'lint' ? `lint, the ${e.type}: ${e.errors ? `${e.errors} problem(s)` : 'clean'}` : e.kind === 'verify' ? `Vera, the ${e.type}: round ${e.round}, ${e.must_fix} must-fix${e.reused ? ' (reused)' : ''}` : `reader test, the ${e.type}: ${e.result}, round ${e.round}`);
    const r = await runNora({ cwd: home.root, env: home.env, initiative: c.initiative, nextToken: () => mintLaunchToken(), launchOptions: { status: green }, onStep });
    const store = openStore({ cwd: home.root, env: home.env });
    for (const l of noraStateLines(readJournal(store).events, c.initiative)) log(l);
    for (const t of ['interview', 'requirements', 'business-change', 'brief', 'prd']) {
      const p = join(home.root, 'docs', 'mirai', c.initiative, `${t}.md`);
      if (existsSync(p)) log(p);
    }
    log(`commits: ${r.commits.map((s) => s.slice(0, 12)).join(', ') || 'none'}`);
    return r.state === 'failed' ? 1 : 0;
  }
  // drop: P4's seeded loss. The PRD's citation of one REQ-n taken out, committed; the lint's answer,
  // then Vera's on that text.
  const line = values.line ?? '';
  if (!/^REQ-[0-9]{1,4}$/.test(line)) throw new Error('--line REQ-n');
  const file = `docs/mirai/${c.initiative}/prd.md`;
  const abs = join(home.root, file);
  const text = readFileSync(abs, 'utf8');
  const cut = text.replace(new RegExp(`\\s*\\(${line}\\)(?![0-9])`, 'g'), '');
  if (cut === text) throw new Error(`${file} doesn't cite (${line})`);
  writeFileSync(abs, cut);
  commit(home, `probe: ${line} dropped from the PRD`);
  const lint = spawnSync(process.execPath, [MIRAI, 'lint', file], { cwd: home.root, env: home.env, encoding: 'utf8' });
  log(`lint (exit ${lint.status}):\n${lint.stdout}${lint.stderr}`);
  const r = await runVerify({ cwd: home.root, env: home.env, file, launchToken: mintLaunchToken(), launchOptions: { status: green } });
  if (!r.entry) throw new Error(`Vera didn't record a result: ${r.outcome}: ${r.why}`);
  const hits = mustFix(r.entry.findings).filter((f) => `${f.against?.quote ?? ''} ${f.where.quote} ${f.what}`.includes(line));
  log(`Vera: round ${r.entry.round}, ${r.entry.must_fix} must-fix (model ${r.entry.model}); ${hits.length ? `${line} raised as a must-fix:` : `${line} NOT raised as a must-fix`}`);
  for (const f of hits) log(findingLines(f).join('\n'));
  return hits.length ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
