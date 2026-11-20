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
# People discuss a task where the task lives

Brief: [Keep the reasons behind a task with the task](brief.md)

## Summary for approval

### The ask

Approve the brief and this PRD for task comments, so that 60% of task changes carry a written reason in the app (SM-1).

### Why

Team leads and their 3 to 10 team members discuss tasks in a chat tool, where the reasons for changes get buried (BR-2). The brief rests on the team's own report, not measured data.

### What changes

- A team member who can see a task can post a comment on it, in an open or done task (FR-1)
- Anyone who can see a task reads its whole discussion, oldest first (FR-2)
- The owner and assignee get an in-app notice when someone else comments, in a new notice list (FR-3, FR-4)
- Empty, too long or unsaved comments are refused with a message and no text is lost (FR-10, FR-11, FR-12)
- Others see a new comment on their next reload, not live (FR-7)
- Tasks, access rules and the chat tool stay as they are, and a change needs no comment (FR-16, FR-17)

### Decisions for you

1. Who is told about a new comment (Q-1)? Options: the owner and assignee only, or everyone who has commented. Recommendation: owner and assignee only; it costs a past commenter possibly missing a reply. This PRD is written on that choice (A-1).
2. Can people edit or delete their comments (Q-2)? Options: edit and delete allowed, or comments are permanent. Recommendation: permanent; it costs the ability to fix a typo. This PRD is written on that choice (A-2).

### Not in this

- Replacing or linking the chat tool, because it serves other needs (NG-1)
- File attachments, because text covers the need (NG-2)
- Comments by people outside the team, because the problem is internal (NG-3)
- Importing old chat history, because it is costly and hard to match to tasks (NG-4)
- Live updates, email or chat notices, replies, mentions and comment search, (NG-5, NG-6, NG-7, NG-8)
- A report or screen for measuring SM-1 and SM-2, because the app's own data and a survey are enough (NG-9)

## User journeys

- UJ-1: Omar, a team lead, changes a task's owner or due date, then posts a comment saying why.
- UJ-2: Priya, a new team member, opens a task she can see and reads its discussion to learn why it was done that way.
- UJ-3: Ana, an assignee, opens a notice about a comment, reads the task and replies.
- UJ-4: Ben loses access to a task, or it is deleted, and no longer sees its comments or notices.

## Functional requirements

### Capabilities

- FR-1: A team member who can see a task can post a comment on it while it is open or done. (BR-1) (BR-4) (A-6)
  - AC-FR-1.1: Given Ana can see an open or done task, when she posts "Client moved the date", then the discussion shows that text. It also shows her name and the time.
- FR-2: A team member who can see a task can read its whole discussion, oldest comment first, whenever they joined the team. (BR-2) (BR-4)
  - AC-FR-2.1: Given a task with 3 comments from before Priya joined, when she opens it, then she sees all 3, oldest first.
- FR-3: A team member can open the notice list and see their notices, newest first. (BR-3) (A-3)
  - AC-FR-3.1: Given Ana has 2 notices, when she opens the notice list, then the newer is first and each names the task and commenter.
  - AC-FR-3.2: Given Ana has a notice, when she opens it, then she sees the task and the notice leaves her list.

### Triggers and states

- FR-4: When a comment is posted, the system must give one notice to the task's owner and one to its assignee. The comment's author gets none. (BR-3) (A-1)
  - AC-FR-4.1: Given Omar owns a task assigned to Ana, when Ben comments, then Omar and Ana each get one notice.
  - AC-FR-4.2: Given Omar is both owner and assignee, when Ben comments, then Omar gets one notice.
- FR-5: While a person can't see a task, its comments and notices must stay hidden from them, including links, notice lists and search. (BR-4)
  - AC-FR-5.1: Given Ben can't see a task, when he opens its link, then he gets the same "no access" result as today. He sees no comment text.
- FR-6: When a comment is posted, the system must keep it with its author, time and text. It stays unchanged while the task exists, with no edit or delete. (BR-2) (A-2)
  - AC-FR-6.1: Given a posted comment, when its author views it, then no edit or delete control is shown.
- FR-7: When a person posts a comment, other people viewing the task must see it on their next reload, not before. (BR-1) (A-4)
  - AC-FR-7.1: Given Ana has a task open, when Ben posts a comment, then Ana's page shows nothing new until she reloads.
- FR-8: When a person loses the right to see a task, the system must remove that task's notices from their list. (BR-4)
  - AC-FR-8.1: Given Ben has a notice for a task, when he loses access to it, then his notice list no longer shows that notice.
- FR-9: When a task is deleted, the system must delete its comments and its notices. (BR-4) (A-6)
  - AC-FR-9.1: Given a task with 2 comments and 1 notice, when the task is deleted, then the comments and the notice are gone.

### Failures

- FR-10: If a comment is empty or holds only spaces and line breaks, then the system must refuse it. It must show "Write a comment before posting." (BR-1)
  - AC-FR-10.1: Given the comment box holds 3 spaces, when Ana posts, then that message shows and no comment is added.
