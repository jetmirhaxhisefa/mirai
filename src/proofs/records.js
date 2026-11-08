import { parseJsonStrict } from '../findings/schema.js';
import { signObject, verifySigned } from '../sign/sign.js';
import { TICKET_ID } from '../status/ticket-file.js';

// Proof records (unit 25a; D-16, AR-22, Q9): one immutable file per record, committed on the
// ticket's branch, `.mirai/records/<ticket>/<kind>-r<n>-<hash12>.json`: the kind, the round (review)
// or attempt (gate), and the first 12 hex of the code hash it is bound to (the full hash inside).
// Canonical JSON signed with your key (Ed25519, a key id; unit 06), context `mirai/proof/1:<repo-id>`
// with the kind inside the signed body, so a proof can't pass as another kind or another repo's.
// A proof says "this passed for exactly this code", never what was found (Q9: no findings).

export const PROOF_SCHEMA = 'mirai-proof/1';
export const PROOF_KINDS = Object.freeze(['review', 'gate', 'qa']);
export const proofContext = (repoId) => `mirai/proof/1:${repoId}`;
export const RECORDS_DIR = '.mirai/records';
const HASH = /^sha256:[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
export const PROOF_NAME = /^(review|gate|qa)-r([1-9][0-9]{0,3})-([0-9a-f]{12})\.json$/;
export const MAX_PROOF_BYTES = 256 * 1024;

export const proofName = ({ kind, round, codeHash }) => `${kind}-r${round}-${codeHash.slice('sha256:'.length, 'sha256:'.length + 12)}.json`;
export const proofPath = (ticket, proof) => `${RECORDS_DIR}/${ticket}/${proofName(proof)}`;
export const proofText = (proof) => `${JSON.stringify(proof, null, 2)}\n`;

// A proof's fields, checked before signing and after reading: a problem (string) or null.
export function proofProblem(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'not an object';
  if (p.schema !== PROOF_SCHEMA) return 'not a proof record';
  if (!PROOF_KINDS.includes(p.kind)) return `an unknown kind (${String(p.kind).slice(0, 20)})`;
  if (typeof p.ticket !== 'string' || !TICKET_ID.test(p.ticket)) return 'no ticket';
  if (!Number.isSafeInteger(p.round) || p.round < 1 || p.round > 9999) return 'no round';
  if (typeof p.code_hash !== 'string' || !HASH.test(p.code_hash)) return 'no code hash';
  for (const f of ['base_sha', 'head_sha']) if (typeof p[f] !== 'string' || !SHA.test(p[f])) return `no ${f}`;
  if (typeof p.trust_root_hash !== 'string' || !/^[0-9a-f]{64}$/.test(p.trust_root_hash)) return 'no trust root hash';
  if (typeof p.framework_version !== 'string' || p.framework_version === '') return 'no framework version';
  if (p.trace !== 'n/a' && (typeof p.trace !== 'object' || p.trace === null)) return 'no trace';
  if (typeof p.minted_at !== 'string') return 'no minting time';
  if (p.outcome !== 'pass') return 'a proof is of a pass only';
  // A proof never carries findings (Q9).
  if (Object.hasOwn(p, 'findings') || Object.hasOwn(p, 'followups')) return 'a proof holds no findings';
  return null;
}

// Signs a proof: the signed object.
export function signProof(proof, signer, { repoId, now = () => new Date() }) {
  const problem = proofProblem(proof);
  if (problem) throw new TypeError(`not a proof: ${problem}`);
  return signObject(proof, signer, { context: proofContext(repoId), now });
}

// A proof file's bytes, checked: { ok, proof?, keyId?, reason? }. `name`: the file's name, which
// must be the one its fields give; `ticket`: the folder's ticket.
export function readProof(bytes, { name, ticket, keys, repoId }) {
  if (bytes.length > MAX_PROOF_BYTES) return { ok: false, reason: 'larger than a proof can be' };
  let proof;
  try {
    proof = parseJsonStrict(bytes.toString('utf8'), { maxBytes: MAX_PROOF_BYTES });
  } catch (err) {
    return { ok: false, reason: `not JSON MIRAI reads (${String(err.message).slice(0, 80)})` };
  }
  const problem = proofProblem(proof);
  if (problem) return { ok: false, reason: problem };
  if (proof.ticket !== ticket) return { ok: false, reason: `a proof for ${proof.ticket}, in ${ticket}'s folder` };
  if (proofName({ kind: proof.kind, round: proof.round, codeHash: proof.code_hash }) !== name) return { ok: false, reason: 'its name isn\'t the one its fields give' };
  const v = verifySigned({ ...proof }, keys, { context: proofContext(repoId) });
  if (!v.ok) return { ok: false, reason: v.reason };
  return { ok: true, proof, keyId: v.keyId };
}
