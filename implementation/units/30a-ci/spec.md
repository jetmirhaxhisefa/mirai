---
unit: "30a"
name: ci
status: draft (decision 1 from Jet's answer, 2026-11-19)
roadmap: design/07-implementation-roadmap.md, row 30a; design/04-decisions.md D-63; design/11-platforms.md (P01 follows)
depends_on: ["01", "29e"]
---

# Unit 30a: MIRAI's own CI on Ubuntu, and the operating-system module

## Why

MIRAI's repo has no CI. Its suite runs only on your Mac, through the build runner. D-63 keeps the
MVP macOS-only, but asks for two things so that the Ubuntu port (P01) stays small:

- the unit tests run on Ubuntu from now on;
- one module answers every question about the operating system.

Both catch path and shell assumptions when they're written, not a year later. Today, 31 files
in `src/` name macOS things directly, such as `Library/Application Support`, `darwin` or
`sandbox-exec`.

## Decisions

1. **CI is required to merge** (Jet, 2026-11-19). Branch protection on `main` means a PR merges
   only when both the macOS and the Ubuntu jobs are green. You can still override as the repo's
   admin.
2. **What CI proves, and what it doesn't:**
   - GitHub's machines have no Docker on macOS, no Claude Code, and no keys of yours.
   - So CI runs every test that needs none of these. On Ubuntu it also leaves out tests that
     need macOS's cage (`sandbox-exec`).
   - **The build runner's `tests` job on your Mac stays the full check**, and each unit's
     done-when still names it.
   - CI is the fast gate that also catches Linux slips.
3. **The repo is public, so CI is free**, macOS included.
   - It runs on pull requests and on pushes to `main`, with `pull_request` (never
     `pull_request_target`), read-only permissions and no secrets.
   - A fork's PR gets the same run, with nothing to steal.

## Scope

**In**

1. **`.github/workflows/ci.yml`:**
   - **The jobs:** `macos-latest` and `ubuntu-latest`, each on Node 22 (MIRAI's minimum) and
     Node 24;
   - **Each job runs** `npm test`: `node --test` as today, with no npm install, since MIRAI has
     no dependencies;
   - **Pinning:** actions pinned to full commit SHAs, `permissions: contents: read`, and a
     timeout.
2. **Tests that can't run there are marked, not hidden.**
   - **The helper:** `test/helpers/needs.js` gives `needs('docker' | 'cage' | 'claude' |
     'macos', reason)`. Each test it marks is skipped with that reason when the thing is missing.
   - **What's missing:** detected (`docker info`, `sandbox-exec` present, a real `claude`), never
     guessed from an environment variable that CI could set.
   - **On your Mac,** nothing is skipped that runs today. A test checks that the skip list there
     is empty with Docker running.
   - **Each job prints the left-out tests,** grouped by reason, at the end of its run: "left out
     (n): docker: …".
3. **The operating-system module, `src/os/index.js`:**
   - One module answers:
     - where MIRAI's home is;
     - which sandbox runs the cage;
     - how paths are compared (macOS folds case and Unicode);
     - where glab's config lives;
     - the denied home paths for agents.
   - It has the macOS answers, and a plain "not supported yet: <system>" for every other system
     that MIRAI would need in order to run there.
   - Code that runs today keeps working, because no existing macOS code moves (that's P01).
     Only new code must ask the module.
4. **The guard test:**
   - It searches `src/` for system checks: `process.platform`, `os.platform()`, `darwin`,
     `Library/Application Support`, `sandbox-exec`, `/Users/`.
   - It fails on a new one outside `src/os/`.
   - The ones that exist today are on a list in the test, with their file and count. P01 empties
     the list. A list entry whose code is gone fails too, so the list only shrinks.
5. **Branch protection:**
   - After the first green run, `main` requires both jobs. It also requires a PR, and keeps
     admin override.
   - It's set by one `gh api` command. You run it, since it changes your repo's settings, and I
     give you the exact command.
6. **Docs:**
   - `docs/ci.md`: what runs where, the left-out list, and how to mark a test;
   - a line in `CONTRIBUTING` or the README.

**Out**

- Moving existing macOS code into the module, the store under XDG on Linux, and `doctor`
  naming the system: all P01.
- Docker, the cage or the red team in CI: they stay on the build runner.
- Windows.

## Tests

- **T1 Marked tests:**
  - `needs('docker')` skips with its reason when `docker` is missing or not running;
  - it runs the test when Docker is there;
  - an unknown need is a test error.
- **T2 The left-out list:** a run with two skipped tests prints both, grouped by reason. A run
  with none prints "left out: none".
- **T3 The module:**
  - the macOS answers equal today's values (the home path, the case fold);
  - asked as `linux`, each answer is "not supported yet: linux" with a hint, and never a
    guessed path.
- **T4 The guard:**
  - a system check added outside `src/os/` fails, naming the file and line;
  - one inside `src/os/` passes;
  - a list entry whose code is gone fails ("the list only shrinks").
- **T5 The workflow file:**
  - every `uses:` is pinned to a 40-hex SHA;
  - its permissions are read-only;
  - its trigger is `pull_request`, never `pull_request_target`;
  - no `secrets.` appears in it.

## Probes (real)

- **P1 The first CI run:** the PR's own run.
  - Both systems go green, and the Ubuntu job prints its left-out list.
  - Each test that fails on Ubuntu is either marked with its real reason, or is a Linux slip in
    test code (fixed).
  - A failure that needs macOS code to move is marked `macos` and listed for P01, never fixed
    here.
- **P2 A red PR:** a throwaway branch with a failing test is opened as a draft PR. Its run goes
  red, and the merge button is blocked once protection is on. The PR is then closed.
- **P3 Your Mac:** the runner's `tests` job leaves nothing out, with Docker running.

## Done when

- T1–T5 pass, and the full suite passes through the build runner's `tests` job.
- P1, P2 and P3 pass.
- Branch protection on `main` requires both jobs.
- The roadmap row's done-when holds:
  - the workflow is green on both systems;
  - the Ubuntu run prints which tests it left out and why;
  - a new system check outside the module fails a test.
