---
unit: "17b"
name: test-baseline
status: approved (2026-10-30)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 17b; D-45 (the ratchet), R2-M7, AR3-11 (one baseline home), design/01 §1 step 3b and §8, unit 02 review's P7, 16a's and 16b's review notes for 17
depends_on: ["17a", "16a", "16b"]
---

# Unit 17b: The test baseline

## Why

The gate checks **"nothing new broke", not "everything is green"** (D-45). Many projects MIRAI
will run in already have failing or flaky tests. Without a record of them, every ticket would be
blocked by failures it didn't cause. The record is the **test baseline**:
- every level and check of the integration branch's commit;
- each level's run time, counts and coverage;
- the tests that already fail, and which of those are flaky.

Its users:
- **the gate-result record (25)** names the baseline it used and its known failures;
- **pre-push (26)** blocks only new failures, and compares diff coverage with what the baseline
  measured;
- **unit 52** reruns a test the baseline calls flaky instead of failing the ticket (P8);
- **CI (54)** reads the known failures from the signed gate-result record;
- **setup (39)** reports the gaps, and never turns them into tickets.

The design fixes three things:
- **One home:** `<store>/baseline/<sha>.json`, per integration-branch commit (AR3-11).
- **Only a refresh from the integration branch moves it;** no agent can edit it (D-45 point 1).
  The orchestrator refreshes it at the start of every run (units 28 and 52). This unit gives the
  command and the library they call.
