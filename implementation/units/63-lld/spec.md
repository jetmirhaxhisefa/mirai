---
unit: "63"
name: lld
status: approved (Jet, 2026-11-26: interview Q1 "B", shape "A", Q2 "A" ("go with your recommendation"), Q3 "A", Q4 "A", Q5 "A", restatement "yes"; after the research in research.md; batch mode with 62, 64, 65)
roadmap: design/07-implementation-roadmap.md, row 63; design/01 §4 (design: HLD, ADR, LLD); research/07 §6.3 (superseded where this spec differs); units 31 (templates), 40 (Vera), 43 (trace), 45 (`[tickets.inputs]`), 61 (ADR), 62 (HLD), 64 (Arlo), 65 (the design workflow)
depends_on: ["31", "40", "45", "61", "62"]
---

# Unit 63: The LLD, a contracts document

## Why

On `full`, the HLD names the components and their interfaces but not their exact shapes, and each
of Kai's plans sees one ticket. Tickets built in parallel then disagree on the shapes they share:
the same field becomes `blockedSince` in one ticket and `blockedOn` in another (research.md, C).
Rex finds it late, after both are built. What an LLD buys agents most is agreement on exact names
and shapes, written before the tickets are cut. Everything else a classic LLD holds is already in
the PRD, the HLD, the ADRs or Kai's plans.

## Decisions (Jet, 2026-11-26, interview; research.md)

1. **One LLD per initiative, only where it is needed** (Q1, "B"): `docs/mirai/<initiative>/lld.md`.
2. **A contracts document, not a classic LLD** ("A"): only the shared, exact shapes; no narrative,
   no decisions, no alternatives, no ticket breakdown.
