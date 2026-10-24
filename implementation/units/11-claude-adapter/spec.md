---
unit: "11"
name: claude-adapter
status: approved (2026-10-24)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 11; D-12, D-37; R-M16, R2-M12; 03 "Adapter: Claude Code", §8 (folder layout); research/08 §2, §5.1, §5.2
depends_on: ["03b", "07a", "10"]
---

# Unit 11 — The Claude Code adapter

## Why

Claude Code is the only tool until Milestone D (D-32). It doesn't read `AGENTS.md` when a
`CLAUDE.md` exists (research/08 §2.1). It finds skills and agents only in its own folders. So
MIRAI has to render Claude Code's own files from its registry, and list them in the lock as
`rendered` (D-37).

Two rules shape this unit:
- **One source for both modes (R2-M12, D-12):** your interactive `.claude/` files and a
  headless run's plugin folder (unit 19) are rendered from the same **launch bundle**. Your
  custom overrides (unit 37) then reach both, and both have the same content hash for their
  shared part: skills, agents and prompts.
- **The adapter is data (R-M16, D-37):** a profile file per tool, checked against a schema and
  loaded through the registry core. Codex and Cursor (Milestone D) are then another profile plus
  a small renderer, not changes across the CLI.

**Roadmap "done when":**
- Claude Code lists MIRAI's skills and agents;
- the interactive and headless bundles have the same content hash.

## Scope

**In:**
- **The tool profile** `registry/adapters/claude-code.toml` and its schema in the registry core:
  - the instruction file, `CLAUDE.md`, and the line it imports, `@AGENTS.md`;
  - where skills and agents go, `.claude/skills/<name>/SKILL.md` and `.claude/agents/<name>.md`;
  - the plugin layout a headless run uses, `skills/` and `agents/`;
  - the files the adapter will own later but doesn't write yet: `.claude/settings.json`
    (unit 13) and `.mcp.json` (unit 15).
- **Skill definitions in the registry:** `registry/skills/<name>/SKILL.md`, with `name` and
  `description` frontmatter read by 07a's reader. The portable rules (research/08 §5.1):
  - the name is lowercase with hyphens, starts with `mirai-`, matches its folder, and has at
    most 64 characters;
  - the description has at most 1,024 characters;
  - the file has at most 500 lines.
- **Agent files rendered from the existing agent definitions** (03b's `AGENT` schema). The
  schema gains a required `description`, which Claude Code needs to list an agent. The rendered
  frontmatter carries:
  - `name` and `description`;
  - `tools`, from `tools.allowed`;
  - `model`, from the agent's `default_tier`, through the **project** config's `[models]` and
    MIRAI's defaults. Never your personal layer: the file is committed, so it must not change
    from machine to machine.

  The body is the agent's prompt file.
- **The launch bundle** (`src/adapters/bundle.js`): a pure function from the registry plus the
  project config to a list of `{ path, bytes }` in plugin layout, sorted by path, with
  `sharedHash` over it. Two placements of that one list:
  - **interactive:** the files written under `.claude/` in the work tree;
  - **headless:** a plugin folder. Unit 19 puts it in the trust root, unit 12 snapshots it.
    This unit only builds the folder in tests, to prove the hash matches.
- **`CLAUDE.md`:** MIRAI's block (unit 10's markers and rules) holding `@AGENTS.md`. The rest of
  the file stays yours.
- **`mirai render` and `mirai init`** render these files too, and list them in the lock as
  `rendered`, each with its hash and `from` inputs.
- **The skill MIRAI ships now:** decided in open point 1.

**Out:**
- **`.claude/settings.json`** (sandbox, deny rules, `ask` outside the project): unit 13 renders
  it with the strict bundle, because both come from the same rules.
- **`.mcp.json`:** nothing to list until the broker exists (unit 15).
- **Real agents:** Kai (unit 21) and Rex (unit 24). This unit renders whatever the registry
  holds, and tests with fixture definitions.
- **Launching anything:** `mirai agent run` is unit 19. MIRAI never starts `claude` in this unit.
- **Codex and Cursor files:** Milestone D.

## What gets rendered

