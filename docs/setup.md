# Setting a project up: `/mirai setup` (unit 39)

`mirai init`, `mirai detect` and the baseline install MIRAI. `/mirai setup` takes the project from
there to `mirai doctor` all green: it goes through the AI setup the project already has, writes the
context files with you, connects the host and the store, and ends with what only you can do. It
runs in your own Claude Code session (the `mirai-setup` skill), in five stages you can stop and
resume. Each stage ends with a commit you make.

```
/mirai setup                  # in your Claude Code session: goes on from where it stopped
mirai setup status            # in a terminal or a session: where it stands, and what's next
```

## The stages

| Stage | What happens | Done when |
|---|---|---|
| 1. scan | `mirai setup scan` writes the ledger, `.mirai/setup/ledger.md`: every AI item the project has, one row each | you've read the ledger and committed it |
| 2. migrate | each item, one at a time: setup reads it, tells you what it does, recommends where it fits, and asks until it's settled: keep (where) or drop | every item is decided, moved or deleted, approved, rendered and committed |
| 3. context | the five context files (docs/context.md), from your sources and the migrated documents; then the review | each file you approve is approved, or put off for later |
| 4. connect | the host, the document store (docs/stores.md) and CI; Playwright only with your yes | committed |
| 5. finish | the hand checklist | every line is done, `mirai doctor` green |

`mirai setup done <stage>` records a stage as done at the commit you made. It refuses while the
work tree has changes, while an earlier stage isn't done, or while the stage has something left
(it lists each one). `mirai setup start <stage>` marks a stage in progress; the skill runs it as it
starts one. The state is kept in your MIRAI store (`setup.json`, outside the repo).

**Stopping and resuming.** Stop whenever you like. `/mirai setup` resumes at the first stage
that isn't done, with the decisions already made: stage 2 goes on at the next undecided item.

**Running it again.** A second `/mirai setup` does only what's missing or changed: new items,
context files whose sources changed, checklist lines still open. On a finished project with
nothing new, `mirai setup status` says "setup is done: nothing new or changed since the last run".
A skill added later is the only thing it offers then.

## Stage 1: the ledger

`mirai setup scan` reads the commit you're on (never your uncommitted files) and lists:

- `.claude/`: skills, agents, commands, hook scripts, and each hook in `settings.json`;
- `.cursor/`, `.codex/`, `.agents/`, `AGENTS.md`, `CLAUDE.md` (and `CLAUDE.local.md`, or its
  `.example`) and the files they import with `@`;
- BMAD's folders (`bmad/`, `_bmad/`, `.bmad-core/`) and its documents in `docs/` (a PRD, an
  architecture note);
- the council's folders (`council/`, `.council/`) and Markdown files named for it
  (`docs/development-council.md`);
- `.mcp.json`'s servers, and the scripts the items call.

Each row has the item's path, its kind (skill, agent, command, hook, script, instruction, mcp,
document, other), one line on what it does, the commands 17a's patterns flag in it, and your
decision. MIRAI's own rendered files aren't items. Nothing in the ledger is used by a MIRAI run
until it's decided, moved and approved.

## Stage 2: migrate

For each item, setup researches it first: what it does, when it runs, what it reads and writes,
and what it needs (tools, paths, network). Then it tells you, recommends a place, and asks. Your
decision goes in with `mirai setup decide <item> --keep <where>` or `--drop`, with
`--summary <text>` for what the research found.

