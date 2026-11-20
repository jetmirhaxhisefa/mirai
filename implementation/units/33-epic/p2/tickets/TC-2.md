---
id: TC-2
type: story
epic: TC-1
template: story@v1
repo: "."
risk: normal
size: M
verify: "A test writes a comment on a task as a viewer, reopens the task as another viewer and finds it with author and time, oldest first."
covers_fr: [FR-1, FR-2, FR-3, FR-5, FR-15]
covers_ac: [AC-FR-1.1, AC-FR-2.1, AC-FR-3.1, AC-FR-5.1, AC-FR-15.1]
governed_by: []
after: []
files_likely: []
e2e: true
---
# Viewers write and read plain-text comments on a task

## Description

A viewer opens a task, writes a plain-text comment and submits it. Every viewer of the task then sees all its comments, oldest first, each with its author and time. This is the tracer bullet: the thinnest path from the task page to the comment store and back.

## Acceptance criteria

- AC-TC-2.1: A viewer adds a comment
  - Given a person who can see a task
  - When they submit non-empty text on that task
  - Then the text is saved and shown in the task's comments
- AC-TC-2.2: All comments, oldest first
  - Given a task with comments written at different times, some before the reader gained access
  - When any viewer opens the task
  - Then they see every comment, ordered from oldest to newest
- AC-TC-2.3: Author and time on each comment
  - Given a comment on a task
  - When a viewer opens the task
  - Then the comment shows its author's name and the time it was written
- AC-TC-2.4: Comments are permanent
  - Given a comment on a task, including one the viewer wrote
  - When the viewer looks at it
  - Then no way to edit or delete it is offered
- AC-TC-2.5: A task without comments is unchanged
  - Given a task with no comments
  - When a viewer opens it
  - Then its fields and actions match today's, plus an empty comment area

## Boundaries

The task page's existing fields and actions, and who can open a task, must work as they do today.

## References

- PRD: [Comments on tasks](../prd.md), FR-1, FR-2, FR-3, FR-5, FR-15, UJ-1, UJ-2
- Epic: [TC-1](../epic-task-comments.md)

## Notes

- A-2 (2026-11-20): comments are permanent, the recommendation for Q-2, still open in the brief. If edit or delete is chosen, AC-TC-2.4 changes.
- This ticket does not add access checks on comments; TC-3 does. Comments must not go live before TC-3 (see the epic's Release).
