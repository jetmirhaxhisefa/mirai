import { createHash, sign as edSign, verify as edVerify } from 'node:crypto';

import { canonical } from './canonical.js';
import { KEY_ID } from './keys.js';
import { validTime } from './time.js';

export { validTime };

// Signing and verifying (unit 06; D-17). A signed object carries
//   signature: { alg: "ed25519", key_id, ts, sig }
// where `sig` is base64 over the canonical bytes of the object with its signature record minus
// `sig` (so key_id and ts are covered too), plus a **context** that isn't stored: what the
// signature is for and where, such as "mirai/journal/2:<repo-id>". The verifier supplies the
// same context, so a line copied into another repo's journal, or a journal line passed off as a
// proof record, doesn't verify (one key per machine signs for every repo, D-52).
//
// Honest limit (D-17; docs/signing.md): this resists accidental and casual forgery. Agents run as
// your own user, so it's only as strong as the deny rules and the sandbox (units 13, 18):
// - around ~/.config/mirai, the private key;
// - around the `mirai approve | drop | key` commands, and terminal emulators that drive them
//   (expect, script, unbuffer, a pty): the real-terminal check stops piped input, not those;
// - around .git writes: a process that moves your local integration branch can make its own key
//   "committed" locally. The real check is CI against the remote base commit (unit 54).
// `ts` is written by the signer: someone holding a revoked key could backdate a signature;
// revocation stops later use, not a stolen key used with an old date (CI can also compare
// commit times, unit 54).

const B64 = /^[A-Za-z0-9+/]{86}==$/; // an Ed25519 signature is 64 bytes
const CONTEXT = /^mirai\/[a-z0-9-]+\/\d+:[A-Za-z0-9._-]{1,128}$/;

function payload(object, { alg, key_id, ts }, context) {
  if (typeof context !== 'string' || !CONTEXT.test(context)) throw new TypeError('a signature needs its context, such as "mirai/journal/2:<repo-id>"');
  const { signature: _drop, ...rest } = object;
  return canonical({ ...rest, signature: { alg, key_id, ts, context } });
}

// Signs a plain object with your key ({ privateKey, keyId }) for a context. Returns a new
// object; the context isn't stored, the verifier supplies it.
export function signObject(object, { privateKey, keyId }, { context, now = () => new Date() } = {}) {
  if (!KEY_ID.test(keyId)) throw new TypeError('not a key id');
  const head = { alg: 'ed25519', key_id: keyId, ts: now().toISOString() };
  const sig = edSign(null, payload(object, head, context), privateKey).toString('base64');
  return { ...object, signature: { ...head, sig } };
}

// Checks a signed object against public keys (committedKeys: key id → { publicKey, revokedAt })
// for a context. Returns { ok: true, keyId } or { ok: false, reason }.
export function verifySigned(object, keys, { context } = {}) {
  if (typeof context !== 'string' || !CONTEXT.test(context)) throw new TypeError('verifying needs the signature\'s context');
  const s = object?.signature;
  if (!s || typeof s !== 'object') return { ok: false, reason: 'not signed' };
  // One spelling only: the base64 must be exactly what the 64 bytes encode to.
  const canonicalB64 = B64.test(s.sig ?? '') && Buffer.from(s.sig, 'base64').toString('base64') === s.sig;
  if (s.alg !== 'ed25519' || !KEY_ID.test(s.key_id ?? '') || !validTime(s.ts) || !canonicalB64) {
    return { ok: false, reason: 'the signature record is malformed' };
  }
  const key = keys.get(s.key_id);
  if (!key) return { ok: false, reason: `key ${s.key_id} is not on the integration branch` };
  if (key.revokedAt !== null && Date.parse(s.ts) >= key.revokedAt) return { ok: false, reason: `key ${s.key_id} was revoked before this was signed` };
  let good = false;
  try {
    good = edVerify(null, payload(object, s, context), key.publicKey, Buffer.from(s.sig, 'base64'));
  } catch {
    good = false;
  }
  return good ? { ok: true, keyId: s.key_id } : { ok: false, reason: 'the signature does not match' };
}

// The content hash an approval signs: "sha256:<hex>" over the file's bytes.
export function contentHash(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

// Whether a signed approval still holds for the file as it is now (R2-M11): the signature is
// valid and the bytes are the ones that were approved.
export function verifyApproval(approval, bytesNow, keys, { context } = {}) {
  const v = verifySigned(approval, keys, { context });
  if (!v.ok) return v;
  if (approval.content_hash !== contentHash(bytesNow)) return { ok: false, reason: 'the file changed after it was approved' };
  return v;
}
