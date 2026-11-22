# Unit 39: test results (2026-11-22)

Built stacked on unit 38's branch (`unit/38-build`, with main merged in), as the coordinator asked.

## Tests

All in `test/setup/setup.test.js` unless named. The fixture is an installed sample repo with an
existing AI setup: a skill (with a second file), an agent, a command, a hook in
`.claude/settings.json` running `.claude/hooks/format.sh`, a second hook that pipes `curl` to `sh`,
a script the skill calls, `_bmad/agents/pm.md`, `docs/prd.md`, an MCP server in `.mcp.json` and a
`CLAUDE.md` that imports `docs/notes.md`.

- **T1 The ledger:** `mirai setup scan` lists 12 items, each with its kind: the skill (one row for
  its folder), the agent, the command, the hook script, each hook in the settings
  (`.claude/settings.json#hooks.<Event>.<n>`), the called script, BMAD's agent, BMAD's PRD
  (`document`), the MCP server (`.mcp.json#docs-search`), `CLAUDE.md` and its import. 17a's
  patterns flag the skill's `curl … | sh` (fetch, pipe-to-shell), the hook's curl and the
  import's `npm install`. MIRAI's own rendered files (its skills, agents, `/mirai` command,
  `AGENTS.md` with only its block) are no items. Nothing in it reaches a launch (fake launcher,
  macOS): Kai's launch carries none of the items' names, texts, hook scripts or servers, in its
  arguments, its settings file or any JSON it's given, and has `--strict-mcp-config`.
- **T2 `mirai custom add`:** the skill (both files), the agent (as an overlay of `mirai-reviewer`
  under a project role, its tools kept), a script, a command (made a project skill with its
  description) and the hook (its script moved, its group taken out of the settings, the hook file
  written) each land in their place; the originals are deleted; the output ends with the next
  steps and the item's full path. Before approval `mirai render` skips each with its line and
  `.claude/` doesn't change; after `mirai approve --file` of each (records
  `approvals/<kind>-<name>.json`) and `mirai render`: the skill's files in `.claude/skills/deploy/`,
  Rex's agent file with the added text, the hook in `.claude/settings.json`, the server in
  `.mcp.json`, each in the lock (`hook:` and `mcp:` entries); a second render changes nothing;
  taking the skill and hook out removes them and leaves the project's own hook. Refused, naming the
  check, nothing moved: a skill named `mirai-write`; an agent whose overlay names a custom role that
  may write `.github/workflows/**`; a hook that pipes `curl` to `sh` ("no sandbox-safe form").
  Also: an agent without `--as`, and instruction text (`CLAUDE.md`), are refused with the way that
  works. The items' own checks: a skill pre-approving `Bash`, a skill with its own `hooks`, an MCP
  server with a literal token, a script naming `.mirai/`, a hook naming a missing script, a stray
  file; a server with `Bearer ${WEB_TOKEN}` passes.
- **T3 Hooks:** kept as a check (`--as check --service app`), the script moves and the printed
  `[checks]` line, added to the config, makes `mirai test format` run
  `sh .mirai/custom/scripts/format.sh` in the `app` service (fake docker). Kept interactive-only,
  it's in your session's `.claude/settings.json` and absent from a MIRAI launch's settings (the
  launch test above).
