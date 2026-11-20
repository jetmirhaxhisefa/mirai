---
id: TC-4
type: story
epic: TC-1
template: story@v1
repo: "."
risk: normal
size: M
verify: "A test comments on tasks with each owner and assignee combination and counts the in-app notifications each person gets, then repeats with notifications unavailable."
covers_fr: [FR-4, FR-11, FR-14]
covers_ac: [AC-FR-4.1, AC-FR-4.2, AC-FR-4.3, AC-FR-14.1, AC-FR-14.2, AC-FR-11.1]
governed_by: []
after: [TC-2]
files_likely: []
e2e: false
---
# The owner and assignee are told in the app when someone comments

## Description

When a viewer comments on a task, the task's owner and assignee each get one in-app notification naming the task. The author is never notified of their own comment, and no one else is. If notifications fail, the comment is still kept.

## Acceptance criteria

- AC-TC-4.1: Owner and assignee are notified
  - Given a task with an owner and a different assignee
  - When a third viewer comments on it
  - Then the owner and the assignee each get one in-app notification that names the task
- AC-TC-4.2: The author is not notified
  - Given a task whose owner or assignee writes a comment
  - When the comment is saved
  - Then the author gets no notification and the other of the two gets one
- AC-TC-4.3: No one else is notified
  - Given a viewer who is neither owner nor assignee, including one who commented earlier
  - When someone else comments on the task
  - Then that viewer gets no notification
- AC-TC-4.4: One notification per person
  - Given a task whose owner is also its assignee
  - When another viewer comments
  - Then that person gets exactly one notification
- AC-TC-4.5: No assignee
  - Given a task with an owner and no assignee
  - When another viewer comments
  - Then only the owner is notified
- AC-TC-4.6: A failed notification keeps the comment
  - Given notifications cannot be delivered
  - When a viewer comments on a task
  - Then the comment is saved and shown in the task's comments

## Boundaries

Notifications the app sends today, if any, must not change. Saving and showing a comment, as in TC-2, must not wait on or depend on a notification.

## References

- PRD: [Comments on tasks](../prd.md), FR-4, FR-11, FR-14, UJ-3, A-1, A-3, Q-3
- Epic: [TC-1](../epic-task-comments.md)

## Notes

- A-1 (2026-11-20): only the owner and assignee are notified, the recommendation for Q-1, open in the brief.
- A-3 (2026-11-20): in-app notice only, the recommendation for Q-3, open in the PRD. Email would change this ticket.
