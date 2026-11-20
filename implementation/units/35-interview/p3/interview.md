---
id: overdue-reminders-interview
type: interview
template: interview@v1
state: paused
owner: mirai-product-manager
created: "2026-11-20"
---
# Interview: reminders for overdue tasks

## Questions

Request: "Add reminders for overdue tasks." (the owner, 2026-11-20)

First guess: the person a task is assigned to gets a reminder once the task is past its due date. Confidence: about 25%. Still open: who it's for, who gets reminded, how often and through what channel, how success is measured, the limits, and what is left out.

Read before asking: the folder holds only the MIRAI framework files and the brief template. It has no task app code, no research and no `business.md`, so the facts about the app (whether tasks have due dates, whether it can send email) could not be looked up. Nothing was assumed. This run had no owner to ask, so every question below is open and blocks the brief.

### Q-1: Who it's for

Confidence: about 25%. Still open: who it's for, who gets reminded, how often and through what channel, how success is measured, the limits, and what is left out.

Who should this work for first?

- A: the person a task is assigned to, who needs to know what they are late on
- B: team leads, who answer for the team's deadlines
- C: both, with one of them first

Guess: A, because a reminder is aimed at the person who can act on the task, and leads can be covered by Q-3.

Answer:

### Q-2: Why now

Confidence: about 30%. Still open: why now, who gets reminded, how often and through what channel, how success is measured, the limits, and what is left out.

What is the problem today that makes this worth doing now?

- A: tasks go overdue and nobody notices until someone asks
- B: people notice, but leads spend their time chasing them
- C: something else (reply with a note)

Guess: B, because "reminders" usually replace someone chasing by hand.

Answer:

### Q-3: Who gets reminded

Confidence: about 40%. Still open: who gets reminded, how often and through what channel, how success is measured, the limits, and what is left out.

Who receives the reminder for an overdue task?

- A: only the person the task is assigned to
- B: the assignee, and the lead if it stays overdue for a set number of days
- C: the lead only, as a list of what is late on the team

Guess: B, because the assignee can fix it, and the lead needs to hear only when it did not help.

Answer:

### Q-4: How often

Confidence: about 45%. Still open: how often and through what channel, how success is measured, the limits, and what is left out.

How often should the same overdue task remind?

- A: once, on the first day it is overdue
- B: once a day until it is done, with a limit of one message a day per person for all their tasks
- C: at times each person chooses

Guess: B, because one message a day stops people ignoring it, and C needs settings nobody has asked for.

Answer:

### Q-5: How reminders reach people

Confidence: about 55%. Still open: how reminders reach people, how success is measured, the limits, and what is left out.

Through what channel should reminders arrive?

- A: email only
- B: a notice in the app only
- C: email and a notice in the app

Guess: A, because email works without the person opening the app, and it is the smaller build. This needs the facts on what the app can send today; the owner may know them.

Answer:

### Q-6: How success is measured

Confidence: about 60%. Still open: how success is measured, the limits, and what is left out.

How will you know it works?

- A: fewer tasks stay overdue for more than 3 days
- B: leads stop chasing people by hand
- C: both, with A as the main measure

Guess: C, because A gives a number and B shows the old habit is gone. The number and the date to check it are the owner's choice.

Answer:

### Q-7: Time and limits

Confidence: about 70%. Still open: the time worth spending, and what is left out.

How much build time is this worth?

- A: two weeks
- B: six weeks
- C: as long as it takes

Guess: A, because a reminder on top of existing due dates is a small change if the app can already send messages.

Answer:

### Q-8: What is left out

Confidence: about 75%. Still open: what is left out.

Which of these stay out of the first version?

- A: reminders by text message, recurring tasks and per-person reminder settings
- B: only text messages
- C: none of them; build all three

Guess: A, because each of them needs its own design, and none was asked for.

Answer:
