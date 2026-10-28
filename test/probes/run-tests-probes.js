#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { findClaude, parseStream, redact } from './claude-probes.js';
import { init } from '../../src/install/init.js';
import { DOCKER } from '../../src/tests/docker.js';
import { miraiHome } from '../../src/store/mirai-home.js';
import { readToken } from '../../src/sign/token.js';
import { snapshot, trustedStrict } from '../../src/trust/snapshot.js';
import { checkInit, prepareLaunch, removeLaunch } from '../../src/launch/strict.js';

// Unit 14d's end-to-end probes: MIRAI's real MCP server, started from a real launch plan
// (prepareLaunch, the trust root's bin/mcp.js, its read-only policy), against Docker Desktop, on a
// throwaway fixture repo under your home folder with MIRAI installed and a temporary MIRAI home.
// Local image only (nginx:1.27-alpine, never pulled); canaries only.
// - direct (no model): the server driven over its pipes, as Claude Code would: the refused
//   arguments, a real run_tests with a path, a run killed with SIGINT mid-call (nothing left in
//   Docker), and a host-side .git change between calls (refused, then stopped);
// - haiku (one run on your subscription, --yes): Haiku calls run_tests(level: "unit") and
//   run_check(name: "lint") in a real headless launch; both results come back inline, the init
//   event passes checkInit (MIRAI's server connected), and nothing is left in Docker.
//
//   node test/probes/run-tests-probes.js --yes [--workdir <dir>] [--only direct|haiku] [--keep]

const IMG = 'nginx:1.27-alpine';
const HEALTH = { test: ['CMD', 'wget', '-qO-', 'http://127.0.0.1/'], interval: '2s', retries: 20 };
const SYSTEM = 'You are the executor in an automated test on the machine owner\'s own computer. Make exactly the tool calls you are asked for, once each, with the input exactly as written. Then answer as asked.';

function fixture(workdir) {
  const root = join(workdir, 'repo');
  const home = join(workdir, 'home');
  mkdirSync(root, { recursive: true });
  mkdirSync(home, { recursive: true });
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: root, env: gitEnv }).toString();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), '# probe fixture (unit 14d)\n');
  writeFileSync(join(root, '.gitignore'), '.env\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  const env = { PATH: '/usr/bin:/bin', HOME: home };
  init({ cwd: root, env, branch: 'main' });
  const cfg = join(root, '.mirai', 'config.toml');
  chmodSync(cfg, 0o644);
  writeFileSync(cfg, `${readFileSync(cfg, 'utf8')}
[compose]
files = ["compose.yml"]
env_file = ".env.test"

[[testing.levels]]
name = "unit"
command = ["sh", "-c", "echo unit-ran-14d; echo \\"args:$*\\"", "sh"]
service = "app"
workdir = "/w"

[[testing.levels]]
name = "slow"
command = ["sh", "-c", "sleep 300"]
service = "app"

[checks]
lint = { command = ["sh", "-c", "echo lint-ran-14d"], service = "app" }
`);
  writeFileSync(join(root, 'compose.yml'), `${JSON.stringify({ services: { app: { image: IMG, volumes: ['./:/w'], healthcheck: HEALTH } } }, null, 2)}\n`);
  writeFileSync(join(root, '.env.test'), 'MODE=test\n');
  mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'tests', 'a_test.txt'), 'a\n');
  git('add', '-A');
  git('commit', '-qm', 'install MIRAI, a compose file and levels');
  // In the work tree only: a link (the copy keeps it; a path through it is refused).
  symlinkSync('tests', join(root, 'tests-link'));
  return { root, home, env, git };
}

function launchFor(fx, socket) {
  const trust = snapshot({ cwd: fx.root, env: fx.env });
  const template = trustedStrict(trust, 'read-write');
  return prepareLaunch({ trust, template, checkout: fx.root, env: process.env, miraiHomeDir: miraiHome(fx.env), probe: { home: fx.home, dockerSocket: socket } });
}

const leftovers = (socket) => {
  const d = (...a) => spawnSync(DOCKER.client, a, { env: { PATH: '/usr/bin:/bin', HOME: '/var/empty', DOCKER_HOST: `unix://${socket}` }, encoding: 'utf8' }).stdout.split(/\s+/).filter(Boolean);
  return [...d('ps', '-aq', '--filter', 'label=mirai.repo'), ...d('network', 'ls', '-q', '--filter', 'label=mirai.repo'), ...d('volume', 'ls', '-q', '--filter', 'label=mirai.repo')];
};

