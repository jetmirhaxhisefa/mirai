---
id: own-due-dates-interview
type: interview
template: interview@v2
state: confirmed
owner: mirai-product-manager
created: "2026-11-25"
---
# Interview: due dates on my own tasks

## Questions

Request: "Tasks need due dates: show when each of my tasks is due, and which ones are late." (the owner, 2026-11-25)

First guess: a person wants to date their own tasks and see the late ones at a glance. Confidence: about 40%. Still open: what late means, what changes in the list, and the limits.

Read before asking: the sample app's code (the task list, the task form and the task policy), and business.md. The app keeps one list per person, shows tasks in the order they were added, and sends no message of any kind.

### Q-1: What late means

Confidence: about 40%. Still open: what late means, what changes in the list, and the limits.

When is a task late?

- A: on the day after its due date, while it isn't done
- B: on its due date itself, while it isn't done
- C: never marked; the person reads the date

Guess: A, because a task due today can still be done today.

Answer: A.

### Q-2: What the list shows

Confidence: about 60%. Still open: what changes in the list, and the limits.

How does the list show it?

- A: each task shows its date, and a late task is marked late
- B: late tasks move to the top
- C: a separate page of late tasks

Guess: A, because the list keeps its order and the mark is enough for one person's list.

Answer: A. Keep the order as it is.

### Q-3: Time and limits

Confidence: about 80%. Still open: the time worth spending, and what is left out.

How much build time is this worth, and what stays out?

- A: one week; reminders, repeating tasks and a new sort order stay out
- B: two weeks, with reminders
- C: as long as it takes

Guess: A, because the app sends no message today, and a reminder would need one.

Answer: A.

## Restatement

- Outcome: a person can give each of their own tasks a due date, and sees at a glance which tasks are late.
- Who it's for: people who keep their own task list in the app.
- Why now: people keep dates in their heads or in a calendar beside the app, and asked for them in one place.
- Success: within a month, at least 40% of new tasks carry a due date, and 70% of dated tasks are done by their date.
- Limits: one week of build time, in the existing app, with no new service and no message of any kind.
- Not included: reminders, repeating tasks and a new sort order for the list.

Confirmed: yes (2026-11-25)
