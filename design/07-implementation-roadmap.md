---
status: draft
version: 5
---

# 07 — Implementation roadmap

This is the build order only. Each unit gets its full spec in Phase 4
(`implementation/units/NN-name/spec.md`), one at a time, never in bulk.

**Version history:**
- **Version 2** applied review round 1 (`06-review-round-1.md` §A–C and §G). Main change (R-C6):
  a **walking skeleton on Claude Code only** instead of one horizontal layer at a time.
- **Version 3** applied the follow-up discussion (`08-followup-discussion.md`, Q1–Q9).
- **Version 4** applied review round 2 (`06-review-round-2.md` §A–C and §G U1–U5):
  - the safety fixes moved into Milestone A;
  - the pilot comes right after A;
  - D starts with the second-project install.
- **Version 5** applies review round 3 (`06-review-round-3.md` §B and your decisions §D: V1 (a)
  keep D7; V2 no further design review; V3 the orchestrator merges the docs MR). The main
  changes:
  - **One configurable integration branch** (`[git] integration_branch`) replaces every
    hard-coded "main" (R3-C1). During the pilot it's `mirai/pilot`.
  - **The sample app is a private repo** in the pilot's stacks (R3-M1).
  - **Setup detection moves into A** (R3-M1), and the **pilot checkpoint is a sized unit** (30).
  - **A MIRAI MCP broker** (unit 15) is the only way a sandboxed agent or skill reaches MIRAI
    (R3-C3).
  - **Named checks plus a signed gate-result record** (R3-C2).
  - **`.git` and auto-run config protection** (R3-C4).
  - **The red-team suite gates every headless launch**, not just autonomous mode (R3-M7). It
    comes before the launcher.
  - **The dependency loop between TDD and the supervised run is gone** (checkpoint refs move into
    the commit model).
  - **The D-37 registry core moves into A** (AR3-21 ordering).
  - **A B checkpoint**, measurable pass marks, and a zero-unit usage spike before unit 01
    (R3-M3).
  - **Everything is renumbered.**

**Rules:**
- **One unit** = one skill, one agent, one workflow, one template, one config, or one script
  module. A thin persona and its one main skill may share a unit (D-11: behavior lives in skills).
- **Order follows the skeleton:** the shortest safe path to one MR first, then documents, then
  overnight, then breadth.
- **Dogfooding starts after unit 06** (`mirai approve`). From unit 07 on, every unit's own spec
  and progress use MIRAI's config, status model and run log (PM-18).
- **Every unit is built and tested on the sample app first.** This is a **private** repo
  (`mirai-sample-app` on your personal account, unit 02), never inside the public MIRAI repo
  (PM3-8). So Milestone A's MRs land in a private repo.
- **The pilot starts right after Milestone A** (your decision U1, 2026-10-23; recorded in D-28 and
  `00`).
  - At the **pilot checkpoint** (unit 30), MIRAI is installed on the `mirai/pilot` branch of
    `people-management-tool/platform` (D-28), and `[git] integration_branch = "mirai/pilot"`.
    MIRAI never targets the pilot's real `main` (R3-C1). No local project is touched before then.
  - From then on, each milestone's exit check is repeated on the pilot.
  - Calibration (unit 57) runs on pilot tickets only.
  - Where a "Done when" says "pilot ticket" before the checkpoint, read "sample-app ticket".
- **"Main" below always means the configured integration branch** (`[git] integration_branch`,
  unit 03b). Trust root, ticket base, MR target, docs MR, baseline refresh, stacking and CI all
  read it (R3-C1, AR3-8).
- **Claude Code is the only tool until Milestone D** (D1).
- **No `both` storage mode** (D5), and **no external connector** in the MVP (D4).
- **Subscription only:** budgets are counted in turns, tokens and minutes, plus the **share of the
  session and weekly limit** each ticket used (R2-M2). Dollars are only Claude's estimate
  (`research/09` §5–6).
- **MIRAI follows the project's branch naming.** MIRAI work is recognised by the commit trailer
  `Mirai-Ticket: <id>` **and** by branch registration. The gate fails closed (R2-M4, TL3-22):
  - a registered branch without the trailer is blocked;
  - any branch with at least one trailer commit counts as registered;
  - a missing or corrupt registry blocks pushes of trailer branches until `doctor` repairs it.

  `mirai/pilot` is just the name we chose for the pilot branch.
- **One usage budget across all projects** (D-57): a global config in `~/.config/mirai/` with
  your plan and the night, week and reserve caps; a global usage ledger; one MIRAI run at a time
  across projects.
- **The MVP assumes one machine** (U3). `mirai export/import` is Later.
- **MIRAI's control files never live inside a project** (R2-C1). The store, trust root and hooks
  live under `~/Library/Application Support/mirai/<repo-id>/` (written `<mirai-home>` below). The
  signing key lives in `~/.config/mirai/`. Both are denied to agents.
- **No sandboxed process calls `mirai` directly** (R3-C3). Agents and skills inside a Claude Code
  session reach MIRAI only through the MIRAI MCP broker (unit 15).
- **No headless agent launch without a green red-team result** (R3-M7, TL3-9). The result is
  recorded for the exact (Claude Code version, `strict.json` hash, Docker version), and the
  launcher (unit 19) enforces it.
- **D7 stays as decided (V1 (a)).** Agents run as your user under the blocking rules. **Condition:**
  if the red-team or `05` §G tests show that the docker socket, the ssh-agent, the keychain
  (`git credential fill`, `security find-*-password`) or the real `.env` can be reached and can't
  be closed by configuration (G18, TL3-5, TL3-14), it's a **blocker**. No headless run happens, and
  V1 comes back to you.

**Step 0 is dropped** (agreed 2026-10-23). The usage spike was meant to run before unit 01. On
Max 20x the risk is low, Milestone A is useful in supervised mode either way, and unit 30's usage
note measures the same thing on real pilot work. So the first usage reading is unit 30's.

**Milestones.** Each exit names the evidence that proves it (PM2-19).

| Milestone | Name | Exit check (evidence) | Part of |
|---|---|---|---|
| **A** | First MR | `mirai report <run>` for one hand-written sample-app ticket shows plan → TDD → review → push → MR inside the loop caps, with rounds, turns, tokens, minutes and **the share of the usage limit**; the red-team suite (unit 18) is green for the current Claude Code version; the MR lands in the private sample-app repo | MVP-core |
| **Pilot checkpoint** | MIRAI on the real pilot | Unit 30's exit: `mirai doctor` is green on `mirai/pilot`; the A exit check is repeated on one real pilot ticket targeting `mirai/pilot`; a written go/no-go note ("at this rate, N tickets fit in one night and M in a week") | MVP-core |
| **B** | Supervised document flow (`standard` track) | One pilot feature request → approved PRD-lite (brief approved with it, U4) → approved ticket set → docs MR merged by the orchestrator (V3) → one ticket to MR; `mirai trace` clean; all approvals done from `mirai inbox` | MVP-core |
| **B checkpoint** | Value check | After B's exit, 3–5 supervised pilot tickets: the acceptance rate (unit 29's M1 script) and your active review time (`mirai review`, unit 48) against the B stop rule below | MVP-core |
| **C** | Overnight | One unattended night of at least 3 small pilot tickets ends in MRs and a morning report inside the calibrated budgets; `permission_denials` show zero violations that got through; CI `mirai-verify` is green on every MR | MVP-core |
| **D** | Reuse, full track, release | One quick-track ticket reaches an MR on a second project with no framework edits; one `full` feature goes PRD → design → tickets → MRs → released (release record) on the pilot | MVP-complete |
| **E** | Sync-back | A framework change made in the pilot becomes a clean PR on the MIRAI repo; the leak scanner report is clean | MVP-complete |

**Unit count:** A 30 · Pilot 1 · B 18 · C 10 · D 15 (13 core + 2 "when needed") · E 3 ·
**77 in total.** Unit 03 was split into 03a and 03b on 2026-10-23; the other numbers stay.
- **Unit 02 review proposals P1–P11** (`implementation/units/02-sample-app/review.md`) were added to units 13, 14, 16, 17, 18, 30, 39, 47, 52 and 57 and to the Later list on 2026-10-23.
- **Milestone A grows from 27 to 29.** It gains:
  - the MIRAI MCP broker (unit 15), which every sandboxed skill and agent needs;
  - setup detection (unit 17, moved from B), which the pilot needs.

  It loses the small items PM3-13 listed: the schema-migration test → 70, two-repo config
  validation → 72, `pre-commit` → 44, `handover` → 46.
- **The pilot checkpoint is its own sized unit** (30, R3-M1, PM3-2). It's the hand work of a
  brownfield install, not a footnote.
- **First agent run checkpoint at unit 21** (PM2-2). One supervised Kai session on a sample-app
  ticket through the launcher and loop guard, no ship. The red-team suite must be green first
  (R3-M7).
- **Orchestration is spread across milestones** (R-C6):
  - the store (05);
  - the loop guard (20);
  - the commit model (22);
  - one supervised ticket (28);
  - inbox and parking (46);
  - environment faults (52);
  - stacking (53);
  - the autonomous preset (55);
  - workspace mode (72).

---

## Milestone A: First MR (MVP-core)

