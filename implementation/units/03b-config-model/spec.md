---
unit: "03b"
name: config-model
status: draft
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 03b (+ "Config keys (unit 03b)"); D-14, D-23, D-34, D-37, D-40, D-42, D-47, D-57
depends_on: ["01", "03a"]
---

# Unit 03b — Config model and registry core

## Why

Every later unit reads config: the git units read the integration branch, the launcher reads the
model tiers, the gate reads the named checks, the run loop reads the presets and budgets. The
registry core lets units 04, 07, 11 and 19 load agents and document types as checked data
(D-37) instead of hard-coding them.

Config is attack surface. A project file is shared by every developer and can be changed by any
branch, including an agent's branch. So the model must:
- **keep personal settings out of the repo** (your rule, D-57);
- **stop a project file from loosening what must never be automatic** (D-34);
- **reject anything unknown,** never guess.

**Roadmap "done when":**
- merging is tested;
- a missing required key stops with a clear message;
- out-of-grammar TOML is rejected;
- a credential-looking value in `resources` is rejected;
- a one-entry `repos` (`.`) validates;
- `integration_branch` is required and read by every git-touching unit;
- an agent manifest and a document-type definition validate.

## Scope

**In:**
- A small zero-dependency schema checker that **collects every problem** with its position.
- The config schema (the `07` key list) and the framework defaults.
- The two presets (`supervised`, `autonomous`) and the gates rules.
- Layered loading and merging, with the source of every value.
- A safe file loader.
- The registry core: schemas and a loader for `agent` and `document-type` definitions.
- `mirai config check` and `mirai config show`.

**Out:**
- **Finding the MIRAI home and `<repo-id>`** (unit 05). Until then the per-repo personal file is
  loaded only when its path is passed in. The CLI reads the project and global files.
- **The registry's real content** (unit 37). 03b ships schemas and test fixtures only.
- **Overlays** (unit 37) and **migrations between schema versions** (unit 70).
- **Detection** (unit 17). The sample app's config is written by hand in Milestone A.

## The layers

Later layers win. Tables merge key by key, and arrays are replaced whole.

| # | Layer | File | Who writes it | May contain |
|---|---|---|---|---|
| 1 | Framework defaults | in code (`src/config/defaults.js`) | MIRAI | everything with a default |
| 2 | Project | `<repo>/.mirai/config.toml` (**required**, committed) | the team | everything **except** personal keys |
| 3 | Personal, this repo | `<mirai-home>/<repo-id>/store/config.user.toml` (optional) | you | **personal-per-repo keys only** (see open point 1) |
| 4 | Personal, global | `~/.config/mirai/config.toml` (optional) | you | `[subscription]` and `[usage]` only (D-57) |

**Rules:**
- **A personal key in the project file** (`[subscription]`, `[usage]`, …) is an error: "personal
  setting — move it to ~/.config/mirai/config.toml".
- **A project key in a personal file** is an error too, so a personal file can never loosen team
  policy, for example the gates.
- Each value remembers its source (`file:line:column`, or `default`). `config show --sources`
  prints it.

## The schema

The `07` key list. Unknown keys are refused, with the closest known key suggested.

