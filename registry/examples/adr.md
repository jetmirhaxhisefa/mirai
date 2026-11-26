---
id: ADR-0001
type: adr
template: adr@v1
status: proposed
upstream: [due-dates-prd]
date: "2026-11-26"
decision_makers: [the team lead, the architect]
confidence: high
gate: [hard-to-reverse, nfr]
initiative: due-dates
components: [reminders]
owner: mirai-architect
created: "2026-11-26"
---
# Send due-date reminders from a queue worker

PRD: [Tasks with due dates that people finish on time](../mirai/due-dates/prd.md)

## Summary

In the context of the daily reminder emails, facing reminders lost when one nightly run fails, we decided for a queue worker that sends each email as its own job to achieve a retry per email, accepting one more process to run and watch.

## Context and problem

Each assignee gets one email a day listing their tasks due next day (FR-4). A failed email is retried an hour later and recorded (FR-7). The app has no background jobs today, so the first one sets how later jobs run.

## Options considered

### A nightly cron command

- Good, because it needs nothing new: the server already runs cron.
- Bad, because a run that stops halfway leaves the rest of that night's emails unsent, and the retry of one email needs its own bookkeeping.

### A queue worker, one job per email

- Good, because each email is retried on its own, an hour later, as FR-7 asks.
- Good, because later background work uses the same worker.
- Bad, because operations run and watch one more process.

### Do nothing: send the emails from the web request that ends the day

- Good, because it adds no process.
- Bad, because no request ends the day, so the emails would depend on someone using the app.

## Decision

We chose the queue worker because it retries each email on its own, which FR-7 needs, and later background work can use it.

## Consequences

- Good, because one failed email no longer stops the others.
- Bad, because the deployment gains a worker process, with its own logs and its own restart.
- Neutral, because the cron entry that starts the day's run stays, and only queues the jobs.

## Confirmation

review: each change to the reminders sends emails as queued jobs, one per assignee, never from a request or the cron command itself.

## Revisit when

- The queue's backlog stays over 1,000 jobs for a day.
- A second kind of background work needs a schedule the worker can't give.

## Links

- [The due-dates PRD](../mirai/due-dates/prd.md)
