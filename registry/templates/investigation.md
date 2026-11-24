---
id: PMT-1
type: investigation
template: investigation@v1
ticket_type: Investigation
repo: "."
risk: normal
size: S
priority: normal
order: 1
verify: "One sentence: what a reader checks in the finding to call the question answered."
covers_fr: []
covers_ac: []
after: []
epic: PMT-10
---
<!--
The investigation template (MIRAI, unit 42). Replace every line below; keep the headings. mirai
lint flags any line, the id or the verify sentence left word for word from this template.
- An investigation answers one question with research and a written finding; it merges no code.
  Its run (the research, the finding) is unit 42b: until then MIRAI refuses to start one.
- The planner writes the question, the criteria and where to look; "Looked at", "Finding" and
  "Next steps" are the investigation run's: until then each holds the one line
  "Not applicable — written by the investigation run."
- Frontmatter: as a story's (ticket_type is one of the project's types that runs as an
  investigation, such as Spike); no e2e, tdd or tests: nothing is built.
-->
# The question this investigation answers, in a few words

## Question

<!-- done when: one or two sentences ask one question, and say which decision waits on the answer -->
The one question, and the decision that waits on its answer.

## Acceptance criteria

<!-- done when: each criterion names what the finding must state, with its own ID (AC-<id>.n), so a reader can tell the question is answered -->
- AC-PMT-1.1: What the finding must state
  - Given the state of things the question is about
  - When the research is finished
  - Then the finding names the answer and the evidence for it

## Looked at

<!-- done when: lists what was read, run or measured, each with where it is -->
Not applicable — the investigation run lists what it read here, later.

## Finding

<!-- done when: answers the question in a few sentences, each claim pointing at a source below -->
Not applicable — the investigation run writes its finding here, later.

## Next steps

<!-- done when: says what to do with the answer: the tickets to write, the decision to take, or nothing -->
Not applicable — the investigation run says what to do next here, later.

## Sources

<!-- done when: points at each place to start: a document, a dashboard, a file in the repo, a person -->
- Where to start looking, with its link.

## Notes

<!-- done when: holds only what isn't in the repo or the sources -->
Not applicable — replace this line with notes, or say why there are none.
