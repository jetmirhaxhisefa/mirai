---
id: initiative-prd
type: prd
template: prd@v1
track: standard
variant: lite
owner: mirai-product-manager
created: "2026-01-01"
upstream: [initiative-brief]
---
<!--
The PRD template (MIRAI, unit 32). Replace every line below; keep the headings. mirai lint flags
any line or the id left word for word from this template, except "### ID prefixes", which every
PRD keeps exactly as it is.
- Two readers. "Summary for approval" is for the person who approves. On the standard track it
  covers the brief too: they read this summary and approve both documents in one step. Write it
  LAST, from the finished detail, in at most 600 words, and say nothing the detail doesn't hold.
  Everything after it is for the agents: complete enough to cut tickets and build without guessing.
- Variants: lite (standard track) is every required section. Full (full track) adds Key flows,
  Risks, Dependencies and Rollout. A lite PRD leaves those four out.
- Length: a lite PRD keeps to 2,000 words, a full one to 3,500 (the project may set others). The
  frontmatter, code blocks and the glossary's ID prefixes don't count; everything else does. Over
  the cap, split the feature into two PRDs; never drop a requirement or an AC to fit. If it truly
  can't be split, set length_exception: "<why>" in the frontmatter and ask the approver under
  "Decisions for you".
- The brief is the source of the why. Don't repeat its Problem, Who it is for, Why now or Success:
  cite its IDs (BR-n, SM-n). In the detail, the brief's no-gos, rabbit holes and open questions
  stay in the brief: mention them (NG-1, Q-1), never list them again. The summary is different: on
  standard it covers both documents, so it lists the brief's no-gos and open questions too. The PRD's own NG, R and Q numbers carry on after
  the brief's highest.
- Requirements say what and why, never how: no tables, endpoints, libraries or file names (those
  are the design's and the tickets').
- Plain sentences of 25 words or fewer; "must", never "shall"; no "fast" or "secure" without a
  number. Every term the requirements depend on is in the glossary, used in exactly that form.
- A number the brief and the sources don't give is UNKNOWN, or a guess listed as an assumption.
- Every guess is an assumption A-n under Assumptions, saying what changes if it's wrong; a
  requirement that rests on one cites it after its BR: (BR-2) (A-1). While drafting you may tag a
  guess [ASSUMPTION: …] in place; no tag is left in the body at approval.
- The requirement shapes come from EARS, the Easy Approach to Requirements Syntax (Alistair Mavin
  and others, Rolls-Royce, 2009), written here in MIRAI's own words.
-->
# The outcome this feature buys, in a few words

