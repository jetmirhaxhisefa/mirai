# Wording a technical note

The technical note says how a `standard` feature is built, on one page, before its tickets are cut.
The owner reads it in about five minutes and corrects the approach. Tess cuts along it, Kai's plans
cite its decisions, and Rex checks the code against them. Its form is in the template you're given,
or `mirai show template tech-note`, with its checklist, `mirai show checklist tech-note`. This guide
covers the wording.

## Rules

- **Read the code before the PRD's premise.** A note that builds on something the app doesn't have
  (teams, email, a scheduler) says so in its Approach, and the gap is the owner's decision, not a
  quiet addition. A note that has to build a missing model is usually a `full` feature.
- **Every component cites its file,** and the bullet says what changes there. A file to be created
  ends with `(new)`.
- **The API names every field the components take.** A field a component reads but no endpoint
  accepts can't be set.
- **New work names what runs it.** A job, a schedule or a listener needs the process that runs it,
  and that process is a component too.
- **A data change says how existing rows get their values,** and whether it can be undone.
- **A decision is one line, the choice and its reason.** A decision that is hard to reverse,
  cross-cutting, about an NFR, an external dependency or the first of its kind is an ADR, linked from
  its line.

## Examples

Each example quotes a real draft as it was, then a fixed version, and the rule it teaches.

### Example 1: the API names every field the components take

**Rule:** the API section lists every field a component reads. Here the model gained an assignee,
and no endpoint could set one.

**Before**, from `implementation/units/62b-tech-note/p1/tech-note-r1.md`, "API and contracts" (the detail):

```markdown
- `POST /api/tasks` and `PUT /api/tasks/{task}`: accept `due_date` as `YYYY-MM-DD` or null; a past date answers 422 with the reason.
```

**After:**

```markdown
- `POST /api/tasks` and `PUT /api/tasks/{task}`: accept `due_date` as `YYYY-MM-DD` or null, and `assignee_id`, a member of the task's team. A past date answers 422 with the reason.
```

**Checked by:** judgement.

### Example 2: new work names what runs it

**Rule:** a job needs something that queues it and a process that runs it. Each is a component,
with its file.

**Before**, from `implementation/units/62b-tech-note/p1/tech-note-r1.md`, "Components touched" (the detail):

```markdown
- `backend/app/Jobs/SendDueReminder.php` (new): one email for one assignee, retried an hour later.
```

**After:**

```markdown
- `backend/app/Console/Commands/QueueDueReminders.php` (new): at each team's day end, queues one job per assignee with open tasks due the next day.
- `backend/routes/console.php` (new): runs that command every 15 minutes, so each team's midnight is caught.
- `backend/app/Jobs/SendDueReminder.php` (new): one email for one assignee, retried once an hour later.
- `docker-compose.yml`: adds a `worker` service running the queue, and a `scheduler` service running the schedule.
```

**Checked by:** judgement.

### Example 3: a data change says how existing rows get their values

**Rule:** a new table or column says what the rows that exist today hold after the migration, and
whether the down migration undoes that too.

**Before**, from `implementation/units/62b-tech-note/p1/tech-note-r1.md`, "Data changes" (the detail):

```markdown
- `backend/database/migrations/2026_11_26_100000_create_teams.php` (new): `teams` and `team_user` with a `role` of lead or member, reversible: the down migration drops both.
```

**After:**

```markdown
- `backend/database/migrations/2026_11_26_100000_create_teams.php` (new): `teams` with a `time_zone`, and `team_user` with a `role` of lead or member. Each existing user gets a team of one, as its lead. Reversible: the down migration drops both tables.
```

**Checked by:** judgement.
