#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { findClaude, hostFacts, parseStream, redact } from './claude-probes.js';
import { buildFixture, buildTrustRoot, removeFixture } from './fixture.js';
import { FRAMEWORK_PARTS, PACKAGE_ROOT } from '../../src/install/parts.js';
import { loadRegistry } from '../../src/config/registry.js';
import { commitOf } from '../../src/store/git.js';
import { readToken } from '../../src/sign/token.js';
import { prepareLaunch, removeLaunch, strictTemplate } from '../../src/launch/strict.js';

// Unit 14d's MCP fact probes (M1–M6). You start it by hand; `npm test` never runs it. Each probe
// is one short Haiku run through the strict bundle's real prepareLaunch plan (13b's fixture),
// with a probe MCP server added by `--mcp-config` (mcp-facts-server.js). The server logs what
// it was given, names only; the harness reads that log and the run's stream-json events.
// Reports: <workdir>/out/mcp-results.json and .md (they stay; the fixture is removed).
//
//   node test/probes/mcp-probes.js --yes [--workdir <dir>] [--only id,id] [--dry-run]
//
// It uses your Claude subscription (6 runs; m5-12min waits 12 minutes, about 20 minutes in
// all), so it needs --yes. The token never reaches a report: everything is redacted first.

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, 'mcp-facts-server.js');
const REGISTRY = resolve(HERE, '..', '..', 'registry');
const TOOL = (name) => `mcp__probe__${name}`;
const LONG_TIMEOUT = '7200000';
const SYSTEM = 'You are the executor in an automated test on the machine owner\'s own computer. '
  + 'Make exactly the tool call you are asked for, once, with the input exactly as written; if it fails or is refused, do not try another way. Then answer as asked.';

const ask = (tool, args) => `Call the tool ${TOOL(tool)} once${args ? ` with the arguments ${JSON.stringify(args)}` : ', with no arguments'}. Then reply with exactly what it returned.`;

export const PROBES = [
  { id: 'm1-facts', fact: 'M1 M3 M4', title: 'the server starts from --mcp-config, is connected in init, and reaches Docker and the store', allow: true, prompt: ask('probe_facts'),
    check: ({ run, log, ctx }) => {
      const server = (run.init?.mcp_servers ?? []).find((s) => s.name === 'probe');
      const facts = log.find((e) => e.event === 'facts');
      const answered = run.toolText.includes(ctx.markers.mcp);
      return { pass: server?.status === 'connected' && answered && facts?.docker === 'ok' && facts?.store === 'read', note: `init: ${JSON.stringify(server ?? null)}; answered: ${answered}; docker: ${facts?.docker}; store: ${facts?.store}` };
    } },
  { id: 'm2-no-allow', fact: 'M2', title: 'the same call without an allow rule, under dontAsk', allow: false, prompt: ask('probe_facts'),
    check: ({ run, ctx }) => {
      const denied = run.denials.some((d) => d.tool_name === TOOL('probe_facts'));
      const answered = run.toolText.includes(ctx.markers.mcp);
      return { pass: null, note: `denied: ${denied}; answered: ${answered}` };
    } },
  { id: 'm5-3min', fact: 'M5', title: 'a 3-minute call, MCP_TOOL_TIMEOUT set', allow: true, env: { MCP_TOOL_TIMEOUT: LONG_TIMEOUT }, prompt: ask('probe_sleep', { seconds: 180 }), waitMs: 600_000,
    check: ({ run, log, ctx }) => slept(run, log, ctx, 180) },
  { id: 'm5-default', fact: 'M5', title: 'a 3-minute call, MCP_TOOL_TIMEOUT not set (the default)', allow: true, prompt: ask('probe_sleep', { seconds: 180 }), waitMs: 600_000,
    check: ({ run, log, ctx }) => ({ ...slept(run, log, ctx, 180), pass: null }) },
  { id: 'm5-12min', fact: 'M5', title: 'a 12-minute call, MCP_TOOL_TIMEOUT set', allow: true, env: { MCP_TOOL_TIMEOUT: LONG_TIMEOUT }, prompt: ask('probe_sleep', { seconds: 720 }), waitMs: 1_200_000,
    check: ({ run, log, ctx }) => slept(run, log, ctx, 720) },
  { id: 'm6-kill', fact: 'M6', title: 'the run is ended (SIGTERM, then the process group killed) during a call', allow: true, env: { MCP_TOOL_TIMEOUT: LONG_TIMEOUT }, prompt: ask('probe_sleep', { seconds: 600 }), waitMs: 300_000, killAfterSleepStart: 20_000,
    check: ({ log }) => {
      const after = log.filter((e) => ['stdin-closed', 'signal', 'cancelled', 'exit'].includes(e.event)).map((e) => `${e.event}${e.sig ? ` ${e.sig}` : ''}@${e.t}ms`);
      return { pass: null, note: `the server saw: ${after.join(', ') || 'nothing'}; still running after: ${log.some((e) => e.event === 'alive-after') ? 'yes' : 'no'}` };
    } },
];

