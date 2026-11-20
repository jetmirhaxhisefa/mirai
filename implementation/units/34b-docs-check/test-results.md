# Unit 34b: test results

Built 2026-11-20 on `unit/34b-docs`, from `origin/main` at `8b72dbe` (unit 34 merged).

## Tests

`test/docs/coverage.test.js` (14 tests), with its logic in `test/docs/coverage.js`.

| Test | What it checks | Result |
|---|---|---|
| T1 (real) | the real `docs/`: every command and subcommand, `/mirai` command, config key, document type and file | pass: no gaps |
| T1 (fixture) | a small passing docs set; subcommands from usage strings; who-may-set from LAYER_KEYS | pass |
| T2 ×9 | seeded gaps, each failing with one message that names it and where to add it: a command no page names; a subcommand; a mention outside code; a `/mirai` command; a gate no `/mirai` section names; a schema key with no row; a row for an unknown key; an empty column (also a second row, and a wrong "who may set it"); a document type; a `docs/` file missing from the index | pass |
| T3 | internal list: no reason; something that no longer exists (a command, a key); an unknown kind; `mirai hook` is a gap again without its entry | pass |
| T4 | the check runs in under 2 s (about 100 ms); `coverage.js` uses no git, network, Docker or child process | pass |

Full suite, `caffeinate -i npm test` (Node 26, macOS arm64): **715 of 716 pass**, 14 min.
- The one failure is not this unit's: `T5, T6: the launch: production layout, …` in
  `test/launch/strict.test.js:304` ("a failed launch left its scratch folder", `mirai-3befa780`).
  It compares `/private/tmp/mirai-*` names before and after, so a scratch folder another test file
  makes at that moment counts as a leak. Run alone, the file passes 14 of 14. This unit changes
  no code under `src/`.

### How the check decides

- **A mention** is the name inside a code span, a code block or a heading. Plain prose doesn't count.
- **Commands:** `src/cli/commands/index.js` plus `help`. Subcommands come from each usage string: the
  literal word after the command (`mirai redteam accept-blocker`), or each choice in a first
  `<a|b>` (`mirai key unlock`). 76 commands and subcommands today.
- **Session commands:** every key of `COMMANDS` in `src/mcp/tools/commands.js` must appear as
  `/mirai <command>`. Every gate (`GATES`) and every `NOT_FROM_SESSION` entry must be named in a
  section whose heading has `/mirai`. That is how "the page says it isn't available in a
  session" is checked.
- **Config keys:** walked from `CONFIG_SCHEMA`: `<name>` for a map's keys, `[]` for a list of
  tables, and `schema_version` from LAYER_KEYS. 124 keys. Each needs exactly one row in
  `docs/config.md`, 4 columns, none empty. The check also holds "who may set it" to LAYER_KEYS
  (not in the spec; it keeps the column true).
- **Document types:** every `registry/document-types/*.toml`, and any subfolder, must be named as a
  code span (`story`, `story.toml`) in `docs/documents.md` or a page it links.
- **The index:** every file in `docs/` must be linked from `docs/README.md`.

## What the first run found, and where it went

| Gap | Fixed in |
|---|---|
| `mirai lint` | `docs/documents.md`, new section "The lint: `mirai lint`" |
| `mirai protected` | `docs/agent-safety.md`, new section "Protected paths: `mirai protected`" |
| `mirai help`, `mirai version` | `docs/install.md` |
| `mirai config show` | `docs/config.md` (opening) |
| `mirai key unlock` | `docs/signing.md` |
| `mirai log note`, `mirai log template_gap` | `docs/agent-safety.md` ("How agents talk to MIRAI") |
| `mirai trust snapshot` | `docs/agent-safety.md` ("MIRAI's own git") |
| `mirai session-server remove` | `docs/agent-safety.md` ("How it's set up") |
| `mirai hook`, `mirai hook pre-push` | `docs/internal-list.toml` |
| 17 `/mirai` commands (`lint`, `test`, `baseline show`, `redteam status`, `redteam show`, `branch verify`, `sandbox show`, `version`, `help`, `fix`, `review`, `ship`, `config check`, `config show`, `protected`, `trust check`, `detect`) | `docs/agents.md`, the full `/mirai` list |
| gate `merge`; not from a session: `feedback`, `trust snapshot` | `docs/agents.md`, the `/mirai` section |
| 124 config keys | `docs/config.md` (new) |
| document types `brief`, `bug`, `plan`, `prd`, `story` | `docs/documents.md`, new section "The document types" |
| 22 files not indexed | `docs/README.md` (new) |

