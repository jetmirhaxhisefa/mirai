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
# Comments on tasks, so the reasons stay with the task

Brief: [Keep the reasons behind a task with the task](brief.md)

## Summary for approval

### The ask

Approve the task-comments brief and this PRD, so that 60% of task changes carry a written reason in the app (SM-1).

### Why

Team leads and their 3 to 10 team members discuss tasks in a chat tool. The reasons for a change get buried, and new members cannot find them. The brief holds the evidence, which is the team's own request and not measured data (see the brief, SM-1, SM-2).

### What changes

- A viewer can write a comment on a task. They can read every comment, oldest first, including older ones (FR-1, FR-2, FR-3, BR-1, BR-2)
- The owner and assignee get an in-app notification when someone else comments (FR-4, BR-3)
- Comments cannot be edited or deleted, so reasons stay trustworthy (FR-5, BR-2)
- Only viewers of a task can read or write its comments, and a person who loses access stops seeing them (FR-6, FR-12, BR-4)
- Empty or oversized comments are refused, and a failed save keeps the typed text (FR-8 to FR-10)
- A failed notification never loses the comment, and two simultaneous comments both stay (FR-11, FR-13)
- Tasks without comments, and today's access rules, look and work as before (FR-15, FR-16)

### Decisions for you

1. Who is notified of a new comment (Q-1)? Options: the owner and assignee only, or everyone who has commented. Recommendation: owner and assignee only; it costs the chance that an earlier commenter misses a reply.
2. Can people edit or delete their comments (Q-2)? Options: edit and delete allowed, or comments are permanent. Recommendation: permanent; it costs the ability to fix a typo.
3. How is a person notified (Q-3)? Options: an in-app notice only, or an in-app notice plus email. Recommendation: in-app only, because it fits the four-week appetite; it costs reaching people who do not open the app.

The requirements assume these recommendations (A-1, A-2, A-3).

### Not in this

- Replacing or linking the chat tool, because it serves other needs (NG-1)
- File attachments, because text covers the need (NG-2)
- Comments by people outside the team, because the problem is internal (NG-3)
- Importing old chat history, because it is costly and hard to match to tasks (NG-4)
- Formatting, mentions and reactions in comments, to keep to the appetite (NG-5)
- Searching across comments, because reading one task at a time meets the need (NG-6)

## User journeys

- UJ-1: A team lead reassigns a task, opens it, and writes the reason as a comment, so the reason stays with the task.
- UJ-2: A new team member opens an older task and reads its comments, oldest first, to learn why it was done that way.
- UJ-3: An assignee is told that someone commented on their task, opens the task and reads the comment.

## Functional requirements

### Capabilities

- FR-1: A viewer can write a comment on a task. (BR-1)
  - AC-FR-1.1: Given Ana can see task T, when she submits the text "Moved to May: vendor delay", then the text appears in T's comments.
- FR-2: A viewer can read all comments on a task, oldest first, including those written before they gained access. (BR-2)
  - AC-FR-2.1: Given T has 3 comments written before Ben joined and Ben can see T, when Ben opens T, then he sees all 3, oldest first.
- FR-3: A viewer can see who wrote each comment and when. (BR-2)
  - AC-FR-3.1: Given Ana commented on T at 10:05, when Ben opens T, then that comment shows Ana's name and 10:05.

### Triggers and states

- FR-4: When a viewer comments on a task, the system must send an in-app notification to the owner and the assignee, except the author. (BR-3) (A-1, A-3)
  - AC-FR-4.1: Given Ana owns T and Ben is the assignee, when Cy comments on T, then Ana and Ben each get one notification that names T.
  - AC-FR-4.2: Given Ana owns T and Ben is the assignee, when Ana comments on T, then only Ben is notified.
  - AC-FR-4.3: Given Dee commented on T earlier but is neither owner nor assignee, when Cy comments on T, then Dee gets no notification.
- FR-5: While a task exists, its comments must stay as written, with no edit or delete in the app. (BR-2) (A-2)
  - AC-FR-5.1: Given Ana wrote a comment on T, when she looks for a way to edit or delete it, then none is offered.
- FR-6: While a person cannot see a task, its comments must stay hidden from them. (BR-4)
  - AC-FR-6.1: Given Ben could see T and then loses access to it, when Ben searches the app for T's comments, then none is shown.
- FR-7: When a task is deleted, the system must delete its comments too. (BR-4) (A-4)
  - AC-FR-7.1: Given T has 2 comments, when T is deleted, then no one can read those comments.

### Failures

