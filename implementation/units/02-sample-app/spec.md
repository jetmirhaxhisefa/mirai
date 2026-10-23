---
unit: "02"
name: sample-app
status: draft
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 02; D-55
depends_on: ["01"]
---

# Unit 02 — The sample app (`mirai-sample-app`)

## Why

Every MIRAI unit is tested on this app before the pilot. It's a **test bench, not a product**
(`00`, "Changes at the start of implementation"):
- **Same stack as the pilot,** so the test adapters (unit 16) and named checks carry over
  unchanged (D-55).
- **Safe to attack:** its secrets are fake, so the red-team suite (unit 18) can try to steal
  them.
- **Cheap to run:** a small test suite keeps agent runs fast and light on your usage limit.
- **Deliberate traps:** a known-failing test and a flaky test, to check the test baseline.

**Roadmap "done when":**
- `docker compose up` starts it;
- each test level and named check runs;
- the seeded failing and flaky tests behave as designed;
- no real secret exists in it;
- the repo is private.

## Scope

**In:**
- A new private GitHub repo `jetmirhaxhisefa/mirai-sample-app`, cloned at
  `~/Projects/mirai-sample-app`.
- A small app with one feature (below), its tests, the named checks, Docker Compose and a README.

**Out:**
- **MIRAI itself:** nothing is installed into the app yet (unit 10).
- **CI** for the app (unit 54).
- **Storybook:** not needed (your decision).
- **Anything in the pilot.**

## The stack (matches the pilot, `research/04` §1)

| Part | Choice |
|---|---|
| API | PHP 8.4, Laravel 13, Sanctum (SPA cookie auth), PHPUnit, Pint |
| Database | MySQL 8.4, used in tests too (as in the pilot) |
| UI | React 18, TypeScript, Vite, Vitest, ESLint |
| Browser tests | Playwright, run in the official Playwright container |
| Runtime | Docker Compose: `app` (PHP-FPM), `nginx`, `frontend` (Vite), `mysql` |

Exact versions are pinned in `composer.lock` and `package-lock.json`. The Docker images are
pinned by tag. If the pilot's versions differ when I build, I follow the pilot.

## The feature: a task list behind a login

Small, but with what MIRAI's QA needs (a login, a screen, a form, data):
- **Login** with a seeded user (`demo@example.test`, password from `.env`).
- **Tasks:**
  - the API lists, creates and completes tasks for the logged-in user (`GET/POST /api/tasks`,
    `PATCH /api/tasks/{id}`), with validation (title required, at most 120 characters);
  - the UI shows a login page, the task list, an "add task" form and a "done" checkbox;
  - stable handles (ARIA roles, `data-testid`) for unit 49's feature map.

## Tests and the seeded traps

| Level | What | Count |
|---|---|---|
| `unit` (PHPUnit) | The task model and validation rules | about 3 |
| `api` (PHPUnit feature tests) | Login, list, create, complete, validation errors, another user's task is refused | about 6 |
| `ui` (Vitest) | The task form and list components | about 3 |
| `e2e` (Playwright) | One smoke journey: log in → add a task → mark it done | 1 |

**Seeded on purpose, named so nobody "fixes" them by accident:**
- **`KnownFailureSeedTest`** (PHPUnit): always fails, so the test baseline (unit 17) records a
  known failure.
- **`flaky-seed.test.ts`** (Vitest): fails about half the time, so the baseline marks it flaky.
- The README lists both and says why they exist.

## Named checks (the pilot's gate, split up)

| Name | Command (run in the containers) |
|---|---|
| `composer-validate` | `composer validate --no-interaction` |
| `format` | `vendor/bin/pint --test` |
| `lint` | `npm run lint` (ESLint) |
| `types` | `npx tsc --noEmit` |
| `build` | `npm run build` |

## Secrets (all fake)

- **`.env.example`** (committed): every key, no values that look real.
- **`.env.test`** (committed): dummy values for test runs, as MIRAI's `run_tests` will use them
  (D-49).
- **`.env`** (gitignored, created locally): fake values that **include canary strings** such as
  `CANARY_SECRET=mirai-canary-<random>`. The red-team suite (unit 18) will try to read this file.
  If a canary shows up anywhere it shouldn't (an agent transcript, a commit, a test container),
  that's a proven leak.
- No real key, token or password exists anywhere in the repo. Checked with a secret-pattern scan
  before the first push.

## Compose rules (ready for the hardening in unit 14)

- The source folders (`backend/`, `frontend/`) are the only mounts. Never `.git`, the home
  folder or the Docker socket.
- No `privileged`, and no host network.
- One project network.

## How I build it (safety notes)

- **Scaffolding runs only inside containers:** `composer create-project laravel/laravel` in the
  official `composer` image, and `npm create vite` in the official `node` image. Nothing is
  installed on your Mac.
- These pull packages from Packagist and npm. That's normal app building, not running an
  external *skill*, but it does run the packages' install scripts in the container.
  `npm install --ignore-scripts` is used where it doesn't break the build.
- Lockfiles are committed, so later runs install the same versions.
- **Every test command is scoped** to the app's own folders (lesson from unit 01).

## Verification (what I run before asking for approval)

1. `docker compose up -d` → all services healthy; the UI and API answer on localhost.
2. Each test level runs and gives the expected result:
   - PHPUnit: all pass except `KnownFailureSeedTest`;
   - Vitest: all pass, and the flaky test fails at least once in 10 runs;
   - Playwright: the smoke test passes.
3. Each named check passes.
4. A secret-pattern scan of the repo and its history finds nothing real. The canary values appear
   only in the gitignored `.env`.
5. `gh repo view` shows `visibility: PRIVATE`.
6. `docker compose config` shows no mount of `.git`, the home folder or the Docker socket.

The results go into `implementation/units/02-sample-app/test-results.md` in the MIRAI repo. Then
come the Tech Lead and Architect reviews, and your "UNIT APPROVED".

## Done when

- All six verification points pass, with output recorded.
- The sample app is pushed to its private repo (first push only after your approval).
- **In the MIRAI repo:** `PROGRESS.md` gets unit 02's line. The move of the external clones (done
  2026-10-23, path updates in `research/` and `design/`) is committed with this unit.

## Open point for you

- **The `gh` login** must be done first: `! gh auth login --hostname github.com --git-protocol https --web`.
  I create the repo right after "SPEC APPROVED" and keep it empty until your "UNIT APPROVED".
