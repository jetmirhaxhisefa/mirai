---
id: own-due-dates-tech-note
type: tech-note
template: tech-note@v1
owner: mirai-architect
created: "2026-11-26"
upstream: [own-due-dates-prd]
---
# Due dates on my own tasks: one column, checked on both sides

PRD: [Due dates on my own tasks](prd.md)

## Approach

A task gains a nullable due date, stored as a day with no time. The existing task API reads and writes it, and the server refuses a day before the owner's today. The list shows the date beside the title and marks an open task late from the day after its date, in the owner's own time zone. Who sees a task, the list's order and a task without a date stay exactly as they are.

## Components touched

- `backend/app/Models/Task.php`: adds `due_date` to the fillable fields and casts it to a date.
- `backend/app/Http/Controllers/TaskController.php`: `store` and `update` take `due_date`, and refuse a past day with "Due dates can't be in the past."; `index` keeps its order.
- `frontend/src/api.ts`: the `Task` type gains `due_date: string | null`; `addTask` and the update send it, with the browser's time zone in an `X-Time-Zone` header.
- `frontend/src/components/AddTaskForm.tsx`: a date field beside the title, left empty by default.
- `frontend/src/components/TaskList.tsx`: shows "Due 15 Jan 2027" beside the title, and marks an open task late.

## Data changes

- `backend/database/migrations/2026_11_26_100000_add_due_date_to_tasks.php` (new): a nullable `due_date` date column on `tasks`, reversible: the down migration drops the column, and no other table changes.

## API and contracts

- `POST /api/tasks` and `PUT /api/tasks/{task}`: accept `due_date` as `YYYY-MM-DD` or null; a past day answers 422 with "Due dates can't be in the past."
- `GET /api/tasks`: each task gains `due_date`, `YYYY-MM-DD` or null; the order stays newest first.
- Every write sends `X-Time-Zone`, an IANA zone such as `Europe/Berlin`; without it, or with an unknown zone, the server uses UTC.

## Decisions

- D-1: "Today" is the owner's day in the zone the browser sends, because the app stores no time zone per user and A-1 needs the owner's own.
- D-2: The list marks a task late in the browser, from the same zone, so no server call or stored flag is added.
- D-3: The list's order doesn't use the due date, because FR-5 keeps it as it is today.

## Coverage

| Requirement | Component |
|---|---|
| FR-1 | `backend/app/Http/Controllers/TaskController.php`, `frontend/src/components/AddTaskForm.tsx` |
| FR-2 | `frontend/src/components/TaskList.tsx` |
| FR-3 | `frontend/src/components/TaskList.tsx` (D-2) |
| FR-4 | `backend/app/Http/Controllers/TaskController.php` (D-1) |
| FR-5 | `backend/app/Http/Controllers/TaskController.php` (`index` unchanged), `frontend/src/components/TaskList.tsx` |
| NFR-1 | `backend/app/Http/Controllers/TaskController.php` (the owner's own tasks only, as today) |

## Risks and rollout

- The migration ships first; a task without a date behaves as today.
- Then the API, then the form and the list, in one release: an API that takes dates with no field to set them changes nothing a user sees.
- If the browser sends a wrong zone, a date can be refused or marked late a day early or late; the zone comes from the browser itself, so this needs a wrongly set computer clock.
