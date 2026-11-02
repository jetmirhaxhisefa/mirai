---
unit: "20"
date: 2026-11-02
reviewers: Tech Lead and Architect, then one independent review of the fixes (read-only, no network, no model)
verdicts: one Blocker and many Highs in the first round; no Blocker and two Highs in the second; fixed, two by your decision
---

# Unit 20 — Review

## First round

| Finding | From | Fix |
|---|---|---|
| **Blocker:** L2 dropped unfixed findings, so a ticket with an open blocking problem read as done (verified) | both | L2 applies to new findings only; a known one always counts |
| **High:** environment faults and usage limits used up rounds | both | A refund for a launch that ends so |
| **High:** a launch's share took in a day of other use; "a night" restarted with each run and missed the first ticket | both | A share from its own stream or a fresh baseline only; a night is MIRAI's last 12 hours |
| **High:** any status but "allowed" was a limit, even on a success, and hid safety refusals | both | Only `rejected`, only on a run that didn't succeed, after the safety checks |
| **High:** the plan wasn't recorded; the round came from the caller; nothing could clear a park | Architect | Recorded; derived from the counters; `grantRounds` |
| **Medium:** two re-plan counters; hand-edited counters accepted; no lock; broken caps fell back to defaults; stale readings; no structured limit record; documents can't use it; docs overclaims | both | One re-plan count; full validation; a lock; refuse; out of date refuses; `limit_window`, `resets_at`; rows 25–27; docs |
| Low | both | Fixed, or stated |

## Second round (of the fixes)

| Finding | Fix |
|---|---|
| **High:** a launch over 30 minutes never got a measured share | The baseline's age at the start |
| **High:** every night would refuse its first ticket on an old reading | **Your decision 1A:** a tiny launch refreshes it (unit 28); this unit says `probe` |
| **Medium:** an unfixed finding is always an immediate re-plan | **Your decision 2A:** keep L4 strict, as designed |
| **Medium:** a status write could drop the re-plan count; rounds could be granted by any code; an agent could buy a refunded round; a rejected window mid-stream turned failures into limits; a broken readings file stopped launches | The loop counts re-plans too; a grant needs your signed move; only pre-action faults refund; only a limit the stream ends on; caught |
| Low: double settling, an optional round, the breaker's path, L5 across a re-plan, contents not validated, an exact reset match | Fixed |

The second round's fixes weren't reviewed again; each has a test.