| Item | Where it goes |
|---|---|
| skill | `.mirai/custom/project-skills/<name>/`, a skill of the project's own |
| agent | `.mirai/custom/agents/<name>.toml` + `.md`, as an overlay of a MIRAI agent (`mirai-developer`, `mirai-reviewer`) whose write scope is a role in `.mirai/custom/roles/`; any other agent is dropped or made into a skill |
| command (`.claude/commands/`) | a project skill, or dropped when a `mirai` command does the same |
| hook | a check under `[checks]`, an interactive-only hook in `.mirai/custom/hooks/`, or both |
| script | `.mirai/custom/scripts/`, called by a check, a hook or a skill; a script outside the agent folders that the project itself uses (a build, CI or Docker script) is kept where it is |
| instruction text | its rules to `conventions-<service>.md`; its facts to `project-<service>.md`; the rest to `agents-local.md` |
| MCP server | `.mirai/custom/mcp/`, for your sessions only; never in MIRAI's runs |
| BMAD documents (PRD, architecture) | sources for stage 3; kept where they are, or moved under the docs root |

Nothing MIRAI didn't render stays under `.claude/`, `.cursor/` or `.codex/`: an item there that
you keep is moved, into `.mirai/custom/` or beside the repo root outside those folders; `mirai
setup decide` refuses "in place" for it. `mirai setup decide` again changes a decision, and the
ledger follows; `mirai setup status` lists a kept item that's no longer anywhere in the repo.

**Nothing kept may break MIRAI.** Every kept item gets the static checks before it moves:

- no name clash with MIRAI's (`mirai`, `mirai-*`, MIRAI's skills and agents, Claude Code's own skills);
- no write to a protected path: for an agent, its custom role's `may_write` stays out of MIRAI's
  protected paths; a script may not name `.mirai/`, `.git/`, your key or MIRAI's store;
- permissions within MIRAI's modes: an agent gets no tool the strict bundle denies; a project skill
  may pre-approve only `Read`, `Grep` and `Glob` (`allowed-tools`);
- no hook that runs anything but one script in `.mirai/custom/scripts/` (a hook with no such form is
  refused);
- an MCP server keeps no secret in the repo: an `env` or header value is a `${VARIABLE}` reference.

An item that fails one isn't moved; setup says why and what would fit (for example, the same agent
with fewer tools). An agent kept with more than its MIRAI definition allows needs the red team
first (docs/overlays.md).

**Originals are removed.** A kept item is moved, a dropped item deleted; there is one copy of
everything. At the end of the stage you approve the list, and one commit holds the moves, the
deletions, the ledger's decisions, each item's approval record
(`.mirai/custom/approvals/<kind>-<name>.json`), the rendered `.claude/` and the lock.

## `mirai custom add <path>`

Moves one item into its place under `.mirai/custom/` and deletes the original. Setup uses it in
stage 2; you use it for anything new after setup (also `/mirai custom add`).

```
mirai custom add .claude/skills/deploy
mirai custom add .claude/commands/release.md                 # becomes a project skill
mirai custom add .claude/agents/security.md --as mirai-reviewer --role security-review
mirai custom add .claude/agents/notes.md --as skill
mirai custom add .claude/hooks/format.sh --hook PostToolUse --matcher "Edit|Write"
mirai custom add ".claude/settings.json#hooks.PostToolUse.0"   # a hook as the ledger names it
mirai custom add scripts/lint-docs.sh --hook PostToolUse --as check --service app
mirai custom add ".mcp.json#docs-search"
```

It ends with the next steps and the item's full path:

1. read it, then in your terminal: `mirai approve --file .mirai/custom/<item>`;
2. `mirai render`, which puts it into your sessions' folders (`.claude/skills/<name>/`, the hooks
   in `.claude/settings.json`, the servers in `.mcp.json`);
3. commit the item, its record, `.claude/` and the lock together.

MIRAI renders only an item whose committed approval record verifies, so `.claude/` changes after
your approval, never at the move. Until you approve it, an item isn't used. `mirai approve` types
a project's item as `<kind>-<name>` (for example `project-skill-deploy`).

The `--as` values: for an agent, `mirai-developer` or `mirai-reviewer` (with `--role`), or `skill`;
for a hook, `interactive` (the default), `check` or `both`.

## Hooks: you choose per hook

