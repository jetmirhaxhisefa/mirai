---
unit: "31"
name: brief
status: draft (decisions 1–4 from Jet's answers, 2026-11-19)
roadmap: design/07-implementation-roadmap.md, row 31; design/09-post-mvp-plan.md PM-03 and §4 row 3; research/13-document-writing.md
depends_on: ["04", "07", "08a"]
---

# Unit 31: Shared frontmatter, the summary for approval, and the business brief

## Why

The brief is the first document of B's flow: Nora writes it, Vera checks it, and you approve it.
On `standard` you approve it together with the PRD (U4); on `full` it has its own gate.

**Jet's goal for MIRAI's documents (2026-11-19):** they must be "professional and clear to read,
clear to understand for a human, also detailed enough for the AI agents to make the
implementation". PM-03 answers it with two layers in one file:

- a short summary you approve from;
- the detail the agents work from.

**Why now:** this unit fixes the summary's shape for every document type that comes after it
(PRD, HLD, LLD, ADR, epic). Changing the shape later means rewriting documents (`09` §4 row 3).

**The research behind it:** `research/13-document-writing.md` (2026-11-19). It covers:

- BLUF, Amazon's narratives and PR/FAQ;
- GOV.UK and the Federal Plain Language Guidelines;
- EARS, GitHub Spec Kit, AWS Kiro, BMAD v7, pstack, Agent OS and Task Master.

**What it found:** none of these frameworks keeps an approver layer and an agent layer in one
file. Spec Kit uses two files, the option D-59 rejected. So the risk to manage is the two parts
drifting apart, and this unit's lint checks for that.

## Decisions (Jet, 2026-11-19)

1. **The summary for approval** is the same five fixed parts at the top of every document type:
   brief, PRD, HLD, LLD, ADR and epic. Tickets don't get one; their description is already short.

   ```
   ## Summary for approval
   ### The ask              one sentence, ≤30 words, starts "Approve", "Decide" or "Note" (BLUF)
   ### Why                  2–4 sentences: who has the problem, what it costs, why now; sourced
   ### What changes         3–7 bullets, each ending with the detail IDs it sums up (BR-1, FR-3)
   ### Decisions for you    numbered: the question, 2–3 options, the recommendation and its cost,
                            the ID it rests on; or "None — <why>"
   ### Not in this          bullets, each with its reason and NG-n ID
   ```

   - **The author agent writes it last,** from the finished detail.
   - **It says nothing the detail doesn't hold.**
   - **Word budgets:** brief 400, PRD 600, HLD 600, LLD 500, ADR 250, epic 250. These are tuned
     after the first real documents.
   - The heading is "Summary for approval", not "For you", because teammates approve too (D-62).
2. **The brief's detail** is Lenny Rachitsky's 1-pager plus Basecamp Shape Up's appetite, no-gos
   and rabbit holes, in this order:
   - Problem;
   - Who it is for;
   - Why now;
   - Success (`SM-n`: metric, baseline, target, counter-metric);
   - Business requirements (`BR-n`: outcomes only, never a screen, field or API);
   - Appetite and track;
   - No-gos (`NG-n`);
   - Rabbit holes (`R-n`);
   - Hard questions (optional; Amazon PR/FAQ);
   - Sources;
   - Open questions (`Q-n`, none at approval).
3. **The writing lint fails on the rules and warns on numbers:**
   - **Fail:** the word budget, long sentences, banned words, and an ID in the summary that the
     detail doesn't hold. These send the document back to its author, like a plan's lint.
   - **Warn only:** a number in the summary that the detail doesn't hold, until we've seen it on
     real documents.
4. **The filled example is a sample-app feature,** written from the template. You judge it as the
   approver would.

## Scope

**In**

1. **Shared frontmatter** (`registry/document-types/_shared.toml`, used by every document type
   from 31 on):
   - **Fields:** `id`, `type`, `template`, `title`, `owner` (the author agent or a person),
     `upstream` (parent document IDs), `track` (brief and PRD only) and `created`.
   - **No `status` field:** a document's status lives in the store, as a ticket's does (D-06).
     It moves `draft → in-review → approved → superseded | obsolete`.
2. **The summary for approval** (`src/lint/summary.js`, the `summary` lint check). It runs for
   every document type that lists it:
   - **Shape:**
     - `## Summary for approval` comes right after the title;
     - its five H3s are present, in order, and none is empty;
     - "The ask" starts with Approve, Decide or Note, and has at most 30 words.
   - **Consistency** (fail):
     - every ID in the summary is defined in the detail;
     - every open `Q-n`, and every proposed ADR the document names, appears under "Decisions
       for you";
     - every `NG-n` in the detail appears under "Not in this", and the reverse.
   - **Numbers** (warn): a number in the summary that the detail doesn't hold.
3. **The writing lint** (`src/lint/writing.js`, the `writing` check):
   - **The summary gets all six rules:**
     1. the word budget (fail at the budget, warn at 80%);
     2. sentences over 25 words fail, and over 20 warn;
     3. banned words fail, from one list in `registry/writing/banned.toml`:
        - GOV.UK's words to avoid;
        - vague adjectives with no number (fast, scalable, secure, robust, intuitive…);
        - "etc.";
     4. paragraphs of more than 5 sentences;
     5. an acronym not defined at first use and not on the allowlist;
     6. a list with no lead-in line.
   - **The detail gets rules 2, 3 and 5.**
   - **Every message** quotes the sentence or word, and names the rule and its fix, as 30c's
     plan messages do.
   - Unit 34 (`mirai-write`) later adds the reader test and the before-and-after examples on top
     of this.
4. **The brief document type:**
   - its definition: `registry/document-types/brief.toml`;
   - its template: `registry/templates/brief.md`. Each section has a "done when" comment and
     names its source. "Not applicable — <reason>" is allowed only in optional sections;
   - its checklist: `registry/templates/brief-checklist.md`. It holds Vera's judgement items, one
     of which is "the summary and the detail say the same thing";
   - **its lint** (the `brief` check):
     - `BR-n`, `SM-n`, `NG-n`, `R-n` and `Q-n` are numbered without gaps or repeats;
     - each `SM-n` row has a baseline (or `UNKNOWN`), a target and a counter-metric;
     - each `BR-n` that names a screen, button, field, endpoint or API gets a warning, as a
       requirement that names a solution;
     - "Appetite and track" names a track (`quick`, `standard` or `full`), the same one as the
       frontmatter;
     - "Open questions" is allowed to hold questions only while the brief is a draft; MIRAI's
       approval refuses a brief that still has them.
   - It lives at `<docs_root>/<initiative>/brief.md` (`03`).
5. **The example** (`registry/examples/brief.md`): a filled brief for a sample-app feature I pick
   (decision 4). It lints clean and is the template's worked example.
6. **The approval:** `mirai approve <initiative>/brief.md --file …` records a signed approval of
   the brief's content hash, as a ticket's does today. On `standard`, the PRD gate (32) carries
   it. 31 only makes a brief approvable on its own (`full`).
7. **Docs:** `docs/documents.md` covers the two layers, the five parts, the writing rules, and how
   to read a document as its approver.

**Out**

- Nora writing a brief (units 35–36), and Vera checking one (40). 31 is the template, the lint
  and the checklist they'll use.
- The PRD (32), the epic (33), the HLD (62), the LLD and the ADR. Each adds `summary` and
  `writing` to its own type.
- The reader test and `mirai-write`'s examples (34).
- The summary on tickets (decision 1).

## Tests

- **T1 The summary's shape:** a brief with the five parts passes. Each of these fails, naming the
  part and the fix:
  - a missing part;
  - parts in the wrong order;
  - an empty part;
  - "The ask" over 30 words or not starting with its keyword;
  - the summary not right after the title.
- **T2 Consistency:**
  - an ID in the summary missing from the detail fails;
  - an open `Q-2` that isn't under "Decisions for you" fails;
  - an `NG-n` on one side only fails;
  - a number in the summary missing from the detail only warns.
- **T3 Writing rules:** each rule fails on a seeded sentence, with the sentence quoted and the fix
  named:
  - the budget (and its warning at 80%);
  - a 26-word sentence (and its warning at 21 words);
  - a banned word;
  - "fast" with no number;
  - a 6-sentence paragraph;
  - an undefined acronym;
  - a list with no lead-in.

  The detail only gets rules 2, 3 and 5. Words inside code spans are never checked.
- **T4 The brief:** the example lints clean. Each of these is caught:
  - a gap in the `BR-n` numbers;
  - an `SM-n` row with no counter-metric;
  - a `BR-n` naming "button" (warns);
  - a track that disagrees with the frontmatter;
  - an open question when the brief is approved.
- **T5 The template itself:** the brief template, filled with nothing but its placeholders, fails
  (left word for word, as stories do). A template without the summary fails the lint's own
  check of templates, so any later document type that leaves it out is caught.
- **T6 Approval:** a brief is approved and signed. A brief with an open question is refused, and
  one changed after approval needs a new approval.

## Probes (real)

- **P1 Your read** (decision 4): you read the example brief as its approver, about 5 minutes.
  - **Pass when you say:**
    - you knew what was asked and what to decide from the summary alone;
    - nothing in it was unclear;
    - the detail looks enough for an agent to write a PRD from.
  - Anything you flag is fixed and you read it again.
- **P2 An agent fills it:** a fresh Sonnet agent gets only the template, the checklist and a
  one-paragraph request for a second sample-app feature, and writes the brief. Nora's real launch
  comes in 35–36, so this is a subagent of my session, with no MIRAI context.
  - **Pass when:**
    - it lints clean, after at most one round of fixing the lint's messages;
    - its summary passes your read the same way as P1.

  This is the first check that an agent, not me, can meet the template from the template alone.

## Done when

- T1–T6 pass, and the full suite passes through the build runner and CI.
- P1 and P2 pass.
- The roadmap row's done-when holds:
  - a filled example lints clean;
  - a template without the summary fails the lint.
