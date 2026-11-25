---
unit: "44"
name: prd-workflow
status: approved (Jet, 2026-11-22: "approve 44"; interview Q1 "A" + an interview on what blocks the document, Q2 "A", Q3 "A", Q4 "C" + never merged before approval, Q5 "A", Q6 "A", refinements 1–4 "yes", restatement "yes"; built only after 43 is finished, and re-checked against 38–43 as built first)
roadmap: design/07-implementation-roadmap.md, row 44 (and notes on rows 45, 46); design/01 §2 (intake), §3 (PRD steps 1–8); D-07 (one status vocabulary, the frozen approved version), D-08 (tracks), D-17 (signed human-only moves), D-18 (the loop guard); design/13 §2, §3 (what the MVP logs, the review data pack); PM-14 (`/mirai-new`), PM3-13 (`pre-commit` moved here); units 06 (signing), 20 (loop guard), 26a (hooks), 35 (interview), 36 (`(open)`), 38 (store, publish, links), 40 (Vera), 41 (Nora), 42 (Tess)
depends_on: ["06", "20", "26a", "35", "36", "38", "40", "41", "42"]
---

# Unit 44: The `mirai-prd` workflow

## Why

Every piece is built: the interview (35), Nora who writes the brief and the PRD (41), Vera who
checks them (40), the reader test (34), the store that publishes them (38) and the signed
approval (06, 32). Nothing yet joins them into one path from your request to an approved,
published PRD. And two problems are still open:

- **The fix loop can't tell a writing problem from a decision.** Today Nora would try to fix
  every Vera finding. A finding like "tax rules: EU only, or EU and US?" isn't hers to fix. If she
  answers it, the PRD looks clean and holds a decision you never made. If she can't, she burns
  the rounds and the PRD reaches you with findings you have to sort out yourself.
- **A document's state can be faked.** Nothing stops a commit that writes `status: approved`
  into a PRD by hand, or edits an approval record.

This unit builds the workflow, sorts findings into writing and decisions, sends every decision to
you as an interview question, and adds the `pre-commit` hook.

**Why now:** it's the first stage of the lifecycle. Tess (42) starts from an approved PRD, and
45 automates that hand-off.

## Decisions (Jet, 2026-11-21/22, interview)

The examples below use one feature: **guest checkout** on the sample app. Vera's first check of
the PRD finds three things:

- **F1:** the PRD says "checkout is fast"; the brief's BR-2 says "under 60 seconds";
- **F2:** the PRD charges VAT, but no source says whether US orders are in scope;
- **F3:** Vera says "refunds for guest orders are missing", but the brief's No-gos say refunds
  are out of scope.

1. **The fix loop runs inside Nora's run; the loop guard keeps the books** (Q1, "A"). Nora's
   background run (41) does lint, Vera and the reader test, and fixes within the rounds, as 40
   and 41 were approved. The loop guard only counts: the rounds used and the cost. The caps stay
   `[docs] verify_fix_rounds` and `reader_fix_rounds` (default 2, range 0–5, project file only).

   **When the rounds run out and the PRD isn't clean** (Jet's addition): Nora sorts what's left,
   separates what only you can decide, and interviews you about it: one question at a time, each
   with her guess, through 41's pause (the questions go into `interview.md`, and your session
   asks them). Then she applies your answers. "Approve anyway" stays possible: the signed line
   records the findings still open (40 decision 5).

2. **The rule is MIRAI-wide** (Q2, "A"). Every loop that runs out sends what only you can decide
   to you as an interview. 44 builds it for documents. Code loops get it when 46 builds unpark
   (a note on row 46). There's no `blocked` state for documents: a document's "park" is an
   interview waiting for you, and `mirai show` shows it.

