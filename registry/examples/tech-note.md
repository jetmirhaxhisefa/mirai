---
id: due-dates-tech-note
type: tech-note
template: tech-note@v1
owner: mirai-architect
created: "2026-11-26"
upstream: [due-dates-prd]
---
# Due dates: a column, a policy check and a nightly queue

PRD: [Tasks with due dates that people finish on time](prd.md)

## Approach

The task gets a nullable due date, set through the existing task API and checked by the task policy. The list and a new overdue page read it, and nothing about tasks without a date changes. Each night a scheduled command queues one reminder job per assignee, and the queue retries a failed email an hour later. Teams, logins and the task form's other fields stay as they are.

## Components touched

- `backend/app/Models/Task.php`: casts `due_date` to a date and adds an `overdue` scope.
- `backend/app/Http/Controllers/TaskController.php`: accepts `due_date` on store and update, refuses a past date, and adds the overdue list.
- `backend/app/Policies/TaskPolicy.php`: lets the team lead or the creator change a due date.
- `backend/routes/api.php`: adds `GET /api/tasks/overdue`.
- `backend/app/Jobs/SendDueReminder.php` (new): one reminder email for one assignee, retried after an hour.
- `backend/routes/console.php` (new): schedules the nightly command that queues the jobs.
- `frontend/src/components/TaskList.tsx`: shows the date and the overdue mark.
- `frontend/src/api.ts`: sends and reads `due_date`, and fetches the overdue list.

## Data changes

- `backend/database/migrations/2026_11_26_000000_add_due_date_to_tasks.php` (new): a nullable `due_date` column on `tasks`, reversible: the down migration drops the column.
- `backend/database/migrations/2026_11_26_000001_add_reminders_off_to_users.php` (new): a `reminders_off` flag on `users`, false by default, reversible: the down migration drops it.

## API and contracts

- `POST /api/tasks` and `PATCH /api/tasks/{id}`: accept `due_date` as `YYYY-MM-DD` or null; a date before today answers 422 with the reason.
- `GET /api/tasks/overdue`: the team lead's overdue tasks, most overdue first; 403 for anyone else.
- `PATCH /api/me`: accepts `reminders_off` as true or false.

## Decisions

- D-1: The date is a date without a time, compared in the team's time zone, because the PRD speaks of days.
- D-2: The overdue page filters in the database with an index on `due_date`, to stay within NFR-1's 2 seconds.
- D-3: [ADR-0001: Send due-date reminders from a queue worker](../../decisions/ADR-0001-reminder-queue.md)

## Coverage

| Requirement | Component |
|---|---|
| FR-1 | `backend/app/Policies/TaskPolicy.php`, `backend/app/Http/Controllers/TaskController.php` |
| FR-2 | `backend/app/Http/Controllers/TaskController.php` (the overdue list) |
| FR-3 | the `reminders_off` flag, `PATCH /api/me` |
| FR-4 | `backend/routes/console.php`, `backend/app/Jobs/SendDueReminder.php` |
| FR-5 | `frontend/src/components/TaskList.tsx` |
| FR-6 | `backend/app/Http/Controllers/TaskController.php` |
| FR-7 | `backend/app/Jobs/SendDueReminder.php` (its retry) |
| FR-8 | `backend/app/Jobs/SendDueReminder.php` (it checks the assignee is still in the team) |
| FR-9 | `backend/app/Models/Task.php`, `frontend/src/components/TaskList.tsx` |
| NFR-1 | the `due_date` index (D-2) |
| NFR-2 | `backend/app/Jobs/SendDueReminder.php` (title and date only) |

## Risks and rollout

- The migrations ship first, then the API and the list, then the overdue page, then the reminders.
- No flag: a task without a date behaves as today, so a half-shipped feature shows dates and nothing else.
- If the worker isn't running, no reminder goes out; the jobs wait in the queue and send once it starts.
