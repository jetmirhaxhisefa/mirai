# Wording an HLD

The HLD says how a `full` feature is built: its components, flows, data, the rules every part
follows, its decisions and a trace of every requirement to a component. The owner reads its summary
to approve it in about 15 minutes; the agents build from the detail. Its form is in the template
you're given, or `mirai show template hld`, with its checklist, `mirai show checklist hld`. This
guide covers the wording.

## Rules

- **Read the code before you design.** "Current state" says what the code does today where the
  design touches it, each claim with `path:line`. A file the code names but the repo lacks is said
  so, not called new.
- **Every behaviour change is the owner's to see.** A change to what the app does today (a check
  added, a rule loosened) goes under "Decisions for you" with its options, never only in a D-n line.
- **The summary holds the trade-offs.** What a rollback loses, the release order and any fallback
  the design relies on are in the summary, not only in the detail.
- **Every write path has its flow.** Create and edit each get their validation and their refusals;
  a flow shows each refusal and its status.
- **One sentence per decision, the choice and its reason.** A choice that is hard to reverse,
  cross-cutting, about an NFR, an external dependency or the first of its kind is an ADR, linked from
  its D-n line.

## Examples

Each example quotes a real draft as it was, then a fixed version, and the rule it teaches.

### Example 1: a behaviour change is a decision for the owner

**Rule:** a check the app doesn't do today is a change of behaviour. It goes under "Decisions for
you" with its options, not only in a D-n line.

**Before**, from `implementation/units/62-hld/p1/hld-r1.md`, "Decisions for you" (the summary):

```markdown
1. How does the app know the owner's today (ADR-0001)? A: the browser sends its time zone with each write (recommended). B: a time zone stored on each user. C: every date judged in UTC. Written for: A.
```

**After:**

```markdown
1. How does the app know the owner's today (ADR-0001)? A: the browser sends its time zone with each write, and the server uses UTC without one (recommended). B: a time zone stored on each user. C: every date judged in UTC. Written for: A.
2. Should editing a task check its owner, which it doesn't today (D-5)? A: yes, as completing and deleting already do (recommended). B: no, leave the edit as it is. Written for: A.
```

**Checked by:** judgement.

### Example 2: the summary says what a rollback loses

**Rule:** a cost the owner accepts by approving (data a rollback drops, the release order) is in the
summary, where they decide.

**Before**, from `implementation/units/62-hld/p1/hld-r1.md`, "What changes" (the summary):

```markdown
- A task without a date is shown and sorted as today (D-4)
```

**After:**

```markdown
- A task without a date is shown and sorted as today (D-4)
- It ships in two steps: the migration first, then the API and the list together (D-2)
- Rolling back drops the column, and every date set with it (D-2)
```

**Checked by:** judgement.

### Example 3: every write path has its rules

**Rule:** create and edit each name their validation. A rule the code has today (a title's length)
is carried, and a file the code imports but the repo lacks is said so.

**Before**, from `implementation/units/62-hld/p1/hld-r1.md`, "Building blocks" (the detail):

```markdown
| The task requests | Validate the title and the due date | The app team | (new) `backend/app/Http/Requests/UpdateTaskRequest.php` |
```

**After:**

```markdown
| The task requests | Validate the title (at most 120 characters; required on create, and on edit only when sent) and the due date | The app team | (new) `backend/app/Http/Requests/StoreTaskRequest.php`, `backend/app/Http/Requests/UpdateTaskRequest.php` |
```

**Checked by:** judgement.
