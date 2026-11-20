---
id: TC-8
type: story
epic: TC-1
template: story@v1
repo: "."
risk: normal
size: M
verify: "A load test of 100 submissions and a test opening a task with 200 comments each show the 95th percentile within 2 seconds."
covers_fr: [NFR-1, NFR-2]
covers_ac: []
governed_by: []
after: [TC-2]
files_likely: []
e2e: false
---
# Comments save and load within 2 seconds

## Description

A new comment appears to its author quickly, and a busy task's comment area opens quickly. Both are measured and held to 2 seconds for 95% of cases.

## Acceptance criteria

- AC-TC-8.1: A new comment appears fast
  - Given 100 comment submissions in a load test
  - When each comment is submitted
  - Then 95% of them appear to their author within 2 seconds
- AC-TC-8.2: A long comment area opens fast
  - Given a task with 200 comments
  - When viewers open its comment area repeatedly in a performance test
  - Then 95% of opens finish within 2 seconds

## Boundaries

The task page's own load time, for tasks with no comments, must not get worse.

## References

- PRD: [Comments on tasks](../prd.md), NFR-1, NFR-2, A-6
- Epic: [TC-1](../epic-task-comments.md)

## Notes

- A-6 (2026-11-20): 2 seconds for 95% of cases is acceptable to users. If not, both targets tighten.
