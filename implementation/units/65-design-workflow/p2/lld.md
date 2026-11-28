---
id: own-due-dates-lld
type: lld
template: lld@v1
owner: mirai-architect
created: "2026-11-27"
upstream: [own-due-dates-hld]
changelog: ["2026-11-27: the zone travels as the `tz` query parameter instead of the X-Time-Zone header, in C-5, C-6, the names and the test map (ADR-0003, D-12)"]
---
# Due dates on my own tasks: the task's date, its late flag and the zone parameter

HLD: [Due dates on my own tasks: a date column, a late flag from the owner's today, and the list's mark](hld.md)

## Scope

These are the shapes the tickets of this initiative share: the `due_date` column, the four task responses, the two request classes, the owner's today, the zone parameter and the browser's date helpers. They serve FR-1 to FR-5 and NFR-1. The HLD's D-1 (ADR-0002) fixes the day with no time, D-3 the computed `late`, D-6 and D-2 the request classes, D-7 the keep-or-clear rule, and D-12 (ADR-0003) the `tz` query parameter on every task request. Nothing is decided here.

## Names

| Name | What it is | Where |
|---|---|---|
| `due_date` | the task's due day: string `YYYY-MM-DD` or null | the tasks table (`DATE`), every task response, the request bodies, the browser's `Task` type |
| `late` | boolean, computed on each response, never stored | every task response, the browser's `Task` type |
| `tz` | query parameter holding an IANA zone name such as `Europe/Berlin`; it replaces the `X-Time-Zone` header, which is no longer sent or read | every browser request; read by the owner's today |
| `OwnerToday` | class giving the owner's today; `OwnerToday::from(Request $request): CarbonImmutable` returns the start of today in the `tz` parameter's zone, or in UTC | (new) `backend/app/Support/OwnerToday.php` |
| `Task::isLateOn` | `isLateOn(CarbonInterface $today): bool`: true only when not done, `due_date` is set, and `due_date` is before `$today`'s day | `backend/app/Models/Task.php` |
| `Task::toResponse` | `toResponse(CarbonInterface $today): array`: the task's attributes, with `due_date` as `YYYY-MM-DD` or null and `late` from `isLateOn` | `backend/app/Models/Task.php` |
| `Task::PAST_DATE_MESSAGE` | the string `Due dates can't be in the past.`, full stop included | `backend/app/Models/Task.php` |
| `StoreTaskRequest`, `UpdateTaskRequest` | the two request classes the controller already imports; `rules()` of both return the same array | (new) `backend/app/Http/Requests/StoreTaskRequest.php`, (new) `backend/app/Http/Requests/UpdateTaskRequest.php` |
| `formatDue` | `formatDue(day: string): string` returns `Due 15 Jan 2027` for `2027-01-15`, from a fixed English month list, with no `Date` parsing | (new) `frontend/src/dueDate.ts` |
| `todayLocal` | `todayLocal(): string` returns the browser's today as `YYYY-MM-DD`, built from `getFullYear`, `getMonth` and `getDate` | (new) `frontend/src/dueDate.ts` |
| `PAST_DATE_MESSAGE` | the same string as the API's, exported for the form and the list | (new) `frontend/src/dueDate.ts` |
| `updateTask` | `updateTask(id: number, body: { title: string; due_date?: string \| null }): Promise<Task>` calls C-2 | `frontend/src/api.ts` |
| `addTask` | `addTask(title: string, due_date?: string): Promise<Task>` calls C-1; it leaves `due_date` out of the body when none is given | `frontend/src/api.ts` |

## Contracts

All four task responses carry the task object T: `{ id: integer, title: string, done: boolean, due_date: string | null, late: boolean }` plus the fields the task has today (`user_id`, `created_at`, `updated_at`), unchanged. `due_date` is `YYYY-MM-DD` with no time and no zone (ADR-0002). `late` follows the rule in D-3. Every request below carries the `tz` query parameter (C-5), which no contract requires: without a known zone name, today is judged in UTC (ADR-0003, D-9). It is never part of a request body, and the request classes don't validate it, so it stays out of `validated()`.

| ID | Operation | Request | Response |
|---|---|---|---|
| C-1 | `POST /api/tasks` | `title`: string, required, at most 120 characters; `due_date`: string `YYYY-MM-DD`, optional, not before the owner's today, null accepted as no date | 201, T |
| C-2 | `PUT /api/tasks/{task}` | `title`: string, required, at most 120 characters; `due_date`: string `YYYY-MM-DD` or null, optional: absent keeps the stored date, null clears it, a day sets it (D-7); not before the owner's today | 200, T |
| C-3 | `GET /api/tasks` | none | 200, a JSON array of T, the signed-in owner's tasks only, newest first (`id` descending), as today |
| C-4 | `PATCH /api/tasks/{task}` | none | 200, T with `done` true and `late` false |