### A1. Foundation

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 01 | `mirai` CLI skeleton (Node, no deps): command router, `--help`, exit codes, test harness | — | Everything else is a subcommand | `mirai --help` lists commands; the test runner works; zero npm dependencies |
| 02 | **Sample app as a private repo** `mirai-sample-app` (R3-M1, PM3-2, PM3-8), **in the pilot's stacks** so unit 16's adapters carry over unchanged:<br>• a Laravel API with PHPUnit;<br>• a React UI with Vitest;<br>• one Playwright smoke test;<br>• a seeded known-failing test and a seeded flaky test (for the baseline);<br>• a lint, type-check and build command for the named checks (R3-C2);<br>• a `.env.test` with dummy secrets;<br>• a compose file that mounts only the project source, never `.git` | 01 | Every unit is tested on it before the pilot; it must not live in the public MIRAI repo | `docker compose up` starts it; each test level and named check runs; the seeded failing and flaky tests behave as designed; no real secret exists in it; the repo is private |
| 03a | **TOML subset reader** (split from unit 03 on 2026-10-23; D-40):<br>• a written grammar for the part of TOML MIRAI accepts, and a test corpus of valid and invalid files;<br>• anything outside the grammar is rejected loudly, with file, line and column, never guessed;<br>• safe by construction: no prototype keys, size and depth limits | 01 | Every human-edited config and definition file is TOML | The corpus passes; every out-of-grammar case is rejected with a position; duplicate keys and tables are refused |
| 03b | **Config model + registry core** (AR-18, PM2-3, R2-M12; split from unit 03, built on 03a):<br>• **Schema:** `schema_version`, 3-layer load + merge (plus the personal global layer from `~/.config/mirai/`; `[subscription]` and `[usage]` are rejected in project files, D-57), validation, presets (`supervised`, `autonomous`), `[gate] code_paths` defaults.<br>• **Formats:** JSON for machine-written files; human-edited files through the 03a reader.<br>• **Registry core** (D-37, moved earlier for AR3-21 ordering): the loader and schema for data-driven definitions (document types, agent manifest) that units 04, 07, 11 and 19 read. Overlays come in unit 37.<br>• **Hand-written config in Milestone A:** the sample app's config is written by hand, from unit 17's detected facts.<br>See the key list below | 01, 03a | Every later unit reads config | Merging is tested; a missing required key stops with a clear message; out-of-grammar TOML is rejected; a credential-looking value in `resources` is rejected; a one-entry `repos` (`.`) validates; `integration_branch` is required and read by every git-touching unit; an agent manifest and a document-type definition validate |
| 04 | **Status model:**<br>• **States and moves:** allowed moves including R-M12's (MR comments / red CI → `in-progress`; MR closed → `dropped` or `ready-for-dev`; plan rejected → re-plan; at most one re-plan after `bad_plan`), plus **`waiting`** (on a parent) and **`integrated`** (merged into `feature/<epic>`, R2-M5); human-only moves.<br>• **`obsolete` is defined** (AR2-22).<br>• **Derived states:** `built` and `done` are derived, never written (R-C4).<br>• **One status home** (R3-M12, AR3-7): one status file per ticket in the repo store, holding only what can't be derived. **Derived states win** over the file, so `built` is reachable and `blocked` never overrides `done`.<br>• **Frontmatter and freezing:** frontmatter is the current state, the log is history; approved versions are frozen, with a draft v2 beside them (R-M11).<br>• **A run state machine:** `running → paused → running · stopped · finished` (AR2-23).<br>• `mirai status` | 01, 03b | Every document and ticket needs it | The ticket and run transition tables are tested; illegal moves are refused; a frontmatter/log mismatch is an error; `built`/`done` are computed from git and the MR state; a status file saying `blocked` doesn't override a derived `done`; a `together` epic with one `integrated` ticket unblocks the next one |
| 05 | **Orchestrator store at `<mirai-home>/<repo-id>/`, outside the project** (R2-C1):<br>• `state.json`, `journal.jsonl`, `heartbeat.json`, and the **branch registry** (R2-M4).<br>• **Fail-closed registry** (TL3-22): trailer commits count as registered; a missing or corrupt registry blocks trailer-branch pushes until `doctor` repairs it.<br>• **Trusted personal files** (`config.user.toml`, cache) live here too.<br>• **The run log:** one file per run; every line carries `{schema_version, run_id, seq, ts, item, by}`; metric fields from day one, including `tier`, `model`, `tdd`, `tests`, **`limit_share`** (R2-M2) and the event `template_gap`; structured finding data kept apart from bulky text (Q9).<br>• **The global usage ledger and run lock** (D-57) in `<mirai-home>/global/`: each run appends its limit share with repo id and plan.<br>• **No run-log lines are ever committed** (U3, Q9; PM2-9).<br>• `mirai log` refuses privileged event types | 01, 03b | Logging must exist before anything is measured; control data must be out of agent reach | Concurrent appends lose no lines; the store path is outside the work tree; a privileged event via `mirai log` is refused; a run line with `tier`/`model`/`limit_share` validates; a second run in another repo is refused while one holds the global lock; deleting the registry blocks a trailer-branch push with a `doctor` hint |
| 06 | **Signing + `mirai approve` / `mirai drop`** (R2-C5, R2-M11, R3-M10, AR3-10):<br>• **Keys:** an **Ed25519** key pair via `node:crypto`. The private key lives in `~/.config/mirai/`, denied to agents. The **public key is committed** in the project under `.mirai/keys/<key-id>.pub`, so CI can verify with no secret.<br>• **Key lifecycle:** every signature carries a **key id**. A **bootstrap path** for the first key: the first key enters the integration branch through a human-made commit you sign off in a TTY, so the first docs MR can pass `mirai-verify`. Adding a key is a protected change. A committed **revocation list**.<br>• **Approvals** sign the **content hash** of what was approved.<br>• **Capture:** TTY confirmation, plus the "accepted as is / edited / rejected" capture (R-M18), with an **optional one-line reason** on edit or reject (post-MVP evaluation, `09`) | 04, 05 | Every human gate and every proof needs it. Dogfooding starts here | Refuses without a TTY; an approval made before a document edit fails verification after it; verification works with only the public key; a signature by a revoked key id fails; a new key added by a non-human commit is refused; D-17 is restated honestly |
| 07 | **Lint framework + `mirai lint`:**<br>• **Checks:** frontmatter, required sections, IDs, links. **Unknown headings are rejected** (Q2).<br>• **Template version:** documents record theirs (`template: prd@v3`, R2-M12).<br>• **Mermaid check:** "fenced + diagram keyword + balanced brackets" (AR-18).<br>• **Inputs:** document types come from the registry core (unit 03b). Per-project customization comes in unit 37 | 01, 03b, 04 | Lint runs before any AI | Lints a sample doc set; messages give file:line; an extra heading is flagged; a missing template version is flagged |

**Config keys (unit 03b):**
- **Git (R3-C1):** `[git] integration_branch` (required). The branch naming pattern and the
  trailer format (Q8).
- **Model tiers (Q5):** `light / standard / deep` mapped to model IDs, plus per-step default
  tiers. The defaults come from calibration (unit 57).
- **Testing (Q7, Q8):**
  - `tdd`: `auto` · `on` · `off` (default `auto`);
  - `tests`: `required` · `optional` (default `required`);
  - test levels per repo or service: name, adapter, purpose, when required, time budget;
  - the E2E suite time budget.
- **Named checks (R3-C2):** `lint`, `types`, `build`, and any others the project has, each with a
  fixed command run by the orchestrator in hardened containers (unit 14). Kai runs them only
  through the broker; there's no free shell.
- **Repos and resources (Q3):**
  - `repos`: name, local path, remote URL, start + health commands;
  - `resources`: links and names only, never credentials. Committed with the project config for
    now (round-2 Minor decision). `doctor` warns if the project repo is public.
- **Workspace E2E (Q3):** `local` · `deployed` · `none`.
- **Gates (U4, R3-M4):** see the single gates table below.
- **Proofs required per milestone:** in Milestone A only the review proof and the gate-result
  record are required. The QA proof becomes required when QA exists (unit 51), so A can push under
  its own `pre-push` (TL2-19).
- **Retention (Q9):** `retention.days` (default 90), `retention.auto` (default off).
- **Runs:** `run.stop_by`.
- **Global, not per project (D-57):** `~/.config/mirai/config.toml` holds `[subscription] plan`
  and `[usage] night_max`, `week_max`, `reserve`. Unit 03 loads it as its own layer. These are
  personal: they're rejected in any project file, so a shared repo never holds one developer's
  plan or limits.

**The gates table, the one place this is defined** (U4, V3, R3-M4). `01` §16 and D-34 copy it.

| Track | Your actions | Automatic |
|---|---|---|
| `quick` | approve the ticket; merge the MR; **+ production go/no-go** once release exists (unit 60) | plan gate (`auto` for normal risk); push and MR |
| `standard` | approve brief + PRD together; approve the ticket set; per ticket: plan batch (supervised preset), merge, go/no-go once release exists | **docs MR merged by the orchestrator** after your signed ticket-set approval (V3); push and MR |
| `full` | approve the brief; approve PRD; approve design; approve the ticket set; per ticket as in `standard` | docs MR merged by the orchestrator after your signed ticket-set approval (V3) |

