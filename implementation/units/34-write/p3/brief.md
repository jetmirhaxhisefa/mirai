---
id: task-comments-brief
type: brief
template: brief@v1
track: standard
owner: mirai-product-manager
created: "2026-11-19"
upstream: []
---
# Keep the reasons behind a task with the task

## Summary for approval

### The ask

Approve a four-week build of task comments, so that 60% of task changes carry a written reason in the app (SM-1).

### Why

Team leads who assign tasks to 3 to 10 people discuss those tasks in a separate chat tool. The reasons behind a change get lost there, and new team members cannot see why a task was done a certain way (BR-2). This is the team's own report, not measured data (see Problem).

### What changes

Once approved, the task app changes as follows:

- People comment on a task inside the app, where the task already lives (BR-1)
- A new team member reads the full discussion of a task and sees why it was done that way (BR-2)
- The owner and assignee of a task are told when someone comments (BR-3)
- Share of task changes with a written reason rises from an unknown start to 60% (SM-1)
- The chat tool stays in use for everything else (NG-1)

### Decisions for you

Two choices need your call:

1. Who is told about a new comment (Q-1)? Options: the owner and assignee only, or everyone who has commented. Recommendation: owner and assignee only, because it keeps alerts low; it costs the chance that a past commenter misses a reply.
2. Can people edit or delete their comments (Q-2)? Options: edit and delete allowed, or comments are permanent. Recommendation: permanent comments, because the reasons then stay trustworthy; it costs the ability to fix a typo.

### Not in this

The following are left out:

- Replacing the chat tool, or linking it to the app, because the chat tool serves other needs (NG-1)
- File attachments in comments, because text covers the stated need (NG-2)
- Comments by people outside the team, because the problem is internal (NG-3)
- Importing old chat history, because it would be costly and hard to match to tasks (NG-4)

## Problem

Team leads use the task app to assign tasks to 3 to 10 people. The app has no way to discuss a task, so people discuss tasks in a chat tool. When a task changes, such as a new owner, scope or due date, the reason stays in the chat thread and is soon buried. New team members open a task, cannot see why it was done a certain way, and must ask someone or guess. The cost is repeated questions, lost context and the risk that a settled decision gets reopened.

Evidence: the request from the team, received on 2026-11-19. Assumption: the problem is common across the team and costly enough to fix. No survey, chat count or interview has been done yet, so the baseline in SM-1 and SM-2 is UNKNOWN.

## Who it is for

The first users are team leads and their 3 to 10 team members. The situation is a task that is reassigned, rescoped or finished in a way that needs explaining. They want to record why in the place where the task lives. A second reader is a new team member, who wants to understand why an existing task was done a certain way without interrupting colleagues.

## Why now

Assumption: the team is growing and new members keep joining, so lost context costs more each month. This is the team's own account and not backed by a source. The request itself is the trigger for doing this now.

## Success

How success is measured:

| ID | Metric | Baseline | Target | How measured | Counter-metric |
|---|---|---|---|---|---|
| SM-1 | Share of task changes (new owner, scope or due date) that carry a written reason in the app | UNKNOWN | 60% within 3 months of release (Assumption) | Count of changed tasks with a comment within 1 day of the change, divided by all changed tasks, from the app's own data | Median days to complete a task must not rise by more than 10% |
| SM-2 | Questions a new team member asks in chat about why a task was done a certain way, in their first 30 days | UNKNOWN | Fewer than 2 per new member (Assumption) | A short survey of new members at day 30 | Share of new members who say they feel lost must not rise |

## Business requirements

- BR-1: Team members can discuss a task in the same place where the task is tracked. Source: the request from the team, 2026-11-19.
- BR-2: The reasons behind a task stay with the task, and anyone with access to the task, including people who join later, can read them. Source: the request from the team, 2026-11-19.
- BR-3: The people responsible for a task learn when someone discusses it, so a comment is not missed. Source: Assumption, since comments nobody sees do not capture reasons.
- BR-4: Only people who can already see a task can read or write its discussion. Source: Assumption, to keep the task app's existing access rules intact.

## Appetite and track

Appetite: four weeks of one team's time (Assumption). If it needs more, we cut scope rather than extend. Track: standard, because the work touches one existing app, has no outside customers and carries moderate risk.

## No-gos

- NG-1: Replacing the chat tool or linking it to the app. The chat tool serves other needs and the problem is where task reasons are kept.
- NG-2: File attachments in comments. Text covers the stated need, and files add storage and safety work.
- NG-3: Comments by people outside the team. The problem is internal and outside access needs its own review.
- NG-4: Importing old chat history. It would be costly and hard to match to tasks.

## Rabbit holes

- R-1: Alerts for every comment become noise and people ignore them. Handled by limiting alerts to the owner and assignee (Q-1).
- R-2: People keep discussing in chat out of habit, so SM-1 stays low. Handled by a release to one team first, then a check of SM-1 after 1 month before wider release.
- R-3: Edited or deleted comments erase the reasons we want to keep. Handled by the decision in Q-2.

## Hard questions

Not applicable — the work is internal and faces no customer outside the company.

## Sources

- The request from the team to add comments to the task app, received 2026-11-19. No document or link exists. All other claims above are marked as assumptions.

## Open questions

- Q-1: Who is told about a new comment: the owner and assignee only, or everyone who has commented? The product owner answers; it blocks BR-3.
- Q-2: Can people edit or delete their comments? The team lead answers; it blocks BR-2 and R-3.
