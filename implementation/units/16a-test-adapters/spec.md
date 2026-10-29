---
unit: "16a"
name: test-adapters
status: approved (2026-10-29)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 16 (split proposed below into 16a and 16b); D-48 item 5, D-40, R2-M7, TL2-10, P5
depends_on: ["15b"]
---

# Unit 16a: Test adapters and JUnit results

## Why

Today a test run returns pass or fail, an exit code and the end of the output (14c, 14d). Later
units need to know **which tests** failed and **why**:
- **the red check** (unit 23): a new test must fail for the right reason, an assertion and not a
  "not found" or a crash;
- **the baseline** (unit 17): the tests that already fail or are flaky;
- **the gate** (unit 25).

An agent also needs to run **one test**, not only a file or a whole level. 14d left that open:
test IDs such as `tests/LoginTest.php::test_rejects_bad_password` need each runner's own
escaping.

D-48 item 5 sets the contract: run one file or test ID, results as JUnit XML, and small
zero-dependency parsers. This unit builds it for results. **Coverage and unified diffs** follow in
16b (open point 1).

**Stack-neutral, as everything in MIRAI** (your rule since unit 12: nothing built in may assume
one stack):
- **What's built in is the same for every stack:** the contract, a JUnit XML reader and the
  classification rules.
- **Each framework is a data file,** a **test adapter** (`registry/test-adapters/<name>.toml`)
  that a level opts into with `adapter = "<name>"`. A level without one works exactly as today.
- **Three adapters ship,** for the sample app's stacks (which are the pilot's): **PHPUnit**
  (through `php artisan test`), **Vitest** and **Playwright**.
- **A project can add its own** in `.mirai/custom/test-adapters/`. It's read from the trust root
  like everything else, so a new stack is a new data file, never new code.

**Roadmap "done when" covered here:**
- the sample app's tests run by ID;
- results parse;
- a malformed report is an environment fault, not a failure.

**Moved to 16b:** coverage parses (lcov, Cobertura) and the unified-diff parser.

**Dropped:** "a run longer than the time limit is chunked" (open point 2). It came from Claude
Code's 10-minute Bash limit. Agents now run tests through the MCP tool, which has a 6-hour
timeout and proved 12-minute calls (14d). The level's own `timeout_minutes` already ends a run as
`timeout` (14c), which the gate counts as an environment fault (P5, unit 25).

## Scope

**In:**

