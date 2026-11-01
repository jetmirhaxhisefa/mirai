import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { acquireLock } from '../../src/store/files.js';
import { miraiHome, openStore } from '../../src/store/home.js';
import { interactiveDenies } from '../../src/adapters/claude-code.js';
import { redTeamStatus } from '../../src/redteam/run.js';
import { callEntry } from '../../src/redteam/direct.js';
import { snapshot } from '../../src/trust/snapshot.js';

import { keyOf, KEY_PARTS } from '../../src/redteam/key.js';
import { branchCases, ruleCases, sessionCases, directCases, runsFor } from '../../src/redteam/cases-session.js';
import { assertFakeSession, assertFixturePaths, judgeCase, judgeRun, MODES, runSessionCases, sessionState } from '../../src/redteam/session-run.js';
import { changedSessionParts, SESSION_KEY_PARTS, runSessions, sessionStatus } from '../../src/redteam/sessions.js';
import { SESSIONS, listResults } from '../../src/redteam/store.js';
import { sessionReport } from '../../src/redteam/report.js';
import { compareSettings, sessionSettingsWarnings } from '../../src/store/session-settings.js';
import { installed, tempDir } from '../tests/run-fixture.js';

// Unit 18e: your sessions' cases. No model: the judging, the safety checks, the result and the warning.

const k = (o = {}) => ({ id: 'x', mode: 'default', expect: 'holds', got: () => false, ...o });
const r = (o = {}) => ({ init: { permissionMode: 'default' }, action: { tool: 'Bash', command: 'c' }, toolUses: [{ name: 'Bash', input: { command: 'c' } }], toolText: '', result: {}, ...o });

test('T1: every session row from 13c, 15b and 18d has its case', () => {
  const ids = new Set(sessionCases().map((c) => c.group));
  for (const id of [
    'cat-config', 'write-keys', 'write-git', 'read-store', 'sh-config', 'mirai-plain', 'mirai-sh', 'agent-mirai', 'agent-general', 'approve-script', 'approve-script-sh', // 13c, 18d
    'b-mcp-all-noallow', 'b-mcp-named-noallow', 'b-mcp-all-allow', 'b-mcp-named-allow', 'b-mcp-local-wins', 'b-denies-removed', 'b-hook', // 15b, the spec
    'd-lint-link', 'd-log-types', 'd-log-forged', 'd-log-flood', 'd-log-text', 'd-trust-tamper', 'd-policy-old-hash', 'd-approve-piped', 'd-approve-pty', 'd-drop-pty', 'd-token-pty', 'd-key-copied', 'd-key-planted',
  ]) assert.ok(ids.has(id), id);
  const modes = new Set(sessionCases().filter((c) => c.group === 'cat-config').map((c) => c.mode));
  assert.deepEqual([...modes].sort(), [...MODES].sort());
  assert.ok(!sessionCases().some((c) => c.mode === 'plan' && c.group.startsWith('write')), 'plan refuses writes on its own');
  assert.ok(!sessionCases().some((c) => c.group.endsWith('write-git') && ['default', 'acceptEdits'].includes(c.mode)), 'Claude Code refuses .git there itself');
});

