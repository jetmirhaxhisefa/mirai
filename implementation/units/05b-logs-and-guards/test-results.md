---
unit: "05b"
name: logs-and-guards
date: 2026-10-23
node: v22.23.2
result: 88 / 88 pass (earlier units' 80 + unit 05b's 8), after the review fixes and your four decisions; 3 full runs in a row green
---

# Unit 05b — Test results

## Run

`npm test` (scoped to `test/**/*.test.js`), after the review fixes (`review.md`):

```
ok 68 - T11: run log: a line with tier, model and limit_share validates; bad lines are refused; the event list is pinned
ok 69 - T12: run state: legal moves are saved with a run_state line of the same seq; illegal and human moves are refused
ok 70 - T13: registry: register, look up, clear with their events; a missing or corrupt registry blocks trailer branches
ok 71 - T14: global: one run at a time across repos; a dead holder is broken and logged; the ledger sums across repos
ok 72 - T15: mirai log: notes are unverified; MIRAI's own events are refused; bad input is a usage error
ok 73 - T18: several numbers in one step: consecutive seqs across the journal and a run log; an unused number is a gap
ok 74 - T19: the counter check reads the newest run log too
ok 75 - T20: mirai status shows the run and the global lock, in text and JSON
# tests 88
# pass 88
# fail 0
```

**Three full runs in a row:** 88/88 each, 50–58 s.
- **Why slower than 05a's 33–35 s:** node runs test files in parallel, and the two store test
  files now compete for the machine.
- **Evidence:** T1's code didn't change, and it went from 4 s to 10 s.

**Earlier tests changed:**
- `test/cli/cli.test.js` T14: one line, because the command list now includes `log`.
- `test/store/store.test.js`: its helpers moved, unchanged, into `test/store/helpers.js` (shared
  with the new file), and its unused imports went.

**Isolation:** every test uses a temporary `HOME` and temporary git repos, as in 05a. T14
starts a second MIRAI process (`fixtures/run-lock-worker.mjs`) to prove the cross-process
refusal. T15 checks the work tree is unchanged.

## Coverage of the spec's tests

| Spec | Where | Notes |
|---|---|---|
| T11 run log | T11 | Plus the new fields (your decisions 3–5), the `limit_share` source rule, cost, rung, `finding_outcome`, and "a refused line takes no number" through `startRun` |
| T12 run state, heartbeat | T12 | Plus `recordProgress`, position kept across pause/resume, a future or damaged heartbeat, `stopBy` refused before writing, `runStateMatchesLog` after a simulated crash |
| T13 registry, `pushScope` | T13 | Plus all reasons kept, the ancestry filter, blocking on any MIRAI sign while the index is lost |
| T14 global lock, ledger | T14 | Plus `beginRun`, release after a failed break log, delta lines skipped when already covered, ticket/run line rules, a bad date |
| T15 `mirai log` | T15 | Plus multi-byte text over 16 KB is a usage error and uses no number |
| T18 several numbers | T18 | Plus the guard: a number not taken, used twice or out of order is refused, and the store still opens |
| T19 counter and run logs | T19 | Plus `state.json` naming a run that doesn't sort last |
| T20 status lines | T20 | |

## What came up while testing

1. **T14's first version** tried the second run from the same process, so the re-entrancy guard
   answered instead of the run lock. The test now uses a separate process, like a real second
   run.
2. **T11's 400-check line** was 14.9 KB, under the 16 KB limit, so it wasn't refused. The test
   now uses 500 checks.