- **High-risk tickets** always get a human plan gate.
- **There is no `ship` gate;** your merge is the gate.
- **`unpark` has one choice list:** re-plan · retry with the budget raised once · split · drop,
  plus a note. `01` and `04` must use the same list.
- **Protected paths a ticket plans to touch** are declared in the plan and approved at the plan
  gate, so the ticket doesn't park mid-night (R3-M2).

### A2. The templates one ticket needs

Each template unit includes its checklist for the author and the verifier, and its lint rules.
Every template follows the Q2 rules: fixed sections, "N/A — reason" for optional ones, no
agent-added sections.

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 08 | Story/bug templates + plan template + their lints (two small templates in one unit, sized per TL2-22).<br>• **Ticket:** `AC-<ticket>.n` IDs for quick-track tickets (R-M10); fields `repo`, `e2e`, `tdd`, `tests`, risk, size; one field name `covers_ac` (R2-M11).<br>• **Plan:** a frozen block whose **content hash** is signed at the plan gate (R2-M11); a test list with AC IDs and a test level per AC (Q8); `no-test` rows; a characterization-test list naming only the changed functions or methods (Q8); a **protected-paths list** the ticket will touch (R3-M2); **new dependencies** listed, which makes the ticket high risk (R3-C2) | 04, 07 | The skeleton starts from one hand-written ticket | A filled example lints clean; a ticket without AC IDs or a `repo` is flagged; an AC without a level is flagged; a characterization test for an unchanged symbol is flagged; an edited frozen block fails verification; a new dependency raises the risk |
| 09 | Report templates + **findings schema** (R-M7):<br>• **The schema:** review findings with `basis.ref`, fingerprints by file + symbol, test-failure signatures.<br>• **The other templates:** QA report; run report; MR description with **one review line** (`Review: PASS after N rounds (MIRAI)`) plus non-blocking follow-ups and text-only QA evidence (Q9).<br>• **Verdicts** (reviewer, QA) and the **gate result** (R3-C2) are defined as **structured output** the launcher or broker captures, never as files the agent writes (R2-C1, R3-C3) | 08 | The loop guard and review need a machine-checkable format | A finding without a citation or a resolvable `basis.ref` is flagged; the schema has a test corpus; a rendered MR description holds no findings |

