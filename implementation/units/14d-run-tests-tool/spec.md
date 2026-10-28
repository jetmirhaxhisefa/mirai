---
unit: "14d"
name: run-tests-tool
status: approved (2026-10-27); unit approved (2026-10-28)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 14 (split into 14a–14d); D-48, D-49, D-53, D-54
depends_on: ["14c"]
---

# Unit 14d: The `run_tests` tool

## Why

14c built the part that runs a test level or a named check in containers, but only you can start
it (`mirai test <name>`). Agents must run tests and checks too: Kai during TDD, Ivy for QA. They
must do it without a shell exception, without Docker access and without seeing the store (D-48).

This unit gives a headless agent run exactly two MCP tools from a small MIRAI server:
- **`run_tests(level, path?)`**;
- **`run_check(name)`**.

Each has structured arguments and no shell. The server's code comes from the trust root, and the
server runs 14c's executor. Results come back inline. Unit 15's broker later grows out of this
server (D-53).

This unit also adds what the gate needs from a run: a **signed test result** bound to exactly what
ran, from a clean tree on a named branch. Unit 25 builds the gate-result record from it.

**Versions:**
- as 14c: Docker Desktop 29.6.2, Compose 5.3.1, git 2.39.5, macOS 26.7;
- Claude Code 2.1.311 (13a probed 2.1.310; this unit's probes re-check what it relies on).

**Roadmap "done when" covered here:**
- an unknown level or check is refused (now through the tool);
- a host-side change to `.git` is detected before the next git call. The server checks D-54's
  hash before and after every call;
- `run_tests` with shell metacharacters or an option injection is refused (also a unit 18
  red-team row).

## Scope

**In:**

1. **Facts first: MCP probes** (`test/probes/mcp-probes.js`, run by hand, canaries only, fixture
   under `~`). They are settled before the wiring is built, and each fact has a fallback below.
   - **M1:**
     - Claude Code starts a stdio server given by `--mcp-config <file>` with
       `--strict-mcp-config`;
     - the init event lists it as connected;
     - which MCP protocol version it asks for.
   - **M2:** under `--permission-mode dontAsk`, a call to `mcp__mirai__run_tests` needs an allow
     rule in the settings. Without the rule it's denied and appears in `permission_denials`.
     `--tools` doesn't list MCP tools (or, if it must, how they're spelled).
   - **M3:** what the server process gets from Claude Code. It records only names, never
     values:
     - its environment;
     - its open file descriptors (fd 3 is the token pipe);
     - its working folder.
   - **M4:** the server runs outside the sandbox, so it reaches the Docker socket and the store.
     Bash in the same run still can't reach either.
   - **M5:** a tool call that takes 3, then 12 minutes completes, with `MCP_TOOL_TIMEOUT` set in
     the launch environment, and progress notifications don't break it.
     - **Fallback if a call is capped:** `run_tests` returns a run id after a limit, and
       `test_result(id)` waits for the rest.
   - **M6:** when the run ends mid-call (`--max-turns`, a kill of the process group), the server
     sees stdin close or a signal. It stops the Docker call, and nothing is left in Docker.

   M1–M3 and M6 need a real `claude -p` run with Haiku and a trivial prompt (about 8 runs on your
   subscription; open point 4). M4 and M5 ride on the same runs. Every other check talks to the
   server directly, with no model.

