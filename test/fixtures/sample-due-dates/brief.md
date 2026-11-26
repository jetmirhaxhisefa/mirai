---
id: own-due-dates-brief
type: brief
template: brief@v1
track: standard
owner: mirai-product-manager
created: "2026-11-25"
upstream: []
---
# Due dates on my own tasks

Interview: [Interview: due dates on my own tasks](interview.md)

## Summary for approval

### The ask

Approve due dates for each person's own tasks, so that 70% of dated tasks are done by their date (SM-1).

### Why

People keep their own task list in the app, but a task has no date. They keep dates in their heads or in a calendar beside it, and asked for one place (see Problem).

### What changes

Once this is built:

- A person can give each of their own tasks a due date, and change or remove it (BR-1).
- The list shows each task's date, and marks a late task as late (BR-2).
- Tasks without a date work as they do today, and the list keeps its order (BR-1).

### Decisions for you

None — the interview settled what late means and what the list shows (BR-2).

### Not in this

- Reminders: the app sends no message of any kind (NG-1).
- Repeating tasks: a separate need with its own rules (NG-2).
- A new sort order for the list: the owner asked to keep today's order (NG-3).

## Problem

People keep their own task list in the app, but a task has no due date. Dates live in their heads or in a calendar beside the app, so the list doesn't show what is late. The owner asked for the dates in one place (interview.md, the request).

## Who it is for

People who sign in to keep their own task list in the app. Each person sees only their own tasks.

## Why now

People asked for dates in the app itself. The owner wants them before the app looks for its first 100 weekly users. Source: the interview.

## Success

We'll know it works when:

| ID | Metric | Baseline | Target | How measured | Counter-metric |
|---|---|---|---|---|---|
| SM-1 | Share of dated tasks done by their due date | UNKNOWN | 70% | The app's task data, monthly | Share of dated tasks whose date is removed rises above 30% |
| SM-2 | Share of new tasks that carry a due date | 0% | 40% | The app's task data, a month after release | Tasks added with a date in the past are refused more than 5% of the time |

## Business requirements

The business needs these outcomes:

- BR-1: Each of a person's own tasks can carry a due date, which they can change or remove. Source: the interview.
- BR-2: A person sees at a glance which of their tasks are late. Source: the interview.

## Appetite and track

Appetite: one week of build time; past that, the calendar beside the app is good enough. Track: standard, because this changes one app and needs no new service.

## No-gos

These are left out on purpose:

- NG-1: Reminders. The app sends no message of any kind, and a reminder would need one.
- NG-2: Repeating tasks. They need their own rules for what done means.
- NG-3: A new sort order for the list. The owner asked to keep today's order.

## Rabbit holes

These are the hard parts:

- R-1: Time zones. A person's day ends at different moments around the world. A task is late from the day after its due date, in the person's own time zone.

## Hard questions

Not applicable — one person's own list, with no sharing and no money.

## Sources

The evidence above comes from:

- The interview: interview.md beside this brief.

## Open questions