## The internal list

| Name | Kind | Reason |
|---|---|---|
| `mirai hook` | command | called by git, not by you: git runs it as the pre-push hook that `mirai init` installs (`docs/pre-push.md` explains the check itself) |

Nothing else was truly internal. `mirai trust snapshot` was a candidate, but its own error hint
tells you to run it, so it's documented instead.

## `docs/config.md`

124 rows. Defaults come from `src/config/defaults.js`; where the code that reads a key falls back
to its own value, that value is used:

| Key | Default | From |
|---|---|---|
| `git.host_url` | by `git.host` | src/ship/host.js:17,31 |
| `git.committer_email` | `"mirai@localhost"` | src/agent/commit.js:21 |
| `git.allow_repo_config` | `[]` | src/config/load.js:269 |
| `dependencies.max_added` | `50` | src/agent/install.js:38,356 |
| `loop.rounds`, `loop.rounds_high_risk` | `2`, `3` | src/loop/guard.js:29 |
| `loop.breaker` | `3` | src/run/drive.js:333 |
| `…timeout_minutes`, `…run` (levels and checks) | `15`, `"exec"` | src/tests/run.js:47,67 |
| `compose.output`, `compose.allow` | `"/mirai/out"`, `[]` | src/tests/run.js:48,392 |
| `gate.packs` | `[]` | src/trust/protected.js:30 |
| `docs.reader_test` | `true` | src/cli/commands/approve.js:376 |
| `docs.limits.*` | 400, 600, 1000, 3000, 5000, 20, 5, 400, 300 | registry/document-types/{brief,prd,epic}.toml; src/lint/graph.js:23 |
| `run.on_limit`, `run.max_wait_minutes` | `"wait"`, `300` | src/run/pause.js:9,44 |
| `tests.max_parallel` | `2` | src/config/load.js:281 |
| `signing.unlock` | `"each"` | src/sign/unlock.js:31 |
| `usage.ticket_estimate`, `usage.stale_hours` | `2`, `12` | src/loop/ledger.js:18,71 |

Keys nothing reads yet (their rows say so): `loop.ticket_turns`, `loop.ticket_tokens`,
`loop.ticket_minutes`, `testing.e2e_budget_minutes`, `testing.levels[].purpose`,
`testing.levels[].budget_minutes`, `repos[].path`, `repos[].remote`, `repos[].start`,
`repos[].health`, `workspace.e2e`, `workspace.worktree_safe` (written by `mirai detect`),
`resources.*`, `retention.*`, `subscription.plan`, and `gates.*` (question 1).

**P1** (your read of `run.stop_by` and `docs.root`) is yours to run.

## The read (Scope 6)

Every page in `docs/` was read against the code on main: usage strings and options, config keys
and defaults, file paths, error codes, flows. 73 statements fixed. Line numbers are as at the read.

