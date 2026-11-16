---
status: draft
version: 1
---

# 14 — Progress display and notifications (stage 2)

Decisions PM-08 and PM-09.

## 1. The problem

A run prints progress lines one after another (unit 21e). To know where an epic stands you read
back through them. Inside a Claude Code session you see only what the model relays. You asked
for: the phase, steps done and left, the ticket list of an overnight epic, the document flow's
phases, colours, progress bars, the next step, links you can't miss, and all in a few lines.

## 2. One state, one renderer

```
orchestrator ──writes──▶ run state file ──read by──▶ renderer ──▶ terminal block
                    └──▶ event stream ─────────────▶ notifications   status line
                                          └────────▶ the hub (15)
```

### 2.1 The run state view (P14)

The store already holds a run's truth: `state.json`, `heartbeat.json`, the run log and
`journal.jsonl`. P14 adds no second truth. It adds a **projection**: one small JSON file per
run, derived from those by one function and rewritten atomically whenever they change.

- It holds only what a display needs: the run id and preset, the epic and its ticket list with
  each ticket's state, the active ticket's steps with their states and the current round,
  elapsed time, the usage share, what is waiting for you, and the next command.
- **A list of active runs** for the workspace, not a single pointer, because stage 4 allows two
  runs (`16` §4.0).
- **No project text beyond ticket ids and titles.** No code, no document text, no agent output.
  Titles are untrusted and are escaped for display by `shown()`, as in the inbox.
- Agents can't read or write it. It is in the store, which the sandbox denies.
- Because it is derived, it can be rebuilt at any time, and a missing or broken file is never
  an error for the run.

### 2.2 The event stream (P14)

- An append-only file of events, one JSON line each, in the store, also derived from the run
  log and the journal by one function.
