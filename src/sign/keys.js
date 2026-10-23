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
// The key id is derived from the public key, so a file can't claim another key's id. Public keys
// count only when they're on the integration branch (never the work tree): any branch can edit
// the work tree's .mirai/keys/.

export const KEY_ID = /^k-[0-9a-f]{16}$/;
const KEYS_DIR = '.mirai/keys';

export function keyPaths(env) {
  if (!env.HOME || !isAbsolute(env.HOME)) throw new StoreError('HOME is not set to an absolute path', { code: 'no-home' });
  const dir = join(env.HOME, '.config', 'mirai');
  return { dir, privateKey: join(dir, 'signing.ed25519'), meta: join(dir, 'signing.json') };
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
export function createKeyPair(env, { label = hostname(), replace = false, now = () => new Date() } = {}) {
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
  atomicWrite(p.privateKey, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  atomicWrite(p.meta, `${JSON.stringify({ key_id: keyId, label: String(label).slice(0, 64), created_at: now().toISOString() }, null, 2)}\n`);
  return { keyId, label, publicPem: publicKey.export({ type: 'spki', format: 'pem' }) };
}

// Your signing key: { keyId, label, privateKey, publicKey }. The private key file gets the
// store's checks (real file, yours, 0600). The id is derived again, so an edited signing.json
// can't change it.
export function loadSigningKey(env) {
  const p = keyPaths(env);
  const pem = readPrivateFile(p.privateKey, { maxBytes: 4096, optional: true });
  if (pem === null) throw new StoreError('there is no signing key on this machine', { code: 'no-key', hint: 'make one: mirai key new' });
  let privateKey;
  try {
    privateKey = createPrivateKey(pem);
  } catch {
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
  return { keyId: keyIdOf(publicKey), label, privateKey, publicKey };
}

// .mirai and .mirai/keys must be real folders, so the file lands in the repo.
// Your existing key's public half, as written into a repo.
export function publicPemOf(env) {
  const key = loadSigningKey(env);
  return { keyId: key.keyId, label: key.label, publicPem: key.publicKey.export({ type: 'spki', format: 'pem' }) };
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
export function writePublicKeyFile(checkout, keyId, publicPem) {
  if (!KEY_ID.test(keyId)) throw new TypeError('not a key id');
  const file = join(keysDirIn(checkout), `${keyId}.pub`);
  try {
    writeFileSync(file, publicPem, { flag: 'wx', mode: 0o644 });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    if (readFileSync(file, 'utf8') !== publicPem) throw new StoreError(`${KEYS_DIR}/${keyId}.pub already exists with another key`, { code: 'key-mismatch' });
  }
  return `${KEYS_DIR}/${keyId}.pub`;
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
    const m = /^\.mirai\/keys\/(k-[0-9a-f]{16})\.(pub|revoked)$/.exec(e.path);
    if (!m) {
      problems.push({ path: e.path, reason: 'not a key or revocation file' });
      continue;
    }
    const bytes = blobs.get(e.sha);
    if (!bytes) {
      problems.push({ path: e.path, reason: 'too large or unreadable' });
      if (m[2] === 'revoked') revoked.set(m[1], 0);
      continue;
    }
    const text = bytes.toString('utf8');
    if (m[2] === 'pub') {
      let publicKey = null;
      try {
        publicKey = createPublicKey(text);
      } catch {
        publicKey = null;
      }
      if (publicKey?.asymmetricKeyType === 'ed25519' && keyIdOf(publicKey) === m[1]) keys.set(m[1], publicKey);
      else problems.push({ path: e.path, reason: 'not an Ed25519 key with this id' });
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
    keys: new Map([...keys].map(([id, publicKey]) => [id, Object.freeze({ publicKey, revokedAt: revoked.has(id) ? revoked.get(id) : null })])),
    problems: Object.freeze(problems),
  });
  cache.set(`${checkout}\0${tree}`, result);
  return result;
}

// The keys committed at a ref: key id → { publicKey, revokedAt }.
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
