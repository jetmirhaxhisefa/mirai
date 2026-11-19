---
id: task-comments-prd
type: prd
template: prd@v1
track: standard
variant: lite
owner: mirai-product-manager
created: "2026-11-20"
upstream: [task-comments-brief]
---
# Comments on tasks, with notices to the people responsible

Brief: [Keep the reasons behind a task with the task](brief.md)

## Summary for approval

### The ask

Approve the brief and this PRD for task comments with in-app notices, so that 60% of task changes carry a written reason (SM-1).

### Why

Team leads and their 3 to 10 team members discuss tasks in chat, so the reasons get buried (see the brief, SM-1, SM-2).

### What changes

- Anyone who can see an open or done task can add a text comment and read all comments (FR-1, FR-2)
- The owner and assignee get an in-app notice per comment (FR-3, FR-7)
- Comments are permanent and appear for others on reload, not live (FR-8, FR-9)
- The app records task changes and gives team leads the SM-1 figure (FR-5, FR-6)
- Bad input, failed saves, lost access and failed notices lose no text and leak nothing (FR-10 to FR-15)
- Access rules, task changes and search stay as today; no change needs a comment (FR-16 to FR-18)

### Decisions for you

1. Who is told about a new comment (Q-1)? Options: owner and assignee only, or everyone who has commented. Recommendation: owner and assignee only; a past commenter may miss a reply. Assumed in A-1.
2. Can people edit or delete comments (Q-2)? Options: allowed, or permanent. Recommendation: permanent; a typo cannot be fixed. Assumed in A-2.

### Not in this

- Replacing or linking the chat tool, because it serves other needs (NG-1)
- File attachments, because text covers the need (NG-2)
- Comments by people outside the team, because the problem is internal (NG-3)
- Importing chat history, because it is costly and hard to match (NG-4)
- Email or push notices, because in-app notices cover the need (NG-5)
- Searching comment text, because the brief does not ask for it (NG-6)
- Forcing a reason on every task change, because it slows people down (NG-7)

## User journeys

- UJ-1: Ana, an owner, reassigns a task to Ben and comments why; Ben gets a notice.
- UJ-2: Cy, a new team member, reads a done task's comments to learn why it was done that way.
- UJ-3: Dee, an assignee, reads Ana's new comment from the notice area and marks it read.
- UJ-4: Eli, a team lead, picks a date range and sees how many changed tasks carry a reason.

## Functional requirements

### Capabilities

- FR-1: A viewer can add a text comment of 1 to 2,000 characters to an open or done task. (BR-1) (A-3) (A-4)
  - AC-FR-1.1: Given an open task, when Ana submits "Moved to Friday", then it appears last with her name and time.
  - AC-FR-1.2: Given a done task, when Ana comments, then it is saved.
  - AC-FR-1.3: Given exactly 2,000 characters, when Ana submits, then all are saved.
- FR-2: A viewer can read every comment on a task, oldest first, each with its author, time and text. (BR-2)
  - AC-FR-2.1: Given 3 comments, when Cy, who got access today, opens the task, then he sees all 3, oldest first.
  - AC-FR-2.2: Given two comments saved in the same second, when a viewer opens the task, then the one received first is first.
- FR-3: A viewer can open the notice area from any page, read their notices newest first, and mark one read. (BR-3) (A-8)
  - AC-FR-3.1: Given Dee has 2 notices, when she opens the notice area, then she sees both, newest first, with author, task title and time.
  - AC-FR-3.2: Given Dee has a notice, when she selects it, then the task page opens at that comment.
- FR-4: A viewer can see the count of their unread notices in the notice area. (BR-3)
  - AC-FR-4.1: Given Dee has 2 unread notices, when she marks one read, then the count shows 1.
- FR-5: A team lead can pick a date range and see the changed tasks they can see, and how many have a reason. (BR-2) (A-9)
  - AC-FR-5.1: Given 4 changed tasks in range, 3 with a comment within 24 hours, when Eli picks it, then he sees 4, 3 and 75%.
  - AC-FR-5.2: Given no changed tasks in range, when Eli picks it, then he sees "No task changes" and no percentage.

### Triggers and states

- FR-6: When a task change happens, the system must record its kind, the person and the time. (BR-2) (A-5)
  - AC-FR-6.1: Given Ana moves a due date, when she saves, then the record holds "due date", her name and the time.
- FR-7: When a comment is saved, the system must create one notice each for the owner and the assignee, except the author. (BR-3) (A-1)
  - AC-FR-7.1: Given owner Ana and assignee Ben, when Cy comments, then each gets one notice.
  - AC-FR-7.2: Given Ana is owner and assignee, when Cy comments, then she gets one notice.
  - AC-FR-7.3: Given Ana is owner, with no assignee, when she comments, then no notice is created.
- FR-8: While a comment exists, the system must keep its text, author and time unchanged and offer no edit or delete. (BR-2) (A-2)
  - AC-FR-8.1: Given a saved comment, when its author views it, then no edit or delete action shows.
- FR-9: When a comment is saved, the system must show it to other viewers on their next reload. (BR-1) (A-7)
  - AC-FR-9.1: Given Ben has the task open, when Cy comments, then Ben sees it only after reloading.
  - AC-FR-9.2: Given Ben has any page open, when Cy comments, then Ben's notice shows after reloading.
