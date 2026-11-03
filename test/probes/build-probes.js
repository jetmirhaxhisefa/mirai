#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { HANDOVER_SCHEMA, runBuild } from '../../src/agent/build.js';
import { planPath } from '../../src/agent/plan.js';
import { mintLaunchToken } from '../../src/agent/requests.js';
import { runAgent } from '../../src/agent/run.js';
import { recordBaseline } from '../../src/baseline/record.js';
import { main } from '../../src/cli/main.js';
import { init } from '../../src/install/init.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { readToken, writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { readTicketStatus, writeTicketStatus } from '../../src/store/tickets.js';
import { snapshot, trustedConfig } from '../../src/trust/snapshot.js';

// Unit 21b's probes, on a sample-app clone with a probe home (your token copied in; your own
// ~/.claude is never touched: each launch has its own CLAUDE_CONFIG_DIR). The red-team gate is
// stubbed green, as in 19a's R6. Docker Desktop must be running.
// - R1 (Haiku, through --step commit-message): Kai as author, with the handover schema, calls
//   run_tests and run_check through MIRAI's server, then hands over. Does the stream carry it?
// - R2 (Sonnet, the build step's tier): `mirai build` end to end on SAMPLE-1, from 21a's R2 plan
//   (~/.mirai-21a-r2-plan.md), approved here; the baseline is recorded first (Docker only).
//   node test/probes/build-probes.js --yes --probe r1|r2 [--app <sample app>]

