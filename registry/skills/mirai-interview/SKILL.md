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

## The intake (/mirai-new, /mirai-prd)

`/mirai-new "<request>"` is the neutral way in (`/mirai new` in the `/mirai` file). Before the
interview, propose how much process the request needs:

1. **Read first**: the context files and the code the request names.
2. **At most 2 intake questions**, in the questions' format (options, your guess, one at a time),
   only about what decides the track: how much it changes, and whether it needs a decision of the
   owner's. Fewer is better; none is fine.
3. **Propose a track, with its reason**, and ask the owner to confirm it:
   - `quick`: one ticket (a story, a bug, a technical change) that needs no PRD;
   - `standard`: a brief and a lite PRD, approved together ("standard: a new screen and a new
     rule; no new service");
   - `full`: the brief approved first, then a full PRD.

   **Never propose `quick` for a request your intake found unclear.** The one-ticket path asks at
   most 3 questions.
4. **Record it** at the top of `interview.md`, under `## Intake` (before `## Questions`): the
   intake questions as `### I-1`, `### I-2`, then

   ```markdown
   Track: standard, because a new screen and a new rule; no new service.

   Track confirmed: yes (2026-11-25)
   ```

   The brief's "Appetite and track" and its `track` say the same; the lint checks both.
5. **Then:**
   - `quick`: go on with "One ticket by hand" below, in the same `interview.md` with `for: ticket`.
     If you then see that 3 questions can't settle it, offer the `standard` track (change the
     intake's track to standard, drop `for: ticket`, and go on with the interview), never
     `/mirai-new` again;
   - `standard` or `full`: go on with the interview, the look-ahead included, then hand over to
     Nora.

`/mirai-prd "<request>"` skips the track question: the track is `standard`, unless the owner says
`full`. Write the intake with no question, its track line and the owner's yes.

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
4. **Read the business context before the first question** (unit 41): `.mirai/context/business.md`
   and `.mirai/context/journeys.md`. When the request contradicts one of them (business.md says
   "signed-in teams only", the request says "guests comment"), that contradiction is your **first
   question**: quote both sides, and offer "propose a change to business.md" as one of the
   options, beside keeping business.md and changing the request.
5. **The owner's own list.** When the owner gives a list of requirements (pasted, or a file), keep
   it: save a pasted list as `docs/mirai/<initiative>/requirements.md`, one requirement per line,
   word for word, then run `/mirai requirements <initiative>` (in a terminal: `mirai requirements
   <initiative>`, or `--from <file>` for a file), which numbers each line `REQ-1`, `REQ-2` …. Read
   it first, and ask only what it leaves open, or where two lines contradict each other or the
   context. Never ask the owner to repeat a line.

## When the owner chooses "propose a change to business.md"

business.md changes only through a proposal the owner approves on its own; neither you nor Nora
edits it. Write `docs/mirai/<initiative>/business-change.md` from its template
(`/mirai show template business-change`): for each change, the lines of business.md as they are
now under `Replace:`, the new text under `With:` (with its source ID, and a new row under
"Sources" when the source is new), `Source: you said, <date> (interview.md Q-n)` and `Why:`.
Record the answer in `interview.md` as usual.

- **Cover what the restatement allows.** The proposal changes business.md for everything the
  restatement says the request now allows, not only its headline: "guests see the whole task and
  every comment" needs both seeing and commenting in business.md.
- **Lint it before you hand it over:** `/mirai lint` (or `mirai lint
  docs/mirai/<initiative>/business-change.md`). The lint applies the proposal and lints business.md
  as it would become, with business.md's own rules (sentence length, the sources' form). Fix the
  `With:` text until it's clean.

Then tell the owner the approval command, for their terminal: `mirai approve --file
docs/mirai/<initiative>/business-change.md`. The brief can't be approved while the proposal is
open.

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

How to word the step and an explanation is in the [`mirai-write`](../mirai-write/SKILL.md) skill,
in its [session guide](../mirai-write/guides/session.md). Follow it here too.

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

## The look-ahead (before the restatement)

The writer (Nora) turns the interview into a brief and a PRD after the owner has walked away. Each
gap she meets then stops her work until the owner comes back. So before the restatement, look
ahead: read the PRD's checklist (`.mirai/framework/registry/templates/prd-checklist.md`, the
`[vera]` lines) against the answers so far, the way she and the verifier will read them.