3. **Writing or decision: Vera labels each finding** (refinement 1, "yes"). Each finding gets
   `writing` or `decision`, with a one-line reason.
   - **The rule:** if the fix can be written by citing a source that exists (the brief,
     `interview.md`, the context files, an approved earlier document, the code), it's `writing`.
     If it needs a new fact or a choice that no source holds, it's `decision`.
   - **Always `decision`:** scope (in or out); users, markets, countries; money, legal,
     compliance; a number no source gives (limits, targets, SLAs); two sources that disagree; a
     trade-off between two requirements.
   - **Always `writing`:** wording, structure, a missing ID or link, a summary that doesn't match
     a sourced detail, an untestable criterion whose value is in a source.
   - **When in doubt:** `decision`.
   - **Where they go:** a decision goes to you at once, in any round, and uses no round. Rounds
     are only for writing problems.

   *Example:* F1 is `writing` ("the brief's BR-2 gives the number"). F2 is `decision`
   ("markets: no source says whether US orders are in scope"). F3 is labelled `decision`
   ("scope"), so it goes to you, and you can tell Vera she's wrong (decision 5).

4. **Nora never answers a decision herself** (refinement 2, "yes"). She writes 36's `(open)`
   where the answer goes, with the question, and approval refuses a document with an `(open)`
   in it.

   *Example:* `Tax rules apply for (open) — EU only, or EU and US? Asked in interview.md Q-7.`

   **The backstop:** a fix that adds a claim no source holds is flagged at Vera's next check as
   an `invented-decision` finding. It's always must-fix, and it goes to you.

