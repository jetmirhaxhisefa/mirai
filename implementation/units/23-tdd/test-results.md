# Unit 23: test results

## `npm test` (2026-11-15)

622 tests: 620 passed on the full run. The 2 that failed:
- **T11 (run log):** the pinned event list didn't have `red_check` yet. Fixed, 8/8.
- **T5/T6 (unit 13's launch):** the known race on the scratch-folder count. It passes alone.

New: `test/agent/tdd.test.js`, 7/7:
- the row verdicts;
- the plan lint (`test-change`, a bug's red row, `after: <reason>`, and the gate for a test change);
- the floor guard on git;
- the red handover end to end, with the evidence in the record, the run log and the proof;
- red rounds, and three failed checks stopping for you;
- a locked red test edited in green stopping the ticket, uncommitted;
- `tdd: after` with one handover and no red check;
- an existing test weakened (stopped), or declared (allowed).

The legacy build, review and proof fixtures now build from an `after`-only plan (`tdd: auto`), since they test other things.

## R2: seeded, on real runners (no model), 10/10

Run as `node test/probes/tdd-probes.js`, on a throwaway clone of the sample app, in Docker:

| Case | Result |
|---|---|
| PHPUnit, a test calling a method that doesn't exist | wrong reason (an error) |
| PHPUnit, the same test with a stub returning a wrong value | red, by an assertion ("Failed asserting…") |
| PHPUnit, a test that passes already | refused (passes already) |
| PHPUnit, a file that doesn't parse | wrong reason |
| Vitest, a failing `expect()` | red |
| Vitest, a TypeError | wrong reason |
| The floor guard: a test added to an existing file | fine |
| The floor guard: an existing assertion weakened | stopped |
| The floor guard: a new `markTestSkipped` | stopped |
| Clean-up | the clone deleted |

The first run reported Docker as down: the probe hadn't passed Docker's socket to the runner, as the other probes do. Fixed in the probe; MIRAI wasn't involved.

## R1: a real run on the sample app (2026-11-15), passed

SAMPLE-6 ("A user sees how many of their tasks are done", GET /api/tasks/summary, `tdd: auto`) on
the sample app refreshed to unit 23 (`fb255be`, then `4ab4625`), the red team green (326 runs,
signed with the machine key `k-6ffd6a59990e793c`). Two runs before it were INCOMPLETE on
`r-tilde-tools` alone (Haiku didn't make the `~/` Read as written); PR #57 steadied that case and
names the calls a run made when it misses one.

| Step | Result |
|---|---|
| Ticket approval | your passphrase, signed `k-eea7…`, seq 111 |
| Plan | one lint fix launch (4 problems), then: 3 `red` rows (AC 6.1–6.3), 1 `after: <reason>` row (6.4, the 401 comes with the stub route), a new test file, no declared changes |
| Plan approval | your passphrase; the plan printed before the question |
| Red commit `54e2bed` | the tests, the route, and a stub answering `-1` for each count |
| Red check | all 3 rows red by an assertion ("Failed asserting that two strings are equal."), 0 red rounds |
| Green commit `8f97769` | the stub replaced by the counts; the `after` test added (new lines only: the lock held, nothing stopped) |
| Tests | lint, unit, frontend, e2e: pass |
| Rex | PASS, 0 blocking findings, read only its input |
| Proofs | review and gate signed by the machine key; the gate proof's `tdd`: 3 red, 1 after, the red commit and each row's first failure |
| `review-mr` | "Test-first 3 red, 0 characterization, 1 after · red confirmed at 54e2bed", each row's first failure listed |
| `gate check SAMPLE-6 --commit 977a448` | passes; all 3 changed lines that can run ran |
| Merge | your passphrase; MR #15 merged as `9805f38`; SAMPLE-6 done |

34 turns, 319 k tokens, 2.2 min. No passphrase was asked during the run.