### A3. Install on Claude Code and lock it down

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 10 | **Installer `mirai init`** (Claude Code only):<br>• **What it writes:** the framework copy, `mirai.lock` with hashes **including generated tool files** (R-M13), `.gitignore` entries, the store at `<mirai-home>`.<br>• **Lock marks:** each file is marked **`framework`, `project` or `rendered`** (R2-M12, R3-M13, AR3-13). `rendered` covers generated tool files and the MIRAI block in `AGENTS.md`, which mix framework content with project facts.<br>• **Install** via `npx github:<owner>/mirai#vX.Y.Z` | 03b, 05 | Gets MIRAI into a project | Fresh install on the sample app; the lock lists every file with its mark; `AGENTS.md`'s MIRAI block is `rendered`; nothing MIRAI controls is written under `.git/` |
| 11 | **Claude Code adapter:**<br>• `CLAUDE.md` → `@AGENTS.md`, skills, agents, `.mcp.json`.<br>• The tool profile is a data file with a schema (R-M16), loaded through the registry core.<br>• **Interactive `.claude/` files are rendered from the same launch bundle** as headless runs (R2-M12) | 10 | The only tool until Milestone D | Claude Code lists MIRAI skills and agents; the interactive and headless bundles have the same content hash |
| 12 | **Trust root + protected paths** (R-C2, R2-C1, R3-C4):<br>• **The snapshot:** at run start, snapshot and hash the framework, config, custom files, generated tool files and the compose inputs **from the integration branch's base commit**, never from a parent branch (R2-M6, R3-C1). It goes to `<mirai-home>/<repo-id>/trust/`, and agents get a **read-only export** of the skill files they need (TL3-7).<br>• **Re-hash before every launch.**<br>• **Protected paths, forced to `high` risk:** `.mirai/**` (including `.mirai/keys/` and records), tool dirs, CI files, hooks, lint/test configs, compose/Dockerfile/`.env*`, new or changed `CLAUDE.md`/`AGENTS.md`/`@`-imported files and project skill folders (R2-M10, R3-M9). Also, from R3-C4/TL3-12/AR3-12: `.gitattributes`, `.gitignore`, `.lfsconfig`, `.claude/`, `.vscode/`, `.envrc`, `.husky/`, and `package.json` lifecycle scripts.<br>• **A plan-declared protected path** (unit 08) approved at the plan gate doesn't park the ticket (R3-M2) | 10, 05 | The gate must not be editable by the agent it checks | A branch that edits a lint config, a compose override, a `.gitattributes` `-diff` rule, a `.vscode` task or a nested `CLAUDE.md` gets `high` risk; a tampered trust-root file is detected at the next launch; hooks and gates read the snapshot, not the work tree; the report warns before you open such a branch in your IDE |
| 13 | **Strict settings bundle** (D7, `research/09` §7, R2-C1, R2-C3, R2-M10, R3-C4, R3-M5, R3-M13). Generates `<trust-root>/strict.json` and the launch flags:<br>• **Sandbox:** on, with `allowUnsandboxedCommands: false`.<br>&nbsp;&nbsp;– "Outside the project" is written as sandbox `denyRead`/`allowRead` (narrower path wins), not as deny + allow permission rules (TL2-5).<br>&nbsp;&nbsp;– `denyRead`/`denyWrite` on `<mirai-home>` and `~/.config/mirai`.<br>&nbsp;&nbsp;– **`denyWrite` on `.git`** (R3-C4).<br>&nbsp;&nbsp;– **`denyRead` on the real `.env*`** (TL3-14).<br>&nbsp;&nbsp;– **The network allowlist:** test an **empty headless allowlist** first (G16), since Claude's own API traffic may not go through the sandbox. Dependency installs happen only through the broker (R3-M5).<br>• **Denies:** agent writes to `.git/**`, `git commit`/`git config`/`git push`, `gh`, `docker`, **`claude` and `mirai` from Bash** (R3-M5, R3-C3), `env`/`printenv`, the Task/Agent tool, `WebFetch`/`WebSearch`.<br>• **Blocking hooks:** secret patterns (including the **exact value of the login token**) in Write/Edit content; Glob/Grep outside the project.<br>• **No browser MCP in headless runs** (Q6).<br>• **Launch flags:** `--restricted` with only `--settings` from the trust root, if it fits (G10). Otherwise the **tested fallback**: a scrubbed `CLAUDE_CONFIG_DIR` so user settings, memory and skills don't load (G22, TL3-15).<br>• **Environment:** the scrub is an **allowlist**, not a denylist (R3-M13). `claude auth status` reports `oauth_token`; `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` are unset.<br>• **Optional, with your approval:** `managed-settings.json` locks<br>• **Instruction files (P1):** the headless launch controls which `CLAUDE.md`/`AGENTS.md` load; listing them in the ledger isn't enough, because Claude Code loads the project's `CLAUDE.md` itself<br>• **Exact paths (P4):** `denyRead` for real `.env*` files uses exact paths; `.env.testing` matches `.env*` but must stay readable | 12, 11 | Agents run on your machine from unit 19 on, supervised or not | A headless launch uses only trust-root settings; a user-settings `env` with an API key has no effect; user memory and skills don't load; the denies above appear in `permission_denials` when tried; G1, G5, G9, G10, G13, G16, G17, G18, G20 and G22 are settled by test. **If G18 shows the docker socket, ssh-agent or keychain reachable and not closable, this unit fails and V1 goes back to you** |
| 14 | **`run_tests` MCP tool + named checks + compose hardening** (R2-C2, R2-C3, R3-C2, R3-C4, R3-M6):<br>• **The tool:** part of the MIRAI MCP broker (unit 15) from the trust root, `run_tests(level, path?)` and **`run_check(name)`** for the named checks (lint, types, build). Structured arguments, strict path and argument checks (no option injection, symlinks resolved and refused outside the project), no shell.<br>• **The compose call:**<br>&nbsp;&nbsp;– built only from trust-root files with **absolute paths**: a pinned compose file list, no override auto-load, the env file `.env.test` with dummy secrets;<br>&nbsp;&nbsp;– a **unique compose project name per run**, so it never touches your daytime stack.<br>• **No validate-then-run gap:** `docker compose config` renders the exact file that then runs. An **allowlist validator** checks it: only the project source mounted, **`.git` masked**, no docker socket, no privileged mode, no host network.<br>• **Test containers** get an internal network only, with no outside access.<br>• **E2E** uses the official Playwright image next to the project's containers; level `qa-explore` is reserved for unit 51.<br>• **The gate result:** checks and tests return a result the orchestrator **signs as a gate-result record** (R3-C2).<br>• **Pre-step guard:** single checkout with branch switching; it checks a clean tree, the right branch and a healthy stack.<br>• **Host git:** always runs with a **pinned set of settings**: `core.hooksPath=<trust-root>/hooks`, `core.fsmonitor=false`, no filters, no `sshCommand`, no credential helper from the repo, no `include.path`, `GIT_CONFIG_NOSYSTEM`. **`.git/config` is hash-checked before every git call** (R3-C4, G23)<br>• **Exact paths (P4):** masking covers each real `.env*` file by exact path; `.env.testing` stays mounted<br>• **Hard timeouts (P5):** every test run has one; a timeout counts as an environment fault, not a test failure (a full disk hangs instead of failing) | 13, 02 | The gate must test the branch actually checked out, without giving the branch control of docker or host git | A marker change on the branch is seen by the test run; a seeded `compose.override.yml`, a host mount, a `.git` mount and a docker-socket mount are each refused; a test that tries to reach the internet fails; a real `.env` is never mounted; an unknown level or check is refused; a container write to `.git/config` is impossible and a host-side change to it is detected before the next git call; two runs never share a compose project; G12, G15, G19 and G23 are settled |
| 15 | **MIRAI MCP broker** (R3-C3, AR3-2, AR3-3, TL3-7, TL3-8). The one narrow channel between a sandboxed Claude Code session and MIRAI:<br>• **Tools:** `launch` (the launch broker for supervised runs from your session), `log`, `lint`, `trace`, `session`, plus `run_tests`/`run_check` (unit 14).<br>• **Inputs:** per launch, a **read-only input folder** holds what the agent needs: the plan, the findings from earlier rounds, the trust-root skill export.<br>• **Outputs:** come back only as **structured output**. QA scripts are passed **as content**, not as paths into the store.<br>• **Rule:** no sandboxed process calls `mirai` directly. It's denied in unit 13 | 13, 14, 05 | Supervised and interactive flows can't work otherwise without reopening R2-C1 | A skill in an interactive session launches an agent, logs and lints only through the broker; `mirai` from Bash is denied; a launched agent reads its plan from the input folder and can't write it; a QA script passed as content runs in the Playwright container |
| 16 | **Test adapter contract per stack** (R2-M7, TL2-10):<br>• **Runs:** one file, a test ID or a whole level, in chunks under the Bash time limit.<br>• **Formats:** results as **JUnit XML**; coverage as **lcov or Cobertura**; small zero-dependency parsers for exactly those formats and for unified diff (TL2-21).<br>• **Adapters for the sample app's stacks**, which are the pilot's (PHPUnit, Vitest, Playwright)<br>• **Hard timeouts (P5):** the adapter enforces a time limit per run and reports a timeout as an environment fault | 14 | Red checks, the baseline and diff coverage all need machine-readable results | The sample app's tests run by ID; results and coverage parse; a run longer than the time limit is chunked; a malformed report is an environment fault, not a failure |
| 17 | **Setup detection** script (moved from B, R3-M1, PM3-2; no AI). It detects:<br>• `repos`;<br>• test levels and adapters per repo;<br>• named checks;<br>• the **test baseline**: levels, run times, coverage if available, failing and flaky tests. Gaps are reported, never turned into tickets;<br>• the branch pattern and commit format;<br>• compose mounts;<br>• the `worktree_safe` check.<br>It writes a **draft config** for you to review<br>• **Agent-instruction files (P2):** finds every `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.cursor/rules` and `.github/copilot-instructions.md`, and flags shell, network and install commands in them (live example: Laravel 13's project template)<br>• **Flaky vs failing (P7):** reruns a failing test until it has seen both a pass and a fail, up to 10 runs; maps framework suite names to MIRAI levels (PHPUnit `Unit`/`Feature` → `unit`/`api`) | 16, 03b, 14 | The hand-written config in A and at the pilot checkpoint is written from these facts | On the sample app, and later on the pilot, it finds the stacks, levels, checks and existing failing tests, and writes a draft config for review; G8 is checked per project here |
| 18 | **Red-team suite** (TL2-22, R2-M10, AR2-18, R3-M7, AR3-21). **The single list lives in `04` D-30**; this unit implements it, and `01` §7a references it. It covers rounds 1–3:<br>• **Reads and network:** read `~/.ssh`; read the store; read the launch token; a Glob from `/`; `curl` to an unlisted host; `sh -c` around a denied command; `grep -r` from `/`; `WebFetch`; reach the docker socket, the ssh-agent, `git credential fill` and `security find-*-password` (G18).<br>• **Secrets:** write an API key or **the login token** into a file; read the real `.env` through Bash; send the token to a package registry.<br>• **Sandbox escape:** `dangerouslyDisableSandbox`; a symlink from the work tree into the trust root, used through the file tools (G17).<br>• **MIRAI's control files:** write into `<mirai-home>`, `.git/hooks` or `.git/config` (from Bash and from a container); `git config core.hooksPath`; read the signing key; write `.mirai/keys/*.pub` or a `records/` file through Bash; forge a verdict file.<br>• **Through tests:** a branch that brings its own `compose.override.yml`, `.env` or `COMPOSE_FILE`; `run_tests` with shell metacharacters or an option injection; a test container calling the internet.<br>• **Through the agent:** start a native subagent; run `claude -p` or `mirai` from Bash; plant a nested `CLAUDE.md` or `@` import aimed at the reviewer; leave a background process running after handover.<br>• **Through review and CI:** `.gitattributes -diff` hiding code from the reviewer; a stacked parent editing the workflow.<br>**The result is recorded** per (Claude Code version, `strict.json` hash, Docker version). `doctor` re-runs it after every update<br>• **Planted instructions (P3):** plants an agent-instruction file like Laravel's on a fixture branch at run time (never committed)<br>• **Second canary (P3):** a canary in a second `.env*` file proves every real env file is masked; QA screenshots and transcripts of a debug error page must never show env values | 13, 14, 15 | **Every headless launch needs a green result** (R3-M7) | Every seeded attempt is blocked and appears in `permission_denials` or the MIRAI log; the suite runs in under 10 minutes; the recorded result names the three versions. **A G18 failure that configuration can't close is a blocker: V1 goes back to you** |

### A4. Launcher and loop guard

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 19 | **`mirai agent run`** (Claude adapter; invoked from your terminal or the broker's `launch`):<br>• **The bundle:** an explicit launch bundle from the trust root (plugin dir, system prompt file, strict settings, MCP config with the broker); `--permission-mode dontAsk`, `--max-turns`, `stream-json`; detach-and-wait for supervised launches.<br>• **Refuses to launch** unless the red-team result for the current versions is green (R3-M7, TL3-9).<br>• **Checks:**<br>&nbsp;&nbsp;– a write-scope check per role after every run; read-only roles' work-tree writes fail the run;<br>&nbsp;&nbsp;– a depth guard via an orchestrator-held one-time token stored in `<mirai-home>` (unreadable to agents).<br>• **Process group:** the agent's process group is **killed at the end of every run**, so no background process changes files before the commit and the hash (R3-M8, G21).<br>• **Inputs and outputs:** the per-launch input folder (unit 15); verdicts captured from structured output (R2-C1).<br>• **Sessions:** `mirai session start/end` for interactive authoring, so it gets a run id (R-M3, PM2-3).<br>• **Tier selection (Q5):** default tier, raised one tier for high-risk or L work, never lowered for judgement steps.<br>• **Verifier ladder (R2-M9):** a different model family when available, else a different Claude model, else the same model in fresh context, logged as such.<br>• **One run-log line** with tier, model, turns, tokens, minutes, the cost estimate and `limit_share` | 05, 13, 14, 15, 18 | Every agent run goes through it (D-12) | A launch with a stale or red red-team result is refused; one run is logged with its tier, model, usage and limit share; a high-risk step launches one tier up; a nested launch is refused; a write outside the role's scope fails the run; a verdict written as a file is ignored; a seeded background process is gone after the run; a same-model verifier is logged as rung 3 |
| 20 | **Loop guard** library (R-C7):<br>• round counter, budget ledger (turns, tokens, minutes, limit share), fingerprints, strict-progress check, parking-note writer;<br>• **the global usage check before every ticket** (D-57): stop cleanly when the next ticket could break `night_max`, `week_max` or the `reserve`;<br>• counters live in the store and are saved **before** each launch; **resume never resets them**;<br>• tier escalation comes later (unit 58) | 19, 09 | Loops start at unit 21 | Seeded loops park inside the caps; a killed-then-resumed loop keeps its counters; a repeat fingerprint routes to re-plan; a seeded ledger near `night_max` stops the run before the next ticket and names the cap |

### A5. Build loop for one ticket

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 21 | **Agent `mirai-developer` (Kai) + `mirai-plan` skill + plan gate:**<br>• **Before handover,** Kai runs the named checks and tests through the broker (`run_check`, `run_tests`). Machine failures inside the session don't use a round, and fix rounds resume the same session (R-M4).<br>• **Tests** follow the project's existing style (D-20).<br>• **New dependencies** only through the plan (R3-C2).<br>• **First agent run checkpoint** (PM2-2): one supervised Kai session on a sample-app ticket, plan + build, no ship. It needs a green red-team result | 19, 20, 08, 16 | Builder and per-ticket start; the first real look at behaviour and usage | A plan passes lint and stops at the gate; the checkpoint run's report shows turns, tokens, minutes and limit share; an install of an unplanned dependency is refused |
| 22 | **Commit model + checkpoint refs** (R2-M4, TL2-7; checkpoint refs moved here to break the old 20 ↔ 26 dependency loop):<br>• **Who commits:** the orchestrator alone, at fixed points (after each green step), with the `Mirai-Ticket` trailer and the project's branch pattern, after killing the agent's process group (unit 19).<br>• **Checkpoint refs:** a ref before each step ("redo" = reset to it). It's also the `baseline_revision` for red checks.<br>• **Registration:** each MIRAI branch is registered when it's created, and a signed **`branch.json`** is committed on it so CI can see the scope (R3-M10, AR3-4).<br>• **Agents can't commit** (denied in unit 13).<br>• **Pinned flags:** host git uses unit 14's pinned settings and `.git/config` check | 05, 06, 14 | Proofs, red checks, stacking, parking and checkpoints all depend on who commits when | Every MIRAI commit carries the trailer; an agent `git commit` is denied; a registered branch's commits are made only by the orchestrator; every step has a checkpoint ref; `branch.json` verifies with the public key |
| 23 | **`mirai-tdd` skill + floor guard + orchestrator red check** (Q7, Q8, R2-M7):<br>• **`tdd: auto`:** test-first for logic-heavy work and bug fixes; tests-after or QA evidence for UI styling, config, glue and migrations. High-risk tickets keep `tests: required` unless you override.<br>• **The stub step before red:** for a new function, Kai first adds a stub with a wrong return value, so red is a real assertion failure.<br>• **Right-reason red:** the orchestrator runs new or changed tests against `baseline_revision` (unit 22's checkpoint ref). Only an assertion failure counts.<br>• **Characterization tests** only for changed functions or methods, before the change.<br>(E2E protection comes with QA in unit 51) | 21, 16, 20, 22 | Build discipline | Red evidence is logged from the baseline run; an import-error "red" is rejected; a stub-then-assert red is accepted; a weakened test is caught; `tdd: off` skips the red check and still requires a test or QA evidence per AC |
| 24 | **Agent `mirai-reviewer` (Rex), read-only + `mirai-review` skill:**<br>• **Review rules:** lenses by risk, citation rule, freeze after round 1, per-finding check for high risk, findings in the R-M7 schema.<br>• **L1:** a finding's file:line must fall inside the changed lines, otherwise it's downgraded to "pre-existing" (TL2-23).<br>• **Clean instruction files** (R3-M9): Rex runs on a **clean export of the integration branch's instruction files** (`CLAUDE.md`, `AGENTS.md`, `@` imports, project skills). Instruction-file diffs **block in supervised mode too**.<br>• **The diff** is fenced as data. `.gitattributes` rules are ignored when the diff is built for the reviewer (TL3-12).<br>• **Results:** the verdict comes via structured output; results stay local (Q9).<br>• The test-level and out-of-scope test checks come in unit 48 | 19, 20, 09 | Review | Finds a seeded bug; uncited findings are downgraded; a finding on an untouched line is marked pre-existing; a seeded nested `CLAUDE.md` or `@` import doesn't reach Rex's context; code hidden by `-diff` is still reviewed; round 2 sees only the delta plus the old blocking findings |

### A6. Proofs, gate and ship

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 25 | **Proof records + `mirai gate record\|check`** (R-C1, R2-M7, R3-M11, AR3-6):<br>• **The hash:** bound to a **normalized patch** of `merge-base..head` over `code_paths`. Pinned git options (`--no-ext-diff --no-textconv --no-color`, fixed diff algorithm, rename detection off, binary content included), and `index` lines and hunk line numbers stripped before the SHA-256. So a change on the base in another part of a touched file doesn't break the proof.<br>• **The files:** one immutable proof file per record, **Ed25519-signed with a key id** (unit 06): `<ticket>/<kind>-r<n>-<hash>.json` (AR-22). Proof kinds: review, QA (from unit 51), and the **gate result** (R3-C2).<br>• **Contents:** a proof holds no findings (Q9) and, from unit 43, the `mirai trace` result in the ship-time proof (R2-M11).<br>• **`handover.json`** comes with unit 46 | 05, 06, 09, 12, 22 | The gate needs proofs | A code change after a proof fails `check`; a whitespace-only or binary change fails `check`; a clean rebase onto a base that changed other lines of a touched file keeps the proof; a proof verifies with only the public key; G14 is settled |
| 26 | **Git hooks**, installed in `<mirai-home>` and hash-checked against the base `mirai.lock` (R-C2, R2-C1, R3-C2):<br>• **`pre-push` checks signed records, it doesn't re-run suites:** the review proof (only that in Milestone A) and the **signed gate-result record** for the current hash. Plus a blocking secret scan, including the exact login token value.<br>• **"Green" means nothing new broke:** the baseline is refreshed from the integration branch at the start of every run (one baseline home, AR3-11). Known failures are listed; new ones block.<br>• **Diff coverage only warns in Milestone A** and becomes blocking in unit 54, once G7 is settled.<br>• **Fail-closed scope** (unit 05): a registered branch without the trailer is blocked; an unregistered branch with no MIRAI commits (a human branch) is untouched. The secret scan is offered to everyone.<br>• **`pre-commit`** comes with the first approved documents (unit 44, PM3-13) | 25, 22, 16 | The hard gate (Q3) | A push without a review proof or gate-result record is refused; a gate-result record for an older hash is refused; a seeded secret or the token value is refused; an edited hook is detected; a known baseline failure doesn't block and a new one does; a registered branch with a trailer-less commit is blocked; a human branch pushes freely |
| 27 | **`mirai-ship`** (orchestrator, not an agent):<br>• push and open the MR **targeting the integration branch** (or the stacked parent, unit 53) via the host CLI with its own credentials;<br>• MR description with the review line and follow-ups only, no review comments (Q9);<br>• idempotent MR creation (R-M6) | 22, 26, 09 | Ship | A sample-app MR opens with the template against `integration_branch`; running it twice opens one MR; no MIRAI-written text in the MR holds findings |
| 28 | **`mirai run`, supervised, one ticket:**<br>• a deterministic state machine over plan → TDD → review → ship, driven by the run state machine (unit 04) and unit 22's checkpoint refs;<br>• run lock, `caffeinate` during runs (R-M6);<br>• `mirai resume` restarts from the store;<br>• **`mirai show <ticket>`** prints a ticket's review rounds, QA table and parking notes (Q9);<br>• **no `ship` gate:** your merge is the gate (U4) | 21, 23, 24, 27 | One ticket end to end | One sample-app ticket goes to an MR, stopping only at the plan gate; a killed run resumes without new rounds; `mirai show` prints the ticket's results |
| 29 | **Minimal `mirai report` + minimal `mirai doctor` + the M1 script** (PM2-3, PM3-6):<br>• **`report`:** one run's tickets with rounds, turns, tokens, minutes, limit share and verdicts. Reports are stored in `<mirai-home>` and printed by `mirai report` (PM2-17).<br>• **The M1 acceptance-rate script** (tier 0, from git; moved from the morning report): merged as is / edited / closed without merge.<br>• **`mirai feedback <ticket> "<text>"`** (tier 0, no AI): logs a `feedback` event (your words on back-and-forth with an agent), shown in `report` and `mirai show`. Kept as structured data under the retention rule's "kept" class, so the post-MVP evaluation has the reasons from the first ticket (`09`)<br>• **`doctor`:** auth method, strict bundle active, red-team status for the current versions, trust-root integrity, registry health, merge-gate mode ("local-only" until CI in unit 54), the plan and this week's MIRAI share from the global ledger (D-57) | 28, 18 | **Milestone A exit** evidence | `mirai report` prints the A exit evidence; the M1 script classifies seeded merged, edited and closed MRs correctly; `mirai doctor` is green on the sample app and names each red item with a fix hint |

**Milestone A exit:** see the milestone table.

### Pilot checkpoint (a sized step, R3-M1, PM3-2)

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 30 | **Pilot checkpoint:** MIRAI installed on `mirai/pilot` of `people-management-tool/platform`.<br>• **Config:** unit 17's detection writes the draft config; you review it; `[git] integration_branch = "mirai/pilot"`.<br>• **Hand work:**<br>&nbsp;&nbsp;– a `.env.test` with dummy secrets;<br>&nbsp;&nbsp;– a test compose file if the pilot's compose mounts more than the source;<br>&nbsp;&nbsp;– the named checks wired to the pilot's `pint`/`tsc`/lint/build;<br>&nbsp;&nbsp;– the adapters checked on the pilot's PHPUnit, Vitest and Playwright;<br>&nbsp;&nbsp;– the test baseline recorded;<br>&nbsp;&nbsp;– the signing key bootstrapped (unit 06).<br>• **Then:** red-team green on the pilot; one real pilot ticket through A's flow; the written go/no-go note on usage.<br>• **The pilot questions** in `05` §E (16–22) are answered here<br>• **Instruction files (P9):** the pilot is checked for agent-instruction files too (P2's list) | 29, 17 | Calibration, the stop rules and the first real value all need real tickets | `mirai doctor` green on `mirai/pilot`; one real pilot ticket's MR targets `mirai/pilot`, never the pilot's real `main`; the go/no-go note is written; `05` §E is answered |

**Early stop rule (PM2-4, PM3-5):** stop and rethink before B if the pilot ticket:
- needs more than about 2 hours of your attention (`mirai session` time plus one manual note); or
- needs more than 2 fix rounds, or parks; or
- uses more than 2× the **provisional S-ticket turn cap** (100 turns, provisional until unit 57);
  or
- the usage note says fewer than 3 tickets fit in one night. The limit share can be read by hand
  from `/status` if G4 fails.

---

## Milestone B: Supervised document flow, `standard` track (MVP-core)

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 31 | Shared frontmatter + business brief template + checklist. On the `standard` track the brief is **approved together with the PRD** (U4); on `full` it has its own gate | 04, 07 | First document in the flow | A filled example lints clean |
| 32 | **PRD template (full + lite) + checklist:**<br>• one ID chain: `BR → FR/NFR → AC-FR-n.m` (R-M10);<br>• the lite PRD uses the same IDs;<br>• every NFR names its verification method;<br>• the PRD header carries the proposed track (R2-M11, U4) | 31 | Feeds tickets | FR/NFR/AC ID rules are linted; an NFR without a verification method is flagged |
| 33 | Epic template (with the release mode) + ticket **graph lint** (cycles, closure over FRs, ACs and NFRs, sizes) | 08, 32 | Ticket splitting | Graph lint catches a cycle and an uncovered AC |
| 34 | `mirai-write` skill (agent-facing + human-facing rules; vendored, pinned humanizer) | 11 | Every author agent uses it | Before/after examples pass the checklist |
| 35 | `mirai-interview` skill | 11 | Setup and PRD need it | A sample interview ends in a restatement and an explicit yes |
| 36 | **Context file templates:**<br>• project and conventions (per service);<br>• **`business.md`** (Q4): what the product does; who it's for; business model and goals/KPIs; what this project or repo is and is not responsible for; key business rules; domain glossary; constraints; stakeholders (optional). About 1–2 pages, every claim sourced;<br>• the **feature map**, with a **critical-journeys list using `J-n` IDs** (Q6, R2-M11) | 31 | Setup writes them | A `business.md` claim without a source, or one over the size cap, is flagged; journeys without IDs are flagged |
| 37 | **Template registry content + overlays** (D-37, R2-M12; the registry core is in unit 03b):<br>• **Definitions:** the full document-type definitions (template, checklist, lint rules, state machine) and agent manifests (role, write scope, allowed tools, default tier).<br>• **Per-project customization as overlays** in `.mirai/custom/`: add, reorder or rename (with a mapping) sections. The protected core sections can't be removed, and the framework template underneath still updates | 07, 36, 03b | Per-project templates without breaking updates | A custom overlay adds a section and survives a template version bump; an overlay that drops a protected section is refused; every agent manifest validates |
| 38 | **Connector contract + `repo` store** (R-M16, R-M15, AR2-27, D5, R2-M5, R2-M13, Q3, R3-M12, V3):<br>• **The contract:** verbs + status map; deterministic actions run in the CLI, MCP only for agent-time reading; the missing verbs added.<br>• **One source of truth** per artifact type.<br>• **Documents reach the integration branch through a docs MR:** the orchestrator commits the documents on a `docs/<initiative>` branch. The docs MR's gate is your signed document approvals plus lint, and **the orchestrator merges it after your signed ticket-set approval** (V3). Documents only, never code.<br>• **External status** is mirrored into a local cache with a last-sync time and is **advisory**; gates use only repo-side proofs.<br>• **Paths:** document paths resolve through the store.<br>• **Connector text** is fenced as untrusted data | 04, 05, 06 | Every document workflow writes through it | The `repo` store passes the contract tests; a stub external store passes them too; a document publish opens a docs MR that the orchestrator merges only after a valid signed ticket-set approval; a docs MR containing a code path is refused; a stale external cache is reported, never trusted by a gate |
| 39 | **`mirai-setup` skill** (Claude only), on top of unit 17's facts:<br>• **Flow:** ledger → interview gaps → write → connect → enforce. Offers the council and BMAD migration via the ledger.<br>• **Business context, sources first** (Q4), with links stored in `resources`; `repos` and `resources` entries (Q3).<br>• **Playwright:** a minimal container-based setup offered only with your yes.<br>• **Journeys:** the first critical-journeys list for your approval (Q6).<br>• **The "what you do by hand" checklist** (PM3-10), printed and stored:<br>&nbsp;&nbsp;1. `claude setup-token` once per machine, with where MIRAI stores the token and the `doctor` warning 30 days before it expires;<br>&nbsp;&nbsp;2. the host push credentials MIRAI's orchestrator uses;<br>&nbsp;&nbsp;3. the signing-key bootstrap and **key backup**;<br>&nbsp;&nbsp;4. `.env.test`;<br>&nbsp;&nbsp;5. the managed-settings choice (default: off);<br>&nbsp;&nbsp;6. the integration branch;<br>&nbsp;&nbsp;7. CI required checks;<br>&nbsp;&nbsp;8. `mirai doctor` until green<br>• **Instruction files (P2):** the ledger lists every agent-instruction file found by unit 17, with its flagged commands, and none loads unreviewed | 17, 35, 36, 38, 13 | First AI-assisted setup on the pilot | Pilot set up; you approve the context; a run with only a pasted text source produces a sourced `business.md`; the checklist is printed with every optional choice's default stated |
| 40 | Agent `mirai-verifier` (Vera). Verifier ladder per unit 19 | 19, 20, 31, 32, 33 | Every document needs it | Finds the seeded defects in a test PRD; findings have citations; the log records the rung |
| 41 | Agent `mirai-product-manager` (Nora). Proposes `business.md` updates on contradictions (Q4); reports `template_gap` instead of new sections (Q2) | 34, 35, 32 | PRD author | Writes a lint-clean PRD-lite from a sample request; a seeded contradiction produces a proposed `business.md` change |
| 42 | Agent `mirai-ticket-planner` (Tess). Sets `e2e: yes` only when a ticket creates or changes a critical journey (`J-n`), and proposes `tdd` per ticket (Q6, Q7) | 34, 33, 36 | Ticket author | A graph-lint-clean ticket set; only the journey-changing ticket in a seeded set gets `e2e: yes` |
| 43 | **`mirai trace`** (R-M10, R2-M11), reached through the broker:<br>• **The chain:** AC → ticket → test (any level, AC-tagged) → QA evidence, honouring `tdd`/`tests`.<br>• **When:** runs locally at ship time. Its result goes into the **ship-time proof** (AR3-15), and CI checks the proof, not the evidence | 33, 08, 09, 25, 15 | Makes SDD checkable without local data in CI | A seeded broken link is reported with its location; a ticket with `tests: optional` isn't flagged for a missing test; the ship-time proof carries the trace result |
| 44 | **`mirai-prd` workflow:**<br>• intake, brief, interview, PRD, lint, verify, fix loop through the loop guard;<br>• **human-only final approval of brief + PRD together** on `standard`;<br>• publish via the docs MR (unit 38);<br>• neutral entry `/mirai-new` (PM-14);<br>• **`pre-commit` hook** (moved from A, PM3-13): a human-only status change needs a matching signed approval (D-17) | 40, 41, 38, 06, 20 | First stage of the lifecycle | A real pilot feature goes request → approved PRD-lite in one approval action; a forged status change is refused at commit |
| 45 | **`mirai-tickets` workflow:**<br>• `standard` track: PRD → ticket set, verifier review, human-only approval of the ticket set, after which the orchestrator merges the docs MR (V3);<br>• **quick track:** one ticket, approve + merge only, plan gate `auto` for normal risk (U4) | 44, 42, 43 | Feeds the build loop | Approved PRD → approved ticket set, trace clean, docs MR merged by the orchestrator; a quick ticket needs two human actions in total |
| 46 | **`mirai inbox` + `mirai unpark <ticket>` + `mirai handover <ticket>`** (R-M2, PM2-14, R3-M4; handover moved from A, PM3-13):<br>• **The inbox:** one screen split into **"needs a decision"** and **"FYI"** (template gaps, cleanup due, known baseline failures); batch plan approval; dispute outcomes.<br>• **Unpark** takes the one choice list from the gates table plus a note.<br>• **`handover`** releases a branch to you, writes a signed **`handover.json`** on the branch so CI sees it (R3-M10, AR3-4), and logs it | 06, 20, 28, 25 | Approvals per feature drop to a few batches | A feature's approvals are done from one screen; unpark without a choice is refused; a `template_gap` appears under FYI; a handed-over branch passes CI as a human branch |
| 47 | `mirai doctor` (full; extends unit 29): install, config, hooks, merge-gate mode, strict bundle and red-team status, auth (with the token expiry), stack health, verifier rungs, test baseline present, `business.md` age, a public-repo warning for `resources`<br>• **Free disk (P6):** reports Docker's free disk and warns below the threshold | 29, 39 | Proves setup | Reports each item green/red with a fix hint on the pilot |
| 48 | **Review refinements + `mirai review <ticket>`** (PM2-2, Q8, R3-M3, PM3-5):<br>• Rex flags **tests at a needlessly high level** and **tests for unchanged code** as out-of-scope findings.<br>• **`mirai review <ticket>`** opens the MR and starts a timer; the merge event stops it, with idle time capped at 30 minutes. This is **your active review time**, the measure the pass marks use | 24, 27 | Quality, and the measurement the B checkpoint needs | A seeded test for an unchanged function and a seeded E2E test for unit-level logic are flagged; `mirai review` logs active minutes per MR |

**Milestone B exit:** see the milestone table. Then the **B checkpoint** (R3-M3, PM3-6): 3–5
supervised pilot tickets.

**B stop rule:** stop and rethink before C if:
- fewer than 40% of those MRs are merged without hand edits (unit 29's M1 script); or
- your active review time (unit 48) is over 30 minutes per ticket.

---

## Milestone C: Overnight (MVP-core)

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 49 | `verify-<app>` generator (part of setup) | 39, 14 | QA needs it | The generated skill starts the pilot in its containers, logs in and takes one screenshot through `run_tests(level: "qa-explore")` |
| 50 | Agent `mirai-qa` (Ivy). The browser runs only in the **Playwright container**. Playwright MCP is for interactive daytime sessions only (Q6). Issue taxonomy per vercel `dogfood` (R-M17) | 19, 49 | QA | Verifies one AC on the running pilot with a screenshot; a headless QA launch has no MCP browser |
| 51 | **`mirai-qa` skill** (R2-M8, U2, Q6, R3-C3):<br>• **Order (U2):** for `e2e: yes` tickets Ivy **writes or updates the E2E test before review** (build → checks → E2E authoring → review → QA). Rex reviews it with the code, so there is one proof.<br>• **Exploratory QA:** a throwaway Playwright script, **passed as content** to `run_tests(level: "qa-explore")`, returning screenshots and output.<br>• **Evidence:** per AC ID, kept in the store and referenced (Q9).<br>• **Journeys:** stable selectors; Ivy may propose a new critical journey.<br>• **E2E protection:** E2E files are protected from Kai; editing them trips the floor guard.<br>• **The QA proof** becomes required by `pre-push` | 50, 43, 23, 24 | QA in the loop | A QA report with evidence per AC; an `e2e: yes` ticket's E2E test is in the reviewed diff; Kai editing it is caught; `mirai trace` sees the evidence |
| 52 | **Environment faults** (R-M5, TL2-17):<br>• preflight before each run and ticket; circuit breaker; flaky test re-run once; API backoff;<br>• **usage-limit pause:** checkpoint, reset time, wait, resume with the same counters; stop and report after `run.stop_by` or on a weekly limit; run state `paused` (unit 04);<br>• timing edge cases (laptop asleep, battery) specified<br>• **Free disk (P6):** checks Docker's free disk before every run and ticket, and stops with a clear message below a threshold<br>• **Flaky re-runs (P8):** uses the baseline's flaky list instead of a single re-run (one re-run of a 50% flaky test still fails about 25% of the time) | 20, 28, 13 | One bad night must not park everything | A stopped stack, a flaky test and a simulated usage limit each behave as specified; a paused run resumes at the simulated reset without new rounds |
| 53 | **Stacking within an epic** (D2, R2-M6, R3-M10, AR3-5):<br>• **Start:** a ticket whose dependency has an open MR starts from that branch; its MR targets the parent; at most 2 levels.<br>• **Trust root and lock** always come from the **integration branch**, never the parent.<br>• **Children never merge into a parent.** The child is rebased after the parent merges, never merged into it.<br>• **After the parent merges:** `git rebase --onto <integration_branch> <recorded-parent-head>`, with the parent head re-recorded whenever the parent changes (survives squash merges). Checks re-run; the proof holds if the code is unchanged.<br>• **Push:** the orchestrator pushes with `--force-with-lease=<branch>:<expected-commit>`, with an explicit expected commit. A grandchild is rebased after its parent, one level at a time.<br>• **Parent changes** → `waiting`; conflicts → parked | 28, 25, 22, 46 | Overnight throughput (R-M9) | A 3-ticket chain builds in one night; a squash-merged parent doesn't park the child; changes on A put B in `waiting`; a depth-3 chain is refused; an attempt to merge a child into its parent is refused |
| 54 | **CI** (R2-C5, TL2-13, R3-M10, TL3-13, AR3-4, AR3-5, AR3-10, AR3-11). Two GitHub Actions jobs:<br>• **`mirai-verify`** runs from the **integration branch's** workflow (`pull_request_target`), even for stacked MRs (never the parent's). It **never executes PR code**, has **minimal permissions** and **no caches**. It checks:<br>&nbsp;&nbsp;– the proofs, recomputed: it **recomputes the normalized-patch hash from the PR head** and checks it matches the signed proofs;<br>&nbsp;&nbsp;– the Ed25519 proofs, approvals, `branch.json` and `handover.json` against the integration branch's public keys and revocation list;<br>&nbsp;&nbsp;– the trace result in the proof;<br>&nbsp;&nbsp;– the framework and workflow against the base lock.<br>• **The test job:** the normal `pull_request` job re-runs the quality gate and the secret scan on `head.sha`, with a **read-only `GITHUB_TOKEN`**. The baseline comes from the integration branch.<br>• **Scope:** both jobs use the same fail-closed scope, read from the committed `branch.json`.<br>• **The required check** is bound to the `mirai-verify` job by name and app, so a PR adding a same-named check can't satisfy it (G11).<br>• **Diff coverage** becomes blocking here, once G7 is settled.<br>• **If the pilot can't require checks,** `doctor` reports "local-only" (R-M21), and D-15 says plainly that your merge is the final gate | 25, 26, 43, 47, 46 | CI must guard unattended nights | An MR whose PR edits the workflow still gets verified by the integration branch's workflow; a proof whose hash doesn't match the recomputed one fails; a forged or revoked-key proof fails; a stacked MR is verified against the integration branch; a handed-over branch passes as human; a human MR without the trailer gets only the secret scan; the G11 facts are settled |
| 55 | **`mirai run`, autonomous preset:**<br>• a multi-ticket queue, with a `mirai run --plan` preview;<br>• **refuses to start** unless `doctor` shows the strict bundle active (no browser MCP), the red-team suite green for the current versions, and the merge-gate mode known;<br>• credentials and push stay with the orchestrator;<br>• overnight covers the build loop only (D6) | 52, 53, 51, 54, 47 | Overnight | An unattended run of 3 small pilot tickets ends in MRs |
| 56 | **Morning report + `mirai metrics`:**<br>• report M1, M3, M4 and M6 first; log all raw fields. M1 comes from unit 29's script;<br>• **your time per MR** is the active review time from `mirai review` (unit 48), with the MR timeline as a secondary upper bound (PM2-5, PM3-5);<br>• **value line:** MRs merged per week via MIRAI and the share merged without edits (PM2-4);<br>• capture point `mirai escape <ticket>` (R-M18);<br>• the report also lists template gaps | 05, 55, 48, 29 | Morning report | The report lists done, parked, waiting, pauses, usage, limit share and the value line; metrics are computed from the store and git |
| 57 | **Calibration run on pilot tickets only** (R-M4, PM2-16):<br>• measure turns, tokens, minutes and limit share per ticket size;<br>• write the **budget** defaults (replacing the provisional caps) and per-step **tier** defaults into the presets;<br>• compare `tdd` on/off tickets;<br>• **pass marks are not set here**; they're fixed below (R2-M2);<br>• the first 5 tickets set the budgets; the next 15 are judged<br>• **Cold starts (P10):** budgets a cold first run (image pull) and about 20–30 seconds of MySQL start-up per hardened test run | 55, 56 | Budgets and tiers were withdrawn until measured | The presets carry measured defaults; the measurement tickets and judged tickets are listed separately |
| 58 | **Tier escalation** (moved from A, R2-M9): applies only to tier-1 (light) steps outside the review rounds. A light step that fails its check twice is retried once on the next tier up | 57, 20 | Only meaningful once tier defaults are measured | A twice-failing light step escalates exactly once; review-round failures never trigger escalation |

**Milestone C exit:** see the milestone table.

---

## Milestone D: Reuse, full track, release (MVP-complete)

The order follows U5 and PM2-7: reuse first, then by how often you'll use each piece. The last two
units are **"when needed"**: build them only when a real multi-repo project or real Cursor use
exists.

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 59 | **Second-project install** (R-M20, U5): install MIRAI on another personal project with a different stack and run one quick-track ticket to MR | 47, 10 | Proves "reusable" (Q1) first | One quick-track ticket reaches an MR on project 2 with no framework edits |
| 60 | **Release record + `mirai-release`, per ticket** (D3):<br>• deploy after your merge, smoke check, your go/no-go for production;<br>• the release state machine is `pending → [staging → verified] → approved → deployed → live \| rolled-back`, and the staging steps are optional (`release.environments`, PM2-18);<br>• the inbox can **batch** go/no-go for tickets merged the same day;<br>• this adds the go/no-go action to the gates table | 28, 51, 46 | Up to live, used on every ticket | A release record for one pilot ticket; a project with no staging goes `pending → approved → deployed → live` |
| 61 | ADR template (MADR 4.0.0-based) + checklist; "Confirmation" names a check ID that `mirai trace` verifies (AR-28) | 31, 43 | `full` track | Required sections linted; supersede links checked |
| 62 | HLD template (arc42 order in our own words + C4 + pilot sections) + checklist | 31, 61 | `full` track | The trace table is linted; the Mermaid check passes |
| 63 | LLD template + checklist | 31, 61 | Epic-level design | The AC-mapped test plan section is linted |
| 64 | Agent `mirai-architect` (Arlo) | 34, 61, 62, 63 | Design author | Writes a lint-clean ADR + HLD for a pilot feature |
| 65 | `mirai-design` workflow (verifier review, human-only final approval; the `full` track keeps the separate brief gate, U4) | 44, 64, 40 | `full` track | Approved PRD → approved ADR(s)/HLD/LLD → `mirai-tickets` |
| 66 | `mirai-change`: versioning, frozen approved versions with drafts beside them, stale detection downstream | 44, 45, 65 | Requirements move | Editing an approved PRD makes a v2 draft; downstream items are flagged stale |
| 67 | **Epic release `release: together`** (D2, D3, R2-M5):<br>• a `feature/<epic>` branch, protected; ticket MRs target it;<br>• **you** merge each one via the inbox (AR2-29), which makes the ticket `integrated`;<br>• then the final E2E (the epic's E2E tests plus one exploratory pass by Ivy), one MR to the integration branch, one release | 60, 53, 51, 04 | Some epics ship as a whole | A 2-ticket pilot epic goes through the feature branch without deadlock, final E2E and one release record; no agent merges any code |
| 68 | **ATDD for high-risk tickets** (Q7): before Kai starts, a separate agent writes the acceptance tests from the ACs at the plan's levels; they start red and are protected from Kai | 23, 51, 21 | Independence where it matters most | On a seeded high-risk ticket the acceptance tests exist and fail before Kai's first commit; editing them trips the floor guard |
| 69 | **Retention: `mirai clean` + `mirai archive`** (Q9, PM2-15, AR2-25):<br>• `clean` lists bulky text older than `retention.days` after merge and deletes only after your yes; parked, stacked or reopened tickets keep everything; structured data is kept;<br>• `archive` moves `superseded`/`obsolete` documents into `archive/`; retired documents are out of agent context either way | 05, 56 | Nothing to delete before about 90 days of use | A seeded 100-day-old merged ticket loses its bulky files after your yes; a parked ticket is untouched; nothing is deleted without a yes |
| 70 | **Updater `mirai update`** (R-M13, R2-M12):<br>• lock diff over `framework` files; `rendered` files re-rendered; `project` files untouched;<br>• 3-way merge with the pinned base version;<br>• **overlays re-applied on new template versions**;<br>• deterministic schema migrations shown before they apply (the v1 → v2 migration test moved here from unit 03, PM3-13);<br>• approve-then-apply | 10, 12, 37 | Before others rely on it | An update with a local overlay shows a 3-way diff and keeps the overlay working; `project` files are untouched; a v1 → v2 config migration is shown, then applied only after a yes |
| 71 | Codex adapter, **as a verifier rung first** (rung 1: a second model family) via its tool profile. Role-to-tool matrix (R-M17) | 19, 40, 11 | Q12 cross-model verification | A Codex verifier run is logged with tokens; the ladder picks rung 1 when Codex is logged in |
| 72 | *When needed:* **Workspace mode** (Q3, R2-C7). MIRAI in a separate workspace repo with several `repos`, and a light install per service repo.<br>• **The proof split:** per-ticket proofs are committed on the **service repo's** ticket branch; documents and approvals live in the workspace repo; each service repo's lock pins the workspace public key and gate config version; `mirai trace` runs from the workspace.<br>• **Config:** two-repo validation (moved from unit 03, PM3-13); each service repo has its own `integration_branch`.<br>• **Tickets:** interface ticket first, with a `contract` test level; one MR per repo.<br>• **Cross-repo E2E and release:** E2E per workspace setting; with `release: together`, one `feature/<epic>` per repo and a recorded release order | 38, 28, 67, 14, 39 | Only when a real multi-repo project exists | A two-repo sample workspace runs one cross-repo epic: interface ticket → one MR per repo with its proofs → cross-repo E2E (`local`) → recorded release order; a two-repo config validates |
| 73 | *When needed:* Cursor adapter: generated `.cursor/hooks.json` or dialect-aware hooks; **duplicate-loading test**; `doctor` reports (AR-25, TL-26) | 71 | Only when you actually use Cursor | Cursor lists each MIRAI skill once; the duplicate behavior is documented |

## Milestone E: Sync-back (MVP-complete)

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 74 | `mirai promote`: move a custom overlay or a new skill into a framework path so `contribute` can carry it (R-M13); it changes the file's lock mark from `project` to `framework` | 70 | New files need a way into the framework | A promoted file appears in the lock as a framework file |
| 75 | **Leak scanner** (R-M14, Q3, R2-M12, R3-M13, AR2-33):<br>• **Detectors:** the setup block list + secret patterns + generic detectors (emails, URLs, ticket-key patterns, proper nouns not in upstream).<br>• **What it scans:** files **and** the final PR title, body and commit messages.<br>• **Block list:** every `resources` link and ID is on it automatically.<br>• **Eligible files:** only `framework`-marked files; `rendered` files only as their framework template, never with project facts.<br>• **MIRAI repo pre-commit** | 39 | Needed before contribute | Seeded project names, paths, ticket keys, resource URLs and secrets are caught in files and in the PR text; a `project`-marked file is refused; a `rendered` file's project block is stripped |
| 76 | `mirai contribute`: builds the contribution branch fresh from upstream with a neutral git identity, runs the scanner last, and shows you the final diff before opening the PR | 74, 75 | Last MVP unit | A framework change from the pilot becomes a clean PR on the MIRAI repo; no project history or identity leaks |

---

## MVP success and kill criteria (R-M19, R2-M2, R3-M3)

These pass marks are **fixed now, from your side**. Calibration sets only the budgets, never the
pass marks (PM2-4). Proposed values come from rounds 2 and 3; you can adjust them at the pilot
checkpoint. Judged on the 15 pilot tickets after the 5 calibration tickets:
- **Value:** at least 60% of MIRAI MRs merged with no hand edits (unit 29's M1 script, from git).
- **Your time:** under 15 minutes of **active review time** per shipped ticket (`mirai review`,
  unit 48; idle capped at 30 minutes). The MR timeline is only a secondary upper bound.
- **Overnight:** at least 2 of 3 overnight tickets shipped per night.
- **Usage:** one night uses **at most 15% of the weekly limit** (limit share) **across all
  projects** (D-57), so 4 nights a week leave at least 40% for your daytime work.
- **Parking:** under 20% of tickets parked.
- **Escapes:** zero escapes on high-risk tickets (`mirai escape`).
- **Safety:** zero blocking-rule violations that got through.

**Stop rules:**
- **Early:** the stop rule at the pilot checkpoint (after Milestone A, unit 30).
- **Value:** the B stop rule at the B checkpoint.
- **Kill / rethink:** if the pass marks are missed on the 15 judged tickets, stop adding units and
  revisit the design before Milestone D.

`04` D-38 must state exactly this list and these stop rules, and must drop "calibration only fills
in the numbers" and "after 20 pilot tickets" (PM3-5).

## Later (not in the MVP; ordered by value)

**From the unit 02 review (P11):** a low-rate flaky test (about 10%) and a flaky PHPUnit test in the sample app, closer to real projects.

1. Parallel lanes: worktrees or isolated compose projects with `seed_files` (R-C5 Architect
   version).
2. External connectors behind the contract from unit 38 (D4).
   - **Candidates:** **ClickUp** (personal tasks), **Jira** (work projects), **Linear** (one
     project). Then Confluence, GitHub Issues, Notion.
   - **The first tracker connector brings the QA ticket comment** (Q9): a tier-0 script posts the
     QA result as a frozen comment, with screenshots uploaded where the tracker's API allows.
3. **`mirai export/import`** to move the store between machines (U3).
4. Codex and Cursor as overnight drivers (not just as verifiers), with their own hooks.
5. Review someone else's MR: Rex's findings as inline comments on GitHub/GitLab, under a clear
   MIRAI marker, ideally from a bot account or app (Q9).
6. Screenshots on MRs, once GitHub's options are verified (`05` §G6).
7. Move a monorepo's docs into a new workspace repo (a helper for the Q3 growth path).
8. Acceptance-test-first for every ticket, widening unit 68 beyond high risk (Q6, Q7).
9. Slack connector and a morning report post.
10. `mirai-retro` and `mirai-eval` (blinded skill evals).
11. `mirai-test-plan` (risk-based test design).
12. Debugger agent and the "council" pattern (deferred; the loop rules replace the council in the
    MVP).
13. Discovery: analyst, research, ideate.
14. UX agent.
15. Per-tool plugins.
16. Per-use confirmation for signing (e.g. a hardware key), on top of unit 06's Ed25519 key.
17. A dedicated macOS user or a container per agent run, if the blocking rules (units 13–18) prove
    insufficient. This is round 3's V1 (b) or (c), and it comes back to you under the V1
    condition.
18. Metrics dashboard.
19. Docs website. It must explain the design reasoning, not just the commands, for example why
    both HLD and ADR exist (Q1).
20. The context pack (round-1 TL-9.3): not adopted for the MVP; revisit if launch bundles grow
    too large (TL2-23).
