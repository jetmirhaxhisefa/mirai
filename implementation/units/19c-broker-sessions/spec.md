---
unit: "19c"
name: broker-sessions
status: approved (2026-11-02)
roadmap: design/07-implementation-roadmap.md, rows 19 and 19c; D-12, D-12 and D-14 (recursion guard), D-53, D-57; R-M1, R-M3, PM2-3, TL3-8; G24; the 19a review's notes for 19c and 28
depends_on: ["19b", "15b"]
---

# Unit 19c: Starting agents from your session, and sessions with a run id

## Why

Today an agent starts only from your terminal. D-12 and D-53 say workflow skills in your own Claude Code session start agents too, through MIRAI's server, without ever handling the launch token. Your authoring sessions also get a run id, so their work is logged like a run's. This unit:
- adds the broker's last verbs to **your session's server**: `start_agent`, `agent_status`, `session_start`, `session_end`;
- adds the depth guard's one-time token, moved here from 19b;
- adds `mirai session start|end` for your terminal;
- settles G24: whether a launch started from MCP's side works and stays caged.

Headless agents never get these tools: the tool table gives each tool its contexts (unit 15a), and a test pins it.

## Scope

**In.**

1. **`start_agent(role, prompt, item?, step?, risk?, size?, verifies?)`** on your session's server only.
   - It checks its arguments, mints a one-time token (below), and starts a **detached worker**: MIRAI's launcher from the trust root, run through `/usr/bin/env -i` like the server itself.
   - It returns a launch request id at once. A run can take an hour, longer than any tool call should wait (detach-and-wait, from 19a's review).
   - The worker calls the same `runAgent` as your terminal, so every check of 19a and 19b applies: the red-team gate, the clean tree, the role's scope, the run lock.
   - The prompt is text, at most 200,000 characters, kept in the store, never a path the session names.
2. **`agent_status(id)`:** the request's state (`queued`, `running`, `done`), and when done its outcome, why, the model and its reply (the last 32 KiB, escaped). It reads a status file the worker writes in the store, which the session can't reach through its tools.
3. **The depth guard's one-time token (D-12's recursion guard).** `runAgent` refuses without one.
   - **Minted by:** your terminal's `mirai agent run`, after the terminal check; the broker, once per `start_agent`; the orchestrator later (unit 28).
   - **How it works:** the token goes to the worker down a pipe, never into a file or an argument. Only its hash goes in the request's record. The worker checks it against the record and deletes the record, so the token can't be used twice.
   - **What it guards against:** a sandboxed agent, which has no `start_agent` and can't reach the store, and any MIRAI code path that would launch without going through one of the three minters.
   - **What it doesn't guard against: your own session.** It isn't sandboxed, so it could read the store or drive `mirai agent run` through `script` (18e). There it's a speed bump, and the docs say so.
4. **`session_start(skill, item?)` and `session_end(id, note?)`,** and **`mirai session start|end`:** a run id for interactive authoring (R-M3, PM2-3).
   - New run-log events `session_started` and `session_ended`. Lines your session logs carry the session's run id.
   - A session that's never ended is closed by the next `session_start`, and says so.
