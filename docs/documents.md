# MIRAI's documents: two readers, one file

Unit 31 (PM-03; `research/13-document-writing.md`). Every document you approve has two layers in
one file:

- **The summary for approval** is for you: what is asked, why, what changes, what you must decide,
  and what is left out. It's one page, and you can approve from it alone.
- **The detail** is for the agents. It must be complete enough that the next step needs no
  guessing.

Briefs have it from unit 31. PRDs, epics, HLDs, LLDs and ADRs get it as their units come.
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
- **Keep to the word budget:** brief 400, PRD 600, HLD 600, LLD 500, ADR 250, epic 250.

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
