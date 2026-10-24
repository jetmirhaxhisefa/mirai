---
id: PMT-1-plan
type: plan
template: plan@v1
ticket: PMT-1
acs: [AC-PMT-1.1]
risk: normal
tdd: auto
tests: required
round: 1
---
<!--
The plan template (MIRAI). The developer agent fills it for one ticket; the orchestrator keeps
it in the store. mirai lint flags any line left word for word from this template.
- Frontmatter: acs lists every AC the plan must prove, the ticket's own and its covers_ac;
  tdd and tests are the ticket's effective values; round counts plan rounds.
- Your approval signs the frozen block (Intent, Boundaries, Edge cases), the Declared changes
  rows and the fields ticket, acs, risk, tdd, tests and round: an edit to any of them needs a
  new approval. The frozen block wins over anything written below it.
- Inside the frozen block, write only what should show: no HTML comments. Keep the two markers,
  with the end marker right before the next section.
  - Intent: one or two sentences each for the problem and the approach: what, not how.
  - Boundaries: "always" holds the rules every change keeps; "never" holds what is out of scope
    or forbidden.
  - Edge cases: one row per meaningful input or state, each with its expected result and its
    error handling.
- A new dependency in Declared changes makes the ticket high risk: set risk: high.
- Aim for about 900 to 1,600 tokens: boundaries and examples, not step-by-step instructions.
-->
# The plan for this ticket

<!-- frozen:start -->
## Intent

**Problem:** what is broken or missing, and why it matters.

**Approach:** what will change, at a high level.

## Boundaries

- Always: a rule every change keeps.
- Never: something out of scope or forbidden.

## Edge cases

| Case | Input or state | Expected | On error |
|---|---|---|---|
| The main path | the usual input | the usual result | no error expected |
<!-- frozen:end -->

## Code map

<!-- done when: every file the work touches or reads, with the functions or methods involved and how each changes: add, change, remove or read -->
| Path | Symbols | Change |
|---|---|---|
| `src/example.js` | `exampleFunction` | change |

## Tasks

<!-- done when: one task per file where it can be, each with what to do and why -->
- [ ] `src/example.js`: what to do there, and why.

## Test list

<!-- done when: every AC in acs has a row; each row names the lowest level that really proves it, the Test ID the level's runner selects (a file or a test name), and its kind: red (fails first; not with tdd: after), after (not with tdd: first), or characterization (passes at baseline; its Symbol is one the Code map marks change). Without a test, the level is no-test: <reason>, with no Test ID or kind. One row per edge case where it can be. -->
| Test | Test ID | Symbol | AC | Level | Kind |
|---|---|---|---|---|---|
| exampleFunction keeps today's results | `tests/example.test.js` | `exampleFunction` | AC-PMT-1.1 | unit | characterization |

## Declared changes

<!-- done when: every protected path the ticket touches (a path or glob in the repo) and every new dependency it needs (<ecosystem>:<name>, such as npm:left-pad), each with why; or one row "none" -->
| Kind | Item | Why |
|---|---|---|
| none | | |

## Verification

<!-- done when: the commands that show the work is done, each with its expected result -->
- `npm test`: every test passes.

## Design notes

Not applicable — replace this line with the reasoning behind a non-obvious approach, or say why there is none.

## Implementation log

<!-- Append only, during the build: decisions, files touched, surprises. Empty at plan time. -->

## Change log

<!-- Append only, during review rounds: what a finding changed in this plan. Empty at plan time. -->

## Review triage log

<!-- Append only, on every review pass: each finding and what was done with it. Empty at plan time. -->
