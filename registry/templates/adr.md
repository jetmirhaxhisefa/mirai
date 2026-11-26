---
id: ADR-0000
type: adr
template: adr@v1
status: proposed
date: "2026-01-01"
decision_makers: [the decision's owner]
confidence: medium
gate: [hard-to-reverse]
initiative: initiative
upstream: [initiative-prd]
owner: mirai-architect
created: "2026-01-01"
---
<!--
The architecture decision record template (MIRAI, unit 61; MADR 4.0.0 at its core). Replace every
line below; keep the headings. mirai lint flags any line or the id left word for word from this
template.
- One hard decision per ADR. Write one only when the decision passes the gate, and name each test
  it passes in `gate`: hard-to-reverse, cross-cutting (two or more components), nfr (it changes a
  non-functional requirement), external (a new dependency or interface), first-of-kind. Everything
  else is one line in the HLD's or the technical note's Decisions list.
- Where it lives: the ADR folder (docs/decisions/ unless the project has its own), named
  <number>-<slug>.md; `mirai adr new <slug> --initiative <name>` gives the next number and this
  template. MIRAI renders the index (README.md) beside it.
- `status`: write `proposed`. Only MIRAI writes the others, at your signature (mirai approve).
- About one page: past 600 words the lint warns. No design guide: the HLD or the technical note
  says how; this says why.
- Accepted is final: only typo and link fixes. To change the decision, write a new ADR with
  `supersedes: <this id>`.
- `components`: the paths or component names it governs (optional); an agent working on one gets
  this ADR in full.
-->
# Use one short sentence that states the decision

<!-- done when: the PRD of the initiative this decision serves is linked by its title; with no initiative (a project-wide decision), delete the line and the initiative and upstream fields -->
PRD: [The PRD's title](../mirai/initiative/prd.md)

## Summary

<!-- done when: one Y-statement of at most 80 words, in this order: In the context of <the situation>, facing <the concern>, we decided for <the option> to achieve <the quality>, accepting <the cost> -->
In the context of the situation this decision is made in, facing the concern that forces it, we decided for the chosen option to achieve the quality it brings, accepting the cost it has.

## Context and problem

<!-- done when: two to five sentences say what forces a decision now; every requirement it serves is cited by its ID from the PRD (FR-n, NFR-n) -->
What forces the decision, and the requirements it serves (FR-1, NFR-1).

## Options considered

<!-- done when: at least two real options, each a ### heading with its pros and cons as "Good, because …" and "Bad, because …" bullets; "Do nothing" where it fits; no option written to lose -->
### The first option

- Good, because it meets the requirement it is chosen for.
- Bad, because it costs something real.

### The second option

- Good, because it is better on another quality.
- Bad, because it misses the concern that forces the decision.

## Decision

<!-- done when: one sentence "We chose <option> because <the reason>", then at most three sentences more -->
We chose the first option because it meets the requirement that forces the decision.

## Consequences

<!-- done when: bullets starting Good, Bad or Neutral; at least one Bad: the cost you accept, honestly -->
- Good, because the requirement is met.
- Bad, because the cost named in the summary is paid.
- Neutral, because something changes that is neither better nor worse.

## Confirmation

<!-- done when: one line or more, each one of: "check: <a check in the project's [checks]>", "test: <this ADR's id>" (a test whose name starts with it, such as test_adr_0007_…), or "review: <what the reviewer checks in each change>" -->
review: each change that touches the governed component keeps the chosen option.

## Revisit when

<!-- done when: the triggers that would reopen this decision, each measurable; delete the section if none -->
- A trigger that would make this decision wrong.

## Links

<!-- done when: the HLD or technical note section, the ADR it supersedes, a spike; delete the section if none -->
- [The design section it records](../mirai/initiative/hld.md)
