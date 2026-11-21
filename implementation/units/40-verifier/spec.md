---
unit: "40"
name: verifier
status: approved (Jet, 2026-11-20: "approve 40"; decisions 1–7 from his interview the same day; built only after 39 is finished, and re-checked against 34b–39 first)
roadmap: design/07-implementation-roadmap.md, row 40; D-13 (one verifier, a checklist per type), D-14 (tiers and the verifier ladder), D-43; 09 PM-03, PM-06; 13 §2; units 19a–19c (launch, roles, broker), 31–34 (types, checklists, reader test), 36 (context files)
depends_on: ["19a", "19b", "19c", "31", "32", "33", "34", "36"]
---

# Unit 40: Vera, the verifier agent

## Why

Every document you approve (brief, PRD, epic with its tickets, and the context files you approve)
passes the lint, and some pass the reader test. Neither one judges content. A PRD can lint
clean and still say "reminders are sent" without saying when, hide a push notice from its
summary, or let guests comment in a product that business.md says is for signed-in teams. Today
you catch these yourself and send the document back.

Vera is the agent that catches them first. She reads a finished document the way a strict senior
reviewer would, cites every finding to its line, and the author fixes the must-fix ones before
the document reaches you.

**Why now:** Nora (41) and Tess (42) write documents that go through Vera, and the workflows
(44, 45) run her as a step.

## Decisions (Jet, 2026-11-20, interview)

1. **Vera is a gate** (Q1, "A"). The order is lint, then Vera, then the reader test (where the
   type has one), then you. The author fixes Vera's must-fix findings. If any are still open
   after the last fix round, the document reaches you marked "Vera: N findings open", each one
   listed.
2. **Fix rounds are settings** (Jet: "two fix rounds are configurable"). `[docs]
   verify_fix_rounds = 2` for Vera, and `[docs] reader_fix_rounds = 2` for the reader test, which
   34 fixed in the code (`ROUNDS = 3`: the first run plus 2). Project file only; a range of 0–5.
