---
id: sample-app-conventions-backend
type: conventions
template: conventions@v1
service: backend
owner: product-owner
updated: "2026-11-20"
---
# Conventions: backend

## Rules

- The backend's code keeps Laravel's code style (enforced by format).
- The Composer manifest is valid (enforced by composer-validate).
- A controller checks who may change a task through the task policy, never by comparing IDs itself (judgment).
  Example: `TaskController::complete` calls `Gate::authorize('update', $task)` first.
- A rule about a task lives on the `Task` model. The frontend repeats it only to show the error early (judgment).
  Example: `Task::MAX_TITLE_LENGTH` is 120, and `AddTaskForm` checks the same number before it sends.
- An API test logs in as a real user. It never turns the login check off (judgment).
  Example: `TaskApiTest` calls `$this->actingAs($user)` before each request.
- A test that fails on purpose stays as it is (judgment).
  Example: `KnownFailureSeedTest` always fails, and MIRAI's baseline records it as a known failure.