- Events (fixed list): `ticket-started`, `ticket-in-review`, `approval-waiting` (plan,
  document, ticket set), `ticket-parked`, `run-paused` (usage limit), `run-resumed`,
  `run-missed` (a scheduled run didn't start or finish), `report-ready`, `mr-opened`,
  `mr-merged`, `released` (with the tickets it contained), `finding-drafted` (`17`),
  `queue-paused` (autopilot brake, `16`).
- Each event has an id, a time, the workspace, the service, ticket or epic ids, and a link.
- **A unit that adds an event registers it here.** P25c, P33 and P37 add theirs when they are
  built. If one of them is built before P14, it writes to the run log and P14 picks the event
  up.
- Notifications, the hub and the status line read this stream. The Jira status mirror (`12`
  P07) is built earlier and hooks the state change directly. It moves to the stream once P14
  exists.

### 2.3 The renderer (P15)

One pure function, `renderTracker(state, { width, colour, unicode, lines })`, returns text. It
has four views, chosen from the state:

**One ticket:**

```
PROJ-142  Add export button                    step 5/9 · 12m
✓ plan  ✓ gate  ✓ build  ✓ red  ● checks  ○ review  ○ QA  ○ ship
next: waiting for checks
```

**An epic or an overnight queue:**

```
EPIC-9  Roles and permissions      ████████░░░░░░  5/11 · night 2 · 9% of week
✓ PROJ-138  ✓ PROJ-139  ✓ PROJ-140  ✓ PROJ-141  ● PROJ-142 checks 5/9
○ PROJ-143  ○ PROJ-144  ◆ PROJ-145 needs you  ✗ PROJ-146 parked  ○ +2
next: mirai approve --plan PROJ-145
```

**The document flow:**

```
Roles and permissions   ✓ brief  ✓ PRD  ● design (Vera, round 1)  ○ tickets  ○ docs MR
next: nothing yet · HLD draft: https://…
```

**One line** (for the status line):

```
PROJ-142 ●checks 5/9 · EPIC-9 5/11 · ◆1 needs you
```

Rules:

- **States are a glyph and a word**, never colour alone: `✓ done`, `✗ failed`, `● running`,
  `○ pending`, `◆ needs you`, `⏸ paused`. ASCII fallbacks exist for each.
- **16-colour ANSI only**, through Node's `util.styleText`. No colour when the output isn't a
  terminal or `NO_COLOR` is set.
- **Links are always printed as the full URL.** A clickable link (OSC 8) is added on top where
  the terminal supports it.
- **A next line always.** Either the command to type or what MIRAI is waiting for.
- **At most the lines asked for.** A long ticket list folds to `+n`.

### 2.4 The terminal block (P15)

- Finished events scroll above as today. The block is redrawn in place below them.
- `--progress=auto|tty|plain|json`. `auto` picks `tty` on a terminal and `plain` elsewhere.
  `plain` prints a line per change, as today. `json` prints the state.
- One writer. Redraws at most ten times a second, inside a synchronized-output pair where the
  terminal supports it. The cursor is restored on exit and on a signal.
- **Never on the MCP server's standard output**, which carries the protocol.
- `mirai watch` attaches to a running or paused run from another terminal and draws the same
  block from the state file.

### 2.5 The Claude Code status line (P16)

- Claude Code can run a script to draw its status line. MIRAI ships one that finds the active
  run for the session's project folder and prints the one-line view.
- **It composes with your own status line.** MIRAI never replaces a script you have. Setup
  offers to wrap it: yours runs first and MIRAI's line is added. Removing is as easy as adding.
- It reads only the state file, runs no model and must return within a few milliseconds.
- **Check first:** the current status-line contract (input, refresh interval, multi-line
  support) and whether it applies to the Claude Code version the team is on.
- **It goes into your user-level Claude Code settings, never the project's.** The project's
  rule files are part of the red-team key, so writing there would make every result stale.
- Also in this unit: a tool result from `/mirai status` in the session contains the multi-line
  view as text, so the model can relay it.

## 3. Notifications (P17)

- **One-way.** MIRAI sends. Nothing comes back in. Approving from Slack is not planned: a click
  there is a weaker proof than your key in a terminal.
- **Per project, off by default.** Which events a project sends is project config. Who receives
  them is personal config, since each developer has their own channel (proposed):

  ```toml
  [notify]
  events = ["approval-waiting", "ticket-parked", "run-paused", "report-ready", "mr-merged", "released"]

  ```

  ```toml
  # personal layer, per developer
  [[notify.channel]]
  kind = "slack"            # an incoming webhook
  [[notify.channel]]
  kind = "email"
  to = "you@example.com"
  ```

- **Secrets are not in the repo.** The webhook URL and mail credentials live in
  `~/.config/mirai/`, beside the key, set with a command like `mirai notify set`.
- **What a message contains:** the event, ticket or epic id and title, the state, and a link.
  For `released`: the list of ticket ids and titles. For `finding-drafted`: the id, the source
  and the severity only, because a finding's title is written by an agent. **Never** code, document text, findings
  text, log lines or secrets, because the message leaves your machine.
- **Channels behind one small interface** (`send(event) → ok | error`), so a new channel is one
  file. First two: a Slack incoming webhook and email.
- **Email:** the git host already mails you for MRs. MIRAI's email covers the events the host
  doesn't know: approvals waiting, parks, pauses, the report, releases. **Check first** how to
  send mail with no dependency: an SMTP relay with credentials is the likely answer.
- **Failures are quiet for the run and loud in the report.** A failed send never stops or slows
  a run. The morning report lists what couldn't be sent.
- **No storm.** Events of one kind within a short window are sent as one message.
- **A missed run is an event too.** If a scheduled night run or nightly check didn't start, a
  message says so (`17`).

## 4. Units

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| P14 | **Run state view and event stream:** both as projections of the existing store files, the state schema, atomic rewrites, the list of active runs, the fixed event list with registration for later units, titles escaped by `shown()` | Review | Every display reads them | During a seeded run the state view always parses and matches the run log; deleting it and rebuilding gives the same content; each listed event appears once with its ids and link; an agent's attempt to read either is denied (red-team case) |
| P15 | **The tracker renderer and the terminal block:** the four views, glyph-and-word states with ASCII fallback, colour rules, full URLs, the in-place block, `--progress`, `mirai watch` | P14 | Your first surface in the terminal | Snapshot tests cover each view at three widths, with and without colour and unicode; piped output has no escape codes; a killed run leaves the cursor visible; nothing is drawn on the MCP server's output |
| P16 | **The Claude Code status line:** the one-line script, wrapping an existing status line without replacing it, setup and removal, the multi-line text in `/mirai status` | P15 | Where you watch most | With a run active, the session shows the line and it changes as steps finish; your existing status line still shows; removal restores your settings byte for byte; the project's rule files are untouched and the red-team key is unchanged; with no run the line is empty |
| P17 | **Notifications:** the channel interface, Slack webhook, email, `[notify]` config, secrets in `~/.config/mirai/`, message content rules, grouping, failures in the morning report | P14 | You're told when MIRAI waits for you, merges or releases | A seeded run sends one message per configured event to a test webhook and a test mailbox; a message contains no code, document text or agent-written finding text (checked by a test with canaries); a dead webhook doesn't change the run's result and appears in the report; a project with no `[notify]` sends nothing |
