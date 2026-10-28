---
unit: "14d"
date: 2026-10-28
reviewers: Tech Lead, Architect (independent, read-only, no network, no Docker, no model)
verdicts: Tech Lead "approvable after fixes" (three Medium); Architect "approvable after fixes" (three Medium); every Medium and Low fixed and tested, the direct probes re-run on the fixes; notes recorded in the spec
---

# Unit 14d — Review

Both reviewers worked on a frozen tree. They made no network calls, ran no Docker and no
`claude`, read no secrets and changed nothing in the repo. The Tech Lead ran
`test/mcp/server.test.js` (8/8), `test/launch/strict.test.js` (12/12) and
`test/tests/test-run.test.js` (15/15), plus one small reproduction in its own folder under
`/private/tmp` (removed). The Architect ran the first two (20/20).

**What held up:**
- **Arguments:**
  - names come only from the enum;
  - extra keys are refused, `__proto__` included;
  - the path is ASCII with no leading `-` or `/` and no empty, `.` or `..` parts, checked again
    in the copy (no links, must exist), and passed after `--`;
  - `run_check` takes no path;
  - a `tools/call` sent as a notification runs nothing.
- **Agent runs are never signed:** `by` is fixed by the server, signing needs `gate` with
  `by === 'you'`, and `verifyTestResult` refuses anything else. The signature covers the whole
  result with a per-repo context. The tamper, other-repo and other-key cases are tested.
- **Concurrency:** `current` is set before the first await, so two calls can't both run. A
  cancel matches the right request id, and cleanup runs without the signal.
- **Abort:** the whole process group is killed, with a 2 s grace, and `rm -f` and `down -v` still
  run.
- **Message limits** are counted as data arrives.
- **The policy** is checked against the hash on the command line. The executor's env is only the
  policy's HOME. Trust is verified against the launch's manifest and never re-resolved.
- **Locks** are released in `finally`, stale holders broken by pid.
- **The trust boundary for a server outside the sandbox (M4)** is argued and enforced (Architect):
  code from the trust root by absolute path, the read-only policy with its hash, the trust root
  re-checked on every call, and D-54's sticky stop.
- **Fits:** `max_parallel` as a personal machine setting fits "personal data not in repo".
  Nothing stack-specific is in the defaults.
- **Deviations judged sound:**
  - the signing context `mirai/test-result/1:<repoId>`;
  - signing the whole result;
  - the path form checked in `callArgs`;
  - `server/discover` answered with method-not-found;
  - Ctrl-C through an AbortController;
  - one Haiku end-to-end run.

## Fixed in unit 14d

