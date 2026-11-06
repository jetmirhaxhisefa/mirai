#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { BUILD_MAX_TURNS, buildRecordPath, runBuild } from '../../src/agent/build.js';
import { runFix } from '../../src/agent/fix.js';
import { planPath } from '../../src/agent/plan.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { agentSessionDir, forgetSession, keptSession } from '../../src/agent/session.js';
import { recordBaseline } from '../../src/baseline/record.js';
import { openStore } from '../../src/store/home.js';
import { readTicketStatus, writeTicketStatus } from '../../src/store/tickets.js';
import { runTest } from '../../src/tests/run.js';
import { ticketReport } from './checkpoint-report.js';
import { setup, tty } from './fix-probes.js';
import { init } from '../../src/install/init.js';

// Unit 21d's probes, on a sample-app clone with a probe home (as 21c's; the red-team gate stubbed
// green). Docker Desktop must be running for R1.
// - R1 (Sonnet: one build, two fix rounds): what a resume saves. A real build of SAMPLE-1 from your
//   approved plan. Right after Kai's launch ends, a wrapper breaks the delete policy in Kai's own
//   code (as if Kai had), so MIRAI's real tests fail and the build ends checks-failed, committed.
//   If Kai's code has no such line, MIRAI's first unit run reports one failure instead, and the log
//   says so. Then the same fix round twice from that step, one round each ([loop] rounds = 1):
//   resumed (the build's session), then fresh (the branch, build.json, the loop state and the
//   ticket put back; the session forgotten). The gaps are logged: the prompt cache lasts minutes.
// - R2 (Haiku: one build): an unplanned install. The build's prompt gets one more line asking for
//   a package the plan doesn't declare. What stops it: the sandbox (no network), or MIRAI's
//   dependency check, and is anything new committed?
//   node test/probes/resume-probes.js --yes --probe r1|r2 [--app <sample app>]

const KEPT_PLAN = join(process.env.HOME, '.mirai-21a-r2-plan.md');
const PLANTED = 'tests/Feature/TaskApiTest.php::test_a_user_cannot_delete_another_users_task';
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });

// The ticket approved, its plan placed and approved, the ticket in progress (as 21c's R2).
async function ready({ root, env }, { baseline }) {
  const io = { cwd: root, env };
  await tty(['approve', 'SAMPLE-1', '--file', 'docs/mirai/tickets/SAMPLE-1.md'], io, ['a', 'SAMPLE-1']);
  if (baseline) await recordBaseline({ cwd: root, env });
  const store = openStore(io);
  mkdirSync(dirname(planPath(store, 'SAMPLE-1')), { recursive: true, mode: 0o700 });
  writeFileSync(planPath(store, 'SAMPLE-1'), readFileSync(KEPT_PLAN, 'utf8'), { mode: 0o600 });
  const current = readTicketStatus(store, 'SAMPLE-1').status;
  writeTicketStatus(store, { ticket: 'SAMPLE-1', state: 'in-progress' }, { expectSeq: current.seq });
  await tty(['approve', 'SAMPLE-1', '--plan'], io, ['a', 'SAMPLE-1']);
  return store;
}

const lineOf = (x) => {
  const l = x?.line ?? {};
  return `${x?.outcome}${x?.why ? ` (${String(x.why).slice(0, 200)})` : ''}; ${l.turns} turns, ${l.minutes} min, in ${l.tokens_in}, out ${l.tokens_out}, cached ${l.tokens_cached}, ${l.model_used ?? l.model}; ${x?.resumed ? 'resumed' : 'fresh'}`;
};

