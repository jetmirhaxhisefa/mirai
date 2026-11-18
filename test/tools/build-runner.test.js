import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRequest, selectCases, Refused } from '../../tools/build-runner/requests.js';
import { scrubbedEnv, sampleEnv } from '../../tools/build-runner/env.js';
import { Runner, checkMiraiRepo, jobCommand, probeKey, sampleReady, ensureFolders, sandboxed, sandboxProfile } from '../../tools/build-runner/runner.js';
import { realpathSync } from 'node:fs';
import { userInfo } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fromRunner, newRunnerId, readRunnerRecord, removeRunnerRecord, writeRunnerRecord, parentChain, RUNNER_ID } from '../../src/cli/runner-proof.js';
import { requireTty } from '../../src/cli/tty.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SHA = 'a'.repeat(40);
const tmp = () => mkdtempSync(join(tmpdir(), 'mirai-29e-'));
const refuses = (fn, re) => assert.throws(fn, (err) => err instanceof Refused && re.test(err.message));

test('T1: requests outside the fixed list are refused', () => {
  const ok = parseRequest(JSON.stringify({ id: 'r-1', job: 'redteam-cases', commit: SHA, arg: 'hook' }));
  assert.deepEqual(ok, { id: 'r-1', job: 'redteam-cases', commit: SHA, arg: 'hook' });
  refuses(() => parseRequest('{'), /JSON/);
  refuses(() => parseRequest(JSON.stringify({ id: 'r', job: 'deploy', commit: SHA })), /unknown job/);
  refuses(() => parseRequest(JSON.stringify({ id: 'r', job: 'tests', commit: SHA, cmd: 'rm' })), /unknown fields: cmd/);
  refuses(() => parseRequest(JSON.stringify({ id: 'r', job: 'tests', commit: 'abc' })), /40-character/);
  refuses(() => parseRequest(JSON.stringify({ id: 'R/1', job: 'tests', commit: SHA })), /id/);
  refuses(() => parseRequest(JSON.stringify({ id: 'r', job: 'tests', commit: SHA, arg: 'x' })), /takes no argument/);
  for (const arg of ['../x', 'a/b', '--force', '-x', '', 'a..b']) {
    refuses(() => parseRequest(JSON.stringify({ id: 'r', job: 'redteam-cases', commit: SHA, arg })), /never a path or a flag/);
  }
  refuses(() => parseRequest(JSON.stringify({ id: 'r', job: 'probes', commit: SHA, arg: 'harness.test.js' })), /test\/probes/);
  refuses(() => parseRequest(JSON.stringify({ id: 'r', job: 'sample-run', commit: SHA, arg: 'run.sh' })), /tools\/runs/);
});