3. **Three layers** (Q2, "B"):
   1. **the type's checklist:** the judgment items a script can't check (each
      `registry/templates/<type>-checklist.md` marks which items are Vera's);
   2. **the top part against the detail** (PM-03): every decision, requirement and boundary in
      the detail is named in the top part, and nothing in the top part is missing below;
   3. **the project's context** (36): no contradiction with `business.md`, a critical journey in
      `journeys.md`, or a conventions rule.
4. **The model is a step setting with a measured default** (Q3, "C"). It's `[models.steps]
   verify`, which exists today with `standard` as a placeholder. P1 sets the default: `standard`
   (Sonnet) and `deep` each check the same seeded documents, and the cheapest that catches every
   seeded defect and raises no false must-fix wins. Every run logs its tier, model and rung
   (D-14: rung 2 or 3 on Claude Code only).
5. **Two grades** (Q4, "B"):
   - **must-fix:** a builder would have to ask, something contradicts (inside the document, with
     an upstream document, or with the context), or the top part hides or adds something. These
     block the gate;
   - **suggestion:** everything else. It doesn't block or use up a round. It goes to the author
     and is listed for you.
6. **The documents you approve** (Q5, "A"): brief, PRD, epic with its tickets, `business.md`,
   `journeys.md` and each `conventions-<service>.md`. Not `feature-map.md` or
   `project-<service>.md` (lint only), and not plans (Kai's plan gate).
7. **Misses are logged** (roadmap, 13 §2). When you reject a document Vera passed, the problem you
   name is recorded against the document type, for the review after the MVP (PM-06).

## Scope

**In**

1. **The agent: `registry/agents/mirai-verifier.toml` + `.md`** (Vera), role `verifier`
   (read-only, step `verify`). Her tools are `Read`, `Glob` and `Grep`, within the document's
   folder, the upstream documents it links and the context files. She gets the document, its
   type's checklist, the upstream documents and the context files as data, and returns
   structured findings.
2. **The findings schema** (`src/verify/findings.js`): each finding has
   - `grade` (`must-fix` or `suggestion`);
   - `layer` (`checklist`, `top-vs-detail`, `context`);
   - `where` (the file, the line and the exact quoted text);
   - for a context finding, `against` (the context file and its line or source ID);
   - `what` (one sentence) and `fix` (one sentence).
   
   MIRAI checks every quote by text match, as 34 does: a finding whose quote isn't in the file is
   dropped and logged, never shown. A reply that isn't the schema records nothing.
3. **Checklists mark Vera's items:** each type's checklist gains a `[vera]` mark on the items she
   owns. The lint's items stay the lint's. A checklist with no `[vera]` item fails the registry
   check.
4. **`mirai verify <file>`** (also `/mirai verify`): runs Vera on one document and records the
   result by the document's content hash, with its round number. A rerun on unchanged text
   reuses the result. The command ends with the must-fix count, then each finding, then the full
   path.
5. **The gate in approval:** `mirai approve` on a Vera-checked type needs a Vera result for the
   file as it is now:
   - with no result, it's refused, naming `mirai verify <file>`;
   - with open must-fix findings after the last round, it shows "Vera: N findings open" and each
     finding, and you can still approve, reject with a note, or answer them yourself. The signed
     line records the result's hash;
   - a pass shows "Vera: passed (N suggestions)";
   - `[docs] verify = false` (project file) turns the gate off and says so on every approval.
6. **Order with the reader test:** on a type that has both, the reader test needs a Vera pass,
   or Vera's last round, first. This means the summary it reads is the fixed one.
7. **Rounds as settings** (decision 2): `verify_fix_rounds` and `reader_fix_rounds`, with 34's
   `ROUNDS` replaced by the setting. Both go in `docs/config.md`.
8. **Misses:** a rejection (`mirai approve --reject --note`) of a document whose Vera result
   passed writes a journal event `verifier-miss` with the type, the document, the note and the
   Vera result's hash. `mirai show <initiative>` marks it.
9. **The fix loop's hand-off:** the author's next run gets Vera's must-fix findings as data
   (fenced, as 34 fences the summary), with "fix these, then run `mirai verify` again". The
   workflows (44, 45) drive it. This unit provides the function and the CLI.
10. **Docs:** `docs/documents.md` gains "Vera" (the three layers, the grades, rounds, the gate,
    misses). `docs/agents.md` lists Vera. `docs/config.md` gains the new keys.

**Out**

- Disputes (an author arguing a finding).
- Plans, `feature-map.md`, `project-<service>.md`.
- Other model families as verifier (D-14 rung 1: Codex later).
- The workflows that call Vera (44, 45).

## Tests

- **T1 The agent:** Vera's definition validates under the `verifier` role, read-only, with
  only `Read`, `Glob` and `Grep`. A launch (fake launcher) gets the document, the checklist, the
  upstream documents and the context files as data, on the `verify` step's model.
- **T2 Findings:** a fake Vera reply with one finding per layer and grade is recorded. A quote not
  in the file is dropped and logged. A reply that isn't the schema records nothing.
- **T3 The gate:** with no result, approval is refused, naming the command. Open must-fix findings
  after the last round show "Vera: N findings open" and still allow approval, and the line records
  the hash. A pass shows its suggestions count. `verify = false` approves without a result and
  says so.
- **T4 Rounds:** `verify_fix_rounds = 1` and `reader_fix_rounds = 3` change the caps. Out of
  range is refused, as is a personal file setting them. 34's tests pass with the default.
- **T5 Order:** the reader test on a PRD with no Vera result is refused, naming `mirai verify`.
- **T6 Misses:** rejecting a Vera-passed PRD writes `verifier-miss` with the type and note. A
  rejection of a document Vera didn't pass writes no miss.
- **T7 Checklists:** every Vera-checked type's checklist has `[vera]` items, and a checklist
  without one fails.
- **T8 Session list:** `/mirai verify` exists, and the docs check (34b) passes.

## Probes (real)

- **P1 Vera's model** (sets the default, decision 4): a set of documents (32's and 33's examples,
  31's P2 brief, 34's P3 PRD, 36's sample-app `business.md`), each clean and each with one seeded
  defect per layer:
  - **checklist:** an FR with no "when";
  - **top vs detail:** a push notice added in the detail and missing from the summary;
  - **context:** guests allowed to comment, against a `business.md` that says signed-in teams
    only.
  
  `standard` and `deep` each run on every document in their own probe home. **Pass when** at
  least one tier raises every seeded defect as a must-fix on its right layer, with a quote that
  matches, and raises no must-fix on a clean document. The cheapest such tier becomes the default.
- **P2 Your read:** Vera's findings on 34's P3 PRD (no seeding). **Pass when** you judge each
  must-fix "would have sent it back" and none "wrong".
- **P3 The loop:** a fresh agent writes a PRD from 31's P2 brief with the skill (as 34's P3 did),
  Vera checks it, and the agent fixes. **Pass when** the must-fix findings are closed within the
  default rounds and the lint and reader test still pass after the fixes.

## Done when

- T1–T8 pass, and the full suite passes through the build runner and CI.
- P1–P3 pass, and P1's default is set in `defaults.js`.

## Checked against the queued units

- **34:** its fixed `ROUNDS` becomes `reader_fix_rounds` (decision 2), and the reader test now
  waits for Vera (Scope 6). 34's tests still pass with the default.
- **36:** the context files are Vera's layer 3 input, and three of them are her documents.
  Re-checked after 36 was built (2026-11-21): 36's decision 8 added `(open)` for what no source
  says yet. On a context file, an `(open)` line isn't a finding (the lint warns, and approval
  refuses it). **A claim whose cited source doesn't say it is a must-fix**: it should be `(open)`
  and asked. That's the failure P2 found on Thudos, and the lint can't see it; the business
  checklist's line for it is Vera's.
- **37:** a section overlay renames sections Vera's checklist names. She reads them through 37's
  rename map, as the reader test does.
- **38:** her file paths go through the store's `pathOf`.
- **41, 42, 44, 45:** the authors and workflows call `mirai verify` and its function. Row 41's
  document links are 38's.
