---
id: own-due-dates-tech-note
type: tech-note
template: tech-note@v1
owner: mirai-architect
created: "2026-11-27"
upstream: [own-due-dates-prd]
---
# Due dates on my own tasks, built as one nullable column and a browser-side late mark

PRD: [Due dates on my own tasks](prd.md)

## Approach

Current state: `tasks` has `user_id`, `title` and `done` (`backend/database/migrations/2026_10_23_100000_create_tasks_table.php:11`), the list is ordered by `id` descending (`backend/app/Http/Controllers/TaskController.php:17`), and the app stores no time zone. The form requests `StoreTaskRequest` and `UpdateTaskRequest` are named by the controller (`TaskController.php:5`) but are not in the repo, so they are written here as new files, with the title rules from `backend/app/Models/Task.php:17` (unverified). Late is decided in the browser, by comparing `due_date` with today's date in the browser's time zone, which is the owner's own time zone (A-1). The browser sends that zone so the server can refuse a past date. Ordering, the done mark and who may read the list do not change (FR-5). Access on `PUT` does change: it has no owner check today (`TaskController.php:35`), so the new `UpdateTaskRequest::authorize` calls `TaskPolicy::update`, and a task's date can be set only by its owner (NFR-1).

## Components touched

- `backend/database/migrations/2026_11_27_100000_add_due_date_to_tasks.php` (new).
- `backend/app/Models/Task.php`: add `due_date` to `#[Fillable(['title'])]` (line 11) and cast it `date:Y-m-d` in `casts()` (line 22).
- `backend/app/Http/Requests/StoreTaskRequest.php` (new) and `backend/app/Http/Requests/UpdateTaskRequest.php` (new): `UpdateTaskRequest::authorize` returns `Gate::allows('update', $task)` from the route task (the owner check `PUT` lacks today); `due_date` is `nullable|date_format:Y-m-d`, plus a rule that refuses a date before today in the zone of the `X-Time-Zone` header (else UTC), with its message
- `backend/app/Http/Controllers/TaskController.php`: `update` (line 37) sets `due_date` when the key is present, and still sets the title; `store` already passes `validated()` (line 30).
- `frontend/src/api.ts`: `Task` gains `due_date: string | null` (line 3); the axios client sends `X-Time-Zone` (line 7); `addTask` takes an optional date (line 23); new `setDueDate(task, date | null)` takes the whole task and calls `PUT /api/tasks/{id}` with `task.title` and the date, so the required title is always filled.
- `frontend/src/components/TaskList.tsx`: shows "Due 15 Jan 2027" (line 20), marks an open task whose date is before today's local date as late, and has a date input to change or remove the date.
- `frontend/src/components/AddTaskForm.tsx`: an optional date input; a 422 shows the server's message in the existing alert (line 32).
- `backend/tests/Feature/TaskApiTest.php` and `frontend/src/components/TaskList.test.tsx`: cases for each AC, including a 403 for another user.s `PUT`.

## Data changes

- `backend/database/migrations/2026_11_27_100000_add_due_date_to_tasks.php` (new): adds `due_date` as a nullable `date` to `tasks`; existing rows get null, so they show and sort as today. Reversible: the down migration drops the column.

## API and contracts

- `POST /api/tasks`: accepts `title` and optional `due_date` (`YYYY-MM-DD` or null). Returns 201 with the task, including `due_date`.
- `PUT /api/tasks/{task}`: accepts `title` (required, as today) and `due_date` (`YYYY-MM-DD`, or null to remove it). Answers 403 to a user who doesn't own the task. Returns the task. A date is checked only when it is sent and differs from the stored one, so renaming still works.
- Both: a date before today in the zone of `X-Time-Zone` answers 422 `{"message": "Due dates can't be in the past.", "errors": {"due_date": [...]}}`.
- `GET /api/tasks`: each task now has `due_date`; unchanged otherwise.
- Header `X-Time-Zone`: an IANA name such as `Europe/Berlin`, sent on every call.

## Decisions

- D-1: Late is computed in the browser from `due_date` and the local date, not stored or computed by the server, because the owner's zone is known there (A-1, Arlo's call).
- D-2: The zone travels in `X-Time-Zone`, not stored, because the app has no profile (Arlo's call).
- D-3: `due_date` is a `date` column, because a due date is a calendar day (Arlo's call).
- D-4: Past-date refusal is on the server as well as the form, so a direct API call can't skip it (FR-4, Arlo's call).

## Coverage

| Requirement | Component |
|---|---|
| FR-1 | `backend/app/Http/Controllers/TaskController.php`, `frontend/src/components/TaskList.tsx` |
| FR-2 | `frontend/src/components/TaskList.tsx` |
| FR-3 | `frontend/src/components/TaskList.tsx` |
| FR-4 | `backend/app/Http/Requests/UpdateTaskRequest.php` |
| FR-5 | `backend/app/Http/Controllers/TaskController.php` |
| NFR-1 | `backend/app/Http/Requests/UpdateTaskRequest.php` (owner check on `PUT`), `backend/app/Policies/TaskPolicy.php` (unchanged rule it calls) |

## Risks and rollout

- Ship in order: migration, then backend, then frontend. No flag: a null date changes nothing for existing tasks.
- Backend-only: dates settable by API but unseen. Frontend-only: the input fails on the missing column.
