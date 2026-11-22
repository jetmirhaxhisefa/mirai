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
- **T1/T5 Thudos's markers and the project's own scripts:** the fixture plus
  `docs/development-council.md` and `CLAUDE.local.md.example` (as on Thudos's main): the scan lists
  them (`other`, `instruction`); a `.txt` with "council" in its name isn't an item. `scripts/release.sh`
  (called by the skill, outside the agent folders) kept "in place (the project's own)" doesn't hold
  up `setup done migrate`, while a dropped agent still there does; with the agent-folder items gone
  and a kept instruction file still naming the script, migrate is done and the script is still there.
  Checked by hand on a local clone of Thudos's main (224afc4, a temp HOME, nothing pushed): the scan
  lists 54 items, every council file of the pilot's decision 3 among them (all of `.claude/`, the
  three `CLAUDE.md`, `CLAUDE.local.md.example`, `docs/development-council.md`, `scripts/set-risk.sh`,
  `scripts/token-savings.sh`), plus `scripts/quality-gate*.sh` and `docker/php/entrypoint.sh` as
  scripts the items call.
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
  The hook runs the launcher (sealed copy): with the work tree's `.mirai/framework` check edited to
  pass everything, the commit is still refused, never skipped. A new repo's install commit (MIRAI
  not on main yet) goes through with `mirai pre-commit: skipped: main (…) has no MIRAI copy MIRAI
  can run; MIRAI isn't committed on the integration branch yet …`, and the next commit adding a
  skill by hand is refused by the sealed copy. With a copy on main from before this unit (no
  pre-commit check in it), the next commit (a refresh's) goes through with `mirai pre-commit:
  skipped: the copy committed at <commit> has no pre-commit check; …`.
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
checks (read-only: no approval, commit or store write). The steps below are the ones to follow.

**Why a local mirror for P1:** MIRAI keeps one store per repo on a machine, named from the
remote and the first commits. A second clone of Thudos from GitHub gets the pilot's store id, and
`mirai init` refuses it ("a store already exists"). A clone of a local bare mirror has its own
remote, so its own store; nothing is pushed to GitHub, and `~/Projects/thudos` and `mirai/pilot`
are never touched.

### Findings on the probes

- **P1, step 4 (2026-11-22): `mirai init` in the mirror's clone was refused** ("this checkout has
  a MIRAI store under another id (platform-2a0b292426c1, now thudos-setup-ccf02c7bf60a)"). Cause:
  `sameRepoAt` (`src/store/home.js`) checked the old checkout (`~/Projects/thudos`, live, on
  `mirai/pilot`) for the new checkout's integration branch (`mirai/setup`), found no such branch,
  and took the live pilot checkout for a gone one. Fixed: it checks the old store's own
  integration branch (`meta.integration_branch`), in both places it's used (the related-store and
  the second-checkout checks). Test: `test/store/store.test.js` "39 P1 finding": a clone on
  another integration branch with the original live gets its own store; with the original
  deleted, it's refused (`identity-changed`); store 43/43, and the setup, launch, install and
  doctor files pass. The scratch scan before P1 used a temp HOME, so it never met the pilot's store.

- **F2, P1 step 4 (cosmetic): `mirai init`'s summary named only the pre-push**, though the
  pre-commit was installed and ran at the install commit. **Fixed:** `setUpHooks` returns MIRAI's
  hooks in the folder and the line reads `hooks: pre-push, pre-commit in … (core.hooksPath)`
  (`src/cli/commands/init.js`; test "39 F2").
- **F3, P1 step 8: `mirai session-server install` registered in the default Claude Code config**
  (`~/.claude.json`, Jet's work account) and didn't say which; Jet runs MIRAI under
  `CLAUDE_CONFIG_DIR=~/.claude-private`, so `/mirai setup` there had no `mcp__mirai__` tools.
  **Fixed:** `install`, `remove` and `status` name the config (`CLAUDE_CONFIG_DIR=<dir>`, or "the
  default config (~/.claude.json; CLAUDE_CONFIG_DIR isn't set)") and how to register for another;
  doctor's Session server item names the config it checked; `/mirai`'s command file and the setup
  skill's step 0 stop with "MIRAI's tools aren't connected in this session … `CLAUDE_CONFIG_DIR=<its
  folder> mirai session-server install` …" when the tools are missing; `docs/agent-safety.md`
  says a registration moves with `remove` (old config's env), then `install` (new one's), since
  both share `.claude/settings.local.json` (test: 15b T6 in `test/mcp/session.test.js`).
- **F4, P1 stage 5 (blocking): `mirai setup done finish` could never succeed.** Line 8 ("mirai
  doctor until it's green") took every doctor item, and the Merge gate is always yellow
  (local-only) until unit 54; finish also read the states the last `setup checklist` stored. On
  Thudos: doctor 21 ok, 1 yellow (Merge gate), 0 red, and line 8 stayed `check`. The tests used a
  fake doctor without the Merge gate. **Fixed, with a named rule:** a doctor item can be a yellow
  *expected until a named later unit* (`expected_until`; today only the Merge gate, unit 54).
  Line 8 is done when doctor has no red and no other yellow, and says which expected ones remain;
  `setup done finish` runs doctor then and computes every line (not the stored states); P1's probe
  check uses the same rule (`toFix`, `expectedNow` in `src/setup/checklist.js`). Test "39 F4" uses
  doctor's real items on the fixture (its real Merge gate item) made ok elsewhere, as on Thudos.
- **F5, P1 stage 2 to 5: "keep in place" for a file under `.claude/` that finish then refused.**
  `.claude/settings.local.json.example` (kind `other`) was decided "keep: in place (the project's
  own)"; doctor's "Not rendered by MIRAI" flagged it, `custom add` refused it (not a custom kind),
  so Jet deleted it (39fffdc) and the ledger still said "keep". **Decision (Jet, 2026-11-22: F5
  option 1):** everything under `.claude/`, `.cursor/` and `.codex/` is MIRAI's rendered output
  (P3's premise). **Fixed:** `setup decide --keep` refuses "in place" (or any place still under
  those folders) for an item there that MIRAI didn't render, naming the ways out (`custom add`,
  `git mv` beside the root then `--keep <that path>`, or `--drop`); MIRAI's own settings file,
  rendered with the project's content, may stay. A decision made again updates the ledger, and a
  kept item that's gone from the repo with its place is a "stale decision" in `setup status` and a
  gap for `setup done migrate` and `finish`. The migrate guide and `docs/setup.md` say so. Test "39
  F5".
- **Known flake, u39-tests-4 (at `d6afc48`): `test/launch/strict.test.js` T5/T6** failed once with
  "a failed launch left its scratch folder": it scanned all of `/private/tmp/mirai-*`, so another
  run's folder read as a leak (u39-tests-5 at the same commit passed 771/771). **Fixed:** a refused
  launch's error names the scratch folder it made (`scratchDir`, not enumerable), and the test
  checks only that one is gone.
- **F6, P1's red team in `thudos-setup` (copy from `10c615e`, 2026-11-22): RED on `pr-test-run`
  alone** (0/3: "3 guards held; … c1-exec failed; … c21-nested-swap failed"). It ran while the
  runner's `u39-baseline-3` ran the sample app's tests on the same Docker (load 16.8). The probe
  (`src/redteam/probes/test-run.js`) counts as a scenario's leftovers every container, network and
  volume labelled `mirai.repo`, from any repo, so the baseline's own test containers failed each
  scenario. Not a gap in the guards, and not Thudos-specific: the probe runs its own fixture, never
  Thudos's compose. The sample app's runs passed it (u39-redteam-1/-2) because nothing else ran.
  **Fixed:** leftovers are the fixture's own repo id only (`leftoverFilter`, `label=mirai.repo=<id>`);
  a test pins it. `h-timeout-link` and `l-cd` failed as always: informational (the known limits
  accepted 2026-11-07), never part of the state, in every repo; `adv-linger` inconclusive 2/3 (timed
  out under the load) and `w-claude-config` inconclusive runs (3/3 in the end) don't make it red.
  **Confirmed (Jet, 2026-11-22):** the same red team in `thudos-setup`, on the same copy (from
  `10c615e`), run again on a quiet Mac with nothing else on Docker: **GREEN** (333 runs, 17 min
  35 s). The earlier red was F6.
- **P1, finish (Jet, 2026-11-22, copy from `10c615e`):** `CLAUDE_CONFIG_DIR=~/.claude-private mirai
  setup checklist` showed all 8 lines done (F4's fix works); after committing the checklist
  (3b877ee), `setup done finish` refused with 7 items: F7, F8 and F9 below. Not fixed yet: decided
  after P1.
- **F7: doctor and the checklist check only the Claude Code config of the environment they run
  in.** Jet's default `~/.claude.json` still had a registration from `c64d307`. In stage 5 the
  setup session told him to run `mirai session-server install` without `CLAUDE_CONFIG_DIR`, so a
  plain `mirai setup checklist` said "Session server: behind, and it doesn't start" while the
  private config's registration was current. **Draft fix:** the session's own config travels with
  every step it gives: an MCP server inherits the session's environment, so `mirai_command`'s
  answers for terminal steps (`yours`, the setup skill's hand steps, doctor's hints run from a
  session) prefix `CLAUDE_CONFIG_DIR=<the session's>` when the server's environment has it; the
  skill says "run it in this form". Doctor and `setup checklist` run through the session check the
  session's config; in a terminal they name the config they checked (F3) and, when another config
  has MIRAI's registration for this folder, say so ("current in CLAUDE_CONFIG_DIR=…; this one is
  behind"). The old registration in `~/.claude.json` is Jet's to remove: `mirai session-server
  remove` with no `CLAUDE_CONFIG_DIR`.
- **F8: every commit on the integration branch puts the session server "behind", and finish
  refuses on it.** Committing the checklist itself (3b877ee) did it (line 8, through doctor's
  Session server item). Why it's pinned (unit 15b, D-53; design/05): the server runs from the
  trust root verified at registration, with its policy's hash on the command line, so nothing in
  the work tree or a later branch state changes what the tools in your session do without your
  act in a terminal; 15b says "a stale registration still works, with the rules it was made
  with", and `mirai render` registers again. So "behind" is by design a note, not a fault; only
  "doesn't start" (`connected: false`), a foreign server and "missing" stop `/mirai`. **Proposed
  rule:** keep the pin (following the branch's head at each start would let a merge change your
  session's tools without you); doctor's Session server item gives "behind, still starts" as an
  advisory yellow (a named class beside F4's `expected_until`, say `advisory: "re-register with
  mirai render or mirai session-server install"`), which line 8 and `setup done finish` don't
  count, as they don't count the Merge gate; "doesn't start", foreign and missing stay to fix.
- **F9: `setup decide --keep` took free text from the session as the place.** The ledger held
  places such as "source for conventions-*.md in stage 3, then deleted" (4 × `.claude/rules/*.md`)
  and ".mirai/custom/agents/mirai-reviewer (overlay, read-only, appended lenses)"
  (`architecture-reviewer.md`); F5's stale check then flagged them (rightly) as "neither it nor that
  place is in the repo". Jet re-decided them: the rules and `settings.local.json.example`
  `--drop`, `architecture-reviewer.md` `--keep .mirai/custom/agents/mirai-reviewer.toml`. **Draft
  fix:** `--keep` takes one repo path that exists at HEAD or in the work tree (refused otherwise,
  naming what's there under `.mirai/custom/` for that item), with an optional `--note`; an item
  used as a source or merged into another file is `--drop --note "<what it became>"` (the ledger
  shows "drop: used as a source for conventions-app.md"), so no decision claims a place that isn't
  there. The migrate guide says so, and the skill passes the path `custom add` printed.
- **What passed on P1 (Jet, 2026-11-22, on `thudos-setup` with MIRAI from `d6afc48`):** every stage
  but finish done (finish blocked by F4); doctor 21 ok, 1 yellow (Merge gate), 0 red; the P1 check
  all PASS but finish and "doctor green" (both F4). Jet: resuming after Ctrl-D in stage 2 went on
  at the next undecided item (pass); stage 3 showed every context file with its path and link,
  then the `(open)` questions, then approve or review per file (pass); `CLAUDE.local.md.example`
  kept in place (right); nothing else looked wrong ("generally ok"). The setup session ran out of
  context once (an auto-summary) during stages 4 and 5 and carried on correctly.

### Before P1 and P2 (once, in Terminal)

1. `git -C ~/Projects/mirai fetch origin unit/39-build`
2. `git -C ~/Projects/mirai worktree add --detach ~/Projects/mirai-u39 origin/unit/39-build`
   You see `HEAD is now at <commit> …`. Keep this folder until the probes are done: the clones'
   git hooks run its launcher.

### P1 Thudos, end to end

1. `git clone --bare ~/Projects/thudos ~/Projects/thudos-setup.git`
2. `git clone ~/Projects/thudos-setup.git ~/Projects/thudos-setup && cd ~/Projects/thudos-setup`
3. `git switch -c mirai/setup origin/main` (Thudos's `main` with the council and `.claude/`; you see
   `Switched to a new branch 'mirai/setup'`)
4. `node ~/Projects/mirai-u39/bin/mirai.js init --branch mirai/setup` (this branch's MIRAI, not
   the one on your PATH). It ends with `Next:` and four steps.
5. `git add -A && git commit -m "Install MIRAI"`. You see one line:
   `mirai pre-commit: skipped: mirai/setup (…) has no MIRAI copy MIRAI can run; MIRAI isn't committed on the integration branch yet …`
   and the commit is made.
6. `git push -u origin mirai/setup` (to the local mirror; MIRAI's pre-push prints `pass`).
7. `mirai key new`. You have a key on this Mac, so it says `this machine's key is <id>; its public
   key is in …/.mirai/keys/<id>.pub`. Commit it by itself:
   `git add .mirai/keys && git commit -m "MIRAI key" && git push`.
8. `mirai session-server install` (registers MIRAI's tools for your sessions in this folder).
9. `claude` in this folder. Note: Thudos's council hooks are still in `.claude/settings.json`
   until stage 2 moves or drops them, so they may run in this session as they did before MIRAI.
10. Type `/mirai setup`. It says stage 1 (scan) is next and runs the scan: about 54 items (the
    agents, skills, hooks, rules and templates under `.claude/`, the three `CLAUDE.md`,
    `CLAUDE.local.md.example`, `docs/development-council.md`, and the scripts they call). Follow
    it: it gives you each commit to make in Terminal and each `mirai approve --file …` command.
11. In stage 2, after a few items, close the session (Ctrl-D). Start `claude` again and type
    `/mirai setup`: it must go on at the next undecided item, with the earlier decisions kept.
    For `scripts/quality-gate.sh` and `docker/php/entrypoint.sh` the right answer is "keep, in
    place (the project's own)".
12. Stage 3: give it your sources (`docs/`, the README, what you know). After it writes the files
    you must see a list of every file in `.mirai/context/` with what it is, its state, its full
    path and a link; then each `(open)` line as a question; then the approval command for
    `business.md`, `journeys.md` and each conventions file; for the feature map and each project
    file, "anything wrong or missing?".
13. Stages 4 and 5: the connect steps and the checklist, until `mirai doctor` has no red line
    (Merge gate stays yellow until unit 54; the red team needs `mirai redteam run --kept` here,
    in your terminal).
14. In Terminal, in `~/Projects/thudos-setup`:
    `node ~/Projects/mirai-u39/test/probes/setup-probes.js --check p1`. Pass when every line says
    PASS. You judge the rest: each researched summary was right, and step 12 happened as written.

### P2 Pasted text only

1. `mkdir ~/Projects/u39-p2 && cd ~/Projects/u39-p2 && git init -b main && echo "# p2" > README.md && git add -A && git commit -m first`
2. `node ~/Projects/mirai-u39/bin/mirai.js init --branch main`, then
   `git add -A && git commit -m "Install MIRAI"` (the same one skipped line as in P1, step 5).
3. `mirai session-server install`, then `claude`, then `/mirai setup`.
4. Go through scan and migrate (nothing to migrate). In stage 3, when asked for sources, give no
   links or files: paste a short description of a made-up product (5 to 10 sentences).
5. Answer its `(open)` questions; stop after the review list (no approval needed).
6. In Terminal: `node ~/Projects/mirai-u39/test/probes/setup-probes.js --check p2`. Pass when
   `business.md` lints clean and its Sources table lists only "you said" and the pasted text.

### P3 A skill added later (after P1, in `~/Projects/thudos-setup`)

1. `claude`, then ask: "make a skill that lists the open merge requests". Pass when it uses
   `/mirai custom add` (or `mcp__mirai__mirai_command` with `custom add`) and doesn't write into
   `.claude/` itself.
2. In Terminal: the `mirai approve --file …` and `mirai render` it gives you; commit them.
3. `node ~/Projects/mirai-u39/test/probes/setup-probes.js --check p3 --skill <its name>`: PASS.
4. By hand: `cp -R .mirai/custom/project-skills/<its name> .claude/skills/handmade`, change the
   `name:` line in `.claude/skills/handmade/SKILL.md` to `handmade`, then
   `git add .claude/skills/handmade && git commit -m x`. Pass when the commit is refused and
   prints `  mirai custom add .claude/skills/handmade`.
5. Clean up: `git restore --staged .claude/skills/handmade && rm -r .claude/skills/handmade`.

### The red team

The new case `c-custom-hook` runs in `redteam-full` on the sample app (runner job below).

## Changed from the spec

- **Setup's record is a command, `mirai setup`,** with steps the skill calls through
  `mirai_command`: `status`, `scan`, `decide`, `review`, `defer`, `checklist`, `start`, `done`.
  The spec names `mirai setup status` and `/mirai setup`; the skill needs the rest to keep
  `setup.json`, the ledger and the checklist without one-off scripts (decision 10). Each is on 21f's
  session list (none is a gate: `setup done` only records the commit you made).
- **The ledger keeps every item it has seen,** in `setup.json`, so a moved item stays in the ledger
  with its decision; a scan adds new items and keeps decisions. It reads the commit you're on
  (HEAD), not uncommitted files, as 17a reads committed content.
- **A script outside the agent folders stays where it is when kept** (found on Thudos's main
  before P1): the ledger lists the scripts the items call, and on Thudos those include
  `scripts/quality-gate.sh` (the project's own gate, kept by the pilot's decision 3) and
  `docker/php/entrypoint.sh`. Moving them into `.mirai/custom/scripts/` (decision 5) would break
  the project, so a kept script outside `.claude/`, `.cursor/`, `.codex/`, `.agents/` and the
  council's and BMAD's folders isn't moved (`staysInPlace`); `setup done migrate` and P1's check
  don't count it as "left in its old place". Only the items that call it move.
- **The council's markers** (question 3 below, partly answered from Thudos's main): a `council/` or
  `.council/` folder, or a Markdown file with "council" in its name (`docs/development-council.md`);
  and an instruction file's `.example` (`CLAUDE.local.md.example`). The README's council section and
  the `.gitignore` lines aren't items: P1 removes them by hand, as the pilot did.
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
- **The pre-commit hook runs the sealed copy, and is skipped only where nothing is sealed yet**
  (coordinator's review, 2026-11-22). It goes through the launcher like the pre-push, so the
  integration branch's sealed copy runs and the work tree's `.mirai/framework` never does. The
  launcher skips it, with one line naming the case (`mirai pre-commit: skipped: <why>`), only when
  there is no committed MIRAI to seal: the integration branch has no MIRAI copy yet (the commit
  that installs MIRAI; 12c T2 and the launcher's T3 hit this), the branch has no commit here, or
  the machine has no store to say which branch that is. It is also skipped when the sealed copy
  is from before this unit (it has no `src/setup/pre-commit.js`): `mirai init --refresh` writes the
  pre-commit into the hooks folder, so without this the refresh's own commit (yours, or the build
  runner's on the sample app) would be refused by the old copy it replaces ("pre-commit isn't a
  hook MIRAI runs"). Every other refusal stays a refusal, and
  the launcher's refusal line for a commit says `git commit --no-verify`. `mirai which hook
  pre-commit` shows the skip.
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
3. **The council's markers:** read from a local clone of Thudos's main (see "Changed from the
   spec"): every council file of the pilot's list now has a row. Options: (A) that's enough; P1
   shows anything missed (default); (B) you name more now.

## For later units

- 38b (naming), done at the merge of main (219946d): the launch test runs Kai under `developer`;
  the rule sentence of decision 10 says the host's word (`{merge_requests}` in
  `registry/templates/agents-block.md`, filled by `renderAgents` from `wordsFor`: "pull requests"
  on GitHub, "merge requests" on GitLab or an unknown host, such as a local mirror); `mirai custom
  add`'s widening line names the agent in full ("it widens Rex (mirai-reviewer) …"); the
  overlay check keeps 38b's renamed-role refusal and 39's protected-path check (the merge's one
  conflict, `src/config/overlays.js`). 38b's T8 source check passes with 39's code.

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

**Through the build runner** (the authoritative runs, a clean export each):
- `u39-tests-1` at `f94a975` (before main's 38 was merged in): **pass, 768/768**, 24 minutes.
- `u39-tests-2` at `127dfc7` (main merged in, the pre-commit on the sealed copy): **pass, 769/769**.
- `u39-tests-3` at `15ff50c`: **pass, 770/770**; `u39-baseline-1` there: **pass** (3.9 min; the
  runner's refresh commit went through the new pre-commit); `u39-redteam-1` (`redteam-full`)
  there: **pass** (13.9 min; the red team gains `c-custom-hook`).
- `u39-tests-4` at `d6afc48` (the P1 store fix): 770/771, the known flake above; `u39-tests-5` at
  the same commit: **pass, 771/771**.

**On the Mac** before them: 768/768 at `f94a975`
(`caffeinate -i node --test --test-timeout=300000 "test/**/*.test.js"`); after the last changes,
the files they touch (`test/setup`, `launch`, `hooks`, `install`, `docs`, `doctor`, `cli`,
`detect`, `mcp`): 86/86 and 98/98, and `test/setup` 13/13 with the new test. The run before the
first full one, 761/768, failed on pins this unit moves (the bundle's and the registry's skill
lists, the command list, 17a's instruction-file list), on two words the system-check guard (30a)
caught, and on the pre-commit hook refusing the commit that installs MIRAI (fixed, see "Changed
from the spec").
