---
unit: "39"
name: setup
status: approved (Jet, 2026-11-20: "approve 39"; decisions 1–8 from his interview the same day; built only after 38 is finished, and re-checked against 34b–38 first)
roadmap: design/07-implementation-roadmap.md, row 39; design/01 §"Setup" (steps 1–6, the ledger); D-37 (marks: framework, rendered, project); D-41, D-43; 08 Q3, Q4, Q6; PM3-10; units 17a (facts, instruction files), 17b (the baseline), 26a (the hooks folder), 35, 36, 37, 38
depends_on: ["17a", "17b", "26a", "35", "36", "37", "38"]
---

# Unit 39: The `mirai-setup` skill

## Why

Today a project gets MIRAI through `mirai init`, `mirai detect` and the baseline. After that:
- the context files from 36 are still empty;
- the project's existing AI setup (Thudos: the council and BMAD) sits beside MIRAI's;
- what you have to do by hand is spread over several docs.

An agent then works from guesses, and old skills or hooks can do things MIRAI never checked.

This unit adds `/mirai setup`, a guided setup in your Claude Code session. It takes a project
from "MIRAI installed" to "`mirai doctor` all green", in stages you can stop and resume.

**Why now:** the first real setup (Thudos) is on the path to v1.0, and it needs 35's interview,
36's context files, 37's custom items and 38's store, all built just before it.

## Decisions (Jet, 2026-11-20, interview)

1. **Migration is in the MVP** (Q1, "A"). Setup reads the existing AI setup and goes through it
   **item by item**: skills, agents, scripts, hooks, instruction files, commands, MCP servers.
   For each item it proposes where it fits in MIRAI (a skill goes to `.mirai/custom/skills/`),
   and you decide whether to keep it.