- **A check** runs in the sandbox, in your test service, at the build's checks step. `mirai custom
  add … --as check --service <service>` moves the script and prints the line to add under
  `[checks]` in `.mirai/config.toml` (docs/config.md); the config is yours, so MIRAI doesn't edit it.
- **An interactive-only hook** (`.mirai/custom/hooks/<name>.toml`) runs in your own sessions only:
  `mirai render` writes it into `.claude/settings.json`, running the approved script with its
  language's program (`sh`, `bash`, `node`, `python3`). The trust root never reads it, and a MIRAI
  run never fires it (the red team's `c-custom-hook` case checks that).
- **Both:** the check and the hook.

A hook file names its event (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Notification`,
`Stop`, `SubagentStop`, `SessionStart`, `SessionEnd`, `PreCompact`), an optional `matcher`, the
`script` it runs and an optional `timeout`. Its approval binds the script: a changed script needs
a new approval.

## Stage 3: the context files and their review

Setup writes the five context files (docs/context.md) from your links, files and pasted text, and
the documents stage 2 kept. It asks only what those don't answer; a claim no source says is
written `(open)`. The first critical-journeys list is proposed here.

Then `mirai setup review` shows every context file it wrote: what it is, its state, its full path
and its link. Then each file in turn:

- **`business.md`, `journeys.md` and each conventions file:** first their `(open)` lines, each a
  question with options and a guess; your answer goes in as a "you said" source. Then the approval
  command, `mirai approve --file .mirai/context/<file>`.
- **`feature-map.md` and each `project-<service>.md`:** checked against the code, not approved;
  you're still asked "anything wrong or missing?", and your correction goes in before the commit.

The stage isn't done while a file you approve is neither approved nor put off:
`mirai setup defer .mirai/context/<file>` puts it off, and it becomes a checklist line that
`mirai setup status` names.

## Stage 5: the hand checklist

`mirai setup checklist` prints what only you can do, each line with its exact command, what you
should see, and the default for every optional choice. Each line's state comes from `mirai doctor`
where an item checks it; the others you mark with `mirai setup checklist --done <n>`. It's stored,
with the states (never doctor's details), in `.mirai/setup/checklist.md`.

1. `claude setup-token`, then `mirai token set`: MIRAI keeps it in `~/.config/mirai/claude-token`;
   doctor warns 30 days before the year it lasts runs out.
2. The host push credentials (`gh auth login`, or `glab auth login` with your own
   `GLAB_CONFIG_DIR`).
3. Your signing key (`mirai key new`, `mirai key protect`) and its backup. Default: a
   passphrase-protected key and a machine key; the backup isn't optional.
4. `.env.test`, with test-only values.
5. Managed settings. Default: off.
6. The integration branch, pushed.
7. CI required checks.
8. `mirai doctor` until it's green.

## New items after setup: three layers

1. **The rule** in MIRAI's block in `CLAUDE.md` and `AGENTS.md`: "New skills, agents, hooks and
   scripts go in `.mirai/custom/`, added with `mirai custom add <path>`; never directly in
   `.claude/`." With it: "To read or change tickets, documents or merge requests (pull requests on GitHub), use MIRAI's
   commands; don't write one-off scripts or call the tools' APIs directly. A missing command is a
   MIRAI change, or a script added once with `mirai custom add`."
2. **`mirai custom add <path>`**, above.
3. **The safety net:** MIRAI's `pre-commit` hook (`mirai hook pre-commit`, in MIRAI's hooks
   folder beside the pre-push, docs/pre-push.md) refuses a commit that adds a file under `.claude/`,
   `.cursor/` or `.codex/` that the lock doesn't mark `rendered`, and prints
   `mirai custom add <path>` for each. A repo's own pre-commit still runs first. `git commit
   --no-verify` skips it; `mirai doctor` then lists the file under "Not rendered by MIRAI". A
   folder installed before unit 39 gets the hook with `mirai init --refresh` (doctor says so).
