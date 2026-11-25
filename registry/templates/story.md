---
id: PMT-1
type: story
template: story@v2
ticket_type: Story
repo: "."
risk: normal
size: S
priority: normal
order: 1
verify: "One sentence: how a person or a test checks that this works."
covers_fr: []
covers_ac: []
governed_by: []
after: []
epic: PMT-10
files_likely: []
e2e: false
---
<!--
The story template (MIRAI). Replace every line below; keep the headings. mirai lint flags any
line, the id or the verify sentence left word for word from this template.
- A story is a vertical slice: it touches each layer it needs and has one runnable check. One
  agent session plans and finishes it, and its diff reviews in about 15 minutes (S, M or L).
  Anything bigger is split, never shrunk: "for now" and "wired later" are a second story.
- Frontmatter: id is the ticket key, and the file is tickets/<id>.md; repo is a name from
  [[repos]] in .mirai/config.toml; covers_fr and covers_ac list the PRD's FR/NFR and AC IDs
  (AC-FR-n.m, AC-NFR-n.m) this story delivers, empty on the quick track; an NFR it delivers is
  cited by its ID (NFR-n) in covers_fr; epic is the epic's id, and a lone ticket (asked for by
  hand) has no epic line but an "Interview:" line under its title; tdd and tests only when they
  differ from the project's setting, as a proposal for you.
- ticket_type is one of the project's ticket types (mirai config show: tickets.types; Story by
  default); priority is high, normal or low (normal unless it's urgent: you set it at approval);
  order numbers the epic's tickets, the tracer bullet first, then the one least certain.
- No status field: the store holds the ticket's status.
- An optional section that doesn't apply keeps one line: Not applicable — <the reason>.
-->
# What exists or works when this is done

## Description

<!-- done when: two to four sentences say what the user can do, end to end, and how it moves the epic forward; the criteria carry the proof, so this doesn't repeat them -->
What the user can do when this ships, end to end.

## Acceptance criteria

<!-- done when: each criterion has its own ID (AC-<id>.n), a short name, and Given / When / Then; each states a rule, not one example, and the failure paths have their own criteria -->
- AC-PMT-1.1: Short name of the behaviour
  - Given the state before: data, user, settings
  - When the one action
  - Then what a person or a test can observe

## Boundaries

<!-- done when: names the nearby behaviour a valid change could break, as behaviour, not files -->
Not applicable — replace this line with the behaviour that must not change, or say why there is none.

## References

<!-- done when: points at the nearest document for each source: the PRD section, the design, the epic -->
Not applicable — replace this line with links, or say why there are none.

## Notes

<!-- done when: holds only what isn't in the repo or the sources: decisions with a date, assumptions to confirm, open questions this ticket waits on -->
Not applicable — replace this line with notes, or say why there are none.
