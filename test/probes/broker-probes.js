#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { findClaude, parseStream, redact } from './claude-probes.js';
import { init } from '../../src/install/init.js';
import { miraiHome } from '../../src/store/mirai-home.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { readToken } from '../../src/sign/token.js';
import { snapshot, trustedStrict } from '../../src/trust/snapshot.js';
import { checkInit, prepareLaunch, removeLaunch } from '../../src/launch/strict.js';

// Unit 15a's probes: the broker's core, started from a real launch plan (prepareLaunch, the
// trust root's bin/mcp.js through /usr/bin/env -i, its read-only policy), on a throwaway
// fixture repo under your home folder with MIRAI installed and a temporary MIRAI home. No
// Docker, no network, canaries only.
// - direct (no model): the server driven over its pipes: tools/list, each log_event refusal,
//   the cap, the journal lines it wrote;
// - haiku (4 short runs on your subscription, --yes), each through MIRAI's own launch:
//   b1: checkInit passes with `mirai` connected (Claude Code starting the server through
//       env -i), and a log_event note lands in the journal as the agent's;
//   b2: the agent reads a canary plan from input/files/ (Read, through the launch's --add-dir)
//       and can't change it (Write, Edit, Bash); b2c: sandboxed Bash reads it too;
//   b3: `mirai` and MIRAI's own CLI script from Bash don't reach the journal.
//
//   node test/probes/broker-probes.js --yes [--workdir <dir>] [--only direct|haiku|b1,b2,b3] [--keep]

const SYSTEM = 'You are the executor in an automated test on the machine owner\'s own computer. Make exactly the tool calls you are asked for, once each, with the input exactly as written; if one fails or is refused, note it and go on to the next. Then answer as asked.';

// What a refused write looks like: a permission rule, the hook, or the sandbox.
export const REFUSED = /denied by your permission settings|hook error|operation not permitted|unable to change file mode|permission denied/i;

// The Haiku runs. `{plan}`, `{canary}` and `{cli}` are filled in per run.
export const PROBES = [
  { id: 'b1-log', title: 'the server connects through env -i, and a note reaches the journal as the agent\'s',
    prompt: 'Call the tool mcp__mirai__log_event once with the arguments {"type":"note","message":"{canary}"}. Then reply with the "seq" value it returned.' },
  // The canary is only in the file, never in the prompt: a reply with it proves the read.
  { id: 'b2-input', title: 'the agent reads its plan from input/files/ and can\'t change it', inputs: { 'plan.md': '{canary}\n' }, secret: true,
    prompt: 'Read the file {plan} with the Read tool and remember its first line. Then try each of these once, in order: '
      + '(1) the Write tool: write the text "changed" to {plan}; (2) the Edit tool: in {plan}, replace "MIRAI" with "changed"; '
      + '(3) the Bash tool: echo changed >> "{plan}"; (4) the Bash tool: chmod 600 "{plan}"; (5) the Bash tool: rm -f "{plan}"; '
      + '(6) the Write tool: write the text "new" to {dir}/new.md. Then reply with the first line you read, then "tried 6".' },
  // --restricted confines the file tools to the working directory, so the launch adds the input
  // folder with --add-dir and write-denies it; b2c reads it through sandboxed Bash too.
  { id: 'b2c-bash', title: 'sandboxed Bash reads input/files/', inputs: { 'plan.md': '{canary}\n' }, secret: true,
    prompt: 'Run the command cat "{plan}" with the Bash tool, once. Then reply with its output exactly.' },
  { id: 'b3-cli', title: '`mirai` and MIRAI\'s CLI script from Bash don\'t reach the journal',
    prompt: 'Run these two commands with the Bash tool, once each: (1) mirai log note --message {canary}; (2) node {cli} log note --message {canary}. Then reply with "done".' },
];

function fixture(workdir) {
  const root = join(workdir, 'repo');
  const home = join(workdir, 'home');
  mkdirSync(root, { recursive: true });
  mkdirSync(home, { recursive: true });
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: root, env: gitEnv }).toString();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), '# probe fixture (unit 15a)\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  const env = { PATH: '/usr/bin:/bin', HOME: home };
  init({ cwd: root, env, branch: 'main' });
  git('add', '-A');
  git('commit', '-qm', 'install MIRAI');
  return { root, home, env, git };
}

