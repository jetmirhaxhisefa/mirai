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
# Comments keep the reasons with the task

Brief: [Keep the reasons behind a task with the task](brief.md)

## Summary for approval

### The ask

Approve the brief and this PRD for task comments, so that 60% of task changes carry a written reason in the app (SM-1).

### Why

Team leads who assign tasks to 3 to 10 people discuss them in a chat tool. The reasons for a change get buried there, and new team members cannot see why a task was done a certain way (BR-2). This is the team's own report, not measured data. Baselines for SM-1 and SM-2 are UNKNOWN (see the brief).

### What changes

- A person who can see a task can post a text comment on it. They can read all its comments, oldest first, including those posted before they joined (FR-1, FR-2, FR-3)
- The task's owner and assignee get an in-app notice when someone else comments, in a new notice area (FR-8, FR-9, FR-10, FR-11, FR-15)
- Comments are permanent while the task exists. Nobody can edit or delete one (FR-14)
- A comment that is empty, over 2,000 characters or not saved is refused with a stated message. The typed text stays in the box (FR-24, FR-25, FR-26)
- A person who loses sight of a task loses its comments and notices. Notices and comments are not in search or exports (FR-16, FR-17, FR-36)
- A comment never blocks a task change. Task changes, access rules and the chat tool stay as they are today (FR-34, FR-35, FR-37)

### Decisions for you

1. Who is told about a new comment (brief Q-1)? Options: the owner and assignee only, or everyone who has commented. Recommendation: owner and assignee only, because it keeps alerts low. It costs the chance that a past commenter misses a reply. The requirements are written for this option (A-6).
2. Can people edit or delete their comments (brief Q-2)? Options: edit and delete allowed, or comments are permanent. Recommendation: permanent comments, because the reasons then stay trustworthy. It costs the ability to fix a typo. The requirements are written for this option (A-7).

### Not in this

- Replacing the chat tool or linking it to the app, because it serves other needs (NG-1)
- File attachments in comments, because text covers the stated need (NG-2)
- Comments by people outside the team, because the problem is internal (NG-3)
- Importing old chat history, because it is costly and hard to match to tasks (NG-4)
- Comments in search results or exports, because the brief asks only to read a task's discussion (NG-5)
- Email or chat alerts for comments, because in-app notices cover BR-3 within the appetite (NG-6)
- Replies, mentions, reactions and formatting, because plain text covers the need (NG-7)
- Requiring a reason for each task change, because SM-1 targets 60%, not 100% (NG-8)
- Comment counts or badges in task lists, because the brief does not ask for them (NG-9)

## User journeys

- UJ-1: A team lead changes a task's owner, scope or due date, then posts a comment on the task that says why (FR-1, FR-34, FR-8).
- UJ-2: A new team member opens an old task, reads its comments oldest first and learns why it was done that way (FR-2, FR-3, FR-5).
- UJ-3: An assignee sees a notice that a colleague commented, opens the task from it and reads the comment (FR-8, FR-11, FR-12, FR-13).
- UJ-4: A team member loses the ability to see a task and no longer sees its comments or notices (FR-16, FR-17, FR-27).

## Functional requirements

### Capabilities

- FR-1: A person who can see a task can post a text comment on it, in any state of the task. (BR-1) (A-4)
  - AC-FR-1.1: Given Ana can see task T, when she posts "Moved the due date because the client slipped.", then it shows in T's comments.
  - AC-FR-1.2: Given Ana can see a done task (T2), when she posts a comment, then it appears in T2's comments.
- FR-2: A person who can see a task can read all its comments, oldest first. (BR-2)
  - AC-FR-2.1: Given T has comments posted on 2026-11-01, 2026-11-05 and 2026-11-10, when Ben can see T and opens it, then he sees them in that order.
- FR-3: A person who can see a task can read comments that were posted before the person could see the task. (BR-2)
  - AC-FR-3.1: Given Ben joined the team on 2026-11-15 and T has a comment from 2026-11-01, when Ben opens T, then he sees that comment.
