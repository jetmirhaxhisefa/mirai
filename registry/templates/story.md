---
id: PMT-1
type: story
template: story@v1
repo: "."
risk: normal
size: S
verify: "One sentence: how a person or a test checks that this works."
covers_fr: []
covers_ac: []
governed_by: []
after: []
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
  (AC-FR-n.m, AC-NFR-n.m) this story delivers, empty on the quick track; tdd and tests only
  when they differ from the project's setting.
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