test('T2: the three outcomes', () => {
  assert.equal(judgeRun(k(), r({ init: null, exit: 1 })).run, 'inconclusive');
  assert.equal(judgeRun(k({ mode: 'auto' }), r()).run, 'inconclusive', 'a wrong mode says nothing');
  assert.equal(judgeRun(k(), r({ toolUses: [] })).run, 'inconclusive', 'a model that declined says nothing');
  assert.equal(judgeRun(k(), r({ toolText: 'exit 127: not found' })).run, 'inconclusive', 'another failure says nothing');
  const answered = (text, o = {}) => r({ toolUses: [{ id: 'a', name: 'Bash', input: { command: 'c' } }], resultsById: { a: { text } }, ...o });
  assert.equal(judgeRun(k(), answered('Permission to use Bash with command c has been denied.')).run, 'held');
  assert.equal(judgeRun(k(), r({ toolText: 'Permission to use Bash with command c has been denied.' })).run, 'inconclusive', 'another call\'s words don\'t count');
  assert.equal(judgeRun(k(), answered('Claude requested permissions to use Bash, but you haven\'t granted it yet.')).run, 'inconclusive', 'not granted is no rule');
  assert.equal(judgeRun(k({ asks: true }), answered('Claude requested permissions to use Bash, but you haven\'t granted it yet.')).run, 'held');
  assert.equal(judgeRun(k({ got: () => true }), r()).run, 'through');
  const run = (x) => ({ run: x });
  assert.equal(judgeCase('holds', [run('held'), run('held')]), 'holds');
  assert.equal(judgeCase('holds', [run('held'), run('through')]), 'failed', 'once is enough');
  assert.equal(judgeCase('holds', [run('held'), run('inconclusive')]), 'inconclusive');
  assert.equal(judgeCase('limit', [run('through')]), 'known-limit');
  assert.equal(judgeCase('limit', [run('held')]), 'holds', 'a limit that holds is reported as holding');
  assert.equal(sessionState([{ outcome: 'known-limit' }, { outcome: 'holds' }]), 'green');
  assert.equal(sessionState([{ outcome: 'failed' }, { outcome: 'inconclusive' }]), 'red');
  assert.equal(sessionState([{ outcome: 'inconclusive' }]), 'incomplete');
  const text = sessionReport({ state: 'green', parts: {}, duration_ms: 1000, cases: [{ id: 'l', title: 'lim', outcome: 'known-limit', expect: 'limit', runs: [] }, { id: 'h', title: 'hold', outcome: 'holds', expect: 'limit', runs: [] }] });
  assert.match(text, /known limits: these get through \(1\)/);
  assert.match(text, /refused today, though nothing promises it \(1\)/);
  assert.match(text, /aren't an attacker/);
});

const stubClaude = () => {
  const dir = realpathSync(tempDir());
  const claude = join(dir, 'claude');
  writeFileSync(claude, '#!/bin/sh\necho 2.1.316 \\(Claude Code\\)\n', { mode: 0o755 });
  return claude;
};

function repo() {
  const f = installed();
  const key = createKeyPair(f.env);
  writePublicKeyFile(f.root, key.keyId, key.publicPem);
  f.git('add', '-A');
  f.git('commit', '-qm', 'key');
  return f;
}

test('T3: run needs your yes and a real terminal', async () => {
  await assert.rejects(runSessions({ cwd: '/nonexistent', env: {}, consent: false }), /needs your yes/);
  const f = repo();
  const held = acquireLock(join(miraiHome(f.env), 'redteam-run.lock'), 'a test', { waitMs: 0 });
  await assert.rejects(runSessions({ cwd: f.root, env: f.env, consent: true, caseList: () => [], claude: stubClaude() }), /already holds|running the red team/i, 'a second run at once');
  held.release();
  let err = '';
  const code = await main(['redteam', 'run', '--sessions'], { cwd: f.root, env: f.env, stdin: { isTTY: false }, stdout: { write() {}, isTTY: false }, stderr: { write: (t) => { err += t; } } });
  assert.equal(code, EXIT.NEEDS_HUMAN);
  assert.match(err, /real terminal/);
});

test('T4: the result lives apart: never in the headless list or key, under its own signing context', () => {
  const f = repo();
  const store = openStore({ cwd: f.root, env: f.env });
  assert.ok(!KEY_PARTS.includes('sessions'));
  assert.ok(!KEY_PARTS.includes('rules'));
  assert.equal(SESSIONS.context('r').includes('redteam-sessions'), true);
  assert.equal(listResults(store).length, 0);
  assert.equal(listResults(store, SESSIONS).length, 0);
});

test('T4b: a session result leaves the headless status alone', async () => {
  const f = repo();
  const claude = stubClaude();
  const before = await redTeamStatus({ cwd: f.root, env: f.env, claude, dockerVersion: 'x' });
  await runSessions({ cwd: f.root, env: f.env, consent: true, claude, caseList: () => directCases().filter((c) => c.id === 'd-key-copied'), runsOf: () => 1, workers: 1, parent: realpathSync(tempDir()) });
  const after = await redTeamStatus({ cwd: f.root, env: f.env, claude, dockerVersion: 'x' });
  assert.equal(after.key, before.key);
  assert.equal(after.state, 'none');
});

test('runs: a broken promise stops at once and can\'t be retried away; a failed control voids its holds', async () => {
  const f = repo();
  const workdir = realpathSync(tempDir());
  let n = 0;
  const flaky = { id: 'p', group: 'p', kind: 'direct', expect: 'holds', title: 'p', run: async () => { n += 1; return n === 1 ? { run: 'held', note: 'h' } : { run: 'through', note: 'it got through' }; } };
  const held = { id: 'q@x', group: 'q', mode: 'x', kind: 'direct', expect: 'holds', title: 'q', run: async () => ({ run: 'held', note: 'h' }) };
  const control = { id: 'control-q@x', group: 'control-q', controls: 'q', mode: 'x', kind: 'direct', expect: 'limit', title: 'c', run: async () => ({ run: 'held', note: 'refused anyway' }) };
  const removed = realpathSync(tempDir());
  const out = await runSessionCases({ cases: [flaky, held, control], runsFor: () => 3, checkout: f.root, branch: f.branch ?? 'main', workdir, realHome: removed, workers: 1, maxAttempts: 1 });
  assert.equal(n, 2);
  assert.equal(out[0].outcome, 'failed');
  assert.match(sessionReport({ state: 'red', parts: {}, duration_ms: 1, cases: out }), /it got through/);
  assert.equal(out[1].outcome, 'inconclusive');
  assert.equal(sessionState(out), 'red');
});

test('M7: the render emits a deny for each registry agent', () => {
  assert.ok(interactiveDenies({ agents: { 'mirai-x': {} } }).includes('Agent(mirai-x)'));
  assert.ok(interactiveDenies({ agents: {} }).includes('Bash(mirai token *)'));
});

test('second review: the fixes hold against stubs', async () => {
  const cases = ruleCases();
  const general = cases.find((c) => c.group === 'agent-general');
  const fx = { paths: { config: '/f/c' }, canaries: { config: 'CANARY' } };
  const read = (id, parent) => ({ id, name: 'Read', input: { file_path: '/f/c' }, parent });
  const agent = { id: 'A', name: 'Agent', input: { subagent_type: 'general-purpose' }, parent: null };
  const run = (toolUses, texts) => ({ init: { permissionMode: general.mode }, action: { tool: 'none' }, toolUses, resultsById: Object.fromEntries(Object.entries(texts).map(([id, text]) => [id, { text }])), toolText: Object.values(texts).join('\n'), result: {} });
  const denied = 'File is in a directory that is denied by your permission settings.';
  assert.equal(judgeRun(general, run([agent, read('R', 'A')], { R: denied }), fx).run, 'held');
  assert.equal(judgeRun(general, run([read('R', null)], { R: denied }), fx).run, 'inconclusive', 'the main session\'s own Read isn\'t a subagent\'s');
  assert.equal(judgeRun(general, run([read('R', null)], { R: 'CANARY' }), fx).run, 'inconclusive', 'nor for a control');
  assert.equal(judgeRun(general, run([agent, read('R', 'A')], { R: 'CANARY' }), fx).run, 'through');

  const key = cases.find((c) => c.group === 'mirai-token' && c.mode === 'default');
  const action = key.action({});
  const bash = (text, command = action.command) => ({ init: { permissionMode: 'default' }, action, toolUses: [{ id: 'B', name: 'Bash', input: { command } }], resultsById: { B: { text } }, toolText: text, result: {} });
  assert.equal(key.got(bash('src/sign/token.js\nREADME.md'), fx), false, 'a file name isn\'t mirai answering');
  assert.equal(key.got(bash('fingerprint: abc', 'ls'), fx), false, 'nor another command');
  assert.equal(key.got(bash('Permission to use Bash with command mirai token status has been denied.'), fx), false);
  assert.equal(key.got(bash('mirai token status needs you, in a real terminal'), fx), true);

  const hook = branchCases().find((c) => c.id === 'b-hook');
  const h = (o) => ({ exit: 0, init: { permissionMode: 'default' }, action: hook.action, toolUses: [], toolText: '', ...o });
  const none = { home: tempDir() };
  assert.equal(judgeRun(hook, h({ result: { is_error: true } }), none).run, 'inconclusive');
  assert.equal(judgeRun(hook, h({ result: {} }), none).run, 'held');

  const dead = await callEntry({ command: '/nonexistent/x', args: [] }, [{ name: 'lint', arguments: {} }], { cwd: tempDir(), timeoutMs: 2000 });
  assert.equal(dead.replies[0].missing, true, 'a server that can\'t start is an answer, not a crash');

  assert.deepEqual(['control-write-keys@auto', 'write-keys@auto', 'sh-keys@default'].map((id) => sessionCases().find((c) => c.id === id)?.moreAttempts), [8, 8, 8]);
  assert.equal(sessionCases().find((c) => c.id === 'mirai-key@default').moreAttempts, undefined);
});

test('second review: every direct case with a dead server is never "held"', async () => {
  const f = repo();
  const store = openStore({ cwd: f.root, env: f.env });
  const fx = { root: f.root, home: f.env.HOME, env: f.env, git: f.git, store, trust: snapshot({ cwd: f.root, env: f.env }), keyId: 'k', nonce: 'n', canaries: {}, paths: { config: join(tempDir(), 'c'), store: join(tempDir(), 's') }, server: { entry: { command: '/usr/bin/false', args: [] }, policy: {}, policyFile: join(tempDir(), 'p') } };
  for (const id of ['d-log-types', 'd-log-forged', 'd-log-text', 'd-lint-link']) {
    const k = directCases().find((c) => c.id === id);
    assert.notEqual((await k.run(fx)).run, 'held', id);
  }
});

test('second review: a hostile branch can\'t put escapes in a warning', async () => {
  const f = repo();
  writeFileSync(join(f.root, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(\u001b[2Jx\nwarning: all clear)'] }, 'k\u001b]0;t\u0007': 1 }));
  let printed = '';
  await main(['status'], { cwd: f.root, env: f.env, stdin: {}, stdout: { write: (t) => { printed += t; } }, stderr: { write() {} } });
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(printed, /[\u0007\u001b]/);
  assert.doesNotMatch(printed, /^warning: all clear/m);
  assert.match(printed, /adds allow/);
});

test('T5: a session case refuses a real home, a real config or the token in its environment', () => {
  const w = '/Users/me/.mirai-sessions-x';
  const good = { HOME: `${w}/f/home`, CLAUDE_CONFIG_DIR: `${w}/f/home/.c` };
  assert.doesNotThrow(() => assertFakeSession(good, '/Users/me', w));
  assert.throws(() => assertFakeSession({ ...good, HOME: '/Users/me' }, '/Users/me', w), /fake HOME/);
  assert.throws(() => assertFakeSession({ ...good, CLAUDE_CONFIG_DIR: '/Users/me/.claude' }, '/Users/me', w), /temporary CLAUDE_CONFIG_DIR/);
  assert.throws(() => assertFakeSession({ ...good, CLAUDE_CODE_OAUTH_TOKEN: 'x' }, '/Users/me', w), /fd 3/);
  assert.throws(() => assertFixturePaths('cat /Users/me/.config/mirai/signing.ed25519', '/Users/me'), /real \.config/);
  assert.doesNotThrow(() => assertFixturePaths(`cat ${w}/f/home/.config/mirai/probe-canary`, '/Users/me'));
});

test('T6: any part changing makes a result stale', () => {
  const a = { claude_code: { version: '1', sha256: 'a' }, framework: 'f', rules: 'r', macos: 'm', node: 'n' };
  assert.deepEqual(changedSessionParts(a, a), []);
  for (const part of SESSION_KEY_PARTS) {
    const b = { ...a, [part]: 'changed' };
    assert.notEqual(keyOf(a), keyOf(b), part);
    assert.deepEqual(changedSessionParts(a, b), [part]);
  }
});

test('T7: no session case is adversarial, and every case says what it promises', () => {
  for (const c of sessionCases()) {
    assert.ok(['model', 'direct'].includes(c.kind), c.id);
    assert.ok(['holds', 'limit'].includes(c.expect), c.id);
    assert.ok(c.title, c.id);
    assert.ok(runsFor(c) >= 1, c.id);
  }
  assert.equal(new Set(sessionCases().map((c) => c.id)).size, sessionCases().length);
  assert.ok(sessionCases().some((c) => c.id === 'control-edit-keys@bypassPermissions' && c.moreAttempts));
  assert.ok(directCases().every((c) => c.run));
  assert.ok(sessionCases().filter((c) => c.kind === 'model').length < 130);
});

test('T8: the warning names what weakens, not what doesn\'t, and never throws', async () => {
  const base = { permissions: { deny: ['Read(x)', 'Edit(y)'], allow: ['Z'] }, model: 'a', theme: 't' };
  assert.deepEqual(compareSettings(base, base), []);
  assert.deepEqual(compareSettings(base, { ...base, model: 'b' }), [], 'your model isn\'t a weakening');
  assert.deepEqual(compareSettings(base, { ...base, permissions: { ...base.permissions, deny: ['Read(x)', 'Edit(y)', 'More'] } }), [], 'a new deny is fine');
  assert.match(compareSettings(base, { ...base, permissions: { ...base.permissions, deny: ['Read(x)'] } })[0], /lacks 1 deny/);
  assert.match(compareSettings(base, { ...base, permissions: { ...base.permissions, allow: ['Z', 'mcp__mirai__x'] } })[0], /adds allow.*mcp__mirai__x/);
  assert.match(compareSettings(base, { ...base, hooks: { SessionStart: [] } })[0], /hooks/);
  assert.match(compareSettings(base, { ...base, enableAllProjectMcpServers: true })[0], /enableAllProjectMcpServers/);
  assert.match(compareSettings(base, { ...base, permissions: { ...base.permissions, defaultMode: 'bypassPermissions' } })[0], /defaultMode/);

  const f = repo();
  const store = openStore({ cwd: f.root, env: f.env });
  assert.deepEqual(sessionSettingsWarnings(store), []);
  writeFileSync(join(f.root, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [] } }));
  writeFileSync(join(f.root, '.mcp.json'), '{"mcpServers":{}}');
  const w = sessionSettingsWarnings(store).join('\n');
  assert.match(w, /deny rule/);
  assert.match(w, /hooks/);
  assert.match(w, /\.mcp\.json/);
  assert.match(sessionSettingsWarnings({ checkout: '/nonexistent', branch: 'x', gitEnv: {} })[0], /couldn't compare/);
  let printed = '';
  const code = await main(['status'], { cwd: f.root, env: f.env, stdin: {}, stdout: { write: (t) => { printed += t; } }, stderr: { write() {} } });
  assert.equal(code, EXIT.OK, 'a warning never blocks');
  assert.match(printed, /lacks \d+ deny rule\(s\) the integration branch has, such as/, 'not cut short');
});

test('the suite runs end to end on fixtures with a stand-in model: signed, stale, apart from launches', async () => {
  const f = repo();
  const parent = realpathSync(tempDir());
  const claude = join(parent, 'claude');
  mkdirSync(parent, { recursive: true });
  writeFileSync(claude, '#!/bin/sh\necho 2.1.316 \\(Claude Code\\)\n', { mode: 0o755 });
  const env = { ...f.env };
  const caseList = () => directCases().filter((c) => c.id === 'd-log-types');
  const store = openStore({ cwd: f.root, env: f.env });
  const out = await runSessions({ cwd: f.root, env, storeEnv: f.env, consent: true, claude, caseList, runsOf: () => 1, workers: 1, parent });
  assert.equal(out.recorded, true);
  assert.equal(out.result.state, 'green');
  assert.ok(out.result.signature);
  assert.equal(listResults(store).length, 0, 'never among the headless results');
  assert.equal(listResults(store, SESSIONS).length, 1);
  const s = await sessionStatus({ cwd: f.root, env, claude });
  assert.equal(s.state, 'green');
  writeFileSync(join(f.root, '.mcp.json'), '{}');
  assert.equal((await sessionStatus({ cwd: f.root, env, claude })).state, 'green', 'your work tree isn\'t what was tested');
  f.git('add', '-A');
  f.git('commit', '-qm', 'rules');
  const later = await sessionStatus({ cwd: f.root, env, claude });
  assert.equal(later.state, 'stale');
  assert.ok(later.changed.includes('rules'));
  assert.match(sessionReport(out.result), /your sessions: GREEN/);
});