For each item the answers leave open (who can see what, what happens at a limit, a time zone, what
someone who loses access still sees, how a success metric is measured …):

- **your guess is shaky** (no source points one way, or two would): ask it as a real question, as
  above, one at a time;
- **your guess is confident** (a source says it: business.md, journeys.md, the code, an earlier
  answer): write it as an assumption, with that source.

Then show the owner the whole list at once, numbered, and ask: "ok, or correct any by number":

```markdown
## Assumptions

- A-1: Only the task's owner sees its due date, as today's tasks. Source: the code (TaskPolicy). Approved: yes
- A-2: A due date is a calendar day in the owner's time zone. Source: Q-2. Approved: corrected: in UTC
```

On "ok", write `Approved: yes` on each. A correction by number ("2: in UTC") is an answer: write
`Approved: corrected: <their words>`, and fold it into the restatement. Put the list under
`## Assumptions`, right before `## Restatement`. `mirai lint` fails a confirmed interview with an
assumption that isn't approved. Never invent one to fill a gap: every assumption is shown and
approved, and a gap the look-ahead missed is still the writer's pause later. Leave the section out
when there is none. There is no cap on the list, and no approving one at a time.

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
date, and set `state: confirmed`.

**After the yes, the restatement is the owner's.** Any change to it after "Confirmed: yes", even a
rewording or a guess they accepted folded in, is shown to the owner line by line and confirmed
again before the record is final. Never change it and tell them afterwards. Then stop and hand back: the brief comes next, from the
confirmed interview. The brief links it in the line under its title:
`Interview: [<the interview's title>](interview.md)`.

## Handing over to Nora

In your own session, once the interview is confirmed, Nora (`mirai-product-manager`) writes the
brief and the PRD in the background:

1. **Commit first.** Every agent launch needs a clean tree. Commit `interview.md` (and
   `requirements.md` and `business-change.md` when there are any) on a branch for this feature,
   never on the integration branch: `git switch -c docs-<initiative>` when you're on it, then
   `git add docs/mirai/<initiative> && git commit -m "<initiative>: interview"`.
