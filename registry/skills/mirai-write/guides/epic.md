# Wording an epic

The epic is the set of tickets for one PRD: their order, how they are released, and what needs
the owner's call. Its form (the summary, Order, Release, the generated tables) is in the template
you're given, or `mirai show template epic`, and its checklist, `mirai show checklist epic`.
The `mirai-docs` skill explains both. This guide covers the wording.

## Rules

- **The epic's sentences are about the set.** The PRD holds why the work exists. The epic's "Why"
  says why this split and this order.
- **One change per bullet** in "What changes", each ending with its tickets and requirements:
  `(TC-2; FR-1, FR-2)`. A second change after ";" is hidden from the owner.
- **Field values in words.** `risk: high` and `e2e: true` are frontmatter. In the summary, write
  "high risk" and "gets an end-to-end test", and say why in plain words.
- **Each item under "Not in this" names its reason,** as in the PRD.
- **Ticket names say what someone can do after the ticket,** not the layer it touches
  ("Front end", "Bugs" and "Cleanup" never finish).

## Examples

Each example quotes a real agent draft as it was, then a fixed version, and the rule it teaches.

### Example 1: field values in words

**Rule:** the summary is for a person. Frontmatter syntax (`risk: high`, `e2e: true`) is written
out as words, with the reason in plain language.

**Before**, from `implementation/units/33-epic/p2/epic-task-comments.md`, "Decisions for you" (the summary):

```markdown
2. Access control (TC-3) is risk: high: a mistake leaks comments to people who cannot see the task.
3. Task deletion (TC-7) is risk: high: it deletes data, and a mistake leaves comments readable or removes the wrong ones.
4. The comment journey (TC-2) is e2e: true: it creates the new journey of writing and reading a reason on a task.
```

**After:**

```markdown
2. Access control (TC-3) is high risk: a mistake would show comments to people who can't see the task.
3. Deleting a task's comments (TC-7) is high risk: a mistake would leave comments readable, or delete the wrong ones.
4. The comment journey (TC-2) gets an end-to-end test, because it is the new way to record a reason.
```

**Checked by:** judgement.

### Example 2: one change per bullet

**Rule:** each bullet under "What changes" holds one change. A second change joined with ";"
gets its own bullet and its own IDs.

**Before**, from `implementation/units/33-epic/p2/epic-task-comments.md`, "What changes" (the summary):

```markdown
- Viewers write comments and read all of them, oldest first, with author and time; comments cannot be edited or deleted (TC-2; FR-1, FR-2, FR-3, FR-5)
```

**After:**

```markdown
- Viewers write comments and read all of them, oldest first, with author and time (TC-2; FR-1, FR-2, FR-3)
- Comments can't be edited or deleted (TC-2; FR-5)
```

**Checked by:** the lint, `writing-sentence`.

### Example 3: "Why" explains the split, not the work

**Rule:** the owner has just approved the PRD. The epic's "Why" doesn't retell what is built; it
says why the tickets are cut and ordered this way.

**Before**, from `implementation/units/33-epic/p2/epic-task-comments.md`, "Why" (the summary):

```markdown
The set builds plain-text comments on a task, with access rules, notifications and failure handling. A thin write-and-read path comes first, then access control, the riskiest part. The rest builds on that path and can run side by side. The PRD holds the reasons and evidence.
```

**After:**

```markdown
A thin write-and-read path comes first (TC-2), so every other ticket builds on working code. Access control follows (TC-3), because it is the part the team is least sure of. The other tickets then run side by side.
```

**Checked by:** judgement.
