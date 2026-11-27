# The LLD (low-level design)

On the `full` track, the LLD holds the exact shapes the tickets of one initiative share: the names,
the contracts, the schema changes and their failures, so tickets built in parallel agree (unit 63).
It's a contracts document, not a classic LLD: no narrative, no decisions, no alternatives, no
ticket breakdown. The HLD decides; the LLD gives the shapes those decisions need.

It's written only where it is needed: the HLD says `lld: required` with the triggers that fire (a
stored entity or field, an external contract, several modules that could pick different shapes, a
non-trivial state machine), or `lld: not-required` with a reason ([hld.md](hld.md), "The `lld`
field"). Without `required`, Tess doesn't wait for one.

```
docs/mirai/due-dates/
  prd.md
  hld.md
  lld.md          # HLD: [<the HLD's title>](hld.md) under its title
```

`mirai show template lld` shows it; `registry/examples/lld.md` is a filled one.

## The sections

**Always:**

| Section | What it holds |
|---|---|
| Scope | three to five sentences: what these shapes serve, citing the PRD's FR and NFR IDs, the HLD's `D-n` lines and the ADRs, nothing restated |
| Names | one row per identifier more than one ticket uses: its spelling, what it is, where it lives |
| Failures | one row per failure case: how it is detected, how it is handled, what the user sees |
| Test map | one row per acceptance criterion in scope and per failure: its level, the seam it is tested at, the case in one line; no test code |
| Open questions | empty when you approve |

**When its trigger fires**, else one line `Not applicable — <why>`:

| Section | What it holds |
|---|---|
| Contracts | one table per contract `C-n` (its operation, typed request and response), its failure rows (status or exit code, machine code, retryable), and for a write a line `Retry:` saying how a retried call stays safe; one error shape for all |
| Schema changes | one row per change `S-n`: table and column, type, null, default, index, migration, rollback, backfill |
| Flows | a `sequenceDiagram` per flow across modules the HLD doesn't already show |
| State and algorithms | a state machine or algorithm no single ticket owns |

**Delta only:** Security, Observability, Rollout: "as the HLD says", or only what's new.

A project that writes OpenAPI, JSON Schema, proto or SDL may put a fenced fragment in place of a
contract's table.

## The lint, Vera, the length

The lint checks the sections; that every contract has failure rows and every write a `Retry:` line;
that every schema change has its migration, rollback and backfill; each name once; the test map
covers every failure row and every AC of the PRD's FRs and NFRs its Scope cites (all of them when it
cites none); every `D-n` it cites is the HLD's; no Decisions or Alternatives section; Open questions
empty at approval; `(open)`. Prose (tables and code blocks don't count) warns past 2,500 words
(`[docs.limits] lld_warn_words`) and fails past 4,000 (`lld_words`).

Vera checks what needs judgement: could a builder implement it without guessing where a wrong guess
would matter; the shapes match the HLD's components and flows and the code at the files it names;
every non-obvious choice cites a `D-n` or an ADR; hidden limits, re-runs, the security surface.

## Approving it

`mirai approve <id> --file docs/mirai/<initiative>/lld.md`, once the HLD is approved as it is now and
says `lld: required`: the lint (with the PRD beside it, for the test map), Vera's result, then you;
one signed line (`kind: lld`). Then the initiative is published, and the offer to start Tess follows
when the track's inputs are complete. From unit 65 the design set (the HLD, its ADRs and the LLD) is
approved in one sitting.

## What follows it

- **Tickets cite it.** A story or bug names the items it builds in `uses` (`uses: [C-1, S-1]`). The
  ticket lint refuses an ID the LLD doesn't have; the epic's lint refuses an LLD item no ticket uses.
- **Kai and Rex.** Kai's plan gets the approved LLD and builds the items its ticket uses exactly as
  given. Rex checks the code against them: a difference is a finding whose basis is that `C-n` or
  `S-n`.
- **Frozen after the ship.** Once every ticket of the initiative is merged into the integration
  branch, the pre-commit hook refuses a change to its `lld.md`: the code owns the shapes, and a
  later change belongs to a new initiative's LLD.
