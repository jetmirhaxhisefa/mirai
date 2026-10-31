import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { snapshot, trustedFile } from '../../src/trust/snapshot.js';
import { copyTree, isEnvPath } from '../../src/tests/copy.js';
import { checkAllowlist, DAYTIME_KEYS, prescan, tighten } from '../../src/tests/compose.js';
import { findTarget, redact, runTest } from '../../src/tests/run.js';
import { writeToken } from '../../src/sign/token.js';
import { checkConfig } from '../../src/config/load.js';
import { parseToml } from '../../src/config/toml.js';
import { main } from '../../src/cli/main.js';
import { COMMANDS } from '../../src/cli/commands/index.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { guardScenario, scenarios } from '../probes/test-run-probes.js';
import { COMPOSE, CONFIG, fakeDocker, gitIn, installed, resolvedApp, tempDir } from './run-fixture.js';

// Unit 14c: the test executor, without Docker (a fake docker records every call). The real
// Docker runs are test/probes/test-run-probes.js and the sample app (test-results.md). The
// fixtures are in run-fixture.js (unit 16a).

test('14c T1: the copy: tracked and new files with modes; no .git, ignored or real .env files; links stay inside; limits; the tree hash', () => {
  const r = installed({ files: { 'bin/run': '#!/bin/sh\n', 'sub/.env.example': 'X=1\n' } });
  chmodSync(join(r.root, 'bin/run'), 0o755);
  writeFileSync(join(r.root, 'new.txt'), 'new\n');
  writeFileSync(join(r.root, '.env'), 'SECRET=real\n');
  writeFileSync(join(r.root, 'sub', '.ENV.local'), 'SECRET=real\n');
  mkdirSync(join(r.root, 'build'));
  writeFileSync(join(r.root, 'build', 'out.js'), 'x\n');
  symlinkSync('README.md', join(r.root, 'readme-link'));
  const dest = join(tempDir('copy'), 'tree');
  const keep = new Map([['.env.test', Buffer.from('MODE=from-base\n')]]);
  writeFileSync(join(r.root, '.env.test'), 'MODE=changed-in-work-tree\n');
  const c = copyTree({ root: r.root, env: r.env, dest, keep });
  const has = (p) => existsSync(join(dest, p));
  assert.ok(has('README.md') && has('new.txt') && has('.env.test') && has('compose.yml'));
  assert.ok(!has('.git') && !has('.env') && !has('sub/.ENV.local') && !has('sub/.env.example') && !has('build'));
  assert.deepEqual(c.left.sort(), ['sub/.ENV.local', 'sub/.env.example'].sort());
  assert.equal(readFileSync(join(dest, 'readme-link'), 'utf8'), '# r\n');
  assert.equal(readFileSync(join(dest, '.env.test'), 'utf8'), 'MODE=from-base\n', 'kept env files come from the base commit');
  assert.equal((execFileSync('/usr/bin/stat', ['-f', '%Lp', join(dest, 'bin/run')]).toString().trim()), '755');
  assert.deepEqual(['.env', 'a/.Env.x', 'x/.envrc', 'env.txt'].map(isEnvPath), [true, true, true, false]);
  // The hash changes with one byte.
  const again = copyTree({ root: r.root, env: r.env, dest: join(tempDir('copy'), 'tree'), keep });
  assert.equal(again.treeHash, c.treeHash);
  writeFileSync(join(r.root, 'new.txt'), 'neW\n');
  assert.notEqual(copyTree({ root: r.root, env: r.env, dest: join(tempDir('copy'), 'tree'), keep }).treeHash, c.treeHash);
  // Links that could lead out stop the copy, and it leaves nothing behind: absolute, any "..",
  // and the review's chains that stay inside on paper (a/b/up -> ../.. then x -> a/b/up/../../../O).
  for (const target of ['/etc', '../outside', 'sub/../../x', 'a/../README.md']) {
    symlinkSync(target, join(r.root, 'bad-link'));
    const to = join(tempDir('copy'), 'tree');
    assert.throws(() => copyTree({ root: r.root, env: r.env, dest: to }), (e) => e.code === 'copy-link', target);
    assert.equal(existsSync(to), false);
    rmSync(join(r.root, 'bad-link'));
  }
  mkdirSync(join(r.root, 'a', 'b'), { recursive: true });
  symlinkSync('../..', join(r.root, 'a', 'b', 'up'));
  assert.throws(() => copyTree({ root: r.root, env: r.env, dest: join(tempDir('copy'), 'tree') }), (e) => e.code === 'copy-link' && /a\/b\/up/.test(e.message));
  rmSync(join(r.root, 'a'), { recursive: true });
  // A tracked folder replaced by a link: nothing under it is read through the link.
  const outside = tempDir('outside');
  writeFileSync(join(outside, 'run'), 'OUTSIDE\n');
  rmSync(join(r.root, 'bin'), { recursive: true });
  symlinkSync(outside, join(r.root, 'bin'));
  assert.throws(() => copyTree({ root: r.root, env: r.env, dest: join(tempDir('copy'), 'tree') }), (e) => e.code === 'copy-link');
  rmSync(join(r.root, 'bin'));
  mkdirSync(join(r.root, 'bin'));
  writeFileSync(join(r.root, 'bin', 'run'), '#!/bin/sh\n');
  // A hard link brings another file's content under a harmless name: refused.
  execFileSync('/bin/ln', [join(r.root, '.env'), join(r.root, 'notes.txt')]);
  assert.throws(() => copyTree({ root: r.root, env: r.env, dest: join(tempDir('copy'), 'tree') }), (e) => e.code === 'copy-hardlink' && /notes\.txt/.test(e.message));
  rmSync(join(r.root, 'notes.txt'));
  assert.throws(() => copyTree({ root: r.root, env: r.env, dest: join(tempDir('copy'), 'tree'), limits: { files: 3, bytes: 1e9 } }), (e) => e.code === 'copy-too-large');
  // A nested repo is refused (14b's check comes with the file list).
  gitIn(join(r.root), r.home)('init', '-q', 'nested');
  mkdirSync(join(r.root, 'nested2'));
  gitIn(join(r.root, 'nested2'), r.home)('init', '-q');
  assert.throws(() => copyTree({ root: r.root, env: r.env, dest: join(tempDir('copy'), 'tree') }), (e) => e.code === 'repo-nested');
});

