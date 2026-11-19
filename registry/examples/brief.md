---
id: due-dates-brief
type: brief
template: brief@v1
track: standard
owner: mirai-product-manager
created: "2026-11-19"
upstream: []
---
# Tasks with due dates that people finish on time

## Summary for approval

### The ask

Approve due dates and overdue reminders for tasks, so that 70% of dated tasks are done by their date (SM-1).

### Why

Team leads plan work in the task app, but a task has no date. They keep deadlines in a spreadsheet beside it. Last month, 4 of the 6 leads we asked missed a deadline because the two lists drifted apart. The quarterly planning cycle starts in January, so this is the time to have dates in one place.

### What changes

Once this is built:

- A task can have a due date, and the task list shows which tasks are overdue (BR-1).
- The person a task is assigned to gets one reminder the day before it's due (BR-2).
- A team lead sees all of the team's overdue tasks in one place (BR-3).
- Tasks without a date work as they do today (BR-1).

### Decisions for you

1. How should reminders reach people (Q-1)? Options: email only, or email and an in-app notice. Recommendation: email only, because the app has no notification system yet; an in-app notice would double the work.

### Not in this

- Recurring tasks: a separate need with its own rules (NG-1).
- Reminders by text message: the app holds no phone numbers (NG-2).
- Changing how tasks are sorted: leads asked to keep today's order (NG-3).

## Problem

Team leads plan work in the task app, but a task has no due date. Each lead keeps deadlines in a separate spreadsheet. In interviews in November 2026, 4 of the 6 leads said they missed a deadline last month. The spreadsheet and the app had drifted apart. The cost is late work and about 30 minutes a week per lead spent copying dates between the two.

## Who it is for

Team leads who assign tasks to 3 to 10 people and answer for the team's deadlines. They open the app at the start of the day to see what is due. Their team members are the second group: they want to know what is due without asking.

## Why now

Quarterly planning starts in January 2027. Leads will set the next quarter's deadlines then, and asked to do it in one place instead of two. Source: the November 2026 lead interviews.

## Success

We'll know it works when:

| ID | Metric | Baseline | Target | How measured | Counter-metric |
|---|---|---|---|---|---|
| SM-1 | Share of dated tasks done by their due date | UNKNOWN | 70% | The app's task data, monthly | Share of tasks with no date rises above 50% |
| SM-2 | Leads who still keep a deadline spreadsheet | 6 of 6 | 1 of 6 or fewer | Asking the 6 leads in March 2027 | Reminder emails marked as spam |

## Business requirements

The business needs these outcomes:

- BR-1: Every task can carry a due date, and people can see which tasks are overdue. Source: the November 2026 lead interviews.
- BR-2: The person a task is assigned to is reminded before it's due, without the lead having to chase them. Source: the November 2026 lead interviews.
- BR-3: A lead can see every overdue task of their team at once. Source: the November 2026 lead interviews.

## Appetite and track

Appetite: two weeks of build time; past that, the spreadsheet is good enough. Track: standard, because this changes one app and needs no new service.

## No-gos

These are left out on purpose:

- NG-1: Recurring tasks. They need their own rules for what "done" means, and no lead asked for them.
- NG-2: Reminders by text message. The app holds no phone numbers, and collecting them is a privacy question of its own.
- NG-3: A new sort order for the task list. Leads asked to keep today's order.

## Rabbit holes

These are the hard parts:

- R-1: Time zones. A team spread over time zones could see a task as overdue at different moments. The due date is a calendar day in the team's own time zone, set once per team.
- R-2: Many reminders at once. A lead who dates 50 tasks on one day could send 50 emails. One email per person per day lists all of that person's tasks due the next day.

## Hard questions

Not applicable — the app is used inside the company only.

## Sources

The evidence above comes from:

- The November 2026 lead interviews: notes in `docs/research/2026-11-lead-interviews.md`.

## Open questions

- Q-1: How should reminders reach people: email only, or email and an in-app notice? The approver answers; it blocks the PRD's notification requirements.
