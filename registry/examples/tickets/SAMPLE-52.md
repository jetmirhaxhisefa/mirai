---
id: SAMPLE-52
type: story
template: story@v2
ticket_type: Story
repo: "."
risk: normal
size: S
priority: normal
order: 3
verify: "Entering yesterday's date on a task shows the refusal message and keeps the old date."
covers_fr: [FR-6]
covers_ac: [AC-FR-6.1]
governed_by: []
after: [SAMPLE-51]
epic: SAMPLE-50
files_likely: [app/Http/Requests/UpdateTaskDueDate.php, resources/js/pages/TaskDetail.tsx]
e2e: false
---
# A due date in the past is refused

## Description

When someone enters a due date before today, the task keeps its old date and they are told why.
Today is the team's own calendar day. This closes the main failure of setting a date.

## Acceptance criteria

- AC-SAMPLE-52.1: A past date is refused with the reason
  - Given today is 2027-01-14 in the team's time zone
  - When the creator enters 2027-01-13
  - Then the date is refused with "Due dates can't be in the past." and the old date stays
- AC-SAMPLE-52.2: Today's date is accepted
  - Given today is 2027-01-14 in the team's time zone
  - When the creator enters 2027-01-14
  - Then the task shows "Due 14 Jan 2027"

These deliver AC-FR-6.1 from the PRD.

## Boundaries

- Must not change: the dates of tasks dated before this change.

## References

- The PRD: FR-6 in [the due-dates PRD](../prd.md).

## Notes

Not applicable — nothing beyond the PRD and the epic.