1. **Facts first: adapter probes on the sample app** (`test/probes/adapter-probes.js`, by hand,
   Docker Desktop, the sample app's images; open point 4). For each adapter:
   - **J1:** the flags that make it write JUnit XML into the run's output folder (`/mirai/out`),
     and what the file looks like: suites, cases, `classname`/`file`/`name`, failure versus
     error, skipped, and the time and line attributes;
   - **J2:** how to run **one file** and **one test** through the level's own command:
     - `php artisan test` passes PHPUnit's `--filter` and a path through;
     - Vitest takes a file and `-t <name>`;
     - Playwright takes a file and `-g <name>`;
     - the probe also confirms that a name with spaces, quotes or regex characters matches
       exactly that test;
   - **J3:** what "the test doesn't exist" and "the code doesn't compile or load" look like (exit
     code, JUnit content, or no file), so they can be told from an assertion failure;
   - **J4:** that a run that writes no report, or a broken one, is caught.

   The sample app's seeded known failure and flaky test (unit 02) give real failing cases. The
   adapters' fields below are then settled from these probes.

2. **The adapter contract** (`registry/test-adapters/<name>.toml`, schema `test-adapter/1`):
   - **`results`:** `format = "junit"` and the file (`{out}/junit.xml`), plus the arguments that
     ask for it (`["--log-junit", "{out}/junit.xml"]`, or an environment variable for runners
     that take one, such as Playwright's `PLAYWRIGHT_JUNIT_OUTPUT_NAME`);
   - **`file`:** the arguments for one file (`["{path}"]`), replacing 14c's `-- <path>`;
   - **`test`:** the arguments for one test, from its file and name (such as `["--filter",
     "{name:regex}", "{path}"]`). A placeholder says how the name is passed: `{name}` as written,
     or `{name:regex}` with every regex character escaped, for runners that match by pattern;
   - **`id`:** how a JUnit case maps back to a test ID: which attribute holds the file
     (`file`, or a `classname` mapped to a path) and the name;
   - **`classify`:** what counts as "not found" and as a load or compile error, as patterns on the
     exit code and the JUnit content, settled by J3;
   - **checked when loaded:**
     - known fields only, every placeholder known;
     - argument templates that never start with `-` from a value;
     - **no shell, ever:** each placeholder fills exactly one argv element.

3. **Test IDs in `run_tests`** (and `mirai test --test <id>`):
   - **the form:** `<path>::<name>`;
     - **the path** keeps 14d's rules (no leading `-` or `/`, no `.`/`..` parts, checked in the
       copy, no link along it);
     - **the name** is printable text: 1–200 characters, no control characters, newline, bidi
       or invisible-only text;
   - **`path` stays** for a file or folder;
   - **with no adapter on the level,** a test ID is refused with a clear message. A file works as
     today (`-- <path>`).

4. **Reading results** (`src/tests/junit.js`, zero dependencies):
   - **a small XML reader** for what JUnit files use:
     - elements, attributes, text, CDATA, comments and the XML declaration;
     - the five predefined entities and numeric character references;
     - **refused:** a DOCTYPE, any other entity, more than 64 levels deep, a file over 16 MiB, or
       more than 100,000 test cases. A refused file is a malformed report;
   - **JUnit, as runners write it:** nested `<testsuites>`/`<testsuite>`, and `<testcase>` with
     `<failure>`, `<error>`, `<skipped>`, `system-out`/`system-err` (ignored), time;
   - **each case becomes** `{ id, file, name, outcome: pass | fail | error | skip, kind, message }`:
     - `kind` is `assertion`, `error`, `not-found` or `load`, from the adapter's `classify`;
     - `message` is the first line of the failure, redacted, at most 300 characters.

5. **What a run returns, in addition to today's fields** (stored in `result.json` and inline
   from `run_tests`):
   - `tests`: `{ total, passed, failed, errors, skipped }`;
   - `failing`: up to 50 of the failed or errored cases (`id`, `outcome`, `kind`, `message`),
     with the rest counted;
   - `report`: `ok`, `missing` or `malformed`.

   **A level with an adapter whose report is missing or malformed is `env-fault`** (code
   `bad-report`), whatever the exit code. The roadmap: a malformed report is an environment
   fault, not a failure. Without an adapter, nothing changes.

6. **The sample app's config** (your commit, as in 14c):
   - `adapter = "phpunit"` on `unit`, `"vitest"` on `frontend` and `"playwright"` on `e2e`;
   - I'll give you the exact lines, and you commit them in the sample app (never pushed by me).

7. **Docs:**
   - `docs/agent-safety.md` gains test IDs and what comes back;
   - a short `docs/test-adapters.md` on writing a project adapter;
   - `research/11` (or a new `research/12`) gets J1–J4.

**Out:**
- **Coverage (lcov, Cobertura) and unified diffs:** 16b.
- **Detecting adapters at setup:** unit 17.
- **The baseline, the red check and the gate's use of results:** units 17, 23 and 25.
- **Flakiness** (re-runs, quarantine): the baseline's (unit 17).

## Files

- **New:**
  - `src/tests/adapters.js` (load and check adapters, build argv);
  - `src/tests/junit.js` (the XML reader, JUnit cases, classification);
  - `registry/test-adapters/{phpunit,vitest,playwright}.toml`;
  - `registry/schemas/test-adapter.*` (if the registry keeps schemas there);
  - `test/tests/adapters.test.js`, `test/tests/junit.test.js` and a JUnit corpus under
    `test/tests/corpus/`;
  - `test/probes/adapter-probes.js`;
  - `docs/test-adapters.md`;
  - `implementation/units/16a-test-adapters/{spec,test-results,review}.md`.
