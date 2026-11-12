#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';

import { main } from '../../src/cli/main.js';
import { readLoop } from '../../src/loop/guard.js';
import { driveTicket, STEPS } from '../../src/run/drive.js';
import { showData, showText } from '../../src/run/show.js';
import { installHooks } from '../../src/hooks/install.js';
import { findCli, hostFor, TOOLS_FILE } from '../../src/ship/host.js';
import { pushBranch } from '../../src/store/git.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { readRunLog } from '../../src/store/run-log.js';
import { readHeartbeat, readRunState } from '../../src/store/run.js';
import { readTicketStatus } from '../../src/store/tickets.js';
import { setup } from './review-probes.js';

// Unit 28's probes, on a sample-app clone with a probe home (as 27a's P1: your Claude token copied
// in, the red-team gate stubbed green, Docker Desktop running). Every approval and signature uses
// the probe home's own key, never yours.
// - r1 (about 40 min; Sonnet plans and reviews, Kai builds): `mirai run SAMPLE-1` plans and stops at
//   the gate; the probe approves; `mirai run` again records the baseline, builds, reviews, signs the
//   proofs and opens one PR on your GitHub sample app (on a throwaway base branch, as 27a's P1);
//   again: built, nothing changes; `mirai show`. Clean-up: the PR closed, the branches deleted.
// - r2 (about 40 min): the plan approved, `mirai run` in its own process is killed mid-build
//   (SIGKILL; Kai keeps running in his own process group). `mirai status`, then `mirai resume`: the
//   crashed run taken over, its agent ended; uncommitted changes name `mirai discard` (the probe
//   types the key), then resume builds again, reviews and signs the proofs; the clone has no
//   remote, so the ship stops there and nothing is pushed. The loop counters before and after.
//   node test/probes/run-probes.js --yes --probe r1|r2 [--repo owner/name] [--app <sample app>]

const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const HERE = fileURLToPath(new URL('.', import.meta.url));

// A terminal for `mirai <argv>`: typed answers, its output kept.
async function term(argv, { cwd, env, claude = null, redTeamStatus = null }, answers = []) {
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  let out = '';
  let err = '';
  // As the in-process runs: the probe's Claude, and the red-team gate stubbed green (its home has
  // no red-team result of its own).
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (t) => (out += t) }, stderr: { write: (t) => (err += t) }, env, cwd, ...(claude ? { claude } : {}), ...(redTeamStatus ? { redTeamStatus } : {}) });
  return { code, out, err };
}

async function prep(ctx) {
  const io = { cwd: ctx.root, env: ctx.env };
  // The planted flaky test out of the clone (as 24a's probes): the probe isn't about it.
  ctx.git('rm', '-q', 'frontend/src/flaky-seed.test.ts');
  ctx.git('commit', '-qm', 'probe: no planted flaky test (unit 28)');
  const a = await term(['approve', 'SAMPLE-1', '--file', 'docs/mirai/tickets/SAMPLE-1.md'], io, ['a', 'SAMPLE-1']);
  if (a.code !== 0) throw new Error(`approve the ticket: ${a.err}`);
  return io;
}

const events = (log, label) => (e) => {
  if (e.type === 'step') log(`${label}: [${e.step}]`);
  else if (e.type === 'step-done') log(`${label}: [${e.step}] ${e.outcome}${e.why ? `: ${String(e.why).slice(0, 200)}` : ''}`);
  else if (e.line) log(`${label}: ${e.line}`);
};
const summary = (log, label, r) => {
  log(`${label}: ${r.outcome}${r.stop ? ` (${r.stop.kind}): ${String(r.stop.why).slice(0, 300)}` : ''}${r.mr ? `; MR ${r.mr}` : ''}`);
  if (r.stop?.next) log(`${label}:   next: ${r.stop.next}`);
  for (const n of r.notes ?? []) log(`${label}:   note: ${String(n).slice(0, 300)}`);
  log(`${label}:   steps: ${r.steps.map((s) => `${s.step} ${s.outcome}`).join(', ') || 'none'}; on ${r.here}`);
};