3. **The HLD declares it** (Q2, "A"): the HLD carries `lld: required` with the triggers that fire, or
   `lld: not-required` with a reason (unit 62's re-check). The triggers: (1) a new or changed stored
   entity or field; (2) a new or changed external contract (an endpoint, an event, a CLI command, a
   file format, a public module interface); (3) more than one module, where two tickets could pick
   different names or shapes; (4) a non-trivial state machine or algorithm no single ticket owns.
   Vera checks the declaration against the HLD (a new table with `not-required` is a must-fix).
   Tess waits for an approved `lld.md` only when the HLD says required.
4. **Typed tables, the project's own notation where it has one** (Q3, "A"): every field typed,
   required or optional, with constraints; per operation a row for each failure (status or exit
   code, machine code, retryable) and one error shape for all; a line on how a retried write stays
   safe; per schema change its migration, rollback and backfill; a Names table. A project that uses
   OpenAPI (or JSON Schema, proto, SDL) may put a fenced fragment in place of a table. Every item
   has a stable ID: `C-n` for a contract, `S-n` for a schema change.
5. **Sections and length** (Q4, "A"):
   - always: **Scope** (3–5 sentences citing PRD FR/NFR IDs, the HLD's D-n lines and ADRs, nothing
     restated), **Names**, **Failures** (case, detection, handling, what the user sees), **Test map**
     (AC ID | level | seam | the case in one line | the failure row it covers; no test code),
     **Open questions** (empty at approval);
   - when its trigger fires: **Contracts** (2), **Schema changes** (1), **Flows** (3: a
     `sequenceDiagram` per flow across modules), **State and algorithms** (4); each either filled or
     `Not applicable — <the trigger that didn't fire>`;
   - delta only: **Security**, **Observability**, **Rollout** ("as the HLD says", or only what's
     new);
   - cut: alternatives and drawbacks (ADRs), the component view (the HLD's), a ticket breakdown
     (Tess's);
   - about 2,500 words of prose: the lint warns past 2,500 and fails past 4,000; tables and code
     blocks don't count (`[docs.limits] lld_words`, `lld_warn_words`).
6. **Approval, use, lifetime** (Q5, "A"): approved after its HLD (65 later puts both in one
   sitting): refused unless the HLD is approved as it is now and says `lld: required`. Tess's tickets
   cite the items they build (`uses: [C-1, S-2]`); the lint checks every cited ID exists in the
   approved LLD and every item is used by a ticket. Kai's plan gets the LLD; Rex checks the code
   against the items the ticket cites (a mismatch is a finding with that ID as its basis). Once
   every ticket of the initiative is merged the LLD is frozen: the code owns the shapes, and a later
   change belongs to a new initiative's LLD.

## Scope

**In**

1. **The type `lld`:** `registry/document-types/lld.toml`, `registry/templates/lld.md`,
   `lld-checklist.md` with `[vera]` lines, an example (`registry/examples/lld.md`, the sample app's
   due dates on `full`), protected parts with `read_by` (37), `template_version` 1 and its hash;
   path `docs/mirai/<initiative>/lld.md`; the "HLD:" line under the title links the HLD;
   `status = "forbidden"`; `verifier = true`; IDs `C-n`, `S-n`, and FR/NFR/AC cited from the PRD.
2. **The lint** (`src/lint/lld.js`): the always-sections; each trigger section filled or `Not
   applicable — <reason>`; every operation in Contracts with typed fields, at least one failure row
   and a retry line for a write; every schema change with migration, rollback and backfill;
   Names unique; the test map covers every AC of the PRD in scope and every failure row; cited
   D-n and ADRs exist; Open questions empty at approval; no "Alternatives"/"Decisions" section; the
   word caps (tables and code blocks not counted); `(open)` (44).
3. **The checklist** (Vera): could a builder implement it without guessing (a "builder check":
   only the questions where a wrong guess would matter); the shapes match the HLD's components
   and flows; consistent with the code at the cited files; every non-obvious choice cites a D-n or
   an ADR (the LLD decides nothing); hidden limits, re-runs, security surface; no false revise of a
   thin LLD.
4. **The HLD's line** (with 62): `lld:` and its triggers or reason; Vera's check of it.
5. **Inputs (45):** `lld` in `[tickets.inputs].full` becomes conditional: needed only when the
   approved HLD says `lld: required` (`src/tickets/inputs.js`).
6. **Approval:** `mirai approve <id> --file …/lld.md`: the lint, Vera's result, the HLD approved as
   it is now with `lld: required`; one signed line (`kind: lld`); 44's publish; 45's offer when it
   completes `full`'s list. The docs merge checks it as it checks the HLD.
7. **Tickets cite it:** story and bug gain `uses` (a list of `C-n`/`S-n`, a template bump); the
   ticket lint checks each against the initiative's approved LLD; the epic's set approval checks
   every LLD item is used by at least one ticket; Tess's prompt says to cite them.
8. **Kai and Rex:** the approved LLD is a plan and review input (as 62b's note is); Rex's prompt:
   a change against a cited `C-n`/`S-n` is a finding with that ID as its basis (a `rule` basis
   resolving against the LLD's IDs).
9. **Frozen after the ship:** once every ticket of the initiative is merged, a change to `lld.md`
   is refused by the pre-commit hook ("a shipped initiative's LLD is frozen: write the change into
   a new initiative's LLD").
10. **Docs:** `docs/lld.md` (new), `docs/documents.md`, `docs/tickets.md` (`uses`), `docs/config.md`
    (`lld_words`), the `mirai-write` guide `lld.md` (rules; examples from P1's real draft).

**Out:** Arlo writing it (64); the one-sitting approval (65); generating code or OpenAPI files from
it.

## Tests

- **T1** the type, template, checklist, example (lints clean); protected parts.
- **T2** the lint: a missing failure row, a write with no retry line, a schema change with no
  rollback, a duplicate name, an AC not in the test map, a failure row with no test, an unknown
  D-n, an Alternatives section, the caps, a trigger section neither filled nor `Not applicable`.
- **T3** the HLD's `lld:` line: required with no LLD keeps Tess waiting; not-required doesn't.
- **T4** approval: refused while the HLD isn't approved or says not-required; one signed line;
  the docs merge checks it.
- **T5** `uses`: an unknown ID fails the ticket lint; an item no ticket uses fails the set approval.
- **T6** Kai's and Rex's inputs and Rex's basis.
- **T7** frozen after the ship: the pre-commit refusal.
- **T8** the docs check (34b); the guide's examples (34).

## Probes (real)

- **P1 An LLD in the session, reviewed** (Vera, Sonnet): the sample app's due dates on `full`
  (with the HLD from 62's P1): lint clean, Vera's findings about the shapes, not the format.
- **P2 Tess cites it:** Tess cuts the set from the PRD, HLD and LLD; every ticket's `uses` resolves
  and every item is used.

## Done when

T1–T8 pass, the full suite through the build runner and CI; P1 and P2 pass; the roadmap's
done-when holds ("the AC-mapped test plan section is linted").

## Checked against the other units

- **62:** the HLD gains `lld:` (its re-check, below in 62's spec); the HLD's cap message points here.
- **64:** Arlo's run 2 writes it (step `lld`, standard), against the HLD as Vera checked it.
- **65:** the one sitting signs it with the HLD and ADRs; the set check traces FR → component →
  LLD item; the change run amends it with a changelog line, IDs stable.
- **45:** `lld` conditional in `full`'s inputs.
- **42 (Tess), 21 (Kai), 24 (Rex):** `uses`; inputs; basis.
