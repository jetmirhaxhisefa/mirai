---
unit: "30c"
name: parks-rare
status: done (spec and unit approved by Jet, 2026-11-19: "approve 30c"; decisions 1–3 from his answers the same day)
roadmap: design/07-implementation-roadmap.md, row 30c; implementation/units/30-pilot/usage-note.md and findings.md (F18–F25)
depends_on: ["08b", "21a", "21b", "22", "29e", "30"]
---

# Unit 30c: Parks are the rare case

## Why

The pilot's one ticket, BKT-49, met three early stop limits, all in the plan step:

- 10 plan rounds;
- 3 `bad-plan` parks;
- 3–4 hours of your attention.

Build, review and proofs worked first time. Jet, 2026-11-18: "parked should be generally a edge
case, mostly I want to run it overnight and dont have too many failings."

**One finding is worse than the pilot recorded.** F21 said a re-plan sees only the latest
rejection note. Checked in the code on 2026-11-19, a re-plan sees **none**:

- `approve --plan`'s reason goes into the journal (`approve.js`, the approval event's `reason`);
- `planInputs` and `planPrompt` never read it;
- an unpark note doesn't reach Kai either.

So your rejection notes on BKT-49 changed nothing. Only the ticket edit and the template fix did.

## Decisions (Jet, 2026-11-19)

1. **MIRAI fixes clear format slips itself.**
   - Where the meaning is certain, MIRAI normalizes the plan before the lint, and the plan's
     Implementation log lists each change.
   - Everything else goes back to Kai, with the cell quoted and the fix shown.
2. **Line endings are converted back automatically.**
   - A file that was CRLF throughout at the base, and is LF-only after an agent's step, is
     converted back to CRLF before MIRAI commits. The commit body says so.
   - A file with mixed endings is left as it is, and named in the step's output and the MR.
3. **The proof is on the sample app:** a ticket shaped like BKT-49, planned 5 times. No change
   on the pilot.

## Scope

**In**

1. **Rejection and unpark notes reach Kai (F21):**
   - Every plan rejection note of the ticket, and every unpark note, oldest first, go into the
     plan's inputs as `review-notes.md`. Each carries its date and kind, read from the journal's
     signed events. The fix launch gets them too.
   - The prompt says: "your earlier plans were rejected for these reasons; each one still
     holds unless the ticket says otherwise".
   - When a note names a value the approved ticket also names differently, Kai is told to follow
     the ticket and flag the conflict in Design notes. At the reject, MIRAI warns: "a note can't
     overrule the approved ticket: edit the ticket and approve it again". BKT-49's version mix-up
     (F21) is the case.
2. **The plan normalizer (decision 1)** runs on Kai's plan before the lint, in
   `src/lint/normalize.js`. Only these:
   - **A Change cell:** its first word, when that word is one of add, change, remove, read
     (`change: replace X` becomes `change`). The words after it go to the row's Tasks line if
     there is one, or else to the Implementation log.
   - **A test row's Symbol:** when it matches exactly one Code map symbol by its leading code
     span, by case, or as a prefix at a word boundary, it becomes that symbol.
     `render test` matches `render test using composeStories` when no other symbol starts so.
     Quotes and a leading "tests"/"test" are dropped (`tests "has a story file"` becomes
     `has a story file`).
   - **A Symbols cell that starts with prose:** the code spans become its symbols, and the prose
     goes to the log (F19).
   - **A Test ID with the level's own folder:** when the path doesn't exist from the repo root
     but does under exactly one level's service folder (`src/test/x.ts` and level
     `frontend-unit` working in `frontend/`), it gets that prefix (F18, F20).

   Each normalization is one line in the plan's Implementation log:
   `MIRAI normalized: line 46 Change "change: replace…" → "change"`. Nothing else is changed: no
   meaning, no new rows.
3. **Better messages for what's left (F19, F22, F24):** every plan-table refusal quotes the cell
   (cut at 80 characters) and gives the fix in one line. The fix launch's prompt lists the
   problems grouped by rule, with one example fix each.
