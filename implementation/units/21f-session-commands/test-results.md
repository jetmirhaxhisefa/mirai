---
unit: "21f"
date: 2026-11-07
claude_code: 2.1.319
result: 511/511 tests after the review and re-review fixes; no model run; R2 (yours) after the refresh and the red-team run
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

## Still to run (yours, after the refresh and one red-team run)

**R2, in your own Claude Code session in the sample app:**
1. `/mirai status`;
2. `/mirai approve SAMPLE-2 --plan`: it should answer with the terminal command;
   Also check that Claude Code asks before `mirai_command` each time, and that `/mirai redteam status` needs no prompt;
3. optionally `/mirai plan` on a new ticket, to see a real launch from the session;
4. `! node ~/Projects/mirai/bin/launch.js approve SAMPLE-2 --plan`: does a `!` command get a real terminal?

## Not proven

- **A real `plan`, `build` or `fix` launched from a session:** R2.
- **Claude Code's own handling of the command file** (`$ARGUMENTS`, `allowed-tools`, the 15-second follow-up): R2.