5. **Your permission for each launch.** `mirai session-server install` adds allow rules for `lint`, `log_event` and the test tools, as it does today. **Not for `start_agent`** (open point 2), so Claude Code asks you every time a skill tries to start an agent.
6. **A split for unit 28:** `runAgent` takes and holds the run itself today. It becomes `runAgent` (the lock, then a launch) and `launchInRun({ runId, … })`, so a launch inside `mirai run` doesn't refuse on its own lock.
7. **The red team, sessions suite (18e):** `start_agent` with forged and hostile arguments; without a token; with a reused one; a request id from elsewhere; a prompt holding the login token. All direct, no model. And a pin that the headless policy never offers these tools.
8. **Docs:** `docs/agent-safety.md` (starting agents from your session; what the token does and doesn't do), the roadmap, D-12 and D-53's wording.

**Out:**
- `trace(item)`: unit 43, as decided in 15a.
- Workflow skills that use these verbs: unit 21 and later. This unit adds the verbs and one probe skill.
- Running the orchestrator inside these: unit 28.

## Probes (with your OK before each batch)

- **R1, G24: a launch from your session's server, end to end.** A real session (`claude -p`, temporary config, the sample-app clone) calls `start_agent` for a reviewer on a light step; `agent_status` until done. What's checked:
  - the worker starts outside your session's process tree, with the cage the red team tested (`checkInit`);
  - it reads the token from the pipe;
  - it survives the calling session's end.

  About 3 Haiku runs, the agent's included.
- **R2:** what Claude Code does to an MCP server's children when the session ends. If it kills them, the worker needs its own session, `setsid` or an equivalent. No model.
- **R3:** your permission prompt for `start_agent` with no allow rule, in a real interactive session. You run this one, once: I'll give you the steps. A `-p` run can't show a prompt.
- **R4:** the sessions suite once, on the final code, after the review. About 170 Haiku runs, about 10 minutes.

**No full headless red team,** if the strict bundle doesn't change: these verbs are only on your session's server. Any green goes stale with the code anyway.

## Files

- **New:** `src/mcp/tools/agents.js` (`start_agent`, `agent_status`), `src/mcp/tools/sessions.js`, `src/agent/requests.js` (request records, the token), `bin/agent-worker.js`, `src/cli/commands/session.js`, tests in `test/mcp/` and `test/agent/`.
- **Changed:** `src/mcp/tools.js`, `src/mcp/session.js` (the policy and its allow rules), `src/agent/run.js` (the token, the split), `src/cli/commands/agent.js`, `src/store/run-log.js`, `src/redteam/cases-session.js`, `docs/agent-safety.md`, the roadmap, D-12, D-53.

## Tests (`npm test`, no model; a stand-in `claude`)

- **T1.** `start_agent` and `agent_status` exist only in an interactive policy. A headless policy offering them is refused at start, and the headless `mcp.json` never lists them.
- **T2.** `runAgent` without a token is refused. A token used twice is refused. A token for one request doesn't start another.
- **T3.** `start_agent` returns at once. The worker runs every 19a and 19b check (a stale red team, a dirty tree, a role's scope), and its refusals reach `agent_status`.
- **T4.** Hostile arguments are refused before anything starts: unknown roles, steps or flags; a prompt over the limit or holding the token; an `item` that isn't an id; a `verifies` that isn't a launch.
- **T5.** `agent_status` for an unknown or malformed id is refused. Its reply is escaped and capped.
- **T6.** `session_start` / `session_end` write their run-log lines. A session left open is closed by the next one. A session's `log_event` lines carry its run id.
- **T7.** `install` adds no allow rule for `start_agent`, and `status` says so.
- **T8.** `launchInRun` launches inside a run that already holds the lock.

## Done when

- A skill in your session launches an agent through the broker, and its outcome comes back through `agent_status`.
- A launch without a token, or with a reused one, is refused.
- Headless agents never have `start_agent`.
- Your session asks you before each launch.
- G24 is settled in research/10.

## Open points for you

1. **The worker and your session's lifetime.** My recommendation: the worker outlives the session that started it, so a run isn't cut off when you close a window, and `agent_status` from a new session still finds it. The run lock and the takeover from 19a already cover a crash. Ending a running launch is Ctrl-C in your terminal today; a `stop_agent` verb could come later.
2. **No allow rule for `start_agent`.** My recommendation: none, so Claude Code asks you every time. Each launch uses your subscription and acts in your checkout. Under bypass or auto nothing asks, which is your call, and the docs say it again.
3. **Sessions and the global run lock.** My recommendation: a session run id doesn't take the lock. You're there, and authoring shouldn't block a launch you start from it. Only agent launches take the lock, as now.
4. **The token's honesty.** It guards code paths and sandboxed agents, not your own session (point 3 in Scope). My recommendation: build it as D-14 says, and state the limit plainly, as 18e did.
5. **The cost:** about 3 Haiku runs for R1, then the sessions suite once, about 170 Haiku runs. I'll ask before each batch. R3 is yours.

## Changes after testing and review

1. **A session's journal lines keep their registration id, not the session's run id.** Adding a field to the journal means a new journal version, and the journal's signing context includes its version. The session's run id is in the run log (`session_started`, `session_ended`); its notes are matched by time.
2. **The red team's session fixture links your `claude`** so its server offers `start_agent`. A launch from a fixture is refused by the red-team gate, so nothing reaches a model. `d-start-chain` shows the chain end to end with no model: server, the real worker from the trust root, the gate's refusal, `agent_status`.
3. **From the reviews:** `launchInRun` spends a token and checks the caller holds the run lock (it launched with neither); only the run's owner ends the run, so unit 28's next launch carries on; the worker's empty environment now gives the same red-team key as your terminal (macOS's ssh-agent socket comes from launchd), or every session launch read as stale; the worker re-checks its request, handles signals like Ctrl-C, writes its pid, and a dead worker shows `lost`; `agent_status`'s reply is `reply_untrusted`; `status` says whether start_agent asks you, across your settings files; the plan is read for the log; session notes refuse bidi text. The token's limits now name a branch's hook and look-alike server, as 18e found.
4. **G24 is two questions:** research/10's G24 (claude from sandboxed Bash) was settled in 13a. A launch from MIRAI's server is **G30**.
5. **One open session per repo at a time,** stated, not one per window.
6. **From the review of the fixes:** `status` reads only plain, small settings files (a branch's link to `/dev/zero` hung it); a request records its worker's pid and start time from the start, so one that never got going, or whose pid was reused, shows `lost`, and prune drops it; `launchInRun` also checks the lock is this repo's; two sessions starting at once are serialised. The ssh fix matches only whether there's an agent, not which: stated.