- FR-4: A person who can see a task can see each comment's author name and time posted. (BR-2)
  - AC-FR-4.1: Given Ana posted a comment, when Ben opens the task, then the comment shows "Ana" and the time it was posted.
- FR-5: A person who opens a task with no comments can see the text "No comments yet." (BR-2)
  - AC-FR-5.1: Given T has no comments, when Ana opens T, then the comments area shows "No comments yet."
- FR-6: A person can open the notice area and read their notices, newest first. (BR-3) (A-1)
  - AC-FR-6.1: Given Ben has notices from 10:00 and 11:00, when he opens the notice area, then the 11:00 one is first.
- FR-7: A person who reads a notice can open from it the task that the notice names. (BR-3)
  - AC-FR-7.1: Given Ben has a notice about T and can see T, when he selects the notice, then T opens.

### Triggers and states

- FR-8: When a comment is posted, the system must create one notice for the owner of the task. (BR-3) (A-6)
  - AC-FR-8.1: Given Ana owns T and Ben is its assignee, when Ben posts a comment, then Ana has one new notice.
- FR-9: When a comment is posted, the system must create one notice for the assignee of the task. (BR-3) (A-6)
  - AC-FR-9.1: Given Ana owns T and Ben is its assignee, when Ana posts a comment, then Ben has one new notice.
- FR-10: When a comment is posted and the owner and assignee are the same person, the system must create one notice for that person. (BR-3)
  - AC-FR-10.1: Given Ana is both owner and assignee of T, when Ben posts a comment, then Ana has exactly one new notice.
- FR-11: When a comment is posted, the system must create no notice for its author. (BR-3)
  - AC-FR-11.1: Given Ana owns T and posts a comment, when the notices are created, then Ana has no new notice.
- FR-12: When the system creates a notice, it must word it "<author name> commented on <task title>." (BR-3)
  - AC-FR-12.1: Given Ben comments on the task "Plan release", when Ana's notice is created, then it reads "Ben commented on Plan release."
- FR-13: When a person opens a task that has an unread notice for them, the system must mark that notice read. (BR-3)
  - AC-FR-13.1: Given Ana has an unread notice about T, when she opens T, then the notice no longer shows "Unread".
- FR-14: While a task exists, the system must offer no way to change or delete its comments. (BR-2) (A-7)
  - AC-FR-14.1: Given Ana is the author of a comment on T, when she looks at it, then no edit or delete option is shown.
- FR-15: While a notice is unread, the notice area must mark it "Unread". (BR-3)
  - AC-FR-15.1: Given Ana has one unread and one read notice, when she opens the notice area, then only the unread one shows "Unread".
- FR-16: When a person can no longer see a task, the system must remove that task's notices from the person's notice area. (BR-4)
  - AC-FR-16.1: Given Ben has a notice about T, when Ben stops being able to see T, then the notice is gone from his notice area.
- FR-17: When a person can no longer see a task, the system must show none of its comments to that person. (BR-4)
  - AC-FR-17.1: Given Ben could read T's comments, when Ben stops being able to see T, then no page of the app shows T's comments to him.
- FR-18: When a comment is posted, the system must show it at once to its author. (BR-1)
  - AC-FR-18.1: Given Ana posts a comment, when the system saves it, then it shows in her view without a reload.
- FR-19: When a comment is posted, the system must show it to other people on their next reload of the task. (BR-1)
  - AC-FR-19.1: Given Ben has T open and Ana posts a comment, when Ben reloads T, then he sees the comment. Before the reload he does not.
- FR-20: While comments are listed, the system must order those posted in the same minute by the order in which the system received them. (BR-2)
  - AC-FR-20.1: Given Ana's comment is received before Ben's in the same minute, when anyone opens T, then Ana's comment is above Ben's.