function slept(run, log, ctx, seconds) {
  const end = log.find((e) => e.event === 'sleep-end');
  const answered = run.toolText.includes(`${ctx.markers.mcp} slept ${seconds}`);
  const progress = log.find((e) => e.event === 'method' && e.method === 'tools/call')?.progressToken;
  return { pass: answered, note: `answered: ${answered}; server: ${end ? `finished ${end.finished}, ${end.waited} s` : 'no sleep-end'}; progress token sent: ${progress}; tool text: ${run.toolText.slice(0, 200)}` };
}

function readLog(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// One run in its own process group, so m6 can kill all of it as unit 19 will.
function runClaude(claude, { args, env, cwd, fdToken, waitMs, logFile, killAfterSleepStart }) {
  return new Promise((done) => {
    const child = spawn(claude, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    child.stdio[3].end(fdToken);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const killGroup = (sig) => {
      try {
        process.kill(-child.pid, sig);
      } catch {
        // gone
      }
    };
    const timer = setTimeout(() => killGroup('SIGKILL'), waitMs);
    let watch = null;
    if (killAfterSleepStart) {
      watch = setInterval(() => {
        const start = readLog(logFile).find((e) => e.event === 'sleep-start');
        if (!start) return;
        clearInterval(watch);
        setTimeout(() => {
          child.kill('SIGTERM');
          setTimeout(() => killGroup('SIGKILL'), 5000);
        }, killAfterSleepStart);
      }, 1000);
    }
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (watch) clearInterval(watch);
      done({ exit: code ?? -1, signal, stdout, stderr });
    });
  });
}

function launch(probe, ctx, { model, logFile }) {
  const trust = { dir: join(ctx.repoHome, 'trust', 'abc'), baseSha: ctx.baseSha, manifest: { files: [] }, manifestSha256: ctx.trustManifestSha256 };
  const plan = prepareLaunch({ trust, template: ctx.template, checkout: ctx.project, env: process.env, miraiHomeDir: ctx.miraiHome });
  ctx.launches.push(plan);
  const settings = JSON.parse(readFileSync(join(plan.launchDir, 'input', 'settings.json'), 'utf8'));
  if (probe.allow) settings.permissions.allow.push(TOOL('probe_facts'), TOOL('probe_sleep'));
  const settingsFile = join(ctx.root, 'settings', `${probe.id}.json`);
  writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  const args = [...plan.args];
  args[args.indexOf('--settings') + 1] = settingsFile;
  const storeFile = join(ctx.repoHome, 'store', 'state.json');
  const mcp = { mcpServers: { probe: { type: 'stdio', command: realpathSync(process.execPath), args: [SERVER, logFile, ctx.markers.mcp, ctx.host.dockerSocket ?? '', storeFile], env: { HOME: process.env.HOME } } } };
  args.push('--mcp-config', JSON.stringify(mcp));
  return {
    args: ['-p', probe.prompt, '--max-turns', '3', '--model', model, '--append-system-prompt', SYSTEM, ...args],
    env: { ...plan.env, ...(probe.env ?? {}) }, cwd: plan.cwd, fdToken: plan.fds[3],
  };
}

