---
unit: "35"
name: interview
status: approved (Jet, 2026-11-20: "approve 35"; decisions 1–8 from his interview answers the same day)
roadmap: design/07-implementation-roadmap.md, row 35; design/01 §2 step 1 and setup step 3; design/03 (`mirai-interview`); D-27, D-31 (design/04); research/06 (addyosmani `interview-me`); research/06b (mattpocock `grilling`)
depends_on: ["11", "31", "34"]
---

# Unit 35: The `mirai-interview` skill

## Why

Nora interviews you before she writes a brief when your request is thin (design/01 §2, step 1).
Setup (unit 39) interviews you about the gaps its sources leave. Both need one way of asking.
Today the design names the method in one line, and nothing keeps the answers once the session
ends.

This unit adds:

- **the `mirai-interview` skill:** how an agent interviews you, one question at a time, written
  as MIRAI's own skill from the two best sources found;
- **`interview.md`:** the record of each interview, next to the brief. It holds every question
  with your answer, the restatement and your "yes".
- **the gate:** a brief can't be approved while its interview has open questions or no "yes".

**Why now:** Nora's workflow (44) and setup (39) come next and both use it. The rules come from
how the interviews for units 32–35 went with you.

## Decisions (Jet, 2026-11-20, interview)

1. **One question at a time, with three ideas from `grilling`** (Q1, "C"):
   - the agent looks facts up itself (code, docs, the brief's sources, past decisions) and asks
     you only decisions;
   - each question has lettered options, one marked as the agent's guess, with its reason;
   - a short reply ("B", "yes", "B, but no email") is enough.

   One question at a time stays, because an answer often changes the next question.
2. **MIRAI's own skill, taken once** (as 34's decision 9). The agent reads `interview-me`
   (addyosmani/agent-skills, MIT) and `grilling` (mattpocock/skills, MIT) once at pinned commits
   and rewrites what helps in our words, with credit and their notices (D-27, D-31). There is
   no vendored copy and no tracking of upstream.
3. **The record is `interview.md`, beside the brief** (Q2, "B"), at
   `docs/mirai/<initiative>/interview.md`. It holds each question with its options, guess and
   your answer; the restatement; and your "yes" with its date. It isn't approved on its own. The
   brief cites it.
