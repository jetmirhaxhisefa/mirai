---
id: TC-9
type: story
epic: TC-1
template: story@v1
repo: "."
risk: normal
size: S
verify: "A person reads, writes and submits a comment using only the keyboard, with no mouse."
covers_fr: [NFR-4]
covers_ac: []
governed_by: []
after: [TC-2, TC-5]
files_likely: []
e2e: false
---
# Comments work with the keyboard alone

## Description

A person who uses only the keyboard can reach a task's comments, read them, type a comment and submit it.

## Acceptance criteria

- AC-TC-9.1: Reading by keyboard
  - Given a task with comments
  - When a person moves through the page with the keyboard only
  - Then they can reach and read each comment
- AC-TC-9.2: Writing and submitting by keyboard
  - Given a viewer on a task, with no mouse
  - When they move to the comment box, type and submit with the keyboard
  - Then the comment is saved and shown
- AC-TC-9.3: Messages reach keyboard users
  - Given a comment is refused or fails to save
  - When a keyboard-only person submits it
  - Then they can reach the message and their kept text with the keyboard

## Boundaries

Keyboard use of the rest of the task page must work as it does today.

## References

- PRD: [Comments on tasks](../prd.md), NFR-4
- Epic: [TC-1](../epic-task-comments.md)

## Notes

Not applicable — no open question or assumption touches this ticket.
