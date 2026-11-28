---
id: initiative-design-decisions
type: design-decisions
template: design-decisions@v1
owner: you
created: "2026-01-01"
initiative: initiative
research: research.md
---
<!--
The design decisions template (MIRAI, unit 65b). Your session writes it as you decide, one question
at a time (/mirai design --explore <initiative>, part 2); you don't edit it by hand.
- Decisions: one "### Q-n: <the question>" per question of research.md, with
  "- **Options:** A: … [S-n]; B: … [S-n]" (citing research.md's sources),
  "- **Pick:** A" or "- **Pick:** (Arlo's call)", "- **Reason:** …" (your words; not needed for
  Arlo's call), "- **Hard to reverse:** yes" or "no" (and why, if it helps). A pick that is hard to reverse becomes a draft
  ADR (`proposed`), which the architect completes and you sign at the design set's sitting.
- Log: "- <YYYY-MM-DD> Q-n: <your answer, as you gave it>", one line per answer, in order.
The architect's run 1 follows every pick, and Vera's set check checks that he did.
-->
# Design decisions: the initiative

## Decisions

### Q-1: A background job or a synchronous import for CSV files of up to 200 MB?

- **Options:** A: a queued job in chunks [S-1]; B: a synchronous import [S-2]
- **Pick:** A
- **Reason:** our largest customer files are 150 MB.
- **Hard to reverse:** no, the import can move to the queue later

## Log

- 2026-01-01 Q-1: A, the largest files are 150 MB.
