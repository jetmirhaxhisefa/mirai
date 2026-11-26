# Config keys

Every key MIRAI reads from a config file, one row each. The docs check
(`test/docs/coverage.test.js`) fails when a key has no row here, or a row names a key MIRAI
doesn't know.

## The three files

MIRAI reads three files, then its own defaults. A later file wins over an earlier one, key by key.
A whole list (an array) is replaced, never merged.

| File | Where | Shared? | What it may set |
|---|---|---|---|
| **Project** | `.mirai/config.toml` in the repo | yes, committed | team policy: every table except your personal ones below |
| **Personal repo** | `config.user.toml` in this repo's store (`~/Library/Application Support/mirai/<repo-id>/store/`) | no, yours | `models.light`, `models.standard`, `models.deep`, `models.steps.*` (your own launches; see [model-tiers.md](model-tiers.md)), `run.stop_by`, `run.on_limit`, `run.max_wait_minutes` |
| **Personal global** | `~/.config/mirai/config.toml` | no, yours, all your projects | `[subscription]`, `[usage]`, `[signing]`, `[claude_code]`, `git.allow_repo_config`, `git.author_name`, `git.author_email`, `tests.max_parallel` |

- **Order:** MIRAI's defaults, then the project file, then the personal repo file, then the personal global file.
- **A key in the wrong file is an error,** not ignored. `mirai config check` names the file, the line and where the key belongs.
- **Personal settings never live in the repo** (D-57). The project file can't set your usage caps, your key's unlock time or your git identity.
- **Every file may set `schema_version`.** The project file must; it is `1` today.
- **See what's in effect:** `mirai config show` prints the merged config. `mirai config show --sources` adds where each value came from.

## How to read the tables

- **Key:** the path in TOML. `[run] stop_by = "06:30"` is `run.stop_by`.
- **`<name>`:** a name you choose, such as `[checks.lint]` or `[resources.jira]`.
- **`[]`:** a list of tables, such as `[[testing.levels]]`; each entry has these keys.
- **Who may set it:** the files from the table above. "none" means no file may set it yet.
- **Default:** what MIRAI uses when no file sets it. "none" means the key is off or unset until you set it.

## Top level

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `preset` | project | `"supervised"` | `"supervised"` or `"autonomous"`: sets each gate's default; under `"autonomous"` a plan with nothing risky is approved without you. |
| `schema_version` | project, personal repo, personal global | none (required in the project file) | The config file format's version; it must be `1`, and the project file must set it. |

## [git]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `git.integration_branch` | project | none (required) | The branch tickets start from and merge into; MIRAI trusts only the config, keys and registry committed on it. |
| `git.host` | project | none | `"github"` or `"gitlab"`, where `mirai ship` opens MRs; unset, MIRAI tells it from a github.com or gitlab.com remote. |
| `git.host_url` | project | `"https://github.com"` or `"https://gitlab.com"`, by `git.host` | A self-hosted server's https address, such as `"https://gitlab.example.com"`; the remote must be on that host. |
| `git.branch_pattern` | project | `"feature/{ticket}-{slug}"` | How MIRAI names a ticket's branch: `{ticket}` is the ticket key, `{slug}` comes from its title; it must contain `{ticket}`. |
| `git.trailer` | project | `"Mirai-Ticket"` | The trailer that names the ticket in every MIRAI commit, such as `Mirai-Ticket: PMT-31`; the pre-push hook checks it. |
| `git.commit_format` | project | none | Commit subjects as `"plain"` (`PMT-31: …`) or `"conventional"` (`feat(PMT-31): …`); unset, MIRAI follows the history `mirai detect` saw. |
| `git.author_name` | personal global | none | Your name, credited as the author of MIRAI's commits; a commit is refused while it is unset. |
| `git.author_email` | personal global | none | Your email, credited as the author of MIRAI's commits; a commit is refused while it is unset. |
| `git.committer_email` | project | `"mirai@localhost"` | The email on MIRAI's committer line, for a host that needs a real address; the committer name stays MIRAI. |
| `git.allow_repo_config` | personal global | `[]` | Repo git config keys you trust on this machine beyond MIRAI's known ones (a key or `section.*`); keys that run code are refused. |

