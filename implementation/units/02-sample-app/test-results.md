---
unit: "02"
name: sample-app
date: 2026-10-23
repo: github.com/jetmirhaxhisefa/mirai-sample-app (private, still empty until "UNIT APPROVED")
local: ~/Projects/mirai-sample-app (97 files staged, not committed)
versions: PHP 8.4.27, Laravel 13.38.0, MySQL 8.4, Node 22, React 18, Vite 5.4.21, Vitest 3.2.7, Playwright 1.64.0
result: all 6 spec checks pass, plus 3 checks added after review; final run on fresh volumes
---

# Unit 02 — Test results

The final run came after the review fixes (`review.md`), with all volumes deleted and the images
rebuilt, so it is close to how unit 14 will start the app.

## Verification

| # | Check | Result |
|---|---|---|
| 1 | Services up and healthy; UI and API answer | **Pass.** All four services `healthy` (the frontend and nginx now have healthchecks). `GET /` → 200; `GET /api/user` as a guest → 401 |
| 2a | PHPUnit, with JUnit XML and Clover coverage (pcov) | **Pass as designed:** 13 passed, 1 failed (`KnownFailureSeedTest`); `junit.xml` and `clover.xml` written |
| 2b | Vitest, 10 runs | **Pass as designed:** 5 runs "1 failed, 5 passed" (the flaky seed) and 5 runs "6 passed"; the 5 real tests passed every time |
| 2c | Vitest coverage | **Pass:** `coverage/lcov.info` written (v8) |
| 2d | Playwright smoke (log in → add task → complete) | **Pass:** 1 passed (7.8s; the dependencies are now in the image) |
| 3 | Named checks | **Pass:** `composer-validate`, `format`, `lint`, `types`, `build` |
| 4 | Secret scan of everything staged | **Pass:** 97 files; no `node_modules`/`vendor`/`dist`/`coverage`; the real `.env` not staged; the canary found 0 times; 0 secret-pattern hits |
| 5 | Repo visibility | **Pass:** `PRIVATE`, `isEmpty: true` |
| 6 | Compose mounts and ports | **Pass:** no `.git`, home folder or Docker socket; nothing privileged or on the host network; every port on `127.0.0.1` |
| 7 | Login rate limit (added after review) | **Pass:** 6 wrong tries → 422, then 429 |
| 8 | Start without the real `.env` (added after review) | **Pass:** with `APP_ENV=testing` and `.env` masked by `/dev/null`, the app boots on `.env.testing` and uses the `sample_test` database |
| 9 | Canary in the built images (added after review) | **Pass:** 0 files in `mirai-sample/app`, `/frontend` and `/e2e` contain the canary (`.dockerignore` keeps `.env` out of builds) |

## Raw output (final run)

```
### 1. services (fresh volumes)
app        Up 4 minutes (healthy)
frontend   Up 4 minutes (healthy)
mysql      Up 5 minutes (healthy)
nginx      Up 4 minutes (healthy)
UI / -> 200
API /api/user as guest -> 401
### 2a. PHPUnit (+ JUnit + clover coverage via pcov)
   FAILED  Tests\Feature\KnownFailureSeedTest > known failure seed
  Tests:    1 failed, 13 passed (34 assertions)
8373 /tmp/clover.xml
4757 /tmp/junit.xml
### 2b. Vitest x10
   5       Tests  1 failed | 5 passed (6)
   5       Tests  6 passed (6)
### 2c. Vitest coverage (lcov)
1954 coverage/lcov.info
### 2d. Playwright
  ✓  1 tests/smoke.spec.ts:4:5 › log in, add a task and complete it (3.3s)
  1 passed (7.8s)
### 3. named checks
./composer.json is valid
format: pass
lint: pass
types: pass
build: pass
### 4. secret scan (staged files)
files staged: 97
heavy dirs staged: 0
real .env staged: 0
canary value in staged content: 0
secret pattern hits: 0
### 5. repo visibility
{"isEmpty":true,"visibility":"PRIVATE"}
### 6. compose mounts
services: app, frontend, mysql, nginx, playwright
forbidden mounts / privileged / host network / non-localhost ports: none
### 7. login rate limit (8 wrong tries)
422 422 422 422 422 422 429 429
### 8. app starts with .env masked (APP_ENV=testing, .env -> /dev/null)
NOTICE: ready to handle connections
sample_test testing
### 9. canary in built images
mirai-sample/app:dev: 0 files contain the canary
mirai-sample/frontend:dev: 0 files contain the canary
mirai-sample/e2e:dev: 0 files contain the canary
```

## Changes against the approved spec

| Change | Why |
|---|---|
| The test env file is `backend/.env.testing`, not `.env.test` | Laravel loads `.env.testing` automatically. D-49's file is a configured path |
| The demo password (`demo-password`) is public test data, the same in `.env.example`, `.env.testing` and the e2e service | The browser test must log in without reading `.env`, including under unit 14's dummy env |
| Dependencies installed at **image build time**; images named `mirai-sample/{app,frontend,e2e}:dev`; a Dockerfile for e2e | Unit 14's runs have no outside network and fresh volumes (Architect, blocking for unit 14) |
| `APP_ENV=testing` lets the app start from `.env.testing` alone | Unit 14 masks the real `.env` (Architect, blocking for unit 14) |
| `scripts/make-env.sh` creates `.env` with a canary in the pattern `mirai-canary-<24 hex>`; the entrypoint refuses any other value | Unit 18 finds the canary by pattern |
| Coverage tooling: pcov (PHP), `@vitest/coverage-v8` 3.2.7 | Unit 16 needs lcov or Cobertura |
| Healthchecks on all four services; Playwright waits for a healthy frontend | No false e2e failures on a cold start |
| More tests: PHPUnit 3 unit + 10 feature; Vitest 5 + the flaky seed | Review gaps: too-long title at API level, `done` not settable on create, UI save error |
| Extra mounts beyond the two source folders: `backend/public` (nginx), `e2e/` (Playwright), `docker/nginx/default.conf`, `docker/mysql/init.sql` | Needed by those services; none is sensitive |
| Playwright pinned to 1.64.0, not the newest 1.64.1 | The two-week rule for pinned versions |
| Ports `8100`/`8180` on localhost; no MySQL host port | No clash with the pilot; less exposure |

## Findings for MIRAI (beyond this unit)

1. **Laravel 13's project template ships `AGENTS.md` and `CLAUDE.md`** telling AI agents to run
   `curl … | bash` installers and install Laravel Boost first. They were removed from the sample
   app. The follow-ups are in `review.md` ("Proposed changes for later units").
2. **A full Docker disk hangs things instead of failing them.** Docker's 59 GB disk hit 100%,
   so MySQL couldn't write and logins and seeding hung (504). See `review.md`.
3. **This machine is slow on a cold start.** The first Playwright run took about 15 minutes
   (image pull + `npm ci`). Now that dependencies are in the images, later runs take about 8
   seconds.

## Housekeeping

- **Your other containers:** 10 Supabase containers (project `riblsogjwbgghlzjcgvy`) are
  **stopped, not removed**. `supabase_db` had already crashed (exit 1) from the full disk before
  the stop. Restart them with `supabase start` in that project.
- **Disk:** unused images were deleted (with your OK) and so was **all** build cache (19 GB, every
  project's), so other projects' next image builds will be slower once. Docker now has 27 GB
  free (52% used).
- **The Mac stays awake** while this session runs (`caffeinate -dimsu -w <claude pid>`).
