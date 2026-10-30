---
unit: "17b"
date: 2026-10-30
reviewers: Tech Lead, Architect (independent, read-only, no network, no Docker, no probes, never the real claude, never your Claude Code config)
verdicts: no Blocker; Tech Lead three High, Architect three High (one shared), all fixed; every Medium fixed or recorded for the unit that owns it
---

# Unit 17b — Review

Both reviewers worked on a frozen tree. Their experiments ran in `mktemp -d` copies with the
unit's own scripted stand-in, and those copies were removed afterwards. Each ran the new test
file (7 / 7 then). Neither changed anything in either repo.

**What held up (both):**
- **One home per integration commit,** signed with its own context (`mirai/test-baseline/1:<repo>`),
  verified with the integration branch's keys. The commit and schema version are inside the
  signed body, so a file renamed or replayed for another commit fails. A tampered file is refused,
  never read as "none".
- **Runs come from the trusted config,** checks first, then each level whole, with coverage only
  where the adapter has it. 17a's note (run the configured levels) and 16a's (`cases.json`, not
  the failing list) are done, and 16b's measured files are recorded with their hash.
- **The rerun arithmetic:** the first run counts, so at most 10 runs a file. The budget is checked
  before it's spent and shared across levels. Files past the cap spend nothing. Flaky wins over
  a stop reason. Skips and missing tests stop with a reason. The bounds fail safe:
  `unchecked` is still a known failure.
- **Reruns by file,** including a passing test that fails on rerun, are the right cost trade.
- **Environment faults are never known failures;** `complete: false` exits 5.
- **Terminal escaping** of test names (C0, C1, bidi, zero-width).
- **Stack neutrality:** no framework names in `src/baseline/`, covered by T13.

## Fixed in unit 17b

| # | Finding | Severity, from | Fix | Test |
|---|---|---|---|---|
| 1 | **A rerun that times out crashed the whole baseline.** `runTest` *returns* a timeout and leaves no `cases.json`, so the read threw ENOENT after up to about 20 minutes of runs, and nothing was written. T4's stand-in threw instead, as `runTest` doesn't | High, both | A rerun that isn't pass or fail, or has no cases, is an environment fault for its tests (`unchecked`, with the reason) | A rerun returned as `timeout` |
| 2 | **`knownFailures()` gave `[]` for an `env-fault` level, a missing level or no baseline.** That's the "incomplete reads as nothing fails" trap | High, Tech Lead; Medium, Architect | `null` ("can't tell") for all three; `[]` only for a level that ran | Each case |
| 3 | **A level-wide known failure (`id: null`) could let new failures through.** A check failing on main, or a level failing on warnings, would cover every new failure if read as "doesn't block". The kind was prose only | High, Architect | Known failures have `scope` (`test`, `level`) and `kind` (`load`, `not-found`, `error`, `no-ids`, `unmapped`). `docs/test-baseline.md` states the rule for 25, 26 and 54: a level-wide one never covers a failing test ID, and a check already failing is "can't tell". Rows 25, 26 and 54 point to it | The scopes and kinds |
| 4 | **AR3-11's "the known-failure list may only shrink automatically" was neither honoured nor deferred** | High, Architect | Each baseline records the previous commit's (sha and file hash) and the known failures it adds (`growth`). `refuseGrowth` stops an automatic refresh with `baseline-grew`. `mirai baseline` shows growth prominently; row 28 owns the automatic refresh | Growth listed; refused |
| 5 | **An incomplete or partial baseline was reused forever** for its commit | High, Tech Lead; Medium, Architect | Only a complete one is reused. Otherwise the next run runs just the faulted, refused or missing levels, merged | Completed, then reused |
| 6 | **`--force` couldn't recover a baseline that fails verification,** though the hint said it would | Medium, Tech Lead | `--force` (without `--level`) doesn't read it; `--level` refuses to merge into it | Both |
| 7 | **One file that fails to load, or one case with no project path, wiped every per-test known failure in the level** | Medium, Tech Lead | Only the run's own level-wide outcomes (no ID, and a load, not-found, or error with nothing failing) are the whole level's. A file's load case keeps its ID. Unmapped cases are one `unmapped` entry | A mixed run |
| 8 | **A refusal partway through (HEAD moving) was recorded as `env-fault`,** and a signed baseline written; the spec's T1 test for it was missing | Medium, both | `gate-branch`, `gate-dirty` and `repo-changed` stop the whole baseline, and nothing is written. Other refusals are `refused` (incomplete). The tree and HEAD are checked once more before signing | HEAD moving; a refusal |
| 9 | **Reruns' ids and hashes weren't kept,** though spec change 2 said so; `tests/gate/` keeps 100 runs | Medium, both | `reruns: [{ file, id, outcome, result_sha256 }]` per level. The docs say the baseline outlives its runs' files, and its hashes still name what ran | The rerun kept |
| 10 | **Duplicate IDs were found only on failing levels;** a `--level` merge dropped other levels' gaps | Medium, Tech Lead; Low, Architect | `cases.json` read for every level with tests; kept levels' gaps carried over; gaps have codes (also for 39) | A passing level; a merge |
| 11 | **Roadmap row 17b was stale** (claimed `coverage_paths`, the Playwright qualifier, " > "), though the spec listed it | Medium, Architect | Row 17b rewritten as built; `coverage_paths` to 26, the qualifier and " > " to 52 (which reruns by ID) | — |
| 12 | **Smaller things:** <ul><li>`fileOf` on an ID without `::` dropped a character;</li><li>an environment fault's message wasn't shown;</li><li>a merge restamped old entries;</li><li>no lock around read, merge and write;</li><li>the docs' schema was incomplete;</li><li>the `e2e` gap is a name heuristic;</li><li>`test-results.md` placeholders and "3 reruns saw it pass" (it passed once)</li></ul> | Low, both | <ul><li>`null`, and `unchecked`;</li><li>shown;</li><li>each entry has `recorded_at` and its MIRAI version;</li><li>`baseline-busy`;</li><li>complete;</li><li>said so;</li><li>fixed</li></ul> | `fileOf` |

**Not changed, on purpose:**
- **The probe's 24-run cap** is a loop guard, not a hard stop (Architect, Tech Lead). Missing the
  flaky seed three times in a row is about 1 in 8. It held at 17.
- **A baseline is reused per commit even if the images were rebuilt since** (Architect): that
  belongs with 17a's "rebuild images before each run" item, still to place on the roadmap.

## Noted for later units

| Unit | Note | From |
|---|---|---|
| 25 | Embed the known failures (IDs, scope, kind) and the baseline's signed digest in the gate record: the store keeps 10, and CI can't read it. Refuse an incomplete baseline or a missing level. Choose which baseline a ticket uses (merge base or run start; stacked tickets). Compare counts and IDs | Architect (in row 25) |
| 26 | Follow `docs/test-baseline.md`'s rule. A changed file in a level's `measured.files` that the branch's coverage doesn't list is uncovered. Settle `coverage_paths` | Architect (in row 26) |
| 28 | Refresh with `refuseGrowth`; stop on `baseline-grew` or an incomplete baseline. The baseline is signed unattended with your key, as gate runs are (documented) | Architect (in row 28) |
| 52 | `flaky` drives reruns; `unchecked` has unknown flakiness; rerunning by ID meets Vitest's " > " titles and Playwright's duplicate IDs | Architect (in row 52) |
| 54 | Reconcile CI's own baseline on the merge base with the gate record's known failures; apply the rule | Architect (in row 54) |
| 39 | Gaps now have codes to interview on | Architect |
