import { StoreError } from '../cli/errors.js';
import { branchKeys, loadSigningKey } from './keys.js';

// Your signer for a store: { privateKey, keyId, keys } (unit 06). Refused when the key isn't on
// the integration branch yet, or is revoked: a signature nobody can verify is worth nothing.
export function loadSigner(env, store) {
  const key = loadSigningKey(env);
  const keys = branchKeys(store.checkout, store.branch, store.gitEnv);
  const committed = keys.get(key.keyId);
  if (!committed) {
    throw new StoreError(`your key ${key.keyId} is not on the integration branch (${store.branch}) yet`, {
      code: 'key-not-committed',
      hint: `commit and push .mirai/keys/${key.keyId}.pub to ${store.branch} yourself (or pull, if it's merged already), then try again`,
    });
  }
  if (committed.revokedAt !== null) {
    throw new StoreError(`your key ${key.keyId} is revoked`, { code: 'key-revoked', hint: 'make a new one: mirai key new --replace, and commit its .pub' });
  }
  return { privateKey: key.privateKey, keyId: key.keyId, keys };
}
