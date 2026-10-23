---
unit: "02"
date: 2026-10-23
reviewers: Tech Lead, Architect (independent, read-only; neither read backend/.env)
verdicts: PASS WITH FIXES, PASS WITH FIXES
---

# Unit 02 — Review

The Tech Lead found nothing blocking. Its probes confirmed:
- CSRF is enforced: a login without the XSRF token returns 419;
- ownership checks work;
- `user_id` can't be mass-assigned;
- the session is regenerated on login;
- tests never touch the app database.

The Architect found two points that would have **blocked unit 14**. Both are fixed. Every
should-fix and nit is applied, and `test-results.md` shows the final run on fresh volumes.

## Applied in unit 02

| # | Finding | From | Fix |
|---|---|---|---|
| 1 | Dependencies installed at start-up over the network; unit 14's fresh volumes and missing outside DNS would fail every run | Architect (blocking for 14) | Installed at image build time; fixed image names; a Dockerfile for e2e |
| 2 | The app needed the real `.env` to start | Architect (blocking for 14) | `APP_ENV=testing` starts from `.env.testing` alone (check 8) |
| 3 | The e2e password didn't match `.env.testing` | Architect | One public value in all three places |
| 4 | No coverage tooling | Architect | pcov + `@vitest/coverage-v8` 3.2.7 (checks 2a, 2c) |
| 5 | No healthchecks on the frontend or nginx; Playwright didn't wait for a ready UI; no `start_period` on the app | both | Healthchecks on all four, `start_period`s, `condition: service_healthy` |
| 6 | The canary was filled in by hand | Architect | `scripts/make-env.sh`; the entrypoint refuses a value outside the pattern |
| 7 | Tests could wipe the app database after a `config:cache` | Tech Lead | `DB_DATABASE=sample_test` forced in `phpunit.xml` |
| 8 | No login rate limit | Tech Lead | `throttle:6,1` (check 7) |
| 9 | `npm ci` ran install scripts | Tech Lead | `--ignore-scripts` at build |
| 10 | The README told you to invent an `APP_KEY` | Tech Lead | `make-env.sh` generates it |
| 11 | Leftovers: `backend/.npmrc`, the welcome view pointing at deleted assets | Tech Lead | Removed; `/` returns a short JSON note |
| 12 | Nits: a stale closure in `App.tsx`; API errors not shown; UTF-16 vs character count; `done` was fillable; `env()` in the seeder; no API test for the length limit; e2e data growth undocumented; the e2e password link undocumented; extra mounts not in the spec table | Tech Lead | All fixed or documented; tests added |
| — | `chown -R` on the bind mount | Tech Lead | Kept: it's limited to `storage` and `bootstrap/cache`, which is what the app writes |
| — | `mysql:8.4` / `nginx:1.27-alpine` float on patch versions | Architect | Deferred to unit 14, which freezes the compose file and can pin digests |

## Proposed changes for later units (approved 2026-10-23 and added to `07`)

| # | Unit | Proposal | From |
|---|---|---|---|
| P1 | **13** (blocking rules) | The headless launch must control which `CLAUDE.md`/`AGENTS.md` load. Listing them in the ledger isn't enough, because Claude Code loads the project's `CLAUDE.md` itself | Architect |
| P2 | **17** (detection) and **39** (setup ledger) | Find **every** agent-instruction file (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.cursor/rules`, `.github/copilot-instructions.md`) and flag shell, network and install commands in them. Laravel 13's template is the live example | both |
| P3 | **18** (red-team) | Plant an instruction file like Laravel's on a fixture branch at run time (not committed). Add a second canary in another `.env*` file, to prove *every* real env file is masked. Check that QA screenshots and transcripts never show env values on a debug error page | Architect |
| P4 | **13**, **14** | Masking and `denyRead` use exact paths: `.env.testing` matches `.env*` but must stay readable | Architect |
| P5 | **14**, **16** | Hard timeouts on test runs. A timeout counts as an environment fault, not a test failure (a full disk hangs instead of failing) | Architect |
| P6 | **52** (environment faults) + `doctor` | Check Docker's free disk before every run and ticket; stop with a clear message below a threshold | both |
| P7 | **17** | Rerun until both a pass and a fail are seen, up to 10 runs. The chance of a wrong "stable" verdict on the 50% seed is 0.2% at 10 runs. Map PHPUnit suites `Unit`/`Feature` to MIRAI levels `unit`/`api` | Architect |
| P8 | **52** | "Re-run a flaky test once" still fails about 25% of the time on a 50% test; use the baseline's flaky list instead of a single re-run | Architect |
| P9 | **30** (pilot checkpoint) | Check the pilot for agent-instruction files too | Architect |
| P10 | **57** (calibration) | Budget a cold first run (image pull) and about 20–30 seconds of MySQL start-up per hardened run | both |
| P11 | Later | A low-rate flaky test (about 10%) and a flaky PHPUnit test, closer to real projects | Architect |
