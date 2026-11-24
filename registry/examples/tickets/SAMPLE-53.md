---
id: SAMPLE-53
type: story
template: story@v2
ticket_type: Story
repo: "."
risk: high
size: L
priority: normal
order: 2
verify: "With tasks due tomorrow for two people, ending the day sends each of them one email listing only their open tasks."
covers_fr: [FR-4, NFR-2]
covers_ac: [AC-FR-4.1, AC-FR-4.2, AC-FR-4.3, AC-FR-4.4, AC-FR-4.5, AC-NFR-2.1]
governed_by: []
after: [SAMPLE-51]
epic: SAMPLE-50
files_likely: [app/Console/Commands/SendDueReminders.php, app/Mail/DueReminder.php, resources/views/emails/due-reminder.blade.php]
e2e: true
---
# Assignees get one reminder email as the day before ends

## Description

When a team's day ends, each assignee gets one email listing their open tasks due the next day.
The email shows each task's title and due date only. A day is sent once, and a moved date is
reminded again. It is the part of the epic we are least sure of, so it comes right after the
tracer bullet.

## Acceptance criteria

- AC-SAMPLE-53.1: One email per assignee, listing all of the next day's tasks
  - Given Ana has two open tasks due 2027-01-15
  - When 2027-01-14 ends in her team's time zone
  - Then Ana gets one email naming both tasks
- AC-SAMPLE-53.2: A day is sent once
  - Given the reminders for 2027-01-14 were sent
  - When the reminder job runs again that day
  - Then no second email is sent
- AC-SAMPLE-53.3: A moved date is reminded again
  - Given Ana was reminded of a task due 2027-01-15
  - When its date moves to 2027-01-20
  - Then she is reminded again as 2027-01-19 ends
- AC-SAMPLE-53.4: Done tasks and tasks dated today aren't listed
  - Given a task due 2027-01-15 is marked done on 2027-01-14, and another is dated 2027-01-15 on that day
  - When the days end
  - Then no email lists either task
- AC-SAMPLE-53.5: The email shows only the title and the date
  - Given a task whose description holds a salary
  - When its reminder is sent
  - Then the email shows the task's title and due date, and nothing of its description

These deliver AC-FR-4.1 to AC-FR-4.5 and AC-NFR-2.1 from the PRD.

## Boundaries

- Must not change: the emails the app sends today, such as the assignment email.

## References

- The PRD: FR-4 and NFR-2 in [the due-dates PRD](../prd.md).

## Notes

- Decision: the reminder journey gets an end-to-end test, and the ticket is high risk, because a fault emails every assignee (2026-11-20).
