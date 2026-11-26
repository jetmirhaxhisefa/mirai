---
unit: "61"
name: adr
status: approved (Jet, 2026-11-26: "approve 133"; interview 2026-11-26: Q1–Q5 "A", restatement "yes"; after the web research in research.md)
roadmap: design/07-implementation-roadmap.md, row 61 (build order: right after 45 and 45b, Jet 2026-11-24); design/01 §4 (design: HLD, ADR, LLD), §5a (trace); design/03 (ADR: MADR 4.0.0); AR-28; D-20 (a project's existing numbering and format win); units 31 (templates), 34 (`mirai-write`), 37 (overlays), 40 (Vera), 43 (trace), 62b (the technical note), 62 (HLD), 64 (Arlo), 65 (the design workflow), 60/67 (releases)
depends_on: ["31", "34", "37", "40", "43"]
---

# Unit 61: The ADR (architecture decision record)

## Why

An ADR records one hard decision: the options (the rejected ones too), the choice and its
consequences. It belongs to the project and outlives the feature that raised it. Without ADRs,
the "why" of a design is buried in a feature document nobody reads again, and agents re-argue
settled decisions. Without rules, agents write too many of them (research.md §4: one agent-driven
repo reached 141 ADRs in four months).

**Why now:** tickets are cut from the technical documents too (45's decision 1); 62b's technical
note links to an ADR for any decision that passes the ADR test, and 62 (HLD), 64 (Arlo) and 65
(the design workflow) build on this type.

## Decisions (Jet, 2026-11-26, interview; research.md)

1. **How the documents fit** (Q1, "A"). The HLD (`full`) or the technical note (`standard`, 62b)
   says **how**; an ADR says **why**, for one hard decision; the LLD (63) holds no decisions. ADRs
   are project-wide (not per initiative) and outlive the feature. The HLD and the note carry a
   Decisions list: one line each, or a link to the ADR. *Why:* the design doc is read now, by
   builders; the ADR later, by whoever asks "why is it like this?", agents included (Spotify,
   Microsoft, arc42: link, don't repeat).
2. **Only decisions that pass the gate get an ADR**, and the ADR names which test it passes:
   hard to reverse, cross-cutting (two or more components), changes an NFR, adds an external
   dependency or interface, first of its kind. Everything else is one line in the HLD or note.
3. **A cap that Vera flags, you decide** (Q2, "A"): 2 ADRs per epic on `standard`, 3 on `full`.
   Over the cap, Vera's finding names the ADR that could be a line; you keep it or turn it into a
   line at the approval. Nothing is refused automatically (a hard cap would push agents to merge
   decisions into a "Mega-ADR").
4. **The template** (Q3, "A"): MADR 4.0.0 at its core, about 600 words (the lint warns over it):
   - front matter: `status` (`proposed | accepted | rejected | deprecated | superseded`, with
     `superseded_by`), `date`, `decision_makers`, `confidence` (`high | medium | low`), `gate`
     (the tests it passes), `initiative` (where it came from);
   - required: the title (the decision as a short sentence), a **Y-statement summary** ("In the
     context of …, facing …, we decided for … to achieve …, accepting …"), **Context and problem**
     (the FR/NFR IDs it serves, cited), **Options considered** (at least two real ones, "do
     nothing" where it fits, pros and cons), **Decision** ("We chose X because …"),
     **Consequences** (good, bad, neutral: the bad ones required), **Confirmation** (required: how
     compliance is checked, Scope 4);
   - optional: **Revisit when** (the triggers that reopen it), **Links** (the HLD or note
     section, the ADR it supersedes, a spike).
   A project may change it, add to it or replace it with its own (37's overlays and rename map:
   Thudos's "Validation" can stand for "Confirmation").
5. **What agents read** (Q4, "A"): every agent's context gets the index; the full text only of the
   **accepted** ADRs that touch the ticket's components or the PRD's IDs, plus the last three
   accepted. In their prompts: accepted is binding; a rejected option isn't proposed again without
   new evidence; superseded is history. A conflict with an accepted ADR stops the agent, who asks
   you whether the task changes or the ADR is superseded; never a quiet workaround. Rex checks the
   change against each relevant ADR's Confirmation.
6. **Lifecycle** (Q5, "A"):
   - **approval:** with the HLD or note that proposes it, on the same screen, one signed line per
     ADR; Arlo (or you) writes it `proposed`, Vera checks it, your signature makes it `accepted`;
     a rejected ADR stays, `rejected`, with your one-line reason, so it isn't proposed again;
   - **immutable once accepted:** only typo and link fixes (the lint allows a change that keeps
     every section's words but links and spelling); a change of decision is a new ADR with
     `supersedes: ADR-0007`, and approving it marks the old one `superseded`;
   - **pruning:** at each release record (60, 67) MIRAI lists the ADRs in force with their Revisit
     triggers, and you mark each one still true or `deprecated`; `mirai adr review` does the same
     at any time;
   - **folder and numbering:** `docs/decisions/ADR-0001-<slug>.md` and an index
     `docs/decisions/README.md`, unless the project already has ADRs: then their folder and
     numbering win (D-20; Thudos's `docs/decisions/adr-0001-…` continues at `adr-0002`), and the
     existing ones join the index as they are (`status: accepted` unless they say otherwise).
7. **Until Arlo (64) exists**, ADRs are written by hand or in your session with the `mirai-write`
   skill, and still go through the lint, Vera and your approval.

## Scope

**In**

1. **The document type** `adr` (`registry/document-types/adr.toml`, the template
   `registry/templates/adr.md`, the checklist `registry/templates/adr-checklist.md` with `[vera]`
   lines): required sections, the front matter above, `summary_words` for the Y-statement,
   `document_words = 600` (a warning), `verifier = true`, its folder from the project (Scope 6).
2. **The lint** (`src/lint/adr.js`): the required sections and front matter; at least two options;
   a Consequences section with a bad one; the gate names at least one test; the cited FR/NFR IDs
   exist in the initiative's PRD; `supersedes` names an ADR that exists and is accepted; an
   accepted ADR changed beyond typo and link fixes is refused ("supersede it: ADR-00NN"); a
   rejected ADR keeps its reason.
3. **The checklist** (Vera's `[vera]` lines): is it one decision (not a design guide); are the
   options real (no "dummy alternative"); are the bad consequences honest; does the gate hold
   (else "make it a line in the HLD/note"); is the Confirmation checkable; the cap per epic
   (decision 3), as a finding that names the ADR.
4. **Confirmation, checked by trace** (43's documents scope, now real): the section names one of
   - `check: <name>`: a project check in `[checks]` (a lint or dependency rule, e.g.
     dependency-cruiser), which must exist in the config;
   - `test: ADR-0007`: a test whose name starts with the ADR's ID (43's naming, e.g.
     `test_adr_0007_…` for PHPUnit), found in the gate's results when a ticket of that
     initiative ships;
   - `review: <what Rex checks>`: no automated check fits; Rex's checklist gets the line.
   Trace's "no ADRs yet" note becomes a link per ADR; a Confirmation that names nothing it can find
   is a missing link.
5. **The index** `docs/decisions/README.md`: one line per ADR (number, title, status, date,
   superseded by), rendered by MIRAI (`mirai adr index`, and on every ADR approval), linted to
   match the files.
6. **The project's own ADRs** (D-20): `[adr] folder` and `[adr] numbering` in the project config
   (defaults `docs/decisions`, `ADR-0001`); `mirai setup` (39) detects an existing ADR folder and
   sets them; existing ADRs are indexed as they are and never rewritten.
7. **Approval:** `mirai approve <adr>` on its own (until 65), and as part of the design approval
   from 65; `accepted` / `rejected` (a reason required) signed; superseding marks the old one.
8. **`mirai adr review`:** the ADRs in force with their Revisit triggers; per ADR "still true" or
   "deprecated" (a reason), signed and logged (`adr_review`). The release record (60, 67) calls it.
9. **Agents' context** (decision 5): the index for every launch that has the project's documents
   as inputs; the relevant accepted ADRs in full (by `initiative`, the FR/NFR IDs, and the
   components the ticket's plan names), the last three; the rules in Kai's, Rex's and Tess's
   prompts (Arlo's at 64); a conflict is a pause (`decision_type: adr-conflict`).
10. **62b's link:** the technical note's `D-n` lines link an ADR that exists (62b's Scope already
    checks it); this unit gives the type.
11. **Docs:** `docs/adr.md` (new: when to write one, the gate, the template, what agents read, the
    lifecycle, how to use your own template); `docs/documents.md`, `docs/trace.md`,
    `docs/config.md`; `/mirai adr review` on the session list (the approval stays a terminal gate).

**Out**

- Arlo writing ADRs (64); the HLD (62) and LLD (63) templates; the design workflow (65).
- Fitness functions beyond trace checking that the Confirmation's check or test exists.
- Rewriting a project's existing ADRs into MIRAI's template.

## Tests

- **T1 The lint:** a good ADR passes; one option, no bad consequence, no gate, a missing
  Confirmation, an unknown FR ID: each named.
- **T2 Immutability:** an accepted ADR with a changed Decision is refused naming "supersede it";
  a typo fix passes; a superseding ADR's approval marks the old one `superseded` with the link.
- **T3 The cap:** three ADRs on one `standard` epic give a Vera must-fix naming one (fake Vera);
  approval with it open records it (40's `verifierField`).
- **T4 Confirmation in trace:** `check:` with no such check, `test:` with no such test in the
  gate's results, and `review:` each give the right link state.
- **T5 The index:** rendered from the files; a hand edit is a lint problem; a superseded ADR shows
  its successor.
- **T6 The project's ADRs:** a repo with `docs/decisions/adr-0001-x.md` in its own format: setup
  sets the folder and numbering; the next ADR is `adr-0002-…`; the old one is indexed, not changed.
- **T7 Agents' context:** a ticket touching component X gets the index plus X's accepted ADRs and
  the last three, never a rejected or superseded ADR in full; a plan that contradicts an accepted
  ADR pauses as `adr-conflict` (fake launcher).
- **T8 Review:** `mirai adr review` marks one deprecated with a reason, signed and logged.
- **T9 Overlay:** a project's own ADR template (an overlay with a rename map) is linted by its
  local section names.
- **T10 The docs check** (34b) passes.

## Probes (real)

- **P1 A real ADR by hand, through the gates** (in your session, `mirai-write`; about one Vera
  check, Sonnet): an ADR for the sample app's reminders (cron vs a queue). **Pass when** it lints
  clean under 600 words, Vera's findings are about the decision (not the shape), your approval
  signs it, the index lists it, and `mirai trace` shows its Confirmation link.
- **P2 Thudos's format** (the local mirror `thudos-setup`, no model): setup detects
  `docs/decisions/`; the index lists ADR-0001 as it is; a new ADR is numbered `adr-0002`.

Both can run with `--auto` except P1's writing step (your session).

## Done when

- T1–T10 pass, and the full suite passes through the build runner and CI.
- P1 and P2 pass.
- The roadmap row's done-when holds: required sections linted; supersede links checked.

## Checked against the queued units

- **43:** the ADR Confirmation link becomes real (its "no ADRs yet" note ends).
- **44:** Vera's routing applies: a finding that a decision isn't ADR-worthy is a writing finding;
  "which option" is a decision for you.
- **45:** `[tickets.inputs]` for `full` lists `adr`; on `standard` ADRs are an input when the note
  links them.
- **62b:** its `D-n` links resolve to this type.
- **62, 63, 64, 65:** the HLD's Decisions list; the LLD holds none; Arlo writes ADRs; the design
  approval signs them with the HLD.
- **60, 67:** the release record calls `mirai adr review`.

## Questions for Jet

None open: the interview settled Q1–Q5. The build-level choices (the Confirmation forms in
Scope 4, the index's format, `[adr]` keys) are defaults; the builder records any change.

## Re-checked against 44 as built (merged 2026-11-26, PR #132)

- **The cap finding is a decision, the gate finding is writing** (corrects "Checked against the
  queued units", 44): an ADR that passes none of the gate's tests is a `writing` must-fix (the fix:
  make it a line; it refuses approval until fixed); the cap's finding ("this one could be a line")
  is a `decision` (`Kind: scope`), so 44's gate shows it as "a decision only you can make" and lets
  you sign, as decision 3 says (nothing refused automatically). T3 also checks that the signed line
  names it in `vera_open`.
- **`(open)`:** the ADR lint uses 44's `checkOpenMarks` (`src/lint/open.js`), as the brief and PRD
  do: an unsettled choice is written `(open)`, warns, and blocks approval.
- **Publishing:** an ADR lives in `docs/decisions/`, not the initiative's folder, so 44's
  `publishAfter` (which takes the folder's name) would publish "decisions". The ADR's approval
  publishes the initiative in its `initiative` field; on the design approval (65) one publish covers
  the HLD and its ADRs.
- **The front matter's `status`** conflicted with 44's `pre-commit` and D-06 (every type today is
  `status = "forbidden"`). Jet's answer A: the ADR keeps it, written only by MIRAI at your
  signature; your signed lines stay the truth and the field mirrors them.
- **Signing what's written:** if MIRAI writes `accepted` into the file at approval, the signed hash
  must be of the bytes with `accepted` in them, or 44's stale-approval warning fires on the next
  commit. The same for the old ADR it supersedes: both hashes go in the one signed line. A typo or
  link fix the lint allows (decision 6) is compared with 44's `changedLines` against the approved
  text, so it doesn't count as a stale approval.

**Question for Jet (from this re-check; answered 2026-11-26, "A"):**

1. **Where an ADR's status lives** (answered **A**: in the file, written only by MIRAI at your
   signature; the type is the one exception to `status = "forbidden"`, and `pre-commit` refuses
   any change of it but `proposed`; add a test for that refusal). A: in the file (MADR's `status`), written only by MIRAI at your
   signature (`accepted`, `rejected`, `superseded`, `deprecated`); `pre-commit` refuses any other
   change of it, and a person or agent writes only `proposed`; your signed lines stay the truth and
   the field mirrors them. B: out of the file like every other type; the index `README.md` (MIRAI
   writes it) shows each status; a project's existing ADRs keep their own lines, read once at
   import. Recommendation: **A**: ADRs are read outside MIRAI (on GitHub, by other teams, by tools
   that read MADR), and existing folders like Thudos's already carry the field.

## Re-checked against 45 as built (merged 2026-11-26, PR #136)

- **45's inputs read one file per type** (`docs/mirai/<initiative>/<type>.md`); ADRs are many files
  in the ADR folder. This unit gives `adr` its own reader in `src/tickets/inputs.js`: the
  initiative's ADRs (by their `initiative` field), approved when each is `accepted` or `rejected` by
  your signed line and none is `proposed`; none at all counts as approved (an initiative may need no
  ADR).
- **An approved type, the offer:** as 62b's and 62's notes say (`DOCUMENTS`, the journal's `kind`,
  `tessOffer` after the approval).
- **The docs merge carries one folder** (the initiative's, 38's "documents only"; `outsideFolder`
  refuses anything else), and ADRs live in `docs/decisions/`. Jet's "A": the initiative's docs MR
  carries its ADRs too (question 1).

**Question for Jet (from this re-check; answered 2026-11-26, "A"):**

1. **How an initiative's ADRs reach `main`** (answered **A**: the initiative's docs MR also carries
   the ADRs it proposes, each checked at the merge against your signed approval; 38's folder rule
   gains the ADR folder for those files only; documents only still). A: the initiative's docs MR also carries the ADRs it
   proposes (their files in the ADR folder, each with your signed approval checked at the merge, as
   the initiative's documents are); still documents only. B: each ADR approval opens its own small
   docs MR for the ADR folder, merged at once. C: ADRs go with the code MR of the ticket that
   needs them. Recommendation: **A**: one MR per initiative stays the rule, the HLD and its ADRs
   land together, and the merge's checks already exist.

## Re-checked against 45b as built (merged 2026-11-26, PR #138)

- **Vera's checks follow the `verify` step's tier:** since 45b, `mirai models set verify <tier>`
  (the project) or `--mine` (your personal file) changes the model of every check of this type;
  the default stays standard (Sonnet). The probes' "Sonnet" holds in a fresh probe home (no
  personal file); each probe records the run line's tier, model and `tier_reason`, which names the
  source ("verify: deep from your personal file").
- **Nothing else changes:** this unit adds no step and launches no new agent; Arlo's step (64)
  is the `design` step, a judgement step (D-14): `mirai models` shows it as "the architect, unit
  64" until then, and refuses it below deep.
