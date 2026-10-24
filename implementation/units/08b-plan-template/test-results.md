---
unit: "08b"
name: plan-template
date: 2026-10-24
node: v22.23.2
result: 140 / 140 pass (earlier units' 133 + unit 08b's 7), after the review fixes; 3 full runs in a row green
---

# Unit 08b — Test results

## Run

`npm test` (scoped to `test/**/*.test.js`), after the review fixes (`review.md`). The new file:

```
T2 (plan): the filled example plan lints clean through lintText; the template's own lines are leftovers
T6: every AC has a row with a level and a Test ID; levels from the config; no-test needs a reason; kinds follow tdd
T7: a characterization test names, in Symbol, a symbol the Code map marks "change"
T8: a new dependency makes the ticket high risk; declared changes have a fixed format
T9: the frozen block: markers, what sits between them, and nothing hidden or left after them
T10: the approval covers the frozen block, the declared changes and the key fields, for one ticket
T11: registry: may_be_empty and frozen_sections name listed sections; frozen ones come first
# tests 140
# pass 140
# fail 0
```

Three full runs in a row: 140/140 each.

**On MIRAI's own repo:** `mirai lint` gives "6 files, 0 problems, 0 warnings, 83 skipped". The
six are the three templates and the three examples.

**Earlier tests changed:** `test/lint/templates.test.js` T1 now expects the three types,
`story`, `bug` and `plan`.

## The roadmap's "done when", mapped (08b's share)

| Done when | Test |
|---|---|
| a filled example lints clean | T2 (the example plan through `lintText`) |
| an AC without a level is flagged | T6 (`plan-level`: an empty level, no row, a level not in the config) |
| a characterization test for an unchanged symbol is flagged | T7 (symbols marked `add`, `read` or not listed) |
| an edited frozen block fails verification | T10 (one word inside the block; also declared changes and key fields) |
| a new dependency raises the risk | T8 (`plan-risk` until `risk: high`) |

## What came up while testing

1. **Linting the example plan as text flagged its table headers** as leftovers, because every
   plan has the template's headers. Prescribed structure is now left out.
2. **A row hidden by a leading comment** left eight spaces once the comment was blanked. The
   reader took the line for indented code and skipped it silently. A comment is now checked
   before indentation.
3. **My column and order counts were off a few times:** `acs` is at column 6, and problems
   come in line order.