2. **Research, then a talk** (Q2, Jet: "setup researches it and it has a chat with questions to
   the user"). For each item, setup first reads it and works out what it does and when it runs.
   Then it tells you, recommends a place, and asks until the place is clear.
3. **Nothing kept may break MIRAI** (Q2, Q5 "C"). Every kept item gets the static checks: no name
   clash with MIRAI's, no write to a protected path, permissions within MIRAI's modes, and no hook
   that runs outside the sandbox. An agent kept with more permissions than its MIRAI role needs
   the red team first (37's rule). Plain skills and text don't.
4. **Hooks: you choose per hook** (Q2, "C"). A kept hook becomes a MIRAI check (`[[checks]]`, run
   in the sandbox at its step), an interactive-only hook (your sessions only, never MIRAI's runs),
   or both. MIRAI never runs a project hook outside the sandbox.
5. **Originals are removed** (Q3, "B"). A kept item is moved, and its original is deleted in the
   same stage commit, after your approval. A dropped item is deleted too. There is one copy of
   everything.
6. **New items after setup are caught in three layers** (Q4, Jet's idea plus "yes"):
   - **the rule** in MIRAI's block in CLAUDE.md and AGENTS.md: "New skills, agents, hooks and
     scripts go in `.mirai/custom/`, added with `mirai custom add <path>`; never directly in
     `.claude/`.";
   - **`mirai custom add <path>`** moves an item into `.mirai/custom/`, removes the original, and
     asks for approval;
   - **the safety net:** a `pre-commit` hook refuses a commit that adds an item MIRAI didn't
     render to `.claude/` (or another agent folder), printing the `mirai custom add` command.
     `mirai doctor` reports anything that got past it.
   Until you approve it, a new item isn't used (37).
7. **Stages with a commit each** (Q6, "B"). The order is scan, migrate, context, connect, finish.
   `/mirai setup` resumes at the first stage not done. Migrating comes before context, so
   migrated docs (BMAD's PRDs, architecture notes) can be sources for `business.md`.
8. **Running it again** (restate, "yes"). A second `/mirai setup` does only what's missing or
   changed: new items, context files whose sources changed, checklist lines still open.
9. **You're told about every context file it writes, and asked to review it** (Jet, 2026-11-21:
   "Make sure that when these context files are generated the user is informed and sees the
   links and is asked to review them"). When stage 3 writes or rewrites a context file, setup
   stops and shows you a list with each file, what it is, its state, and its full path and link
   (38). It then asks you to review each file, one at a time:
   - **`business.md`, `journeys.md` and each conventions file:** first the `(open)` lines (36,
     decision 8), each asked as a question with options and a guess, and your answer written in
     as a "you said" source. Then the approval command. The stage isn't done until each one is
     approved, or you choose to come back to it later; then it stays on the checklist and
     `/mirai setup status` names it.
   - **`feature-map.md` and each `project-<service>.md`:** they're checked against the code, not
     approved, but you're still shown them and asked "anything wrong or missing?". Your
     correction is written in before the stage commit.
   A second run (decision 8) does the same for each file it rewrites, and says which lines changed.

## Scope

**In**

1. **The skill: `registry/skills/mirai-setup/`** (`SKILL.md`, one guide per stage,
   `CREDITS.md` if it takes from another skill). Claude Code only. It follows `mirai-interview`
   (35) for questions (one at a time, each with a guess) and `mirai-write`'s session guide (34)
   for steps you do by hand.
2. **The state: `<store>/setup.json`** (outside the repo). It records each stage's state
   (`not started`, `in progress`, `done` with its commit) and, in migrate, each item's decision.
   `mirai setup status` prints it, and `/mirai setup` resumes from it.
3. **Stage 1, scan:** `mirai detect`'s facts (17a) and the baseline's state (17b), plus **the
   ledger** of every AI item. The ledger is `.mirai/setup/ledger.md`, committed. It has one row
   per item: path, kind (skill, agent, command, hook, script, instruction file, MCP server,
   other), what it does in one line, its flagged commands (17a's patterns), and its decision
   (empty until migrate). It finds:
   - `.claude/` (skills, agents, commands, hooks and settings), `.cursor/`, `.codex/`,
     `AGENTS.md`, `CLAUDE.md` and their imports;
   - BMAD's folders (`bmad/`, `_bmad/`, `.bmad-core/`);
   - the council's files (by its own markers, found on Thudos);
   - `.mcp.json`, and scripts that the items call.
   
   Nothing in the ledger is loaded by a MIRAI run until it's decided (17a's rule, unchanged).
4. **Stage 2, migrate, one item at a time:**
   - **research:** read the item and what it calls; write what it does, when it runs, what it
     reads and writes, and what it needs (tools, paths, network);
   - **talk:** show that, recommend where it fits (table below) and why, and ask until it's
     settled: keep (where) or drop;
   - **check** (decision 3): a kept item that fails a static check isn't moved; setup says why
     and what would fit (for example, the same agent with fewer tools);
   - **move:** `mirai custom add` does it (Scope 6). For a hook, your choice from decision 4;
   - **commit** at the end of the stage: the moves, the deletions and the ledger's decisions,
     after you approve the list. Custom items still need their own approval (37) before use.

   | Item | Where it goes |
   |---|---|
   | skill | `.mirai/custom/skills/<name>/` |
   | agent | `.mirai/custom/agents/<name>.toml` + `.md`, as an overlay of the closest MIRAI role, or a new agent under a role |
   | command (`.claude/commands/`) | a custom skill, or dropped when a `mirai` command does the same |
   | hook | a check in `[[checks]]`, an interactive-only hook in `.mirai/custom/hooks/`, or both |
   | script | `.mirai/custom/scripts/`, called by a check or a skill |
   | instruction text | its rules to `conventions-<service>.md`; its facts to `project-<service>.md`; the rest to `agents-local.md` |
   | MCP server | `.mirai/custom/mcp/` for interactive sessions; never in MIRAI's runs (unchanged) |
   | BMAD documents (PRD, architecture) | sources for stage 3; kept where they are, or moved under the docs root |

5. **Stage 3, context:** the five files from 36, written by the skill from your sources
   (links, files, pasted text) and the migrated documents. It asks only what those don't answer.
   Each claim carries its source ID (36). What no source says is written `(open)` and asked
   (36, decision 8). The first critical-journeys list is proposed here (row 39, Q6). At the end
   of the stage, the review of decision 9: the list of files with their paths and links, then
   each file in turn, `(open)` lines first. You approve `business.md`, `journeys.md` and each
   conventions file.
6. **`mirai custom add <path>`** (also used after setup; also `/mirai custom add`): it detects
   the item's kind, copies it to its place under `.mirai/custom/`, deletes the original, renders
   `.claude/` again, and ends with the approval command and the item's full path. It refuses an
   item that fails the static checks, naming the check.
7. **Interactive-only hooks:** `.mirai/custom/hooks/` is rendered into `.claude/settings.json` for
   your sessions only. The trust root never reads it for a MIRAI run. The red team gains a case:
   a custom interactive hook doesn't fire in a MIRAI run.
8. **The rule sentence** (decision 6) goes into the framework block that MIRAI renders into
   `CLAUDE.md` and `AGENTS.md` (`src/install/agents-block.js`).
9. **The `pre-commit` hook:** MIRAI's hooks folder (26a) gains a `pre-commit` script. It refuses
   a commit that adds a file under `.claude/`, `.cursor/` or `.codex/` that the lock doesn't mark
   `rendered`, and prints `mirai custom add <path>` for each one. A forward to the repo's own
   pre-commit is kept, as 26a does today. `mirai doctor` lists the same files as "not
   rendered by MIRAI".
10. **Stage 4, connect:** the host (27a/27b), the store (38), and CI (which checks are required).
    Playwright is offered only with your yes: a minimal container setup.
11. **Stage 5, finish:** the hand checklist (row 39, PM3-10). Each line has the exact command,
    what you should see, and the default for every optional choice:
    1. `claude setup-token`, where MIRAI stores it, and `doctor`'s warning 30 days before it
       expires;
    2. the host push credentials;
    3. your signing key and its backup;
    4. `.env.test`;
    5. managed settings (default: off);
    6. the integration branch;
    7. CI required checks;
    8. `mirai doctor` until it's green.
    
    It's printed and stored in `.mirai/setup/checklist.md`, with each line's state.
12. **`mirai setup status`** and **`/mirai setup`** go on 21f's session list. Stage commits
    and approvals stay with you (the gates).
13. **Docs:** `docs/setup.md` (new): the stages, migration with the table, hooks, the three
    layers for new items, resuming, running it again. `docs/config.md` (34b) gains any new key.

**Out**

- Cursor and Codex setup (rows 71/73). Their folders are scanned and migrated, but the skill runs
  in Claude Code only.
- Writing the first E2E tests (Ivy, 51). Setup proposes the journeys list only.
- Migrating from places outside the repo (a Notion workspace, a wiki). Their pages can still be
  sources for `business.md`.
- `mirai promote` (74): moving a custom item back into MIRAI.

## Tests

- **T1 The ledger:** a fixture project with a skill, an agent, a command, a hook, a script, a
  BMAD folder, an `.mcp.json` and a `CLAUDE.md` with an import lists each one with its kind and its
  flagged commands. Nothing in it is loaded by a launch (fake launcher).
- **T2 `mirai custom add`:** a skill, an agent, a script and a hook each land in their place,
  with the original deleted and `.claude/` rendered again. A skill named `mirai-write` (clash),
  an agent writing to a protected path, and a hook with no sandbox-safe form are each refused,
  naming the check.
- **T3 Hooks:** a hook kept as a check runs in the sandbox at its step (fake test run). A hook
  kept as interactive-only is in your session's settings and absent from a MIRAI launch's.
- **T4 Widened agent:** a kept agent with `Bash` beyond its role is moved but refused at launch
  until a red-team result covers it (37's path).
- **T5 Stages:** after stage 2 ends, `setup.json` says "migrate done" with its commit, and a new
  `/mirai setup` starts stage 3. Stopping inside a stage resumes it with the decisions already
  made. A second full run on a finished fixture does nothing and says so. A new skill added
  later is the only thing it offers.
- **T6 The three layers:** the framework block in `CLAUDE.md` and `AGENTS.md` has the rule
  sentence. The `pre-commit` hook refuses a commit adding `.claude/skills/x/SKILL.md` and prints
  `mirai custom add .claude/skills/x`. A rendered file passes. `doctor` lists an unrendered item
  committed with `--no-verify`.
- **T7 The checklist:** every line has its command, what you should see, and its default;
  `doctor`'s state fills each line's state.
- **T8 Session list:** `/mirai setup`, `/mirai setup status` and `/mirai custom add` exist.
- **T9 The review** (decision 9): after a fake stage 3 writes the files, setup's output lists all
  of them with their state, full path and link, before any approval command. A file with an
  `(open)` line asks it before showing its approval command. Stage 3 isn't marked done while an
  approved-kind file is unapproved and not deferred; a deferred one is a checklist line.

## Probes (real)

- **P1 Thudos, end to end** (a clone, never Thudos's `main`; an integration branch as in the
  pilot). You run `/mirai setup` in your own session. **Pass when:**
  - every council and BMAD item gets a ledger row, a researched summary and your decision;
  - the kept ones work from `.mirai/custom/` and nothing is left in the old places;
  - `business.md`, `journeys.md` and the conventions are sourced and you approve them;
  - after stage 3 you were shown every context file with its path and link, asked each `(open)`
    line, and asked to review each file, including the feature map and project files;
  - `doctor` is green;
  - you stop once mid-stage and it resumes where you left it.
- **P2 Pasted text only** (row 39's done-when): a fresh project with no links, only a pasted
  description. **Pass when** `business.md` comes out with every claim sourced to "you said" or the
  pasted text, and lints clean.
- **P3 A skill added later:** after P1, an agent in your session is asked to "make a skill for
  X". **Pass when** it uses `mirai custom add` (the rule worked); and a skill copied in by hand
  is refused at commit with the command printed.

## Done when

- T1–T9 pass, and the full suite passes through the build runner and CI (34b's docs check
  included).
- P1–P3 pass.

## Checked against the queued units

- **36:** stage 3 writes 36's files with 36's lint. 36's decision 8 (2026-11-21) added `(open)`
  for what no source says, refused at approval: setup asks each one (decision 9). No change to 36.
- **37:** custom items, their approval and widening are 37's. 39 adds the interactive-only hooks
  folder and the `mirai custom add` command on top. 37's spec doesn't name `.mirai/custom/hooks/`
  or `scripts/`, so 39 adds them to the overlay schema.
- **38:** stage 4 sets the store. No change to 38.
- **44:** its `pre-commit` hook (the human-only status check) goes into the same script this unit
  creates.
- **34b:** `docs/setup.md`, the new commands and any new key must pass the docs check.
