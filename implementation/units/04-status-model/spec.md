---
unit: "04"
name: status-model
status: draft (decisions applied 2026-10-23)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 04; D-06, D-07, D-17, D-18, D-33; 02 view (h)
depends_on: ["01", "03b"]
---

# Unit 04 — The status model

## Why

Every document, ticket and run moves through states, and MIRAI must never get them wrong:
- an agent must not approve its own work;
- a merged ticket must never show as `blocked`;
- an overnight run must know whether it's paused or stopped.

This unit defines the states, the allowed moves, who may make them, and which states are
**derived from facts** instead of written down (D-07, `02` view (h)).

**Roadmap "done when":**
- the ticket and run transition tables are tested;
- illegal moves are refused;
- a frontmatter/log mismatch is an error;
- `built` and `done` are computed from git and the MR state;
- a status file saying `blocked` doesn't override a derived `done`;
- a `together` epic with one `integrated` ticket unblocks the next one.

## Scope

**In:** a pure library (no files, no git, no network):
- **Four state machines:**
  - **document:** brief, PRD, HLD, LLD, ADR, ticket set, context files;
  - **ticket;**
  - **run;**
  - **epic** (`release: together`).
- **One move function** that checks the move is allowed and that the mover may make it. Human-only
  moves need `by: 'human'`; signing them is unit 06.
- **Derivation:** the effective ticket state from the written status plus facts (MR state, merge
  target, proofs at the head, push times).
- **The ticket status file:** its format (JSON), validation and serialization. Where it lives is
  unit 05's store.
- **Dependency check:** whether a ticket's `after` dependency is satisfied, with `integrated`
  counting inside a `together` epic.
- **Document helpers:**
  - the frontmatter/history consistency check;
  - the frozen-version naming (`prd.md` approved, `prd.v2.draft.md` beside it).

**Out:**
- **Where status files live, and the run log** (unit 05).
- **Collecting the facts:** git and MR state come from units 22 and 27, so 04 receives them as
  plain data.
- **Signing human moves** (unit 06).
- **Parsing document frontmatter** (unit 07); 04 checks values it's given.
- **The release machine** (unit 60).
- **`mirai status`:** moved to unit 05, where the store exists (your decision).

**Hard-coded in A, data later (D-37):** the machines live in code now. Unit 37 can move them
into registry definitions; the 03b registry already validates that shape.

## The machines (from `02` view (h) and D-07)

**Documents:** `draft → in-review → changes-requested → draft`, `in-review → approved`,
`approved → superseded | obsolete`, and `draft | in-review | changes-requested → dropped`.
- **Human-only:** `approved`, `superseded`, `obsolete`, `dropped`.

**Tickets:**

| From | To | Who | When |
|---|---|---|---|
| draft | ready-for-dev | human | ticket set approved |
| ready-for-dev | in-progress | script | plan written |
| in-progress | ready-for-dev | script or **human** | re-plan: you reject the plan (any time), or the orchestrator re-plans after a bad plan (once per ticket) |
| in-progress | in-review | script | handover, checks green |
| in-review | in-progress | script | blocking finding or QA fail (uses a round) |
| built | in-progress | **human** | MR comments or red CI: you grant a new budget |
| built | waiting | script | a stacked parent got change requests |
| waiting | *(no move)* | — | parent fixed: after the rebase push, `built` is derived again, because the push is newer than the written `waiting` |
| built | ready-for-dev | **human** | MR closed, you send it back |
| built | dropped | **human** | MR closed, you drop it |
| in-progress, in-review | blocked | script | cap, budget, repeat, no progress, environment (`park_reason` required) |
| waiting | blocked | script | rebase conflict |
| blocked | ready-for-dev / in-progress / dropped | **human** | `unpark`: re-plan / retry (new budget) / drop, **with your note** |
| draft, ready-for-dev | dropped | **human** | you drop it |

**`built`, `integrated` and `done` are derived, never written.** A move *to* them is refused.

**Runs:** `running → paused → running`, `paused → stopped` (reset after `run.stop_by`, or the
weekly limit), `running → stopped`, `stopped → running` (`mirai resume`), `running → finished`.

