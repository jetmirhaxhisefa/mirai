import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { containsToken, madeTheCall, redact, runProbes } from './claude-probes.js';
import { buildFixture, checkWorkdir, removeFixture } from './fixture.js';
import { g18Check, guardProbe, probeList, strict } from './probes.js';
import { tmp } from '../store/helpers.js';
import { DIFF_FLAGS, pinArgs, pinEnv } from '../../src/store/git-pins.js';
import { buildComposeFixture } from './compose-fixture.js';
import { dockerProbes, gitProbes, guardDockerProbe, section, writeCompose } from './compose-probes.js';
import { runDockerProbes } from './docker-probes.js';
import { classify, MIRAI_STEPS, runGitProbes } from './git-probes.js';

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

// ---- Unit 14a: the Docker and git harnesses (no Docker used; git runs on a throwaway fixture) ----

// A fake docker: it logs each call (its arguments and its environment's names) as a JSON line,
// answers config with a resolved file named after -p, "runs" the masks probe by printing the
// project's real .env (so a failed mask shows up as a FAIL), and lists one leftover container
// for the harness's final sweep.
function fakeDocker(project) {
  const dir = tmp('fake-docker');
  const log = join(dir, 'calls.log');
  const path = join(dir, 'docker');
  writeFileSync(path, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, env: Object.keys(process.env).sort(), DOCKER_CONFIG: process.env.DOCKER_CONFIG }) + '\\n');
