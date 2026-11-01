---
unit: "19a"
date: 2026-11-01
reviewers: Tech Lead and Architect, then one independent review of the fixes (read-only, no network, no model)
verdicts: three Blockers and many Highs in the first round; no Blocker and three Highs in the second; fixed. The last round of fixes wasn't reviewed again (your choice not to), but the red team ran on it
---

# Unit 19a — Review

## First round

| Finding | From | Fix |
|---|---|---|
| **Blocker:** a run read `ok` with its init never checked | Tech Lead | Every init checked; no check means not ok; nothing may act before it |
| **Blocker:** `ok` with no result, or an error subtype | Tech Lead | Only a real success |
| **Blocker:** a blocker cleared itself on a rerun or by rotation | Tech Lead | A permanent signed record; a decision tied to it |
| **High:** your "not a blocker" rested on part of the read side | Architect | R1c tried the rest; all refused; the decision stands |
| **High:** the cwd rule killed your processes; reused pids and groups; Ctrl-C lost; a false "renew your token"; built-ins filtered; `ps` starving the red team | Tech Lead | Fixed, with tests |
| **High:** survivors only warned; a crash wedged all launches; no nested-launch case; `adv-linger` couldn't measure survival; no-levels projects could never go green | Architect | Fixed |
| Medium, Low | both | Fixed or given a named unit in rows 19b/19c, 20, 21, 22, 24, 28 |

## Second round (of the fixes)

| Finding | Fix |
|---|---|
| **High:** a reused group id could get your process killed (verified with a stubbed table) | A group counts only while one of the agent's processes lives in it; no table, no group signalled |
| **High:** the first launch after a real crash was refused, the agent left running | Takeover under the lock, before the checks; a test with a real kill |
| **High:** a silent process never hit the deadline | It starts at the launch |
| **Medium:** a second Ctrl-C ignored during cleanup; the 3 s timer cutting cleanup; outcomes downgraded; blocker records failing open; `a-mirai-agent` passing trivially | Fixed |

## Left, and named

- A process that leaves the project first: units 21, 22.
- `.git` isn't compared for a crashed run: the takeover says so.

## Your decisions

1. Hook past its timeout on reads: not a blocker.
2. A seeded process that can't be tied to the run: named, not killed (option A).
3. No third review.
