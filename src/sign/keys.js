import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { StoreError } from '../cli/errors.js';
import { atomicWrite, checkPrivateFile, ensurePrivateDir, readPrivateFile } from '../store/files.js';
import { catBlobs, lsTree, refExists, treeId } from '../store/git.js';
import { validTime } from './time.js';

// Signing keys (unit 06; D-17). One Ed25519 pair per machine, through node:crypto:
//   ~/.config/mirai/signing.ed25519   the private key (PKCS#8 PEM, 0600; yours only, denied to agents)
//   ~/.config/mirai/signing.json      { key_id, label, created_at }
//   <project>/.mirai/keys/<id>.pub    the public key (SPKI PEM), committed by you
//   <project>/.mirai/keys/<id>.revoked { revoked_at, reason? }, committed by you
// Unit 29b: your key's file is encrypted with your passphrase (PKCS#8, AES-256) once you protect
// it; the machine key (machine.ed25519, plain, 0600) signs MIRAI's records, never your decisions,
// and its public key is committed as <id>.machine.pub.
// The key id is derived from the public key, so a file can't claim another key's id. Public keys
// count only when they're on the integration branch (never the work tree): any branch can edit
// the work tree's .mirai/keys/.

export const KEY_ID = /^k-[0-9a-f]{16}$/;
const KEYS_DIR = '.mirai/keys';

export function keyPaths(env) {
  if (!env.HOME || !isAbsolute(env.HOME)) throw new StoreError('HOME is not set to an absolute path', { code: 'no-home' });
  const dir = join(env.HOME, '.config', 'mirai');
  return { dir, privateKey: join(dir, 'signing.ed25519'), meta: join(dir, 'signing.json'), machineKey: join(dir, 'machine.ed25519'), machineMeta: join(dir, 'machine.json') };
}

// The key id of a public key: k- and the first 16 hex characters of SHA-256 over its raw bytes.
export function keyIdOf(publicKey) {
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  return `k-${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`;
}

// Makes a new key pair. Refuses when one exists, unless `replace` (the old private key is kept as
// signing.ed25519.old-<time>, for you to revoke). Returns { keyId, label, publicPem }; the
// private key never leaves this function except into its file. (With one key per machine and
// many repos, `mirai key new` in another repo publishes the existing key instead: publicPemOf.)
export function createKeyPair(env, { label = hostname(), replace = false, passphrase = null, now = () => new Date() } = {}) {
  const p = keyPaths(env);
  mkdirSync(join(env.HOME, '.config'), { recursive: true, mode: 0o700 });
  ensurePrivateDir(p.dir);
  if (checkPrivateFile(p.privateKey)) {
    if (!replace) throw new StoreError('a signing key already exists on this machine', { code: 'key-exists', hint: 'to rotate it: mirai key new --replace, then mirai key revoke <old id>' });
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    renameSync(p.privateKey, `${p.privateKey}.old-${stamp}`);
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyId = keyIdOf(publicKey);
  atomicWrite(p.privateKey, privateKey.export({ type: 'pkcs8', format: 'pem', ...(passphrase !== null ? { cipher: 'aes-256-cbc', passphrase: checkPassphrase(passphrase) } : {}) }));
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  atomicWrite(p.meta, `${JSON.stringify({ key_id: keyId, label: String(label).slice(0, 64), created_at: now().toISOString(), public_pem: publicPem }, null, 2)}\n`);
  return { keyId, label, publicPem };
}

// Your signing key: { keyId, label, privateKey, publicKey }. The private key file gets the
// store's checks (real file, yours, 0600). The id is derived again, so an edited signing.json
// can't change it.
// Unit 29b: a protected key needs `passphrase`; without one it's `key-locked`, with a wrong one
// `bad-passphrase` (nothing about the key is said either way).
export function loadSigningKey(env, { passphrase } = {}) {
  const p = keyPaths(env);
  const pem = readPrivateFile(p.privateKey, { maxBytes: 4096, optional: true });
  if (pem === null) throw new StoreError('there is no signing key on this machine', { code: 'no-key', hint: 'make one: mirai key new' });
  const encrypted = ENCRYPTED.test(pem);
  if (encrypted && (passphrase === undefined || passphrase === null)) throw new StoreError('your key is protected: this needs your passphrase', { code: 'key-locked', hint: 'run it in your terminal, where MIRAI asks for it' });
  let privateKey;
  try {
    privateKey = encrypted ? createPrivateKey({ key: pem, format: 'pem', passphrase }) : createPrivateKey(pem);
  } catch {
    if (encrypted) throw new StoreError('that isn\'t your passphrase', { code: 'bad-passphrase', hint: 'try again; a forgotten passphrase can\'t be recovered: mirai key new --replace, then mirai key revoke <old id>' });
    throw new StoreError(`${p.privateKey}: is not a readable private key`, { path: p.privateKey, code: 'bad-key', hint: 'make a new one: mirai key new --replace' });
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new StoreError(`${p.privateKey}: is not an Ed25519 key`, { path: p.privateKey, code: 'bad-key' });
  const publicKey = createPublicKey(privateKey);
  let label = null;
  const meta = readPrivateFile(p.meta, { maxBytes: 4096, optional: true });
  if (meta !== null) {
    try {
      label = JSON.parse(meta).label ?? null;
    } catch {
      label = null;
    }
  }
  return { keyId: keyIdOf(publicKey), label, privateKey, publicKey, protected: encrypted };
}

// Unit 29b: a passphrase is any length you choose (Jet, 2026-11-15: no minimum), but not empty and
// on one line. A short one is yours to weigh: the encrypted file can be guessed at offline.
export const PASSPHRASE_MIN = 1;
// Written as -{5}, so MIRAI's own source never looks like a key to the secret scan (registry/secrets).
const ENCRYPTED = /^-{5}BEGIN ENCRYPTED PRIVATE KEY-{5}/;
export function checkPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || [...passphrase].length < PASSPHRASE_MIN || /[\n\r]/.test(passphrase)) throw new StoreError('a passphrase can\'t be empty, and is one line', { code: 'weak-passphrase', hint: 'type at least one character' });
  return passphrase;
}

