# MIRAI's documents: two readers, one file

Unit 31 (PM-03; `research/13-document-writing.md`). Every document you approve has two layers in
one file:

- **The summary for approval** is for you: what is asked, why, what changes, what you must decide,
  and what is left out. It's one page, and you can approve from it alone.
- **The detail** is for the agents. It must be complete enough that the next step needs no
  guessing.

Briefs have it from unit 31, PRDs from unit 32. Epics, HLDs, LLDs and ADRs get it as their units come.
Tickets and plans don't: they're short already, and their gates are different.

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
- **Keep to the word budget:** brief 400, PRD 600 (a full PRD 1,000), HLD 600, LLD 500, ADR 250, epic 250. A project can change the brief and PRD budgets (see "The caps" below).

## The writing rules

The lint checks these. A failing document goes back to its author with the sentence quoted and
the fix named.

| Rule | Where | Fails | Warns |
|---|---|---|---|
| The word budget | summary | over the type's budget | at 80% of it |
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

Code spans, code blocks and tables are never checked for writing. Unit 34 (`mirai-write`) adds a
reader test and before-and-after examples on top of these rules.

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

It refuses a brief that fails the lint, or still has an open question. Your answer is signed on
the file's exact bytes, so a brief changed after its approval needs a new approval.

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
nothing is written.

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