test('14c T2: the compose inputs come from the base commit\'s trust root, never the work tree', async () => {
  const r = installed();
  const trust = snapshot({ cwd: r.root, env: r.env });
  assert.equal(trust.manifest.format, 5);
  assert.equal(trustedFile(trust, 'compose.yml').toString(), COMPOSE);
  assert.equal(trustedFile(trust, '.env.test').toString(), 'MODE=test\n');
  writeFileSync(join(r.root, 'compose.yml'), 'services: {}\n');
  writeFileSync(join(r.root, 'compose.override.yml'), 'services:\n  app:\n    privileged: true\n');
  const f = fakeDocker({ resolved: resolvedApp() });
  await runTest({ cwd: r.root, env: r.env, name: 'unit', docker: f.docker });
  const files = f.calls().filter((c) => c.args[0] === 'compose').flatMap((c) => c.args.filter((a, i) => c.args[i - 1] === '-f'));
  assert.ok(files.length > 0);
  for (const file of files) assert.ok(file.startsWith(join(trust.dir, 'tree')) || file.endsWith('compose.frozen.json'), file);
  assert.ok(!files.some((x) => x.includes('override')));
});

test('14c T3: the prescan refuses keys that act on the host, tags, merge keys and escaped keys, with the line', () => {
  for (const [text, re] of [['include:\n  - x.yml\n', /:1: the key include/], ['services:\n  a:\n    extends:\n      file: b.yml\n', /:3: the key extends/],
    ['services:\n  a:\n    env_file: .env\n', /env_file/], ['services:\n  a:\n    provider:\n      type: x\n', /provider/], ['models:\n  m: {}\n', /models/],
    ['{"services":{"a":{"env_file":[".env"]}}}', /env_file/], ['x: !!binary abc\n', /YAML tag/], ['base: &b\n  a: 1\nc:\n  <<: *b\n', /merge key/],
    ['"inc\\x6cude": [x]\n', /escape/], ['services: { a: { image: x, include: y } }\n', /include/]]) {
    assert.throws(() => prescan(text, 'compose.yml'), (e) => e.code === 'compose-prescan' && re.test(e.message), text);
  }
  prescan(COMPOSE, 'compose.yml');
  prescan('# include: is fine in a comment\nservices:\n  a:\n    image: x\n    command: ["sh", "-c", "echo hi"]\n', 'c.yml');
});

test('14c T4: every Docker call: Desktop\'s client by path, four variables, the same flags; no COMPOSE_*; a unique project; "start Docker Desktop"', async () => {
  const r = installed();
  const f = fakeDocker({ resolved: resolvedApp() });
  const process_ = { ...r.env, COMPOSE_FILE: 'evil.yml', COMPOSE_PROFILES: 'x', DOCKER_HOST: 'tcp://evil:2375', SECRET: 'canary' };
  const a = await runTest({ cwd: r.root, env: process_, name: 'unit', docker: f.docker });
  const calls = f.calls();
  for (const c of calls) {
    assert.deepEqual(Object.keys(c.env).filter((k) => !['PWD', 'SHLVL', '_', 'OLDPWD'].includes(k)).sort(), ['DOCKER_CONFIG', 'DOCKER_HOST', 'HOME', 'PATH']);
    assert.equal(c.env.DOCKER_HOST, `unix://${f.docker.socket}`);
    assert.ok(c.env.DOCKER_CONFIG.startsWith(join(r.home, 'Library', 'Application Support', 'mirai', 'docker')));
  }
  const config = JSON.parse(readFileSync(join(calls[0].env.DOCKER_CONFIG, 'config.json'), 'utf8'));
  assert.deepEqual(Object.keys(config), ['cliPluginsExtraDirs']);
  for (const c of calls.filter((x) => x.args[0] === 'compose')) {
    const at = (flag) => c.args[c.args.indexOf(flag) + 1];
    assert.equal(at('-p'), a.project);
    assert.ok(at('--project-directory').endsWith('/tree'));
    assert.ok(at('--env-file').endsWith('/tree/.env.test'));
    assert.equal(at('--progress'), 'quiet');
  }
  const b = await runTest({ cwd: r.root, env: r.env, name: 'unit', docker: fakeDocker({ resolved: resolvedApp() }).docker });
  assert.notEqual(a.project, b.project);
  assert.match(a.project, /^mirai-[a-z0-9]+-t-\d{8}-\d{6}-[0-9a-f]{6}$/);
  const down = fakeDocker({ resolved: resolvedApp() });
  rmSync(down.docker.socket);
  await assert.rejects(runTest({ cwd: r.root, env: r.env, name: 'unit', docker: down.docker }), (e) => e.code === 'docker-down' && /start Docker Desktop/.test(e.hint));
  await assert.rejects(runTest({ cwd: r.root, env: r.env, name: 'unit', docker: { ...down.docker, client: '/nonexistent/docker' } }), (e) => e.code === 'no-docker');
});

test('14c T5: tighten removes the daytime keys, makes networks internal, adds labels and the output mount, and nothing else', () => {
  const resolved = { name: 'x', services: { app: { image: 'i', ports: [], build: {}, restart: 'always', container_name: 'c', develop: {}, profiles: ['e2e'], environment: { A: '1' } }, db: { image: 'j' } }, networks: { default: { name: 'p_default', ipam: {} } } };
  const t = tighten(resolved, { project: 'p', labels: { 'mirai.test-run': 'r' }, output: { service: 'app', source: '/out', target: '/mirai/out' } });
  for (const k of DAYTIME_KEYS) assert.equal(t.services.app[k], undefined, k);
  assert.equal(t.name, 'p');
  assert.equal(t.networks.default.internal, true);
  assert.deepEqual(t.services.app.environment, { A: '1' });
  assert.deepEqual(t.services.db.labels, { 'mirai.test-run': 'r' });
  assert.deepEqual(t.services.app.volumes.at(-1), { type: 'bind', source: '/out', target: '/mirai/out', bind: { create_host_path: false } });
  assert.equal(t.services.db.volumes, undefined);
  assert.equal(resolved.services.app.ports.length, 0, 'the input is untouched');
});

