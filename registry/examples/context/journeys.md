---
id: sample-app-journeys
type: journeys
template: journeys@v1
owner: product-owner
updated: "2026-11-20"
---
# Critical journeys: the task list

## Journeys

### J-1: Log in and see your own tasks

Steps:

1. On **Log in**, enter your email and password, then choose "Log in".
2. **Tasks** opens with your name in its heading, and lists only your own tasks.

Why critical: when it breaks, nobody can use the app, and every team stops at once (S-1).

E2E test: `e2e/tests/smoke.spec.ts`

### J-2: Add a task and mark it done

Steps:

1. On **Tasks**, type a title in "New task", then choose "Add".
2. The task shows at the top of the list, not done.
3. Tick its box. It shows as done once the API confirms.

Why critical: adding and finishing tasks is the whole product. A team that can't do it leaves (S-2, S-3).

E2E test: `e2e/tests/smoke.spec.ts`

## Sources

| ID | Source | Where | Date |
|---|---|---|---|
| S-1 | The app's README | `README.md` | 2026-11-20 |
| S-2 | The product owner, in setup's interview | you said | 2026-11-20 |
| S-3 | The end-to-end test, "the one critical journey" | `e2e/tests/smoke.spec.ts` | 2026-11-20 |
