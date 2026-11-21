# Wording a ticket

A ticket (a story or a bug) is one slice an agent plans and builds without asking. It has no
summary: its reader is the agent, and the epic's summary covers the set for the owner. Its form
is in the templates you're given, or `mirai show template story` and `mirai show template bug`, with
their checklists, `mirai show checklist story` and `mirai show checklist bug`. The `mirai-docs` skill
explains both. This guide covers the wording.

## Rules

- **Given is the state before. When is one event. Then is what someone can observe.** No user
  action in Given; no second action in When; no internal detail in Then.
- **A criterion states behaviour, not the test.** How it is measured (a load test, a performance
  run) goes in `verify`. The criterion says what must be true, with its number.
- **One event per criterion.** "When they open, search or request anything" is three criteria and
  an open end. Name each route.
- **Exact values from the PRD.** The message, the limit and the role are copied from the PRD's
  requirement, not described.
- **No hedges.** "If any" and "where possible" hand the builder a question. The ticket answers
  it, or names it as an assumption with what changes if it's wrong.
- **The title says what someone can do after the ticket ships.**

## Examples

Each example quotes a real agent draft as it was, then a fixed version, and the rule it teaches.

### Example 1: the number, not the test

**Rule:** a criterion states the behaviour and its number. "Fast" with no number fails the lint,
and a Given that describes the test belongs in `verify`.

**Before**, from `implementation/units/33-epic/p2/tickets/TC-8.md`, "Acceptance criteria" (the detail):

```markdown
- AC-TC-8.1: A new comment appears fast
  - Given 100 comment submissions in a load test
  - When each comment is submitted
  - Then 95% of them appear to their author within 2 seconds
```

**After:**

```markdown
- AC-TC-8.1: A new comment shows within 2 seconds
  - Given a person is on a task's page
  - When they submit a comment
  - Then it shows in the task's comments within 2 seconds, for 95% of submissions
```

The load test stays in the ticket's `verify` line, where it already is.

**Checked by:** the lint, `writing-vague`.

### Example 2: one event per criterion

**Rule:** a When holds one event. Several routes, or "anything", become one criterion per route,
each with what the person sees.

**Before**, from `implementation/units/33-epic/p2/tickets/TC-3.md`, "Acceptance criteria" (the detail):

```markdown
- AC-TC-3.3: Losing access hides the comments
  - Given a person who could see a task and then loses access to it
  - When they open, search or request anything that would show its comments
  - Then none of its comments is shown
```

**After:**

```markdown
- AC-TC-3.3: Losing access hides the comments on the task's page
  - Given a person lost access to a task they could see
  - When they open the task's link
  - Then they get the same refusal as today, with no comment text
- AC-TC-3.6: Losing access hides the comments from search
  - Given a person lost access to a task they could see
  - When they search for words from one of its comments
  - Then the results show none of its comments
```

**Checked by:** judgement.

### Example 3: no hedge about what exists

**Rule:** a boundary says what must not change. "If any" leaves the builder to find out what the
ticket should have stated; write the sentence so it holds either way, or state the fact.

**Before**, from `implementation/units/33-epic/p2/tickets/TC-4.md`, "Boundaries" (the detail):

```markdown
Notifications the app sends today, if any, must not change. Saving and showing a comment, as in TC-2, must not wait on or depend on a notification.
```

**After:**

```markdown
Every notification the app already sends must keep working as it does today. Saving and showing a comment, as in TC-2, must not wait for a notification.
```

**Checked by:** judgement.
