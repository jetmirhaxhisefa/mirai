---
unit: "14d"
name: run-tests-tool
date: 2026-10-28
node: v22.23.2
claude-code: 2.1.311
docker: Docker Desktop 29.6.2 (engine and client), Compose 5.3.1
git: 2.39.5 (Apple Git-154)
macos: 26.7
result: 268 / 268 pass after the review fixes (earlier units' 256 + unit 14d's 12); 6 MCP fact probes with Haiku (M1–M6); 19 / 19 direct run_tests probes on Docker Desktop, before and again after the review fixes, and 1 Haiku end-to-end run (before the fixes), nothing left behind; on the sample app a signed gate run (verified, and a tampered copy refused) and a server-driven frontend run (failures only from its seeded known failure and flaky test)
---

# Unit 14d — Test results

## `npm test`

New tests. `test/mcp/server.test.js` drives the server over in-memory pipes with a stand-in
executor. The others use 14c's fake `docker` (no Docker in `npm test`):

```
14d T1: the protocol: initialize, tools/list with the configured names, ping, unknown methods, oversized or broken input ends it
14d T2: the argument rules: names from the list, no extra fields, the path form and the path in the copy
14d T3: every call hashes the trust root again and checks .git before and after; a change stops the server
14d T4: the policy: its hash, its shape; nothing from the environment but the policy
14d T5: results inline: the fields, the 32 KiB tail, no store paths, isError per outcome, redacted errors
14d T6: one call at a time; cancelling a call or closing stdin aborts the run, which still finishes cleaning up; progress
14d T7: waiting: the repo lock and the machine slots, max_parallel, a deadline, an abort
14d T11: the MCP probes stay canary-only and local, and the model is always Haiku
14d T6/T9: a cancelled run kills its Docker call and still cleans up; mirai test --gate signs on a clean tree on the branch; agent runs never
14d T8: MIRAI's MCP server in the launch: read-only policy and mcp.json, --mcp-config, the allow rules, the init check; none without tests
14d T8b: mirai sandbox show names MIRAI's MCP server, its tools and names
14d review fixes: the gate is checked again after the copy and before signing; no --path; skipped files; signed results kept apart; the launch id; one deadline for waiting
```

**The review fixes** (review.md) are covered:
- in T3 (a trust-root change and a `.git` change while waiting both stop the server; the after
  check runs on every path; the launch id);
- in T5 (no MIRAI-home paths in errors);
- in T6 (a closed stdout mid-cleanup, the progress note);
- in T8 and T8b (the wiring in the template and the canonical hash, `env -i`, the probe option);
- in the new review-fixes test.

Two were checked by mutation: the EPIPE test fails with the output handler removed, and the
deadline test fails with two separate waits (5.0 s against a 3 s deadline, where the fix gives
3.0 s).

**Existing tests changed by this unit:**
- **14c's test-run tests:**
  - they await `runTest`, which is now async, and use `assert.rejects`;
  - the `--path` cases use paths that exist and contain no spaces (`tests/A_Test.php`,
    `tests/x/a.txt`), since 14d refuses other path forms;
  - T14's "one run at a time" waits 300 ms instead of 30 minutes;
  - T13 (stack-neutral) also scans `src/mcp/`.
- **strict T5:** the launch environment list gains `MCP_TIMEOUT` and `MCP_TOOL_TIMEOUT`.
- **strict (sandbox show):** it prints "MCP server: none" for a project without tests.
- **strict T1 and 14c T2:** the snapshot format is 4, since the strict templates now hold the MCP
  tools.
- **`test/probes/test-run-probes.js`:** awaits `runTest`; c3 uses `tests/a_b.php` and creates
  the file.

```
# tests 268
# pass 268
# fail 0
# cancelled 0
```

**Earlier full runs failed, and the reasons are on record:**
- **The machine was very busy for most of this unit** (load average 390–410, later 70).
  - The lint T12 timing check (1026 ms against a 1 s limit) failed in one run.
  - Hook T4 (its `bin/hook.js` must answer in under 2 s) failed in two runs.
  - Both pass alone and in the final full run, which ran at a load average of about 15. Nothing
    in 14d touches them.
- **One full run hung for 3 h 20 min in 14d T6/T9.** That was a bug in the test, not in MIRAI:
  - the fake `docker` wrote a call's arguments file before its environment file;
  - the test's poller read the pair in between, and the read threw inside a timer;
  - the test then never sent its abort, and the fake `exec` call waited forever.
  
  **Fix:** the fake now writes the environment first and renames the arguments file into
  place, so a call only shows once both files are complete. The test also has a 3-minute
  limit, so a failure like this can't hang the suite again.

## MCP fact probes (Claude Code 2.1.311, Haiku)