| Page:line | Old text | New text | Code checked |
|---|---|---|---|
| docs/agent-safety.md:185 | "with four tools: `lint` (MIRAI's document checks)," | "Its tools for checks and notes: `lint` (MIRAI's document checks)," | src/mcp/session.js:113-120 |
| docs/agent-safety.md:194 | "The allow rules for the four tools go into" | "The allow rules for its tools (all but `start_agent` and `mirai_command`, which ask you each time) go into" | src/mcp/session.js:58-60 |
| docs/agent-safety.md:209 | "Its environment is empty (`/usr/bin/env -i`)" | "Its environment is empty but for `HOME` and `PATH=/usr/bin:/bin` (`/usr/bin/env -i`)" | src/mcp/session.js:133, src/launch/strict.js:577 |
| docs/agent-safety.md:245 | "or from the orchestrator later." | "or from the orchestrator (`mirai run`, unit 28)." | src/run/drive.js:131-148 |
| docs/agent-safety.md:272 | "MIRAI doesn't put them there for you yet. Until it does, you can add … by hand." | "Since unit 29b, `mirai key new`, `key protect` and `token set` add the `~/.config/mirai` and MIRAI-home denies to your user-level Claude Code settings." | src/sign/denies.js:5-14, src/cli/commands/token.js:45, src/cli/commands/key.js:25 |
| docs/agent-safety.md:483 | "with an empty environment, as with the hook" | "with an empty environment but for `HOME` and a fixed `PATH`, as with the hook" | src/launch/strict.js:577 |
| docs/agent-safety.md:651 | "and every tool so far is for agent runs only." | "may be in: an agent run's, your session's, or both." | src/mcp/tools/*.js `contexts` |
| docs/agent-safety.md:682 | "What isn't here yet: launching agents and session runs (…): unit 19 …; trace: unit 43." | "What isn't here yet: `trace` (unit 43). Launching agents and session runs (…) came with unit 19c, on your session's server only." | src/mcp/tools.js:26, src/mcp/tools/agents.js, sessions.js |
| docs/agent-safety.md:688 | "and later the commits." | "and the commits." | src/agent/commit.js, src/store/git.js:25 |
| docs/agent-safety.md:770 | "Not live yet: … MIRAI's launcher, which calls them, comes with units 15 and 19 … tested but not yet in use." | "Live since unit 19: every agent launch takes the fingerprint and checks it at the end (`prepareLaunch` / `finishLaunch`)." | src/agent/run.js:328,480,603 |
| docs/agent-safety.md:930 | "`plan`, `build`, `fix` and `redteam run` accept the request" | "`plan`, `build`, `fix`, `review`, `run`, `resume` and `redteam run` accept the request" | src/cli/commands/review.js:28, run.js:74, resume.js:40, src/cli/tty.js:55 |
| docs/agent-safety.md:953 | "Skills will reach it through MIRAI's server later (unit 19c)." | "Skills reach it through MIRAI's server (`start_agent`, unit 19c)." | src/mcp/tools/agents.js:27 |
| docs/agent-safety.md:957 | "`mirai redteam show <key>` … `accept-blocker <key> --note <why>`" | "`mirai redteam show <id>` … `accept-blocker <id> --note <why>`" | src/cli/commands/redteam.js:76,131; src/redteam/store.js:22 |
| docs/agent-safety.md:961 | "your own session could read the key and forge one (…). So watch each run until roadmap row 29b is done." | "while it's unlocked, your own session could read it and forge one (…, unit 29b)." | src/config/config-schema.js:347-356 |
| docs/agent-safety.md:966 | "So does silence for two minutes." | "So does no init event within two minutes." | src/agent/run.js:42,453-455 |
| docs/agent-safety.md:974 | "Usage share is "unknown" until unit 20." | "Its usage share is measured from Claude Code's usage readings (unit 20), or "unknown" without them." | src/agent/run.js:507-548 |
| docs/agent-safety.md:end | "## Coming next — Units 19b and 19c: …" | section removed (both shipped) | src/agent/tiers.js, src/agent/scope.js, src/mcp/tools/agents.js |
| docs/agent-safety.md:697 | "git simply has no home folder" | "git has no home folder" | wording rule |
| docs/agent-safety.md:730 | "an IDE's own section and so on." | "an IDE's own section, for example." | wording rule |
| docs/agent-safety.md:91 | "not just the name it's given" | "not only the name it's given" | wording rule |
| docs/agents.md:81 | "so `mirai plan` simply runs again." | "so `mirai plan` runs again." | wording rule |
| docs/agents.md:107 | "You type the ticket's key to confirm." | "You type the ticket's key to confirm, or your passphrase for a protected key (`docs/signing.md`)." | src/sign/signer.js:63-90, src/cli/commands/approve.js:176 |
| docs/agents.md:119 | "An existing branch is used only while it has no commits of its own, since nothing commits before unit 22." | "An existing branch is used only when its record verifies and every commit on it is MIRAI's" | src/agent/branch.js:11-16 |
| docs/agents.md:225 | "It starts only from a step that ended with failing tests MIRAI committed, under the plan…" | "…failing tests MIRAI committed, or from Rex's blocking findings, under the plan…" | src/agent/fix.js:107-118,143 |
| docs/agents.md:252 | "or `[git] committer_email` there" (your personal file) | "or `[git] committer_email` in `.mirai/config.toml`" | src/agent/commit.js:26-43, src/config/config-schema.js:11 |
| docs/loop-rules.md:10 | (unpark retry read as a working grant) | added "No command grants rounds yet: `mirai unpark` refuses a loop-guard park until unit 46." | src/cli/commands/unpark.js:48; src/loop/guard.js:199 (grantRounds, no caller) |
| docs/loop-rules.md:19 | "including one that simply wasn't fixed" | "including one that wasn't fixed" | wording rule |
| docs/signing.md:42 | "pass for a document approval (`mirai/approval/1:<repo-id>`) or a journal line." | "pass for a journal line (`mirai/journal/<version>:<repo-id>`), where document approvals go." | src/cli/commands/approve.js:88,262; src/store/journal.js:168 |
| docs/signing.md:47 | "It's signed with your key, under its own context" | "It's signed with your key, or the machine key once it's set up, under its own context" | src/sign/signer.js:25-45, src/agent/build.js:456 |
| docs/signing.md:47 | "Records are signed from your terminal only. Night runs need a machine key, which is row 29b's." | "Unattended, only the machine key signs one (unit 29b)." | src/agent/branch.js:89-92 |
| docs/signing.md:51 | "signed with your key under `mirai/proof/1:<repo-id>`" | "signed with your key, or the machine key once it's set up, under `mirai/proof/1:<repo-id>`" | src/proofs/record.js:126-127 |
| docs/signing.md:51 | "Like every record, they're signed from your terminal only; until row 29b's machine key, a night run parks the ticket for you (`sign-proofs`)." | "With the machine key set up (unit 29b), `mirai run` signs them with it, from your session too. Without it, they're signed in your terminal only." | src/run/drive.js:293-297,149; src/cli/commands/gate.js:48 |
| docs/build-runner.md:43 | "`runner.log` has one line per request:" | "`runner.log` has a line when a request starts and when it ends:" | tools/build-runner/runner.js:262,283 |
| docs/build-runner.md:51 | "its result is reused until" | "a pass is reused until" | tools/build-runner/runner.js:304-305 |
| docs/build-runner.md:66 | "a home folder and a temp folder of its own." | "a home folder of its own, with your real home closed to it by a macOS sandbox." | tools/build-runner/runner.js:309-315,138-150 |
| docs/build-runner.md:73 | (step 2 before each job) | added "Steps 2 to 4 are skipped when `main` already carries that commit." | tools/build-runner/runner.js:353 |
| docs/ci.md:17 | "it uses only the `pull_request` trigger." | "for pull requests, it uses only the `pull_request` trigger." | .github/workflows/ci.yml:9-12 |
| docs/doctor.md:21 | "the week's MIRAI share would pass `usage.week_max`" | "the next ticket would pass `usage.night_max`, `usage.week_max` or `usage.reserve`" | src/loop/ledger.js:113-118 |
| docs/doctor.md:23 | "the pre-push hook runs a Node that isn't there" | "MIRAI's hooks aren't installed here; the pre-push hook runs a Node that isn't there" | src/doctor/checks.js (hook check) |
| docs/doctor.md:25 | "the kept Claude Code is for another CPU…" / "it's an Intel binary…" | "the kept Claude Code is gone, or is for another CPU…" / "none kept yet; it's an Intel binary…" | src/doctor/checks.js (cpu check) |
| docs/doctor.md:26 | (row missing) | "Claude Code moves" row | src/doctor/checks.js claude-move; src/redteam/move.js:26,65-76 |
| docs/doctor.md:28 | (row missing) | "Key at rest" row | src/doctor/checks.js key-rest |
| docs/doctor.md:31-32 | (rows missing) | "Ticket images" and "Banned words" rows | src/doctor/checks.js ticket-images, word-list (WORDS_REVIEW_DAYS=90) |
| docs/documents.md:88-90 | "…or the quote isn't in the summary." | added: "\"What's left out\" and \"What you decide\" must quote their own parts" | src/write/reader.js:46-47,147-149 |
| docs/documents.md:132 | "Until unit 34's P2 measures both, the default is `standard`." | "Unit 34's P2 measured both: Haiku failed a good summary, so the default is `standard`." | src/config/defaults.js:42 |
| docs/documents.md:372 | "every FR, NFR and AC of the PRD, with its group" | "… (on `full`, those its own tickets cover), with its group" | src/lint/epic.js:170-171 |
| docs/red-team.md:41 | "After a MIRAI refresh:" | "After a MIRAI refresh that changes the cage:" | src/redteam/cage.js:5-8 |
| docs/red-team.md:61-62 | "the one edge left out is named in the file" | "the two edges left out are named in the file, each with why" | src/redteam/cage.js:34-43 |
| docs/red-team.md:103 | "about 95 cases, roughly 260 short Claude Code runs on Haiku" | "over 110 cases, roughly 290 short Claude Code runs on Haiku" | src/redteam/cases.js:360, src/redteam/run.js:51 |
| docs/red-team.md:107-109 | "it only runs when you type yes in a terminal … it isn't one of MIRAI's tools" | "it runs only with your yes … in a terminal, or in your session with a one-time code … isn't one of the tools MIRAI gives agents" | src/mcp/tools/commands.js:39-41,134; src/cli/tty.js:26 |
| docs/red-team.md:147 | "the way unit 19 will start an agent" | "the way unit 19 starts an agent" | src/agent/run.js:9 |
| docs/red-team.md:156-157 | "today two: …" | "today four: …; `l-cd` and `h-timeout-link`" | src/redteam/cases.js caseIndex() |
| docs/red-team.md:340 | "- **Show it in `doctor`:** units 29 and 47." (under "What it doesn't do") | removed | src/doctor/checks.js Red team item (29c) |
| docs/run.md:22 | "signs the proofs (your terminal), or stops (your session)" | "signs the proofs, or stops (your session, with no machine key)" | src/run/drive.js:295, src/sign/signer.js:49 |
| docs/run.md:41 | "or, from your session, the proofs." | "or, from your session with no machine key, the proofs." | src/run/drive.js:295 |
| docs/run.md:77 | "your key signs them in your terminal only, until row 29b." | "the run stops before the proofs, unless the machine key is set up (`mirai key new --machine`, unit 29b). Without it, your key signs them in your terminal only." | src/run/drive.js:293-297, src/proofs/record.js:127 |
| docs/run.md:105 | "Rounds 0 of 2 used · re-plans 0 of 1" | "… · re-plans 0 of 1 · no parks" | src/run/show.js:126 |
| docs/run.md:108 | (no Feedback row in the example) | "Feedback —" added before QA | src/run/show.js:133 |
| docs/report.md:54 | "From your terminal it's signed with your key" | "From your terminal it's MIRAI's line, unsigned since unit 29b: it isn't a decision. It needs a real terminal, like `approve`." | src/cli/commands/feedback.js:10-12,33 |
| docs/test-adapters.md:135 | "(`bad-coverage`), unless its tests didn't load." | "(`bad-coverage`), unless the run failed." | src/tests/run.js:518-520 |
| docs/test-baseline.md:16-18 | "your signing key committed … (`mirai key new`, then commit the `.pub`)" | "a signing key committed …: the machine key (`mirai key new --machine`, unit 29b), or your own (`mirai key new`). Commit its `.pub`" | src/baseline/record.js:98, src/sign/signer.js:29-45 |
| docs/test-baseline.md:74 | "signed with your key; the last 10" | "signed with the machine key (or yours without one); the last 10" | src/sign/signer.js:29-35, src/baseline/store.js:16 |
| docs/test-baseline.md:106 | "signed with your key (you're there)." | "signed with the machine key, or your key without one." | src/sign/signer.js:29-35 |
| docs/pre-push.md:31 | "not just the result" | "not only the result" | wording rule |
| docs/pre-push.md:16 | "`mirai build`, `mirai fix` and `mirai review` refuse to start" | "`mirai build`, `mirai fix`, `mirai review`, `mirai run` and `mirai resume` refuse to start" | src/cli/commands/run.js:76, resume.js:76 (requireHooks) |
| docs/red-team.md:14 | "mirai redteam show [<key>]" | "mirai redteam show [<key or blocker id>]", plus the `accept-blocker` line | src/cli/commands/redteam.js (usage) |
| docs/red-team.md:329 | the `blocker` row: "the decision … comes back to you" | adds: "`mirai redteam accept-blocker <id> --note <why>` signs your decision; launches then go ahead once a current result is green" | src/cli/commands/redteam.js:240-257, src/agent/run.js:62 |
| docs/agent-safety.md:931 | "Approvals, `discard`, `unpark`, accepting a blocker, your key and your token" | "Approvals, `drop`, `discard`, `unpark`, `gate record`, `merge`, accepting a blocker, your key, your token and `session-server`" | src/mcp/tools/commands.js:89-106 (GATES) |
| docs/agents.md:/mirai | "**`/mirai run`** stops before the proofs: your key signs them in your terminal only, until row 29b." | "**`/mirai run`** signs the proofs with the machine key when it's set up (unit 29b). Without it, the run stops before the proofs…" | src/run/drive.js:293-297 |
| docs/agents.md:/mirai | "**Not from a session:** `init --refresh` and `render`." (no `trust snapshot`, no `feedback`) | "`init` and `render` … `trust snapshot` neither"; "`feedback` is `log_event`'s feedback type" | src/mcp/tools/commands.js:78-87 (NOT_FROM_SESSION) |
| docs/agents.md:/mirai | "Quick commands (`status`, `lint`, `baseline show`, `redteam status`) answer at once." | "Quick commands, such as `status`, `lint`, `show`, `baseline show` and `redteam status`, answer at once." | src/mcp/tools/commands.js:32-73 (`quick`) |
| docs/agents.md:/mirai | gates "… `key`, `token` and `session-server`" (no `merge`) | "… `gate record`, `merge`, `redteam accept-blocker`, `key`, `token` and `session-server`" | src/mcp/tools/commands.js:104 (GATES.merge) |
| docs/agents.md:/mirai | a list of 11 example `/mirai` commands | every command the session server offers (29), grouped | src/mcp/tools/commands.js:30-73 (COMMANDS) |

No changes were needed in `model-tiers.md`, `tdd.md`, `releasing.md`, `install.md` (apart from the
added lines), `ship.md`, `review-mr.md` or `setup-detection.md`.

### Wording (research/14)

Fixed where small: "simply", "just", "and so on" (listed above). Not fixed, because the fix is a
rewrite: sentences over 25 words on every long page, worst in
- `review-mr.md:38` (one sentence of about 100 words), `run.md:47`, `ship.md:95-99`;
- `agent-safety.md`: "Starting agents from your session", "What holds in your sessions", the
  `/mirai` bullets, "Starting an agent" limits, "Which layer stops the file tools";
- `red-team.md` and `documents.md` (about 20 sentences), `agents.md`, `signing.md` (Proofs);
- `loop-rules.md`: the parking list ends with "…", an open end like "etc.".

The read before v1.0 can take these.

## Questions for Jet

Each looks wrong but may be intended, so nothing was changed.

**Code that may be a bug** (listed, not fixed):
1. **`gates.*` overrides do nothing.** `load.js:119` merges `config.gates`, but nothing reads it; the
   plan gate uses `PRESETS[preset].plan` (src/agent/plan.js:174). design/01 §16 says you can
   change any `yes` line. Planned for a later unit, or a bug?
2. **`dependencies.max_added` can't be set.** It's in the schema (config-schema.js:213), but no
   layer in LAYER_KEYS allows it, so a file that sets it is refused. agents.md and agent-safety.md
   describe it as a setting. Should the project file set it?
3. **`git.host_url` with a port:** the schema accepts one (config-schema.js), `mirai ship` refuses it
   (src/ship/host.js:34).
4. **`subscription.plan` never reaches the usage ledger:** every line records `"unknown"`
   (src/store/global.js:46, src/agent/run.js:563).
5. **`mirai show` and the loop guard disagree** when `rounds_high_risk < rounds`: the guard uses
   the larger (src/loop/guard.js:86), show doesn't (src/run/show.js:76).
6. **The personal repo file's hint** lists only `models.*` and `run.stop_by`, not `run.on_limit` or
   `run.max_wait_minutes` (src/config/load.js:192).
7. **`mirai run` on a shipped ticket whose MR merged on the host** records nothing: only `ship`
   asks the host (src/run/drive.js:96-97). review-mr.md says "the next `ship` or `run`" notices.
8. **`unattended: true` always parks `sign-proofs`,** even with the machine key ready
   (src/proofs/record.js:104-108). Nothing passes it today.
9. **`src/sign/denies.js:19` writes deny rules into `~/.claude-private/settings.json`** as well as
   `~/.claude`: a folder name from your own setup, in general code. Skipped when missing.

**Docs that may run ahead of the code, or the other way round:**
10. **Rejecting a plan "until the build"** (agents.md, tdd.md): the code allows a reject after the
    build started (approve.js:123-128). Is "until the build" a missing rule?
11. **"On `full` … one approval covers [several epics]"** (documents.md): `mirai approve <epic-id>`
    approves one epic per call. Later (unit 45's inbox)?
12. **An allow rule "would skip the question"** for `start_agent` (agent-safety.md:237): since
    21f, install adds an `ask` rule, and ask beats allow. Only true when install couldn't write it?
13. **"A worktree per launch"** for units 21 and 22 (agent-safety.md, "Starting an agent"): there's
    none in the code. Dropped, or moved to a later unit?
14. **Credential helpers "switched off"** (agent-safety.md, MIRAI's own git): push, fetch and
    ls-remote add MIRAI's own helper (src/store/git.js:710-725). Worth a line?
15. **The red team's size:** its consent text says "about 320 short runs"
    (src/mcp/tools/commands.js:24; agents.md repeats it). red-team.md now says "roughly 290",
    counted from `caseIndex()` (98 model cases × 3). Which should both say?
16. **"Not run on a real model yet"** for unit 21d's red-team cases (red-team.md): stale?
17. **The brief is linted with the PRD at approval** (documents.md): only on `standard`
    (approve.js:331-334). Probably intended.
18. **A grant of rounds** (loop-rules.md): `grantRounds` has no caller yet; I added "No command
    grants rounds yet … until unit 46". Right unit?

**Incomplete, not untrue** (left as they are): ship.md's Codes table (no `bad-record`,
`nothing-to-prove`, `no-branch`, `unknown-ticket`, `push-refused`, `push-check`); pre-push.md's
codes (no `too-many-commits`); report.md's sections (no Summary, Branch warnings, Housekeeping);
test-baseline.md's `no-e2e` (any level with "e2e" in its name); ci.md's guard list.

## Not as written in the spec

- **Session commands:** "or the command's doc page must say it isn't available in a session" is
  checked as "named in a `/mirai` section" (the gates and "Not from a session" lines). A
  free-text "isn't available" can't be checked reliably.
- **The who-may-set check** is extra.
- **PROGRESS:** rows are added on approval, so 34b is on the Next line only, between 34 and 35.
- **P1 and P2** are yours: P1 your read of config.md; P2 runs at 35's rebase.
