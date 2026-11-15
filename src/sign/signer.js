import { StoreError } from '../cli/errors.js';
import { branchKeys, keyIsProtected, loadMachineKey, loadSigningKey } from './keys.js';
import { holderSign, holderStatus, startHolder, unlockSetting } from './unlock.js';

// Your signer for a store: { privateKey, keyId, keys } (unit 06). Refused when the key isn't on
// the integration branch yet, or is revoked: a signature nobody can verify is worth nothing.
// `passphrase` (unit 29b): for a protected key.
export function loadSigner(env, store, { passphrase } = {}) {
  const key = loadSigningKey(env, { passphrase });
  const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
  const committed = keys.get(key.keyId);
  if (!committed) {
    throw new StoreError(`your key ${key.keyId} is not on the integration branch (${store.branch}) yet`, {
      code: 'key-not-committed',
      hint: `commit and push .mirai/keys/${key.keyId}.pub to ${store.branch} yourself (or pull, if it's merged already), then try again`,
    });
  }
  if (committed.kind === 'machine') throw new StoreError(`${key.keyId} is committed as a machine key, not yours`, { code: 'key-kind', hint: `commit it as .mirai/keys/${key.keyId}.pub` });
  if (committed.revokedAt !== null) {
    throw new StoreError(`your key ${key.keyId} is revoked`, { code: 'key-revoked', hint: 'make a new one: mirai key new --replace, and commit its .pub' });
  }
  return { privateKey: key.privateKey, keyId: key.keyId, keys };
}

// The signer for MIRAI's records (unit 29b, decision 2: the baseline, red-team results, the
// tested Claude Code, branch records, proofs): the machine key once it's on the integration
// branch, else your key as before (unit 06). Your protected key can't sign a record with nobody
// there: the hint names the machine key.
export function loadRecordSigner(env, store) {
  const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
  const machine = loadMachineKey(env);
  if (machine) {
    const committed = keys.get(machine.keyId);
    if (committed && committed.kind === 'machine' && committed.revokedAt === null) return { privateKey: machine.privateKey, keyId: machine.keyId, keys, kind: 'machine' };
  }
  try {
    return { ...loadSigner(env, store), kind: 'human' };
  } catch (err) {
    if (err.code !== 'key-locked') throw err;
    throw new StoreError('your key is protected, and MIRAI\'s records are signed with the machine key, which isn\'t set up here', {
      code: 'no-machine-key',
      hint: machine ? `commit and push .mirai/keys/${machine.keyId}.machine.pub to ${store.branch} yourself, then try again` : 'make it: mirai key new --machine, then commit its .machine.pub by itself and push it',
    });
  }
}

// Whether MIRAI's records can be signed with the machine key here: it's on this machine and on
// the integration branch, as a machine key, not revoked (unit 29b).
export function machineReady(env, store) {
  try {
    const m = loadMachineKey(env);
    const c = m ? branchKeys(store.checkout, store.branch, store.gitEnv).get(m.keyId) : null;
    return Boolean(c && c.kind === 'machine' && c.revokedAt === null);
  } catch {
    return false;
  }
}

// Your signer for a decision (unit 29b, decisions 1 and 3), asked in your terminal:
// - a plain key (not protected yet): the ticket key typed, as before;
// - your key unlocked by the holder: the ticket key typed, signed through the holder;
// - else your passphrase, in place of the typed key; with `[signing] unlock` set to a duration,
//   the holder keeps it unlocked that long afterwards.
// `prompter`: the command's (createPrompter); `ticket`: what's confirmed. Returns the signer.
export async function decisionSigner(io, store, { prompter, ticket, confirm }) {
  if (!keyIsProtected(io.env)) {
    await confirm(prompter, ticket);
    return loadSigner(io.env, store);
  }
  const held = holderStatus(io.env);
  if (held) {
    const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
    const committed = keys.get(held.keyId);
    if (committed && committed.kind !== 'machine' && committed.revokedAt === null) {
      io.stdout.write(`your key is unlocked until ${new Date(held.until).toLocaleString()} (mirai key lock locks it)\n`);
      await confirm(prompter, ticket);
      return { keyId: held.keyId, keys, signBytes: (bytes) => holderSign(io.env, bytes) };
    }
  }
  const passphrase = await prompter.askHidden(`your passphrase (for ${ticket}): `);
  const signer = loadSigner(io.env, store, { passphrase });
  const ms = unlockSetting(io.env);
  if (ms > 0) {
    try {
      const s = await startHolder(io.env, { passphrase, keyId: signer.keyId, ms });
      io.stdout.write(`your key stays unlocked until ${new Date(s.until).toLocaleString()} (signing.unlock; mirai key lock locks it)\n`);
    } catch (err) {
      io.stdout.write(`note: ${err.message}\n`);
    }
  }
  return signer;
}
