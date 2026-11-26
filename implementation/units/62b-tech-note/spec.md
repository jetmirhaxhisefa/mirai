---
unit: "62b"
name: tech-note
status: approved (Jet, 2026-11-25: "approve 62b"; interview 2026-11-24: Q1 "A", Q2 "yes", Q3 "yes", Q4 "A", Q5 "A", restatement "yes")
roadmap: design/07-implementation-roadmap.md, row 62b (new, from unit 45's interview Q2 "A"); design/01 §4 (design: HLD, ADR, LLD), §5 (tickets), §16 (gates); units 31 (templates), 40 (Vera), 45 (`[tickets.inputs]`), 61 (ADR), 62 (HLD), 64 (Arlo), Kai's plan gate (22/23), Rex (24)
depends_on: ["31", "40", "45", "61"]
---

# Unit 62b: The technical note (`standard` track)

## Why

On `standard`, tickets are cut from the PRD alone, so the technical approach is decided ticket by
ticket inside Kai's plans, after the work is already cut. A wrong approach (a polled table where the
team uses a queue) shows up only once several tickets are built. `full` has the HLD, ADRs and LLD
for this; `standard` has nothing. Jet (45's interview, Q2 "A"): every `standard` feature gets a
short technical note before its tickets.

**Why now:** 45 makes the needed documents a list per track; this unit adds the note's type to it.

## Decisions (Jet, 2026-11-24, interview)

1. **It's mainly your technical review** (Q1, "A"): an engineering manager or tech lead reads it in
   about five minutes and corrects the approach before anything is cut. Tess cuts along it; Kai and
   Rex follow it.
2. **Its own approval, before Tess** (Q2, "yes"): PRD approved → Arlo writes the note → Vera checks
   it → you approve it → Tess cuts from the PRD and the note. `standard` has three approvals: brief
   + PRD, the note, the ticket set.
3. **What's in it** (Q3, "yes"), in this order:
   - **Approach:** 3–5 sentences on how it's built, and what isn't changing;
   - **Components touched:** each module or file, cited;
   - **Data changes:** tables, columns, migrations, and whether each can be undone;
   - **API and contracts:** new or changed endpoints and events;
   - **Decisions:** each real choice as one line, or a link to an ADR (61) when it passes the ADR
     test (design/01 §4);
   - **Coverage:** every FR and NFR of the PRD → the component that delivers it;
   - **Risks and rollout:** the order of changes, a flag, what breaks if half-shipped.

   About 800 words at most (a bigger note means the feature belongs on `full`). Every claim about the
   code cites a file. It links to PRD IDs, never restates them.
4. **The build follows it** (Q4, "A"): Kai's plan gets the approved note and cites the decisions it
   relies on; a plan that departs from a decision is flagged at the plan gate ("departs from the
   technical note's D-2"), and you accept it with a reason (logged) or send the plan back. Rex
   checks the code against the note's decisions. The note changes only through a new approval.
5. **Required once Arlo exists** (Q5, "A"): this unit builds the type; `mirai tickets` requires an
   approved note on `standard` from unit 64 on. Until then it's optional: written by hand or with
   your session, linted, checked by Vera, approved by you, and used by Tess and Kai when it exists.

## Scope

**In**

1. **The type `tech-note`:** `registry/templates/tech-note.md`, its checklist, an example
   (`registry/examples/tech-note.md`, the due-dates feature), protected sections and fields with
   `read_by` (37), `template_version` 1 and its hash in `test/lint/template-versions.json`. Path:
   `docs/mirai/<initiative>/tech-note.md` (the store's `pathOf`, 38). Its line under the title links
   the PRD (`PRD: …`).
2. **The lint** (`src/lint/tech-note.js`): the seven sections; the word cap (`[docs.limits]
   tech_note_words`, default 800; the message says "move to `full`" above it); every FR and NFR of
   the linked PRD appears in Coverage, and no ID that isn't the PRD's; each Decisions line is
   numbered `D-n` and either one line or a link to an ADR that exists; each component and data
   change cites a path that exists in the repo (a warning for a path to be created, marked `(new)`);
   data changes say `reversible` or `not reversible`.
3. **Vera:** the type is one of hers, with a tech-note checklist: the approach answers every FR and
   NFR; the claims hold at the cited files; two engineers following it couldn't build incompatible
   parts; a decision that passes the ADR test but is only a line is a must-fix ("make it ADR-n").
4. **Approval:** `mirai approve <id> --file …/tech-note.md`: the lint, Vera's result, the PRD
   approved as it is now; one signed line. On approving it, 45's offer to start Tess applies (the
   note completes `standard`'s list).
5. **The inputs list (45):** `tech-note` is added to `[tickets.inputs].standard`, marked
   `required_from = "64"`: until 64 is built, a missing note is a warning, an approved one is
   Tess's input; from 64 on, it's required.
6. **Kai's plan and the plan gate:** the approved note is a plan input; the plan template gains
   "Technical note: D-n relied on" (protected, read by `gate`); a plan whose design notes contradict
   a cited D-n, or that names a decision the note made otherwise, is flagged at the plan gate
   (`plan-departs-tech-note`, shown, never blocking): accept with a reason (a signed, logged line) or
   send back.
7. **Rex:** the note's decisions are a review input; a change against a decision is a finding
   ("departs from the technical note's D-2"), graded as Rex grades a broken convention.
8. **Docs:** `docs/documents.md` (the type and the flow), `docs/tickets.md` (inputs per track),
   `docs/config.md` (`tech_note_words`), the `mirai-write` guide `tech-note.md`.

**Out**

- Arlo (64), who writes it later; the HLD (62), LLD (63), ADR template (61) beyond linking to one.
- Making it required before 64.
- `full`'s design flow (65).

## Tests

- **T1 The type:** the template, checklist and example validate; the example lints clean; protected
  parts declared with readers.
- **T2 The lint:** a note over 800 words fails naming the cap and `full`; an FR missing from
  Coverage fails naming it; an ID not in the PRD fails; a `D-n` without a line or with a missing ADR
  fails; a cited path that doesn't exist fails (a `(new)` one warns); a data change without
  `reversible`/`not reversible` fails.
- **T3 Vera:** the type is checked; a fake finding "D-3 passes the ADR test" is a must-fix.
- **T4 Approval:** refused while the PRD isn't approved as it is now, or Vera has must-fix open
  within her rounds; signed once; 45's offer appears.
- **T5 Inputs:** before 64, `mirai tickets` warns on a missing note and passes an approved one to
  Tess; with 64 marked built (a fake), it refuses without one.
- **T6 Plan gate:** a plan citing D-2 and doing otherwise is flagged; accept with a reason writes a
  signed line; a plan that follows it isn't flagged.
- **T7 Rex:** a fake review sees the note's decisions as input; a departing change is a finding.
- **T8 The docs check** (34b) passes with the new key and type.

## Probes (real)

- **P1 A note by hand, reviewed:** on the sample app, for 42's due-dates PRD, write a note with your
  session and the guide; lint, Vera, approve. **Pass when** it lints clean within the cap, Vera's
  findings are about the content (not the format), and you'd approve it in about five minutes.
- **P2 Tess and Kai follow it:** Tess cuts from the PRD and the note; Kai plans one ticket. **Pass
  when** the tickets split along the note's components, Kai's plan cites the note's decisions, and a
  seeded departure in a plan is flagged at the gate.

## Done when

- T1–T8 pass, and the full suite passes through the build runner and CI.
- P1 and P2 pass.
- The roadmap row's done-when holds: a lint-clean, Vera-checked note for a pilot feature;
  `mirai tickets` on `standard` requires it once it exists (from 64).

## Checked against the queued units

- **45:** adds `tech-note` to `[tickets.inputs].standard` with `required_from`; 45's offer runs on
  the note's approval.
- **61:** Decisions link to ADRs; until 61 exists, a decision that needs an ADR is flagged by Vera
  and written as a line marked "ADR pending (61)".
- **64 (Arlo):** writes the note on `standard`; his prompt takes this template and checklist.
- **65:** `full` keeps HLD/ADRs/LLD; the note is `standard`'s only.
- **Kai's plan gate and Rex:** new inputs and one flag each; no cage change expected beyond the
  plan template (a protected field) — the builder confirms with `cageOf`.
- **42 (Tess):** her inputs gain the note when it's approved.

## Re-checked against 44 as built (merged 2026-11-26, PR #132)

- **Publishing:** the note's approval publishes the initiative (44's `publishAfter`) before 45's
  offer to start Tess, so the docs MR holds the note Tess cuts from.
- **`(open)`:** the tech-note lint uses 44's `checkOpenMarks`: a choice the writer can't settle is
  written `(open)` with its question, warns, and blocks approval.
- **Vera's findings:** 44's routing and grading apply to her tech-note checks. "A decision that
  passes the ADR test but is only a line" is `writing` (the fix is to write the ADR), so it refuses
  approval; "which approach" is a `decision`, shown to you at approval. A `number` decision quoting
  an `NFR-n` in Coverage is must-fix (44's Q3 "B": a number in a commitment).
- **Status:** `status = "forbidden"`, like every type; 44's `pre-commit` refuses a hand-set one.
