---
unit: "62"
name: hld
status: approved (Jet, 2026-11-26: "approve 135"; interview 2026-11-26: Q1–Q5 "A", restatement "yes"; after the web research in research.md)
roadmap: design/07-implementation-roadmap.md, row 62 (build order: with 61–65 and 62b, right after 45 and 45b, Jet 2026-11-24); design/01 §4 (design: HLD, ADR, LLD); research/07 §3, §4.2, §6.2 (arc42, C4, the pilot's 16 sections); D-06 (status in the store), D-20 (a project's format wins), D-40 (Mermaid); units 31 (templates), 34 (`mirai-write`, the reader test), 37 (overlays, rename map), 40 (Vera), 43 (trace), 44 (the document rules), 45 (`[tickets.inputs]`), 61 (ADR), 62b (technical note), 63 (LLD), 64 (Arlo), 65 (the design workflow)
depends_on: ["31", "34", "37", "40", "43", "44", "61"]
---

# Unit 62: The HLD (high-level design)

## Why

On the `full` track a feature is big enough that parts get built separately: several epics,
several people or agents, sometimes a new service. The PRD says what and why; the ADRs (61) say
why one hard choice went the way it did. Nothing yet says **how the whole feature fits
together**: its parts, how requests and data flow between them, who owns which data, and how each
requirement is met. Without it, two agents can each follow the PRD and build parts that don't fit
(design/01 §4's adversarial question).

The HLD is that document: one per feature, read while the feature is built (the next big feature
gets a new one), and short enough for you to review in about 15 minutes. It links ADRs, never
repeats them (research.md: arc42 §9, NASA, Microsoft).

**Why now:** tickets on `full` are cut from the PRD, HLD, ADRs and LLD (45's decision 2); 61 gives
the ADR, and 63 (LLD), 64 (Arlo) and 65 (the design workflow) build on this type.

## Decisions (Jet, 2026-11-26, interview; research.md)

Settled before it (design/01 §4): one HLD per feature on `full`, read while it's built; it links
ADRs and never repeats them.

1. **A required core and optional sections** (Q1, "A"). The core, in this order:
   1. **Goals and quality goals:** what the design must achieve, and the top 3–5 quality goals as
      measurable scenarios (arc42 §1);
   2. **Context and scope:** the context diagram, what's outside the system, and the non-goals
      (something someone could reasonably want, deliberately left out);
   3. **Solution strategy:** the approach in a few sentences, and what isn't changing;
   4. **Building blocks:** the container diagram and a components table (component,
      responsibility, owner, cited path or `(new)`);
   5. **Key flows:** one sequence diagram per key flow, with its error path;
   6. **Data:** who owns which data, what changes, the migration and whether it can be undone;
   7. **Cross-cutting rules and conventions:** one table (naming, IDs, date formats, error shape,
      logging, security) that every part follows (research/13 §7);
   8. **Decisions:** each real choice as one line (`D-n`), or a link to an ADR when it passes
      61's gate;
   9. **Trace table:** every FR and NFR → its component(s) → its decision;
   10. **Risks and rollout:** the order of changes, a flag, what breaks if half-shipped, rollback.

   Optional, each either filled in or written `Omitted: <reason>` (arc42's "omitted"; the lint
   checks one or the other): **Deployment**, **Observability**, **Failure modes**, **Test
   strategy**, **Constraints**, **Glossary**.
2. **Diagrams** (Q2, "A"): Mermaid `flowchart` with C4 labels (`Person:`, `Container:`,
   `External:`), not Mermaid's C4 syntax (still experimental). Required: the context diagram, the
   container diagram, and a `sequenceDiagram` per key flow (at least one). The lint runs the
   shallow Mermaid check (D-40); Vera checks that every container in the diagram is in the
   components table and the reverse.
3. **The lint checks the structure, Vera the substance** (Q3, "A"):
   - **Trace table** `ID | Component(s) | Decision | Note`: every FR and NFR of the linked PRD has a
     row and no other ID does; every component is in the components table; every decision is a
     `D-n` of this HLD or an ADR link that resolves (accepted, or proposed on the same approval,
     61); `deferred: <reason>` allowed in place of a component;
   - **Quality goals:** each a scenario citing an `NFR-n`, with a number ("NFR-2: 500 users export
     at once → each export finishes within 30 s"); so a goal's number comes from the PRD, never
     invented (44's Q3 "B"). Vera judges whether the scenario tests the goal and the design meets it.
4. **Length** (Q4, "A"): the summary keeps 600 words (`hld_summary_words`, fails above); the whole
   HLD 4,000 (`hld_words`, warns above: "move per-epic detail, tables, endpoints, data models, into
   an LLD (unit 63)"). Both project settings, like the PRD's.
5. **A project's own HLD template** (Q5, "A", D-20): through 37's overlays and rename map. Its
   section names map onto the core; a core section it lacks is added at the end (the pilot's
   16-section template gets the trace table and Decisions, research/07 §4.2); the lint, Vera and
   trace read the mapped names; its extra sections ("Transaction and consistency model") stay.

## Scope

**In**

1. **The document type** `hld` (`registry/document-types/hld.toml`, the template
   `registry/templates/hld.md`, the checklist `registry/templates/hld-checklist.md` with `[vera]`
   lines, an example `registry/examples/hld.md`: the sample app's due-dates feature as if on
   `full`): the sections of decision 1, `template_version` 1 and its hash in
   `test/lint/template-versions.json`; protected sections and fields with `read_by` (37); path
   `docs/mirai/<initiative>/hld.md` (the store's `pathOf`, 38); the line under the title links the
   PRD (`PRD: …`); `status = "forbidden"` (D-06; 44's `pre-commit` refuses a hand-set one);
   `verifier = true`; a summary with the reader test (34).
2. **The lint** (`src/lint/hld.js`): the core sections; each optional section present or
   `Omitted: <reason>` (a reason of at least a few words); the three required diagram kinds
   (context, container, at least one sequence), found by the C4 labels and `sequenceDiagram`; the
   trace table and quality goals (decision 3); `D-n` numbered and unique; every component and data
   change cites a path that exists in the repo (a warning for `(new)`); 44's `checkOpenMarks`
   (`(open)` warns and blocks approval); the word caps (decision 4).
3. **The checklist** (Vera's `[vera]` lines): diagram ↔ components table both ways; "two teams
   obey every rule here and still build incompatible parts: where?"; the claims about the code
   hold at the cited files; each quality scenario tests its goal and the design meets it; every
   `D-n` that passes 61's gate is an ADR (else a `writing` must-fix: "make it ADR-n"); data
   ownership has one owner per entity; the conventions table covers what parallel parts must
   agree on. 44's routing and grading apply: "which approach" is a `decision` for you.
4. **Approval:** `mirai approve <id> --file …/hld.md`: the lint, Vera's result, the reader test,
   the PRD approved as it is now; the ADRs it proposes on the same screen (61's decision 6), one
   signed line each; then 44's `publishAfter` (the docs MR), and 45's offer when the HLD
   completes `full`'s list. The design gate stays human always (D6). From 65, the combined design
   approval takes this over.
5. **Trace** (43's documents scope): the HLD's trace table gives the FR/NFR → component links on
   `full` (as 62b's Coverage does on `standard`); a requirement with no row, or `deferred`
   without a reason, is a missing link. On `full` with no HLD yet, trace says so as a note, as it
   does for the technical note today (`src/trace/documents.js`).
6. **Inputs:** `hld` in `[tickets.inputs].full` (45); Kai's plan gets the approved HLD's sections
   for the ticket's components (the components table, its flows, the conventions table), cited by
   section.
7. **Overlays** (decision 5): a rename map from a project's section names onto the core; a core
   section missing from the project's template is appended by the template render, so the lint
   and trace find it.
8. **Until Arlo (64):** written by hand or in your session with the `mirai-write` skill; the
   lint, Vera and your approval as above. The skill gains the HLD's guide (decision 1's order,
   what goes to an ADR, what goes to the LLD).
9. **Docs:** `docs/hld.md` (new: when there's an HLD, the sections, the diagrams, the trace table,
   your own template); `docs/documents.md` (the type, the caps, the `Design:` line now live),
   `docs/trace.md`, `docs/config.md` (`hld_words`, `hld_summary_words`).

**Out**

- The LLD (63), Arlo (64), the combined design approval (65).
- A living system-wide architecture document; Structurizr or other model tools.
- Rendering diagrams to images; a full Mermaid parse (D-40's shallow check stays).
- Rewriting a project's existing HLDs into this template.

## Tests

- **T1 The lint, the core:** the example passes; a missing core section, a missing context or
  container diagram, no sequence diagram: each named.
- **T2 Optional sections:** absent and not marked is a problem; `Omitted: <reason>` passes;
  `Omitted:` with no reason is a problem.
- **T3 The trace table:** a PRD FR with no row, an ID the PRD doesn't have, a component not in
  the components table, a broken ADR link, `deferred` without a reason: each named; a proposed
  ADR on the same approval passes.
- **T4 Quality goals:** a goal without an `NFR-n` and one without a number are named; more than 5
  goals warns.
- **T5 Caps:** a summary over 600 fails; a document over 4,000 warns with the LLD hint; both read
  from the project's config.
- **T6 Vera** (fake): a container in the diagram that's missing from the table is a must-fix; a
  `D-n` that passes the ADR gate is a `writing` must-fix; an approach choice is a `decision`.
- **T7 Approval:** refused while the PRD isn't approved as it is now, or `(open)` is in it, or
  Vera has writing must-fix open; with proposed ADRs, one signed line each; the publish runs; on
  `full` with the HLD completing the list, 45's offer is shown (fake launcher).
- **T8 Trace:** the HLD's rows become FR → component links; a missing row is a missing link.
- **T9 Overlay:** the pilot's section names through a rename map lint clean; the appended trace
  table and Decisions are found.
- **T10 Status:** a hand-set `status` in `hld.md` is refused at commit (44's `pre-commit`).
- **T11 The docs check** (34b) passes with the new type and keys.

## Probes (real)

- **P1 A real HLD by hand, through the gates** (your session, `mirai-write`; about one Vera check
  and one reader test, Sonnet): an HLD for the sample app's due-dates feature on `full`. **Pass
  when** it lints clean under 4,000 words, Vera's findings are about the design (not the shape),
  you review it in about 15 minutes, your approval signs it, and `mirai trace` shows its FR →
  component links.
- **P2 The pilot's template** (no model): the pilot's 16-section template as an overlay with a
  rename map lints a hand-written HLD clean, with the trace table and Decisions appended.

## Done when

- T1–T11 pass, and the full suite passes through the build runner and CI.
- P1 and P2 pass.
- The roadmap row's done-when holds: the trace table is linted; the Mermaid check passes.

## Checked against the queued units

- **43:** trace gains the HLD's FR → component links on `full`.
- **44:** the document rules apply: no status in the file, `(open)`, Vera's routing and grading,
  the publish at approval.
- **45:** `[tickets.inputs].full` lists `hld`; its approval can complete the list and show the
  offer.
- **61:** the HLD's Decisions link ADRs; ADRs it proposes are approved on its screen; the cap (3
  on `full`) is Vera's.
- **62b:** the same shape where they overlap (Decisions as `D-n`, Coverage ↔ the trace table);
  the note stays `standard`'s only.
- **63:** the LLD takes the detail the HLD's cap pushes out; the HLD links each LLD (`Design:`).
- **64, 65:** Arlo writes it with this template and checklist; 65's design approval signs the HLD
  with its ADRs and LLDs.

## Questions for Jet

None open: the interview settled Q1–Q5. The build-level choices (the example's feature, the
optional sections' order, the reason's minimum length) are defaults; the builder records any
change.

## Re-checked against 45 as built (merged 2026-11-26, PR #136)

- **The name and path match 45's list:** `hld` in `[tickets.inputs].full`, read at
  `docs/mirai/<initiative>/hld.md`. Until this unit, 45 prints "no HLD yet (unit 62)"; once the
  type exists, an HLD not approved as it is now refuses `mirai tickets` on `full`.
- **The offer to start Tess** (`tessOffer` in `src/cli/commands/approve.js`) runs today only after a
  PRD's approval. This type's approval calls it too, after the publish and before the documents'
  lines (45's order), so approving the last document the track needs asks to start her.
- **An approved type:** `documentApproval` and the approval line's `kind` know `brief`, `prd` and
  `epic` only (`DOCUMENTS` in `approve.js`, the journal's `kind` enum); this type joins both, or 45's
  input check (`src/tickets/inputs.js`) can never see it approved.
- **The docs merge:** `approvalGaps` (`src/store/connectors/state.js`) refuses a document type it
  doesn't check ("has no approval MIRAI checks before a docs merge"); this type joins its approved
  types, checked as the PRD is (your last approval matches the file at the head).
- **Tess's input:** 45 passes it to her as `hld.md`; Scope 6's Kai input is new.

## Re-checked against 45b as built (merged 2026-11-26, PR #138)

- **Vera's checks follow the `verify` step's tier:** since 45b, `mirai models set verify <tier>`
  (the project) or `--mine` (your personal file) changes the model of every check of this type;
  the default stays standard (Sonnet). The probes' "Sonnet" holds in a fresh probe home (no
  personal file); each probe records the run line's tier, model and `tier_reason`, which names the
  source ("verify: deep from your personal file").
- **The reader test** runs on the `reader-test` step (standard by default), settable the same way.
- **Nothing else changes:** no new step; Arlo's HLD (64) is the `design` step, kept deep (D-14).

## Re-checked against 61 as built (merged 2026-11-26, PR #140)

- **Where ADRs are, and the link:** ADRs live in the project's `[adr] folder` (default
  `docs/decisions`, numbered by `[adr] numbering`), read with `listAdrs`/`adrSettings`
  (`src/adr/adr.js`). A `D-n` line links the ADR file itself (from `docs/mirai/<initiative>/` that is
  `../../decisions/ADR-0001-<slug>.md`), never the index (`README.md`, or `index.md` when the
  folder's README is the project's own). The lint resolves it and checks it is an ADR of the folder
  that is `accepted`, or `proposed` and signed on the same approval; a link to a rejected,
  superseded or deprecated ADR is refused, naming the one that replaced it.
- **Signing the ADRs it proposes, on the same screen** (61's decision 6): 61 built the ADR's approval
  on its own (`src/cli/commands/approve-adr.js`): MIRAI writes `status: accepted` (or `rejected` with
  your reason) into the file, signs those bytes, marks an ADR it supersedes in the same line
  (`files`), keeps the signed text (`keepSignedCopy`) and renders the index. This unit's approval
  reuses that core, factored out of `approveAdr`, so one screen signs the document and one line per
  ADR it proposes; it doesn't copy it.
- **The cap:** Vera's ADR check already gets `adrs.md` (the initiative's ADRs and its track). Her check
  of this type gets the same file, so "too many ADRs" is seen from the design document too.
- **The docs MR:** 61's merge carries the initiative's ADRs (with any they superseded and the index)
  and checks each against your signed line; this type still has to join `approvalGaps`
  (`src/store/connectors/state.js`), as the earlier notes say.
- **Agents:** 61 gives Kai, Rex and Tess the ADR index and the accepted ADRs that touch the work, and
  Kai's `ADR-CONFLICT` stop parks the ticket `adr-conflict`. A departure from one of this document's
  `D-n` lines (not an ADR) is this unit's own check, as its spec says.
- **On `full`, the ADRs are an input of their own** (61's `adrInputState`): Tess waits while one of
  the initiative's ADRs is still proposed. Approving the HLD with its proposed ADRs on one screen
  clears both.
- **The trace table's Decision column** reads the same `D-n` or ADR link; trace's ADR Confirmation
  links (61) are separate and stay as built.

## Re-checked against the interviews of 63, 64 and 65 (2026-11-26, batch mode)

What the later units need from the HLD, built here so they don't collide:

- **`lld:` in the frontmatter** (63's Q2 "A"): `lld: required` with `lld_triggers` naming the
  triggers that fire (`entity`, `contract`, `modules`, `state`), or `lld: not-required` with
  `lld_reason` (a few words). The lint checks one or the other; Vera checks it against the HLD (a
  new entity in Data with `not-required` is a must-fix). Decision 4's cap message points to the LLD.
- **"Current state"** (64's Q3): a core section after "Context and scope": what the code does today
  where this design touches it, each claim cited `path:line` or marked `unverified`. The lint checks
  each bullet cites or says unverified; Vera checks the cites hold. The core is 11 sections.
- **"Decisions for you" answerable at the sitting** (64's Q2, 65's Q3): in the summary's "Decisions
  for you" part, each decision lettered (`A:`, `B:`, `C:` options, one marked "(recommended)", and
  the choice the document is written for); the lint checks the shape, so 65's sitting can record
  your letter.
- **"(Arlo's call)"** (64's Q2): a D-n line may end with "(Arlo's call)"; 65's sitting lists them.
  Not required (a person writing the HLD has no calls of Arlo's).
- **Inputs (45):** with 63, `lld` in `full`'s list is needed only when the approved HLD says
  `lld: required` (63 builds the reader).
- **Approval:** this unit's approval (with the ADRs on its screen) is what 65 turns into the set's
  sitting; built here as the spec says, with the ADR signing from 62b's factored core
  (`proposedAdrReady`, `adrDecision`, `adrsSigned`).
