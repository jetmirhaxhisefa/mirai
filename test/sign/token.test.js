import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';

import { main } from '../../src/cli/main.js';
import { readHidden } from '../../src/cli/tty.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { readToken, tokenFingerprint, tokenPath, writeToken } from '../../src/sign/token.js';
import { decide } from '../../src/launch/launch.js';
import { tmp } from '../store/helpers.js';

// Unit 13a: mirai token set | status | clear.

const TOKEN = `sk-ant-oat01-${'Ab3_-x'.repeat(16)}`;

async function run(argv, env, { input = null, tty = true } = {}) {
  let out = '';
  let err = '';
  const stdin = Readable.from(input === null ? [] : [input]);
  stdin.isTTY = tty;
  const io = { stdin, stdout: { isTTY: tty, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd: env.HOME };
  const code = await main(argv, io);
  return { code, out, err };
}

const freshHome = () => ({ HOME: tmp('token-home'), PATH: process.env.PATH });

test('T1: token set needs a real terminal, checks the shape, writes a private file, never echoes', async () => {
  const env = freshHome();
  const piped = await run(['token', 'set'], env, { input: `${TOKEN}\n`, tty: false });
  assert.equal(piped.code, EXIT.NEEDS_HUMAN);
  assert.equal(readToken(env), null);

  const bad = await run(['token', 'set'], env, { input: 'sk-ant-api03-notatoken\n' });
  assert.notEqual(bad.code, EXIT.OK);
  assert.equal(readToken(env), null);

  // Pasted with surrounding spaces and a backspace-corrected typo: still the token.
  const r = await run(['token', 'set'], env, { input: `  ${TOKEN}x\u007f  \r` });
  assert.equal(r.code, EXIT.OK, r.err);
  assert.equal(readToken(env), TOKEN);
  assert.ok(!r.out.includes(TOKEN) && !r.err.includes(TOKEN), 'the token was printed');
  assert.match(r.out, new RegExp(`fingerprint: ${tokenFingerprint(TOKEN)}`));
  assert.equal(statSync(tokenPath(env)).mode & 0o777, 0o600);
  assert.equal(statSync(join(env.HOME, '.config', 'mirai')).mode & 0o777, 0o700);
  // Nothing else was written next to it (no journal, no temp file left).
  assert.deepEqual(readdirSync(join(env.HOME, '.config', 'mirai')), ['claude-token']);

  const stopped = await run(['token', 'set'], env, { input: 'sk-ant\u0003' });
  assert.equal(stopped.code, EXIT.INTERRUPTED);
  assert.equal(readToken(env), TOKEN);
});

test('T2: token status shows the fingerprint only; clear removes it and needs a terminal', async () => {
  const env = freshHome();
  const none = await run(['token', 'status'], env, { tty: false });
  assert.equal(none.code, EXIT.OK);
  assert.match(none.out, /no token set/);

  writeToken(env, TOKEN);
  const s = await run(['token', 'status'], env, { tty: false });
  assert.equal(s.code, EXIT.OK);
  assert.match(s.out, new RegExp(tokenFingerprint(TOKEN)));
  assert.ok(!s.out.includes(TOKEN));

  assert.equal((await run(['token', 'clear'], env, { tty: false })).code, EXIT.NEEDS_HUMAN);
  assert.equal(readToken(env), TOKEN);
  const c = await run(['token', 'clear'], env);
  assert.equal(c.code, EXIT.OK);
  assert.equal(readToken(env), null);
  assert.match((await run(['token', 'clear'], env)).out, /no token was set/);
});

test('T2b: a token file that is a link, too open, or not a token is refused', async () => {
  const env = freshHome();
  writeToken(env, TOKEN);
  chmodSync(tokenPath(env), 0o644);
  assert.notEqual((await run(['token', 'status'], env)).code, EXIT.OK);
  chmodSync(tokenPath(env), 0o600);
  writeFileSync(tokenPath(env), 'hello\n', { mode: 0o600 });
  assert.notEqual((await run(['token', 'status'], env)).code, EXIT.OK);

  const env2 = freshHome();
  mkdirSync(join(env2.HOME, '.config', 'mirai'), { recursive: true, mode: 0o700 });
  const elsewhere = join(tmp('token-elsewhere'), 't');
  writeFileSync(elsewhere, `${TOKEN}\n`, { mode: 0o600 });
  symlinkSync(elsewhere, tokenPath(env2));
  assert.notEqual((await run(['token', 'status'], env2)).code, EXIT.OK);
  assert.equal(readFileSync(elsewhere, 'utf8'), `${TOKEN}\n`);
});

test('T2c: the launcher runs token from its own code, in or out of a repo', () => {
  const env = freshHome();
  assert.equal(decide({ cwd: env.HOME, env, argv: ['token', 'status'] }).run, 'self');
});

test('T2d: clear removes an exposed token file: too open, or a link (never following it)', async () => {
  const env = freshHome();
  writeToken(env, TOKEN);
  chmodSync(tokenPath(env), 0o644);
  assert.equal((await run(['token', 'clear'], env)).code, EXIT.OK);
  assert.ok(!existsSync(tokenPath(env)));

  const elsewhere = join(tmp('token-elsewhere'), 't');
  writeFileSync(elsewhere, `${TOKEN}\n`, { mode: 0o600 });
  symlinkSync(elsewhere, tokenPath(env));
  assert.equal((await run(['token', 'clear'], env)).code, EXIT.OK);
  assert.throws(() => lstatSync(tokenPath(env)), /ENOENT/);
  assert.equal(readFileSync(elsewhere, 'utf8'), `${TOKEN}\n`, 'the link target was touched');

  mkdirSync(tokenPath(env));
  assert.notEqual((await run(['token', 'clear'], env)).code, EXIT.OK);
});

test('T2e: status says when the token was set, and asks for renewal after 330 days', async () => {
  const env = freshHome();
  writeToken(env, TOKEN);
  const fresh = await run(['token', 'status'], env, { tty: false });
  assert.match(fresh.out, /set on: \d{4}-\d{2}-\d{2} \(0 days ago\)/);
  assert.doesNotMatch(fresh.out, /renew/);
  const old = new Date(Date.now() - 340 * 86_400_000);
  utimesSync(tokenPath(env), old, old);
  assert.match((await run(['token', 'status'], env, { tty: false })).out, /renew it soon/);
});

test('T1b: the hidden reader switches raw mode on, and off again on Enter, Ctrl-C and overflow', async () => {
  const fakeTty = (input) => {
    const stdin = Readable.from([input]);
    stdin.isTTY = true;
    stdin.modes = [];
    stdin.setRawMode = (on) => stdin.modes.push(on);
    return stdin;
  };
  const io = (stdin) => ({ stdin, stdout: { write() {} } });
  const ok = fakeTty('secret\r');
  assert.equal(await readHidden(io(ok), '? '), 'secret');
  assert.deepEqual(ok.modes, [true, false]);
  const stopped = fakeTty('sec\u0003ret\r');
  await assert.rejects(readHidden(io(stopped), '? '), /stopped/);
  assert.deepEqual(stopped.modes, [true, false]);
  const long = fakeTty('x'.repeat(30));
  await assert.rejects(readHidden(io(long), '? ', { max: 10 }), /longer than 10/);
  assert.deepEqual(long.modes, [true, false]);
});
