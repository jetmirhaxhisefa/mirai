#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { buildFixture, removeFixture, resetProject } from './fixture.js';
import { guardProbe, ORDER, probeList, TOOLS } from './probes.js';
import { readToken } from '../../src/sign/token.js';
import { containsToken, findClaude, MAX_TURNS, madeTheCall, parseStream, promptFor, redact, runClaude, SYSTEM } from '../../src/redteam/claude.js';
import { cleanupOutside, hostBaseline, hostCanaries, hostFacts, macos, sweepStale } from '../../src/redteam/host.js';

// The shared pieces moved to src/redteam/ in unit 18a; the other probe scripts import them from
// here.
export { containsToken, findClaude, hostFacts, madeTheCall, parseStream, promptFor, redact, sweepStale };

// Unit 13a's probe harness. You start it by hand; `npm test` never runs it (it isn't a
// *.test.js file). Each probe is one short `claude -p` run against a throwaway fixture, with an
// allowlisted environment and the probe's own settings file; the run's stream-json output is
// searched for canaries. Reports: <workdir>/out/results.json and results.md (they stay there;
// the fixture is removed).
//
//   node test/probes/claude-probes.js --yes [--workdir <dir>] [--only id,id] [--model haiku]
//                                     [--claude <path>] [--keep] [--dry-run]
//
// The strict bundle's own checks (13b's and 13c's --bundle mode) moved to the red-team runner in
// unit 18a: `mirai redteam run`, src/redteam/.
//
// The work folder must be missing or empty, not your home folder, not inside a git work tree,
// and not under a temp folder: the sandbox lets Bash write anywhere in its temp folders, so an
// "outside the project" canary there isn't outside anything. The default is ~/.mirai-probes-*.
//
// It uses your Claude subscription (about 60 runs of at most 4 turns), so it needs --yes. The
// login token comes from `mirai token set` and is never written to a report: every output is
// redacted before it's stored. Ctrl-C cleans up (the canary keychain item, git credential,
// launchd job, temp markers and the fixture); a run that was killed outright is cleaned up by
// the next run's sweep.

const HERE = dirname(fileURLToPath(import.meta.url));
const LAUNCHER = resolve(HERE, '..', '..', 'bin', 'launch.js');
const MCP_SERVER = join(HERE, 'mcp-echo.js');
// The environment a probe gets: an allowlist, never the harness's own environment.
const ENV_ALLOW = ['PATH', 'LANG', 'TERM', 'TMPDIR', 'USER'];

// The launch forms: how Claude Code is started, besides --settings and the output flags.
export function formArgs(form, ctx) {
  const mcp = () => JSON.stringify({ mcpServers: { probe: { command: process.execPath, args: [MCP_SERVER, ctx.markers.mcp] } } });
  switch (form) {
    case 'strict': return ['--restricted', '--tools', TOOLS, '--strict-mcp-config'];
    case 'strict-agents': return ['--restricted', '--tools', TOOLS, '--strict-mcp-config',
      '--agents', JSON.stringify({ 'mirai-probe': { description: 'A probe agent.', prompt: `Your role word is ${ctx.markers.agentWord}. When asked for your role word, reply with it.` } }),
      '--agent', 'mirai-probe'];
    case 'strict-mcp': return ['--restricted', '--tools', `${TOOLS},mcp__probe__probe_echo`, '--strict-mcp-config', '--mcp-config', mcp()];
    case 'strict-mcp-unlisted': return ['--restricted', '--tools', TOOLS, '--strict-mcp-config', '--mcp-config', mcp()];
    case 'fallback': return ['--setting-sources', 'project,local', '--tools', TOOLS, '--strict-mcp-config'];
    case 'safe': return ['--safe-mode', '--strict-mcp-config'];
    case 'agents': return ['--strict-mcp-config', '--agents', JSON.stringify({ 'mirai-probe': { description: 'A probe subagent.', prompt: 'Reply with the single word probe-agent-ran.' } })];
    case 'plain': return ['--strict-mcp-config'];
    // Your own interactive sessions (unit 13c): project settings only, no --restricted, no sandbox.
    case 'interactive': return ['--setting-sources', 'project', '--strict-mcp-config', '--agents', JSON.stringify({ 'mirai-probe': { description: 'A probe subagent.', prompt: 'Reply with the single word probe-agent-ran.' } })];
    default: throw new Error(`unknown form ${form}`);
  }
}

