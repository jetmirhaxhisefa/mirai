# Unit 35: test results (2026-11-20)

## Tests

- **`test/documents/interview.test.js`:**
  - T1: the skill's files. `mirai-interview` is in the registry's skills, with only `name` and
    `description`. `SKILL.md` has one question per message with lettered options and a guess
    with its reason, "look the facts up yourself", the five rules in order, the want against
    should-want question, the 95% stop, the stuck check, the six restatement lines, the explicit
    yes, pause, resume, autonomous mode, "write it as you go", the link to `mirai-write` and its
    session guide, and "You don't run `mirai`". `CREDITS.md` names both sources, each with its
    40-character commit, MIT and its notice (Addy Osmani 2025, Matt Pocock 2026);
  - T2: the type has `Questions` and `Restatement` and no summary check. The template, left as it
    is, fails as leftover text only. The example is `confirmed` and lints clean with no warning.
    Unit 31's example brief links it in the line under its title;
  - T3: the lint, each problem naming the question and the fix: an unanswered Q-2 (and only
    that); "explain" as an answer; Q-3 with no guess; a guess that isn't an option; a guess with
    no reason; a question with one option; Q-4 after Q-2 ("Q-4 should be Q-3"); `confirmed` with
    no "Not included" line; "Not included: None." with no reason (and "None. <reason>" passes);
    `Confirmed: sounds good`; `Confirmed: yes` with no date; a date that isn't real; no
    `Confirmed:` line; `paused` with Q-6 and Q-7 open names both on the state line and on each
    question; `open` with every question answered and no yes still fails;
  - T4: through `mirai lint` in a git repo: an `interview.md` beside a brief that doesn't link it
    fails the brief ("interview.md beside the brief isn't linked"); a linked paused interview fails
    the brief once, naming Q-6 and Q-7 with "answer them in your session, then run mirai lint",
    and fails on its own too; a confirmed one passes (2 files, 0 problems); a brief with no
    interview and no link passes; a link to a missing interview fails;
  - T5: approval through the CLI with a signed key. A brief on `full` and the brief and PRD pair
    on `standard` are refused while the interview is paused, before any prompt, with
    `brief.md:12: the interview interview.md has open questions: Q-6 and Q-7 (…)`, and nothing is
    written. An unlinked interview beside the brief is refused too, and so is a link to a file
    that isn't there. Once confirmed, the full brief still needs its reader-test result (34), then
    is approved; the pair is approved after the PRD's reader test. The journal holds exactly the
    three approvals. Each brief's line has `files` with its interview's path and hash; the PRD's
    has none. An edited interview then makes both briefs stale (`documentApproval` with
    `briefFiles`), and `mirai show` lists each brief as "changed since approval" while the PRD
    stays "approved". Approving the full brief again says "it or its interview has changed since"
    and binds the new hash;
  - T6: `mirai show due-dates` lists `interview.md   interview   due-dates-interview   paused`
    with its full path, then `confirmed` and `open` as the file changes; the brief's line is
    unchanged.
