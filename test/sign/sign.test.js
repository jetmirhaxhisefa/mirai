import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';

import { main } from '../../src/cli/main.js';
import { EXIT } from '../../src/cli/exit-codes.js';
import { canonical } from '../../src/sign/canonical.js';
import { branchKeys, committedKeys, keyPaths, loadSigningKey, readCommittedKeys } from '../../src/sign/keys.js';
import { contentHash, signObject, validTime, verifyApproval, verifySigned } from '../../src/sign/sign.js';
import { checkKeyChange } from '../../src/sign/key-rule.js';
import { loadSigner } from '../../src/sign/signer.js';
import { createStore, openStore } from '../../src/store/home.js';
import { atomicWrite } from '../../src/store/files.js';
import { appendEvent, journalContext, readJournal } from '../../src/store/journal.js';
import { readTicketStatus, signHumanMove, writeTicketStatus } from '../../src/store/tickets.js';
import { git, HERE, refused, setup, tmp } from '../store/helpers.js';

const BIN = join(HERE, '..', '..', 'bin', 'mirai.js');

// Runs a command with a simulated terminal: `answers` are typed one per line.
async function run(argv, { cwd, env }, { answers = [], tty = true, stdoutTty = tty } = {}) {
  let out = '';
  let err = '';
  const stdin = Readable.from(answers.length ? [`${answers.join('\n')}\n`] : []);
  stdin.isTTY = tty;
  const io = { stdin, stdout: { isTTY: stdoutTty, write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, env, cwd };
  const code = await main(argv, io);
  return { code, out, err };
}

// A repo with a store, your key made, and (unless `commit: false`) its .pub committed on main.
async function withKey({ commit = true } = {}) {
  const s = setup();
  const store = createStore({ cwd: s.repo, env: s.env });
  const r = await run(['key', 'new', '--label', 'test-mac'], { cwd: s.repo, env: s.env });
  assert.equal(r.code, EXIT.OK, r.err);
  const keyId = /made key (k-[0-9a-f]{16})/.exec(r.out)[1];
  if (commit) commitKeys(s.repo, s.home, 'add my key');
  return { ...s, store: openStore({ cwd: s.repo, env: s.env }), keyId, firstStore: store };
}

const CTX = 'mirai/test/1:repo-0123456789ab';

// Your status lines, written as you (signed): an approval-free path to a ready-for-dev ticket.
function approveAs(store, env, ticket) {
  return signHumanMove(store, loadSigner(env, store), { ticket, state: 'ready-for-dev' });
}

function commitKeys(repo, home, message) {
  git(repo, ['add', '.mirai/keys'], home);
  git(repo, ['commit', '-q', '-m', message], home);
}

function ticketFile(repo, ticket = 'T-12', text = '# T-12\n\nAs a user I can log in.\n') {
  mkdirSync(join(repo, 'tickets'), { recursive: true });
  writeFileSync(join(repo, 'tickets', `${ticket}.md`), text);
  return `tickets/${ticket}.md`;
}

test('T1: keys: a private key 0600 in a 0700 folder, the public key in .mirai/keys/, a derived id, never shown', async () => {
  const { env, repo, keyId } = await withKey({ commit: false });
  const p = keyPaths(env);
  assert.equal(statSync(p.dir).mode & 0o777, 0o700);
  assert.equal(statSync(p.privateKey).mode & 0o777, 0o600);
  const pub = readFileSync(join(repo, '.mirai', 'keys', `${keyId}.pub`), 'utf8');
  assert.match(pub, /^-----BEGIN PUBLIC KEY-----/);
  assert.equal(loadSigningKey(env).keyId, keyId, 'the id is derived from the key');

  // A second `key new` on this machine publishes the same key (one key per machine, D-52).
  const again = await run(['key', 'new'], { cwd: repo, env });
  assert.equal(again.code, EXIT.OK, again.err);
  assert.match(again.out, new RegExp(`this machine's key is ${keyId}`));
  const second = setup();
  second.env.HOME = env.HOME;
  const other = await run(['key', 'new'], { cwd: second.repo, env });
  assert.equal(other.code, EXIT.OK, other.err);
  assert.equal(readFileSync(join(second.repo, '.mirai', 'keys', `${keyId}.pub`), 'utf8'), pub, 'the same key, published in a second repo');

  // The private key's bytes never appear in any output.
  const secret = readFileSync(p.privateKey, 'utf8').split('\n')[1];
  const shown = await run(['key', 'show'], { cwd: repo, env });
  assert.match(shown.out, /fingerprint: SHA256:[A-Za-z0-9+/]{43}\n/);
  assert.ok(!(again.out + again.err + shown.out + shown.err).includes(secret));

  chmodSync(p.privateKey, 0o640);
  refused(() => loadSigningKey(env), 'mode');
  chmodSync(p.privateKey, 0o600);
  const real = join(tmp('elsewhere'), 'k');
  renameSync(p.privateKey, real);
  symlinkSync(real, p.privateKey);
  refused(() => loadSigningKey(env), 'symlink');

  // key new and revoke need a terminal too.
  assert.equal((await run(['key', 'revoke', keyId], { cwd: repo, env }, { tty: false })).code, EXIT.NEEDS_HUMAN);
});

test('T2: canonical JSON: key order never changes the bytes; non-JSON values are refused', () => {
  assert.deepEqual(canonical({ b: 1, a: [true, null, 'x'], c: { z: 1, y: 2 } }), canonical({ c: { y: 2, z: 1 }, a: [true, null, 'x'], b: 1 }));
  assert.equal(canonical({ b: 1, a: 'é' }).toString('utf8'), '{"a":"é","b":1}');
  // eslint-disable-next-line no-sparse-arrays
  for (const bad of [{ a: undefined }, { a: () => 1 }, { a: Infinity }, { a: NaN }, { a: new Date() }, { a: 1n }, { a: Symbol('x') }, { a: [1, , 3] }]) {
    assert.throws(() => canonical(bad), TypeError);
  }
  // Real times only: no month 13, no 30 February.
  assert.equal(validTime('2026-10-23T22:14:05.000Z'), true);
  for (const bad of ['2026-13-01T00:00:00.000Z', '2026-02-30T00:00:00.000Z', '2026-10-23T22:14:05Z']) assert.equal(validTime(bad), false, bad);
});

test('T3 + T5: verification needs only the public key; revoked keys and renamed files fail', async () => {
  const { env, repo, store, keyId, home } = await withKey();
  const me = loadSigningKey(env);
  const signed = signObject({ hello: 'world' }, me, { context: CTX });
  assert.deepEqual(Object.keys(signed.signature).sort(), ['alg', 'key_id', 'sig', 'ts']);

  // A separate process that has only the committed .pub verifies it.
  const verifier = join(tmp('verify'), 'verify.mjs');
  writeFileSync(verifier, `
    import { createPublicKey } from 'node:crypto';
    import { readFileSync } from 'node:fs';
    import { verifySigned } from ${JSON.stringify(join(HERE, '..', '..', 'src', 'sign', 'sign.js'))};
    const [pubFile, keyId, json] = process.argv.slice(2);
    const keys = new Map([[keyId, { publicKey: createPublicKey(readFileSync(pubFile, 'utf8')), revokedAt: null }]]);
    process.stdout.write(JSON.stringify(verifySigned(JSON.parse(json), keys, { context: ${JSON.stringify('mirai/test/1:repo-0123456789ab')} })));
  `);
  const out = spawnSync(process.execPath, [verifier, join(repo, '.mirai', 'keys', `${keyId}.pub`), keyId, JSON.stringify(signed)], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.deepEqual(JSON.parse(out.stdout), { ok: true, keyId });
  const mainKeys = branchKeys(repo, 'main', env);
  assert.equal(verifySigned({ ...signed, hello: 'World' }, mainKeys, { context: CTX }).reason, 'the signature does not match');
  // Bound to its context: the same object under another repo's or kind's context fails.
  assert.equal(verifySigned(signed, mainKeys, { context: 'mirai/test/1:repo-ffffffffffff' }).ok, false);
  assert.equal(verifySigned(signed, mainKeys, { context: 'mirai/journal/2:repo-0123456789ab' }).ok, false);
  assert.throws(() => verifySigned(signed, mainKeys), /context/);
  // One spelling of the signature: a changed unused base64 bit is refused.
  // The last character carries 4 unused bits; flipping one gives other text for the same bytes.
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const sig = signed.signature.sig;
  const twinSig = `${sig.slice(0, -3)}${ALPHABET[ALPHABET.indexOf(sig.at(-3)) ^ 1]}==`;
  assert.ok(Buffer.from(twinSig, 'base64').equals(Buffer.from(sig, 'base64')), 'the same 64 bytes');
  assert.equal(verifySigned({ ...signed, signature: { ...signed.signature, sig: twinSig } }, mainKeys, { context: CTX }).reason, 'the signature record is malformed');

  // Revoked: a signature dated after revoked_at fails; one dated before still passes.
  const before = signObject({ n: 1 }, me, { context: CTX, now: () => new Date('2026-10-01T00:00:00Z') });
  const r = await run(['key', 'revoke', keyId, '--reason', 'laptop stolen'], { cwd: repo, env });
  assert.equal(r.code, EXIT.OK, r.err);
  commitKeys(repo, home, 'revoke my key');
  const keys = branchKeys(repo, 'main', env);
  const after = signObject({ n: 2 }, me, { context: CTX });
  assert.match(verifySigned(after, keys, { context: CTX }).reason, /revoked before this was signed/);
  assert.equal(verifySigned(before, keys, { context: CTX }).ok, true);
  refused(() => loadSigner(env, store), 'key-revoked');
  // A signature dated in the far future against a revoked key: still refused (no NaN gap).
  const future = signObject({ n: 3 }, me, { context: CTX, now: () => new Date('2099-01-01T00:00:00Z') });
  assert.equal(verifySigned(future, keys, { context: CTX }).ok, false);

  // A .pub renamed to another id verifies nothing.
  git(repo, ['mv', `.mirai/keys/${keyId}.pub`, '.mirai/keys/k-0000000000000000.pub'], home);
  git(repo, ['commit', '-q', '-m', 'rename'], home);
  const report = readCommittedKeys(repo, 'refs/heads/main', env);
  assert.equal(report.keys.has('k-0000000000000000'), false);
  assert.equal(report.keys.has(keyId), false);
  assert.deepEqual(report.problems.map((p) => p.path), ['.mirai/keys/k-0000000000000000.pub'], 'listed for doctor');
  // CI can read the keys at a commit id (the base commit), not only a branch.
  const head = git(repo, ['rev-parse', 'HEAD~1'], home);
  assert.equal(committedKeys(repo, head, env).has(keyId), true);
});

test('T5b: a revocation with no real date revokes from the start', async () => {
  const { env, repo, home, keyId } = await withKey();
  writeFileSync(join(repo, '.mirai', 'keys', `${keyId}.revoked`), '{"revoked_at":"2026-13-01T00:00:00.000Z"}\n');
  commitKeys(repo, home, 'a typo in the date');
  const k = branchKeys(repo, 'main', env).get(keyId);
  assert.equal(k.revokedAt, 0);
  const r = await run(['key', 'show'], { cwd: repo, env });
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /revoked \(from the start/);
});

test('T4: public keys count only from the integration branch, never the work tree or another branch', async () => {
  const { env, repo, home, store, keyId } = await withKey({ commit: false });
  assert.equal(branchKeys(repo, 'main', env).size, 0, 'only in the work tree');
  refused(() => loadSigner(env, store), 'key-not-committed');
  git(repo, ['checkout', '-q', '-b', 'feature/x'], home);
  commitKeys(repo, home, 'key on a branch');
  assert.equal(branchKeys(repo, 'main', env).size, 0, 'only on another branch');
  git(repo, ['checkout', '-q', 'main'], home);
  git(repo, ['merge', '-q', '--ff-only', 'feature/x'], home);
  assert.ok(branchKeys(repo, 'main', env).has(keyId));
  assert.equal(loadSigner(env, store).keyId, keyId);
});

test('T4b: the integration branch is pinned in the store: a work-tree config pointing at a branch with another key is refused', async () => {
  const { env, repo, home } = await withKey();
  // An agent's own key, committed on its own branch, and the config pointed at that branch.
  git(repo, ['checkout', '-q', '-b', 'agent-keys'], home);
  const agentHome = setup().env;
  const made = await run(['key', 'new', '--label', 'agent'], { cwd: repo, env: agentHome });
  assert.equal(made.code, EXIT.OK, made.err);
  commitKeys(repo, home, 'agent key');
  git(repo, ['checkout', '-q', 'main'], home);
  const config = join(repo, '.mirai', 'config.toml');
  writeFileSync(config, readFileSync(config, 'utf8').replace('"main"', '"agent-keys"'));
  const err = refused(() => openStore({ cwd: repo, env }), 'branch-changed');
  assert.equal(err.exitCode, EXIT.BLOCKED);
  const r = await run(['status'], { cwd: repo, env });
  assert.equal(r.code, EXIT.BLOCKED);
});

test('T6: an approval made before an edit fails after it', async () => {
  const { env, store } = await withKey();
  const signer = loadSigner(env, store);
  const bytes = Buffer.from('# T-12\nAs a user I can log in.\n');
  const approval = signObject({ item: 'T-12', content_hash: contentHash(bytes) }, signer, { context: CTX });
  assert.equal(verifyApproval(approval, bytes, signer.keys, { context: CTX }).ok, true);
  const edited = Buffer.from(bytes);
  edited[edited.length - 2] = 0x21; // one byte
  assert.equal(verifyApproval(approval, edited, signer.keys, { context: CTX }).reason, 'the file changed after it was approved');
});

test('T7 + T8: approve needs a real terminal; it asks, signs the approval and the move in one step', async () => {
  const { env, repo, store, keyId } = await withKey();
  const file = ticketFile(repo);

  // No terminal: refused, with stdin or stdout piped, and from the real entry point.
  for (const options of [{ tty: false }, { tty: false, stdoutTty: true }, { tty: true, stdoutTty: false }]) {
    assert.equal((await run(['approve', 'T-12', '--file', file], { cwd: repo, env }, options)).code, EXIT.NEEDS_HUMAN, JSON.stringify(options));
  }
  const piped = spawnSync(process.execPath, [BIN, 'approve', 'T-12', '--file', file], { cwd: repo, env: { ...env }, input: 'a\nT-12\n', encoding: 'utf8' });
  assert.equal(piped.status, EXIT.NEEDS_HUMAN, piped.stderr);
  assert.match(piped.stderr, /needs you, in a real terminal/);

  // A wrong typed key cancels with nothing written.
  let r = await run(['approve', 'T-12', '--file', file], { cwd: repo, env }, { answers: ['a', 'T-13'] });
  assert.equal(r.code, EXIT.FAILURE);
  assert.match(r.err, /cancelled, nothing was written/);
  assert.equal(readJournal(store).events.length, 0);

  // Rejected: the signed approval, no move.
  r = await run(['approve', 'T-12', '--file', file], { cwd: repo, env }, { answers: ['r', 'acceptance criteria are vague', 'T-12'] });
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /rejected .* it stays draft/);
  assert.equal(readTicketStatus(store, 'T-12'), null);

  // Edited: approval and move, signed, consecutive numbers.
  r = await run(['approve', 'T-12', '--file', file], { cwd: repo, env }, { answers: ['e', 'tightened AC-2', 'T-12'] });
  assert.equal(r.code, EXIT.OK, r.err);
  const events = readJournal(store).events;
  assert.deepEqual(events.map((e) => [e.type, e.by, e.decision ?? e.state]), [['approval', 'human', 'rejected'], ['approval', 'human', 'edited'], ['status_written', 'human', 'ready-for-dev']]);
  assert.deepEqual([events[1].reason, events[1].path, events[1].content_hash], ['tightened AC-2', file, contentHash(readFileSync(join(repo, file)))]);
  assert.equal(events[2].seq, events[1].seq + 1);
  assert.ok(events.every((e) => e.signature.key_id === keyId));
  assert.equal(typeof events[1].answered_after_s, 'number');
  const status = readTicketStatus(store, 'T-12').status;
  assert.deepEqual([status.state, status.written_by, status.seq], ['ready-for-dev', 'human', events[2].seq]);

  // Not draft any more: approving again is refused (exit 4).
  r = await run(['approve', 'T-12', '--file', file], { cwd: repo, env }, { answers: ['a', 'T-12'] });
  assert.equal(r.code, EXIT.BLOCKED);
  // A bad answer writes nothing.
  ticketFile(repo, 'T-14', '# T-14\n');
  r = await run(['approve', 'T-14', '--file', 'tickets/T-14.md'], { cwd: repo, env }, { answers: ['yes'] });
  assert.equal(r.code, EXIT.USAGE);
  // Invisible characters in an answer are refused.
  r = await run(['approve', 'T-14', '--file', 'tickets/T-14.md'], { cwd: repo, env }, { answers: ['r', 'fine\u202e', 'T-14'] });
  assert.equal(r.code, EXIT.USAGE);
});

test('T8b: a move refused at the last moment leaves no approval behind', async () => {
  const { env, repo, store } = await withKey();
  const file = ticketFile(repo);
  // The status changes while you're answering (another of your approvals wins the race).
  let fired = false;
  const answers = ['a', 'T-12'];
  const stdin = new Readable({
    read() {
      if (!fired) {
        fired = true;
        approveAs(store, env, 'T-12');
      }
      this.push(answers.length ? `${answers.shift()}\n` : null);
    },
  });
  stdin.isTTY = true;
  let err = '';
  const code = await main(['approve', 'T-12', '--file', file], { stdin, stdout: { isTTY: true, write() {} }, stderr: { write: (t) => (err += t) }, env, cwd: repo });
  assert.equal(code, EXIT.BLOCKED, err);
  assert.equal(readJournal(store).events.filter((e) => e.type === 'approval').length, 0, 'no orphaned approval');
});

test('T9: drop: signed from draft, ready-for-dev and built; refused from in-progress; same terminal rule', async () => {
  const { env, repo, store } = await withKey();
  approveAs(store, env, 'T-1');
  let r = await run(['drop', 'T-1', '--note', 'not needed any more'], { cwd: repo, env }, { answers: ['T-1'] });
  assert.equal(r.code, EXIT.OK, r.err);
  assert.deepEqual([readTicketStatus(store, 'T-1').status.state, readTicketStatus(store, 'T-1').status.written_by], ['dropped', 'human']);
  assert.equal(readJournal(store).events.at(-1).note, 'not needed any more', 'the note is in the signed line');

  // A script can't make a move only you may make.
  assert.throws(() => writeTicketStatus(store, { ticket: 'T-9', state: 'ready-for-dev' }), /needs you/);
  assert.throws(() => writeTicketStatus(store, { ticket: 'T-9', state: 'dropped' }), /needs you/);

  // built (an MR that closed): dropping is your decision.
  appendEvent(store, { type: 'mr_opened', by: 'script', ticket: 'T-2', head: 'a'.repeat(40), target: 'main' });
  appendEvent(store, { type: 'mr_closed', by: 'script', ticket: 'T-2' });
  r = await run(['drop', 'T-2'], { cwd: repo, env }, { answers: ['T-2'] });
  assert.equal(r.code, EXIT.OK, r.err);

  approveAs(store, env, 'T-3');
  writeTicketStatus(store, { ticket: 'T-3', state: 'in-progress' });
  r = await run(['drop', 'T-3'], { cwd: repo, env }, { answers: ['T-3'] });
  assert.equal(r.code, EXIT.BLOCKED);
  assert.equal((await run(['drop', 'T-3'], { cwd: repo, env }, { tty: false })).code, EXIT.NEEDS_HUMAN);
});

test('T10: the store: unsigned, tampered, moved and revoked human lines fail closed; status shows who signed', async () => {
  const { env, repo, store, keyId, home } = await withKey();
  const file = ticketFile(repo);
  assert.equal((await run(['approve', 'T-12', '--file', file], { cwd: repo, env }, { answers: ['a', 'T-12'] })).code, EXIT.OK);
  let r = await run(['status'], { cwd: repo, env });
  assert.match(r.out, new RegExp(`\\nT-12\\s+ready-for-dev\\s+written\\s+seq 2\\s+by you \\(signed, ${keyId}\\)\\n`));

  const journal = join(store.dir, 'journal.jsonl');
  const good = readFileSync(journal, 'utf8');
  const lines = good.trim().split('\n').map((l) => JSON.parse(l));
  const put = (ls) => writeFileSync(journal, `${ls.map((l) => JSON.stringify(l)).join('\n')}\n`);

  put([lines[0], { ...lines[1], state: 'dropped' }]); // tampered
  refused(() => readJournal(store), 'bad-signature');
  put([lines[0], { ...lines[1], seq: 7 }]); // moved
  refused(() => readJournal(store), 'bad-signature');
  const { signature: _s, ...unsigned } = lines[1];
  put([lines[0], unsigned]); // unsigned
  refused(() => readJournal(store), 'corrupt-line');
  put(lines);
  assert.equal(readJournal(store).events.length, 2);

  // The status file claims a human write that no signed line backs.
  writeTicketStatus(store, { ticket: 'T-20', state: 'in-progress' });
  const statusFile = join(store.dir, 'tickets', 'T-20', 'status.json');
  writeFileSync(statusFile, readFileSync(statusFile, 'utf8').replace('"script"', '"human"'));
  r = await run(['status'], { cwd: repo, env });
  assert.equal(r.code, EXIT.BLOCKED);
  assert.match(r.out, /T-20\s+error: the status says you wrote it, but seq \d+ is not your latest signed line for it/);
  writeFileSync(statusFile, readFileSync(statusFile, 'utf8').replace('"human"', '"script"'));

  // After a signed drop, the file edited back to ready-for-dev (seq and written_by untouched).
  assert.equal((await run(['drop', 'T-12'], { cwd: repo, env }, { answers: ['T-12'] })).code, EXIT.OK);
  const t12 = join(store.dir, 'tickets', 'T-12', 'status.json');
  const dropped = readFileSync(t12, 'utf8');
  writeFileSync(t12, dropped.replace('"dropped"', '"ready-for-dev"'));
  r = await run(['status'], { cwd: repo, env });
  assert.match(r.out, /T-12\s+error: the status says you wrote it/);
  refused(() => readTicketStatus(store, 'T-12', { events: readJournal(store).events }), 'status-mismatch');
  writeFileSync(t12, dropped);

  // After revoking the key, lines it signed before the revocation still verify.
  assert.equal((await run(['key', 'revoke', keyId], { cwd: repo, env })).code, EXIT.OK);
  commitKeys(repo, home, 'revoke');
  // Lines it signed before the revocation still read; a line signed after it doesn't.
  assert.ok(readJournal(store).events.length >= 3);
  const keys = new Map([...branchKeys(repo, 'main', env)].map(([id, k]) => [id, { ...k, revokedAt: Date.now() - 60_000 }]));
  refused(() => readJournal(store, { keys }), 'bad-signature');
});

test('T10b: a signed line copied into another repo\'s journal doesn\'t verify there', async () => {
  const a = await withKey();
  const b = setup();
  b.env.HOME = a.env.HOME; // the same machine and key
  const storeB = createStore({ cwd: b.repo, env: a.env });
  assert.equal((await run(['key', 'new'], { cwd: b.repo, env: a.env })).code, EXIT.OK);
  commitKeys(b.repo, b.home, 'my key');
  approveAs(a.store, a.env, 'T-5');
  const line = readFileSync(join(a.store.dir, 'journal.jsonl'), 'utf8');
  atomicWrite(join(storeB.dir, 'journal.jsonl'), line);
  atomicWrite(join(storeB.dir, 'seq'), '1\n');
  refused(() => readJournal(openStore({ cwd: b.repo, env: a.env })), 'bad-signature');
  assert.match(journalContext(storeB), /^mirai\/journal\/3:/);
});

test('T11: the key-change rule', () => {
  const pub = { path: '.mirai/keys/k-0123456789abcdef.pub', status: 'A' };
  const revoked = { path: '.mirai/keys/k-0123456789abcdef.revoked', status: 'A' };
  assert.equal(checkKeyChange({ changes: [pub] }).ok, true);
  assert.equal(checkKeyChange({ changes: [revoked] }).ok, true, 'revoking is a key change you may make');
  assert.equal(checkKeyChange({ changes: [{ path: 'src/a.js', status: 'M' }], hasTrailer: true }).ok, true, 'no key change');
  assert.match(checkKeyChange({ changes: [pub], hasTrailer: true }).reason, /non-human commit is refused/);
  assert.equal(checkKeyChange({ changes: [pub], miraiCommitter: true }).ok, false);
  assert.match(checkKeyChange({ changes: [pub, { path: 'src/a.js', status: 'M' }] }).reason, /its own commit/);
  assert.match(checkKeyChange({ changes: [{ ...pub, status: 'D' }] }).reason, /never edited or deleted/);
  assert.match(checkKeyChange({ changes: [{ ...pub, status: 'M' }] }).reason, /never edited or deleted/);
  assert.match(checkKeyChange({ changes: [{ ...revoked, status: 'D' }] }).reason, /never deleted/);
});

test('T12: no key, or a key not committed yet: approve says what to do; key show says "not committed yet"', async () => {
  const s = setup();
  createStore({ cwd: s.repo, env: s.env });
  const file = ticketFile(s.repo);
  let r = await run(['approve', 'T-12', '--file', file], { cwd: s.repo, env: s.env }, { answers: ['a', 'T-12'] });
  assert.equal(r.code, EXIT.CONFIG);
  assert.match(r.err, /no signing key on this machine\nmake one: mirai key new/);

  const k = await withKey({ commit: false });
  const kf = ticketFile(k.repo);
  r = await run(['approve', 'T-12', '--file', kf], { cwd: k.repo, env: k.env }, { answers: ['a', 'T-12'] });
  assert.equal(r.code, EXIT.CONFIG);
  assert.match(r.err, new RegExp(`commit and push .mirai/keys/${k.keyId}.pub to main yourself`));
  r = await run(['key', 'show'], { cwd: k.repo, env: k.env });
  assert.match(r.out, /not committed yet/);
  // A file outside the repo, or a link, is refused.
  commitKeys(k.repo, k.home, 'key');
  const outside = join(tmp('out'), 'x.md');
  writeFileSync(outside, 'x');
  r = await run(['approve', 'T-12', '--file', outside], { cwd: k.repo, env: k.env }, { answers: ['a', 'T-12'] });
  assert.equal(r.code, EXIT.USAGE);
  symlinkSync(outside, join(k.repo, 'tickets', 'link.md'));
  r = await run(['approve', 'T-12', '--file', 'tickets/link.md'], { cwd: k.repo, env: k.env }, { answers: ['a', 'T-12'] });
  assert.equal(r.code, EXIT.USAGE);
});

test('15a: a signed line from before journal version 3 still verifies; relabelled as version 3 it doesn\'t', async () => {
  const s = await withKey();
  const signer = loadSigner(s.env, s.store);
  const line = signObject({ schema_version: 2, seq: 1, ts: '2026-10-27T10:00:00.000Z', type: 'status_written', by: 'human', ticket: 'T-5', state: 'ready-for-dev' },
    signer, { context: `mirai/journal/2:${s.store.repoId}` });
  atomicWrite(join(s.store.dir, 'journal.jsonl'), `${JSON.stringify(line)}\n`);
  atomicWrite(join(s.store.dir, 'seq'), '1\n');
  assert.deepEqual(readJournal(s.store).events.map((e) => [e.schema_version, e.by, e.ticket]), [[2, 'human', 'T-5']]);
  atomicWrite(join(s.store.dir, 'journal.jsonl'), `${JSON.stringify({ ...line, schema_version: 3 })}\n`);
  refused(() => readJournal(s.store), 'bad-signature');
});
