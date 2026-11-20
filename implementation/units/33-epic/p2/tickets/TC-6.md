---
id: TC-6
type: story
epic: TC-1
template: story@v1
repo: "."
risk: normal
size: S
verify: "A test submits two comments on one task at the same moment, reopens the task and finds both."
covers_fr: [FR-13]
covers_ac: [AC-FR-13.1]
governed_by: []
after: [TC-2]
files_likely: []
e2e: false
---
# Two comments submitted at the same moment both stay

## Description

Two viewers can comment on the same task at the same moment, and neither comment is lost or overwritten. Both appear when the task is reopened.

## Acceptance criteria

- AC-TC-6.1: Simultaneous comments are both kept
  - Given two viewers of a task
  - When both submit a comment within the same second
  - Then both comments are saved and shown when the task is reopened
- AC-TC-6.2: Order stays stable
  - Given two comments saved within the same second
  - When any viewer opens the task several times
  - Then the two comments appear in the same order every time

## Boundaries

A single comment must still save and show as in TC-2.

## References

- PRD: [Comments on tasks](../prd.md), FR-13
- Epic: [TC-1](../epic-task-comments.md)

## Notes

Not applicable — no open question or assumption touches this ticket.
