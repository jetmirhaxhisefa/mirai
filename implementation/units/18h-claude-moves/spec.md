---
unit: "18h"
name: claude-moves
status: draft (interview decisions 1–3, Jet, 2026-11-16)
roadmap: design/07-implementation-roadmap.md, row 18 (the red team's key, R3-M7), after 18g. Asked for on 2026-11-16, during pilot prep's move to Claude Code 2.1.325, six releases behind: "I dont wanna risk that after weeks working on old claude version … should have a rule that lets claude keep updating"
depends_on: ["18a", "18g", "19", "21f", "29b"]
---

# Unit 18h: Claude Code moves between tickets, never during one

## Why

Since 18g, agents run the Claude Code binary the last green red-team run tested, and MIRAI moves
to a newer one only when you run the red team on it. Nothing prompts that run, so it gets put off:
agents sat on 2.1.319 while 2.1.325 was installed. And when a move does happen, it lands under
whatever is in flight: every launch takes the current kept binary, so a ticket planned on one
version can be built and reviewed on another.

What doesn't change: a binary is only used after a green red-team run on it, and new settings keys
or sandbox profile rules (S1/S2) are only listed after a person has read what they do (on
2026-11-16 the auto-mode classifier refused an agent's edit to that list, rightly).

## Decisions (Jet, 2026-11-16, in the interview)

1. **One version per ticket.** A ticket's first agent launch records the Claude Code it ran, and
   every later launch for that ticket uses that binary: plan, re-plan, build, fix rounds, review.
   The next ticket starts on the newest green one. (Epics, units 33 and 67, are sets of tickets;
   the same rule can apply there later.)
2. **MIRAI moves at a ticket's start.** When a ticket with no pin starts and a newer Claude Code is
   installed, MIRAI checks S1/S2 on it; if they're clean, it runs the red team on it first, under a
   consent you give once in your personal config. Green: the ticket pins the new version. Not
   green: it pins the current one, and you're told why. If S1/S2 find something new, nothing runs;
   you're told what to read.
3. **Warn, then stop after 7 days.** While a newer version is waiting, every run, `mirai status`
   and doctor name what's waiting and the command that clears it. Once the gap is more than 7 days
   old, a new ticket doesn't start until you act. A ticket that already has a pin always finishes
   on it.

## Scope

**In.**

1. **The ticket's pin.**
   - **When:** the ticket's first agent launch (normally its plan) writes
     `tickets/<ticket>/claude-code.json` in the store: version, sha256, the kept path, when. It is
     signed by the machine key, like `tested-claude.json` (18g).
   - **Every later launch for the ticket** (`plan`, `build`, `fix`, Rex's review, `start_agent`
     with a ticket) uses the pinned binary. The launch gate (19) checks the red-team result for
     that binary, not the newest kept one. A pinned copy that's missing or changed refuses the
     launch, as 18g's check does today.
   - **The evidence:** the build record, the gate proof and the report name the Claude Code
     version the ticket ran on.
   - **Released** when the ticket is done, dropped or obsolete. A re-plan keeps the pin.
2. **Kept copies.** 18g keeps the current and previous binary per repo. It now also keeps every
   binary a ticket still pins, and the red-team results for them (`KEEP_RESULTS` never prunes a
   pinned binary's last green result).
3. **The move at a ticket's start.** It runs at the top of `mirai run` and `mirai plan` (terminal,
   session worker or broker) for a ticket with no pin, when the newest installed Claude Code isn't
   the kept one:
   - **S1/S2 first (no model).** Something new: no move. The run's output and `mirai redteam status`
     list it (as now), and the ticket pins the current kept binary.
   - **Clean, and you've consented:** `[claude_code] move = "auto"` in your personal config (new
     key; absent means MIRAI tells you once how to set it, and doesn't move). MIRAI runs the full
     red team on the newest installed binary, as `mirai redteam run` does, with its progress lines
     in the run's output (about 15 minutes). Green: it's kept, as 18g does, and the ticket pins it.
     Not green: the ticket pins the current one; the run's last line says which cases.
   - **One automatic try per binary per day.** A flaky case doesn't cost 15 minutes on every
     ticket: after a not-green try, the next automatic one for the same binary waits 24 hours.
     Your own `mirai redteam run` can always try again.
   - **One at a time:** the red team takes the global run lock, as today; a second ticket starting
     meanwhile waits or pins the current version.
4. **The gap, and the stop.**
   - **The gap starts** when MIRAI first sees a newer installed Claude Code it couldn't move to
     (recorded in the store; cleared by a move).
   - **Warnings:** each run's last line, `mirai status`, and doctor (yellow) name what's waiting:
     S1/S2 to read (and that a MIRAI update lists them), or the red team's cases, with the command.
   - **After 7 days:** a ticket with no pin doesn't start (`blocked`), with the same command. A
     ticket with a pin is never stopped by this.
5. **Docs:** `docs/red-team.md` (moves and pins), `docs/run.md`, `docs/config.md` (the new key).

**Out.**

- Listing S1/S2's new entries without a person: always a MIRAI update after someone has read them.
- A scheduler (a nightly move): not before the pilot.
- Holding back one bad release on purpose (`skip <version>`): later, if a release ever needs it.
- Epics (33, 67); Cursor and Codex (their adapters).

## Tests

- A ticket planned on binary A; the kept binary moves to B; the ticket's build, fix and review
  launch A; its gate proof names A; the next ticket pins B.
- A pinned binary's copy and its green result survive two later moves; released after `done`.
- At a ticket's start with a newer binary: S1/S2 new → no red-team run, pinned to the current one,
  the note names what to read; clean without consent → no run, the one-time hint; clean with
  consent → the red team runs (stand-in runner), green → pinned to the new one; not green →
  current one, and no second automatic try within 24 hours.
- The gap: warnings from its first day; on day 8 a new ticket is `blocked` and a pinned one runs.

## Probes

- **R1 (real):** with `move = "auto"`, the next Claude Code release after 2.1.325 is installed by
  its updater while a ticket is in progress on the sample app: that ticket finishes on its pinned
  version, and the next ticket's start runs the red team and pins the new version. Its gate proof
  names it.

## Done when

The tests pass, and R1 shows a real release moving between two tickets with no command from you
but the ticket's own `run`.
