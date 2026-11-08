---
unit: "25a"
name: proofs
status: approved (2026-11-08; Jet's seven decisions taken in the interview; not built yet)
roadmap: design/07-implementation-roadmap.md, row 25 (split, Jet's decision 2026-11-08: **25a** the proof records and `mirai gate record|check`; **25b** the documents' park state and loop files from unit 20); D-16 (patch-id records with MIRAI's own hash; R-C1, R2-M7, R3-M11, AR3-6, AR3-15, R3-C2, AR-22); D-15 (pinned git), D-17 (signing), Q9 (no findings in a proof); G14; 17b's review (row 25's notes); D-22's update (records out of the hash)
depends_on: ["05", "06", "09", "12", "14d", "17b", "22", "24a", "24b"]
---

# Unit 25a: proof records and `mirai gate record|check`

## Why

Rex's review (24a, 24b) and the gate's test runs (14d) work, but nothing a push or CI can check says they passed for **this exact code**. Today the review writes an unsigned file in your store, and `mirai test --gate` signs one level at a time, bound to a tree hash that the next commit (a status file, a rebase) already changes. Units 26 (`pre-push`), 27 (`mirai-ship`) and 54 (CI) need one small, signed, committed answer per ticket: "Rex passed this change, and the gate's tests passed on it, judged against this baseline", that stays true across a clean rebase and stops being true after any code change.

Already built and waiting for this unit:

- Signing (06): `signObject` / `verifySigned`, key ids (`k-` + 16 hex), canonical JSON, contexts per record kind; public keys counted only from the integration branch (`readCommittedKeys`).
- Pinned git (D-15, `src/store/git-pins.js`): no system or global config, `LC_ALL=C`, `--no-ext-diff --no-textconv --no-color`.
- `.mirai/records/<ticket>/branch.json` (22): the first signed record on a MIRAI branch, its context `mirai/branch-record/1`.
- The review record (24a, 24b): `tickets/<ticket>/review-r<n>.json` in the store, `outcome: 'pass'`, `complete: true`, the commit, the risk, the passes and the verifier launches.
- `runTest` (14c, 14d): a level or check in its containers from a copy of a commit; `gateCheck` / `gateRecheck`.
- The baseline (17b): signed per integration-branch commit, `knownFailures()`, `againstBaseline()`, the rule in `docs/test-baseline.md`.
- `gate.code_paths` (03b): project layer only, default `['**', '!docs/mirai/**', '!.mirai/**']`, following `docs.root`.

## Decisions (Jet, 2026-11-08, in the interview)

1. **Split:** 25a is the proofs; 25b is the documents' park state and `loop/doc-<id>.json` (unit 20's finding), a spec of its own.
2. **Proofs are minted at ship, by `mirai gate record <ticket>`** (D-16, AR3-15), from the captured review verdict and the gate's own test run, for the head commit, in one go. Unit 27's ship will call it; until then you run it by hand. The review step itself writes no proof.
3. **The gate record embeds the merge-base's baseline:** the baseline of the integration-branch commit that is the ticket's merge-base with the integration branch (what 21b already judges builds against, and what the hash is taken from). A stacked ticket still uses the integration branch's merge-base, never its parent's. No signed, complete baseline for that commit, or one without a level the gate runs → refused (`no-baseline`), with the `mirai baseline` command to run.
4. **The hash is D-16's, as written.** SHA-256 over:
   `git -c core.quotePath=true diff --binary --no-ext-diff --no-textconv --no-renames --no-color --diff-algorithm=myers -U3 --src-prefix=a/ --dst-prefix=b/ <merge-base>..<head> -- <code paths>`
   with the pinned git environment, then: `index …` lines dropped, every hunk header replaced by `@@` (no line numbers, no function label), file sections sorted by path. Whitespace, mode and binary content count. Accepted limit: an identical hunk moved within one file with identical 3-line context keeps the hash.
5. **`gate record` runs the gate's tests itself:** every level and named check of the project, at the head, in their containers (as `mirai test --gate`), each judged against the embedded baseline; it records only when all pass or fail only as known failures.
6. **MIRAI commits the proof files** on the ticket branch: one commit, `Proofs for <ticket>`, only `.mirai/records/<ticket>/`. Refused on the integration branch or any branch without the ticket's branch record.
7. **Signing from your terminal only** until row 29b's machine key: unattended, `gate record` refuses (`needs-you`, a park at night: `sign-proofs`).

Defaults taken with the decisions (not asked; say if you want them otherwise):

- **A record alone doesn't make an MR high-risk** (D-22's question): every ticket gets records from `gate record`. Instead `gate check` refuses any file in `.mirai/records/<ticket>/` that isn't a valid signed record for that ticket (`branch.json` or a proof), so a branch can't slip anything else in there.
- **`gate.code_paths` may not exclude a protected path** other than `.mirai/**` and the docs root (03b's open note): lint refuses it, so a project can't hide `.claude/**` changes from the proof.

## Scope

**In.**

1. **The hash** (`src/proofs/hash.js`): `codeHash({ root, env, base, head, codePaths })` → `sha256:<hex>`, decision 4, from the trust root's `gate.code_paths` (the integration branch's config, never the ticket branch's). `.mirai/records/**` is outside it whatever `code_paths` says (D-22's update). An empty patch (nothing in the code paths changed) is refused: there's nothing to prove.
2. **The proof files** (`src/proofs/records.js`): immutable, `.mirai/records/<ticket>/<kind>-r<n>-<hash12>.json` (the first 12 hex of the code hash in the name, the full hash inside), canonical JSON, Ed25519-signed with your key id, context `mirai/proof/1:<repo-id>` and the kind inside the signed body. A file that exists is never rewritten; a new round or attempt is a new file. Kinds in 25a: `review` and `gate`; `qa` is accepted by the format for unit 51. Duplicate JSON keys refused (06's review).
   - **Common fields:** `schema: 'mirai-proof/1'`, `kind`, `ticket`, `round` (n), `code_hash`, `base_sha` (the merge-base), `head_sha` (at minting), `trust_root_hash`, `framework_version`, `trace: 'n/a'` (unit 43), `minted_at`.
   - **`review`:** the review round, `risk`, `depth`, the passes' names and states, and per launch the verifier rung and model (D-16); the review record's commit and its code hash. **No findings** (Q9).
   - **`gate`:** per level and check: name, outcome, counts, the signed test result's id and digest; the embedded baseline (`sha`, the signed file's digest, and its known failures for those levels: id, scope, kind); and how each failure was judged (`known`). The attempt number is `r<n>`.
3. **`mirai gate record <ticket>`** (`src/cli/commands/gate.js`, `src/proofs/record.js`):
   1. checks: your terminal (decision 7), HEAD on the ticket's branch with its branch record (22), a clean tree (`gateCheck`), the porcelain-v2 `--ignored` hash unchanged up to the signature (R3-M8);
   2. the code hash at HEAD (item 1);
   3. the review: the latest review record that passed and is complete, whose commit's code hash equals HEAD's (a clean rebase keeps it; any code change since the review → `review-stale`, run `mirai review` again); none → `no-review`;
   4. the baseline (decision 3);
   5. runs every level and named check at HEAD (decision 5), judges each against the baseline with `docs/test-baseline.md`'s rule (a level-wide known failure never covers a test id; a named check or `no-ids` level already failing is "can't tell" → refused, `needs-you`);
   6. writes the `review` and `gate` proofs and commits them (decision 6).
   Outcomes and exit codes: `recorded` (0); `no-review`, `review-stale`, `no-baseline`, `gate-failed` (with the failing tests), `cant-tell`, `needs-you` (unattended), `dirty`, `wrong-branch` (each non-zero, each with the next command to run).
4. **`mirai gate check <ticket> [--commit <sha>]`** (`src/proofs/check.js`): for HEAD or the given commit, with the integration branch's config and public keys only:
   - recompute the code hash (never trust a hash in a file);
   - every file in `.mirai/records/<ticket>/` must be `branch.json` or a proof that verifies; anything else → `bad-record`;
   - pass when a `review` proof and a `gate` proof both carry that code hash and verify; else `no-proof` (with which kind is missing) or `stale` (proofs exist for another hash);
   - prints what matched (the files, the key id) and exits 0 or non-zero. Works with only the public key: no store, no private key, so CI (54) and `pre-push` (26) can call it.
5. **G14, proven by tests:** the hash is the same with a hostile user git config (`diff.algorithm=patience`, `diff.renames=copies`, `diff.context=10`, `diff.noprefix`, `diff.mnemonicPrefix`, `core.quotePath=false`, an external diff and textconv driver, `diff.orderFile`) and under `LANG` variations; and, where the machine has a second git (Homebrew's beside Apple's), the same across both, recorded in `test-results.md`.
6. **Lint:** `gate.code_paths` excluding a protected path (beyond `.mirai/**` and the docs root) is an error.
7. **Docs:** design/01 §9 and §11 "built" notes, D-16's "Update (unit 25a)" (the pin choice, the file name's 12-hex hash, the outcomes), roadmap row 25 split, `docs/signing.md` (proof records), G14 marked settled in 05.