## [models]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `models.light` | project, personal repo | `"claude-haiku-5-5"` | The model the `light` tier runs: rewording with all facts given, such as commit messages, MR descriptions and summaries. |
| `models.standard` | project, personal repo | `"claude-sonnet-5-5"` | The model the `standard` tier runs: building, plans, reviews, tickets, verification and QA. |
| `models.deep` | project, personal repo | `"claude-opus-5-5"` | The model the `deep` tier runs: PRDs, designs, high-risk reviews and re-planning. |
| `models.alternates.light` | project | none | A different `light` model a verifier uses first, so a check isn't run by the author's own model. |
| `models.alternates.standard` | project | none | A different `standard` model a verifier uses first, so a check isn't run by the author's own model. |
| `models.alternates.deep` | project | none | A different `deep` model a verifier uses first, so a check isn't run by the author's own model. |
| `models.steps.prd` | project, personal repo | `"deep"` | The tier that runs writing a PRD; it must stay `"deep"`. |
| `models.steps.design` | project, personal repo | `"deep"` | The tier that runs writing a design; it must stay `"deep"`. |
| `models.steps.tickets` | project, personal repo | `"standard"` | The tier that runs splitting work into tickets; one tier up for high risk or size L. |
| `models.steps.verify` | project, personal repo | `"standard"` | The tier that runs verifying another agent's work; one tier up for high risk or size L. |
| `models.steps.plan` | project, personal repo | `"standard"` | The tier that runs planning a ticket; one tier up for high risk or size L. |
| `models.steps.replan` | project, personal repo | `"deep"` | The tier that runs re-planning a ticket after a repeated failure; one tier up for high risk or size L. |
| `models.steps.build` | project, personal repo | `"standard"` | The tier that runs building a ticket's code; one tier up for high risk or size L. |
| `models.steps.review` | project, personal repo | `"standard"` | The tier that runs reviewing a ticket's change; one tier up for high risk or size L. |
| `models.steps.review-high-risk` | project, personal repo | `"deep"` | The tier that runs reviewing a high-risk change; it must stay `"deep"`. |
| `models.steps.qa` | project, personal repo | `"standard"` | The tier that runs the QA agent's E2E work; one tier up for high risk or size L. |
| `models.steps.commit-message` | project, personal repo | `"light"` | The tier that runs writing a commit message; one tier up for high risk or size L. |
| `models.steps.mr-description` | project, personal repo | `"light"` | The tier that runs writing an MR description; one tier up for high risk or size L. |
| `models.steps.report-summary` | project, personal repo | `"light"` | The tier that runs summarising a run's report; one tier up for high risk or size L. |
| `models.steps.parking-note` | project, personal repo | `"light"` | The tier that runs writing a parked ticket's note; one tier up for high risk or size L. |
| `models.steps.reader-test` | project, personal repo | `"standard"` | The tier that runs the reader test's fresh agent, which reads only a summary; one tier up for high risk or size L. |

## [dependencies]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `dependencies.max_added` | none | `50` | Would cap how many packages one approved install adds before the ticket parks; no file may set it yet, so MIRAI uses `50`. |

## [loop]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `loop.rounds` | project | `2` | Fix rounds a ticket gets (checks, review and QA together) before it parks. |
| `loop.rounds_high_risk` | project | `3` | Fix rounds a high-risk ticket gets before it parks; never fewer than `loop.rounds`. |
| `loop.breaker` | project | `3` | Environment faults in a row (Docker, the login, the machine) that stop a `mirai run`; a good launch resets the count. |
| `loop.ticket_turns` | project | none | A cap on one ticket's agent turns, unset until calibration; nothing reads it yet. |
| `loop.ticket_tokens` | project | none | A cap on one ticket's tokens, unset until calibration; nothing reads it yet. |
| `loop.ticket_minutes` | project | none | A cap on one ticket's minutes, unset until calibration; nothing reads it yet. |