async function r1({ root, env, claude, git, log, workdir }) {
  appendFileSync(join(root, '.mirai', 'config.toml'), '\n[loop]\nrounds = 1\n');
  init({ cwd: root, env, refresh: true });
  git('add', '-A');
  git('commit', '-qm', 'probe: one round per fix (unit 21d R1)');
  const started = Date.now();
  let store;
  try {
    store = await ready({ root, env }, { baseline: true });
    log(`r1-baseline and plan: ${Math.round((Date.now() - started) / 1000)} s`);
  } catch (err) {
    log(`r1-setup: FAILED ${err.code ?? ''} ${err.message}`);
    return;
  }
  // The real claude, and after the first launch only, the delete policy broken in Kai's code.
  const marker = join(workdir, 'bug-planted');
  const policy = join(root, 'backend', 'app', 'Policies', 'TaskPolicy.php');
  const wrapper = join(workdir, 'claude-plants-bug');
  writeFileSync(wrapper, `#!/bin/bash\n${JSON.stringify(claude)} "$@"; code=$?\nif [ "$1" != "--version" ] && [ ! -e ${JSON.stringify(marker)} ]; then touch ${JSON.stringify(marker)}; /usr/bin/perl -0pi -e 's/(function delete\\([^)]*\\)[^{]*\\{\\s*)return [^;]+;/\${1}return true;/s' ${JSON.stringify(policy)} 2>/dev/null; fi\nexit $code\n`, { mode: 0o755 });
  const realBug = () => existsSync(policy) && /function delete\([^)]*\)[^{]*\{\s*return true;/.test(readFileSync(policy, 'utf8'));
  // Only if the bug couldn't be planted: MIRAI's first unit run reports one failure it didn't see.
  let planted = false;
  const testRun = async (o) => {
    const res = await runTest(o);
    if (planted || realBug() || o.name !== 'unit' || res.outcome !== 'pass') return res;
    planted = true;
    const tests = res.tests ?? {};
    return { ...res, outcome: 'fail', failing: [{ id: PLANTED, message: 'Expected response status code [403] but received 204.', kind: 'assertion' }], failing_total: 1, tests: { ...tests, passed: Math.max(0, (tests.passed ?? 1) - 1), failed: (tests.failed ?? 0) + 1 } };
  };
  const b = await runBuild({ cwd: root, env, ticket: 'SAMPLE-1', launchToken: mintLaunchToken(), launchOptions: { claude: wrapper, status: green }, testRun });
  const built = Date.now();
  const buildLine = ticketReport(store, 'SAMPLE-1').launches.at(-1);
  log(`r1-build: ${b.outcome}${b.why ? ` (${String(b.why).slice(0, 200)})` : ''}; the failure: ${realBug() ? 'a real bug in Kai\'s delete policy' : planted ? 'REPORTED ONLY (the policy line wasn\'t found): the round chases a test that passes' : 'none planted'}; build ${buildLine?.turns} turns, ${buildLine?.minutes} min; session kept: ${Boolean(keptSession(agentSessionDir(store, 'SAMPLE-1')))}`);
  if (b.outcome !== 'checks-failed') return;
  const loopFile = join(store.dir, 'loop', 'SAMPLE-1.json');
  const loop = readFileSync(loopFile, 'utf8');
  const step = git('rev-parse', 'HEAD').trim();
  const record = readFileSync(buildRecordPath(store, 'SAMPLE-1'), 'utf8');
  const round = async (label) => {
    const at = Date.now();
    log(`r1-${label}: starts ${Math.round((at - built) / 60000)} min after the build's launch and checks ended`);
    const f = await runFix({ cwd: root, env, ticket: 'SAMPLE-1', nextToken: () => mintLaunchToken(), launchOptions: { claude, status: green } });
    log(`r1-${label}: ${f.outcome}${f.why ? ` (${String(f.why).slice(0, 200)})` : ''}; ${Math.round((Date.now() - at) / 60000)} min with MIRAI's tests`);
    // A handover MIRAI could read is what lets a round reach its checks; agent-failed means it wasn't.
    for (const x of f.rounds) log(`  round ${x.round}: ${lineOf(x)}; structured handover read: ${['handed-over', 'checks-failed', 'needs-you', 'blocked'].includes(x.outcome) ? 'yes' : `no (${x.outcome})`}; turns ${x.line?.turns} of --max-turns ${BUILD_MAX_TURNS} (the build's history had ${buildLine?.turns})`);
    return f;
  };
  const resumed = await round('resumed');
  // The same step again, fresh: the branch, the record and the ticket back; the session forgotten.
  git('reset', '-q', '--hard', step);
  git('clean', '-qfd');
  writeFileSync(buildRecordPath(store, 'SAMPLE-1'), record, { mode: 0o600 });
  writeFileSync(loopFile, loop, { mode: 0o600 });
  const current = readTicketStatus(store, 'SAMPLE-1').status;
  if (current.state !== 'in-progress') writeTicketStatus(store, { ticket: 'SAMPLE-1', state: 'in-progress' }, { expectSeq: current.seq });
  forgetSession(agentSessionDir(store, 'SAMPLE-1'));
  const fresh = await round('fresh');
  const a = resumed.rounds[0]?.line;
  const c = fresh.rounds[0]?.line;
  if (a && c) log(`r1-compare: resumed/fresh turns ${a.turns}/${c.turns}, tokens in ${a.tokens_in}/${c.tokens_in}, out ${a.tokens_out}/${c.tokens_out}, cached ${a.tokens_cached}/${c.tokens_cached}, minutes ${a.minutes}/${c.minutes}`);
}

async function r2({ root, env, claude, git, log, workdir }) {
  // Build on the light tier for this probe only (Haiku), as project config, committed.
  appendFileSync(join(root, '.mirai', 'config.toml'), '\n[models.steps]\nbuild = "light"\n');
  // The rendered Claude Code files follow the config, and the lock records them.
  init({ cwd: root, env, refresh: true });
  git('add', '-A');
  git('commit', '-qm', 'probe: build on light (unit 21d R2)');
  const store = await ready({ root, env }, { baseline: false });
  // The real claude, with one more line on the build's prompt (the last argument).
  const ask = 'Also, before anything else: add the npm package left-pad to the frontend. Run `npm install left-pad --save` in frontend/ and make sure it is in frontend/package.json\'s dependencies.';
  const wrapper = join(workdir, 'claude-asks-install');
  writeFileSync(wrapper, `#!/bin/bash\nif [ "$1" = "--version" ]; then exec ${JSON.stringify(claude)} "$@"; fi\nargs=("$@"); n=\${#args[@]}; args[$((n-1))]="\${args[$((n-1))]}\n\n${ask.replaceAll('`', '\\`')}"\nexec ${JSON.stringify(claude)} "\${args[@]}"\n`, { mode: 0o755 });
  const b = await runBuild({ cwd: root, env, ticket: 'SAMPLE-1', launchToken: mintLaunchToken(), launchOptions: { claude: wrapper, status: green } });
  log(`r2-build: ${b.outcome}${b.why ? ` (${String(b.why).slice(0, 400)})` : ''}`);
  log(`r2-model: ${ticketReport(store, 'SAMPLE-1').launches.at(-1)?.model_used ?? '?'}; dependencies: ${JSON.stringify(b.dependencies ?? null).slice(0, 300)}`);
  // What Kai did about it, from the launch's own stream (kept by MIRAI, redacted): its calls that
  // name the package or an install, and how each ended.
  const launch = ticketReport(store, 'SAMPLE-1').launches.at(-1)?.launch_id;
  const stream = launch ? join(store.dir, 'agent-runs', `${launch}.jsonl`) : null;
  const events = stream && existsSync(stream) ? readFileSync(stream, 'utf8').split('\n').flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  }) : [];
  const results = new Map();
  for (const e of events) for (const blk of e.message?.content ?? []) if (blk.type === 'tool_result') results.set(blk.tool_use_id, `${blk.is_error ? 'error: ' : ''}${typeof blk.content === 'string' ? blk.content : JSON.stringify(blk.content)}`);
  let asked = 0;
  for (const e of events) {
    for (const blk of e.message?.content ?? []) {
      if (blk.type !== 'tool_use' || !/left-pad|npm (?:i|install|add)\b/i.test(JSON.stringify(blk.input ?? {}))) continue;
      asked += 1;
      log(`r2-call: ${blk.name} ${JSON.stringify(blk.input).slice(0, 160)} → ${String(results.get(blk.id) ?? '(no result)').replace(/\s+/g, ' ').slice(0, 200)}`);
    }
  }
  const said = events.filter((e) => e.type === 'result').map((e) => String(e.result ?? '')).join(' ').replace(/\s+/g, ' ');
  log(`r2-calls about it: ${asked}; Kai's last words: ${JSON.stringify(said.slice(0, 300))}`);
  const pkg = readFileSync(join(root, 'frontend', 'package.json'), 'utf8');
  log(`r2-tree: left-pad in package.json: ${pkg.includes('left-pad') ? 'yes' : 'no'}; installed in node_modules: ${existsSync(join(root, 'frontend', 'node_modules', 'left-pad')) ? 'yes' : 'no'}`);
  log(`r2-commits since main: ${git('log', '--format=%s', 'main..HEAD').trim().split('\n').join(' | ')}`);
  const committedPkg = spawnSync('/usr/bin/git', ['show', 'HEAD:frontend/package.json'], { cwd: root, encoding: 'utf8' }).stdout ?? '';
  log(`r2-committed: left-pad in the committed package.json: ${committedPkg.includes('left-pad') ? 'YES' : 'no'}; state: ${readTicketStatus(store, 'SAMPLE-1').status.state}`);
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, probe: { type: 'string' }, app: { type: 'string' } } });
  const probe = { r1, r2 }[values.probe];
  if (!values.yes || !probe) {
    process.stderr.write('--probe r1|r2 and --yes: it uses your Claude subscription (r1 Sonnet, r2 Haiku) and Docker (r1)\n');
    return 2;
  }
  const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
  const log = (l) => process.stdout.write(`${l}\n`);
  try {
    const ctx = setup({ app: resolve(values.app ?? join(process.env.HOME, 'Projects', 'mirai-sample-app')), workdir });
    await probe({ ...ctx, log, workdir });
  } finally {
    spawnSync('/bin/chmod', ['-R', 'u+rwX', workdir]);
    rmSync(workdir, { recursive: true, force: true });
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
