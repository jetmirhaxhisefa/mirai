---
unit: "21f"
name: session-commands
status: approved (2026-11-07)
roadmap: design/07-implementation-roadmap.md, row 21f (asked for on 2026-11-06; MVP; "both ways"); builds on 15b (your session's MIRAI server), 19c (start_agent, agent_status, the detached worker) and 21e (progress)
depends_on: ["21e", "19c", "15b"]
---

# Unit 21f: `/mirai` in your Claude Code session

## Why

Today you drive MIRAI from a terminal: `mirai plan`, `mirai build` and the rest. You asked to be able to do the same from inside the coding session you already work in, as BMAD does with `/bmad …`. You also asked to keep the terminal: both ways, your choice each time.

The security reason the terminal exists still holds for the **gates**. Approvals need your signing key and your typed confirmation, so the model in your session can't approve its own plan, even if a file it read told it to. Everything that isn't a gate can safely run from the session, through MIRAI's own server and never by the session calling `mirai` itself (R3-C3).

## Scope

**In.**

1. **`/mirai <command>` in Claude Code.**
   - **The file:** `mirai init` installs `.claude/commands/mirai.md`, MIRAI-managed and in the lock like the other rendered files.
   - **What it tells the session to do:**
     1. read `$ARGUMENTS`;
     2. call MIRAI's tool for the command;
     3. show MIRAI's progress lines as they come;
     4. show the final result.

     It doesn't paraphrase MIRAI's output.
   - **Headless agents never load it:** `--restricted` keeps project commands out, which the red team's `c-instructions` case already checks.
2. **A tool on your session's MIRAI server: `mirai_command`** (interactive context only, like `start_agent`).
   - **Its input:** `command` (from a fixed list) and that command's own arguments, each one checked: a ticket key, a level name, the few flags each allows.
   - **No allow rule is added:** Claude Code asks you each time, as for `start_agent`. If a file talks the session's model into calling it, you see the prompt.
   - **What it runs (open point 1):**

     | Kind | Commands | How |
     |---|---|---|
     | Read-only | `status`, `lint`, `test` (a level), `baseline show`, `redteam status`, `redteam show`, `branch verify`, `sandbox show`, `version`, `help` | in the server, at once; the answer is the command's own text |
     | Long, no agent | `baseline`, `build --recheck`, `init --refresh`, `render` | the detached worker, as `start_agent`'s |
     | With an agent | `plan <ticket>`, `build <ticket>`, `fix <ticket>` | the detached worker, with its one-time launch tokens minted by the server (the same as `start_agent`; plan's fix launch and each fix round get their own) |
     | The red team | `redteam run` (and `--kept`) | the detached worker; Claude Code's prompt is your consent, in place of the terminal's y/N |
     | **Gates, never run** | `approve`, `approve --plan`, `drop`, `discard`, `unpark`, `redteam accept-blocker`, `key`, `token`, `session-server install` / `remove` | the tool answers with the exact terminal command to run, and why it's yours |
3. **Progress in your session.**
   - **`mirai_status`** (the tool, or `agent_status` grown) returns a command's state and its newest progress lines, read from the worker's status file and the heartbeat. Those are the same filtered lines 21e prints: tool, project path or level, turns, minutes, never the agent's text.
   - **The `/mirai` command** asks again every 15 seconds or so, until the command ends, then shows the result.
   - **For this, 21e's leftovers are done here:**
     - the heartbeat names its launch, and the worker's request;
     - the worker passes `onProgress` and `onCheck` through to the request's status file.
4. **Your terminal is unchanged.** Every command still runs there, and a gate only there.
5. **Docs:**
   - `docs/agents.md`: running MIRAI from your session;
   - `docs/agent-safety.md`: why the gates stay in a terminal, and what the tool lets a session do;
   - the roadmap.

**Out (open point 2):**
- **Codex and Cursor.** Their own command files (`.cursor/commands/`, Codex's prompts) and MCP config come with their adapters. They aren't in MIRAI yet: design/03 places them later, and Codex only from Milestone D. 21f builds the server tool every tool will call, and Claude Code's command file. Each adapter then adds a small file of its own, and its row in the roadmap names this.
- **`mirai report`:** unit 29. Its command joins the list when it exists.

## Probes

- **R1 (pre-approved, one Haiku launch, a sample-app clone):** `mirai_command` with `plan` through the worker, with the gate stubbed. Its progress lines reach the status, and the plan comes out as from the terminal.
- **R2 (you, about two minutes, no model):** in your own Claude Code session in the sample app:
  1. run `/mirai status`;
  2. try `! node ~/Projects/mirai/bin/launch.js approve SAMPLE-2 --plan`.

  **What we learn:** whether a `!` command gets a real terminal. If it doesn't, the approval refuses with "needs a terminal", and the gates stay terminal-only as designed. If it does, it's your call whether that's safe enough (open point 3).

## Files

- **New:**
  - `src/mcp/tools/commands.js`: `mirai_command`, `mirai_status`, the command list and its argument checks;
  - the command file's text in `src/adapters/claude-code.js` (rendered by `mirai init`);
  - tests;
  - `src/agent/command-worker.js`.
- **Changed:**
  - `src/agent/worker.js` and `bin/agent-worker.js`: a worker request for a command, besides one agent;
  - `src/agent/requests.js`: the worker's record;
  - `src/cli/tty.js` and the plan, build, fix and red-team commands: the session proof;
  - the adapter's rendered files and the lock;
  - docs.
- **Cage code:** `src/mcp/**` and the worker are cage code, so your refresh needs one red-team run (18g: only that).

## Tests (`npm test`, no model; stand-in `claude`)

- **T1.** `mirai_command` refuses a command not on the list, and a bad argument (a ticket that isn't a key, a flag a command doesn't take). A gate answers with its terminal command and runs nothing.
- **T2.**
  - A read-only command answers with the same text as the terminal's.
  - `plan` and `build` through the worker run as from the terminal: the same refusals, checks, commit and record. Each launch gets its own one-time token.
- **T3.** `mirai_status` shows a running command's progress lines (21e's filtered fields only) and its result. A stand-in that writes a secret and a terminal escape gets neither through.
- **T4.** The command file is installed and in the lock. It only names `mirai_command` and `mirai_status`. A headless launch's init event doesn't list it.
- **T5.** The tool exists only on your session's server, never on a headless agent's.

## Done when

- From a Claude Code session in the sample app, `/mirai status`, `/mirai plan <ticket>` and `/mirai build <ticket>` take a ticket to its gate, with progress shown in the session.
- `/mirai approve` prints the terminal command instead of approving.
- A session's model can't approve its own plan.

## Open points for you

1. **The command list above** (everything but the gates, the red team's run included, with Claude Code's prompt as your consent). My recommendation: yes. Say if you'd keep `redteam run` or `init --refresh` terminal-only.
2. **Codex and Cursor come with their adapters,** not in this unit. They aren't in MIRAI yet, and the server tool is what makes adding them small. My recommendation: yes. Each adapter's roadmap row will name its `/mirai` file.
3. **The gates stay in a terminal.**
   - **If R2 shows a `!` command doesn't get a real terminal:** that's the end of it, and `/mirai approve` prints the command.
   - **If it does get one:** my recommendation is still no for now. A `!` line in your session is typed by you, which is good. But the session's model can put text on screen right before it, and the typed-key confirmation is the whole gate. Row 29b (your key at rest, a human key apart from a machine key) is where approving from a session can be designed safely.

## Changes after testing and review

1. **A command doesn't run under `script(1)`.** macOS's `script` needs its own input to be a terminal, and the worker has none.
   - **Now:** the worker runs `mirai <command>` directly, naming its request (`MIRAI_SESSION_REQUEST`).
   - **What accepts the request in place of a terminal:** `plan`, `build`, `fix` and `redteam run`, and only when the store confirms the request is running, claimed by their parent process (the worker), for that very command.
   - **The gates** keep the plain terminal check.
2. **Read-only commands go through the worker too.** The tool waits for the worker, a few seconds, so the answer still comes at once. The server stays small, and the text is the CLI's own.
3. **Progress reaches your session through the command's own lines,** which are 21e's filtered progress lines as the CLI prints them. So the heartbeat needs no request id. `start_agent`'s launches now pass their progress lines to `agent_status` too.
4. **R1 became a test (T6) with no model.** It runs the real chain: the tool, a detached worker from the trust root's copy, `mirai status`, the answer.
   - **Why:** a real `plan` from a clone would meet the clone's stale red team, since the CLI the worker starts checks the real gate.
   - **The real plan through `/mirai`** is your R2, in the sample app after its red-team run.
5. **The command file is interactive only.** It's written by `render` into `.claude/commands/`, never into the shared bundle, so a headless run's plugin folder never has it. The profile gained an optional `commands` folder.
6. **From the reviews (Tech Lead and Architect):**
   - **The prompt really comes each time (both Highs).**
     - The command file pre-approves only `mirai_status`. Pre-approving `mirai_command` would have let `/mirai`, or a file steering it, run commands with no prompt.
     - `disable-model-invocation: true` keeps the model from starting `/mirai` itself.
     - `session-server install` adds an `ask` rule for `mirai_command` and `start_agent`. Ask beats allow, so a "don't ask again" can't silence them.
   - **plan, build and fix from a session would always have been refused (both Highs).** The worker named its command in the status only after the command had already checked it. Now the worker writes its own record (`<id>.worker`: its pid and command) and the status before the command starts, and the proof reads that record. The server's "queued" write no longer overwrites a request that's already running. A test runs `plan` through the real worker.
   - **`redteam run` finds `claude`:** the Claude Code your session server registered goes first on the command's PATH (Medium).
   - **The red team's consent comes after its cost** (Medium). The first call answers with the cost and a one-time code (kept by the server for ten minutes), and only a second call with that code runs it.
   - **A command can't hang forever** (Medium). stdin closes right after the optional "y", and each kind of command has a deadline:
     - quick, 2 min;
     - long, 90 min;
     - an agent's, 4 h;
     - the red team, 2 h.

     At the deadline it's stopped (SIGINT, then SIGKILL), and its outcome is `timeout`. A second signal to the worker kills it at once. The command file stops polling after 30 minutes and gives you the request id.
   - **The login token is taken out** of every line and of the output (Medium).
   - **Not from a session: `init --refresh` and `render`** (Architect Low). A session's copy is the trust root's, so it couldn't bring a newer MIRAI, and they rewrite files in your work tree.
   - **The docs say what's true** (Medium):
     - the session proof stops agents, not programs running as you;
     - a session's model can't approve its own plan through `/mirai`, but until 29b its Bash still could;
     - the lines quote MIRAI's report, which can quote an agent.
   - **A branch that changes `/mirai`** makes `mirai status` warn (Medium). Unit 24's instruction-file check should cover `.claude/commands/**`.
   - **Small ones:**
     - a spawn failure ends as `refused`;
     - a line with no newline is capped;
     - `agent_status`'s lines are plain;
     - the spec's files list matches the code;
     - roadmap row 28 notes the proof `mirai run` would need.
7. **From the independent re-review:**
   - **A deadline doesn't cut the CLI's own cleanup short** (Medium): the SIGKILL comes 2 minutes after the SIGINT, past the CLI's 30 s grace for an agent's processes.
   - **The result doesn't wait on a grandchild** (Medium): the worker ends on the command's exit plus a 3 s drain, not on every holder of its pipes closing.
   - **The ask rule's limits are said** (Medium). Install says so when it can't write `.claude/settings.local.json` (not git-ignored, not JSON, a link), and the docs name the file. **Left for later:** putting the ask rule in the committed `.claude/settings.json` beside 13c's denies, so it holds for every developer. It's in PROGRESS.
   - **The red team's code is tied to `--kept`, and the docs say what it protects** (Medium). The real yes is Claude Code's prompt on the second call; the code makes sure the cost was given out first. The cost is labelled rough: the terminal works out the exact numbers.
   - **`mirai status`'s check of `/mirai` never follows a link and never reads a big file** (Medium). It's worded "isn't the one this MIRAI renders", so a file from another MIRAI version isn't blamed on a branch, and a BOM is stripped first.
   - **Small ones:**
     - the token is taken out of each chunk as it comes, before the output's tail is cut;
     - the polling interval is 30 s everywhere;
     - the ask record goes when the local settings file is gone;
     - a non-list `ask` is left alone.
