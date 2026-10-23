---
unit: "04"
name: status-model
date: 2026-10-23
node: v22.23.2
result: 67 / 67 pass (earlier units' 51 + unit 04's 16), after the review fixes
---

# Unit 04 — Test results

## Run

`npm test` (scoped to `test/**/*.test.js`), after the review fixes (`review.md`):

```
ok 52 - T1: every allowed move succeeds and every other pair is refused, in all four machines
ok 53 - T2: human-only moves need a human; agents never move a status
ok 54 - T3: built, integrated and done can never be written
ok 55 - T4: unpark needs a note and a matching choice; parking needs a park reason
ok 56 - T5: a bad plan gets one re-plan, then the ticket is parked
ok 57 - T6: derived states win over the status file, ordered by journal seq
ok 58 - T6b: a closed MR waits for your decision, which then takes over
ok 59 - T6c: malformed facts throw instead of falling back to a written state
ok 60 - T7: a dependency is satisfied by done, or by integrated inside the same together epic
ok 61 - T8: the run machine
ok 62 - T9: the epic machine, with its human-only moves
ok 63 - T10: the status file round-trips and refuses bad content with positions
ok 64 - T11: documents: frontmatter matches history; frozen versions; no way back from approved
ok 65 - T12: StatusError shape, and movesFrom for menus
ok 66 - T13: text from files is shown safely in messages
ok 67 - T14: the document machine fits the registry's definition shape (unit 37 can move it to data)
# tests 67
# pass 67
# fail 0
```

All earlier tests (units 01, 03a and 03b) are green and unchanged.

## Coverage of the machines

| Machine | States | Allowed moves | Human-only |
|---|---|---|---|
| document | 7 | 9 | 6 |
| ticket | 10 | 17 | 9 |
| run | 4 | 6 | 1 |
| epic | 6 | 6 | 2 |

**T1 checks all 201 pairs of states:** every one of the 38 allowed moves succeeds, and every
other pair is refused. **T2 checks every human-only move** against `script`, `agent` and an
unnamed mover. It also checks that an agent can make **no** move at all.

## The roadmap's "done when"

| Done when | Test |
|---|---|
| The ticket and run transition tables are tested | T1, T8 |
| Illegal moves are refused | T1, T12 |
| A frontmatter/log mismatch is an error | T11 |
| `built`/`done` are computed from git and the MR state (as facts handed in) | T6 |
| A status file saying `blocked` doesn't override a derived `done` | T6 |
| A `together` epic with one `integrated` ticket unblocks the next one | T7 |

## Changes against the approved spec

| Change | Why |
|---|---|
| **`note` is optional; `null` reads as no note;** written files leave it out | Review fix 8 |
| **Ordering by journal `seq`, not clocks** (status files gain `seq`); while the MR is open, `in-progress`, `in-review`, `waiting` and `blocked` may take over from `built` | Review fixes 3–4 (`review.md`) |
| **A closed MR derives `built` ("waiting for your decision")** | Review fix 2: your send-back and drop moves start from `built` |
| **Re-plan moves need a reason** (`plan-rejected`, `bad-plan`); **the orchestrator gets one re-plan per ticket whatever the reason**, you can always reject a plan | Review fix 5 |
| **`movesFrom(machine, state, by)`** added | Lists the moves you can make from a state, for `mirai inbox` and `unpark` later |
| **Agents can make no move at all;** moves are `script` (the orchestrator) or `human` | Agents never write the store (D-12) |
