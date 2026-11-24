---
id: SAMPLE-54
type: story
template: story@v2
ticket_type: Story
repo: "."
risk: normal
size: M
priority: normal
order: 4
verify: "With the mail service refusing one reminder, it is sent again an hour later and the failure is logged."
covers_fr: [FR-7]
covers_ac: [AC-FR-7.1]
governed_by: []
after: [SAMPLE-53]
epic: SAMPLE-50
files_likely: [app/Jobs/RetryDueReminder.php, app/Mail/DueReminder.php]
e2e: false
---
# A failed reminder is retried once

## Description

When the mail service refuses a reminder, the app records the failure and sends the same email
again an hour later, once. Assignees then don't miss a reminder because of a short outage.

## Acceptance criteria

- AC-SAMPLE-54.1: A refused reminder is retried an hour later and logged
  - Given the mail service refuses Ana's reminder at 00:00
  - When an hour passes
  - Then the reminder is sent again, and the failure is in the log
- AC-SAMPLE-54.2: Only one retry
  - Given the retry is refused too
  - When another hour passes
  - Then nothing more is sent, and both failures are in the log

These deliver AC-FR-7.1 from the PRD.

## Boundaries

- Must not change: the reminders that were sent the first time.

## References

- The PRD: FR-7 in [the due-dates PRD](../prd.md).

## Notes

Not applicable — nothing beyond the PRD and the epic.
