# Architecture decisions (ADRs)

An ADR (architecture decision record) records one hard decision: the options, the rejected ones
too, the choice and its cost. It belongs to the project, not to a feature, and it outlives the
feature that raised it. MIRAI's ADR is MADR 4.0.0 at its core, with a one-sentence summary and a
required Confirmation (unit 61).

The design document says **how**: the HLD on `full` (unit 62), the technical note on `standard`
(unit 62b). An ADR says **why**, for one decision. The LLD (unit 63) holds no decisions. The HLD
and the note carry a Decisions list, one line each, or a link to the ADR.

## When to write one

Only for a decision that passes the gate. Name each test it passes in `gate`:

| Test | The decision … |
|---|---|
| `hard-to-reverse` | would cost real work to undo (a data model, a storage engine) |
| `cross-cutting` | touches two or more components |
| `nfr` | changes how a non-functional requirement is met |
| `external` | adds an external dependency or interface |
| `first-of-kind` | is the first of its kind in the project |

Anything else is one line in the HLD's or the note's Decisions list. An initiative should rarely
need more than 2 ADRs on `standard` and 3 on `full`. Over that, Vera names the ADR that could be a
line instead, as a decision for you: keep it, or make it a line at the approval. Nothing is
refused automatically.

## The template

`mirai show template adr` shows it as your project uses it. About one page: the lint warns past
600 words and fails past 900.

| Part | What it holds |
|---|---|
| frontmatter | `status` (`proposed`, written by the author; the others only by MIRAI), `date`, `decision_makers`, `confidence` (`high`, `medium`, `low`), `gate`, `initiative`, `supersedes`; MIRAI writes `superseded_by` and `status_reason`; `components` (optional) names what it governs |
| `PRD:` line | under the title: the PRD of the initiative it serves (required when `initiative` is set); the FR and NFR IDs it cites must be that PRD's |
| Summary | one Y-statement, at most 80 words: "In the context of …, facing …, we decided for … to achieve …, accepting …" |
| Context and problem | what forces the decision now, citing the FR and NFR IDs it serves |
| Options considered | at least two real options, each a `###` heading with "Good, because …" and "Bad, because …" bullets |
| Decision | "We chose X because …" |
| Consequences | Good, Bad and Neutral bullets; at least one Bad |
| Confirmation | how compliance is checked: `check: <a check in [checks]>`, `test: <the ADR's id>` (a test named `test_adr_0007_…`) or `review: <what the reviewer checks>` |
| Revisit when | optional: the measurable triggers that would reopen it |
| Links | optional: the HLD or note section, the ADR it supersedes, a spike |

## Writing one

```sh
mirai adr new reminder-queue --initiative due-dates   # the next number, the template, status proposed
mirai lint docs/decisions/ADR-0001-reminder-queue.md
mirai verify docs/decisions/ADR-0001-reminder-queue.md
mirai approve ADR-0001 --file docs/decisions/ADR-0001-reminder-queue.md
```

Until Arlo, the architect (unit 64), exists, you write ADRs by hand or in your session with the
`mirai-write` skill (`/mirai adr new` gives the file). They still go through the lint, Vera and your
approval.

## Approving one, and the status in the file

`mirai approve <adr-id> --file <path>`, in a real terminal: the lint as at approval, then Vera's
result, then you, `[a/r]`. A rejection needs a reason, one line. The ADR is the one MIRAI type that
keeps its status in the file, because people and tools read ADRs outside MIRAI. Only MIRAI writes
it, at your signature:

- **accepted:** MIRAI writes `status: accepted` into the file and signs those exact bytes. If the
  ADR has `supersedes: ADR-0003`, the old one becomes `superseded` with `superseded_by`, and both
  files are in your one signed line.
- **rejected:** `status: rejected` and your reason (`status_reason`). The ADR stays in the folder,
  so the same option isn't proposed again.

Every approval renders the index again. Commit the ADRs and the index. The pre-commit hook refuses
an ADR whose status is anything but `proposed` unless the bytes are ones you signed. On the design
workflow (unit 65) your approval of the HLD signs its ADRs on the same screen.

An initiative's ADR is published with its documents, and its docs merge request carries it, any ADR
it superseded and the index ([stores.md](stores.md)). The merge checks each one against your signed
line.

## Accepted is final

An accepted ADR takes only typo and link fixes. Every section keeps its words, apart from small
spelling fixes. The pre-commit hook, the approval and the docs merge refuse anything more, with
"supersede it". A change of decision is a new ADR with `supersedes: <the old id>`
(`mirai adr new <slug> --supersedes ADR-0003`). Approving it marks the old one superseded.

## The index

`docs/decisions/README.md` lists every ADR: number, title, status, date and what superseded it.
MIRAI writes it (`mirai adr index`, and at every approval). `mirai lint` fails while it doesn't
match the files. When the folder already has a `README.md` of the project's own (a usage note, say),
MIRAI leaves it alone and writes its index to `index.md` instead.

## Your project's own ADRs

`[adr] folder` and `[adr] numbering` in `.mirai/config.toml` ([config.md](config.md)) say where
ADRs live and how they're numbered. The defaults are `docs/decisions` and `ADR-0001`. When the
project already has ADRs, `mirai detect` (run by `mirai setup`) finds the folder and drafts both
from the files there. A folder of `adr-0001-….md` files continues at `adr-0002`. The existing ADRs
are indexed as they are, `accepted` unless they say otherwise, and MIRAI never rewrites them.

A project can change the template, add to it, or use its own, through an overlay with a rename map
([overlays.md](overlays.md)): a project's "Validation" can stand for "Confirmation". The core
sections the lint reads can't be dropped.

## What agents read

Every launch that has the project's documents as inputs gets the index (`adr-index.md`). The plan
(Kai), the review (Rex) and the ticket planner (Tess) also get the full text of the accepted ADRs
that touch the work: the initiative's own, the ones a ticket is `governed_by`, the ones whose
`components` the work names, and the last three accepted. A rejected or superseded ADR is never
given in full.

Their prompts say: accepted is binding; a rejected option isn't proposed again without new
evidence; superseded is history. A conflict with an accepted ADR stops the agent:

- Kai answers `ADR-CONFLICT: <id>: <why>` instead of a plan, and the ticket parks `adr-conflict`.
  You change the ticket or supersede the ADR, then `mirai unpark <ticket> --retry` sends it back
  for a new plan.
- Tess pauses with the question.
- Rex checks each change against the Confirmation of every ADR he's given. A change that breaks an
  accepted decision is a blocking finding with that ADR as its basis.

## Confirmation, checked by trace

`mirai trace <initiative>` follows each ADR's Confirmation ([trace.md](trace.md)):

- `check: <name>`: linked when `[checks]` has it;
- `test: ADR-0007`: linked when a ticket of the initiative passed the gate with a test whose name
  starts with the ADR's id. It stays pending until a ticket ships.
- `review: …`: linked, and the reviewer checks it.

A Confirmation that names nothing MIRAI can find is a missing link.

## Reviewing them: `mirai adr review`

```sh
mirai adr review            # each accepted ADR with its Revisit triggers: still true (k) or deprecated (d)
mirai adr review ADR-0003   # one
mirai adr review --list     # the list only, nothing signed (/mirai adr review in your session)
```

A deprecated ADR keeps your reason in the file. Each answer is signed (`adr_review`). The release
record (units 60 and 67) calls it.

## In your session

`/mirai adr` (the list), `/mirai adr index`, `/mirai adr new` (with `slug`, and optionally
`initiative` and `supersedes`) and `/mirai adr review` (the list). Approving an ADR and marking one
deprecated are signed in your terminal.
