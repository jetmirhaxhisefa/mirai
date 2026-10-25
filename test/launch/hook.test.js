import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decide, hookPolicy, policyText, runHook } from '../../src/launch/hook.js';
import { loadRegistry } from '../../src/config/registry.js';
import { writeToken } from '../../src/sign/token.js';
import { init } from '../../src/install/init.js';
import { snapshot } from '../../src/trust/snapshot.js';

// Unit 13c: the hook.

const temps = [];
after(() => {
  for (const d of temps) {
    spawnSync('chmod', ['-R', 'u+rwX', d]);
    rmSync(d, { recursive: true, force: true });
  }
});
const tempDir = (name) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `mirai-${name}-`)));
  temps.push(d);
  return d;
};
const sha = (t) => createHash('sha256').update(t).digest('hex');
const TOKEN = `sk-ant-oat01-${'Hk4_-r'.repeat(16)}`;
const SECRETS = loadRegistry(new URL('../../registry', import.meta.url).pathname).secrets.core.patterns;

// A checkout with the files the checks are about, and a policy for it.
function world() {
  const root = tempDir('hook');
  const co = join(root, 'app');
  const put = (rel, text = 'x\n') => {
    mkdirSync(join(co, rel, '..'), { recursive: true });
    writeFileSync(join(co, rel), text);
  };
  put('.env', 'APP_KEY=real\n');
  put('sub/.env', 'X=1\n');
  put('.env.example', 'APP_KEY=\n');
  put('.git/config', '[core]\n');
  put('nested/.git/HEAD', 'ref\n');
  put('.mirai/config.toml', '');
  put('src/a.js', 'let a = 1;\n');
  put('.githooks/pre-commit', '#!/bin/sh\n');
  mkdirSync(join(root, 'outside'));
  writeFileSync(join(root, 'outside', 'secret.txt'), 'outside\n');
  symlinkSync('../outside/secret.txt', join(co, 'link-out'));
  const scratch = join(root, 'scratch');
  mkdirSync(scratch);
  const trustDir = join(root, 'trust');
  mkdirSync(trustDir);
  const policy = hookPolicy({
    checkout: co, readRoots: [co, trustDir, scratch], writeRoots: [co, scratch], writeDenied: ['.envrc', '**/.vscode/**', '.npmrc', '**/.husky/**'],
    hooksPaths: [join(co, '.githooks')], readableEnv: [join(co, '.env.example')], protectedFiles: [join(co, '.env'), join(co, 'sub', '.env')],
    trust: null, tokenFile: null, secrets: SECRETS,
  });
  return { root, co, scratch, trustDir, policy };
}
const call = (tool_name, tool_input, cwd) => ({ tool_name, tool_input, cwd });
const refused = (d) => d.allow === false;

