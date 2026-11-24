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
- **Her ticket keys:** `<tickets.key_prefix>-<n>`, numbered on from the highest key under the docs
  root ([config.md](config.md)). With no prefix set she doesn't start, and says how to set it.

How she cuts follows design/01 §5 and §7: vertical slices, the first a tracer bullet through every
layer and the next the one she's least sure of; "split, never shrink"; one repo per ticket; sizes
S, M and L within the caps; `e2e: true` only on a ticket that creates or changes a critical journey;
`tdd` and `tests` only as a proposal for you.

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
