---
id: SAMPLE-57
type: story
template: story@v1
repo: "."
risk: normal
size: M
verify: "A team lead opens the overdue page and sees the team's overdue tasks, the most overdue first, within 2 seconds."
covers_fr: [FR-2, NFR-1]
covers_ac: [AC-FR-2.1, AC-FR-2.2]
governed_by: []
after: [SAMPLE-56]
epic: SAMPLE-50
files_likely: [app/Http/Controllers/OverdueController.php, resources/js/pages/Overdue.tsx, app/Models/Task.php]
e2e: false
---
# Team leads see the team's overdue tasks on one page

## Description

A team lead opens one page with every overdue task of their own team, the most overdue first.
It shows within 2 seconds for a team with 500 open tasks. Only a team lead opens it.

## Acceptance criteria

- AC-SAMPLE-57.1: The most overdue first
  - Given tasks 1, 5 and 2 days overdue
  - When the lead opens the overdue page
  - Then they show in the order 5, 2, 1
- AC-SAMPLE-57.2: Nothing overdue
  - Given a team with no overdue task
  - When the lead opens the overdue page
  - Then it says "Nothing is overdue"
- AC-SAMPLE-57.3: Within 2 seconds
  - Given the test data set of 500 open tasks
  - When the lead opens the overdue page in the browser
  - Then it shows within 2 seconds

These deliver AC-FR-2.1 and AC-FR-2.2, and NFR-1, from the PRD.

## Boundaries

- Must not change: what team members who aren't leads can open.

## References

- The PRD: FR-2 and NFR-1 in [the due-dates PRD](../prd.md).

## Notes

Not applicable — nothing beyond the PRD and the epic.