const p = args.includes('-p') ? args[args.indexOf('-p') + 1] : null;
if (args[0] === 'version') { console.log(JSON.stringify({ Client: { Version: '0.0-fake' }, Server: { Version: '0.0-fake' } })); process.exit(0); }
if (args.includes('config')) { console.log(JSON.stringify({ name: p, services: { app: { image: 'nginx:1.27-alpine' } } })); process.exit(0); }
if (args.includes('exec')) { try { console.log(fs.readFileSync(process.env.FAKE_ENV_FILE ?? ${JSON.stringify(join(project ?? '/nonexistent', '.env'))}, 'utf8')); } catch {} process.exit(0); }
if (args[0] === 'ps' && args.some((a) => a.startsWith('label=mirai.probe='))) { console.log('deadbeef'); process.exit(0); }
if (args[0] === 'compose' && args.includes('version')) { console.log('0.0-fake'); process.exit(0); }
process.exit(0);
`);
  chmodSync(path, 0o755);
  return { path, log, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []) };
}

test('14a T1: the Docker harness: Desktop-style client, allowlisted env, named projects, labels, down -v around runs, canary = FAIL, reports, sweep, cleanup', async () => {
  const workdir = join(tmp('docker-probes'), 'w');
  const fake = fakeDocker(join(workdir, 'project'));
  const report = await runDockerProbes({
    workdir, docker: fake.path, realHome: '/nonexistent-home',
    probes: (ctx) => dockerProbes(ctx).filter((p) => ['g12-override', 'g27-mask-volume', 'docker-own-config'].includes(p.id))
      .concat([{ id: 'throws', fact: 'x', kind: 'config', compose: { services: { app: { image: 'nginx:1.27-alpine' } } }, check: () => { throw new Error('boom'); } }]),
  });
  const by = Object.fromEntries(report.results.map((r) => [r.id, r]));
  assert.equal(by['g12-override'].outcome, 'pass');
  assert.equal(by['g27-mask-volume'].outcome, 'FAIL', 'the fake printed the real .env canary');
  assert.equal(by.throws.outcome, 'FAIL');
  assert.match(by.throws.note, /check failed: boom/);
  const calls = fake.calls();
  const allowed = ['DOCKER_CONFIG', 'DOCKER_HOST', 'HOME', 'PATH'];
  for (const c of calls) {
    assert.deepEqual(c.env.filter((k) => !['__CF_USER_TEXT_ENCODING'].includes(k)), allowed, `env for ${c.args.join(' ')}`);
    assert.match(c.DOCKER_CONFIG, /docker-config$/);
  }
  const projects = calls.filter((c) => c.args[0] === 'compose' && c.args.includes('-p')).map((c) => c.args[c.args.indexOf('-p') + 1]);
  assert.ok(projects.length > 0 && projects.every((p) => new RegExp(`^mirai-probe-${report.runId}-\\d+$`).test(p)));
  const maskProject = calls.find((c) => c.args.includes('exec')).args[2];
  const downs = calls.filter((c) => c.args.includes('down') && c.args.includes(maskProject));
  assert.ok(downs.length >= 2 && downs.every((c) => c.args.includes('-v')), 'down -v before and after');
  assert.ok(calls.some((c) => c.args[0] === 'rm' && c.args.includes('deadbeef')), 'leftover containers removed');
  assert.ok(calls.every((c) => !c.args.includes('build') && !c.args.includes('pull')));
  assert.ok(calls.filter((c) => c.args.includes('up')).every((c) => c.args.includes('--pull') && c.args.includes('never') && c.args.includes('--no-build')));
  assert.equal(existsSync(join(workdir, 'project')), false, 'fixture removed');
  assert.ok(existsSync(join(workdir, 'out', 'docker-results.md')) && existsSync(join(workdir, 'out', 'docker-results.json')));
});

test('14a T1b: compose files carry the probe label; the frozen-file and show checks read resolved JSON', () => {
  const root = tmp('compose-write');
  const ctx = { root, project: join(root, 'project'), trust: join(root, 'trust'), canaries: {} };
  mkdirSync(join(root, 'compose'));
  const file = writeCompose(ctx, { id: 'p', compose: { services: { a: { image: 'nginx:1.27-alpine', labels: { k: 'v' } } } } }, 'run1');
  const written = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(written.services.a.labels, { k: 'v', 'mirai.probe': 'run1' });
  assert.equal(section('#a\nx\ny\n#b\nz\n#end\n', 'a'), 'x\ny');
  assert.equal(section('#proxy\n#end\n', 'proxy'), '', 'an empty section stays empty');
});

test('14a T2: the git harness runs MIRAI\'s commands unpinned and pinned, and sees a key fire', async () => {
  const workdir = join(tmp('git-probes'), 'w');
  const report = await runGitProbes({ workdir, only: ['g15-fsmonitor', 'g23-pager'] });
  const by = Object.fromEntries(report.results.map((r) => [r.id, r]));
  assert.equal(by['g15-fsmonitor'].control.fired, true, 'the control saw the marker');
  assert.equal(by['g15-fsmonitor'].pinned.fired, false);
  assert.equal(by['g15-fsmonitor'].outcome, 'pass');
  assert.equal(by['g23-pager'].kind, 'inert');
  assert.ok(by['g15-fsmonitor'].control.marks.every((m) => !m.includes(workdir)), 'paths in marks are shortened');
  assert.equal(existsSync(join(workdir, 'git')), false, 'fixture removed');
  assert.ok(existsSync(join(workdir, 'out', 'git-results.md')));
  assert.deepEqual([classify(true, false), classify(true, true), classify(false, false), classify(false, true)], ['neutralised', 'not pinnable', 'inert', 'fires only pinned']);
});

test('14a T3: canaries only: Docker probes stay in the fixture, use local images, never the socket; git remotes are local', () => {
  const root = join(tmp('guard14'), 'w');
  const ctx = buildComposeFixture(root);
  try {
    for (const p of dockerProbes(ctx)) guardDockerProbe(p, ctx);
    // A probe whose script never ran (no output) doesn't pass (14a review).
    const mask = dockerProbes(ctx).find((p) => p.id === 'g27-mask-volume');
    assert.equal(mask.check({ started: true, out: '', hostChanged: [] }).pass, false);
    assert.equal(mask.check({ started: true, out: '#mounts\n#end\n', hostChanged: [] }).pass, true);
    const base = { id: 'x', kind: 'up', compose: { services: { a: { image: 'nginx:1.27-alpine' } } } };
    const withSvc = (s, extra = {}) => ({ ...base, ...extra, compose: { services: { a: { image: 'nginx:1.27-alpine', ...s } } } });
    assert.throws(() => guardDockerProbe(withSvc({ volumes: ['/Users:/u'] }), ctx), /outside the fixture/);
    assert.throws(() => guardDockerProbe(withSvc({ volumes: [`${ctx.root}/../x:/u`] }), ctx), /outside the fixture/);
    assert.throws(() => guardDockerProbe(withSvc({ volumes: ['/var/run/docker.sock:/s'] }), ctx), /Docker socket/);
    assert.throws(() => guardDockerProbe(withSvc({ image: 'alpine:latest' }), ctx), /local images/);
    assert.throws(() => guardDockerProbe(withSvc({ privileged: true }), ctx), /only in a config probe/);
    assert.throws(() => guardDockerProbe({ ...base, compose: { services: { a: { image: 'nginx:1.27-alpine' } }, volumes: { v: { driver_opts: { device: '/etc' } } } } }, ctx), /outside the fixture/);
    guardDockerProbe(withSvc({ privileged: true }, { kind: 'config' }), ctx);
    assert.throws(() => guardDockerProbe(withSvc({ volumes: ['~/.ssh:/s'] }), ctx), /outside the fixture/);
    assert.throws(() => guardDockerProbe({ ...base, kind: 'config', compose: { include: [{ path: '/etc/x.yml' }], services: { a: { image: 'nginx:1.27-alpine' } } } }, ctx), /outside the fixture/);
    assert.throws(() => guardDockerProbe(withSvc({ extends: { file: '/etc/x.yml', service: 'b' } }, { kind: 'config' }), ctx), /outside the fixture/);
    assert.throws(() => guardDockerProbe(withSvc({ devices: [{ source: '/dev/disk0', target: '/d' }] }, { kind: 'config' }), ctx), /outside the fixture/);
    assert.throws(() => guardDockerProbe({ id: 'c', kind: 'cli', cli: ['run', '-v', '/Users:/u', 'nginx:1.27-alpine'] }, ctx), /isn't allowed/);
    assert.throws(() => guardDockerProbe({ id: 'c', kind: 'cli', cli: ['run', 'alpine:latest'] }, ctx), /isn't allowed/);
    for (const p of gitProbes({ authPort: 1, server: { port: 2 } })) {
      const url = p.push({ dir: join(ctx.root, 'git', p.id), payload: join(ctx.root, 'payload') });
      assert.ok(url.startsWith(`file://${ctx.root}/`) || url.startsWith('http://127.0.0.1:') || url.startsWith('ssh://127.0.0.1:1/') || url.startsWith(`ext::${ctx.root}/`) || url === 'origin', `${p.id}: ${url}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('14a T4: the pin set holds the probed pins, and no value comes from the repo', () => {
  const args = pinArgs();
  const pins = Object.fromEntries(args.filter((a, i) => i % 2 === 1).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
  assert.ok(args.filter((a, i) => i % 2 === 0).every((a) => a === '-c'));
  assert.equal(pins['core.hooksPath'], '/dev/null');
  assert.equal(pins['core.fsmonitor'], 'false');
  for (const k of ['credential.helper', 'diff.external', 'http.proxy', 'core.askPass', 'core.excludesFile']) assert.equal(pins[k], '', k);
  assert.equal(pins['protocol.ext.allow'], 'never');
  assert.equal(pins['commit.gpgSign'], 'false');
  for (const k of ['gpg.program', 'gpg.openpgp.program', 'gpg.ssh.program', 'gpg.x509.program']) assert.equal(pins[k], '/usr/bin/false', k);
  for (const [k, v] of [['merge.verifySignatures', 'false'], ['log.showSignature', 'false'], ['diff.ignoreSubmodules', 'all'], ['status.showUntrackedFiles', 'all'], ['color.ui', 'never'], ['diff.noprefix', 'false']]) assert.equal(pins[k], v, k);
  for (const v of Object.values(pins)) assert.ok(['', 'false', 'never', 'always', 'all', 'no', 'cat', '/usr/bin/false', '/dev/null'].includes(v), v);
  assert.equal(pinArgs({ excludesFile: '/u/ignore' }).at(pinArgs().indexOf('core.excludesFile=')), 'core.excludesFile=/u/ignore');
  const env = pinEnv({ top: '/repo' });
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(env.HOME, '/var/empty');
  assert.equal(env.GIT_DIR, '/repo/.git');
  assert.equal(env.GIT_WORK_TREE, '/repo');
  assert.equal(env.GIT_SSH_COMMAND, '/usr/bin/false');
  assert.equal(env.GIT_ALLOW_PROTOCOL, 'file:https');
  assert.equal(pinEnv().GIT_DIR, undefined);
  assert.deepEqual(DIFF_FLAGS, ['--no-ext-diff', '--no-textconv', '--no-color']);
});