- **Changed:**
  - `src/tests/run.js` (argv from the adapter, read the report, the new fields);
  - `src/mcp/args.js` and `src/mcp/tools/tests.js` (test IDs);
  - `src/cli/commands/test.js` (`--test`);
  - `src/config/registry.js` (test adapters, core plus the project's custom ones);
  - `src/config/config-schema.js` (the level's `adapter` checked against the known ones);
  - `src/launch/strict.js` (`testTools` unchanged unless the tool schema needs the ID form);
  - `docs/agent-safety.md`, `design/04-decisions.md` (D-48 item 5), the roadmap (the split).

## Tests

`npm test`, no Docker:
- **T1: the XML reader.**
  - A corpus of real reports (from J1) and hand-made ones.
  - Entities, CDATA, comments, attributes with either quote.
  - Refused: a DOCTYPE, an unknown entity, too deep, too big, unclosed or mismatched tags, a
    stray `<`.
  - It never runs anything and never reads another file.
- **T2: JUnit cases.**
  - Each adapter's real report maps to the right IDs, outcomes and kinds.
  - Messages are cut to their first line and redacted (the token, secret shapes).
  - The caps hold.
- **T3: the adapter contract.**
  - Known fields only, known placeholders only, one argv element per placeholder.
  - A template that would start an argument with `-` from a value is refused.
  - A project adapter from `.mirai/custom/` loads; one from the work tree doesn't count.
- **T4: test IDs.**
  - The form, the name's characters, regex escaping for `{name:regex}`.
  - A name with spaces and quotes stays one argument.
  - Refused without an adapter.
  - 14d's path rules still hold for the path part.
- **T5: runs** (14c's fake `docker`):
  - the argv for a level, a file and a test;
  - the report read from the output folder;
  - the new fields;
  - a missing or broken report gives `env-fault`/`bad-report`;
  - a level without an adapter behaves exactly as before.
- **T6: `run_tests` inline:**
  - the counts and the failing list;
  - the 32 KiB budget still holds with 50 failures;
  - no store paths.
- **T7: stack neutrality:**
  - no framework names in `src/tests/` or `src/mcp/` (14c's T13);
  - the three adapters are only data.
- **T8: the probes** stay local and never pull an image.

**Probes:** J1–J4 on the sample app, with your OK.

## Open points for you

1. **Split unit 16 into 16a (this) and 16b (coverage and diffs).** Recommended.
   - The JUnit side is what units 17, 23 and 25 need first.
   - lcov, Cobertura and unified diffs are separate formats with separate parsers, and their
     users (diff coverage) come later.
   - 16b can follow right after, or wait until the unit that first reads coverage. I'd do it
     right after, to keep the roadmap's order.
2. **Drop the chunking requirement.** Recommended. It assumed agents run tests through Bash,
   with its 10-minute limit. They run them through the MCP tool, which proved 12-minute calls and
   allows 6 hours, and a level's `timeout_minutes` still stops a run. If a real level turns out
   too long for one call, chunking can come back with the baseline (unit 17).
3. **A level with an adapter and no usable report is `env-fault`,** even if the exit code is 0.
   Recommended: a run that should have produced results but didn't can't be trusted to have run
   the tests. The other choice is to trust the exit code and warn.
4. **Probe runs on the sample app** (Docker, its own images, nothing pulled; about 15 short runs
   across the three stacks; no Claude subscription). As in 14c, I'll check the images are there
   and that nothing is left behind, and ask you to start Docker Desktop if it's down.
5. **Up to 50 failing tests inline,** with the rest counted. A guess: enough to act on, and small
   enough for the reply's size budget.

## Changes after testing and review

**From the probes (J1–J4, `research/12-test-runner-facts.md`):**

1. **Paths reach the runner as the service's own path.** The sample app's services mount parts
   of the project elsewhere (`backend/` is `/var/www/html` in `app`). 14d passed the project path
   as is, so `--path backend/tests/Unit` passed MIRAI's check and PHPUnit answered "not found"
   (exit 2, reported as a failing test). Now a file or test ID's path is mapped through the
   frozen compose file's mounts of the level's service (`src/tests/paths.js`):
   - a path the service doesn't mount, or that another of its mounts hides (the vendor volume),
     is refused (`bad-path`);
   - a report's paths are mapped back the same way, relative ones from the service's working
     folder (the level's `workdir`, the compose `working_dir`, or the image's), or from the new
     level field **`report_root`** (Playwright's report names files relative to its `testDir`);
   - **this applies to levels without an adapter too** (`-- <service path>`): a fix to 14d, not
     "exactly as today" as the spec said.
2. **"Nothing ran" comes from the report, not the exit code.** Vitest exits 0 when `-t` matches
   nothing (every case skipped). So a file or test ID run where none of the asked cases ran (none
   there, or all skipped) is a failing run of kind `not-found`. And a run is a pass only with
   exit 0 *and* no failing case in the report.
3. **"Doesn't load" differs per runner, so it's adapter data** (`[classify]`):
   - PHPUnit: exit 255 and "An error occurred inside PHPUnit.", with an empty report; one such
     file stops a whole run;
   - Vitest: one case named after its file (`file_cases_are_load`);
   - Playwright: an `Error:` line at the start of the output that isn't "No tests found." (an
     empty report either way).
   A load failure is a failing run of kind `load`, never `bad-report`.
4. **More `[classify]` fields than the spec named:**
   - `assertion_types` (Vitest marks every failure `<failure>`, the type tells);
   - `assertion_messages` (Testing Library's matchers throw a plain `Error` with an `expect(…)`
     message);
   - `message_skip` (PHPUnit's first line repeats `Class::method`).
5. **Names and filters:** the report joins nested titles with ` > ` (Vitest) or ` › `
   (Playwright); the runners' filters join them with spaces. So `report.separator` and
   `select.join`. `{path:regex}` was added: Playwright takes a file as a regex on the absolute
   path, and the adapter anchors it so `a.spec.ts` doesn't also run `a.spec.tsx`. Vitest's file
   filter is a substring and can't be anchored: a twin that also runs is counted as `outside`,
   not in the counts.
6. **The rule "never start an argument from a value"** is: an argument can't start with
   `{name}`; `{path}` and `{report}` are always absolute paths.
7. **Attribute values keep their newlines** (XML would turn them into spaces): runners put
   multi-line messages there. Vitest drops the escape character of colour codes; the leftovers
   (`[2m`) are removed from messages.
8. **The reply's size:** the failing list takes at most 16 KiB of the 32 KiB, and the output's
   tail gets the rest.
9. **The stored result** also records `added_args` and `added_env`: what MIRAI added to the
   level's command.
10. **Files:**
    - the XML reader is its own file, `src/tests/xml.js`, apart from `junit.js`;
    - the mapping to IDs and kinds is `src/tests/results.js`;
    - the adapter schema is in `src/config/registry.js` (`TEST_ADAPTER`), as the other kinds
      are; there's no `registry/schemas/` file;
    - project adapters load through `loadCustomTestAdapters`. A project's name can't be one of
      the shipped ones;
    - the facts went into a new `research/12-test-runner-facts.md`, not research/11;
    - 14c's test helpers moved to `test/tests/run-fixture.js`, shared with the new run tests.
11. **More probe runs than estimated:**
    - 18 J runs, plus 1 kept from a first batch I stopped;
    - 8 runs through MIRAI's own adapters (the m- scenarios);
    - about 30 in all, against about 15 in open point 4.

    The reasons:
    - the first batch's broken test file stopped every PHPUnit run, so I made it per scenario
      and ran again;
    - a reused work folder hit a Docker Desktop file-sharing cache;
    - the m- runs check the argv MIRAI builds.

    All were local, with the sample app's own images and no subscription use.

**From the review (`review.md`):**

12. **What a run stores** changes from the spec's point 5:
    - every case in scope goes to the run's `cases.json`;
    - `result.json` keeps up to 1,000 failing tests with messages, plus the hashes of
      `cases.json` and the report, so a signed gate result covers them;
    - the "up to 50" is the reply's only, together with its 16 KiB share.
13. **The outcome rules, tightened:**
    - a pass needs at least one test run;
    - nothing run, for a level too, is `not-found`;
    - output or exit-code `load` counts only when no test ran;
    - a failed run with nothing failing in its report gets one `error` entry.
14. **PHPUnit's data sets:** a new `report.variant`, so a test ID by a data provider's method
    covers its data sets. PHPUnit's adapter drops `load_exit_codes = [255]`.
15. **Names up to 1,000 characters** (the spec said 200). A folder can't be a test ID.
16. **Playwright:**
    - a file or a folder (`(?:/|$)`), not probed;
    - its config must list the junit reporter, read from its source and not probed. Both are
      noted for 16b or 17.
17. **The level's `adapter` is checked when the level runs** (`unknown-adapter`, or `bad-adapter`
    for a project adapter that doesn't load), not when the config loads as the spec's Files
    said. A `mirai doctor` check is noted for later.
18. **The docs say what a report proves:** MIRAI's side is the trust root's, but the runner's
    config and the code under test are the branch's, so a report is evidence, not proof.
