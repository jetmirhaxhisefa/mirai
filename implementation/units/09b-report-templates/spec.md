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

## Changes after testing and review

Listed for your check before "UNIT APPROVED".

**Settled while building:**
1. **A template's `##` headings are its sections, in order.** The renderer fills each, and
   refuses a template whose sections it doesn't know (or that lacks one). So a unit 37 overlay
   can't silently drop or add a section. The templates are plain Markdown with their guidance
   in comments, not document types, so `mirai lint` skips them.
2. **Each renderer checks its input against an input schema** (09a's validator).
   - Unknown keys are refused, so a findings list can't be passed to the MR description at
     all.
   - The QA report renders from a verdict checked by 09a's `checkQaVerdict`.
3. **Escaping (changed after review, #7 below):**
   - **Everywhere:** every value is one line (the schema refuses newlines), with Markdown's
     inline markup escaped: `` \ ` * _ [ ] < > | ~ & $ @ # ! ``. So no emphasis, code, link,
     image, HTML, entity or table cell gets through.
   - **At the start of a line:** headings, quotes, list markers and setext underlines.
   - **URLs in free text are defanged** (`https[:]//`, `www[.]`), because GitHub autolinks
     URLs even when they're escaped.
   - **Command output** goes in a fence longer than any run inside it, with terminal escapes
     stripped, control and invisible characters shown escaped, and anything over 4,000
     characters cut with a note.
4. **Links are built from checked targets only:** an `https` URL, or a path inside the repo,
   with no credential. The run report shows MR links as they are, so they stay clickable in a
   terminal.
5. **The review line** says "round" or "rounds" by count: `Review: PASS after 1 round (MIRAI)`.
6. **A high risk needs its reason.** A stacked MR says "do not merge until it's retargeted"
   (01 §6).

**From the reviews (`review.md`), with your decisions (2026-10-24):**
7. **References are shown as code.**
   - **The problem:** GitHub links `@user`, `#12`, `GH-12`, emails, `$math$`, `:emoji:` and
     commit SHAs even when they're backslash-escaped. Its reference filters run on the
     rendered text (the Tech Lead verified this on GitHub's renderer).
   - **The fix:** every reference-shaped word is wrapped in a code span. That covers URLs,
     emails, mentions, `#12`, `GH-12`, `!12`, `%milestone`, `~label`, `&3`, SHAs, `$` and
     `:emoji:`. Hosts never link code spans.
   - **What it replaces:** the `https[:]//` defanging, which also missed a URL right after `_`
     or a digit.
8. **Command output in the MR is a redacted tail.**
   - **The tail:** the last 20 lines per command; the rest stays in the store.
   - **Redaction:** before rendering, commands and output are redacted:
     - token shapes, `NAME=value` with a secret-like name, and credentials in URLs are masked;
     - terminal escapes, OSC 8 links included, are stripped;
     - the repo root and home become `<repo>` and `~`.
   - **Any other text with a token shape refuses the render.** It's checked before escaping,
     which could split the token's shape.
   - **The body fits the host's limit** (GitHub about 60,000 characters, GitLab 500,000).
     Output is dropped first, then test names, each with "in the store".
9. **The report templates are fixed.** Unit 37's overlays don't change them, and MIRAI writes
   its own MR body rather than a project's pull-request template.
10. **The renderer is host-aware** (`host: github | gitlab`):
    - the stack reference is `#12` or `!12`, from a structured `stack.number`;
    - the size limit follows the host;
    - a leading `/` is escaped on both hosts, so a value can't be a GitLab quick action such as
      `/merge`.
11. **The follow-up guard:** a follow-up that cites a file path or a `file:line` is refused.
    Unit 27 builds follow-ups only from triaged non-blocking findings.
12. **The run report has a plain-text form for the terminal** (`format: "text"`): the same
    sections, no Markdown escapes, only controls and invisible characters made visible. The
    stored file stays Markdown.

**Fixes from the reviews:**
13. **Blocking (Architect):** a Why starting with `/merge` reached the MR as a GitLab quick
    action. A leading `/` is now escaped.
14. **Blocking (Tech Lead):** references and URLs that GitHub links even when escaped (#7).
15. **Links:**
    - targets refuse control, bidi, quote and backslash characters;
    - MR links in the run report are credential-checked too;
    - repo files are shown as code paths, not relative links, which resolve wrongly on an MR
      page.
16. **Smaller fixes:**
    - the title's `{title}` is replaced with a function, so `$'` in a value stays as written;
    - a template whose title lacks `{title}`, or that names a section twice, is refused;
    - values are trimmed, so leading spaces can't make indented code;
    - list items get the line-start escapes;
    - QA rows in the MR must be passes;
    - `resets_at` is an ISO time;
    - NaN is refused (also fixed in 09a's validator, which accepted it in a passed object);
    - the run report's branch warnings come first, after the summary (D-54);
    - the MR body starts with a hidden marker, `<!-- mirai:mr-description@v1 -->`, so unit 27
      can recognise its own body.

**For later units:**
- **Unit 27** (ship and the MR):
  - check the real GitHub and GitLab rendering of a hostile description before calling the
    escaping done. This can be an opt-in script, not part of `npm test`, because it needs the
    network;
  - build follow-ups from triaged non-blocking findings only.
- **Units 29 and 56** add fields (rounds, verdicts, limit share, metrics) as optional input keys
  with their sections. That's additive.