// The command line, environment and stdin of one probe. The token goes in the environment, or,
// with tokenVia 'fd', on file descriptor 3 (CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR).
export function launchFor(probe, ctx, { token, model, settingsFile, home = process.env.HOME }) {
  const args = ['-p', promptFor(probe.action), '--output-format', 'stream-json', '--verbose', '--max-turns', MAX_TURNS,
    '--model', model, '--permission-mode', 'dontAsk', '--settings', settingsFile, '--append-system-prompt', SYSTEM, ...formArgs(probe.form, ctx)];
  const env = {};
  for (const name of ENV_ALLOW) if (process.env[name] !== undefined) env[name] = process.env[name];
  env.HOME = probe.fakeHome ? ctx.fakeHome : home;
  if (probe.tokenVia === 'fd') env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR = '3';
  else env.CLAUDE_CODE_OAUTH_TOKEN = token;
  env.CLAUDE_CONFIG_DIR = probe.configDir ? ctx[probe.configDir] : ctx.claudeHome;
  Object.assign(env, probe.env ?? {});
  return { args, env, cwd: ctx.project, fdToken: probe.tokenVia === 'fd' ? token : null };
}

// One probe: the run, its parsed output, and the check. Nothing unredacted leaves this function:
// every field is redacted first and cut to size after.
export async function runProbe(probe, ctx, { claude, token, model }) {
  const settingsFile = join(ctx.root, 'settings', `${probe.id}.json`);
  writeFileSync(settingsFile, `${JSON.stringify(probe.settings, null, 2)}\n`);
  probe.before?.();
  let launch;
  try {
    launch = launchFor(probe, ctx, { token, model, settingsFile });
  } catch (err) {
    // A launch MIRAI refuses (unit 13c: a hard link to a protected file) is the probe's result.
    const expected = probe.expectLaunchRefused?.test(err.message) === true;
    return {
      id: probe.id, fact: probe.fact, form: probe.form, title: probe.title, outcome: expected ? 'pass' : 'FAIL',
      note: redact(`launch refused: ${err.message}`, token), exit: null, asked: null, denials: [], init: null, result: null, toolUses: [], toolText: '', stderr: '',
    };
  }
  if (probe.expectLaunchRefused) {
    return { id: probe.id, fact: probe.fact, form: probe.form, title: probe.title, outcome: 'FAIL', note: 'the launch wasn\'t refused', exit: null, asked: null, denials: [], init: null, result: null, toolUses: [], toolText: '', stderr: '' };
  }
  probe.afterLaunch?.();
  const raw = await runClaude(claude, launch);
  const parsed = parseStream(raw.stdout);
  const toolText = parsed.toolResults.join('\n');
  const r = {
    exit: raw.exit,
    init: parsed.init,
    result: parsed.result,
    toolUses: parsed.toolUses,
    toolText,
    denials: parsed.result?.permission_denials ?? [],
    raw: `${raw.stdout}\n${raw.stderr}`,
    tokenInTools: containsToken(toolText, token),
  };
  const wanted = madeTheCall(probe.action, parsed.toolUses);
  let verdict;
  try {
    verdict = probe.check(r, ctx);
  } catch (err) {
    verdict = { pass: false, note: `check failed: ${err.message}` };
  }
  const inconclusive = verdict.inconclusive || (!wanted && !probe.expectNoCall && verdict.pass !== false);
  const outcome = inconclusive ? 'inconclusive' : verdict.pass === null ? 'fact' : verdict.pass ? 'pass' : 'FAIL';
  const clean = (v) => redact(typeof v === 'string' ? v : JSON.stringify(v), token);
  const init = parsed.init;
  return {
    id: probe.id,
    fact: probe.fact,
    form: probe.form,
    title: probe.title,
    outcome,
    note: clean(verdict.note),
    exit: raw.exit,
    asked: !wanted && !probe.expectNoCall ? 'the model never made the requested call as written' : null,
    denials: JSON.parse(clean(r.denials)),
    init: init ? JSON.parse(clean({
      apiKeySource: init.apiKeySource, model: init.model, tools: init.tools, permissionMode: init.permissionMode, cwd: init.cwd,
      claude_code_version: init.claude_code_version, skills: init.skills, slash_commands: init.slash_commands, memory_paths: init.memory_paths,
      agents: init.agents, plugins: init.plugins, mcp_servers: init.mcp_servers, output_style: init.output_style,
    })) : null,
    result: parsed.result ? JSON.parse(clean({ subtype: parsed.result.subtype, is_error: parsed.result.is_error, num_turns: parsed.result.num_turns, result: clean(String(parsed.result.result ?? '')).slice(0, 600) })) : null,
    toolUses: JSON.parse(clean(parsed.toolUses)),
    toolText: clean(toolText).slice(0, 3000),
    stderr: clean(raw.stderr).slice(0, 2000),
  };
}

