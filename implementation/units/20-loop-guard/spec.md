---
unit: "20"
name: loop-guard
status: approved (2026-11-02)
roadmap: design/07-implementation-roadmap.md, row 20; D-18 (loop rules, caps, budgets, environment faults, usage pauses), D-57 (one usage budget), D-38, D-41; R-C7, R-M4, R-M5, R-M7; design/01 §9 (L1–L8); the notes for 20 from 19a, 19b, 19c
depends_on: ["19c", "09a", "05b"]
---

# Unit 20: The loop guard

## Why

Your main worry, from the start, has been agents going back and forth and burning your subscription (Q5). D-18 answers it with fixed rules, not an AI deciding when to stop:
- a small number of rounds;
- findings that can't multiply;
- a repeat counting as a plan problem;
- progress or stop;
- hard budgets.

From unit 21 on, every fix loop for code and documents goes through this one library, so it comes first (R-C7). No loop runs yet, so this unit is a library with its store, tested with seeded rounds.

**A new fact makes the usage budget real.** Your first launch's stream carried a `rate_limit_event` from Claude Code:

```
"rateLimitType": "seven_day", "unifiedWindows": { "seven_day": { "utilization": 0.11, "resetsAt": 1793865600, "status": "allowed" } }
```

That's your weekly limit's use, 11%, and when it resets. Until now `limit_share` was "unknown" and D-57's caps had nothing to check against. This unit reads that number.

## Scope

**In.**

1. **Round counter (D-18, L1–L5).** One shared budget per ticket across checks, review and QA: 2 rounds normally, 3 for high risk (config, `[loop] rounds`, `rounds_high_risk`).
   - Machine failures inside the developer's own session don't use a round; only failures after handover do.
   - **Environment faults never use a round** (R-M5).
2. **Findings across rounds (L2, L4, L5):**
   - **L2:** from round 2, a new finding is allowed only if it's blocking and cites the delta. 09a's triage has the parts; this applies them across rounds.
   - **L4:** the same fingerprint (file + symbol + `basis.ref`) or the same test-failure signature twice is a plan problem: route to re-plan, or park if re-plan was used.
   - **L5:** the open blocking count must strictly drop each round; a file's blob hash returning to an earlier value is churn. Either one parks.
