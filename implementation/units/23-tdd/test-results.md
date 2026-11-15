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

## R1: a real run on the sample app

Pending: SAMPLE-6 through `mirai run`, after the sample app's refresh and a green red team.
