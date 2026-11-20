# mirai-sample-app

A **private test bench for MIRAI**, not a product. Every MIRAI unit is tested here before it
touches a real project. It mirrors the pilot's stack (Laravel API + React SPA + MySQL + Playwright,
in Docker Compose) and contains **deliberate traps** and **fake secrets**.

## The app

A task list behind a login:
- log in with the seeded demo user;
- list, add and complete your own tasks (a title is required, at most 120 characters);
- you can't see or complete another user's tasks.

| Part | Stack | Where |
|---|---|---|
| API | PHP 8.4, Laravel 13, Sanctum (SPA cookie auth), PHPUnit, Pint | `backend/` |
| UI | React 18, TypeScript, Vite 5, Vitest, ESLint | `frontend/` |
| Browser tests | Playwright 1.64.0 in the official container | `e2e/` |
| Database | MySQL 8.4 (tests use the separate `sample_test` database) | `docker/mysql/` |

## Run it

```sh
scripts/make-env.sh                    # creates backend/.env (all fake)
docker compose up -d --build           # dependencies are installed at build time
open http://localhost:8180             # log in: demo@example.test / demo-password
```

The UI is on `localhost:8180`, and the API is reached through it (`/api`, `/sanctum`), so cookie
auth needs no CORS. nginx also listens on `localhost:8100`. Ports bind to localhost only.

## Tests

| Level | Command |
|---|---|
| `unit` + `api` (PHPUnit) | `docker compose exec app php artisan test` |
| `ui` (Vitest) | `docker compose exec frontend npm test` |
| `e2e` (Playwright) | `docker compose --profile e2e run --rm playwright` |

**Coverage:** PHPUnit uses pcov (`php artisan test --coverage-clover=coverage.xml`), Vitest uses
v8 (`npm run coverage` writes `coverage/lcov.info`). JUnit XML: `--log-junit` (PHPUnit),
`--reporter=junit` (Vitest), `e2e/results/junit.xml` (Playwright).

**The e2e test adds one task per run** to the demo user (unique titles, so reruns stay green).
Reset with `docker compose down -v`.

## Named checks

| Name | Command |
|---|---|
| `composer-validate` | `docker compose exec app composer validate --no-interaction` |
| `format` | `docker compose exec app vendor/bin/pint --test` |
| `lint` | `docker compose exec frontend npm run lint` |
| `types` | `docker compose exec frontend npx tsc --noEmit` |
| `build` | `docker compose exec frontend npm run build` |

## Seeded test traps (do not fix)

| Test | Behaviour | Why |
|---|---|---|
| `backend/tests/Feature/KnownFailureSeedTest.php` | Always fails | MIRAI's test baseline must record it as an existing failure, so it never blocks new work |
| `frontend/src/flaky-seed.test.ts` | Fails about half the time | The baseline must mark it flaky |

## Compose rules

- Only the app's own folders are mounted: never `.git`, the home folder or the Docker socket.
- Dependencies are baked into the images (`mirai-sample/app`, `/frontend`, `/e2e`), so a run needs
  no network. `.dockerignore` keeps `.env`, `.git` and installed dependencies out of builds.
- No privileged containers and no host network; one project network.