async function r1(ctx, repo) {
  const io = await prep(ctx);
  const store = openStore(io);
  const opts = { claude: ctx.claude, status: green };
  const t0 = Date.now();
  // The plan's lint problems, if any, and every launch of the run, as its log has them.
  const planSteps = {
    ...STEPS,
    runPlan: async (a) => {
      const r = await STEPS.runPlan(a);
      for (const p of r?.problems ?? []) ctx.log(`r1-plan-lint: line ${p.line}${p.code ? ` [${p.code}]` : ""}: ${String(p.reason ?? p.message ?? JSON.stringify(p)).slice(0, 300)}`);
      return r;
    },
  };
  const d1 = await driveTicket({ ...io, ticket: 'SAMPLE-1', steps: planSteps, launchOptions: opts, onEvent: events(ctx.log, 'r1-run1') });
  summary(ctx.log, 'r1-run1', d1);
  ctx.log(`r1-run1: ${Math.round((Date.now() - t0) / 1000)} s; ticket ${readTicketStatus(store, 'SAMPLE-1').status.state}; run ${readRunState(store).state}`);
  for (const l of readRunLog(store, d1.runId).lines.filter((x) => x.event === 'agent_run')) ctx.log(`r1-run1-launch: ${l.step}/${l.outcome}${l.why ? ` (${String(l.why).slice(0, 200)})` : ''}, ${l.turns ?? '?'} turns, ${l.model_used ?? l.model ?? '?'}`);
  if (d1.stop?.kind !== 'gate-plan') {
    ctx.keep = true;
    return;
  }
  const ap = await term(['approve', 'SAMPLE-1', '--plan'], io, ['a', 'SAMPLE-1']);
  ctx.log(`r1-approve: exit ${ap.code} (the probe home's key)`);
  if (ap.code !== 0) return;

  // The host, as 27a's P1: a throwaway base branch stands in for GitHub's main.
  const gh = findCli('gh', process.env, ctx.root);
  if (!gh) {
    ctx.log('r1: no gh on your PATH; stopped');
    return;
  }
  writeFileSync(join(store.dir, TOOLS_FILE), JSON.stringify({ schema_version: 1, github: gh }), { mode: 0o600 });
  const id = randomBytes(3).toString('hex');
  const base = `mirai-probe/base-${id}`;
  const remoteUrl = `https://github.com/${repo}.git`;
  const real = (a) => hostFor({ ...a, remoteUrl, cliHome: process.env.HOME });
  const ghRun = (...args) => spawnSync(gh, args, { env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }, encoding: 'utf8' });
  // The ticket's branch name is the same every time, so an earlier probe's closed PR on it is
  // there: PRs from before this probe aren't its own (a real project's would be yours).
  const last = ghRun('api', `repos/${repo}/pulls?state=all&per_page=1&sort=created&direction=desc`, '--jq', '.[0].number // 0');
  const before = Number(String(last.stdout).trim()) || 0;
  ctx.log(`r1-prs: the newest PR before this probe: #${before}${last.status === 0 ? '' : ` (gh exit ${last.status})`}`);
  const hostOf = (a) => {
    const h = real(a);
    const ours = (mr) => (mr && Number(/\/pull\/(\d+)/.exec(mr.url ?? '')?.[1] ?? 0) > before ? mr : null);
    return { ...h, branchTip: (b) => h.branchTip(b === 'main' ? base : b), openMr: (o) => h.openMr({ ...o, base }), findMr: (b) => ours(h.findMr(b)) };
  };
  const cleanups = [];
  try {
    const host = real({ config: { git: { integration_branch: 'main' } }, store, env: ctx.env, root: ctx.root });
    const pb = pushBranch(ctx.root, host.pushUrl, base, ctx.git('rev-parse', 'main').trim(), store.gitEnv, { helper: host.helper });
    cleanups.push(() => ghRun('api', '--method', 'DELETE', `repos/${repo}/git/refs/heads/${base}`));
    ctx.log(`r1-base: ${base}: ${pb.ok ? 'pushed' : `REFUSED ${pb.why}`}`);
    if (!pb.ok) return;

    const t1 = Date.now();
    // Each test run's verdicts (the build's and the gate's), and a failing run's messages.
    const tests = (label, r) => {
      for (const x of r?.tests?.runs ?? []) {
        ctx.log(`${label}: ${x.name} ${x.verdict} (${x.outcome}${x.tests ? `; ${x.tests.passed ?? '?'} passed, ${x.tests.failed ?? '?'} failed of ${x.tests.total ?? '?'}` : ''})`);
        for (const f of x.failing ?? []) ctx.log(`${label}:   ${String(f.id ?? f.name).slice(0, 160)}: ${String(f.message ?? '').replace(/\s+/g, ' ').slice(0, 400)}`);
        if (x.output_tail) for (const l of x.output_tail.split('\n').slice(-40)) ctx.log(`${label}:   tail| ${l}`);
      }
    };
    const steps = {
      ...STEPS,
      runBuild: async (a) => { const r = await STEPS.runBuild(a); tests('r1-build-tests', r); return r; },
      runFix: async (a) => { const r = await STEPS.runFix(a); for (const x of r?.rounds ?? []) tests('r1-fix-tests', x); return r; },
      recordProofs: async (a) => { const r = await STEPS.recordProofs(a); tests('r1-gate-tests', r); return r; },
    };
    const d2 = await driveTicket({ ...io, ticket: 'SAMPLE-1', steps, launchOptions: { ...opts, hostOf }, onEvent: events(ctx.log, 'r1-run2') });
    summary(ctx.log, 'r1-run2', d2);
    ctx.log(`r1-run2: ${Math.round((Date.now() - t1) / 60000)} min`);
    const branch = JSON.parse(readFileSync(join(store.dir, 'tickets', 'SAMPLE-1', 'build.json'), 'utf8')).branch;
    // The branch is on GitHub only if the run shipped it.
    cleanups.push(() => ghRun('api', '--method', 'DELETE', `repos/${repo}/git/refs/heads/${branch}`));
    if (d2.outcome !== 'finished') {
      ctx.keep = true;
      ctx.log(`r1-diff: ${ctx.git('diff', '--stat', 'main...HEAD').trim().split('\n').join(' | ').slice(0, 600)}`);
    }
    const pr = /\/pull\/(\d+)/.exec(d2.mr ?? '')?.[1];
    if (pr) cleanups.unshift(() => ghRun('pr', 'close', pr, '--repo', repo));
    // One run for every step: one run_started, its launches, run_finished.
    const lines = readRunLog(store, d2.runId).lines;
    ctx.log(`r1-log: run ${d2.runId}: run_started ${lines.filter((l) => l.event === 'run_started').length}, agent_run ${lines.filter((l) => l.event === 'agent_run').map((l) => `${l.step}/${l.outcome}${l.tool_calls ? ` (${l.tool_calls.map((t) => `${t.tool}×${t.n}`).join(' ')})` : ''}`).join(', ')}, run_finished ${lines.some((l) => l.event === 'run_finished')}`);
    if (d2.outcome !== 'finished') return;

    const d3 = await driveTicket({ ...io, ticket: 'SAMPLE-1', launchOptions: { ...opts, hostOf }, onEvent: events(ctx.log, 'r1-run3') });
    summary(ctx.log, 'r1-run3', d3);
    ctx.log('r1-show:');
    for (const l of showText(showData({ ...io, ticket: 'SAMPLE-1' })).split('\n')) if (l.trim()) ctx.log(`  show| ${l}`);
  } finally {
    for (const c of cleanups) {
      const x = c();
      ctx.log(`r1-cleanup: ${x.status === 0 ? 'ok' : /Reference does not exist/.test(String(x.stderr)) ? 'ok (the branch was never pushed)' : `exit ${x.status} ${String(x.stderr).trim().slice(0, 160)}`}`);
    }
  }
}

