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
| `brief` | the business case for a feature: the first document | `docs/mirai/<initiative>/brief.md` | "The business brief", below |
| `prd` | what the product must do, and how each requirement is checked | `docs/mirai/<initiative>/prd.md` | "The PRD", below |
| `epic` | a set of tickets, approved together | `docs/mirai/<initiative>/epic-<slug>.md` | "Epics and ticket sets", below |
| `story` | a ticket: one vertical slice of work | `docs/mirai/<initiative>/tickets/<key>.md` | "Epics and ticket sets", below; [agents.md](agents.md) for how it's built |
| `bug` | a ticket: what's wrong, how to reproduce it, and how the fix is proven | `docs/mirai/<initiative>/tickets/<key>.md` | [tdd.md](tdd.md) for its red test |
| `plan` | how one ticket will be built and proven, written by Kai | the store: `<store>/tickets/<ticket>/plan.md` | [agents.md](agents.md), "The plan step" |
| `business` | what the product does, for whom, its goals, rules and constraints, each claim with its source; approved as a whole | `.mirai/context/business.md` | [context.md](context.md) |
| `journeys` | the critical journeys `J-n`, each with its steps, why it's critical and its E2E test; approved as a whole | `.mirai/context/journeys.md` | [context.md](context.md) |
| `feature-map` | one row per screen: its name, route and test handles; not approved, the lint checks it against the code | `.mirai/context/feature-map.md` | [context.md](context.md) |
| `project` | one service's stack, commands, layout and test levels; not approved, the lint checks it against the code | `.mirai/context/project-<service>.md` | [context.md](context.md) |
| `conventions` | one service's rules, each `enforced by <check>` or `judgment`; approved as a whole | `.mirai/context/conventions-<service>.md` | [context.md](context.md) |

`docs/mirai` is the default `[docs] root` ([config.md](config.md)).

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
summary shows the kept result and costs no run. Two fixing rounds follow a failure; from the
workflow units on (35–36, 42, 45), the author agent gets the failed question back automatically.
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