**Epic (`release: together`):** `open → integrating → final-e2e → ready-to-merge | final-e2e-failed`,
`final-e2e-failed → integrating`, `ready-to-merge → done`. The moves into `done` and back to
`integrating` are human-only.

## Derivation (the "derived states win" rules)

`deriveTicketState(status, facts)`:
- `facts` holds `mr` (`none` | `open` | `merged` | `closed`), `mergedInto` (`integration` |
  `epic`), `epicMerged`, `proofsValidAtHead`, `lastPushAt`, and `releaseMode`.
- The rules, in order:
  1. Merged into the integration branch, or into `feature/<epic>` whose epic is merged →
     **`done`**. Always wins, even over a written `blocked`.
  2. Merged into `feature/<epic>` → **`integrated`**.
  3. MR open, with valid proofs at the head → **`built`**. A written `in-progress` or `waiting`
     whose time is **after** the latest push takes over until the next push.
  4. Otherwise, the written state.
- **The result says where it came from** (`derived` or `written`), so reports can explain it.

## The ticket status file (one home per ticket, D-06)

JSON, holding only what can't be derived:
```json
{ "schema_version": 1, "ticket": "T-12", "state": "blocked",
  "park_reason": "cap", "replans": 1, "seq": 4182,
  "written_at": "2026-10-23T22:14:05Z", "written_by": "script" }
```
`seq` is the store journal's sequence number of the write; it orders the status against pushes,
merges and closes (D-06), never clocks. `note` is optional (`null` reads as no note).
Validated on read:
- `state` must be a writable ticket state;
- `park_reason` is required exactly when `blocked`, from a fixed list: `cap`, `budget`, `repeat`,
  `no-progress`, `environment`, `rebase-conflict`, `bad-plan`;
- `replans` is at most 1 after a `bad_plan` re-plan.

Unknown keys are refused. Ticket files themselves carry no status field (D-06).

## Errors

- **An illegal or unauthorized move** is a `StatusError`, exit code 4 (`BLOCKED`, "refused by a
  gate or safety rule"). It names the machine, the states and the reason, for example:
  `ticket T-12: in-review → done is not allowed (done is derived from the merge)`, or
  `document prd: in-review → approved needs a human (D-17)`.
- **A bad status file** is a `ConfigError` (exit 3) with its position, through 03b's checker.

## Files

```
src/status/machines.js     # the four machines as data: states, moves, human-only, derived
src/status/move.js         # move(machine, from, to, { by, note, reason }) → next | StatusError
src/status/derive.js       # deriveTicketState, isDependencySatisfied
src/status/ticket-file.js  # parse/validate/serialize the status file
src/status/documents.js    # frontmatter/history check, frozen-version names
src/cli/errors.js          # + StatusError (exit 4)
test/status/*.test.js
```

## Tests

| # | Test |
|---|---|
| T1 | Every allowed move in each machine succeeds; **every other pair of states is refused**, checked exhaustively (states × states) |
| T2 | Human-only moves refused for `script` and `agent`; allowed for `human` |
| T3 | Moves to `built`, `integrated` or `done` are refused (derived only) |
| T4 | `unpark` needs a note and one of the choices; a `blocked` move needs a `park_reason` |
| T5 | At most one re-plan after `bad_plan` |
| T6 | Derivation: merged → `done` even when the file says `blocked`; `integrated`; `built` with valid proofs; a later written `in-progress`/`waiting` takes over until the next push; no MR → the written state |
| T7 | `isDependencySatisfied`: `done` always; `integrated` only inside the same `together` epic |
| T8 | Run machine: pause/resume/stop/finish; `finished` is final |
| T9 | Epic machine incl. the human-only moves |
| T10 | Status file: valid examples round-trip; unknown keys, a missing `park_reason`, a `park_reason` without `blocked`, a written derived state, a bad time → refused with positions |
| T11 | Documents: a frontmatter/history mismatch is an error; `nextDraftName('prd.md', 2)` → `prd.v2.draft.md`; an approved version can't be moved to `draft` |
| T12 | Error shapes: `StatusError` exit 4, message names machine, states and reason |

## Decisions (2026-10-23)

1. **Unpark has three choices:** re-plan, retry, drop. No `split`; the `07` note is fixed.
2. **`mirai status` moves to unit 05.** Unit 04 is a pure library.
