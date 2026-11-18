---
unit: 30
title: The pilot's usage note, and go or no-go for Milestone B
date: 2026-11-18
ticket: BKT-49 (size M, high risk), MR people-management-tool/platform#3, merged 2026-11-18
sources: mirai report (run r-20261117-223153-e4ab, all of BKT-49's steps), mirai show BKT-49, findings.md
---

# The pilot's usage note

## What ran

BKT-49 ("The team can see every UI primitive in Storybook") went through Milestone A's flow on
`mirai/pilot`, supervised:

- ticket approved;
- plan (10 rounds; see below);
- plan approved;
- the three Storybook packages installed by MIRAI behind Jet's gate (unit 30b);
- the TDD build: red, then green;
- Rex's high-risk review: 5 reviewers, a pass, 17 follow-ups;
- the proofs;
- the MR, which Jet merged.

The result is good:

- 49 story files, two Vitest guards and 176 new frontend tests (3 → 179);
- frontend coverage up from 0 to 3,567 lines;
- `storybook build` passes offline in the ticket's image;
- no component file changed;
- after the merge, a `storybook` compose service (`docker compose up storybook`) was added by hand.

## The numbers

From `mirai report`. "Limit share" is the run log's share of the usage limit.

| Part | Launches | Turns | Tokens | Agent minutes | Limit share |
|---|---|---|---|---|---|
| The approved path: last plan + fix launch (Sonnet) | 2 | 17 | 88 k | 1.3 | 0% |
| Build: red, red round, green (Opus) | 3 | 49 | 3.07 M | 12.8 | 0% |
| Review, high risk, 5 Rex lenses (Opus) | 5 | 89 | 1.54 M | 4.7 | 1% |
| **The approved path in all** | **10** | **155** | **4.7 M** | **18.8** | **~1%** |
| Rejected plans: 9 rounds, each a plan + a fix launch (Sonnet) | 18 | 227 | 1.2 M | 13.0 | 0% (2 unknown) |
| The discarded red step (Opus; Test IDs from the wrong folder, F18) | 1 | 18 | 0.4 M | 3.5 | unknown |
| **BKT-49 in all** | **29** | **400** | **6.3 M** | **35.1** | **~1%** |

- **Fix rounds: 0** of 3. Re-plans after review: 0 of 1.
- **Parks:**
  - 1 `deps-review`: by design, Jet's gate on the lockfile change;
  - 3 `bad-plan`: the plan lint failing twice in one round.
- **Wall time on the approved path:** plan approved 22:02, MR opened 22:50: **48 minutes**,
  including MIRAI's test runs.
- **Jet's attention:** not measured by `mirai session` (none was used); estimated from the journal.
  About **3–4 hours** in all:
  - 13:47–17:46 on the ticket, the first plans, the 30b gate and the red step, interleaved with
    other pilot work;
  - 21:41–22:50 on the plan loop and the build;
  - the morning review and merge.
  - **Jet to confirm** (the manual note the stop rule asks for).

## At this rate

A night is 8 hours, one ticket at a time (MVP).

| Size | Measured | A night | A week (5 nights) |
|---|---|---|---|
| M | about 50 min wall time and ~1% of the limit on the approved path | **about 9 M tickets** (wall time is the limit; the usage limit allows far more) | about 45 |
| S | not measured on the pilot | expected higher; unit 57 calibrates it | — |

If the plan loop seen here repeats (10 rounds, about 13 Sonnet-minutes plus your rejections), it
doesn't cost much usage. It costs **your attention**, and a night run without you can't get past
a `bad-plan` park at all.

## The early stop rule (`07` row 30, spec decision 8)

| Limit | Met? | The reading |
|---|---|---|
| More than about 2 h of Jet's attention | **Met** | About 3–4 h, mostly the plan loop (to be confirmed by Jet). |
| More than 2 fix rounds, or parks | **Met (parks)** | 0 fix rounds, but 3 `bad-plan` parks; the `deps-review` park is the designed gate, not a failure. |
| More than 2× the provisional turn cap (2 × 100 = 200) | **Met in all, not on the approved path** | 400 turns in all; 155 on the approved path. There's no M cap yet, so the S cap is used, as written. |
| Fewer than 3 tickets fit in one night | **Not met** | About 9 M tickets a night. |

## Why the limits were met

All three met limits come from **one place: the plan step**. Build, review, proofs and the MR
worked first time:

- 0 fix rounds;
- a review pass;
- proofs and the MR in one go;
- a correct, working result.

The plan step failed in ways that are known and fixable (`findings.md`):

1. **Test IDs (F18, F20):**
   - the plan template said "the Test ID the level's runner selects", and Kai wrote paths from
     the frontend's folder;
   - the lint didn't catch it, and the red check failed only after a 3.5-min Opus build;
   - fixed in the template during the pilot (PR #70); the lint check is still to do.
2. **The lint's table rules (F19, F22, F24):**
   - a Change cell must be one bare word;
   - Symbols must be code spans;
   - a test row's Symbol must match the Code map exactly.
   - Kai's one fix launch rarely got all of these, so most rounds parked `bad-plan`.
3. **The re-plan's memory (F21):**
   - each re-plan saw only the latest rejection note, and the fix launch saw none;
   - a wrong detail in the approved ticket (my Storybook version, 10.2.16 for 10.4.6) kept coming
     back until the ticket itself was edited.
4. **Dead ends in the CLI (F23):** `unpark --retry` on a `bad-plan` park led to a state where
   `plan` refuses. The way out was a reject at the gate, found by trial.
5. **My own input error:**
   - the version in the ticket was wrong;
   - Kai caught it in the first plan, but the ticket outranked him.

Other findings (F1–F17, F25–F28) cost time on install and review, not on the ticket's own run:

- setup and detect gaps;
- the session server and the baseline after every push;
- CRLF line endings;
- the MR text;
- merging on the host;
- previewing a branch.

## Go or no-go

**Recommended: go for Milestone B, with the plan-step fixes first.** Jet decides.

The rule says "stop and rethink before B". This note is that rethink:

- the agent work itself (build, review, proofs) is sound;
- the cost on the approved path is small;
- the throughput is well above the bar.

What failed is the plan step's lint and re-plan loop, plus the CLI paths around it. Milestone B
runs tickets at night without you, where a `bad-plan` park simply stops the ticket. So these must
be fixed before B, not during it.

**Before B starts (proposed, with 29e → 30a → 12c):**

1. **The plan lint and template:**
   - a Test ID must be in a path the level mounts, and of a file type the level can run (F18,
     F20);
   - the Change cell takes its first word (F22);
   - Symbols are code spans, and the error message quotes the cell (F19, F24);
   - the gate refuses `a` on a plan that fails the lint (F24b).
2. **Re-plans:**
   - a re-plan and the fix launch get every rejection note (F21);
   - `unpark --retry` on `bad-plan` goes to `ready-for-dev` (F23).
3. **Line endings:** MIRAI's commit keeps each file's line endings (F25).
4. **Measuring attention:** use `mirai session` on the next supervised ticket, so the 2 h limit is
   measured, not estimated.

The rest of the findings go to the units they name (`findings.md`, "Fix after the pilot").

## Follow-ups from BKT-49 itself (Thudos, not MIRAI)

- Rex's should-fix findings (F4, F8 of review 1): the render test should assert that no
  `fetch`/XHR is called for every story, not only the 7 context ones. Material for a small
  follow-up ticket.
- Add `build-storybook` to `.mirai/config.toml`'s checks (AC 6; a person does it after the
  merge).
- The README and `.storybook/main.ts` are now LF in a CRLF file set (F25); normalize them or add
  a `.gitattributes`.