// Whether your key file is protected (encrypted), without reading the key.
export function keyIsProtected(env) {
  const pem = readPrivateFile(keyPaths(env).privateKey, { maxBytes: 4096, optional: true });
  return pem !== null && ENCRYPTED.test(pem);
}

// Encrypts your key in place with a passphrase (unit 29b): the same key, so its id and every
// signature so far stay valid. `current`: the passphrase it has now, to change it.
export function protectKey(env, passphrase, { current } = {}) {
  const key = loadSigningKey(env, { passphrase: current });
  const pem = key.privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: checkPassphrase(passphrase) });
  atomicWrite(keyPaths(env).privateKey, pem);
  // The public half beside it, so mirai key show and status need no passphrase.
  const meta = (() => {
    try {
      return JSON.parse(readPrivateFile(keyPaths(env).meta, { maxBytes: 8192, optional: true }) ?? '{}');
    } catch {
      return {};
    }
  })();
  atomicWrite(keyPaths(env).meta, `${JSON.stringify({ ...meta, key_id: key.keyId, public_pem: key.publicKey.export({ type: 'spki', format: 'pem' }) }, null, 2)}\n`);
  // Read back with it before saying so: a key that can't be opened again would lock you out.
  if (loadSigningKey(env, { passphrase }).keyId !== key.keyId) throw new StoreError('the protected key didn\'t read back as yours', { code: 'bad-key' });
  return { keyId: key.keyId, was: key.protected ? 'protected' : 'plain' };
}

