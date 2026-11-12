# Running a ticket: `mirai run`, `mirai resume`, `mirai show`

`mirai run <ticket>` takes one ticket from wherever it is to its merge request (MR). It stops only where you're needed (unit 28). Each step is the same command you'd type yourself (`plan`, `build`, `fix`, `review`, `gate record`, `ship`); the run only chains them.

```
mirai run SAMPLE-1             # plans, then stops: "approve the plan: mirai approve SAMPLE-1 --plan"
mirai approve SAMPLE-1 --plan  # yours, in a terminal
mirai run SAMPLE-1             # build → tests → fix rounds → review → proofs → MR
```

The next step is read from the ticket every time, never remembered. So running `mirai run SAMPLE-1` again after any stop, or a crash, is the same command.

## The order

| The ticket | What the run does |
|---|---|
| `ready-for-dev` (also after a rejected plan or a re-plan) | plans, then stops at the plan gate |
| `in-progress`, its plan waiting for you | stops: `mirai approve <ticket> --plan` |
| `in-progress`, plan approved, no build yet | records the baseline if `main` moved, then builds |
| `in-progress` after failing checks or review changes | fix rounds |
| `in-review`, no passed review of this code | Rex reviews |
| `in-review`, review passed | signs the proofs (your terminal), or stops (your session) |
| `in-review`, proofs valid at the head | ships: pushes and opens the MR |
| `built` (an MR with valid proofs at its head) | nothing: prints the MR |
| `blocked` | stops with the parking note and `mirai unpark` |
| `draft`, `dropped`, `done`, `waiting` | refused, with why |

**Where it starts:** on the integration branch with a clean tree, or on the ticket's own branch. The build step makes the ticket's branch, named by `[git] branch_pattern` (default `feature/{ticket}-{slug}`). After the MR, the run goes back to the integration branch. After any other stop, it stays where it is, and says which branch you're on.

**Every plan waits for you.** There's no automatic approval until the autonomous preset (unit 55, with row 29b's machine key), whatever `[gates] plan` says.

## Where it stops

Each stop ends with one line saying what to do next, ending in the exact command:

- **A gate:** the plan approval; or, from your session, the proofs.
- **A park** (the loop guard, a bad plan): the reason, then `mirai unpark`.
- **Needs you:** a protected path, a step MIRAI couldn't judge, a failing gate.
- **The baseline:** a new known failure on the integration branch (`baseline-grew`) or an incomplete baseline. A test that was flaky before and passed first time is carried over, not new.
- **The breaker:** `loop.breaker` environment faults in a row (3 by default). A single fault runs the step again.
- **A usage limit** it can't wait out (below), or Ctrl-C.

The exit code: 0 for the MR, 5 for a gate or a stop for you, 4 for a park or a refusal (such as no `origin` remote, or a closed MR), 130 for Ctrl-C.

## Usage limits

Before the first launch, if your usage reading is older than `usage.stale_hours` (12), one Haiku launch with no tools reads it.

At a **5-hour limit**, the run waits for the reset and continues by itself:

```
paused: usage limit until 14:05 (in 2 h 10 min). Ctrl-C stops; mirai resume continues later
```

The cut launch doesn't use up a round. A **weekly limit** stops the run. Your settings:

| Setting | Where | What | Default |
|---|---|---|---|
| `run.on_limit` | project or personal | `"wait"` or `"stop"` at the 5-hour limit | `"wait"` |
| `run.max_wait_minutes` | project or personal | the longest wait; past it, the run stops | 300 |
| `run.stop_by` | project or personal | a clock time ("06:30") after which a wait stops instead | none |
| `usage.stale_hours` | your global file | how old a usage reading may be | 12 |
| `usage.night_max`, `week_max`, `reserve` | your global file | how much MIRAI may use, and leaves for you | 15 / 60 / 40 |
| `loop.rounds`, `rounds_high_risk` | project | fix rounds per ticket | 2 / 3 |
| `loop.breaker` | project | environment faults in a row before the run stops | 3 |

Your Mac doesn't sleep during a run: MIRAI runs `caffeinate`, which ends with the run.

## From your session

`/mirai run SAMPLE-1`, `/mirai resume` and `/mirai show SAMPLE-1` work in your Claude Code session too. From the session, the run stops before the proofs: your key signs them in your terminal only, until row 29b. The stop says:

```
in your terminal: mirai gate record SAMPLE-1; then /mirai run SAMPLE-1
```

`/mirai gate record` from the session prints that command and runs nothing, as every gate does.

## `mirai resume`

Continues your last run. It first says what was in progress, what's parked and what waits for you. A run whose process is gone (a crash, a restart) is taken over: its agent is ended if it's still there. Then the same ticket goes on from where it is. **Round counters and budgets are never reset.**

- After a crash with uncommitted changes in the tree, the run stops and names `mirai discard <ticket>` (your typed confirmation): the half-finished step goes back to its checkpoint, then `mirai resume`.
- Moving the run from stopped to running is yours: signed from your terminal, or, from your session, confirmed by the request the store holds. The journal's `run_resumed` line says which.
- `mirai resume --abandon` gives the run up. While a stopped run is open, `mirai run` of another ticket says to resume it or give it up.

## `mirai show <ticket>`

The ticket's page, from MIRAI's store; nothing of it is committed, and showing it writes nothing:

```
PMT-31: Renaming a team hides its members          built · MR https://…/pull/7
  branch feature/PMT-31-… at 3f2a91c · proofs valid at head · normal risk

Plan       round 1, approved by you 2026-11-12 10:41 (k-eea7…)
Build      handed-over 2026-11-12 10:58 · tests: unit pass, feature pass
Review 1   PASS · 1 follow-up
MR         open https://…/pull/7
Rounds     0 of 2 used · re-plans 0 of 1
Usage      41 turns · 1.2 M tokens · 19 min
Parked     —
QA         not yet (unit 51)
```

`--full` adds every finding's text, the plan and the parking note whole; `--json` is for scripts.
