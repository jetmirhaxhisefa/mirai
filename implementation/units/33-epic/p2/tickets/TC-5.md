---
id: TC-5
type: story
epic: TC-1
template: story@v1
repo: "."
risk: normal
size: S
verify: "A test submits an empty comment, a 2,001-character comment and a comment while the store is down, and each is refused with a message and the text kept."
covers_fr: [FR-8, FR-9, FR-10]
covers_ac: [AC-FR-8.1, AC-FR-9.1, AC-FR-10.1]
governed_by: []
after: [TC-2]
files_likely: []
e2e: false
---
# Empty, oversized and failed comments are refused without losing the text

## Description

A viewer who submits a comment that cannot be saved is told why, and does not lose what they typed. Empty comments and comments over 2,000 characters are refused. A failed save shows an error.

## Acceptance criteria

- AC-TC-5.1: Empty text is refused
  - Given a viewer of a task
  - When they submit a comment that is empty or only spaces
  - Then no comment is added and a message says text is needed
- AC-TC-5.2: Over 2,000 characters is refused
  - Given a viewer has typed more than 2,000 characters
  - When they submit
  - Then no comment is added, the limit is shown and their text is still in the box
- AC-TC-5.3: Exactly 2,000 characters is accepted
  - Given a viewer has typed exactly 2,000 characters
  - When they submit
  - Then the comment is saved
- AC-TC-5.4: A failed save keeps the text
  - Given the comment store is unavailable
  - When a viewer submits a comment
  - Then an error is shown, no comment is added and their text is still in the box

## Boundaries

Valid comments must still save and show as in TC-2.

## References

- PRD: [Comments on tasks](../prd.md), FR-8, FR-9, FR-10, A-5
- Epic: [TC-1](../epic-task-comments.md)

## Notes

- A-5 (2026-11-20): 2,000 characters is enough for a written reason. If it changes, AC-TC-5.2 and AC-TC-5.3 change.
