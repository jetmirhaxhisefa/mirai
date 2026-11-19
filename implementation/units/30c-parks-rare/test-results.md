# Unit 30c: test results (2026-11-19)

Each result names the commit it ran on (`unit/30c-parks-rare`). Jet started the build runner in
his Terminal and ran P1 and P2 in the sample app (`~/Projects/mirai-sample-app`), whose `main`
the runner refreshed with 30c's MIRAI (`1e14d28`).

## Tests

- **The 30c tests in `test/agent/plan.test.js`:** T1+T6, T2, T3, T4+T5, T6 and T8. T1 also checks
  that `mirai show` puts a re-plan at the gate (see 1 below).
- **`test/agent/line-endings.test.js`, and 30c T7 in `test/agent/build.test.js`:**
  - CRLF at the base and LF after → committed CRLF, and the commit body says so;
  - mixed endings → left as they are, and reported;
  - LF stays LF.
- **The full suite**, through the runner's `tests` job inside its sandbox, at `6143ee4`
  (`30c-tests`, 13.2 min): **660/660**.
  - At `86d703e` (`30c-tests-final`): 659/660, the store race (see 2 below), now fixed.
  - At `17a862a` (`30c-tests-final-2`, 14.9 min), with the fix: **660/660**.
  - In this session it was 659/660. The one failure was `strict.test.js` T5/T6, the known race,
    which passed 14/14 twice on rerun.

## Through the runner

| Job | Request | Result |
|---|---|---|
| baseline | `30c-baseline` on `6143ee4` | The sample app was refreshed (`1e14d28`) and its baseline recorded in 6 min. Its two failures are the planted `KnownFailureSeedTest` and the flaky seed. |
| tests | `30c-tests` on `6143ee4` | 660/660 in the sandbox. |
| red team | `30c-redteam` on `6143ee4` | **GREEN**: 324 runs in 19 min 17 s. Planning had been refused as `stale`, since 30c changed the framework. |

## Probes (real)

### P1: SAMPLE-49, planned 5 times on the sample app: **pass**

Jet approved SAMPLE-49 once (seq 134), then planned it 5 times and rejected the first four
plans.

| Plan | First draft | Fix launch | Park | Notes in `review-notes.md` | Followed | Normalized (logged) |
|---|---|---|---|---|---|---|
| 1 | 2 problems | 1 → pass | none | none | n/a | 0 |
| 2 | 14 problems | 1 → pass | none | 1: `findMissingDemos` in `frontend/src/demo/coverage.ts`, the test at `frontend/src/demo/demos.test.tsx` | yes: the Design notes quote the note and find no conflict with the ticket | 5: `"Demos" section` → `` `Demos` ``, and 4 test-row symbols → the full Code map symbol |
| 3 | 1 problem | 1 → pass | none | 1 and 2: each demo also exports `Empty`, and the render test covers it | **both** | 0 |
| 4 | 1 problem | 1 → pass | none | 1–3: 3 is "no change wanted" | 1 and 2, and names 3 | 0 |
| 5 | 1 problem | 1 → pass | none | 1–4 | 1 and 2, and names 3 and 4 | 0 |

- **The pass conditions all hold:**
  - every plan passed the lint within one fix launch, and none parked;
  - the plan after the second rejection follows both notes;
  - every normalization is in the Implementation log.
- **The comparison:** BKT-49 met 3 `bad-plan` parks over 10 rounds. SAMPLE-49 met none over 5
  rounds, in 5.2 min of Sonnet (103 turns, 511 k tokens).

### P2: line endings on a real build: **pass**

Plan 5 was approved (seq 169) and built: red, a red round, then green. Its branch is
`feature/SAMPLE-49-every-frontend-component-has-a-demo` at `b2044cd`.

- `frontend/COMPONENTS.md` is still CRLF at `b2044cd`.
- Its diff is only the 6 lines it adds, each ending in CRLF. That's the MR's view, against
  BKT-49's ~600-line rewrite (F25).
- **One caveat:** Kai kept CRLF itself this time, because plan 5 said "Keep CRLF". So MIRAI's
  conversion found nothing to convert, and no commit body names one. The conversion itself is
  proved by T7, on a real git repo, with a file the agent rewrote as LF.
- The checks passed: lint, unit (only its known failure), frontend, and e2e.

## Found while proving, and fixed

1. **`mirai show` called a new plan "rejected by you":**
   - **What:** after a reject and a re-plan, it named the last plan decision of any round, so
     plan 5 at the gate read "round 5, rejected by you".
   - **The fix:** it now uses only a decision on this plan's own approval hash. Each round has a
     new hash, because the round is in the approved fields.
   - **The test:** 30c T1 checks for "waits for your approval". It fails without the fix.
   - Commit `1d8dbc3`.

2. **A store opened during another process's append read as `counter-behind`:**
   - **What:** the runner's `tests` job on `86d703e` failed one test: store T5, 8 processes ×
     25 appends. `checkCounter` read the counter and then the journal, so an append in between
     looked like a counter behind the journal. It ran 5/5 alone. 30c doesn't touch the store; it
     was hit by chance.
   - **Why it's fixed here:** two MIRAI commands at once happen at night, with the runner and you
     both running, and the error tells you to run `mirai doctor` for nothing.
   - **The fix:** the lines are read first and the counter last. An append bumps the counter
     before writing its line, so a counter read later is never behind.

## Seen, not fixed in 30c

- **What a first draft got wrong isn't kept:** MIRAI keeps only the count of a first draft's lint
  problems (plan 2's was 14), not what they were. So the park rate can be measured, but not why
  first drafts fail. That belongs in the run report's plan section, for B's checkpoint.
- **Kai names MIRAI's tools in Verification:** `mcp__mirai__run_tests`, `mcp__mirai__run_check`.
  A reader can't run these. The plan template could say "commands a person can run".
- **A red step can be wrong at first:** the build's first red step was `wrong-reason` on all 5
  rows, and its red round fixed it. This is behaviour from before 30c, noted for the measure.
