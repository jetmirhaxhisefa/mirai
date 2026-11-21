---
id: due-dates-interview
type: interview
template: interview@v1
state: confirmed
owner: mirai-product-manager
created: "2026-11-19"
---
# Interview: due dates on tasks

## Questions

Request: "Tasks need due dates." (the owner, 2026-11-19)

First guess: team leads want to see in the task app what is due and what is late. Confidence: about 30%. Still open: who it's for, how success is measured, and whether people get reminded.

Read before asking: the November 2026 lead interviews (`docs/research/2026-11-lead-interviews.md`), the task app's code, and `business.md`. Six leads were interviewed. All six keep deadlines in a spreadsheet, and four of them missed a deadline last month.

### Q-1: Who it's for

Confidence: about 30%. Still open: who it's for, how success is measured, and whether people get reminded.

Who should this work for first?

- A: team leads, who assign tasks and answer for the team's deadlines
- B: every team member equally
- C: the managers above the leads, for reporting

Guess: A, because the request comes from the lead interviews, and leads are the ones keeping the spreadsheet.

Answer: A. Team members come second: they want to know what's due without asking.

### Q-2: How success is measured

Confidence: about 50%. Still open: how success is measured, and whether people get reminded.

How will you know it works?

- A: more dated tasks are done by their date
- B: leads stop keeping a deadline spreadsheet
- C: both, with A as the main measure

Guess: C, because A shows the outcome and B shows the old workaround is gone.

Answer: C. Aim for 70% of dated tasks done on time. Check the spreadsheets with the six leads in March.

### Q-3: Reminders

Confidence: about 60%. Still open: whether people get reminded, and what the lead sees.

Should the app remind the person a task is assigned to?

- A: no reminder; overdue tasks are only marked in the list
- B: one reminder the day before the task is due
- C: reminders at times each person chooses

Guess: B, because leads said chasing people is the work they want gone, and C needs settings nobody asked for.

Answer: B. One reminder a day at most, with all of that person's tasks due the next day.

### Q-4: How reminders reach people

Confidence: about 70%. Still open: the reminder channel, what the lead sees, and the limits.

How should reminders reach people?

- A: email only
- B: email and a notice in the app
- C: leave it open in the brief, for the approver to decide

Guess: A, because the app has no notification system yet, and building one would double the work.

Answer: C. I want to see what the in-app notice costs before I choose.

### Q-5: What the lead sees

Confidence: about 75%. Still open: what the lead sees, and the limits.

How does a lead find the team's overdue tasks?

- A: each lead filters the task list by hand
- B: one place that shows every overdue task of the team
- C: a weekly email to the lead

Guess: B, because four leads said they check deadlines at the start of the day, in the app.

Answer: B.

### Q-6: Time and limits

Confidence: about 85%. Still open: the time worth spending, and what is left out.

How much build time is this worth?

- A: two weeks
- B: six weeks
- C: as long as it takes

Guess: A, because it changes one app and needs no new service.

Answer: A. Past two weeks, the spreadsheet is good enough.

### Q-7: What is left out

Confidence: about 90%. Still open: what is left out.

Which of these stay out?

- A: recurring tasks, reminders by text message, and a new sort order
- B: recurring tasks only
- C: none of them; build all three

Guess: A, because recurring tasks need their own rules, the app holds no phone numbers, and leads asked to keep today's order.

Answer: A.

## Restatement

- Outcome: a task can carry a due date, and people finish dated tasks by their date.
- Who it's for: team leads who assign tasks to 3 to 10 people; their team members come second.
- Why now: quarterly planning starts in January 2027, and leads want dates in one place by then.
- Success: 70% of dated tasks done by their date; by March 2027, at most 1 of the 6 leads still keeps a spreadsheet.
- Limits: two weeks of build time, in the task app only, with no new service. The reminder channel stays open for the approver.
- Not included: recurring tasks, reminders by text message, and a new sort order for the task list.

Confirmed: yes (2026-11-19)