- **T4 Widened agent:** an agent with `Bash` kept as an overlay of Rex moves, `custom add` says it
  widens him, and after approval his launch is refused (`overlay-widened`, naming
  `mirai redteam run`) while no result covers it (37's path).
- **T5 Stages:** `mirai setup` says next is scan; `setup done scan` is refused while the ledger
  isn't committed, then done; after one decision and a stop, `setup status` shows migrate in
  progress with 1 of 12 decided and the ledger row holds the decision and the researched summary;
  `done migrate` lists an undecided item, then a dropped item still there; once all are decided and
  deleted and committed, `setup.json` says migrate done at that commit, and the next `/mirai setup`
  says stage context. A finished project: "setup is done: nothing new or changed since the last
  run"; a skill committed later is the only thing offered, and a scan opens migrate again.
- **T6 Three layers:** AGENTS.md's block has both sentences (decision 6 and 10) and CLAUDE.md
  imports it; with MIRAI's hooks folder installed, a real `git commit` adding
  `.claude/skills/x/SKILL.md` is refused, printing `mirai custom add .claude/skills/x`; adding back
  MIRAI's rendered `/mirai` command passes; committed with `--no-verify`, doctor's new item lists it.
- **T7 Checklist:** eight lines, each with its command, what you see and its default (managed
  settings: off; the token's line names `claude setup-token` and the 30-day warning); doctor's items
  fill the states (ok: done, yellow: check, red: open), the lines doctor can't check take your mark,
  and line 3 (the key) needs both doctor and your mark for the backup. `mirai setup checklist --done 5`
  stores `.mirai/setup/checklist.md` with 8 commands and defaults, and no path from this Mac.
- **T8 Session list:** `setup`, `setup status`, `custom add` and the other setup steps are on
  21f's list, with their argv; a `..` path, an argument a command doesn't take and a summary with a
  line break are refused; `/mirai`'s command file sends `setup` alone to the `mirai-setup` skill;
  the skill and its five guides are in the registry.
- **T9 Review:** `mirai setup review` lists business.md, journeys.md and feature-map.md, each with
  what it is, its state, its full path and its `file://` link, before any approval command;
  business.md's `(open)` line is shown first and its approval command isn't; journeys.md gets its
  command; feature-map.md is asked "anything wrong or missing?". `setup done context` is refused for
  both unapproved files; after `setup defer` of each it's done, `setup status` names them, and
  `setup checklist` shows each as line 9 and 10.
- **Changed tests from earlier units:** `test/doctor/doctor.test.js` 29c (a 22nd item, `custom`).
- **The full suite:** see the last section.

## Probes (real)

Not run yet: each needs your session, your key or Thudos. `test/probes/setup-probes.js` holds the
checks (read-only: no approval, commit or store write); its header has every step. In the
project's checkout, in your terminal:

- **P1 Thudos, end to end** (a clone, never Thudos's main; an integration branch as in the pilot):
  `/mirai setup` in a Claude Code session in the clone, all five stages, stopping once inside a
  stage and resuming in a new session; then
  `node <mirai>/test/probes/setup-probes.js --check p1`.
  What the check can't see and you judge: each researched summary was right; after stage 3 you were
  shown every context file with its path and link, asked each `(open)` line, and asked to review
  the feature map and project files.
- **P2 Pasted text only:** a fresh throwaway project after `mirai init`; `/mirai setup` to stage 3
  with only a pasted description as the source; then
  `node <mirai>/test/probes/setup-probes.js --check p2`.
- **P3 A skill added later:** after P1, in a new session, ask "make a skill that lists the open
  merge requests" (it must use `/mirai custom add`); approve and render it; then
  `node <mirai>/test/probes/setup-probes.js --check p3 --skill <its name>`. Then by hand:
  `cp -R .mirai/custom/project-skills/<name> .claude/skills/handmade`, set its SKILL.md's name to
  `handmade`, `git add .claude/skills/handmade && git commit -m x`: pass when the commit is refused
  and prints `mirai custom add .claude/skills/handmade`; then
  `git restore --staged .claude/skills/handmade && rm -r .claude/skills/handmade`.
- **The red team:** the new case `c-custom-hook` (below) runs with `mirai redteam run`; not run yet.

## Changed from the spec

- **Setup's record is a command, `mirai setup`,** with steps the skill calls through
  `mirai_command`: `status`, `scan`, `decide`, `review`, `defer`, `checklist`, `start`, `done`.
  The spec names `mirai setup status` and `/mirai setup`; the skill needs the rest to keep
  `setup.json`, the ledger and the checklist without one-off scripts (decision 10). Each is on 21f's
  session list (none is a gate: `setup done` only records the commit you made).
- **The ledger keeps every item it has seen,** in `setup.json`, so a moved item stays in the ledger
  with its decision; a scan adds new items and keeps decisions. It reads the commit you're on
  (HEAD), not uncommitted files, as 17a reads committed content.
- **A ledger kind `document`** for BMAD's documents (a PRD, an architecture note in `docs/`), which
  the migrate table treats apart; the spec's list has no kind for them.
- **Project items' kinds and files:** `project-skill` is `project-skills/<name>/SKILL.md` plus its
  other files (the approval binds all of them); `script` is the script file itself
  (`scripts/<name>.<sh|bash|js|mjs|py>`); `hook` is `hooks/<name>.toml` naming a script (no inline
  command: the hook's approval binds the script, and a script bound by an approved hook counts as
  approved with it); `mcp` is `mcp/<name>.toml`. Approval items are typed `<kind>-<name>`
  (`project-skill-deploy`), since a hook and its script share a name.
- **"No hook that runs outside the sandbox"** (decision 3) is checked as: a kept hook runs one
  script the repo holds, by its language's program, and nothing else. A settings hook that does
  anything else (a pipe, an inline command, a script outside the repo) is refused at `custom add`.
- **A hook kept as a check isn't written into `.mirai/config.toml`:** `custom add` prints the
  `[checks]` line for you to add (the config is yours, and MIRAI's TOML writer doesn't edit it).
- **Static checks added beyond the spec's list:** a project skill may pre-approve only `Read`,
  `Grep` and `Glob` (`allowed-tools`) and may not carry its own `hooks`; a script may not name
  `.mirai/`, `.git/`, `~/.config/mirai`, MIRAI's store, `.claude/settings` or `core.hooksPath`;
  an MCP server's `env` and header values are `${VARIABLE}` references (around at most a word such
  as "Bearer ").
- **A lenient frontmatter reader** (`toolFrontmatter`) for Claude Code's skill, agent and command
  files: MIRAI's YAML subset refuses keys like `allowed-tools` and `argument-hint`.
- **Rendering:** hooks are merged into `.claude/settings.json` and servers into `.mcp.json` the way
  13c merges the denies: each listed in the lock as an entry (`hook:<event>:<hash>`,
  `mcp:<name>:<hash>`), the file's other content left alone; `settingsHash` checks them. A project
  skill's rendered files are found for removal by their `from` (`.mirai/custom/project-skills/`).
- **The pre-commit hook runs the installed MIRAI's own copy** (`bin/mirai.js` beside the launcher
  the hooks record), not the integration branch's sealed copy as the pre-push does: the commit
  that installs MIRAI has no sealed copy yet, so the sealed rule refused it (12c T2 and the
  launcher's T3 caught this). It's a reminder, not a gate (`--no-verify` skips it); with no store
  on the machine it only checks, forwarding nothing.
- **The pre-commit hook** is in MIRAI's hooks folder only after `mirai init --refresh` for a folder
  written before this unit (its record gains `pre_commit: true`); doctor's Hook item is yellow until
  then, so existing pushes don't break.
- **Doctor's new item is "Not rendered by MIRAI"** (`custom`, the 22nd). It reads the top-level
  `.claude/`, `.cursor/` and `.codex/` at HEAD; the pre-commit hook also sees nested ones.
- **The checklist file holds the states only,** never doctor's details (they name paths on your
  Mac); `mirai setup checklist` prints them. A context file put off in stage 3 is checklist line 9
  onward. `setup done finish` needs every line done at the last `setup checklist`.
- **The red team gains `c-custom-hook`:** a hook and a server as `mirai render` writes them, with
  the hook file and script in `.mirai/custom/`; neither may run in a launch.

## Questions for Jet

1. **Project skills in MIRAI's runs:** today an approved project skill reaches your sessions only
   (`.claude/skills/`), never an agent's launch. Options: (A) sessions only (built); (B) also into
   the launch bundle, as MIRAI's skills are (more context for Kai, but the project's text in a
   launch). Default: A.
2. **The key's backup line:** MIRAI has no `mirai key backup`; the line says to copy the private
   key file into your password manager and mark it. Options: (A) keep the hand step (built); (B) a
   `mirai key backup` command in a later unit. Default: A.
3. **The council's markers:** without Thudos here, the ledger finds the council by a `council/` or
   `.council/` folder, plus whatever it put in `.claude/`. Options: (A) fix the markers at P1 when
   we see Thudos (default); (B) you name them now.

## For later units

- 44: its human-only status check goes into `mirai hook pre-commit` (`src/cli/commands/hook.js`,
  `preCommit`).
- 74 (`mirai promote`): a project item's files and records are under `.mirai/custom/`, with kinds in
  `CUSTOM_KINDS`.
- P43 (scripts and languages): the script kind takes `sh`, `bash`, `js`, `mjs` and `py`, run by
  `sh`, `bash`, `node` and `python3`.

## What I'm unsure about

- **The pre-commit check reads `git status`** through MIRAI's pinned git, which doesn't keep git's
  `GIT_INDEX_FILE`; with `git commit -a` or `git commit <paths>` (a temporary index) it may miss a
  file added in that same command. `mirai doctor` still lists it.
- **Claude Code's skill and hook formats:** the rendered hook command (`sh
  "$CLAUDE_PROJECT_DIR/…"`) and the project skill folder follow Claude Code's documented forms;
  no real session ran them here (P1 and P3 do).
- **The ledger's kinds for BMAD and the council** come from folder names; a real BMAD tree may have
  folders the guess files as `other`.
- **Interactive hooks run the script in the work tree,** as approved at render time; a branch that
  changes the script changes what your session runs until doctor's Overlays item flags the changed
  approval. Agents can't write `.mirai/`, so only you (or a teammate's merge) can.

## The full suite

768/768 on the Mac (`caffeinate -i node --test --test-timeout=300000 "test/**/*.test.js"`), no
failure and nothing skipped. The run before it, 761/768, failed on pins this unit moves (the
bundle's and the registry's skill lists, the command list, 17a's instruction-file list), on two
words the system-check guard (30a) caught, and on the pre-commit hook refusing the commit that
installs MIRAI (fixed: it runs the installed copy, see "Changed from the spec"). The runner runs
as u39-tests-1.