`node test/probes/mcp-probes.js --yes`. A canary stdio server
(`test/probes/mcp-facts-server.js`) records what it sees. The launch is MIRAI's own (sandbox,
dontAsk, `--strict-mcp-config`). These facts are now in `research/10-claude-code-facts.md`.

| Probe | Result |
|---|---|
| m1-facts | pass: init shows `{"name":"probe","status":"connected","source":"dynamic"}`; the call was answered. The server reached the Docker socket and read the store, so it runs outside the sandbox (M4). Claude Code asks for protocol `2025-11-25` and sends `server/discover` before `initialize` |
| m2-no-allow | fact: under dontAsk, an MCP tool with no allow rule is denied and never called |
| m5-3min | pass: a 180 s call completed and was answered, with a progress token sent |
| m5-default | fact: with no `MCP_TOOL_TIMEOUT`, a 180 s call still completes |
| m5-12min | pass: a 720 s call completed with `MCP_TOOL_TIMEOUT` set |
| m6-kill | fact: SIGTERM to `claude`: the server got SIGINT at 22.4 s and exited 1 ms later; nothing left running |

The server's environment (M3) is Claude Code's: the allowlisted launch variables plus
`CLAUDECODE`, `CLAUDE_PROJECT_DIR` and `CLAUDE_CODE_SESSION_ID`. No variable holds the token.
The server's working directory is the project, and the pipes it inherits are on fd 3 and up.

## run_tests probes: MIRAI's own server on Docker Desktop

`node test/probes/run-tests-probes.js --yes`. The fixture is a git repo under `~` with MIRAI
installed. It has levels `unit` and `slow` and a check `lint`, all on `nginx:1.27-alpine`
(local, never pulled). The harness checks that no container, network or volume is left.

**Direct**, with the harness as the MCP client:

| Probe | Result |
|---|---|
| d1-initialize | pass: `{"name":"mirai","version":"0.1.0"}` |
| d2-tools | pass: `run_tests(level, path)`, `run_check(name)` |
| d3 (11 cases) | pass, refused as `bad-arguments`: paths `-x`, `a;b`, `$(id)`, `../x`, `/etc/passwd`, an unknown level (with the configured list), a `script` field, a path on `run_check`. Refused as `bad-path`: a link and a missing file. Then 0 left |
| d4 | pass: `run_tests(unit)` passed (exit 0, 25 s, tree `1e538be8b650`); `run_check(lint)` passed; 0 left |
| d5-repo-changed | pass: a commit during a call gives `repo-changed`, then the server stops |
| d6-stdin-closed | pass: the server exits 0 when stdin closes |
| d7-killed-mid-run | pass: killed while the containers were up; exited 0 after 1 s with 0 left |

**After the review fixes**, all 19 direct probes were run again, and passed with nothing left.
That run used the server as the launch now starts it, `/usr/bin/env -i … node bin/mcp.js`, with
the tools from the template.

**End to end with Haiku (h1-haiku), one run:** pass.
- MIRAI's own launch passed `checkInit`, with the `mirai` server connected.
- The model called `mcp__mirai__run_tests({"level":"unit"})` and
  `mcp__mirai__run_check({"name":"lint"})` and replied "pass pass".
- 0 left, exit 0.

The spec planned two Haiku end-to-end runs. One was enough because the direct probes cover the
argument and failure paths.

That run came before the review fixes. So Claude Code itself hasn't yet started the server
through `/usr/bin/env -i`. The direct probes start it exactly as `mcp.json` says, but through the
harness.

## The sample app (your key, with your OK)

**A gate run:** `mirai test unit --gate --branch main` on a clean `main`.
- **Outcome:** `fail`, exit 1, from the app's seeded known failure (13 passed, 1 failed).
- **Signed** with `k-eea753565042f25b` for `main` at `4fd3e11e075d`, tree `861561503394`.
- `verifyTestResult` accepted the result. A copy with one field changed was refused.

**A server-driven run:** `run_tests(frontend)` through `bin/mcp.js`.
- **Outcome:** `fail`, exit 1, from the app's seeded flaky test (5 of 6 passed).
- It took 241 s, with 4 progress notes on the way. The reply named no store path.

**Afterwards:** no Docker leftovers, and `git status` on the sample app was clean.

## Bugs the real runs found (fixed, and covered by tests)

- **A killed run took 9 s to return.** The client's own child processes held the output pipes.
  `dockerCall` now runs each call in its own process group, kills the whole group, and has a
  2 s grace timer (T6/T9, and 14c's T8, now under 8 s).
- **Ctrl-C no longer reached Docker** once calls had their own process group.
  `mirai test` now turns SIGINT and SIGTERM into an abort, which kills the call and still
  cleans up (T6/T9).
- **The machine slots folder didn't exist on a fresh MIRAI home** (ENOENT).
  `machineSlot` now creates the MIRAI home and `locks/` first (T7).
