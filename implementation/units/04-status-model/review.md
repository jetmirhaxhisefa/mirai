---
unit: "04"
date: 2026-10-23
reviewers: Tech Lead, Architect (independent, read-only)
verdicts: PASS WITH FIXES, PASS WITH FIXES
---

# Unit 04 — Review

Both reviewers confirmed:
- all four machines match `02` view (h) and D-07: no missing or extra moves;
- the human-only check couldn't be bypassed (by arrays, `'constructor'`, string objects, or by
  choice selection).

Each found one blocking issue, all fixed. Every should-fix is applied.

## Applied in unit 04

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **Blocking: a merged MR with a missing or unknown merge target fell back to the written state**, so a merged ticket could show `blocked` | Tech Lead | Facts are checked; malformed facts throw `bad-facts` (exit 4) | T6c |
| 2 | **Blocking: after an MR closed, your moves "send back" and "drop" (from `built`) couldn't be made** | Architect (also Tech Lead) | A closed MR derives `built` with "waiting for your decision"; your written decision after the close takes over | T6b |
| 3 | Ordering by wall clock (local `written_at` vs the host's push time): clock skew, and same-second ties | both | Ordered by the store journal's `seq` (D-06); the status file gains a required `seq`; equal seq → the push wins | T6 |
| 4 | Any later written state took over from `built` | Tech Lead | Only `in-progress`, `in-review`, `waiting` and `blocked` may take over while the MR is open; anything else is an error | T6, T6c |
| 5 | The orchestrator could re-plan forever by labelling every re-plan `plan-rejected` | Tech Lead | The orchestrator gets one re-plan per ticket, whatever the reason; you can always reject a plan | T5 |
| 6 | Document history didn't check who made each move (`by: 'agent'` approving passed) | Tech Lead | When a step names its mover, the mover must be allowed | T11 |
| 7 | Text from files reached messages raw (an escape sequence could reach your terminal) | Tech Lead | Untrusted values are shown safely (`text.js`); a `Symbol` mover is refused cleanly; the context is copied once | T13 |
| 8 | Status file: impossible dates accepted (30 February, 24:00); duplicate keys; position by first text match; `null` note refused; unknown keys dropped on write; no size limit; newer schema unclear | Tech Lead, Architect | Round-trip date check; duplicate keys refused with position; per-line key positions; `null` = no note; unknown keys refused on write; 16 KB limit; "written by a newer MIRAI" | T10 |
| 9 | `nextDraftName` could go backwards (`v3` → `v2`) and accepted `.md` | Tech Lead | Must be newer; a name is required | T11 |
| 10 | T1 didn't check why a pair was refused and used only the first allowed mover | Tech Lead | Asserts `not-allowed`/`derived`, and runs every allowed mover | T1 |
| 11 | The document machine and the registry's shape could drift apart | Architect | A test converts the machine to a registry definition and loads it | T14 |
| 12 | `REPLAN_REASONS` lived inside `move` | Architect | Exported next to `PARK_REASONS` | — |
| 13 | The spec table said `script` for re-plans; the code allows you too | Tech Lead | Spec updated (you can reject a plan) | — |
| 14 | Unit 06 needs to add its own fields to a move record | Architect | `move` passes an `extra` object into the frozen record | — |

**Left to the caller, by design:** a move's outside conditions (for example "the MR is closed"
before `built → dropped`) are checked by the unit that has the facts: units 27 and 46.

## Notes for later units

| Unit | Note |
|---|---|
| 05 | The journal provides `seq` for status writes, pushes, merges and closes; the status-file migration hook lives here when schema 2 arrives |
| 06 | The signature wraps the move record and adds `content_hash`, `version`, `ts`, `key_id` and `seq`; document items carry the version (`prd@v2`) |
| 20, 28 | Rounds and budgets live in the ledger (D-06); `in-review → in-progress` "uses a round" is unit 20's |
| 46 | `mirai handover` may need a `handed-over` final ticket state (additive); one `note` field is enough for park notes |
| 53 | A cross-repo dependency may need `ready-for-dev → waiting` (additive) |
| 60 | The release machine; `machine()` already supports it |
| 67 | Derive the epic's `done` (and maybe `integrating`/`final-e2e`) from facts, as tickets do |
| 37 | Registry definitions gain optional `by`, `needs` and `final` (additive; schema stays 1) |