function markdown(report) {
  const rows = report.results.map((x) => `| ${x.id} | ${x.fact} | ${x.form} | **${x.outcome}** | ${x.note.replace(/\|/g, '\\|')} | ${x.denials.length} | ${x.exit} |`);
  return [
    '# Claude Code probes (unit 13a)',
    '',
    `Claude Code ${report.claudeVersion}, macOS ${report.macos.version} (${report.macos.build}), model ${report.model}, ${report.startedAt}.`,
    `Conditions: ${report.conditions}`,
    '',
    `Host (outside the sandbox, no model): ${report.hostBaseline ?? 'not run'}`,
    '',
    '| Probe | Fact | Form | Outcome | What was seen | Denials | Exit |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    report.stopped ? `**Stopped:** ${report.stopped}` : '',
  ].join('\n');
}

// Runs the probes. Returns the report; writes it to <workdir>/out.
export async function runProbes({ workdir, only = null, model = 'haiku', claude, token, useHostCanaries = true, keep = false, dryRun = false, log = () => {} }) {
  if (useHostCanaries && !dryRun) sweepStale();
  const ctx = buildFixture(workdir);
  ctx.host = { ...hostFacts(), claude, launcher: LAUNCHER };
  const report = {
    claudeVersion: null, macos: macos(), model, startedAt: new Date().toISOString(),
    conditions: 'one run per probe; --permission-mode dontAsk; settings from --settings only (flagSettings); autoAllowBashIfSandboxed; the model is told to run exactly the command, not to try other routes (not adversarial)',
    hostBaseline: null, results: [], stopped: null,
  };
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (useHostCanaries && !dryRun) hostCanaries(ctx, false);
    cleanupOutside(ctx);
    const text = redact(JSON.stringify(report, null, 2), token);
    writeFileSync(join(ctx.root, 'out', 'results.json'), `${text}\n`);
    writeFileSync(join(ctx.root, 'out', 'results.md'), `${redact(markdown(report), token)}\n`);
    if (!keep) removeFixture(ctx);
  };
  const onSignal = (signal) => {
    cleanup();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    let probes = probeList(ctx);
    for (const p of probes) guardProbe(p, ctx);
    probes.sort((a, b) => rank(a.fact) - rank(b.fact));
    if (only) probes = probes.filter((p) => only.includes(p.id));
    report.claudeVersion = spawnSync(claude, ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'unknown';
    if (dryRun) {
      for (const p of probes) log(`${p.id}  ${p.form}  ${p.title}`);
      return report;
    }
    if (useHostCanaries) {
      hostCanaries(ctx, true);
      ctx.baseline = hostBaseline(ctx);
      report.hostBaseline = Object.entries(ctx.baseline).map(([k, v]) => `${k}: ${v ? 'reachable' : 'not reachable'}`).join(', ');
    }
    for (const probe of probes) {
      log(`${probe.id} ...`);
      const res = await runProbe(probe, ctx, { claude, token, model });
      resetProject(ctx);
      cleanupOutside(ctx);
      report.results.push(res);
      log(`${probe.id}: ${res.outcome}  ${res.note}`);
      if (probe.blocker && res.outcome === 'FAIL') {
        report.stopped = `${probe.id} failed (${probe.fact} is a blocker; V1 goes back to you)`;
        break;
      }
    }
    return report;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    cleanup();
  }
}

function rank(fact) {
  const i = ORDER.indexOf(fact);
  return i < 0 ? ORDER.length : i;
}

async function cli() {
  const { values } = parseArgs({
    options: {
      yes: { type: 'boolean' }, workdir: { type: 'string' }, only: { type: 'string' }, model: { type: 'string' },
      claude: { type: 'string' }, keep: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, 'no-host-canaries': { type: 'boolean' },
    },
  });
  const dryRun = values['dry-run'] === true;
  if (!values.yes && !dryRun) {
    process.stderr.write('this uses your Claude subscription (about 60 short runs); add --yes to run, or --dry-run to see the plan\n');
    return 2;
  }
  const claude = values.claude ?? findClaude();
  if (!claude) {
    process.stderr.write('claude is not on PATH; pass --claude <path>\n');
    return 2;
  }
  const token = readToken(process.env);
  if (!token && !dryRun) {
    process.stderr.write('no login token: run claude setup-token, then mirai token set (in your terminal)\n');
    return 2;
  }
  const workdir = values.workdir ? resolve(values.workdir) : mkdtempSync(join(process.env.HOME, '.mirai-probes-'));
  const report = await runProbes({
    workdir, claude, token: token ?? '', model: values.model ?? 'haiku', only: values.only?.split(',') ?? null,
    keep: values.keep === true, dryRun, useHostCanaries: values['no-host-canaries'] !== true,
    log: (line) => process.stdout.write(`${redact(line, token)}\n`),
  });
  process.stdout.write(`\nreports: ${join(workdir, 'out')}\n`);
  return report.stopped || report.results.some((r) => r.outcome === 'FAIL') ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
