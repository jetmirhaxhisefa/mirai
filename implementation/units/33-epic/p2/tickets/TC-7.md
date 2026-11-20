---
id: TC-7
type: story
epic: TC-1
template: story@v1
repo: "."
risk: high
size: S
verify: "A test deletes a task with comments, then requests those comments as a former viewer and finds none."
covers_fr: [FR-7]
covers_ac: [AC-FR-7.1]
governed_by: []
after: [TC-2]
files_likely: []
e2e: false
---
# Deleting a task deletes its comments

## Description

When a task is deleted, its comments are deleted with it. No one can read them afterwards, by any route in the app.

## Acceptance criteria

- AC-TC-7.1: Comments go with their task
  - Given a task with comments
  - When the task is deleted
  - Then no one can read any of its comments
- AC-TC-7.2: Other tasks keep their comments
  - Given two tasks with comments
  - When one task is deleted
  - Then the other task's comments are unchanged

## Boundaries

Who may delete a task, and what else deleting a task does today, must not change.

## References

- PRD: [Comments on tasks](../prd.md), FR-7, A-4
- Epic: [TC-1](../epic-task-comments.md)

## Notes

- A-4 (2026-11-20): deleting a task deletes its comments. If they must be kept, this ticket changes and BR-4 needs a rule for who may read them.
