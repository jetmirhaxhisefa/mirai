import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { EXIT } from '../../src/cli/exit-codes.js';
import { runChecks } from '../../src/doctor/checks.js';
import { MIRAI_DENIES, userSettings, writeUserDenies } from '../../src/sign/denies.js';
import { createMachineKey, keyIsProtected, loadSigningKey, protectKey, writePublicKeyFile } from '../../src/sign/keys.js';
import { signObject, verifySigned } from '../../src/sign/sign.js';
import { loadRecordSigner, loadSigner, machineReady } from '../../src/sign/signer.js';
import { holderStatus, lockHolder, parseUnlock } from '../../src/sign/unlock.js';
import { checkConfig, readConfigFile } from '../../src/config/load.js';
import { openStore } from '../../src/store/home.js';
import { appendEvent, readJournal } from '../../src/store/journal.js';
import { readTicketStatus } from '../../src/store/tickets.js';
import { approvedTicket, tty } from '../proofs/fixture.js';
import { tempDir } from '../tests/run-fixture.js';

// Unit 29b: your key and token at rest. A fixture with a ticket approved by a plain key (as one
// made before 29b), then protected, a machine key, the unlock setting, the user-level denies.

const PASS = 'correct horse battery staple';
const commitKeys = (f, msg) => {
  f.git('add', '.mirai/keys');
  f.git('commit', '-qm', msg);
};

test('29b: protect keeps your key\'s id and every signature; a protected key needs its passphrase; the passphrase can change', async () => {
  const f = await approvedTicket();
  const store = openStore(f.io);
  const before = loadSigner(f.env, store);
  const r = protectKey(f.env, PASS);
  assert.deepEqual([r.keyId, r.was], [before.keyId, 'plain']);
  assert.ok(keyIsProtected(f.env));
  assert.ok(readFileSync(join(f.home, '.config', 'mirai', 'signing.ed25519'), 'utf8').startsWith('-----BEGIN ENCRYPTED PRIVATE KEY-----'));
  assert.throws(() => loadSigningKey(f.env), (e) => e.code === 'key-locked');
  assert.throws(() => loadSigningKey(f.env, { passphrase: 'not the passphrase' }), (e) => e.code === 'bad-passphrase');
  assert.equal(loadSigningKey(f.env, { passphrase: PASS }).keyId, before.keyId);
  // Everything signed before still verifies (the approval in the fixture).
  const events = readJournal(store, { keys: before.keys }).events;
  assert.ok(events.some((e) => e.type === 'approval' && e.signature));
  // A new passphrase: any length (no minimum), but not empty.
  assert.throws(() => protectKey(f.env, '', { current: PASS }), (e) => e.code === 'weak-passphrase');
  protectKey(f.env, 'x', { current: PASS });
  assert.equal(loadSigningKey(f.env, { passphrase: 'x' }).keyId, before.keyId);
  protectKey(f.env, PASS, { current: 'x' });
  protectKey(f.env, 'another long passphrase', { current: PASS });
  assert.throws(() => loadSigningKey(f.env, { passphrase: PASS }), (e) => e.code === 'bad-passphrase');
  assert.equal(loadSigningKey(f.env, { passphrase: 'another long passphrase' }).keyId, before.keyId);
});

test('29b: a decision asks your passphrase in place of the typed key; a wrong one writes nothing; a plain key still takes the typed key', async () => {
  const f = await approvedTicket();
  const store = openStore(f.io);
  protectKey(f.env, PASS);
  const wrong = await tty(['drop', 'PMT-31'], f.io, ['not my passphrase']);
  assert.notEqual(wrong.code, EXIT.OK);
  assert.equal(readTicketStatus(store, 'PMT-31').status.state, 'ready-for-dev', 'nothing written');
  // The typed ticket key is no passphrase.
  assert.notEqual((await tty(['drop', 'PMT-31'], f.io, ['PMT-31'])).code, EXIT.OK);
  const ok = await tty(['drop', 'PMT-31'], f.io, [PASS]);
  assert.equal(ok.code, EXIT.OK, ok.err);
  assert.match(ok.out, /your passphrase \(for PMT-31\): /);
  assert.equal(readTicketStatus(store, 'PMT-31').status.state, 'dropped');
  assert.ok(!ok.out.includes(PASS), 'the passphrase is never shown');
});

test('29b: the machine key signs MIRAI\'s records, never a decision', async () => {
  const f = await approvedTicket();
  const store = openStore(f.io);
  const m = createMachineKey(f.env);
  // Not on the integration branch yet: records still use your key.
  assert.equal(machineReady(f.env, store), false);
  assert.equal(loadRecordSigner(f.env, store).kind, 'human');
  writePublicKeyFile(f.root, m.keyId, m.publicPem, { machine: true });
  commitKeys(f, 'the machine key');
  const s = openStore(f.io);
  assert.equal(machineReady(f.env, s), true);
  const rec = loadRecordSigner(f.env, s);
  assert.deepEqual([rec.kind, rec.keyId], ['machine', m.keyId]);
  assert.equal(rec.keys.get(m.keyId).kind, 'machine');
  // A record signed by it verifies; the same signature as a decision doesn't.
  const ctx = `mirai/proof/1:${s.repoId}`;
  const signed = signObject({ ticket: 'PMT-31' }, rec, { context: ctx });
  assert.equal(verifySigned(signed, rec.keys, { context: ctx }).ok, true);
  assert.match(verifySigned(signed, rec.keys, { context: ctx, decision: true }).reason, /machine key: a decision needs yours/);
  // A journal decision line signed with it is refused when written.
  assert.throws(() => appendEvent(s, { type: 'status_written', by: 'human', item: 'PMT-31', ticket: 'PMT-31', state: 'dropped' }, { signer: rec }), /machine key/);
  // As your signer, a machine key is refused.
  assert.equal(readTicketStatus(s, 'PMT-31').status.state, 'ready-for-dev');
  // Your protected key and no machine key: a record names the machine key.
  const g = await approvedTicket();
  protectKey(g.env, PASS);
  assert.throws(() => loadRecordSigner(g.env, openStore(g.io)), (e) => e.code === 'no-machine-key' && /mirai key new --machine/.test(e.hint));
});