- FR-8: If a comment is empty or only spaces, then the system must refuse it and say why. (BR-1)
  - AC-FR-8.1: Given Ana can see T, when she submits only spaces, then no comment is added and a message says text is needed.
- FR-9: If a comment is over 2,000 characters, then the system must refuse it, say the limit and keep the typed text. (BR-1) (A-5)
  - AC-FR-9.1: Given Ana types 2,001 characters, when she submits, then no comment is added and the limit is shown. Her text is still in the box.
- FR-10: If saving a comment fails, then the system must tell the author and keep the typed text. (BR-1)
  - AC-FR-10.1: Given the comment store is unavailable, when Ana submits, then an error is shown and her text is still in the box.
- FR-11: If a notification cannot be delivered, then the system must still keep the comment. (BR-3)
  - AC-FR-11.1: Given notifications are unavailable, when Cy comments on T, then the comment appears in T's comments.
- FR-12: If a person who cannot see a task tries to read or write its comments, then the system must refuse and reveal nothing about them. (BR-4)
  - AC-FR-12.1: Given Eli cannot see T, when Eli requests T's comments, then access is refused and no comment text is returned.
  - AC-FR-12.2: Given Eli cannot see T, when Eli tries to submit a comment on T, then it is refused and nothing is saved.
- FR-13: If two viewers submit comments on a task at the same moment, then the system must keep both. (BR-1)
  - AC-FR-13.1: Given Ana and Ben submit on T within the same second, when T is reopened, then both comments are shown.
- FR-14: If the owner and the assignee are the same person or there is no assignee, then the system must notify each person at most once. (BR-3)
  - AC-FR-14.1: Given Ana is both owner and assignee of T, when Cy comments, then Ana gets exactly one notification.
  - AC-FR-14.2: Given T has an owner and no assignee, when Cy comments, then only the owner is notified.

### Unchanged behaviour

- FR-15: Where a task has no comments, the task must look and work as it does today. (BR-1)
  - AC-FR-15.1: Given a task with no comments, when a viewer opens it, then its fields and actions match today's, plus an empty comment area.
- FR-16: Where a person could see or not see a task today, the same rule must apply after release. (BR-4)
  - AC-FR-16.1: Given a task Eli cannot see today, when comments are released, then Eli still cannot see it.

## Non-functional requirements

- NFR-1: A new comment must appear to its author within 2 seconds, for 95% of submissions. (A-6)
  - Verified by: a load test of 100 submissions, reading the 95th percentile.
- NFR-2: A task's comment area must open within 2 seconds for a task with 200 comments, for 95% of opens. (A-6)
  - Verified by: a performance test on a task with 200 comments.
- NFR-3: Comments must be unreadable to 100% of people who cannot see the task.
  - Verified by: an integration test that requests comments as each role without access to a task.
- NFR-4: A person must be able to read, write and submit comments using the keyboard alone.
  - Verified by: a manual check with the keyboard only, on the comment area.

## Non-goals

Besides the brief's no-gos (NG-1 to NG-4):

- NG-5: Formatting, mentions and reactions in comments. Plain text meets the need and keeps to the appetite.
- NG-6: Searching across comments. Reading one task at a time meets the need.

## Assumptions

- A-1: Only the owner and assignee are notified (the recommendation for Q-1). If everyone who commented is to be told, FR-4 and its ACs change and alert volume rises.
- A-2: Comments are permanent (the recommendation for Q-2). If edit or delete is allowed, FR-5 is replaced and a way to keep the original text is needed.
- A-3: A notification is an in-app notice only (the recommendation for Q-3). If email is wanted, FR-4 and FR-11 grow and a mail dependency appears.
- A-4: Deleting a task deletes its comments. If they must be kept, FR-7 changes and the brief's BR-4 needs a rule for who may read them.
- A-5: 2,000 characters is enough for a written reason. If it is too low, FR-9 changes.
- A-6: 2 seconds for 95% of cases is acceptable to users. If not, NFR-1 and NFR-2 tighten.

## Open questions

The brief's Q-1 (blocks FR-4) and Q-2 (blocks FR-5) stay open there and are carried under "Decisions for you".

- Q-3: Is a notification an in-app notice only, or also email? The product owner answers; it blocks FR-4.

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

- Task: a unit of work in the app.
- Comment: a piece of plain text a viewer writes on a task.
- Viewer: a person who can see a task under the app's existing access rules.
- Author: the viewer who wrote a given comment.
- Owner: the person who owns a task.
- Assignee: the person the task is assigned to; a task may have none.
- Notification: an in-app notice telling a person that a comment was added to a task.