- **Changed tests from 31–34** (the example brief now links its interview, as the spec says the
  brief cites it):
  - `test/documents/brief.test.js` T5 (an interview has no summary, like tickets and plans) and
    T6 (the fixture holds `interview.md`);
  - `test/documents/prd.test.js` T4, T7 and T8, `test/documents/epic.test.js` T2 (11 files now),
    T7 and T8 (the interview's line in `show`, 5 lines), `test/documents/write.test.js` (its
    fixture): each fixture that installs the example brief holds the example interview beside it;
  - `test/lint/templates.test.js` T1 (the seven types, and the interview template beside the
    brief's);
  - `test/adapters/claude-code.test.js` T1 (the bundle's file list) and T7 (the shipped skills:
    `mirai-docs`, `mirai-interview`, `mirai-write`), and `test/detect/detect.test.js` 17a T8 (the
    instruction files an install leaves, now with `mirai-interview`'s two).
- **The full suite:** 708/708 on the Mac, before and after the binding change (`caffeinate -i npm test`), 6 tests in
  `interview.test.js`. A first run had one failure in `test/launch/strict.test.js` T5/T6 ("a failed
  launch left its scratch folder", a `mirai-*` folder in the shared temp folder); that file passed
  alone (14/14) and the next full run passed. The build runner and CI run on the final commit.

## Probes (real)

| Probe | Result |
|---|---|
| **P1 A real interview** | not run yet |
| **P2 Pause and resume** | not run yet |
| **P3 Autonomous mode** | not run yet |

## Changed from the spec

- **The step that changed in design/01 is §3 (PRD), step 1.** The spec says §2 step 1; §2
  (Intake) has no steps, and the "draft it" text the spec replaces is §3's step 1. It now says:
  "pause" saves and stops, autonomous mode parks with the questions in `interview.md` and no
  `[ASSUMPTION]` draft, and every open question blocks.
- **The example lives at `registry/examples/interview.md`**, beside the example brief, as every
  example does. `docs/mirai/<initiative>/interview.md` is where it goes in a project.
- **The example brief and the brief template carry the `Interview:` line.** The brief cites its
  interview (decision 3), so the example brief links the example interview. The template has the
  line with a "delete it when there was no interview" comment. The brief type gains it as an
  `upstream_link` with no type and `required = false`.
- **The record's format is fixed so the lint can read it:** options are `- A: …` list items; the
  guess is `Guess: <letter>, because …` (a letter that isn't an option, or no reason, fails); the
  answer is `Answer: …`. A `Confidence:` line under each question, and `Request:` and `First guess:`
  lines at the top of "Questions", are in the template and the example but not linted.
- **"explain", "pause" and "draft it" as an answer count as no answer.**
- **An open or paused interview fails twice over:** once on its `state` line, listing the open
  questions, and once per unanswered question. Open with nothing unanswered fails with "write
  the restatement, get the owner's explicit yes". A `Confirmed: yes` line under `state: paused`
  fails too ("set state: confirmed").
- **The six restatement lines are `- Outcome:`, `- Who it's for:`, `- Why now:`, `- Success:`,
  `- Limits:`, `- Not included:`.** Their order isn't checked. "Not included" with nothing to
  leave out is `None. <reason>`.
- **The template is `state: confirmed`**, with every part filled with guidance text, so it lints
  clean where it lives (outside the docs root) and as leftover text only inside it, as T2 asks.
  Its comment says to start with `state: open`.
- **The type has a checklist** (`templates/interview-checklist.md`), because every document type
  needs one; it's for the verifier.
- **The gate runs at every lint, not only at approval.** A brief beside an unfinished interview
  fails `mirai lint` too: decision 4 says no brief is written before every question is answered.
  The brief reports one problem (`brief-interview`), naming the open questions, or the
  interview's first problem when none is open. The interview is checked with the full rules of
  its type, except leftover text and its own links, which its own lint covers.
- **Approval reads the interview itself.** `mirai approve` lints from text, so it passes the
  brief's interview to the lint: the linked file, or an `interview.md` beside the brief. A linked
  interview that isn't a regular file in the repo refuses the approval ("links its interview …,
  which isn't a file in the repo"); an unlinked entry that isn't a regular file still fails as
  unlinked.
- **Approval binds the interview (added after the first hand-over, at the coordinator's
  request).** A brief's approval line, on `full` alone and on `standard` with its PRD, records the
  linked interview's path and hash in `files`, as an epic's line records its tickets (33). The
  journal now allows `files` on a `brief` line (it was epic-only); an epic's line still needs it.
  `documentApproval` takes the files a line binds as they are now (`briefFiles` reads the
  interview a brief links), so a changed interview makes the brief stale: in `mirai show`, at its
  own approval ("it or its interview has changed since"), and for a PRD on `full`, which is
  refused until the brief is approved again. A change while you answer refuses the approval. On
  `standard` only the brief's line goes stale, not the PRD's, as 32 does for a changed brief: the
  PRD's line binds only the PRD's bytes. No journal schema bump, as 31–34 added fields without
  one.
  31 T6 and 32 T7 now expect the new wording ("it or its interview has changed since", "it or
  its interview changed since its approval").
- **`mirai show` gives an interview's own state** (`open`, `paused`, `confirmed`, or "no state")
  in the column where other documents show their approval state.
- **The grilling source's path is `skills/productivity/grilling/SKILL.md`.** The spec says
  `productivity/grilling`; the file is under `skills/` in the repo. Both sources were read at the
  `main` branch's commit on 2026-11-20: addyosmani `8c99fa36…`, mattpocock `abeeaf95…` (the
  grilling file last changed in `7739eaed…`).
- **`mirai-write`'s session guide now links the skill** (after the rebase onto unit 34's
  decision 11), and the skill points to that guide for how the step and an explanation are worded (it said "unit 35, not built yet"), and
  calls the marked option "your guess", the term this skill uses.
- **`docs/agents.md` and `registry/README.md`** name the skill; `docs/documents.md` adds "The
  interview" before "The business brief", and the brief's approval paragraph names the gate.

## Rebase onto 34 and 34b (2026-11-20)

**How.** The branch had 35's 8 commits on an old state of unit 34 (merge-base `c604af3`). Since
then 34 was finished and merged (PR #87, approved in #88) and 34b, the docs check, was merged
(PR #90). `git rebase --onto origin/main c604af3` applied all 8 commits with **no conflicts**,
onto `ae9641a`. Nothing was dropped on either side: 35's files are as they were, and main's final
34 (`src/write/reader.js`, the P3 probes, the PRD guide) and 34b (`test/docs/`, `docs/config.md`,
`docs/README.md`, `docs/internal-list.toml`) are unchanged by it.

**Double-check against the final 34 and 34b.**

| What | Finding | Fix |
|---|---|---|
| 34's reader test (`src/write/reader.js`: section-scoped quotes via `summarySection`, the who-seed, the prompt) | It reads only a document's summary. An interview has no summary, is never approved, so it never gets a reader test; the brief's `Interview:` line sits outside its summary, so the quotes and the who-seed don't see it. | none needed |
| 34's approval (`approve.js`: `readerFor`, `readerField`, the reader-test requirement) | 35 adds `linked` to the brief's lint and `files` to the brief's line beside 34's `reader_test`; it doesn't touch `readerFor`. On a brief (full) and a PRD (standard/quick), the reader test is still required and recorded as before; the interview gate and the `files` binding run alongside it. A changed interview makes only the brief's line stale, not the PRD's. 34's `write.test.js` passes with 35's fixture (the example interview beside the example brief). | none needed |
| 34's skill `registry/skills/mirai-write/` | `mirai-interview/SKILL.md` links `../mirai-write/SKILL.md` and `../mirai-write/guides/session.md`; both exist. The session guide links back to `../../mirai-interview/SKILL.md`, which resolves. The split is clean: the interview skill says how to ask, the session guide how to word the step and an explanation. | none needed |
| Duplication with 34 | None found. The interview type's lint is its own (`lint_checks = ["interview"]`), not a copy of 34's writing rules; the wording rules stay in the session guide. | none |

**34b's P2 (`node --test test/docs/coverage.test.js`).** Before: 13/14; T1 named exactly one thing:

> document type `interview` (registry/document-types/interview.toml) isn't named in
> docs/documents.md or a page it links: add it to the document types table in
> docs/documents.md, or to docs/internal-list.toml with a reason

"The interview" section already existed in `docs/documents.md`, but the check counts a type only
in a code span, block or heading, and the types table didn't list it. Fixed by adding an
`interview` row to the document types table in `docs/documents.md` (not the internal list). The
brief's `Interview:` link was already documented (in "The interview" and the brief's approval
paragraph); 35 adds no command or config key. After: 14/14.

**Full suite (`caffeinate -i npm test`).** 722 tests: 721 pass, 1 fail, the known flake
`test/launch/strict.test.js` T5/T6 ("a failed launch left its scratch folder", the /private/tmp
race). That file alone: 14/14 pass.
