# Test adapters

A test adapter tells MIRAI how one test runner:
- writes a **JUnit XML report**;
- runs **one file** or **one test**;
- names its tests, so a report's cases map back to test IDs.

It's data, not code. MIRAI's runner is the same for every stack, and nothing about any one test
runner is built in. Without an adapter, a level still runs: you get pass or fail, the exit code
and the output, but no test counts, no failing list, and no test IDs.

## Using one

Name it on the level in `.mirai/config.toml`:

```toml
[[testing.levels]]
name = "unit"
command = ["php", "artisan", "test"]
service = "app"
adapter = "phpunit"
```

**Shipped** in `registry/test-adapters/`:

| Adapter | For | Note |
|---|---|---|
| `phpunit` | PHPUnit (seen on 12.5), directly or through a command that passes its options on (`php artisan test`) | a test ID by a data provider's method covers all its data sets |
| `vitest` | Vitest (seen on 3.2) | through a package script, end the command with `--`: `["npm", "test", "--"]` |
| `playwright` | Playwright Test (seen on 1.64) | set `report_root` to the config's `testDir`, as a project path (`"e2e/tests"`). In MIRAI's runs the reporters are `list` and `junit`, whatever the config lists |

"Seen on" is what the probes ran. Other versions are likely to work, but haven't been checked.

Then:
- `mirai test unit --test backend/tests/Unit/TaskRulesTest.php::test_a_title_is_required`;
- or `run_tests(level: "unit", test: "…")` from an agent.

The file in a test ID is its path in the project. MIRAI passes it to the runner as the service's
own path for it, from the compose file's mounts.

## Writing one

Put it in `.mirai/custom/test-adapters/<name>.toml` and commit it on the integration branch.
MIRAI reads it from the trust root, like the rest of `.mirai/`, so a branch can't change it for
its own run. Its name can't be one of the shipped ones.

```toml
kind = "test-adapter"
schema_version = 1
name = "mytool"
description = "mytool 2 or later"

[report]
format = "junit"                       # the only format so far
args = ["--junit-out", "{report}"]     # or: env = { MYTOOL_JUNIT = "{report}" }
file = "file"                          # the <testcase> attribute holding its file: file or classname
separator = " > "                      # optional: how the report joins describe blocks and the title
variant = " #"                         # optional: what follows a test's name in its variants' names

[select]
file = ["{path}"]                      # the arguments for one file or folder
test = ["{path}", "--grep", '^{name:regex}$']   # the arguments for one test
join = " "                             # optional: how the runner's name filter joins the parts

[coverage]                             # optional: line coverage, on a run that asks for it
format = "lcov"                        # or "cobertura"
args = ["--cov-out", "{coverage}"]     # or env; {coverage_dir} for runners that name the file
file = "lcov.info"                     # the file's name in the coverage folder

[detect]                               # optional: how mirai detect finds it (unit 17a)
markers = ["mytool.config.json"]       # its config files, at any depth
level = "unit"                         # the level name to suggest
package = { file = "package.json", fields = ["devDependencies"], name = "mytool" }  # optional
report_root = ["tests"]                # optional: candidates beside the marker, first one found

[[detect.commands]]                    # the first whose conditions hold
if_file = "bin/mytool"                 # optional: a file beside the marker
command = ["bin/mytool", "run"]

[[detect.commands]]
if_script = { file = "package.json", field = "scripts", name = "test", contains = "mytool" }
command = ["npm", "test", "--"]

[detect.suites]                        # optional: where its XML config names suites (facts only)
element = "suite"
attribute = "name"

[classify]                             # all optional
assertion_types = ['^AssertionError$'] # a failure of this type is an assertion; others are errors
assertion_messages = ['^expect\(']     # or one whose message starts like this
load_exit_codes = [3]                  # when no test ran: this exit code means the tests didn't load
load_output = ['^Fatal: cannot load']  # or a line of output like this (also only when no test ran)
message_skip = ['^\S+::\S+$']          # a first line that only repeats the test's name
file_cases_are_load = true             # a case named after its file is the file failing to load
```

**The placeholders:**