- FR-21: When a person's account is removed or deactivated, the system must keep that person's comments with their name as it was when posted. (BR-2) (A-9)
  - AC-FR-21.1: Given Ana posted a comment on T and her account is deactivated, when Ben opens T, then the comment is there and shows "Ana".
- FR-22: When a task is deleted, the system must delete its comments and its notices. (BR-2) (A-10)
  - AC-FR-22.1: Given T has 3 comments and 2 notices, when T is deleted, then none of them can be opened.
- FR-23: While a comment is shown, the system must write its time as YYYY-MM-DD HH:MM in 24-hour time in the reader's browser time zone. (BR-2) (A-3)
  - AC-FR-23.1: Given a comment posted at 2026-11-19 13:05 UTC, when a reader in Berlin opens it, then it shows "2026-11-19 14:05".

### Failures

- FR-24: If a comment is empty or holds only spaces and line breaks, then the system must refuse it. It must show "Write a comment before posting." (BR-1)
  - AC-FR-24.1: Given Ana can see T, when she posts only spaces, then no comment is added and the message "Write a comment before posting." shows.
- FR-25: If a comment has more than 2,000 characters, then the system must refuse it. It must show "A comment can have at most 2,000 characters." (BR-1) (A-5)
  - AC-FR-25.1: Given Ana types 2,000 characters, when she posts, then the comment is added.
  - AC-FR-25.2: Given Ana types 2,001 characters, when she posts, then no comment is added. The message "A comment can have at most 2,000 characters." shows.
- FR-26: If the system cannot save a comment, then it must keep the typed text in the box and show "The comment was not posted. Try again." (BR-1)
  - AC-FR-26.1: Given saving fails, when Ana posts "Reason A", then no comment is added, "Reason A" stays in the box and the message shows.
- FR-27: If a person who can no longer see a task posts on it, then the system must refuse the comment. It must show "You can't comment on this task." (BR-4)
  - AC-FR-27.1: Given Ben had T open and then lost sight of T, when he posts, then no comment is added and the message shows.
- FR-28: If a person posts once and presses the post button again before the first post ends, then the system must add only one comment. (BR-1)
  - AC-FR-28.1: Given Ana presses the post button twice within 1 second, when both presses are handled, then T gains exactly one comment.
- FR-29: If two people post on the same task at the same moment, then the system must keep both comments. (BR-1)
  - AC-FR-29.1: Given Ana and Ben post on T at the same moment, when T is opened, then both comments are listed.
- FR-30: If the owner or the assignee cannot see the task, then the system must create no notice for that person. (BR-4)
  - AC-FR-30.1: Given Ben is the assignee of T and cannot see T, when Ana posts a comment, then Ben gets no notice.
- FR-31: If the owner or the assignee account is deactivated, then the system must create no notice for that person. (BR-3)
  - AC-FR-31.1: Given Ben's account is deactivated and he is T's assignee, when Ana posts, then no notice is created for Ben.
- FR-32: If a task has no owner or no assignee, then the system must create a notice only for the one it has. (BR-3)
  - AC-FR-32.1: Given T has an owner Ana and no assignee, when Ben posts, then Ana has one notice and no other notice is created.
- FR-33: If the system cannot create a notice, then it must still keep the posted comment. (BR-2)
  - AC-FR-33.1: Given notice creation fails, when Ben posts on T, then the comment shows in T.

### Unchanged behaviour

- FR-34: Where a person changes a task's owner, scope or due date, the product must let the person save the change without a comment. (BR-1)
  - AC-FR-34.1: Given Ana changes the due date of T, when she saves with no comment, then the change is saved.
- FR-35: Where a person decides who can see a task, the product must apply the rules it applies today and none from comments. (BR-4)
  - AC-FR-35.1: Given Carl cannot see T today, when comments are released, then Carl still cannot see T or its comments.
- FR-36: Where a person searches or exports tasks, the product must show no comment text, as it does today. (BR-4)
  - AC-FR-36.1: Given T has a comment containing "budget", when Ana searches for "budget", then T is not found through the comment.
