---
id: sample-app-conventions-frontend
type: conventions
template: conventions@v1
service: frontend
owner: product-owner
updated: "2026-11-20"
---
# Conventions: frontend

## Rules

- The code passes the rules in `frontend/eslint.config.js` (enforced by lint).
- The types check with no error (enforced by types).
- Each component in `frontend/src/components/` has a demo beside it that exports `Empty` (judgment).
  Example: `TaskList.demo.tsx` renders the list with two tasks, and `Empty` renders it with none.
- Components call the backend through `frontend/src/api.ts` only, never with axios directly (judgment).
  Example: `App.tsx` calls `addTask(title)` from `api.ts`.
- A control gets an accessible name a test can find. A test ID is only for a part with no fixed text (judgment).
  Example: the task's box is labelled "Done: <title>", and each row has `data-testid="task-<id>"`.
- A message to the user is a full sentence that says what to do next (judgment).
  Example: "The task could not be saved. Try again."
