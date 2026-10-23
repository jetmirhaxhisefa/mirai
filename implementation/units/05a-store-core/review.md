---
unit: "05a"
date: 2026-10-23
reviewers: Tech Lead, Architect (independent, read-only)
verdicts: NOT READY (before fixes), NOT READY (before fixes); all blocking and should-fix findings applied
---

# Unit 05a — Review

Both reviewers confirmed:
- **D-06 ordering:** file order equals `seq` order. A status file and its `status_written`
  event share one number under one lock. A crash leaves a gap, never a duplicate.
- **D-47 and D-57:**
  - the store is outside the checkout (checked on real paths), with no `MIRAI_HOME` override;
  - folders are 0700 and never symbolic links; files are 0600 and opened with `O_NOFOLLOW`;
  - credentials never reach `store.json`;
  - nothing is written into the project.
- **D-21:** status migrations run in memory only.
- **The known deviations from the spec text are right:**
  - a torn tail is cut off, not healed with a newline;
  - the short-lock wait is 30 s and T5 is 8 × 25;
  - `mirai status` exits 4 when a ticket's facts can't be derived.

Both found the same **blocking concurrency bug** (1), and the Architect found a **blocking gap at
the trust boundary** (2). All findings marked blocking or should-fix are applied, plus most nits.

