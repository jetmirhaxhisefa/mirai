---
unit: "01"
name: cli-skeleton
date: 2026-10-23
node: v22.23.2
result: 19 / 19 pass (after review fixes)
---

# Unit 01 — Test results

## Run

`npm test` → `node --test "test/**/*.test.js"`, on Node v22.23.2 (macOS), after the review fixes
(`review.md`):

```
ok 1 - T1: --help lists every registered command with its summary, sorted
ok 2 - T2: no arguments prints the same help, exit 0
ok 3 - T3: --version and version print the package.json version
ok 4 - T4: help for one command, both ways; help for an unknown one fails
ok 5 - T5: an unknown command exits 2 and suggests the closest one
ok 6 - T6: an unknown flag exits 2 and names the flag, before or after the command
ok 7 - T6b: extra arguments are usage errors
ok 8 - T7: a failing command exits with its code and one line, no stack
ok 9 - T7b: unexpected errors exit 1, whatever was thrown
ok 10 - T7c: a command that returns no exit code fails closed
ok 11 - T8: MIRAI_DEBUG=1 adds the stack frames, without repeating the message
ok 12 - T9: invalid command modules fail at load, naming the module
ok 13 - T9b: a broken options definition is a bug (exit 1), not a usage error
ok 14 - T9c: positionals ranges are enforced
ok 15 - T10: the Node version check, as a function and through the real entry point
ok 16 - T11: package.json has zero dependencies and a working bin
ok 17 - T12: source files import only node: modules and relative paths, as plain strings
ok 18 - T13: the test script runs only MIRAI tests under test/
ok 19 - T14: the real command list is pinned, so every new command is a reviewed test change
# tests 19
# pass 19
# fail 0
```

## Real output

```
$ node bin/mirai.js --help
Usage: mirai <command> [options]

Commands:
  help     Show all commands, or one command in detail
  version  Print the MIRAI version

Run "mirai help <command>" for details.
(exit 0)

$ node bin/mirai.js helpp
mirai: unknown command "helpp"
did you mean "help"?
(exit 2)

$ node bin/mirai.js version --nope
mirai: unknown option "--nope"
see: mirai version --help
(exit 2)

$ node bin/mirai.js version extra
mirai: unexpected argument "extra"
see: mirai version --help
(exit 2)

$ node bin/mirai.js --version
0.1.0
```

## Changes against the approved spec

| Change | Why |
|---|---|
| **The test script is scoped:** `node --test "test/**/*.test.js"` instead of bare `node --test` | The first run used bare `node --test`, which ran external code (see the incident below) |
| **T13 added:** the test script must stay scoped to `test/` | So the incident can't come back unnoticed |
| **T7b added:** an unexpected error exits 1 | Covers the default branch of the exit-code mapping |
| **`src/cli/node-version.js`:** the Node check lives in its own module with no imports, used by `bin/mirai.js` and T10 | Avoids two copies of the check |
| **Unknown-flag message shortened** from Node's long text to `unknown option "--nope"` | The spec asks for one line naming the flag |
| **Review fixes** (positionals, fail-closed return, error normalisation, tests T6b, T7c, T9b, T9c, T14 and stronger T10, T12) | See `review.md`; the spec is amended to match |

## Incident: external test code ran during the first test run

**What happened:**
- My first `npm test` used the spec's script, bare `node --test`. With no path, Node searches
  the whole repo for test files.
- That included the read-only external clones in `research/_sources/` (gitignored, but on disk).
  823 files matched, mostly in `affaan-m-ECC/tests` and `bmad-tea/test`.
- The run hung. About 2 minutes later (10:36:30–10:38:35) I stopped it.

**This broke hard rule 4** ("never run their scripts").

**What was checked afterwards:**
- **The MIRAI repo's git state is intact:** no new commits, branches, hooks or config changes.
- **The external clones show no tracked changes** (`git status` clean in each). One ignored
  Python cache appeared in `affaan-m-ECC/skills/continuous-learning-v2/scripts/__pycache__/`.
- **Files created outside the repo during the window**, all with test markers (for example
  `session-nonexistent-session-cost-test-xyz-999.json`, "Fallback test message", a logged fake
  `gh pr create --title "Fix bug"`):
  - `~/custom-learned-skills-dir/` (empty)
  - `~/.claude/skills/learned/` (empty)
  - `~/.claude/metrics/` (cost snapshots, `costs.jsonl`)
  - `~/.claude/session-data/` (a fake session summary and a compaction log)
  - `~/.claude/bash-commands.log`
  - `~/.claude/cost-tracker.log`
- **Not checked, and can't be from here:** whether any test made network calls, or read files
  without writing. The output was not captured, because the run was piped through `tail`.

**Cleanup:** moving these files to a quarantine folder was blocked by the permission check.
They're listed for you to remove; see the unit report.

**Fixed by:** the scoped test script and T13.
**Proposed structural fix (needs your decision):** move the external clones out of the MIRAI repo
folder, so no repo-wide tool can reach them.
