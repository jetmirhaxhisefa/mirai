# MIRAI's documents: two readers, one file

Unit 31 (PM-03; `research/13-document-writing.md`). Every document you approve has two layers in
one file:

- **The summary for approval** is for you: what is asked, why, what changes, what you must decide,
  and what is left out. It's one page, and you can approve from it alone.
- **The detail** is for the agents. It must be complete enough that the next step needs no
  guessing.

Briefs have it from unit 31, PRDs from unit 32, epics from unit 33. HLDs, LLDs and ADRs get it as their units come.
Tickets and plans don't: they're short already, and their gates are different.

The project's context files in `.mirai/context/` (business, critical journeys, feature map,
project facts and conventions, unit 36) have no summary: you approve the whole file. See
[context.md](context.md).

## The document types

Each type is a file in `registry/document-types/`, with its template and checklist in
`registry/templates/`.

| Type | What it is | Where it lives | Explained in |
|---|---|---|---|
| `interview` | the questions an agent asked you before the brief, your answers and your "yes"; no approval of its own, but an unconfirmed one blocks the brief's | `docs/mirai/<initiative>/interview.md` | "The interview", below |
| `requirements` | your own list of requirements, each line word for word as `REQ-n`; a source the PRD carries line by line | `docs/mirai/<initiative>/requirements.md` | "From request to approval", below |
| `business-change` | a proposal to change `business.md`, which you approve on its own; approving it applies it | `docs/mirai/<initiative>/business-change.md` | "From request to approval", below |
| `brief` | the business case for a feature: the first document | `docs/mirai/<initiative>/brief.md` | "The business brief", below |
| `prd` | what the product must do, and how each requirement is checked | `docs/mirai/<initiative>/prd.md` | "The PRD", below |
| `epic` | a set of tickets, approved together | `docs/mirai/<initiative>/epic-<slug>.md` | "Epics and ticket sets", below |
| `story` | a ticket: one vertical slice of work | `docs/mirai/<initiative>/tickets/<key>.md` | "Epics and ticket sets", below; [agents.md](agents.md) for how it's built |
| `bug` | a ticket: what's wrong, how to reproduce it, and how the fix is proven | `docs/mirai/<initiative>/tickets/<key>.md` | [tdd.md](tdd.md) for its red test |
| `investigation` | a ticket that answers one question with research and a written finding, no code merge; its run is unit 42b, and until then MIRAI doesn't start one | `docs/mirai/<initiative>/tickets/<key>.md` | [tickets.md](tickets.md) |
| `plan` | how one ticket will be built and proven, written by Kai | the store: `<store>/tickets/<ticket>/plan.md` | [agents.md](agents.md), "The plan step" |
| `business` | what the product does, for whom, its goals, rules and constraints, each claim with its source; approved as a whole | `.mirai/context/business.md` | [context.md](context.md) |
| `journeys` | the critical journeys `J-n`, each with its steps, why it's critical and its E2E test; approved as a whole | `.mirai/context/journeys.md` | [context.md](context.md) |
| `feature-map` | one row per screen: its name, route and test handles; not approved, the lint checks it against the code | `.mirai/context/feature-map.md` | [context.md](context.md) |
| `project` | one service's stack, commands, layout and test levels; not approved, the lint checks it against the code | `.mirai/context/project-<service>.md` | [context.md](context.md) |
| `conventions` | one service's rules, each `enforced by <check>` or `judgment`; approved as a whole | `.mirai/context/conventions-<service>.md` | [context.md](context.md) |

`docs/mirai` is the default `[docs] root` ([config.md](config.md)).

A project can change a type for its own needs: add, reorder or rename sections, or use its own
template. Each change is an overlay you approve, and it can't drop what MIRAI reads. See
[overlays.md](overlays.md).

## The lint: `mirai lint`

`mirai lint` checks the shape of MIRAI documents: frontmatter, sections, IDs, links, and each
type's own checks. It writes nothing.

```
mirai lint                 # every MIRAI document in the repo
mirai lint docs/mirai/     # only these files or folders
mirai lint --json          # the result as JSON
```

- **Which files:** every Markdown file inside the docs root. Outside it, only a file whose
  frontmatter names a known type and has `template:`.
- **Exit codes:** 0 when clean (warnings allowed), 1 with problems, 2 for a usage error, 3 for a
  broken registry or config.
- **The rules come from the MIRAI you run.** No flag or setting points it at other rules.
  `[docs] root` and the repo names come from `.mirai/config.toml` only, never your personal files.
- **From your session:** `/mirai lint`, or MIRAI's `lint` tool, which uses the trust root's rules
  ([agent-safety.md](agent-safety.md)).

## The summary for approval

It comes right after the document's `# title`:

```
## Summary for approval
### The ask              one sentence, ≤30 words, starting Approve, Decide or Note
### Why                  2–4 sentences: who has the problem, what it costs, why now
### What changes         3–7 bullets, each ending with the IDs it sums up (BR-1)
### Decisions for you    each: the question, 2–3 options, a recommendation and its cost, the ID
                         it rests on; or "None — <why>"
### Not in this          each left-out thing, its reason and its NG-n
```

**How to read one as the approver:**

1. **The ask** says what you're agreeing to, and the outcome it buys.
2. **Decisions for you** is what the agent couldn't decide alone. Answer each one. An item you
   disagree with is a rejection, with your answer as the reason.
