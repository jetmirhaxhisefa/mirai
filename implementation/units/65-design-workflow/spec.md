---
unit: "65"
name: design-workflow
status: done (Jet, 2026-11-28: "approve 65", built and probed; spec approved 2026-11-26: interview Q1 "A", Q2 "A", Q3 "A", Q4 "A", restatement "yes"; after the research in research.md and ../64-arlo/research.md; batch mode with 62, 63, 64)
roadmap: design/07-implementation-roadmap.md, row 65 (verifier review, human-only final approval; the `full` track keeps the separate brief gate, U4); design/01 §4; units 40 (Vera), 44 (the document workflow), 45 (tickets), 61 (ADR), 62 (HLD), 63 (LLD), 64 (Arlo)
depends_on: ["40", "44", "45", "61", "62", "63", "64"]
---

# Unit 65: The `mirai-design` workflow

## Why

64 gives Arlo and his run; each document is still approved on its own. On `full` the design is one
set: the HLD, the ADRs it proposes and the LLD it asks for. Checked one by one, mismatches between
them reach you or the tickets; approved one by one, the HLD is signed before the LLD has been
checked against it. This unit makes the design one flow from the approved PRD to the approved set
and on to Tess, with one early pause only for a choice that is hard to reverse.

## Decisions (Jet, 2026-11-26, interview; research.md)

1. **One sitting at the end, plus an early pause for hard-to-reverse choices** (Q1, "A"): when run 1
   proposes an ADR whose `gate` names `hard-to-reverse`, the run pauses after drafting it, before
   the LLD and Vera's full review; you pick in your session (Arlo's pause, 64), and it continues.
2. **Vera's set check** (Q2, "A"), on top of each document's own: the HLD's Decisions list matches
   the ADR files; every FR and NFR traced to a component and onward to an LLD item when the LLD
   covers it; every LLD name and contract matches the HLD's components; no orphan components, no
   invented connections; the probe "construct two units that each obey every decision and still
   build incompatibly". Every finding cites its line; no quota; a thin set isn't sent back for being
   thin. Rounds as `[docs] verify_fix_rounds`; what's left goes to your sitting.
3. **One sitting, an answer per decision, one signature for the set** (Q3, "A"): the screen shows the
   summary, "Decisions for you" (you answer each with a letter), "Arlo's calls", Vera's open
   findings and the files. If every answer matches what's written, one signature: one line per
   document (the HLD, each ADR, the LLD) in one step; MIRAI writes the ADRs' status (61); the docs
   MR updates; 45's offer to start Tess follows. If an answer differs, or you reject an ADR (with a
   reason), nothing is signed: your answers go to Arlo's next run as notes (as ticket notes go to
   Tess, 45), and the set comes back to the same sitting.
4. **Changes after approval** (Q4, "A"): `mirai design <initiative> --change "<what>"`: Arlo writes a
   superseding ADR where a decision changes and amends the HLD (and the LLD when affected) with a
   changelog line, IDs stable; Vera reviews only the change and what depends on it; you sign the
   changed documents in the same kind of sitting; MIRAI lists the tickets citing the changed IDs
   (`governed_by`, `uses`): unbuilt ones back to Tess for a re-cut with the change as her notes,
   built ones flagged for you. A change of requirements goes through the PRD first.

## Scope

**In**

1. **The offer** after a PRD's approval, on both tracks: "Start Arlo on the design now? [y/N]" on
   `full`, "Start Arlo on the technical note now? [y/N]" on `standard` (45's offer's pattern). It
   replaces the offer to start Tess after the PRD on `standard`: from 64 on, the note is required
   there, so Tess's offer moves to the note's approval (62b already offers her there).
2. **The early pause** (decision 1) in `src/design/run.js` (64's run).
3. **The set check** (decision 2): Vera's set checklist (`registry/templates/design-set-checklist.md`)
   and a set launch with the HLD, its ADRs and the LLD as inputs; findings routed by 44's rules; the
   mechanical part in MIRAI (Decisions ↔ ADR files; the trace table ↔ the LLD's Scope and test map;
   LLD names ↔ HLD components).
4. **The sitting** (decision 3): `mirai approve <hld-id> --file …/hld.md` on `full` becomes the set's
   screen (with 63's LLD and 61's ADRs); your answers to "Decisions for you" recorded (`design_answer`
   lines); one `withSeq` for every signed line; a set rejected writes `design-notes.md` (like
   `ticket-notes.md`: MIRAI writes it, the docs merge checks each line against your signed
   answers) for Arlo's next run.
5. **Changes** (decision 4): `--change`; the delta review (Vera's inputs: the changed documents and
   what cites them); the delta sitting; the impact list (`src/design/impact.js`); Tess's re-cut with
   the change as notes; built tickets flagged in `mirai show`.
6. **The handover:** the set's signature completes `full`'s inputs (45), so the offer to start Tess
   follows; Tess's inputs are the PRD, the HLD, the ADRs and the LLD.
7. **Session:** `/mirai design` and `/mirai design --change` (not gates); the sitting is a gate
   (terminal only).
8. **Docs:** `docs/design.md` (the workflow), `docs/documents.md`, `docs/tickets.md`.

**Out:** an extra adversarial reviewer run; prototypes; changing a merged ticket's code (a new
ticket does that).

## Tests

- **T1** the offer after a PRD's approval on `full` (the design) and on `standard` (the note), and
  Tess's offer after the note's approval, not the PRD's (stand-in runs).
- **T2** the early pause on a `hard-to-reverse` ADR; no pause without one.
- **T3** the set check: a Decisions line with no ADR file, an FR with no component, an LLD name
  missing from the HLD, an orphan component: each found (fake Vera for the judgement part).
- **T4** the sitting: all answers match → one signature, one line per document, ADR statuses
  written, Tess offered; one answer differs → nothing signed, `design-notes.md` written, Arlo's next
  run gets it; an ADR rejected → nothing signed.
- **T5** a change: a superseding ADR, HLD and LLD amended with changelog lines, the delta review,
  the delta sitting, the impact list (an unbuilt ticket re-cut, a built one flagged).
- **T6** the docs check (34b).

## Probes (real)

- **P1** the whole `full` flow on the sample app: PRD approved → the offer → Arlo's runs → the set
  check → the sitting (probe key) → Tess offered.
- **P2** a change after approval: one decision changed; the impact list names the tickets citing it.

## Done when

T1–T6 pass, the full suite through the build runner and CI; P1 and P2 pass; the roadmap's
done-when holds (approved PRD → approved ADR(s)/HLD/LLD → `mirai-tickets`).

## Checked against the other units

- **62:** the HLD's own approval (ADRs on its screen) becomes the set's sitting on `full`.
- **63:** the LLD signed in the same sitting; its approval on its own stays for a change.
- **64:** the pause, the runs; `--change` is a run mode of 64's command.
- **45:** the offer and Tess's notes pattern; `full`'s inputs complete on the set's signature.
- **44:** Vera's routing; the docs MR.
