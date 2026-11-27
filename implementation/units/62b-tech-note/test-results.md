# Unit 62b: test results (2026-11-26)

**Approved 2026-11-27 ("approve 62b"), PR #143.** Runner green at `37cb860` (red team GREEN on u62b-redteam-4). P1 and P2 passed (real Sonnet runs; the probe's last
run, with its plan step resumed in the same home). Built on `unit/62b-build` from `origin/main`
(`f5db304`: 61 merged, its re-checks merged).

## What was built

| Scope | Where | What |
|---|---|---|
| 1 The type | `registry/document-types/tech-note.toml`, `registry/templates/tech-note.md`, `tech-note-checklist.md`, `registry/examples/tech-note.md` | Seven sections in order (Approach, Components touched, Data changes, API and contracts, Decisions, Coverage, Risks and rollout); the "PRD:" line; FR and NFR cited from the PRD, D-n defined in Decisions; 800 words; `status = "forbidden"`; `verifier = true`; protected parts with readers. Path `docs/mirai/<initiative>/tech-note.md` (the store's `pathOf`). |
| 2 The lint | `src/lint/tech-note.js` | The cap (`[docs.limits] tech_note_words`, "the feature belongs on the full track"); every FR and NFR of the PRD in Coverage with a component, and no other ID; each D-n one line, or a link to an ADR that is accepted or proposed (a superseded one names its successor; the index or another file is refused); each component and data change cites a path that exists (`(new)` warns); `reversible` or `not reversible`; `(open)`. |
| 3 Vera | `tech-note-checklist.md`, `src/verify/run.js` | Her lines (the approach answers every requirement; the claims hold at the cited files; no two incompatible builds; a D-n that passes the ADR test is a writing must-fix; the ADR cap); her inputs gain `adrs.md` (61's re-check). |
| 4 Approval | `src/cli/commands/approve-tech-note.js`, `approve-adr.js` | The lint as at approval (the PRD, the linked ADRs, the repo), the PRD approved as it is now, Vera's result; `[a/e/r]`; one signed line, plus one per proposed ADR its D-n lines link, accepted on the same screen with 61's core (factored out: `proposedAdrReady`, `adrDecision`, `adrsSigned`); a rejected note leaves them proposed. Then 44's publish and 45's offer. The journal's `kind` gains `tech-note`; the docs merge checks it as it checks the PRD. |
| 5 The inputs | `src/tickets/inputs.js` | `REQUIRED_FROM = { 'tech-note': '64' }`: until unit 64 is built, a missing note is a warning ("not required until unit 64; with one approved, the tickets follow it"), and an approved one is Tess's input, with "cut the tickets along its Components touched and Coverage". |
| 6 Kai and the plan gate | `src/agent/inputs.js`, `src/agent/tech-note.js`, `src/agent/plan.js`, `approve.js`, plan template v2 | The approved note (from the integration branch, approved by your line) is a plan and review input. The plan template gains "## Technical note" (`Relies on: D-n`, `Departs from D-n: <why>`; left out with no note; protected, read by the gate). The gate flags a departure or a D-n the note lacks (`plan-departs-tech-note`), shown, never blocking, and it makes the gate yours on any preset; accepting needs your reason, signed in the line (`departures`). |
| 7 Rex | `src/agent/review.js` | The note's decisions are a review input; a change against one is a finding with basis `rule` and ref its D-n ("departs from the technical note's D-n"), graded as a broken convention. |
| 8 Docs | `docs/documents.md` ("The technical note"), `docs/tickets.md`, `docs/config.md`, `registry/skills/mirai-write/guides/tech-note.md` | The type and the flow; inputs per track; `tech_note_words`; the writing guide, its three examples from P1's real first draft and Vera's findings on it. |

## Tests

| Test | File | Result (Mac) |
|---|---|---|
| T1 the type, template, checklist, example (clean against the sample app), protected parts; the plan template's new section | `test/documents/tech-note.test.js` | pass |
| T2 the lint: the cap naming full, an FR missing, an ID not the PRD's, an empty or multi-line D-n, a superseded or non-ADR link, a missing path, a cite-less bullet, no reversible, `(open)` | same | pass |
| T3 Vera: the type, `adrs.md`, a must-fix "D-2 passes the ADR test" refuses approval | same | pass |
| T4 approval: refused with the PRD unapproved; one line, its proposed ADR accepted on the screen, published, the offer; a rejected note leaves the ADR proposed | same | pass |
| T5 the inputs: optional before 64, required with 64 built, approved is her input | same | pass |
| T6 the plan gate: flags, the gate yours, the signed departure (and never without a reason), Kai's prompt | same | pass |
| T7 the note in the plan and review inputs (not the build's), Rex's prompt, the D-n basis | same | pass |
| T8 the docs check (34b); the writing guide's three examples (34's T1, T2) | `test/docs/coverage.test.js`, `test/documents/write.test.js` | pass |

Pinned lists updated: the registry's types, template hashes (tech-note v1, plan v2), Vera's types,
the summary-check exemption, 45's warning lines (the note is optional until 64).

## The red team

The cage changes: the journal (`tech-note`, `departures`), the plan and review launches (inputs,
prompts, the gate), the plan template. A baseline and `redteam-full` go with the tests.

## Probes (real)

`test/probes/tech-note-probes.js` (in a probe home of 42's, every approval with the probe home's key):

- **P1 PASSED** (`~/mirai-u62b-p2.txt`, its first part): the note written in this session with the
  guide, linted clean (646 words). Over seven runs Vera's findings were all about content, never the
  format, and each was right:
  - on 42's team due-dates PRD (runs 1–2, `~/mirai-u62b-p2-run1.txt`, `-run2.txt`): **the PRD says
    teams, leads and time zones exist; the sample app has none**, so the note built a team model,
    and she found what that needed (a backfill, a scheduler, a once-a-day marker, D-2 as an ADR).
    That PRD doesn't fit this app; the probe moved to 44's owner-only PRD (`--own`), which does;
  - on the owner-only PRD (runs 3–7): the request classes that hold validation, the missing update
    call and edit field, **`update` with no owner check (any user could change another's date)**, a
    date cast that wouldn't give `YYYY-MM-DD`, the time-zone header as a first-of-its-kind interface
    (made ADR-0001), the 422 message nowhere on screen.
  - The last run: the note passed (2 suggestions); the ADR had one decision open for you (the list
    marks lateness on a read, and the header goes with writes only). The approval signed the note
    and accepted ADR-0001 on the same screen. **Your read** (Jet, 2026-11-26: "ok sounds good"):
    you'd approve the final note (`implementation/units/62b-tech-note/p1/own-note-final.md`).
- **P2 PASSED** (`~/mirai-u62b-p2.txt`, then `~/mirai-u62b-p2-kai.txt`): Tess cut 4 tickets from the
  PRD and the note, **every ticket naming the note's components, all 7 of them covered**; the set
  signed; then Kai's plan of SAMPLE-2 (resumed in the same home, after the probe's missing ticket
  approval was added): **"Relies on: D-1, D-3"**; a departure from D-3 seeded into it was flagged
  at the gate with D-3's own words, and the gate was yours ("it departs from the technical note
  (D-3)").

The kept homes of the stopped runs were deleted once done (Jet, 2026-11-26: delete probe homes when they're no longer needed).

## Changed from the spec

- **P1 and P2 ran on 44's owner-only due-dates PRD**, not 42's team one: the team PRD assumes teams
  the sample app doesn't have (Vera's first finding), so no honest standard note fits it.
- **Kai declares a departure** in his plan ("Departs from D-n: <why>"); MIRAI flags it, and a D-n the
  note doesn't have. Whether code contradicts a decision Kai didn't declare is Rex's check.
- **The plan template is v2** (its "Technical note" section); plans written at v1 lint with a
  warning only.

## Questions for Jet

None open. One for you to look at: ADR-0001 of the probe (`p1/own-adr-final.md`) was accepted with
Vera's open decision (lateness is judged on a read; the header goes with writes). In a real project
that's yours to settle before accepting.
