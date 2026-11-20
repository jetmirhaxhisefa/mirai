---
id: TC-3
type: story
epic: TC-1
template: story@v1
repo: "."
risk: high
size: M
verify: "An integration test requests and submits comments on a task as each role without access, and gets a refusal with no comment text, every time."
covers_fr: [FR-6, FR-12, FR-16, NFR-3]
covers_ac: [AC-FR-6.1, AC-FR-12.1, AC-FR-12.2, AC-FR-16.1]
governed_by: []
after: [TC-2]
files_likely: []
e2e: false
---
# Only people who can see a task can read or write its comments

## Description

Comments follow the task app's existing access rules. A person who cannot see a task, or who loses access, can neither read nor write its comments, by any route in the app. A refusal reveals nothing about the comments. This closes the main risk of the epic: comments leaking past BR-4.

## Acceptance criteria

- AC-TC-3.1: Reading without access is refused
  - Given a person who cannot see a task
  - When they request that task's comments by any route
  - Then access is refused and no comment text, count or author is returned
- AC-TC-3.2: Writing without access is refused
  - Given a person who cannot see a task
  - When they try to submit a comment on it
  - Then the request is refused and nothing is saved
- AC-TC-3.3: Losing access hides the comments
  - Given a person who could see a task and then loses access to it
  - When they open, search or request anything that would show its comments
  - Then none of its comments is shown
- AC-TC-3.4: Task access rules are unchanged
  - Given any person and any task
  - When comments are released
  - Then the person can see the task exactly when they could before
- AC-TC-3.5: Every role without access is refused
  - Given each role that cannot see a given task
  - When a test requests that task's comments as that role
  - Then all of them, 100%, are refused

## Boundaries

Who can see, change or delete a task today must not change. Viewers must still read and write comments as in TC-2.

## References

- PRD: [Comments on tasks](../prd.md), FR-6, FR-12, FR-16, NFR-3; brief BR-4
- Epic: [TC-1](../epic-task-comments.md)

## Notes

Not applicable — no open question blocks this ticket; it reuses the app's existing access rules.