export async function runProbes({ workdir, only = null, model = 'haiku', claude, token, dryRun = false, log = () => {} }) {
  const ctx = buildFixture(workdir);
  ctx.host = hostFacts();
  ctx.template = strictTemplate({ registry: loadRegistry(REGISTRY), config: { compose: { env_file: '.env.test' } }, mode: 'read-write' });
  ctx.baseSha = commitOf(ctx.project, 'HEAD', process.env);
  ctx.trustManifestSha256 = buildTrustRoot(ctx, PACKAGE_ROOT, FRAMEWORK_PARTS);
  ctx.launches = [];
  const report = { claudeVersion: spawnSync(claude, ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'unknown', model, startedAt: new Date().toISOString(), results: [] };
  const probes = PROBES.filter((p) => !only || only.includes(p.id));
  try {
    if (dryRun) {
      for (const p of probes) log(`${p.id}  ${p.fact}  ${p.title}`);
      return report;
    }
    for (const probe of probes) {
      log(`${probe.id} ...`);
      const logFile = join(ctx.root, 'out', `${probe.id}.server.jsonl`);
      const l = launch(probe, ctx, { model, logFile });
      const raw = await runClaude(claude, { ...l, waitMs: probe.waitMs ?? 240_000, logFile, killAfterSleepStart: probe.killAfterSleepStart });
      if (probe.killAfterSleepStart) {
        // Is the server process still there after its run was killed?
        await new Promise((r) => setTimeout(r, 3000));
        const ps = spawnSync('pgrep', ['-f', logFile], { encoding: 'utf8' });
        if (ps.stdout.trim()) {
          writeFileSync(logFile, `${readFileSync(logFile, 'utf8')}${JSON.stringify({ event: 'alive-after' })}\n`);
          spawnSync('pkill', ['-f', logFile]);
        }
      }
      const parsed = parseStream(raw.stdout);
      const run = { init: parsed.init, toolText: parsed.toolResults.join('\n'), denials: parsed.result?.permission_denials ?? [], result: parsed.result };
      const serverLog = readLog(logFile);
      let verdict;
      try {
        verdict = probe.check({ run, log: serverLog, ctx });
      } catch (err) {
        verdict = { pass: false, note: `check failed: ${err.message}` };
      }
      const start = serverLog.find((e) => e.event === 'start');
      const init = serverLog.find((e) => e.event === 'initialize');
      const res = {
        id: probe.id, fact: probe.fact, title: probe.title,
        outcome: verdict.pass === null ? 'fact' : verdict.pass ? 'pass' : 'FAIL',
        note: redact(verdict.note, token), exit: raw.exit, signal: raw.signal,
        server: start ? { envNames: start.envNames, fds: start.fds, cwd: start.cwd } : null,
        initialize: init ? { protocolVersion: init.protocolVersion, capabilities: init.capabilities, clientInfo: init.clientInfo } : null,
        events: serverLog.filter((e) => e.event !== 'start').map((e) => `${e.event}${e.method ? ` ${e.method}` : ''}${e.sig ? ` ${e.sig}` : ''}@${e.t}`),
        initServers: parsed.init?.mcp_servers ?? null, initTools: (parsed.init?.tools ?? []).filter((t) => t.startsWith('mcp__')),
        result: parsed.result ? { subtype: parsed.result.subtype, is_error: parsed.result.is_error, num_turns: parsed.result.num_turns, duration_ms: parsed.result.duration_ms, text: redact(String(parsed.result.result ?? ''), token).slice(0, 400) } : null,
        stderr: redact(raw.stderr, token).slice(0, 1000),
      };
      report.results.push(JSON.parse(redact(JSON.stringify(res), token)));
      log(`${probe.id}: ${res.outcome}  ${res.note}`);
    }
    return report;
  } finally {
    for (const plan of ctx.launches) removeLaunch(plan.launchDir, plan.scratchDir);
    writeFileSync(join(ctx.root, 'out', 'mcp-results.json'), `${redact(JSON.stringify(report, null, 2), token)}\n`);
    const rows = report.results.map((x) => `| ${x.id} | ${x.fact} | **${x.outcome}** | ${x.note.replace(/\|/g, '\\|')} | ${x.exit} |`);
    writeFileSync(join(ctx.root, 'out', 'mcp-results.md'), `${redact(['# MCP probes (unit 14d)', '', `${report.claudeVersion}, model ${model}, ${report.startedAt}`, '', '| Probe | Fact | Outcome | Seen | Exit |', '|---|---|---|---|---|', ...rows].join('\n'), token)}\n`);
    removeFixture(ctx);
  }
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, workdir: { type: 'string' }, only: { type: 'string' }, 'dry-run': { type: 'boolean' }, claude: { type: 'string' } } });
  const dryRun = values['dry-run'] === true;
  if (!values.yes && !dryRun) {
    process.stderr.write('this uses your Claude subscription (6 short Haiku runs, about 20 minutes); add --yes to run, or --dry-run\n');
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
  const report = await runProbes({ workdir, claude, token: token ?? '', only: values.only?.split(',') ?? null, dryRun, log: (line) => process.stdout.write(`${redact(line, token)}\n`) });
  process.stdout.write(`\nreports: ${join(workdir, 'out')}\n`);
  return report.results.some((r) => r.outcome === 'FAIL') ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
