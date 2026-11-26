#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { parseArgs } from 'node:util';

import { mintLaunchToken } from '../../src/agent/requests.js';
import { exitCodeOf, formatError } from '../../src/cli/errors.js';
import { main } from '../../src/cli/main.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { readToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { runTess } from '../../src/tess/run.js';
import { runVerify } from '../../src/verify/run.js';
import { tessHome } from './tess-probes.js';

// Unit 45b's probes (spec "Probes (real)"), each in a probe home of 42's (the sample app, MIRAI, a
// key, your token, a kept Claude Code), with the red-team gate stubbed green as 42's are.
// - P1: `mirai models`, `mirai models set verify deep`, the commit "merged" (the home works on main's
//   snapshot: the probe commits on main), then one Vera check (Opus). Pass when the listing showed
//   the change and its source, and her run line names Opus.
// - P2: `mirai models set standard sonnet --mine` (Claude Code's alias for its newest Sonnet: another
//   Sonnet than the pinned one), then one Tess run. Pass when her run line names it, says it came
//   from your personal file, and the project config is unchanged.

const green = async () => ({ state: 'green', blocker_seen: null, changed: [] });
const gitEnvOf = (home) => ({ PATH: '/usr/bin:/bin', HOME: home.home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
const git = (home, ...a) => spawnSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: home.root, env: gitEnvOf(home), encoding: 'utf8' });

async function term(home, argv) {
  let out = '';
  let err = '';
  const code = await main(argv, { stdin: Readable.from(['\n']), stdout: { isTTY: false, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: home.env, cwd: home.root });
  return { code, out, err };
}
// Every agent_run line of the home's runs, newest last.
function runLines(home) {
  const dir = join(openStore({ cwd: home.root, env: home.env }).dir, 'runs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort().flatMap((n) => readFileSync(join(dir, n), 'utf8').split('\n').filter(Boolean).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })).filter((e) => e?.event === 'agent_run');
}

export async function p1(home, log, fakes = {}) {
  const checks = {};
  const on = (b) => git(home, 'switch', '-q', b);
  on('main');
  const before = await term(home, ['models']);
  log(before.out.split('\n').find((l) => l.startsWith('verify ')) ?? '');
  const set = await term(home, ['models', 'set', 'verify', 'deep']);
  log(set.out.trim() || set.err.trim());
  checks.set = set.code === 0 && /set: models\.steps\.verify = deep/.test(set.out);
  git(home, 'add', '-A');
  git(home, 'commit', '-qm', 'MIRAI models: verify deep');
  const after = await term(home, ['models']);
  const row = after.out.split('\n').find((l) => l.startsWith('verify ')) ?? '';
  log(row);
  checks.listed = /Vera \(mirai-verifier\) +deep +claude-opus-5-5 +Claude Code +\.mirai\/config\.toml:\d+/.test(row);
  on('probe-p1');
  git(home, 'merge', '-q', '--no-edit', 'main');
  const r = await runVerify({ cwd: home.root, env: home.env, file: '.mirai/context/business.md', launchToken: mintLaunchToken(), launchOptions: { status: green }, ...(fakes.launch ? { launch: fakes.launch } : {}) });
  const line = runLines(home).filter((e) => e.step === 'verify').at(-1);
  log(`Vera's run line: tier ${line?.tier}, model ${line?.model}${line?.model_used ? ` (reported ${line.model_used})` : ''}; ${line?.tier_reason ?? ''}`);
  log(`her result: ${r.entry ? `round ${r.entry.round}, ${r.entry.must_fix} must-fix` : r.outcome}`);
  checks.opus = line?.tier === 'deep' && /opus/i.test(line?.model ?? '') && (fakes.launch || /opus/i.test(line?.model_used ?? ''));
  return checks;
}

export async function p2(home, log, fakes = {}) {
  const checks = {};
  const cfg = readFileSync(join(home.root, '.mirai', 'config.toml'), 'utf8');
  const set = await term(home, ['models', 'set', 'standard', 'sonnet', '--mine']);
  log(set.out.trim() || set.err.trim());
  checks.set = set.code === 0 && /your personal file/.test(set.out);
  const r = await runTess({ cwd: home.root, env: home.env, initiative: 'due-dates', nextToken: () => mintLaunchToken(), launchOptions: { status: green }, ...(fakes.launch ? { launch: fakes.launch, verifyLaunch: fakes.verifyLaunch } : {}) });
  log(`Tess: ${r.state}${r.why ? `: ${r.why}` : ''}`);
  const line = runLines(home).filter((e) => e.step === 'tickets').at(-1);
  log(`her run line: tier ${line?.tier}, model ${line?.model}${line?.model_used ? ` (reported ${line.model_used})` : ''}; ${line?.tier_reason ?? ''}`);
  checks.model = line?.model === 'sonnet' && /standard: sonnet from your personal file/.test(line?.tier_reason ?? '');
  checks.projectUnchanged = readFileSync(join(home.root, '.mirai', 'config.toml'), 'utf8') === cfg && git(home, 'status', '--porcelain', '--', '.mirai/config.toml').stdout.trim() === '';
  const tessEnd = readJournal(openStore({ cwd: home.root, env: home.env })).events.filter((e) => e.type === 'tess_run').at(-1);
  if (tessEnd?.model) log(`tess_run line: ${tessEnd.tier}, ${tessEnd.model}`);
  return checks;
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, probe: { type: 'string' } } });
  const log = (l) => process.stdout.write(`${l}\n`);
  const probe = { p1, p2 }[values.probe];
  if (!probe || !values.yes) {
    process.stderr.write('--probe p1|p2 --yes: P1 one Vera check on Opus; P2 one Tess run on Sonnet (her Vera checks on Sonnet too)\n');
    return 2;
  }
  const token = readToken(process.env);
  if (!token) throw new Error('no Claude login token: mirai token set');
  const workdir = realpathSync(mkdtempSync(join(process.env.HOME, '.mirai-probes-')));
  const home = { ...(await tessHome({ workdir, key: values.probe, c: { initiative: 'due-dates' }, claude: resolveClaude(process.env), token })), workdir, home: join(workdir, 'home') };
  log(`the probe home: ${workdir}`);
  let checks;
  try {
    checks = await probe(home, log);
  } catch (err) {
    log(`stopped: ${formatError(err).trim()}`);
    checks = { ran: false };
  }
  for (const [k, v] of Object.entries(checks)) log(`${v ? 'pass' : 'FAIL'}  ${k}`);
  const pass = Object.values(checks).every(Boolean);
  log(`${values.probe}: ${pass ? 'PASS' : 'FAIL'}`);
  if (pass) {
    spawnSync('/bin/chmod', ['-R', 'u+rwX', workdir]);
    rmSync(workdir, { recursive: true, force: true });
    log('the home is deleted');
  } else log(`the home is kept: ${workdir}`);
  return pass ? 0 : 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url).pathname)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(formatError(err));
    process.exit(exitCodeOf(err));
  });
}
