---
unit: "08a"
name: ticket-templates
date: 2026-10-24
node: v22.23.2
result: 133 / 133 pass (earlier units' 126 + unit 08a's 7), after the review fixes; 3 full runs in a row green
---

# Unit 08a — Test results

## Run

`npm test` (scoped to `test/**/*.test.js`), after the review fixes (`review.md`). The new file:

```
T1: MIRAI's registry: story and bug, templates that match their types, and known checks
T2: the filled examples lint clean through mirai lint
T3: a ticket without its own AC IDs or a repo is flagged; so are an unknown repo and a status
T4: ticket fields: sizes, risk, AC and FR lists, after, e2e, tdd; PRD ACs in the text are fine
T5: {id}: a ticket's own AC kind is its own id
T6: registry: {id} only in ID patterns, known checks only, required kinds
T7: from review: ACs under another id or outside their section, leftover template text, file names
# tests 133
# pass 133
# fail 0
```

Three full runs in a row: 133/133 each.

**On MIRAI's own repo:** `mirai lint` gives "4 files, 0 problems, 0 warnings, 80 skipped". The
four files are the two templates and the two examples: they're outside the docs root, but they
have a known type and `template:`.

**Earlier tests changed:** none. The lint tests (07b) use their own fixture registry.

## The roadmap's "done when", mapped (08a's share)

| Done when | Test |
|---|---|
| a filled example lints clean | T2 (story and bug examples through `mirai lint`, before and after a config) |
| a ticket without AC IDs or a `repo` is flagged | T3 (`missing-id` for a story and a bug; `required` for `repo`) |

## What came up while testing

1. **T5 as approved couldn't hold.** With `{id}`, another ticket's `AC-PMT-13.1` isn't this
   ticket's kind, just as a PRD's isn't, so it's left to `mirai trace`. The spec's "Changes"
   #1 records it.
2. **My line counts were off by one again.** The story example's frontmatter has 14 lines.
3. **After the review, two expectations showed correct new behaviour.** Under another id, the
   old ACs are now `foreign-id`. An AC in the wrong section was reported twice, so a misplaced
   definition now still counts as defined.
