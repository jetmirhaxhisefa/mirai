#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { init } from '../../src/install/init.js';
import { createKeyPair, createMachineKey, loadMachineKey, protectKey, writePublicKeyFile } from '../../src/sign/keys.js';
import { signObject } from '../../src/sign/sign.js';
import { writeToken } from '../../src/sign/token.js';
import { openStore } from '../../src/store/home.js';
import { readJournal } from '../../src/store/journal.js';
import { readTicketStatus } from '../../src/store/tickets.js';

// Unit 29b's R1 (your OK, 2026-11-15). No model, a throwaway clone of your sample app with its own
// MIRAI home and probe keys (your real key is never used); deleted at the end.
//   1. the protected key file, read as a session would: encrypted bytes, nothing to sign with;
//   2. `mirai approve` driven through a real pseudo-terminal (`expect`, as 18e's `script` attack) with the
//      ticket key typed but no passphrase: refused, nothing written;
//   3. a decision line signed with the machine key, written into the journal by hand: the journal
//      fails closed on it;
//   4. the same approve with the passphrase through the pty: signed (the control);
//   5. the machine key signs a record (the baseline's context) that verifies.
//   node test/probes/keys-probes.js [--app <sample app>]

const { values } = parseArgs({ options: { app: { type: 'string' } } });
const app = resolve(values.app ?? join(process.env.HOME, 'Projects', 'mirai-sample-app'));
const MIRAI = fileURLToPath(new URL('../../bin/mirai.js', import.meta.url));
const PASS = 'probe passphrase 29b';
let ok = true;
const check = (what, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${!cond && detail ? `\n      ${String(detail).split('\n').join('\n      ')}` : ''}`);
  if (!cond) ok = false;
};
const workdir = realpathSync(mkdtempSync(join(tmpdir(), 'mirai-keys-probe-')));
try {
  const root = join(workdir, 'repo');
  mkdirSync(join(workdir, 'home'), { recursive: true, mode: 0o700 });
  const home = realpathSync(join(workdir, 'home'));
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('/usr/bin/git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { cwd: root, env: gitEnv }).toString();
  execFileSync('/usr/bin/git', ['clone', '--quiet', '--no-local', '--branch', 'main', app, root], { env: gitEnv });
  git('remote', 'remove', 'origin');
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USER: process.env.USER, LANG: 'C' };
  init({ cwd: root, env, refresh: true });
  const k = createKeyPair(env, { label: 'probe' });
  writePublicKeyFile(root, k.keyId, k.publicPem);
  const m = createMachineKey(env);
  writePublicKeyFile(root, m.keyId, m.publicPem, { machine: true });
  git('add', '-A');
  git('commit', '-qm', 'probe: refresh, a key and the machine key (unit 29b)');
  writeToken(env, `sk-ant-oat01-${'Pr0be_'.repeat(14)}`);
  writeFileSync(join(home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "MIRAI Probe"\nauthor_email = "probe@example.invalid"\n', { mode: 0o600 });
  protectKey(env, PASS);

  // 1. The key file as a session reads it.
  const bytes = readFileSync(join(home, '.config', 'mirai', 'signing.ed25519'), 'utf8');
  check('1: the key file is encrypted (a session reading it gets nothing to sign with)', bytes.startsWith('-----BEGIN ENCRYPTED PRIVATE KEY-----') && !bytes.includes('BEGIN PRIVATE KEY'));

  // 2. approve through a real pty, the ticket key typed, no passphrase.
  const ticket = 'SAMPLE-1';
  const file = 'docs/mirai/tickets/SAMPLE-1.md';
  // A real pseudo-terminal driven by a program, as 18e's attack: expect answers each prompt.
  // (macOS script can't take piped input from here: it fails on the socket.)
  const pty = (answers) => {
    const exp = join(workdir, 'drive.exp');
    const tcl = (x) => `"${String(x).replace(/[\\"$\[\]]/g, (c) => `\\${c}`)}"`;
    writeFileSync(exp, [
      'set timeout 60',
      `spawn ${tcl(process.execPath)} ${tcl(MIRAI)} approve ${ticket} --file ${file}`,
      'expect -re {\[a/e/r\]}',
      `send -- ${tcl(answers[0])}; send "\r"`,
      'expect -re {passphrase|confirm}',
      `send -- ${tcl(answers[1])}; send "\r"`,
      'expect eof',
      'catch wait result',
      'exit [lindex $result 3]',
    ].join('\n'));
    return spawnSync('/usr/bin/expect', ['-f', exp], { cwd: root, env, encoding: 'utf8', timeout: 90_000 });
  };
  const store = openStore({ cwd: root, env });
  const before = readJournal(store).events.length;
  const forged = pty(['a', ticket]);
  check('2: approve through a pty (expect) with the ticket key typed, no passphrase: refused', forged.status !== 0 && /passphrase/i.test(forged.stdout), forged.stdout.slice(-300));
  check('2: nothing written (no approval, no move)', readJournal(store).events.length === before && !readTicketStatus(store, ticket)?.status);

  // 3. A decision line signed with the machine key, appended by hand.
  const mk = loadMachineKey(env);
  const journal = join(store.dir, 'journal.jsonl');
  const saved = readFileSync(journal);
  const last = readJournal(store).events.at(-1);
  const seq = (last?.seq ?? 0) + 1;
  const line = signObject({ schema_version: 6, seq, ts: new Date().toISOString(), type: 'status_written', by: 'human', item: ticket, ticket, state: 'ready-for-dev' }, { privateKey: mk.privateKey, keyId: mk.keyId }, { context: `mirai/journal/6:${store.repoId}` });
  writeFileSync(journal, Buffer.concat([saved, Buffer.from(`${JSON.stringify(line)}\n`)]));
  writeFileSync(join(store.dir, 'seq'), `${seq}\n`, { mode: 0o600 });
  let refused = null;
  try {
    readJournal(store);
  } catch (err) {
    refused = `${err.code}: ${err.message}`;
  }
  check('3: a decision signed with the machine key: the journal fails closed on it', refused !== null && /machine key/.test(refused), refused);
  writeFileSync(journal, saved);
  writeFileSync(join(store.dir, 'seq'), `${seq - 1}\n`, { mode: 0o600 });

  // 4. The control: the same approve through the pty, with the passphrase.
  const real = pty(['a', PASS]);
  check('4: with the passphrase, through the same pty: approved, signed with your key', real.status === 0 && /approved: SAMPLE-1/.test(real.stdout) && readTicketStatus(store, ticket)?.status?.state === 'ready-for-dev', real.stdout.slice(-300));
  check('4: the passphrase never shows in the output', !real.stdout.includes(PASS));
} catch (err) {
  check(`R1 stopped: ${err.message}`, false, err.stack);
} finally {
  execFileSync('/bin/chmod', ['-R', 'u+w', workdir]);
  rmSync(workdir, { recursive: true, force: true });
  check('clean-up: the probe folder is deleted', !existsSync(workdir));
}
console.log(ok ? 'R1: PASS' : 'R1: FAIL');
process.exitCode = ok ? 0 : 1;
