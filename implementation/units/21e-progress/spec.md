---
unit: "21e"
name: progress
status: approved (2026-11-06)
roadmap: design/07-implementation-roadmap.md, row 21e (asked for on 2026-11-06, during 21d's checkpoint; MVP); 21d's checkpoint findings 2, 3, 5, 6 and 7
depends_on: ["21d", "18g"]
---

# Unit 21e: progress while a step runs

## Why

During 21d's checkpoint, `mirai build SAMPLE-2` ran for nine minutes and printed nothing until it was done. You couldn't tell whether Kai was working, stuck, or running tests.

MIRAI already has everything it needs to say more. Claude Code streams every tool call Kai makes, and MIRAI runs its test levels one at a time. `mirai baseline` shows how that should look ("unit: running…"); `plan`, `build` and `fix` don't.

21d's checkpoint also found small things in the same output that are worth fixing here:
- a refresh moves `main`, and you learn that a new baseline is needed only after a 9-minute build;
- a refused build leaves you on its new branch;
- "the changes are left as they are" after a step MIRAI has committed;
- a recheck writes no `checks` line;
- how old the usage reading is isn't shown.

## Scope

**In.**

1. **What a launch reports while it runs** (in `src/agent/run.js`, from the stream it already reads):
   - **The events:** the init event (model), then each tool call Kai makes, with the turns so far and the minutes.
   - **What a tool call shows, and only this:**
     - its name;
     - a file path, for the file tools, relative to the project ("outside the project" when it isn't in it);
     - the level, for `run_tests` and `run_check`.
   - **Never** Kai's text, a Bash command, or a tool's output. Anything Kai wrote could carry anything, so it never reaches your terminal or the heartbeat.
   - **Shown as plain text:** names and paths go through MIRAI's plain-text filter, capped in length.
2. **The commands print it** (`plan`, `build`, `fix`; and unit 28's `mirai run` later), on stderr:
   ```
   Kai (Sonnet): started
   Kai (Sonnet): 4 turns, 2.1 min — Edit backend/app/Http/Controllers/TaskController.php
   Kai (Sonnet): 7 turns, 5.3 min — run_tests unit
   Kai (Sonnet): 9 turns, 8.9 min — handed over
   MIRAI's checks: lint running… pass (141 s)
   MIRAI's checks: unit running… pass, only known failures (56 s)
   ```
   - **How often:** a line per tool call, at most one every 5 seconds. If nothing new happens, a "still working" line every 15 seconds, with the last tool. So 15 seconds is the longest you wait for a sign of life.
   - **MIRAI's own checks:** each check and level as it starts and ends, with its time (as `mirai baseline` does).
   - **The plan step names its stages:** the plan, its lint, and the one fix launch when one is needed.
   - **When stderr isn't a terminal** (a log, the broker), the same lines are printed without any terminal tricks.
3. **`mirai status` from a second terminal** names the running step and its last progress line ("SAMPLE-2 build: Kai (Sonnet), 7 turns, 5.3 min — run_tests unit, 4 s ago"). It reads this from the launch's heartbeat, which now carries that line (the same filtered fields, never more).
4. **The small fixes from 21d's checkpoint:**
   - **A build without a baseline is refused before Kai starts** (finding 2). It says to record the baseline for this commit: `mirai baseline` on the integration branch. Today it learns that only after the launch.
   - **The red-team gate is checked before the branch is made** (finding 3). A refused build no longer leaves you on a new ticket branch.
   - **`mirai init --refresh` says a new baseline is needed** (finding 2): its "Next" list gains "record a baseline for the new commit: mirai baseline".
   - **The message after `checks-failed` or `needs-you`** says what's true. When MIRAI committed the step, it names the commit ("committed as 5da255b on <branch>"), not "the changes are left as they are" (finding 7).
   - **A recheck writes its `checks` line to the run log** (finding 6), so a report shows the recheck's results.
   - **The usage reading's age** (finding 5, the part 21e can do): at the start of a step, "your usage reading is N h old" when it's stale, beside today's note that the caps weren't checked.
5. **Docs:** `docs/agents.md` (what you see while a step runs), the roadmap.

**Out:**
- **`/mirai` in your session:** unit 21f. It will show the same progress through `agent_status`.
- **A manual usage reading:** unit 29.
- **Carrying a known-flaky test across baselines** (21d's finding 1): its own small unit before unit 28, since it changes the baseline's rules.

## Files

- **Changed:**
  - `src/agent/run.js`: progress events, and the heartbeat's progress field;
  - `src/store/run.js`: the heartbeat's progress field;
  - `src/agent/build.js`, `src/agent/fix.js` and `src/agent/plan.js`: pass progress through; the checks' start and end; the baseline and gate checks before the branch; the messages; the recheck's `checks` line;
  - `src/cli/commands/build.js`, `fix.js` and `plan.js`: print the lines and the ticker;
  - `src/cli/commands/status.js`: the running step's line;
  - `src/cli/commands/init.js`: the baseline line;
  - docs.
- **New:** tests in `test/agent/` and `test/cli/`.
- **`src/agent/run.js` is cage code:** one red-team run after your refresh, which 18g makes the only cost (a Claude Code update no longer adds one).

## Tests (`npm test`, no model; stand-in `claude` that streams tool calls)

- **T1.** A launch's progress events carry exactly the tool name, a relative path or level, the turns and the minutes. A stand-in that writes a secret-looking string, a terminal escape and a long text in its message and in a Bash command gets none of them into the events, the heartbeat or the printed lines.
- **T2.**
  - `mirai build` prints a line per tool call (throttled), a "still working" line after 15 s of quiet, and each check level's start and end.
  - Plain lines when stderr isn't a terminal.
- **T3.** `mirai status` names the running step and its last progress line, from the heartbeat.
- **T4.** The small fixes:
  - a build with no baseline for the commit is refused before any launch or branch;
  - a stale red-team gate refuses before the branch is made;
  - `init --refresh` names the baseline step;
  - the message after a committed step names the commit;
  - a recheck writes its `checks` line;
  - a stale usage reading's age is shown.

## Probes

- **R1** (pre-approved: one Haiku launch, on a sample-app clone): a real build launch, recording its progress events, checks that they appear while it runs (at least one every 15 s) and carry no text of Kai's.

Then your refresh and one red-team run, and the next real build shows it.

## Done when

- During a real build, a progress line appears at least every 15 seconds while Kai works, and one per check or level.
- Nothing the agent wrote appears in those lines.
- `mirai status` from a second terminal names the running step.
- A build without a baseline is refused before Kai starts.

## Open points for you

1. **The tool's file path is shown, but no Bash command text.** A command can carry anything Kai wrote, including text a file planted. My recommendation: yes. "Bash" alone, plus the level for `run_tests`, says enough.
2. **A build with no baseline is refused before the launch,** rather than built and left for a recheck. Today it builds, then stops at "needs-you" after 9 minutes. A refusal costs nothing, and you'd record the baseline first anyway. My recommendation: refuse. Say if you'd rather have a flag to build anyway.
3. **The small fixes from 21d ride along here** (gate before branch, the messages, the recheck's line, init's baseline step). They're the same commands and the same output. My recommendation: yes.

## Changes after testing and review

1. **R1 found 13 silent seconds before the launch** (MIRAI's own checks, the red-team gate, the trust root's hashes). A "preparing the launch" line now comes first: from the step itself, before its checks, and once more for the plan's fix launch. While it lasts, "still preparing" follows after 15 s.
2. **A malformed stream event can't touch the launch (Tech Lead H1).** A content that isn't a list is no progress, and the progress handler is wrapped. A throw from it could otherwise have left MIRAI dead with Claude Code still running, or the launch hanging.
3. **The heartbeat always lands (Architect H1).** A ticket or step it can't carry, such as an item like `docs/prd.md` from your session's `start_agent`, is left out of the beat; the beat is never dropped. Before, every heartbeat of such a launch failed, and `mirai status` would have called a live run dead.
4. **What a line may show is narrower (Architect M1 and L1, Tech Lead M6):**
   - **a path** only when it's plain (ASCII letters, digits and `._@+/-`, no spaces, no segment 32 characters long or more); else "a file". Long paths keep their head, not their tail;
   - **a tool** only when it's one of Claude Code's own or the launch's; else "a tool";
   - **a level** only when it's one of the project's.

   So an agent can't pad a path into what looks like one of MIRAI's own lines.
5. **The baseline check is right, and wider (Architect M2 and M3, Tech Lead M3 and M4):**
   - it judges the commit the step will be judged against: an existing branch's own base (its record), else the integration commit;
   - it refuses a project with no test levels or checks, and a baseline that doesn't cover each of them;
   - `mirai fix` checks it too, against the step's own base.
6. **The heartbeat covers MIRAI's checks (Architect M4, Tech Lead M1).** While the checks run after a build's or a fix round's launch, the heartbeat keeps going and carries the running check. A tool line inside the 5-second window lands at the window's end, not at the next event (Tech Lead M2).
7. **Turns count the agent's own messages (Architect L4, Tech Lead M5):** one per message id, never a subagent's. Before, every content block counted.
8. **Small ones:**
   - a launch whose init check failed doesn't say "started";
   - an unknown check says why;
   - the usage age reads "under an hour old" or "dated in the future" where it should;
   - docs say which refusals still come after the branch is made;
   - roadmap row 28 notes that a night run should park an unjudgeable ticket, and log progress as a per-launch summary.
9. **Left for 21f (Architect M5):** the heartbeat names no launch or request, and the broker's worker passes no `onProgress`. 21f's `agent_status` adds both when it shows progress in your session.
10. **From the independent re-review:**
    - **The launch's last line never lands late** (Medium). A trailing beat from the last tool call is cancelled when the launch ends, so it can't overwrite the check line MIRAI's tests write next.
    - **The no-baseline hint fits the case** (Medium). For an older base (a branch that starts before `main` moved), `mirai baseline` can't record one, so the hint says to start the ticket again from the current commit instead.
    - **Small ones:**
      - "started" isn't shown for any init that failed;
      - a tool name is one of the launch's own when they're known;
      - a recheck has no run of its own, so it gets no heartbeat (the claim is dropped);
      - the fix round's base is always the step's;
      - the docs say which short step has no line.
    - **Not changed:** a foreign branch with no baseline shows "no baseline" before `branch-not-mirai` (both refuse; the order is cosmetic). The red-team gate is asked twice per build, before the branch and at the launch; it's a speed cost only.
