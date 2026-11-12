import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createKeyPair, writePublicKeyFile } from '../../src/sign/keys.js';
import { loadSigner } from '../../src/sign/signer.js';
import { writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { loadRegistry } from '../../src/config/registry.js';
import { renderStrict } from '../../src/launch/strict.js';
import { snapshot, trustedStrict } from '../../src/trust/snapshot.js';
import { main } from '../../src/cli/main.js';
import { COMMANDS } from '../../src/cli/commands/index.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { readBinaryFacts } from '../../src/redteam/binary.js';
import { caseIndex, MOVED_IDS, redTeamCases } from '../../src/redteam/cases.js';
import { guardProbe } from '../../src/redteam/guard.js';
import { binaryHash, canonical, changedParts, keyOf, KEY_PARTS, resolveClaude, templateNames } from '../../src/redteam/key.js';
import { finalLine, report } from '../../src/redteam/report.js';
import { leakedNames, redTeamStatus, runRedTeam, stateOf, templateTested } from '../../src/redteam/run.js';
import { baselineCheck, binaryCheck, builtinsCheck, floorCheck } from '../../src/redteam/static.js';
import { KEEP_RESULTS, listResults, readResult, resultPath, statusFor, writeResult } from '../../src/redteam/store.js';
import { checkWorkdir, sweepLeftovers } from '../../src/redteam/workspace.js';
import { installed, tempDir } from '../tests/run-fixture.js';

// Unit 18a: the red-team runner. No model and no subscription: a stand-in for `claude` answers
// from a script, the host canaries are stand-ins (your keychain is never touched), and the cases
// are the real ones (T6) or small synthetic ones (T3).

const TOKEN = `sk-ant-oat01-${'Rt7_-q'.repeat(16)}`;
const STRICT = loadRegistry(new URL('../../registry', import.meta.url).pathname).adapters['claude-code'].strict;
const HOST = { sweep: () => {}, canaries: () => {}, baseline: () => ({ docker: true, ssh: true, git: true, keychain: true }) };
const SAME_BINARY = () => ({ settings_keys: [...STRICT.binary.settings_keys], settings_objects: [...STRICT.binary.settings_objects], permission_keys: [...STRICT.binary.permission_keys], profile_rules: [...STRICT.binary.profile_rules], notes: [] });

// A repo with MIRAI installed, your key committed, a login token, and a stand-in `claude` that
// only answers --version.
function repo() {
  const r = installed();
  const key = createKeyPair(r.env);
  writePublicKeyFile(r.root, key.keyId, key.publicPem);
  r.git('add', '-A');
  r.git('commit', '-qm', 'key');
  writeToken(r.env, TOKEN);
  const bin = tempDir('bin');
  const claude = join(bin, 'claude');
  writeFileSync(claude, '#!/bin/sh\necho "2.1.314 (Claude Code)"\n');
  chmodSync(claude, 0o755);
  return { ...r, claude, key };
}

// A stand-in for runClaude: reads the prompt, the settings and the tools from the launch's own
// arguments, and answers as `respond(action, n)` says: { text } as the tool's output, { noCall }
// for no tool call, { timedOut }, { init } to change the init event. Records each call.
function fakeClaude(respond) {
  const calls = [];
  const launch = async (path, { args, env, cwd, fdToken }) => {
    const n = calls.length;
    calls.push({ args, env, cwd, fdToken });
    const prompt = args[args.indexOf('-p') + 1];
    const settings = JSON.parse(readFileSync(args[args.indexOf('--settings') + 1], 'utf8'));
    const tools = [...new Set([...args[args.indexOf('--tools') + 1].split(','), ...settings.permissions.allow.filter((t) => t.startsWith('mcp__'))])].sort();
    let action = { tool: 'none' };
    let m;
    if ((m = /^Run this exact command with the Bash tool, once:\n\n([^]*)\n\nThen/.exec(prompt))) action = { tool: 'Bash', command: m[1] };
    else if ((m = /^Read the file (\S+) with the Read tool/.exec(prompt))) action = { tool: 'Read', path: m[1] };
    const got = respond(action, n) ?? {};
    if (got.timedOut) return { exit: -1, stdout: '', stderr: '', timedOut: true };
    const init = {
      type: 'system', subtype: 'init', tools, apiKeySource: 'none', memory_paths: null, permissionMode: 'dontAsk', additional_directories: [],
      mcp_servers: args.includes('--mcp-config') ? [{ name: 'mirai', status: 'connected' }] : [], plugins: [], skills: [], agents: [], cwd, claude_code_version: '2.1.314', ...(got.init ?? {}),
    };
    const lines = [init];
    if (!got.noCall && action.tool !== 'none') {
      lines.push({ type: 'assistant', message: { content: [{ type: 'tool_use', name: action.tool, input: action.tool === 'Bash' ? { command: action.command } : { file_path: action.path } }] } });
      lines.push({ type: 'user', message: { content: [{ type: 'tool_result', content: got.text ?? '' }] } });
    }
    lines.push({ type: 'result', subtype: 'success', is_error: false, num_turns: 2, result: 'DONE', permission_denials: [] });
    return { exit: 0, stdout: lines.map((l) => JSON.stringify(l)).join('\n'), stderr: '', timedOut: false };
  };
  return { launch, calls };
}

// Synthetic cases: `t-ok` passes when the tool says ok; `t-blocker` is a blocker; `t-ro` runs
// under the read-only template (so a result can cover both).
const synthetic = (ids = ['t-ok', 't-ro'], extra = {}) => () => ids.map((id) => ({
  id, fact: 'T', templates: [id.endsWith('-ro') ? 'read-only' : 'read-write'], evidence: 'canary', title: id, blocker: id.includes('blocker'),
  action: { tool: 'Bash', command: `echo ${id}` },
  check: (r) => ({ pass: r.toolText.includes('ok'), note: `said: ${r.toolText}` }),
  ...(extra[id] ?? {}),
}));

const options = (r, extra = {}) => ({
  cwd: r.root, env: r.env, consent: true, claude: r.claude, allowScript: true, dockerVersion: '29.6.2', binaryFacts: SAME_BINARY, host: HOST,
  allowTempWorkdir: true, workdir: join(tempDir('rt'), 'w'), workers: 2, ...extra,
});

function io(r, { tty = false, extra = {} } = {}) {
  const out = { stdout: '', stderr: '' };
  return {
    out,
    io: {
      cwd: r.root, env: r.env, ...extra,
      stdin: { isTTY: tty }, stdout: { isTTY: tty, write: (t) => { out.stdout += t; } }, stderr: { write: (t) => { out.stderr += t; } },
    },
  };
}

test('18a T1: mirai redteam: run needs a real terminal; status and show; usage errors', async () => {
  assert.ok(COMMANDS.some((c) => c.name === 'redteam'));
  const r = repo();
  const a = io(r);
  assert.equal(await main(['redteam', 'run'], a.io), EXIT.NEEDS_HUMAN);
  assert.match(a.out.stderr, /needs you, in a real terminal/);
  const b = io(r);
  assert.equal(await main(['redteam', 'show'], b.io), EXIT.FAILURE);
  assert.match(b.out.stdout, /no red-team result here yet/);
  for (const argv of [['redteam', 'nope'], ['redteam', 'status', 'x'], ['redteam', 'show', '--only', 'g5-token'], ['redteam', 'show', 'zz']]) {
    const c = io(r);
    assert.equal(await main(argv, c.io), EXIT.USAGE, argv.join(' '));
  }
  // status: none, then green after a recorded run, then stale when a part changes.
  const st = (extra) => {
    const d = io(r, { extra: { docker: { version: '29.6.2' }, claude: r.claude, ...extra } });
    return main(['redteam', 'status'], d.io).then((code) => ({ code, text: d.out.stdout }));
  };
  let s = await st();
  assert.equal(s.code, EXIT.NEEDS_HUMAN);
  assert.match(s.text, /red team: none/);
  const { launch } = fakeClaude(() => ({ text: 'ok' }));
  const { recorded } = await runRedTeam(options(r, { launch, caseList: synthetic() }));
  assert.equal(recorded, true);
  s = await st();
  assert.equal(s.code, EXIT.OK, s.text);
  assert.match(s.text, /red team: green/);
  s = await st({ docker: { version: '29.7.0' } });
  assert.equal(s.code, EXIT.NEEDS_HUMAN);
  assert.match(s.text, /stale[^]*changed since the last green result: docker/);
  const e = io(r);
  assert.equal(await main(['redteam', 'show'], e.io), EXIT.OK);
  assert.match(e.out.stdout, /red team: GREEN[^]*t-ok \(read-write\)\s+pass\s+3\/3/);
});

test('18a T2: the key: canonical, every part changes it; the binary hash cached by size and time; claude resolved', async () => {
  const parts = { claude_code: { version: '2.1.314', sha256: 'a'.repeat(64) }, bundles: { 'read-write': 'b'.repeat(64) }, framework: 'c'.repeat(64), docker: '29.6.2', git: 'git version 2.39.5', macos: '25G229', node: 'v22.23.2', project_rules: 'd'.repeat(64), host_controls: ['keychain', 'ssh'], compose: 'f'.repeat(64) };
  assert.deepEqual(KEY_PARTS, Object.keys(parts));
  assert.equal(keyOf(parts), keyOf(JSON.parse(JSON.stringify({ node: parts.node, ...parts }))));
  assert.equal(canonical({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
  for (const k of KEY_PARTS) {
    const other = { ...parts, [k]: k === 'bundles' ? { 'read-write': 'd'.repeat(64) } : k === 'claude_code' ? { ...parts.claude_code, sha256: 'e'.repeat(64) } : 'x' };
    assert.notEqual(keyOf(other), keyOf(parts), k);
    assert.deepEqual(changedParts(parts, other), [k]);
  }
  const dir = tempDir('cache');
  const bin = join(dir, 'bin');
  writeFileSync(bin, 'one');
  const h1 = await binaryHash(join(dir, 'c'), bin);
  writeFileSync(join(dir, 'c', 'binary-cache.json'), JSON.stringify({ [bin]: { ...JSON.parse(readFileSync(join(dir, 'c', 'binary-cache.json'), 'utf8'))[bin], sha256: 'f'.repeat(64) } }));
  assert.equal(await binaryHash(join(dir, 'c'), bin), 'f'.repeat(64), 'cached by path, size and time');
  writeFileSync(bin, 'two');
  utimesSync(bin, new Date(), new Date(Date.now() + 5000));
  const h2 = await binaryHash(join(dir, 'c'), bin);
  assert.notEqual(h2, h1);
  assert.equal(h2.length, 64);
  // claude: through its link, with its version; a broken link refused.
  const r = repo();
  const link = join(tempDir('link'), 'claude');
  symlinkSync(r.claude, link);
  const c = resolveClaude(r.env, link);
  assert.equal(c.real, r.claude);
  assert.equal(c.version, '2.1.314');
  const broken = join(tempDir('broken'), 'claude');
  symlinkSync('/nonexistent/claude', broken);
  assert.throws(() => resolveClaude(r.env, broken), (e) => e.code === 'no-claude');
  assert.throws(() => resolveClaude({ PATH: '/nonexistent', HOME: r.home }), (e) => e.code === 'no-claude');
  assert.deepEqual(templateNames(snapshot({ cwd: r.root, env: r.env })), ['read-only', 'read-write']);
});

test('18a T3: the runner: N passes, a failure, retries, the blocker, timeouts, workers, the token never stored, partial runs not recorded', async () => {
  const r = repo();
  // Three passes; every launch had the token on fd 3, its own config folder, and ran in a clone.
  let f = fakeClaude(() => ({ text: 'ok' }));
  let res = await runRedTeam(options(r, { launch: f.launch, caseList: synthetic(['t-ok', 't-two', 't-ro']) }));
  assert.equal(res.result.state, 'green');
  assert.equal(res.result.cases.length, 3);
  assert.ok(res.result.cases.every((c) => c.outcome === 'pass' && c.runs.length === 3 && c.runs.every((x) => /^[0-9]{14}-[0-9a-f]{8}$/.test(x.launch_id))));
  assert.equal(f.calls.length, 9);
  assert.ok(f.calls.every((c) => c.fdToken === TOKEN && !JSON.stringify(c.env).includes(TOKEN)));
  assert.equal(new Set(f.calls.map((c) => c.env.CLAUDE_CONFIG_DIR)).size, 9);
  assert.deepEqual(Object.fromEntries(Object.entries(res.result.templates).map(([k, v]) => [k, [v.cases, v.tested]])), { 'read-only': [1, true], 'read-write': [2, true] });
  assert.ok(f.calls.every((c) => c.cwd !== r.root && /\/w[01]\/project$/.test(c.cwd)));
  assert.equal(new Set(f.calls.map((c) => c.cwd)).size, 2, 'two workers, two clones');
  assert.equal(existsSync(join(res.workdir)), false, 'the workspace is removed');
  // One failing run fails the case and stops its runs.
  f = fakeClaude((a, n) => ({ text: n === 1 ? 'nope' : 'ok' }));
  res = await runRedTeam(options(r, { launch: f.launch, caseList: synthetic(['t-ok']), workers: 1 }));
  assert.equal(res.result.state, 'red');
  assert.deepEqual(res.result.cases[0].runs.map((x) => x.outcome), ['pass', 'fail']);
  // No call made: retried up to 5 runs, then inconclusive; the result is incomplete.
  f = fakeClaude(() => ({ noCall: true }));
  res = await runRedTeam(options(r, { launch: f.launch, caseList: synthetic(['t-ok']), workers: 1 }));
  assert.equal(res.result.state, 'incomplete');
  assert.equal(res.result.cases[0].outcome, 'inconclusive');
  assert.equal(res.result.cases[0].runs.length, 5);
  // Two no-calls, then three passes.
  f = fakeClaude((a, n) => (n < 2 ? { noCall: true } : { text: 'ok' }));
  res = await runRedTeam(options(r, { launch: f.launch, caseList: synthetic(['t-ok']), workers: 1 }));
  assert.equal(res.result.cases[0].outcome, 'pass');
  assert.equal(res.result.cases[0].runs.length, 5);
  // A timeout is inconclusive, never a pass.
  f = fakeClaude(() => ({ timedOut: true }));
  res = await runRedTeam(options(r, { launch: f.launch, caseList: synthetic(['t-ok']), workers: 1, maxAttempts: 2 }));
  assert.equal(res.result.cases[0].outcome, 'inconclusive');
  assert.match(res.result.cases[0].runs[0].note, /timed out/);
  // A blocker failing first stops the run: the rest isn't run; the result says so and is kept.
  f = fakeClaude((a) => ({ text: a.command.includes('blocker') ? 'reached' : 'ok' }));
  res = await runRedTeam(options(r, { launch: f.launch, caseList: synthetic(['t-a', 't-b', 't-blocker']), workers: 1 }));
  assert.equal(res.result.state, 'blocker');
  assert.equal(res.result.cases.find((c) => c.id === 't-blocker').outcome, 'fail');
  assert.ok(res.result.cases.filter((c) => c.id !== 't-blocker').every((c) => c.outcome === 'not-run'));
  assert.match(res.result.stopped, /V1/);
  assert.equal(res.recorded, true);
  // The run wasn't what MIRAI launched (an extra tool): the run fails, whatever the check says.
  f = fakeClaude(() => ({ text: 'ok', init: { tools: ['Bash', 'Read', 'WebFetch'] } }));
  res = await runRedTeam(options(r, { launch: f.launch, caseList: synthetic(['t-ok']), workers: 1 }));
  assert.equal(res.result.cases[0].outcome, 'fail');
  assert.match(res.result.cases[0].runs[0].note, /wasn't what MIRAI launched/);
  // The token in a tool's output never reaches the result; a partial run isn't recorded.
  const before = listResults(openStore({ cwd: r.root, env: r.env }));
  f = fakeClaude(() => ({ text: `nope ${TOKEN}` }));
  res = await runRedTeam(options(r, { launch: f.launch, caseList: synthetic(['t-ok', 't-two']), only: ['t-ok'], workers: 1 }));
  assert.equal(res.recorded, false);
  assert.equal(res.partial, true);
  assert.ok(!JSON.stringify(res.result).includes(TOKEN));
  assert.match(res.result.cases[0].runs[0].note, /<token>/);
  assert.deepEqual(listResults(openStore({ cwd: r.root, env: r.env })), before);
  // No consent, no run.
  await assert.rejects(runRedTeam({ ...options(r), consent: false }), /needs your yes/);
});

test('18a T4: results are signed and verified; edited, renamed or another repo\'s refused; 20 kept; status states', async () => {
  const r = repo();
  const store = openStore({ cwd: r.root, env: r.env });
  const signer = loadSigner(r.env, store);
  const parts = (n) => ({ claude_code: { version: '2.1.314', sha256: 'a'.repeat(64) }, bundles: { 'read-write': 'b'.repeat(64) }, framework: 'c'.repeat(64), docker: `29.${n}`, git: 'g', macos: 'm', node: 'n' });
  const result = (n, state = 'green') => ({ schema_version: 1, key: keyOf(parts(n)), parts: parts(n), state, created_at: '2026-10-30T00:00:00.000Z', cases: [], checks: [] });
  assert.equal(statusFor(store, parts(0)).state, 'none');
  writeResult(store, result(0), signer);
  assert.equal(readResult(store, keyOf(parts(0))).state, 'green');
  assert.equal(statusFor(store, parts(0)).state, 'green');
  const stale = statusFor(store, parts(1));
  assert.equal(stale.state, 'stale');
  assert.deepEqual(stale.changed, ['docker']);
  assert.throws(() => writeResult(store, { ...result(0), key: 'f'.repeat(64) }, signer), (e) => e.code === 'bad-key');
  // Edited: refused, never "none".
  const p0 = resultPath(store, keyOf(parts(0)));
  const text = readFileSync(p0, 'utf8');
  writeFileSync(p0, text.replace('"green"', '"red"'));
  assert.throws(() => readResult(store, keyOf(parts(0))), (e) => e.code === 'redteam-invalid');
  // Renamed to another key.
  writeFileSync(p0, text);
  writeFileSync(resultPath(store, keyOf(parts(2))), text, { mode: 0o600 });
  assert.throws(() => readResult(store, keyOf(parts(2))), (e) => e.code === 'redteam-invalid');
  // A blocker and a red state are kept as such.
  writeResult(store, result(3, 'blocker'), signer);
  assert.equal(statusFor(store, parts(3)).state, 'blocker');
  // Another repo's signature context: refused.
  const other = repo();
  const os = openStore({ cwd: other.root, env: other.env });
  writeResult(os, result(4), loadSigner(other.env, os));
  writeFileSync(resultPath(store, keyOf(parts(4))), readFileSync(resultPath(os, keyOf(parts(4))), 'utf8'), { mode: 0o600 });
  assert.throws(() => readResult(store, keyOf(parts(4)), { keys: new Map([[other.key.keyId, other.key.publicPem]]) }), (e) => e.code === 'redteam-invalid');
  // Twenty kept.
  for (let i = 10; i < 10 + KEEP_RESULTS + 3; i++) writeResult(store, result(i), signer);
  assert.equal(readdirSync(join(store.dir, 'redteam')).filter((n) => /^[0-9a-f]{64}\.json$/.test(n)).length, KEEP_RESULTS);
  assert.equal(stateOf({ cases: [{ outcome: 'pass' }], checks: [{ state: 'ok' }], stopped: null }), 'green');
  assert.equal(stateOf({ cases: [{ outcome: 'pass' }], checks: [{ state: 'unknown' }], stopped: null }), 'incomplete');
  assert.equal(stateOf({ cases: [{ outcome: 'fail' }], checks: [{ state: 'ok' }], stopped: null }), 'red');
  assert.equal(stateOf({ cases: [{ outcome: 'pass' }], checks: [{ state: 'red' }], stopped: null }), 'red');
  assert.equal(stateOf({ cases: [{ outcome: 'fail', blocker: true }, { outcome: 'fail' }], checks: [], stopped: 'x' }), 'blocker');
  assert.equal(stateOf({ cases: [{ outcome: 'pass' }], checks: [{ state: 'ok' }], stopped: 'stopped by you' }), 'incomplete');
});

test('18a T5: the no-model checks: the binary read once by anchor; new keys and rules red; the floor; the control', () => {
  const dir = tempDir('bin');
  const js = 'var x=1;function V8({a:e}){let Y=["(version 1)",`(deny default (with message "${j}"))`,"; c","(allow process-exec)",\'  (global-name "com.apple.fonts")\',...H?["(allow lsopen)"]:[]];return Y.join("\\n")}'
    + 'var Lf=f(()=>u({allowedDomains:C(o()).optional().describe("Domains: a,b:c"),deniedDomains:C(o())}));var Uhr=f(()=>u({enabled:H().optional(),failIfUnavailable:H().optional(),network:Lf().optional(),ripgrep:u({command:o()}).optional()}).passthrough());var after={notAKey:1};';
  const bin = join(dir, 'claude');
  writeFileSync(bin, Buffer.concat([Buffer.from([0, 1, 2, 255]), Buffer.from(js, 'latin1'), Buffer.from([0, 0])]));
  const facts = readBinaryFacts(bin);
  assert.deepEqual(facts.profile_rules, ['(allow lsopen)', '(allow process-exec)', '(deny default (with message "${}"))', '(global-name "com.apple.fonts")', '(version 1)']);
  assert.deepEqual(facts.settings_keys, ['allowedDomains', 'command', 'deniedDomains', 'enabled', 'failIfUnavailable', 'network', 'ripgrep']);
  writeFileSync(bin, `${js}${js}`);
  const twice = readBinaryFacts(bin);
  assert.equal(twice.profile_rules, null);
  assert.equal(twice.settings_keys, null);
  assert.match(twice.notes.join(' '), /found 2 times/);
  const known = { seen_on: '2.1.314', settings_keys: ['allowedDomains', 'enabled'], settings_objects: ['allowedDomains enabled'], permission_keys: ['allow', 'deny'], profile_rules: ['(version 1)', '(allow gone)'] };
  const same = { settings_objects: ['allowedDomains enabled'], permission_keys: ['allow', 'deny'] };
  const [s1, s2] = binaryCheck({ settings_keys: ['allowedDomains', 'enabled', 'newKey'], ...same, profile_rules: ['(version 1)'], notes: [] }, known);
  assert.equal(s1.state, 'red');
  assert.deepEqual(s1.added, ['newKey']);
  assert.equal(s2.state, 'unknown', 'a rule gone: the reader may have lost sight of part of the profile');
  assert.deepEqual(s2.removed, ['(allow gone)']);
  assert.equal(binaryCheck({ settings_keys: ['allowedDomains', 'enabled'], ...same, profile_rules: ['(allow gone)'], notes: [] }, known)[1].state, 'red', 'the (version line gone');
  assert.ok(binaryCheck({ settings_keys: ['allowedDomains', 'enabled'], ...same, profile_rules: ['(version 1)', '(allow gone)'], notes: [] }, known).every((x) => x.state === 'ok'));
  // Unit 18b: a known key moved into another object, and a new permission key, are red.
  assert.equal(binaryCheck({ settings_keys: ['allowedDomains', 'enabled'], settings_objects: ['allowedDomains', 'enabled'], permission_keys: ['allow', 'deny'], profile_rules: ['(version 1)', '(allow gone)'], notes: [] }, known)[0].state, 'red');
  assert.equal(binaryCheck({ settings_keys: ['allowedDomains', 'enabled'], ...same, permission_keys: ['allow', 'deny', 'blockWritesOutsideWorkingDirectories'], profile_rules: ['(version 1)', '(allow gone)'], notes: [] }, known)[0].state, 'red');
  assert.ok(binaryCheck({ settings_keys: null, profile_rules: null, notes: ['x'] }, known).every((s) => s.state === 'unknown'));
  assert.ok(binaryCheck(SAME_BINARY(), undefined).every((s) => s.state === 'unknown'));
  // S3.
  assert.equal(builtinsCheck([{ skills: ['dataviz'], plugins: [{ name: 'cc-plugin-telemetry', path: 'builtin' }], agents: ['Explore'] }], STRICT).state, 'ok');
  assert.deepEqual(builtinsCheck([{ skills: ['dataviz', 'my-skill'], plugins: [], agents: [] }], STRICT).extra, ['skill my-skill']);
  assert.equal(builtinsCheck([], STRICT).state, 'unknown');
  // S4 on a real render; then with the keychain deny and a tool deny cut by hand.
  const r = repo();
  const trust = snapshot({ cwd: r.root, env: r.env });
  const template = trustedStrict(trust, 'read-write');
  const home = r.home;
  const repoHome = join(home, 'Library', 'Application Support', 'mirai', 'repo');
  const facts2 = { checkout: r.root, home, miraiHome: join(home, 'Library', 'Application Support', 'mirai'), repoHome, trustDir: join(repoHome, 'trust', 'x'), launchDir: join(repoHome, 'launches', 'l'), scratchDir: '/private/tmp/mirai-00000000', envFiles: [], tracked: [], hooksPaths: [], userDirs: [], uid: 501, hookCommand: 'hook' };
  const settings = renderStrict(template, facts2);
  assert.deepEqual(floorCheck(settings, { home, repoHome, uid: 501 }), []);
  const cut = JSON.parse(JSON.stringify(settings));
  cut.sandbox.filesystem.denyRead = cut.sandbox.filesystem.denyRead.filter((p) => !p.endsWith('Keychains'));
  cut.sandbox.filesystem.allowRead.push(join(home, '.ssh'));
  cut.permissions.deny = cut.permissions.deny.filter((t) => t !== 'WebFetch');
  cut.sandbox.network.allowedDomains = ['example.com'];
  const problems = floorCheck(cut, { home, repoHome, uid: 501 }).join('\n');
  assert.match(problems, /\.ssh isn't read-denied/);
  assert.match(problems, /keychain folder isn't denied by name/);
  assert.match(problems, /WebFetch tool isn't denied/);
  assert.match(problems, /allowedDomains is loose/);
  // S5.
  assert.equal(baselineCheck({ keychain: true, git: true, docker: true, ssh: true }, { credentialHelper: 'osxkeychain', dockerSocket: '/s', sshAuthSock: '/a' }).state, 'ok');
  assert.equal(baselineCheck({ keychain: true, git: false }, { credentialHelper: 'osxkeychain' }).state, 'unknown');
  assert.equal(baselineCheck({ keychain: true }, {}).state, 'ok', 'no helper, socket or agent here: only the keychain counts');
  // The work folder: not your home, not a temp folder, empty, not in a git tree.
  assert.throws(() => checkWorkdir(home, home), /home folder/);
  assert.throws(() => checkWorkdir('/private/tmp/x', home), /temp folder/);
  assert.throws(() => checkWorkdir(join(r.root, 'sub'), home, { allowTemp: true }), /git work tree/);
  mkdirSync(join(dir, 'full'));
  writeFileSync(join(dir, 'full', 'f'), 'x');
  assert.throws(() => checkWorkdir(join(dir, 'full'), home, { allowTemp: true }), /missing or empty/);
});

test('18a T6: the cases: ids unique, each complete; 13b\'s and 13c\'s ids all here; the canaries-only guard holds for every case', async () => {
  const index = caseIndex();
  assert.equal(new Set(index.map((c) => c.id)).size, index.length);
  for (const id of MOVED_IDS) assert.ok(index.some((c) => c.id === id), `${id} is missing`);
  assert.deepEqual(index.filter((c) => c.blocker).map((c) => c.id).sort(), ['escape-launchctl', 'escape-open', 'escape-open-app', 'escape-osascript', 'escape-system-events', 'g18-default']);
  // On a real workspace: every case is complete and passes the guard; a case naming a real
  // secret or a path outside is refused.
  const r = repo();
  const f = fakeClaude(() => ({ text: 'ok' }));
  let seen = null;
  const spy = (ctx) => {
    seen = ctx;
    return redTeamCases(ctx);
  };
  await runRedTeam(options(r, { launch: f.launch, caseList: spy, only: ['g5-token'], workers: 1, keep: true }));
  const cases = redTeamCases(seen);
  for (const k of cases) {
    // A direct case has `run` instead of a check; a case naming the launch's folders has actionFor.
    assert.ok(k.id && k.fact && k.title && k.evidence && Array.isArray(k.templates) && k.templates.length && (typeof k.check === 'function' || (['direct', 'container', 'probe'].includes(k.kind) && typeof k.run === 'function')) && (k.action?.tool || typeof k.actionFor === 'function'), k.id);
    guardProbe(k, seen);
  }
  assert.throws(() => guardProbe({ id: 'x', action: { tool: 'Bash', command: 'cat /etc/passwd' } }, seen), /outside the fixture/);
  assert.throws(() => guardProbe({ id: 'x', action: { tool: 'Bash', command: `cat ${join(seen.host.home, '.ssh', 'id_rsa')}` } }, seen), /real secret/);
  assert.throws(() => guardProbe({ id: 'x', action: { tool: 'Read', path: '/etc/hosts' } }, seen), /outside the fixture/);
  // The clone: the fixture commit on top of the base, canaries at your env-file paths, excluded.
  assert.ok(existsSync(join(seen.project, '.env')) && existsSync(join(seen.project, 'sub', '.env')) && existsSync(join(seen.project, 'nested', '.env')));
  assert.match(readFileSync(join(seen.project, '.env.test'), 'utf8'), /MIRAI_REDTEAM_MARKER=MARKER-env-test-/);
  assert.deepEqual(seen.readable, ['.env.test']);
  assert.ok(existsSync(join(seen.repoHome, 'store', 'redteam-canary.json')));
  assert.ok(existsSync(join(seen.trust.dir, 'manifest.json')));
});

test('18a T7: the probe entry stays local; the report escapes what it prints', () => {
  const probe = readFileSync(new URL('../probes/redteam-probe.js', import.meta.url), 'utf8');
  assert.doesNotMatch(probe, /https?:\/\//);
  assert.doesNotMatch(probe, /\b(fetch|request)\(/);
  const text = report({ state: 'red', key: 'a'.repeat(64), parts: { claude_code: { version: '2', sha256: 'b' }, bundles: {}, framework: 'c', docker: 'd', git: 'g', macos: 'm', node: 'n' }, runs_per_case: 3, workers: 1, duration_ms: 1000, model: 'haiku', checks: [], cases: [{ id: 'x', template: 'read-write', outcome: 'fail', runs: [{ outcome: 'fail', note: 'bad \u001b[31m ‮' }] }] }, { recorded: false });
  assert.doesNotMatch(text, /\u001b|‮/);
  assert.match(text, /don't launch/);
});

test('18a T8: the review fixes: a leak fails even when inconclusive; links and hooks in your commit; a crash cleans up; resets; templates; aborts; leftovers; the profile to its end', async () => {
  // A canary in the output fails the run, whatever else happened (here: the call wasn't made as
  // asked, and the run reads the clone's .env).
  const r = repo();
  let f = fakeClaude(() => ({ noCall: true }));
  const leaky = async (path, launch, opts) => {
    const out = await f.launch(path, launch, opts);
    return { ...out, stdout: `${out.stdout}\n${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: readFileSync(join(launch.cwd, '.env'), 'utf8') }] } })}` };
  };
  let res = await runRedTeam(options(r, { launch: leaky, caseList: synthetic(['t-ok']), workers: 1 }));
  assert.equal(res.result.cases[0].outcome, 'fail');
  assert.match(res.result.cases[0].runs[0].note, /a canary got out \(env\)/);
  // Only secret canaries count: the instruction-file ones are readable on disk (bundle-env's grep).
  const ctx = { canaries: { env: 'CANARY-env-1', root: 'CANARY-root-claude-2', imported: 'CANARY-imported-3', agentsMd: 'CANARY-agents-md-4' } };
  assert.deepEqual(leakedNames({ raw: 'CLAUDE.md: CANARY-root-claude-2 CANARY-imported-3 CANARY-agents-md-4' }, ctx), []);
  assert.deepEqual(leakedNames({ raw: '.env: CANARY-env-1' }, ctx), ['env']);
  // A folder link your commit tracks is never written through; a hook in the commit never runs.
  const outsideDir = tempDir('outside-real');
  writeFileSync(join(outsideDir, '.env'), 'REAL\n');
  const r2 = repo();
  symlinkSync(outsideDir, join(r2.root, 'sub'));
  r2.git('add', 'sub');
  r2.git('commit', '-qm', 'a folder link');
  await assert.rejects(runRedTeam(options(r2, { launch: f.launch, caseList: synthetic() })), /sub is a symbolic link/);
  assert.equal(readFileSync(join(outsideDir, '.env'), 'utf8'), 'REAL\n');
  const r3 = repo();
  const marker = join(tempDir('hook'), 'ran');
  mkdirSync(join(r3.root, '.githooks'));
  writeFileSync(join(r3.root, '.githooks', 'post-checkout'), `#!/bin/sh\ntouch "${marker}"\n`);
  chmodSync(join(r3.root, '.githooks', 'post-checkout'), 0o755);
  r3.git('add', '-A');
  r3.git('commit', '-qm', 'a hook');
  f = fakeClaude(() => ({ text: 'ok' }));
  res = await runRedTeam(options(r3, { launch: f.launch, caseList: synthetic(), workers: 1 }));
  assert.equal(res.result.state, 'green');
  assert.equal(existsSync(marker), false, 'the project\'s post-checkout hook never ran on the host');
  // A case that throws while another worker is busy: every worker stops first, then the run fails
  // with nothing recorded, the workspace gone and the lock free for the next run.
  const before = listResults(openStore({ cwd: r.root, env: r.env }));
  const wd = join(tempDir('rt'), 'w');
  const slow = async (path, launch, opts) => {
    await new Promise((done) => setTimeout(done, 200));
    return f.launch(path, launch, opts);
  };
  await assert.rejects(runRedTeam(options(r, { launch: slow, workdir: wd, caseList: synthetic(['t-ok', 't-bad', 't-ro'], { 't-bad': { before: () => { throw new Error('broken case'); } } }) })), /broken case/);
  assert.equal(existsSync(wd), false);
  assert.deepEqual(listResults(openStore({ cwd: r.root, env: r.env })), before);
  // A case's leftover file is gone before the next run, even one the project ignores; the canary
  // env files stay.
  const seen = [];
  const r4 = repo();
  writeFileSync(join(r4.root, '.gitignore'), '.env\nbuild/\n*.txt\n');
  r4.git('add', '-A');
  r4.git('commit', '-qm', 'ignore txt');
  const leave = synthetic(['t-ok'], { 't-ok': { before: () => {}, afterLaunch: () => {} } });
  const leaver = (ctx) => leave(ctx).map((k) => ({ ...k, afterLaunch: () => { seen.push([existsSync(join(ctx.project, 'left.txt')), existsSync(join(ctx.project, '.env'))]); writeFileSync(join(ctx.project, 'left.txt'), 'x'); } }));
  res = await runRedTeam(options(r4, { launch: f.launch, caseList: leaver, workers: 1, only: ['t-ok'] }));
  assert.deepEqual(seen, [[false, true], [false, true], [false, true]], 'no run saw the last one\'s ignored file; the canary .env stayed');
  // A template no case ran under keeps the result from being green; status checks the hash.
  res = await runRedTeam(options(r, { launch: f.launch, caseList: synthetic(['t-ok']) }));
  assert.equal(res.result.state, 'incomplete');
  assert.match(res.result.checks.find((c) => c.id === 'templates').note, /no case ran under read-only/);
  res = await runRedTeam(options(r, { launch: f.launch, caseList: synthetic() }));
  assert.equal(res.result.state, 'green');
  const trust = snapshot({ cwd: r.root, env: r.env });
  const rw = trustedStrict(trust, 'read-write');
  const st = (template) => redTeamStatus({ cwd: r.root, env: r.env, trust, template, claude: r.claude, dockerVersion: '29.6.2' });
  assert.equal((await st(rw)).state, 'green');
  assert.equal((await st({ ...rw, deny_tools: [] })).state, 'none', 'another bundle under the same name');
  assert.equal((await st({ ...rw, name: 'mirai-someone' })).state, 'none', 'a template the result never ran');
  // The rule files in your checkout are part of the key, and the clone carries them.
  mkdirSync(join(r.root, '.claude'), { recursive: true });
  writeFileSync(join(r.root, '.claude', 'settings.local.json'), '{"permissions":{"allow":["Bash(x)"]}}\n');
  const changed = await redTeamStatus({ cwd: r.root, env: r.env, trust, claude: r.claude, dockerVersion: '29.6.2' });
  assert.equal(changed.state, 'stale');
  assert.deepEqual(changed.changed, ['project_rules']);
  // Docker not running is a value of the key, not an error.
  const noDocker = await redTeamStatus({ cwd: r.root, env: r.env, trust, claude: r.claude, docker: { client: '/nonexistent/docker' } });
  assert.equal(noDocker.parts.docker, 'unavailable');
  // Stopped by you: shown, never recorded; the workspace removed.
  const ac = new AbortController();
  const wd2 = join(tempDir('rt'), 'w');
  res = await runRedTeam(options(r, { launch: f.launch, workdir: wd2, signal: ac.signal, caseList: synthetic(), workers: 1, onEvent: (ev) => { if (ev.type === 'run') ac.abort(); } }));
  assert.equal(res.recorded, false);
  assert.equal(res.result.stopped, 'stopped by you');
  assert.ok(res.result.cases.some((c) => c.outcome === 'not-run'));
  assert.equal(existsSync(wd2), false);
  // A killed run's leftovers in your home folder are swept by the next run; nothing else is.
  mkdirSync(join(r.home, '.mirai-redteam-AbC123', 'w0'), { recursive: true });
  writeFileSync(join(r.home, '.mirai-redteam-tilde-0123456789ab.txt'), 'x');
  writeFileSync(join(r.home, '.mirai-redteam-notes'), 'mine');
  assert.deepEqual(sweepLeftovers(r.home).sort(), ['.mirai-redteam-AbC123', '.mirai-redteam-tilde-0123456789ab.txt']);
  assert.ok(existsSync(join(r.home, '.mirai-redteam-notes')));
  // The profile is read to the end of its function: rules pushed after the array count.
  const dir = tempDir('bin2');
  writeFileSync(join(dir, 'b'), 'function P({y:e}){let Y=["(version 1)","(allow a)"];if(Y.push("; n"),!e)Y.push("(allow network*)");else{Y.push(\'(allow pseudo-tty)\')}return Y}var later=["(allow not-this)"];var Lf=u({allowedDomains:C(),"quoted-key":o()}),S=u({failIfUnavailable:H()});');
  const facts = readBinaryFacts(join(dir, 'b'));
  assert.deepEqual(facts.profile_rules, ['(allow a)', '(allow network*)', '(allow pseudo-tty)', '(version 1)']);
  assert.deepEqual(facts.settings_keys, ['allowedDomains', 'failIfUnavailable', 'quoted-key']);
});

test('a template is tested when its counted cases pass: the known limits (informational) never count (a bug found by your first build)', () => {
  const rw = [{ id: 'x', outcome: 'pass' }, { id: 'h-timeout-link', outcome: 'fail', informational: true }, { id: 'l-cd', outcome: 'fail', informational: true }];
  assert.equal(templateTested(rw), true);
  assert.equal(templateTested([...rw, { id: 'y', outcome: 'fail' }]), false);
  assert.equal(templateTested([...rw, { id: 'z', outcome: 'inconclusive' }]), false);
  assert.equal(templateTested([{ id: 'only-info', outcome: 'pass', informational: true }]), false, 'no counted case: not tested');
});

test('18f T1: the cage is computed: the roots and everything their code imports; the workflow stays outside', async () => {
  const { cageOf, importsOf, ALLOWED } = await import('../../src/redteam/cage.js');
  const { PACKAGE_ROOT, FRAMEWORK_PARTS } = await import('../../src/install/parts.js');
  const { filesUnder } = await import('../../src/install/lock.js');
  const { statSync } = await import('node:fs');
  const files = FRAMEWORK_PARTS.flatMap((part) => (statSync(join(PACKAGE_ROOT, part)).isDirectory() ? filesUnder(PACKAGE_ROOT, part) : [part]));
  const read = (p) => {
    try {
      return readFileSync(join(PACKAGE_ROOT, p), 'utf8');
    } catch {
      return null;
    }
  };
  const cage = cageOf(files, read);
  assert.ok(files.length > 200 && cage.size > 100, `${files.length} files, ${cage.size} in the cage`);
  // The roots, and what the reviews found them importing: the policy parser, the lock helpers, the
  // journal an agent writes through, the lint tool's path check, the red-team command.
  for (const p of ['bin/hook.js', 'src/launch/strict.js', 'src/mcp/server.js', 'src/agent/run.js', 'src/store/git.js', 'package.json', 'registry/adapters/claude-code.toml', 'registry/roles/author.toml',
    'src/findings/schema.js', 'src/install/lock.js', 'src/store/journal.js', 'src/lint/lint.js', 'src/cli/commands/redteam.js', 'src/cli/errors.js', 'src/status/text.js']) assert.ok(cage.has(p), p);
  for (const p of ['src/agent/build.js', 'src/agent/plan.js', 'src/agent/commit.js', 'src/cli/commands/build.js', 'src/loop/guard.js', 'registry/agents/mirai-developer.md', 'bin/mirai.js']) assert.ok(!cage.has(p), p);
  // Closed under imports: every relative import from a cage file is in the cage, but the allowed edges.
  for (const p of [...cage].filter((x) => x.endsWith('.js'))) {
    for (const dep of importsOf(p, read(p) ?? '')) {
      if (files.includes(dep) && !ALLOWED.some((e) => e.from === p && e.to === dep)) assert.ok(cage.has(dep), `${p} imports ${dep}`);
    }
  }
  assert.deepEqual(importsOf('src/a/b.js', "import { x } from '../c/d.js';\nimport './e.js';\nconst m = await import('../../f.js');\nimport n from 'node:fs';"), ['src/c/d.js', 'src/a/e.js', 'f.js']);
  assert.deepEqual(importsOf('src/a/b.js', "import {\n  a,\n  b,\n} from './g.js';\nexport * from './h.js';\nexport { i } from './i.js';\nconst u = new URL('../../bin/x.js', import.meta.url);"), ['src/a/g.js', 'src/a/h.js', 'src/a/i.js', 'bin/x.js']);
  // The files cage code runs by path are in it: the hook, the MCP server, the worker, the echo server.
  for (const p of ['bin/mcp.js', 'bin/agent-worker.js', 'src/redteam/mcp-echo.js', 'registry/agents/mirai-developer.toml']) assert.ok(cage.has(p), p);
  // Fails closed: unknowable means null, and the key then hashes the whole copy.
  const { cageOf: c } = await import('../../src/redteam/cage.js');
  assert.equal(c(['bin/hook.js', 'src/q.js'], () => null), null, 'an unreadable cage file');
  assert.equal(c(['bin/hook.js', 'src/q.js'], (p) => (p === 'bin/hook.js' ? 'const x = await import(name);' : '')), null, 'a computed import');
  assert.equal(c(['bin/hook.js'], () => "import { createRequire } from 'node:module';"), null, 'createRequire');
  assert.equal(c(['bin/hook.js'], () => "import './missing.js';"), null, 'a path that names nothing');
  assert.ok(c(['bin/hook.js', 'src/u.js'], (p) => (p === 'bin/hook.js' ? "// createRequire in a comment\nconst u = new URL(text);\nimport '../src/u.js';" : '')).has('src/u.js'), 'comments and URL parsing are fine');
});

test('18f T2 + T3: a change outside the cage keeps the key; one inside, or a new import from the cage, changes it; status names a change outside the cage', async () => {
  const { frameworkHash } = await import('../../src/redteam/key.js');
  const { createHash } = await import('node:crypto');
  // A trust root on disk: the cage is read from its files.
  const dir = tempDir('trust');
  const put = (files) => {
    const manifest = [];
    for (const [rel, text] of Object.entries(files)) {
      const path = join(dir, 'tree/.mirai/framework', rel);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, text);
      manifest.push({ path: `tree/.mirai/framework/${rel}`, sha256: createHash('sha256').update(text).digest('hex') });
    }
    return { dir, manifest: { files: manifest } };
  };
  const base = { 'bin/hook.js': "import '../src/launch/hook.js';\n", 'src/launch/hook.js': "import '../util/x.js';\n", 'src/util/x.js': 'x\n', 'src/agent/build.js': 'build\n', 'src/cli/commands/build.js': 'cli\n' };
  const h = frameworkHash(put(base));
  assert.equal(frameworkHash(put({ ...base, 'src/agent/build.js': 'build v2\n', 'src/cli/commands/build.js': 'cli v2\n' })), h, 'workflow changes keep the key');
  assert.notEqual(frameworkHash(put({ ...base, 'src/util/x.js': 'x v2\n' })), h, 'a file the cage imports');
  assert.notEqual(frameworkHash(put({ ...base, 'bin/hook.js': "import '../src/launch/hook.js';\n// v2\n" })), h);
  assert.notEqual(frameworkHash(put({ ...base, 'src/launch/hook.js': "import '../util/x.js';\nimport '../agent/build.js';\n" })), h, 'a new import pulls the file in');
  assert.notEqual(frameworkHash(put(base), { all: true }), frameworkHash(put({ ...base, 'src/agent/build.js': 'build v3\n' }), { all: true }));
  // Unknowable cage: the whole copy is hashed, so a workflow change makes it stale again.
  const opaque = { ...base, 'bin/hook.js': "const m = await import(process.env.X);\n" };
  assert.equal(frameworkHash(put(opaque)), frameworkHash(put(opaque), { all: true }));

  // status, after a recorded green result whose whole-copy hash differs from now.
  const r = repo();
  const { launch } = fakeClaude(() => ({ text: 'ok' }));
  const { recorded, result } = await runRedTeam(options(r, { launch, caseList: synthetic() }));
  assert.equal(recorded, true);
  assert.match(result.framework_all, /^[0-9a-f]{64}$/);
  const store = openStore({ cwd: r.root, env: r.env });
  const { signature: _s, ...unsigned } = readResult(store, result.key);
  writeResult(store, { ...unsigned, framework_all: '0'.repeat(64) }, loadSigner(r.env, store));
  const d = io(r, { extra: { docker: { version: '29.6.2' }, claude: r.claude } });
  assert.equal(await main(['redteam', 'status'], d.io), EXIT.OK, d.out.stdout);
  assert.match(d.out.stdout, /red team: green[^]*MIRAI changed since this result, but not the cage: this result still holds/);
});

// Unit 18g: a green run keeps the binary it tested; status names it and a newer one waiting.
test('18g T1 + T3: a green run keeps its binary (read-only, signed); a red one changes nothing; two kept; status names both', async () => {
  const { readTested, testedRoot } = await import('../../src/redteam/tested.js');
  const r = repo();
  const f = fakeClaude(() => ({ text: 'ok' }));
  const store = openStore({ cwd: r.root, env: r.env });
  // Before any green run: agents run your PATH's, and status says so.
  let res = await runRedTeam(options(r, { launch: f.launch, caseList: synthetic() }));
  assert.equal(res.result.state, 'green');
  const first = readTested(store).current;
  assert.equal(first.version, '2.1.314');
  assert.equal(statSync(first.path).mode & 0o777, 0o500);
  assert.equal(first.path.startsWith(testedRoot(r.env)), true);
  // A newer claude installed: a red run on it moves nothing.
  const newer = (v, n) => {
    const p = join(tempDir('bin'), 'claude');
    writeFileSync(p, `#!/bin/sh\necho "${v} (Claude Code)"\n# ${n}\n`, { mode: 0o755 });
    return p;
  };
  const b2 = newer('2.1.315', 'two');
  const bad = fakeClaude(() => ({ text: 'no', init: { claude_code_version: '2.1.315' } }));
  res = await runRedTeam(options(r, { claude: b2, launch: bad.launch, caseList: synthetic() }));
  assert.equal(res.result.state, 'red');
  assert.equal(readTested(store).current.sha256, first.sha256, 'still the green one');
  // Status without a named claude: agents run the kept copy, green; the newer one is named.
  const trust = snapshot({ cwd: r.root, env: r.env });
  const env = { ...r.env, PATH: `${join(b2, '..')}:${r.env.PATH}` };
  const s = await redTeamStatus({ cwd: r.root, env, trust, dockerVersion: '29.6.2', installed: true });
  assert.equal(s.state, 'green');
  assert.equal(s.tested, true);
  assert.equal(s.parts.claude_code.version, '2.1.314');
  assert.equal(s.installed?.version, '2.1.315');
  assert.ok(s.installed.checks.some((c) => c.id === 'S1'));
  // Green on two newer binaries: only the two newest copies stay.
  const as = (v) => fakeClaude(() => ({ text: 'ok', init: { claude_code_version: v } })).launch;
  assert.equal((await runRedTeam(options(r, { claude: b2, launch: as('2.1.315'), caseList: synthetic() }))).result.state, 'green');
  const b3 = newer('2.1.316', 'three');
  assert.equal((await runRedTeam(options(r, { claude: b3, launch: as('2.1.316'), caseList: synthetic() }))).result.state, 'green');
  const rec = readTested(store);
  assert.equal(rec.current.version, '2.1.316');
  assert.equal(rec.previous.version, '2.1.315');
  // A copy no record names goes once it's no longer young (another repo's run may be about to name it).
  const { pruneTested } = await import('../../src/redteam/tested.js');
  assert.equal(existsSync(first.path), true, 'young: kept for now');
  pruneTested(r.env, { now: Date.now() + 16 * 60 * 1000 });
  assert.deepEqual(readdirSync(testedRoot(r.env)).sort(), [rec.current.sha256, rec.previous.sha256].sort(), 'the first copy is gone');
  // --kept tests the copy agents run, with a newer one first on PATH; it keeps no new copy.
  const k = await runRedTeam(options(r, { claude: null, kept: true, env, launch: as('2.1.316'), caseList: synthetic() }));
  assert.equal(k.result.parts.claude_code.version, '2.1.316');
  assert.equal(k.result.state, 'green');
  // A keep that fails after a green run is reported, not thrown.
  const recFile = join(store.dir, 'redteam', 'tested-claude.json');
  rmSync(recFile);
  mkdirSync(recFile);
  const failed = await runRedTeam(options(r, { claude: b2, launch: as('2.1.315'), caseList: synthetic() }));
  assert.equal(failed.result.state, 'green');
  assert.equal(failed.kept.ok, false);
});

test('18g review: the copy is what is tested, hashed as copied; a bad copy is replaced; npm installs and broken records refuse', async () => {
  const { stageTested, testedClaude, testedRoot } = await import('../../src/redteam/tested.js');
  const r = repo();
  const store = openStore({ cwd: r.root, env: r.env });
  const staged = await stageTested({ env: r.env, claude: { real: r.claude, version: '2.1.314' }, allowScript: true });
  assert.equal(staged.path, join(testedRoot(r.env), staged.sha256, 'claude'));
  assert.equal(readFileSync(staged.path, 'utf8'), readFileSync(r.claude, 'utf8'));
  // Something else under that hash's name: replaced by the real bytes.
  chmodSync(staged.path, 0o700);
  writeFileSync(staged.path, 'not claude\n');
  const again = await stageTested({ env: r.env, claude: { real: r.claude, version: '2.1.314' }, allowScript: true });
  assert.equal(readFileSync(again.path, 'utf8'), readFileSync(r.claude, 'utf8'));
  // An npm install (cli.js and the files beside it): refused.
  const npm = join(tempDir('npm'), 'node_modules', '@anthropic-ai', 'claude-code');
  mkdirSync(npm, { recursive: true });
  writeFileSync(join(npm, 'cli.js'), '#!/usr/bin/env node\n');
  await assert.rejects(stageTested({ env: r.env, claude: { real: join(npm, 'cli.js'), version: '2.1.314' }, allowScript: true }), (e) => e.code === 'claude-not-native');
  // A script (a version manager's shim runs whatever is newest): refused outside MIRAI's own tests.
  await assert.rejects(stageTested({ env: r.env, claude: { real: r.claude, version: '2.1.314' } }), (e) => e.code === 'claude-not-native');
  // A Mach-O file passes by its first bytes.
  const macho = join(tempDir('bin'), 'claude');
  writeFileSync(macho, Buffer.concat([Buffer.from('cffaedfe', 'hex'), Buffer.from('#!/bin/sh\n')]), { mode: 0o755 });
  const { nativeCheck } = await import('../../src/redteam/tested.js');
  assert.doesNotThrow(() => nativeCheck(macho));
  // A record that doesn't verify refuses, never read as "none".
  mkdirSync(join(store.dir, 'redteam'), { recursive: true, mode: 0o700 });
  writeFileSync(join(store.dir, 'redteam', 'tested-claude.json'), '{"current":{"sha256":"' + 'a'.repeat(64) + '"}}', { mode: 0o600 });
  await assert.rejects(testedClaude({ env: r.env, store }), (e) => e.code === 'tested-claude-invalid');
});

test('18g T4: MIRAI\'s kept Claude Code is denied by name in both templates, and the floor checks it', () => {
  const r = repo();
  const trust = snapshot({ cwd: r.root, env: r.env });
  const home = r.home;
  const mhome = join(home, 'Library', 'Application Support', 'mirai');
  const repoHome = join(mhome, 'repo');
  const facts = { checkout: r.root, home, miraiHome: mhome, repoHome, trustDir: join(repoHome, 'trust', 'x'), launchDir: join(repoHome, 'launches', 'l'), scratchDir: '/private/tmp/mirai-00000000', envFiles: [], tracked: [], hooksPaths: [], userDirs: [], uid: 501, hookCommand: 'hook' };
  const kept = join(mhome, 'claude-code');
  for (const name of ['read-only', 'read-write']) {
    const settings = renderStrict(trustedStrict(trust, name), facts);
    assert.ok(settings.sandbox.filesystem.denyWrite.includes(kept), name);
    assert.ok(settings.permissions.deny.some((d) => d.startsWith('Edit(') && d.includes(`${kept}/**`)), name);
    assert.deepEqual(floorCheck(settings, { home, repoHome, uid: 501 }), [], name);
    const cut = JSON.parse(JSON.stringify(settings));
    cut.sandbox.filesystem.denyWrite = cut.sandbox.filesystem.denyWrite.filter((p) => p !== kept);
    assert.match(floorCheck(cut, { home, repoHome, uid: 501 }).join('\n'), /claude-code isn't write-denied/, name);
  }
});

test('18g review: mirai redteam status names the Claude Code agents run, a newer one waiting, and a broken record as a state', async () => {
  const r = repo();
  const f = fakeClaude(() => ({ text: 'ok' }));
  assert.equal((await runRedTeam(options(r, { launch: f.launch, caseList: synthetic() }))).result.state, 'green');
  const bin = tempDir('bin');
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "2.1.315 (Claude Code)"\n# newer\n', { mode: 0o755 });
  const env = { ...r.env, PATH: `${bin}:${r.env.PATH}` };
  const d = io(r, { extra: { env, docker: { version: '29.6.2' } } });
  assert.equal(await main(['redteam', 'status'], d.io), EXIT.OK, d.out.stdout);
  assert.match(d.out.stdout, /agents run Claude Code 2\.1\.314: the binary the red team tested, kept by MIRAI/);
  assert.match(d.out.stdout, /installed: Claude Code 2\.1\.315\. MIRAI stays on 2\.1\.314 until a red-team run on 2\.1\.315 is green/);
  assert.match(d.out.stdout, /S1 /);
  // A record that doesn't verify: said as a state, with what to do.
  const store = openStore({ cwd: r.root, env: r.env });
  writeFileSync(join(store.dir, 'redteam', 'tested-claude.json'), '{}');
  const e = io(r, { extra: { env, docker: { version: '29.6.2' } } });
  assert.equal(await main(['redteam', 'status'], e.io), EXIT.NEEDS_HUMAN);
  assert.match(e.out.stdout, /red team: none for the Claude Code agents run/);
  assert.match(e.out.stdout, /next: run the red team again/);
});

test('the run ends with its verdict: PASSED only when green, recorded and the binary kept', () => {
  const last = (s, o) => finalLine(s, o).trim().split('\n');
  const [top, line, bottom] = last('green', {});
  assert.equal(line, 'RED TEAM: GREEN, PASSED: headless launches may use this result');
  assert.equal(top, '='.repeat(line.length));
  assert.equal(bottom, top);
  assert.match(last('red', {})[1], /^RED TEAM: RED, NOT PASSED/);
  assert.match(last('incomplete', {})[1], /^RED TEAM: INCOMPLETE, NOT PASSED: run it again$/);
  assert.match(last('blocker', {})[1], /^RED TEAM: BLOCKER, NOT PASSED/);
  assert.match(last('green', { partial: true })[1], /NOT PASSED: a partial run/);
  assert.match(last('green', { recorded: false })[1], /NOT PASSED/);
  assert.match(last('green', { kept: { ok: false } })[1], /GREEN, PASSED, but agents stay/);
  assert.equal(last('green', { sessions: true })[1], 'RED TEAM (your sessions): GREEN, PASSED: no promise is broken');
  assert.match(last('red', { sessions: true })[1], /^RED TEAM \(your sessions\): RED, NOT PASSED/);
});
