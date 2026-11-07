---
unit: "21f"
date: 2026-11-07
claude_code: 2.1.319
result: 511/511 tests after the review and re-review fixes; no model run; R2 (yours, 2026-11-07): the session commands and the gate answered as designed, and a `!` command doesn't get a real terminal
---

# Unit 21f — Test results

## Tests (`npm test`, no model)

In `test/mcp/commands.test.js`, plus the pinned tool lists in `test/mcp/`.

- **T1:** only listed commands, with checked arguments: a ticket key, a level name, a flag the command takes. Refused:
  - an unknown command;
  - a missing ticket;
  - `../x`;
  - a flag the command doesn't take;
  - an extra argument.

  A gate (`approve --plan`) answers `yours` with `mirai approve SAMPLE-2 --plan`, and spawns nothing.
- **T2:** `version` run through the worker as `mirai version` from MIRAI's copy gives the same text as the terminal. A gate written into a request by hand is refused by the worker too.
- **T3:** the status carries the command's lines as they come (a progress line verbatim; a terminal escape escaped), its exit code (3), and the note that quoted agent text is data.
- **T4:** `.claude/commands/mirai.md` is installed and in the lock. It names only `mirai_command` and `mirai_status`, and the headless bundle has no command file.
- **T5:** the two tools exist on your session's server only. `mirai_command` is on the "needs your yes" list; `mirai_status` isn't.
- **The session request proof:**
  - no request, or a forged id: "needs a real terminal";
  - a running request claimed by the parent, for this command: accepted;
  - another command, a request not claimed by the parent, or one that's done: refused.
- **From the reviews:**
  - `plan` through the real worker is answered by the plan command itself, not refused for a terminal;
  - the red team's first call gives its cost and a code, a wrong code gives it again, and the right one goes on;
  - the command file pre-approves only `mirai_status`, and has `disable-model-invocation: true`;
  - the proof needs the worker's own record, and a late "queued" write doesn't undo it;
  - the login token written by a command is taken out of its status.
- **T6, the real chain:** `mirai_command status` runs a detached worker from the fixture's trust root, which runs `mirai status`. The answer comes back at once, with MIRAI's own text.

## R2 (yours, 2026-11-07, Claude Code 2.1.319, the sample app at `c3d595e`)

Before it: `mirai session-server install` registered the server from the trust root at `c3d595edc0e0`, with `mirai_command` and `mirai_status` among its tools, and `start_agent` asking before each launch. The first `/mirai status` came before that, in a session opened earlier: the tools weren't there, and the session's model said so and didn't fall back to Bash. A new session found them.

1. **`/mirai status`:** answered with MIRAI's own text: the repo, run `r-20261106-175323-ad5e` stopped, the global lock free, SAMPLE-1 and SAMPLE-2 `in-review`. Outcome ok, exit 0.
2. **`/mirai approve SAMPLE-2 --plan`:** answered with the terminal command (`mirai approve SAMPLE-2 --plan`) and ran nothing ("Outcome: yours, nothing executed").
   - **Claude Code asked before each command:** yes (you).
   - **`/mirai redteam status` needing no prompt:** not checked.
3. **A real `/mirai plan`:** not run.
4. **`! node ~/Projects/mirai/bin/launch.js approve SAMPLE-2 --plan`:** refused, "mirai approve needs you, in a real terminal; it can't be piped or run by an agent". **A `!` command doesn't get a real terminal**, so the gates stay terminal-only, as designed (open point 3 is settled that way).

Outside R2: the same approval typed in a real terminal was refused because SAMPLE-2 is already `in-review` ("a plan waits at the gate while the ticket is in-progress"), which is right.

## Not proven

- **A real `plan`, `build` or `fix` launched from a session:** not run in R2.
- **Claude Code's own handling of the command file:** `$ARGUMENTS` reached the server for `status` and `approve SAMPLE-2 --plan`; `allowed-tools` (no prompt for `mirai_status`) and the 15-second follow-up weren't checked.