2. **Start her** with `/mirai write <initiative>` (MIRAI's `mirai_command` tool, command `write`).
   Your tool asks the owner to allow it.
3. **Follow her** with MIRAI's `mirai_status` tool and the request id, now and then. Her run takes a while:
   several launches, with MIRAI's lint, the verifier and the reader test between them.
4. **Tell the owner** when it ends, with the full path and the link of each document from its last
   lines:
   - **done:** "the brief and the PRD are ready to approve", and the approval command for their
     terminal;
   - **paused:** her question, which she added to `interview.md` (state `paused`). Resume the
     interview at that question (below), then start her again: she continues from the documents
     as they are;
   - **stopped:** why, as the output says it.

`/mirai show <initiative>` shows her state (running, paused with her question, done) at any time.

## Handing over to Tess

Once the owner has approved the PRD (`mirai approve <prd-id> --file …prd.md`, in their terminal),
Tess (`mirai-ticket-planner`) cuts it into an epic and its tickets in the background:

1. **Commit first,** on the feature's branch, as above.
2. **Start her** with `/mirai tickets <initiative>` (MIRAI's `mirai_command` tool, command
   `tickets`), and **follow her** with `mirai_status`, as for Nora.
3. **Tell the owner** when it ends, with each file's full path and link from its last lines:
   - **done:** "the epic and its tickets are ready to approve", and the approval command;
   - **paused:** her question about a gap in the PRD, which she added to `interview.md`. Resume
     the interview at it. The answer changes the PRD: start Nora (`/mirai write <initiative>`) to
     bring it in line, the owner approves the PRD again (it shows only what changed), then start
     Tess again (`/mirai tickets <initiative>`).

## One ticket by hand

When the owner asks for one ticket (`/mirai ticket "<one line>"`): a story, a bug or a technical
change that needs no PRD.

1. **Read first** (the context files, the code the line names), as above: ask only what's missing.
   **When 3 questions can't settle it, say so first.** If, after reading, you see that three
   questions can't settle the request ("make logging better": what, where, measured how?), say so
   up front, before asking anything, and offer two ways on: (a) a small feature through
   `/mirai-new`, with a full interview and no cap; (b) a sharper line from the owner, which you
   then take as a new `/mirai ticket`. Never write a ticket interview from a guess.
2. **At most 3 questions.** Pick the three that decide the ticket: what the reviewer must see to
   call it done, whether it's a story or a bug (something that works wrongly today), and the one
   limit or edge case that matters. Fewer is better. `mirai lint` fails a ticket interview with a
   fourth question.
3. **The record:** `interview.md` in a folder of its own under the docs root, named for the ticket
   in a few words (`docs/mirai/<name>/interview.md`), with `for: ticket` in its frontmatter, then
   the restatement and "Confirmed: yes (date)" as for any interview.
4. **Hand over:** commit it on a branch for this ticket, then `/mirai tickets <name>` with `one`
   (`mirai_command`, command `tickets`, `initiative` the folder's name, `one` true). Tess writes one
   lone ticket in `docs/mirai/tickets/`, with no epic, and MIRAI runs the lint and Vera on it. It
   doesn't pause: anything still open goes in the ticket's Notes.
5. **Tell the owner** its path and link, and the approval command: they approve it on its own
   (`mirai approve <KEY> --file docs/mirai/tickets/<KEY>.md`). It gets its own branch, and its
   documents travel in its code merge request.

## Questions from a finding

When the verifier's check of a document finds a decision only the owner can make (a scope, the
users or markets, money or law, a number no source gives, two sources that disagree, a trade-off),
Nora writes `(open)` in the document and asks it in `interview.md`, with two more lines:

```markdown
### Q-7: US orders and VAT

Finding: F2 (fp-0123456789abcdef): "The PRD charges VAT on every order"
Kind: audience

Do the tax rules cover orders from the EU only, or from the EU and the US?

- A: EU only for now
- B: EU and US
- C: the verifier is wrong
- D: not a decision, just fix it
- E: leave it open and accept it

Guess: A, because business.md names EU customers only.

Answer:
```

Ask it as any question, with all its options. The four kinds of answer:

- **an answer** (A or B here): it becomes the owner's source; Nora writes it in;
- **"the verifier is wrong"**: the finding is dismissed for this version, and not raised again;
- **"not a decision, just fix it"**: it goes back to Nora as a writing finding;
- **"leave it open and accept it"**: it moves to the document's Open questions, marked accepted by
  the owner.

Write the owner's answer after `Answer:`, and under it `Answer type: answered`, `vera-wrong`,
`not-a-decision` or `left-open`, for the option they chose. **Too many:** when a document has more
decisions than the project allows (`[docs] max_decision_questions`, 5 by default), MIRAI asks one
question instead (`Kind: reopen`): reopen the brief interview (A), or go on with them (B). On A,
resume the interview where it missed something, then hand over again.

## Pause and resume

**Pause.** When the owner says "pause" (or "draft it"), write every question you still have into
`interview.md`, each with its options and your guess, and an empty `Answer:` line. Keep every
section of the template, `## Restatement` included, with its lines still unfilled. Set
`state: paused`, and stop.

**Nothing moves on with an open question.** Don't write the brief until every question is
answered and the owner said yes. `mirai lint` fails an interview that isn't confirmed, and the
brief beside it can't be approved.

**Resume.** A new session reads `interview.md` first. It starts at the first open question, and
never asks an answered one again. Set `state: open` while you ask.
When Nora paused on a question, ask it the same way; when it's answered and the owner says yes
to the restatement again (amend it if the answer changes it), set `state: confirmed`, commit, and
start her again (`/mirai write <initiative>`).

## Autonomous mode

With no one to ask (a non-interactive run), don't guess and don't draft. Write your questions into
`interview.md`, each with its options and your guess, keep the template's `## Restatement`
unfilled, set `state: paused`, and stop. Don't write
`[ASSUMPTION]` tags in place of an answer. Every open question blocks the feature until the owner
answers it.

## Checking it

- **You don't run `mirai` from a shell.** In the owner's session use `/mirai lint` (the
  `mirai_command` tool); otherwise ask the owner to run `mirai lint docs/mirai/<initiative>/interview.md`.
  Fix what it reports.
- **Don't edit** `.mirai/`, `AGENTS.md` or `CLAUDE.md`.

Credits for the sources behind this method are in [CREDITS.md](CREDITS.md).