test('T1: a commit on no branch of origin is refused; a sample-run script not on main is refused', async () => {
  const paths = { requests: tmp(), results: tmp(), work: tmp(), probeCache: tmp(), log: join(tmp(), 'runner.log') };
  const gitFn = (cwd, args) => {
    if (args[0] === 'branch') return { status: 0, stdout: '', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  const runner = new Runner({ env: { HOME: tmp(), PATH: process.env.PATH }, repo: '/r', sample: '/s', runnerId: newRunnerId(), paths, say: () => {}, deps: { git: gitFn } });
  writeFileSync(join(paths.requests, 'a.json'), JSON.stringify({ id: 'r-2', job: 'tests', commit: SHA }));
  const r = await runner.handle('a.json');
  assert.equal(r.state, 'refused');
  assert.match(r.summary, /isn't on any branch of origin/);
  assert.match(readFileSync(paths.log, 'utf8'), /r-2 \| tests \| aaaaaaaaaaaa \| - \| - \| refused/);
  // sample-run: the script comes from origin/main only.
  const missing = new Runner({ env: {}, repo: '/r', sample: '/s', runnerId: newRunnerId(), paths, say: () => {}, deps: { git: () => ({ status: 128, stdout: '', stderr: 'fatal' }) } });
  refuses(() => missing.mainScript('r9.js', tmp()), /isn't on MIRAI's main/);
  // An unknown job is logged as refused too.
  writeFileSync(join(paths.requests, 'b.json'), JSON.stringify({ id: 'r-3', job: 'shell', commit: SHA }));
  assert.equal((await runner.handle('b.json')).state, 'refused');
  assert.match(readFileSync(paths.log, 'utf8'), /r-3 \| - \| aaaaaaaaaaaa .*refused: unknown job/);
});

test('the branch named for a commit: its tip first, then a unit branch', async () => {
  const { checkCommit } = await import('../../tools/build-runner/runner.js');
  const gitFn = (cwd, args) => {
    if (args[0] === 'branch') return { status: 0, stdout: 'origin/main\norigin/probe/x\norigin/unit/29e\n', stderr: '' };
    if (args[0] === 'rev-parse') return { status: 0, stdout: args[1] === 'origin/unit/29e' ? `${SHA}\n` : 'b'.repeat(40), stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  assert.equal(checkCommit('/r', SHA, {}, { gitFn }).branch, 'unit/29e');
  const noTip = (cwd, args) => (args[0] === 'rev-parse' ? { status: 0, stdout: 'c'.repeat(40), stderr: '' } : gitFn(cwd, args));
  assert.equal(checkCommit('/r', SHA, {}, { gitFn: noTip }).branch, 'unit/29e');
});

test('a quiet job prints a "still running" line with its latest output', async () => {
  const { runLogged } = await import('../../tools/build-runner/runner.js');
  const beats = [];
  const log = join(tmp(), 'job.log');
  const r = await runLogged(process.execPath, ['-e', "console.log('step one'); setTimeout(() => console.log('done'), 1500)"], { cwd: tmp(), env: { PATH: process.env.PATH }, log, minutes: 1, every: 200, onBeat: (b) => beats.push(b) });
  assert.equal(r.status, 0);
  assert.ok(beats.length >= 2, `beats: ${beats.length}`);
  assert.ok(beats.some((b) => b.last === 'step one'), JSON.stringify(beats));
});

test('T2: a fact selects exactly its cases; ids pass; an unknown fact is refused', () => {
  const cases = [{ id: 'a', fact: 'hook' }, { id: 'b', fact: 'D-30, hook' }, { id: 'c', fact: 'bundle' }, { id: 'd', fact: 'hooks' }];
  assert.deepEqual(selectCases('hook', cases), ['a', 'b']);
  assert.deepEqual(selectCases('c,a', cases), ['c', 'a']);
  refuses(() => selectCases('nothing', cases), /no case has the fact/);
});

test('T3: redteam-cases runs with --only (a partial run, never recorded); redteam-full without', () => {
  const ctx = { exportDir: '/x', sample: '/s', cases: [{ id: 'h1', fact: 'hook' }, { id: 'h2', fact: 'hook' }] };
  const c = jobCommand('redteam-cases', 'hook', ctx);
  assert.deepEqual(c.args.slice(1), ['redteam', 'run', '--only', 'h1,h2']);
  assert.equal(c.input, 'y\n');
  assert.ok(!jobCommand('redteam-full', null, ctx).args.includes('--only'));
  // The red team's own rule: a run with --only is reported, never recorded (18a).
  const src = readFileSync(join(ROOT, 'src', 'cli', 'commands', 'redteam.js'), 'utf8');
  assert.match(src, /a partial run is reported, never recorded/);
});

test('T4: a tests job gets no credential and a home of its own; sample jobs keep HOME, lose credentials', () => {
  const env = { HOME: '/Users/me', PATH: '/bin', SSH_AUTH_SOCK: '/s', GH_TOKEN: 't', GITHUB_TOKEN: 't', GLAB_CONFIG_DIR: '/g', CLAUDE_CODE_OAUTH_TOKEN: 't', GIT_ASKPASS: '/a', ANTHROPIC_API_KEY: 'k', LANG: 'en' };
  const s = scrubbedEnv(env, { home: '/job/home', tmp: '/job/tmp' });
  assert.deepEqual(s, { HOME: '/job/home', TMPDIR: '/job/tmp', PATH: '/bin', LANG: 'en' });
  const t = sampleEnv(env, { MIRAI_BUILD_RUNNER: 'b-1' });
  assert.equal(t.HOME, '/Users/me');
  for (const k of ['SSH_AUTH_SOCK', 'GH_TOKEN', 'GITHUB_TOKEN', 'GLAB_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'GIT_ASKPASS', 'ANTHROPIC_API_KEY']) assert.equal(t[k], undefined, k);
  assert.equal(t.MIRAI_BUILD_RUNNER, 'b-1');
  // The red team keeps your SSH agent (its S5 control), nothing else.
  const rt = sampleEnv(env, {}, { keepSshAgent: true });
  assert.equal(rt.SSH_AUTH_SOCK, '/s');
  assert.equal(rt.GH_TOKEN, undefined);
});

test('a partial red-team run passes when every case in its report passed', async () => {
  const { partialState } = await import('../../tools/build-runner/runner.js');
  const tail = (rows) => `red team: INCOMPLETE (a partial run: reported, not recorded)\n${rows}\nwithout a model:\n  S5 unknown  x\n`;
  assert.equal(partialState({ status: 3, tail: tail('  hook-a (read-write)  pass         3/3\n  hook-b (read-write)    pass  3/3') }), 'pass');
  assert.equal(partialState({ status: 3, tail: tail('  hook-a (read-write)  pass         3/3\n  hook-b (read-write)    inconclusive  1/3') }), 'fail');
  assert.equal(partialState({ status: 3, tail: tail('') }), 'fail');
});

test('T4: the tests job runs in a sandbox that closes your real home but its own folder', { skip: process.platform !== 'darwin' }, () => {
  assert.match(sandboxProfile({ home: '/Users/a "b"', open: ['/w'] }), /\(deny file-read\* file-write\* \(subpath "\/Users\/a \\"b\\""\)\)/);
  const home = realpathSync(userInfo().homedir);
  const canary = join(home, `.mirai-29e-canary-${randomBytes(4).toString('hex')}`);
  try {
    writeFileSync(canary, 'canary');
  } catch (err) {
    // Already inside the build runner's own sandbox: the home is closed, which is the point.
    if (err.code === 'EPERM') return;
    throw err;
  }
  const job = realpathSync(tmp());
  try {
    const c = sandboxed({ cmd: process.execPath, args: ['-e', `let r='denied';try{require('fs').readFileSync(${JSON.stringify(canary)});r='READ'}catch{};require('fs').writeFileSync('own.txt','ok');process.stdout.write(r)`], cwd: job }, job);
    const out = execFileSync(c.cmd, c.args, { cwd: job, encoding: 'utf8' });
    assert.equal(out, 'denied');
    assert.equal(readFileSync(join(job, 'own.txt'), 'utf8'), 'ok');
  } finally {
    rmSync(canary, { force: true });
  }
});

test('T5: the runner proof covers the red team only, while the runner lives, from its own children', () => {
  const dir = tmp();
  const store = { dir };
  const id = newRunnerId();
  assert.match(id, RUNNER_ID);
  assert.throws(() => writeRunnerRecord(store, { id, pid: 4242, commands: ['plan'] }), /can't cover plan/);
  writeRunnerRecord(store, { id, pid: 4242, commands: ['redteam run'] });
  assert.equal(readRunnerRecord(store, id).pid, 4242);
  const base = { env: { MIRAI_BUILD_RUNNER: id }, openStore: () => store, isAlive: () => true };
  assert.equal(fromRunner({ ...base, command: 'redteam run', chain: () => [111, 4242] }), true);
  assert.equal(fromRunner({ ...base, command: 'redteam run', chain: () => [111, 222] }), false, 'outside the chain');
  assert.equal(fromRunner({ ...base, command: 'redteam run --sessions', chain: () => [4242] }), false, 'a command the record doesn\'t name');
  assert.equal(fromRunner({ ...base, command: 'plan', chain: () => [4242] }), false, 'never a non-red-team command');
  assert.equal(fromRunner({ ...base, command: 'redteam run', chain: () => [4242], isAlive: () => false }), false, 'a dead runner');
  assert.equal(fromRunner({ ...base, env: { MIRAI_BUILD_RUNNER: 'x' }, command: 'redteam run', chain: () => [4242] }), false);
  assert.equal(fromRunner({ ...base, env: {}, command: 'redteam run', chain: () => [4242] }), false);
  removeRunnerRecord(store, id);
  assert.equal(fromRunner({ ...base, command: 'redteam run', chain: () => [4242] }), false, 'record removed at stop');
  // The chain walks parents, nearest first.
  const parents = { 10: 20, 20: 30, 30: 40 };
  assert.deepEqual(parentChain({ ppid: 10, depth: 3, parent: (p) => parents[p] ?? null }), [10, 20, 30]);
  // The gates' check never reads it.
  writeRunnerRecord(store, { id, pid: process.ppid, commands: ['redteam run'] });
  assert.throws(() => requireTty({ stdin: {}, stdout: {}, env: { MIRAI_BUILD_RUNNER: id } }, 'mirai approve'), /real terminal/);
});

test('T6: the runner refuses another repo', () => {
  const d = tmp();
  execFileSync('git', ['init', '-q'], { cwd: d });
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'other' }));
  assert.match(checkMiraiRepo(d, process.env), /only in MIRAI's own repo/);
  const fake = (cwd, args) => ({ status: 0, stdout: args[0] === 'remote' ? 'git@github.com:jetmirhaxhisefa/mirai.git\n' : '', stderr: '' });
  assert.equal(checkMiraiRepo(ROOT, process.env, { gitFn: fake }), null);
  const evil = () => ({ status: 0, stdout: 'git@github.com:someone/mirai.git\n', stderr: '' });
  assert.match(checkMiraiRepo(ROOT, process.env, { gitFn: evil }), /only in MIRAI's own repo/);
  // The entry point refuses without a terminal, before anything else.
  const r = (() => {
    try {
      execFileSync(process.execPath, [join(ROOT, 'tools', 'build-runner.js')], { cwd: d, stdio: 'pipe', encoding: 'utf8' });
      return null;
    } catch (err) {
      return err;
    }
  })();
  assert.ok(r && /real terminal/.test(r.stderr));
});

test('T7: the installed file set has no tools/', () => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, npm_config_cache: tmp() } });
  const files = JSON.parse(out)[0].files.map((f) => f.path);
  assert.ok(files.length > 10);
  assert.equal(files.filter((p) => p.startsWith('tools/')).length, 0);
});

test('T8: a probe result is reused until its file or a tool version changes', async () => {
  const v1 = { claude: '2.1.326', docker: '28.0', git: '2.50', node: 'v22' };
  assert.equal(probeKey('x', v1), probeKey('x', { ...v1 }));
  assert.notEqual(probeKey('x', v1), probeKey('x', { ...v1, claude: '2.1.327' }));
  assert.notEqual(probeKey('x', v1), probeKey('y', v1));
  const home = tmp();
  const paths = { requests: tmp(), results: tmp(), work: tmp(), probeCache: tmp(), log: join(tmp(), 'runner.log') };
  let runs = 0;
  let versions = v1;
  const deps = {
    git: (cwd, args) => ({ status: 0, stdout: args[0] === 'branch' ? 'origin/unit/29e\n' : '', stderr: '' }),
    exportCommit: (repo, commit, dir) => {
      mkdirSync(join(dir, 'test', 'probes'), { recursive: true });
      writeFileSync(join(dir, 'test', 'probes', 'git-probes.js'), 'probe');
    },
    toolVersions: () => versions,
    runLogged: async () => {
      runs += 1;
      return { status: 0, tail: 'all probes pass' };
    },
  };
  const runner = new Runner({ env: { HOME: home, PATH: process.env.PATH }, repo: '/r', sample: '/s', runnerId: newRunnerId(), paths, say: () => {}, deps });
  const ask = async (id) => {
    writeFileSync(join(paths.requests, `${id}.json`), JSON.stringify({ id, job: 'probes', commit: SHA, arg: 'git-probes.js' }));
    return runner.handle(`${id}.json`);
  };
  assert.equal((await ask('p1')).state, 'pass');
  const second = await ask('p2');
  assert.equal(second.state, 'pass');
  assert.ok(second.reused, 'reused');
  assert.equal(runs, 1);
  versions = { ...v1, docker: '29.0' };
  await ask('p3');
  assert.equal(runs, 2);
});

test('T9: a sample checkout that isn\'t ready is refused, and nothing in it changes', () => {
  const origin = tmp();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: origin });
  const s = tmp();
  const g = (...a) => execFileSync('git', a, { cwd: s, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  g('init', '-q', '-b', 'main');
  g('remote', 'add', 'origin', origin);
  writeFileSync(join(s, 'a.txt'), 'a');
  g('add', '.');
  g('commit', '-qm', 'one');
  g('push', '-q', 'origin', 'main');
  assert.equal(sampleReady(s, process.env), null);
  writeFileSync(join(s, 'b.txt'), 'b');
  assert.match(sampleReady(s, process.env), /uncommitted changes/);
  assert.ok(existsSync(join(s, 'b.txt')), 'never cleaned');
  rmSync(join(s, 'b.txt'));
  writeFileSync(join(s, 'a.txt'), 'a2');
  g('commit', '-qam', 'two');
  assert.match(sampleReady(s, process.env), /1 commit\(s\) origin doesn't/);
  g('push', '-q', 'origin', 'main');
  g('switch', '-q', '-c', 'other');
  assert.match(sampleReady(s, process.env), /on "other", not main/);
  assert.equal(g('branch', '--show-current').trim(), 'other');
});

test('the folders are made private', () => {
  const base = tmp();
  const paths = { base, requests: join(base, 'q'), results: join(base, 'r'), work: join(base, 'w'), probeCache: join(base, 'p') };
  ensureFolders(paths);
  for (const d of Object.values(paths)) assert.ok(existsSync(d));
});
