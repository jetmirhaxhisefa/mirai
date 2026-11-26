---
id: initiative-tech-note
type: tech-note
template: tech-note@v1
owner: mirai-architect
created: "2026-01-01"
upstream: [initiative-prd]
---
<!--
The technical note template (MIRAI, unit 62b). Replace every line below; keep the headings. mirai
lint flags any line or the id left word for word from this template.
- What it is: how a standard-track feature is built, on one page, before its tickets are cut. The
  owner reads it in about five minutes and corrects the approach. The ticket planner cuts along its
  components; the developer's plans cite its decisions; the reviewer checks the code against them.
- Where it lives: docs/mirai/<initiative>/tech-note.md, beside the PRD it builds.
- At most 800 words. A note that needs more means the feature belongs on the full track.
- Cite the code: every component and data change names a file in backticks; a file to be created
  ends with (new). Cite the PRD's IDs (FR-n, NFR-n); never restate them.
- Decisions: one line each, D-1, D-2 … A decision that passes the ADR test (hard to reverse,
  cross-cutting, an NFR, an external dependency, first of its kind) is an ADR: link it from its line,
  and the note's approval signs it on the same screen (mirai adr new <slug> --initiative <name>).
- No status field: the store holds the note's status.
-->
# The feature, and how it is built, in a few words

<!-- done when: the line links the PRD this note builds, by its title -->
PRD: [The PRD's title](prd.md)

## Approach

<!-- done when: three to five sentences say how it is built, the main parts in the order the work goes, and what isn't changing -->
How the feature is built, in a few sentences, and what stays as it is.

## Components touched

<!-- done when: one bullet per module or file the work changes, each with its path in backticks and what changes there; a file to be created ends with (new) -->
- `src/the/module.ext`: what changes in it.

## Data changes

<!-- done when: one bullet per table, column or migration, each ending with reversible or not reversible and why; with none, one line: Not applicable — <the reason> -->
- `database/migrations/the_migration.ext` (new): the column it adds, reversible: dropping the column undoes it.

## API and contracts

<!-- done when: one bullet per new or changed endpoint, event or message, with its shape; with none, one line: Not applicable — <the reason> -->
- `GET /the/endpoint`: what it returns, and who may call it.

## Decisions

<!-- done when: each real choice as one line, D-1, D-2 …: the option chosen and the reason; a choice that passes the ADR test links its ADR instead: D-n: [ADR-0001: its title](../../decisions/ADR-0001-slug.md) -->
- D-1: The option chosen for one real choice, and the reason in a few words.

## Coverage

<!-- done when: one row per FR and NFR of the PRD, each with the component that delivers it, from Components touched -->
| Requirement | Component |
|---|---|
| FR-1 | `src/the/module.ext` |

## Risks and rollout

<!-- done when: the order the changes ship in, whether a flag guards it, and what breaks if only half of it ships -->
- The order of the changes, the flag that guards them, and what breaks if half of it ships.