## Applied in unit 05a

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **Blocking: false "not a readable lock" under contention.** A new lock file is briefly empty between create and write; a waiter's 1-second timer never reset, so normal contention ended in `bad-lock` with a `doctor` hint. T5 failed most runs on the reviewers' machines | both | The lock content appears in one step: a private temp file, hard-linked into place (`link` fails with EEXIST like `O_EXCL`). Only the *same* unreadable content for over 1 s counts as damaged. A holder without a numeric `pid` is unreadable, not dead | T5, T8 (3 clean full runs) |
| 2 | **Blocking: the store's location depended on project-controlled input.** An edited `integration_branch` (any branch can change it), a renamed remote, or a merged unrelated history gave "not set up, run `mirai init`"; following the hint would create a fresh store and reset rounds and parking (the cheat D-47 prevents). A remote-less checkout lost its store when the folder was renamed | Architect | Before "no store", MIRAI looks for a store recording this checkout's path, or sharing a root with a checkout that no longer exists, and refuses with `identity-changed` (exit 4, a `doctor` hint, "don't run `mirai init`"). `createStore` refuses the same. The readable name comes from the remote only (`local` without one), never from the folder. A fork checked out elsewhere isn't affected | T1, T1b |
| 3 | `mr_merged` couldn't say which epic, so an epic-merged ticket stayed `integrated` forever | both | `epic` is required when `target` is `epic` (and only then); `epicMerged` comes from the journal alone | T10 |
| 4 | `ticketFacts` didn't match the spec: an `mr_opened` counted as a push | Tech Lead | `pushSeq` is the latest `pushed`; an MR opened with no logged push counts its opening. "A merge always wins, integration over epic" (D-06) is now written in the code and the spec, and tested | T10 |
| 5 | Unsigned `by: "human"` and `unverified` privileged events were accepted on read; an `unverified` `mr_merged` would derive `done` (D-17) | Architect | Privileged types must be `by: script`, written and read; `human` is refused until unit 06 signs it | T10 |
| 6 | `mirai config check` broke for valid repos: a relative remote, a broken `%` escape (an uncaught crash), no git | both | Any failure to work out the repo's identity means "no per-repo personal file". Local and relative remotes are kept as `local:<path>`; a bad escape is a clear `bad-remote` | T1, T17 |
| 7 | `store/config.user.toml` was read like a dotfile (symlinks followed, no owner or mode check) | Architect | It gets the store's checks: real, yours, 0600 | T17 |
| 8 | A ticket folder swapped for a symbolic link was followed by `mirai status <ticket>` | both | `readTicketStatus` checks the folder | T9 |
| 9 | macOS folders ignore case: `proj-1` overwrote `PROJ-1`'s status and left the store unreadable | Architect | A key whose folder exists in another case is refused (`case-clash`, exit 4); reads match the exact case | T9 |
| 10 | `writeTicketStatus` had no compare-and-swap, and could write a state the journal's facts make unreadable | Architect | `expectSeq` is checked under the lock (`stale-write`, exit 4); the new status is derived against the journal before it's written | T9 |
| 11 | The moved-checkout update was unordered and unlocked: an event could be lost, or written twice | both | The counter is checked first; the path and its event are written under the journal lock, only by the first process that sees the move | T4 |
| 12 | An unrelated folder at the old path meant a permanent "second checkout" | Architect | A second checkout is a git work tree at that path sharing a root; anything else is a move | T4 |
| 13 | The torn fragment vanished without a trace | Tech Lead | It's kept in `<file>.torn` (0600) for `doctor` | T6 |
| 14 | `openStore` parsed the whole journal just to check the counter | Architect | The counter check reads only the journal's last line; `mirai status` builds all ticket facts in one pass | — |
| 15 | Locks weren't re-entrant: `appendEvent` inside `withSeq` waited 30 s on itself | Architect | Refused at once ("not re-entrant") | T8 |
| 16 | A held short lock was exit 3 (CONFIG) | Architect | Exit 4 (`BLOCKED`), like the other refusals | T8 |
| 17 | `mirai status T-404` printed a made-up `draft` and exited 0; journal-only tickets said "written" | Tech Lead | An unknown ticket is a usage error; a ticket with no status file says "no status file yet" | T16 |
| 18 | Paths in error messages (from `store.json`, from `HOME`) reached the terminal raw; `escapeInvisible` missed U+061C, U+00AD and tag characters | Tech Lead | `formatError` escapes control and invisible characters in every message and hint; the character list is extended | T16 |
| 19 | Unknown event types looked like corruption | Architect | A distinct `unknown-event` code with an "update MIRAI" hint | T10 |
| 20 | `refs/replace` could change the roots; `git remote` wasn't in the spec's list; `rev-list` could time out on big repos; GitHub remote case and `:22` changed the id | both | `--no-replace-objects`; remotes via `config --get-regexp`; 60 s for `rev-list`; GitHub paths lowercased, ssh port 22 dropped | T1 |
| 21 | Small robustness gaps: a caller's `schema_version` overrode the file's; missing `locks/` or `tickets/` gave raw errors; `createStore` had a check-then-create race | Tech Lead | Fixed in place | T3, T9 |
| 22 | T8 didn't prove "broken once"; T5 could pass with writers running one after another | Tech Lead | Workers report each break: exactly one; T5 asserts the writers interleave | T5, T8 |

## Notes for later units

| Unit | Note |
|---|---|
| 05b | `checkCounter` must also read the newest run log's last line, since run logs share the counter. A run-log line plus a journal event in one step needs one `withSeq` that takes several numbers (locks aren't re-entrant) |
| 06 | Signed `human` lines: the read side refuses them until signatures are verified. Adding an event type: bump `JOURNAL_SCHEMA_VERSION`, so an older MIRAI says "newer MIRAI", not `unknown-event` |
| 10 | `mirai init` calls `createStore`, which already refuses `identity-changed` |
| 22 | Pinned host git (D-54): `git.js` still runs the first `git` on `PATH` |
| 26, 28 | Hooks and the orchestrator should pass the repo id they were installed with and have `openStore` check it, instead of computing it from the work tree |
| 28, 06 | `writeTicketStatus` checks `expectSeq` and readability; the move rules (unit 04's `move()`) stay with the callers |
| 29 | `doctor` needs a "find without verifying" open, because `openStore` refuses exactly what doctor repairs (counter behind, corrupt line, `identity-changed`), plus journal rotation before the 64 MB read limit. Measured: 100k events and 1,000 tickets take about 3.5 s for `mirai status --json` before the one-pass fix |