test('29b: signing.unlock: "each" by default; a duration keeps your key unlocked after the passphrase, until mirai key lock; personal config only', async () => {
  assert.equal(parseUnlock('each'), 0);
  assert.equal(parseUnlock('8h'), 8 * 3_600_000);
  assert.equal(parseUnlock('30d'), 30 * 86_400_000);
  assert.throws(() => parseUnlock('31d'), (e) => e.code === 'bad-unlock');
  assert.throws(() => parseUnlock('forever'), (e) => e.code === 'bad-unlock');
  // A project's config can't set it.
  const dir = tempDir('cfg');
  writeFileSync(join(dir, 'config.toml'), 'schema_version = 1\n[git]\nintegration_branch = "main"\n[signing]\nunlock = "30d"\n');
  const project = readConfigFile(join(dir, 'config.toml'), { trust: 'project' });
  assert.throws(() => checkConfig([{ kind: 'project', file: project }]), (e) => /config/.test(e.message) && JSON.stringify(e.problems ?? e).includes('signing'));

  const f = await approvedTicket();
  const store = openStore(f.io);
  protectKey(f.env, PASS);
  writeFileSync(join(f.home, '.config', 'mirai', 'config.toml'), 'schema_version = 1\n[git]\nauthor_name = "Test Author"\nauthor_email = "author@example.com"\n[signing]\nunlock = "1h"\n', { mode: 0o600 });
  try {
    // A second ticket to decide on: approve it as plain (the fixture's flow), then drop both.
    const first = await tty(['drop', 'PMT-31'], f.io, [PASS]);
    assert.equal(first.code, EXIT.OK, first.err);
    assert.match(first.out, /your key stays unlocked until/);
    const held = holderStatus(f.env);
    assert.ok(held && held.until > Date.now() + 50 * 60_000);
    // While unlocked: the typed ticket key, no passphrase; signed through the holder.
    writeFileSync(join(f.root, 'docs', 'mirai', 'tickets', 'PMT-32.md'), readFileSync(join(f.root, 'docs', 'mirai', 'tickets', 'PMT-31.md'), 'utf8').replaceAll('PMT-31', 'PMT-32'));
    f.git('add', '-A');
    f.git('commit', '-qm', 'PMT-32');
    const second = await tty(['approve', 'PMT-32', '--file', 'docs/mirai/tickets/PMT-32.md'], f.io, ['a', 'PMT-32']);
    assert.equal(second.code, EXIT.OK, second.err);
    assert.match(second.out, /your key is unlocked until/);
    assert.ok(!/your passphrase/.test(second.out));
    assert.equal(readTicketStatus(openStore(f.io), 'PMT-32').status.state, 'ready-for-dev');
    // Locked: the passphrase again.
    assert.equal((await tty(['key', 'lock'], f.io, [])).code, EXIT.OK);
    assert.equal(holderStatus(f.env), null);
    const third = await tty(['drop', 'PMT-32'], f.io, [PASS]);
    assert.equal(third.code, EXIT.OK, third.err);
    assert.match(third.out, /your passphrase \(for PMT-32\)/);
    // Doctor shows it unlocked while it is.
    const items = await runChecks({ cwd: f.root, env: f.env, redTeam: async () => ({ state: 'green', parts: { claude_code: { version: '2.1.319' } } }), session: () => ({ state: 'current' }) });
    assert.match(items.find((i) => i.id === 'key-rest').detail, /unlocked until/);
  } finally {
    lockHolder(f.env);
  }
  assert.ok(store);
});

test('29b: MIRAI\'s deny rules go into both your Claude configs, once, through a link, and nothing else changes', () => {
  const home = tempDir('home');
  const env = { HOME: home };
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.claude-private'), { recursive: true });
  mkdirSync(join(home, 'claude-config'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'x', permissions: { allow: ['Bash(ls)'], deny: ['Read(./secret)'] } }, null, 2));
  writeFileSync(join(home, 'claude-config', 'settings.json'), JSON.stringify({ hooks: { Stop: [] } }, null, 2));
  symlinkSync(join(home, 'claude-config', 'settings.json'), join(home, '.claude-private', 'settings.json'));
  assert.deepEqual(userSettings(env).map((u) => u.missing.length), [4, 4]);
  const done = writeUserDenies(env);
  assert.deepEqual(done.map((d) => d.added), [4, 4]);
  const work = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(work.permissions.deny, ['Read(./secret)', ...MIRAI_DENIES]);
  assert.deepEqual([work.model, work.permissions.allow], ['x', ['Bash(ls)']]);
  const synced = JSON.parse(readFileSync(join(home, 'claude-config', 'settings.json'), 'utf8'));
  assert.deepEqual(synced.permissions.deny, [...MIRAI_DENIES], 'written through the link, into your synced file');
  assert.deepEqual(synced.hooks, { Stop: [] });
  assert.deepEqual(writeUserDenies(env).map((d) => d.added), [0, 0], 'once');
  // An unreadable file is left as it is, and named.
  writeFileSync(join(home, '.claude', 'settings.json'), '{ not json');
  assert.match(writeUserDenies(env).find((d) => d.skipped)?.skipped ?? '', /left as it is/);
  assert.equal(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'), '{ not json');
});
