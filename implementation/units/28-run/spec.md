---
unit: "28"
name: run
status: approved (2026-11-12; Jet's interview decisions 1–7 and the standing rule, the defaults as written)
roadmap: design/07-implementation-roadmap.md, row 28 (`mirai run`, supervised, one ticket); design/01 §14 (resume), §13 (the report's run log); design/03's orchestrator and `mirai show` rows; D-07 (the run states), D-18 (usage limits, the breaker), D-06 point 5 (the checkout lock)
depends_on: ["21", "23", "24", "27"]
---

# Unit 28: `mirai run`, supervised, one ticket

## Why

Every step of a ticket exists as its own command: `plan`, `approve --plan`, `build`, `fix`, `review`, `gate record` and `ship`. Today you type each one, read its outcome and work out the next. This unit adds the driver: `mirai run SAMPLE-1` takes the ticket from wherever it is to its merge request (MR), and stops only where you're needed. After it, one sample-app ticket goes to an MR with you typing `run`, `approve --plan` and `run` again.

Already built and waiting (the research, 2026-11-12):

- **The steps and their outcomes:** `runPlan`, `runBuild`, `runFix`, `runReview`, `recordProofs` and `shipTicket`, each with fixed outcome words (`waiting`, `handed-over`, `changes`, `pass`, `recorded`, `opened`, `parked`, `needs-you`, …) and the ticket moves they make (`src/status/machines.js`).
- **The run's parts:** run ids, the run lock (one run at a time on this machine), the run state (`running → paused → stopped | finished`), the heartbeat, taking over a crashed run, `launchInRun` (unit 19c: a launch inside a run whose lock the caller holds), launch tokens, checkpoints (unit 22), the loop guard and round budgets (unit 20), parking, and `usageCheck` with its `probe` answer.

What's missing:

- **Nothing chains the steps,** and they can't be chained as written: `plan`, `build`, `fix` and `review` each take the run lock themselves, and a lock can't be taken twice by one process.
- **No `run`, `resume` or `show` command, and no `caffeinate`.**
- **Unused so far:** the circuit breaker (`recordFault`), `run_finished`, a signed "you resumed it" move, the usage probe launch, pausing on a usage limit, the baseline refresh with `refuseGrowth`.

## Decisions (Jet, 2026-11-12, in the interview)

1. **The run stops at the plan gate, and you run it again.** `mirai run <ticket>` always does the next steps from wherever the ticket is, until a gate or the MR. Running it again after a crash or a stop is the same command.

   ```
   mirai run SAMPLE-1             # plans, then stops: "approve the plan: mirai approve SAMPLE-1 --plan"
   mirai approve SAMPLE-1 --plan
   mirai run SAMPLE-1             # build → tests → fix rounds → review → proofs → MR
   ```

2. **From your session, the run stops before the proofs.** Your key signs proofs only in your terminal until row 29b's machine key (25a's decision 7). From the terminal, `mirai run` signs them and ships in one go. From the session, `/mirai run SAMPLE-1` stops with "sign the proofs in your terminal: `mirai gate record SAMPLE-1`", and `/mirai run SAMPLE-1` again opens the MR.
3. **No automatic plan approval in this unit.** It moves to unit 55 (the autonomous preset), which needs 29b's machine key to sign it. Under any preset, `mirai run` stops at the plan gate. With `plan = "auto"` set, it says "automatic approval comes with the autonomous preset (unit 55)" and gives the `approve` command. `docs/agents.md` ("Automatic approval is unit 28's") and roadmap rows 28 and 55 are corrected.
4. **The baseline at the start, and flaky tests:**
   - **a.** The run records the baseline of the integration branch's commit only when that commit has no complete signed one, so most runs start at once. It passes `refuseGrowth`: a new known failure (`baseline-grew`) or an incomplete baseline stops the run for you.
   - **b.** A test that was **flaky** in the previous baseline and isn't caught this time is **carried over** as known-flaky (`carried_from: <sha>`), and isn't growth. A test never seen failing, or one that failed every time before, still is. A newly caught flaky test is reported as "a newly flaky test", not "a test broke".
5. **A 5-hour usage limit: the run waits, then continues by itself.** It prints `paused: usage limit until 14:05 (in 2 h 10 min). Ctrl-C stops; mirai resume continues later`, waits with `caffeinate`, then continues where it was (the cut launch doesn't use up a round; built in unit 20). A weekly limit stops the run. **Every limit is configurable** (Jet: "make sure that these limits are configurable"):

   | Setting | Where | What | Default |
   |---|---|---|---|
   | `usage.night_max`, `usage.week_max`, `usage.reserve` | personal global (exists) | how much of your subscription MIRAI may use, and leaves for you | 15 / 60 / 40 |
   | `loop.rounds`, `loop.rounds_high_risk` | project (exists) | fix rounds per ticket | 2 / 3 |
   | `loop.ticket_turns`, `loop.ticket_tokens`, `loop.ticket_minutes` | project (exists) | per-ticket spending caps | none |
   | `loop.breaker` | project (exists, wired in now) | environment faults in a row before the run stops | 3 |
   | `run.stop_by` | project or personal (exists) | a clock time after which a paused run stops instead of waiting | none |
   | **`run.on_limit`** | project or personal (new) | at the 5-hour limit: `"wait"` or `"stop"` | `"wait"` |
   | **`run.max_wait_minutes`** | project or personal (new) | the longest a run waits for a reset; past it, it stops for `mirai resume` | 300 |
   | **`usage.stale_hours`** | personal global (new; fixed at 12 today) | how old a usage reading may be before the short Haiku check refreshes it | 12 |

6. **`mirai resume` continues your last run.** It shows what was in progress, what's parked and why, and what waits for you. After a crash, it resets a half-finished step to that step's checkpoint and starts the step again. **It never resets round counters or budgets.** `mirai run <other ticket>` refuses while a stopped run is unfinished, and says to resume it or `mirai resume --abandon` it.
7. **`mirai show <ticket>`** prints the ticket's page, read from the store and never committed:

   ```
   SAMPLE-1: A user deletes one of their tasks          built · MR !2 https://…/merge_requests/2
     branch feature/SAMPLE-1-…  at 3f2a91c · proofs valid at head · normal risk

   Plan       round 1, approved by you 2026-11-12 10:41 (k-eea7…)
   Build      handed over 10:58 · Kai 23 turns, 6.1 min · tests: unit fail → pass, rest pass
   Review 1   CHANGES · Rex 9 turns · 1 blocking, 2 follow-ups
     F1 blocking  app/Policies/TaskPolicy.php:14  delete() compares ids as strings …
   Fix 1      fixed F1 · 11:20 · tests pass
   Review 2   PASS · follow-ups: N1 (a comment could say why)
   Proofs     review + gate, signed 11:31, baseline 9528664
   Ship       opened 11:32, unchanged since
   Rounds     1 of 2 used · re-plans 0 of 1
   Usage      41 turns · 1.2 M tokens · 19 min
   Parked     —   (or: why, the evidence, and the exact unpark command)
   QA         not yet (unit 51)
   ```

   By default, one line per step and every blocking finding with its file:line. `--full` adds every finding's text, the plan, and the parking notes in full. `--json` is for scripts.

**The standing rule (Jet, 2026-11-12; "for every command in the past and in the future"):** every MIRAI command also runs from your coding agent's session as `/mirai <command>` (Claude Code now; Codex and Cursor with their adapters, rows 71 and 73), except the gates agreed in 21f. In a session, a gate prints the exact terminal command and runs nothing, because it needs your key and your typed confirmation. **Every unit's spec puts each new command on the session list, or names it as a gate with the reason.** It goes into the roadmap's rules, beside 21f's row. For this unit:

- **On the list:** `run`, `resume`, `show`, and `ship` (missing so far; it signs nothing).
- **Gates:** `gate record` (signs with your key until 29b; the run's stop in decision 2 names it).
- **The `/mirai` file:** names the new commands and flags (`--full`, `--abandon`, `--json`). For `run` and `resume` it keeps showing progress past today's 30-minute limit. When you stop following, it says `/mirai show <ticket>` or `/mirai status` picks it up again. When the run stops at a gate, it shows the terminal command word for word.

## Defaults taken with the decisions (not asked; say if you want them otherwise)

- **The step order** is read from the ticket's state each time, never from memory:

  | The ticket | The next step |
  |---|---|
  | `ready-for-dev` (also after a rejected plan or a re-plan) | plan, then stop at the gate |
  | `in-progress`, plan waiting for you | stop: the `approve --plan` command |
  | `in-progress`, plan approved, no build yet | build |
  | `in-progress` after failing checks or review changes | fix rounds |
  | `in-review`, no passing review of this commit | review |
  | `in-review`, review passed, no proofs at the head | proofs (your terminal) or stop (session) |
  | `in-review`, proofs valid at the head | ship |
  | `built` (an MR with valid proofs at its head) | nothing: prints the MR and stops `finished` |
  | `blocked` | stop: the parking note and the unpark command |
  | `draft`, `dropped`, `done`, `waiting` | refused, with why |

- **The ticket's branch** is made by the build step, as `mirai build` makes it today (units 21b, 22): from the integration branch's commit, named by `[git] branch_pattern` (default `feature/{ticket}-{slug}`; `{ticket}` required, `{slug}` optional), its signed record its first commit. A later run reuses it only when its record verifies and every commit on it is MIRAI's. No new placeholder (Jet, 2026-11-12: `{type}` not needed).
- **What stops the run, and how:** a gate (plan approval, or proofs from the session), a park, `needs-you` (a protected path, a step MIRAI can't judge), the breaker, a weekly limit, a wait longer than `run.max_wait_minutes` or past `run.stop_by`, Ctrl-C, and the MR. Each ends with **one line naming what to do next**, ending in the exact command. The run state is `stopped` (resumable) or `finished`. A `run_finished` line goes into the run log.
- **One lock for the whole run:** the step functions get an optional `run` (the store, the run id and the run's own heartbeat). With it they skip their own `withRun` and launch with `launchInRun`. Without it they behave exactly as today, so `mirai plan` and the other commands are unchanged.
- **Where the run starts:** on the integration branch with a clean tree, or on the ticket's own branch. Anywhere else, it refuses and names the branch to switch to. After the MR, the run switches back to the integration branch, as the design has it. On any other stop it stays where it is, and the last line says which branch you're on.
- **Your terminal is supervised,** as are the session's requests: `needs-you` stops the run and leaves the ticket as it is. Nothing parks for "you weren't there", because you are.
- **`caffeinate`:** the run starts `/usr/bin/caffeinate -i -w <its pid>`, so the Mac doesn't sleep and caffeinate ends with the run, even after a crash.
- **The usage probe:** before the first launch, if `usageCheck` answers `probe`, one Haiku launch with no tools and one turn reads your usage. Your decision 1A in unit 20.
- **The breaker:** each launch's environment fault counts (`recordFault`), a good launch resets it, and `loop.breaker` in a row stops the run.
- **The progress summary:** each `agent_run` line in the run log gets a `progress` summary (the tools used and how often, the turns and the minutes), never each tool call (21e's note).
- **The checkout lock:** a session refuses to start while a run holds the checkout, and the reverse (D-06 point 5). The run lock already covers MIRAI's own commands. A Claude Code session of yours isn't stopped. `mirai status` shows the run.
- **`resume` is your move:** `stopped → running` is marked as yours in the run machine. From your terminal it's signed with your key. From the session, the store confirms your request, as 21f does for `plan` and `build`. The journal says which.

## Scope

**In.**

1. **`src/run/drive.js`:** `driveTicket({ cwd, env, ticket, via, signal, onEvent })`, the state table above, one lock, the stops.
2. **`src/run/pause.js`:** the usage limit wait (heartbeat while waiting, Ctrl-C), the probe launch, the breaker.
3. **The step functions** (`src/agent/plan.js`, `build.js`, `fix.js`, `review.js`, `src/proofs/record.js`, `src/ship/ship.js`): the optional `run`, and a progress summary on `agent_run`.
4. **`src/baseline/record.js`:** the flaky carry-over and the "newly flaky" message.
5. **Commands:** `mirai run <ticket>`, `mirai resume [--abandon]`, `mirai show <ticket> [--full | --json]`, in `src/cli/commands/` and the command list. On the session list: `run`, `resume`, `show`, `ship`. `gate record` is a gate.
6. **`src/store/run.js`:** the signed (or request-confirmed) `stopped → running` move. `src/status/machines.js` is unchanged (the moves exist).
7. **Config:** `run.on_limit`, `run.max_wait_minutes`, `usage.stale_hours`, and `loop.breaker` read where it applies.
8. **Docs:** a new `docs/run.md` (the commands, the order, the stops, the limits, the session); `docs/agents.md`'s automatic approval line; `docs/test-baseline.md` (the carry-over); `docs/loop-rules.md` (the pause, the breaker); design/01 §14 and design/03's orchestrator row ("Update (unit 28)"); roadmap rows 28 (built), 55 (automatic plan approval, with 29b), and the standing rule beside row 21f.

**Out.**

- **Several tickets in one run, the queue, `--plan`, overnight:** unit 55. **Automatic plan approval:** 55, with 29b.
- **QA** (unit 51), E2E written by the agent (its unit), the inbox (46), environment faults beyond the breaker (52), stacking (53).
- **Noticing a merge or a close on the host** (unit 56). The run stops at the MR. A merged MR shows in `show` once 56 notices it.

## Probes (with your OK)

- **R1, one ticket end to end on a sample-app clone** (about 40 minutes; Sonnet plans and reviews, Kai builds, as the earlier checkpoints). On a throwaway base branch of your GitHub sample app, with a stand-in key in the clone, as 27a's P1:
  1. `mirai run SAMPLE-1` plans and stops at the gate, naming `approve --plan`.
  2. The approval, then `mirai run SAMPLE-1` builds, reviews, signs the proofs and opens one MR.
  3. `mirai run SAMPLE-1` again says `built`, prints the MR, and changes nothing.
  4. `mirai show SAMPLE-1` prints the page above.
  5. Cleanup: the MR closed, the branches deleted.
- **R2, a killed run resumes without new rounds** (about 15 minutes, on the same kind of clone): the probe kills the run mid-build (`SIGKILL` of the whole process group). Then:
  - `mirai status` shows the run as dead and its lock as stale;
  - `mirai resume` takes over, resets the build to its checkpoint, and builds again;
  - `rounds_used` and `replans` are the same before and after.
- **By hand, at the end (you):** in a Claude Code session in the sample app, `/mirai run SAMPLE-2` plans and stops at the gate. After your approval in the terminal, `/mirai run SAMPLE-2` stops before the proofs with the `gate record` command, and `/mirai show SAMPLE-2` prints its page.

## Files

- **New:** `src/run/drive.js`, `src/run/pause.js`, `src/run/show.js`, `src/cli/commands/run.js`, `resume.js`, `show.js`, `docs/run.md`; `test/run/*.test.js`; `test/probes/run-probes.js`.
- **Changed:** the step functions (above), `src/store/run.js`, `src/baseline/record.js`, `src/loop/ledger.js` (`usage.stale_hours`), `src/mcp/tools/commands.js` (the list and the gate), `src/adapters/claude-code.js` (the `/mirai` file), `src/config/config-schema.js`, `src/cli/commands/index.js`, docs.

## Tests (`npm test`, no model, no network; stand-in `claude` and host as before)

- **The order:** from each ticket state in the table, the run takes the right next step; `draft`, `dropped`, `done` and `waiting` are refused.
- **The plan gate:** `run` stops at it under `supervised`, and under `plan = "auto"` with the unit 55 message; it never approves.
- **One ticket to the MR** (stand-ins): plan, approval (the fixture key), `run`, then build → review `changes` → fix → review `pass` → proofs → MR. One lock for all of it; the run state `finished`; `run_finished` in the log; back on the integration branch.
- **From the session:** a request-confirmed `run` stops before the proofs with the `gate record` line; `gate record` from the session answers with its terminal command; `run`, `resume`, `show` and `ship` are on the list.
- **Stops:** a park, `needs-you`, a closed MR, the breaker after `loop.breaker` faults (a good launch in between resets it), Ctrl-C. Each ends `stopped` with its one next-step line, and the ticket is left as the step left it.
- **Limits:** a 5-hour `usage-limit` pauses until `resets_at` and then relaunches the same step, without a round used (a fake clock); `run.on_limit = "stop"` stops; a wait longer than `run.max_wait_minutes` or past `run.stop_by` stops; a weekly limit stops; the probe launch when the reading is older than `usage.stale_hours`; each setting refused when out of range.
- **The baseline:** reused when the commit has one; recorded when it doesn't; a new failure → `baseline-grew`, and the run stops; a flaky test from the previous baseline carried over and not growth; a new flaky one → growth, with the "newly flaky" message.
- **Resume:** after a killed run (a stale lock, a dead pid, the state still `running`), `resume` takes over, resets the half-finished step to its checkpoint, and re-runs it; `rounds_used`, `replans` and the budgets are unchanged; a dirty tree from a refused launch (19b) is refused, not relaunched; `--abandon` ends the run as `stopped` for good; `run` on another ticket refuses while a stopped run is open.
- **Show:** the page's lines from a fixture store (every step, a park, a dispute); `--full`, `--json`; read-only (the store unchanged after).
- **`caffeinate`:** started with the run's pid, gone after (a stand-in at `/usr/bin/caffeinate`'s place, through the same path check as other host tools).
- **The other commands are unchanged:** `plan`, `build`, `fix`, `review`, `gate record` and `ship` alone still pass their own tests.

## Done when

- The tests pass. R1 and R2 are recorded in `test-results.md`. After the sample app's refresh, the red team is green and the baseline signed. For the row: one sample-app ticket goes to an MR stopping only at the plan gate; a killed run resumes without new rounds; `mirai show` prints the ticket's results.

## What you'll do by hand (when we get there; exact commands then)

1. Run R1 and R2 in the Terminal app. They approve the plan and sign the proofs with the probe's own key in its own MIRAI home, as the earlier probes do, never yours.
2. The session check at the end (above). That's the one time you approve for real (`mirai approve SAMPLE-2 --plan` in your terminal).
3. The sample-app refresh, the red team and the baseline, as for every unit.

## Open points for you

The seven decisions and the standing rule are taken (above), and the defaults are named. Approve the spec, or say which default to change.

## Changes during the build (2026-11-12)

1. **One lock for the run:** the steps take an optional `run` and use `inRun` (src/agent/run.js), which uses the outer run's lock and leaves the run state to it, or takes a run of its own as before. Alone, `plan`, `build`, `fix` and `review` are unchanged: their 81 tests pass as they were.
2. **The fix round's start is shared:** `fixFrom` (src/agent/fix.js) answers "where would a fix round start", for `mirai fix` and the run alike.
3. **In review, the order is proofs first:** minting the proofs adds a records-only commit, so after it the review's commit is behind the head. The run asks: valid proofs at the head → ship; a passed, complete review on this branch → proofs (which refuse a review whose code changed, `review-stale`); else review.
4. **An environment fault runs the step again;** the breaker (`loop.breaker`, 3) stops the run after that many in a row, and a good launch resets it. A fault doesn't stop the run on its own.
5. **After a crash with uncommitted changes, `resume` names `mirai discard` first.** Resetting a half-finished step throws work away, and `discard` is a gate (your typed key), so it stays one: the run refuses a dirty tree and says so. A crash between steps (a clean tree) resumes at once. R2 shows which.
6. **`resume` is signed:** a new journal event `run_resumed` (your key from the terminal; from the session MIRAI's line with the request id), written with the stopped → running move in one step (`resumeRun`, src/store/run.js). `--abandon` writes the same event with `abandon: true`, and the run stays stopped, given up.
7. **The per-launch progress summary** is `tool_calls` on the `agent_run` line: each tool and how often (a tool outside the launch's list counts as `other`), never each call.
8. **The session list, by the standing rule:** besides `run`, `resume`, `show` and `ship`, five read-only or draft-writing commands joined it (`config check`, `config show`, `protected`, `trust check`, `detect`). `NOT_FROM_SESSION` names the rest with the reason (`agent`, `hook`, `log`, `session` have session tools of their own; `init`, `render` and `trust snapshot` stay terminal-only, 21f). A test holds every CLI command to the list, the gates, or that.
9. **The session worker's time limit for `run` and `resume` is 600 minutes** (other agent commands keep 240): a run can wait up to `run.max_wait_minutes` for a usage limit.
10. **From the probes:** the usage check launches on the light step (`report-summary`) instead of asking for a lower tier, which 19b's rule refuses (R1's first run). A crashed run taken over keeps its ticket, so `mirai resume` continues it after the dirty-tree refusal and `mirai discard` (found before R2's third run, by reading the path; a test holds it). A refused step (such as no `origin`) ends the run with exit 4, as every MIRAI refusal; `docs/run.md` says so.