**Out.**

- **Calling `gate record` from ship:** unit 27. **Checking proofs at push:** unit 26. **CI:** unit 54.
- **`qa` proofs:** unit 51 (the format accepts the kind). **`trace`:** unit 43 (`'n/a'` until then). **`handover.json`:** unit 46.
- **`mirai gate override`** and bypass counting (AR-23, M9): later.
- **The machine key** and signing at night: row 29b.
- **Documents' loops:** 25b.
- **Reusing earlier `mirai test --gate` results** (decision 5): not now.

## Probes (with your OK)

No model run: the unit launches no agent. One manual check on the sample app (yours, about 5 minutes of tests):

- **P1.** A ticket that passed Rex's review (the 24a seed's ticket from a probe clone, or SAMPLE-1 when it's there): `mirai gate record`, then `mirai gate check`; rebase it onto a `main` that changed another line of a touched file → `check` still passes; one whitespace change in the code → `check` fails (`stale`).

## Files

- **New:** `src/proofs/hash.js`, `src/proofs/records.js`, `src/proofs/record.js`, `src/proofs/check.js`, `src/cli/commands/gate.js`, tests in `test/proofs/`.
- **Changed:** the command list and its pins, `src/lint/` (the code-paths rule), `src/store/git.js` (the hash's diff, beside `reviewPatch`), `src/status/machines.js` only for the `sign-proofs` park reason, docs.

## Tests (`npm test`, no model; a stand-in test run)

- The hash: the same across a rebase onto a base that changed another part of a touched file; different after a code change, a context-line change, a whitespace-only change, a mode-only change, a binary-only change; the same under a hostile git config (item 5); `.mirai/records/**` never in it; file order doesn't matter.
- `gate record`: refuses without a passing review for the same hash (`no-review`, `review-stale`); keeps the review across a clean rebase; refuses without the merge-base's baseline, or one missing a level; a new failing test → `gate-failed`; a known failure (same id) → recorded, the failure listed as known; a level-wide known failure doesn't cover a failing test id; an already-failing named check → `cant-tell`; dirty tree, wrong branch, unattended → refused; writes two signed files and one commit with only them; a second run writes `gate-r2`, never touching r1.
- `gate check`: passes with only the public key; fails after a code change (`stale`); a proof signed by a key not on the integration branch fails; a hand-edited proof fails; an extra file in the records folder → `bad-record`; a proof for another ticket in the folder → `bad-record`; a hash in the file that doesn't match the recomputed one doesn't count.
- Lint: `code_paths` with `!.claude/**` is an error; `!.mirai/**` and the docs root aren't.

## Done when

- The tests pass, P1 is recorded in `test-results.md`, and the red team is green after the sample app's refresh. The row's done-when: a code change after a proof fails `check`; a whitespace-only or binary change fails `check`; a clean rebase onto a base that changed other lines of a touched file keeps the proof; a proof verifies with only the public key; G14 is settled.

## Open points for you

All seven design decisions are taken (above), and the two defaults are named. Approved by Jet on 2026-11-08 (PR #14), the defaults as written.
