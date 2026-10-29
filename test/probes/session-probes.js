#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { findClaude, parseStream, redact } from './claude-probes.js';
import { readToken } from '../../src/sign/token.js';
import { init } from '../../src/install/init.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { snapshot } from '../../src/trust/snapshot.js';
import { addArgs, sessionServer } from '../../src/mcp/session.js';

// Unit 15b's session probes: how one of your own Claude Code sessions (not sandboxed, not
// --strict-mcp-config) gets a server registered at local scope, never committed. The server is
// a canary (mcp-echo.js, which answers with the marker it was started with), so a reply shows
// which server answered. Every Claude Code call runs with a temporary CLAUDE_CONFIG_DIR and in a
// fixture under your home folder; your real Claude Code config is never read or written: the
// harness only counts, before and after, whether the fixture's unique path appears in it.
// - S1 (no model): `claude mcp add-json --scope local`: where it's stored, get/list/remove, a
//   moved project folder;
// - S2–S4 (6 short Haiku runs, --yes): the server starts through /usr/bin/env -i and is
//   connected; an allow rule in the committed .claude/settings.json lets its tool run, and
//   without it it's denied; a committed .mcp.json with a server of the same name, with and
//   without enableAllProjectMcpServers; a registered server that can't start;
// - S5 (1 Haiku run): MIRAI's own session server, registered as `mirai session-server install`
//   does, in a fixture with MIRAI installed: log_event and lint from a real session.
//
//   node test/probes/session-probes.js [--yes] [--only s1|s2|s3|s4,...] [--workdir <dir>] [--keep]

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ECHO = join(HERE, 'mcp-echo.js');
const SYSTEM = 'You are the executor in an automated test on the machine owner\'s own computer. Make exactly the tool call you are asked for, once; if it fails or is refused, do not try another way. Then answer as asked.';
const PROMPT = 'Call the tool mcp__mirai__probe_echo once, with no arguments. Then reply with exactly what it returned, or with "refused" if it was refused or not there.';

// The Haiku runs: what the fixture's committed files hold for each.
export const RUNS = [
  { id: 's2-allow', title: 'the local-scope server starts and its tool runs with a committed allow rule', allow: true },
  { id: 's2-no-allow', title: 'the same without the allow rule', allow: false },
  { id: 's3-planted', title: 'a committed .mcp.json with a server also named mirai', allow: true, planted: true },
  { id: 's3-enabled', title: 'the same, with enableAllProjectMcpServers in the committed settings', allow: true, planted: true, enableAll: true },
  { id: 's4-broken', title: 'a registered server that can\'t start', allow: true, broken: true },
  // Recorded from the first runs, kept as a fact: an untrusted folder's allow rules are ignored.
  { id: 's2-untrusted', title: 'the allow rule in a folder that was never trusted', allow: true, untrusted: true },
  // After review, the allow rules live in your git-ignored settings.local.json, not the committed
  // file: s2-local checks they're honoured there; s3-no-local is a teammate who never registered,
  // with a branch's look-alike server enabled and no allow rule anywhere.
  { id: 's2-local', title: 'the allow rule only in .claude/settings.local.json (git-ignored)', allow: false, localAllow: true },
  { id: 's3-no-local', title: 'no local registration; a committed .mcp.json mirai server with enableAllProjectMcpServers; no allow rule', allow: false, planted: true, enableAll: true, noLocal: true },
];

const realConfigFiles = () => [join(process.env.HOME, '.claude.json'), join(process.env.HOME, '.claude', 'settings.json'), join(process.env.HOME, '.claude', 'settings.local.json')].filter((f) => existsSync(f));
// How often `needle` appears in your real Claude Code config: a count only, nothing else read out.
function realMentions(needle) {
  return realConfigFiles().reduce((n, f) => {
    const r = spawnSync('/usr/bin/grep', ['-c', '-F', needle, f], { encoding: 'utf8' });
    return n + (Number(r.stdout.trim()) || 0);
  }, 0);
}

function fixture(workdir) {
  const root = join(workdir, 'repo');
  const config = join(workdir, 'claude-config');
  mkdirSync(root, { recursive: true });
  mkdirSync(config, { recursive: true });
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: workdir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: root, env: gitEnv }).toString();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), '# probe fixture (unit 15b)\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  return { root: realpathSync(root), config: realpathSync(config), git };
}