2. **The server** (`src/mcp/server.js`, `bin/mcp.js`; no dependencies):
   - **The protocol:** MCP over stdio, newline-delimited JSON-RPC 2.0.
     - It handles `initialize` (answering with the version Claude Code asks for, if supported),
       `notifications/initialized`, `ping`, `tools/list`, `tools/call` and
       `notifications/cancelled`.
     - Anything else gets "method not found".
     - A message over 1 MiB, or one that isn't JSON, ends the connection.
   - **The tools:** exactly two, with input schemas set to `additionalProperties: false`:
     - `run_tests`: `level` is a configured test level and `path` is optional;
     - `run_check`: `name` is a configured named check.
     - `tools/list` names the configured levels and checks in each schema's `enum`, read from the
       trust root.
   - **Started from the trust root:** `<trust>/tree/.mirai/framework/bin/mcp.js
     <policy-file> <sha256>`, like 13c's hook.
     - The policy file is written read-only by `prepareLaunch` into the launch's `input/`. It
       holds the checkout, the trust folder and its manifest hash, D-54's hash at launch, the
       launch id and the allowed names.
     - The server refuses to start if the policy's hash differs.
     - It takes nothing from its environment but `HOME`.
   - **Every call:**
     1. It re-verifies the trust root, which must be the launch's manifest hash. It never
        re-resolves the base mid-session.
     2. It checks D-54's hash against the policy's.
     3. It runs 14c's executor with that trust root.
     4. It checks the hash again.

     A mismatch fails the call with `repo-changed`. Every later call is then refused (the
     server is "stopped"), and unit 19's `finishLaunch` reports it.
   - **One call at a time per server.** A second call while one runs gets `busy` at once.
   - **Results inline,** as one JSON text block:
     - `id`, `outcome` (pass / fail / timeout / env-fault / refused) and `code`;
     - `exit`, duration, `level` or `name`, and `path`;
     - the output tail (redacted, 32 KiB inline; the full 64 KiB stays in the store);
     - the output folder's file list (paths and sizes);
     - `isolated_binds` and the tree hash.

     `isError` is true for refused and env-fault. Nothing in the result points into the store,
     since agents can't read it. Parsing JUnit and coverage, and sending screenshots, are unit
     16's.
   - **Progress:** while a run is going, if the call asked for progress, a notification goes out
     each minute ("running unit, 3 min").

