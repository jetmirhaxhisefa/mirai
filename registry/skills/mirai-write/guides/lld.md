# Wording an LLD

The LLD holds the exact shapes a `full` initiative's tickets share: names, contracts (`C-n`),
schema changes (`S-n`), failures and a test map. Tickets built in parallel by different agents
agree because they build from it. It decides nothing: the HLD and the ADRs decide; the LLD gives
the shapes. Its form is in the template you're given, or `mirai show template lld`, with its
checklist, `mirai show checklist lld`. This guide covers the wording.

## Rules

- **Exact, not described.** A field has its type, whether it's required, and its limits. "a date"
  is a guess; "`due_date`: string `YYYY-MM-DD` or null, optional: absent keeps it, null clears
  it" is a shape.
- **Every limit has its failure.** A limit in a request (a length, a format, an owner) has a row in
  the failure table and a row in the test map. A builder shouldn't have to guess its status.
- **One error shape, or say each.** When two kinds of refusal carry different bodies (a validation
  error, an authorization error), give each body.
- **The LLD decides nothing.** A choice the HLD didn't make (a disabled button, a new retry
  rule) is not the LLD's to make: cite the `D-n` or ADR that made it, or ask in interview.md.
- **"Not applicable" names the trigger.** A section that doesn't apply says why in one line.

## Examples

Each example quotes a real draft as it was, then a fixed version, and the rule it teaches.

### Example 1: every limit has its failure row

**Rule:** a limit in a request has a failure row and a test-map row, so a builder doesn't guess.

**Before**, from `implementation/units/63-lld/p1/lld-r1.md`, "Contracts" (the detail):

```markdown
| a date before the owner's today | 422 | `due_date` (the field's error) | no |
| a date that isn't `YYYY-MM-DD` | 422 | `due_date` | no |
| no title | 422 | `title` | no |
```

**After:**

```markdown
| a date before the owner's today | 422 | `due_date` (the field's error) | no |
| a date that isn't `YYYY-MM-DD` | 422 | `due_date` | no |
| no title | 422 | `title` | no |
| a title over 120 characters | 422 | `title` | no |
```

**Checked by:** judgement.

### Example 2: two refusal bodies, both given

**Rule:** "every refusal is X" must be true. A 403 that carries another body gets its own line.

**Before**, from `implementation/units/63-lld/p1/lld-r1.md`, "Contracts" (the detail):

```markdown
Every refusal is Laravel's validation body: `{ "message": string, "errors": { field: [string] } }`; the message for a past date is "Due dates can't be in the past."
```

**After:**

```markdown
A 422 is Laravel's validation body: `{ "message": string, "errors": { field: [string] } }`. A past date gets the message "Due dates can't be in the past." exactly, full stop included. A 403 is Laravel's authorization body, `{ "message": "This action is unauthorized." }`, as `complete` answers today.
```

**Checked by:** judgement.

### Example 3: the retry line decides nothing new

**Rule:** a `Retry:` line says how a repeat behaves. A new safeguard is a decision for the HLD, not
something the LLD adds.

**Before**, from `implementation/units/63-lld/p1/lld-r1.md`, "Contracts" (the detail):

```markdown
Retry: a repeated create makes a second task, as it does today; the form sends it once and disables its button while it waits.
```

**After:**

```markdown
Retry: a repeated create makes a second task, as it does today; the HLD changes nothing here.
```

**Checked by:** judgement.
