---
unit: "03b"
name: config-model
date: 2026-10-23
node: v22.23.2
result: 51 / 51 pass (unit 01's 19 + 03a's 14 + 03b's 18), after the review fixes and D-58
---

# Unit 03b — Test results

## Run

`npm test` (scoped to `test/**/*.test.js`), after the review fixes (`review.md`):

```
ok 20 - T1: layers merge in order, tables per key, arrays replaced, sources recorded
ok 21 - T2: a missing integration_branch is one clear error, and config check exits 3
ok 22 - T3: out-of-grammar TOML in any layer stops with that file's position
ok 23 - T4: credential-looking resources are refused, and the value is never echoed
ok 24 - T5: repos: the one-entry "." default validates; duplicates and ".." are refused
ok 25 - T6: personal keys are refused in the project file, project keys in personal files
ok 26 - T7: never-auto gates refuse "auto"; presets fill every stage
ok 27 - T8: exact types, enums, times and unknown keys
ok 28 - T9: every schema problem in a file is collected, in file order
ok 29 - T10: readConfigFile: symlinks, size, encoding
ok 30 - T11: the registry loads valid definitions and refuses bad ones
ok 31 - T12: mirai config check / show
ok 32 - T13: the sample app's hand-written config validates
ok 33 - T14: schema_version is checked in each file, before merging
ok 34 - T15: a symlinked .mirai folder or registry folder is refused
ok 35 - T16: checkConfig works on parsed layers, without the file system (trust root, unit 12)
ok 36 - T17: checks, levels, code paths and errors keep one shape
# tests 50
# pass 50
# fail 0
```

Unit 01's and 03a's tests are all green. Unit 01's T14 (the pinned command list) now lists
`config` and `version`.

## Real output

```
$ mirai config check            # a project file with five problems
mirai: 5 problems in config
.mirai/config.toml:6:1: usage is a personal setting
  hint: move [usage] to ~/.config/mirai/config.toml
.mirai/config.toml:10:1: retention.days must be a whole number
  hint: write it without a decimal point
.mirai/config.toml:11:1: unknown key retention.dayz
  hint: did you mean "days"?
.mirai/config.toml:14:1: gates.merge can never be automatic
  hint: this decision always needs you (D-34)
.mirai/config.toml:17:25: resources.grafana.url looks like it contains a credential
  hint: keep links and names only; log in through the tool itself
(exit 3)

$ mirai config check            # a minimal valid project
config OK (project)
(exit 0)
```

The credential's value (`token=abc`) appears nowhere in the output.

## Bugs found while testing (fixed)

| Bug | Fix |
|---|---|
| Custom checks didn't run on number, boolean and enum fields, so `schema_version = 2` was accepted | `runCheck` now runs for every node type (T8 covers it) |
| Unit 01's import scan (its T12) read the words "comes from '" in help text as an import | The scan now matches only real `import`/`export … from` statements, bare imports, `import()` and `require()`. A check against six sample forms (multi-line import, bare import, dynamic import, require, re-export, plain text) showed all five real ones caught and the text ignored |

## Changes against the approved spec

| Change | Why |
|---|---|
| **`[models]` and `[run]` may also be set in the project file** (as team defaults), and your personal per-repo file may override them | Your decision on open point 1 covers what you may change; a team still needs defaults |
| **Gate stages listed in code:** never-auto are `track` (added to the spec's list), `brief`, `prd`, `design`, `tickets`, `instruction-files`, `merge`, `new-budget`, `unpark`, `context`, `clean`, `production`; may be auto are `plan`, `build`, `review`, `qa`, `docs-merge`, `final-e2e` | From `01` §16; the spec listed only the never-auto ones |
| **Judgement steps** (`prd`, `design`, `review-high-risk`) **must stay `deep`** in `[models.steps]` (the spec said "can't be `light`") | D-14 says judgement steps are never downgraded, so `standard` is refused too |
| **`schema_version` is required in the project file** | So a future schema change is always detected |
| **A document type declares its states** (`[states] names`) | So unknown and unreachable states can be detected |
| **Registry `.md` paths are also checked with `realpath`** | A symlinked folder on the way could lead outside the registry; the spec only said "no symlinks" |
| **Models: freedom with visibility (D-58, your decision):** any model per tier; `config check` shows the models and warns outside a tier's family (T18) | Your answer to the reviewers' finding P1 |
| **After review:** see `review.md` for the 15 applied fixes (symlinked `.mirai`, per-file `schema_version`, credential bypasses, `checkConfig` for the trust root, check tables, error codes, and more) | Both reviews |
| **`closest()` moved to `src/util/closest.js`** and **`deepFreeze()` to `src/util/freeze.js`** | Shared by the router, the schema checker, the loader and the registry |