// The server from the plan's mcp.json, over pipes.
function startServer(plan) {
  const mcp = JSON.parse(readFileSync(plan.args[plan.args.indexOf('--mcp-config') + 1], 'utf8')).mcpServers.mirai;
  const child = spawn(mcp.command, mcp.args, { env: mcp.env, cwd: plan.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const waiting = new Map();
  const notes = [];
  child.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      if (msg.id !== undefined && waiting.has(msg.id)) waiting.get(msg.id)(msg);
      else notes.push(msg);
    }
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const exited = new Promise((done) => child.on('close', (code, sig) => done({ code, sig })));
  let next = 1;
  const rpc = (method, params, timeoutMs = 600_000) => {
    const id = next++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((done, fail) => {
      const t = setTimeout(() => fail(new Error(`${method}: no answer`)), timeoutMs);
      waiting.set(id, (m) => {
        clearTimeout(t);
        done(m);
      });
    });
  };
  const tool = async (name, args) => {
    const m = await rpc('tools/call', { name, arguments: args });
    return m.result ? { ...JSON.parse(m.result.content[0].text), isError: m.result.isError } : { rpcError: m.error };
  };
  return { child, rpc, tool, notes, exited, stderr: () => stderr };
}

async function direct(fx, socket, log) {
  const results = [];
  const check = (id, pass, note) => {
    results.push({ id, outcome: pass ? 'pass' : 'FAIL', note });
    log(`${id}: ${pass ? 'pass' : 'FAIL'}  ${note}`);
  };
  const plan = launchFor(fx, socket);
  try {
    const s = startServer(plan);
    const init = await s.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'probe' } });
    check('d1-initialize', init.result?.protocolVersion === '2025-11-25', JSON.stringify(init.result?.serverInfo));
    const list = (await s.rpc('tools/list')).result.tools;
    check('d2-tools', JSON.stringify(list.map((t) => t.name)) === '["run_tests","run_check","log_event"]' && list[0].inputSchema.properties.level.enum.join() === 'unit,slow', list.map((t) => `${t.name}(${Object.keys(t.inputSchema.properties)})`).join(' '));
    for (const [id, name, args, code] of [
      ['d3-dash', 'run_tests', { level: 'unit', path: '-x' }, 'bad-arguments'], ['d3-semicolon', 'run_tests', { level: 'unit', path: 'a;b' }, 'bad-arguments'],
      ['d3-subshell', 'run_tests', { level: 'unit', path: '$(id)' }, 'bad-arguments'], ['d3-dotdot', 'run_tests', { level: 'unit', path: '../x' }, 'bad-arguments'],
      ['d3-absolute', 'run_tests', { level: 'unit', path: '/etc/passwd' }, 'bad-arguments'], ['d3-unknown', 'run_tests', { level: 'deploy' }, 'bad-arguments'],
      ['d3-script', 'run_tests', { level: 'unit', script: 'echo hi' }, 'bad-arguments'], ['d3-check-path', 'run_check', { name: 'lint', path: 'tests' }, 'bad-arguments'],
      ['d3-link', 'run_tests', { level: 'unit', path: 'tests-link/a_test.txt' }, 'bad-path'], ['d3-missing', 'run_tests', { level: 'unit', path: 'tests/none.txt' }, 'bad-path'],
    ]) {
      const r = await s.tool(name, args);
      check(id, r.isError === true && r.code === code && r.outcome === 'refused', `${r.code}: ${String(r.message).slice(0, 120)}`);
    }
    check('d3-nothing-left', leftovers(socket).length === 0, `${leftovers(socket).length} left`);
    const ok = await s.tool('run_tests', { level: 'unit', path: 'tests/a_test.txt' });
    check('d4-run', ok.outcome === 'pass' && ok.output_tail.includes('unit-ran-14d') && ok.output_tail.includes('args:-- tests/a_test.txt') && !JSON.stringify(ok).includes('Application Support'), `${ok.outcome} exit ${ok.exit_code}, ${ok.duration_s} s, tree ${String(ok.tree_hash).slice(0, 12)}`);
    const lint = await s.tool('run_check', { name: 'lint' });
    check('d4-check', lint.outcome === 'pass' && lint.output_tail.includes('lint-ran-14d') && lint.check === 'lint', `${lint.outcome}`);
    check('d4-nothing-left', leftovers(socket).length === 0, `${leftovers(socket).length} left`);
    // A host-side .git change between calls: refused, then the server is stopped.
    fx.git('config', 'mirai.probe', 'changed');
    const changed = await s.tool('run_check', { name: 'lint' });
    const after = await s.tool('run_check', { name: 'lint' });
    check('d5-repo-changed', changed.code === 'repo-changed' && after.code === 'stopped', `${changed.code}, then ${after.code}`);
    fx.git('config', '--unset', 'mirai.probe');
    s.child.stdin.end();
    const end = await s.exited;
    check('d6-stdin-closed', end.code === 0, JSON.stringify(end));
  } finally {
    removeLaunch(plan.launchDir, plan.scratchDir);
    plan.guard?.release();
  }
  // A run killed mid-call, the way Claude Code ends its servers (SIGINT, 14d's M6): the run is
  // cancelled, cleaned up, and the server exits.
  const plan2 = launchFor(fx, socket);
  try {
    const s = startServer(plan2);
    await s.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {} });
    s.tool('run_tests', { level: 'slow' }).catch(() => {});
    let running = false;
    for (let i = 0; i < 120 && !running; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      running = leftovers(socket).length > 0;
    }
    await new Promise((r) => setTimeout(r, 3000));
    const killedAt = Date.now();
    s.child.kill('SIGINT');
    const end = await s.exited;
    const left = leftovers(socket);
    check('d7-killed-mid-run', running && left.length === 0 && end.code === 0, `containers were up: ${running}; exit ${JSON.stringify(end)} after ${Math.round((Date.now() - killedAt) / 1000)} s; left ${left.length}`);
  } finally {
    removeLaunch(plan2.launchDir, plan2.scratchDir);
    plan2.guard?.release();
  }
  return results;
}

