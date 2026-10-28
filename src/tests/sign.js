import { verifySigned } from '../sign/sign.js';
import { resultContext } from './run.js';

// Checking a signed test result (unit 14d; `mirai test --gate`). The whole result.json is signed
// with your key, for this repo: the outcome, the name and path, the exit code, the tree hash,
// HEAD and its branch, the base commit, the frozen compose file's and the trust manifest's
// hashes, Docker's version and the times. Only runs that ended in pass, fail or timeout are
// signed, and only for a whole level or check (no path). This checks the signature and the
// shape; whoever acts on it (unit 25's gate record) decides what counts, such as outcome "pass".
// Returns { ok: true, keyId } or { ok: false, reason }.
export function verifyTestResult(result, keys, repoId) {
  if (!result || typeof result !== 'object') return { ok: false, reason: 'not a test result' };
  const { dir: _local, ...stored } = result;
  if (stored.by !== 'you' || !stored.gate) return { ok: false, reason: 'not a gate run (only mirai test --gate signs)' };
  for (const field of ['outcome', 'name', 'base_sha', 'trust_manifest_sha256', 'frozen_sha256', 'finished_at']) {
    if (stored[field] === undefined) return { ok: false, reason: `the result has no ${field}` };
  }
  if (typeof stored.tree?.hash !== 'string') return { ok: false, reason: 'the result has no tree hash' };
  if (stored.path !== null) return { ok: false, reason: 'a gate result covers a whole level or check, not a path' };
  return verifySigned(stored, keys, { context: resultContext(repoId) });
}
