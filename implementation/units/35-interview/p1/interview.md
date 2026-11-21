---
id: night-run-interview
type: interview
template: interview@v1
state: confirmed
owner: mirai-product-manager
created: "2026-11-20"
---
# Interview: night run, a batch of tickets in one run

## Questions

Request: "Night runs stop at a default time so they never run into my workday." (the owner, 2026-11-20)

First guess: an unattended overnight MIRAI run gets a default stop time (for example 07:00 local), stops cleanly when it is reached, and leaves the work in a state the owner can pick up in the morning. Confidence: about 30%. Still open: what "stop" means for work in progress, the default time and whether it can be changed per run, what the owner sees in the morning, and why it matters now.

Read before asking: this repo (`mirai-p35`) holds only the MIRAI templates, examples and skills. It has no night-run code, scheduler or config, so how night runs start today can't be checked here.

### Q-1: What "stop" means

Confidence: about 30%. Still open: what "stop" means for work in progress, the default time, what the owner sees in the morning, and why now.

When the stop time comes and an agent is halfway through a ticket, what should happen?

- A: hard stop: end the run at the stop time, even mid-ticket; unfinished work stays on its branch
- B: soft stop: start nothing new after the stop time, but let the ticket in progress finish
- C: soft stop with a limit: finish the ticket in progress, but end hard at a second, later time (for example 30 minutes after)
- D (added by the owner): no stop; the run goes on until the job is finished

Guess: C, because "never run into my workday" needs a hard guarantee, and a pure hard stop would leave half-done tickets every morning.

Answer: "I want to change the logic of night run. Night run does not mean that it is gonna run only at night. If I put a epic with tickets to be finished I could run it at day at time. The idea of the night run is to finish a bunch of tickets or a epic vs going ticket by ticket."

Note (2026-11-20): the owner first added D (no stop until the job is finished) and asked why a run should stop at all. After the reasons were explained, the owner replaced the request: a night run is a batch run over an epic or a set of tickets, at any time of day. A default stop time is no longer the request. Whether a batch run needs any limit (time, cost, failures) is still open and comes back later.

Revised request: "The idea of the night run is to finish a bunch of tickets or a epic vs going ticket by ticket." (the owner, 2026-11-20)

Revised first guess: the owner wants to hand MIRAI a whole epic or a list of tickets and have it work through all of them in one run, at any time of day, without starting each ticket by hand. Confidence: about 35%. Still open: what hurts about going ticket by ticket today, where the run must stop for the owner, what happens when one ticket fails, and how success is measured.

### Q-2: What hurts about going ticket by ticket

Confidence: about 35%. Still open: what hurts today, where the run must stop for the owner, what happens when a ticket fails, and how success is measured.

What is the main problem with going ticket by ticket today?

- A: you have to be there: you start each ticket, wait, approve it and start the next, so a 10-ticket epic takes your whole day
- B: context is lost: each ticket starts fresh, so the agent doesn't carry what it learned in T-1 into T-2, and tickets that depend on each other come out inconsistent
- C: it's slow: tickets run one after another, when independent ones could run side by side

Guess: A, because the name "night run" suggests work that goes on while you are away.

Answer: A and C.

### Q-3: Where the run waits for the owner

Confidence: about 50%. Still open: where the run waits for the owner, what happens when a ticket fails, how results are reviewed, and how success is measured.

During a batch run, when should the run wait for the owner?

- A: never: it runs to the end and the owner reviews everything afterwards
- B: only when blocked: a ticket that needs the owner's decision waits, the other tickets carry on, and the owner answers when back
- C: at the usual gates: each ticket still waits for approval at the same points as today, but the next ticket starts on its own

Guess: B, because the owner wants to stop being there for each ticket (Q-2, A), and A would have the agent guess on decisions only the owner can make.

Answer: B.

### Q-4: When a ticket fails

Confidence: about 50%. Still open: what happens when a ticket fails, how results are reviewed, what limits a run, why now, and how success is measured.

When one ticket in the batch fails (tests stay red, or the agent gives up), what should happen to the rest?

