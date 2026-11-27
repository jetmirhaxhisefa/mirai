# Unit 65: test results (2026-11-27, batch, continued in the morning on your "B")

P1 and P2 passed. Built on `unit/65-build`, stacked on `unit/64-build`.

## What was built

| Scope | Where | What |
|---|---|---|
| 1 The offer | `src/cli/commands/approve.js` (`nextOffer`, `startNext`) | After the PRD's approval: when a design document is what the track still needs, "Start Arlo on the design now? [y/N]" (`full`) or "… on the technical note now?" (`standard`); after his pause "continue his run now? [Y/n]". Otherwise 45's offer to start Tess, as before (a non-design input still missing stays her "still needed" line). |
| 2 The early pause | `src/design/run.js` (`hardAdrsOpen`, `adrQuestion`, `hardPause`), `src/design/hard.js` | After run 1, an ADR he proposed with `hard-to-reverse` in its gate, not yet answered: MIRAI asks in interview.md (its "Options considered" as A/B/C, his choice as the guess), the run ends paused (`hard: true`), before the LLD and Vera's full review. Your answer needs no new PRD approval. **The brief's approval binds the interview without MIRAI's own design questions** (P2's finding, below). |
| 3 The set check | `designSetProblems` (MIRAI), `registry/templates/design-set-checklist.md` and `src/verify/run.js` (Vera) | MIRAI: every proposed ADR linked from a D-n line; every FR the LLD's Scope cites traced to a component; an orphan component as a **warning** (P1's finding). Vera: her HLD and LLD checks also get the initiative's ADRs, the LLD (on the HLD's check) and the set checklist (D-n ↔ ADRs, requirement → component → LLD item, orphans, invented connections, "two units that obey every decision and still don't fit"). The LLD's fix rounds may fix the HLD for a set problem; an HLD changed that way goes through its own checks again. |
| 4 The sitting | `src/cli/commands/approve-tech-note.js`, `src/design/sitting.js`, `registry/document-types/design-notes.toml` | On `full`, `mirai approve <hld-id> --file …/hld.md` is the set's sitting: the LLD with it (refused until it's written and lint-clean, with Vera's result), each "Decision for you" answered by letter (Enter = what it's written for), Arlo's calls listed, each proposed ADR accepted or rejected with a reason. All as written: one `withSeq`: the HLD, each ADR (status written by MIRAI), the LLD, and your `design_decision` lines; 44's publish; Tess offered. An answer that differs or an ADR rejected: nothing approved, your answers signed, `design-notes.md` written, Arlo's next run takes it (step `notes`); the docs merge checks each line against your signed answers. |
| 5 Changes | `mirai design <initiative> --change "<what>"`, `src/design/impact.js` | Refused unless the design is approved as it is now. Arlo writes a superseding ADR, amends the HLD and the LLD (a `changelog` frontmatter line each; IDs stable). Vera reviews the change against the approved version (incremental). The impact: D-n lines, LLD items and superseded ADRs changed; tickets citing them (`governed_by`, `uses`): unbuilt ones go back to Tess (her next run's step `change`, with `design-change.md`), built ones flagged in `mirai show`. Tess waits for the changed set's sitting first. |
| 6 Handover | (45's inputs) | The set's signature completes `full`'s inputs; Tess is offered on the same screen. |
| 7 Session | `/mirai design` with `change` | The sitting is terminal only (a signature). |
| 8 Docs | `docs/design.md` ("The workflow"), `documents.md` (`design-notes`), `tickets.md` | |

## Tests

| Test | Result (Mac) |
|---|---|
| T1 the offer on full and on standard; y starts his run; Tess's offer after the design | pass |
| T2 the early pause: the question, no LLD before your pick, `hard: true`; the interview reads as signed without it; the next run continues | pass |
| T3 the set check: an orphan ADR, an orphan component (warning), an LLD FR the HLD doesn't trace | pass |
| T4 the sitting: all as written → one signature for HLD, ADR, LLD; an answer differs and an ADR rejected → nothing approved, notes written and checked, his next run takes them | pass |
| T5 a change: changedIds and ticketImpact; the run with a superseding ADR and changelog; the impact; Tess waits for the changed set, then takes the change | pass |
| T6 the docs | pass |

## Probes (real)

`test/probes/design-probes.js --probe p65` (and `--probe p65change --home <dir>` to resume P2):

- **P1 PASSED** (`p1-p2-run3.txt`; P1 also passed in run 2, `p1-run2.txt`): the PRD's approval offered
  Arlo; run 1 on Opus proposed ADR-0002 ("store a due date as a calendar day", hard to reverse); MIRAI
  paused and asked; answered with his own guess; the HLD through Vera (three real must-fix in one
  round: the owner of the due-date rule unclear between model and request, a scope exclusion NG-5
  the PRD doesn't have, a done task's date lock missing from the summary), then the LLD (one
  must-fix: a 64-character header limit decided only in the LLD); the sitting: four decisions for
  you, five Arlo's calls, ADR-0002; one signature for HLD + ADR + LLD; Tess offered.
- **P2 PASSED** (`p2-run4.txt`), after three findings:
  1. **My first change was a change of requirements** (due times of day). Arlo rightly paused:
     "a change of requirements, so it goes through the PRD before the design changes", with three
     options (`p1-run2.txt`). The probe now changes the design only (the zone as a `tz` query
     parameter instead of the header, because a proxy strips it).
  2. **The early pause broke the brief's binding** (found resuming P2): MIRAI's question went into
     interview.md, which the brief's signature covers, so after your answer Tess, the PRD's
     re-approval and the docs merge would all have refused. Fixed: the binding reads the interview
     without MIRAI's own design questions (exactly; a test checks the bytes).
  3. **A change didn't reach the LLD**: his inputs for a change held only the HLD, and Vera's HLD
     check didn't see the LLD. Fixed: both now get it. The rerun: ADR-0003 supersedes ADR-0001,
     D-9 and the LLD's C-5 and C-6 amended with changelog lines; Vera found two real must-fix in
     ADR-0003, fixed; impact: SAMPLE-91 back to Tess, SAMPLE-92 (merged) flagged.
- **P1's first run** (`p1-run1.txt`) found the set check's orphan-component rule too blunt ("The web
  app", a container carried by finer components) and unfixable from the LLD's run: now a warning,
  and the LLD's rounds may fix the HLD for a set problem.

## Decisions I made

- The changelog is a frontmatter field (`changelog`), not a new section: the HLD's and LLD's
  templates (and their version hashes) don't change.
- The set launch is Vera's HLD and LLD checks with the set added (not a third launch).
- On a change, "unbuilt" means not merged into the integration branch (`mr_merged`).
- Orphan components warn; Vera judges them.
