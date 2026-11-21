---
id: sample-app-project-frontend
type: project
template: project@v1
service: frontend
root: frontend
updated: "2026-11-20"
---
# Project: frontend

The task list's web app: React screens that call the backend's API through the same origin.

## Stack

| Part | Version | Set in |
|---|---|---|
| React | 18.3 | `frontend/package.json` |
| TypeScript | 5.8 | `frontend/package.json` |
| Vite, the dev server and build | 5.4 | `frontend/package.json` |
| Vitest, with Testing Library | 3.2 | `frontend/package.json` |
| ESLint | 9.32 | `frontend/package.json` |
| Node.js | 22 | `docker/node/Dockerfile` |

## Commands

Run them from the repo's top folder: the app runs in Docker Compose.

| What | Command |
|---|---|
| Start the whole app | `docker compose up -d --build` |
| Run the tests | `docker compose exec frontend npm test` |
| Lint | `docker compose exec frontend npm run lint` |
| Check the types | `docker compose exec frontend npx tsc --noEmit` |
| Build | `docker compose exec frontend npm run build` |
| Coverage | `docker compose exec frontend npm run coverage` |

## Layout

| Path | What it holds |
|---|---|
| `frontend/src/App.tsx` | The app: shows Log in or Tasks, and holds the task list's state |
| `frontend/src/api.ts` | Every call to the backend's API |
| `frontend/src/components/` | One file per component, with its demo and its test beside it |
| `frontend/src/demo/demos.test.tsx` | The test that fails when a component has no demo |
| `frontend/vite.config.ts` | The dev server's proxy to the API, and Vitest's settings |

## Test levels

| Level | Command | What it covers |
|---|---|---|
| `frontend` | `npm test --` | Components and their demos, in jsdom, with Vitest |

## Instructions

- `frontend/COMPONENTS.md`: the component list, and the rule that each component has a demo.
- `AGENTS.md`: MIRAI's block and the project's own instructions, for every agent.
