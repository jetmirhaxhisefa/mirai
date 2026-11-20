# Wording a brief

The brief says what the business needs and why, before anyone designs anything. Its form (the
sections, IDs and the summary's five parts) is in the template
`.mirai/framework/registry/templates/brief.md` and its checklist `brief-checklist.md`, next to it.
The `mirai-docs` skill explains both. This guide covers the wording.

## Rules

- **A problem sentence names a person and what it costs them.** "Team leads lose the reason for a
  change in the chat thread" says who and what. "Context gets lost" says neither.
- **A business requirement (BR) is an outcome, never a mechanism.** If it names a screen, a field
  or an API, it has started designing: move that to the PRD. Test: swap the product for another
  one; the BR should still be true.
- **Every claim carries its evidence or a label.** A source ("the team's request of 2026-11-19"),
  or "Assumption". Label a guess once; don't repeat that it's a guess.
- **"Why now" names what changed.** If nothing changed except that someone asked, say so: the
  trigger is the request.
- **"What changes" holds changes only:** what a person does differently once it's built. The
  outcome you measure goes in "The ask"; a limit goes in "Not in this".
- **A recommendation names its cost** in the same item: "Recommendation: X, because Y; it costs Z."

## Examples

Each example quotes a real agent draft as it was, then a fixed version, and the rule it teaches.

### Example 1: "What changes" holds changes only

**Rule:** "What changes" lists what a person does differently. The outcome you measure belongs in
"The ask", and a limit belongs in "Not in this", so neither is said twice.

**Before**, from `implementation/units/31-brief/p2-agent-brief.md`, "What changes" (the summary):

```markdown
Once approved, the task app changes as follows:

- People comment on a task inside the app, where the task already lives (BR-1)
- A new team member reads the full discussion of a task and sees why it was done that way (BR-2)
- The owner and assignee of a task are told when someone comments (BR-3)
- Share of task changes with a written reason rises from an unknown start to 60% (SM-1)
- The chat tool stays in use for everything else (NG-1)
```

**After:**

```markdown
In the task app:

- People comment on a task inside the app, where the task already lives (BR-1)
- A new team member reads the full discussion of a task and sees why it was done that way (BR-2)
- The owner and assignee of a task are told when someone comments (BR-3)
```

The 60% target is already in "The ask" (SM-1), and the chat tool is already under "Not in this"
(NG-1). The lead-in loses its padding.

**Checked by:** judgement.

### Example 2: one claim per sentence

**Rule:** a sentence in the summary carries one claim. Where a sentence joins two with "and",
split it at the join.

**Before**, from `implementation/units/31-brief/p2-agent-brief.md`, "Why" (the summary):

```markdown
Team leads who assign tasks to 3 to 10 people discuss those tasks in a separate chat tool. The reasons behind a change get lost there, and new team members cannot see why a task was done a certain way (BR-2). This is the team's own report, not measured data (see Problem).
```

**After:**

```markdown
Team leads who assign tasks to 3 to 10 people discuss those tasks in a separate chat tool. The reason for a change gets buried in the chat thread (BR-2). New team members then can't see why a task was done the way it was. This is the team's own report, not measured data (see Problem).
```

**Checked by:** the lint, `writing-sentence`.

### Example 3: "Why now" starts with the trigger

**Rule:** "Why now" names what changed, first. A guess is labelled once, and a sentence that only
repeats the label goes.

**Before**, from `implementation/units/31-brief/p2-agent-brief.md`, "Why now" (the detail):

```markdown
Assumption: the team is growing and new members keep joining, so lost context costs more each month. This is the team's own account and not backed by a source. The request itself is the trigger for doing this now.
```

**After:**

```markdown
The trigger is the team's request of 2026-11-19. Assumption: the team is growing, so each month more new members meet tasks whose reasons are lost.
```

**Checked by:** judgement.