## [testing]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `testing.tdd` | project | `"auto"` | The test order for a ticket that sets none: `"first"` tests fail before the code, `"after"` follows it, `"auto"` lets the plan choose per row. |
| `testing.tests` | project | `"required"` | The `tests` value for a ticket that sets none, `"required"` or `"optional"`; MIRAI writes it into the plan and the run log. |
| `testing.levels[].name` | project | none | The level's name, used by `mirai test`, the baseline and the build's checks; required, and unique. |
| `testing.levels[].repo` | project | none | Which `[[repos]]` entry the level belongs to; MIRAI checks the name exists, and nothing else reads it yet. |
| `testing.levels[].adapter` | project | none | The test adapter that reads the level's report, runs one file or test, and measures coverage, such as `"phpunit"`. |
| `testing.levels[].report_root` | project | none | The project folder the adapter's report paths start from, when that isn't the service's working folder, such as `"e2e/tests"`. |
| `testing.levels[].command` | project | none | The command that runs the level inside its service, as a list of arguments; required. |
| `testing.levels[].purpose` | project | none | What the level proves, in words; nothing reads it yet. |
| `testing.levels[].required_for` | project | none | When the level is required, such as `"logic"` or `"critical-journeys"`; only the baseline reads it, counting `"critical-journeys"` as end-to-end. |
| `testing.levels[].budget_minutes` | project | none | A time budget for the level; nothing reads it yet. |
| `testing.levels[].coverage_paths` | project | none | The files this level must measure for diff coverage, read from the integration branch; unset, the files its baseline measured. |
| `testing.levels[].service` | project | none | The compose service the level runs in; a test run refuses a level without one. |
| `testing.levels[].workdir` | project | none | The working folder inside the container, such as `"/app"`; unset, the service's own working folder. |
| `testing.levels[].timeout_minutes` | project | `15` | The hard time limit for one run of the level, from 1 to 240 minutes. |
| `testing.levels[].run` | project | `"exec"` | `"exec"` runs the level inside the running service; `"oneoff"` runs it in a fresh container of that service. |
| `testing.e2e_budget_minutes` | project | `15` | A time budget for the E2E suite; nothing reads it yet. |
| `testing.e2e_paths` | project | `[]` | Where the E2E tests live; they become protected paths that only the QA agent may change. |

## [checks]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `checks.<name>` | project | none | A named check, such as a linter: a command as a list of arguments, or a table with `command` and where it runs. |
| `checks.<name>.command` | project | none | The command that runs the check inside its service, as a list of arguments; required in the table form. |
| `checks.<name>.service` | project | none | The compose service the check runs in; a test run refuses a check without one. |
| `checks.<name>.workdir` | project | none | The working folder inside the container, such as `"/app"`; unset, the service's own working folder. |
| `checks.<name>.timeout_minutes` | project | `15` | The hard time limit for one run of the check, from 1 to 240 minutes. |
| `checks.<name>.run` | project | `"exec"` | `"exec"` runs the check inside the running service; `"oneoff"` runs it in a fresh container of that service. |

## [compose]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `compose.files` | project | none | The compose files, as repo paths, that test runs start the project's containers from. |
| `compose.env_file` | project | none | A committed file of dummy values that compose reads in test runs; agents may read it, and a test run refuses without it. |
| `compose.allow` | project | `[]` | Extra compose service keys a test run accepts, from `shm_size`, `ulimits`, `mem_limit`, `cpus` and `pids_limit`. |
| `compose.output` | project | `"/mirai/out"` | Where the run's output folder is mounted inside the service; reports and coverage are written there. |

## [sandbox]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `sandbox.readable_env` | project | `[]` | Committed `.env*` files with no real secret, such as `.env.example`, that agents may read; every other `.env*` file stays denied. |

## [repos]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `repos[].name` | project | `"." (one repo)` | The repo's name, which a ticket's `repo` field must match; `"."` is this repo. |
| `repos[].path` | project | `"." (one repo)` | Where the repo is, relative to this one; nothing reads it yet. |
| `repos[].remote` | project | none | The repo's git remote, with no credential in it; nothing reads it yet. |
| `repos[].start` | project | none | The command that starts the repo's app, as a list of arguments; nothing reads it yet. |
| `repos[].health` | project | none | The command that checks the repo's app is up, as a list of arguments; nothing reads it yet. |

## [workspace]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `workspace.e2e` | project | `"none"` | Where E2E tests run: `"local"`, `"deployed"` or `"none"`; nothing reads it yet. |
| `workspace.worktree_safe` | project | none | Whether the toolchain works from a second checkout; recorded by `mirai detect`, and nothing reads it until work runs in parallel. |

## [resources]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `resources.<name>.name` | project | none | A display name for a link to one of the project's tools, such as Jira; nothing reads it yet. |
| `resources.<name>.url` | project | none | The tool's http(s) link, with no credential in it; required in the table, and nothing reads it yet. |

## [gate]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `gate.code_paths` | project | `["**", "!docs/mirai/**", "!.mirai/**"]` | Which files count as code for the proof hash, the review and the M1 rate; unset, the docs exclusion follows `docs.root`. |
| `gate.risk.high` | project | `[]` | File patterns that make a ticket's review high risk when its change touches one, read from the integration branch. |
| `gate.protected` | project | `[]` | More protected paths for this project, added to the built-in ones; a plan that changes one always waits for you. |
| `gate.packs` | project | `[]` | Ecosystem packs of protected paths to switch on, such as `"node"` or `"php"`; the core pack is always on. |

