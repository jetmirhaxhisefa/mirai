---
status: settled by test
version: 1
---

# 12 — Test runner facts, settled by probes (unit 16a)

**What this is:** the facts the shipped test adapters (`registry/test-adapters/`) are built on:
- how each of the sample app's runners writes JUnit XML;
- how it runs one file or one test;
- what "no such test" and "doesn't load" look like.

They were settled by real runs of the sample app's own levels, through MIRAI's own `runTest`, on
a throwaway clone under the home folder (origin removed, a temporary MIRAI home). The harness is
`test/probes/adapter-probes.js`, run by hand; `npm test` never runs it. The reports it saved
are the corpus in `test/tests/corpus/`.

**Seen on:**
- PHPUnit 12.5.40 through Laravel 13's `php artisan test`;
- Vitest 3.2.7 through `npm test` (`vitest run`);
- Playwright Test 1.64.0 (`npx playwright test`);
- Docker Desktop 29.6.2, macOS 26.7, 2026-10-29.

A fact holds for those versions; unit 18 re-runs the probes when a runner changes.

**The test conditions:**
- the sample app's own images only, never pulled;
- every container, network and volume of a run checked gone afterwards;
- probe-only test files written to the clone's work tree, never committed. They cover:
  - a pass, an assertion that fails, a throw, a skip;
  - names that share a prefix or a suffix;
  - names with regex characters, and nesting;
  - a twin file (`a.test.tsx` beside `a.test.ts`);
- the files that don't load were present only for their own run (see J3: one stops a whole
  PHPUnit run).

## J1: the report

| | PHPUnit | Vitest | Playwright |
|---|---|---|---|
| **How it's asked for** | `--log-junit <file>`, passed on by artisan | `--reporter=default --reporter=junit --outputFile.junit=<file>`; through npm, after `--` | `PLAYWRIGHT_JUNIT_OUTPUT_FILE=<file>`: it wins over the config's junit `outputFile` (read in its source) and keeps the config's other reporters |
| **The test's file** | `file`, the service's absolute path (`/var/www/html/tests/…`) | `classname`, relative to Vitest's root (the service's working folder) | `classname`, relative to the config's `testDir` |
| **The test's name** | the method; a data set adds ` with data set "<name>"` (quotes kept) | describe blocks and title joined with ` > ` | describe blocks and title joined with ` › ` (U+203A) |
| **Assertion** | `<failure type="PHPUnit\Framework\ExpectationFailedException">` | `<failure type="AssertionError">`; Testing Library's matchers `<failure type="Error" message="expect(…)…">` | `<failure type="expect.toBe">` |
| **Error** | `<error type="RuntimeException">` | `<failure type="Error">` | `<error type="Error">` (a throw, or a test timeout) |
| **The message** | in the text; its first line is `Class::method` | a `message` attribute with literal newlines, and colour codes without their escape character (`[2m…[22m`) | a `message` attribute (the assertion's own message) |
| **Exit codes** | 0 pass, 1 failures, 2 errors | 0 or 1 | 0 or 1 |

Nested `<testsuite>` elements occur (PHPUnit: the config file, each suite, each class, each data
provider). No report had a DOCTYPE or an entity other than XML's own.

## J2: one file, one test

| | One file | One test | Exact? |
|---|---|---|---|
| **PHPUnit** | the path | `--filter '/::<name>(?: with data set .*)?$/' <path>`, a regex on `Class::method` | yes: anchored, `test_a_b` didn't run `test_a_bc` |
| **Vitest** | the path, matched as a **substring**: `a.test.ts` also ran `a.test.tsx` | `<path> -t '(?:^\| )<name>$'`, a regex on the describe blocks and title joined with spaces | yes for the name. Every other case is reported as skipped |
| **Playwright** | the path, as a **case-insensitive regex** on the absolute path: unanchored, `a.spec.ts` also ran `a.spec.tsx` | `<path> -g '(?:^\| )<name>$'`, a case-insensitive regex on the project, file, describe blocks and title joined with spaces | yes for the name. Cases that don't match are left out |

A name with spaces, quotes and `(x)+ "q" [y]` matched exactly that test once its regex
characters were escaped. Its `… more` twin and the nested test of the same title didn't run.

**The path:** the services mount parts of the project elsewhere. The sample app's `backend/` is
`/var/www/html` in `app`, `frontend/` is `/app`, `e2e/` is `/e2e`. 14d passed the project path
as is: `--path backend/tests/Unit` passed MIRAI's check, and PHPUnit answered `Test file
"backend/tests/Unit" not found` (exit 2, which 14d reported as a failing test). Since 16a, MIRAI
passes the service's absolute path, from the frozen compose file's mounts.

**Not probed:**
- **Playwright with a folder:** the adapter anchors the path at the end or a `/`
  (`…/tests(?:/|$)`), read from Playwright's source, not run.
- **Playwright without a junit reporter in the config:** the sample app's config lists one. As
  read in Playwright's source, `PLAYWRIGHT_JUNIT_OUTPUT_FILE` only sets where that reporter
  writes, so a config without it would leave no report (`bad-report`). The adapter's docs say
  the config must list it.

## J3: not found, doesn't load

| | A name that isn't there | A file that doesn't load | A file that isn't there |
|---|---|---|---|
| **PHPUnit** | exit 1, `No tests found.`, `<testsuites/>` | exit 255, `An error occurred inside PHPUnit.`, an **empty** report file. Present anywhere in a folder being run, **one such file stops the whole run** | exit 2, `Test file "…" not found`, an empty report |
| **Vitest** | **exit 0**, every case skipped | exit 1, one case named after the file, `<failure type="Error" message="Failed to resolve import …">` | exit 1, `No test files found`, an empty `<testsuites>` |
| **Playwright** | exit 1, `Error: No tests found.`, an empty `<testsuites>` | exit 1, `Error: Cannot find module …` at the start of a line, then `Error: No tests found.`, an empty `<testsuites>` | as a name that isn't there |

So:
- "nothing ran" has to be told from the report, never from the exit code: Vitest exits 0;
- a file that doesn't load looks different in each runner, so it's each adapter's `classify`.

MIRAI refuses a file that isn't in the copy before anything runs (14d).

## J4: no report

A run without the report option (14d's `--path` run above) left the output folder empty. MIRAI
reads the report only as a regular file in the output folder, without following a link.

## Seen on the way

- **One PHPUnit file that doesn't parse stops every PHPUnit run that includes it.** Through
  MIRAI's runs it's a failing run of kind `load`, from the adapter's exit code and output.
- **Docker Desktop and a reused folder:** a folder removed and made again at the same path, then
  bind-mounted, failed with `bind source path does not exist` (Desktop's file sharing still had
  it as removed). MIRAI's run folders are always new; the harness now always uses a fresh work
  folder.
- **The sample app's own tests under load:**
  - Vitest's `AddTaskForm` tests timed out at 5 s, and one typed each character twice
    ("BBuuyy mmiillkk");
  - Playwright's smoke test timed out at 30 s waiting for the page after login.

  Both ran while other test runs loaded the machine, and both passed in 14c. Unit 17's baseline
  will see such failures as flaky.
