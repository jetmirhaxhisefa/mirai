---
id: PMT-1
type: bug
template: bug@v2
ticket_type: Bug
repo: "."
risk: normal
size: S
priority: normal
order: 1
verify: "One sentence: how a person or a test checks that the bug is gone."
covers_fr: []
covers_ac: []
governed_by: []
after: []
epic: PMT-10
files_likely: []
e2e: false
---
<!--
The bug template (MIRAI). Replace every line below; keep the headings. mirai lint flags any
line, the id or the verify sentence left word for word from this template.
- Frontmatter: id is the ticket key, and the file is tickets/<id>.md; repo is a name from
  [[repos]] in .mirai/config.toml; covers_fr and covers_ac (AC-FR-n.m, AC-NFR-n.m) only when
  the bug breaks a PRD requirement; epic is the epic's id, and a lone bug (asked for by hand)
  has no epic line but an "Interview:" line under its title; tdd and tests only when they differ
  from the project's setting.
- ticket_type is one of the project's ticket types (Bug by default); priority is high, normal or
  low (an urgent bug is high: you set it at approval).
- No status field: the store holds the ticket's status.
- If the reproduction shows nothing is wrong, the ticket is dropped, with the evidence in Notes.
- An optional section that doesn't apply keeps one line: Not applicable — <the reason>.
-->
# What is wrong, from the user's side

## Description

<!-- done when: two to four sentences say what the user sees go wrong and what should happen instead -->
What goes wrong, and what should happen instead.

## Reproduction

<!-- done when: someone else can follow the steps; the environment, the actual and the expected values are named, with error text copied exactly -->
1. The environment and the starting state.
2. The steps, one per line.
3. Actual: what happens. Expected: what should happen.

## Cause hypothesis

<!-- done when: says where the defect probably lives and why; a hypothesis, never a prescribed fix -->
Not applicable — replace this line with a hypothesis, or say why there is none yet.

## Acceptance criteria

<!-- done when: each criterion states the fixed behaviour, from the reproduction and from each related case the fix touches; every one is proven by a test that fails on the defect and passes on the fix -->
- AC-PMT-1.1: The expected behaviour holds
  - Given the state from the reproduction
  - When the reproduction steps are followed
  - Then what should happen, happens
- AC-PMT-1.2: A related case the fix touches
  - Given the related state
  - When the same action
  - Then the behaviour there is right too

## References

<!-- done when: points at the report, logs, screenshots or sample data -->
Not applicable — replace this line with links, or say why there are none.

## Notes

<!-- done when: holds only what isn't in the repo or the sources -->
Not applicable — replace this line with notes, or say why there are none.
