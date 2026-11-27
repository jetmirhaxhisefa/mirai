---
id: own-due-dates-lld
type: lld
template: lld@v1
owner: mirai-architect
created: "2026-11-27"
upstream: [own-due-dates-hld]
---
# Due dates on my own tasks: the date field, the zone header and the refusals

HLD: [Due dates on my own tasks: one column, checked on both sides](hld.md)

## Scope

These are the shapes the due-date tickets share: setting a date on a new task or an edited one (FR-1, FR-4), showing it and the late mark (FR-2, FR-3) and keeping undated tasks as today (FR-5), with only the owner seeing a date (NFR-1). The column is the HLD's D-2, the owner check on edit its D-5, and the date checked only when sent its D-6. Today comes from the browser's zone, ADR-0001.

## Names

| Name | What it is | Where |
|---|---|---|
| `due_date` | the task's due day, `YYYY-MM-DD`, or null | the tasks table, the task JSON, the form, the list |
| `X-Time-Zone` | the browser's IANA zone, sent with every write | the task API's create and edit requests |
| `isLate` | true when the task is open and its due day is before the browser's today | the task list |
| "Due 15 Jan 2027" | how the list shows a due date: "Due", the day, the short English month, the year, as the PRD's AC-FR-2.1 gives it | the task list |

## Contracts

| ID | Operation | Request | Response |
|---|---|---|---|
| C-1 | `POST /api/tasks` | `title`: string, required, at most 120 characters; `due_date`: string `YYYY-MM-DD` or null, optional; header `X-Time-Zone`: string, optional | 201, the task with `due_date` |

| Failure | Status | Code | Retryable |
|---|---|---|---|
| a date before the owner's today | 422 | `due_date` (the field's error) | no |
| a date that isn't `YYYY-MM-DD` | 422 | `due_date` | no |
| no title | 422 | `title` | no |
| a title over 120 characters | 422 | `title` | no |

Retry: a repeated create makes a second task, as it does today; the HLD changes nothing here.

| ID | Operation | Request | Response |
|---|---|---|---|
| C-2 | `PUT /api/tasks/{task}` | `title`: string, optional, at most 120 characters; `due_date`: string `YYYY-MM-DD` or null, optional: absent keeps it, null clears it; header `X-Time-Zone`: string, optional | 200, the task with `due_date` |

| Failure | Status | Code | Retryable |
|---|---|---|---|
| the task isn't the user's | 403 | none | no |
| a date before the owner's today | 422 | `due_date` | no |
| a date that isn't `YYYY-MM-DD` | 422 | `due_date` | no |
| a title over 120 characters | 422 | `title` | no |

An edit checks the owner first: another user's task answers 403 whatever its date, as the HLD's flow shows.

Retry: the same edit twice leaves the task as the first one did.

| ID | Operation | Request | Response |
|---|---|---|---|
| C-3 | `GET /api/tasks` | none | 200, the user's tasks, each with `due_date` (null when unset), in today's order |

A 422 is Laravel's validation body: `{ "message": string, "errors": { field: [string] } }`. A past date gets the message "Due dates can't be in the past." exactly, full stop included. A 403 is Laravel's authorization body, `{ "message": "This action is unauthorized." }`, as `complete` answers today.

## Schema changes

| ID | Change | Type | Null | Default | Index | Migration | Rollback | Backfill |
|---|---|---|---|---|---|---|---|---|
| S-1 | `tasks.due_date` | date | yes | null | no | adds the column | drops it, and every date set with it | none: every task starts with no date |

## Flows

Not applicable — the HLD's key flows show both writes and their refusals.

## State and algorithms

Not applicable — lateness is one comparison of two days, in the list.

## Failures

| Case | Detected by | Handled by | The user sees |
|---|---|---|---|
| a past date | the request's rule against the owner's today | refusing the write | "Due dates can't be in the past." beside the date field |
| a date in the wrong form | the request's date rule | refusing the write | the field's message beside it |
| a title over 120 characters | the request's title rule | refusing the write | the field's message beside it |
| an edit of another user's task | the task policy, as `complete` checks it | refusing the write | the list's error line |
| an unknown or missing zone | the request | judging today in UTC | nothing; a date near midnight may be judged by UTC's day |

## Test map

| AC or failure | Level | Seam | The case |
|---|---|---|---|
| AC-FR-1.1 | feature | C-2 | a date set on a task is returned and shown |
| AC-FR-1.2 | feature | C-2 | null clears the date |
| AC-FR-2.1 | component | the task list | a dated task shows "Due 15 Jan 2027" |
| AC-FR-3.1 | component | the task list | an open task due yesterday is marked late |
| AC-FR-3.2 | component | the task list | a done task is not marked late |
| AC-FR-4.1 | feature | C-1 | a past date answers 422 with the message |
| AC-FR-5.1 | feature | C-3 | undated tasks keep today's order |
| AC-NFR-1.1 | feature | C-3 | another user's list has neither task nor date |
| a past date | feature | C-2 | an edit to a past date answers 422 |
| a date in the wrong form | feature | C-1 | `15/01/2027` answers 422 |
| a title over 120 characters | feature | C-2 | a 121-character title answers 422 on `title` |
| an edit of another user's task | feature | C-2 | answers 403 and the task is unchanged |
| an unknown or missing zone | feature | C-1 | no header: today is UTC's |

## Security

Not applicable — as the HLD's D-5 says: `update` checks the owner as `complete` does.

## Observability

Not applicable — as the HLD says, nothing new needs watching.

## Rollout

Not applicable — as the HLD's rollout says: the migration first, then the API and the list together.

## Open questions