async function r2(ctx) {
  const io = await prep(ctx);
  const store = openStore(io);
  // MIRAI's hooks in the probe home, as `mirai init` installs them: `mirai resume` needs them (26a).
  installHooks({ store, env: ctx.env, node: process.execPath, launcher: join(HERE, '..', '..', 'bin', 'launch.js') });
  const opts = { claude: ctx.claude, status: green };
  // The plan, then your gate (the probe's key), as in r1.
  const d1 = await driveTicket({ ...io, ticket: 'SAMPLE-1', launchOptions: opts, onEvent: events(ctx.log, 'r2-plan') });
  summary(ctx.log, 'r2-plan', d1);
  if (d1.stop?.kind !== 'gate-plan') return;
  if ((await term(['approve', 'SAMPLE-1', '--plan'], io, ['a', 'SAMPLE-1'])).code !== 0) return;
  const before = readLoop(store, 'SAMPLE-1');

  // The run in its own process, killed while Kai builds.
  const child = join(ctx.workdir, 'run-child.mjs');
  writeFileSync(child, `import { driveTicket } from ${JSON.stringify(join(HERE, '..', '..', 'src', 'run', 'drive.js'))};
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
await driveTicket({ cwd: ${JSON.stringify(ctx.root)}, env: ${JSON.stringify(ctx.env)}, ticket: 'SAMPLE-1', launchOptions: { claude: ${JSON.stringify(ctx.claude)}, status: green }, onEvent: (e) => { if (e.type === 'step') process.stdout.write('[' + e.step + ']\\n'); else if (e.type === 'step-done') process.stdout.write('[' + e.step + '] ' + e.outcome + '\\n'); } });
`);
  const p = spawn(process.execPath, [child], { cwd: ctx.root, env: ctx.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  // The step the child is on, from its own lines (a launch's heartbeat may carry no step).
  let current = null;
  p.stdout.on('data', (b) => {
    for (const l of String(b).split('\n').filter((x) => x.trim())) {
      ctx.log(`r2-child: ${l.trim()}`);
      const m = /^\[([a-z-]+)\]$/.exec(l.trim());
      if (m) current = m[1];
    }
  });
  const agentFile = join(store.dir, 'agent-runs', 'current.json');
  const t0 = Date.now();
  let agentSince = null;
  while (Date.now() - t0 < 40 * 60_000) {
    await new Promise((r) => { setTimeout(r, 5000); });
    if (current === 'build' && existsSync(agentFile)) {
      agentSince ??= Date.now();
      if (Date.now() - agentSince > 90_000) break;
    }
    if (p.exitCode !== null) break;
  }
  if (p.exitCode !== null) {
    ctx.log(`r2: the run ended (${p.exitCode}) before Kai's build was 90 s in; stopped`);
    return;
  }
  const agent = JSON.parse(readFileSync(agentFile, 'utf8'));
  // Whatever resume does, Kai isn't left running after the probe.
  ctx.after.push(() => { try { process.kill(-agent.pid, 'SIGTERM'); ctx.log(`r2-end: Kai (pid ${agent.pid}) was still running; stopped`); } catch { /* gone */ } });
  process.kill(-p.pid, 'SIGKILL');
  await new Promise((r) => { setTimeout(r, 3000); });
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  ctx.log(`r2-kill: mirai run (pid ${p.pid}) killed ${Math.round((Date.now() - agentSince) / 1000)} s into the build; Kai (pid ${agent.pid}) still running: ${alive(agent.pid)}; run state ${readRunState(store).state}; heartbeat ${readHeartbeat(store)?.step ?? '-'}`);
  const st = await term(['status'], io);
  for (const l of st.out.split('\n').filter((x) => /run|lock|heartbeat|SAMPLE-1/i.test(x)).slice(0, 8)) ctx.log(`  status| ${l}`);

  let res = await term(['resume'], { ...io, claude: ctx.claude, redTeamStatus: green });
  for (const l of res.out.split('\n').filter((x) => x.trim()).slice(-40)) ctx.log(`  resume| ${l}`);
  ctx.log(`r2-resume: exit ${res.code}${res.err ? `; ${res.err.trim().split('\n').at(-1).slice(0, 200)}` : ''}; Kai still running: ${alive(agent.pid)}`);
  if (/mirai discard SAMPLE-1/.test(`${res.out}${res.err}`)) {
    const dis = await term(['discard', 'SAMPLE-1'], io, ['SAMPLE-1']);
    ctx.log(`r2-discard: exit ${dis.code}`);
    res = await term(['resume'], { ...io, claude: ctx.claude, redTeamStatus: green });
    for (const l of res.out.split('\n').filter((x) => x.trim()).slice(-40)) ctx.log(`  resume2| ${l}`);
    ctx.log(`r2-resume2: exit ${res.code}`);
  }
  const after = readLoop(store, 'SAMPLE-1');
  ctx.log(`r2-loop: rounds_used ${before.rounds_used} → ${after.rounds_used}; replans ${before.replans_used} → ${after.replans_used}; granted ${before.granted} → ${after.granted}`);
  const resumed = readJournal(store).events.filter((e) => e.type === 'run_resumed');
  ctx.log(`r2-journal: run_resumed ${resumed.map((e) => `${e.via}/${e.by}${e.signature ? ' signed' : ''}`).join(', ') || 'none'}; ticket ${readTicketStatus(store, 'SAMPLE-1').status.state}`);
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, probe: { type: 'string' }, app: { type: 'string' }, repo: { type: 'string' } } });
  const probe = { r1, r2 }[values.probe];
  if (!values.yes || !probe) {
    process.stderr.write('--probe r1|r2 and --yes: it uses your Claude subscription (Sonnet: r1 about 3 runs, r2 about 3), Docker, and r1 opens then closes a real PR on your GitHub sample-app repo\n');
    return 2;
  }
  const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
  const log = (l) => process.stdout.write(`${l}\n`);
  const ctx = { log, workdir, keep: false, after: [] };
  try {
    Object.assign(ctx, setup({ app: resolve(values.app ?? join(process.env.HOME, 'Projects', 'mirai-sample-app')), workdir }), { log, workdir });
    await probe(ctx, values.repo ?? 'jetmirhaxhisefa/mirai-sample-app');
  } finally {
    for (const f of ctx.after) f();
    spawnSync('/bin/chmod', ['-R', 'u+rwX', workdir]);
    // A run that stopped short keeps its folder, to look at; delete it after.
    if (ctx.keep) log(`kept for a look: ${workdir} (delete it after: rm -rf ${workdir})`);
    else rmSync(workdir, { recursive: true, force: true });
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
