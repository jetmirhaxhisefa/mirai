---
id: initiative-lld
type: lld
template: lld@v1
owner: mirai-architect
created: "2026-01-01"
upstream: [initiative-hld]
---
<!--
The LLD template, a contracts document (MIRAI, unit 63). Replace every line below; keep the
headings. mirai lint flags any line or the id left word for word from this template.
- What it is: the exact shapes several tickets share (names, contracts, schema changes, failures),
  so tickets built in parallel agree. Written only when the HLD says `lld: required`.
- No narrative, no decisions (cite the HLD's D-n lines and the ADRs), no alternatives, no ticket
  breakdown. Every contract is C-n and every schema change S-n: tickets cite them in `uses`.
- Typed: every field with its type, required or optional, and its constraints. A project that uses
  OpenAPI or JSON Schema may put a fenced fragment in place of a table.
- A section whose trigger doesn't fire keeps one line: Not applicable — <why>.
- About 2,500 words of prose; tables and code blocks don't count.
- No status field: the store holds the LLD's status.
-->
# The feature's contracts, in a few words

<!-- done when: the line links the HLD this LLD details, by its title -->
HLD: [The HLD's title](hld.md)

## Scope

<!-- done when: three to five sentences say what these shapes serve, citing the PRD's FR and NFR IDs, the HLD's D-n lines and the ADRs, nothing restated -->
The shapes the tickets of this initiative share, for FR-1 and NFR-1, as the HLD's D-1 decides.

## Names

<!-- done when: one row per identifier more than one ticket uses: its exact spelling, what it is, and where it lives -->
| Name | What it is | Where |
|---|---|---|
| `due_date` | the task's due day | the tasks table, the API, the list |

## Contracts

<!-- done when: one table per contract: a row C-n naming it, then its fields (type, required, constraints), its failures (status or exit code, machine code, retryable), and for a write the line "Retry:" saying how a retried call stays safe; one error shape for all -->
| ID | Operation | Request | Response |
|---|---|---|---|
| C-1 | `PUT /api/things/{id}` | `name`: string, required, at most 120 characters | 200, the thing |

| Failure | Status | Code | Retryable |
|---|---|---|---|
| the name is missing | 422 | `name_required` | no |

Retry: the same request twice leaves the thing as the first one did.

## Schema changes

<!-- done when: one row per change S-n: the table and column, its type, null, default, index, then its migration, rollback and backfill -->
| ID | Change | Type | Null | Default | Index | Migration | Rollback | Backfill |
|---|---|---|---|---|---|---|---|---|
| S-1 | `things.name` | string(120) | no | none | no | adds the column | drops it | none: a new table |

## Flows

Not applicable — the flows across modules are the HLD's, and no contract adds a new one.

## State and algorithms

Not applicable — no state machine or algorithm is shared between tickets.

## Failures

<!-- done when: one row per failure case: how it is detected, how it is handled, what the user sees -->
| Case | Detected by | Handled by | The user sees |
|---|---|---|---|
| the name is missing | the request check | refusing the write | "A name is required." |

## Test map

<!-- done when: one row per acceptance criterion in scope and per failure row: the AC or failure, the test level, the seam it is tested at, and the case in one line; no test code -->
| AC or failure | Level | Seam | The case |
|---|---|---|---|
| AC-FR-1.1 | feature | `PUT /api/things/{id}` | a thing renamed keeps its new name |
| the name is missing | feature | `PUT /api/things/{id}` | an empty name answers 422 with `name_required` |

## Security

Not applicable — as the HLD says.

## Observability

Not applicable — as the HLD says.

## Rollout

Not applicable — as the HLD says.

## Open questions

<!-- done when: empty when you approve: each open point settled in the sections above, or asked in interview.md -->