const TICKET = readFileSync(new URL('./plan-probes.js', import.meta.url), 'utf8').match(/const TICKET = `([^`]*)`;/)[1];
const KEPT_PLAN = join(process.env.HOME, '.mirai-21a-r2-plan.md');
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });

async function tty(argv, { cwd, env }, answers) {
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  let out = '';
  let err = '';
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: (t) => (out += t) }, stderr: { write: (t) => (err += t) }, env, cwd });
  return { code, out, err };
}

function setup({ app, workdir }) {
  const root = join(workdir, 'repo');
  mkdirSync(join(workdir, 'home'), { recursive: true, mode: 0o700 });
  const home = realpathSync(join(workdir, 'home'));
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: root, env: gitEnv }).toString();
  execFileSync('/usr/bin/git', ['clone', '--quiet', '--no-local', app, root], { env: gitEnv });
  git('remote', 'remove', 'origin');
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USER: process.env.USER, LANG: 'C' };
  init({ cwd: root, env, refresh: true });
  const key = createKeyPair(env);
  writePublicKeyFile(root, key.keyId, key.publicPem);
  mkdirSync(join(root, 'docs', 'mirai', 'tickets'), { recursive: true });
  writeFileSync(join(root, 'docs', 'mirai', 'tickets', 'SAMPLE-1.md'), TICKET);
  git('add', '-A');
  git('commit', '-qm', 'probe: refresh, a key and a ticket (unit 21b)');
  writeToken(env, readToken(process.env));
  // The probe home's way to the real Docker, as ~/.docker/run/docker.sock is in a real home.
  mkdirSync(join(home, '.docker', 'run'), { recursive: true });
  symlinkSync(join(process.env.HOME, '.docker', 'run', 'docker.sock'), join(home, '.docker', 'run', 'docker.sock'));
  return { root, env, git, claude: resolveClaude(process.env).real };
}

async function r1({ root, env, claude, log }) {
  const config = trustedConfig(snapshot({ cwd: root, env }));
  const level = config.testing?.levels?.find((l) => l.service)?.name;
  const check = Object.keys(config.checks ?? {})[0] ?? null;
  const prompt = [
    `Call mcp__mirai__run_tests once with level "${level}".`,
    ...(check ? [`Then call mcp__mirai__run_check once with name "${check}".`] : []),
    'Change no file. Then hand over with your structured output: status done, summary "probe", tests_run and checks_run each listing what you ran with its outcome.',
  ].join(' ');
  const r = await runAgent({ launchToken: mintLaunchToken(), cwd: root, env, claude, status: green, agent: 'mirai-developer', role: 'author', step: 'commit-message', maxTurns: 8, item: 'SAMPLE-1', prompt, jsonSchema: HANDOVER_SCHEMA });
  log(`r1-handover: ${r.outcome}${r.why ? ` (${r.why})` : ''}; structured ${JSON.stringify(r.structured)?.slice(0, 400)}; ${r.line.turns} turns, ${r.line.minutes} min; model ${r.line.model_used}`);
}

async function r2({ root, env, claude, git, log }) {
  if (!existsSync(KEPT_PLAN)) throw new Error(`no plan at ${KEPT_PLAN} (21a's R2 keeps it there)`);
  const io = { cwd: root, env };
  const a = await tty(['approve', 'SAMPLE-1', '--file', 'docs/mirai/tickets/SAMPLE-1.md'], io, ['a', 'SAMPLE-1']);
  if (a.code !== 0) throw new Error(`approving the ticket: ${a.err}`);
  // The baseline for the integration commit (Docker, no subscription).
  const started = Date.now();
  try {
    const b = await recordBaseline({ cwd: root, env });
    log(`r2-baseline: complete ${b.baseline?.complete ?? b.complete}; ${Math.round((Date.now() - started) / 1000)} s`);
  } catch (err) {
    log(`r2-baseline: FAILED ${err.code ?? ''} ${err.message}`);
  }
  // 21a's plan, stored and approved as `mirai plan` would leave it.
  const store = openStore(io);
  mkdirSync(dirname(planPath(store, 'SAMPLE-1')), { recursive: true, mode: 0o700 });
  writeFileSync(planPath(store, 'SAMPLE-1'), readFileSync(KEPT_PLAN, 'utf8'), { mode: 0o600 });
  const current = readTicketStatus(store, 'SAMPLE-1').status;
  writeTicketStatus(store, { ticket: 'SAMPLE-1', state: 'in-progress' }, { expectSeq: current.seq });
  const p = await tty(['approve', 'SAMPLE-1', '--plan'], io, ['a', 'SAMPLE-1']);
  if (p.code !== 0) throw new Error(`approving the plan: ${p.err}`);
  const r = await runBuild({ cwd: root, env, ticket: 'SAMPLE-1', launchToken: mintLaunchToken(), launchOptions: { claude, status: green } });
  const l = r.launch?.line;
  log(`r2-build: ${r.outcome}${r.why ? ` (${String(r.why).slice(0, 400)})` : ''}; branch ${r.branch}`);
  if (l) log(`r2-launch ${r.launch.id}: ${r.launch.outcome}; ${l.turns} turns, ${l.minutes} min, ${(l.tokens_in ?? 0) + (l.tokens_out ?? 0)} tokens (+${l.tokens_cached ?? 0} cached), ${l.model_used}, share ${l.limit_share ?? 'unknown'}`);
  if (r.handover) log(`r2-handover: ${r.handover.status}; ${r.handover.summary.slice(0, 600).replace(/\s+/g, ' ')}; tests ${JSON.stringify(r.handover.tests_run)}; checks ${JSON.stringify(r.handover.checks_run)}`);
  for (const t of r.tests?.runs ?? []) log(`r2-mirai-run ${t.name}: ${t.outcome} → ${t.verdict}${t.why ? ` (${t.why})` : ''}${t.fresh?.length ? `; new: ${t.fresh.slice(0, 8).join(', ')}` : ''}`);
  log(`r2-protected: ${JSON.stringify(r.protectedPaths?.touched?.map((x) => x.path) ?? [])}; dependencies added ${JSON.stringify(r.dependencies?.added ?? [])}`);
  const diff = git('diff', '--stat');
  const keep = join(process.env.HOME, '.mirai-21b-r2-diff.patch');
  writeFileSync(keep, `${git('status', '--porcelain')}\n${git('diff')}`);
  log(`r2-tree: ${diff.trim().split('\n').at(-1) ?? 'clean'}; the diff kept at ${keep}`);
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, probe: { type: 'string' }, app: { type: 'string' } } });
  const probe = { r1, r2 }[values.probe];
  if (!values.yes || !probe) {
    process.stderr.write('--probe r1|r2 and --yes: it uses your Claude subscription (r1 Haiku, r2 Sonnet) and Docker\n');
    return 2;
  }
  const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
  const log = (l) => process.stdout.write(`${l}\n`);
  try {
    const ctx = setup({ app: resolve(values.app ?? join(process.env.HOME, 'Projects', 'mirai-sample-app')), workdir });
    await probe({ ...ctx, log });
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
