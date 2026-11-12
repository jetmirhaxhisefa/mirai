# The loop rules

When an agent's work is checked and sent back, MIRAI follows fixed rules to decide whether to try again. An AI never decides whether to go on (decision D-18). From unit 21 on, every fix loop for code and documents uses them.

## Rounds

- **One budget per ticket,** shared by checks, review and QA: **2 rounds**, or **3 for high-risk work** (`[loop] rounds`, `rounds_high_risk`).
- **A round is the fix launch that sends work back,** whatever triggered it: failed checks, review findings or QA. **The developer's own session doesn't use one:** it runs the checks and tests itself before handing over, and fixes what fails.
- **A launch stopped before the agent could act** (Claude Code never started properly, the login token was refused) **or by a usage limit gives its round back.** A fault found in what the agent did (too many files to check, a process left behind) keeps it, and so does a crash, so neither can buy more rounds.
- **When the rounds are used, the ticket parks.** Only you can give it more: each grant needs your signed move for that ticket (unpark retry, or a grant after an MR, D-07), one grant per move, kept with its note.

**In practice (unit 21c):** `mirai fix` runs the rounds. A round's failures are MIRAI's own test run's new failures, against your baseline. The loop guard reads those as test-failure signatures (by level and test) for L4 and L5, and the files the round changed for churn. The build isn't a round, so L4 and L5 start from round 1. A launch MIRAI refused before Claude Code started gives its round back, like an environment fault. Anything that fails after it started keeps the round. Review findings join from unit 24.

## Findings

- **L1:** only a blocking finding with a basis MIRAI can check (an AC, an ADR, a rule, a repro) sends work back.
- **L2:** from round 2, a new finding counts only if it's blocking and about a file the last fix changed (by file; design/01 says by line). A finding from an earlier round always counts.
- **L3:** a finding the developer disputes goes to your inbox, not the count (unit 24).
- **L4:** the same problem in a later round is a plan problem, **including one that simply wasn't fixed:** "still open next round" is a repeat, so a fix that misses one problem sends the ticket back to planning (your decision in unit 20). That's the same finding by file, symbol and basis, never line numbers, or the same test failure with times and paths taken out. The ticket goes back to planning once (one re-plan per ticket, whatever the reason, counted both in its status and in the loop counters); the progress count starts again after it; the next repeat parks it.
- **L5:** the number of open blocking problems must drop every round. A file going back to an earlier version is churn. Either parks the ticket.

## Counters

They're kept in the store, `<store>/loop/<ticket>.json`, changed under a lock, and written **before** each launch. A launch that crashed counts as having happened. **A resume never resets them:** a restart can't grant new rounds. A counters file MIRAI can't read, or one that's been edited into nonsense, refuses the next launch; it's never reset by guessing.

## Budgets

Per ticket and per night, MIRAI records turns, tokens (cached input apart), minutes, the dollar estimate and your usage. **Turns, tokens and minutes have no caps until the calibration run (unit 57):** they're recorded, not enforced.

## Your usage (D-57)

Claude Code has reported, in each run's stream seen so far, how much of your weekly limit you've used (`utilization`) and when it resets. MIRAI keeps those readings in `~/Library/Application Support/mirai/global/`, from every project. **A launch's share** is the change across its own stream, or from the last reading before it if that was under 30 minutes old when the launch started, in the same week; otherwise it's unknown, never a day of other use booked as the launch's. A share still includes whatever else used your subscription at the same time. The reading comes once per stream, after the first answer (probed), so the end of a launch is booked to the next one; across a night they add up.

**Before every ticket** MIRAI checks your caps in `~/.config/mirai/config.toml`:

| Cap | Default | Checked against |
|---|---|---|
| `night_max` | 15 | MIRAI's measured use in the last 12 hours, all runs and projects, plus the next ticket |
| `week_max` | 60 | MIRAI's measured use this week, plus the next ticket |
| `reserve` | 40 | what's left of your week by the latest reading, whatever used it, your own work included, minus the next ticket |
| `ticket_estimate` | 2 | the next ticket's likely share, until a run has measured one |

It stops **before** a ticket that could cross a cap, and says which cap and the numbers.

- **What it can't tell, it refuses in an unattended run** and warns about in your terminal: no reading yet, a reading out of date (older than 12 hours, or its week has reset), or caps in a file it can't read. Readings come only from launches, so an out-of-date one needs a tiny launch to refresh it before the night's first ticket (your decision in unit 20; unit 28 makes it).
- **A usage limit** (the stream ends on a window Claude Code `rejected`) on a run that didn't finish, other than by running out of turns, is that run's outcome, `usage-limit`, with the window and when it resets in the log. A warning (`allowed_warning`) isn't a limit. In `mirai run` (unit 28) a 5-hour limit pauses the run until the reset, then the same step runs again (`run.on_limit`, `run.max_wait_minutes`, `run.stop_by`); a weekly limit stops it for `mirai resume` (docs/run.md).

The reading is undocumented, so a Claude Code update could change it. `mirai agent run` says when a run had none.

## Parking

A parked ticket goes to `blocked` with its reason (`cap`, `repeat`, `no-progress`, `budget`, `environment`, `scope`, …) and a short note naming the evidence. **Three environment faults in a row** will stop the night with one message instead of parking every ticket (`[loop] breaker`). `mirai run` counts them across its launches (unit 28): a single fault runs the step again, a good launch resets the count.

**A scope refusal** (unit 19b) parks the ticket and names its evidence file. Resetting the tree to the checkpoint is unit 22's; until then the files stay for you.
