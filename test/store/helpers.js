import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main } from '../../src/cli/main.js';
import { StoreError } from '../../src/cli/errors.js';

// Shared by the store tests (units 05a and 05b).
export const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_CONFIG = join(HERE, '..', 'config', 'fixtures', 'sample-app-config.toml');

// ---- Helpers: a temporary HOME and temporary git repos; nothing touches your real home. ----

export const tmp = (prefix) => mkdtempSync(join(tmpdir(), `mirai-${prefix}-`));

export function git(cwd, args, home) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

// A repo with a project config and one commit on main. `config`: 'minimal' or 'sample'.
export function makeRepo({ home, remote, config = 'minimal', commit = true, name = 'repo' } = {}) {
  const dir = join(tmp('repo'), name);
  mkdirSync(join(dir, '.mirai'), { recursive: true });
  git(dir, ['init', '-q', '-b', 'main'], home);
  if (config === 'sample') copyFileSync(SAMPLE_CONFIG, join(dir, '.mirai', 'config.toml'));
  else writeFileSync(join(dir, '.mirai', 'config.toml'), 'schema_version = 1\n\n[git]\nintegration_branch = "main"\n');
  // Unique content, so two test repos made in the same second never share a first commit.
  writeFileSync(join(dir, 'README.md'), `# ${name}\n${Math.random()}\n`);
  if (remote) git(dir, ['remote', 'add', 'origin', remote], home);
  if (commit) {
    git(dir, ['add', '.'], home);
    git(dir, ['commit', '-q', '-m', 'first'], home);
  }
  return dir;
}

export function setup(options = {}) {
  const home = tmp('home');
  const env = { HOME: home, PATH: process.env.PATH };
  const repo = makeRepo({ home, ...options });
  return { home, env, repo };
}

// Every file in the work tree (outside .git) with its size and content, to prove MIRAI wrote
// nothing into the project.
export function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[p] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

export function unchanged(repo, fn) {
  const before = snapshot(repo);
  const result = fn();
  assert.deepEqual(snapshot(repo), before, 'MIRAI wrote into the project');
  return result;
}

export async function unchangedAsync(repo, fn) {
  const before = snapshot(repo);
  const result = await fn();
  assert.deepEqual(snapshot(repo), before, 'MIRAI wrote into the project');
  return result;
}

export function refused(fn, code) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof StoreError, `expected a StoreError, got ${err?.name}: ${err?.message}`);
    if (code) assert.equal(err.code, code, err.message);
    return err;
  }
  return assert.fail('expected a StoreError');
}

export async function cli(argv, { cwd, env }) {
  let out = '';
  let err = '';
  const io = { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd };
  const code = await main(argv, io);
  return { code, out, err };
}

export const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;
export const mode = (p) => statSync(p).mode & 0o777;