- FR-37: Where people use the chat tool, the product must not link to it or change it. (BR-1)
  - AC-FR-37.1: Given the chat tool works today, when comments are released, then the chat tool and the app are not linked.

## Non-functional requirements

- NFR-1: A posted comment must show in the poster's view within 2 seconds for 95% of posts.
  - AC-NFR-1.1: Given a task with 200 comments and 10 people posting at once on staging, when each posts, then 95% show within 2 seconds. Time runs from pressing the post button to the comment showing in the browser.
- NFR-2: A task that has 200 comments must open with its comments in 3 seconds for 95% of opens.
  - AC-NFR-2.1: Given the same staging setup, when 10 people open the task, then 95% of opens show all 200 comments within 3 seconds. Time runs from the request to the last comment showing.
- NFR-3: A notice must be in the recipient's notice area within 5 seconds of the post for 95% of posts.
  - Verified by: an automated test on the staging system that posts 100 comments and reads the recipient's notice area 5 seconds after each post.
- NFR-4: The comment box, the post button, the notice area and each notice must work with the keyboard alone and have a text label.
  - Verified by: a manual check with a keyboard and a screen reader on the task page and the notice area.
- NFR-5: The system must lose no comment once it shows "posted" to its author. The count is 0 lost in 1,000 test posts.
  - Verified by: an integration test that posts 1,000 comments and counts them afterwards.

## Non-goals

- NG-5: Comments in search results and exports. The brief asks only to read a task's discussion.
- NG-6: Email or chat alerts for comments. In-app notices cover BR-3 within the appetite (A-2).
- NG-7: Replies, mentions, reactions and formatting. Plain text covers the need.
- NG-8: Requiring a reason for each task change. SM-1 targets 60%, not 100%.
- NG-9: Comment counts or badges in task lists. The brief does not ask for them.

## Assumptions

- A-1: The app has no notice area today, so this feature builds one. If it has one, FR-6 and FR-7 reuse it.
- A-2: In-app notices satisfy "learn" in BR-3. If the team wants email too, a new FR and NG-6 change.
- A-3: Every reader has a browser time zone. If not, FR-23 needs one fixed time zone.
- A-4: A task is either open or done, and comments are allowed in both. If there are other states, FR-1 names the allowed ones.
- A-5: 2,000 characters is enough for a reason. If not, the number in FR-25 and NFR-5 changes.
- A-6: The owner picks "owner and assignee only" for brief Q-1. If not, FR-8 to FR-11 change.
- A-7: The team lead picks "permanent comments" for brief Q-2. If not, FR-14 changes and an edit rule is added.
- A-8: The app records the time of each owner, scope and due date change, and SM-1 counts from it. If not, SM-1 cannot be measured and a new FR is needed. SM-2 comes from a survey outside the product.
- A-9: The app keeps the name of a removed or deactivated account. If not, FR-21 shows a fixed label.
- A-10: Tasks can be deleted. If not, FR-22 is dropped.

## Open questions

None — the brief's two questions sit under "Decisions for you".

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

- Task: a work item in the task app. It exists today. It is open or done (A-4).
- Task app: the app where tasks are tracked. It exists today.
- Team member: a person in the team who uses the task app. It excludes people outside the team (NG-3).
- Owner: the team member set as a task's owner. This exists today.
- Assignee: the team member set as a task's assignee. This exists today.
- Can see a task: the task app lets the person open the task today. These access rules do not change (FR-35).
- Comment: a text message of 1 to 2,000 characters posted on one task. It is new.
- Comments: the list of a task's comments on its page. It is new.
- Notice: a message in a person's notice area that someone commented on a task. It is new.
- Notice area: the place in the app where a person reads their notices. It is new (A-1).
- Unread: a notice that its recipient has not opened the task for. It is marked "Unread".
- Chat tool: the separate tool where teams discuss tasks today. The feature does not touch it.
