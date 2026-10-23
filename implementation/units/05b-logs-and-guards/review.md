---
unit: "05b"
date: 2026-10-23
reviewers: Tech Lead, Architect (independent, read-only)
verdicts: APPROVE WITH SHOULD-FIXES (Tech Lead), CHANGES REQUESTED (Architect); all applied, schema questions decided by you
---

# Unit 05b — Review

Both reviewers confirmed:
- **One lock for each step:** a single journal lock covers all of `withSeq`. The run lock never
  waits, and breaks a dead holder only under 05a's breaker. The ledger has its own lock.
- **Security:** no project- or agent-controlled input reaches the global folder, the ledger, the
  run lock or the registry. Every path comes from `HOME` and a checked repo id, and the global
  folder is 0700/0600.
- **Lock records:** `extra` can't override `pid`, `host` or `purpose`.
- **`mirai log`** is an allowlist, safe against `__proto__`/`constructor`, and writes nothing
  into the project.
- **D-58:** the run log carries `step`, `tier` and `model`, enough for units 19, 29 and 56 to
  show the model used for judgement steps.

The Architect found **one blocking bug** (1). Both found the same `withSeq` hole (2). Four
schema questions went to you, and all were decided on 2026-10-23 (14–17).

## Applied in unit 05b

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **Blocking: `startRun({ stopBy: "07:00" })` wrote a `state.json` its own reader rejects**, which bricks the store; "07:00" is the config's own `run.stop_by` format | Architect | `stopBy` must be a UTC time, checked before anything is written; `writeHeartbeat` checks its ticket and step too | T12 |
| 2 | `withSeq` accepted numbers never taken, used twice or out of order; one such line made the journal unreadable, or the counter "behind" | both | Refused before writing: a number must be taken in that step, used once, and above the last one written to the same file | T18 |
| 3 | A run couldn't record its position while running (there's no `running → running` move); a resume without repeating the ticket wiped it, and `mirai status` almost never showed the live ticket | both | `recordProgress`; moves keep the ticket and step unless `clear: true`; status takes them from the heartbeat when it belongs to the run | T12, T20 |
| 4 | The global run lock wasn't tied to the run: `startRun` worked with no lock held | Architect | `beginRun` takes the lock, then starts the run with the same id, and releases the lock if the start fails | T14 |
| 5 | A run that couldn't log breaking a dead lock kept the lock (and the in-process "held" mark) | both | Released before the error is raised | T14 |
| 6 | `pushScope` kept only the first reason (unit 26 needs "registered" together with "has the trailer"), and ignored `creation_sha`, so a stale entry captured a later human branch with the same name | Architect | Returns `reasons`, `registered` and `entries`; takes an optional `isAncestor(sha)`; a lost index blocks on any MIRAI sign | T13 |
| 7 | `usageSince` read a bad date as "no usage", which fails open for the caps | Tech Lead | A TypeError | T14 |
| 8 | `mirai log` with multi-byte text over 16 KB exited 1 and used up a number | Tech Lead | The whole line is checked in bytes before a number is taken (`checkEvent`); `mirai log` turns it into a usage error | T15 |
| 9 | Bad run lines used up numbers; T11's "takes no number" check was empty (it never called `take()`) | Tech Lead | `startRun` and `writeRunState` check their line before `take()`; the test goes through `startRun` | T11 |
| 10 | The order of a run-log line and `state.json` wasn't stated, and a crash between them went unnoticed | Tech Lead | Documented (log first: it stays a superset); `runStateMatchesLog` detects the gap for `resume` and `doctor` | T12 |
| 11 | A damaged heartbeat made `mirai status` fail; a heartbeat from the future never went stale | Tech Lead | Shown as "unreadable (run: mirai doctor)"; more than a minute ahead counts as stale | T12 |
| 12 | Three plan-name limits (no limit, 64, 32): a long plan passed the config and failed mid-run in the ledger | both | One pattern, at most 32 characters, in the config schema | T11 |
| 13 | Small gaps: a finding's `file` allowed `..`; `readUsage` checked less than `appendUsage` writes; unhelpful run-lock refusals (damaged lock, a dead lock being cleared); `startRun`'s "resume it" hint pointed nowhere; the spec's file list was stale | both | Fixed in place | T11, T14 |
| 14 | **Your decision:** `tdd` as the setting or as what was applied (the reviewers disagreed) | both | Both: `tdd` and `tdd_applied`, plus `tests_policy` (D-23) | T11 |
| 15 | **Your decision:** the launch line lacked `round`, `rung` (D-14), cost, a launch id, and an honest "unknown" share (D-38) | both | Renamed `agent_run`, with these fields; `limit_share` is left out exactly when its source is `unknown` | T11 |
| 16 | **Your decision:** findings lacked D-46's kept data | Architect | `round`, `category`, `line`, `basis_ref`, `downgraded`; a `finding_outcome` event | T11 |
| 17 | **Your decision:** the ledger under-counted between tickets, lost a crashed run's remainder, and could count a ticket twice on resume | Architect | Every line is a delta; run overhead is written at each ticket boundary; lines carry `ticket` and `upto_seq`, and a line already covered is skipped | T14 |

**Approved as built:** the run log in its own file (no import cycle); `pushScope` returning a
decision instead of throwing; `startRun` refusing while the last run is running or paused.
Starting over a `stopped` run gives that run up; unit 28 should say so when it happens.

## Notes for later units

| Unit | Note |
|---|---|
| 06 | A signed `mirai resume` (stopped → running) needs `by: human` on `run_state`, or a pointer to the signed journal event's seq. `withSeq` can write both in one step |
| 19 | Write `agent_run` when a launch ends, with `limit_share_source`; log the verifier `rung` |
| 20 | D-57's `reserve` ("whatever used it") needs the real weekly usage (G4), not only MIRAI's ledger. The counters "saved before each launch" need a named file in the store |
| 26 | Pass `isAncestor` (from the pinned git) to `pushScope`; use `registered` for "a registered branch with a trailer-less commit is blocked" |
| 28 | Begin runs with `beginRun`; call `recordProgress` at each step; write ledger deltas at each ticket boundary; on resume, use `runStateMatchesLog` and rebuild the ledger from the run log (`upto_seq` keeps it from counting twice); warn when a new run gives up a stopped one |
| 29 | `doctor`: repair `state.json` from the run log; check that `~` itself isn't a git work tree (the home would be inside one); show `finding.file` through `shown()` |
| D-46 | `mirai clean` must keep the run logs' structured lines (the metrics home) or export them to `metrics/` first |
| — | PID reuse after a reboot can make a stale lock look alive (05a too): compare the recorded `started_at` with the process start time |
