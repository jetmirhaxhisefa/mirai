import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { knownFailures, readBaseline, baselinePath } from '../baseline/store.js';
import { buildRecordPath, checkJudgeable, testsAfter } from '../agent/build.js';
import { commitStep } from '../agent/commit.js';
import { reviewsOf } from '../agent/review.js';
import { parkTicket } from '../loop/park.js';
import { frameworkHash } from '../redteam/key.js';
import { RUNNING_VERSION } from '../install/lock.js';
import { loadSigner } from '../sign/signer.js';
import { contentHash } from '../sign/sign.js';
import { verifyBranchAt } from '../store/branch-record.js';
import { readPrivateFile } from '../store/files.js';
import { commitOf, ignoredNames, lsTree, mergeBase, workTreeChanges } from '../store/git.js';
import { openStore } from '../store/home.js';
import { readRunLog, runIds } from '../store/run-log.js';
import { readTicketStatus } from '../store/tickets.js';
import { gateCheck } from '../tests/gate.js';
import { runTest } from '../tests/run.js';
import { protectionRules } from '../trust/protected.js';
import { snapshot, trustedConfig, trustedRegistry } from '../trust/snapshot.js';
import { codeHash, codePathsHide } from './hash.js';
import { PROOF_NAME, PROOF_SCHEMA, RECORDS_DIR, proofPath, proofText, signProof } from './records.js';

// `mirai gate record <ticket>` (unit 25a; D-16, AR3-15; Jet's decisions 2–7): at ship, MIRAI mints
// the ticket's proofs for its branch's HEAD, in one go:
//   1. your terminal only (decision 7: unattended it parks, `sign-proofs`); HEAD on the ticket's
//      branch, with its branch record (22); a clean tree;
//   2. the code hash at HEAD, from the merge-base with the integration branch (decision 4);
//   3. Rex's latest review passed and is complete, and its commit has the same code hash (a clean
//      rebase keeps it; any code change since → `review-stale`);
//   4. the merge-base's baseline, signed and complete for every level (decision 3);
//   5. every named check and test level run now, at HEAD, signed (decision 5), each judged against
//      that baseline with docs/test-baseline.md's rule;
//   6. the `review` and `gate` proofs written and committed on the branch (decision 6).
// The work tree and the ignored files must be what they were from step 1 to the signature (R3-M8).

const fail = (message, code, exitCode = EXIT.BLOCKED, hint) => Object.assign(new MiraiError(message, exitCode), { code, ...(hint ? { hint } : {}) });
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// What `git status --porcelain=v2 --ignored` would show, as a hash: changed, new and ignored files.
const treeState = (store) => sha256(JSON.stringify([workTreeChanges(store.checkout, store.gitEnv), ignoredNames(store.checkout, store.gitEnv)]));

// The launches' model, tier and verifier rung, from the run logs (newest first): { id: facts }.
function launchFacts(store, ids) {
  const want = new Set(ids.filter(Boolean));
  const out = {};
  for (const run of runIds(store).slice().reverse()) {
    if (Object.keys(out).length === want.size) break;
    let lines;
    try {
      ({ lines } = readRunLog(store, run));
    } catch {
      continue;
    }
    for (const l of lines) {
      if (l.event === 'agent_run' && want.has(l.launch_id) && !out[l.launch_id]) out[l.launch_id] = { model: l.model_used ?? l.model ?? null, tier: l.tier ?? null, rung: l.rung ?? null };
    }
  }
  return out;
}

// The rounds already used for `kind` in the ticket's folder at HEAD (any hash).
function usedRounds(store, ticket, kind) {
  const entries = lsTree(store.checkout, 'HEAD', `${RECORDS_DIR}/${ticket}/`, store.gitEnv) ?? [];
  return entries.map((e) => PROOF_NAME.exec(e.path.split('/').pop())).filter((m) => m && m[1] === kind).map((m) => Number(m[2]));
}

