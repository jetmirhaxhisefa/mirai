---
id: sample-app-project-backend
type: project
template: project@v1
service: backend
root: backend
updated: "2026-11-20"
---
# Project: backend

The task list's API: Laravel behind nginx, with cookie logins through Sanctum and a MySQL database.

## Stack

| Part | Version | Set in |
|---|---|---|
| PHP | 8.4 | `docker/php/Dockerfile` |
| Laravel | 13 | `backend/composer.json` |
| Sanctum, for cookie logins | 4 | `backend/composer.json` |
| PHPUnit | 12.5 | `backend/composer.json` |
| Pint, the formatter | 1.27 | `backend/composer.json` |
| MySQL | 8.4 | `docker-compose.yml` |

## Commands

Run them from the repo's top folder: the app runs in Docker Compose, as the service `app`.

| What | Command |
|---|---|
| Start the whole app | `docker compose up -d --build` |
| Run the tests | `docker compose exec app php artisan test` |
| Check the format | `docker compose exec app vendor/bin/pint --test` |
| Check composer.json | `docker compose exec app composer validate --no-interaction` |
| Run the migrations | `docker compose exec app php artisan migrate` |

## Layout

| Path | What it holds |
|---|---|
| `backend/routes/api.php` | Every API route, behind Sanctum except the login |
| `backend/app/Http/Controllers/` | One controller per resource: the login and the tasks |
| `backend/app/Models/Task.php` | The task, with its rules: the title's length and marking it done |
| `backend/app/Policies/TaskPolicy.php` | Who may change a task: only its owner |
| `backend/database/migrations/` | The tables, one migration each |
| `backend/tests/Feature/` | API tests, through HTTP calls |
| `backend/tests/Unit/` | Tests of the rules alone |

## Test levels

| Level | Command | What it covers |
|---|---|---|
| `unit` | `php artisan test` | Unit and API tests with PHPUnit, on the separate `sample_test` database |

## Instructions

- `README.md`: how to run the app, the named checks, and the two tests that fail on purpose.
- `AGENTS.md`: MIRAI's block and the project's own instructions, for every agent.