4. **"Pause" saves and stops; nothing moves on with an open question** (Q3, Jet: "the process
   cannot move forward without all question being answered"; Q3b, "A"):
   - when you say "pause" (or "draft it"), the agent writes every question it still has into
     `interview.md`, each with its options and guess, and stops;
   - no brief is written until every question is answered;
   - a new session resumes from `interview.md` at the first open question and doesn't ask an
     answered one again.
5. **Autonomous mode parks the feature** (Q3). With no one to ask, the agent writes its
   questions into `interview.md` and stops. design/01 §2 step 1 changes: autonomous mode no
   longer drafts on `[ASSUMPTION]` tags when the input is thin. Every open question blocks.
6. **Five rules on every question** (Q5, "A"):
   1. a header naming what it's about, e.g. "## Feature: due dates on tasks (PRD)";
   2. a confidence line with what's still open, e.g. "Confidence: about 70%. Still open: who
      gets reminders.";
   3. "explain" gets plain words and an example, then the same question again; it isn't an
      answer;
   4. one short "Your step" at the end: what to reply, with the options repeated;
   5. the restatement before your "yes" names what's not included.
7. **No question limit, but a stuck check** (Q6, "A"). After three answered questions with no
   rise in confidence, the agent stops asking and says so, names what seems to be missing, and
   asks you how to go on.
8. **How steps and explanations are worded lives in `mirai-write`** (Q4, "A"), added to unit
   34. This skill points to it.

## Scope

**In**

1. **The skill: `registry/skills/mirai-interview/`:**
   - **`SKILL.md`:**
     - when to use it: Nora before a brief when the request is thin; setup for the gaps its
       sources leave; any agent that needs your decision before it can go on;
     - when not to: a clear, self-contained request; a pure question; a mechanical change;
     - **before asking:** read what can be read; write a one-sentence guess at what you want with
       a confidence number and what's missing;
     - **each question:** decision 6's five rules, lettered options with the guess marked and a
       reason, one question per message;
     - **listening:** want against should-want (an answer that sounds like best practice gets
       "if you didn't have to justify this to anyone, what would you want?");
     - **the 95% stop:** the agent can predict your reaction to its next three questions;
     - **the restatement:** outcome, who it's for, why now, success, limits, not included;
     - **the yes:** only an explicit "yes" closes it; "sounds good", "whatever you think" or
       silence get one follow-up that names the choice;
     - **pause, resume, autonomous mode, the stuck check** (decisions 4, 5, 7);
     - the record: write `interview.md` as you go, after each answer, not only at the end.
   - **`CREDITS.md`:** `interview-me` and `grilling`, each with its commit and license, and
     what MIRAI took from each.
   - The skill is listed for Nora and setup, as `mirai-write` is (unit 34).
2. **The document type `interview`:** `registry/document-types/interview.toml`, a template and
   an example (`docs/mirai/<initiative>/interview.md` for the due-dates example, the interview
   that led to unit 31's example brief).
   - **Sections:** `Questions` (each `### Q-n: …` with its options, guess and `Answer:`), and
     `Restatement` (the six lines, then `Confirmed: yes (YYYY-MM-DD)`).
   - **Frontmatter:** `state: open | paused | confirmed`.
   - It has no summary for approval and no approval of its own.
3. **The interview lint** (`src/lint/interview.js`), naming the question and the fix:
   - a `Q-n` with no `Answer:` line, or an empty one, fails: "Q-3 isn't answered";
   - a `Q-n` with no options or no guess fails;
   - a gap in the Q numbers fails;
   - `state: confirmed` needs every question answered, all six restatement lines (with "Not
     included" holding something or `None.` with a reason), and a `Confirmed: yes` line with a
     date;
   - a `Confirmed:` line that isn't "yes" fails ("sounds good" isn't a yes);
   - `state: open` or `paused` fails with the open questions listed: an unfinished interview
     never passes the lint.
4. **The brief's link and the gate:**
   - the brief gains an optional link line under its title, `Interview: [..](interview.md)`, in
     the same block as the PRD's `Brief:` line;
   - an `interview.md` beside the brief that the brief doesn't link fails the brief's lint;
   - a linked interview that doesn't lint clean fails the brief's lint, naming the interview's
     open questions;
   - so `mirai approve` refuses a brief (and, on `standard`, the brief and PRD pair) while its
     interview isn't confirmed, with the open questions listed and the hint "answer them in your
     session, then run mirai lint".
5. **`mirai show <initiative>`** lists the interview with its state (`open`, `paused`,
   `confirmed`) and full path.
6. **design changes:**
   - design/01 §2 step 1: "pause" in place of "draft it"; autonomous mode parks with the
     questions in `interview.md` (decision 5);
   - design/03's `mirai-interview` row: the method, the record, the sources.
7. **Docs:** `docs/documents.md` gains "The interview": what you see, how to reply, "explain"
   and "pause", where the record lives and what blocks approval. `docs/agents.md` gains one
   line on `mirai-interview`.

**Out**

- Calling the skill from Nora's workflow, the loop and the park state (44).
- Setup's interview (39); it uses this skill and record format.
- How steps and explanations are worded (34, `mirai-write`'s session guide).
- Interviews in Jira, Confluence or chat tools.
- Grilling's rounds of several questions at once (decision 1).

## Tests

- **T1** The skill's files: `SKILL.md` holds the five rules, pause, resume, autonomous mode, the
  stuck check, the 95% stop and the restatement's six lines, and links `mirai-write`.
  `CREDITS.md` names both sources with commit and license.
- **T2** The interview type: the template, left as it is, fails as leftover text only; the
  example lints clean, with no warning, in state `confirmed`.
- **T3** The interview lint, each naming the question and the fix: an unanswered Q-2; a question
  with no guess; Q-4 after Q-2; `confirmed` with no "Not included" line; `Confirmed: sounds good`;
  `confirmed` with no date; `paused` with two open questions lists both.
- **T4** The brief's link, through `mirai lint`: an unlinked `interview.md` beside the brief
  fails; a linked paused interview fails the brief naming its open questions; a confirmed one
  passes; a brief with no interview beside it passes (the request wasn't thin).
- **T5** Approval, through the CLI with a signed key: a brief on `full`, and the brief and PRD
  pair on `standard`, are refused while the interview is paused, nothing written; after it's
  confirmed, approval goes on as before (the reader test from 34 still applies).
- **T6** `mirai show due-dates` lists the interview with its state and full path.

## Probes (real)

- **P1 A real interview:** you start a session with the skill and ask for a small real feature in
  one line. **Pass when:**
  - every question follows the five rules, one per message, with lettered options and a guess;
  - "explain" once gets plain words and an example, then the same question;
  - it ends in a restatement with "Not included" and your explicit "yes";
  - `interview.md` lints clean, and you'd want every MIRAI interview to feel like it.
- **P2 Pause and resume:** in P1 or a second run, you say "pause" after two answers. A fresh
  session with only the skill and the repo resumes. **Pass when** it asks the first open
  question next, asks no answered one again, and `interview.md` held the open questions with
  their guesses after the pause.
- **P3 Autonomous mode:** a fresh agent gets a thin one-line request in a non-interactive run.
  **Pass when** it writes no brief, `interview.md` holds its questions in state `paused`, and a
  brief written by hand beside it can't be approved.

## Done when

- T1–T6 pass, and the full suite passes through the build runner and CI.
- P1, P2 and P3 pass.
- The roadmap row's done-when holds: a sample interview ends in a restatement and an explicit
  yes.