export async function recordProofs({ cwd, env, ticket, unattended = false, run = runTest, signal = null, onCheck = null, now = () => new Date() }) {
  const store = openStore({ cwd, env });
  const status = readTicketStatus(store, ticket)?.status ?? null;
  if (!status) throw fail(`${ticket} has no status in MIRAI`, 'unknown-ticket', EXIT.USAGE);
  if (status.state !== 'in-review') throw fail(`${ticket} is ${status.state}, not in-review: its proofs are minted after Rex's review passes`, 'not-reviewed', EXIT.BLOCKED, `mirai review ${ticket}`);
  // Decision 7: signed from your terminal only until row 29b's machine key.
  if (unattended) {
    parkTicket(store, ticket, { reason: 'sign-proofs' });
    return { ticket, outcome: 'parked', why: 'proofs are signed from your terminal only' };
  }
  let last;
  try {
    last = JSON.parse(readFileSync(buildRecordPath(store, ticket), 'utf8'));
  } catch {
    last = null;
  }
  const branch = last?.branch;
  if (typeof branch !== 'string') throw fail(`${ticket} has no branch MIRAI built`, 'no-branch', EXIT.BLOCKED, `mirai build ${ticket}`);
  let gate;
  try {
    gate = gateCheck(store.checkout, branch, store.gitEnv);
  } catch (err) {
    throw fail(err.message, err.code === 'gate-branch' ? 'wrong-branch' : 'dirty', EXIT.BLOCKED, err.hint);
  }
  const head = gate.head;
  const before = treeState(store);
  const signer = loadSigner(env, store);
  const { keys } = signer;
  const mine = verifyBranchAt({ root: store.checkout, env: store.gitEnv, branch, keys, repoId: store.repoId });
  if (!mine.ok || mine.record.ticket !== ticket) throw fail(`${branch} isn't ${ticket}'s MIRAI branch: ${mine.ok ? `its record is for ${mine.record.ticket}` : mine.reason}`, 'wrong-branch');

  const trust = snapshot({ cwd, env, now });
  const config = trustedConfig(trust);
  const codePaths = config.gate?.code_paths;
  const hidden = codePathsHide(codePaths, protectionRules(trustedRegistry(trust), config).rules, config.docs?.root);
  if (hidden.length) throw fail(`gate.code_paths leaves protected paths out of the proof hash (${hidden.slice(0, 3).map((h) => h.path).join(', ')})`, 'code-paths-hide', EXIT.CONFIG, 'only .mirai/** and the docs root may be excluded: fix [gate] code_paths on the integration branch');
  const base = mergeBase(store.checkout, trust.baseSha, head, store.gitEnv);
  if (!base) throw fail(`${branch} shares no history with ${store.branch}`, 'no-base');
  const code = codeHash({ root: store.checkout, env: store.gitEnv, base, head, codePaths });
  if (!code.files.length) throw fail(`${branch} changes nothing in the code paths since ${store.branch}`, 'nothing-to-prove');

  // 3. The review: the latest is a complete pass, for the same code.
  const reviews = reviewsOf(store, ticket);
  const review = reviews.at(-1) ?? null;
  if (!review || review.record.outcome !== 'pass' || review.record.complete !== true) {
    throw fail(`${ticket}'s latest review ${review ? `(${review.n}) is ${review.record.incomplete ? 'incomplete' : review.record.outcome}` : 'is missing'}: a proof needs Rex's pass`, 'no-review', EXIT.BLOCKED, `mirai review ${ticket}`);
  }
  const reviewed = commitOf(store.checkout, review.record.commit, store.gitEnv);
  const reviewBase = reviewed ? mergeBase(store.checkout, trust.baseSha, reviewed, store.gitEnv) : null;
  const reviewedHash = reviewBase ? codeHash({ root: store.checkout, env: store.gitEnv, base: reviewBase, head: reviewed, codePaths }).hash : null;
  if (reviewedHash !== code.hash) throw fail(`the code changed since Rex reviewed it (review ${review.n} at ${String(review.record.commit).slice(0, 12)})`, 'review-stale', EXIT.BLOCKED, `mirai review ${ticket}`);

  // 4. The merge-base's baseline (decision 3).
  try {
    checkJudgeable({ store, config, keys, base, branch: store.branch, integration: trust.baseSha });
  } catch (err) {
    throw fail(err.message, 'no-baseline', EXIT.BLOCKED, err.hint);
  }
  const baseline = readBaseline(store, base, { keys });
  const baselineDigest = contentHash(readPrivateFile(baselinePath(store, base), { maxBytes: 64 * 1024 * 1024 }));

  // 5. Every check and level, now, signed (decision 5).
  const results = new Map();
  const signedRun = async (o) => {
    const r = await run({ ...o, by: 'you', gate: { branch, head, signer } });
    results.set(o.name, r);
    return r;
  };
  const tests = await testsAfter({ cwd, env, store, trust, config, keys, base, run: signedRun, signal, onCheck });
  if (treeState(store) !== before || commitOf(store.checkout, 'HEAD', store.gitEnv) !== head) throw fail('the work tree changed while the gate ran', 'dirty', EXIT.BLOCKED, 'look for a process still working in the project, then run it again');
  if (tests.verdict === 'fail') return { ticket, outcome: 'gate-failed', why: tests.runs.filter((x) => x.verdict === 'fail').map((x) => `${x.name}: ${x.why}${x.fresh?.length ? ` (${x.fresh.slice(0, 5).join(', ')})` : ''}`).join('; '), tests, hash: code.hash };
  if (tests.verdict !== 'pass') return { ticket, outcome: 'cant-tell', why: [tests.why, ...tests.runs.filter((x) => x.verdict === 'unknown').map((x) => `${x.name}: ${x.why}`)].filter(Boolean).join('; '), tests, hash: code.hash };

  // 6. The proofs.
  const common = { schema: PROOF_SCHEMA, ticket, code_hash: code.hash, base_sha: base, head_sha: head, trust_root_hash: trust.manifestSha256, framework_version: RUNNING_VERSION, framework_hash: frameworkHash(trust, { all: true }), trace: 'n/a', outcome: 'pass', minted_at: now().toISOString() };
  const passes = review.record.passes ?? {};
  const launchIds = [...Object.values(passes).map((p) => p?.launch), review.record.check?.launch].filter(Boolean);
  const facts = launchFacts(store, launchIds);
  const reviewProof = {
    ...common,
    kind: 'review',
    round: review.record.round ?? review.n,
    review: { n: review.n, commit: review.record.commit, code_hash: reviewedHash, risk: review.record.risk, depth: review.record.depth ?? 'normal' },
    passes: Object.fromEntries(Object.entries(passes).map(([name, p]) => [name, { state: p?.state ?? null, launch: p?.launch ?? null }])),
    ...(review.record.check ? { check: { state: review.record.check.state ?? null, launch: review.record.check.launch ?? null } } : {}),
    launches: launchIds.map((id) => ({ id, ...(facts[id] ?? { model: null, tier: null, rung: null }) })),
  };
  const gateProof = {
    ...common,
    kind: 'gate',
    round: Math.max(0, ...usedRounds(store, ticket, 'gate')) + 1,
    levels: tests.runs.map((x) => {
      const r = results.get(x.name);
      const { dir: _dir, ...stored } = r ?? {};
      return {
        name: x.name,
        outcome: x.outcome,
        verdict: x.verdict,
        tests: x.tests ?? null,
        result_id: r?.id ?? null,
        result_digest: r ? contentHash(Buffer.from(`${JSON.stringify(stored, null, 2)}\n`)) : null,
        ...(x.outcome === 'fail' ? { known: (knownFailures(baseline, x.name) ?? []).map(({ id, scope, kind }) => ({ id: id ?? null, scope, kind: kind ?? null })) } : {}),
      };
    }),
    baseline: {
      sha: base,
      digest: baselineDigest,
      known_failures: Object.fromEntries(tests.runs.map((x) => [x.name, (knownFailures(baseline, x.name) ?? []).map(({ id, scope, kind }) => ({ id: id ?? null, scope, kind: kind ?? null }))])),
    },
  };
  const written = [];
  const files = [];
  for (const proof of [reviewProof, gateProof]) {
    const path = proofPath(ticket, { kind: proof.kind, round: proof.round, codeHash: proof.code_hash });
    // Immutable: a review proof for this round and hash already there is kept as it is.
    if ((lsTree(store.checkout, 'HEAD', path, store.gitEnv) ?? []).some((e) => e.path === path)) continue;
    const signed = signProof(proof, signer, { repoId: store.repoId, now });
    files.push({ path, text: proofText(signed) });
    written.push(path);
  }
  // Written only now, into a tree that is still what it was, then committed alone (decision 6).
  if (treeState(store) !== before || commitOf(store.checkout, 'HEAD', store.gitEnv) !== head) throw fail('the work tree changed before the proofs were written', 'dirty', EXIT.BLOCKED, 'look for a process still working in the project, then run it again');
  for (const f of files) writeProofFile(store.checkout, f);
  const sha = commitStep({
    store, env, config, ticket, what: 'proofs',
    body: `Review ${review.n} and gate attempt ${gateProof.round} for code ${code.hash.slice(7, 19)}.`,
    before: () => {
      const changes = workTreeChanges(store.checkout, store.gitEnv);
      const expected = new Set(written.map((p) => `? ${p}`));
      if (changes.length !== expected.size || changes.some((c) => !expected.has(c))) throw fail('something besides the proofs changed in the work tree', 'dirty', EXIT.BLOCKED, 'look for a process still working in the project; nothing was committed');
    },
  });
  return { ticket, outcome: 'recorded', hash: code.hash, files: code.files, commit: sha, written, review: review.n, gate: gateProof.round, tests, base };
}

// A proof file in the checkout: its folder made, the file created new (never overwritten).
function writeProofFile(checkout, { path, text }) {
  const abs = join(checkout, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text, { flag: 'wx', mode: 0o644 });
}