| Failure | Status | Code | Retryable |
|---|---|---|---|
| C-1, C-2, C-3, C-4: not logged in | 401 | none: body `{ "message": "Unauthenticated." }` | no |
| C-2, C-4: no such task | 404 | none: Laravel's not-found body | no |
| C-2: not the task's owner (checked before validation, D-6) | 403 | none: body `{ "message": "This action is unauthorized." }` | no |
| C-4: not the task's owner | 403 | none: the same body | no |
| C-1, C-2: `title` missing | 422 | `title` (the field's error key) | no |
| C-1, C-2: `title` over 120 characters | 422 | `title` | no |
| C-1, C-2: `due_date` before the owner's today | 422 | `due_date`, with the message `Due dates can't be in the past.` | no |
| C-1, C-2: `due_date` not `YYYY-MM-DD` | 422 | `due_date` | no |

A 422 is Laravel's validation body: `{ "message": string, "errors": { field: [string] } }`. A 403 carries the authorization body above, and a 401 the unauthenticated body above; they are not validation bodies. A due date equal to the owner's today is accepted: only an earlier day is refused.

Retry: C-1 repeated makes a second task, as it does today; the HLD changes nothing here.

Retry: C-2 repeated leaves the task as the first call did, while the day is not yet past in the owner's zone.

Retry: C-4 repeated leaves the task done; C-3 is a read and changes nothing.

| ID | Operation | Request | Response |
|---|---|---|---|
| C-5 | every browser request through `http` in `frontend/src/api.ts` | query parameter `tz`: string, the value of `Intl.DateTimeFormat().resolvedOptions().timeZone`, set once on the client's defaults as `params: { tz }`, which axios URL-encodes, so `Europe/Berlin` goes as `tz=Europe%2FBerlin` | the API's, unchanged |
| C-6 | the owner's today, `OwnerToday::from($request)` | query parameter `tz`, read with `$request->query('tz')`: string, optional; it counts as known only when `DateTimeZone::listIdentifiers()` holds it exactly | `CarbonImmutable`: the start of the owner's today in that zone, else in UTC |

Failure: C-5 and C-6 have no failure of their own. A missing, empty or unknown `tz` is not an error: it falls back to UTC (D-9), so the request is answered as any other.

Retry: C-5 and C-6 read and send values only, so a repeat gives the same result within the same day.

## Schema changes

| ID | Change | Type | Null | Default | Index | Migration | Rollback | Backfill |
|---|---|---|---|---|---|---|---|---|
| S-1 | `tasks.due_date` | `DATE` (`$table->date('due_date')->nullable()->after('title')`) | yes | none | no | `backend/database/migrations/2026_11_27_100000_add_due_date_to_tasks_table.php` adds the column; it runs with `php artisan migrate` | the down method drops `due_date`, and every date set with it | none: existing rows get null |

The model keeps `due_date` out of mass assignment's default and adds it to `#[Fillable]` beside `title`, and casts it with `'due_date' => 'date:Y-m-d'`, so it serialises as `YYYY-MM-DD`. The store sets it through `$request->user()->tasks()->create($request->validated())`. The update sets `due_date` only when `array_key_exists('due_date', $request->validated())` (D-7).

## Flows

Not applicable — every flow crosses modules as the HLD's key flows draw it, and no contract here adds one.

## State and algorithms

The late rule is the one algorithm the tickets share (D-3). `Task::isLateOn($today)` is true when `done` is false, `due_date` is not null, and `due_date->toDateString() < $today->toDateString()`. A task due on the owner's today is not late; a task marked not done again is judged by this rule on the next response. The controller computes `$today = OwnerToday::from($request)` once per request and passes it to `toResponse` for each task. The browser never computes `late`: it shows what the API returns.

## Failures

| Case | Detected by | Handled by | The user sees |
|---|---|---|---|
| not logged in | the `auth:sanctum` route group | the framework's 401 | the login screen, as today |
| no such task | route model binding | the framework's 404 | as today |
| not the task's owner on an edit | `UpdateTaskRequest::authorize()`, which calls `Gate::allows('update', $this->route('task'))` | the 403 before validation (D-6) | the API's error, as `complete` shows today |
| not the task's owner on completing | `Gate::authorize('update', $task)` in `complete` | the 403 | as today |
| `title` missing | the request class | the 422 | the API's `title` error |
| `title` over 120 characters | the request class, `max:` `Task::MAX_TITLE_LENGTH` | the 422 | the API's `title` error |
| `due_date` before the owner's today | the request class, `after_or_equal:` the day from `OwnerToday` | the 422 with `Task::PAST_DATE_MESSAGE` | "Due dates can't be in the past." |
| `due_date` not `YYYY-MM-DD` | the request class, `date_format:Y-m-d` | the 422 | the API's `due_date` error |
| the owner's day past in the browser, not yet in the API | the browser's check first, then the API's (the API's answer wins) | the browser shows `PAST_DATE_MESSAGE` before sending | "Due dates can't be in the past." |

