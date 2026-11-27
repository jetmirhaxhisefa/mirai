# The HLD (high-level design)

On the `full` track, the HLD says how one feature is built: its components, flows, data ownership,
the rules every part follows, the answers to its NFRs, its decisions and a trace of every requirement
to a component (unit 62). It's arc42's order in MIRAI's words, with C4 levels 1–2 as Mermaid
flowcharts. You read it to approve it, in about 15 minutes; the agents read it while they build.
The next big feature gets a new one. On `standard`, the one-page technical note does this job
([documents.md](documents.md), "The technical note").

It **links ADRs and never repeats them** ([adr.md](adr.md)): a choice that is hard to reverse,
cross-cutting, about an NFR, an external dependency or the first of its kind is an ADR; any other
choice is one `D-n` line. A `D-n` line Arlo (unit 64) decided alone ends with "(Arlo's call)".

```
docs/mirai/due-dates/
  prd.md
  hld.md          # PRD: [<the PRD's title>](prd.md) under its title
```

`mirai show template hld` shows it; `registry/examples/hld.md` is a filled one.

## The sections

**Summary for approval** (at most 600 words, reader-tested): The ask, Why, What changes,
**Decisions for you**, Not in this. Each decision for you is lettered so you can answer it with one
letter: the options `A:`, `B:` (and `C:`), one marked "(recommended)", and "Written for: <letter>",
the option the document is written for.

**The core**, in this order:

| Section | What it holds |
|---|---|
| Goals and quality goals | what the design must achieve; three to five quality scenarios, each with the PRD's number and its `NFR-n` |
| Context and scope | a context diagram (`Person:`, `External:` labels); what's outside; non-goals (`NG-n`, numbered on from the PRD's) |
| Current state | what the code does today where the design touches it, each claim `path:line` or "unverified" |
| Solution strategy | the approach in a few sentences, and what isn't changing |
| Building blocks | a container diagram (`Container:` labels) and a components table: component, responsibility, owner, path (or `(new)`) |
| Key flows | one `sequenceDiagram` per key flow, with its error path |
| Data | each entity: its owner, what changes, the migration, whether it can be undone |
| Cross-cutting rules and conventions | one table of what every part follows: naming, IDs, dates, the error shape, logging, security |
| Decisions | `D-n` lines, or a link to an ADR |
| Trace table | `ID | Component(s) | Decision | Note`: every FR and NFR of the PRD, its components, its decision; `deferred: <reason>` in place of a component |
| Risks and rollout | the order of changes, a flag, what breaks if half ships, the rollback |

**Optional**, each filled or one line `Omitted: <reason>` (arc42's way): Deployment, Observability,
Failure modes, Test strategy, Constraints, Glossary.

**The `lld` field** (unit 63): `lld: required` with `lld_triggers` (`entity`, `contract`, `modules`,
`state`), when the work adds or changes a stored entity or an external contract, spans modules that
could pick different shapes, or has a non-trivial state machine; else `lld: not-required` with
`lld_reason`. Vera checks it against the design.

## The lint, Vera, the length

The lint checks the sections, the three diagram kinds, the quality goals' NFR and number, the trace
table against the PRD and the components table, the `D-n` lines and their ADR links, the cited
paths, the `lld` field, the lettered decisions, `(open)`, and the length: the summary fails past 600
words (`[docs.limits] hld_summary_words`), the whole HLD warns past 4,000 (`hld_words`: move the
detail into the LLD). Vera checks what needs judgement: every container in the table and every
component in a diagram, "two teams obey every rule and still build parts that don't fit", one owner
per piece of data, no invented connections, the cites hold, the quality goals are met, the `lld`
field is right, and a `D-n` that passes the ADR test is made an ADR.

## Approving it

`mirai approve <id> --file docs/mirai/<initiative>/hld.md`, once the PRD is approved as it is now:
the lint, Vera's result, the reader test, then you. The ADRs its Decisions link that are still
proposed are on the same screen; accepting the HLD accepts them, one signed line each. Then the
initiative is published, and the offer to start Tess follows when the track's inputs are complete.
From unit 65 the design set (the HLD, its ADRs and the LLD) is approved in one sitting.

## What follows it

`mirai trace <initiative>` reads its trace table: every FR and NFR → its component. Tess cuts the
tickets from the PRD, the HLD and its ADRs. Kai's plan gets the approved HLD; a plan that departs from
one of its `D-n` lines says so ("Departs from D-n") and is flagged at the plan gate. Rex checks the
code against its decisions.

## Your own HLD template

A project's own template works through an overlay with a rename map ([overlays.md](overlays.md)):
its section names map onto the core ("Components and ownership" for "Building blocks"), its own
extra sections stay, and a core section it lacks (the trace table, Decisions) is part of the
rendered template, so the lint, Vera and trace find it.
