---
id: SAMPLE-51
type: story
template: story@v1
repo: "."
risk: normal
size: M
verify: "A team lead dates a task, changes the date and removes it; the task list keeps its order for undated tasks."
covers_fr: [FR-1, FR-9]
covers_ac: [AC-FR-1.1, AC-FR-1.2, AC-FR-1.3, AC-FR-9.1]
governed_by: []
after: []
epic: SAMPLE-50
files_likely: [app/Models/Task.php, app/Http/Controllers/TaskController.php, resources/js/pages/TaskDetail.tsx, resources/js/pages/TaskList.tsx]
e2e: false
---
# A task can carry a due date

## Description

A task's creator, while in the team, or the team's lead can set, change or remove a task's due
date, and the task shows it. Everyone else sees the date but can't change it. This is the
epic's tracer bullet: it stores, edits and shows a date through every layer, and leaves undated
tasks exactly as they are today.

## Acceptance criteria

- AC-SAMPLE-51.1: The creator sets, changes and removes a date
  - Given a task with no due date, created by Ana, who is in the team
  - When Ana sets 2027-01-15, then removes it
  - Then the task shows "Due 15 Jan 2027", then no due date
- AC-SAMPLE-51.2: Only the creator or the lead may change the date
  - Given Ben neither created the task nor leads its team
  - When Ben opens the task
  - Then he sees its date and has no way to change it, and a direct request is refused
- AC-SAMPLE-51.3: Undated tasks are unchanged
  - Given a list of tasks with no due date
  - When the list opens after this change
  - Then the tasks show and sort exactly as before

These deliver AC-FR-1.1, AC-FR-1.2, AC-FR-1.3 and AC-FR-9.1 from the PRD.

## Boundaries

- Must not change: how tasks are created, assigned or sorted today.

## References

- The PRD: FR-1 and FR-9 in [the due-dates PRD](../prd.md).
- The epic: SAMPLE-50, the due-dates ticket set.

## Notes

Not applicable — nothing beyond the PRD and the epic.