| Placeholder | Is | In |
|---|---|---|
| `{report}` | the report's path in the service (in MIRAI's output folder) | `report.args`, `report.env` |
| `{path}` | the file or folder, as the service's absolute path | `select.file`, `select.test` |
| `{path:regex}` | the same, with regex characters escaped | `select.file`, `select.test` |
| `{name}` | the test's name, its parts joined with `select.join` | `select.test` |
| `{name:regex}` | the same, with regex characters escaped | `select.test` |
| `{coverage}` | the coverage file's path in the service (`coverage/<file>` in MIRAI's output folder) | `coverage.args`, `coverage.env` |
| `{coverage_dir}` | that folder | `coverage.args`, `coverage.env` |

**The rules, checked when MIRAI loads the adapter:**
- each list item is **one argument**, never a shell line: a name with spaces or quotes stays one
  argument;
- an argument can't start with `{name}`, so a test's name can never become an option. Put text
  before it (`'^{name:regex}$'`), or join it to its option (`"--only={name}"`);
- known fields and placeholders only; regexes must compile and can't use back-references.

**How a run is read:**
- **pass:** exit code 0, at least one test ran, and no failing case;
- **fail:** anything else:
  - the tests didn't load (`load`): no test ran, and the exit code or output says so;
  - nothing ran (`not-found`): the file, test or level ran no test, or only skipped ones. Some
    runners exit 0 when their name filter matches nothing;
  - a non-zero exit with nothing failing in the report is listed as one `error`;
- **an environment fault (`bad-report`):** the report is missing or can't be read, whatever the
  exit code.

Every case goes to the run's `cases.json`, and the failing ones, with messages, to `result.json`
(up to 1,000). The result holds both files' hashes and the report's, so a signed gate result
covers them.

**Coverage** (unit 16b): `mirai test <level> --coverage`, or `run_tests(…, coverage: true)`,
on a level whose adapter has `[coverage]`; otherwise it's refused (`no-coverage`). The runner's
lcov or Cobertura file is mapped to project paths, and stored as the run's `coverage.json`. The
result holds its hash and the raw file's, and a summary (files, lines, lines that ran). A run
asked for coverage that leaves none, or a file MIRAI can't read, is an environment fault
(`bad-coverage`), unless its tests didn't load. Add `--against <ref>` to see **diff coverage**:
of the lines your work tree added since the merge base with `<ref>`, the ones that can run, and
which of them ran. Files the coverage doesn't list (a new file no test loaded, a template), and
files git shows as binary, are shown apart, never counted as covered. `--against` needs the
whole level: a one-file run lists every other file as not run.

Shipped: `phpunit` (Cobertura; needs pcov or Xdebug in the image, and a `<source>` in
`phpunit.xml`) and `vitest` (lcov; needs `@vitest/coverage-v8` or `-istanbul`). Playwright's
browser tests don't measure the app's code, so `playwright` has none.

**What a report proves.** MIRAI's adapter, the reader and the compose files come from the trust
root. But the runner's own config (`phpunit.xml`, `vitest.config.*`, `playwright.config.*`), the
package scripts and the code under test are the branch's: they decide which tests run, and could
write the report themselves. So a report is evidence of what ran, not proof. Unit 25 compares a
branch's counts and IDs with the integration branch's baseline (unit 17b).

**Coverage is the same kind of evidence.** The runner's config decides which files are listed and
which lines count: include and exclude lists, ignore comments (`@codeCoverageIgnore`,
`/* v8 ignore */`), a custom coverage provider. The code under test could write the coverage file
itself too. So a branch can make a new file "not listed", or a line "can't run", without a test.
Diff coverage guards against forgotten tests, not a branch that games it. Units 17b, 26 and 54
compare what's measured with the integration branch's baseline. Coverage also counts execution,
not assertions: a test that checks nothing still covers lines.

**Check it on your project:**
1. Run one level: `mirai test <level>`. The counts should match the runner's own summary.
2. Run one test: `mirai test <level> --test <id from the failing list>`.
3. Run a name that doesn't exist: it should come back `not-found`.

The probes that settled the shipped adapters are in `research/12-test-runner-facts.md` (J1–J4,
K1–K4, D1). How `mirai detect` uses `[detect]` is in `docs/setup-detection.md`.