3. **What changes** and **Not in this** are the scope. If something you expected is missing from
   both, ask.

Every number and ID in the summary comes from the detail; the lint checks it. Open the detail for
an ID you want to check.

**What the agent who writes it must do:**

- **Write it last,** from the finished detail.
- **Say nothing the detail doesn't hold.**
- **Keep to the word budget:** brief 400, PRD 600 (a full PRD 1,000), HLD 600, LLD 500, ADR 250, epic 400. A project can change the brief, PRD and epic budgets (see "The caps" below, and "Epics and ticket sets").

## The writing rules

The lint checks these. A failing document goes back to its author with the sentence quoted and
the fix named.

| Rule | Where | Fails | Warns |
|---|---|---|---|
| The word budget | summary | over the type's budget | at 80% of it (an epic: at 300 of 400) |
| Sentence length | everywhere | over 25 words | over 20 words |
| Banned words | everywhere | "leverage", "utilise", "seamless", "etc."… (`src/lint/words.js`) | — |
| A vague word with no number | everywhere | "fast", "scalable", "secure", "robust"… in a sentence with no number | — |
| Paragraph length | summary | more than 5 sentences | — |
| An acronym | everywhere | not spelled out at its first use, unless it's well known (API, PR…) | — |
| A list's lead-in | summary | a list after a line that doesn't end with ":" | — |
| An ID in the summary | summary | not defined in the detail | — |
| An open question or proposed ADR | summary | not under "Decisions for you" | — |
| A non-goal | summary | not under "Not in this" | — |
| A number in the summary | summary | — | not found in the detail (decision 3) |

Code spans, code blocks and tables are never checked for writing. The `mirai-write` skill (unit
34) teaches agents the wording behind these rules, with three before-and-after examples per type,
and the reader test below checks the summary as a whole.

The banned words live in `src/lint/words.js`, which opens with its review date. Every 90 days,
check the lists against the last 90 days' lint warnings and findings, change them, and update the
date. `mirai doctor` shows a yellow "Banned words" item once the date is older than that.

## Vera, the verifier

