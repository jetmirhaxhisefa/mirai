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

   *(changed by 44's interview, Jet 2026-11-22):* each finding is `writing` or `decision`
   (Scope 2). A decision goes to you at once, in any round, as an interview question, and uses
   no round. After the last round, what only you can decide becomes an interview; the rest
   reaches you as "Vera: N findings open". Approve anyway stays (decision 5's signed line).
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
   - `what` (one sentence) and `fix` (one sentence);
   - *(changed by 44's interview, Jet 2026-11-22):* `kind` (`writing` or `decision`) with
     `kind_reason` (one line), and for a decision a `decision_type` (`scope`, `audience`,
     `money-legal`, `number`, `conflict`, `trade-off`, `other`, `invented`). A claim added since
     her last check that no source holds is an `invented-decision` finding: always must-fix,
     always a decision. The rule and the lists are in 44's decision 3.
   
   MIRAI checks every quote by text match, as 34 does: a finding whose quote isn't in the file is
   dropped and logged, never shown. A reply that isn't the schema records nothing.

   *(changed: Jet, 2026-11-23, P1):* "isn't the schema" means its shape: not an object, no
   `findings` list, another key, more than 100 findings. A finding that breaks a rule of the schema
   on its own (a `context` finding without `against`, a bad grade, an id used twice) is dropped and
   logged, as one whose quote isn't in the file is, and the other findings count. P1's first run
   lost three whole replies to one such finding each.
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
  in the file is dropped and logged, as is a finding that breaks a rule of the schema (changed:
  Jet, 2026-11-23, P1). A reply that isn't the schema's shape records nothing.
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

**Re-checked against 37 as built (2026-11-21):**

- **The checklist Vera gets** (decision 3, Scope 3, the 37 line above): her checklist is named as
  `registry/templates/<type>-checklist.md`, but the project's real checklist is
  `checklistTextOf` (`src/config/overlays.js`): MIRAI's lines with the renames applied, then an
  overlay's `[[add]] checklist` lines as `- line`, with no `[vera]` mark. Added: Vera gets the
  checklist as `mirai show checklist <type>` prints it, and lines an overlay adds are rendered
  with `[vera]`.
- **A Vera overlay** (T1): an overlay of `mirai-verifier` applies only when the launch passes
  `store` (`src/agent/run.js`, `agentFor`). Added: an unapproved Vera overlay refuses her launch
  (`overlay-not-approved`), and a widening one needs a red-team result for
  `agent-mirai-verifier-read-only`.

**Re-checked against 38, 38b and 39 (2026-11-23),** as built on `main` (780f856), before the
build. Nothing here changes a decision of yours; each is how a decision is wired.

- **38 (stores):** a document is read as the reader test and approval read it: `docsStoreFor`,
  `baseForArg`, then `readApprovedFile` from the store's base, so a document in the `local` store
  is checked where it lives. The context files come from the store's `pathOf` (they are the
  repo's, whatever the store), as `mirai show context` finds them. Results are kept by document
  id, so the store makes no difference to them. `mirai verify`'s last line is the document's full
  path through 38's `documentLine` (its decision 8). No external store exists yet; when one does,
  its text reaches Vera inside 38's untrusted fence (`agentText`).
- **38b (naming):** `persona = "Vera"` in `mirai-verifier.toml`. Every line that names her goes
  through the namer (`agentNamer`, `fullName`): "Vera (mirai-verifier)" the first time, then
  "Vera". T8's source check now refuses a hard-coded "Vera" in `src/` too (three strings changed
  to "the verifier"). She adds her row to the naming table. Her output names no merge request, so
  `words.js` isn't needed. The role `verifier` (19b) already exists, unchanged.
- **39 (setup):**
  - `/mirai verify <file>` is on the session list (`COMMANDS.verify`, `tty: true`: an agent launch,
    as `review` is). The worker carries `CLAUDE_CONFIG_DIR` for every command (F7), so nothing new.
    The session's file pattern refused a leading "." and so `.mirai/context/business.md`: it now
    takes `.mirai/context/` paths, and nothing else that starts with a dot.
  - Vera's rendered agent (`.claude/agents/mirai-verifier.md`) comes from the bundle, which renders
    every agent of the registry, so `mirai init --refresh` and `mirai render` write it and the lock
    marks it: doctor's "Not rendered by MIRAI" never lists it.
  - `mirai custom add --as` gains `mirai-verifier`: a project's own document checker becomes an
    overlay of Vera, as one of Rex's does (the 37 re-check above covers her overlay).
  - No doctor item is added, so no yellow class.
  - The context files are approved with `mirai approve --file` (36), and three of them are Vera's
    (decision 6), so setup's context stage now checks them before giving you the approval
    command. A launch needs a clean work tree, so the guide (`guides/context.md`) commits each file
    before `verify`.
  - The pre-commit hook checks `.mirai/records/`; Vera's results live in MIRAI's store, not the
    repo, so it is untouched.
- **44's decision 3:** the findings schema has `kind` and `kind_reason` (required), and
  `decision_type` for a decision (`scope`, `audience`, `money-legal`, `number`, `conflict`,
  `trade-off`, `other`, `invented`); an `invented` one must be must-fix. A reply without `kind`
  isn't the schema, so it records nothing. The PRD and brief checklists now carry 44's
  `[vera]` line about claims with no source (44's Scope 2 asked for it).
- **Wiring choices made in the build (in test-results, "Changed from the spec"):** the miss is the
  journal event `verifier_miss` (the journal's names use `_`); a rejection's note is the reason you
  type after `r` (there is no `--reject --note` flag); Vera's run logs its rung only when MIRAI
  knows the author's launch (a document written in your session has none).
