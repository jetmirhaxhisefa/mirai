# Tickets

How MIRAI's tickets are planned, typed and picked (unit 42). The epic, its generated tables and
the graph lint are in [documents.md](documents.md), "Epics and ticket sets"; how a ticket is built
is in [agents.md](agents.md).

## Who writes them

Tess (`mirai-ticket-planner`) writes tickets, under her own role `ticket-planner` (read-write,
step `tickets`, the standard tier by default: `models.steps.tickets`).

- **A set, from an approved PRD:** `mirai tickets <initiative>` (in your session
  `/mirai tickets <initiative>`). She starts only while the PRD is approved as it is now. On the
  `full` track she will start from the approved design once units 62–65 write it; until then, from
  the PRD. Her first launch writes the epic and every ticket; MIRAI renders the epic, lints the set
  and runs Vera on it between her launches ([documents.md](documents.md), "From request to
  approval").
- **One ticket by hand:** `/mirai ticket "<one line>"` in your session: at most 3 questions, then
  `mirai tickets <name> --one` writes one lone story or bug ([documents.md](documents.md), "One
  ticket by hand").
- **A lone ticket fixed:** `mirai tickets fix <KEY>` (in your session `/mirai ticket fix <KEY>`):
  Tess takes an existing lone story or bug, yours or hers, with Vera's must-fix findings on it as
  it is now (`findings.md`), and changes only what they name, never its scope or intent. Then MIRAI
  lints it and Vera checks it again, with her usual rounds and the 16-launch cap. She writes only
  that one file and doesn't pause; a `tess_run` line (mode `fix`) records it. Refused for a ticket
  of an epic (fix it through the epic's set) and for one with no result of Vera's yet (`mirai
  verify <file>` first).
- **Your answer to an open point:** `mirai tickets fix <KEY> --answer "<text>"` (in your session
  `/mirai ticket fix <KEY> "<answer>"`). A lone ticket's Notes may hold "Open: …" points, each saying
  how to settle it. Your answer reaches Tess as data (`answer.md`, fenced); she settles the point it
  answers, changing only that, and MIRAI lints it and Vera checks it again. It works on a ticket Vera
  passed too; an empty answer is refused.
- **Her ticket keys:** `<tickets.key_prefix>-<n>`, numbered on from the highest key under the docs
  root ([config.md](config.md)). With no prefix set she doesn't start, and says how to set it.

How she cuts follows design/01 §5 and §7: vertical slices, the first a tracer bullet through every
layer and the next the one she's least sure of; "split, never shrink"; one repo per ticket; sizes
S, M and L within the caps; `e2e: true` only on a ticket that creates or changes a critical journey;
`tdd` and `tests` only as a proposal for you.

## From approved documents to an approved set

Unit 45 joins the steps from your approved documents to an approved, merged ticket set.

**The documents each track needs** (`[tickets.inputs]`, [config.md](config.md)):

| Track | Tess cuts from | Until the type exists |
|---|---|---|
| `quick` | nothing: one ticket by hand | |
| `standard` | the approved PRD and the technical note | the note is required from unit 64 (Arlo) on; until then a missing one is a warning, and an approved one is her input |
| `full` | the approved PRD, HLD, ADRs and LLD | no HLD or LLD yet (units 62, 63): she cuts from the PRD and the ADRs |

Since unit 65 the design comes first: approving the PRD offers the architect's run
([design.md](design.md)), and Tess's offer follows the design's approval (the note's on
`standard`; on `full` the set's one signature at its sitting). After a change to an approved design
(`mirai design <initiative> --change`), the tickets citing a changed ADR (`governed_by`) or LLD item
(`uses`) that aren't built yet come back to her: her next run re-cuts them with the change as her
notes (`design-change.md`); built ones are flagged in `mirai show` for you.

`mirai tickets <initiative>` refuses while a needed document of a type MIRAI has isn't approved as
it is now, naming it and its approval command. A type not built yet is skipped, and her run line
says so (`inputs: not built yet, so not needed: no HLD yet (unit 62)`).

**The technical note** (unit 62b, `standard`): how the feature is built, on one page, approved
after the PRD and before the set ([documents.md](documents.md), "The technical note"). With an
approved note, Tess cuts the tickets along its components and coverage; Kai's plans cite its
decisions; Rex checks the code against them. Until Arlo (unit 64) writes notes, one is optional:

```
tickets: no technical note yet: not required until unit 64; with one approved, the tickets follow it
Start Tess (mirai-ticket-planner) on the ticket set now? [y/N]
```

**The offer.** When an approval completes the track's list (on `standard`, the PRD's, or the
note's when there is one), it ends with a question, never a start on its own.

`y` starts her run in that terminal; `N` (the default) prints `mirai tickets <initiative>`. When
she paused on the PRD and you approved it again, it asks `Tess paused on Q-8 for this; continue her
run now? [Y/n]`, yes by default, since you started her already.

**The set's screen.** `mirai approve <epic-id> --file …/epic-<slug>.md` shows the epic, Vera's and
the reader test's results, the release mode with Tess's reason, and one line per ticket:

```
release: per-ticket (Tess (mirai-ticket-planner): each ticket goes live on its own once you merge it.)
the tickets (key, type, priority, order, size, blocks, title):
  SAMPLE-51    Story         normal  order 1   M  blocks SAMPLE-52, SAMPLE-53, SAMPLE-56   A task can carry a due date
  …
accepted as is / edited / rejected, or go through the tickets and the release mode? [a/e/r/t]
```

`a`, `e` or `r` decide the set as it is. `t` goes through it:

| Key | For each ticket | What happens |
|---|---|---|
| Enter or `k` | keep it | nothing (the default) |
| `d` | drop it, with a one-line reason | MIRAI removes its file, renders the epic again, lints and traces the set, and shows the screen again. A drop that leaves an FR, NFR or AC uncovered is shown and undone. Dropping a ticket another one comes after (`after`) is refused, naming both: change that one instead. Vera's result still stands while the set covers what it covered. |
| `c` | change it: merge (`m`), split (`s`) or another change (`c`), with your note | nothing is signed; your notes go to `ticket-notes.md`, and the screen ends with `/mirai tickets <initiative>`. Tess's next run takes them (its step is `notes`, a new cycle for Vera), Vera checks the new set, and you approve it. |

Then the release mode: Enter keeps it, `s` switches it (`per-ticket` ↔ `together`) and asks why.
When everything is kept you sign once: one line over the epic and every ticket, with the release
mode (`release_mode`, and `release_reason` when you switched it) and the tickets you dropped.

Every drop and change is a signed `ticket_decision` line in the journal, with your reason, the
epic and the screen's round. `mirai show <initiative>` lists them, and the release mode the set
was signed with (design/13 §2, "Ticket decisions").

**After your signature** MIRAI publishes the initiative and merges its docs MR (38's `mirai docs
merge`), the only merge it ever makes: documents only. When the host still holds it (checks
running, a required review), it says what for, and `mirai docs merge <initiative>` tries again. A
tracker publish comes with the tracker connectors (none is built yet).

**The quick track.** `/mirai-new` with a `quick` answer → one ticket by hand → your approval of the
ticket (the lint, Vera, your signature) → MIRAI's build → your merge of its code MR. Its plan gate
is `auto` for a normal-risk ticket (a high-risk one, protected paths, new dependencies or changed
tests still need you); until MIRAI can sign an automatic approval (unit 55) the plan still waits
for you, and says why.

## Approving a lone ticket

Every story or bug with no epic needs Vera's result for it as it is now before you approve it
(`mirai verify <file>`), whoever wrote it; a ticket of an epic is checked and approved with its
epic. One that links its interview is linted as at approval too.

- **Tess's own** (a `tess_run` line of MIRAI's names it): her must-fix findings go back to her
  within the rounds, as for any document.
- **Yours** (no `tess_run` names it): right after Vera's first check you may **approve anyway**
  with must-fix findings open; the screen shows each one, and the signed line records her result.
  Or `mirai tickets fix <KEY>` first.

## Acceptance criteria a reviewer can test

The lint fails an AC nobody could test (`ac-untestable`). Each AC is "Given … when … then …", or a
plain sentence whose outcome can be observed. Its outcome (the "then" part) names no vague word
without a number: `fast`, `reliable`, `reliably`, `properly`, `correctly`, `as expected`,
`appropriately`, `smoothly`, `seamlessly`, `quickly` and the writing rules' other vague words. The
fix is to say what the reviewer sees: a value, a screen, a record, a log line.

```text
AC-SAMPLE-55.1: reminders are sent reliably                                  fails
AC-SAMPLE-55.1: Given a task due tomorrow, when the reminder job runs at
  18:00, then one email is sent to the assignee                             passes
AC-SAMPLE-60.1: the log entries in GCP use the structure in ADR-12          passes (system-facing)
```

## Priority and order

Two things, kept apart (Jet's decision 5):

- **`priority`:** `high`, `normal` (the default) or `low`, on every ticket. Tess proposes it (an
  urgent bug is `high`); you set it at approval. Every `high` ticket is listed under the epic's
  "Decisions for you", or the epic lint fails.
- **`order`:** within an epic, Tess numbers the tickets: the tracer bullet `1`, then the one she's
  least sure of, then the rest.

The epic's ticket table (generated) shows each ticket's type, size, risk, priority, order and how
many tickets it **blocks**: every ticket whose `after` chain reaches it.

## The run's pick

Among the ready tickets (approved, not done, every `after` ticket done), the run takes:

1. the one that blocks the most other tickets, counted through the whole `after` chain (done ones
   no longer count);
2. then the highest priority;
3. then the epic's order;
4. then the earliest approval.

So a ticket three others wait for goes first, and an urgent bug that blocks nothing goes before
every other ticket that blocks nothing. `mirai show <initiative>` lists the ready tickets in this
order. The night run (unit 55) takes them the same way.

## Ticket types

Each project names its own ticket types, as its tracker does (`[[tickets.types]]`,
[config.md](config.md)). With none, MIRAI's three apply: Story, Bug and Investigation.

```toml
[[tickets.types]]
name = "Task"
description = "Work to build: code and tests."
runs_as = "change"

[[tickets.types]]
name = "Spike"
description = "A question to answer before we build."
runs_as = "investigation"
tracker_type = "Spike"

[[tickets.types]]
name = "Tech Debt"
description = "Clean-up that changes no behaviour."
runs_as = "change"
template = "tech-debt"
```

- **The description is what Tess reads** to choose a ticket's type: say what the type is for and
  when to use it. A ticket names its type in `ticket_type`.
- **Every type runs as one of MIRAI's behaviours:** `change` (a story: code and tests), `bug` (a bug:
  a test that reproduces it first) or `investigation` (research and a written finding, no code
  merge). A type can't invent a new way to run: a new behaviour is a MIRAI change, never a setting.
  The lint fails a ticket whose type runs as another document type than its own.
- **The config check refuses** a type with no description, an unknown `runs_as`, and two types
  with one name, naming the problem.
- **A type's own template:** `.mirai/custom/ticket-types/<name>.toml`
  (`kind = "ticket-type-overlay"`, `schema_version = 1`, `name`, `base = "story"` or `"bug"`) with
  `<name>.md` beside it. It is checked like a replacement template: it must keep every protected
  section and field of its base type. You approve it like any overlay (`mirai approve --file
  .mirai/custom/ticket-types/<name>.toml`); until then MIRAI's template is used.
- **An investigation isn't run yet.** Its run (the research, the finding) is unit 42b; until it is
  built, `mirai plan` and `mirai run` refuse one, with the reason.

## New critical journeys

When a feature creates a critical journey, Tess writes it under the epic's "New critical
journeys", in `journeys.md`'s own form, and lists it under "Decisions for you" with the ticket that
builds it. Approving the set adds it to `.mirai/context/journeys.md` and approves `journeys.md` as
it then is, in the same step: a second signed line. Commit it with the set.