Brief: [The brief's title](brief.md)

## Summary for approval

### The ask

<!-- done when: one sentence of at most 30 words starts with Approve, Decide or Note; on standard it names both the brief and this PRD, and the outcome they buy (bottom line up front) -->
Approve the brief and this PRD for the feature named here, so that the outcome in SM-1 is reached.

### Why

<!-- done when: two to four sentences say who has the problem, what it costs them and why now, citing the brief ("see the brief", SM-n) rather than repeating it -->
Who has the problem and what it costs them, in a sentence that points to the brief's evidence.

### What changes

<!-- done when: three to seven bullets say what a user or the system does differently; each ends with the FR, NFR or BR IDs it sums up; failures and unchanged behaviour the approver would worry about are named -->
- What a person can do that they can't today (FR-1)
- What the system does by itself, and when (FR-2)
- What happens when something goes wrong (FR-3)
- What stays as it is today (FR-4)

### Decisions for you

<!-- done when: each item is a question, two or three options, the recommendation and its main cost, and the ID it rests on (Q-n, the brief's Q-n on standard, a length exception); or one line: None — <why nothing needs your call>. The heading is the list's lead-in -->
1. The brief's open question, carried here on standard (Q-1)? Options: the first option, or the second option. Recommendation: the first option, because of its main benefit.
2. A question this PRD raises (Q-2)? Options: the first option, or the second option. Recommendation: the second option; it costs this.

### Not in this

<!-- done when: each bullet is something left out, with a short reason and its NG-n; on standard the brief's no-gos are listed too -->
- Something the brief leaves out, and its reason (NG-1)
- Something this PRD leaves out, and its reason (NG-2)

## User journeys

<!-- done when: each UJ-n names who, the situation they're in, and the steps they take, in one or two sentences; every FR serves at least one journey -->
- UJ-1: A named role, in a stated situation, takes these steps to reach this result.

## Functional requirements

<!-- done when: every FR is in one of the four groups, in its group's sentence shape, says "must" where the system acts, and ends with the brief's BR it serves, then any assumptions it rests on: (BR-2) (A-1); under each FR, its ACs (AC-FR-n.m) in Given / When / Then, each one a check anyone could run; failures and edge cases are their own FRs, never folded into a happy path -->
### Capabilities

<!-- shape: "[Actor] can [do something] [under these conditions]." Something a person does. -->
- FR-1: A named role can do one thing, under stated conditions. (BR-1)
  - AC-FR-1.1: Given a starting state, when the person does the thing, then a result anyone can check.

### Triggers and states

<!-- shape: "When [an event], the system must [respond]." or "While [a state lasts], [the thing] must [hold]." The system acts by itself, or something holds for a while. -->
- FR-2: When an event happens, the system must respond in a stated way. (BR-1)
  - AC-FR-2.1: Given a starting state, when the event happens, then the response anyone can check.

### Failures

<!-- shape: "If [something goes wrong], then [the system] must [respond]." Bad input, an outage, a limit, an edge case. Or one line: None — <why nothing can fail>. -->
- FR-3: If a stated thing goes wrong, then the system must respond in a stated way. (BR-1)
  - AC-FR-3.1: Given a starting state, when the thing goes wrong, then the response anyone can check.

### Unchanged behaviour

<!-- shape: "Where [an existing case], [the thing] must [stay as it is today]." What a user of today's product would notice if it broke. Or one line: None — <why nothing existing is touched>. -->
- FR-4: Where an existing case applies, the product must behave exactly as it does today. (BR-1)
  - AC-FR-4.1: Given an existing case, when a person uses it, then it behaves as it did before.

## Non-functional requirements

<!-- done when: each NFR-n is a quality (speed, availability, security, privacy, accessibility) with a number or UNKNOWN, and says how it's verified: its own AC-NFR-n.m, or a line "Verified by: <a test level, a measurement or a manual check>" (D-35) -->
- NFR-1: A quality, with the number it must meet, or UNKNOWN until it is measured.
  - Verified by: a test level, a measurement or a manual check, and what it looks at.

## Key flows

<!-- full only. done when: one flow per main journey: its steps and branches, naming the UJ and FR IDs; a Mermaid diagram is welcome -->
The steps of UJ-1, including where they branch (FR-1, FR-3).

## Non-goals

<!-- done when: each NG-n is something this PRD leaves out on purpose, with its reason; it carries on from the brief's highest NG; cite the brief's no-gos rather than repeating them -->
Besides the brief's no-gos (NG-1):

- NG-2: Something left out on purpose, and why.

## Risks

<!-- full only. done when: each R-n names its likelihood, its impact and how it's handled; it carries on from the brief's highest R -->
- R-2: A risk, its likelihood and impact, and how it's handled.

## Dependencies

<!-- full only. done when: each DEP-n names what this needs from another team, system or piece of work, by when, and what it blocks -->
- DEP-1: What this needs from whom, by when, and what waits for it.

## Rollout

<!-- full only. done when: each PH-n is a phase with who gets it and the exit criteria that end it -->
- PH-1: A phase, who gets it, and what must be true to move on.

## Assumptions

<!-- done when: each A-n is something taken as true without proof, with what changes if it's wrong; or one line: None — <why> -->
- A-1: Something taken as true, and what changes if it's wrong.

## Open questions

<!-- done when: each Q-n is a question this PRD raises, with who answers it and what it blocks, numbered on from the brief's highest Q; the brief's own questions aren't listed again (on standard they sit under "Decisions for you"); none is left when the PRD is approved -->
- Q-2: A question still open, who answers it, and what it blocks.

## Glossary

<!-- done when: "ID prefixes" is kept exactly as it is; "Terms" defines, once, each word the requirements depend on, and the requirements use that word and no other for it -->
### ID prefixes

| Prefix | Means | Example |
|---|---|---|
| BR | Business requirement, from the brief: an outcome the business needs | BR-2: people are reminded before a task is due |
| SM | Success metric, from the brief | SM-1: share of dated tasks done on time |
| UJ | User journey: a path a person takes through the product | UJ-1: a lead plans the week's deadlines |
| FR | Functional requirement: what the product does | FR-4: send a reminder the day before |
| NFR | Non-functional requirement: a quality such as speed or privacy | NFR-1: the overdue page shows in 2 seconds |
| AC | Acceptance criterion: a check that proves one requirement | AC-FR-4.1: Ana gets one email on the 14th |
| NG | Non-goal: something left out on purpose | NG-1: recurring tasks |
| R | Risk or hard part | R-1: time zones |
| DEP | Dependency on another team, system or piece of work | DEP-1: the mail service's daily limit |
| PH | Rollout phase | PH-1: one team first |
| A | Assumption: taken as true without proof | A-1: every assignee has an email address |
| Q | Open question | Q-1: email only, or an in-app notice too? |

### Terms

- A term: what it means in this feature, in one sentence.
