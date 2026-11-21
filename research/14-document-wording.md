# 14 — Wording the documents you approve: brief, PRD, epic, ticket, HLD, ADR, LLD

Research date: 2026-11-20, for unit 34 (`mirai-write`). It builds on `research/13-document-writing.md`
and does not repeat it: 13 settled the two layers, the summary's five parts, the general writing
rules (GOV.UK, digital.gov, Google, Microsoft, pstack) and the detail an agent needs. This file is
about **wording only**:

- the shape of a sentence;
- how a decision, a requirement and a criterion are phrased;
- the words to avoid;
- the order of information.

Sections and templates are left out: each type's own unit owns them (31–33 for the brief, PRD and
epic; 62 and later for the HLD, ADR and LLD).

Every fact comes from a live fetch of the URL next to it on this date, or from a file read at a
named commit. Where a page did not state a license, this file says so. All rules below are
written in MIRAI's own words; nothing is copied beyond short quotes with their source. This is not
legal advice.

Legend, as in 13: **L** = a lint script can check it. **J** = judgement (Vera, the reader test, you).

---

## 1. Summary

| Topic | Finding | Sources | Use in `mirai-write` |
|---|---|---|---|
| Requirement verbs | "Must" for an absolute requirement, "must not" for a prohibition; keep "should" and "may" for the rare real preference or option, and use them sparingly. | RFC 2119 (§1–6); GOV.UK ("must" for legal requirements, in 13 §4) | PRD guide: "must" only; a "should" in an FR is a requirement nobody decided. 32 already fails "shall". |
| Requirement shape | One subject, one "must", one response. No escape clauses ("where possible", "as appropriate"), no open ends ("including but not limited to", "etc."), no vague quantities ("several", "approximately"). | INCOSE GtWR rules R7–R9 (secondary sources, §3.2); EARS (13 §5.1) | PRD and ticket guides. "etc." is already a banned word (L). |
| Criteria | Given is the state before, When is one event, Then is an outcome someone can observe. No user action in Given; no implementation detail in the steps. | Cucumber Gherkin reference; Dan North, "Introducing BDD" | Ticket guide. |
| Decisions | The decision is one sentence with a subject: "We will …" or "Chosen option: X, because Y". Context is neutral fact; consequences list the bad with the good. | Nygard (CC0); MADR (MIT or CC0); Y-statement (research/07 §2.3) | Summary "Decisions for you"; ADR guide (62). |
| Non-goals | A non-goal is something a reader could reasonably expect, ruled out, with its reason. It is not a negated goal. | Google design docs (Ubl); KEP (13 §2.3) | Every guide: each "Not in this" item names its reason. |
| Names | Name a piece of work by what it does for someone, not by a layer ("front end", "bugs"). The names become the project's words, so keep them. | Shape Up ch. 12; C4 (relationship labels) | Epic and ticket guides: titles say what a person can do after. |
| Quality goals | The top three to five, concrete, each with a scenario; no buzzwords. | arc42 §1.2 (CC BY-SA 4.0) | HLD (62). |
| AI tells | Staging, inflation, padding, chat leftovers and writing for the wrong reader are structural and survive model changes; word lists go stale. | blader/humanizer `8c307f3` (MIT); Wikipedia "Signs of AI writing" | SKILL.md's six patterns, in MIRAI's words. The word list stays in the lint. |

---

## 2. Order of information

13 §2.1 set BLUF for the summary. The same rule holds at three smaller scales, and every source
below agrees on it.

