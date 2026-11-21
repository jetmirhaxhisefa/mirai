---
id: sample-app-feature-map
type: feature-map
template: feature-map@v1
code: [frontend/src]
updated: "2026-11-20"
---
# Feature map: the task list

## Screens

| Screen | Route | Handles | Notes |
|---|---|---|---|
| Log in | `/` | `form "Log in"`, `data-testid="login-form"`, `label "Email"`, `label "Password"`, `button "Log in"` | Shown at `/` until you're logged in. A failed login shows an `alert`. |
| Tasks | `/` | `heading "Tasks for <name>"`, `form "Add task"`, `label "New task"`, `button "Add"`, `list "Tasks"`, `data-testid="task-<id>"`, `checkbox "Done: <title>"`, `data-testid="empty-tasks"` | Shown at `/` once you're logged in. With no tasks, `empty-tasks` takes the list's place. |
