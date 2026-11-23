---
id: SAMPLE-55
type: story
template: story@v1
repo: "."
risk: normal
size: S
verify: "An assignee who turned reminders off, and one who left the team, get no email; the new assignee does."
covers_fr: [FR-3, FR-8]
covers_ac: [AC-FR-3.1, AC-FR-8.1, AC-FR-8.2]
governed_by: []
after: [SAMPLE-53]
epic: SAMPLE-50
files_likely: [app/Console/Commands/SendDueReminders.php, app/Models/User.php, resources/js/pages/Settings.tsx]
e2e: false
---
# Assignees can turn reminders off, and leavers get none

## Description

An assignee can turn all of their reminder emails off in their settings, and on again. Someone
who leaves a team gets no more reminders for its tasks, while a new assignee is reminded as usual.
This decides who receives a reminder.

## Acceptance criteria

- AC-SAMPLE-55.1: Reminders turned off
  - Given Ana has turned reminders off
  - When a task of hers is due tomorrow
  - Then she gets no email, and turning them on again brings them back
- AC-SAMPLE-55.2: A leaver gets none
  - Given Ana has left the team, and a task still assigned to her is due tomorrow
  - When today ends
  - Then no reminder is sent for it
- AC-SAMPLE-55.3: The new assignee is reminded
  - Given that task is then assigned to Ben, and is due tomorrow
  - When today ends
  - Then Ben is reminded

These deliver AC-FR-3.1, AC-FR-8.1 and AC-FR-8.2 from the PRD.

## Boundaries

- Must not change: the other settings on the settings page.

## References

- The PRD: FR-3 and FR-8 in [the due-dates PRD](../prd.md).

## Notes

Not applicable — nothing beyond the PRD and the epic.
