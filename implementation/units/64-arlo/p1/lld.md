---
id: own-due-dates-lld
type: lld
template: lld@v1
owner: mirai-architect
created: "2026-11-27"
upstream: [own-due-dates-hld]
---
# Due dates: the contracts for the date column, the task API and the today resolver

HLD: [Due dates: a date column on the task, judged in the browser's time zone](hld.md)

## Scope

These shapes serve FR-1 to FR-5 and NFR-1 of the PRD, for the tickets that build the backend and the list in parallel. They give the exact names, the task JSON, the four task endpoints, the one schema change and the test map. Every choice is the HLD's: the column (D-1), the time zone header (D-2, ADR-0001, D-3), the equal add and edit rules (D-4), set, change and remove through `PUT` (D-5), the owner check first (D-6), the computed `late` flag (D-7), the text shown (D-8) and the unchanged order (D-10). This LLD decides nothing.

## Names

| Name | What it is | Where |
|---|---|---|
| `due_date` | the task's due day: string `YYYY-MM-DD` or null | the tasks table, the task JSON, the request body, the API client's `Task` type |
| `late` | the computed late flag: boolean, never stored | the task JSON, the API client's `Task` type |
| `X-Time-Zone` | the request header holding an IANA zone name, such as `Europe/Berlin` | every browser request, read by `RequestToday` |
| `RequestToday` | the class that turns `X-Time-Zone` into today's date: a `Carbon` at 00:00 of that day, in that zone; UTC when the header is missing, empty or not a zone known to PHP | (new) `backend/app/Support/RequestToday.php` |
| `Task::isLate(Carbon $today): bool` | true when `due_date` is not null, is before `$today`'s date, and `done` is false | `backend/app/Models/Task.php` |
| `Task::isPastDue(string $date, Carbon $today): bool` | true when `$date` is before `$today`'s date; the one past-date rule both requests use | `backend/app/Models/Task.php` |
| `StoreTaskRequest` | Form Request for `POST /api/tasks` | (new) `backend/app/Http/Requests/StoreTaskRequest.php` |
| `UpdateTaskRequest` | Form Request for `PUT /api/tasks/{task}` | (new) `backend/app/Http/Requests/UpdateTaskRequest.php` |
| `addTask(title: string, dueDate: string \| null): Promise<Task>` | the client call behind the add form: `POST /api/tasks` with `title` and `due_date` (null when no date); returns the new `Task`; replaces today's `addTask(title)` | `frontend/src/api.ts` |
| `setDueDate(task: Task, date: string \| null): Promise<Task>` | the client call behind the list: `PUT /api/tasks/{task.id}` with `title: task.title` and `due_date: date` (null removes the date); returns the updated `Task`; new | `frontend/src/api.ts` |
| `Due dates can't be in the past.` | the exact past-date message, full stop included | `errors.due_date[0]`, the add form's early check |

## Contracts

The task JSON, returned by C-1 to C-4 (one task, or an array of tasks for C-1):

| Field | Type | Required | Constraints |
|---|---|---|---|
| `id` | integer | yes | as today |
| `title` | string | yes | 1 to 120 characters (`Task::MAX_TITLE_LENGTH`) |
| `done` | boolean | yes | as today |
| `due_date` | string or null | yes | `YYYY-MM-DD`, or null for no date; every task that exists today reads null |
| `late` | boolean | yes | `Task::isLate` with today from `RequestToday`; false when `due_date` is null |

The other columns the task model returns today stay as they are. All four contracts sit behind `auth:sanctum` and read `X-Time-Zone` (optional header, string, an IANA zone name).

The API client sends `X-Time-Zone` on every request, set once on its shared axios instance (`http`) to `Intl.DateTimeFormat().resolvedOptions().timeZone`, so `login`, `currentUser`, `listTasks`, `addTask`, `completeTask` and `setDueDate` all carry it. `addTask` and `setDueDate` do not catch: on a 422 the axios error is thrown with the response body intact, so the caller reads `error.response.data.errors.due_date[0]`. The add form shows that message in the form; the app shell shows a refusal from `setDueDate` as an alert and leaves the list as it was. A 403, 404 or network failure is thrown the same way and shown as the app's alert "The task could not be updated. Try again." Neither call retries.

Two error bodies are used. A 422 is Laravel's validation body: `{ "message": string, "errors": { "<field>": [string] } }`. A 401, 403 and 404 are Laravel's own bodies: `{ "message": "Unauthenticated." }`, `{ "message": "This action is unauthorized." }` and `{ "message": string }`.

| ID | Operation | Request | Response |
|---|---|---|---|
| C-1 | `GET /api/tasks` | no body | 200, an array of the signed-in user's tasks only, newest first by `id` (D-10), each as the task JSON |
| C-2 | `POST /api/tasks` | `title`: string, required, at most 120 characters; `due_date`: string `YYYY-MM-DD` or null, optional, not before today | 201, the new task as the task JSON, owned by the signed-in user |
| C-3 | `PUT /api/tasks/{task}` | `title`: string, required, at most 120 characters; `due_date`: string `YYYY-MM-DD` or null, optional: present sets it, null removes it, absent keeps it (D-5); a present date is not before today | 200, the task as the task JSON |
| C-4 | `PATCH /api/tasks/{task}` | no body | 200, the task as the task JSON, with `done` true and `late` false |

| Failure | Status | Code | Retryable |
|---|---|---|---|
| not signed in (C-1 to C-4) | 401 | `Unauthenticated.` | no |
| the task does not exist (C-3, C-4) | 404 | none (Laravel's not-found body) | no |
| the task belongs to another user (C-3, C-4) | 403 | `This action is unauthorized.` | no |
| no title (C-2, C-3) | 422 | `errors.title` | no |
| a title over 120 characters (C-2, C-3) | 422 | `errors.title` | no |
| a date before today (C-2, C-3) | 422 | `errors.due_date`, message "Due dates can't be in the past." | no |
| a date that isn't `YYYY-MM-DD`, or isn't a real day (C-2, C-3) | 422 | `errors.due_date` | no |

On C-3 the order is: sign-in, then the task is found, then the task policy (`update`) in `UpdateTaskRequest::authorize`, then the title and date rules (D-6). A stranger's invalid edit therefore answers 403, not 422. C-4 asks the policy first, as it does today.

Retry: C-2, a repeated create makes a second task, as it does today; the HLD changes nothing here.

Retry: C-3, the same request twice leaves the task as the first one did.

Retry: C-4, the same request twice leaves the task done.

## Schema changes

| ID | Change | Type | Null | Default | Index | Migration | Rollback | Backfill |
|---|---|---|---|---|---|---|---|---|
| S-1 | `tasks.due_date` | `DATE` | yes | none | no | (new) `backend/database/migrations/2026_11_27_100000_add_due_date_to_tasks_table.php` adds the column | the down migration drops it, and every date set with it | none: every existing task stays null |

The model allows mass assignment of `due_date` beside `title`, and casts it to a date; it is written out as `YYYY-MM-DD` in the task JSON.

## Flows

Not applicable — the HLD's key flows hold every flow across modules, and no contract here adds one.

## State and algorithms

The late rule and the past-date rule are the two shared algorithms. Both compare calendar days, never times of day.

| Rule | Input | Result |
|---|---|---|
| today | `X-Time-Zone` | the date now in that zone; the date now in UTC when the header is missing, empty or unknown (ADR-0001, D-3) |
| past date | a `due_date` and today | refused when the date is before today; today itself is accepted |
| late | a task and today | true when `due_date` is before today and `done` is false: late from the day after the due date (A-1), never on the due day |

The browser formats `due_date` from its string parts: "Due 15 Jan 2027" for `2027-01-15`, never through a `Date` in another zone (D-8). The list shows "Late" when `late` is true and nothing when it is false.

## Failures

| Case | Detected by | Handled by | The user sees |
|---|---|---|---|
| not signed in | the Sanctum middleware | answering 401 | the login page, as today |
| the task does not exist | route binding | answering 404 | nothing new: as today |
| a stranger edits or completes a task | `UpdateTaskRequest::authorize` for C-3, `Gate::authorize` for C-4 | answering 403; the task is unchanged | "The task could not be updated. Try again." (the app's alert) |
| no title, or a title over 120 characters | the task requests | answering 422 | the form's or the alert's message from `errors.title` |
| a date before today | the task requests, with `RequestToday` | answering 422; the task is unchanged | "Due dates can't be in the past." in the add form, or as an alert on the list |
| a date that is malformed | the task requests | answering 422 | the message from `errors.due_date` |
| a missing or unknown `X-Time-Zone` | `RequestToday` | judging in UTC | nothing: a wrong zone shifts what counts as late or past (ADR-0001) |

## Test map

| AC or failure | Level | Seam | The case |
|---|---|---|---|
| AC-FR-1.1 | feature | `PUT /api/tasks/{task}` and the list text | a task with no date set to 2027-01-15 answers `due_date` `2027-01-15`, and the row shows "Due 15 Jan 2027" |
| AC-FR-1.2 | feature | `PUT /api/tasks/{task}` | `due_date` null on a dated task answers `due_date` null |
| AC-FR-2.1 | feature | `GET /api/tasks` and the list | a task due 2027-01-15 returns that date, and the list shows "Due 15 Jan 2027" |
| AC-FR-3.1 | feature | `GET /api/tasks` | with today 2027-01-16, an open task due 2027-01-15 returns `late` true; with today 2027-01-15 it returns false |
| AC-FR-3.2 | feature | `PATCH /api/tasks/{task}`, `GET /api/tasks` | after completing, the task returns `late` false and the list shows no "Late" |
| AC-FR-4.1 | feature | `POST /api/tasks`, `PUT /api/tasks/{task}` | with today 2027-01-14, the date 2027-01-13 answers 422 with `errors.due_date` "Due dates can't be in the past." |
| AC-FR-5.1 | feature | `GET /api/tasks` | undated tasks come back newest first by `id`, with `due_date` null and `late` false |
| AC-NFR-1.1 | feature | `GET /api/tasks` | Ben's list holds none of Ana's tasks or dates |
| not signed in | feature | `PUT /api/tasks/{task}` | no login answers 401 |
| the task does not exist | feature | `PUT /api/tasks/{task}` | an unknown id answers 404 |
| a stranger edits or completes a task | feature | `PUT /api/tasks/{task}`, `PATCH /api/tasks/{task}` | Ben's edit of Ana's task, with a valid and with an invalid body, answers 403, and her date is unchanged |
| no title, or a title over 120 characters | feature | `POST /api/tasks`, `PUT /api/tasks/{task}` | an empty title and a 121-character title each answer 422 with `errors.title` |
| a date before today | unit | `Task::isPastDue`, `RequestToday` | yesterday is past, today is not; `Europe/Berlin` at 23:30 UTC on 2027-01-14 is 2027-01-15 |
| a date that is malformed | feature | `POST /api/tasks` | `15/01/2027` and `2027-02-30` answer 422 with `errors.due_date` |
| a missing or unknown `X-Time-Zone` | unit | `RequestToday` | no header and `Not/AZone` both give today in UTC |
| the add and edit rules stay equal | unit | `StoreTaskRequest`, `UpdateTaskRequest` | both return the same rules (D-4), as `TaskRulesTest` expects |

## Security

Not applicable — the HLD adds no new security surface: the one new field follows the task's existing owner scope (NFR-1), and the 403 and list rows above prove it.

## Observability

Not applicable — the HLD omits observability: the app has no metrics today.

## Rollout

Not applicable — the HLD's two-step rollout and rollback are its own, and no contract adds one.

## Open questions
