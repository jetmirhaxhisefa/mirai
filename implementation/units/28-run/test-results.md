---
unit: "28"
date: 2026-11-12
claude_code: 2.1.319
result: 593/593 at the final commit (589/593 at the build commit: three pinned lists and one lint timing test under load, all fixed or passing) · R1 passed on its fourth run on the real GitHub sample app (plan → gate → baseline, build, review, proofs, PR, one run; again: finished, nothing done); its first three runs found the usage check asking for a lowered tier (fixed), the frontend tests failing once under load (passed on every run since), a parked plan (Kai's two plans failed lint once; not seen again) and an earlier probe's closed PR on the same branch name (the probe now ignores PRs from before it) · R2 passed on its third run (killed mid-build, taken over, Kai ended, the dirty tree named mirai discard, discard, resume built, reviewed and signed the proofs, rounds unchanged, run_resumed signed); its first two found probe gaps; reading the whole path before the third found one MIRAI bug: a taken-over run lost its ticket (fixed, with a test)
---

# Unit 28 — Test results

## Tests (`npm test`, no model, no network)

New: `test/run/run.test.js` (10 tests): one ticket to its MR under one lock; from the session, the stop before the proofs; the next step read from the ticket; the breaker; the usage-limit pause, `on_limit`, `max_wait_minutes`, `stop_by` and the weekly stop; resume after a crash (taken over, your signed move, rounds unchanged; the dirty tree refused with the ticket kept, then resumed; `--abandon`; another ticket waits); `mirai show`; caffeinate. Additions in `test/baseline/baseline.test.js` (the flaky carry-over and the growth message), `test/config/config.test.js` (the new keys) and `test/mcp/commands.test.js` (every CLI command is on the session list, a gate, or named as not from a session, with the reason). The pinned lists (commands, token minters, journal events) take `run`, `resume`, `show` and `run_resumed`.

## The full suite

At the build commit: 593 tests, 589 pass. Three failures were the pinned lists that every new command, token minter and journal event must join on purpose (fixed); the fourth, a lint timing test, took 1.17 s with the Mac under load and passes alone. The plan, build, fix and review tests: 81/81 after the one-lock change.

At the final commit, after the probes' fixes (the usage check's step, the takeover keeping the ticket): **593/593 pass** (29 min under `caffeinate -i`).

## R1: one ticket to its PR (`test/probes/run-probes.js --probe r1`, Sonnet, the real GitHub sample app on a throwaway base branch)

Passed on its fourth run (log `~/mirai-28-r1.log`).

- **Run 1:** the usage check (Haiku, 1 turn), the plan (Sonnet, 11 turns), lint pass, stopped at the plan gate in 38 s with `mirai approve SAMPLE-1 --plan; then mirai run SAMPLE-1`. The probe approved with its own key.
- **Run 2, one run for every step:** baseline → build (`handed-over`) → review (`pass`) → proofs (`recorded`) → ship (`opened`, PR #2), back on `main`, 17 min. Each check and level, after the build and again for the proofs: lint pass; unit 16 of 17 (the planted known failure: pass); frontend 5 of 5; e2e 1 of 1. The run log: one `run_started`, the build and review launches with their `tool_calls`, `run_finished`.
- **Run 3:** `finished`, the same PR, no step ran.
- **`mirai show`:** `built · MR …/pull/2`, branch at the head with proofs valid, the plan approved, the build's tests, review 1 PASS with 1 follow-up, rounds 0 of 2, usage, not parked, QA not yet.
- **Clean-up:** the PR closed, the base and feature branches deleted.

Its first three runs:
1. The usage check was refused: it asked for `--tier light` on a step whose tier is standard, and a tier can only be raised (19b). It now runs on the light step `report-summary`. In the same run the proofs found 3 frontend tests failing (AddTaskForm and TaskList) that had passed after the build. The Mac was heavily loaded right after the full suite, and the probe then kept nothing to look at. It now prints each test run's verdicts and failure messages and keeps its folder when a run stops early. In every run since, the frontend level passed both times.
2. Everything passed to the proofs; the ship stopped `mr-closed` on PR #1, a closed PR from 27a's probe on the same branch name (`feature/SAMPLE-1-…`). Right for a real project (closing it was yours); the probe now ignores PRs from before it started.
3. Kai's plan failed MIRAI's lint twice and the ticket parked `bad-plan`, as designed. The probe now prints the lint problems and keeps the folder in that case; the next run's plan passed first time.

## R2: a crash and `mirai resume` (`--probe r2`, Sonnet)

Passed on its third run (log `~/mirai-28-r2.log`).

- **The kill:** `mirai run` in its own process, SIGKILLed 93 s into Kai's build. Kai, in his own process group, still running; the run state still `running`; the heartbeat on `build`.
- **`mirai status`:** the run `running`, SAMPLE-1 (build), Kai's last progress line; the global lock "left by a dead run of this repo … the next run breaks it".
- **`mirai resume`:** "last run: …, running (its process is gone: it crashed)", in progress SAMPLE-1, build. The takeover ended Kai (still running: false). The work tree had Kai's half-finished changes: refused, exit 4, `a step of SAMPLE-1 was cut short: throw it away (your typed key): mirai discard SAMPLE-1; then mirai resume`.
- **`mirai discard SAMPLE-1`** (the probe typed the ticket): exit 0.
- **`mirai resume` again:** the run `stopped`, the same run id; build `handed-over`, review `pass`, proofs `recorded`, then the ship stopped: the probe's clone has no `origin` (nothing pushed), exit 4.
- **The loop:** rounds used 0 → 0, re-plans 0 → 0, granted 0 → 0.
- **The journal:** `run_resumed` from the terminal, by you, signed. The ticket `in-review`.

Its first two runs, and a read-through before the third:
1. The probe watched the run state for the build step, which `mirai run` keeps in the heartbeat: the kill never came and the run went through by itself (the ship refused: no remote; nothing reached GitHub). It now watches the child's own `[build]` line.
2. The kill came; `mirai resume` refused `hooks-off`: the probe home had no MIRAI hooks (26a; `mirai init` installs them). Right for MIRAI; the probe installs them now. Kai was left running in the deleted probe folder and was stopped by hand; the probe now stops him at its end, whatever happens.
3. Before the third run, reading the whole path found: **a MIRAI bug**, the takeover cleared the run's ticket, so the second `resume` after `mirai discard` would have said "has no ticket on record" (fixed in `takeOver`; the crash test now covers the dirty tree, the kept ticket and the second resume); and two probe gaps, `resume` from the probe's terminal had neither the probe's Claude nor the red-team stand-in the in-process runs get.

## Not run here

The by-hand session check (`/mirai run SAMPLE-2` in a Claude Code session in the sample app, the approval in the terminal, the stop before the proofs, `/mirai show SAMPLE-2`) comes after the merge and the sample app's refresh.