- FR-10: While a person is not a viewer of a task, the system must hide its comments and notices from them. (BR-4)
  - AC-FR-10.1: Given Dee lost access to a task, when she reloads, then its notices are gone from her notice area.
  - AC-FR-10.2: Given Dee lost access, when she opens a link to the task, then she sees the usual no-access message.
  - AC-FR-10.3: Given Dee commented and then lost access, when a viewer opens the task, then her comment is still shown.

### Failures

- FR-11: If a comment is empty, only spaces, or over 2,000 characters, then the system must reject it and say why. (BR-1) (A-4)
  - AC-FR-11.1: Given 2,001 characters, when Ana submits, then nothing is saved and the message states the 2,000 limit.
  - AC-FR-11.2: Given a comment of only spaces, when Ana submits it, then nothing is saved and the message says a comment cannot be empty.
- FR-12: If saving a comment fails, then the system must keep the typed text, say it was not saved, and create no notice. (BR-1)
  - AC-FR-12.1: Given the save fails, when Ana submits, then her text stays, the message says "Not saved", and no notice exists.
- FR-13: If the author loses access, or the task is archived, before the save, then the system must reject the comment and say why. (BR-4) (A-3)
  - AC-FR-13.1: Given Eli archives the task while Ana types, when she submits, then nothing is saved and the message says it is archived.
  - AC-FR-13.2: Given Dee loses access while typing, when she submits, then nothing is saved and the message says she has no access.
- FR-14: If two people submit comments at the same time, then the system must save both, in the order received. (BR-1)
  - AC-FR-14.1: Given Ana and Ben submit together, when a viewer reloads, then both comments show.
- FR-15: If a notice cannot be created, then the system must still save the comment and record the failure. (BR-3)
  - AC-FR-15.1: Given notice creation fails, when Cy comments, then his comment shows on the task and the failure is recorded.

### Unchanged behaviour

- FR-16: Where a person changes a task's owner, scope or due date, the product must accept the change without a comment, as today. (BR-1)
  - AC-FR-16.1: Given Ana changes a due date, when she saves without a comment, then it is saved.
- FR-17: Where a person can or cannot see a task today, the product must give the same answer after release. (BR-4)
  - AC-FR-17.1: Given Fay cannot see a task today, when she opens it after release, then she sees nothing of it.
- FR-18: Where tasks are shown or searched today, the product must give the same fields, order and results, without searching comment text. (BR-1)
  - AC-FR-18.1: Given a word only in a comment, when Ana searches it, then no task is found.

## Non-functional requirements

- NFR-1: A task page with 200 comments must show them all in 2 seconds or less at the 95th percentile.
  - Verified by: a staging load test, 10 viewers at once, timed from page request to the last comment shown.
- NFR-2: Comments and notices must reach 0 people who are not viewers of the task.
  - Verified by: AC-NFR-2.1.
  - AC-NFR-2.1: Given Fay is not a viewer, when she uses every page, then no comment or notice of that task is shown.
- NFR-3: Adding and reading comments and using the notice area must work by keyboard alone.
  - Verified by: a manual check of those actions by keyboard only, in current desktop browsers.

## Non-goals

Besides the brief's no-gos (NG-1):

- NG-5: Email or push notices. In-app notices cover the need.
- NG-6: Searching comment text. The brief asks only to read reasons on the task.
- NG-7: Requiring a comment on a task change. It would slow people down.

## Assumptions

- A-1: Q-1 is answered "owner and assignee only". If it is everyone who commented, FR-7 grows.
- A-2: Q-2 is answered "permanent". If edit or delete is allowed, FR-8 is replaced.
- A-3: A task is open, done or archived, never deleted. If tasks can be deleted, comments need a rule.
- A-4: A limit of 2,000 characters, counted after trimming spaces at both ends, is enough. If not, FR-1 and FR-11 change.
- A-5: The app records no task changes today. If it does, FR-6 shrinks.
- A-6: The app records when a task is done, for SM-1's counter-metric. If not, a new FR is needed.
- A-7: Pages refresh only on reload today. If live updates exist, FR-9 changes.
- A-8: The app has no notice area today. If one exists, FR-3 reuses it.
- A-9: Times show as "2026-11-20 14:05" in the viewer's time zone, or in Coordinated Universal Time (UTC) if unset. FR-5 uses whole UTC days. If local days are wanted, FR-5 changes.
- A-10: SM-2 is a survey outside the app, so no FR serves it. If not, a new FR is needed.

## Open questions

None — the brief's Q-1 and Q-2 sit under "Decisions for you", and this PRD raises no other.

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

- Task: a unit of work with an owner, a description, a due date and a state. Exists today, with its task page.
- Owner: the one person responsible for a task. Exists today.
- Assignee: the person a task is assigned to, at most one. Exists today.
- Team member: a person in the team who uses the task app. Exists today.
- Team lead: a team member who owns tasks assigned to others; not a separate role.
- Viewer: a person who can see a task under today's access rules.
- Open task, done task, archived task: the task states; comments are allowed in the first two. Exist today.
- Task change: a change to a task's owner, scope (its description) or due date. Exists today.
- Changed task: a task with a task change in the chosen date range.
- Reason: a comment on a changed task saved within 24 hours after its task change.
- Comment: a plain-text message on a task. Its author is the viewer who wrote it. New.
- Notice: an in-app message about a new comment, read or unread. New.
- Notice area: the new place, reachable from every page, where notices are read. New.