5. **Every decision question has four ways to answer** (refinement 3, "yes"):
   - **your answer:** it becomes a `you said` source in `interview.md`, and Nora writes it in;
   - **"Vera is wrong":** the finding is dismissed by you, recorded, and not raised again for
     this version;
   - **"not a decision, just fix it":** it goes back to Nora as a writing finding;
   - **"leave it open and accept it":** it moves to the PRD's Open questions as a `Q-n` marked
     accepted by you, and the `(open)` is replaced by a reference to that `Q-n`.

   *Example:* for F2 you answer "EU only for now"; for F3 you pick "Vera is wrong" ("No-gos
   says refunds are out").

6. **Too many decisions mean the brief interview missed something** (refinement 4, "yes"). With
   more than about 5 decision questions on one document, Nora stops and proposes reopening the
   brief's interview (35) instead of asking them one by one. You choose.

7. **44 ends at the approved, published PRD** (Q3, "A"). You start Tess yourself. Row 45
   automates the hand-off. 42's line "44 chains Tess" is corrected.

8. **Published automatically after approval** (Q4, "C", and Jet: never merged before approval).
   Your approval runs 38's `mirai docs publish`. You can run `mirai docs publish` earlier to get
   a link to share. A merge request may exist before approval, but it's never merged before it.
   38's merge rule (merged only after the ticket-set approval) stays, and it's stricter.

9. **A `pre-commit` hook** (Q5, "A"):
   - **it refuses** (a) a hand-added `status` in a brief or PRD, or in any type where `status`
     is forbidden; (b) a change to approval records under `.mirai/` without a valid signature;
   - **it warns, and doesn't refuse,** when a commit changes an approved PRD's text: it names the
     approval that goes stale and the way out (a v2 draft beside it, D-07, or a new approval);
   - **D-17's wording changes:** a document's state comes from the signed lines in the journal,
     not from its frontmatter;
   - **the hooks installer chains** a repo's own `pre-commit`, as it does for `pre-push`.

10. **`/mirai-new "<request>"` is the neutral way in** (Q6, "A"). `/mirai-prd` stays for direct
    use. The session asks 1–2 intake questions and proposes `quick`, `standard` or `full`, with
    its guess. You confirm.
    - `quick` → Tess's one-ticket path (42 decision 2);
    - `standard` or `full` → 35's interview, then Nora.

11. **Document links on every line that writes, changes or approves a document** (unit 32, Jet's
    decision 8): the clickable path, plus the GitHub or GitLab link once pushed. 38 builds them;
    44 uses them on every output line of the workflow.

12. **Decisions are tested in probes and at the review after 20 tickets** (Jet). The danger is
    too much back-and-forth, or too little asking. design/13 gains a log row "Decision questions"
    (§2) and an audit row (§3). The thresholds there are placeholders, set when the review is
    specced.

**Build-level defaults** (Jet didn't object): a document's loop file is
`loop/docs/<id>@v<n>.json`, so each new version gets fresh rounds; the cost goes through the
existing ledger.

## Scope

**In**

1. **The entry: `/mirai-new` and `/mirai-prd`** (decision 10):
   - command files rendered from the adapter (`registry/adapters/claude-code.toml`,
     `src/install/render.js`), and `new` and `prd` on the `/mirai` session list (21f,
     `src/mcp/tools/commands.js`);
   - **intake:** the session reads the context files (36), asks at most 2 questions (35's rules:
     options, a guess, one at a time), and proposes a track with its reason
     ("standard: a new screen and a new rule; no new service");
   - **you confirm** the track; the brief records it in "Appetite and track";
   - `quick` → 42's `/mirai ticket` path with the request and the intake answers;
   - `standard` or `full` → 35's interview, then 41's `start_agent` for Nora;
     *(changed: Jet, 2026-11-23, 41's re-check, Q1 "A1"):* 41 starts Nora with `/mirai write
     <initiative>` (a session command), not `start_agent`; her run is several launches.
   - `/mirai-prd` skips the track question and starts at the interview (track `standard`
     unless you say `full`).
2. **Vera's labels** (decision 3), on 40's findings schema (`src/verify/findings.js`):
   - new required fields: `kind` (`writing` | `decision`) and `kind_reason` (one line);
   - for a decision, `decision_type`: `scope`, `audience` (users, markets, countries),
     `money-legal`, `number`, `conflict` (two sources disagree), `trade-off`, `other`, or
     `invented` (decision 4's backstop);
   - a reply without `kind` isn't the schema, so it records nothing (40's rule);
   - Vera's prompt carries the rule, the "always" lists and "when in doubt: decision";
   - the PRD and brief checklists gain one `[vera]` line: "every claim added since the last
     check cites a source; one that doesn't is an `invented-decision`".

   *(added to 44's scope by unit 40's P3, Jet 2026-11-23, "B"):* **Vera's later rounds are
   incremental.** In 40's P3 the loop didn't converge: each of five rounds raised must-fix findings
   no earlier round had (r1 4, r2 3, r3 ≥1, r4 the glossary and summary limits, r5 2). So from the
   second round, her input gets her previous findings and the diff since her last checked version,
   and she checks the fixes and the changed text; the rest stands as checked. This is also what
   "since her last check" (decision 3, the `invented` backstop) needs. This spec's "fixes within
   the rounds" (decision 1) and P2's "fixed within the rounds" assume convergence, which 40 didn't
   show with full re-checks: they hold only with this. Also from 40, as built: a finding that
   breaks a schema rule (no `kind`, say) is dropped and logged, and the other findings count (Jet,
   2026-11-23, P1); `decision_type` is always given, `none` for a writing finding.
3. **The routing** (`src/docs/route.js`, new; used by 41's `verify` broker tool):
   *(changed: Jet, 2026-11-23, 41's P1, "A2"):* Nora's launch has a headless `lint` tool (the
   same lint, read-only, documents under the docs root only); Vera and the reader test still run
   between her launches, never from her server.
   *(changed: Jet, 2026-11-23, 41's re-check, Q1 "A1"):* there is no `verify` broker tool. MIRAI
   runs Vera between Nora's launches (41's `src/nora/run.js`), and the split below applies to the
   hand-off her next launch gets, not to a tool's reply.
   - the tool's result to Nora is split: **"fix these"** (writing must-fix findings) and
     **"ask these"** (decision findings: write `(open)` with the question and add the question
     to `interview.md`);
   - in one run, Nora fixes the writing findings, writes each decision as `(open)` with its
     question, and then pauses (41's pause) if any decision was asked;
   - a dismissed finding (decision 5, "Vera is wrong") is dropped from later results for the same
     version, matched by its fingerprint (the quote and the `what`), and the drop is logged.
4. **The books: `src/loop/docs.js`** (decision 1, build default):
   - one file per document version, `loop/docs/<id>@v<n>.json` in the store. A version starts at
     1; a `prd.v2.draft.md` (`nextDraftName`, `src/status/documents.js`) is `@v2`. The key can't
     collide with a ticket key: ticket keys can't hold `@` or `/` (the guard's `TICKET` pattern);
   - it keeps `rounds_used` per check (`verify`, `reader_test`), the decision questions asked,
     `answer_runs`, and the cost. It reuses the guard's lock and atomic write (`withLock`,
     `atomicWrite`) and the ledger fields (`BUDGET`). No L2, L4 or L5 rules: no new round
     mechanics;
   - **a round is counted** when `verify` (or `reader_test`) runs on a new content hash after a
     result that had open writing must-fix findings. A result with only decision findings counts
     no round;
   - at the cap, the tool answers "rounds are used" and starts the rounds-out step (item 6).
5. **`(open)` in the brief and the PRD** (decision 4; 36 decision 8 extended):
   - the lint warns on each `(open)` and names the question it points to;
   - `mirai approve` refuses a brief or PRD with an `(open)`, listing each with its `Q-n`;
   - "leave it open and accept it" writes the PRD's Open questions line
     (`- Q-7: US tax rules. Owner: Jet. Accepted open (Jet, 2026-11-22). Blocks: US launch.`),
     and the text points to `(Q-7)` instead of `(open)`;
   - **MIRAI's own check for an invented decision:** each decision finding sent to Nora must, in
     her next version, end as one of: an `(open)` at its place, an answer from `interview.md`
     cited at its place, or a dismissal. A decision finding whose quoted text changed with none of
     these is an `invented-decision` finding, written by MIRAI, not by Vera.
6. **Questions to you** (decisions 1, 5, 6):
   - **the format:** 35's question format, in `interview.md`. A question from a finding adds
     `Finding:` (its ID and quote), `Kind:` (the `decision_type`) and, once answered,
     `Answer type:` (`answered` | `vera-wrong` | `not-a-decision` | `left-open`). The four
     answers are always the options; your guess is Nora's;
   - **the effects:** `answered` → a `you said` source and Nora writes it in; `vera-wrong` → a
     dismissal for this version; `not-a-decision` → a writing finding in her next run;
     `left-open` → item 5's Open questions line;
   - **the rounds-out step:** after the last round, Nora sorts the open writing findings. Those
     only you can decide become questions (same format). The rest stay as Vera's open findings.
     After your answers, one **answer run** applies them (counted in `answer_runs`, not a round),
     Vera checks once more, and the document goes to approval, with "Vera: N findings open" if
     any are left;
   - **too many:** when the open decision questions on one document version would pass
     `[docs] max_decision_questions` (default 5, range 1–20, project file), Nora asks one
     question instead: "reopen the brief interview (35)" or "go on with the N questions". Your
     choice is recorded;
   - **the journal:** a `decision-question` event per question (document, version, round,
     `decision_type`, finding fingerprint) and a `decision-answer` event per answer (answer
     type). These feed design/13's log row.
7. **The document's "park"** (decision 2): no new DOCUMENT state (`src/status/machines.js`
   stays). `mirai show <initiative>` shows "waiting for you: 3 questions in interview.md
   (Q-7…Q-9)" from `interview.md`'s state and the run record. Answering in your session (41)
   starts the next Nora run.
8. **Approval and publish** (decisions 1, 8):
   - `approvePrd` (`src/cli/commands/approve.js`) shows Vera's result as 40 says, refuses on
     `(open)` (item 5), and on approve anyway records the open findings' fingerprints in the
     signed line (`vera_open: [...]`);
   - after the signed lines are written, it calls 38's publish function for the initiative (repo
     store). A failed publish doesn't undo the approval: it says so and names
     `mirai docs publish <initiative>`. On the `local` store, publish says it does nothing;
   - an early `mirai docs publish` is 38's command as it is. 38's merge rule is unchanged, so a
     merge before your approvals is refused.
9. **The `pre-commit` hook** (decision 9):
   - `mirai hook pre-commit` (`src/hooks/pre-commit.js`, new; `src/cli/commands/hook.js`), run on
     the staged files only;
   - **refuses** a staged document whose type has `status = "forbidden"`
     (`registry/document-types/*.toml`, brief and PRD today) with a `status` field, naming the
     file and line;
   - **refuses** a staged change under `.mirai/records/` that doesn't verify against the
     committed public keys (the check `src/proofs/check.js` runs), naming the file;
   - **warns** when a staged change alters a document whose last signed approval matches the
     file as it is in `HEAD`: "this commit makes the approval of PRD due-dates (seq 41) stale.
     Write a new draft (`prd.v2.draft.md`) or approve again: `mirai approve …`";
   - **the installer** (`src/hooks/install.js`): `plannedFiles` gains a MIRAI `pre-commit`
     script beside `pre-push`. A repo's own `pre-commit` is forwarded and run first, as the
     `pre-push` hook does today (`hook.js`, decision 7 of 26a). `mirai init --refresh` installs
     it on existing projects;
   - `git commit --no-verify` skips it, as with `pre-push`; CI (54) is the backstop.
10. **Links** (decision 11): every workflow line that writes, changes or approves a document
    (Nora done or paused, each answer applied, approval, publish) ends with 38's link line.
11. **Design and spec changes** (listed in "Checked against the queued units").
12. **Docs:** `docs/documents.md`'s "From request to approval" (41) gains `/mirai-new`, the
    tracks, writing vs decision, the four answers, the rounds-out step and publishing.
    `docs/pre-commit.md` (new) covers what the hook refuses and warns. `docs/config.md` gains
    `max_decision_questions`. `docs/loop-rules.md` gains the document loop's books.

**Out**

- Starting Tess after the PRD, and PRD → ticket set (45).
- `mirai unpark`, the inbox, and the interview on park for code loops (46).
- `mirai trace` at PRD approval: it stays at the epic's approval (43).
- New loop-guard round mechanics (L2, L4, L5 for documents).
- CI checking the `pre-commit` rules on the host (54).

## Tests

- **T1 Intake and routing:** `/mirai-new` and `/mirai-prd` exist as command files and on the
  session list. A fake session that confirms `quick` starts 42's one-ticket path; `standard` and
  `full` start 35's interview, then Nora. More than 2 intake questions is refused.
- **T2 Labels:** a fake Vera reply with F1 (`writing`), F2 (`decision`, `audience`) and F3
  (`decision`, `scope`) is recorded with each `kind_reason`. A finding without `kind` makes the
  reply not the schema, and nothing is recorded.
- **T3 Rounds only for writing:** with `verify_fix_rounds = 2`, a run whose results hold only
  decision findings uses no round. A run with F1 open uses one. F2 is asked in round 1 and
  doesn't wait for the rounds to run out.
- **T4 `(open)` at approval:** the PRD with `Tax rules apply for (open) — …` lints with a warning
  naming Q-7, and `mirai approve` refuses it, listing it. The same line after "leave it open"
  (`(Q-7)` plus the Open questions line) is approved.
- **T5 Invented decision:** a fake Nora version that replaces F2's quoted text with "EU and US"
  and no answer in `interview.md` gets MIRAI's `invented-decision` finding, must-fix, routed as a
  decision. A fake Vera result with `decision_type: invented` is routed the same way.
- **T6 The four answers:** `answered` writes a `you said` source and the next run cites it;
  `vera-wrong` drops F3 from the next result for `@v1` and logs the drop, but a `@v2` result
  raises it again; `not-a-decision` comes back as a writing finding; `left-open` writes the Open
  questions line. Each writes a `decision-answer` event with its answer type.
- **T7 Too many:** with `max_decision_questions = 5`, a sixth decision makes Nora ask the one
  "reopen the brief interview" question; both choices are recorded. Out of range, or set in a
  personal file, is refused.
- **T8 Rounds out:** with F1 still open after 2 rounds, Nora's questions go to `interview.md`;
  after the answers, one answer run (not a round) and one more Vera check, then approval shows
  what's left.
- **T9 Approve anyway:** approval with 2 open must-fix findings shows "Vera: 2 findings open",
  and the signed line holds both fingerprints in `vera_open`.
- **T10 Publish:** approval publishes through a fake host (38's test setup) and the line ends
  with the link. A failed push leaves the approval and names `mirai docs publish`. An early
  publish opens the merge request, and `mirai docs merge` before the approvals is refused.
- **T11 `pre-commit`:** a staged PRD with `status: approved` is refused; a staged
  `.mirai/records/` file with a bad signature is refused; a staged edit to an approved PRD warns
  with the approval's seq and both ways out, and the commit goes through. With a repo's own
  `pre-commit` that exits 1, the commit is refused and names it; with one that exits 0, MIRAI's
  checks run after it. The installer writes and hash-checks the new hook.
- **T12 The books:** `loop/docs/prd-guest-checkout@v1.json` and `@v2` keep separate rounds. The
  ticket key `doc-PRD-1` and a document id `PRD-1` don't share a file. The cost lands in the
  ledger. A file that can't be read refuses, never resets.
- **T13 Links:** each output line in Scope 10 ends with the full path, and after a fake push,
  with the host link.
- **T14 Show:** `mirai show <initiative>` shows "waiting for you" with the open `Q-n`s, and no
  DOCUMENT state changes.
- **T15 The docs check** (34b) passes, with the new key and the new commands named.

## Probes (real)

- **P1 A real request, end to end:** on the sample app, in your session, `/mirai-new "<a small
  real request>"`. **Pass when:**
  - intake proposes a track and you confirm it;
  - the interview, Nora's run, Vera and the reader test run, and any decision reaches you as a
    question;
  - you approve brief and PRD in one approval action (the roadmap's done-when), and the PRD is
    published with its link;
  - a commit that sets `status: approved` in the PRD by hand is refused at commit (the roadmap's
    done-when).
- **P2 The seeded PRD:** a guest-checkout PRD seeded with 3 writing problems, 3 decisions of
  different kinds (a market, a number, a scope), 1 finding where Vera should be wrong (seeded
  so the brief's No-gos answer it), and 1 bait for an invented decision (a requirement that
  tempts a number no source gives). **Pass when:**
  - the 3 writing problems are fixed within the rounds, and none reaches you;
  - the 3 decisions reach you as questions, with the right `decision_type`, and use no round;
  - "Vera is wrong" on the wrong one drops it for good on this version;
  - no invented decision reaches approval: Nora writes `(open)`, or the backstop flags it;
  - the journal's `decision-question` and `decision-answer` events match what you saw.

## Done when

- T1–T15 pass, and the full suite passes through the build runner and CI.
- P1 and P2 pass.
- The roadmap row's done-when holds: a real feature goes request → approved PRD-lite in one
  approval action; a forged status change is refused at commit.

## Checked against the queued units

- **06:** approvals and the `vera_open` field are signed lines as today.
- **20:** the guard's code is unchanged; the document books reuse its lock, write and ledger.
- **26a:** the installer gains `pre-commit` and forwards a repo's own one.
- **35:** the interview record gains `Finding:`, `Kind:` and `Answer type:` for questions from a
  finding. The brief interview can be reopened (decision 6).
- **36:** `(open)` (decision 8) now applies to the brief and the PRD too.
- **38:** publish is called by approval; links are 38's. The merge rule is unchanged.
- **40 (corrected here):** Vera's findings gain `kind`, `kind_reason` and `decision_type`, and the
  `invented-decision` finding. Decision 1 changes: decisions go to you at once; after the last
  round, what only you can decide becomes an interview; approve anyway stays. Dated note added.
- **41 (corrected here):** her pause carries decision findings, and she never answers a decision
  herself. Dated note added.
- **42 (corrected here):** "44 chains Tess" is wrong: you start Tess; 45 automates it. Dated
  note added.
- **43:** trace stays at the epic's approval.
- **45:** starts Tess after approval and merges the docs MR after the ticket set.
- **46 (roadmap note added):** a code loop's park becomes an interview on what only you can
  decide.
- **54:** CI checks the same rules as `pre-commit`.
- **design/04 D-17 (corrected here):** the state comes from signed journal lines, not
  frontmatter; the `pre-commit` rules. D-07's "frontmatter is the current state" gets the same
  note. Dated notes added.
- **design/07 row 44:** points to this spec. **Row 46:** the note above.
- **design/13 §2 and §3:** the "Decision questions" log row and its audit row.

## To interview before the build (Jet, 2026-11-24, "A", from 41's P4)

- **The interview looks ahead through the PRD's checklist.** Before you confirm the restatement,
  the interview (35) reads the PRD's checklist and asks what Nora would otherwise pause on later, so
  her pauses come up front. *Seen in 41's P4:* 6 questions at the interview, then 5 pauses in
  Nora's runs (Q-7 to Q-11), each a real gap.
- **Interview Jet on it first** (interview-me), before any design for it is written.
- **Accepted only if the probes show** fewer pauses than without it, and Vera's findings no worse
  (the must-fix count and the kinds), on the same requests.

**Re-checked against 42 as built (2026-11-25; PR #123, not merged yet):**

- **`quick` → 42's one-ticket path, and back:** 42's A+ rule sends a line "too unclear for 3
  questions" to `/mirai-new`. A `quick` proposal from `/mirai-new` that reaches that rule would
  ping-pong. Added: `/mirai-new` never proposes `quick` for a request its intake found unclear;
  and when 42's path is entered from `/mirai-new`, its "too unclear" outcome offers `standard`
  (this workflow), never `/mirai-new` again.
- **The PRD's ACs are testability-linted** (42's P2 finding, `prd-ac-untestable`): Nora's lint
  (headless and between launches) catches a vague AC; no Vera round is spent on it.
- **A Tess pause feeds Nora** (42's P2 third run, Jet's "A", being built): after a Tess pause is
  answered, Nora's run continues the PRD with the answer, and Tess refuses to cut while the PRD is
  behind an answer. This workflow's routing of decisions (decisions 1–6) applies to those answers
  too: a Tess question that is a decision is asked as one (its `Kind`).
- **The "start Tess?" offer** is 45's (approved 2026-11-24): this workflow ends at the approved
  PRD and leaves the offer to 45, as decision 7 says.
- **The pause wording** (`PAUSE_PLACE`, shared by Nora and Tess since 42): this unit's
  decision questions use the same placement.
- **The look-ahead note** ("To interview before the build") stands; interviewed 2026-11-25, see below.

## The look-ahead (interview with Jet, 2026-11-25: Q1–Q4, restatement "yes")

**Answers:** Q1 "A" (the pain is the interruption after you've walked away; a longer interview is
fine); Q2 "A" (the PRD's checklist only; Tess's questions stay at the ticket step, 45); Q3 "a mix
of B and A" (a real question where the guess is shaky; an assumption where it's confident, every
one reviewed and approved by you); Q4 "A" (one numbered list, approved together).

**Statement of intent (confirmed):**

| | |
|---|---|
| **Outcome** | Before the restatement, the interview reads the PRD's checklist (`registry/templates/prd-checklist.md`) and finds what Nora would otherwise pause on later. A shaky guess becomes a real question (one at a time, with a guess). A confident guess becomes a numbered **Assumptions** list, approved with "ok" or corrected by number ("2: the team's midnight"); a correction is an answer. interview.md records each assumption as approved by you; Nora builds on them, and Vera checks the PRD against them. |
| **User** | You, as the owner: present at the start, then walking away. |
| **Why now** | 41's P4: 5 late pauses; 42's P2 (third auto run): 8 Nora pauses (Q-9 to Q-16), each a real gap, each stopping the work after you'd left. |
| **Success** | On the same requests, the probes show fewer Nora pauses than without the look-ahead, and Vera's findings no worse (the must-fix count and the kinds). |
| **Constraint** | Nothing is invented: every assumption is shown and approved; Nora still pauses on a gap the look-ahead missed. |
| **Out of scope** | Looking ahead for Tess's ticket questions (45); a cap on questions; approving assumptions one at a time. |

**What the build adds (to be designed with 44's build, nothing before):**

1. **The interview skill** (`registry/skills/mirai-interview/SKILL.md`, 35): a step before the
   restatement: read the PRD's checklist against the answers so far; for each item the answers
   leave open, ask (guess shaky) or assume (guess confident, with its source: business.md, the
   code, an earlier answer).
2. **interview.md's template:** an `## Assumptions` section (numbered `A-n`, each with its source
   and `approved: yes` or the correction), placed before `## Restatement`; the interview lint
   refuses a `confirmed` interview with an assumption not approved.
3. **Nora:** reads `## Assumptions` as answers (cites `A-n` where a requirement rests on one) and
   doesn't pause on them.
4. **Vera:** a checklist line: every approved assumption is reflected in the PRD, none
   contradicted.
5. **The probes:** the same requests (41's P4, 42's P2 with a fixture that matches the sample app)
   run with and without the look-ahead; pauses counted, Vera's must-fix count and kinds compared.
   Accepted only if pauses fall and Vera is no worse.

## Follow-up

- **`pre-commit` and document approvals (from the spec review, 2026-11-22):** the hook's unsigned-approval check covers `.mirai/records/` only, because document approvals are journal lines in MIRAI's store, not repo files. If approvals are ever committed (38's committed-records idea, 37's `approvals/` pattern), the hook must check them too.
