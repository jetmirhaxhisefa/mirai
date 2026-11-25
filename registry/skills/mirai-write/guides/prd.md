# Wording a PRD

The PRD says what the product must do, for whom, and how each requirement is checked. Its form
(the requirement groups, IDs, the glossary and the summary) is in the template
you're given, or `mirai show template prd`, and its checklist, `mirai show checklist prd`. The
`mirai-docs` skill explains both. This guide covers the wording.

## Rules

- **One requirement, one sentence, one "must".** A requirement says "must" or "must not". "Should"
  and "may" mean nobody decided: decide it, or make it an open question. ("Shall" fails the lint.)
- **Name the actor.** "When …, the system must …" or "A team member who can see a task can …".
  Never a passive with no actor.
- **An exception or a second duty gets its own sentence, or its own requirement.** "…, but none
  to the author" inside the main clause makes a sentence no one can check in one test. A failure
  is its own "If …, then the system must …" requirement.
- **An AC's "Given … when … then …" is one sentence for the lint** (25 words at most). When it runs
  longer, end the sentence after "then …" and put the rest of the outcome in a second sentence,
  as Example 3 does. Keep every condition and every outcome; never drop one to fit (unit 34's P3).
- **Every AC's outcome can be observed** (unit 42): "then the reminders are sent reliably" fails
  the lint (`prd-ac-untestable`); "then Ana gets one email naming both" passes. A vague word needs
  a number. A loose bullet under an AC is part of it, and is checked the same way.
- **Exact values, quoted.** A message the user sees is written in quotes, word for word. A limit
  has its number and its unit ("2,000 characters").
- **No escape clauses or open ends.** "Where possible", "as appropriate", "if necessary",
  "including but not limited to" and "etc." leave the builder to decide.
- **One term per concept, the glossary's.** If the glossary says "can see a task", don't switch to
  "has access" or "viewer" halfway.
- **On `standard`, the PRD's summary covers the brief too.** Its "Not in this" carries the brief's
  no-gos with their reasons; don't shorten them to IDs.

## Examples

Each example quotes a real agent draft as it was, then a fixed version, and the rule it teaches.

### Example 1: one requirement per sentence

**Rule:** a requirement states one duty. A second duty ("and offer no edit or delete") is a
second requirement, with its own ID and its own criterion.

**Before**, from `implementation/units/32-prd/p2-agent-prd.md` at commit `c92cd80` (P2 round 3, before its fixing round), "Triggers and states" (the detail):

```markdown
- FR-6: When a comment is posted, the system must keep it, with its author, time and text, unchanged for as long as the task exists, and offer no edit or delete. (BR-2) (A-2)
```

**After:**

```markdown
- FR-6: When a comment is posted, the system must keep its author, time and text unchanged while the task exists. (BR-2) (A-2)
- FR-18: The system must offer no way to edit or delete a posted comment. (BR-2) (A-2)
```

**Checked by:** the lint, `writing-sentence`.

### Example 2: every item left out has its reason

**Rule:** each item under "Not in this" is one thing, with the reason it is left out. A list of
IDs with no reasons asks the owner to look each one up.

**Before**, from `implementation/units/32-prd/p2-agent-prd.md`, "Not in this" (the summary):

```markdown
- Live updates, email or chat notices, replies, mentions and comment search, (NG-5, NG-6, NG-7, NG-8)
```

**After:**

```markdown
- Live updates without a reload, because the brief doesn't ask for them (NG-5)
- Email or chat notices, because in-app notices cover BR-3 within the appetite (NG-6)
- Threads, mentions and reactions, because plain comments cover the need (NG-7)
- Searching inside comments, because the brief asks only to read a task's discussion (NG-8)
```

The reasons are the PRD's own, from NG-5 to NG-8 in its detail.

**Checked by:** judgement.

### Example 3: the exact message, in quotes

**Rule:** when the user sees a message, the requirement quotes it word for word. "Say why" and "a
message says text is needed" leave the builder to write the product's words.

**Before**, from `implementation/units/32-prd/p2-agent-prd.md` at commit `4cb2003` (P2 round 1), "Failures" (the detail):

```markdown
- FR-8: If a comment is empty or only spaces, then the system must refuse it and say why. (BR-1)
  - AC-FR-8.1: Given Ana can see T, when she submits only spaces, then no comment is added and a message says text is needed.
```

**After:**

```markdown
- FR-8: If a comment is empty or holds only spaces, then the system must refuse it. It must show "Write a comment before posting." (BR-1)
  - AC-FR-8.1: Given Ana can see T, when she submits only spaces, then no comment is added. The message "Write a comment before posting." shows.
```

The message is the one P2's later round chose (its FR-10).

**Checked by:** judgement.
