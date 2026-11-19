---
id: initiative-brief
type: brief
template: brief@v1
track: standard
owner: mirai-product-manager
created: "2026-01-01"
upstream: []
---
<!--
The business brief template (MIRAI, unit 31). Replace every line below; keep the headings. mirai
lint flags any line or the id left word for word from this template.
- Two readers. "Summary for approval" is for the person who approves: what is asked, why, what
  changes, what they must decide, and what is left out. Write it LAST, from the finished detail,
  in at most 400 words, and say nothing the detail doesn't hold. Everything after it is the
  detail the agents work from: it must be complete enough that the PRD needs no guessing.
- Plain sentences of 25 words or fewer; no "leverage", "seamless", "etc." or "fast" without a
  number. Spell out an acronym the first time.
- IDs: SM-n (success metrics), BR-n (business requirements), NG-n (no-gos), R-n (rabbit holes),
  Q-n (open questions), numbered 1, 2, 3 with no gap. Mention them anywhere; define each once.
- No status field: the store holds the brief's status.
- An optional section that doesn't apply keeps one line: Not applicable — <the reason>.
-->
# The outcome this initiative buys, in a few words

## Summary for approval

### The ask

<!-- done when: one sentence of at most 30 words starts with Approve, Decide or Note, and names what is approved and the outcome it buys (bottom line up front) -->
Approve the initiative named here, to reach the outcome stated in SM-1.

### Why

<!-- done when: two to four sentences say who has the problem, what it costs them and why now; each claim points to its source, a detail ID or a detail section ("see Problem"); an assumption says "Assumption:" -->
Who has the problem, what it costs them today, and why it matters now.

### What changes

<!-- done when: three to seven bullets say what a user or the business does differently; each ends with the IDs it sums up -->
- What a user can do that they can't today (BR-1)
- What the business sees change, and by how much (SM-1)
- What stays as it is, if the reader would worry about it (BR-1)

### Decisions for you

<!-- done when: each item is a question, two or three options, the recommendation and its main cost, and the ID it rests on; or one line: None — <why nothing needs your call>. The heading is the list's lead-in: no extra line is needed -->
1. The question the approver must answer (Q-1)? Options: the first option, or the second option. Recommendation: the first option, because of its main benefit; it costs this.

### Not in this

<!-- done when: each bullet is something left out, with a short reason and its NG-n -->
- Something a reader might expect, left out for a stated reason (NG-1)

## Problem

<!-- done when: names who has the problem, what it costs them today, and the strongest evidence with its source; an assumed problem says "Assumption:" (Lenny: Problem; Shape Up: Problem) -->
The problem, the people who have it, what it costs them, and the evidence for it.

## Who it is for

<!-- done when: names the first real user or role, the situation they're in, and what they want to get done; "everyone" fails (Lenny: Audience; job stories) -->
The first users, their situation, and what they want to get done.

## Why now

<!-- done when: says what changed that makes this worth doing now, with a source (Lenny: Why) -->
What changed that makes this worth doing now.

## Success

<!-- done when: each SM-n row has a metric, a baseline (or UNKNOWN), a target, how it's measured, and a counter-metric: what must not get worse (Lenny: Success) -->
| ID | Metric | Baseline | Target | How measured | Counter-metric |
|---|---|---|---|---|---|
| SM-1 | The metric that shows the outcome | Today's value, or UNKNOWN | The value that means success | Where the number comes from | What must not get worse |

## Business requirements

<!-- done when: each BR-n is an outcome the business needs, with its source; none names a screen, a field or an API (those are the PRD's) -->
- BR-1: An outcome the business needs, in one sentence. Source: where it comes from.

## Appetite and track

<!-- done when: states the time worth spending on this (an appetite, not an estimate) and the proposed track, quick, standard or full, with a one-line reason; the track matches the frontmatter (Shape Up: Appetite) -->
Appetite: the time worth spending before this stops being worth it. Track: standard, because of a one-line reason.

## No-gos

<!-- done when: each NG-n is something deliberately left out, with its reason (Shape Up: No-gos) -->
- NG-1: Something deliberately left out, and why.

## Rabbit holes

<!-- done when: each R-n is a known risk or hard part, with how it's handled or "becomes a no-go"; or Not applicable — <reason> (Shape Up: Rabbit holes) -->
- R-1: A known risk or hard part, and how it's handled.

## Hard questions

<!-- done when: the two or three questions a sceptic would ask, each answered; needed when the work faces customers outside the company, else Not applicable — <reason> (Amazon PR/FAQ) -->
Not applicable — say why no customer outside the company is affected.

## Sources

<!-- done when: every source cited above, with a link or a path -->
- The source of the evidence above, with its link or path.

## Open questions

<!-- done when: each Q-n has who answers it and what it blocks; none is left when the brief is approved -->
- Q-1: A question still open, who answers it, and what it blocks.
