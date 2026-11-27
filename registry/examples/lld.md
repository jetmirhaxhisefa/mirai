---
id: due-dates-lld
type: lld
template: lld@v1
owner: mirai-architect
created: "2026-11-27"
upstream: [due-dates-hld]
---
# Due dates: the date field, the overdue list and their errors

HLD: [Due dates: a dated task, an overdue page and a reminder queue](hld.md)

## Scope

These are the shapes the due-date tickets share: setting a date (FR-1, FR-6) and the overdue list (FR-2). The column is the HLD's D-1 and the index its D-2. The reminders have their own queue (ADR-0001) and share no shape with these.

## Names

| Name | What it is | Where |
|---|---|---|
| `due_date` | the task's due day, `YYYY-MM-DD`, or null | the tasks table, the task API, the list |
| `days_overdue` | whole days past the due date, in the team's zone | the overdue list |
| `due_date_in_past` | the code of a refused past date | the task API, the list |

## Contracts

| ID | Operation | Request | Response |
|---|---|---|---|
| C-1 | `PATCH /api/tasks/{id}` | `due_date`: string `YYYY-MM-DD` or null, optional; absent keeps it, null clears it | 200, the task with `due_date` |

| Failure | Status | Code | Retryable |
|---|---|---|---|
| a date before the team's today | 422 | `due_date_in_past` | no |
| the user may not change the task | 403 | `forbidden` | no |
| no such task | 404 | `not_found` | no |

Retry: the same request twice sets the same date, so a repeat is harmless.

| ID | Operation | Request | Response |
|---|---|---|---|
| C-2 | `GET /api/tasks/overdue` | none | 200, a list of `{ id, title, due_date, days_overdue }`, most overdue first |

| Failure | Status | Code | Retryable |
|---|---|---|---|
| the user isn't the team's lead | 403 | `forbidden` | no |

Every error body is `{ "message": string, "code": string }`.

## Schema changes

| ID | Change | Type | Null | Default | Index | Migration | Rollback | Backfill |
|---|---|---|---|---|---|---|---|---|
| S-1 | `tasks.due_date` | date | yes | null | yes, with `done` | adds the column and the index | drops both | none: every task starts with no date |

## Flows

Not applicable — the HLD's key flows cover both contracts, and neither adds a step across modules.

## State and algorithms

Not applicable — a task's lateness is a comparison of two days, with no state of its own.

## Failures

| Case | Detected by | Handled by | The user sees |
|---|---|---|---|
| a past date | the request check | refusing the write | "Due dates can't be in the past." |
| a non-lead opens the overdue list | the policy | refusing the read | the page isn't in their menu |

## Test map

| AC or failure | Level | Seam | The case |
|---|---|---|---|
| AC-FR-1.1 | feature | C-1 | a date set shows on the task |
| AC-FR-1.2 | feature | C-1 | null clears the date |
| AC-FR-1.3 | feature | C-1 | another member's change answers 403 |
| AC-FR-2.1 | feature | C-2 | the list is ordered by days overdue |
| AC-FR-2.2 | feature | C-2 | an empty list says "Nothing is overdue" |
| AC-FR-6.1 | feature | C-1 | a past date answers 422 `due_date_in_past` |
| a past date | feature | C-1 | the same refusal, its message shown beside the field |
| a non-lead opens the overdue list | feature | C-2 | a member's request answers 403 |

## Security

Not applicable — as the HLD's conventions say: the task policy decides who may change a date.

## Observability

Not applicable — the HLD adds no metric, and none of these shapes needs one.

## Rollout

Not applicable — as the HLD's rollout says: the migration ships first.

## Open questions