- FR-11: If a comment is longer than 2,000 characters, then the system must refuse it and keep the text in the box. It must show "A comment can have at most 2,000 characters." (BR-1) (A-5)
  - AC-FR-11.1: Given a comment of exactly 2,000 characters, when Ana posts, then it is added.
  - AC-FR-11.2: Given a comment of 2,001 characters, when Ana posts, then it is refused with that message and the text stays in the box.
- FR-12: If saving a comment fails, then the system must show "Your comment was not posted. Try again.", keep the text in the box and send no notice. (BR-2)
  - AC-FR-12.1: Given saving is down, when Ana posts, then that message shows, her text stays and no notice is created.
- FR-13: If two people post at the same moment, then the system must keep both and order them by the time each was accepted. (BR-2)
  - AC-FR-13.1: Given Ana and Ben post at once, when the task is reloaded, then both show, in the order the system accepted them.
- FR-14: If a person posts after the task is deleted or after they lost access, then the system must refuse it. It must show "You can no longer comment on this task." (BR-4)
  - AC-FR-14.1: Given Ben's access was removed while he typed, when he posts, then that message shows and no comment is added.

### Unchanged behaviour

- FR-15: Where a person changes a task's owner, scope or due date, the app must work as today and not require a comment. (BR-1)
  - AC-FR-15.1: Given Omar moves a due date, when he saves without a comment, then the change is saved as today.
- FR-16: Where a person lists, opens, assigns or finishes a task, the app must behave as it does today. (BR-1)
  - AC-FR-16.1: Given an existing task, when Omar assigns it to Ana, then it behaves as before this feature.
- FR-17: Where a person can or can't see a task today, the same must hold after this feature. (BR-4)
  - AC-FR-17.1: Given Ben couldn't see a task before release, when he browses the app after release, then he still can't.

## Non-functional requirements

- NFR-1: After a person posts, the comment must show in the discussion within 2 seconds for 95% of posts.
  - AC-NFR-1.1: Given a task with 200 comments and 10 people posting in the same minute, when 100 posts are timed in the browser, then 95 or more take 2 seconds or less. Each time runs from click to display.
- NFR-2: Comment text and notices must reach 0 people who can't see the task.
  - Verified by: a manual check with two accounts, one without access, over the task page, its link and the notice list.
- NFR-3: Comment times must show as "YYYY-MM-DD HH:MM" in the viewer's browser time zone. (A-7)
  - Verified by: a manual check in two browser time zones.

## Non-goals

- NG-5: Live updates without reload. The brief doesn't ask for them.
- NG-6: Email or chat notices. In-app notices cover BR-3 within the appetite.
- NG-7: Threads, mentions and reactions. Plain comments cover the need.
- NG-8: Searching inside comments. The brief asks only to read a task's discussion.
- NG-9: A report or screen for SM-1 and SM-2. SM-1 uses the app's own data (A-8); SM-2 is a day-30 survey outside the product.
- NG-1 to NG-4 stay as in the brief.

## Assumptions

- A-1: Q-1 is answered "owner and assignee only". If everyone who has commented is told, FR-4 and its ACs gain past commenters.
- A-2: Q-2 is answered "comments are permanent". If edit or delete is allowed, FR-6 changes and edit and delete FRs, rules and failures are added.
- A-3: No notice list exists today, so it is new. Notices are in-app only and stay until opened. If a list exists, FR-3 reuses it.
- A-4: Other people see changes on reload. If they must see them at once, a new FR and NFR are needed.
- A-5: The 2,000-character limit is a guess, counted as characters including spaces and line breaks. A different limit changes FR-11.
- A-6: A task is open or done, has one owner and one assignee who may be the same person, and can be deleted. Another state needs its own rule in FR-1.
- A-7: Times are stored and shown in the viewer's browser time zone. A fixed time zone changes NFR-3.
- A-8: The app already records when a task's owner, scope or due date changed. If not, SM-1 can't be measured without a feature the brief doesn't ask for.

## Open questions

None — the brief's two questions sit under "Decisions for you", and this PRD's guesses are listed as assumptions.

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

- Task: a piece of work in the task app, open or done; exists today.
- Open, done: the two states of a task today; a done task still gets comments (A-6).
- Team member: a person with an account in the task app; exists today.
- Owner: the one team member who owns a task today.
- Assignee: the one team member a task is assigned to today; may be the owner.
- Can see a task: a team member who may open that task under today's access rules; this feature adds no rule.
- Comment: a written text of up to 2,000 characters posted on a task by a team member who can see it; new.
- Discussion: all comments of one task, oldest first; new.
- Notice: a short in-app message telling an owner or assignee about a new comment, naming the task title and commenter; new.
- Notice list: the new page where a team member sees their notices.
- Task change: a new owner, a new scope or a new due date on a task; exists today.
- Written reason: a comment posted within 24 hours after a task change; used by SM-1.
