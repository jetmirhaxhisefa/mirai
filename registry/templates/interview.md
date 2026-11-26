---
id: initiative-interview
type: interview
template: interview@v2
state: confirmed
owner: mirai-product-manager
created: "2026-01-01"
---
<!--
The interview template (MIRAI, unit 35). The method is the mirai-interview skill. Replace every
line below; keep the headings. mirai lint flags any line or the id left word for word.
- Where it lives: docs/mirai/<initiative>/interview.md, beside the brief. The brief links it in
  the line under its title: Interview: [<this title>](interview.md).
- state: open while you ask; paused when the owner says "pause", or when no one can be asked
  (autonomous mode); confirmed once every question is answered and the owner said "yes" to the
  restatement. Start with state: open.
- Write the file as you go: each question when you ask it, each answer as soon as it comes.
- Each question: ### Q-n: <what it is about>, then the question, two or three lettered options,
  the guess with its reason, and the answer. Number them Q-1, Q-2, Q-3 with no gap.
- An open question keeps an empty "Answer:" line. "explain" and "pause" are not answers.
- The lint fails any interview that isn't confirmed, and the brief beside it can't be approved
  until it is.
- Intake (unit 44): only when the request came in through /mirai-new or /mirai-prd. At most 2
  questions (### I-1, ### I-2, in the questions' format), then the track you propose with its
  reason, and the owner's yes to it. Leave the section out otherwise.
- Assumptions (unit 44): before the restatement, read the PRD's checklist against the answers;
  ask what your guess is shaky on, and list what you're confident of as A-1, A-2 …, each with its
  source. The owner approves the list with "ok" (Approved: yes on each) or corrects it by number
  (Approved: corrected: <their words>). Leave the section out when there are none.
- A question from a verifier finding (unit 44) adds Finding:, Kind: and, once answered, Answer
  type:, and its options are always the four answers.
-->
# Interview: the request, in a few words

## Intake

<!-- done when: at most two intake questions, each with options, a guess and the owner's answer; the track proposed with its reason; the owner's yes to the track with its date -->
### I-1: How big it is

What does the request change?

- A: one screen or rule, as one ticket
- B: a new screen and a new rule

Guess: B, because of what you read in the code.

Answer: The owner's reply, in their words.

Track: standard, because of a one-line reason.

Track confirmed: yes (2026-01-01)

## Questions

<!-- done when: the request is quoted as the owner gave it, with the first guess and its confidence -->
Request: "The request, word for word as the owner gave it." (the owner, 2026-01-01)

First guess: what you think the owner wants, in one sentence. Confidence: about 30%. Still open: what you can't tell yet.

### Q-1: What the question is about

<!-- done when: one decision only the owner can make; two or three lettered options; the guess names one option and says why; the answer is the owner's reply, in their words -->
Confidence: about 50%. Still open: what this question settles.

The question, in one sentence?

- A: the first option
- B: the second option
- C: the third option, if there is one

Guess: A, because of what you read in the code, the docs or the sources.

Answer: The owner's reply, in their words.

## Assumptions

<!-- done when: each item of the PRD's checklist the answers leave open is a question above (a shaky guess) or an assumption here (a confident one); each assumption has its source; the owner approved the list with "ok", or corrected one by number -->
- A-1: What you take as true, in one sentence. Source: where it comes from (business.md, the code, an answer). Approved: yes

## Restatement

<!-- done when: the six lines say what the owner wants in their words; "Not included" names what is left out (or None. with the reason); the last line records the owner's explicit yes and the day -->
- Outcome: what the owner wants to be true when this is done.
- Who it's for: the people who benefit, and their situation.
- Why now: what changed that makes this worth doing now.
- Success: how the owner will know it worked, with a number.
- Limits: the time, money or system limits that bind.
- Not included: what is left out on purpose, and why.

Confirmed: yes (2026-01-01)