Unit 40 (Jet's decisions 1–7). The lint checks a document's form, and the reader test checks its
summary. Neither judges what it says. **Vera** (`mirai-verifier`) does: she reads a finished
document the way a strict senior reviewer would, cites every finding to its line, and the author
fixes the must-fix ones before the document reaches you.

**The order** is the lint, then Vera, then the reader test (where the type has one), then you.

**Which documents** (decision 6): the brief, the PRD, the epic with its tickets, and the context
files you approve: `business.md`, `journeys.md` and each `conventions-<service>.md`. Not
`feature-map.md` or `project-<service>.md` (the lint checks them against the code), and not plans
(Kai's plan gate). A type she checks has `verifier = true`, and its checklist marks her lines
`- [vera] …`; a checklist with none fails the registry check. Lines an overlay adds to a
checklist (`docs/overlays.md`) are hers too.

**The three layers** (decision 3):

1. **the type's checklist:** its `[vera]` lines, the judgement a script can't make;
2. **the top part against the detail:** every decision, requirement and boundary in the detail is
   named in the top part, and nothing in the top part is missing below;
3. **the project's context:** no contradiction with `business.md`, a critical journey in
   `journeys.md`, or a conventions rule. A claim in a context file whose cited source doesn't say
   it is a must-fix: it should be `(open)`, and asked. An `(open)` line itself isn't a finding.

**Each finding** has a grade, a layer, where it is (the file, the line and the exact quote), what
it contradicts for a context finding (the context file and its line or source ID), what is wrong
and the fix, each in one sentence, and its kind:

- **must-fix**, by a fixed list (she picks the kind and type first, then the grade): anything
  that contradicts a context file; a `scope`, `audience`, `money-legal`, `conflict` or `invented`
  decision you weren't shown; an upstream commitment (a business requirement, scope, a rollout,
  the appetite or a budget, a success metric) dropped or changed without the summary saying so; a
  contradiction inside the document or with an upstream one; a top part that hides or adds
  something; a builder left asking. These block. MIRAI holds the first two and every top-vs-detail
  finding itself: such a finding is must-fix whatever grade she gave (her own is kept beside it,
  unit 40's P2);
- **suggestion:** everything else, such as a number no source gives that a builder can build as
  written. It doesn't block or use a round. It goes to the author and is listed for you;
- **writing or decision** (unit 44's decision 3): `writing` when a source that exists gives the
  fix; `decision` when it needs a new fact or a choice that no source holds (scope; users,
  markets, countries; money and legal; a number no source gives; two sources that disagree; a
  trade-off), with its `decision_type`. When in doubt, decision. A decision already under "Decisions for
  you" is no finding: it's already yours. A claim **added since her last check** that no source
  holds is an `invented` decision: always must-fix (the workflows give her the earlier version,
  unit 44).

Every `context` finding names the context file it contradicts; a contradiction with the
document's own upstream (a PRD against its brief) is a `checklist` finding naming that document.

MIRAI checks every quote by a text match, as the reader test does: a finding whose quote isn't in
its file is dropped and logged, never shown, and so is a finding that breaks a rule of the
schema on its own (a context finding that names no context file, an unknown grade); the other
findings count. A finding on a part the template fixes word for word (a PRD's "ID prefixes") is
dropped too: the author can't change it. `mirai verify` lists each dropped finding apart, with why and what it said, so a
lost must-fix is visible; it's never counted. A reply that isn't the schema's shape at all (no
list of findings) records nothing.

**Running it:**

```bash
mirai verify docs/mirai/<initiative>/prd.md
mirai verify .mirai/context/business.md
```

From your terminal or your session (`/mirai verify <file>`). Vera runs as every agent does: MIRAI's
launcher, read-only (`Read`, `Glob`, `Grep`), the red-team-tested template, a fresh context, on the
`verify` step's model. Everything she checks goes in as data: the document (an epic's tickets with
it), its checklist as `mirai show checklist <type>` prints it, the documents it links in the line
under its title, and the context files, each with whether it's approved as it is now. Like every
launch, it needs a clean work tree: commit the document first (a document in the local store is
outside the repo, so this never stops it).

The output ends with the must-fix count, then each finding, then the document's full path:

```
Vera (mirai-verifier) checked docs/mirai/due-dates/prd.md (prd due-dates-prd)
round 1 of 3, model claude-sonnet-5-5, tier standard
result: 1 must-fix finding open; recorded as sha256:…
fix them, then run mirai verify docs/mirai/due-dates/prd.md again (…)
must-fix: 1
  must-fix  V-1  checklist, writing  docs/mirai/due-dates/prd.md:58
        "An assignee gets a reminder email"
        FR-4 doesn't say when the email is sent.
        fix: Say "the evening before the due date, at 18:00 in the assignee's time zone".
/Users/you/Projects/app/docs/mirai/due-dates/prd.md
```

**Rounds** (decision 2): each result is kept in MIRAI's store by the document's exact bytes (an
epic's with its tickets), with its round: 1 for the first version checked, one more for each
changed version. A rerun on unchanged text shows the kept result and costs no run. The author has
`[docs] verify_fix_rounds` fix rounds after the first check (default 2, 0–5, project file only);
the reader test's are `[docs] reader_fix_rounds` (the same default; unit 34 had it fixed at 2).

`mirai verify <file> --handoff` prints the must-fix findings of the result for the file as it is
now, as the author's next run gets them: fenced as data, with "fix these, then run mirai verify
again". The workflows (units 44 and 45) pass it to the author's run.

**At approval** (Scope 5):

- **no result** for the document as it is now: refused, with `run: mirai verify <file>, then
  approve again`;
- **must-fix findings with rounds left:** refused too: the author fixes them first;
- **must-fix findings after the last round:** "Vera: N findings open", each listed. You can still
  approve, reject with a note, or answer them yourself (fix the document, check it again);
- **a pass:** "Vera: passed (N suggestions)".

The signed approval line records the result's hash (`verifier`). The reader test, on a type that
has both, needs Vera's pass or her last round first, so the summary it reads is the fixed one.

**Misses** (decision 7): when you reject a document Vera passed, the reason you give is recorded
against the type as her miss (a `verifier_miss` line in the journal, with the result's hash), for
the review after the MVP. `mirai show <initiative>` marks the document: "missed by Vera".

**The model** is the step `verify` in `[models.steps]` (decision 4). It's `standard` until unit
40's P1 measures `standard` against `deep` on seeded documents; the cheapest tier that catches
every seeded defect with no false must-fix becomes the default. Each run's log line has its tier
and model, and its rung when MIRAI ran the author (`docs/model-tiers.md`).

**Turning her off** (project file only; every approval then says so):

```toml
[docs]
verify = false
```

## From request to approval

Unit 41. Nora (`mirai-product-manager`) turns your request into a brief and a PRD ready for your
approval. Your time goes into answering questions and approving; she writes in the background.
The steps, in order:

1. **The interview, in your session** (`mirai-interview`). Before the first question the session
   reads `business.md` and `journeys.md`. A request that contradicts them gets it as the first
   question, with "propose a change to business.md" as one option. When you give your own list of
   requirements, the session keeps it as `requirements.md` and asks only what it leaves open or
   where lines contradict.
2. **Your list, numbered:** `mirai requirements <initiative>` (or `/mirai requirements`) numbers a
   pasted list in place, each line word for word as `REQ-1`, `REQ-2` …; `--from <file>` copies a
   file of yours and names it as the source.
3. **A business.md proposal, when you chose one:** `business-change.md` beside the interview. Each
   change quotes business.md's lines as they are (`Replace:`) and the new text (`With:`), with its
   source ("you said, <date>") and why. `mirai approve --file docs/mirai/<initiative>/business-change.md`
   applies it to business.md and signs both; a rejection leaves business.md as it was. The brief
   can't be approved while it's open. Nora never edits business.md.
4. **Commit, then start her:** every launch needs a clean tree, and MIRAI commits her documents on
   your current branch, never on the integration branch. So the session commits `interview.md` (and
   the list) on a branch for the feature, then runs `/mirai write <initiative>` (in a terminal:
   `mirai write <initiative>`).
5. **Her run:** one MIRAI run, several launches, on the `prd` step's tier (deep). For the brief,
   then the PRD:
   - her launch writes the document (on the local store she returns it and MIRAI writes it there),
     and on the repo store lints it herself with MIRAI's `lint` tool before it ends;
   - MIRAI refuses any change outside the initiative's folder, and commits hers (you as author,
     MIRAI as committer, `Mirai-Initiative: <initiative>`);
   - the lint, then Vera (on the `verify` step's own tier, not raised to Nora's; her launch is the
     author's, so the run log has the rung), then the reader test where the type has one;
   - what they find goes to her next launch: the lint's problems, Vera's must-fix findings (fenced),
     the reader's gaps. Within `[docs] verify_fix_rounds` and `reader_fix_rounds`, and two lint
     fixes for each draft (her write, and each fix of Vera's or the reader's findings).
6. **She pauses** when only you can answer: a contradiction with the context she meets while
   writing, a fact or choice no source holds, or a `decision` finding of Vera's. She writes
   `(open)` with the question where the answer goes, adds it to `interview.md` as an open question
   with options and her guess, and sets the interview `paused`. Your session tells you the
   question; you answer it there, confirm, commit, and start her again. She continues from the
   documents as they are.
7. **She's done:** your session says "the brief and the PRD are ready to approve", with each
   file's full path and link. You approve them as always (on standard, one decision for both).

**Your own list, line by line.** The PRD cites each `REQ-n` on the FR, NFR or AC that carries it
(`(BR-2) (REQ-23)`). The lint fails a line no requirement cites (unless "Not in this" lists it with
the reason) and a `REQ-n` the list doesn't define. Vera gets the list as a fourth input: a line
cited with its number or condition changed ("1 day before" became "before") is a must-fix on the
`checklist` layer, whatever grade she gave. A line left out under "Not in this", with a reason, is
no finding. (`REQ`, not `R`: a brief's and a PRD's `R-n` are their risks.)

**Template gaps.** When something fits no section, she puts it in the closest one (a risk, an
assumption, an open question) and reports it. Each gap is a `template_gap` journal line; `mirai
show <initiative>` lists them. A gap never changes a template, and she never adds a section.

**Where she stands:** `mirai show <initiative>` (or `/mirai show <initiative>`) shows her state
under the documents: running, paused with her question, done, or stopped with why, and each run's
record (rounds per check, launches, tier and model). `mirai write`'s own last lines are the same.

**The ticket step (unit 42).** Once you approve the PRD (on `full`, the design, once units 62–65
write it; until then the PRD), Tess (`mirai-ticket-planner`) cuts it into an epic and its tickets:
`/mirai tickets <initiative>` in your session (`mirai tickets <initiative>` in a terminal). Her
run is Nora's, for the set:

1. her first launch writes the epic and every ticket, on the `tickets` step's tier (standard);
2. MIRAI refuses any change outside the epic, `tickets/` and `interview.md`, renders the epic's
   generated sections (`mirai epic render`'s work), and commits on your branch;
3. the lint (each ticket with the testability lint, the epic with the graph lint), then Vera on the
   epic with its tickets; what they find goes to her next launch, which resumes her kept session;
4. **she pauses** on a gap in the PRD (an AC nobody could test, a case it doesn't cover, a set over
   a cap): her question goes in `interview.md`. Your answer changes the PRD, so `/mirai write`
   brings it in line, you approve the PRD again (approval shows only the lines that changed since
   your last approval, with the whole file's path), then `/mirai tickets` again. She never edits
   the PRD, and never fixes a gap only in a ticket;
5. **she's done:** the epic and its tickets wait for your one approval of the set.

The types, priority, order and the run's pick are in [tickets.md](tickets.md).

## One ticket by hand

`/mirai ticket "<one line>"` in your session (unit 42): the session reads the context files and the
code the line names, and asks **at most 3 questions** (`mirai-interview`, "One ticket by hand"). The
record is `docs/mirai/<name>/interview.md` with `for: ticket`; the lint fails one with a fourth
question; when three can't settle the request, the session says so before asking and offers
`/mirai-new` or a sharper line, and never writes a ticket interview from a guess. Then Tess writes
**one** story or bug (`mirai tickets <name> --one`) at
`docs/mirai/tickets/<KEY>.md`: no epic, an `Interview:` line under its title, and anything still
open in its Notes (she doesn't pause). MIRAI lints it and Vera checks it against its interview and
the context files. You approve it on its own (`mirai approve <KEY> --file
docs/mirai/tickets/<KEY>.md`: the lint and Vera's result first, as for a document). It gets its own
branch, and its documents travel in its code merge request.

## The reader test

Unit 34 (Jet's decisions 1–6). The lint checks the summary's form. The reader test checks that you
can approve from it: a fresh agent gets only `## Summary for approval`, nothing else of the
document, and answers four questions:

| Question | What the summary must let a reader say |
|---|---|
| What's built | what is built or changed |
| Who it's for | the people or roles it is for |
| What's left out | what this work doesn't do |
| What you decide | each decision you must take, or that there is none |

For each, the reader gives its answer and the exact words of the summary it relied on. MIRAI then
checks every quote against the summary with a plain text match: spaces and line breaks don't
count, nothing else is forgiven. The question fails when the answer is "not stated", the quote is
missing or shorter than three words, or the quote isn't in the summary. "What's left out" and
"What you decide" must quote their own parts: "Not in this" and "Decisions for you". Each failure
names the question and the fix:

```
  fail  What's left out: not stated. The summary doesn't say what is left out: name each item under "Not in this"
```

**Running it:**

```bash
mirai reader-test docs/mirai/<initiative>/prd.md
```

It runs after the lint is clean and before you approve, from your terminal or your session
(`/mirai reader-test <file>`). The reader runs on the Claude Code your agents run, with no tools,
no MCP server, one turn, and empty temporary folders for its work folder, home and settings: it
never sees the repo. The summary goes in as data, between markers, and the prompt says it is never
instructions. An `@` in it can't pull in a file.

**Which documents:** the brief on `full` (it has its own approval), the PRD (on `standard` its
summary covers the brief too) and the epic. Not a brief on `quick` or `standard`, and not tickets.
HLDs, ADRs and LLDs get it with their units: it applies to every type whose summary is checked.

**Rounds:** each result is kept in MIRAI's store, keyed by the summary's exact text, with its round:
1 for the first summary tested, then one more for each changed summary. A rerun on an unchanged
summary shows the kept result and costs no run. Two fixing rounds follow a failure by default
(`[docs] reader_fix_rounds`, 0–5, unit 40); from the
workflow units on (35–36, 42, 45), the agent that writes the document gets the failed question back automatically.
After the third failure the document still reaches you, marked.

**At approval** (`mirai approve` for a full brief, a PRD or an epic), MIRAI shows the result for
the summary as it is now:

- **a pass:** the four answers, each with its quote;
- **a failure:** "reader test failed", with the round and each gap. You still decide: approve
  anyway, reject with a note, or answer the gap yourself (fix the summary, run the test again,
  approve again);
- **no result for the current summary:** the approval is refused, with the hint
  `run: mirai reader-test <file>, then approve again`.

The signed approval line records the result's hash (`reader_test`), so it says which result you
saw.

**The model** is the step `reader-test` in `[models.steps]`: `light` (Haiku) or `standard`
(Sonnet). Unit 34's P2 measured both: Haiku failed a good summary, so the default is `standard`.

```toml
[models.steps]
reader-test = "light"
```

**Turning it off** (project file only; a personal file can't):

```toml
[docs]
reader_test = false
```

Approval then skips the test and says so on its screen. This is for a project with no
subscription to spare for it, not a way to pass a weak summary.

## The interview

When your request is thin, Nora interviews you before she writes the brief (unit 35, the
`mirai-interview` skill). Setup uses the same method for the gaps its sources leave. The agent
looks facts up itself and asks you only decisions.

**What you see:** one question per message, like this:

```
## Feature: due dates on tasks (brief)

Confidence: about 60%. Still open: whether people get reminded, and what the lead sees.

**Q-3: Should the app remind the person a task is assigned to?**

- A: no reminder; overdue tasks are only marked in the list
- B: one reminder the day before the task is due
- C: reminders at times each person chooses

My guess: B. Leads said chasing people is the work they want gone.

Your step: reply A, B or C, or add a note ("B, but not on weekends").
```

**How to reply:**

- A letter is enough: "B". "yes" takes the agent's guess. "B, but no email" adds a note.
- **"explain"** gets plain words and an example, then the same question again.
- **"pause"** saves every question the agent still has, with its options and guess, and stops. A
  new session picks up at the first open question and asks no answered one again.

The interview has no fixed length. It stops when the agent can predict your next three answers.
If three answers in a row don't make it surer, it stops and asks you how to go on.

**The end:** the agent restates what you want in six lines: outcome, who it's for, why now,
success, limits, and what's not included. Only an explicit "yes" closes it. "Sounds good" gets one
more question that names the choice.

**Where the record lives:** `docs/mirai/<initiative>/interview.md`, beside the brief. It holds every
question with its options, the guess and your answer, the restatement, and your "yes" with its
date. The brief links it in the line under its title:
`Interview: [Interview: due dates on tasks](interview.md)`. A filled example is
`registry/examples/interview.md`. Its `state` is `open`, `paused` or `confirmed`, and
`mirai show <initiative>` lists it with that state.

**What blocks approval:** an interview isn't approved on its own, but `mirai lint` fails it until
it is confirmed. The brief beside it then fails too, naming the open questions, so
`mirai approve` refuses the brief (on `standard`, the brief and PRD pair) and writes nothing:

```
docs/mirai/due-dates/brief.md:12: the interview interview.md has open questions: Q-6 and Q-7 (answer them in your session, then run mirai lint)
```

An `interview.md` beside a brief that doesn't link it fails the same way. A brief with no
interview beside it (the request was clear) is linted as before.

**Approval binds the interview.** When you approve a brief that links its interview (on `full`
the brief alone, on `standard` with its PRD), the brief's signed line records the interview's path
and hash, as an epic's line records its tickets. A change to the interview after that makes the
brief's approval stale, even when the brief itself is unchanged: `mirai show` lists the brief as
"changed since approval", and it needs a new approval. As with a changed brief, only the brief's
line goes stale; the PRD's stays approved.

In autonomous mode no one can answer, so the agent writes its questions into `interview.md`,
leaves it `paused` and stops. The feature waits for you.

## The business brief

The brief is the first document of a feature. Its template is `registry/templates/brief.md`, and
a filled example is `registry/examples/brief.md`. After the summary come these sections:

| Section | What it holds | From |
|---|---|---|
| Problem | who has it, what it costs, the evidence | Lenny's 1-pager, Shape Up |
| Who it is for | the first real user and their situation | Lenny (Audience) |
| Why now | what changed | Lenny (Why) |
| Success | `SM-n`: metric, baseline, target, how measured, counter-metric | Lenny (Success) |
| Business requirements | `BR-n`: outcomes, never a screen, field or API | MIRAI's ID chain |
| Appetite and track | the time worth spending; `quick`, `standard` or `full` | Shape Up (Appetite) |
| No-gos | `NG-n`, each with its reason | Shape Up |
| Rabbit holes | `R-n`, known risks and how they're handled (optional) | Shape Up |
| Hard questions | a sceptic's questions, answered (optional; for customer-facing work) | Amazon PR/FAQ |
| Sources | every source cited | — |
| Open questions | `Q-n`; none left at approval | — |

**Approving one:**

```bash
mirai approve <brief-id> --file docs/mirai/<initiative>/brief.md
```

It refuses a brief that fails the lint, still has an open question, or has an interview beside it
that isn't confirmed ("The interview", above). Your answer is signed on the file's exact bytes, so a brief changed after its approval needs a new approval.

On the `standard` track, you approve the brief together with the PRD (unit 32). On `full`, it
has its own approval.

## The PRD

The PRD (product requirements document) is the second document of a feature. It says what the
product must do, and how each requirement is checked. Its template is
`registry/templates/prd.md`, and a filled example is `registry/examples/prd.md` (the due-dates
feature, from the example brief). Vera's checklist is `registry/templates/prd-checklist.md`.

It sits beside its brief, at `docs/mirai/<initiative>/prd.md`, and links it in one line under
the title:

```
# Tasks with due dates that people finish on time

Brief: [Tasks with due dates that people finish on time](brief.md)
```

The PRD doesn't repeat the brief's Problem, Who it is for, Why now or Success. It cites the
brief's IDs (`BR-n`, `SM-n`, `NG-n`, `R-n`, `Q-n`). Its own `NG`, `R` and `Q` numbers carry on
after the brief's highest: the brief has `NG-1`…`NG-3`, so the PRD's first new no-go is `NG-4`.
One ID means one thing across both files.

### Lite and full

One type, two variants, set by `variant:` in the frontmatter:

| Variant | Track | Sections |
|---|---|---|
| lite | `standard` | Summary for approval, User journeys, Functional requirements, Non-functional requirements, Non-goals, Assumptions, Open questions, Glossary |
| full | `full` | the lite sections, plus Key flows, Risks, Dependencies and Rollout |

A full PRD's summary may say more: up to 1,000 words (lite: 600), and up to 12 "What changes"
bullets, grouped under short lead-ins such as "For team leads:" (lite: 3–7). The work is bigger,
so the approver needs more of it on the page (Jet, after 32's P1).

A lite PRD becomes a full one by filling in the four extra sections; nothing is rewritten. A lite
PRD may fill any of them. The lint warns when the variant and the track disagree.

### The four requirement groups

The functional requirements sit in four groups. Each group has one sentence shape:

| Group | Shape | Example (due dates) |
|---|---|---|
| Capabilities | "[Actor] can …" | FR-1: A task's creator can set, change or remove the due date of a task. (BR-1) |
| Triggers and states | "When …, the system must …" / "While …, … must …" | FR-4: When a day ends, the system must send each assignee one email listing their tasks due the next day. (BR-2) |
| Failures | "If …, then … must …" | FR-6: If a due date before today is entered, then the system must refuse it with a message saying why. (BR-1) |
| Unchanged behaviour | "Where …, … must …" | FR-9: Where a task has no due date, the task list must show and sort it exactly as it does today. (BR-1) |

The lint checks that:

- all four groups are there. Failures and Unchanged behaviour hold requirements, or one line:
  `None — <reason>`;
- every requirement says "must", never "shall";
- every FR ends with the brief's BR it serves, and every BR of the brief is served by an FR or an
  NFR;
- every FR has at least one AC (`AC-FR-n.m`), and every AC has Given, When and Then;
- every AC (`AC-FR-n.m`, `AC-NFR-n.m`) is one a reviewer could test (unit 42, `prd-ac-untestable`):
  its outcome, the "then" part, names no vague word without a number (`reliably`, `properly`,
  `as expected`, `quickly`, the writing rules' `fast` and `reliable` …). A bullet with no ID under
  an AC is part of it and is held to the same rule. The same rule as a ticket's ACs
  ([tickets.md](tickets.md)), so a vague AC can't reach approval, and then Tess;
- every NFR says how it's verified: its own `AC-NFR-n.m`, or a line `Verified by:` naming a test
  level, a measurement or a manual check;
- IDs run 1, 2, 3 … with no gap, and an AC's requirement exists.

A sentence that doesn't match its group's shape only warns, until we've seen real PRDs. The
shapes come from EARS, the Easy Approach to Requirements Syntax (Alistair Mavin and others,
Rolls-Royce, 2009).

### The glossary

Every PRD ends with a glossary in two parts:

- **ID prefixes:** a fixed table from the template that says what BR, SM, UJ, FR, NFR, AC, NG,
  R, DEP, PH, A and Q mean, with an example each. Keep it word for word; the lint checks it. It
  isn't counted in the word cap, and neither is the rest of the glossary.
- **Terms:** each word the requirements depend on, defined once and used in exactly that form.

### The caps

| Variant | Cap | Warning at |
|---|---|---|
| lite | 3,000 words | 2,400 |
| full | 5,000 words | 4,000 |

Everything below the frontmatter counts, ACs included. The frontmatter, code blocks, the Glossary
and Open questions don't. (The caps were 2,000 and 3,500 until 32's probes: three agent-written
PRDs for a small feature landed at 1,860–1,990 words, and one cut requirements to fit.)

Over the cap fails the lint. Split the feature into two PRDs, or move to `full` and put the "how"
into the design. Don't remove requirements or ACs to fit.

If the PRD can't be split, set `length_exception: "<reason>"` in the frontmatter. The cap then
warns instead, and "Decisions for you" must hold an item that names the cap and the word count,
so you decide: one PRD, or a split. On a PRD under the cap, `length_exception` is an error.

A project can change the caps and the summary budgets in `.mirai/config.toml`. Personal files
can't. Each key has a range, so a cap can't be switched off:

```toml
[docs.limits]
brief_summary_words = 400   # 100–2,000
prd_summary_words = 600     # 100–2,000
prd_full_summary_words = 1000  # 100–2,000
prd_lite_words = 3000       # 500–10,000
prd_full_words = 5000       # 500–10,000
```

### Approving the PRD

```bash
mirai approve <prd-id> --file docs/mirai/<initiative>/prd.md
```

MIRAI reads the brief the PRD links to and lints both as at approval: no open question in either,
and no `[ASSUMPTION]` tag left outside "Assumptions". A problem in either file refuses both, and
nothing is written. The PRD's summary needs a reader-test result first ("The reader test", above).

- **On `standard`** you read one summary, the PRD's. It covers both documents: the ask names both,
  "Decisions for you" carries the brief's open decisions, and "Not in this" lists the brief's
  no-gos with the PRD's. MIRAI prints both paths and hashes, you decide once, and two signed
  approvals are written, one on each file's exact bytes.
- **On `full`** the brief has its own approval first. The PRD is refused unless the brief is
  approved as it is now.

A brief or PRD changed after its approval needs a new approval. Only the changed file goes stale.

### Finding the documents

```bash
mirai show <initiative>
```

It lists the initiative's documents, each with its type, id, approval state and full path, so
you can open it with one click:

```
due-dates   standard
  brief.md   brief   due-dates-brief   approved                 /Users/…/sample-app/docs/mirai/due-dates/brief.md
  prd.md     prd     due-dates-prd     not approved             /Users/…/sample-app/docs/mirai/due-dates/prd.md
```

The state is "approved", "changed since approval" or "not approved". When the name is also a
ticket MIRAI knows, `show` asks you to choose: `--docs` for the documents, `--full` for the
ticket. It writes nothing, so `/mirai show` in your session has it too.

Once a document is on a pushed branch with the same bytes, its line also gives its GitHub or
GitLab link after the path. `mirai approve` ends the same way: its last line is the document's
full path, and the link once it's pushed.

### Where documents are kept, and how they reach main

Documents are kept in the project's store: the repo (the default) or your Mac only. In the repo,
an initiative's documents reach the integration branch through one docs merge request, which
MIRAI opens with `mirai docs publish <initiative>` and merges with `mirai docs merge
<initiative>` after your signed approvals. [Stores and the docs merge request](stores.md) has the
whole flow.

## Epics and ticket sets

After the PRD, the work is split into tickets, and you approve the set before any of it is built
(the `tickets` gate is always yours). The epic is the one page you approve it from. Its template
is `registry/templates/epic.md`, and a filled example is `registry/examples/epic.md`: the
due-dates epic, with its seven tickets in `registry/examples/tickets/`. Vera's checklist is
`registry/templates/epic-checklist.md`.

It sits beside the PRD, at `docs/mirai/<initiative>/epic-<slug>.md`. Its tickets are
`docs/mirai/<initiative>/tickets/<key>.md`, each with `epic: <the epic's id>`. On `standard`
there is one epic per PRD. On `full` there may be several, each covering its own FRs, and one
approval covers them all.

It links its PRD, and on `full` its design, in lines under the title:

```
# Due dates and reminders, in seven tickets

PRD: [Tasks with due dates that people finish on time](prd.md)
Design: [HLD](hld.md), [LLD for reminders](lld-reminders.md)
```

`PRD:` is always required. `Design:` is required on `full`, and on `standard` once a ticket names
an ADR in `governed_by`. The lint checks that its links resolve; their types are checked once
the HLD and LLD types exist (unit 62).

### Reading an epic as its approver

1. **The summary for approval** (400 words at most) is the same five parts as every document.
   "What changes" groups the tickets by what they deliver, each bullet ending with its ticket
   keys and FRs: "Reminder emails go out the evening before, retried once (SAMPLE-53, SAMPLE-54;
   FR-4, FR-7)".
2. **Decisions for you** lists, by ticket key with a one-line reason, everything that needs your
   call: every `risk: high` ticket, every `e2e: true` ticket, every `tdd` or `tests` override,
   and the release mode when it's `together`. The lint checks each one is there.
3. **Order** says why the tickets come in this order: the tracer bullet first (the thinnest path
   through every layer), then the ticket the team is least sure of.
4. **Release** names the mode: `per-ticket` (the default) or `together`, with its reason.
5. **Not in this epic** cites the PRD's non-goals, or adds the epic's own as `NG-n`, numbered on
   from the PRD's and the brief's highest.

You should know what gets built, in what order and what to decide, without opening a ticket.

### The chain: `mirai trace`

Approving the set also runs `mirai trace <initiative>` (unit 43, [trace.md](trace.md)): every BR
of the brief cited by an FR or NFR, every PRD FR, NFR and AC covered by a ticket (`covers_fr`,
`covers_ac`), and every NFR saying how it's verified. A missing link refuses the approval, named
with where to fix it. Tess's run already ran it between her launches, so a set she hands over has
every link; `mirai show <initiative>` shows the result as the documents are now.

**How tests are named.** Each ticket AC is proved by a test whose name starts with its ID and a
colon: `AC-SAMPLE-53.2: a day is sent once` (`AC-SAMPLE-53.2, AC-SAMPLE-53.3: …` proves both). An
`e2e: true` ticket's end-to-end test also names its journey: `J-1, AC-SAMPLE-53.1: …`. The plan's
test list uses the same names. At ship time `mirai trace <ticket>` reads the gate's own results.

**IDs stay.** Approving a PRD, or a set again, compares each FR, NFR and AC (and each ticket key
and its own ACs) with the version you approved last: an ID that comes back with another meaning is
refused (`id-stability`). Give a new requirement a new ID.

### What is generated

The last four sections restate the tickets, so MIRAI writes them, never the author:

| Section | What it holds |
|---|---|
| Tickets | a table: key (linked), title, size, risk, `after`, the FRs and ACs it covers, its ADRs |
| Dependencies | a Mermaid diagram of `after` |
| Coverage | every FR, NFR and AC of the PRD (on `full`, those its own tickets cover), with its group (Failures, Unchanged behaviour …) and the tickets that cover it |
| Design decisions | every ADR the tickets name in `governed_by`, linked, or "None" |

Each sits between two markers. The lint fails when one doesn't match the ticket files and the
PRD: a hand edit inside it, or a ticket changed since it was rendered. The fix is always the
same:

```bash
mirai epic render docs/mirai/<initiative>/epic-<slug>.md
```

It reads every ticket in `tickets/` whose `epic` names the epic, and the PRD, and rewrites only
those four sections. Its last line is the epic's full path, so you can open it with one click.
It writes the repo's docs only, so `/mirai epic render <file>` in your session has it too.

### The graph lint

The lint checks the set is complete and can be built. Each message names the ticket and the fix.
An `after` may name another epic's ticket: this one waits until it's done. How long an `after`
chain is isn't checked: stacking (at most 2 levels, inside one epic; design/01 §6) is a limit the
scheduler keeps at run time, and a ticket deeper in a chain waits until its parents are merged.

| Fails | Warns |
|---|---|
| a cycle in `after`, checked over every epic's tickets in `tickets/` | two tickets list the same file in `files_likely`, with no `after` between them |
| an `after` naming a ticket that doesn't exist | 16 tickets or more |
| a PRD FR, NFR or AC no ticket covers (Failures and Unchanged behaviour included) | |
| a ticket covering an ID the PRD doesn't define | |
| a size other than S, M or L | |
| more tickets, or more L tickets, than the caps | |
| a ticket with no AC or no `verify` line | |
| a generated section that doesn't match | |
| a "Decisions for you" item missing | |

### The caps

| Key | Default | Lint |
|---|---|---|
| `epic_tickets` | 20 | warns at 16, fails above 20 |
| `epic_l_tickets` | 5 | fails above 5 |
| `epic_summary_words` | 400 | fails above |
| `epic_summary_warn_words` | 300 | warns at or above |

Sizes stay S, M and L. There is no exception route: on `standard`, a set over a cap means
splitting the PRD or moving to `full`, never merging, shrinking or dropping tickets to fit. A
project can change the caps in `.mirai/config.toml`, never in a personal file, each within a
range:

```toml
[docs.limits]
epic_tickets = 20              # 2–50
epic_l_tickets = 5             # 0–20
epic_summary_words = 400       # 100–2,000
epic_summary_warn_words = 300  # 100–2,000
```

### Approving the set

```bash
mirai approve <epic-id> --file docs/mirai/<initiative>/epic-<slug>.md
```

MIRAI lints the epic with its PRD and every ticket, the graph included, and each ticket on its
own, all as at approval. A problem in any of them refuses the set, and nothing is written. The
PRD must be approved as it is now, and the epic's summary needs a reader-test result. MIRAI prints the epic's path and hash, and each ticket's path
and hash. You decide once, and one signed approval covers the epic's bytes and every ticket
file's bytes. A later change to any of them, or a ticket joining the epic, needs a new approval.

`mirai show <initiative>` lists the epic with the brief and the PRD, with its state, its ticket
count and its full path:

```
due-dates   standard
  brief.md            brief              due-dates-brief   approved                 /Users/…/docs/mirai/due-dates/brief.md
  epic-due-dates.md   epic (7 tickets)   SAMPLE-50         not approved             /Users/…/docs/mirai/due-dates/epic-due-dates.md
  prd.md              prd                due-dates-prd     approved                 /Users/…/docs/mirai/due-dates/prd.md
```

The inbox screen for the set and the docs MR merge come with units 45 and 38.
