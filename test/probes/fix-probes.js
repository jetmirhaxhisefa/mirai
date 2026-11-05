#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { runBuild } from '../../src/agent/build.js';
import { runFix } from '../../src/agent/fix.js';
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

// Unit 21c's probes, on a sample-app clone with a probe home (your token copied in; your own
// ~/.claude is never touched: each launch has its own CLAUDE_CONFIG_DIR). The red-team gate is
// stubbed green, as in 19a's R6. Docker Desktop must be running for R2.
// - R1 (Haiku, about 2 runs): does a kept session, restored into a fresh config folder, resume
//   under MIRAI's flags (--restricted, dontAsk), remember what it was told, and pass the init check?
// - R2 (Sonnet, 1 to 2 runs): a real fix round. A stand-in "build" applies Kai's SAMPLE-1 code from
//   your walkthrough (commit 314a9df) with one bug planted in the policy, MIRAI's own test run
//   catches it (checks-failed), and real Kai gets `mirai fix`'s rounds, in a fresh session.
//   node test/probes/fix-probes.js --yes --probe r1|r2 [--app <sample app>]

const TICKET = readFileSync(new URL('./plan-probes.js', import.meta.url), 'utf8').match(/const TICKET = `([^`]*)`;/)[1];
const KEPT_PLAN = join(process.env.HOME, '.mirai-21a-r2-plan.md');
const WALKTHROUGH = '314a9df';
const FILES = ['backend/app/Http/Controllers/TaskController.php', 'backend/app/Policies/TaskPolicy.php', 'backend/routes/api.php', 'backend/tests/Feature/TaskApiTest.php'];
const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });

async function tty(argv, { cwd, env }, answers) {
  const stdin = Readable.from([`${answers.join('\n')}\n`]);
  stdin.isTTY = true;
  let err = '';
  const code = await main(argv, { stdin, stdout: { isTTY: true, write: () => {} }, stderr: { write: (t) => (err += t) }, env, cwd });
  if (code !== 0) throw new Error(`${argv.join(' ')}: ${err}`);
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
  git('commit', '-qm', 'probe: refresh, a key and a ticket (unit 21c)');
  writeToken(env, readToken(process.env));
  mkdirSync(join(home, '.config', 'mirai'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "MIRAI Probe"\nauthor_email = "probe@example.invalid"\n', { mode: 0o600 });
  mkdirSync(join(home, '.docker', 'run'), { recursive: true });
  symlinkSync(join(process.env.HOME, '.docker', 'run', 'docker.sock'), join(home, '.docker', 'run', 'docker.sock'));
  return { root, env, git, home, claude: resolveClaude(process.env).real };
}

async function r1({ root, env, claude, log, workdir }) {
  const keep = join(workdir, 'session');
  const canary = `PELICAN-${Math.floor(Math.random() * 1e6)}`;
  const go = (o) => runAgent({ launchToken: mintLaunchToken(), cwd: root, env, claude, status: green, role: 'reviewer', step: 'commit-message', maxTurns: 3, item: 'SAMPLE-1', ...o });
  const a = await go({ prompt: `Remember this word for later: ${canary}. Use no tools. Reply only OK.`, session: { keep } });
  log(`r1-first: ${a.outcome}${a.why ? ` (${a.why})` : ''}; kept ${JSON.stringify(a.kept)}; reply ${JSON.stringify(String(a.text).slice(0, 60))}`);
  const b = await go({ prompt: 'What was the word I asked you to remember? Use no tools. Reply with the word only.', session: { keep, resume: keep } });
  log(`r1-resumed: ${b.outcome}${b.why ? ` (${b.why})` : ''}; resumed ${b.resumed}; reply ${JSON.stringify(String(b.text).slice(0, 80))}; REMEMBERED: ${String(b.text).includes(canary) ? 'YES' : 'no'}; kept again ${JSON.stringify(b.kept)}`);
}

async function r2({ root, env, claude, git, log }) {
  const io = { cwd: root, env };
  await tty(['approve', 'SAMPLE-1', '--file', 'docs/mirai/tickets/SAMPLE-1.md'], io, ['a', 'SAMPLE-1']);
  const started = Date.now();
  try {
    await recordBaseline({ cwd: root, env });
    log(`r2-baseline: ${Math.round((Date.now() - started) / 1000)} s`);
  } catch (err) {
    log(`r2-baseline: FAILED ${err.code ?? ''} ${err.message}`);
    return;
  }
  const store = openStore(io);
  mkdirSync(dirname(planPath(store, 'SAMPLE-1')), { recursive: true, mode: 0o700 });
  writeFileSync(planPath(store, 'SAMPLE-1'), readFileSync(KEPT_PLAN, 'utf8'), { mode: 0o600 });
  const current = readTicketStatus(store, 'SAMPLE-1').status;
  writeTicketStatus(store, { ticket: 'SAMPLE-1', state: 'in-progress' }, { expectSeq: current.seq });
  await tty(['approve', 'SAMPLE-1', '--plan'], io, ['a', 'SAMPLE-1']);
  // The seeded build: Kai's walkthrough code, with the owner check taken out of delete().
  const seed = join(root, '..', 'seed');
  mkdirSync(seed, { recursive: true });
  const app = resolve(process.env.MIRAI_APP ?? join(process.env.HOME, 'Projects', 'mirai-sample-app'));
  for (const f of FILES) {
    let text = execFileSync('/usr/bin/git', ['-C', app, 'show', `${WALKTHROUGH}:${f}`], { encoding: 'utf8' });
    if (f.endsWith('TaskPolicy.php')) text = text.replace(/(public function delete\(User \$user, Task \$task\): bool\s*\{\s*)return \$task->user_id === \$user->id;/, '$1return true;');
    mkdirSync(dirname(join(seed, f)), { recursive: true });
    writeFileSync(join(seed, f), text);
  }
  const stand = join(seed, 'claude');
  writeFileSync(stand, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "$(${JSON.stringify(claude)} --version)"; exit 0; fi\ncp -R ${seed}/backend .\necho '{"type":"system","subtype":"init","permissionMode":"dontAsk"}'\necho '${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'seeded', structured_output: { status: 'done', summary: 'Seeded build: delete route, controller, policy and three tests.' } })}'\n`, { mode: 0o755 });
  const b = await runBuild({ cwd: root, env, ticket: 'SAMPLE-1', launchToken: mintLaunchToken(), launchOptions: { claude: stand, status: green, check: () => [] } });
  log(`r2-seeded-build: ${b.outcome}${b.why ? ` (${String(b.why).slice(0, 300)})` : ''}`);
  for (const t of b.tests?.runs ?? []) log(`  ${t.name}: ${t.outcome} → ${t.verdict}${t.fresh?.length ? `; new: ${t.fresh.join(', ')}` : ''}`);
  if (b.outcome !== 'checks-failed') return;
  const f = await runFix({ cwd: root, env, ticket: 'SAMPLE-1', nextToken: () => mintLaunchToken(), launchOptions: { claude, status: green } });
  log(`r2-fix: ${f.outcome}${f.why ? ` (${String(f.why).slice(0, 300)})` : ''}`);
  for (const x of f.rounds) {
    const l = x.line;
    log(`r2-round ${x.round}: ${x.outcome} → ${x.decision ?? '-'}; ${l?.turns} turns, ${l?.minutes} min, ${(l?.tokens_in ?? 0) + (l?.tokens_out ?? 0)} tokens (+${l?.tokens_cached ?? 0} cached), ${l?.model_used}; ${x.resumed ? 'resumed' : 'fresh'}`);
    for (const t of x.tests?.runs ?? []) log(`    ${t.name}: ${t.outcome} → ${t.verdict}${t.fresh?.length ? `; new: ${t.fresh.join(', ')}` : ''}`);
  }
  log(`r2-ticket: ${readTicketStatus(store, 'SAMPLE-1').status.state}`);
  log(`r2-log: ${git('log', '--format=%s', 'main..HEAD').trim().split('\n').join(' | ')}`);
  const keep = join(process.env.HOME, '.mirai-21c-r2-fix.patch');
  writeFileSync(keep, git('show', 'HEAD'));
  log(`r2-fix-diff: kept at ${keep}`);
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, probe: { type: 'string' }, app: { type: 'string' } } });
  const probe = { r1, r2 }[values.probe];
  if (!values.yes || !probe) {
    process.stderr.write('--probe r1|r2 and --yes: it uses your Claude subscription (r1 Haiku, r2 Sonnet) and Docker (r2)\n');
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
