---
unit: "09b"
name: report-templates
status: approved (2026-10-24, as part of unit 09; split by open point 1)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 09; R-M7, R2-C1, R3-C2, R3-C3, Q9; D-12, D-16, D-29, D-46; 01 §9 (loop rules L1–L8), §10, §11, §13; 03 "Templates"
depends_on: ["05b", "08b", "09a"]
---

# Unit 09b — The report templates

Unit 09's spec was approved with its five open points as recommended. This is the second half:
the QA report, the run report and the MR description. Unit 09a (`../09a-findings-schema/spec.md`)
has the schemas and the findings logic.

## Why

The fix loop is decided by a script, not by agent goodwill (01 §9, L8):
- only blocking findings send work back;
- a finding must cite its basis;
- the same failure twice means a plan problem;
- progress must be strict.

None of that can be deterministic without a fixed format for findings and verdicts (R-M7). And
what an agent returns is untrusted: the launcher captures it as structured output, and MIRAI
must check it before believing a word (R2-C1).

The reports are where you meet the results each morning. The MR description is the only part
that leaves your machine, so it must never carry review text (Q9, D-29).

**Roadmap "done when" (09b's share):**
- a rendered MR description holds no findings.

## Scope

**In:**
- **Four structured-output schemas,** as JSON Schema files in `registry/schemas/`:
  - **`review-verdict`:** the reviewer's verdict and findings;
  - **`finding-replies`:** the developer's `fixed` / `disputed` per finding (L3);
  - **`qa-verdict`:** the QA agent's verdict and evidence per AC;
  - **`gate-result`:** what the orchestrator records after the named checks (R3-C2). It's not
    agent output, but the same kind of checked data.
- **A small validator** for the JSON Schema subset the schemas use (D-04: no packages), so a
  captured output is checked by MIRAI itself.
- **Findings logic:**
  - `findingFingerprint`: file + symbol + `basis.ref`, never line numbers (L4);
  - `failureSignature`: a test failure with numbers, times, hashes and paths normalized;
  - `resolveBasis` and `triage`: a blocking finding without a citation or with an unresolvable
    `basis.ref` is downgraded (L1).
- **Three report templates and their renderers:** the QA report and the run report (both stay
  in the store), and the MR description (it goes to the git host).

**Out:**
- **Running the reviewer, QA or the checks:** units 24, 50–51, 22.
- **The loop guard,** which compares fingerprints across rounds: unit 20. This unit gives it
  the fingerprint and the signature.
- **Signing the gate-result record** and the other proofs: unit 25. This unit defines the
  record's content.
- **The changed-lines check:** a finding outside the diff is "pre-existing" (unit 24). The triage
  takes the changed lines as an optional input.
- **Running a repro command:** a sandboxed run (units 13, 22). This unit checks its shape only.
- **The release record:** Milestone D.

## The report templates

| Template | Where it goes | What it holds |
|---|---|---|
| QA report | the store | the verdict, the AC table with evidence references, issues |
| Run report | the store and the terminal (01 §13) | done (MR links), parked (with reasons), follow-ups, turns / tokens / minutes per ticket, what waits in `mirai inbox`, template gaps |
| **MR description** | **the git host** | Why · What changed · `Review: PASS after N rounds (MIRAI)` · follow-ups worth knowing · QA as text (AC table, test names, command output) · Risk · Links |

- **Renderers:** `renderQaReport`, `renderRunReport` and `renderMrDescription` render each
  template from checked data. Every value is escaped for Markdown, so a value can't inject a
  heading, a link or HTML.
- **The MR description takes no findings at all.** Its input has no field for them. The
  follow-ups are short lines written for it (by the light tier, 01 §2), not finding text. The
  renderer refuses an input with unknown keys.

## Files

```
registry/templates/{qa-report,run-report,mr-description}.md
src/reports/render.js         # renderQaReport, renderRunReport, renderMrDescription, escaping
test/reports/*.test.js
```

## Tests

| # | Test |
|---|---|
| T6 | **A rendered MR description holds no findings:** findings in the run's data never reach it; the review line counts rounds; a hostile value can't add a heading, link or HTML |
| T7 | The QA and run reports render from data, with escaping and the sections of their templates |

## Decisions (approved open points)

- **Split** into 09a and 09b (open point 1).
- **The MR description takes no findings;** follow-ups are short lines written for it (open point 4).

## Done when

- `npm test` passes: the earlier tests plus T6–T7.
- `test-results.md` holds the output.
- The Tech Lead and Architect reviews are done, and `review.md` is written.
- You write **"UNIT APPROVED"**. Then: one commit and push, and `PROGRESS.md` updated.