3. **Argument rules** (D-48, R3-M6, TL3-17), checked before anything runs:
   - names come from the enum only. An unknown name is refused, with the list;
   - **`path`:**
     - at most 512 characters, matching `^[A-Za-z0-9_][A-Za-z0-9_./@-]*$`. So it never starts
       with `-` or `/`, and it has no spaces, quotes, `$`, `;`, `|`, backquotes or newlines;
     - no `.` or `..` parts;
     - checked again **against the copy** (the tree that runs, after 14c copies it): it must
       exist there as a plain path, with no link along it;
     - passed after `--`, as 14c does.
   - **Test IDs** (D-48's `:` for filters such as `File.php::testName`) wait for unit 16's
     adapters, which know each runner's escaping. Until then `path` is a file or folder only.
   - `run_check` takes no `path`. A named check runs whole.

4. **Async Docker calls** (14c review):
   - `dockerCall` becomes async: `spawn`, output collected up to the same caps, a timeout, and
     an `AbortSignal` that kills the client with SIGKILL;
   - `runTest` becomes async. `mirai test` awaits it, and its Ctrl-C handling stays;
   - cancelling a call aborts the current Docker call, and cleanup then runs without the signal;
   - the server keeps answering `ping` while a test runs.

5. **Waiting instead of `test-busy`:**
   - **one run at a time per repo,** as in 14c (the store lock). A call from the server waits up
     to 30 minutes for the lock, with progress, instead of failing after 2 seconds;
   - **a cap on parallel runs across all your projects** (the 14c review): slots in
     `<mirai-home>/locks/test-slots/`, `max_parallel` from your personal
     `~/.config/mirai/config.toml` (`[tests] max_parallel`, 1–8, default 2);
   - **waiting longer than 30 minutes** is `env-fault`, code `test-busy`;
   - **`mirai test`** waits the same way and prints "waiting for another test run" once.

6. **The bundle wiring** (`src/launch/strict.js`):
   - **`prepareLaunch`** writes `input/mcp.json` and `input/mcp-policy.json`, both read-only, when
     the project has `[compose]` configured:
     - one server, `mirai`, `type: stdio`;
     - the command is node by absolute path (the same checks as the hook's);
     - the args are the trust-root script, the policy file and its hash;
     - `env` sets only `HOME` and `PATH=/usr/bin:/bin`.
   - **`launchArgs`** adds `--mcp-config <input/mcp.json>` next to `--strict-mcp-config`.
   - **The settings:** the allow rules `mcp__mirai__run_tests` and `mcp__mirai__run_check` (in
     the form M2 settles).
   - **The template:** both modes, read-write and read-only, get the two tools. Running a test
     changes nothing in the work tree. Agent definitions that list them get them too (open
     point 5).
   - **`expectedInit` and `checkInit`:**
     - `mcpServers` is `['mirai']` when wired;
     - the init event must show it connected;
     - any other server still fails the launch;
     - a server that failed to start fails the launch, not just the tool.
   - **The launch environment** gains `MCP_TOOL_TIMEOUT` and `MCP_TIMEOUT` at fixed values, set
     from M5.
   - **`mirai sandbox show`** lists the server, its two tools and the allowed names.

7. **The signed result** (the roadmap's gate result; the 14c review's binding):
   - **`mirai test <name> --gate --branch <b>`** is for you and, later, the orchestrator. It
     refuses unless:
     - HEAD is on branch `<b>`;
     - the tree is clean: no changed, staged or new files that aren't ignored (`git status
       --porcelain=v2 --untracked-files=all` is empty);
     - Docker is running and the images exist (the "healthy stack" of the roadmap's pre-step
       guard).
   - **After the run,** `result.json` gains a `signed` block, signed with your key
     (`signObject`, context `mirai-test-result/1`) over:
     - the outcome, the level or check name, the path and the exit code;
     - the tree hash, the HEAD commit and the branch;
     - the base commit, `sha256(compose.frozen.json)` and the trust manifest hash;
     - the Docker version and the run's start and end times.
   - **`verifyTestResult(result, keys)`** checks the signature and that its fields match the
     result.
   - **Never signed:** runs from the server (an agent's runs). Their `result.json` says
     `by: "agent"`. A signed result means you or the orchestrator ran it on a committed tree.
   - **Left for unit 25:** the gate-result record, minted at ship from these results, bound to
     the normalized patch, and recomputing the tree hash from a commit.

8. **Docs:**
   - `docs/agent-safety.md` gains "How agents run tests": the two tools, the argument rules, what
     comes back, what's checked on every call, and what a signed result means;
   - `research/10` (or a new short section in `research/11`) gets M1–M6's results.

**Out:**
- **`qa-explore` and scripts as content:** unit 51, as the roadmap says.
- **The interactive `mcp.json`** (broker plus `run_tests` in your session) and `log_event`: unit
  15. Until then the tools exist only in headless launches.
- **Live headless launches:** unit 19's `mirai agent run`. This unit's probes start `claude -p`
  through `prepareLaunch`'s plan by hand, as 13b's probes did.
- **Test IDs and result parsing:** unit 16.
- **Building images:** unit 17.

## Files

- **New:**
  - `src/mcp/server.js` (the protocol and the two tools);
  - `src/mcp/args.js` (the argument rules);
  - `bin/mcp.js`;
  - `src/tests/slots.js` (the global cap);
  - `src/tests/sign.js` (sign and verify a result);
  - `test/mcp/server.test.js`;
  - `test/probes/mcp-probes.js`;
  - `implementation/units/14d-run-tests-tool/{spec,test-results,review}.md`.
- **Changed:**
  - `src/tests/docker.js`, `run.js` and `compose.js` (async, a path check on the copy, waiting,
    `by`);
  - `src/cli/commands/test.js` (`--gate`, `--branch`, awaiting);
  - `src/launch/strict.js` (the MCP wiring, `checkInit`);
  - `src/cli/commands/sandbox.js`;
  - `src/config/config-schema.js` (personal `[tests] max_parallel`);
  - the registry's strict profile, if the allow rules live there;
  - `test/tests/test-run.test.js` (async) and `test/launch/strict.test.js`;
  - `docs/agent-safety.md`, `research/11`.

## Tests

`npm test`, no Docker and no model. A fake `docker` as in 14c, and the server driven over pipes:
- **T1:** the protocol: initialize, version agreement, tools/list with the configured enums,
  ping during a run, unknown methods, oversized or broken messages end it.
- **T2:** the argument rules: unknown names (with the list), extra fields, a `path` with each
  forbidden character, leading `-` or `/`, `.`/`..` parts, too long, a link along it in the copy,
  missing in the copy; `run_check` with a `path`.
- **T3:** every call re-verifies the trust root and checks D-54's hash before and after. A
  change fails the call with `repo-changed`, and later calls are refused.
- **T4:** the policy: a changed policy file or hash stops the server at start. Its environment is
  ignored but `HOME`.
- **T5:** results inline: fields, the 32 KiB tail, redaction (the token and secret shapes),
  `isError` per outcome, no store paths.
- **T6:** async Docker: timeout and abort kill the client. Cancelling a call still cleans up
  (`rm -f`, `down -v`, verified). Ping is answered meanwhile.
- **T7:** waiting: the repo lock and the global slots, `max_parallel`, 30 minutes → `test-busy`
  (with a fake clock). A second call on the same server gets `busy`.
- **T8:** the wiring: `mcp.json` and the policy are read-only in `input/`, absolute paths,
  `HOME`/`PATH` only, `--mcp-config` with `--strict-mcp-config`, the allow rules, no wiring
  without `[compose]`. `checkInit` refuses a missing, failed or extra server.
- **T9:** `--gate`:
  - it refuses on the wrong branch, a dirty tree or a new file;
  - a signed result verifies;
  - a changed field or another key fails;
  - server runs are never signed.
- **T10:** `mirai test` still behaves as in 14c (exit codes, `--path`), now async, with
  "waiting".
- **T11:** the probe scenarios stay canary-only and local, and the model is always Haiku.
- **T12:** 14c's stack-neutrality check covers `src/mcp/`.

**Probes** (`node test/probes/mcp-probes.js --yes`, after your OK on the runs):
- M1–M6 as above;
- **then an end-to-end run:** Haiku is told to call `run_tests(level: "unit")` and
  `run_check(name: "lint")` on a fixture with MIRAI installed. Both results come back inline,
  and nothing is left in Docker;
- **the refused cases sent to the server directly:** each forbidden `path` form, `-x`, `a;b`,
  `$(id)`, a link in the copy, unknown names, an extra `script` field, and a host-side `.git`
  change between calls.

**The sample app:** `mirai test unit --gate --branch main` on a clean checkout signs a result
(the seeded known failure makes it `fail`, which is still a valid signed result). Then a
server-driven `run_tests(level: "frontend")` through the pipes, as the probes do.

## Open points for you

1. **Only your runs are signed, not an agent's.** Recommended.
   - An agent's runs (through the server) come back unsigned, marked `by: "agent"`.
   - Only `mirai test --gate`, from you or later the orchestrator, signs, and only on a clean
     tree at a named branch.
   - The other way, the server signs everything. Then any agent call would mint signed results
     with your key, which is more than D-16 asks for.
2. **Long runs block the call, with progress.** Recommended, if M5 shows long calls complete.
   - The fallback, if Claude Code caps a call: a run id returned after a limit, and a
     `test_result(id)` tool to wait for the rest.
3. **Up to 2 test runs at once across all your projects.** This is a personal setting
   (`[tests] max_parallel`, 1–8). Each run starts a whole compose stack, so 2 is a guess for one
   Mac.
4. **About 8 short Haiku runs on your subscription** for M1–M3, M6 and the end-to-end run. I'll
   ask before starting them, as before.
5. **Both modes, read-write and read-only, get the two tools.** A reviewer could then re-run a
   test. The other choice is read-write only.
6. **One unit, or a split.** Recommended: one unit, with the M probes first. If they change the
   design (open point 2's fallback), I'll stop and show you before building on them. Otherwise
   it could split into 14d (the server, the arguments, async and the signed result) and 14e (the
   bundle wiring and the Haiku probes).

## Changes after testing and review

1. **The MCP wiring is in the strict template** (Architect's review). The spec had the tools
   wired per launch, from the config.
   - **Now:** each template holds `tests`, the levels and checks the server offers (or null). So
     the trust root's manifest and the canonical bundle hash, which red-team results are keyed
     by, both cover it.
   - `renderStrict` adds the allow rules. `prepareLaunch`, `expectedInit` and `sandbox show` read
     the template, so they can't drift apart.
   - The strict schema is 3 and the snapshot format 4, so older trust roots are rebuilt.
   - Every template gets the tools (open point 5). An agent's definition decides whether it uses
     them.
2. **The gate is checked three times** (both reviewers).
   - **When:** before the run, right after the copy (inside the lock, since a run can wait 30
     minutes for its turn), and before signing.
   - **What's checked:** HEAD on the branch, a clean `git status`, and no tracked file marked
     assume-unchanged or skip-worktree.
   - **On a change:** the run is refused (`gate-dirty`) and nothing is signed.
   - **Also:** only a run that ended in pass, fail or timeout is signed, `--gate` takes no
     `--path`, and `verifyTestResult` refuses a result with a path.
   - **What's bound:** the copy that ran is HEAD's files plus the base commit's dummy env files,
     as for every run.
3. **D-54's `.git` check runs again at the run's turn** (Tech Lead). `runTest` calls `onTurn`
   before any git call on the checkout. The after check runs however the run ended. A changed
   trust root also stops the server.
4. **Signed results are kept apart,** in `<store>/tests/gate/` (the last 100). Agents' runs can't
   prune them (Architect).
5. **The server never writes once Claude Code is gone** (Tech Lead, reproduced). A progress note
   due during cleanup after the pipe closed was an unhandled EPIPE, which killed the server
   before its containers were removed.
6. **The server starts like the hook:** `/usr/bin/env -i HOME=… PATH=/usr/bin:/bin node …`.
7. **Waiting has one deadline:** 30 minutes for the repo's turn and a machine slot together, and
   "waiting" is said once. `MCP_TOOL_TIMEOUT` is six hours (30 minutes of waiting, 240 of
   running, then cleanup).
8. **Smaller fixes:**
   - error text shows `<mirai home>` and `<trust root>` instead of store paths;
   - progress says "running" once the wait ends;
   - `mirai test` also aborts on SIGHUP;
   - agent results carry `launch_id`;
   - the probe-only settings are `prepareLaunch({ probe })`, refused without a probe's own MIRAI
     home;
   - the path hint is "tests/", which is neutral.
9. **Other ways the build differs from the spec:**
   - **The signature context** is `mirai/test-result/1:<repoId>`, like the journal's, rather
     than `mirai-test-result/1`. The whole result is signed, not a `signed` block.
   - **The path form is also checked in the server** (`bad-arguments`, before any I/O). The
     check in the copy gives `bad-path`.
   - **Paths with spaces are refused,** and so are `:` test IDs until unit 16, for
     `mirai test --path` too. 14c's c3 probe now uses `tests/a_b.php`.
   - **`server/discover`** (sent before `initialize`, M1) gets method-not-found, and Claude Code
     carries on.
   - **`isError` is also true for `timeout`.**
   - **Ctrl-C in `mirai test`** aborts through a signal, since Docker calls now run in their own
     process group.
   - **One Haiku end-to-end run, not two:** the direct probes cover the argument and failure
     paths. It ran before fixes 1 and 6. The direct probes were re-run after them (19/19), but
     Claude Code itself hasn't yet started the server through `env -i`.
10. **Bugs the real runs found:**
    - a killed run took 9 s, because the client's children held the pipes. Docker calls now run
      in their own process group, killed whole, with a 2 s grace;
    - the slots folder was missing on a fresh MIRAI home;
    - a race in a test's fake Docker hung one full `npm test` run for 3 h 20 min. The test also
      has a time limit now.
11. **Noted for later units** (review.md has the full table):
    - **unit 15:** keep tools as data;
    - **unit 18:** red-team rows for `NODE_OPTIONS` and the bundle hash;
    - **unit 19:**
      - re-hash the trust root before spawning;
      - decide on `checkInit` and `pending`;
      - whether `--agents` tool lists filter MCP tools;
      - let the server finish cleanup before killing the group;
      - sweep test projects after a launch;
    - **unit 25:**
      - require pass, `by: "you"`, a gate and no path;
      - recompute the tree from HEAD plus the base's env files;
      - read `tests/gate/`;
      - consider bumping the result's schema version.