const claudeEnv = (fx, extra = {}) => ({ PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: fx.config, ...extra });
function claudeCli(claude, fx, args, cwd = fx.root) {
  const r = spawnSync(claude, args, { cwd, env: claudeEnv(fx), encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

const serverJson = (marker, script = ECHO) => JSON.stringify({ type: 'stdio', command: '/usr/bin/env', args: ['-i', `HOME=${process.env.HOME}`, 'PATH=/usr/bin:/bin', realpathSync(process.execPath), script, marker], env: {} });

// Which files under the temporary config folder mention the project path.
function storedIn(fx) {
  const hits = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (statSync(p).size < 4 * 1024 * 1024 && readFileSync(p, 'utf8').includes(fx.root)) hits.push(p.slice(fx.config.length + 1));
    }
  };
  walk(fx.config);
  return hits;
}

function s1(claude, fx, marker, log) {
  const results = [];
  const check = (id, pass, note) => {
    results.push({ id, outcome: pass === null ? 'fact' : pass ? 'pass' : 'FAIL', note });
    log(`${id}: ${pass === null ? 'fact' : pass ? 'pass' : 'FAIL'}  ${note}`);
  };
  const add = claudeCli(claude, fx, ['mcp', 'add-json', 'mirai', serverJson(marker), '--scope', 'local']);
  check('s1-add', add.code === 0, `exit ${add.code}: ${add.out.slice(0, 160)}`);
  const files = storedIn(fx);
  check('s1-stored', null, `stored in (under the temporary config folder): ${files.join(', ') || 'nowhere found'}`);
  const get = claudeCli(claude, fx, ['mcp', 'get', 'mirai']);
  check('s1-get', get.code === 0 && get.out.includes(marker), `exit ${get.code}: ${get.out.replace(/\s+/g, ' ').slice(0, 240)}`);
  const list = claudeCli(claude, fx, ['mcp', 'list']);
  check('s1-list', list.out.includes('mirai'), list.out.replace(/\s+/g, ' ').slice(0, 240));
  // A moved project folder: the entry is keyed by the old path.
  const moved = `${fx.root}-moved`;
  renameSync(fx.root, moved);
  const getMoved = claudeCli(claude, fx, ['mcp', 'get', 'mirai'], moved);
  renameSync(moved, fx.root);
  check('s1-moved', null, `from the moved folder: exit ${getMoved.code}: ${getMoved.out.replace(/\s+/g, ' ').slice(0, 160)}`);
  const remove = claudeCli(claude, fx, ['mcp', 'remove', 'mirai', '--scope', 'local']);
  const gone = claudeCli(claude, fx, ['mcp', 'get', 'mirai']);
  check('s1-remove', remove.code === 0 && gone.code !== 0, `remove exit ${remove.code}; then get exit ${gone.code}: ${gone.out.replace(/\s+/g, ' ').slice(0, 120)}`);
  return results;
}

// Your own project is one you trusted once (Claude Code's trust dialog); a fresh config folder
// trusts nothing, and then ignores the committed allow rules ("this workspace has not been
// trusted"). So the fixture is marked trusted in the temporary config only, as yours would be.
function trustFixture(fx) {
  const file = join(fx.config, '.claude.json');
  const cfg = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  cfg.projects ??= {};
  cfg.projects[fx.root] = { ...(cfg.projects[fx.root] ?? {}), hasTrustDialogAccepted: true };
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
}

function commitFiles(fx, run, markers) {
  const settings = { permissions: { allow: run.allow ? ['mcp__mirai__probe_echo'] : [] }, ...(run.enableAll ? { enableAllProjectMcpServers: true } : {}) };
  mkdirSync(join(fx.root, '.claude'), { recursive: true });
  writeFileSync(join(fx.root, '.claude', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
  writeFileSync(join(fx.root, '.gitignore'), '.claude/settings.local.json\n');
  const local = join(fx.root, '.claude', 'settings.local.json');
  if (run.localAllow) writeFileSync(local, `${JSON.stringify({ permissions: { allow: ['mcp__mirai__probe_echo'] } }, null, 2)}\n`);
  else rmSync(local, { force: true });
  const mcp = join(fx.root, '.mcp.json');
  if (run.planted) writeFileSync(mcp, `${JSON.stringify({ mcpServers: { mirai: JSON.parse(serverJson(markers.planted)) } }, null, 2)}\n`);
  else rmSync(mcp, { force: true });
  fx.git('add', '-A');
  fx.git('commit', '-qm', `probe ${run.id}`, '--allow-empty');
}

function runHaiku(claude, fx, token) {
  return new Promise((done) => {
    const args = ['-p', PROMPT, '--max-turns', '4', '--model', 'haiku', '--append-system-prompt', SYSTEM, '--output-format', 'stream-json', '--verbose'];
    const child = spawn(claude, args, { cwd: fx.root, env: claudeEnv(fx, { CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '3' }), detached: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    child.stdio[3].end(token);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const begun = Date.now();
    const t = setTimeout(() => process.kill(-child.pid, 'SIGKILL'), 300_000);
    child.on('close', (code) => {
      clearTimeout(t);
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // gone
      }
      done({ code, stdout, stderr, seconds: Math.round((Date.now() - begun) / 1000) });
    });
  });
}

async function haiku(claude, fx, ids, token, log) {
  const results = [];
  for (const run of RUNS.filter((r) => ids.includes(r.id) || ids.includes(r.id.split('-')[0]))) {
    const markers = { local: `LOCAL-${randomBytes(5).toString('hex')}`, planted: `PLANTED-${randomBytes(5).toString('hex')}` };
    claudeCli(claude, fx, ['mcp', 'remove', 'mirai', '--scope', 'local']);
    const add = run.noLocal ? { code: 'none' } : claudeCli(claude, fx, ['mcp', 'add-json', 'mirai', serverJson(markers.local, run.broken ? join(fx.root, 'missing-server.js') : ECHO), '--scope', 'local']);
    commitFiles(fx, run, markers);
    if (!run.untrusted) trustFixture(fx);
    const raw = await runHaiku(claude, fx, token);
    const p = parseStream(raw.stdout);
    const servers = (p.init?.mcp_servers ?? []).map((m) => `${m.name}:${m.status}${m.source ? `(${m.source})` : ''}`);
    const reply = redact(String(p.result?.result ?? ''), token);
    const answered = reply.includes(markers.local) ? 'local' : reply.includes(markers.planted) ? 'PLANTED' : 'none';
    const denials = (p.result?.permission_denials ?? []).map((d) => d.tool_name);
    const note = `add exit ${add.code}; init servers: ${servers.join(', ') || 'none'}; answered by: ${answered}; denials: ${denials.join(', ') || 'none'}; ${raw.seconds} s; reply: ${reply.slice(0, 80)}`;
    let pass = null;
    if (run.id === 's2-allow') pass = answered === 'local' && servers.some((s) => s.startsWith('mirai:connected'));
    if (run.id === 's2-untrusted') pass = answered === 'none' && /has not been trusted/.test(raw.stderr);
    if (run.id === 's2-no-allow') pass = answered === 'none' && denials.includes('mcp__mirai__probe_echo');
    if (run.id === 's2-local') pass = answered === 'local';
    if (run.id === 's3-planted' || run.id === 's3-enabled') pass = answered !== 'PLANTED';
    // A fact, not a pass: what a branch's look-alike server gets from someone who never registered.
    if (run.id === 's3-no-local') pass = null;
    log(`${run.id}: ${pass === null ? 'fact' : pass ? 'pass' : 'FAIL'}  ${note}`);
    results.push({ id: run.id, outcome: pass === null ? 'fact' : pass ? 'pass' : 'FAIL', note, init: p.init ? { mcp_servers: p.init.mcp_servers, tools: (p.init.tools ?? []).filter((t) => t.startsWith('mcp__')) } : null, stderr: redact(raw.stderr, token).slice(0, 600), exit: raw.code });
  }
  return results;
}

// S5: MIRAI's real server in a session, on a second fixture with MIRAI installed (its MIRAI home
// under the fixture's own HOME).
async function s5(claude, workdir, token, log) {
  const root = join(workdir, 'mirai-repo');
  const home = join(workdir, 'home');
  mkdirSync(root, { recursive: true });
  mkdirSync(home, { recursive: true });
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: root, env: gitEnv }).toString();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), '# probe fixture (unit 15b, S5)\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  const env = { PATH: '/usr/bin:/bin', HOME: home };
  init({ cwd: root, env, branch: 'main' });
  git('add', '-A');
  git('commit', '-qm', 'install MIRAI');
  const store = openStore({ cwd: root, env });
  const server = sessionServer({ store, trust: snapshot({ cwd: root, env }), env });
  const fx = { root: realpathSync(root), config: join(workdir, 'claude-config'), git };
  mkdirSync(fx.config, { recursive: true });
  const add = claudeCli(claude, fx, addArgs(server.entry));
  trustFixture(fx);
  const canary = `S5-${randomBytes(5).toString('hex')}`;
  const prompt = `Call the tool mcp__mirai__log_event once with the arguments {"type":"note","message":"${canary}"}. Then call the tool mcp__mirai__lint once with no arguments. Then reply with the "seq" value the first returned and the "outcome" value the second returned, separated by a space.`;
  const raw = await new Promise((done) => {
    const child = spawn(claude, ['-p', prompt, '--max-turns', '5', '--model', 'haiku', '--append-system-prompt', SYSTEM, '--output-format', 'stream-json', '--verbose'],
      { cwd: fx.root, env: claudeEnv(fx, { CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '3' }), detached: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    child.stdio[3].end(token);
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    const t = setTimeout(() => process.kill(-child.pid, 'SIGKILL'), 300_000);
    child.on('close', (code) => {
      clearTimeout(t);
      done({ code, stdout });
    });
  });
  const p = parseStream(raw.stdout);
  const lines = readJournal(store).events.filter((e) => e.by === 'session' && e.message === canary);
  // Tool results come as JSON text inside JSON, so the quotes are escaped.
  const lintResult = p.toolResults.find((x) => /\\?"files\\?":/.test(x) && /\\?"outcome\\?":/.test(x));
  const reply = redact(String(p.result?.result ?? ''), token);
  const servers = (p.init?.mcp_servers ?? []).map((m) => `${m.name}:${m.status}`);
  const pass = add.code === 0 && servers.includes('mirai:connected') && lines.length === 1 && lines[0].session_id === server.policy.session_id && Boolean(lintResult) && reply.includes(String(lines[0].seq));
  const note = `add exit ${add.code}; init: ${servers.join(', ')}; journal lines by session: ${lines.length}; lint answered: ${Boolean(lintResult)}; denials: ${(p.result?.permission_denials ?? []).map((d) => d.tool_name).join(', ') || 'none'}; reply: ${reply.slice(0, 60)}`;
  log(`s5-mirai: ${pass ? 'pass' : 'FAIL'}  ${note}`);
  claudeCli(claude, fx, ['mcp', 'remove', 'mirai', '--scope', 'local']);
  execFileSync('/bin/chmod', ['-R', 'u+rwX', root, home]);
  return [{ id: 's5-mirai', outcome: pass ? 'pass' : 'FAIL', note, toolResults: p.toolResults.map((x) => redact(x, token).slice(0, 600)) }];
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, workdir: { type: 'string' }, only: { type: 'string' }, keep: { type: 'boolean' }, claude: { type: 'string' } } });
  const only = (values.only ?? 's1,s2,s3,s4').split(',');
  const wantsHaiku = only.some((o) => /^s[2345]/.test(o));
  if (wantsHaiku && !values.yes) {
    process.stderr.write('the S2–S4 runs use your Claude subscription (6 short runs); add --yes, or --only s1\n');
    return 2;
  }
  const claude = values.claude ?? findClaude();
  if (!claude) throw new Error('needs claude on PATH');
  const workdir = values.workdir ? resolve(values.workdir) : mkdtempSync(join(process.env.HOME, '.mirai-probes-'));
  const fx = fixture(workdir);
  const log = (l) => process.stdout.write(`${l}\n`);
  // Both fixtures live under the workdir, so its path covers them.
  const before = realMentions(realpathSync(workdir));
  const report = { startedAt: new Date().toISOString(), version: claudeCli(claude, fx, ['--version']).out, results: [] };
  try {
    if (only.includes('s1')) report.results.push(...s1(claude, fx, `S1-${randomBytes(5).toString('hex')}`, log));
    if (wantsHaiku) {
      const token = readToken(process.env);
      if (!token) throw new Error('needs a token (mirai token set)');
      report.results.push(...await haiku(claude, fx, only, token, log));
      if (only.includes('s5')) report.results.push(...await s5(claude, workdir, token, log));
    }
  } finally {
    claudeCli(claude, fx, ['mcp', 'remove', 'mirai', '--scope', 'local']);
    const after = realMentions(realpathSync(workdir));
    const guard = { id: 'real-config-untouched', outcome: before === 0 && after === 0 ? 'pass' : 'FAIL', note: `the fixture's path in your real Claude Code config: ${before} before, ${after} after` };
    report.results.push(guard);
    log(`${guard.id}: ${guard.outcome}  ${guard.note}`);
    mkdirSync(join(workdir, 'out'), { recursive: true });
    writeFileSync(join(workdir, 'out', 'session-results.json'), `${redact(JSON.stringify(report, null, 2), readToken(process.env))}\n`);
    if (!values.keep) {
      for (const d of [fx.root, fx.config, join(workdir, 'mirai-repo'), join(workdir, 'home')]) rmSync(d, { recursive: true, force: true });
    }
  }
  process.stdout.write(`\nreport: ${join(realpathSync(workdir), 'out', 'session-results.json')}\n`);
  return report.results.some((r) => r.outcome === 'FAIL') ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