- **A flaky test is told from a failing one by rerunning it** until it has both passed and failed,
  up to 10 runs (unit 02 review's P7).

**Roadmap "done when" covered here:** on the sample app, the baseline records:
- each level's run time and coverage;
- the seeded known failure (`KnownFailureSeedTest`, which always fails);
- the seeded flaky test (`flaky-seed.test.ts`, about 50%), told apart from the known failure.

## Scope

**In:**

1. **`mirai baseline`** records the baseline for the integration branch's current commit. It runs
   on a **clean tree with HEAD on the integration branch,** as `mirai test --gate` does (14d):
   checked before, during and after.
   - **What runs:** every configured level and named check (the trust root's config, not 17a's
     draft), each as a whole.
     - A level whose adapter has `[coverage]` runs with coverage.
     - Each run is a 14c run, signed as a gate run is (14d), so the results the baseline names are
       themselves signed.
   - **Order:** checks first (the cheapest), then levels in config order.
   - **One at a time,** within 14d's repo lock and machine slots.
   - **An existing baseline for the same commit is reused,** not run again. `--force` runs it again.
   - **`--level <name>` (repeatable):** only those, merged into the existing baseline for that
     commit (to refresh one slow level).
   - **`mirai baseline show [<sha>]`** prints a stored one. Without a commit, it shows the
     integration branch's current one, or says there is none.

2. **Known failures and flakiness (P7).** After a level's run, the failing tests come from its
   `cases.json` (16a: every case, not the 50 in the reply).
   - **Each file with failing tests is run again,** with `run_tests`' path selection (one container
     run per file, not per test). Each failing test's outcome is read from that run's
     `cases.json`.
     - A test that has **both passed and failed** is `flaky`, and its file stops being rerun.
     - A test that **failed in every run, up to 10** (the first included), is `failing`.
     - A test that a rerun **didn't run** (not found, or loaded under another name) is
       `unchecked`, with the reason.
     - A test that **passed in the first run but failed in a rerun** of its file is `flaky` too.
   - **Bounded:**
     - at most 10 runs per file;
     - at most 50 reruns per baseline;
     - at most 50 files per level.

     Past a bound, a failing test is `unchecked: rerun limit`, so the gate still knows it as a
     known failure.
   - **A whole run of kind `load` (the tests didn't load)** is a level-wide known failure. It isn't
     rerun by file.
   - **A level without an adapter, or a named check,** has no test IDs: a failure is recorded for
     the whole level or check and not rerun (`unchecked: no test IDs`).
   - **An environment fault** (timeout, `bad-report`, `bad-coverage`, a Docker error) is not a known
     failure. The level is recorded as `env-fault`, and the baseline as `complete: false`: units
     25 and 26 must treat an incomplete baseline as "can't tell", never as "no known failures".

3. **The baseline file** (`<store>/baseline/<sha>.json`, schema_version 1):
   - **the commit, the time, MIRAI's version, the trust manifest's hash, and the config's levels
     and checks** as they ran;
   - **per level or check:**
     - its state (`pass`, `fail`, `env-fault`) and duration;
     - the signed run's id and its result hash;
     - the counts;
     - `cases_sha256`;
     - its known failures: `{ id, state: failing | flaky | unchecked, runs, failed, reason? }`;
   - **per level with coverage:**
     - the summary;
     - `coverage_sha256`;
     - **the files it measures** (paths, and a hash of the sorted list), so unit 26 can see a
       branch stop measuring a file (16b's review);
   - **`gaps`,** reported and never turned into tickets:
     - a level without an adapter (no counts or IDs);
     - a level whose adapter has no coverage;
     - no `e2e`-like level;
     - tests skipped in the baseline;
     - duplicate test IDs (16a: Playwright's several projects).

   The file is **signed with your key** (unit 06's signer, context
   `mirai/test-baseline/1:<repo>`), so a change to it shows (open point 2). The last 10 commits'
   baselines are kept.

4. **The library** for units 25, 26, 28 and 52:
   - `recordBaseline({ cwd, env, levels?, force?, … })`;
   - `readBaseline(store, sha)`: checked against its signature, or null;
   - `knownFailures(baseline, level)`: test IDs with their state.

   Nothing in this unit compares a branch with the baseline: that's 25 and 26.

5. **Probe, with your OK: one baseline of a sample-app clone, at most 24 container runs** (Docker
   only, no subscription).
   - **The runs:**
     - 4 runs: `lint`, `unit` with coverage, `frontend` with coverage, `e2e`;
     - up to 10 reruns of `KnownFailureSeedTest`'s file;
     - a few reruns of `flaky-seed.test.ts`'s file.
   - **What it's run with:** the clone's config with 16a's adapter lines, this checkout's MIRAI
     (`init --refresh`, committed in the clone), and a signing key made in the probe's temporary
     home (never yours).
   - **The odds:**
     - The flaky seed fails in the first run only about half the time. If it passes, it isn't a
       known failure (only failing tests are rerun; open point 3), and the probe runs `frontend`
       once more, within the 24.
     - A second run of `mirai baseline` on the same commit must reuse the first and start no
       container.

**Out:**
- **Comparing a branch with the baseline:** units 25 (gate record), 26 (pre-push) and 52 (rerunning
  flaky tests).
- **Refreshing at the start of every run:** the orchestrator (28 and 52) calls this unit's library.
- **Flaky tests that passed in the baseline run:** finding those would take repeated whole-level
  runs. Unit 52 handles a failure at ticket time.
- **A trusted `coverage_paths` per level** (16b's review): unit 26, using the baseline's measured
  files. A Playwright project qualifier in test IDs: later, recorded as a gap meanwhile.
- **CI's own baseline on the merge base** (AR3-11): unit 54.

## Files

- **New:**
  - `src/baseline/` with `record.js` (the runs and reruns), `flaky.js` (classifying), `store.js`
    (the file, signing, keeping 10);
  - `src/cli/commands/baseline.js`;
  - `docs/test-baseline.md`.
- **Changed:**
  - `src/cli/commands/index.js` (pinned list);
  - `docs/test-adapters.md` and `docs/agent-safety.md` (a line each);
  - the roadmap (row 17b's "done when" as built).
- **Tests:** `test/baseline/*.test.js`, through 14c's fake docker, which leaves a report (and
  coverage) per run, so the reruns' outcomes can be scripted.
- **Probe:** `test/probes/baseline-probes.js`.

## Tests

`npm test`, no Docker:
- **T1: preconditions.** A dirty tree, HEAD off the integration branch, or HEAD moving during the
  runs: refused, as gate runs are. Not installed: `no-store`.
- **T2: the runs.** Every level and check runs whole, checks first. Coverage only where the
  adapter has it. Each run signed. `--level` merges. The same commit is reused; `--force` runs
  again.
- **T3: flaky versus failing.** With scripted outcomes:
  - always failing: `failing` after 10 runs;
  - fail then pass: `flaky` after 2;
  - a test that passed first and failed in a rerun: `flaky`;
  - a test missing from a rerun: `unchecked`;
  - one rerun per file, not per test;
  - the three bounds;
  - a load failure is level-wide and not rerun.
- **T4: no test IDs and faults.** A level without an adapter, and a check: whole failures,
  `unchecked`. A timeout or `bad-report`: `env-fault` and `complete: false`, never known
  failures.
- **T5: the file.**
  - Its fields.
  - Measured files and their hash.
  - The gaps.
  - The signature verifies, and an edited file fails `readBaseline`.
  - Ten kept.
- **T6: the command.** `mirai baseline`, `show`, `show <sha>`; the report lists known failures by
  state, run times and gaps; control characters from test names are escaped.
- **T7:** stack neutrality (14c's T13 covers `src/baseline/`), and the probe stays local.

**Probe:** one baseline of a sample-app clone, at most 24 container runs.

## Open points for you

1. **Reruns by file, not by test ID.** One container run reruns every failing test in a file, and
   also catches a passing test that fails on rerun. My recommendation: yes. A run per test ID
   costs a stack start each (about 30 s on the sample app).
2. **The baseline is signed with your key,** and its runs are gate runs (clean tree, HEAD on the
   integration branch). Recommended: CI and pre-push trust it through the gate record, so it
   should be as provable as a gate result.
3. **Only failing tests are rerun.** A test that passed in the baseline but is flaky shows up
   only when it fails in a ticket, where unit 52 reruns it. The alternative is running every level
   several times, which multiplies the cost.
4. **The bounds:** 10 runs per file (P7's 10), 50 reruns per baseline, and 50 files per level.
   A project with 200 known failures gets most of them as `unchecked: rerun limit`. They're still
   known failures, so nothing blocks wrongly. Only their flakiness is unknown.
5. **The probe's cost:** at most 24 container runs on the sample app, about 15–20 minutes. Most
   of it is `KnownFailureSeedTest` failing 10 times, by design.

## Changes after testing and review

**From the probe:** none needed. It took 17 container runs of the 24. The flaky seed passed in
`frontend`'s first run, so the probe ran `frontend` again, as item 5 planned. PHPUnit coverage
through its adapter, pending since 16b (G7), came out end to end: 31 of 35 lines in 8 files.

**Other changes from the spec:**
1. **A baseline that doesn't verify is refused** (`baseline-invalid`), not read back as null
   (item 4). Null means only "there is none", so a tampered or foreign file can never read as "no
   known failures".
2. **Reruns by file are signed like the level runs,** and each run's id, outcome and result hash
   are kept (`reruns`, added in the review).
   14d's `verifyTestResult` still refuses a path run as a gate result, so a rerun can't stand in
   for a level's.
3. **The baseline also refuses a HEAD that isn't the integration branch's commit** (local and
   remote must agree, as the trust root's), not only a HEAD on another branch.
4. **`mirai baseline` exits 5 ("needs you")** when the baseline is incomplete, and 1 for `show`
   when there is none.
5. **The probe uses the clone's own config, with 16a's adapter lines added,** since the sample
   app's committed config doesn't have them yet.
6. **The roadmap's row 17b** is rewritten as built, and the notes from 17b's review go to rows 25,
   26, 28, 52 and 54.

**From the review (`review.md`):**
7. **A rerun that times out is an environment fault for its tests,** not a crash: `runTest`
   returns a timeout rather than throwing it.
8. **Known failures have a structured scope:**
   - `scope: "test"` (by ID);
   - `scope: "level"` with a `kind`: load, not-found, error, no-ids or unmapped.

   `docs/test-baseline.md` states the rule units 25, 26 and 54 implement:
   - a level-wide known failure never covers a failing test ID;
   - a check that already fails is "can't tell", never "known".
9. **`knownFailures()` returns `null` ("can't tell")** for an environment fault, a refusal, a
   missing level or no baseline.
10. **An incomplete baseline is completed, not reused:** only its faulted, refused or missing
    levels run again.
11. **A refusal of the tree or HEAD stops the whole baseline,** and nothing is written. Another
    refusal is `refused` (incomplete). The tree and HEAD are checked once more before signing.
12. **`--force` records over a baseline that doesn't verify.** `--level` refuses to merge into one.
13. **A file that doesn't load, or a case with no project path, no longer wipes the level's other
    failures.** Only the run's own level-wide outcomes are the whole level's.
14. **Growth (AR3-11, "only shrinks automatically"):**
    - each baseline records the previous commit's and the known failures it adds;
    - `refuseGrowth` makes an automatic refresh (unit 28) stop on any.
15. **Duplicate test IDs are found on every level,** and a `--level` merge keeps the other
    levels' gaps. Gaps have codes.
16. **Smaller fixes:**
    - each entry records its time and MIRAI version;
    - one recording per repo at a time (`baseline-busy`);
    - an environment fault's message is shown;
    - a test ID without a file is `unchecked`.
17. **The sample-app probe ran again after the review,** with your OK: 15 container runs.
    - `KnownFailureSeedTest` was `failing` again.
    - The flaky seed passed in all three `frontend` runs (about 1 in 8), so it isn't listed that
      time: open point 3's limit, as documented.
