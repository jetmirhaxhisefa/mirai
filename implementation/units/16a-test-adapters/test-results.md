---
unit: "16a"
date: 2026-10-29
result: 322 / 322 pass after the review fixes (earlier units' 288 + unit 16a's 34); J1–J4 settled by 18 probe runs of the sample app's runners (plus 1 kept from a stopped batch); 8 runs through MIRAI's own adapters on the sample app, all as intended; nothing left in Docker
---

# Unit 16a — Test results

## `npm test`

**322 / 322 pass after the review fixes** (316 / 316 before them). Unit 16a adds 34 tests in
five new files, and changes two of 14c's:

| File | Tests | What |
|---|---|---|
| `test/tests/xml.test.js` | 4 | **T1:** the XML reader: what JUnit files use; refused DOCTYPE, other entities, a foreign encoding, broken UTF-8, anything not well formed; the depth, size and element limits; no file or code access |
| `test/tests/junit.test.js` | 5 | **T2:** every report in the corpus reads; PHPUnit, Vitest and Playwright reports map to the right IDs, outcomes, kinds and messages; not-found and load from real reports; redaction, the 300-character cut, the 50 cap and the case limit |
| `test/tests/paths.test.js` | 3 | The project path to the service's path and back, in the sample app's mount shapes; a path the service doesn't mount, or that a volume hides, is refused |
| `test/tests/adapters.test.js` | 7 | **T3:** the shipped adapters load and hold no code; a project adapter loads; unknown fields, placeholders, `{`, a missing `{path}` or `{name}`, an argument starting with `{name}`, bad regexes and a core name are refused; the argv. **T4:** regex escaping; test IDs. **T8:** the probe script stays local |
| `test/tests/test-adapters-run.test.js` | 9 | **T5** (14c's fake docker, which now leaves a report): the argv for a level, a file and a test ID; the counts and failing list; not-found (nothing, or all skipped, at exit 0); load; exit 0 with a failing case fails; missing, malformed or linked reports are `bad-report`; a project adapter from the trust root (env, oneoff, `report_root`), and one only in the work tree doesn't count; a level without an adapter; redaction; `mirai test --test`. **T6:** `run_tests` checks IDs first; the counts and failing list inline within one 32 KiB budget; no store paths |

**Changed:**
- **14c T7:** the path now reaches the runner as the service's own (`/w/tests/A_Test.php`);
- **14c T10:** `findTarget` returns `adapter` and `reportRoot`;
- **14c T13** (stack neutrality) still covers `src/tests/` and `src/mcp/`, and caught my first
  example test ID (`LoginTest.php`). The new code names no stack;
- 14c's helpers moved to `test/tests/run-fixture.js`, shared with the new run tests.

## The probes

All runs were on a throwaway clone of the sample app under `~`, with its origin removed and a
temporary MIRAI home:
- the sample app's own images, never pulled;
- every container, network and volume checked gone after each run;
- no Claude subscription use.

The facts are in `research/12-test-runner-facts.md`. The reports saved from them are the corpus,
`test/tests/corpus/` (15 files, with no personal data).

**How the runs went:**
1. **One run** (PHPUnit, one file) checked the harness.
2. **A first batch was stopped after one run.** Its broken PHPUnit file stopped the whole level,
   which is a J3 fact in itself, kept as `pj-load-level`. But it would have confounded every
   PHPUnit run, so each broken file is now present only for its own scenario.
3. **An earlier batch failed at start** with "bind source path does not exist". The harness had
   reused a work folder that Docker Desktop's file sharing still had cached as removed. Now
   every invocation uses a fresh folder. Two containers and two volumes from the stopped batch
   were removed by hand; the harness now checks volumes by name too, as 14c's does.
4. **18 J runs.** All the facts in research/12 come from these.
5. **8 runs through MIRAI's own adapters** (the m- scenarios). The clone's MIRAI was refreshed from
   this checkout with `init --refresh`, committed in the clone only:

| Run | Result |
|---|---|
| `unit-a`, the whole level | fail, exit 2: 21 tests (17 passed, 2 failed, 1 error, 1 skipped). Failing: the probe's assertion, its `RuntimeException` (error), and the seeded known failure, each with its message |
| `unit-a --test …::test_data with data set "x y "q""` | pass: exactly 1 test. The quotes went through as one argument, and the path reached PHPUnit as `/var/www/html/tests/Unit/ProbeShapesTest.php` |
| `unit-a --test …::test_nope` | fail, `not-found` |
| `frontend-a` (`npm test --`), one file | fail: 8 tests (5 passed, 2 failed, 1 skipped), assertion versus error by type. The `.tsx` twin ran too and is counted as `outside: 1` |
| `frontend-a --test …::probe > regex (x)+ "q" [y]` | pass: 1 test; `-t` got the escaped, space-joined name. The other 8 cases were reported as skipped, and are counted outside |
| `e2e-a`, one file | fail: 8 tests (1 assertion, 1 error, 1 skipped). The anchored path regex left the `.tsx` twin out (`outside: 0`) |
| `e2e-a --test …::probe › regex (x)+ "q" [y]` | pass: 1 test |
| `e2e-a`, the whole level | fail on the two probe failures only. **The smoke test passed:** its earlier timeout was the machine's load, as was Vitest's AddTaskForm timeout in `vj-level` |

**In all:** 1 + 1 (kept) + 18 + 8 = 28 runs that reached Docker, plus the stopped and failed
starts. That's about double open point 4's estimate. Nothing was left in Docker afterwards, and
every probe folder is removed.

## After the review

**Six tests added**, for the fixes in `review.md`:
- a data provider's method by name;
- a Vitest load failure on a test ID;
- `load` only when no test ran (Playwright's real failures plus an `Error:` line; a passing run;
  PHPUnit's bare exit 255);
- a whole level that ran nothing;
- a failed run with nothing failing;
- the worst result in a case, `(unnamed)`, colour leftovers, whole characters in the cut,
  over-long names;
- `cases.json` and the hashes, a folder test ID, `bad-adapter`;
- the reply's budget as JSON (`o`, `"`, `\x01`, `\\`);
- Playwright's folder regex.

**Checked by mutation:** removing the "no test ran" guard on `load`, the data-set variant, or the
JSON-size cut each makes a test fail.

**No new Docker runs after the review.** Two Playwright cases are therefore unprobed and
recorded as such in research/12: a folder path, and a config without a junit reporter.

## What wasn't run

- **The sample app's own config.** It needs MIRAI refreshed there, which you commit after this unit
  is pushed. The lines are given with the unit.
- **No `run_tests` call from a real agent.** The MCP path is 14d's, unchanged, and T6 covers the
  new fields.
