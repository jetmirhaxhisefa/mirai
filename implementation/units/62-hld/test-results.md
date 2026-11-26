# Unit 62: test results (2026-11-27, overnight batch)

**Built overnight, for your morning review.** P1 and P2 passed. Built on `unit/62-build`, stacked on
`unit/62b-build` (62b not yet approved), with the specs of 63–65 merged in (PR #144).

## What was built

| Scope | Where | What |
|---|---|---|
| 1 The type | `registry/document-types/hld.toml`, `registry/templates/hld.md`, `hld-checklist.md`, `registry/examples/hld.md` | The summary for approval (600 words, reader-tested) and the 11 core sections in order: Goals and quality goals, Context and scope, **Current state** (64's re-check), Solution strategy, Building blocks, Key flows, Data, Cross-cutting rules and conventions, Decisions, Trace table, Risks and rollout; 6 optional, each filled or `Omitted: <reason>`. The `lld` field with `lld_triggers` or `lld_reason` (63's re-check). The PRD line; FR/NFR cited; `NG-n` numbered on from the PRD's; `D-n` in Decisions; `status = "forbidden"`; `verifier = true`. |
| 2 The lint | `src/lint/hld.js` | `lld`; Omitted with a reason; the context (Person:/External:), container (Container:) and sequence diagrams; Current state cited `path:line` (checked in the repo) or "unverified"; the components table's paths (or `(new)`); quality goals with an NFR and a number (more than 5 warns); the D-n lines (the technical note's check, now shared: `checkDecisionLines`); "Decisions for you" lettered, one "(recommended)", "Written for: <letter>" (65's sitting); the trace table against the PRD, the components table, the D-n and ADR links, `deferred: <reason>`; `(open)`; past 4,000 words a warning naming the LLD. |
| 3 Vera | `hld-checklist.md`, `src/verify/run.js` | Her lines (the summary decides alone; diagrams ↔ table; "two teams obey every rule and still build parts that don't fit"; one owner per entity; no invented connections; the cites hold; quality goals met; the `lld` field right; a D-n past the ADR test is a writing must-fix; the cap; "(Arlo's call)" lines the owner would expect to be asked). Her inputs gain `adrs.md`. |
| 4 Approval | `src/cli/commands/approve-tech-note.js` (now `approveDesignDoc` for the note and the HLD) | The PRD approved as it is now; the lint as at approval (the PRD, the linked ADRs, the repo); Vera's result; **the reader test**; its proposed ADRs accepted on the same screen (61's core); one signed line (`kind: hld`, with `reader_test`); 44's publish; 45's offer. The docs merge checks it as it checks the PRD. |
| 5 Trace | `src/trace/documents.js`, `src/trace/initiative.js` | Every FR and NFR → its component: the HLD's trace table on `full`, **and the technical note's Coverage on `standard`** (62b never wired this: its "no technical note yet" note checked a type named `technical-note`; fixed here). |
| 6 Inputs | `src/agent/inputs.js`, `src/agent/plan.js`, `src/agent/review.js`, `approve.js` | Tess gets the approved HLD on `full` (45's reader, `hld.md`). Kai's plan and Rex's review get it (`approvedHld`); the plan gate flags a departure from its D-n lines as from the note's; Rex's D-n basis reads it too. |
| 7 Overlays | (37's machinery) | A project's own HLD template maps onto the core by renames, its own sections kept (P2). |
| 8 The guide | `registry/skills/mirai-write/guides/hld.md` | The rules and three examples from P1's real first draft and Vera's findings on it. |
| 9 Docs | `docs/hld.md` (new), `docs/documents.md`, `docs/config.md` (`hld_words`, `hld_summary_words`), `docs/README.md` | |

## Tests

| Test | Result (Mac) |
|---|---|
| T1 the example clean against the sample app; a missing core section, context, container or sequence diagram, each named | pass |
| T2 optional sections: absent; Omitted with and without a reason | pass |
| T3 the trace table: a missing FR, an ID not the PRD's, an unknown component, D-n or ADR, deferred with and without a reason | pass |
| T4 quality goals: no NFR, no number, more than five | pass |
| T5 the caps, and the project's override | pass |
| T6 Vera's checklist; the re-check's `lld`, Current state, lettered decisions, "(Arlo's call)" | pass |
| T7 approval: refused before the PRD; one line with its ADR, the reader test, the planner's input; T10 a hand-set status refused at commit | pass |
| T8 trace: the HLD's rows, a missing row, the note's Coverage | pass |
| T9 the pilot's names through a rename map | pass |
| T11 the docs (34b); the guide's examples (34) | pass |

Pinned lists updated: the registry's types, the template hashes (hld v1), Vera's types, the skill
bundle and detection lists, 43's trace note wording.

## Probes (real)

`test/probes/hld-probes.js`:

- **P2 PASSED** (no model, `~/mirai-u62-p2.txt`): the pilot's own template from `thudos-setup`'s
  history, all 16 sections; 8 renamed onto the core, 7 kept as its own; a hand-written HLD in its
  names lints clean, the trace table and Decisions found.
- **P1 PASSED** (`~/mirai-u62-p1.txt`; runs 1–5 in `~/mirai-u62-p1-run*.txt`): an HLD written in this
  session for the sample app's owner-only due dates (44's PRD, which fits the app), with 62b's
  ADR-0001 (the browser's time zone). Vera on `claude-sonnet-5-5`, every finding about the design:
  - round 1 (a fresh home): the create path and its request class missing; a title-only edit of a
    late task undecided; the summary hiding the UTC fallback and that a rollback loses the dates;
    **the owner check on `update` (a security change) decided quietly in a D-n line**;
  - the ADR: the header goes with writes but lateness is judged on a read (fixed: the late mark is
    drawn in the browser from its own zone);
  - rounds 2–4 in one home (the probe now resumes, as your rounds would): the edges of a partial
    edit (an absent date keeps it, `null` clears it), the release order and the optional title in
    the summary, the 403 in a flow;
  - past her last round one decision stayed open (the request classes: the controller imports
    them, this copy of the sample app lacks their files), approved anyway and named in the signed
    line, as 44's rule says.
  The reader test passed; the approval signed the HLD and accepted ADR-0001 on the same screen;
  `mirai trace` links FR-1…FR-5 and NFR-1 to their components. The HLD: `p1/hld-final.md`.

## Changed from the spec

- **Current state, `lld`, lettered decisions, "(Arlo's call)"**: added from the 63–65 interviews
  (62's re-check in its spec).
- **Approval** shares 62b's code (`approveDesignDoc`) instead of a copy.
- **The note's trace link** (62b) is built here.

## Decisions I made overnight

- The trace for the note lives here (62b missed it): the same rule as the HLD's, from its Coverage.
- P1 on 44's owner-only PRD, not the team one (the sample app has no teams; 62b's P1 found this).
- The probe resumes a home so Vera's rounds go on, rather than a fresh round 1 each time.