| # | Finding | Severity, from | Fix | Test |
|---|---|---|---|---|
| 1 | **A progress write after Claude Code's pipe closed killed the server mid-cleanup** (EPIPE, unhandled; reproduced), leaving containers until the next sweep | Medium, Tech Lead | `serveStdio` handles output errors and writes nothing once the pipe is gone or it's ending; the progress timer stops on abort | T6: a broken stdout, then stdin ends mid-run with progress due: cleanup finishes, exit 0. It fails with the handler removed (checked by mutation) |
| 2 | **The gate was checked long before the copy and never after.** A run waits up to 30 minutes for its turn, so an edit, commit or branch switch meanwhile was signed as the old HEAD. Files marked assume-unchanged or skip-worktree slipped past `git status` | Medium, both | `src/tests/gate.js`: the branch and clean-tree check is also run right after the copy (inside the lock) and again before signing; a change is refused (`gate-dirty`) and nothing is signed. Skipped files are refused. Only pass, fail and timeout are signed | review-fixes test: a modified tracked file, a staged file, assume-unchanged, skip-worktree; an edit and a commit made while the run waited: refused, unsigned |
| 3 | **`.git` was checked once, up to an hour before MIRAI's host-side git calls** (the wait), which is the window D-54 is meant to close | Medium, Tech Lead | `runTest` calls `onTurn` once the lock and slot are taken, before any git call; the server checks D-54's hash there and stops on a change | T3: a change while waiting is refused before any git call, and the server stops |
| 4 | **Agents' runs could prune your signed results** (the last 20 runs are kept, whoever ran them) | Medium, Architect | A signed result is also written to `<store>/tests/gate/<id>.json` (the last 100) | review-fixes test: 25 old runs pruned to 20, the signed copy kept and verified |
| 5 | **The MCP wiring wasn't in the template**, so the canonical bundle hash (red-team results' key, units 18–19) didn't cover it, and launch and `sandbox show` worked it out separately | Medium, Architect | The strict template has `tests` (the levels and checks), so the trust root's manifest and the canonical hash cover it. `renderStrict` adds the allow rules; `prepareLaunch`, `expectedInit` and `sandbox show` read the template. Strict schema 3, snapshot format 4 | T8: with and without tools hash differently; T8b: the trust root's templates carry the names |
| 6 | **The server wasn't started with an empty environment** as the hook is; node reads `NODE_OPTIONS` and the like before MIRAI's code runs | Low-Medium, Architect | `mcp.json` runs `/usr/bin/env -i HOME=… PATH=/usr/bin:/bin node …` | T8; the direct probes re-run with it (19/19) |
| 7 | **Waiting could run to 60 minutes** (two waits of 30), and "waiting…" could print twice; the 5-hour tool timeout undercounted | Low, both | One deadline for the lock and the slot, `onWait` once; `MCP_TOOL_TIMEOUT` six hours | review-fixes test: 3.0 s against a 3 s deadline; 5.0 s with the old code (checked by mutation) |
| 8 | **A changed trust root, or a failure without a result, didn't stop the server or skipped the after check** | Low, both | A trust-root mismatch stops the server; the after check runs on every path once a run began; an unreadable `.git` counts as changed | T3 |
| 9 | **Store paths could reach the agent in error messages** (a lock path, the trust dir, raw fs errors) | Low, Tech Lead | Error text shows `<mirai home>` and `<trust root>` instead | T5 |
| 10 | **Progress kept saying "waiting"** after the wait ended | Low, Tech Lead | Reset in `onTurn` | T6 |
| 11 | **`mirai test` no longer stopped Docker when its terminal closed** (calls have their own session) | Low, Tech Lead | SIGHUP aborts too; SIGKILL documented (the next run sweeps) | docs |
| 12 | **`--gate` accepted `--path`**, so a partial run could be signed | Low, Architect | Refused; `verifyTestResult` refuses a result with a path | review-fixes test |
| 13 | **Agent results didn't name their launch** | Low, Architect | `launch_id` from the policy goes into the result | T3, review-fixes test |
| 14 | **Probe-only overrides sat in the production launch path** | Low, both | They're `probe: { home, dockerSocket }`, refused without the probe's own `miraiHomeDir` | T8 |
| 15 | **A test's `io.testRun` could override gate, signal or by** | Note, Tech Lead | Spread first | — |
| 16 | **Docs:** "no other tool" read as the agent having none; "exactly that commit" overstated; `bad-arguments` vs `bad-path`; the path hint "tests/Unit" | Notes, Architect | Reworded in `docs/agent-safety.md`; the hint is "tests/" | — |

## Noted for later units (in the spec)

| Unit | Note | From |
|---|---|---|
| 15 | The broker grows out of `createServer`: keep tools as data (name → schema, handler) | Architect |
| 18 | Red-team rows: a hostile `NODE_OPTIONS` reaching the server; the bundle hash covering the MCP wiring | Architect |
| 19 | <ul><li>Re-hash the trust root right before spawning `claude` (the server's code loads before its first per-call check);</li><li>`checkInit` may see `pending` on a busy machine: it fails closed, so decide on a retry;</li><li>whether `--agents` definitions with a `tools` list filter MCP tools;</li><li>let the server finish cleanup before killing the process group, and probe SIGINT then SIGKILL mid-run (N5);</li><li>sweep test projects after a launch</li></ul> | both |
| 25 | <ul><li>Require `by: "you"`, a `gate`, `path === null` and the outcome it needs (pass);</li><li>recompute the tree hash from HEAD plus the base commit's env files;</li><li>read signed results from `tests/gate/`;</li><li>consider bumping the result's `schema_version`</li></ul> | both |
| Later | <ul><li>The server replies to a cancelled request (MCP says SHOULD NOT; harmless with Claude Code);</li><li>hashing the trust root and `.git` is synchronous, so `ping` stalls during it;</li><li>an exec killed for output over 64 MiB reports `fail` with no exit code (from 14c);</li><li>lowering `max_parallel` ignores held slots above the new cap for a while;</li><li>a started service could swap a checked path for a link before `exec`, but that only resolves inside the container's view</li></ul> | Tech Lead |