## [gates]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `gates.track` | project | `"human"` | Confirming the work's track (quick, standard or full); always `"human"`: `"auto"` is refused. |
| `gates.brief` | project | `"human"` | Approving a brief; always `"human"`: `"auto"` is refused. |
| `gates.prd` | project | `"human"` | Approving a PRD; always `"human"`: `"auto"` is refused. |
| `gates.design` | project | `"human"` | Approving a design (HLD, ADR or LLD); always `"human"`: `"auto"` is refused. |
| `gates.tickets` | project | `"human"` | Approving a ticket set; always `"human"`: `"auto"` is refused. |
| `gates.instruction-files` | project | `"human"` | A change to agent instruction files such as `CLAUDE.md`, `AGENTS.md` or skills; always `"human"`: `"auto"` is refused. |
| `gates.merge` | project | `"human"` | Merging code into the integration branch or an epic branch; always `"human"`: `"auto"` is refused. |
| `gates.new-budget` | project | `"human"` | Granting a ticket new fix rounds after MR comments; always `"human"`: `"auto"` is refused. |
| `gates.unpark` | project | `"human"` | Unparking a ticket to re-plan, retry or drop it; always `"human"`: `"auto"` is refused. |
| `gates.context` | project | `"human"` | Changing business context, the critical-journeys list or a template; always `"human"`: `"auto"` is refused. |
| `gates.clean` | project | `"human"` | Deleting old files with `mirai clean`; always `"human"`: `"auto"` is refused. |
| `gates.production` | project | `"human"` | Deploying to production; always `"human"`: `"auto"` is refused. |
| `gates.plan` | project | `"human" (supervised), "auto" (autonomous)` | Approving a ticket's plan; today MIRAI decides it from `preset`, not this key, and a risky plan always waits for you. |
| `gates.build` | project | `"auto"` | Whether the build of an approved plan waits for you; nothing reads this key yet. |
| `gates.review` | project | `"auto"` | Whether the review of a ticket's change waits for you; nothing reads this key yet. |
| `gates.qa` | project | `"auto"` | Whether a ticket's QA step waits for you; nothing reads this key yet. |
| `gates.docs-merge` | project | `"auto"` | Merging a documents-only MR after your signed ticket-set approval; nothing reads this key yet. |
| `gates.final-e2e` | project | `"auto"` | The final E2E run of an epic released together; nothing reads this key yet. |

## [docs]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `docs.root` | project | `"docs/mirai"` | The repo folder that holds MIRAI's documents; the default `gate.code_paths` leaves it out. |
| `docs.store` | project | `"repo"` | Where the project's documents are kept: `"repo"` (under `docs.root`, reaching the integration branch through one docs merge request per initiative) or `"local"` (MIRAI's store on this Mac, never committed; teammates can't see them). Changing it once the store has documents is refused (`docs/stores.md`). |
| `docs.reader_test` | project | `true` | `false` turns off the reader test before you approve a document from its summary, for a project with no subscription to spare. |
| `docs.max_decision_questions` | project | `5` | Past this many decision questions asked on one version (answered or not) of a brief or PRD, MIRAI asks one question instead: reopen the brief interview, or go on with them (1–20; unit 44). |
| `docs.reader_fix_rounds` | project | `2` | The author's fix rounds after a failed reader test (0–5); after the last, the document reaches you marked (unit 40). |
| `docs.verify` | project | `true` | `false` turns off Vera's check before you approve a brief, a PRD, an epic or a context file; every approval then says so (unit 40). |
| `docs.verify_fix_rounds` | project | `2` | The author's fix rounds after Vera's first check (0–5); after the last, open must-fix findings reach you as "Vera: N findings open" (unit 40). |
| `docs.limits.brief_summary_words` | project | `400` | A brief's summary word budget: the lint fails over it and warns at 80%. |
| `docs.limits.prd_summary_words` | project | `600` | A lite PRD's summary word budget: the lint fails over it and warns at 80%. |
| `docs.limits.prd_full_summary_words` | project | `1000` | A full PRD's summary word budget: the lint fails over it and warns at 80%. |
| `docs.limits.prd_lite_words` | project | `3000` | The most words a lite PRD may have; over it the lint fails, or warns when the PRD sets a `length_exception`. |
| `docs.limits.prd_full_words` | project | `5000` | The most words a full PRD may have; over it the lint fails, or warns when the PRD sets a `length_exception`. |
| `docs.limits.epic_tickets` | project | `20` | The most tickets an epic may have; the lint fails above it and warns from 80% of it. |
| `docs.limits.epic_l_tickets` | project | `5` | The most size-L tickets an epic may have; the lint fails above it. |
| `docs.limits.epic_summary_words` | project | `400` | An epic's summary word budget; the lint fails above it. |
| `docs.limits.epic_summary_warn_words` | project | `300` | The word count at which the lint warns that an epic's summary is near its budget. |
| `docs.limits.business_words` | project | `1000` | The most words `.mirai/context/business.md` may have, its Sources table not counted; the lint fails above it ([context.md](context.md)). From 300 to 3000. |
| `docs.limits.business_warn_words` | project | `800` | The word count at which the lint warns that `business.md` is near its cap; below `docs.limits.business_words`. From 200 to 3000. |