## Test map

| AC or failure | Level | Seam | The case |
|---|---|---|---|
| AC-FR-1.1 | feature | `PUT /api/tasks/{task}` and the task list component | an owner sets 2027-01-15 on a task with no date, the response holds `due_date` `2027-01-15`, and the list shows "Due 15 Jan 2027" |
| AC-FR-1.2 | feature | `PUT /api/tasks/{task}` and the task list component | an edit sending `due_date` null on a task due 2027-01-15 answers null, and the list shows no date |
| AC-FR-2.1 | feature | `GET /api/tasks` and the task list component | a task due 2027-01-15 comes back with that `due_date`, and `formatDue` gives "Due 15 Jan 2027" |
| AC-FR-3.1 | feature | `GET /api/tasks` with a fixed clock | an open task due 2027-01-15, listed on 2027-01-16, has `late` true |
| AC-FR-3.2 | feature | `PATCH /api/tasks/{task}` then `GET /api/tasks` | after completing, `late` is false in the response and in the next list |
| AC-FR-4.1 | feature | `POST /api/tasks` with a fixed clock of 2027-01-14 | `due_date` 2027-01-13 answers 422 with "Due dates can't be in the past." on `due_date` |
| AC-FR-5.1 | feature | `GET /api/tasks` | tasks with no date keep `id` descending order, with `due_date` null and `late` false |
| AC-NFR-1.1 | feature | `GET /api/tasks` | Ben's list holds none of Ana's tasks or dates |
| not logged in | feature | the four routes | each answers 401 without a login |
| no such task | feature | `PUT` and `PATCH /api/tasks/{task}` | an unknown id answers 404 |
| not the task's owner on an edit | feature | `PUT /api/tasks/{task}` | another owner's edit with an invalid body still answers 403 |
| not the task's owner on completing | feature | `PATCH /api/tasks/{task}` | another owner's completion answers 403 |
| `title` missing | feature | `POST /api/tasks`, `PUT /api/tasks/{task}` | a body without `title` answers 422 on `title` |
| `title` over 120 characters | feature | `POST /api/tasks`, `PUT /api/tasks/{task}` | 121 characters answers 422 on `title`, 120 passes |
| `due_date` before the owner's today | feature | `POST /api/tasks`, `PUT /api/tasks/{task}` | yesterday answers 422 with the message; today passes |
| `due_date` not `YYYY-MM-DD` | feature | `POST /api/tasks`, `PUT /api/tasks/{task}` | `15/01/2027` answers 422 on `due_date` |
| a title-only edit keeps the date (D-7) | feature | `PUT /api/tasks/{task}` | a body without `due_date` leaves the stored date |
| the owner's zone decides today (ADR-0003) | unit | `OwnerToday::from` | a late-evening UTC clock with `tz=Pacific/Auckland` gives the next day; a missing or unknown `tz` gives UTC, and an `X-Time-Zone` header alone gives UTC |
| the late rule | unit | `Task::isLateOn` | open and past is late; due today, done, and no date are not |
| the rules stay equal (D-2) | unit | `StoreTaskRequest::rules`, `UpdateTaskRequest::rules` | both return the same array, as `TaskRulesTest` expects |
| the owner's day past in the browser, not yet in the API | unit | `AddTaskForm`, `TaskList` | a day before `todayLocal()` shows the message and sends nothing |
| the browser's early check | unit | `AddTaskForm`, `TaskList` | a past day shows the message and sends nothing |
| the browser's day text | unit | `formatDue`, `todayLocal` | `2027-01-05` gives "Due 5 Jan 2027", with no day shift near midnight |
| the zone parameter | unit | `frontend/src/api.ts` | a request, a read or a write, carries `tz` in its query string and no `X-Time-Zone` header |

## Security

Not applicable — the only access rule is the owner's check on C-2 and C-4, which is in the failure rows; the HLD adds no other security surface.

## Observability

Not applicable — the app has no metrics or logs, and no contract here adds one.

## Rollout

Not applicable — the order (migration and API first, then the browser) is the HLD's D-8, and no shape here changes it.

## Open questions