- A: the failed ticket stops and is marked; every ticket that doesn't depend on it carries on
- B: the whole run stops at the first failure
- C: the agent retries the failed ticket a set number of times, then does A

Guess: C, because a single flaky test shouldn't cost a ticket, and stopping everything (B) would undo the point of a batch.

Answer: "C. But it should have a hard limit, as everything else in MIRAI."

Note (2026-11-20): this repo has no existing retry limit to reuse, so the number of retries gets set in the PRD.

### Q-5: How the owner reviews the results

Confidence: about 55%. Still open: how results are reviewed, what limits a run, why now, and how success is measured.

How do you want to review what a batch run produced?

- A: one pull request per ticket, plus one summary of the whole run
- B: one pull request for the whole epic
- C: one pull request per ticket, merged on their own when tests and lint pass

Guess: A, because tickets run side by side (Q-2, C) and each needs its own branch, and a summary saves opening every PR to see what happened.

Answer: A.

### Q-6: What limits a run

Confidence: about 55%. Still open: what limits a run, why now, and how success is measured.

A batch run has no stop time now. Should anything else limit it?

- A: only the retry limit from Q-4; otherwise it runs until every ticket is done, failed or blocked
- B: a hard limit on how many tickets run side by side, so a run doesn't use up the usage quota you need for your own work
- C: B, plus a hard cost or usage limit per run (for example a token budget); when it is reached, the run starts no new tickets

Guess: C, because the owner wants a hard limit on everything in MIRAI (Q-4), running tickets side by side (Q-2, C) multiplies usage, and a cap on parallel tickets alone doesn't stop a long run from costing too much.

Answer: C.

### Q-7: Why now

Confidence: about 60%. Still open: why now, and how success is measured.

What makes this worth doing now?

- A: an epic is coming up that is too big to take ticket by ticket
- B: going ticket by ticket already takes too much of your day, and it gets worse as more work goes through MIRAI
- C: you want MIRAI to work while you are away (overnight, weekends, meetings) so its output is ready when you're back

Guess: B, because the main pain named in Q-2 is having to be there for each ticket.

Answer: C.

Note (2026-11-20): the guess was wrong. The "night" in night run stays as the reason: MIRAI works while the owner is away. Running at any time of day (Q-1) is still part of it.

### Q-8: How success is measured

Confidence: about 65%. Still open: how success is measured.

How will you know the night run works?

- A: an epic of about 10 tickets finishes in one run with you spending no more than 30 minutes on it before the review
- B: the time from "epic approved" to "all tickets ready for review" drops by half
- C: when you come back, at least 8 of 10 tickets in the batch are ready to review, and the other 2 are marked failed or blocked with the reason

Guess: C, because the reason for doing this now is having the output ready when the owner is back (Q-7, C), and blocked or failed tickets are expected (Q-3, Q-4).

Answer: C.

## Restatement

- Outcome: the owner hands MIRAI an epic or a list of tickets, and MIRAI works through all of them in one run, at any time of day, without the owner starting each ticket. Tickets that don't depend on each other run side by side. A ticket that needs the owner's decision waits while the others carry on. A failed ticket is retried up to a set limit and then marked as failed, and the tickets that don't depend on it carry on. The run produces one pull request per ticket and one summary of the whole run.
- Who it's for: the owner of MIRAI, who today has to start, wait for and approve each ticket by hand, so an epic takes a whole day.
- Why now: the owner wants MIRAI to keep working while they're away (overnight, weekends, meetings), so the output is ready when they're back.
- Success: when the owner comes back, at least 8 of 10 tickets in the batch are ready to review, and the other 2 are marked failed or blocked with the reason.
- Limits: every limit is hard, as everywhere else in MIRAI. Each failed ticket gets a set number of retries, only a set number of tickets run side by side, and each run has a cost or usage budget. Once the budget is reached, the run starts no new tickets.
- Not included: a default stop time or a night-only window (dropped at Q-1); merging pull requests automatically; one pull request for the whole epic; the agent deciding questions that are the owner's to answer; carrying what the agent learned in one ticket into the next (Q-2, B was not chosen).

Confirmed: yes (2026-11-20)
