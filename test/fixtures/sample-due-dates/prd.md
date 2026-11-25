---
id: own-due-dates-prd
type: prd
template: prd@v1
track: standard
variant: lite
owner: mirai-product-manager
created: "2026-11-25"
upstream: [own-due-dates-brief]
---
# Due dates on my own tasks

Brief: [Due dates on my own tasks](brief.md)

## Summary for approval

### The ask

Approve the due-dates brief and this PRD, so that 70% of dated tasks are done by their date (SM-1).

### Why

People keep dates in their heads or in a calendar beside the app. They asked for one place (see the brief).

### What changes

Once this is built:

- A person can set, change or remove the due date of each of their own tasks (FR-1).
- The list shows each task's date, and marks a late task as late (FR-2, FR-3).
- A date in the past is refused with a message saying why (FR-4).
- Tasks without a date look and sort exactly as they do today (FR-5).

### Decisions for you

None — the interview settled what late means and what the list shows (A-1).

### Not in this

These are left out, from the brief and from this PRD:

- Reminders: the app sends no message of any kind (NG-1).
- Repeating tasks: they need their own rules (NG-2).
- A new sort order for the list: the owner asked to keep today's order (NG-3).
- A page of late tasks: the mark on the list is enough (NG-4).

## User journeys

The journeys this feature changes:

- UJ-1: A person adds a task with a due date, then sees on the list which of their tasks are late.

## Functional requirements

### Capabilities

- FR-1: A task's owner can set, change or remove its due date. (BR-1)
  - AC-FR-1.1: Given a task with no due date, when its owner sets 2027-01-15, then the task shows "Due 15 Jan 2027".
  - AC-FR-1.2: Given a task due 2027-01-15, when its owner removes the date, then the task shows no due date.
- FR-2: A task's owner can see each task's due date beside its title in the list. (BR-2)
  - AC-FR-2.1: Given a task due 2027-01-15, when its owner opens the list, then it shows "Due 15 Jan 2027".

### Triggers and states

- FR-3: While a task is past its due date and not done, the list must mark it as late. (BR-2) (A-1)
  - AC-FR-3.1: Given an open task due 2027-01-15, when its owner opens the list on 2027-01-16, then it is marked late.
  - AC-FR-3.2: Given that task is then marked done, when the list is opened again, then it is no longer marked late.

### Failures

- FR-4: If a due date before today is entered, then the system must refuse it with a message saying why. (BR-1)
  - AC-FR-4.1: Given today is 2027-01-14, when the owner enters 2027-01-13, then it is refused: "Due dates can't be in the past."

### Unchanged behaviour

- FR-5: Where a task has no due date, the list must show and sort it exactly as it does today. (BR-1)
  - AC-FR-5.1: Given tasks with no due date, when the list opens after this change, then their order is unchanged.

## Non-functional requirements

The qualities this feature must keep:

- NFR-1: A task's due date must be seen only by its owner, as the task itself is today.
  - AC-NFR-1.1: Given Ana's task is due 2027-01-15, when Ben opens his list, then he sees neither task nor date.

## Non-goals

Besides the brief's no-gos (NG-1, NG-2, NG-3):

- NG-4: A page of late tasks. One person's list is short, and the mark on the list is enough.

## Assumptions

- A-1: A task is late from the day after its due date, in the owner's own time zone. If it is late on the due date itself, FR-3 changes.

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

- Due date: the calendar day a task should be done by, in its owner's own time zone.
- Late: past its due date and not done.
- Owner: the person who added the task; only they see, change or finish it.
- Done: the done mark the app has today. A task marked not done again counts as not done.
- Exists today: tasks, their owners, their titles and the done mark. New: due dates and the late mark.