// The machine key (unit 29b, decision 2): MIRAI's records only. Plain (MIRAI signs with nobody
// there), 0600 in ~/.config/mirai. One per machine, as yours.
export function createMachineKey(env, { replace = false, now = () => new Date() } = {}) {
  const p = keyPaths(env);
  mkdirSync(join(env.HOME, '.config'), { recursive: true, mode: 0o700 });
  ensurePrivateDir(p.dir);
  if (checkPrivateFile(p.machineKey)) {
    if (!replace) throw new StoreError('a machine key already exists on this machine', { code: 'key-exists', hint: 'its public key: mirai key show; to rotate it: mirai key new --machine --replace' });
    renameSync(p.machineKey, `${p.machineKey}.old-${now().toISOString().replace(/[:.]/g, '-')}`);
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyId = keyIdOf(publicKey);
  atomicWrite(p.machineKey, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  atomicWrite(p.machineMeta, `${JSON.stringify({ key_id: keyId, kind: 'machine', created_at: now().toISOString() }, null, 2)}\n`);
  return { keyId, publicPem: publicKey.export({ type: 'spki', format: 'pem' }) };
}

// The machine key, or null when this machine has none.
export function loadMachineKey(env) {
  const p = keyPaths(env);
  const pem = readPrivateFile(p.machineKey, { maxBytes: 4096, optional: true });
  if (pem === null) return null;
  let privateKey;
  try {
    privateKey = createPrivateKey(pem);
  } catch {
    throw new StoreError(`${p.machineKey}: is not a readable private key`, { path: p.machineKey, code: 'bad-key', hint: 'make a new one: mirai key new --machine --replace' });
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new StoreError(`${p.machineKey}: is not an Ed25519 key`, { code: 'bad-key' });
  const publicKey = createPublicKey(privateKey);
  return { keyId: keyIdOf(publicKey), privateKey, publicKey, kind: 'machine' };
}

// .mirai and .mirai/keys must be real folders, so the file lands in the repo.
// Your existing key's public half, as written into a repo. A protected key's comes from
// signing.json (written with it), checked: the id is derived from it again.
export function publicPemOf(env) {
  if (keyIsProtected(env)) {
    let meta = null;
    try {
      meta = JSON.parse(readPrivateFile(keyPaths(env).meta, { maxBytes: 8192, optional: true }) ?? 'null');
    } catch {
      meta = null;
    }
    let publicKey = null;
    try {
      publicKey = meta?.public_pem ? createPublicKey(meta.public_pem) : null;
    } catch {
      publicKey = null;
    }
    if (!publicKey || publicKey.asymmetricKeyType !== 'ed25519') throw new StoreError('your protected key\'s public half isn\'t on record', { code: 'no-public', hint: 'mirai key passphrase writes it again (it asks your passphrase)' });
    return { keyId: keyIdOf(publicKey), label: meta.label ?? null, publicPem: publicKey.export({ type: 'spki', format: 'pem' }), publicKey };
  }
  const key = loadSigningKey(env);
  return { keyId: key.keyId, label: key.label, publicPem: key.publicKey.export({ type: 'spki', format: 'pem' }), publicKey: key.publicKey };
}

function keysDirIn(checkout) {
  for (const dir of [join(checkout, '.mirai'), join(checkout, KEYS_DIR)]) {
    try {
      const info = lstatSync(dir);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new StoreError(`${dir} is not a real folder`, { code: 'symlink' });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      mkdirSync(dir);
    }
  }
  return join(checkout, KEYS_DIR);
}

// Writes your public key into the project, for you to commit and push (the bootstrap path).
export function writePublicKeyFile(checkout, keyId, publicPem, { machine = false } = {}) {
  if (!KEY_ID.test(keyId)) throw new TypeError('not a key id');
  const name = `${keyId}${machine ? '.machine' : ''}.pub`;
  const file = join(keysDirIn(checkout), name);
  try {
    writeFileSync(file, publicPem, { flag: 'wx', mode: 0o644 });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    if (readFileSync(file, 'utf8') !== publicPem) throw new StoreError(`${KEYS_DIR}/${name} already exists with another key`, { code: 'key-mismatch' });
  }
  return `${KEYS_DIR}/${name}`;
}

// Writes a revocation for a key id, for you to commit.
export function writeRevocation(checkout, keyId, { reason, now = () => new Date() } = {}) {
  if (!KEY_ID.test(keyId)) throw new TypeError('not a key id');
  const file = join(keysDirIn(checkout), `${keyId}.revoked`);
  const body = { revoked_at: now().toISOString(), ...(reason ? { reason: String(reason).slice(0, 200) } : {}) };
  try {
    writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
  } catch (err) {
    if (err.code === 'EEXIST') throw new StoreError(`${keyId} is already revoked`, { code: 'revoked' });
    throw err;
  }
  return `${KEYS_DIR}/${keyId}.revoked`;
}

// The ref the integration branch resolves to here: the local branch, or, when there is none,
// origin's remote-tracking branch (as the repo identity does, 05a). Null when neither exists.
export function integrationRef(checkout, branch, env) {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    if (refExists(checkout, ref, env)) return ref;
  }
  return null;
}

// Keys read from one tree are the same until the tree changes: cached by tree id.
const cache = new Map();

// The public keys committed at `ref` (a branch ref, or a commit id for CI's base commit, unit
// 54): { keys, problems }. `keys` maps key id → { publicKey, revokedAt } (revokedAt: ms since
// 1970, or null). Files that verify nothing are left out of `keys` and listed in `problems`
// ({ path, reason }) for doctor: a .pub whose derived id doesn't match its name or that isn't an
// Ed25519 key. A revocation that can't be read, or has no real date, revokes from the start
// (fail closed).
export function readCommittedKeys(checkout, ref, env) {
  const tree = ref ? treeId(checkout, ref, KEYS_DIR, env) : null;
  if (tree === null) return { keys: new Map(), problems: [] };
  const hit = cache.get(`${checkout}\0${tree}`);
  if (hit) return hit;
  const entries = (lsTree(checkout, ref, `${KEYS_DIR}/`, env) ?? []).filter((e) => e.type === 'blob');
  const blobs = catBlobs(checkout, entries.map((e) => e.sha), env);
  const keys = new Map();
  const revoked = new Map();
  const problems = [];
  for (const e of entries) {
    const m = /^\.mirai\/keys\/(k-[0-9a-f]{16})(?:(\.machine)\.pub|\.(pub|revoked))$/.exec(e.path);
    if (!m) {
      problems.push({ path: e.path, reason: 'not a key or revocation file' });
      continue;
    }
    const ext = m[2] ? 'pub' : m[3];
    const kind = m[2] ? 'machine' : 'human';
    const bytes = blobs.get(e.sha);
    if (!bytes) {
      problems.push({ path: e.path, reason: 'too large or unreadable' });
      if (ext === 'revoked') revoked.set(m[1], 0);
      continue;
    }
    const text = bytes.toString('utf8');
    if (ext === 'pub') {
      let publicKey = null;
      try {
        publicKey = createPublicKey(text);
      } catch {
        publicKey = null;
      }
      // One key, one kind: a key committed as both yours and the machine's counts as the machine's.
      if (publicKey?.asymmetricKeyType === 'ed25519' && keyIdOf(publicKey) === m[1]) {
        if (keys.has(m[1])) problems.push({ path: e.path, reason: 'the same key is committed twice; it counts as a machine key only' });
        keys.set(m[1], { publicKey, kind: keys.get(m[1])?.kind === 'machine' || kind === 'machine' ? 'machine' : 'human' });
      } else problems.push({ path: e.path, reason: 'not an Ed25519 key with this id' });
    } else {
      let at = 0;
      try {
        const r = JSON.parse(text);
        if (validTime(r.revoked_at)) at = Date.parse(r.revoked_at);
        else problems.push({ path: e.path, reason: 'no real revoked_at date: revoked from the start' });
      } catch {
        problems.push({ path: e.path, reason: 'unreadable: revoked from the start' });
      }
      revoked.set(m[1], at);
    }
  }
  const result = Object.freeze({
    keys: new Map([...keys].map(([id, k]) => [id, Object.freeze({ publicKey: k.publicKey, kind: k.kind, revokedAt: revoked.has(id) ? revoked.get(id) : null })])),
    problems: Object.freeze(problems),
  });
  cache.set(`${checkout}\0${tree}`, result);
  return result;
}

// The keys committed at a ref: key id → { publicKey, kind: 'human' | 'machine', revokedAt }.
export function committedKeys(checkout, ref, env) {
  return readCommittedKeys(checkout, ref, env).keys;
}

// The keys on a branch, resolved as integrationRef does.
export function branchKeys(checkout, branch, env) {
  return committedKeys(checkout, integrationRef(checkout, branch, env), env);
}

// The fingerprint you compare by eye: SHA-256 over the raw public key, in base64.
export function fingerprintOf(publicKey) {
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  return `SHA256:${createHash('sha256').update(raw).digest('base64').replace(/=+$/, '')}`;
}
