---
unit: "01"
name: cli-skeleton
status: approved (2026-10-23), amended after review
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 01
depends_on: []
---

# Unit 01 — `mirai` CLI skeleton

## Why

Every later unit is a `mirai` subcommand or a library the CLI calls (`03` §1). This unit builds
the empty frame:
- an entry point;
- a command router;
- help and version;
- fixed exit codes;
- a test harness.

Later units add commands into this frame instead of each inventing its own.

**Roadmap "done when":** `mirai --help` lists commands; the test runner works; zero npm
dependencies.

## Scope

**In:**
- The `package.json` that makes the repo runnable as `mirai` (`bin`), with zero dependencies.
- The entry point, router, argument parsing, help, version, exit codes and error output.
- Two commands: `help` and `version`.
- Tests with Node's built-in test runner.

**Out (each comes with its own unit):**
- config (03), store (05), any other command;
- the installer `init` (unit 10);
- coloured output and a `--json` output mode;
- CI for the MIRAI repo itself. That could be a small optional addition; it isn't planned in
  `07`, so I'd only add it if you ask.

**Not touched:** the pilot, the sample app (it doesn't exist yet), any project outside
`~/Projects/mirai`.

## Design

### Files (in the MIRAI repo)

```
package.json             # name "mirai", "private": true, "bin": {"mirai": "bin/mirai.js"},
                         # "engines": {"node": ">=22"},
                         # "scripts": {"test": "node --test \"test/**/*.test.js\""} (scoped: never bare `node --test`),
                         # no dependencies, no devDependencies
bin/mirai.js             # shebang; checks the Node version, then calls src/cli/main.js
src/cli/node-version.js  # the Node check, no imports (loaded first)
src/cli/main.js          # main(argv, io) -> exit code; no process globals inside
src/cli/router.js        # static command list, lookup, "did you mean"
src/cli/exit-codes.js    # the exit-code table below
src/cli/errors.js        # UsageError, MiraiError (with an exit code); formatting
src/cli/commands/index.js  # the static command list
src/cli/commands/help.js
src/cli/commands/version.js
test/cli/*.test.js       # node:test
```

`src/` and `test/` are new top-level folders. Framework content (skills, agents, templates)
comes later, in its own folders.

### The command contract

Each command is a module exporting `{ name, summary, usage, options, run(args, io) }`:
- `options` uses the shape Node's built-in `util.parseArgs` takes. Parsing is **strict**, so an
  unknown flag is a usage error.
- `positionals: { min, max }` (default none) sets how many plain arguments the command takes;
  more or fewer is a usage error. `-h`/`--help` are built in and can't be redefined.
- `run` gets the parsed arguments and an `io` object (`stdout`, `stderr`, `env` as a frozen copy,
  `cwd`) and **must return an integer exit code**. Anything else fails closed with exit 1, so a
  forgotten `return` in a gate never looks like success. Commands never touch `process`
  directly, so tests run them in memory.
- **The command list is static** (`src/cli/commands/index.js` imports each command by name, and a
  test pins the list). A file dropped into
  `commands/` does nothing. This is a safety choice: what the CLI can do is fixed by reviewed
  code.
- A command missing `name`, `summary` or `run` fails at load, with a clear message.

### Behaviour

| Input | Output | Exit |
|---|---|---|
| `mirai`, `mirai --help`, `mirai -h`, `mirai help` | Usage line, then every registered command with its summary, sorted | 0 |
| `mirai help <cmd>`, `mirai <cmd> --help` | That command's usage and options | 0 |
| `mirai --version`, `mirai version` | The version from `package.json` | 0 |
| `mirai <unknown>` | stderr: `mirai: unknown command "<x>"`, plus `did you mean "<y>"?` when one name is close | 2 |
| unknown flag or bad argument | stderr: one line naming it, plus `see: mirai <cmd> --help` | 2 |
| a command throws | stderr: `mirai: <message>`, one line, no stack trace | the error's code, else 1 |
| the same with `MIRAI_DEBUG=1` | as above, plus the stack trace | same |
| Node older than 22 | stderr: `mirai needs Node 22 or newer (found vX)` | 1 |

Help lists **only commands that exist**, not the planned ones.

### Exit codes (`src/cli/exit-codes.js`)

| Code | Name | Meaning | Used from |
|---|---|---|---|
| 0 | `OK` | success | 01 |
| 1 | `FAILURE` | unexpected error | 01 |
| 2 | `USAGE` | wrong command, flag or argument | 01 |
| 3 | `CONFIG` | config missing or invalid | 03 |
| 4 | `BLOCKED` | refused by a gate or safety rule | 06, 25, 26 |
| 5 | `NEEDS_HUMAN` | needs a real terminal or your decision | 06 |
| 130 | `INTERRUPTED` | stopped by Ctrl-C | 28 |

Codes 3–5 and 130 are reserved now so their meaning stays stable; unit 01 doesn't use them yet.

## Tests (node:test, run with `npm test`)

| # | Test | Expected |
|---|---|---|
| T1 | `mirai --help` (spawned process) | exit 0; lists `help` and `version` with summaries |
| T2 | `mirai` with no arguments | same output as T1, exit 0 |
| T3 | `mirai --version` and `mirai version` | the `package.json` version, exit 0 |
| T4 | `mirai help version` and `mirai version --help` | the version command's usage, exit 0 |
| T5 | `mirai helpp` | exit 2; stderr names `helpp` and suggests `help` |
| T6 | `mirai version --nope` | exit 2; stderr names `--nope` |
| T7 | a test-only command that throws an error with code 4 | exit 4; one-line message; no stack trace |
| T8 | the same with `MIRAI_DEBUG=1` | stack trace present |
| T9 | a command module without `run` | load fails with a message naming the module |
| T10 | the Node version check, with an injected version `20.0.0` | the message from the table, exit 1 |
| T11 | `package.json` | no `dependencies`, `devDependencies`, `optionalDependencies` or `peerDependencies`; `bin.mirai` points to an existing file |
| T12 | no source file imports anything except `node:` modules and relative paths | true (a static scan of `src/` and `bin/`) |

T7–T9 use a small test-only command list passed to the router, so no test command ships in the
real list.

## Done when

- `npm test` passes: T1–T12 are green on Node 22.
- `node bin/mirai.js --help` works from the repo root. `npm link` is not needed and not done.
- `implementation/units/01-cli-skeleton/test-results.md` holds the test output and Node version.
- **Reviewers:** two independent reviewers (Tech Lead, Architect) review the code and tests; their
  findings are consolidated into `implementation/units/01-cli-skeleton/review.md`. The PM review
  is skipped for internal units with no user-facing behavior beyond help text, unless you want
  it.
- You write **"UNIT APPROVED"**. Then:
  - one commit for this unit;
  - `implementation/PROGRESS.md` is created with unit 01's line;
  - a push to `origin/main`.

## Open points for you

1. **Commits go straight to `main`** in the MIRAI repo, one per approved unit (it's your solo
   repo, and your approval is the gate). Or do you want a branch and PR per unit?
2. **`"private": true` in `package.json`** stops an accidental `npm publish`. Install stays
   `npx github:<owner>/mirai#<tag>`. OK?
