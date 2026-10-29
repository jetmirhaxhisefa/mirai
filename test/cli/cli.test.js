import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { main, COMMANDS } from '../../src/cli/main.js';
import { createRouter } from '../../src/cli/router.js';
import { MiraiError } from '../../src/cli/errors.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { checkNodeVersion } from '../../src/cli/node-version.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(ROOT, 'bin', 'mirai.js');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

// Runs the real entry point as a child process.
function cli(args, env = {}, nodeArgs = []) {
  const r = spawnSync(process.execPath, [...nodeArgs, BIN, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
    timeout: 10_000,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// Runs main() in memory with a given command list.
async function inMemory(argv, commands, env = {}) {
  let out = '';
  let err = '';
  const io = {
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
    env,
    cwd: ROOT,
  };
  const code = await main(argv, io, commands);
  return { code, out, err };
}

const cmd = (name, run, extra = {}) => ({ name, summary: `Test-only ${name}`, usage: `mirai ${name}`, run, ...extra });

test('T1: --help lists every registered command with its summary, sorted', () => {
  const r = cli(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.out, /^Usage: mirai <command>/);
  assert.match(r.out, /\n  help\s+Show all commands/);
  assert.match(r.out, /\n  version\s+Print the MIRAI version/);
  assert.ok(r.out.indexOf('  help') < r.out.indexOf('  version'), 'sorted by name');
  assert.equal(r.err, '');
  for (const alias of [['-h'], ['help']]) {
    assert.equal(cli(alias).out, r.out, `mirai ${alias[0]} prints the same help`);
  }
});

test('T2: no arguments prints the same help, exit 0', () => {
  const r = cli([]);
  assert.equal(r.code, 0);
  assert.equal(r.out, cli(['--help']).out);
});

test('T3: --version and version print the package.json version', () => {
  for (const args of [['--version'], ['version']]) {
    const r = cli(args);
    assert.equal(r.code, 0);
    assert.equal(r.out, `${PKG.version}\n`);
  }
});

test('T4: help for one command, both ways; help for an unknown one fails', () => {
  const a = cli(['help', 'version']);
  const b = cli(['version', '--help']);
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  assert.match(a.out, /^Usage: mirai version\n/);
  assert.equal(a.out, b.out);
  const c = cli(['help', 'nope']);
  assert.equal(c.code, EXIT.USAGE);
  assert.match(c.err, /unknown command "nope"/);
});

test('T5: an unknown command exits 2 and suggests the closest one', () => {
  const r = cli(['helpp']);
  assert.equal(r.code, EXIT.USAGE);
  assert.match(r.err, /unknown command "helpp"/);
  assert.match(r.err, /did you mean "help"\?/);
  assert.equal(r.out, '');

  const far = cli(['deploy-everything']);
  assert.equal(far.code, EXIT.USAGE);
  assert.doesNotMatch(far.err, /did you mean/);
});

test('T6: an unknown flag exits 2 and names the flag, before or after the command', () => {
  const r = cli(['version', '--nope']);
  assert.equal(r.code, EXIT.USAGE);
  assert.equal(r.err, 'mirai: unknown option "--nope"\nsee: mirai version --help\n');
  const lead = cli(['--nope']);
  assert.equal(lead.code, EXIT.USAGE);
  assert.equal(lead.err, 'mirai: unknown option "--nope"\nsee: mirai --help\n');
});

test('T6b: extra arguments are usage errors', () => {
  for (const args of [['version', 'extra'], ['--version', 'junk'], ['--help', 'x'], ['help', 'version', 'extra']]) {
    const r = cli(args);
    assert.equal(r.code, EXIT.USAGE, `mirai ${args.join(' ')}`);
    assert.match(r.err, /unexpected argument/);
  }
});

const thrower = cmd('boom', () => {
  throw new MiraiError('refused by a test gate', EXIT.BLOCKED);
});

test('T7: a failing command exits with its code and one line, no stack', async () => {
  const r = await inMemory(['boom'], [thrower]);
  assert.equal(r.code, EXIT.BLOCKED);
  assert.equal(r.err, 'mirai: refused by a test gate\n');
});

test('T7b: unexpected errors exit 1, whatever was thrown', async () => {
  const cases = [
    [() => { throw new Error('bad'); }, 'mirai: bad\n'],
    [async () => { throw new Error('async bad'); }, 'mirai: async bad\n'],
    [() => { throw null; }, 'mirai: unknown error\n'],
    [() => { throw 'plain text'; }, 'mirai: plain text\n'],
    [() => { throw new Error('first line\nsecond line'); }, 'mirai: first line\n'],
  ];
  for (const [run, expected] of cases) {
    const r = await inMemory(['crash'], [cmd('crash', run)]);
    assert.equal(r.code, EXIT.FAILURE);
    assert.equal(r.err, expected);
  }
});

test('T7c: a command that returns no exit code fails closed', async () => {
  const r = await inMemory(['forgot'], [cmd('forgot', () => {})]);
  assert.equal(r.code, EXIT.FAILURE);
  assert.equal(r.err, 'mirai: command "forgot" returned no exit code\n');
});

test('T8: MIRAI_DEBUG=1 adds the stack frames, without repeating the message', async () => {
  const r = await inMemory(['boom'], [thrower], { MIRAI_DEBUG: '1' });
  assert.equal(r.code, EXIT.BLOCKED);
  assert.match(r.err, /^mirai: refused by a test gate\n\s+at /);
  assert.equal(r.err.split('refused by a test gate').length, 2, 'message appears once');
});

test('T9: invalid command modules fail at load, naming the module', async () => {
  const broken = { name: 'broken', summary: 'x', usage: 'mirai broken' };
  assert.throws(() => createRouter([broken]), /command module "broken" is missing "run"/);
  assert.throws(() => createRouter([{ run() {} }]), /missing "name"/);
  assert.throws(() => createRouter([thrower, thrower]), /registered twice/);
  const takesHelp = cmd('x', () => 0, { options: { help: { type: 'string' } } });
  assert.throws(() => createRouter([takesHelp]), /redefines the built-in --help/);
  const takesH = cmd('y', () => 0, { options: { host: { type: 'string', short: 'h' } } });
  assert.throws(() => createRouter([takesH]), /redefines the built-in --help/);
  const badRange = cmd('z', () => 0, { positionals: { min: 2, max: 1 } });
  assert.throws(() => createRouter([badRange]), /invalid "positionals"/);
  const r = await inMemory(['--help'], [broken]);
  assert.equal(r.code, EXIT.FAILURE);
  assert.match(r.err, /missing "run"/);
});

test('T9b: a broken options definition is a bug (exit 1), not a usage error', async () => {
  const bad = cmd('bad', () => 0, { options: { mode: { type: 'bogus' } } });
  const r = await inMemory(['bad'], [bad]);
  assert.equal(r.code, EXIT.FAILURE);
});

test('T9c: positionals ranges are enforced', async () => {
  const one = cmd('one', (args) => (args.positionals.length === 1 ? 0 : 9), { positionals: { min: 1, max: 1 } });
  assert.equal((await inMemory(['one', 'a'], [one])).code, 0);
  const none = await inMemory(['one'], [one]);
  assert.equal(none.code, EXIT.USAGE);
  assert.match(none.err, /missing argument/);
  assert.equal((await inMemory(['one', 'a', 'b'], [one])).code, EXIT.USAGE);
});

test('T10: the Node version check, as a function and through the real entry point', () => {
  assert.equal(checkNodeVersion('20.0.0'), 'mirai needs Node 22 or newer (found v20.0.0)\n');
  assert.equal(checkNodeVersion('v22.0.0'), null);
  assert.equal(checkNodeVersion(process.versions.node), null);
  const preload = join(ROOT, 'test', 'fixtures', 'fake-old-node.mjs');
  const r = cli(['--help'], {}, ['--import', preload]);
  assert.equal(r.code, 1);
  assert.equal(r.err, 'mirai needs Node 22 or newer (found v20.0.0)\n');
  assert.equal(r.out, '');
});

test('T11: package.json has zero dependencies and a working bin', () => {
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.equal(PKG[key], undefined, `${key} must not exist`);
  }
  assert.equal(PKG.private, true);
  assert.ok(existsSync(join(ROOT, PKG.bin.mirai)), 'bin.mirai points to a file');
});

// Collects every JavaScript file under the given folders.
function sourceFiles(...dirs) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(c|m)?js$/.test(p)) files.push(p);
    }
  };
  dirs.forEach(walk);
  return files;
}

