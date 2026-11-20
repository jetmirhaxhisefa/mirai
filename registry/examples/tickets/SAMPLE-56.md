---
id: SAMPLE-56
type: story
template: story@v1
repo: "."
risk: normal
size: S
verify: "An open task due yesterday is marked overdue in the list, and the mark goes once it is done."
covers_fr: [FR-5]
covers_ac: [AC-FR-5.1, AC-FR-5.2]
governed_by: []
after: [SAMPLE-51]
epic: SAMPLE-50
files_likely: [app/Models/Task.php, resources/js/pages/TaskList.tsx]
e2e: false
---
# Overdue tasks are marked in the list

## Description

While a task is past its due date and not done, the task list marks it as overdue for everyone
who can see it. Marking it done removes the mark.

## Acceptance criteria

- AC-SAMPLE-56.1: An open task past its date is marked
  - Given an open task due 2027-01-15
  - When a team member opens the list on 2027-01-16
  - Then the task is marked overdue
- AC-SAMPLE-56.2: A done task isn't
  - Given that task is then marked done
  - When the list is opened again
  - Then it is no longer marked overdue

These deliver AC-FR-5.1 and AC-FR-5.2 from the PRD.

## Boundaries

- Must not change: the list's order, for dated and undated tasks.

## References

- The PRD: FR-5 in [the due-dates PRD](../prd.md).

## Notes

Not applicable — nothing beyond the PRD and the epic.
