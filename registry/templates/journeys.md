---
id: product-journeys
type: journeys
template: journeys@v1
owner: product-owner
updated: "2026-01-01"
---
<!--
The critical journeys template (MIRAI, unit 36). It lives at .mirai/context/journeys.md, beside
the feature map. A critical journey is a flow that loses users or money when it breaks: few of
them, each with an end-to-end test. Replace every line below; keep the headings. mirai lint flags
any line or the id left word for word from this template.
- Each journey is ### J-n: <what the person gets done>, numbered J-1, J-2, J-3 … with no gap.
- Steps: a numbered list, one action per step. Name each screen in bold, as the feature map names
  it (the lint warns on a screen it doesn't know).
- Why critical: who is stopped, or what money is lost, when it breaks, with its source (S-1).
  No source says it? End the line with (open) and ask the person; it can't be approved open.
- E2E test: the test file in backticks, from the repo's top folder, or "none yet".
- You approve the whole file (mirai approve --file .mirai/context/journeys.md).
-->
# Critical journeys: the product's name

## Journeys

<!-- done when: each flow that loses users or money when it breaks is here, most important first, and no other -->
### J-1: What the person gets done

Steps:

1. On **Start**, the first thing the person does.
2. **Result** shows what they came for.

Why critical: who is stopped, or what money is lost, when it breaks (S-1).

E2E test: `e2e/the-journey.spec.ts`

## Sources

<!-- done when: each ID cited above is one row; Where is a link, a file in backticks or "you said"; Date is when it was read or said -->
| ID | Source | Where | Date |
|---|---|---|---|
| S-1 | The owner, in setup's interview | you said | 2026-01-01 |