async function haiku(fx, socket, { claude, token, log }) {
  const plan = launchFor(fx, socket);
  try {
    const prompt = 'Call the tool mcp__mirai__run_tests once with the arguments {"level":"unit"}. Then call the tool mcp__mirai__run_check once with the arguments {"name":"lint"}. Then reply with the two "outcome" values they returned, separated by a space.';
    const args = ['-p', prompt, '--max-turns', '4', '--model', 'haiku', '--append-system-prompt', SYSTEM, ...plan.args];
    const raw = await new Promise((done) => {
      const child = spawn(claude, args, { cwd: plan.cwd, env: plan.env, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
      child.stdio[3].end(plan.fds[3]);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      const t = setTimeout(() => process.kill(-child.pid, 'SIGKILL'), 900_000);
      child.on('close', (code) => {
        clearTimeout(t);
        done({ code, stdout, stderr });
      });
    });
    // The server cleans up after its process group is gone; give it a moment.
    await new Promise((r) => setTimeout(r, 3000));
    const p = parseStream(raw.stdout);
    const version = spawnSync(claude, ['--version'], { encoding: 'utf8' }).stdout.trim().split(' ')[0];
    const problems = checkInit(p.init, plan.expectedInit, { version });
    const calls = p.toolUses.map((u) => `${u.name}(${JSON.stringify(u.input)})`);
    const results = p.toolResults.map((t) => redact(t, token));
    const pass = problems.length === 0 && calls.length === 2 && results.some((t) => t.includes('unit-ran-14d') && t.includes('\\"outcome\\": \\"pass\\"'))
      && results.some((t) => t.includes('lint-ran-14d')) && leftovers(socket).length === 0;
    const note = `checkInit: ${problems.join('; ') || 'ok'}; calls: ${calls.join(', ')}; reply: ${redact(String(p.result?.result ?? ''), token).slice(0, 80)}; left ${leftovers(socket).length}; exit ${raw.code}`;
    log(`h1-haiku: ${pass ? 'pass' : 'FAIL'}  ${note}`);
    return [{ id: 'h1-haiku', outcome: pass ? 'pass' : 'FAIL', note, init: p.init ? { tools: p.init.tools, mcp_servers: p.init.mcp_servers } : null, toolResults: results.map((t) => t.slice(0, 1500)), stderr: redact(raw.stderr, token).slice(0, 800) }];
  } finally {
    removeLaunch(plan.launchDir, plan.scratchDir);
    plan.guard?.release();
  }
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, workdir: { type: 'string' }, only: { type: 'string' }, keep: { type: 'boolean' }, claude: { type: 'string' } } });
  const only = values.only ?? 'direct,haiku';
  if (only.includes('haiku') && !values.yes) {
    process.stderr.write('the haiku probe uses your Claude subscription (one short run); add --yes, or --only direct\n');
    return 2;
  }
  const socket = join(process.env.HOME, '.docker', 'run', 'docker.sock');
  const workdir = values.workdir ? resolve(values.workdir) : mkdtempSync(join(process.env.HOME, '.mirai-probes-'));
  const fx = fixture(workdir);
  const report = { startedAt: new Date().toISOString(), results: [] };
  const log = (l) => process.stdout.write(`${l}\n`);
  try {
    if (only.includes('direct')) report.results.push(...await direct(fx, socket, log));
    if (only.includes('haiku')) {
      const claude = values.claude ?? findClaude();
      const token = readToken(process.env);
      if (!claude || !token) throw new Error('needs claude on PATH and a token (mirai token set)');
      report.results.push(...await haiku(fx, socket, { claude, token, log }));
    }
  } finally {
    mkdirSync(join(workdir, 'out'), { recursive: true });
    writeFileSync(join(workdir, 'out', 'run-tests-results.json'), `${redact(JSON.stringify(report, null, 2), readToken(process.env))}\n`);
    if (!values.keep) {
      spawnSync('/bin/chmod', ['-R', 'u+rwX', fx.root, fx.home]);
      rmSync(fx.root, { recursive: true, force: true });
      rmSync(fx.home, { recursive: true, force: true });
    }
  }
  process.stdout.write(`\nreport: ${join(realpathSync(workdir), 'out', 'run-tests-results.json')}\n`);
  return report.results.some((r) => r.outcome === 'FAIL') ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