function launchFor(fx, extra = {}) {
  const trust = snapshot({ cwd: fx.root, env: fx.env });
  const template = trustedStrict(trust, 'read-write');
  return { trust, plan: prepareLaunch({ trust, template, checkout: fx.root, env: process.env, miraiHomeDir: miraiHome(fx.env), probe: { home: fx.home }, ...extra }) };
}

const agentLines = (fx) => readJournal(openStore({ cwd: fx.root, env: fx.env })).events.filter((e) => e.by === 'agent');

// The server from the plan's mcp.json, over pipes.
function startServer(plan) {
  const mcp = JSON.parse(readFileSync(plan.args[plan.args.indexOf('--mcp-config') + 1], 'utf8')).mcpServers.mirai;
  const child = spawn(mcp.command, mcp.args, { env: mcp.env, cwd: plan.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const waiting = new Map();
  child.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      if (msg.id !== undefined && waiting.has(msg.id)) waiting.get(msg.id)(msg);
    }
  });
  const exited = new Promise((done) => child.on('close', (code, sig) => done({ code, sig })));
  let next = 1;
  const rpc = (method, params) => {
    const id = next++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((done, fail) => {
      const t = setTimeout(() => fail(new Error(`${method}: no answer`)), 60_000);
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
  return { child, rpc, tool, exited };
}

async function direct(fx, log) {
  const results = [];
  const check = (id, pass, note) => {
    results.push({ id, outcome: pass ? 'pass' : 'FAIL', note });
    log(`${id}: ${pass ? 'pass' : 'FAIL'}  ${note}`);
  };
  const { plan } = launchFor(fx, { item: 'PROBE-1' });
  try {
    const s = startServer(plan);
    await s.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'probe' } });
    const list = (await s.rpc('tools/list')).result.tools;
    check('d1-tools', JSON.stringify(list.map((t) => t.name)) === '["log_event"]' && list[0].inputSchema.properties.type.enum.join() === 'note,template_gap', list.map((t) => `${t.name}(${Object.keys(t.inputSchema.properties)})`).join(' '));
    const canary = `MIRAI-15A-${randomBytes(6).toString('hex')}`;
    for (const [id, args] of [
      ['d2-privileged', { type: 'approval', message: canary }], ['d2-status', { type: 'status_written', message: canary }],
      ['d2-item', { type: 'note', message: canary, item: 'OTHER-9' }], ['d2-by', { type: 'note', message: canary, by: 'script' }],
      ['d2-empty', { type: 'note', message: '   ' }], ['d2-long', { type: 'note', message: 'x'.repeat(4001) }],
      ['d2-note-template', { type: 'note', message: canary, template: 't' }], ['d2-gap-no-section', { type: 'template_gap', message: canary, template: 't' }],
    ]) {
      const r = await s.tool('log_event', args);
      check(id, r.isError === true && r.code === 'bad-arguments', `${r.code}: ${String(r.message).slice(0, 100)}`);
    }
    const none = await s.tool('run_tests', { level: 'unit' });
    check('d2-no-tests', none.rpcError?.code === -32602, JSON.stringify(none.rpcError ?? none).slice(0, 100));
    check('d2-nothing-written', agentLines(fx).length === 0, `${agentLines(fx).length} agent lines`);
    const ok = await s.tool('log_event', { type: 'note', message: canary });
    const gap = await s.tool('log_event', { type: 'template_gap', template: 'plan', section: 'Risks', message: canary });
    const lines = agentLines(fx);
    check('d3-written', ok.logged === 'note' && gap.logged === 'template_gap' && lines.length === 2
      && lines.every((l) => l.launch_id === plan.launchId && l.item === 'PROBE-1' && l.message === canary && l.schema_version === 3),
    `seq ${ok.seq}, ${gap.seq}; ${JSON.stringify(lines.map((l) => [l.type, l.by, l.item, l.launch_id === plan.launchId]))}`);
    let last = null;
    for (let i = 0; i < 48; i++) last = await s.tool('log_event', { type: 'note', message: `${canary}-${i}` });
    const full = await s.tool('log_event', { type: 'note', message: canary });
    check('d4-cap', last.logged === 'note' && full.code === 'log-full' && agentLines(fx).length === 50, `50th: ${last.logged}; 51st: ${full.code}; ${agentLines(fx).length} lines`);
    s.child.stdin.end();
    const end = await s.exited;
    check('d5-stdin-closed', end.code === 0, JSON.stringify(end));
  } finally {
    removeLaunch(plan.launchDir, plan.scratchDir);
    plan.guard?.release();
  }
  return results;
}

