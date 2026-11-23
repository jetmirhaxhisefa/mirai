import { join } from 'node:path';

import { contentHash } from '../../src/sign/sign.js';
import { nextVerifyRound, recordVerifyResult, subjectHash, verifyResultFor } from '../../src/store/verify-results.js';
import { verifyInputs, verifySubject } from '../../src/verify/run.js';

// Unit 40: a verifier result for the tests that aren't about her. No model runs: the result is
// written to the store as `mirai verify` records one, for `file` as it is now. `findings` default
// to none (a pass); `round` to the next one.

export function passVera(f, file, { findings = [], round = null, model = 'claude-sonnet-5-5' } = {}) {
  const s = verifySubject({ cwd: f.root ?? f.cwd, env: f.env, file });
  const subject = subjectHash(s.bytes, s.files);
  const before = verifyResultFor(s.store, s.id, subject);
  if (before && findings.length === 0 && round === null) return before;
  const must = findings.filter((x) => x.grade === 'must-fix').length;
  return recordVerifyResult(s.store, s.id, {
    subject_hash: subject, content_hash: contentHash(s.bytes), files: s.files.map((x) => ({ path: x.path, content_hash: contentHash(x.bytes) })),
    round: round ?? nextVerifyRound(s.store, s.id), result: must ? 'open' : 'pass', must_fix: must, suggestions: findings.length - must,
    findings, dropped: [], type: s.type, path: s.path, model, tier: 'standard', launch_id: '20261123010203-0123abcd', at: new Date().toISOString(),
  });
}

// Before an `approve … --file <path>` in a test that isn't about the verifier: her pass for the
// file as it is now, and for a PRD its brief's too (on standard one decision approves both). A file
// she doesn't check (a ticket, an overlay), or one that can't be read, is left to approval.
export function veraBefore(argv, f) {
  const at = argv.indexOf('--file');
  if (argv[0] !== 'approve' || at < 0 || typeof argv[at + 1] !== 'string') return;
  const file = argv[at + 1];
  let s;
  try {
    s = verifySubject({ cwd: f.root ?? f.cwd, env: f.env, file });
  } catch {
    return;
  }
  passVera(f, file);
  if (s.type !== 'prd') return;
  for (const [name, up] of Object.entries(verifyInputs(s).files)) {
    if (!name.startsWith('upstream-brief')) continue;
    try {
      passVera(f, join(s.base, up.path));
    } catch {
      // not a brief the verifier checks
    }
  }
}
