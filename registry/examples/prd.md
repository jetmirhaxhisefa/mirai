---
id: due-dates-prd
type: prd
template: prd@v1
track: standard
variant: lite
owner: mirai-product-manager
created: "2026-11-20"
upstream: [due-dates-brief]
---
# Tasks with due dates that people finish on time

Brief: [Tasks with due dates that people finish on time](brief.md)

## Summary for approval

### The ask

Approve the due-dates brief and this PRD, so that 70% of dated tasks are done by their date (SM-1).

### Why

Team leads keep deadlines in a spreadsheet beside the task app. Last month 4 of 6 missed one (see the brief). Quarterly planning starts in January 2027, when leads set the next deadlines.

### What changes

Once this is built:

- A task's creator can give it a due date, and overdue tasks are marked in the list (FR-1, FR-5).
- An assignee gets one email the day before a task is due, listing all of that day's tasks (FR-4).
- A team lead sees every overdue task of the team on one page (FR-2).
- A date in the past is refused, and a failed email is retried once (FR-6, FR-7).
- Tasks without a date look and sort exactly as they do today (FR-9).

### Decisions for you

1. How should reminders reach people (Q-1)? Options: email only, or email and an in-app notice. Recommendation: email only, because the app has no notification system yet; an in-app notice would double the work. This PRD is written for email only (A-1).

### Not in this

These are left out, from the brief and from this PRD:

- Recurring tasks: they need their own rules (NG-1).
- Reminders by text message: the app holds no phone numbers (NG-2).
- A new sort order for the task list: leads asked to keep today's order (NG-3).
- Reminders for tasks with no assignee: nobody would receive them (NG-4).

## User journeys

The journeys this feature changes:

- UJ-1: On Monday morning a team lead dates the week's new tasks, then checks which of the team's tasks are overdue.
- UJ-2: A team member reads the reminder email in the evening, then finishes or moves the tasks due next day.

## Functional requirements

### Capabilities

- FR-1: A task's creator can set, change or remove the due date of a task. (BR-1)
  - AC-FR-1.1: Given a task with no due date, when its creator sets 2027-01-15, then the task shows "Due 15 Jan 2027".
  - AC-FR-1.2: Given a task due 2027-01-15, when its creator removes the date, then the task shows no due date.
- FR-2: A team lead can see all of the team's overdue tasks on one page, the most overdue first. (BR-3)
  - AC-FR-2.1: Given tasks 1, 5 and 2 days overdue, when the lead opens the page, then they show 5, 2, 1.
  - AC-FR-2.2: Given a team with no overdue task, when the lead opens the overdue page, then it says "Nothing is overdue".
- FR-3: An assignee can turn reminder emails off, and on again, for themselves. (BR-2)
  - AC-FR-3.1: Given Ana has turned reminders off, when a task of hers is due tomorrow, then she gets no email.

### Triggers and states

- FR-4: When a day ends, the system must send each assignee one email listing their tasks due the next day. (BR-2)
  - AC-FR-4.1: Given Ana has two tasks due 2027-01-15, when 2027-01-14 ends, then Ana gets one email naming both.
  - AC-FR-4.2: Given the reminders for 2027-01-14 were sent, when the job runs again that day, then no second email is sent.
- FR-5: While a task is past its due date and not done, the task list must mark it as overdue. (BR-1)
  - AC-FR-5.1: Given an open task due 2027-01-15, when anyone opens the list on 2027-01-16, then the task is marked overdue.
  - AC-FR-5.2: Given that task is then marked done, when the list is opened again, then it is no longer marked overdue.

### Failures

- FR-6: If a due date before today is entered, then the system must refuse it with a message saying why. (BR-1)
  - AC-FR-6.1: Given today is 2027-01-14, when a creator enters 2027-01-13, then it is refused: "Due dates can't be in the past."
- FR-7: If a reminder email fails to send, then the system must retry once an hour later and record the failure. (BR-2)
  - AC-FR-7.1: Given the mail service refuses a reminder, when an hour passes, then it is sent again and the failure logged.
- FR-8: If a task's assignee leaves the team, then the system must stop sending reminders for that task. (BR-2)
  - AC-FR-8.1: Given Ana leaves the team, when a task still assigned to her is due tomorrow, then no reminder is sent.

### Unchanged behaviour

- FR-9: Where a task has no due date, the task list must show and sort it exactly as it does today. (BR-1)
  - AC-FR-9.1: Given tasks with no due date, when the list opens after this change, then their order is unchanged.

## Non-functional requirements

The qualities this feature must keep:

- NFR-1: The overdue page must show within 2 seconds for a team with 500 open tasks.
  - Verified by: a measurement on the test data set of 500 open tasks, in the browser.
- NFR-2: A reminder email must show only the task's title and due date, never its description.
  - AC-NFR-2.1: Given a task description holding a salary, when its reminder is sent, then the email shows only title and date.

## Non-goals

Besides the brief's no-gos (NG-1, NG-2, NG-3):

- NG-4: Reminders for tasks with no assignee. Nobody would receive them, and the lead sees those tasks on the overdue page.

## Assumptions

- A-1: Reminders go by email only, the recommendation for the brief's Q-1. If the approver chooses an in-app notice too, FR-4 and FR-7 change and a notification FR is added.
- A-2: Every team member has a working email address in the app. If not, FR-7 records the failure.

## Open questions

## Glossary

### ID prefixes

| Prefix | Means | Example |
|---|---|---|
| BR | Business requirement, from the brief: an outcome the business needs | BR-2: people are reminded before a task is due |
| SM | Success metric, from the brief | SM-1: share of dated tasks done on time |
| UJ | User journey: a path a person takes through the product | UJ-1: a lead plans the week's deadlines |
| FR | Functional requirement: what the product does | FR-4: send a reminder the day before |
| NFR | Non-functional requirement: a quality such as speed or privacy | NFR-1: the overdue page shows in 2 seconds |
| AC | Acceptance criterion: a check that proves one requirement | AC-FR-4.1: Ana gets one email on the 14th |
| NG | Non-goal: something left out on purpose | NG-1: recurring tasks |
| R | Risk or hard part | R-1: time zones |
| DEP | Dependency on another team, system or piece of work | DEP-1: the mail service's daily limit |
| PH | Rollout phase | PH-1: one team first |
| A | Assumption: taken as true without proof | A-1: every assignee has an email address |
| Q | Open question | Q-1: email only, or an in-app notice too? |

### Terms

- Due date: the calendar day a task should be done by, in the team's time zone (the brief's R-1).
- Overdue: past its due date and not done.
- Assignee: the one person a task is assigned to.
- Team lead: the person who assigns a team's tasks and answers for its deadlines.
- Day ends: midnight in the team's own time zone.
