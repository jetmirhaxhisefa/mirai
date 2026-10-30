---
unit: "17b"
date: 2026-10-30
result: 355 tests after the review fixes; one baseline of a sample-app clone in 17 container runs (of 24), and 15 more after the review found the seeded known failure failing and the seeded flaky test flaky, with PHPUnit coverage through its adapter end to end; nothing left in Docker
---

# Unit 17b — Test results

## `npm test`

**354 tests, all passing** before the review (load average about 12 to 16). After the review:
see below.

Unit 17b adds 7 tests in one new file, and extends two:

| File | Tests | What |
|---|---|---|
| `test/baseline/baseline.test.js` | 7 | **T1:** a dirty tree, HEAD off the integration branch, no committed key, not a repo: refused. **T2** (14c's fake docker, every run real): checks first, then levels in config order; each run a signed gate run on this commit, its result hash recorded; the failing test rerun by its file until `failing`; a check and a level without an adapter fail whole; the gaps; the signed file read back; the same commit reused with no container; `--level` merges; an unknown level refused. **T3** (a scripted stand-in for runs): always failing, fail then pass, a passing test failing on a rerun (flaky), a test a rerun doesn't run (`unchecked`), the rerun budget, files per level, a load failure as the whole level and not rerun; one rerun per file, not per test; the bookkeeping on its own (states, duplicate IDs, skips, another file's test). **T4/T5:** a timeout is `env-fault`, never a known failure, and the baseline `complete: false`; measured files and their hash; skipped tests a gap; an edited baseline refused (`baseline-invalid`), a missing one null; ten kept. **T6:** `mirai baseline`, `show`, `show <sha>`, usage errors; test names with a C1 control and a bidi override escaped; an incomplete baseline exits 5. **T7:** the probe stays local |
| `test/tests/test-run.test.js` | (extended) | 14c's T13: `src/baseline/` holds no stack names either |
| `test/cli/cli.test.js` | (changed) | The pinned command list has `baseline` |

## Probe

**One baseline of a sample-app clone: 17 container runs** of the 24 you approved (Docker only, no
subscription; `test/probes/baseline-probes.js`). The clone had this checkout's MIRAI
(`init --refresh`), 16a's adapter lines (`unit` phpunit, `frontend` `npm test --` with vitest,
`e2e` playwright with `report_root = "e2e/tests"`) and a signing key made in the probe's own
temporary home, all committed in the clone only.

```
test baseline for main at 68704d7b25a2

lint (check): pass in 243 s
unit (level): fail in 70 s, 14 tests (13 passed, 1 failed, 0 errors, 0 skipped), coverage 31 of 35 lines in 8 files
  failing   backend/tests/Feature/KnownFailureSeedTest.php::test_known_failure_seed — failed 10 of 10
frontend (level): fail in 76 s, 6 tests (5 passed, 1 failed, 0 errors, 0 skipped), coverage 41 of 121 lines in 6 files
  flaky     frontend/src/flaky-seed.test.ts::flaky seed > passes about half the time — failed 3 of 4
e2e (level): pass in 124 s, 1 tests (1 passed, 0 failed, 0 errors, 0 skipped)

gaps (reported, never tickets): 1
  - e2e: the playwright adapter has no coverage
```

- **The runs:** `lint`, `unit` and 9 reruns of `KnownFailureSeedTest.php`; `frontend` and `e2e`.
  The flaky seed passed in `frontend`'s first run, as it does about half the time, so `frontend`
  ran again (`--level frontend`, merged): it failed, and in the 3 reruns of its file it failed twice
  and passed once ("failed 3 of 4"). That's 17.
- **"Done when" met:**
  - each level's run time and coverage are recorded;
  - the seeded known failure is `failing` (10 of 10);
  - the seeded flaky test is `flaky`;
  - **PHPUnit's coverage through its adapter, end to end** (G7's pending half from 16b): 31 of
    35 lines in 8 files, on a level with a failing test.
- **A second `mirai baseline`** on the same commit reused the first and started no container.
- **Nothing was left in Docker** (containers, networks, volumes with MIRAI's label: 0). The probe
  folder is removed; the baseline and report are kept outside the repo, in
  `~/.mirai-16a-corpus/17b-baseline*`.

`lint` took 243 s: ESLint in the frontend container, at a load average of about 9.

## After the review

**The full suite after the fixes:** 355 tests, all passing (load average about 7). `test/baseline/baseline.test.js` has 8 tests; the new
one covers:
- a rerun that comes back timed out (as `runTest` returns it, with no `cases.json`): an environment
  fault for its tests, never a crash; each rerun's id, outcome and hash kept;
- a refusal of the tree or HEAD during the runs: the whole baseline stops, nothing written;
  another refusal recorded as `refused`, the baseline incomplete;
- an incomplete baseline completed by the next run (only the faulted level runs), then reused;
- `--force` over a baseline that doesn't verify; `--level` refusing to merge into one;
- a file that fails to load and a case with no project path, beside a real failure: each kept,
  none wiping the others;
- duplicate test IDs on a passing level, and a `--level` merge keeping other levels' gaps;
- growth since the previous commit's baseline, and `refuseGrowth` stopping on it;
- `fileOf` on an ID without a file.

T4/T5 now check `knownFailures()` is `null` for an environment fault, a missing level and no
baseline, and `[]` only for a level that ran.

**The probe again, after the fixes** (your OK for one more run): **15 container runs.**
- `unit`: `KnownFailureSeedTest` `failing`, 10 of 10. Coverage 31 of 35 lines in 8 files again.
- `lint` and `e2e`: pass.
- The reviewed code ran end to end on real Docker: the scope and `reruns` fields, the final
  recheck before signing, and the lock. A second `mirai baseline` reused the first.
- **The flaky seed passed in all three of `frontend`'s runs** (about a 1-in-8 chance), so this time
  it isn't a known failure. The probe stops at three attempts, by design. The first probe showed it
  `flaky`; this one shows the open point 3 limit in practice: a flaky test that passes in the
  baseline isn't listed, and unit 52 handles it when it fails in a ticket.
- Nothing was left in Docker. The baseline is kept outside the repo, in
  `~/.mirai-16a-corpus/17b-baseline-after-review.json`.
