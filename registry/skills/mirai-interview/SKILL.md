---
name: mirai-interview
description: "How to interview the owner before writing a MIRAI brief, or before any step that needs the owner's decision: one question at a time, with lettered options and your guess, until you can predict the answers, then a restatement the owner confirms with an explicit yes. Every question and answer goes into interview.md beside the brief. Use it when a request is thin, or when setup's sources leave a gap."
---

# Interviewing the owner

A request names a thing ("tasks need due dates"). It rarely says who it's for, why now, how
success is measured or what is left out. Ask before you write, not after you build. This skill is
how MIRAI asks: one decision at a time, each with your guess, until you can predict the owner's
answers. The record goes into `interview.md`, and the brief can't be approved until it's
confirmed.

## When to use it

- **Nora, before a brief**, when the request is thin: it leaves out who it's for, why now, how
  success is measured, or what binds it.
- **Setup**, for the gaps its sources leave.
- **Any agent** that can't go on without a decision only the owner can make.

**Don't use it** for a clear, self-contained request ("rename this field"), a pure question
("how does the lint count words?"), or a mechanical change (a rename, a move, formatting).

## Before you ask

1. **Look the facts up yourself.** Read the code, the docs, the brief's sources and past
   decisions. Ask the owner only for decisions. A question whose answer is in the repo wastes the
   owner's time and shows you didn't look.
2. **Write your first guess** in one sentence, with a confidence number and what's missing:
   "First guess: team leads want to see what is due and what is late. Confidence: about 30%.
   Still open: who it's for, how success is measured, and whether people get reminded."
3. **Start `interview.md`** from the template (`.mirai/framework/registry/templates/interview.md`)
   at `docs/mirai/<initiative>/interview.md`, with `state: open`, the request word for word, and
   your first guess.

## Each question

Ask **one question per message**. An answer often changes the next question, and the owner
thinks better about one thing at a time.

Every question follows five rules:

1. **A header** naming what it's about: `## Feature: due dates on tasks (brief)`.
2. **A confidence line** with what's still open: "Confidence: about 70%. Still open: who gets
   reminders."
3. **"explain" gets plain words and an example**, then the same question again. "explain" is not
   an answer.
4. **One short "Your step" at the end:** what to reply, with the options repeated.
5. **The restatement before the owner's "yes" names what's not included** (below).

Give **two or three lettered options**. Mark one as your guess and give its reason. A short reply
is enough: "B", "yes" (your guess), or "B, but no email".

A question looks like this:

```markdown
## Feature: due dates on tasks (brief)

Confidence: about 60%. Still open: whether people get reminded, and what the lead sees.

**Q-3: Should the app remind the person a task is assigned to?**

- A: no reminder; overdue tasks are only marked in the list
- B: one reminder the day before the task is due
- C: reminders at times each person chooses

My guess: B. Leads said chasing people is the work they want gone, and C needs settings nobody
asked for.

Your step: reply A, B or C, or add a note ("B, but not on weekends"). "explain" gets an example;
"pause" saves and stops.
```

How to word the step and an explanation is in the [`mirai-write`](../mirai-write/SKILL.md) skill.
Follow it here too.

## Listening

Watch for an answer that sounds like best practice instead of a want: "scalable", "clean", "the
standard way", "I should probably …". Ask: "If you didn't have to justify this to anyone, what
would you want?" That one question often does more than the five before it.

Don't take your own guess as confirmed because the owner was polite. Now and then, guess in a
direction you expect the owner to push back on.

## The record: `interview.md`

Write it as you go: each question when you ask it, each answer as soon as it comes. Don't wait
for the end. A session can stop at any time.

Each question in the file has its heading, the question, the options, your guess with its reason,
and the owner's answer:

```markdown
### Q-3: Reminders

Confidence: about 60%. Still open: whether people get reminded, and what the lead sees.

Should the app remind the person a task is assigned to?

- A: no reminder; overdue tasks are only marked in the list
- B: one reminder the day before the task is due
- C: reminders at times each person chooses

Guess: B, because leads said chasing people is the work they want gone.

Answer: B. One reminder a day at most.
```

An open question keeps an empty `Answer:` line. Number the questions Q-1, Q-2, Q-3 with no gap.
The filled example is `.mirai/framework/registry/examples/interview.md`.

## When to stop: the 95% test

Stop asking when you can predict the owner's reaction to your next three questions. If you can't,
ask the next one. This is a test, not a feeling.

**The stuck check:** after three answered questions with no rise in your confidence, stop asking.
Say so, name what seems to be missing, and ask the owner how to go on. More questions of the same
kind won't help.

There is no limit on the number of questions.

## The restatement

Write back what the owner wants, in the owner's words, as six lines:

- **Outcome:** what is true when this is done.
- **Who it's for:** the people who benefit, and their situation.
- **Why now:** what changed.
- **Success:** how the owner will know it worked, with a number.
- **Limits:** the time, money or system limits that bind.
- **Not included:** what is left out on purpose. Never skip it: most misunderstandings are about
  what isn't built. If nothing is left out, write `None.` and why.

Then ask: "Is this right? Reply yes, or tell me what to change." Put the six lines under
`## Restatement` in `interview.md`.

## The yes

Only an explicit "yes" closes the interview. "Sounds good", "whatever you think", "sure, go" and
silence are not a yes. Ask once more, and name the choice: "Do you want A or B?" If the owner
corrects a line, fold it in and restate.

When the owner says yes, add `Confirmed: yes (YYYY-MM-DD)` under the restatement, with that day's
date, and set `state: confirmed`. Then stop and hand back: the brief comes next, from the
confirmed interview. The brief links it in the line under its title:
`Interview: [<the interview's title>](interview.md)`.

## Pause and resume

**Pause.** When the owner says "pause" (or "draft it"), write every question you still have into
`interview.md`, each with its options and your guess, and an empty `Answer:` line. Set
`state: paused`, and stop.

**Nothing moves on with an open question.** Don't write the brief until every question is
answered and the owner said yes. `mirai lint` fails an interview that isn't confirmed, and the
brief beside it can't be approved.

**Resume.** A new session reads `interview.md` first. It starts at the first open question, and
never asks an answered one again. Set `state: open` while you ask.

## Autonomous mode

With no one to ask (a non-interactive run), don't guess and don't draft. Write your questions into
`interview.md`, each with its options and your guess, set `state: paused`, and stop. Don't write
`[ASSUMPTION]` tags in place of an answer. Every open question blocks the feature until the owner
answers it.

## Checking it

- **You don't run `mirai`.** Ask the owner to run `mirai lint docs/mirai/<initiative>/interview.md`,
  and fix what it reports.
- **Don't edit** `.mirai/`, `AGENTS.md` or `CLAUDE.md`.

Credits for the sources behind this method are in [CREDITS.md](CREDITS.md).
