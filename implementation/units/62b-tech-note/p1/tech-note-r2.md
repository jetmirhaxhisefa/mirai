---
id: due-dates-tech-note
type: tech-note
template: tech-note@v1
owner: mirai-architect
created: "2026-11-26"
upstream: [due-dates-prd]
---
# Due dates: teams first, then dates, then nightly reminders

PRD: [Tasks with due dates that people finish on time](prd.md)

## Approach

The app has no teams or assignees today: every task belongs to the user who made it. So the work starts with a team, its members and a task assignee, then adds a nullable due date, then the overdue page, then the reminders. Reminders run as one queued job per assignee each night. Login, the task title rules and a task without a date stay as they are.

## Components touched

- `backend/database/migrations/2026_10_23_100000_create_tasks_table.php`: left as it is; the new columns come in their own migrations.
- `backend/app/Models/Task.php`: adds `due_date`, `team_id` and `assignee_id`, the date cast and an overdue scope.
- `backend/app/Models/Team.php` (new): a team, its members and its lead.
- `backend/app/Policies/TaskPolicy.php`: today only the owner may change a task; the lead and the creator in the team may set the date.
- `backend/app/Http/Controllers/TaskController.php`: accepts `due_date`, refuses a date before today, and lists the team's overdue tasks.
- `backend/routes/api.php`: adds `GET /api/tasks/overdue` and `PATCH /api/user/reminders`.
- `backend/app/Console/Commands/QueueDueReminders.php` (new): at each team's day end, queues one job per assignee with open tasks due the next day, once a day.
- `backend/routes/console.php` (new): runs that command every 15 minutes, so each team's midnight is caught.
- `backend/app/Jobs/SendDueReminder.php` (new): one email for one assignee, retried once an hour later.
- `backend/app/Http/Controllers/ReminderSettingsController.php` (new): turns the user's reminders off and on.
- `docker-compose.yml`: adds a `worker` service running the queue, as ADR-0001 says.
- `frontend/src/api.ts`: sends and reads `due_date`, and fetches the overdue list.
- `frontend/src/components/TaskList.tsx`: shows the date and marks a late task.

## Data changes

- `backend/database/migrations/2026_11_26_100000_create_teams.php` (new): `teams` with a `time_zone`, and `team_user` with a `role` of lead or member; it gives each existing user a team of one, as its lead, reversible: the down migration drops both tables.
- `backend/database/migrations/2026_11_26_100001_add_due_dates_to_tasks.php` (new): nullable `team_id`, `assignee_id` and `due_date` on `tasks`, with an index on `due_date`; each existing task gets its owner's team and its owner as assignee, reversible: the down migration drops the columns.
- `backend/database/migrations/2026_11_26_100002_add_reminders_off_to_users.php` (new): `reminders_off`, false by default, reversible: the down migration drops it.

## API and contracts

- `POST /api/tasks` and `PUT /api/tasks/{task}`: accept `due_date` as `YYYY-MM-DD` or null, and `assignee_id`, a member of the task's team; a past date answers 422 with the reason.
- `GET /api/tasks/overdue`: the lead's team's late tasks, most late first; 403 for anyone who isn't a lead.
- `PATCH /api/user/reminders`: `{ "off": true }` or `{ "off": false }`.

## Decisions

- D-1: A due date is a day, not a moment, judged in the team's time zone, because the PRD speaks only of days.
- D-2: A task keeps its creator in `user_id` and gains a separate `assignee_id`, so who made it and who does it can differ.
- D-3: The overdue page filters in MySQL on the `due_date` index, to stay under NFR-1's 2 seconds.
- D-4: [ADR-0001: Send reminder emails as queued jobs, one per assignee](../../decisions/ADR-0001-reminder-queue.md)

## Coverage

| Requirement | Component |
|---|---|
| FR-1 | `backend/app/Policies/TaskPolicy.php` |
| FR-2 | `backend/app/Http/Controllers/TaskController.php` (the overdue list) |
| FR-3 | `backend/app/Http/Controllers/ReminderSettingsController.php`, the `reminders_off` column |
| FR-4 | `backend/app/Console/Commands/QueueDueReminders.php`, `backend/app/Jobs/SendDueReminder.php` |
| FR-5 | `frontend/src/components/TaskList.tsx` |
| FR-6 | `backend/app/Http/Controllers/TaskController.php` |
| FR-7 | `backend/app/Jobs/SendDueReminder.php` (its retry) |
| FR-8 | `backend/app/Jobs/SendDueReminder.php` (it checks the assignee is still in the team) |
| FR-9 | `backend/app/Models/Task.php`, `frontend/src/components/TaskList.tsx` |
| NFR-1 | the `due_date` index (D-3) |
| NFR-2 | `backend/app/Jobs/SendDueReminder.php` (title and date only) |

## Risks and rollout

- Teams ship first and change nothing a user sees: every existing user gets a team of one, as its lead.
- Then the dates and the list, then the overdue page, then the reminders.
- If only the teams and dates ship, tasks show their dates and nothing else changes; no reminder goes out until the worker runs.
