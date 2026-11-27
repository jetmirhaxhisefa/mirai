# Unit 63: test results (2026-11-27, overnight batch)

**Approved 2026-11-27 ("approve 63"), PR #146.** Runner green: tests (u63-tests-1), baseline, red team GREEN (u63-redteam-2). P1 and P2 passed. Built on `unit/63-build`, stacked on
`unit/62-build`.

## What was built

| Scope | Where | What |
|---|---|---|
| 1 The type | `registry/document-types/lld.toml`, `registry/templates/lld.md`, `lld-checklist.md`, `registry/examples/lld.md` | A contracts document: always Scope, Names, Failures, Test map, Open questions; when a trigger fires Contracts (`C-n`), Schema changes (`S-n`), Flows, State and algorithms, each filled or `Not applicable — <why>`; Security, Observability, Rollout as a delta. The "HLD:" line; `status = "forbidden"`; Vera's; protected parts (Scope, Names, Contracts, Schema changes, Failures, Test map, Open questions, the HLD link). No summary (decision 2: no narrative), so it is exempt from the summary check. |
| 2 The lint | `src/lint/lld.js` | Failure rows per contract; a `Retry:` line per write; migration, rollback, backfill per schema change; each name once; the test map covers every failure and every AC of the PRD's FRs/NFRs the Scope cites; D-n are the HLD's; an unknown section (Alternatives, Decisions) refused; Open questions empty at approval; `(open)`; prose words (tables and code don't count) warn past 2,500, fail past 4,000. |
| 3 Vera | `lld-checklist.md`, `src/verify/run.js` | Her builder check, the shapes against the HLD and the code, every choice cited, hidden limits; she gets the initiative's ADR list. |
| 5 Inputs | `src/tickets/inputs.js` | `lld` on `full` is needed only when the HLD says `lld: required` (state `not-needed` otherwise, named on Tess's line). Tess gets the approved LLD with what to do with it. |
| 6 Approval | `approve-tech-note.js` (`approveDesignDoc` now takes the LLD) | Refused unless the HLD is approved as it is now and says `lld: required`; the lint with the PRD beside it; Vera's result; one signed line (`kind: lld`); 44's publish; 45's offer. |
| 7 `uses` | `src/lint/lld-items.js`, `checks.js` (ticket), `epic.js` | story and bug carry `uses: [C-n, S-n]`; the ticket lint refuses an ID `../lld.md` lacks; the epic refuses an LLD item no ticket uses. Checked by `mirai lint`, **Tess's in-run lint and the set's approval** (P2 found the last two weren't given the LLD). Tess's prompt says to cite them. |
| 8 Kai and Rex | `src/agent/inputs.js`, `plan.js`, `review.js` | Both get the approved LLD; Kai builds the cited items exactly; Rex's finding on one has that `C-n`/`S-n` as its basis (rule bases read from the LLD's text, without the lint, so the review launch's cage doesn't grow). |
| 9 Frozen | `src/hooks/pre-commit.js` | Once every ticket of the initiative is merged into the integration branch (`mr_merged`), a staged change to its `lld.md` is refused. |
| 10 Docs | `docs/lld.md` (new), `documents.md`, `config.md`, `pre-commit.md`, `README.md`; guide `guides/lld.md` | The guide's three examples are from P1's real draft. |

## Tests

| Test | Result (Mac) |
|---|---|
| T1 the type, template, checklist, example (clean), protected parts | pass |
| T2 the lint: failures, retry, schema, names, test map (AC and failure), D-n, Alternatives, Not applicable, Open questions, the caps and the override | pass |
| T3 required keeps Tess waiting; not-required doesn't, and says so | pass |
| T4 approval: refused before the HLD; refused when it says not-required; one signed line; a hand-set status refused | pass |
| T5 `uses`: an unknown ID; an unused item | pass |
| T6 Kai's and Rex's prompts and Rex's bases | pass |
| T7 frozen after the ship | pass |
| T8 the docs; the guide's examples (34) | pass |
| P2's fix: the epic links each ADR at its file, and its lint agrees | pass |

Pinned lists updated: the registry's types, the template hash (lld v1), Vera's types, the summary
exemptions, the guide count (24), the skill bundle and detection lists.

## Probes (real)

`test/probes/lld-probes.js`:

- **P1 PASSED** (`~/mirai-u63-p1*.txt`): the owner-only due dates on `full`, with 62's P1 HLD and ADR
  approved in the home, and an LLD written in this session. Vera on `claude-sonnet-5-5`, every finding
  about the shapes:
  - draft (`p1/lld-r1.md`), round 1, pass with 2 suggestions: the 403's body is a second error shape;
    the 120-character title has no failure row;
  - the next draft (`p1/lld-r2.md`), round 1 of a fresh home: **must-fix**: the LLD fixes a display
    format ("Due 15 Jan 2027") the HLD never names (it is the PRD's AC-FR-2.1: now cited in Names);
    the check order on an edit (403 first); the past-date message's full stop;
  - round 2 (`p1/lld-r3.md`): **must-fix**: a title sent empty on edit has no refusal; the 403's text in
    the list; an impossible day (`2027-02-30`). Writing the fix, I first claimed the list shows a
    message "as for `complete` today"; the code has no error handling at all, so the line now says so;
  - round 3 (`p1/lld-final.md`): pass, one suggestion (the file I cite for "no message" has no save at
    all, so it shows nothing for a different reason). The approval signed it.
- **P2 PASSED** (`~/mirai-u63-p2.txt`): Tess (Sonnet) cut 5 stories from the PRD, the HLD, the ADR and
  the LLD; her run ended `done` (lint clean, Vera 0 must-fix); every `uses` resolves (C-1, C-2, C-3,
  S-1 all used, none unknown). The home's LLD had its Vera pass seeded (`--seeded`): P1 proved it.
  - **Its first run failed on a bug it found**: the epic's Design decisions linked each ADR as
    `adr/ADR-0001.md` (the pre-61 convention), a broken link on every initiative with ADRs. Fixed:
    `mirai epic render`, Tess's render, her lint and the set's approval link the ADR's real file
    (`adrPathFor`). Its second run passed the probe's own checks while her run had stopped on that
    lint: the probe now requires her run to end `done`.

## Changed from the spec

- **No template bump for `uses`** in story and bug: an optional field; their templates' text doesn't
  change, so tickets already written stay valid.
- **"Frozen" reads `mr_merged`** (merged into the integration branch), the merge itself, rather than
  your merge approval line.
- **The epic's ADR links** (above): a fix outside 63's scope, found by P2.

## Decisions I made overnight

- The LLD has no summary for approval (decision 2's "no narrative"); exempt from the summary check.
- `uses` is checked against `../lld.md` beside the tickets, whether or not it is approved yet; the
  approval of the set is where an unapproved LLD stops things (Tess waits for it on `full`).
- Rex's rule bases are read from the LLD's text with a small scan, not the lint, to keep the review
  launch's red-team cage unchanged.
