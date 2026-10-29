import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { init } from '../../src/install/init.js';
import { openStore } from '../../src/store/home.js';
import { checkEvent, readJournal } from '../../src/store/journal.js';
import { KEEP_SNAPSHOTS, snapshot } from '../../src/trust/snapshot.js';
import { checkPolicy, createServer, PolicyError, readPolicy, toolList } from '../../src/mcp/server.js';
import { addArgs, findClaude, install, LOCAL_SETTINGS, policyFiles, remove, sessionServer, sessionToolNames, SESSION_LOG_CAPS, status } from '../../src/mcp/session.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';

// Unit 15b: MIRAI's MCP server in your own Claude Code sessions, without a model. `claude` is a
// fake script that records its arguments and keeps one "registration"; the real runs are
// test/probes/session-probes.js.

const temps = [];
after(() => {
  for (const d of temps) {
    execFileSync('/bin/chmod', ['-R', 'u+rwX', d]);
    rmSync(d, { recursive: true, force: true });
  }
});
const tempDir = (name) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `mirai-15b-${name}-`)));
  temps.push(d);
  return d;
};
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// A fake claude: `mcp add-json` keeps the json, `mcp get` shows it (as Claude Code does: scope,
// status, the args), `mcp remove` drops it. Every call is logged with its folder. A `fail` file
// with a subcommand in it makes that one fail as Claude Code's own errors do.
function fakeClaude() {
  const dir = tempDir('bin');
  const state = join(dir, 'state');
  mkdirSync(state);
  writeFileSync(join(dir, 'claude'), `#!/bin/sh
printf '%s\\n' "$PWD|$*" >> "${state}/calls"
if [ -f "${state}/fail" ] && [ "$(cat "${state}/fail")" = "$2" ]; then echo "boom: something else went wrong"; exit 2; fi
case "$1 $2" in
  "mcp add-json") printf '%s' "$4" > "${state}/entry"; echo "Added stdio MCP server $3 to local config" ;;
  "mcp get") if [ -f "${state}/entry" ]; then echo "$3:"; echo "  Scope: Local config (private to you in this project)"; echo "  Status: $(cat "${state}/status" 2>/dev/null || echo '✔ Connected')"; echo "  Args: $(cat "${state}/entry")"; else echo "No MCP server named \\"$3\\""; exit 1; fi ;;
  "mcp remove") if [ -f "${state}/entry" ]; then rm "${state}/entry"; else echo "No MCP server named \\"$3\\""; exit 1; fi ;;
esac
`);
  chmodSync(join(dir, 'claude'), 0o755);
  return {
    dir,
    calls: () => (existsSync(join(state, 'calls')) ? readFileSync(join(state, 'calls'), 'utf8').trim().split('\n') : []),
    entry: () => (existsSync(join(state, 'entry')) ? JSON.parse(readFileSync(join(state, 'entry'), 'utf8')) : null),
    setEntry: (e) => writeFileSync(join(state, 'entry'), JSON.stringify(e)),
    setStatus: (t) => writeFileSync(join(state, 'status'), t),
    fail: (sub) => (sub ? writeFileSync(join(state, 'fail'), sub) : rmSync(join(state, 'fail'), { force: true })),
  };
}

// A repo with MIRAI installed and committed, and its trust root.
function installed({ compose = false, ignoreLocal = false } = {}) {
  const root = tempDir('repo');
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), '# App\n');
  if (ignoreLocal) writeFileSync(join(root, '.gitignore'), '.claude/settings.local.json\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'first');
  const env = { PATH: '/usr/bin:/bin', HOME: tempDir('home') };
  init({ cwd: root, env, branch: 'main' });
  if (compose) {
    const cfg = join(root, '.mirai', 'config.toml');
    chmodSync(cfg, 0o644);
    writeFileSync(cfg, `${readFileSync(cfg, 'utf8')}\n[compose]\nfiles = ["compose.yml"]\nenv_file = ".env.test"\n\n[[testing.levels]]\nname = "unit"\ncommand = ["t"]\nservice = "app"\n`);
    writeFileSync(join(root, 'compose.yml'), 'services:\n  app:\n    image: x\n');
    writeFileSync(join(root, '.env.test'), 'X=1\n');
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'Install MIRAI');
  const store = openStore({ cwd: root, env });
  return { root, env, store, trust: snapshot({ cwd: root, env }) };
}