test('14b T13: the --mirai harness runs every git.js export on the fixture, sees a refusal, a clean run and a marker', async () => {
  const workdir = join(tmp('git-mirai'), 'w');
  const real = gitProbes({ authPort: 1, server: { port: 2, reset() {}, hits: 0 } });
  const pick = (id) => real.find((p) => p.id === id);
  // A probe that "fires" whatever MIRAI does: the harness must report it.
  const fires = { id: 'x-fires', fact: 'test', title: 'a marker written by the probe itself', push: (d) => `file://${join(d.dir, 'remote.git')}`, plant: (d) => writeFileSync(d.marks, 'fired\n') };
  const report = await runGitProbes({ workdir, mirai: true, probes: [pick('g15-fsmonitor'), pick('g23-filter'), pick('g23-gitfile'), fires] });
  const by = Object.fromEntries(report.results.map((r) => [r.id, r]));
  assert.equal(by['g15-fsmonitor'].control.fired, true);
  assert.deepEqual([by['g15-fsmonitor'].outcome, by['g15-fsmonitor'].kind], ['pass', 'ran, nothing fired']);
  assert.deepEqual([by['g23-filter'].outcome, by['g23-filter'].kind], ['pass', 'refused (repo-config)']);
  assert.match(by['g23-filter'].pinned.refused.message, /filter\.evil\.(clean|smudge)/);
  assert.deepEqual([by['g23-gitfile'].outcome, by['g23-gitfile'].kind], ['pass', 'refused (git-file)']);
  assert.equal(by['g23-gitfile'].pinned.refused.step, 'topLevel');
  assert.equal(by['x-fires'].outcome, 'FAIL');
  for (const r of report.results) assert.ok(!JSON.stringify(r.pinned).includes(workdir), `${r.id}: a full path in the report`);
  assert.ok(MIRAI_STEPS.length >= 21);
  assert.equal(existsSync(join(workdir, 'git')), false, 'fixture removed');
  assert.ok(existsSync(join(workdir, 'out', 'git-mirai-results.md')));
});