| File | Mark | Hash in the lock | From |
|---|---|---|---|
| `CLAUDE.md` | `rendered`, `block: mirai` | the block | the profile |
| `.claude/skills/<name>/SKILL.md` (every file of the skill's folder) | `rendered` | the file | the skill's registry files |
| `.claude/agents/<name>.md` | `rendered` | the file | the agent's definition and prompt, `.mirai/config.toml` |

**The rules:**
- **MIRAI writes only `mirai-*` names** under `.claude/skills/` and `.claude/agents/`. Your own
  skills and agents there are never touched. A `mirai-*` file that the lock doesn't list is
  refused (`conflict`), not overwritten.
- **A rendered file no longer in the bundle is removed by `mirai render`** (for example, a skill
  that was renamed), and so is its lock entry. A file edited by hand is rendered again, with a
  warning, as for the `AGENTS.md` block.
- **`CLAUDE.md` as a symbolic link to `AGENTS.md`** (the setup unit 10's hint suggests): it's
  left alone, since Claude Code then reads `AGENTS.md`, which already holds the block. It gets no
  lock entry. Any other symbolic link on the way is refused, as in unit 10:
  - `CLAUDE.md` linking anywhere else;
  - a linked `.claude/`, `.claude/skills/` or `.claude/agents/`.
- **An `@AGENTS.md` line already in your part of `CLAUDE.md`** gets a warning, since it would be
  imported twice. MIRAI doesn't remove it: it's your text.

## The shared hash

`sharedHash` = SHA-256 over `"<sha256> <path>\n"` for each bundle file, in path order, with
plugin-layout paths (`skills/<name>/SKILL.md`, `agents/<name>.md`). The interactive placement
maps `.claude/skills/…` back to `skills/…`, so both placements give the same hash. The lock
records it as `bundle_sha256` on the adapter's entries, and unit 12's snapshot and unit 19's
launch check compare against it. Settings and MCP config are not part of the shared hash: their
permission modes differ between the two modes by design (D-37).

## Files

```
registry/adapters/claude-code.toml   # the tool profile
registry/skills/<name>/SKILL.md      # (open point 1)
src/config/registry.js               # + ADAPTER and SKILL kinds; AGENT gains `description`
src/adapters/bundle.js               # the launch bundle and sharedHash
src/adapters/claude-code.js          # placements: .claude/ files, CLAUDE.md block, plugin folder
src/install/render.js                # renders the adapter's files too; removes stale ones
src/install/lock.js                  # `bundle_sha256` on entries; removing entries
test/adapters/claude-code.test.js
test/fixtures/registry-agents/       # fixture agents and skills for the tests
```

## Tests

| # | Test |
|---|---|
| T1 | **The bundle is deterministic:** the same registry and config give the same bytes and `sharedHash`. A changed prompt, description or tier mapping changes it; a changed setting outside the bundle doesn't |
| T2 | **Interactive and headless bundles have the same content hash:** render `.claude/` in a repo, build the plugin folder from the same bundle, and compute the hash of each from the files on disk; they're equal |
| T3 | **`init` on a fresh repo:** `CLAUDE.md` with the block (`@AGENTS.md`), the skill, and fixture agents in `.claude/`, all `rendered` in the lock with hash and `from`. `checkLock` is clean, and reports a hand-edited skill |
| T4 | **Yours stays yours:** an existing `CLAUDE.md` keeps every byte outside the block; your own `.claude/skills/x` and `.claude/agents/y` are untouched; an unlisted `mirai-*` file is refused; a `CLAUDE.md` linked to `AGENTS.md` is left alone; other links are refused; a duplicate `@AGENTS.md` warns |
| T5 | **`mirai render`:** a changed `[models]` re-renders the agent files; a definition removed from the registry removes its file and lock entry; a hand-edited file is rendered again with a warning; running it twice changes nothing |
| T6 | **The definitions are checked:** a bad skill name, a name that doesn't match its folder, a description over 1,024 characters, a skill over 500 lines, an agent without `description`, and a profile with an unknown key are each refused with file, line and column |
| T7 | **The real skill passes its own checks,** and its frontmatter uses only the portable fields (`name`, `description`) |
| T8 | **On the sample app** (recorded in `test-results.md`, not `npm test`): the install is refreshed (open point 2), then **you** open Claude Code there and check that the skill list shows `mirai-docs` and that `/memory` shows AGENTS.md imported through CLAUDE.md. Opening Claude Code is yours to do, since it uses your subscription. (The `/agents` check moved to unit 21: MIRAI ships no agent until then.) |
| T9 | **`init --refresh`** (added with open point 2): refused when not installed, when a framework file was changed, and for an older MIRAI; keeps your config, `agents-local.md`, your part of `AGENTS.md` and the store; a failure partway leaves everything as it was |
| T10 | **The review's edge cases:** case-insensitive names, links on `.claude` and `.claude/agents` and on a listed file before its removal, `.claude/skills` as a file, a dangling `CLAUDE.md` → `AGENTS.md` link, render-side lock removals, a hand-edited file that's removed, a write failing partway through `render`, a CRLF checkout, a newer lock, an install without the adapter |

## Open points for you

1. **Which skill ships now.** Real agents come in units 21 and 24, so with no skill the roadmap's
   "Claude Code lists MIRAI's skills" can't be checked before unit 21. Two options:
   - **(a)** one small real skill, `mirai-docs`: how MIRAI documents work in this repo. It
     covers where the templates are, that a ticket has no status field, and that the document
     must pass `mirai lint`, which **you** run, since agents never call `mirai`. It's useful
     right away for writing the sample app's first story ticket together, the one that exercises
     `mirai approve`. It isn't in 03's skill catalogue, so I'd add it there as an A-milestone
     skill.
   - **(b)** no real skill, only fixtures in the tests, with the listing check moved to unit 21.

   I recommend (a).
2. **How an installed repo gets this unit's files.** The sample app's framework copy is 0.1.0
   from unit 10, and `mirai render` renders from that copy, so it can't render files the copy
   doesn't know. `mirai update` is Milestone D. I recommend a small **`mirai init --refresh`**:
   - it replaces the framework copy with the running MIRAI's;
   - it refuses if `checkLock` shows any framework file was changed;
   - it keeps your project files, renders everything again and rewrites the lock;
   - no 3-way merge (that's `update`).

   Otherwise, each unit's dogfooding means deleting the lock and the copy by hand and running
   `init` again.
3. **Agent files in `.claude/agents/`.** D-12 says agent runs go through `mirai agent run`, not
   Claude Code's own subagents. A rendered `.claude/agents/mirai-reviewer.md` would still let
   your session start Rex natively, without the launcher's logging and caps. Two options:
   - **(a)** render them as 03 says, and have the description tell Claude to use them only
     through the broker's `launch` (unit 15). Until then, a native start is your choice in your
     own session, and is unlogged;
   - **(b)** don't render agents interactively at all. Interactive sessions get only skills, and
     agents reach Claude Code only in the headless plugin folder.

   I recommend (a): it matches 03 and the roadmap's listing check, and the unlogged path exists
   only in your own session. Unit 18's red-team covers the headless side.
4. **The model in a committed agent file** comes from the project config and MIRAI's defaults
   only, never your personal `[models]`, so the file is the same on every machine. Your personal
   choice still applies to headless runs, through `mirai agent run` (unit 19). I recommend it.

## Changes after testing and review

Listed for your check before "UNIT APPROVED".

**Your decisions after the review:**
1. **The later docs-website skill is renamed `mirai-docs-site`** in 03's catalogue, so the skill we
   ship keeps the name `mirai-docs`. 03 also says how it relates to `mirai-write` and
   `mirai-tickets` (both B): they point to it instead of repeating it.
2. **The lock records the bundle's hash once,** as a top-level `bundles = { "claude-code":
   "<hash>" }`, not as `bundle_sha256` on every entry (this replaces "The shared hash" above). Units
   12, 19 and 29 compare against that one value, and two branches that change different skills
   don't conflict on every lock entry.
3. **Agent definitions use Claude Code's tool names** (`Read`, `Grep`, `Edit`, `Bash`,
   `mcp__<server>__<tool>`); the Codex and Cursor renderers translate or drop them. Recorded in
   D-37.
4. **`mirai init --refresh` stays when `mirai update` comes,** as update's fast case (no local
   edits, nothing to merge). Recorded in the roadmap, unit 70.

**Fixed from the review:**
5. **An agent must list its tools,** never none: an agent file without `tools:` gets every tool
   in Claude Code. A read-only agent can't list `Write`, `Edit`, `MultiEdit`, `NotebookEdit` or
   `Bash`. The tool name pattern allows `-` (MCP server names).
6. **Names are compared ignoring case,** since macOS disks are case-insensitive: your
   `.claude/skills/MIRAI-DOCS/` was silently overwritten by `mirai-docs`; now it's refused
   (`conflict`).
7. **A file being removed is checked like one being written:** no link on the way, a regular
   file. Before, an undo could turn a link into a regular file holding content from outside the
   repo. A removed file that was edited by hand gets a warning.
8. **Undo steps are recorded after each write succeeds,** so a refused write no longer reports a
   false "undoing it failed"; the message names the path.
9. **Rendered files are hashed with CRLF read as LF,** so a teammate's checkout with
   `core.autocrlf` isn't reported as edited. MIRAI writes LF.
10. **The 500-line limit counts right** (exactly 500 lines passes). Skill file names are plain
    (letters, digits, `.`, `_`, `-`), hidden files such as `.DS_Store` are skipped, and
    descriptions allow only printable characters. An agent's description is at most 950
    characters, so with MIRAI's launcher note it stays within 1,024.
11. **The agent file is rendered by the Claude Code adapter,** not the bundle, so the bundle stays
    tool-neutral; a model name that isn't plain is refused instead of written.
12. **A refresh never goes back to an older MIRAI** (`downgrade`). The CLI says whether a
    same-version refresh changed the copy.
13. **A lock this MIRAI can't read, written by a newer MIRAI** (by `mirai_version`), says so
    (`lock-newer`): fields are only ever added within a lock schema version.
14. **Hints:** `mirai render` on an install older than this unit says "run: mirai init
    --refresh"; on a changed framework copy it says "git checkout -- .mirai" (it pointed to the
    refresh, which refuses that case).
15. **Smaller ones:** a dangling `CLAUDE.md` → `AGENTS.md` link is accepted on a first install;
    `.claude/skills` as a file gives a plain error; the profile can't point at `AGENTS.md`,
    `.mirai/` or `.git/`; empty folders are pruned only up to the tool's own folders;
    `checkLock` names `CLAUDE.md` when its markers are broken.
16. **The `mirai-docs` text** now matches the lint: the template lines, example id and `verify`
    sentence are what's flagged; optional sections keep `Not applicable — <reason>`; the `id` is
    the owner's tracker key; `repo` names a `[[repos]]` entry. "Quote dates" is gone (tickets
    have no date field).
17. **T8 checks the skill and the import, not `/agents`:** MIRAI ships no agent until unit 21,
    where that check moves. Tests T9 (`--refresh`) and T10 (edge cases) are added to the table.

**Noted for later units:**
- **Units 13, 18, 19 (D-37, "committed rendered files are never inputs"):** the work-tree
  `.claude/` copies have the same names as the trust-root plugin's, and Claude Code ranks project
  agents above plugin ones. A headless run must not load project skills or agents: whether
  `--restricted` or `--setting-sources` does that is UNVERIFIED. Unit 19 should pass agents with
  `--agents` (above project in precedence), and unit 18 adds a canary: a branch edits
  `.claude/skills/<skill>/SKILL.md`, and the headless run must see only the trust-root version.
- **Unit 13:** in the interactive `settings.json`, block native starts of `mirai-*` agents (a
  PreToolUse hook on the Task/Agent tool, or a deny rule if its syntax is verified), turning the
  description note into enforcement.
- **Unit 15:** `AGENT_NOTE` points at the broker's `launch`, and `mirai-docs` uses the broker's
  `lint` verb instead of asking you to run `mirai lint`.
- **Unit 19:** the plugin's agent files keep the project-config model; your personal model goes
  through `--model` or `--agents`, or the hashes stop matching. File modes aren't part of the
  bundle (a future skill with scripts would lose its executable bit). Whether a plugin folder
  without `.claude-plugin/plugin.json` loads, and how plugin skills are named, is UNVERIFIED.
- **Unit 29:** an agent's `from` hashes the whole config file, so any config edit marks its inputs
  changed, and MIRAI's default models come from the binary, not the copy. Doctor should compare
  the resolved `[models]`, not only the `from` hashes.
- **Milestone D (Codex, Cursor):** the profile will need an optional `instructions` (they read
  AGENTS.md natively), the agent file format, per-tool models, owning one section of a file
  (`.codex/config.toml`), and Cursor's double-loading of `.claude/skills` and `.claude/agents`.
- **UNVERIFIED Claude Code format facts** for T8 and unit 21: `tools` as a comma-separated string,
  and a full model id in an agent's `model:`.
- **Not done:** a duplicate `@AGENTS.md` inside a code fence still counts toward the warning, and
  description length counts UTF-16 units. Both are harmless.