// Moves the integration branch on, and returns the new trust root.
function moveOn(r, name) {
  writeFileSync(join(r.root, '.mirai', 'context', `${name}.md`), `${name}\n`);
  git(r.root, 'add', '-A');
  git(r.root, 'commit', '-qm', `move ${name}`);
  return snapshot({ cwd: r.root, env: r.env });
}

function harness(policy, deps = {}) {
  const waiting = new Map();
  const send = (msg) => msg.id !== undefined && waiting.get(msg.id)?.(msg);
  const server = createServer({ policy, send, deps });
  let next = 1;
  const call = async (name, args) => {
    const id = next++;
    const done = new Promise((r) => waiting.set(id, r));
    server.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    const m = await done;
    return m.result ? { ...JSON.parse(m.result.content[0].text), isError: m.result.isError } : { rpcError: m.error };
  };
  return { server, call };
}

test('15b T1: the interactive kind: lint, log_event and the test tools; no launch fields; no .git stop', async () => {
  const r = installed({ compose: true });
  const { policy, policyFile, policySha256 } = sessionServer({ store: r.store, trust: r.trust, env: r.env });
  assert.equal(readPolicy(policyFile, policySha256).kind, 'interactive');
  const list = toolList(policy);
  assert.deepEqual(list.map((t) => t.name), ['run_tests', 'log_event', 'lint']);
  assert.match(list.find((t) => t.name === 'log_event').description, /as your session's/);
  assert.deepEqual(policy.tools.log_event.max_events, SESSION_LOG_CAPS.max_events);
  for (const k of ['repo_state', 'launch_id', 'launch_dir', 'item']) assert.equal(policy[k], undefined, k);
  // A launch field in an interactive policy, or lint in a headless one, stops the server at start.
  assert.throws(() => checkPolicy({ ...policy, launch_id: '20261029120000-0123abcd' }), /isn't one this server reads/);
  assert.throws(() => checkPolicy({ ...policy, registration_id: 'nope' }), /isn't one this server reads/);
  const headless = { ...policy, kind: 'headless', registration_id: undefined, state_dir: undefined, repo_state: 'a'.repeat(64), launch_id: '20261029120000-0123abcd', launch_dir: r.root, item: null };
  assert.throws(() => checkPolicy(headless), (err) => err instanceof PolicyError && /a headless server never has \(lint\)/.test(err.message));
  // .git changing (your commits) never stops it; a test run is your session's, unsigned.
  let seen;
  const h = harness(policy, { repoState: () => { throw new Error('no .git check in a session'); }, runTest: async (o) => { seen = o; return { id: 't-1', name: 'unit', kind: 'level', outcome: 'pass', exit_code: 0, duration_ms: 1, output: { tail: '' }, tree: { hash: 'f'.repeat(64) } }; } });
  git(r.root, 'commit', '-q', '--allow-empty', '-m', 'yours');
  assert.equal((await h.call('run_tests', { level: 'unit' })).outcome, 'pass');
  assert.equal((await h.call('run_tests', { level: 'unit' })).outcome, 'pass');
  assert.deepEqual([seen.by, seen.launchId], ['session', null]);
  // The allow rules MIRAI adds are the table's interactive tools.
  assert.deepEqual(sessionToolNames(), ['mcp__mirai__run_tests', 'mcp__mirai__run_check', 'mcp__mirai__log_event', 'mcp__mirai__lint']);
});

test('15b T2: lint: the path form, the trust root\'s rules not the work tree\'s, results inline and escaped, nothing written', async () => {
  const r = installed();
  const { policy } = sessionServer({ store: r.store, trust: r.trust, env: r.env });
  const h = harness(policy);
  mkdirSync(join(r.root, 'docs', 'mirai'), { recursive: true });
  writeFileSync(join(r.root, 'docs', 'mirai', 'plain‮.md'), '# Plain\n');
  writeFileSync(join(r.root, 'docs', 'mirai', 'plain.md'), '# Plain\n');
  // The work tree moves the docs root away and empties its registry's document types; the trust
  // root's (the committed) rules still apply.
  const cfg = join(r.root, '.mirai', 'config.toml');
  chmodSync(cfg, 0o644);
  writeFileSync(cfg, `${readFileSync(cfg, 'utf8')}\n[docs]\nroot = "elsewhere"\n`);
  const types = join(r.root, '.mirai', 'framework', 'registry', 'document-types');
  execFileSync('/bin/chmod', ['-R', 'u+w', join(r.root, '.mirai', 'framework')]);
  for (const f of readdirSync(types)) rmSync(join(types, f));
  const status = () => git(r.root, 'status', '--porcelain');
  const before = status();
  const res = await h.call('lint', { paths: ['docs'] });
  assert.equal(res.outcome, 'fail');
  assert.equal(res.isError, false);
  assert.equal(res.trust_base, r.trust.baseSha);
  assert.ok(res.problems.some((p) => p.file === 'docs/mirai/plain.md' && p.code === 'no-frontmatter'), JSON.stringify(res.problems));
  assert.ok(!JSON.stringify(res).includes('‮'), 'a bidi character came back raw');
  assert.ok(res.problems.some((p) => /plain.+\.md/.test(p.file) && p.file !== 'docs/mirai/plain.md'), 'the file with the bidi name wasn\'t linted');
  assert.equal(status(), before, 'lint wrote something');
  const whole = await h.call('lint', {});
  assert.ok(whole.files >= 1);
  for (const [args, re] of [
    [{ paths: ['-x'] }, /character/], [{ paths: ['../x'] }, /character|part/], [{ paths: ['/etc'] }, /character/], [{ paths: 'docs' }, /list/],
    [{ paths: Array.from({ length: 33 }, (_, i) => `d${i}`) }, /at most 32/], [{ paths: [1] }, /string/], [{ path: 'docs' }, /takes no path/],
  ]) {
    const x = await h.call('lint', args);
    assert.equal(x.code, 'bad-arguments', JSON.stringify(args));
    assert.match(x.message, re, JSON.stringify(args));
  }
  assert.equal((await h.call('lint', { paths: ['nope'] })).code, 'bad-path');
  // Many problems: the reply stays within its byte budget, the counts stay whole.
  for (let i = 0; i < 400; i++) writeFileSync(join(r.root, 'docs', 'mirai', `p${i}.md`), '# P\n');
  const many = await h.call('lint', { paths: ['docs'] });
  assert.equal(many.errors >= 400, true);
  assert.equal(many.problems_truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(many.problems)) <= 32 * 1024);
});

test('15b T3: log_event in a session: by session with its registration, no launch or item, the daily cap under the lock, the journal\'s rules', async () => {
  const r = installed();
  const { policy } = sessionServer({ store: r.store, trust: r.trust, env: r.env });
  let day = '2026-10-29T10:00:00.000Z';
  const capped = { ...policy, tools: { ...policy.tools, log_event: { ...policy.tools.log_event, max_events: 2 } } };
  const h = harness(capped, { now: () => new Date(day) });
  // A second server on the same registration (another session) shares the count.
  const other = harness(capped, { now: () => new Date(day) });
  assert.equal((await h.call('log_event', { type: 'note', message: 'from my session' })).logged, 'note');
  const line = readJournal(r.store).events.find((e) => e.by === 'session');
  assert.deepEqual([line.registration_id, line.launch_id, line.item, line.schema_version], [policy.registration_id, undefined, undefined, 4]);
  assert.equal((await other.call('log_event', { type: 'note', message: 'two' })).logged, 'note');
  const full = await h.call('log_event', { type: 'note', message: 'three' });
  assert.equal(full.code, 'log-full');
  assert.match(full.message, /today \(UTC\)/);
  day = '2026-10-30T10:00:00.000Z';
  assert.equal((await h.call('log_event', { type: 'note', message: 'the next day' })).logged, 'note');
  // Day counts older than a week are removed.
  day = '2026-11-08T10:00:00.000Z';
  await h.call('log_event', { type: 'note', message: 'later' });
  assert.deepEqual(readdirSync(policy.state_dir).sort(), ['log-events-2026-11-08']);
  assert.equal((await h.call('log_event', { type: 'note', message: 'x', item: 'T-1' })).code, 'bad-arguments');
  // The journal: a session line is never privileged, and registration_id goes with it both ways.
  assert.throws(() => checkEvent({ type: 'mr_closed', by: 'session', registration_id: policy.registration_id, ticket: 'T-1' }), /written only by MIRAI itself/);
  assert.throws(() => checkEvent({ type: 'note', by: 'session', message: 'x' }), /names its registration/);
  assert.throws(() => checkEvent({ type: 'note', by: 'agent', launch_id: '20261029120000-0123abcd', registration_id: policy.registration_id, message: 'x' }), /only a session line carries a registration_id/);
});

test('15b T4: the policy: named by its hash, read-only; a stable id; a pinned trust root that changed stops the server', async () => {
  const r = installed();
  const a = sessionServer({ store: r.store, trust: r.trust, env: r.env });
  assert.match(a.policyFile, /\/mcp-policy-[0-9a-f]{64}\.json$/);
  assert.ok(a.policyFile.endsWith(`mcp-policy-${a.policySha256}.json`));
  assert.equal(statSync(a.policyFile).mode & 0o777, 0o400);
  assert.throws(() => readPolicy(a.policyFile, 'f'.repeat(64)), /doesn't match its hash/);
  const b = sessionServer({ store: r.store, trust: r.trust, env: r.env });
  assert.equal(b.policy.registration_id, a.policy.registration_id, 'the id is kept');
  assert.equal(b.policyFile, a.policyFile, 'the same content, the same file');
  assert.deepEqual(policyFiles(r.store).map((p) => p.base), [r.trust.baseSha]);
  assert.deepEqual(b.entry.args.slice(0, 3), ['-i', `HOME=${realpathSync(r.env.HOME)}`, 'PATH=/usr/bin:/bin']);
  assert.equal(b.entry.command, '/usr/bin/env');
  assert.deepEqual(b.entry.env, {});
  // A dry run writes nothing.
  const t2 = moveOn(r, 'dry');
  sessionServer({ store: r.store, trust: t2, env: r.env, write: false });
  assert.equal(policyFiles(r.store).length, 1);
  // The pinned trust root changed under it: every call refused, and the server stops.
  const h = harness(b.policy);
  const lock = join(b.policy.trust_dir, 'tree', '.mirai', 'mirai.lock');
  chmodSync(lock, 0o644);
  writeFileSync(lock, `${readFileSync(lock, 'utf8')} `);
  assert.equal((await h.call('lint', {})).code, 'trust-tampered');
  assert.equal((await h.call('log_event', { type: 'note', message: 'x' })).code, 'stopped');
});

test('15b T5: registration: claude\'s own CLI in the checkout; a failed or impossible install leaves the running one alone; never a server that isn\'t MIRAI\'s', () => {
  const r = installed();
  const fake = fakeClaude();
  const env = { ...r.env, PATH: `${fake.dir}:/usr/bin:/bin` };
  const done = install({ store: r.store, trust: r.trust, env });
  assert.equal(done.done, true);
  const calls = fake.calls();
  assert.deepEqual(calls.map((c) => c.split('|')[0]), [realpathSync(r.root), realpathSync(r.root)], 'run in the checkout');
  assert.match(calls[0], /\|mcp get mirai$/);
  assert.equal(calls[1].split('|')[1], addArgs(done.entry).join(' '));
  assert.deepEqual(fake.entry(), done.entry);
  assert.ok(!existsSync(join(r.env.HOME, '.claude.json')) && !existsSync(join(r.env.HOME, '.claude')), 'MIRAI wrote Claude Code\'s files itself');
  assert.equal(status({ store: r.store, env, trust: r.trust }).state, 'current');
  // The branch moves on: behind. An install with no claude on PATH, or one whose add fails, leaves
  // the running registration's policy and trust root in place: it still starts.
  const t2 = moveOn(r, 'later');
  assert.equal(status({ store: r.store, env, trust: t2 }).state, 'stale');
  const old = fake.entry();
  const none = install({ store: r.store, trust: t2, env: r.env });
  assert.equal(none.done, false);
  assert.match(none.command, new RegExp(`^cd '?${realpathSync(r.root).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'? && claude mcp add-json mirai '\\{"type":"stdio"`));
  assert.doesNotThrow(() => readPolicy(old.args[5], old.args[6]), 'the running registration\'s policy was changed');
  fake.fail('add-json');
  assert.throws(() => install({ store: r.store, trust: t2, env }), /add-json failed/);
  fake.fail(null);
  assert.doesNotThrow(() => readPolicy(old.args[5], old.args[6]));
  // The trust root it runs from is still kept: many more snapshots don't prune it.
  for (let i = 0; i < KEEP_SNAPSHOTS + 2; i++) moveOn(r, `m${i}`);
  assert.ok(existsSync(old.args[4]), 'the running registration\'s trust root was pruned');
  // Registered again: the older policies go, and the new one is current.
  const t3 = snapshot({ cwd: r.root, env: r.env });
  assert.equal(install({ store: r.store, trust: t3, env }).done, true);
  assert.deepEqual(policyFiles(r.store).map((p) => p.base), [t3.baseSha]);
  assert.equal(status({ store: r.store, env, trust: t3 }).state, 'current');
  // Another node (a different command line) or a failed start: stale.
  fake.setEntry({ ...fake.entry(), args: fake.entry().args.map((a, i) => (i === 3 ? '/old/node' : a)) });
  assert.equal(status({ store: r.store, env, trust: t3 }).state, 'stale');
  install({ store: r.store, trust: t3, env });
  fake.setStatus('✘ Failed to connect');
  assert.equal(status({ store: r.store, env, trust: t3 }).state, 'stale');
  fake.setStatus('✔ Connected');
  // claude failing for another reason: unknown, never "missing".
  fake.fail('get');
  assert.equal(status({ store: r.store, env, trust: t3 }).state, 'unknown');
  assert.throws(() => remove({ store: r.store, env }), /claude mcp get failed/);
  fake.fail(null);
  // Remove: gone, and the policies with it, so pruning no longer keeps their trust roots.
  assert.equal(remove({ store: r.store, env }).done, true);
  assert.equal(status({ store: r.store, env, trust: t3 }).state, 'missing');
  assert.deepEqual(policyFiles(r.store), []);
  assert.equal(remove({ store: r.store, env }).absent, true);
  // A `mirai` server that isn't MIRAI's: never replaced or removed.
  fake.setEntry({ type: 'stdio', command: '/usr/local/bin/my-own-mirai', args: [], env: {} });
  assert.equal(status({ store: r.store, env, trust: t3 }).state, 'foreign');
  assert.throws(() => install({ store: r.store, trust: t3, env }), (err) => err.code === 'not-ours');
  assert.throws(() => remove({ store: r.store, env }), (err) => err.code === 'not-ours');
  assert.equal(fake.entry().command, '/usr/local/bin/my-own-mirai');
});

test('15b T5b: findClaude: absolute folders only; never one in the project, by its real path or through a link', () => {
  const r = installed();
  const fake = fakeClaude();
  const inProject = join(r.root, 'node_modules', '.bin');
  mkdirSync(inProject, { recursive: true });
  writeFileSync(join(inProject, 'claude'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(inProject, 'claude'), 0o755);
  const linkToProject = join(tempDir('link'), 'proj');
  execFileSync('/bin/ln', ['-s', r.root, linkToProject]);
  const linkedClaude = join(tempDir('lbin'), 'claude');
  execFileSync('/bin/ln', ['-s', join(inProject, 'claude'), linkedClaude]);
  const co = realpathSync(r.root);
  assert.equal(findClaude({ PATH: `${inProject}:/usr/bin` }, co), null);
  assert.equal(findClaude({ PATH: `${join(linkToProject, 'node_modules', '.bin')}:/usr/bin` }, co), null);
  assert.equal(findClaude({ PATH: `${join(linkedClaude, '..')}:/usr/bin` }, co), null);
  assert.equal(findClaude({ PATH: `relative/bin:${fake.dir}` }, co), join(fake.dir, 'claude'));
});

test('15b T6: the commands, and mirai render: only a registration that\'s behind is made again; remove lasts', async () => {
  const r = installed();
  const fake = fakeClaude();
  const env = { ...r.env, PATH: `${fake.dir}:/usr/bin:/bin` };
  let out = '';
  let err = '';
  const io = (tty = false) => ({ stdin: Readable.from([]), stdout: { isTTY: tty, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd: r.root });
  // Not installed: render in a terminal leaves it so.
  assert.equal(await main(['render'], io(true)), EXIT.OK, err);
  assert.equal(fake.entry(), null, 'render registered without install');
  assert.equal(await main(['session-server', 'install'], io()), EXIT.OK, err);
  assert.match(out, /registered MIRAI's server .* tools: log_event, lint/s);
  out = '';
  assert.equal(await main(['session-server', 'status'], io()), EXIT.OK, err);
  assert.match(out, /registered, for the current trust root/);
  assert.equal(await main(['session-server', 'nope'], io()), EXIT.USAGE);
  // Behind: render outside a terminal leaves it; in a terminal it registers again.
  moveOn(r, 'later');
  const callsBefore = fake.calls().length;
  assert.equal(await main(['render'], io(false)), EXIT.OK, err);
  assert.equal(fake.calls().length, callsBefore, 'render without a terminal called claude');
  out = '';
  assert.equal(await main(['session-server', 'status'], io()), EXIT.NEEDS_HUMAN, err);
  assert.match(out, /behind/);
  out = '';
  assert.equal(await main(['render'], io(true)), EXIT.OK, err);
  assert.match(out, /registered again/);
  assert.equal(await main(['session-server', 'status'], io()), EXIT.OK, err);
  // Removed: render in a terminal doesn't bring it back.
  assert.equal(await main(['session-server', 'remove'], io()), EXIT.OK, err);
  moveOn(r, 'after-remove');
  assert.equal(await main(['render'], io(true)), EXIT.OK, err);
  assert.equal(fake.entry(), null, 'render undid remove');
});

test('15b T7: the allow rules: in your git-ignored settings.local.json, never the committed file; only MIRAI\'s are taken out', () => {
  const fake = fakeClaude();
  // Not ignored: none written, and a note says why.
  const a = installed();
  const envA = { ...a.env, PATH: `${fake.dir}:/usr/bin:/bin` };
  const na = install({ store: a.store, trust: a.trust, env: envA });
  assert.match(na.note, /doesn't ignore \.claude\/settings\.local\.json/);
  assert.equal(existsSync(join(a.root, LOCAL_SETTINGS)), false);
  remove({ store: a.store, env: envA });
  // Ignored: added next to yours, and remove takes out only MIRAI's.
  const b = installed({ ignoreLocal: true });
  const envB = { ...b.env, PATH: `${fake.dir}:/usr/bin:/bin` };
  mkdirSync(join(b.root, '.claude'), { recursive: true });
  writeFileSync(join(b.root, LOCAL_SETTINGS), `${JSON.stringify({ theme: 'dark', permissions: { allow: ['Bash(make)', 'mcp__mirai__lint'] } })}\n`);
  assert.equal(install({ store: b.store, trust: b.trust, env: envB }).note, null);
  const local = () => JSON.parse(readFileSync(join(b.root, LOCAL_SETTINGS), 'utf8'));
  assert.deepEqual(local().permissions.allow, ['Bash(make)', 'mcp__mirai__lint', 'mcp__mirai__run_tests', 'mcp__mirai__run_check', 'mcp__mirai__log_event']);
  assert.equal(local().theme, 'dark');
  install({ store: b.store, trust: b.trust, env: envB });
  assert.equal(local().permissions.allow.length, 5, 'not idempotent');
  remove({ store: b.store, env: envB });
  assert.deepEqual(local().permissions.allow, ['Bash(make)', 'mcp__mirai__lint'], 'your own entries were taken out');
  // The committed settings have none of them.
  const committed = JSON.parse(readFileSync(join(b.root, '.claude', 'settings.json'), 'utf8'));
  assert.ok(!(committed.permissions.allow ?? []).some((e) => e.startsWith('mcp__')));
  // A link in place of the file: left alone.
  rmSync(join(b.root, LOCAL_SETTINGS));
  execFileSync('/bin/ln', ['-s', '/etc/hosts', join(b.root, LOCAL_SETTINGS)]);
  assert.match(install({ store: b.store, trust: b.trust, env: envB }).note, /isn't a plain file/);
});

test('15b T8: the session probes stay canary-only, use a temporary Claude Code config, and use Haiku', async () => {
  const { RUNS } = await import('../probes/session-probes.js');
  assert.deepEqual(RUNS.map((x) => x.id), ['s2-allow', 's2-no-allow', 's3-planted', 's3-enabled', 's4-broken', 's2-untrusted', 's2-local', 's3-no-local']);
  const text = readFileSync(new URL('../probes/session-probes.js', import.meta.url), 'utf8');
  for (const m of text.matchAll(/'--model', ([^,\]]+)/g)) assert.equal(m[1].trim(), "'haiku'");
  assert.ok(!/claude-opus|claude-sonnet|'opus'|'sonnet'/.test(text));
  assert.match(text, /CLAUDE_CONFIG_DIR: fx\.config/);
  // Your real config is only ever counted against the fixture's path, never written.
  assert.ok(!/writeFileSync\([^)]*\.claude\.json|writeFileSync\([^)]*process\.env\.HOME/.test(text.replace(/join\(fx\.config, '\.claude\.json'\)/, 'TEMP')));
  assert.match(text, /'\/usr\/bin\/grep', \['-c', '-F'/);
});

test('15b T9: the registered entry starts MIRAI\'s server as Claude Code would, and its tools answer over the pipe', async () => {
  const r = installed();
  const { entry, policy } = sessionServer({ store: r.store, trust: r.trust, env: r.env });
  const { spawn } = await import('node:child_process');
  const child = spawn(entry.command, entry.args, { env: entry.env, cwd: r.root, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  const replies = () => out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {} } });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'log_event', arguments: { type: 'note', message: 'from the pipe' } } });
  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'lint', arguments: {} } });
  for (let i = 0; i < 300 && replies().length < 4; i++) await new Promise((done) => setTimeout(done, 50));
  child.stdin.end();
  await new Promise((done) => child.on('close', done));
  const by = Object.fromEntries(replies().map((m) => [m.id, m]));
  assert.deepEqual(by[2].result.tools.map((t) => t.name), ['log_event', 'lint']);
  const logged = JSON.parse(by[3].result.content[0].text);
  assert.equal(logged.logged, 'note');
  assert.equal(readJournal(r.store).events.find((e) => e.seq === logged.seq).registration_id, policy.registration_id);
  assert.equal(JSON.parse(by[4].result.content[0].text).outcome, 'pass');
});