test('T12: source files import only node: modules and relative paths, as plain strings', () => {
  const files = sourceFiles(join(ROOT, 'src'), join(ROOT, 'bin'));
  assert.ok(files.length > 0);
  // Real import and export statements only (multi-line too), not the word "from" in text.
  const literal = /(?:^|\n)\s*(?:import|export)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g;
  const anyDynamic = /\bimport\s*\(|\brequire\s*\(|\bcreateRequire\b/g;
  const literalDynamic = /\b(?:import|require)\s*\(\s*['"][^'"]+['"]\s*\)/g;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(literal)) {
      const s = m[1] ?? m[2] ?? m[3];
      assert.ok(s.startsWith('node:') || s.startsWith('./') || s.startsWith('../'), `${f} imports "${s}"`);
    }
    // Every dynamic import or require must use a plain string, so the loaded code is fixed.
    const dynamic = [...src.matchAll(anyDynamic)].length;
    const plain = [...src.matchAll(literalDynamic)].length;
    assert.equal(dynamic, plain, `${f} has a computed import, require or createRequire`);
  }
});

test('T13: the test script runs only MIRAI tests under test/', () => {
  // A bare `node --test` searches the whole repo, including the external clones in
  // research/_sources, and would run their code.
  assert.equal(PKG.scripts.test, 'node --test "test/**/*.test.js"');
});

test('T14: the real command list is pinned, so every new command is a reviewed test change', () => {
  assert.deepEqual(COMMANDS.map((c) => c.name), ['approve', 'config', 'drop', 'init', 'key', 'lint', 'log', 'protected', 'render', 'sandbox', 'session-server', 'status', 'test', 'token', 'trust', 'version']);
});