| Table / key | Type | Default | Rules |
|---|---|---|---|
| `schema_version` | integer | — | **required**; must be `1` |
| `preset` | `supervised` \| `autonomous` | `supervised` | |
| `[git] integration_branch` | string | — | **required**; a plausible git branch name (no spaces, `..`, leading `-`, `~^:?*[\`) |
| `[git] branch_pattern` | string | `feature/{ticket}-{slug}` | must contain `{ticket}` |
| `[git] trailer` | string | `Mirai-Ticket` | a bare token |
| `[models] light / standard / deep` | string (model ID) | open point 2 | |
| `[models.steps] <step>` | `light` \| `standard` \| `deep` | — | judgement steps (`prd`, `design`, `review-high-risk`) can't be set to `light` (D-14) |
| `[testing] tdd` | `auto` \| `on` \| `off` | `auto` | |
| `[testing] tests` | `required` \| `optional` | `required` | |
| `[[testing.levels]]` | `name`, `adapter`, `command` (array), `purpose`, `required_for` (array), `budget_minutes` (integer > 0) | none | `name` and `command` required; names unique |
| `[testing] e2e_budget_minutes` | integer > 0 | `15` | |
| `[checks] <name>` | array of strings (the command) | none | names are bare words; arrays non-empty; no shell strings, an argv array only |
| `[compose] files` / `env_file` | array of paths / path | none | relative paths inside the repo, no `..` |
| `[[repos]]` | `name`, `path`, `remote`, `start`, `health` | one entry: `name = "."`, `path = "."` | names unique; paths relative, no `..` |
| `[workspace] e2e` | `local` \| `deployed` \| `none` | `none` | |
| `[resources] <name>` | `{ name, url }` | none | `url` is `http(s)://`; **no credentials** (below) |
| `[gate] code_paths` | array of globs | `["**", "!docs/mirai/**", "!.mirai/**"]` | |
| `[gate.risk] high` | array of globs | `[]` | |
| `[gates] <stage>` | `human` \| `auto` | from the preset | **never-auto stages refuse `auto`** (below) |
| `[retention] days` / `auto` | integer ≥ 1 / boolean | `90` / `false` | |
| `[run] stop_by` | `"HH:MM"` string | none | a valid 24-hour time |
| `[subscription] plan` | string | none | personal only |
| `[usage] night_max / week_max / reserve` | integer 0–100 (percent) | `15` / `60` / `40` | personal only; `night_max ≤ week_max` |

**Types are exact:** `days = 90.0` is refused for an integer key, using the `type` from 03a's
positions.

**Gates (D-34, `01` §16):** each preset sets every stage. A project may change a stage, but the
stages that can never be automatic refuse `auto`: `brief`, `prd`, `design`, `tickets`,
`instruction-files`, `merge`, `new-budget`, `unpark`, `context`, `clean`, `production`. High-risk
plan gates stay `human` in code whatever the config says. That rule lives in unit 21; 03b only
exposes the setting.

**No credentials in `resources`.** A value is refused when it:
- has a user or password in the URL (`https://user:pass@…`);
- has a query parameter named like a secret (`token`, `key`, `secret`, `password`, `sig`,
  `access_token`, `api_key`);
- matches a known token shape (`ghp_`, `github_pat_`, `glpat-`, `sk-`, `sk-ant-`, `xox?-`,
  `AKIA…`, `AIza…`).

The message names the key and **never echoes the value** (review note L4).

## Loading files safely (review note L1)

`readConfigFile(path, { trust })` is the only way to load a config or definition file:
- **`lstat` first.** It must be a regular file. A **symlink is refused for project and
  definition files**; your personal files may be symlinks (dotfile setups).
- **Size is checked before reading** (256 KB, as in 03a).
- **Bytes go to the parser,** never `'utf8'` text, so invalid UTF-8 can't hide as U+FFFD.
- A missing optional file is skipped. A missing project file is an error with a hint
  (`run mirai init`).

## Errors (review notes L2–L4)

- **Syntax errors** stop at the first, as in 03a.
- **Schema errors are collected:** one `ConfigError` holds `errors[]`, each with its source,
  line, column, key path, reason and hint. Exit code 3.
- **Messages name keys, never values.**
- **Example of `mirai config check` output:**
  ```
  mirai: 2 problems in config
  .mirai/config.toml:4:1: git.integration_branch is required
    hint: add integration_branch = "main" under [git]
  .mirai/config.toml:12:1: usage is a personal setting
    hint: move [usage] to ~/.config/mirai/config.toml
  ```

## The registry core (D-37)

**What a definition file is:** a TOML file with `kind` and `schema_version`. Long text (prompts,
templates, checklists) lives in `.md` files referenced by a relative path (review note L6).

| Kind | Fields |
|---|---|
| `agent` | `name` (`mirai-…`), `role`, `default_tier` (`light`/`standard`/`deep`), `read_only` (boolean), `[may_write] paths` (globs), `[tools] allowed` (names), `prompt` (path to `.md`) |
| `document-type` | `name`, `template` and `checklist` (paths to `.md`), `required_sections` (array), `[states] initial`, `[[states.transitions]]` `{ from, to, human_only }` |

**`loadRegistry(dir)`:**
- loads `dir/agents/*.toml` and `dir/document-types/*.toml`;
- refuses duplicate names;
- checks every referenced `.md` file exists **inside `dir`**: no `..`, no absolute paths, no
  symlinks;
- validates each state machine: `initial` is a known state, every transition uses known states,
  every state is reachable from `initial`.

It returns frozen objects.

## CLI

- **`mirai config check`:** loads the project and global config from the current repo and
  prints every problem, or `config OK (project + global)`. Exit 0 or 3.
- **`mirai config show [--sources]`:** prints the effective config as JSON. With `--sources`,
  each value shows where it came from. It is for you in your terminal; nothing is logged.

`config` takes one positional action (`check` or `show`), which fits unit 01's contract without
adding subcommand routing yet. Subcommands come later (deferred point D2 from unit 01).

## Files

```
src/config/schema.js        # the small schema checker (types, enums, tables, arrays, custom rules; collects errors)
src/config/config-schema.js # the config schema + gates rules + credential checks
src/config/defaults.js      # framework defaults and the two presets
src/config/load.js          # readConfigFile, loadConfig (layers, merge, sources)
src/config/registry.js      # definition schemas + loadRegistry
src/cli/commands/config.js  # mirai config check|show
test/config/*.test.js       # + fixtures under test/config/fixtures/
```

## Tests

| # | Test |
|---|---|
| T1 | Merge: defaults ← project ← personal-per-repo ← global; tables merge per key; arrays replace; sources recorded |
| T2 | A missing `git.integration_branch` → one clear error with position and hint; `config check` exits 3 |
| T3 | Out-of-grammar TOML in any layer → the 03a error, with that file's path |
| T4 | Credential-looking `resources` values (each pattern) are refused, and the value never appears in the message |
| T5 | One-entry `repos` (`.`) validates; duplicate repo names and `..` paths are refused |
| T6 | Personal keys in the project file are refused; project keys in a personal file are refused |
| T7 | Never-auto gates refuse `auto` in any layer; presets fill every stage |
| T8 | Exact types: `90.0` for an integer, `"90"` for an integer, a bad enum, a bad `HH:MM`, unknown keys (with a suggestion) |
| T9 | All schema problems are collected in one error (at least 5 in one file), in file order |
| T10 | `readConfigFile`: symlinked project file refused; personal symlink allowed; oversize refused before reading; invalid UTF-8 refused |
| T11 | A valid agent manifest and a valid document-type definition load; duplicates, missing or escaping `.md` paths, symlinked `.md`, and broken state machines (unknown state, unreachable state) are refused |
| T12 | `mirai config check` / `show` on fixture repos (spawned CLI): exit codes, output, `--sources`; T14 of unit 01 updated to pin the new `config` command |
| T13 | The sample app's hand-written `.mirai/config.toml` (a fixture copy) validates |

## Open points for you

1. **What may your personal per-repo file (layer 3) change?** My proposal: only personal working
   preferences:
   - `[models]`: which model each tier uses for *you*, for example while trying a new model;
   - `[run] stop_by`: when *your* overnight runs must end.

   Nothing that loosens team policy: gates, checks, testing rules and code paths stay
   project-only. Anything else you want here?
2. **Default model IDs for the tiers** (provisional until calibration, unit 57):
   `light = "claude-haiku-5-5"`, `standard = "claude-sonnet-5-5"`, `deep = "claude-opus-5-5"`.
   OK?

## Done when

- `npm test` passes: all earlier tests plus T1–T13.
- `test-results.md` holds the output.
- The Tech Lead and Architect reviews are done and recorded in `review.md`.
- You write "UNIT APPROVED". Then one commit, a push, and `PROGRESS.md` updated.
