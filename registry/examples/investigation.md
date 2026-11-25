---
id: PMT-14
type: investigation
template: investigation@v1
ticket_type: Investigation
repo: "."
risk: normal
size: S
priority: normal
order: 1
verify: "The finding names the mail provider's daily sending limit for our plan, with the page it comes from."
covers_fr: []
covers_ac: []
after: []
---
# How many reminder emails our mail provider lets us send a day

## Question

How many emails a day does our mail provider let the app send on our current plan? The choice
between one reminder per task and one digest per person waits on this answer.

## Acceptance criteria

- AC-PMT-14.1: The daily limit is named with its source
  - Given the plan the project pays for today
  - When the investigation is finished
  - Then the finding states the daily sending limit as a number, with the page it comes from
- AC-PMT-14.2: The cost of a higher limit is named
  - Given the limit is below 5,000 emails a day
  - When the investigation is finished
  - Then the finding names the next plan up and its monthly price

## Looked at

Not applicable — written by the investigation run.

## Finding

Not applicable — written by the investigation run.

## Next steps

Not applicable — written by the investigation run.

## Sources

- The mail settings in `config/mail.php`, which name the provider.
- The provider's pricing page, linked from the team's billing notes.

## Notes

Not applicable — nothing beyond the question and its sources.