test('T1: the path check: roots, .git at any depth, .env*, .mirai, write-denied and hook paths, symlinks, case, ".."', () => {
  const w = world();
  const { co, policy: p } = w;
  const ok = (tool, input) => assert.equal(decide(p, call(tool, input, co)).allow, true, `${tool} ${JSON.stringify(input)}`);
  const no = (tool, input, re) => {
    const d = decide(p, call(tool, input, co));
    assert.ok(refused(d), `${tool} ${JSON.stringify(input)} was allowed`);
    if (re) assert.match(d.reason, re);
  };
  ok('Read', { file_path: join(co, 'src/a.js') });
  ok('Read', { file_path: join(co, '.env.example') });
  ok('Read', { file_path: join(co, '.mirai/config.toml') });
  ok('Write', { file_path: join(co, 'src/new/deep/b.js'), content: 'let b = 2;\n' });
  ok('Write', { file_path: join(w.scratch, 'notes.txt'), content: 'x' });
  ok('Grep', { pattern: 'a', path: join(co, 'src') });
  ok('Glob', { pattern: 'src/**/*.js' });
  ok('Glob', { pattern: 'src/**/*.js', path: co });
  no('Read', { file_path: join(co, '.env') }, /\.env file/);
  no('Read', { file_path: join(co, '.ENV') }, /\.env file/);
  no('Read', { file_path: join(co, 'sub', '.Env') }, /\.env/);
  no('Read', { file_path: join(co, 'link-out') }, /outside the project/);
  no('Read', { file_path: `${co}/src/../../outside/secret.txt` }, /\.\./);
  no('Read', { file_path: 'src/a.js' }, /isn't an absolute path/);
  no('Read', { file_path: 'src/../../outside/secret.txt' }, /absolute|\.\./);
  // Paths Claude Code would read its own way are refused, not guessed at (13c review).
  no('Write', { file_path: '~/.zshrc', content: 'x' }, /starts with ~/);
  no('Read', { file_path: '~/.config/mirai/claude-token' }, /starts with ~/);
  no('Write', { file_path: ` ${join(co, 'src/a.js')}`, content: 'x' }, /space/);
  no('Write', { file_path: `${join(co, 'src/a.js')} `, content: 'x' }, /space/);
  no('Grep', { pattern: 'x', path: '~' }, /starts with ~/);
  no('Glob', { pattern: '~/Library/**' }, /~/);
  no('Glob', { pattern: '**/../../*' }, /~|\.\./);
  no('NotebookEdit', { notebook_path: join(w.root, 'outside', 'n.ipynb'), new_source: 'x' }, /outside the project/);
  // A dangling symlink: writing through it would create its target, wherever that is.
  symlinkSync(join(w.root, 'outside', 'LaunchAgents', 'evil.plist'), join(co, 'notes.txt'));
  no('Write', { file_path: join(co, 'notes.txt'), content: 'x' }, /points nowhere/);
  // A write-denied folder that is itself a symlink elsewhere in the project.
  mkdirSync(join(co, 'scripts', 'hooks'), { recursive: true });
  symlinkSync('scripts/hooks', join(co, '.husky'));
  no('Write', { file_path: join(co, '.husky', 'pre-commit'), content: 'x' }, /runs by itself/);
  no('Read', { file_path: join(w.root, 'outside', 'secret.txt') }, /outside the project/);
  no('Read', { file_path: join(co, '.git/config') }, /\.git/);
  no('Read', { file_path: join(co, '.GIT/config') }, /\.git/);
  no('Edit', { file_path: join(co, 'nested/.git/HEAD'), new_string: 'x' }, /\.git/);
  no('Write', { file_path: join(co, '.mirai/keys/k.pub'), content: 'x' }, /MIRAI's own/);
  // .envrc is refused twice over: it starts with .env (like the sandbox's **/.env* glob; it often
  // holds secrets), and it runs by itself (direnv).
  no('Write', { file_path: join(co, '.envrc'), content: 'x' }, /\.env file|runs by itself/);
  no('Write', { file_path: join(co, '.npmrc'), content: 'x' }, /runs by itself/);
  no('Write', { file_path: join(co, 'web/.vscode/tasks.json'), content: '{}' }, /runs by itself/);
  no('Write', { file_path: join(co, '.githooks/pre-push'), content: 'x' }, /git hooks/);
  no('Write', { file_path: join(co, '.env.example'), content: 'x' }, /\.env/);
  no('Write', { file_path: join(w.trustDir, 'x'), content: 'x' }, /outside the project/);
  no('Grep', { pattern: 'KEY', path: w.root }, /outside the project/);
  no('Glob', { pattern: `${w.root}/outside/*` }, /outside the project/);
  no('Bash', { command: 'ls' }, /isn't a tool/);
  no('Read', {}, /empty path|names no path/);
  // A read-only agent: the checkout isn't a write root.
  const ro = { ...w.policy, writeRoots: [w.scratch] };
  assert.ok(refused(decide(ro, call('Write', { file_path: join(co, 'src/a.js'), content: 'x' }, co))));
});

test('T2: the inode check: a hard link to a protected file is refused under any name', () => {
  const w = world();
  linkSync(join(w.co, '.env'), join(w.co, 'notes.txt'));
  const d = decide(w.policy, call('Read', { file_path: join(w.co, 'notes.txt') }, w.co));
  assert.ok(refused(d));
  assert.match(d.reason, /same file as a protected one/);
  assert.ok(refused(decide(w.policy, call('Edit', { file_path: join(w.co, 'notes.txt'), new_string: 'x' }, w.co))));
  assert.equal(decide(w.policy, call('Read', { file_path: join(w.co, 'src/a.js') }, w.co)).allow, true);
});

test('T3: the secret check: the token in every encoding and each secret shape are refused in what a write tool writes; ordinary code passes', () => {
  const w = world();
  const write = (content, tool = 'Write') => {
    const input = tool === 'Write' ? { file_path: join(w.co, 'src/x.js'), content }
      : tool === 'Edit' ? { file_path: join(w.co, 'src/a.js'), old_string: 'a', new_string: content }
        : tool === 'MultiEdit' ? { file_path: join(w.co, 'src/a.js'), edits: [{ old_string: 'a', new_string: 'ok' }, { old_string: 'b', new_string: content }] }
          : { notebook_path: join(w.co, 'n.ipynb'), new_source: content };
    return decide(w.policy, call(tool, input, w.co), { token: TOKEN });
  };
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) assert.ok(refused(write(`const t = "${TOKEN}";`, tool)), tool);
  for (const form of [Buffer.from(`k=${TOKEN}`).toString('base64'), Buffer.from(TOKEN).toString('hex').toUpperCase(), encodeURIComponent(TOKEN), TOKEN.slice(20, 40)]) {
    assert.match(write(`x = "${form}"`).reason, /login token/, form);
  }
  const samples = {
    'private-key': '-----BEGIN OPENSSH PRIVATE KEY-----', 'aws-access-key': 'AKIAIOSFODNN7EXAMPLE', 'github-token': `ghp_${'a1'.repeat(18)}`,
    'github-fine-grained-token': `github_pat_${'A1b'.repeat(22)}`, 'anthropic-key': `sk-ant-api03-${'z'.repeat(30)}`, 'openai-key': `sk-proj-${'q'.repeat(30)}`,
    'slack-token': 'xoxb-1234567890-abcdef', 'google-api-key': `AIza${'B'.repeat(35)}`, 'stripe-live-key': `sk_live_${'c'.repeat(24)}`, 'npm-token': `npm_${'d'.repeat(36)}`,
  };
  for (const [name, sample] of Object.entries(samples)) assert.match(write(`const k = "${sample}";`).reason, new RegExp(name), name);
  for (const code of ['const apiKey = process.env.API_KEY;', 'function skip(task) { return task; }', '# AKIA in a comment', 'ghp_ is GitHub\'s prefix', 'BEGIN PUBLIC KEY']) {
    assert.equal(write(code).allow, true, code);
  }
});

test('T4: failing closed: a changed policy or trust root, bad input, an unknown tool or a missing policy all refuse; bin/hook.js end to end', () => {
  // A real trust root, as a launch has it.
  const repo = tempDir('hook-repo');
  const git = (...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: repo, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '# App\n');
  writeFileSync(join(repo, 'a.js'), 'let a = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  const env = { PATH: process.env.PATH, HOME: tempDir('hook-home') };
  init({ cwd: repo, env, branch: 'main' });
  git('add', '-A');
  git('commit', '-qm', 'Install MIRAI');
  writeToken(env, TOKEN);
  const trust = snapshot({ cwd: repo, env });
  const scratch = tempDir('hook-scratch');
  const policy = hookPolicy({
    checkout: realpathSync(repo), readRoots: [realpathSync(repo), realpathSync(trust.dir), scratch], writeRoots: [realpathSync(repo), scratch], writeDenied: [], hooksPaths: [], readableEnv: [],
    protectedFiles: [], trust: { dir: realpathSync(trust.dir), manifestSha256: trust.manifestSha256 }, tokenFile: join(env.HOME, '.config', 'mirai', 'claude-token'), secrets: SECRETS,
  });
  const dir = tempDir('hook-input');
  const policyFile = join(dir, 'hook-policy.json');
  const text = policyText(policy);
  writeFileSync(policyFile, text, { mode: 0o400 });
  const good = JSON.stringify(call('Write', { file_path: join(realpathSync(repo), 'b.js'), content: 'let b = 2;\n' }, realpathSync(repo)));
  assert.equal(runHook({ policyFile, policySha: sha(text), stdin: good }).allow, true);
  // The token, read by the hook itself from ~/.config/mirai.
  const leak = JSON.stringify(call('Write', { file_path: join(realpathSync(repo), 'b.js'), content: TOKEN }, realpathSync(repo)));
  assert.match(runHook({ policyFile, policySha: sha(text), stdin: leak }).reason, /login token/);
  assert.match(runHook({ policyFile, policySha: 'f'.repeat(64), stdin: good }).reason, /policy changed/);
  assert.match(runHook({ policyFile: join(dir, 'missing.json'), policySha: sha(text), stdin: good }).reason, /failed/);
  assert.match(runHook({ policyFile, policySha: sha(text), stdin: '{not json' }).reason, /can't read/);
  // A policy without a trust root refuses; so does a token file that can't be read (a write
  // would otherwise go unchecked for the token).
  const noTrust = policyText({ ...policy, trust: null });
  writeFileSync(join(dir, 'no-trust.json'), noTrust);
  assert.match(runHook({ policyFile: join(dir, 'no-trust.json'), policySha: sha(noTrust), stdin: good }).reason, /names no trust root/);
  chmodSync(join(env.HOME, '.config', 'mirai', 'claude-token'), 0o644);
  assert.match(runHook({ policyFile, policySha: sha(text), stdin: good }).reason, /token couldn't be read/);
  chmodSync(join(env.HOME, '.config', 'mirai', 'claude-token'), 0o600);
  // A changed trust root.
  const victim = join(trust.dir, 'tree', '.mirai', 'framework', 'package.json');
  chmodSync(join(trust.dir, 'tree', '.mirai', 'framework'), 0o755);
  chmodSync(victim, 0o644);
  const before = readFileSync(victim, 'utf8');
  writeFileSync(victim, `${before} `);
  assert.match(runHook({ policyFile, policySha: sha(text), stdin: good }).reason, /trust root was changed/);
  writeFileSync(victim, before);
  chmodSync(victim, 0o444);
  // bin/hook.js, as Claude Code runs it: allow prints the decision; a refusal exits 2.
  const hookJs = join(trust.dir, 'tree', '.mirai', 'framework', 'bin', 'hook.js');
  const run = (input, args = [policyFile, sha(text)]) => spawnSync(process.execPath, [hookJs, ...args], { input, encoding: 'utf8' });
  const started = Date.now();
  const yes = run(good);
  const ms = Date.now() - started;
  assert.equal(yes.status, 0, yes.stderr);
  assert.equal(JSON.parse(yes.stdout).hookSpecificOutput.permissionDecision, 'allow');
  assert.ok(ms < 2000, `the hook took ${ms} ms`);
  const no = run(leak);
  assert.equal(no.status, 2);
  assert.match(no.stderr, /MIRAI refused this call: the content holds the Claude login token/);
  assert.ok(!no.stderr.includes(TOKEN));
  assert.equal(run(good, []).status, 2);
  // A passing read prints no decision: for reads the hook only refuses (13c review).
  const read = run(JSON.stringify(call('Read', { file_path: join(realpathSync(repo), 'a.js') }, realpathSync(repo))));
  assert.equal(read.status, 0, read.stderr);
  assert.equal(read.stdout, '');
  assert.ok(readdirSync(dir).length === 2);
});