4. **The Test ID check (F18):**
   - a Test ID must name a file that exists at the plan's base, or that a Code map row adds;
   - the file must be inside the folder the level's service mounts;
   - its file type must be one the level's adapter runs (`.php` for PHPUnit, `.ts`/`.tsx`/`.js`
     for Vitest).
   - A wrong level for the file type (BKT-49's frontend test at `unit`) is refused, with the
     right level named.
5. **No dead ends (F23):**
   - `unpark --retry` on a `bad-plan` park moves the ticket to `ready-for-dev`, with the note
     kept as a review note (item 1).
   - `mirai show` names the next command for every park reason. A test walks every park reason
     to a command that moves it on.
   - An empty unpark note is refused before the passphrase, with the reason why.
6. **Line endings kept (F25, decision 2):** in MIRAI's commit step (`src/agent/commit.js`).
   - It runs before the diff checks, so the checks and the MR see the real change.
   - A test commits a CRLF file the agent rewrote as LF and checks that its blob is CRLF and its
     diff is only the real lines.
7. **The park rate is measured:** the run report (29a) and `mirai show` count each ticket's
   plan launches, its fix launches, and its parks by reason. The B checkpoint reads them.

**Out**

- Unparking from Claude (the B brainstorm, not a must).
- More than one fix launch per plan: the normalizer and better messages come first, and are
  measured.
- Changing what the lint requires: only how it's met and said.
- The pilot: nothing there changes in 30c.

## Tests

- **T1 Notes reach Kai:**
  - two rejections, then a re-plan: `review-notes.md` holds both, oldest first, and the prompt
    names it;
  - the fix launch gets it too;
  - an unpark note is in it;
  - a note changed in the store (not signed) is left out.
- **T2 Note against the ticket:** a rejection note naming `10.4.6` on a ticket naming `10.2.16`
  warns at the reject. Kai's prompt says the ticket rules.
- **T3 Normalizer:** each rule on BKT-49's real failing plans (`test/fixtures/plans/bkt-49-*`,
  from the pilot's stored plans, rounds 8–10, through `mirai show --full`):
  - every normalization is logged;
  - nothing else in the plan changes;
  - an ambiguous Symbol (two symbols start the same) is left for the lint;
  - a Change cell whose first word isn't one of the four is left for the lint.
- **T4 Messages:** each plan-table refusal quotes the cell and gives the fix. The fix prompt
  groups by rule.
- **T5 Test ID:** each is refused with its reason, and an existing or added file in the level's
  folder passes:
  - a path no level mounts;
  - a `.tsx` at a PHPUnit level;
  - a file that neither exists nor is added.
- **T6 No dead ends:**
  - `unpark --retry` on `bad-plan` leads to `ready-for-dev`, and `mirai plan` starts;
  - every park reason in `PARK_REASONS` has a next command in `show` that its state machine
    accepts.
- **T7 Line endings:**
  - CRLF at the base and LF after → committed CRLF, the commit body says so;
  - mixed endings → left as they are and reported;
  - an LF file stays LF.
- **T8 Measured:** the report counts plan launches, fix launches and parks per ticket.

## Probes (real)

- **P1 The sample app, 5 plans** (decision 3). Planning needs your terminal (`mirai plan` and
  the gates are yours, not the build runner's), so you run it step by step, as with BKT-49:
  - **The ticket:** a sample-app ticket shaped like BKT-49, `SAMPLE-49`, "every frontend
    component has a demo story". It has a new frontend test file, a test level working in
    `frontend/`, and a Code map with a move and reads. I write it on the sample app's `main`.
  - **The runs:** you approve it once, then plan it 5 times, rejecting twice with notes I give
    you. About 10 minutes of Sonnet.
  - **Pass when:**
    - every plan passes the lint within one fix launch, and none parks;
    - the plan after the second rejection follows both notes;
    - every normalization is logged.
- **P2 Line endings on a real build:** a sample-app ticket that edits a CRLF file. The MR diff
  shows only the changed lines.

## Done when

- T1–T8 pass, and the full suite passes (through the build runner's `tests` job).
- P1 and P2 pass.
- `findings.md` F18–F25 each name 30c as where they went (F21 corrected: no note reached Kai).
- The roadmap row's done-when holds, with "on the pilot" read as "on the sample app" (decision 3).