3. **Budget ledger, per ticket and per night (R-M4):** turns, tokens (cached apart), minutes, the dollar estimate from `total_cost_usd`, and **limit share** (below). **No default caps on turns, tokens or minutes** until the calibration run (D-18): the keys exist, unset means "recorded, not enforced".
4. **Limit share, measured (D-57).**
   - `runAgent` reads every `rate_limit_event` in the stream: the window, `utilization`, `resetsAt` and `status`.
   - A launch's share is the weekly utilization at its end minus the last known value before it. It's logged as `limit_share_source: measured`, and the global ledger gets its delta (05b's `appendUsage`).
   - Utilization comes in hundredths, so a short run often reads 0. The ledger also keeps the raw readings, and the night's total is the latest reading minus the night's first, which doesn't lose the small runs.
   - A `status` other than `allowed`, or a five-hour window near its limit, is a **usage limit**, not an agent failure (below).
5. **The global usage check before every ticket (D-57):** with the latest weekly utilization U, the night's use N, and your caps from `~/.config/mirai/config.toml`:
   - no new ticket if N ≥ `night_max`, or the week's MIRAI use ≥ `week_max`, or 1 − U < `reserve`;
   - **projected:** no new ticket when the next one could cross a cap, using the largest ticket so far tonight, or a configured `ticket_estimate` until there is one;
   - the refusal names the cap and the numbers, and the run stops like `run.stop_by`;
   - **no reading yet** (a fresh install, Claude Code stopped sending it): the check says "unknown" and **refuses** a new ticket in an unattended run, and allows it in your terminal with a warning (open point 2).
6. **A usage limit pauses, never parks (D-18):** the run goes `running → paused`, with the reset time recorded and the counters checkpointed. The resume itself is unit 28's; this unit gives the decision and the record.
7. **Counters in the store, saved before each launch:** `<store>/loop/<ticket>.json`, written atomically **before** a launch is started, never reset by a resume (D-18: "a restart can't grant new rounds"). A launch that crashed counts as having happened.
8. **Parking notes:** a fixed, deterministic note per park reason (rounds out, repeat, no progress, churn, scope violation, budget), naming the evidence by path. Rewording it on the `light` tier (D-14) is unit 28's. A ticket parks through 04's state machine (`blocked` with a park reason).
9. **From 19b, a scope refusal:** the evidence stays (`agent-runs/<launch>.scope.json`) and the ticket parks, naming it. Resetting to the checkpoint is unit 22's, since checkpoint refs come there; until then the dirty tree stays for you, as now.
10. **The circuit breaker (D-18):** N environment faults in a row (config, default 3) stop the night with one clear message instead of parking every ticket.
11. **Docs:** `docs/loop-rules.md` (the rules in plain words, what each cap means, where counters live); research/10 (the `rate_limit_event` fact); the roadmap.

**Out:**
- **The loops themselves:** units 21 (plan and build), 24 (review), 25–27 (QA, docs).
- **Tier escalation for light steps:** unit 58.
- **The pause's wait and resume:** units 28 and 29; the morning report: 56.
- **Calibration of the caps:** unit 57.

## Probes (with your OK before each batch)

- **R1. What `rate_limit_event` carries, and when.** Three short Haiku launches through `mirai agent run`'s path, reading every event:
  - Does each run get one?
  - At the start or the end?
  - Does it show a five-hour window?
  - Does utilization move by 0.01 for a short run?

  About 3 runs. Your own sessions use the same weekly limit, so the numbers include them.
- **R2. A run that hits a limit,** if one can be shown safely. It probably can't on purpose without using up your week, so I'd rely on the documented `status` values and a seeded stream, and say so.

## Files

- **New:** `src/loop/guard.js` (rounds, rules, decisions), `src/loop/ledger.js` (budgets, usage readings, the check), `src/loop/park.js` (notes), `docs/loop-rules.md`, tests in `test/loop/`.
- **Changed:** `src/agent/run.js` (read `rate_limit_event`, log a measured share, feed the ledger), `src/store/global.js` (readings beside the deltas), `src/config/config-schema.js` (`[loop]`, `[usage] ticket_estimate`), `src/store/run-log.js`, research/10, the roadmap.

## Tests (`npm test`, no model)

- **T1.** Seeded rounds: a ticket parks when its rounds run out (2, or 3 for high risk); a machine failure inside the session and an environment fault use none.
- **T2.** L4: the same fingerprint or failure signature twice routes to re-plan, then parks.
- **T3.** L5: a count that doesn't drop parks; a blob hash returning parks (churn).
- **T4.** L2: a new non-blocking finding in round 2 is dropped, and so is a blocking one outside the delta.
- **T5.** A killed-then-resumed loop keeps its counters: the file is written before the launch, and a reload never lowers them.
- **T6.** The usage check: a seeded ledger near `night_max`, `week_max` or the reserve stops before the next ticket and names the cap and numbers. A projected crossing stops too. "Unknown" refuses unattended and warns in a terminal.
- **T7.** A stream with `rate_limit_event`s: the share is measured, the global ledger gets the delta once (05b: never counted twice), a non-`allowed` status is a usage limit.
- **T8.** The circuit breaker trips after N faults in a row and resets on a success.
- **T9.** Parking notes name the reason and the evidence path, escape what they quote, and park through 04's machine.

## Done when

- Seeded loops park inside the caps.
- A killed-then-resumed loop keeps its counters.
- A repeat fingerprint routes to re-plan.
- A seeded ledger near `night_max` stops the run before the next ticket and names the cap.
- A real launch logs a measured limit share.

## Open points for you

1. **Reading your usage from Claude Code's stream.** My recommendation: yes. It's the only measured number there is, and it makes D-57's caps work. It's undocumented, so a Claude Code update could change or remove it. Then the check falls back to "unknown" (point 2), and the red team's binary check (S1) wouldn't notice: I'd add a no-model check that a launch's stream still carries it.
2. **No reading.** My recommendation: refuse a new ticket in an unattended run, and warn in your terminal. Refusing is the safe side of your worry. The cost: a Claude Code change would stop overnight runs until it's fixed.
3. **No default caps on turns, tokens and minutes until calibration (D-18).** My recommendation: keep it so. Usage caps (D-57) have defaults (15 / 60 / 40); the others are recorded, not enforced, until unit 57 measures them. The rounds caps (2 and 3) are D-18's and stay.
4. **The projected check's estimate.** My recommendation: the largest ticket so far tonight, or a `ticket_estimate` you set (default 2% of the week) until there is one. It's crude; calibration replaces it.
5. **The cost:** about 3 Haiku runs for R1. I'll ask first.

## Changes after testing and review

1. **A new park reason, `scope`,** in unit 04's list, for 19b's refusals.
2. **A usage limit is its own outcome,** `usage-limit` (exit 5), so it never reads as an agent's failure.
3. **The check "a launch's stream still carries the reading"** is a note in `mirai agent run`'s output, not a red-team check: S1 reads the binary, not a stream.
4. **A cap is crossed when the projection goes over it,** not when it reaches it.
5. **From the reviews:** L2 applies to new findings only, so an unfixed finding outside the delta still counts (it was dropped, so a ticket could read as done with an open problem); a launch ending in an environment fault or a usage limit gives its round back (`settleLaunch`); the round number comes from the counters, so a replay is refused; one re-plan per ticket, the status file's; only you add rounds (`grantRounds`); counters change under a lock and a hand-edited file refuses; "a night" is MIRAI's measured use in the last 12 hours, not "since this run"; a launch's share uses its own stream or a fresh baseline only; only `rejected` is a limit, and only on a run that didn't succeed; out-of-date readings and unreadable caps refuse unattended; the plan is recorded; `limit_window` and `resets_at` in the log; per-launch ledger lines are the only kind.
6. **L2 by file, not by line,** as design/01 says by line: the delta's hunks aren't available yet (unit 24 brings them).
7. **"A five-hour window near its limit" is dropped:** only `rejected` counts; a warning feeds no decision yet.
8. **A usage limit ends a single agent run as `stopped`, not `paused`:** `paused` would block the next `mirai agent run` until unit 28's resume exists. Unit 28 pauses its own runs.
9. **Not built here:** documents' loops (rows 25–27 settle a park state in 04 first), the breaker's caller (unit 28), per-night aggregates of turns and tokens (unit 29). `src/store/global.js` changed only in a comment.
10. **From the review of the fixes:** the baseline's age is taken at the launch's start (a long launch never got a measured share); a broken readings file can't stop a launch; only a fault decided before the agent could act, or a usage limit, gives a round back; a usage limit only when the stream ends on it, never for running out of turns; the loop keeps its own re-plan count too; rounds need your signed move as proof, one grant per move; each launch is settled once; the round is required; the breaker checks its run id; the progress count starts again after a re-plan; an old reading's refusal says a tiny launch would refresh it (`cap: 'stale'`, `probe`).
11. **Your decisions after the reviews:** 1A, an out-of-date reading needs a tiny Haiku launch to refresh it before the night's first ticket (unit 28 makes it; this unit refuses with `cap: 'stale'` and `probe`); 2A, L4 stays strict: a problem still open in the next round is a repeat, so a re-plan.
12. **R1's answer:** one reading per stream, after the first answer, so a launch's tail is booked to the next; stated in the docs and research/10.