## [tickets]

Unit 42 ([tickets.md](tickets.md)). Team policy: the project file only.

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `tickets.inputs.standard` | project | MIRAI's list | The document types the `standard` track needs approved before Tess cuts the set (unit 45). MIRAI's list always counts: the PRD and the technical note (`tech-note`); a type MIRAI doesn't have yet is skipped with a warning naming its unit. A project may only add types, such as `["requirements"]`. |
| `tickets.inputs.full` | project | MIRAI's list | The same for the `full` track: MIRAI's list is the PRD, the HLD, the ADRs and the LLD; a project may only add types. |
| `tickets.key_prefix` | project | none | The ticket keys' prefix (`PROJ` in `PROJ-12`): capital letters and digits, up to 10. Tess numbers new tickets on from the highest key with it; with none set, she doesn't start, and says so. |
| `tickets.types[].name` | project | none | One `[[tickets.types]]` entry per type; with none, MIRAI's three (Story, Bug, Investigation). The type's name, as your tracker calls it (`Task`, `Spike`, `Tech Debt`); required, unique. A ticket names it in `ticket_type`. |
| `tickets.types[].description` | project | none | What the type is for and when to use it; required: Tess reads it to choose a ticket's type. |
| `tickets.types[].runs_as` | project | none | The MIRAI behaviour it runs as: `change` (a story), `bug` (a bug, red test first) or `investigation` (research and a finding, unit 42b); required. Anything else is refused. |
| `tickets.types[].template` | project | none | The name of its own template, `.mirai/custom/ticket-types/<name>.toml` + `.md`, approved as an overlay ([overlays.md](overlays.md)); unapproved, MIRAI's template is used. |
| `tickets.types[].checklist` | project | none | Extra checklist lines for the type, one line each; read by Tess with the type. |
| `tickets.types[].tracker_type` | project | none | The issue type a tracker uses when the ticket is published (unit 38's trackers). |

## [retention]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `retention.days` | project | `90` | Days a merged ticket's bulky work files are kept before cleanup may delete them; nothing reads it yet (`mirai clean` comes later). |
| `retention.auto` | project | `false` | `true` would let cleanup delete old files without asking you; nothing reads it yet. |

## [run]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `run.stop_by` | project, personal repo | none | A local clock time, such as `"06:30"`; a usage-limit wait that would end after it stops the run instead. |
| `run.on_limit` | project, personal repo | `"wait"` | At the 5-hour usage limit, `"wait"` pauses the run until the reset and `"stop"` stops it. |
| `run.max_wait_minutes` | project, personal repo | `300` | The longest a run waits for a 5-hour limit to reset; a longer wait stops the run. |

## [tests]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `tests.max_parallel` | personal global | `2` | How many test runs may run at once on this machine, across all your projects, from 1 to 8. |

## [subscription]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `subscription.plan` | personal global | none | Your Claude plan's name, such as `"max-20x"`; nothing reads it yet, and the usage ledger records `"unknown"`. |

## [claude_code]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `claude_code.move` | personal global | none | `"auto"` lets MIRAI move agents to a newer Claude Code at a ticket's start after a green red team; unset or `"off"`, it doesn't. |

## [signing]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `signing.unlock` | personal global | `"each"` | How long your key stays unlocked after your passphrase: `"each"` asks at every decision, or a duration up to 30 days, such as `"8h"`. |

## [usage]

| Key | Who may set it | Default | What it does |
|---|---|---|---|
| `usage.night_max` | personal global | `15` | The most of your weekly limit, in percent, MIRAI may use in 12 hours; a ticket that would pass it doesn't start. |
| `usage.week_max` | personal global | `60` | The most of your weekly limit, in percent, MIRAI may use this week; a ticket that would pass it doesn't start. |
| `usage.reserve` | personal global | `40` | The percent of your weekly limit kept for you; a ticket that would leave less doesn't start. |
| `usage.ticket_estimate` | personal global | `2` | The percent of your weekly limit MIRAI expects the next ticket to take, unless a larger ticket was measured tonight. |
| `usage.stale_hours` | personal global | `12` | How old, in hours, a usage reading may be; an older one makes a run launch a short Haiku check first. |

