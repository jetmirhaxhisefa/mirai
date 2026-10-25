import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { containsToken, madeTheCall, redact, runProbes } from './claude-probes.js';
import { buildFixture, checkWorkdir, removeFixture } from './fixture.js';
import { g18Check, guardProbe, probeList, strict } from './probes.js';
import { tmp } from '../store/helpers.js';

// Unit 13a: the probe harness, checked with a fake `claude` (no subscription used). The real
// runs are by hand: node test/probes/claude-probes.js --yes.

const HERE_DIR = dirname(fileURLToPath(import.meta.url));
const TOKEN = `sk-ant-oat01-${'Zz9_-q'.repeat(16)}`;

// A fake claude that answers in stream-json: it really reads a file it's asked to read (so a
// canary leaks, as a failed control would), prints the token when asked for it, reports its
// environment's names on stderr, and crashes on the agent probes.
function fakeClaude() {
  const path = join(tmp('fake-claude'), 'claude');
  writeFileSync(path, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('9.9.9 (Fake)'); process.exit(0); }
const prompt = args[args.indexOf('-p') + 1];
const emit = (e) => process.stdout.write(JSON.stringify(e) + '\\n');
process.stderr.write('ENVKEYS=' + Object.keys(process.env).sort().join(',') + '\\n');
if (prompt.includes('subagent named mirai-probe')) process.exit(3);
emit({ type: 'system', subtype: 'init', apiKeySource: 'none', tools: ['Bash', 'Read'], model: 'fake' });
let text = 'probe-ok';
let tool = 'Bash';
let input = { command: (/once:\\n\\n([\\s\\S]*?)\\n\\nThen/.exec(prompt) ?? [])[1] };
const read = /Read the file (\\S+) with the Read tool/.exec(prompt);
if (read) { tool = 'Read'; input = { file_path: read[1] }; try { text = fs.readFileSync(read[1], 'utf8'); } catch (e) { text = String(e); } }
const t = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '';
if (prompt.includes('printenv CLAUDE_CODE_OAUTH_TOKEN')) text = '#count\\n' + (t.length + 1) + '\\n#names\\nHOME PATH ' + t + '\\n#end\\n';
emit({ type: 'assistant', message: { content: [{ type: 'tool_use', name: tool, input }] } });
emit({ type: 'user', message: { content: [{ type: 'tool_result', content: text }] } });
emit({ type: 'result', subtype: 'success', is_error: false, permission_denials: [], result: 'DONE', num_turns: 2 });
`);
  chmodSync(path, 0o755);
  return path;
}

test('T3: the harness builds the fixture, scrubs the environment, flags canaries, redacts, writes both reports, cleans up', async () => {
  const workdir = join(tmp('probes'), 'w');
  process.env.MIRAI_PROBE_LEAK_CHECK = 'must-not-pass';
  try {
    const report = await runProbes({
      workdir, claude: fakeClaude(), token: TOKEN, useHostCanaries: false,
      only: ['g5-token', 'g10-read-out', 'g9-env', 'agent-glob'],
    });
    const by = Object.fromEntries(report.results.map((r) => [r.id, r]));
    assert.equal(report.claudeVersion, '9.9.9 (Fake)');
    assert.equal(by['g5-token'].outcome, 'pass');
    // The fake read the outside canary: a failed control is a FAIL, whatever the model says.
    assert.equal(by['g10-read-out'].outcome, 'FAIL');
    // The token reached "Bash": a FAIL, and the token itself is never stored.
    assert.equal(by['g9-env'].outcome, 'FAIL');
    assert.match(by['g9-env'].note, /token bytes in Bash: 1\d\d/);
    // The crashed run is recorded, and the run went on.
    assert.equal(by['agent-glob'].exit, 3);
    assert.equal(by['agent-glob'].outcome, 'inconclusive');

    // Only the allowlisted environment reached claude.
    const keys = /ENVKEYS=(\S+)/.exec(by['g5-token'].stderr)[1].split(',');
    assert.ok(!keys.includes('MIRAI_PROBE_LEAK_CHECK'));
    for (const k of keys) assert.ok(['PATH', 'HOME', 'LANG', 'TERM', 'TMPDIR', 'USER', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', '__CF_USER_TEXT_ENCODING'].includes(k), `unexpected variable ${k}`);

    const json = readFileSync(join(workdir, 'out', 'results.json'), 'utf8');
    const md = readFileSync(join(workdir, 'out', 'results.md'), 'utf8');
    for (const text of [json, md]) assert.ok(!text.includes(TOKEN) && !text.includes(Buffer.from(TOKEN).toString('base64')), 'the token reached a report');
    assert.match(json, /<token>/);
    assert.match(md, /\| g10-read-out \| G10 \| strict \| \*\*FAIL\*\*/);
    // The fixture is gone; the reports stay.
    for (const name of ['project', 'outside', 'remote.git', 'user-a', 'mirai-home']) assert.ok(!existsSync(join(workdir, name)), `${name} left behind`);
  } finally {
    delete process.env.MIRAI_PROBE_LEAK_CHECK;
  }
});

test('T3b: the fixture is removed and the reports written even when the run throws', async () => {
  const workdir = join(tmp('probes'), 'w');
  let calls = 0;
  await assert.rejects(runProbes({
    workdir, claude: fakeClaude(), token: TOKEN, useHostCanaries: false, only: ['g5-token', 'g1-read'],
    log: () => {
      calls += 1;
      if (calls === 2) throw new Error('boom');
    },
  }), /boom/);
  assert.ok(!existsSync(join(workdir, 'project')));
  assert.ok(existsSync(join(workdir, 'out', 'results.json')));
});

test('T4: every probe names only the fixture or known host items; real secret paths and tricks are refused', () => {
  const ctx = buildFixture(join(tmp('probes'), 'w'));
  ctx.host = {
    home: '/Users/someone', libraryDir: '/Users/someone/Library', keychainDir: '/Users/someone/Library/Keychains',
    dockerSocket: '/var/run/docker.sock', sshAuthSock: '/private/tmp/agent.sock', claude: '/usr/local/bin/claude', launcher: '/opt/mirai/bin/launch.js',
    claudeTmpMarker: '/private/tmp/claude-501/mirai-probe-0', userTmpMarker: '/private/var/folders/x/T/mirai-probe-0',
  };
  try {
    const probes = probeList(ctx);
    assert.ok(probes.length >= 50);
    for (const p of probes) guardProbe(p, ctx);
    const bad = (command, extra = {}) => ({ id: 'bad', action: { tool: 'Bash', command }, settings: {}, ...extra });
    for (const command of [
      'cat ~/.ssh/id_ed25519', 'cat /etc/passwd', 'cat "$HOME/.aws/credentials"', 'cat $HOME/.kube/config',
      'security find-generic-password -s "Claude Code-credentials" -w', 'security dump-keychain',
      'cp /Users/someone/Library/Keychains/login.keychain-db .', `cat ${ctx.root}/../.kube/config`, 'cd ../../..; cat .docker/config.json',
      'cat </Users/x/.kube/config', 'echo `id`', "printf 'protocol=https\\nhost=github.com\\n\\n' | git credential fill",
    ]) assert.throws(() => guardProbe(bad(command), ctx), /probe bad/, command);
    assert.throws(() => guardProbe({ id: 'bad', action: { tool: 'Read', path: '/Users/someone/.env' }, settings: {} }, ctx), /probe bad/);
    assert.throws(() => guardProbe({ id: 'bad', action: { tool: 'none', ask: 'read /Users/someone/.env please' }, settings: {} }, ctx), /probe bad/);
    assert.throws(() => guardProbe(bad('echo hi', { env: { X: '/Users/someone/.netrc' } }), ctx), /probe bad/);
    // Settings may deny anything, but an allow must stay inside the fixture.
    guardProbe(bad('echo hi', { settings: strict({ filesystem: { denyRead: ['/Users/someone', '/Users/someone/Library/Keychains'] } }) }), ctx);
    assert.throws(() => guardProbe(bad('echo hi', { settings: strict({ filesystem: { allowRead: ['/Users/someone/.ssh'] } }) }), ctx), /probe bad/);
    assert.throws(() => guardProbe(bad('echo hi', { settings: strict({ allow: ['Read(//Users/someone/**)'] }) }), ctx), /probe bad/);
  } finally {
    removeFixture(ctx, { keepOut: false });
  }
});

test('T5: redaction catches the token in every form a leak would use, before anything is cut', () => {
  const T = `sk-ant-oat01-${'Ab3_-x9Q'.repeat(12)}`;
  const piece = T.slice(13, 29);
  const forms = {
    plain: T,
    'inside a longer string': `X=${T}`,
    base64: Buffer.from(`X=${T}`).toString('base64'),
    base64url: Buffer.from(`XY=${T}`).toString('base64url'),
    'upper hex': Buffer.from(T).toString('hex').toUpperCase(),
    'a fragment': `zz${T.slice(20, 60)}zz`,
    'cut at 600 characters': (`${'a'.repeat(560)}${T}`).slice(0, 600),
    'url-encoded': encodeURIComponent(`k=${T}`),
  };
  for (const [name, text] of Object.entries(forms)) {
    const out = redact(text, T);
    assert.ok(!out.includes(piece) && !/oat01-Ab3/.test(out) && !out.includes(Buffer.from(T).toString('base64').slice(8, 24)), name);
    assert.ok(containsToken(text, T), name);
  }
  assert.ok(!containsToken('nothing here', T));
  assert.equal(redact('256 SHA256:abcdefghijklmnopqrstuvwxyz0123 me@example.com (ED25519)', null), '<ssh key>');
});

test('T6: the work folder must be missing or empty, not home, not inside a git work tree', () => {
  const home = tmp('probes-home');
  assert.throws(() => checkWorkdir(home, home), /home folder/);
  const full = tmp('probes-full');
  writeFileSync(join(full, 'keep.txt'), 'mine');
  assert.throws(() => checkWorkdir(full, home), /missing or empty/);
  const repo = tmp('probes-repo');
  mkdirSync(join(repo, 'sub'));
  const r = spawnSync('git', ['init', '-q'], { cwd: repo });
  assert.equal(r.status, 0);
  assert.throws(() => checkWorkdir(join(repo, 'sub', 'w'), home), /git work tree/);
  checkWorkdir(join(tmp('probes-ok'), 'w'), home);
  assert.equal(readFileSync(join(full, 'keep.txt'), 'utf8'), 'mine');
});

test('T7: a call counts only as written; G18 needs every section and counts only what the host reaches', () => {
  const action = { tool: 'Bash', command: 'echo a' };
  assert.ok(madeTheCall(action, [{ name: 'Bash', input: { command: 'echo a' } }]));
  assert.ok(!madeTheCall(action, [{ name: 'Bash', input: { command: 'echo b' } }]));
  assert.ok(madeTheCall({ tool: 'Read', path: '/x' }, [{ name: 'Read', input: { file_path: '/x' } }]));
  const ctx = { canaries: { gitCredential: 'GC', keychain: 'KC' }, baseline: { docker: true, ssh: false, git: true, keychain: true } };
  const out = (body) => ({ toolText: body });
  const full = '#docker\nCouldn\'t connect\n#ssh\nError\n#git\nfatal\n#keychain\nnot found\n#end\n';
  const v = g18Check(out(full), ctx);
  assert.equal(v.pass, true);
  assert.match(v.note, /ssh: absent on host/);
  assert.equal(g18Check(out('#docker\n#ssh\n'), ctx).inconclusive, true);
  assert.equal(g18Check(out(full.trimEnd()), ctx).pass, true, 'a last line without a newline still counts');
  assert.equal(g18Check(out(full.replace('not found', 'KC')), ctx).pass, false);
  assert.equal(g18Check(out(full), { ...ctx, baseline: {} }).inconclusive, true);
});

test('T13b: npm test never runs the real harness', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test "test/**/*.test.js"');
  // The only file here npm test picks up is this one.
  assert.deepEqual(readdirSync(HERE_DIR).filter((f) => f.endsWith('.test.js')), ['harness.test.js']);
});