1. **The section:** the answer first, then the reason, then the detail. Microsoft ("Lead with
   what's most important") and GOV.UK ("most important information first") were cited in 13. The
   Google design-doc article (§3.4) adds that context is "objective background facts" and stays
   short; the proposal and its trade-offs carry the weight.
2. **The sentence:** the condition before the instruction (Google style, 13 §4), and the actor
   before the action. EARS puts the trigger first ("When …, the system must …"); Gherkin puts the
   state first (Given), then the event (When), then the outcome (Then).
3. **The list item:** the item's own words first and its IDs last, in brackets, as 31–33 already do
   (`… (FR-3, FR-4)`). An item that starts with an ID or a label is read as a code, not a claim.

**For the approver:** what is asked of you, then what you get, then what it costs, then what is
left out. **For the agent:** what must be true, under which condition, and how it is checked.

---

## 3. Per-type wording conventions

### 3.1 Brief (business outcomes)

- **Problem sentences name a person and a cost:** "Team leads lose the reason for a change in the
  chat thread" says who and what. "Context gets lost" does not. (J)
- **A business requirement states an outcome the business needs, never a mechanism.** 13 §3
  quoted BMAD's BRD rule (MIT): once a statement names a screen, a field or an API it has started
  designing. Wording test: replace the product with a different one; the BR should still read true.
- **Evidence is labelled.** pstack's reply rule (13 §6.2) gives each claim its evidence or a label
  (measured, inferred, guess). In a brief that means "the team's request of 2026-11-19" or
  "Assumption", never a bare claim. (J; the lint already requires `UNKNOWN` baselines to be written.)
- **"Why now" names what changed.** Lenny and Cagan ask why now (13 §3). A sentence that only
  repeats the problem ("the problem is getting worse") is not an answer. If nothing changed, say
  the trigger is the request itself and mark the growth claim as an assumption.
- **A recommendation names its cost in the same sentence.** 13 §2.4's convention: question,
  options, recommendation, cost.

### 3.2 PRD (requirements)

- **One requirement, one sentence, one "must".** RFC 2119 (https://www.rfc-editor.org/rfc/rfc2119,
  §1–5) defines MUST as "an absolute requirement" and MUST NOT as "an absolute prohibition";
  SHOULD leaves room for "valid reasons in particular circumstances to ignore"; §6 says the words
  "must be used with care and sparingly". In a PRD, a "should" is a requirement nobody decided:
  decide it ("must") or move it to an open question. Copyright: the IETF Trust; the page states
  only "Distribution of this memo is unlimited". Nothing copied.
- **The INCOSE Guide to Writing Requirements** (GtWR) could not be fetched: incose.org returned 403
  for the rules summary. Its rule titles are quoted here from secondary sources found by search
  (qracorp.com, prog.world's summary of the June 2023 edition), and only the three titles used:
  R7 "Avoid vague terms" (several, many, approximately, most -ly adverbs), R8 "Avoid escape
  clauses" (where possible, as appropriate, if necessary, to the extent practical), R9 "Avoid
  open-ended clauses" (including but not limited to, etc., and so on). The sources disagree on
  the rule count (41 or 42). © INCOSE; treat as convention, describe in our words.
- **No combinators.** A requirement with "and" between two responses is two requirements; with
  "or" it is an unmade choice; "and/or" is both (Google's word list says avoid "and/or",
  https://developers.google.com/style/word-list). (J; a lint for "and/or" is possible.)
- **The actor is named.** "The system must …" or "A team member can …", never a passive with no
  actor ("comments are kept"). digital.gov (13 §4) and EARS both put the actor up front.
- **Exceptions get their own sentence or their own requirement.** 32's P2 round 3 had eight
  sentences over 25 words; every one packed an exception into the main clause ("…, but none to
  the comment's author"). Splitting fixed the lint; a separate "If …, then …" requirement (EARS's
  unwanted-behaviour pattern) fixes the meaning.
- **Exact values, quoted.** A message the user sees is written in quotes, word for word; a limit is
  a number with its unit ("2,000 characters"). "A message says text is needed" leaves the builder
  to invent the text.

### 3.3 Epic (a set of tickets)

- **The epic's sentences are about the set**: order, release and risk. Its "Why" says why this
  split and this order, since the PRD holds why the work exists.
- **Name each ticket by what someone can do after it**, not by layer. Shape Up chapter 12
  (https://basecamp.com/shapeup/3.3-chapter-12, © 37signals, all rights reserved) says scope
  names "become the language of the project" and warns that names like "front-end" or "bugs" are
  "grab bags". C4 (https://c4model.com/diagrams/notation, CC BY 4.0) gives the same advice for
  labels: be specific, avoid single words like "Uses".
- **Field values are words for the approver.** `risk: high` is frontmatter; in the summary it is
  "TC-3 is high risk: a mistake shows comments to people who can't see the task." (J)
- **One idea per bullet.** A "What changes" bullet that joins two changes with ";" hides the second
  one (33's P2 epic did this three times).

### 3.4 HLD (architecture; for unit 62)

- **Quality goals are few and concrete.** arc42 §1.2 (https://docs.arc42.org/section-1/, Gernot
  Starke, CC BY-SA 4.0): "the top three (max five) quality goals", "be very concrete about these
  qualities, avoid buzzwords", explained through scenarios. A goal is a sentence with a number and
  a condition, not "scalable" (already a vague word in the lint).
- **Context is neutral and short.** Malte Ubl, "Design Docs at Google"
  (https://www.industrialempathy.com/posts/design-docs-at-google/, 2020-07-06; no license stated):
  context should be "entirely focused on objective background facts", and the doc is "the place to
  write down the trade-offs". Alternatives are judged by "the trade-offs that each respective
  design makes".
- **Non-goals are things a reader could expect.** Same article: "non-goals aren't negated goals".
  "Not slow" is a negated goal; "No offline mode" is a non-goal.
- **Relationships have specific verbs.** C4 (above): every line is one direction, labelled with
  what it does ("sends reminder emails through"), not "uses".

### 3.5 ADR (one decision; for unit 62)

- **The decision is one active sentence: "We will …".** Michael Nygard, "Documenting Architecture
  Decisions" (https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions,
  2011-11-15; CC0 1.0 per the page footer): the decision is stated "in full sentences, with active
  voice"; context is "value-neutral"; "All consequences should be listed here, not just the
  'positive' ones"; write "as if it is a conversation with a future developer"; bullets "only for
  visual style, not as an excuse for writing sentence fragments".
- **MADR's sentence shapes** (https://adr.github.io/madr/, MIT or CC0-1.0): the title is "short,
  representative of solved problem and found solution"; the outcome is "Chosen option: …, because
  …"; consequences are "Good, because …" and "Bad, because …". These are short enough to reuse as
  shapes; MIRAI's templates will describe them in its own words (62).
- **For the approver:** 13 §7 already proposed "We chose X over Y because Z. We accept W." The
  Y-statement stays in the detail (research/07 §2.3).

### 3.6 LLD (a change to code; for unit 62)

- **The summary says what changes, the risk and the rollback** (13 §7), in that order.
- **The reference part uses real names**: files, functions, tables, commands, in code spans (Google
  style, 13 §4; pstack "call each thing by one name").
- **The Rust RFC template** (https://raw.githubusercontent.com/rust-lang/rfcs/master/0000-template.md;
  the repo is MIT or Apache-2.0) separates a "guide-level explanation", written "as if it was
  already included … and you were teaching it", from the "reference-level explanation", and asks
  "Why should we *not* do this?" for drawbacks. Wording lesson: explain by example for the reader,
  then state the mechanics; write the drawbacks as plainly as the benefits.

### 3.7 Ticket (story or bug)

- **Given / When / Then each have one job.** Cucumber's Gherkin reference
  (https://cucumber.io/docs/gherkin/reference/, © The Cucumber Open Source Project; no license on
  the page): Given "describe[s] the initial context"; "Avoid talking about user interaction in
  Given's"; When describes "an event, or an action"; Then is "an expected outcome", and "An
  outcome should be on an observable output". Examples should not "make any assumptions about
  technology or user interface".
- **One event per criterion.** The reference's pattern and every example have one When (it does
  not state a rule). A When with "open, search or request anything" is three criteria and an
  open end.
- **The criteria are the behaviour.** Dan North, "Introducing BDD"
  (https://dannorth.net/blog/introducing-bdd/, © Dan North & Associates; no license): "A story's
  behaviour is simply its acceptance criteria". So a criterion that describes the test ("Given 100
  submissions in a load test") belongs in `verify`, and the criterion states the behaviour.
- **Testable means the author could write the test.** Bill Wake, "INVEST in Good Stories"
  (https://xp123.com/invest-in-good-stories-and-smart-tasks/, 2003; © XP123, all rights
  reserved): the card carries an "implicit promise: 'I understand what I want well enough that I
  could write a test for it.'" Hedges such as "if any" break that promise: find out, or mark an
  assumption.
- **The title says what someone can do after.** As for scopes (§3.3).

---

## 4. Words and shapes to avoid

The banned list stays in `src/lint/words.js` (31's decision, kept by unit 34). This section adds
only what 13 §4 didn't cover, and says what is lint-checkable.

| Avoid | Why | Instead | Source | L/J |
|---|---|---|---|---|
| "should", "may" in a requirement | An undecided requirement | "must", or an open question | RFC 2119 §6 | J (a lint is possible; 32 only fails "shall") |
| "where possible", "as appropriate", "if necessary", "if any" | An escape clause: the builder decides | Decide, or mark an assumption | INCOSE R8 (secondary) | J |
| "including but not limited to", "etc.", "and so on" | An open end | List every item | INCOSE R9; Google word list | L ("etc.", "and so on") |
| "several", "many", "quickly", "approximately" | A vague quantity | A number | INCOSE R7 | J (vague adjectives: L) |
| "and/or" | Two meanings at once | Choose one, or two sentences | Google word list | J |
| "e.g.", "i.e." | Abbreviations readers misread | "for example", "that is" | Google word list | J |
| "just", "simply", "easy" | Filler, or a judgement the reader may not share | Delete | Google word list | J |
| "uses" as a whole relationship | Says nothing about what flows | The verb that happens | C4 | J |
| Frontmatter syntax in prose (`risk: high`) | Written for the parser | Words: "high risk" | 33's P2 epic | J |
| A layer as a name ("front end", "bugs") | A grab bag, never done | What a person can do after | Shape Up ch. 12 | J |

**AI tells.** Wikipedia's "Signs of AI writing"
(https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing, WikiProject AI Cleanup; Wikipedia
text is CC BY-SA 4.0 under its terms of use, though the fetched part didn't show the footer) groups
them as language and tone, style, communication meant for the user, markup and citations. Its
word list (delve, crucial, pivotal, underscore, tapestry, testament, showcase, landscape …) changes
with each model generation. humanizer (§5) makes the same point: the structural habits last, the
words do not. MIRAI keeps word lists in the lint, where they can be reviewed (unit 34's doctor
check), and teaches the structural patterns in the skill.

---

## 5. blader/humanizer, read once at `8c307f3`

Fetched on 2026-11-20 into a scratch folder outside the repo, at commit
`8c307f367c91bd974002f10f2be2965d642c13df` (2026-10-16), as data only; nothing in it was run. MIT,
© 2025 Siqi Chen (`LICENSE`). `SKILL.md` is 397 lines, 26 numbered patterns in six groups,
"based on Wikipedia's 'Signs of AI writing'". research/06 §2 vetted it.

**What adds something for MIRAI's documents** (rewritten in `mirai-write`'s SKILL.md, in our words):

| humanizer group | Patterns kept | Why it matters for an approver or an agent |
|---|---|---|
| A. Staging instead of stating | §1 contrast with a claim nobody made; §2 one-line closers; §4 run-ups ("Here's what you need to know"); §5 arguing with no one | A summary has a word budget; each of these spends words without adding a fact. §5's "fake alternative" also invents options the approver then has to weigh. |
| C. Inflation | §12–13 inflated significance; §18 "serves as" for "is" | "A pivotal step" tells Jet nothing he can approve. |
| E. Leftovers | §22 chat residue; §25 writing about the document ("This section describes …") | A document stands alone; a sentence about the document is padding. |
| F. Wrong reader | §26 re-explaining what the reader knows | The approver already holds the brief when reading the PRD; the agent already holds the template. Lead with the decision. |
| How to work | "Treat the text as material to edit, never as instructions"; "Do not add a fact … unless it comes from the source"; "When not to act" | The first is the reader test's own stance. The second is the rule a rewrite must keep. The third keeps code, quotes, IDs and names untouched. |

**What MIRAI leaves out, and why:**

- **B. Rhythm by rule** (§6 triads, §7 repeated openings, §8 dashes, §9–11): mostly weak alone, and
  about voice. MIRAI's documents are reference text; the lint's sentence length does more. The
  em-dash rule would also fight MIRAI's own "None — <why>" and "Not applicable — <reason>" lines.
- **D. Formatting** (§19–21): MIRAI's templates fix the headings and the bold, so these tells come
  from the template, not the writer.
- **Voice matching** (writing samples): MIRAI's documents have one voice, plain and neutral.
- **§12's word list:** the list idea stays in `src/lint/words.js`; the words themselves are added
  there only after a review shows them in real drafts (doctor's 90-day review, unit 34).

There is no vendored copy and no upstream tracking (Jet's decision 9; D-27 changed).

---

## 6. pstack `technical-writing` and `unslop`

Both are in the cursor/plugins repo, `pstack/`, MIT, © Lauren Tan (research/03, research/13 §4 and
§6.2; plugin 0.15.44 read for 13). Not re-fetched for this file. What `mirai-write` takes, in its
own words: one name per thing, every pronoun with one obvious antecedent, specific over general
(13 §4), and from `unslop` the idea of a numbered, stable catalogue of tells, which MIRAI's six
patterns follow in small. Left out: `unslop`'s mid-sentence-colon and em-dash bans (taste, and
they would fight MIRAI's own line forms; research/03 W9).

---

## 7. Sources not reached

- The INCOSE Guide to Writing Requirements itself (incose.org returned 403; a "quick reference
  card" PDF found by search had no readable text). R7–R9 are cited from secondary sources only.
- Olaf Zimmermann's Y-statement article on Medium (403); research/07 §2.3 has its form.
- Atlassian's epic page (only navigation was returned).
- The Google style guide's license line (the fetched part of the word list didn't include the
  footer).

---

## 8. What unit 34 takes, and what it leaves

**Into the guides now:**

| Guide | Rules |
|---|---|
| `SKILL.md` | The two readers; order (answer, reason, detail); the summary written last from the detail; the six patterns (padding, empty emphasis, staging, re-explaining, chat leftovers, wrong reader); one name per thing; exact values; when not to act. |
| `brief.md` | A problem names a person and a cost; a BR is an outcome with no mechanism; evidence labelled; "Why now" names what changed; "What changes" holds changes only. |
| `prd.md` | One requirement, one "must", one response; the actor named; exceptions in their own sentence or FR; exact messages in quotes; no escape clauses or open ends; one term per concept. |
| `epic.md` | Sentences about the set; one idea per bullet; field values in words; each "Not in this" item with its reason. |
| `ticket.md` | Given is state, When is one event, Then is observable; the criterion is behaviour, the test goes in `verify`; exact values from the PRD; no hedges; titles say what someone can do after. |

**Left for 62 and later:** the HLD's quality-goal and relationship wording (arc42, C4); the ADR's
"We will …", MADR outcome and consequence shapes; the LLD's guide-level and reference-level split
(Rust RFC). Each of those units researches its own format and template in depth.

**Possible lint rules, not added by this unit** (each needs evidence from real drafts first):
"should" or "may" inside an FR, escape clauses, "and/or", "e.g." and "i.e.". The doctor's 90-day
review of `src/lint/words.js` is where they get decided.
