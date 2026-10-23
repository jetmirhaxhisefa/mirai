---
unit: "01"
date: 2026-10-23
reviewers: Tech Lead, Architect (independent, read-only)
verdicts: PASS WITH FIXES, PASS WITH FIXES
---

# Unit 01 — Review

Both reviewers found nothing blocking, and nothing that forces a rewrite later. All
should-fixes and nits that belong in unit 01 are applied. Four design points are deferred to
the units that need them.

## Applied in unit 01

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | A command returning no exit code counted as success (`main.js`) | Architect | Fail closed: a non-integer return exits 1 with "returned no exit code" | T7c |
| 2 | Extra arguments were accepted silently (`mirai version extra`, `--version junk`) | both | `positionals: {min, max}` in the contract, default none; trailing args after `--help`/`--version` rejected | T6b, T9c |
| 3 | Every `parseArgs` error became a usage error, including bugs in a command's `options` | Tech Lead | Only `ERR_PARSE_ARGS_*` becomes exit 2; other errors exit 1 | T9b |
| 4 | `throw null` crashed the error path; `throw 'x'` printed `undefined` | both | `toError()` normalises anything thrown | T7b |
| 5 | `mirai --nope` said "unknown command" | Tech Lead | "unknown option", with `see: mirai --help` | T6 |
| 6 | A command could redefine `-h`/`--help` | Tech Lead | Rejected at load | T9 |
| 7 | T12 missed `.mjs`/`.cjs`, computed `import()`/`require()` and `createRequire` | both | Walks all three extensions; any dynamic import must be a plain string | T12 |
| 8 | Nothing pinned the real command list | Architect | A test pins the names, so a new command is always a reviewed test change | T14 |
| 9 | The bin's "exit 1 on old Node" path was untested | Tech Lead | A preload fakes Node 20 | T10 |
| 10 | Debug output repeated the message; multi-line messages broke "one line" | both | First line only; debug adds only the stack frames | T7b, T8 |
| 11 | `io.env` was the live `process.env` | Architect | A frozen copy | — |
| 12 | Nits: no spawn timeout; sorting unchecked; no async-reject or `help <unknown>` test; `return 0` instead of `EXIT.OK`; help didn't show `<value>` for string options; the command list's location differed from the spec | Tech Lead | All fixed; the list moved to `src/cli/commands/index.js` | T1, T4, T7b |
| 13 | The spec still showed a bare `node --test` | Tech Lead | Spec amended | T13 |

## Deferred, with the unit that needs it

| # | Point | From | When | Proposal |
|---|---|---|---|---|
| D1 | **Structured results:** `run` writes text and returns only a code. The broker (D-53) and a future `--json` need data | Architect | **Before the first command that outputs data** (unit 04 `mirai status`) | `run` may return `{ code, data }`, with a text renderer per command; `main` picks text or JSON. Decided in unit 04's spec |
| D2 | **Nested subcommands** (`key add`, `gate record`) | Architect | Unit 06 (`key`) or 25 (`gate`), whichever comes first | An optional `subcommands` field; help and "did you mean" see them |
| D3 | **Global flags anywhere** (`mirai --json gate check`) | Architect | With D1 | A small global-options table parsed before the command |
| D4 | **`io.stdin` and an abort signal** (hooks and the broker pass JSON on stdin; Ctrl-C → exit 130) | Architect | Units 15 (broker), 26 (hooks), 28 (run) | Add `io.stdin` and an `AbortSignal` wired in `bin/mirai.js` |
| — | Reading `package.json` at import time could crash outside the error path | Tech Lead | Accepted | Low risk; the file ships with MIRAI |

## The incident (from `test-results.md`)

The Architect pointed out that my first check listed only **new** files. A second check covered
**changes to existing** files in the 10:36–10:40 window. **None were found:**
- `~/.claude/settings*.json`, `CLAUDE.md`, `hooks/` and `commands/` are untouched;
- so are `~/.gitconfig`, `~/.config/git`, the shell rc files, `~/.ssh` and `~/Library/LaunchAgents`;
- there's no crontab;
- `~/.claude.json` changed at 10:42, after the window; that's Claude Code's own state file.

**Still unknown:** whether the external tests made network calls. The Architect advises treating
secrets in that shell's environment as possibly exposed. The shell held no MIRAI tokens (none
exist yet); your own environment is for you to judge.

**Both reviewers support moving `research/_sources/` out of the repo folder.** The Architect
calls it blocking before unit 02, and suggests making the clones read-only (`chmod -R a-w`).
That needs your decision.