test('14c T6: the allowlist refuses everything it doesn\'t name, naming service and key', () => {
  const copy = tempDir('copy');
  const out = tempDir('out');
  mkdirSync(join(copy, 'sub'));
  writeFileSync(join(copy, '.env.test'), 'X=1\n');
  const base = () => tighten(JSON.parse(JSON.stringify(resolvedApp()).replaceAll('@PROJECT@', 'p').replaceAll('@COPY@', copy)), { project: 'p', labels: {}, output: { service: 'app', source: out, target: '/mirai/out' } });
  const ok = { project: 'p', copy, out, imageOk: () => true };
  checkAllowlist(base(), ok);
  const refused = (mutate, re, opts = ok) => {
    const c = base();
    mutate(c, c.services.app);
    assert.throws(() => checkAllowlist(c, opts), (e) => ['compose-refused', 'no-image'].includes(e.code) && re.test(e.message), String(mutate));
  };
  for (const key of ['privileged', 'cap_add', 'devices', 'network_mode', 'pid', 'ipc', 'uts', 'cgroup', 'security_opt', 'userns_mode', 'sysctls', 'runtime', 'gpus',
    'configs', 'secrets', 'volumes_from', 'links', 'extra_hosts', 'dns', 'logging', 'post_start', 'provider', 'shm_size']) {
    refused((c, s) => { s[key] = key === 'privileged' ? true : ['x']; }, new RegExp(`service app: ${key}`));
  }
  refused((c, s) => s.volumes.push({ type: 'bind', source: '/', target: '/host' }), /a mount of \//);
  refused((c, s) => s.volumes.push({ type: 'bind', source: '/var/run/docker.sock', target: '/s' }), /docker\.sock/);
  refused((c, s) => s.volumes.push({ type: 'bind', source: join(copy, '..'), target: '/up' }), /a mount of/);
  refused((c, s) => s.volumes.push({ type: 'bind', source: join(copy, '.git'), target: '/g' }), /\.git/);
  refused((c, s) => s.volumes.push({ type: 'bind', source: join(copy, 'sub', '.env'), target: '/e' }), /env files/);
  refused((c, s) => s.volumes.push({ type: 'volume', target: 'v:/x' }), /mount target v:\/x/);
  refused((c, s) => s.volumes.push({ type: 'npipe', source: 'x', target: '/x' }), /npipe/);
  refused((c, s) => s.volumes.push({ type: 'bind', source: copy, target: '/x', bind: { propagation: 'shared' } }), /bind options/);
  refused((c, s) => s.volumes.push({ type: 'volume', source: 'shared', target: '/x' }), /the volume shared/);
  refused((c) => { c.networks.default.internal = false; }, /outside access/);
  refused((c) => { c.networks.default.external = true; }, /network default: external/);
  refused((c) => { c.networks.default.name = 'my-daytime-net'; }, /the name my-daytime-net/);
  refused((c) => { c.volumes = { v: { name: 'p_v', external: true } }; }, /volume v: external/);
  refused((c) => { c.volumes = { v: { name: 'shared-data' } }; }, /the name shared-data/);
  refused((c) => { c.configs = {}; }, /top-level configs/);
  refused((c) => { c.name = 'daytime'; }, /project name/);
  refused(() => {}, /isn't on this machine/, { ...ok, imageOk: () => false });
  // A committed dummy env file kept in the copy may be mounted; [compose] allow lets exactly its keys through.
  const c = base();
  c.services.app.volumes.push({ type: 'bind', source: join(copy, '.env.test'), target: '/w/.env' });
  c.services.app.shm_size = 1024;
  checkAllowlist(c, { ...ok, allow: ['shm_size'] });
  assert.throws(() => checkAllowlist(c, { ...ok, allow: ['privileged'] }), /shm_size/);
});

test('14c T7: the run: frozen file, down before and after, exec vs oneoff, --path after --, inspect mismatches stop it', async () => {
  const r = installed({ files: { 'tests/A_Test.php': '' } });
  const f = fakeDocker({ resolved: resolvedApp() });
  const res = await runTest({ cwd: r.root, env: r.env, name: 'unit', path: 'tests/A_Test.php', docker: f.docker });
  assert.equal(res.outcome, 'pass');
  const verbs = f.calls().map((c) => (c.args[0] === 'compose' ? c.args.find((a) => ['config', 'up', 'exec', 'run', 'down'].includes(a)) : c.args.slice(0, 2).join(' ')));
  const clear = ['ps -aq', 'down', 'network ls', 'volume ls', 'ps -aq', 'network ls', 'volume ls'];
  assert.deepEqual(verbs, ['version --format', 'ps -a', 'config', 'image inspect', ...clear, 'up', 'ps -aq', 'exec', ...clear]);
  const exec = f.calls().find((c) => c.args.includes('exec')).args;
  // Unit 16a: the path is the service's own for it (the copy is at /w in app).
  assert.deepEqual(exec.slice(exec.indexOf('exec')), ['exec', '-T', 'app', 'run-tests', '--', '/w/tests/A_Test.php']);
  const frozenPath = exec[exec.indexOf('-f') + 1];
  assert.ok(frozenPath.endsWith('compose.frozen.json'));
  const frozen = JSON.parse(readFileSync(frozenPath, 'utf8'));
  assert.equal(frozen.services.app.ports, undefined);
  assert.equal(frozen.networks.default.internal, true);
  const up = f.calls().find((c) => c.args.includes('up')).args;
  assert.deepEqual(up.slice(up.indexOf('up')), ['up', '-d', '--wait', '--no-build', '--pull', 'never', 'app']);
  // A check run once: what it depends on starts first, then `run --rm --no-deps` with its workdir.
  const f2 = fakeDocker({ resolved: resolvedApp({ depends_on: {} }) });
  await runTest({ cwd: r.root, env: r.env, name: 'lint', docker: f2.docker });
  const run = f2.calls().find((c) => c.args.includes('run')).args;
  assert.deepEqual(run.slice(run.indexOf('run')), ['run', '-d', '--no-deps', '--pull', 'never', '-w', '/w', 'app', 'lint-it']);
  assert.ok(f2.calls().some((c) => c.args[0] === 'wait') && f2.calls().some((c) => c.args[0] === 'logs'));
  assert.ok(!f2.calls().some((c) => c.args.includes('up')), 'nothing to start first');
  // docker inspect: a container with a mount the frozen file doesn't have stops the run, and is cleaned up.
  const bad = JSON.stringify([{ Name: '/x', Config: { Labels: { 'com.docker.compose.service': 'app' } }, HostConfig: {}, NetworkSettings: { Networks: {} }, Mounts: [{ Type: 'bind', Source: '/Users' }] }]);
  const f3 = fakeDocker({ resolved: resolvedApp(), upPs: 'c1', inspect: bad });
  let caught;
  await assert.rejects(runTest({ cwd: r.root, env: r.env, name: 'unit', docker: f3.docker }).catch((e) => {
    caught = e;
    throw e;
  }), (e) => e.code === 'inspect-mismatch' && /\/Users/.test(e.message));
  const after3 = f3.calls().map((c) => c.args.join(' '));
  assert.ok(after3.at(-1).startsWith('volume ls') && after3.some((a) => a.startsWith('rm -f -v c1')));
  // Every run that got this far leaves a typed result, also a refused one.
  const stored3 = JSON.parse(readFileSync(join(caught.result.dir, 'result.json'), 'utf8'));
  assert.deepEqual([stored3.outcome, stored3.code], ['refused', 'inspect-mismatch']);
  // Docker Desktop may report a bind as the VM sees it (/host_mnt + the Mac path): the same mount.
  const vm = JSON.stringify([{ Name: '/x', Config: { Labels: { 'com.docker.compose.service': 'app' } }, HostConfig: {}, NetworkSettings: { Networks: {} }, Mounts: [{ Type: 'bind', Source: '/host_mnt@COPY@' }, { Type: 'bind', Source: '/host_mnt@OUT@' }] }]);
  const f4 = fakeDocker({ resolved: resolvedApp(), upPs: 'c1', inspect: vm });
  const ok4 = await runTest({ cwd: r.root, env: r.env, name: 'unit', docker: f4.docker });
  assert.equal(ok4.outcome, 'pass');
  // A service that doesn't start: the error carries the exited containers' last log lines, redacted.
  const f5 = fakeDocker({ resolved: resolvedApp(), upCode: 1 });
  await assert.rejects(runTest({ cwd: r.root, env: r.env, name: 'unit', docker: f5.docker }), (e) => e.code === 'stack-down'
    && /exited \(1\)\n--- app ---\napp says: backend\/\.env is missing <redacted:github-token>/.test(e.message));
  // The copy is gone after every run, whatever happened.
  const testsDir = join(r.home, 'Library', 'Application Support', 'mirai');
  const trees = execFileSync('/usr/bin/find', [testsDir, '-type', 'd', '-name', 'tree', '-path', '*/tests/*']).toString().trim();
  assert.equal(trees, '');
});

test('14c T8: a timeout is an environment fault: the client killed, containers force-removed, down -v', async () => {
  const r = installed();
  const f = fakeDocker({ resolved: resolvedApp(), execSleep: 8, execPs: 'c9' });
  const res = await runTest({ cwd: r.root, env: r.env, name: 'unit', docker: f.docker, minuteMs: 200 }); // 15 "minutes" = 3 s
  assert.equal(res.outcome, 'timeout');
  assert.equal(res.timed_out, true);
  assert.equal(res.exit_code, null);
  const calls8 = f.calls().map((c) => c.args.join(' '));
  const at = calls8.lastIndexOf(calls8.find((c) => c.startsWith('rm -f -v c9')));
  assert.ok(at > calls8.findIndex((c) => c.includes(' exec ')) && calls8[at + 1].includes(' down -v --remove-orphans'), calls8.slice(-8).join(' / '));
  assert.ok(res.duration_ms < 8_000, `${res.duration_ms} ms`);
});

test('14c T9: the result: output tail capped and redacted, the output folder listed without following links, stored', async () => {
  const r = installed();
  const token = `sk-ant-oat01-${'Zx9_-q'.repeat(16)}`;
  writeToken(r.env, token);
  const gh = `ghp_${'a1B2'.repeat(9)}`;
  const f = fakeDocker({ resolved: resolvedApp(), execOut: `${'x'.repeat(70 * 1024)}\nleaked ${token} and ${gh}\n` });
  const res = await runTest({ cwd: r.root, env: r.env, name: 'unit', docker: f.docker });
  assert.equal(res.output.truncated, true);
  assert.ok(Buffer.byteLength(res.output.tail) <= 64 * 1024);
  assert.ok(!res.output.tail.includes(token) && !res.output.tail.includes(gh));
  assert.match(res.output.tail, /<redacted:login-token>.*<redacted:github-token>/s);
  assert.match(res.output.tail, /to-stderr/);
  const stored = JSON.parse(readFileSync(join(res.dir, 'result.json'), 'utf8'));
  assert.equal(stored.outcome, 'pass');
  assert.equal(stored.images.app, 'sha256:0123');
  assert.match(stored.tree.hash, /^[0-9a-f]{64}$/);
  assert.equal(redact('a TOKEN b', { token: 'TOKEN' }), 'a <redacted:login-token> b');
  // Terminal codes are removed, also when they'd split a token.
  assert.equal(redact('\x1b[32;1m✓\x1b[39;22m ok \x1b]0;title\x07T\x1b[0mOKEN', { token: 'TOKEN' }), '✓ ok <redacted:login-token>');
  // The output folder: regular files only, links never followed.
  const out = join(res.dir, 'out');
  execFileSync('/bin/chmod', ['u+w', out]);
  mkdirSync(join(out, 'reports'));
  writeFileSync(join(out, 'reports', 'junit.xml'), '<x/>');
  symlinkSync('/etc/passwd', join(out, 'passwd'));
  const f2 = fakeDocker({ resolved: resolvedApp() });
  const res2 = await runTest({ cwd: r.root, env: r.env, name: 'unit', docker: f2.docker });
  writeFileSync(join(res2.dir, 'out', 'a.xml'), '<a/>');
  symlinkSync('/etc', join(res2.dir, 'out', 'etc'));
  assert.deepEqual(res2.out_files, []);
});

test('14c T10: config: the new fields validate; an unknown name is refused with the list; a level needs a service', () => {
  const load = (extra) => checkConfig([{ kind: 'project', file: { ...parseToml(`schema_version = 1\n[git]\nintegration_branch = "main"\n${extra}`, { source: 'c', positions: true }), source: 'c' } }]).config;
  const config = load(CONFIG);
  assert.deepEqual(findTarget(config, 'unit'), { kind: 'level', name: 'unit', service: 'app', command: ['run-tests'], workdir: null, timeoutMinutes: 15, run: 'exec', adapter: null, reportRoot: null });
  assert.deepEqual(findTarget(config, 'lint'), { kind: 'check', name: 'lint', service: 'app', command: ['lint-it'], workdir: '/w', timeoutMinutes: 15, run: 'oneoff', adapter: null, reportRoot: null });
  assert.throws(() => findTarget(config, 'nope'), (e) => e.code === 'unknown-test' && e.exitCode === EXIT.USAGE && /unit, lint, bare/.test(e.hint));
  assert.throws(() => findTarget(config, 'bare'), (e) => e.code === 'no-service');
  for (const [bad, re] of [['[compose]\nallow = ["privileged"]\n', /allow/], ['[[testing.levels]]\nname = "u"\ncommand = ["x"]\nservice = "app"\nworkdir = "rel"\n', /workdir/],
    ['[[testing.levels]]\nname = "u"\ncommand = ["x"]\nrun = "shell"\n', /run/], ['[[testing.levels]]\nname = "u"\ncommand = ["x"]\ntimeout_minutes = 0\n', /timeout_minutes/],
    ['[compose]\noutput = "relative/out"\n', /output/]]) {
    assert.throws(() => load(bad), (e) => e.errors.some((x) => re.test(x.path)), bad);
  }
});

test('14c T11: mirai test: output, exit codes for pass, fail, timeout and refusal, --path', async () => {
  const r = installed({ files: { 'tests/x/a.txt': '' } });
  const run = async (args, docker) => {
    let out = '';
    let err = '';
    const io = { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env: r.env, cwd: r.root, docker };
    return { code: await main(['test', ...args], io, COMMANDS), out, err };
  };
  const pass = await run(['unit', '--path', 'tests/x'], fakeDocker({ resolved: resolvedApp(), execOut: 'all good\n' }).docker);
  assert.equal(pass.code, EXIT.OK);
  assert.match(pass.out, /all good[\s\S]*unit: passed in \d+ s\n {2}service app, \d+ files copied \(tree [0-9a-f]{12}\), base [0-9a-f]{12}/);
  const fail = await run(['unit'], fakeDocker({ resolved: resolvedApp(), execCode: 2 }).docker);
  assert.equal(fail.code, EXIT.FAILURE);
  assert.match(fail.out, /unit: failed \(exit 2\)/);
  const refused = await run(['unit'], fakeDocker({ resolved: resolvedApp({ privileged: true }) }).docker);
  assert.equal(refused.code, EXIT.BLOCKED);
  assert.match(refused.err, /service app: privileged/);
  const unknown = await run(['nope'], fakeDocker({ resolved: resolvedApp() }).docker);
  assert.equal(unknown.code, EXIT.USAGE);
  assert.match(unknown.err, /configured: unit, lint, bare/);
});

test('14c T12: the Docker probe scenarios stay canary-only and local', () => {
  const list = scenarios();
  assert.ok(list.length >= 20);
  for (const s of list) guardScenario(s);
  assert.throws(() => guardScenario({ id: 'x', compose: { services: { a: { image: 'alpine:latest' } } } }), /isn't a local probe image/);
  assert.throws(() => guardScenario({ id: 'x', compose: { services: { a: { image: 'nginx:1.27-alpine', volumes: ['/Users:/u'] } } } }), /outside the fixture/);
  assert.ok(list.filter((s) => s.refused).length >= 10, 'refusal scenarios');
});

test('14c T13: the test runner is stack-neutral: no language, framework or tool names in src/tests/ or src/mcp/ (14d), src/mcp/tools/ (15a), src/detect/ (17a), src/baseline/ (17b) and src/redteam/ (18a)', () => {
  const dirs = ['../../src/tests/', '../../src/mcp/', '../../src/mcp/tools/', '../../src/detect/', '../../src/baseline/', '../../src/redteam/'].map((d) => new URL(d, import.meta.url).pathname);
  const STACK = /\b(php|laravel|artisan|composer|phpunit|pest|npm|npx|yarn|pnpm|node_modules|vitest|jest|playwright|python|pytest|django|pip|ruby|rails|rspec|bundler|golang|cargo|rust|java|maven|gradle|dotnet|mysql|postgres|redis|APP_ENV|RAILS_ENV|NODE_ENV|DJANGO_SETTINGS_MODULE|vendor)\b/i;
  for (const [dir, name] of dirs.flatMap((d) => readdirSync(d).filter((n) => n.endsWith('.js')).map((n) => [d, n]))) {
    const text = readFileSync(join(dir, name), 'utf8');
    const m = STACK.exec(text);
    assert.equal(m, null, `${name} names ${m?.[0]}`);
  }
});

test('14c T14: the review fixes: nested binds get their own copy; links and ".." in bind sources; explicit keys; typed results; caps; one run at a time; stale sweeps; a linked compose file on main', async () => {
  const { nestedBinds, plainBindInside } = await import('../../src/tests/compose.js');
  const { listOut } = await import('../../src/tests/run.js');
  // nestedBinds: a bind strictly inside another service's writable bind; read-only or same-service ones don't count.
  const c = { services: {
    app: { volumes: [{ type: 'bind', source: '/c/backend' }, { type: 'bind', source: '/c/backend/storage' }] },
    web: { volumes: [{ type: 'bind', source: '/c/backend/public', read_only: true }, { type: 'bind', source: '/c/docker/conf' }] },
    ro: { volumes: [{ type: 'bind', source: '/c/docker', read_only: true }] },
    same: { volumes: [{ type: 'bind', source: '/c/backend' }] },
  } };
  assert.deepEqual(nestedBinds(c).map((b) => `${b.service}:${b.source}`), ['app:/c/backend/storage', 'web:/c/backend/public']);
  // plainBindInside: plain real paths only.
  const copy = tempDir('copy');
  mkdirSync(join(copy, 'real'));
  const outside = tempDir('outside');
  symlinkSync(outside, join(copy, 'abs'));
  symlinkSync('real', join(copy, 'rel'));
  assert.equal(plainBindInside(join(copy, 'real'), [copy]), true);
  assert.equal(plainBindInside(join(copy, 'not-yet', 'x'), [copy]), true);
  for (const bad of [join(copy, 'abs'), join(copy, 'abs', 'sub'), join(copy, 'rel'), `${copy}/../x`, `${copy}/./real`, 'relative/path', outside]) assert.equal(plainBindInside(bad, [copy]), false, bad);
  // The prescan refuses explicit keys.
  for (const text of ['? env_file\n: /Users/me/.env\n', 'services:\n  a:\n    ? >-\n      include\n    : [x]\n', '- ? x\n']) {
    assert.throws(() => prescan(text, 'c.yml'), (e) => e.code === 'compose-prescan' && /explicit YAML key/.test(e.message), text);
  }
  // A nested bind in a real run: its own copy, outside the tree, recorded in the result.
  const r = installed();
  const resolved = resolvedApp({}, {});
  resolved.services.app.volumes = [{ type: 'bind', source: '@COPY@', target: '/w', bind: {} }];
  resolved.services.web = { image: 'nginx:1.27-alpine', networks: { default: null }, volumes: [{ type: 'bind', source: '@COPY@/.mirai', target: '/m', read_only: true, bind: {} }] };
  const f = fakeDocker({ resolved });
  const res = await runTest({ cwd: r.root, env: r.env, name: 'unit', docker: f.docker });
  assert.deepEqual(res.isolated_binds, ['web: .mirai']);
  const frozen = JSON.parse(readFileSync(join(res.dir, 'compose.frozen.json'), 'utf8'));
  assert.match(frozen.services.web.volumes[0].source, /\/binds\/0\/\.mirai$/);
  assert.equal(existsSync(join(res.dir, 'binds')), false, 'removed after the run');
  // A stack that doesn't start: an environment fault (exit 5), with a stored, typed result.
  const down = fakeDocker({ resolved: resolvedApp(), upCode: 1 });
  const err = await runTest({ cwd: r.root, env: r.env, name: 'unit', docker: down.docker }).catch((e) => e);
  assert.deepEqual([err.code, err.exitCode, err.result.outcome], ['stack-down', EXIT.NEEDS_HUMAN, 'env-fault']);
  assert.equal(JSON.parse(readFileSync(join(err.result.dir, 'result.json'), 'utf8')).outcome, 'env-fault');
  // The output folder's caps: count, bytes, depth.
  const o = tempDir('out');
  for (let i = 0; i < 5; i++) writeFileSync(join(o, `f${i}`), 'x'.repeat(10));
  let deep = o;
  for (let i = 0; i < 4; i++) { deep = join(deep, `d${i}`); mkdirSync(deep); }
  writeFileSync(join(deep, 'deep.txt'), 'x');
  assert.deepEqual(listOut(o, { files: 100, bytes: 1000, depth: 10 }).overCap, false);
  assert.equal(listOut(o, { files: 3, bytes: 1000, depth: 10 }).overCap, true);
  assert.equal(listOut(o, { files: 100, bytes: 25, depth: 10 }).overCap, true);
  assert.equal(listOut(o, { files: 100, bytes: 1000, depth: 3 }).overCap, true);
  // One run at a time per repo.
  const { acquireLock } = await import('../../src/store/files.js');
  const { openStore } = await import('../../src/store/home.js');
  const store = openStore({ cwd: r.root, env: r.env });
  const held = acquireLock(join(store.dir, 'locks', 'tests.lock'), 'test');
  try {
    await assert.rejects(runTest({ cwd: r.root, env: r.env, name: 'unit', waitMs: 300, docker: fakeDocker({ resolved: resolvedApp() }).docker }), (e) => e.code === 'test-busy');
  } finally {
    held.release();
  }
  // A crashed run's containers are swept before the next run, by its project.
  const stale = fakeDocker({ resolved: resolvedApp() });
  const staleDir = stale.docker.client.slice(0, -'/docker'.length);
  writeFileSync(join(staleDir, 'docker'), readFileSync(join(staleDir, 'docker'), 'utf8').replace('case " $* " in', `case " $* " in\n  *" --filter label=mirai.repo="*) echo mirai-old-t-20260101-000000-abcdef ;;`));
  await runTest({ cwd: r.root, env: r.env, name: 'unit', docker: stale.docker });
  assert.ok(stale.calls().some((x) => x.args.join(' ') === 'network ls -q --filter label=com.docker.compose.project=mirai-old-t-20260101-000000-abcdef'));
  // A compose file that is a link on main: the snapshot still builds; the test run says so.
  const l = installed();
  gitIn(l.root, l.home)('rm', '-q', 'compose.yml');
  writeFileSync(join(l.root, 'real-compose.yml'), COMPOSE);
  symlinkSync('real-compose.yml', join(l.root, 'compose.yml'));
  gitIn(l.root, l.home)('add', '-A');
  gitIn(l.root, l.home)('commit', '-qm', 'linked compose');
  snapshot({ cwd: l.root, env: l.env });
  await assert.rejects(runTest({ cwd: l.root, env: l.env, name: 'unit', docker: fakeDocker({ resolved: resolvedApp() }).docker }), (e) => e.code === 'no-compose' && /not as a link/.test(e.hint));
});

test('14d T6/T9: a cancelled run kills its Docker call and still cleans up; mirai test --gate signs on a clean tree on the branch; agent runs never', { timeout: 180_000 }, async () => {
  const { createKeyPair, writePublicKeyFile, branchKeys } = await import('../../src/sign/keys.js');
  const { verifyTestResult } = await import('../../src/tests/sign.js');
  const { openStore } = await import('../../src/store/home.js');
  const r = installed();
  // Cancelled during the test command: the client (and its children) killed, then rm -f and down -v.
  const f = fakeDocker({ resolved: resolvedApp(), execSleep: 8, execPs: 'c9' });
  const controller = new AbortController();
  const watch = setInterval(() => {
    if (f.calls().some((c) => c.args.includes('exec'))) {
      clearInterval(watch);
      setTimeout(() => {
        abortedAt = Date.now();
        controller.abort();
      }, 300);
    }
  }, 50);
  let abortedAt = null;
  const err = await runTest({ cwd: r.root, env: r.env, name: 'unit', docker: f.docker, signal: controller.signal }).catch((e) => e);
  assert.deepEqual([err.code, err.result.outcome], ['cancelled', 'env-fault']);
  clearInterval(watch);
  // The fake test sleeps 8 s: the run ends well before, cleanup included.
  assert.ok(abortedAt && Date.now() - abortedAt < 6000, `${Date.now() - abortedAt} ms after the abort`);
  const calls = f.calls().map((c) => c.args.join(' '));
  const exec = calls.findIndex((c) => c.includes(' exec '));
  assert.ok(exec > 0);
  assert.ok(calls.slice(exec).some((c) => c.startsWith('rm -f -v c9')) && calls.slice(exec).some((c) => c.includes(' down -v')), calls.slice(exec).join(' / '));

  // The gate: your key, committed on main.
  const key = createKeyPair(r.env);
  writePublicKeyFile(r.root, key.keyId, key.publicPem);
  r.git('add', '-A');
  r.git('commit', '-qm', 'key');
  const run = async (args, docker) => {
    let out = '';
    let errText = '';
    const io = { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (errText += s) }, env: r.env, cwd: r.root, docker };
    return { code: await main(['test', ...args], io, COMMANDS), out, err: errText };
  };
  const docker = () => fakeDocker({ resolved: resolvedApp() }).docker;
  assert.equal((await run(['unit', '--gate'], docker())).code, EXIT.USAGE);
  const wrong = await run(['unit', '--gate', '--branch', 'release'], docker());
  assert.match(wrong.err, /HEAD is on main, not release/);
  writeFileSync(join(r.root, 'new.txt'), 'x\n');
  const dirty = await run(['unit', '--gate', '--branch', 'main'], docker());
  assert.match(dirty.err, /isn't clean \(1 changed, staged or new file\)/);
  rmSync(join(r.root, 'new.txt'));
  writeFileSync(join(r.root, '.env'), 'IGNORED=1\n'); // ignored files don't count
  const ok = await run(['unit', '--gate', '--branch', 'main'], docker());
  assert.equal(ok.code, EXIT.OK, ok.err);
  assert.match(ok.out, new RegExp(`signed with ${key.keyId} for main at [0-9a-f]{12}`));
  const store = openStore({ cwd: r.root, env: r.env });
  const dir = join(store.dir, 'tests');
  const latest = readdirSync(dir).filter((n) => n.startsWith('t-')).sort().at(-1);
  const signed = JSON.parse(readFileSync(join(dir, latest, 'result.json'), 'utf8'));
  const keys = branchKeys(r.root, 'main', r.env);
  assert.deepEqual(verifyTestResult(signed, keys, store.repoId), { ok: true, keyId: key.keyId });
  assert.equal(signed.gate.head, r.git('rev-parse', 'HEAD'));
  assert.match(signed.frozen_sha256, /^[0-9a-f]{64}$/);
  assert.equal(signed.trust_manifest_sha256.length, 64);
  for (const tamper of [{ outcome: 'fail' }, { tree: { ...signed.tree, hash: '0'.repeat(64) } }, { gate: { ...signed.gate, branch: 'x' } }, { frozen_sha256: '0'.repeat(64) }]) {
    assert.equal(verifyTestResult({ ...signed, ...tamper }, keys, store.repoId).ok, false, JSON.stringify(tamper));
  }
  assert.equal(verifyTestResult(signed, keys, 'another-repo').ok, false, 'bound to this repo');
  assert.equal(verifyTestResult(signed, new Map(), store.repoId).ok, false, 'another key');
  // An agent's run is never signed, even if asked.
  const agent = await runTest({ cwd: r.root, env: r.env, name: 'unit', docker: docker(), by: 'agent', gate: { branch: 'main', head: 'x', signer: null } });
  assert.equal(agent.signature, undefined);
  assert.equal(agent.by, 'agent');
  assert.match(verifyTestResult(agent, keys, store.repoId).reason, /not a gate run/);
});

test('14d review fixes: the gate is checked again after the copy and before signing; no --path; skipped files; signed results kept apart; the launch id; one deadline for waiting', { timeout: 180_000 }, async () => {
  const { createKeyPair, writePublicKeyFile, branchKeys } = await import('../../src/sign/keys.js');
  const { loadSigner } = await import('../../src/sign/signer.js');
  const { verifyTestResult } = await import('../../src/tests/sign.js');
  const { gateCheck } = await import('../../src/tests/gate.js');
  const { openStore } = await import('../../src/store/home.js');
  const { acquireLock } = await import('../../src/store/files.js');
  const r = installed();
  const key = createKeyPair(r.env);
  writePublicKeyFile(r.root, key.keyId, key.publicPem);
  writeFileSync(join(r.root, 'tracked.txt'), 'one\n');
  r.git('add', '-A');
  r.git('commit', '-qm', 'key');
  const store = openStore({ cwd: r.root, env: r.env });
  const docker = () => fakeDocker({ resolved: resolvedApp() }).docker;
  const run = async (args) => {
    let errText = '';
    const io = { stdout: { write: () => {} }, stderr: { write: (s) => (errText += s) }, env: r.env, cwd: r.root, docker: docker() };
    return { code: await main(['test', ...args], io, COMMANDS), err: errText };
  };
  // --gate runs a whole level: no --path.
  const withPath = await run(['unit', '--gate', '--branch', 'main', '--path', 'tracked.txt']);
  assert.deepEqual([withPath.code, /takes no --path/.test(withPath.err)], [EXIT.USAGE, true]);
  // A changed tracked file, a staged one, and a file git status skips are all refused.
  writeFileSync(join(r.root, 'tracked.txt'), 'two\n');
  assert.match((await run(['unit', '--gate', '--branch', 'main'])).err, /isn't clean/);
  r.git('add', 'tracked.txt');
  assert.match((await run(['unit', '--gate', '--branch', 'main'])).err, /isn't clean/);
  r.git('reset', '-q', '--hard');
  r.git('update-index', '--assume-unchanged', 'tracked.txt');
  writeFileSync(join(r.root, 'tracked.txt'), 'hidden\n');
  assert.match((await run(['unit', '--gate', '--branch', 'main'])).err, /assume-unchanged or skip-worktree/);
  r.git('update-index', '--no-assume-unchanged', 'tracked.txt');
  r.git('checkout', '-q', '--', 'tracked.txt');
  r.git('update-index', '--skip-worktree', 'tracked.txt');
  assert.match((await run(['unit', '--gate', '--branch', 'main'])).err, /assume-unchanged or skip-worktree/);
  r.git('update-index', '--no-skip-worktree', 'tracked.txt');

  // Checked before the run, but changed while it waited: refused after the copy, never signed.
  const signer = loadSigner(r.env, store);
  const gated = (onTurn) => runTest({ cwd: r.root, env: r.env, name: 'unit', docker: docker(), gate: { ...gateCheck(r.root, 'main', r.env), signer }, onTurn }).catch((e) => e);
  const edited = await gated(() => writeFileSync(join(r.root, 'tracked.txt'), 'edited while waiting\n'));
  assert.deepEqual([edited.code, edited.result.outcome, edited.result.signature], ['gate-dirty', 'refused', undefined]);
  r.git('checkout', '-q', '--', 'tracked.txt');
  const moved = await gated(() => {
    writeFileSync(join(r.root, 'tracked.txt'), 'committed while waiting\n');
    r.git('commit', '-qam', 'moved');
  });
  assert.deepEqual([moved.code, moved.result.signature], ['gate-dirty', undefined]);
  assert.match(moved.message, /HEAD moved during the run/);

  // A clean gate run: signed, and kept in tests/gate/, where agents' runs can't prune it.
  const ok = await runTest({ cwd: r.root, env: r.env, name: 'unit', docker: docker(), gate: { ...gateCheck(r.root, 'main', r.env), signer } });
  const gateDir = join(store.dir, 'tests', 'gate');
  assert.deepEqual(readdirSync(gateDir), [`${ok.id}.json`]);
  const kept = JSON.parse(readFileSync(join(gateDir, `${ok.id}.json`), 'utf8'));
  assert.deepEqual(verifyTestResult(kept, branchKeys(r.root, 'main', r.env), store.repoId), { ok: true, keyId: key.keyId });
  assert.equal(verifyTestResult({ ...kept, path: 'tracked.txt' }, branchKeys(r.root, 'main', r.env), store.repoId).ok, false);
  for (let i = 0; i < 25; i++) mkdirSync(join(store.dir, 'tests', `t-20200101-0000${String(i).padStart(2, '0')}-abcdef`));
  const agent = await runTest({ cwd: r.root, env: r.env, name: 'unit', docker: docker(), by: 'agent', launchId: '20261027120000-0123abcd' });
  assert.equal(readdirSync(join(store.dir, 'tests')).filter((n) => n.startsWith('t-')).length, 20, 'pruned to the last 20');
  assert.deepEqual(readdirSync(gateDir), [`${ok.id}.json`], 'the signed result survives');
  assert.equal(agent.launch_id, '20261027120000-0123abcd');
  assert.equal(ok.launch_id, undefined);

  // Waiting: one deadline for the repo's turn and a machine slot, and "waiting" said once.
  const held = acquireLock(join(store.dir, 'locks', 'tests.lock'), 'test');
  setTimeout(() => held.release(), 2500);
  const slots = join(r.env.HOME, 'Library', 'Application Support', 'mirai', 'locks', 'test-slots');
  mkdirSync(slots, { recursive: true });
  const slot = acquireLock(join(slots, '0.lock'), 'test');
  let told = 0;
  let t0 = null;
  try {
    await assert.rejects(runTest({ cwd: r.root, env: r.env, name: 'unit', docker: docker(), waitMs: 3000, maxParallel: 1, onWait: () => { told++; t0 = Date.now(); } }), (e) => e.code === 'test-busy');
  } finally {
    slot.release();
  }
  const waited = Date.now() - t0;
  // Separate deadlines: about 3 s for the lock (1 s polls), then 3 for the slot; one deadline:
  // 3 s in all, plus at most one poll.
  assert.ok(waited < 4800, `waited ${waited} ms against a 3000 ms deadline`);
  assert.equal(told, 1);
});