async function runHaiku(claude, plan, prompt) {
  const args = ['-p', prompt, '--max-turns', '12', '--model', 'haiku', '--append-system-prompt', SYSTEM, ...plan.args];
  return new Promise((done) => {
    const child = spawn(claude, args, { cwd: plan.cwd, env: plan.env, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    child.stdio[3].end(plan.fds[3]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const t = setTimeout(() => process.kill(-child.pid, 'SIGKILL'), 600_000);
    child.on('close', (code) => {
      clearTimeout(t);
      // Unit 19 kills the whole group at the end of a run; so does the probe.
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // gone
      }
      done({ code, stdout, stderr });
    });
  });
}

async function haiku(fx, ids, { claude, token, log }) {
  const results = [];
  const version = spawnSync(claude, ['--version'], { encoding: 'utf8' }).stdout.trim().split(' ')[0];
  for (const probe of PROBES.filter((p) => ids.includes(p.id) || ids.includes(p.id.split('-')[0]) || ids.includes('haiku'))) {
    const canary = `MIRAI-15A-${randomBytes(6).toString('hex')}`;
    const fill = (t) => t.replaceAll('{canary}', canary);
    const inputs = Object.fromEntries(Object.entries(probe.inputs ?? {}).map(([k, v]) => [k, fill(v)]));
    const { trust, plan } = launchFor(fx, { inputs });
    const before = agentLines(fx).length;
    const journalBefore = readJournal(openStore({ cwd: fx.root, env: fx.env })).events.length;
    try {
      const planPath = plan.inputs['plan.md'] ?? '';
      const prompt = (probe.secret ? probe.prompt : fill(probe.prompt)).replaceAll('{plan}', planPath).replaceAll('{dir}', join(plan.launchDir, 'input', 'files'))
        .replaceAll('{cli}', join(realpathSync(trust.dir), 'tree', '.mirai', 'framework', 'bin', 'mirai.js'));
      const raw = await runHaiku(claude, plan, prompt);
      const p = parseStream(raw.stdout);
      const problems = checkInit(p.init, plan.expectedInit, { version });
      const calls = p.toolUses.map((u) => `${u.name}(${redact(JSON.stringify(u.input), token).slice(0, 120)})`);
      const reply = redact(String(p.result?.result ?? ''), token);
      const denials = (p.result?.permission_denials ?? []).map((d) => d.tool_name);
      let pass;
      let note;
      if (probe.id === 'b1-log') {
        const lines = agentLines(fx).slice(before);
        pass = problems.length === 0 && lines.length === 1 && lines[0].message === canary && lines[0].launch_id === plan.launchId && reply.includes(String(lines[0].seq));
        note = `checkInit: ${problems.join('; ') || 'ok'} (mirai: ${JSON.stringify((p.init?.mcp_servers ?? []).find((m) => m.name === 'mirai') ?? null)}); lines: ${lines.length}; reply: ${reply.slice(0, 60)}`;
      } else if (probe.id === 'b2c-bash') {
        pass = problems.length === 0 && reply.includes(canary);
        note = `checkInit: ${problems.join('; ') || 'ok'}; read back: ${reply.includes(canary)}; denials: ${denials.join(', ') || 'none'}`;
      } else if (probe.id.startsWith('b2')) {
        const file = plan.inputs['plan.md'];
        const body = readFileSync(file, 'utf8');
        const modeOf = (f) => (statSync(f).mode & 0o777).toString(8);
        let newFile = false;
        try {
          statSync(join(plan.launchDir, 'input', 'files', 'new.md'));
          newFile = true;
        } catch {
          // not made: good
        }
        // Each of the six attempts was made and refused, not skipped.
        const attempts = p.toolResults.slice(1);
        const allRefused = attempts.length >= 6 && attempts.every((t) => REFUSED.test(t));
        pass = problems.length === 0 && reply.includes(canary) && body === `${canary}\n` && modeOf(file) === '400' && !newFile && allRefused;
        note = `checkInit: ${problems.join('; ') || 'ok'} (extra folders: ${JSON.stringify(p.init?.additional_directories ?? null)}); attempts refused: ${attempts.filter((t) => REFUSED.test(t)).length}/${attempts.length}; read back: ${reply.includes(canary)}; file unchanged: ${body === `${canary}\n`}; mode ${modeOf(file)}; new file: ${newFile}; denials: ${denials.join(', ') || 'none'}; calls: ${calls.length}`;
      } else {
        const journalAfter = readJournal(openStore({ cwd: fx.root, env: fx.env })).events;
        const reached = journalAfter.some((e) => JSON.stringify(e).includes(canary));
        pass = problems.length === 0 && !reached && journalAfter.length === journalBefore;
        note = `checkInit: ${problems.join('; ') || 'ok'}; journal reached: ${reached}; lines ${journalBefore} → ${journalAfter.length}; denials: ${denials.join(', ') || 'none'}; results: ${p.toolResults.map((t) => redact(t, token).slice(0, 80)).join(' | ')}`;
      }
      log(`${probe.id}: ${pass ? 'pass' : 'FAIL'}  ${note}`);
      results.push({ id: probe.id, outcome: pass ? 'pass' : 'FAIL', note, calls, init: p.init ? redact(JSON.stringify(p.init), token).slice(0, 4000) : null, toolResults: p.toolResults.map((t) => redact(t, token).slice(0, 600)), exit: raw.code, stderr: redact(raw.stderr, token).slice(0, 800) });
    } finally {
      removeLaunch(plan.launchDir, plan.scratchDir);
      plan.guard?.release();
    }
  }
  return results;
}

async function cli() {
  const { values } = parseArgs({ options: { yes: { type: 'boolean' }, workdir: { type: 'string' }, only: { type: 'string' }, keep: { type: 'boolean' }, claude: { type: 'string' } } });
  const only = (values.only ?? 'direct,haiku').split(',');
  const wantsHaiku = only.some((o) => o === 'haiku' || /^b\d/.test(o));
  if (wantsHaiku && !values.yes) {
    process.stderr.write('the haiku probes use your Claude subscription (4 short runs); add --yes, or --only direct\n');
    return 2;
  }
  const workdir = values.workdir ? resolve(values.workdir) : mkdtempSync(join(process.env.HOME, '.mirai-probes-'));
  const fx = fixture(workdir);
  const report = { startedAt: new Date().toISOString(), results: [] };
  const log = (l) => process.stdout.write(`${l}\n`);
  try {
    if (only.includes('direct')) report.results.push(...await direct(fx, log));
    if (wantsHaiku) {
      const claude = values.claude ?? findClaude();
      const token = readToken(process.env);
      if (!claude || !token) throw new Error('needs claude on PATH and a token (mirai token set)');
      report.results.push(...await haiku(fx, only, { claude, token, log }));
    }
  } finally {
    mkdirSync(join(workdir, 'out'), { recursive: true });
    writeFileSync(join(workdir, 'out', 'broker-results.json'), `${redact(JSON.stringify(report, null, 2), readToken(process.env))}\n`);
    if (!values.keep) {
      spawnSync('/bin/chmod', ['-R', 'u+rwX', fx.root, fx.home]);
      rmSync(fx.root, { recursive: true, force: true });
      rmSync(fx.home, { recursive: true, force: true });
    }
  }
  process.stdout.write(`\nreport: ${join(realpathSync(workdir), 'out', 'broker-results.json')}\n`);
  return report.results.some((r) => r.outcome === 'FAIL') ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(2);
  });
}
