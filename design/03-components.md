---
status: draft
version: 5
---

# 03 — Component catalogue

Every part of MIRAI, what it's for, where the idea comes from, and whether it's in the MVP.
- "Notes" refers to the user's notes (`research/01-notes-analysis.md`).
- Prior-art paths are relative to `~/Projects/mirai-sources/`.
- Row numbers like `#20` point to `research/05-reuse-matrix.md`.
- "R-…" points to themes in `06-review-round-1.md`. "D-…" points to `04-decisions.md`.
- "Q…" in version 3 points to `08-followup-discussion.md`.
- "R2-…" and "U1–U5" in version 4 point to `06-review-round-2.md` (themes and your decisions in its
  section G).
- "R3-…" and "V1–V3" in version 5 point to `06-review-round-3.md` (themes in section B, your
  decisions in section D). Version 5 also aligns the MVP column with `07` v5.
- "`main`" below means **the integration branch**, `[git] integration_branch` (D-15); on the
  pilot that's `mirai/pilot` (D-28).

**MVP column:**
- **A–E** is the milestone that brings the component in (see `07`).
- **MVP-core** = Milestones A–C. **MVP-complete** = Milestones D–E.
- Milestones A–C run on **Claude Code only** (D-32).

**Naming** (Q11):
- Agents have a persona display name and a functional file name.
- Skills, workflows, templates and scripts have functional names only.
- Everything starts with `mirai-`.
- Persona names are kept for now and can change later (section G of `06`).

---

## 0. Glossary

| Term | Meaning |
|---|---|
| **Integration branch** | `[git] integration_branch`: the branch MIRAI treats as "main" for trust roots, ticket bases, MR targets, the docs MR, the baseline and CI's base. Default: the host's default branch; `mirai/pilot` on the pilot (D-15, D-28). |
| **MIRAI home** | `~/Library/Application Support/mirai/<repo-id>/`, outside the project, split by trust: `store/` (denied to agents), `bundle/<sha>/` (the trust root; readable, write-denied, immutable flag), `hooks/`, `input/<launch>/`, `scratch/<run>/`, `gitconfig`, `tmp/` (D-47). |
| **Trust root** | `bundle/<base-sha>/` in the MIRAI home: a read-only snapshot and render of framework, config, custom files, generated tool files and the compose inputs, taken *from the integration branch* (never a stacked parent) at run start. Re-hashed before every launch. Every launch, hook and gate uses it, never the working copy (D-15, D-47). |
| **MIRAI MCP broker** | The one channel from a sandboxed session to MIRAI: `log_event`, `start_agent`/`agent_status` (your session only), `session_start`/`session_end`, `lint`, `trace`. No sandboxed process calls `mirai` (D-53). |
| **Input folder** | `input/<launch>/` in the MIRAI home: the read-only files one launch needs (plan, delta diff, findings, ACs), allowed for that launch only. Outputs come back as structured output (D-12). |
| **Named checks** | `lint`, `types`, `build`, `gate`, …: the project's quality-gate steps, configured by name in the trust-root config and run only through `run_tests` (D-48). |
| **Signed gate-result record** | The orchestrator's signed result of the named checks, bound to the code hash. `pre-push` and CI verify it instead of re-running suites (D-16). |
| **`branch.json` / `handover.json`** | Signed, committed records under `.mirai/records/<ticket>/`: the branch registration (first commit) and the hand-over to you. They make the fail-closed gate scope visible to CI (D-15, D-50). |
| **Lock marks** | `framework` (copied, 3-way merged, contributable), `rendered` (generated, re-rendered, never contributed), `project` (yours) (D-37). |
| **Strict settings bundle** | `<trust-root>/strict.json` (one per role) plus `mcp.json` (headless: `run_tests` and the broker's `log_event` only): the sandbox, deny rules and hooks passed to every Claude Code launch, with user, project and local settings, memory and skills switched off (D-12, D-30). |
| **Protected paths** | `.mirai/**` (incl. `keys/`, `records/`), tool dirs, CI files, git hooks, lint/test configs, compose files, Dockerfiles, `.env*`, any new or changed `CLAUDE.md`/`AGENTS.md`, E2E files for anyone but QA, files that hide code (`.gitattributes`, `.gitignore`, `.gitmodules`, `.lfsconfig`, `CODEOWNERS`), auto-run config (`.claude/`, `.vscode/`, `.idea/`, `.envrc`, `.devcontainer/`, `.husky/`, `.mcp.json`, `package.json` scripts) and dependency manifests. A diff touching them is `high` risk; declared at plan time it's approved at the plan gate, undeclared it parks. Auto-run config parks in both presets (D-15, D-54). |
| **Orchestrator store** | `store/` in the MIRAI home, **outside the project** and denied to agents: run state, ticket status (`tickets/<t>/status.json`, the only status home), counters, ledger, parking, run lock, the local branch index, baseline, reports, work files, metrics, `config.user.toml`, cache. Never committed (D-06, D-47). |
| **Branch-carried facts** | Documents, signed approvals and records that travel with the MR (D-06). |
| **Patch-id record** | A signed review or QA proof bound to MIRAI's own SHA-256 over a **normalized patch** of the code paths (E2E files included; no blob ids or hunk line numbers), minted at ship, stored as one immutable file (D-16). |
| **Loop guard** | The shared library every fix loop uses: rounds, ledger, fingerprints, progress check, parking (D-18). |
| **Parked** | A ticket stopped with a reason, waiting for you. Released with `mirai unpark` (D-34). |
| **Stacking** | A ticket starting from its dependency's unmerged branch, within one epic, at most depth 2; rebased with `--onto` when the parent merges (D-24). |
| **`waiting` / `integrated`** | Ticket states: `waiting` = a stacked child whose parent changed (or a cross-repo dependency); `integrated` = merged into `feature/<epic>`, derived, and enough for `after` inside the epic (D-07). All ticket status lives in the store (D-06). |
| **Run states** | `running → paused → stopped \| finished`. `paused` waits for a usage-limit reset (D-07, D-18). |
| **`run_tests(level, path?, script?)`** | The MIRAI MCP tool agents use to run tests and named checks: structured arguments, no shell, a frozen and validated compose file from the trust root, `.git` and real `.env*` masked, results returned inline (JUnit XML, coverage, text, images). Levels include `qa-explore`, whose script is passed as content (D-48). |
| **`release: per-ticket \| together`** | The per-epic release mode. `together` uses `feature/<epic>` and a final E2E (D-33). |
| **Rung** | A step on the verifier model ladder (D-14). |
| **Track** | `quick`, `standard` or `full` (D-08). |
| **Model tier** | `0` no AI · `1` light · `2` standard · `3` deep. Config maps tiers to models (D-14). |
| **Template gap** | An agent's report that something important doesn't fit the template. Logged, never acted on by adding a section (D-41). |
| **Workspace repo** | In a multi-repo project, the repo that holds MIRAI's config, docs, tickets and run state and points to the service repos (D-42). |
| **Critical journey** | A user flow where a break loses users or money. Only these get E2E tests (D-44). |
| **Test baseline** | The tests that already fail or are flaky when MIRAI is installed. The gate blocks only new failures (D-45). |
| **`Mirai-Ticket` trailer** | The commit trailer the orchestrator writes on every MIRAI commit (agents can't commit). A branch is MIRAI-scoped if any commit has the trailer, a valid `branch.json` exists, or the committer is the MIRAI identity; in scope, every commit must carry the trailer. Fails closed locally and in CI (D-15, D-50). Docs commits carry `Mirai-Docs: <initiative>`. |
| **`mirai handover`** | Releases a MIRAI branch to you by hand: commits a signed `handover.json`; CI then checks only the secret scan beyond `at_sha` (D-50). |
| **Critical journey ID** | `J-n`, carried by E2E tests alongside AC IDs (D-35). |
| **Retention rule** | How long a local work file is kept before it may be deleted: 90 days after merge by default (D-46). |

## 1. Foundation (scripts and data formats)

The foundation is code, not prompts. **Runtime: Node.js, no npm dependencies** (D-04). Every
machine-written file is JSON (D-40).

| Name | Purpose | Prior art | MVP |
|---|---|---|---|
| `mirai` CLI | The single entry point for every deterministic action. **Setup:** `init`, `update`, `doctor`. **State:** `status`, `resume`, `log`, `trace`, `show <ticket>`. **Runs:** `run` (with `--plan`), `agent run`, `session start/end` (from a sandboxed session these are reached only through the MIRAI MCP broker, D-53). **Human:** `inbox`, `approve` (optional one-line reason on edit/reject), `feedback <ticket> "<text>"`, `drop`, `unpark` (re-plan / retry / drop), `handover`, `escape`, `review <ticket>` (opens the MR and times your active review, D-38), `key add \| rotate \| revoke` (D-17). **Gate:** `gate`, `lint`. **Output:** `report`, `metrics`, `release`. No sandboxed process calls `mirai` directly (`Bash(mirai *)` is denied, D-30). **Housekeeping:** `clean`, `archive`. **Sync-back:** `promote`, `contribute`. | BMAD `setup.py`, `tickets.py`; pstack `orch/`; bmad-loop CLI | A (commands arrive with their milestone) |
| Config model | `.mirai/config.toml` (project, committed) ← `config.user.toml` (personal, in the orchestrator store outside the project, D-47) ← `.mirai/custom/<skill>.toml` (per-skill overrides). Schema migrations are deterministic and shown to you before they apply (D-21). Schema-checked and versioned; a missing key stops the run instead of guessing. Holds:
- storage per artifact type (`repo` or `external:<tool>`, D-06);
- `repos` (name, path, remote URL, start + health commands; one entry `.` for a monorepo) and `resources` links, never credentials, committed for now with a `doctor` warning on public repos (D-42, D-29);
- model tier mapping `light / standard / deep` (D-14);
- `tdd` (`auto`/`on`/`off`) and `tests` (`required`/`optional`) (D-23);
- test levels per repo: command, test-adapter contract (one file or test ID, JUnit XML, lcov/Cobertura), purpose, when required, time budget; the E2E suite budget (D-44, D-45, D-48);
- the compose files `run_tests` may use and the `.env.test` path (D-48, D-49);
- `[git] integration_branch` (default: the host's default branch; `mirai/pilot` on the pilot) (D-15, D-28);
- the project's branch naming pattern and the commit trailer format (D-15);
- **named checks** (`lint`, `types`, `build`, `gate`, …) translated by setup from the project's gate script (D-48);
- `[gate] code_paths`, risk paths, `release` per epic, cross-repo E2E mode (D-42);
- retention days and the optional metrics compaction (D-46). | BMAD three layers + merge rules (`bmod-core-tools/help/customization.md:41-47`); "missing keys halt" (`CHANGELOG.md:73`); pstack role lines with defaults (`setup-pstack/SKILL.md:39-66`) | A |
| Status model | Document, ticket, release and run states, allowed moves, and which moves are human-only (`02`). Includes the round-1 moves (R-M12), `waiting`, `integrated`, `obsolete`, a release machine `pending → [staging → verified] → approved → deployed → live | rolled-back` (staging optional), and the run machine (D-07). Each document type's machine comes from its definition (D-37). **Ticket status home:** one only, `store/tickets/<t>/status.json`; ticket files carry no `status` field; derived facts are timestamped journal observations, and merged into the integration branch (`done`) or `feature/<epic>` (`integrated`) always wins; a tracker is a one-way mirror (D-06). Until the registry exists, the document and ticket machines are hard-coded (D-37). | `bmad-method/tools/ticket-tree-rules.md:21-35`; Addy ADR lifecycle; pilot template statuses (inconsistent, `research/04` §3) | A |
| Run log | JSON lines with `{schema_version, run_id, seq, ts, item, by}` on every line. Logs live only in the orchestrator store; no lines are committed or exported into MRs (D-29, U3). Written only by the CLI, append-only. `mirai log` refuses privileged event types (D-17). Every run line carries `tier` and `model` (D-14); `template_gap` is an event type (D-41). | BMAD `memlog.py` (O_APPEND, blind writes); bmad-loop `journal.jsonl`; pstack `show-me-your-work` + `log.sh` | A |
| Orchestrator store | `store/` in the MIRAI home (`~/Library/Application Support/mirai/<repo-id>/`), outside the project, denied to agents by the sandbox and deny rules: `state.json`, `journal.jsonl`, `heartbeat.json`, ledger, parking notes, run lock, `branches.json` (the local index of registered branches), ticket status, baseline, reports, cache, `config.user.toml`, and the per-ticket work files: plans, review findings, QA reports, evidence, transcripts, captured verdicts, frozen compose files. Agents never read or write it: inputs come through the input folder, outputs as structured output or broker calls (D-12, D-53). Never committed. Bulky files follow the retention rule; structured finding and metrics data is kept (D-29, D-46, D-47). In a multi-repo workspace it belongs to the workspace repo (D-42). One machine in the MVP (D-52). | bmad-loop `state.json` + `journal.jsonl` + `heartbeat.json` | A |
| Trust root + strict settings bundle | `bundle/<base-sha>/` in the MIRAI home: a snapshot from the integration branch, hashed, readable by agents but write-denied (sandbox, `Edit` deny, `chflags uchg`); re-hashed before every launch, and the hook shim checks its target's hash on every call. Renders the launch bundle: plugin dir, system prompt file, one `strict.json` per role, `mcp.json` (headless: `run_tests` + `log_event`; interactive: `run_tests` + the broker), the pinned compose inputs, with `.mirai/custom/` overlays merged in as a content-hashed snapshot. The same render produces your interactive `.claude/` files; committed rendered files are never inputs to a headless run (D-12, D-21, D-37). | BMAD `render_skill.py` merge rules; `research/09` §7 | A |
| Signing | **Ed25519** via Node's built-in `crypto`. Private key per machine in `~/.config/mirai/` (optionally the Keychain), denied to agents (D-30). Public keys committed in `.mirai/keys/<machine>.pub`; the first one lands in the `init` commit you push by hand; later changes only through a key MR (`mirai key add \| rotate \| revoke`); revocation by `keys/<machine>.revoked`. Signatures carry `{key_id, ts}`. CI verifies with the base commit's keys. Approvals sign the document's content hash; the plan approval signs the frozen block's hash; proofs sign the code-change hash and trace result (D-17). | none (build new) | A |
| Records | Immutable signed files under `.mirai/records/<ticket>/`: proofs `<kind>-r<n>-<hash>.json`, bound to SHA-256 over a **normalized patch** of the code paths (E2E files included) and minted at ship with `base_sha`, `trust_root_hash`, `framework_version` and rung/model; the **signed gate-result record** `gate-r<n>-<hash>.json`; `branch.json`; `handover.json`. A proof holds no findings. Written by the CLI from verdicts the launcher captured from structured output, never from a work-tree file (D-15, D-16). Sandbox- and `Edit`-denied to agents. In a workspace, proofs live in the service repo (D-51). Pointer files for external documents. | pilot `mark-review-complete.sh` + `stop-quality-gate.sh`; pstack shipping `git patch-id` idea (`playbooks/shipping.md`) | A |
| Agent launcher (`mirai agent run`) | Starts any agent headless with the launch bundle: re-hashes the trust root, picks the model tier per step (raised by risk and size) and the verifier rung, sets turn/time limits, scrubs the environment, captures the structured verdict into the store, checks the role's write scope afterwards, writes the run-log line (tokens, turns, minutes, dollar estimate, share of the usage limit, verdict). Detach-and-wait for supervised launches through the broker (`start_agent` / `agent_status`). Renders the per-launch input folder, runs reviewers on a clean export with the integration branch's instruction files, passes an allowlisted environment, starts each agent in its own process group and kills it after. Native subagents (Task tool) and `claude` from Bash denied. A one-time launch token minted inside the broker or orchestrator replaces the env-var depth guard (D-12, D-53). | bmad-loop profiles (`data/profiles/claude.toml`) without `bypassPermissions`; pstack model roles | A |
| Loop guard | Shared by every fix loop (documents and code): round counter, budget ledger (turns, tokens, minutes, dollar estimate), finding fingerprints (file + symbol), strict-progress check, parking-note writer, and one tier escalation for light (tier-1) steps after two failed checks (D-14; the escalation arrives in C). Counters saved before each launch; `resume` never resets them (D-18). | bmad-loop `escalation.py`, `policy.toml`; BMAD TEA `run-and-heal.md:28` | A (escalation: C) |
| Orchestrator (`mirai run`) | Fixed state machine per ticket (plan → build → checks → E2E written when `e2e: yes` → review → QA → ship) and a run state machine (`running → paused → stopped \| finished`). Uses the loop guard, preflight, a circuit breaker for environment faults, usage-limit pause and resume, checkpoint refs, a run lock, idempotent MR creation and `caffeinate`. **The only committer:** commits at stub / tests / build / fix round / E2E with the trailer, checks the process group is gone and the status hash unchanged first, registers its branches with a signed `branch.json`, commits documents on the docs branch via `git commit-tree`, and merges the docs MR after your ticket-set approval (D-50, D-56). Runs the named checks and writes the signed gate-result record (D-16). Runs host git pinned and integrity-checked (D-54). **One checkout with branch switching**, ending every run on the integration branch with a clean tree; stacking within an epic (depth 2, `rebase --onto`, `--force-with-lease=<branch>:<sha>`, cascade; never merged into a parent); `--plan` previews the night and flags protected-path tickets (D-18, D-24). | bmad-loop `statemachine.py:25-65`, `escalation.py`, `policy.toml`; pstack `playbooks/orchestrate.md`, `autonomous-run.md` | Supervised: A; autonomous: C |
| `run_tests(level, path?, script?)` MCP tool | Replaces version 3's `mirai exec test`. The only way agents run tests **and named checks** (`lint`, `types`, `build`, `gate`): a small MIRAI MCP server from the trust root with structured arguments and no shell; unconfigured names refused; `path` allowlisted by pattern and `realpath`, passed after `--`; `qa-explore` scripts passed as content; `execFile` with a minimal environment. **Resolve once, freeze, run the frozen file** with an allowlist validator (image, command, `.env.test`, project source with **`.git` and real `.env*` masked**, one internal network, no DNS out), a unique compose project name per run, `--no-build --pull never`, `docker inspect` after start. Results returned inline (JUnit XML, coverage, capped text, screenshots as MCP images). `e2e` and `qa-explore` run in the official Playwright container. Agents never install dependencies; the orchestrator does, from the integration branch's manifests (D-48, D-49). The sandbox has no `excludedCommands`. | pilot `scripts/quality-gate.sh` (`docker compose exec`) | A |
| MIRAI MCP broker | The one channel from a sandboxed session to MIRAI (D-53): `log_event` (no privileged types), `start_agent` / `agent_status` (your interactive session only; the launch token stays inside), `session_start` / `session_end`, `lint`, `trace` (read-only). Headless `mcp.json` gets only `run_tests` and `log_event`. | none (build new) | A |
| Git integrity check | Hashes `.git/config`, `.git/info/**`, the `.git/hooks/` listing and the ref list before every git call and before and after every agent launch and `run_tests` call; a change stops the run. Host git pinned (`GIT_CONFIG_NOSYSTEM=1`, MIRAI's `GIT_CONFIG_GLOBAL`, `-c` pins, `--no-ext-diff --no-textconv`, explicit push URL) (D-54). | none (build new) | A |
| `mirai inbox` | One terminal screen with everything waiting for you: document approvals, plan batches with a short review packet (protected-path declarations and new dependencies shown), parked tickets (unpark: re-plan / retry / drop), disputes, MRs into `feature/<epic>` for you to merge, stacked MRs marked "do not merge until retargeted", template gaps. No separate `ship` gate: your merge is the gate (D-34, D-41). | none (build new) | B |
| Lints | `mirai lint prd|design|tickets|plan|context`: required sections, unknown headings rejected, protected core sections present (D-41), IDs, links, Mermaid check (fenced + keyword + balanced brackets), dependency graph, FR closure. | BMAD `lint_spine.py`, `tickets.py` diagnostics; pstack `check-plan.mjs` | A (plan), B (docs) |
| `mirai trace` | Checks the ID chain `BR → FR/NFR → AC-FR-n.m → ticket covers_ac → tests (AC IDs, `J-n` for E2E) → QA evidence`, per the ticket's `tdd`/`tests` settings, NFR verification methods and ADR Confirmation check IDs. Runs locally at ship time; its result goes into the signed proof, which CI checks (D-35). | BMAD TEA trace step (logic) | B |
| Floor guard | Flags weakened or deleted tests, new skips and suppressions, lowered thresholds, diffs on protected paths (incl. compose/Docker/`.env*` and new `CLAUDE.md`/`AGENTS.md`), and developer changes to E2E files (D-15, D-44). | Addy `constraint-driven-development/references/floor-guard.md` | A |
| Secret scan | Blocks secrets in `pre-push` and again in CI's test job (D-30). Zero-dependency patterns, the exact value of the Claude login token and its base64, base64url, hex and reversed forms, and an entropy rule on new files (D-30, D-49). | none (build new); patterns shared with the leak scanner | A |
| `mirai show <ticket>` | Shows a ticket's local work files: plans, review rounds, QA table, parking notes (D-29). | none (build new) | A |
| `mirai clean` / `mirai archive` | `clean` lists local files past the retention rule and the space freed, then deletes on your yes; auto-delete is off by default. `archive` moves retired documents to `archive/`, only when you run it (D-46). | none (build new) | D |
| `mirai handover <ticket>` | Gives a MIRAI branch to you: commits a signed `handover.json`, MIRAI gates off beyond `at_sha` (CI checks only the secret scan), ticket leaves the queue (D-50). | none (build new) | B |
| Registry (D-37) | Loads document types, agents and adapters from schema-checked definitions; the status model reads each document type's state machine from it. The core lands with the config model; the content and overlays come with the templates. | bmad-loop `data/profiles/*.toml` | A (core), B (content) |
| Leak scanner | Blocks project-identifying content in `mirai contribute` and in MIRAI's own pre-commit. Scans the final PR title, body and commits; generic detectors plus the block list, which includes the internal URLs and IDs from `resources` (D-21, D-42). | none (build new); pattern ideas from BMAD `scan_scripts.py` | E |

## 2. Tool adapters and installer

| Name | Purpose | Prior art | MVP |
|---|---|---|---|
| Installer (`mirai init`) | `npx github:<owner>/mirai#vX.Y.Z`. Copies a pinned framework version into `.mirai/framework/`, writes `mirai.lock` (version + hashes of framework *and* generated tool files), marks every file `framework`, `rendered` or `project` in the lock (D-37), runs the adapter, creates the MIRAI home outside the project, installs git hooks into it and writes `core.hooksPath` into `.git/config` (covered by the integrity hash, D-54), records the first git-integrity hash, generates the Ed25519 key pair if missing and puts the public key in the `init` commit you push by hand (D-17). | BMAD `setup.py` staging + atomic replace (`:2226-2314`) | A |
| Updater (`mirai update`) | Lock-hash diff with a 3-way merge (base from the pinned version) for `framework` files; `rendered` files re-rendered (drift flagged); `project` files untouched; custom template overlays re-applied on the new framework template; versioned config/state schemas with deterministic migration scripts shown as a diff; applies on yes (D-21). | BMAD `retired.toml`, `migration-N.toml`, `references/migrate.md:7` | D |
| Shared instructions | A small MIRAI-managed block in `AGENTS.md`, which all three tools read, rendered from a framework block plus `.mirai/context/agents-local.md` (lock mark `rendered`, D-37). Kept well under Codex's 32 KiB cap and about 200 lines. | `research/08` §5.1; BMAD managed `AGENTS.md` block | A |
| Adapter: Claude Code | A profile file (D-37). `CLAUDE.md` containing `@AGENTS.md`; `.claude/skills/<name>/SKILL.md`; `.claude/agents/<name>.md`; `.claude/settings.json` for your interactive sessions (sandbox on, deny rules, `ask` outside the project). **Headless** (subscription, no `--bare`): `claude -p --restricted --settings <trust-root>/strict.json --strict-mcp-config --mcp-config <trust-root>/mcp.json --permission-mode dontAsk --permission-prompts none --max-turns N --output-format stream-json`, with no user, project or local settings, memory or skills (fallback if `--restricted` doesn't fit: `CLAUDE_CONFIG_DIR=<mirai-home>/claude-home` plus a source list without `user`; UNVERIFIED, `research/09` §8), an allowlisted environment with `CLAUDE_CODE_OAUTH_TOKEN` and no `ANTHROPIC_API_KEY`; auth checked in every launch's init event. Interactive `.claude/` files are rendered from the same bundle (D-12). | `research/08` §2, §5.2; `research/09` §2–§5; pstack `docs/harness/claude-code.md`; pilot `.claude/` | A |
| Adapter: Codex | `.agents/skills/<name>/SKILL.md`; `.codex/agents/<name>.toml`; `.codex/config.toml` (sandbox, `[mcp_servers]`); `.codex/hooks.json` (needs user trust). Headless: `codex exec --json --output-schema --sandbox workspace-write`, network off. First used as verifier rung 1. | `research/08` §3, §5.2, §5.4 | D |
| Adapter: Cursor | No extra skill files (Cursor reads `.agents/skills` and `.claude/skills`); `.cursor/agents/` only if needed; `.cursor/cli.json` permissions; generated `.cursor/hooks.json` or dialect-aware hook scripts so Cursor doesn't run Claude's hooks wrongly. Headless: `agent -p --force --trust --sandbox enabled`, wrapped in `timeout`. Turn off third-party config import on the orchestrator machine. | `research/08` §4, §5.2, §5.4 | D |
| Managed settings (optional) | Setup offers to install `/Library/Application Support/ClaudeCode/managed-settings.json` with the managed-only locks. Needs admin rights and your approval. Default off; `doctor` shows it as "recommended" before the first overnight run. | `research/09` §2 | C (offered before autonomous) |
| Per-tool plugins | Thin plugin wrapper around the same files | pstack, BMAD plugins | Later |

## 3. Enforcement (gates and blocking rules)

| Name | Purpose | Prior art | MVP |
|---|---|---|---|
| `mirai-gate` git hooks | Installed in `<mirai-home>/<repo-id>/hooks/`, hash-checked against the integration branch's `mirai.lock`, run from the trust root; `core.hooksPath` written by `init` and covered by the git-integrity hash; host git pinned (D-54). `pre-commit`: frontmatter checks; a human-only change only with a signed approval event. `pre-push` **runs no project code**: it verifies the patch-id review (and QA, once it exists) record for the current change, the **signed gate-result record** ("nothing new broke" against the store's test baseline, diff coverage on changed lines, D-45), and the secret scan. Scope fails closed: trailer, `branch.json` or MIRAI committer identity puts a branch in scope, and every commit in scope must carry the trailer; a missing local index blocks trailer branches until `doctor` repairs it; unregistered human branches are untouched, and the secret scan is offered to everyone (D-15, D-50). Milestone A's own pushes satisfy the same rule (see `07`). | pilot `stop-quality-gate.sh` logic, moved to git | A |
| CI job template | **Two jobs** (D-15): **`mirai-verify`** runs from the base branch's workflow (`pull_request_target`), never executes PR code, **recomputes the normalized-patch hash from the PR head** (code paths from the base config), and checks Ed25519 signatures with the base commit's keys, the proofs, the gate-result record, `branch.json`/`handover.json`, key-MR rules and the lock hashes; `permissions: contents: read, statuses: write`; base checkout with `persist-credentials: false`; no caches. **The test job** checks out `pull_request.head.sha`, re-runs the named checks and the secret scan with no secrets and `permissions: contents: read`, against its own baseline on the merge-base. Stacked MRs are verified against the stack root and count only after retargeting; required checks only on the integration branch and `feature/*`. `doctor` reports "CI-enforced / local-only" and that your merge is the final gate. GitHub event details UNVERIFIED (G11). | pilot `scripts/quality-gate.sh` | C |
| Blocking-rules layer | The strict settings bundle (D-30): sandbox on with `allowUnsandboxedCommands: false`, **no `excludedCommands`**, `allowUnixSockets` empty; "outside the project" written with sandbox `denyRead`/`allowRead` (project, toolchain caches, `bundle/`, the launch's `input/`), explicit `denyRead`/`denyWrite` on `store/`, `~/.config/mirai` and each real `.env*`; **`denyWrite` on `.git/**`, `.mirai/keys/**`, `.mirai/records/**`** (and the whole project for read-only roles); an **empty headless network allowlist** (G16); `Read`/`Edit` denies naming the store, key and credential folders, `.env*`, records, keys, `bundle/`; deny on `git push`, `git commit`, `git config`, `gh`, `docker`, `claude`, `mirai`, `env`/`printenv`, `WebFetch`/`WebSearch` and the Task tool in headless runs; tests and named checks only via `run_tests`; no Playwright MCP in headless runs (D-44); an allowlisted environment; test containers without outside network or DNS, with dummy secrets and `.git`/`.env*` masked (D-49). **No headless launch without a green red-team suite** (the single list in D-30). | `research/09` §7; pilot `settings.json` denies | A |
| Claude Code hooks | Loaded from the trust root through a fixed shim that checks the target's hash on every call. Blocking (exit 2): a **path hook on `Read`/`Edit`/`Write`/`MultiEdit`/`NotebookEdit`** that `realpath`s the target and denies anything outside the project or inside `.git/`, `.env*` (except `.env.test`), `.mirai/keys/` or `.mirai/records/` (closes the symlink route, G17); secret patterns and the login token (plain and encoded) in Write/Edit; Glob/Grep outside the project. Feedback: an edit makes the current record stale, the reviewer verdict is captured from the reviewer's structured output by the launcher, a stop gate, a read-only guard for reviewers. | pilot `on-file-change.sh`, `mark-review-complete.sh`, `stop-quality-gate.sh`, `reviewer-bash-guard.sh` | A |
| Codex / Cursor hooks | Same where the tool supports it; otherwise git/CI only. They fail open, so they are never the gate (D-15). | `research/08` | Later (as available) |

## 4. Agents (personas)

An agent is a persona plus a role contract: what it does, what it may touch, what it hands off. It
**follows skills**; the behavior lives in skills (BMAD lesson X4: "personas add little" when
behavior lives in them). Personas are limited to a name and 1–2 lines of style (Q11). Each agent is
a definition file with a schema: role, `may write` scope, allowed tools, default model tier (D-14,
D-37). The tier is raised per step by risk and size. The
launcher enforces `may write` after every run (D-12).

| File name | Persona | Role | May write | Prior art | MVP |
|---|---|---|---|---|---|
| `mirai-product-manager` | **Nora** | Intake, interview, business brief, PRD; proposes `business.md` updates when a request contradicts it (D-43) | business brief, PRD, its replies to findings | `bmad-agent-pm/`, `bmad-prd/`; notes PM agent (#2) | B |
| `mirai-architect` | **Arlo** | HLD, ADRs, LLDs | design docs | `bmad-agent-architect/`, `bmad-architecture/`; pstack `architect`; notes Architect (#3) | D |
| `mirai-ticket-planner` | **Tess** | Epics, stories, bugs, dependencies, risk, size, `repo`, `e2e`, `tdd` proposal, release mode proposal | tickets | `bmad-ticket/`; Addy `planning-and-task-breakdown`; notes Create Tickets (#10) | B |
| `mirai-developer` | **Kai** | Plan, build (TDD per `tdd`, with a stub step before red for new code), characterization tests for changed code in untested areas, fixes; runs tests and named checks only through `run_tests`; can't install packages or run generators (a new dependency is declared in the plan and approved at the plan gate) | code, unit/integration tests; the plan's agent sections come back as structured output (never protected paths beyond those declared and approved, never E2E files; never commits) | `bmad-build/`; pilot `developer`; notes Developer (#5) | A |
| `mirai-reviewer` | **Rex** | Code review lenses (quick or thorough by risk), including the E2E test Ivy wrote, on a clean export of the committed head with the integration branch's instruction files, diff with `--text --no-textconv --no-ext-diff`; flags tests at a needlessly high level and tests for unchanged code | nothing: sandbox `denyWrite` on the project; findings and verdict go out as structured output, kept local | `bmad-code-review/`; pilot reviewers; pstack `interrogate`; notes Code Review (#24) | A |
| `mirai-qa` | **Ivy** | Writes and updates E2E tests for critical journeys (`e2e: yes`) **after the build and before review**, so Rex reviews them (U2); then verification on the running app via `run_tests` (`e2e`, `qa-explore`), evidence per AC ID; final E2E for `release: together`; staging check | QA verdict and QA table (structured output) + evidence (returned inline by `run_tests`, stored locally), E2E test files; `qa-explore` scripts passed to `run_tests` as content | pstack verification skills; vercel `dogfood` taxonomy and report shape (logic); notes QA (#15, #25) | C |
| `mirai-verifier` | **Vera** | Checks brief, PRD, design docs and tickets against the doc type's checklist before your approval; input reconciliation | nothing: sandbox `denyWrite` on the project; findings go out as structured output | `bmad-prd` reviewer gate + rubric; `bmad-architecture` reviewer gate; `bmad-ticket/references/validate.md`; your "another agent verifies" (Q4) | B |
| `mirai-analyst` | — | Discovery, market and domain research | research docs | `bmad-agent-analyst/`, `bmad-deep-recon/` (#1, #27) | Later |
| `mirai-ux` | — | UX design docs | UX docs | `bmad-ux/` (#4) | Later |
| `mirai-debugger` | — | Evidence-first bug investigation | investigation notes | pstack `bug-fix.md`, `why`; superpowers `systematic-debugging` (#21) | Later (D-39) |
| `mirai-data` | — | Read-only data questions | none | (#8) | Later |

**Why one verifier, not one per document type** (D-13): the expertise lives in the checklist for
each document type. One agent file is easier to keep sharp, and the metrics are still split per
stage, because every log line carries `stage`. If the metrics show the verifier is weak on one
document type, that type gets its own agent. The verifier never gives final approval; you do
(D-34).

**Role-to-tool matrix** (D-32): in Milestones A–C every role runs on Claude Code. Overnight covers
developer, reviewer and QA only. Codex joins at D as verifier rung 1; it can't run QA (network-off
sandbox). QA overnight uses the Playwright container through `run_tests` (`e2e`, `qa-explore`),
never Playwright MCP (D-44, D-48).

**Verifier ladder** (D-14): a different model family where available, otherwise a different Claude
model of a comparable tier (e.g. Fable vs Opus), otherwise the same model in fresh context, logged
as such.

## 5. Skills (procedures)

| Name | Purpose | Used by | Prior art | MVP |
|---|---|---|---|---|
| `mirai-setup` | Detect (a script, no AI: stack, `repos`, test levels, named checks from the gate script, test baseline, branch pattern, real `.env*` paths, compose mounts) → ledger → business sources → interview gaps → config + context (`business.md`, critical journeys, `resources`) → storage per artifact type → verify skill → enforcement (MIRAI home outside the project, hooks, git-integrity hash, Ed25519 keys, strict settings bundle, `run_tests` server and broker, pinned compose inputs, `.env.test`, `worktree_safe` check) → doctor (D-42, D-43, D-45, D-47, D-48, D-49, D-55). Ends with a "what you do by hand" checklist | you | `bmad-project-context/`; pstack `create-verification-skill`; BMAD `bmad setup` (#40, #11) | A (detection script), B (skill) |
| `mirai-doctor` | Health check of install, config, the integration branch (carries the lock, public keys and CI workflow), the MIRAI home and its permissions, hooks and the git-integrity hash, CI ("CI-enforced / local-only"; your merge is the final gate), active keys and fingerprints, blocking rules and red-team status (re-run after every update), `run_tests` resolved-config check, `claude auth status`, connectors, verifier rungs, context freshness (including the age of `business.md`), public-repo warning for `resources`, "one machine" note (D-52); one smoke run | you, setup | pstack Benny fresh-agent check (`setup-benny/SKILL.md:48-61`) (#13) | A (minimal), B (full) |
| `mirai-interview` | One question at a time with a guess, confidence, want vs should-want, restatement, explicit yes | setup, product-manager | `addyosmani-agent-skills/skills/interview-me/SKILL.md` (#38) | B |
| `mirai-write` | Writing rules: agent-facing (terse, exact) and human-facing (plain, no AI tells) | every author | pstack `technical-writing`, `unslop`; `blader-humanizer` (vendored, pinned, D-27) (#30, #36) | B |
| `mirai-new` | Neutral entry point: intake → proposes track → routes to `mirai-prd` or straight to a quick-track ticket | you | none (build new) | B |
| `mirai-prd` | Workflow: intake → business brief → interview → PRD (lite on `standard`) → lint → verify → fix loop (loop guard) → your approval (on `standard`, brief and PRD in one approval; `full` keeps a brief gate, D-34) → committed on the docs branch by the CLI (D-50) | product-manager, verifier | `bmad-prd/` (#20) | B |
| `mirai-design` | Workflow: decide which docs (HLD/ADR/LLD) → draft → lint → verify → your approval → publish | architect, verifier | `bmad-architecture/`; Addy `documentation-and-adrs` (#3, #17) | D |
| `mirai-tickets` | Workflow: slice → graph checks → trace → verify → your signed ticket-set approval → the orchestrator merges the docs MR (V3, D-56) → publish to store; sets `release` per epic | ticket-planner, verifier | `bmad-ticket/` (#10) | B |
| `mirai-plan` | Per-ticket plan from the plan template; declares the protected paths it expects to touch and any new dependency, both approved at the plan gate (D-15, D-48); VCS and multi-goal checks; quick + normal risk: plan gate `auto`; other plans batch into `mirai inbox` | developer | `bmad-build/step-01`, `step-02` (#5, #22) | A |
| `mirai-tdd` | Follows `tdd` (`auto`/`on`/`off`) and `tests` (D-23). Red-green-refactor where TDD applies; a stub step before red for new code; red evidence produced by the orchestrator (`run_tests` on the new or changed tests against `baseline_revision`, a checkpoint ref from the commit model), accepted only as an assertion failure; characterization tests first for changed functions in untested code (D-45); tests tagged with AC IDs at the lowest level that proves them; prove-it pattern for bugs; matrix audit | developer | Addy `test-driven-development`; mattpocock `tdd` (refactor step restored); `bmad-build/step-03` (#23) | A |
| `mirai-review` | Lens prompts per risk tier, the findings schema (`basis.ref`, fingerprints), triage rules, freeze after round 1, per-finding check for high risk; inputs from the launch's input folder, findings out as structured output; the test-level and out-of-scope-test checks and `mirai review <ticket>` (your timed review) come in B | reviewer | `bmad-code-review/`; `bmad-build/step-04-review.md`; pstack `lead-judgment.md` (#24) | A (refinements: B) |
| `mirai-qa` | For `e2e: yes` tickets, write or update the critical journey's E2E test before review (happy path + 1–2 key failure paths, stable selectors, tagged `J-n` + AC IDs); then verify each AC ID on the running app with evidence via `run_tests` (`e2e`, `qa-explore` throwaway scripts with screenshots); edge-case probes; final E2E on `feature/<epic>`; staging check; QA result posted as a ticket comment when a tracker exists (D-29, D-44). Scripts go to `run_tests` as content; evidence comes back inline | qa | pstack verification skills; superpowers `verification-before-completion` (logic) (#15, #25) | C |
| `verify-<app>` (generated) | Project-specific: start the app (in its containers), log in, feature map, evidence capture | qa | pstack `create-verification-skill/references/feature-map-example/` (#19, #56) | C |
| `mirai-ship` | Run by the orchestrator, not the agent: commit per repo convention with the `Mirai-Ticket` trailer, mint the proofs and gate-result record, push to a registered branch named by the project's pattern via an explicit URL (`--force-with-lease=<branch>:<sha>` after a stacked rebase), open or update the MR (idempotent), target the integration branch, the stacked parent (never merged into it; retargeted first) or `feature/<epic>`. No separate ship gate; your merge is the gate (D-34). The MR description carries `Review: PASS after N rounds (MIRAI)`, non-blocking follow-ups and the QA text; no review comments on the host (D-29) | orchestrator | pstack `opening-a-pr.md` (#52) | A |
| `mirai-release` | Per ticket by default; per epic for `release: together`. Release record `pending → [staging → verified] → approved → deployed → live | rolled-back` (staging steps optional), production go/no-go record, smoke check | qa, you | none in prior art (build new) | D |
| `mirai-report` | Run report / morning report, stored in `<store>/reports/` and printed by `mirai report`: **MRs touching auto-run config first, with a "review on the host before opening in your IDE" warning (D-54)**; done, parked, `usage-limit` pauses, share of the usage limit per ticket, ledger, template gaps, known baseline failures, E2E suite over budget, files due for `mirai clean`, metrics M1 (from the first milestone, a tier-0 git script), M3, M4, M6 | orchestrator, you | bmad-loop run state; BMAD retro "source or drop" rule | A (minimal), C (morning) |
| `mirai-resume` | Rebuild from the orchestrator store, git and the host; continue from the last checkpoint; never resets counters | you | pstack `session-pickup.md`, `pause-safely.md`; Addy restartable boundary (#47) | A |
| `mirai-change` | Change request: new draft beside the frozen approved version, stale detection downstream | product-manager, architect | `bmad-correct-course/`; `bmad-spec/SKILL.md:133-139` | D |
| `mirai-contribute` | Sync-back: framework files only (after `mirai promote` for custom changes) → fresh branch from upstream, neutral identity → leak scan incl. PR text → your diff review → PR on the MIRAI repo | you | none (build new) (#42) | E |
| `mirai-find-skills` | Search for external skills + vetting checklist; never installs | you | `vercel-labs-skills/skills/find-skills/` (#39, #49) | Later |
| `mirai-retro` / `mirai-eval` | Epic and framework retros from logs; blinded evals of skills | you | `bmad-retrospective/`, `bmad-eval/`; pstack `reflect`, `correct`, `playbooks/eval.md` (#26) | Later |
| `mirai-research`, `mirai-ideate` | Discovery: market and domain research, brainstorming | analyst | `bmad-deep-recon/`, `bmad-brainstorming/`; Addy `idea-refine` (#14, #27) | Later (Q4: second topic) |
| `mirai-test-plan` | Risk-based test design per epic (P×I) | qa | `bmad-tea-test-design/` (#34) | Later |
| `mirai-docs`, metrics dashboard | Docs website; trust dashboard | you | BMAD `docs-site/` (#33, #37) | Later |

## 6. Templates

The template choices and licensing are in `research/07-doc-templates.md`. We write our own wording.
arc42 is CC BY-SA and most PRD templates have no license, so they are structure only (D-19). Each
document type is a definition: template + checklist + lint rules + state machine (D-37).

| Template | Based on | Key additions | MVP |
|---|---|---|---|
| Business brief | Lenny's 1-pager (structure) | `BR-n` IDs; a sources list; proposed track | B |
| Business context (`business.md`) | our own (D-43) | product, users, business model, what this repo is and isn't responsible for, business rules, glossary, constraints; every claim sourced; ~1–2 pages | B |
| PRD (full / lite) | Kevin Yien structure + HashiCorp per-requirement acceptance criteria + BMAD PRD discipline | `FR-n`/`NFR-n` with `AC-FR-n.m` (Given/When/Then), the same IDs in the lite variant; a verification method per NFR; non-goals with reasons; metrics with baseline/target + counter-metrics; risks; assumptions index; `UNKNOWN` for missing numbers. The lite variant = the spec kernel (Why / Capabilities / Constraints / Non-goals / Success). | B (lite and full template; the full track uses it from D) |
| HLD | arc42 order + C4 context/container (Mermaid) + the pilot's 16 sections | top quality goals; FR/NFR → component/ADR trace table; failure modes, migration, test strategy (pilot strengths) | D |
| ADR | MADR 4.0.0 full | required: decision drivers, ≥2 options, good/bad consequences, Confirmation naming a check ID (checked by `mirai trace`), a Y-statement summary, supersede links | D |
| LLD | Google design-doc shape + Rust RFC "drawbacks / unresolved questions" | API contracts with error cases; schema + migration + rollback; test plan mapped to AC IDs; ticket breakdown | D |
| Epic / story / bug | BMAD ticket templates + Addy task structure | **no `status` field** (status lives in the store, D-06); `covers_ac` (AC IDs), `governed_by`, `after`, `risk`, `size`, `files_likely`, `verify`; `repo` (D-42), `e2e: yes` for critical journeys (D-44), `tdd`/`tests` overrides (D-23); epic: `release: per-ticket \| together`; feature flag only when you ask; bug: reproduction + cause hypothesis, never a fix; quick track mints `AC-<ticket>.n` | A (story/bug), B (epic) |
| Plan | BMAD plan template | test list column with AC IDs and the test level per AC; characterization tests listed for changed functions in untested code; `no-test: <reason>` rows; **declared protected paths and new dependencies**; round counter. Lives in the store; agents receive it in the input folder and return their sections as structured output (D-12) | A |
| Review findings / QA report / MR description / run report / release record | BMAD triage log; pilot `verification-report.md`; pstack PR body; vercel `dogfood` report shape (logic) | the findings schema (`basis.ref`, file + symbol fingerprint); evidence per AC ID; the MR's one-line review summary; review and QA text kept local; no run-log lines in the MR (D-29); release record `pending → [staging → verified] → approved → deployed → live \| rolled-back`, exported as a tag or host release only at a terminal state (D-07) | A (findings, MR, run report), C (QA), D (release) |
| Context files | BMAD project-context template; Addy CONSTRAINTS; pstack feature map | `enforced by <check>` tags; business context file (D-43); critical-journeys list with `J-n` IDs in the feature map (D-44); a setup-time test-baseline *report* (the gate's baseline lives in the store, per integration-branch SHA, D-15); `agents-local.md`, the project part of `AGENTS.md` (D-37) | B |

**Shared across all documents:**
- YAML frontmatter (subset grammar, D-40): `id`, `type`, `template` (`<type>@vN`), `status`,
  `version`, `derived_from`, `upstream`, `downstream`, `owner`, `updated`.
- A one-line "done when" per section, used by both author and verifier.
- "N/A — reason" for optional sections; never left empty.
- **Strict:** agents can't add sections; the lint rejects unknown headings. Agents report a
  template gap instead. You can add, reorder or rename sections per project, as an overlay on the
  framework template; core sections are protected (D-41).
- Retired documents (`superseded`/`obsolete`) are excluded from agent context (D-46).
- An approved version is frozen and its content hash is signed in the approval; a new draft lives
  beside it as `<name>.v<n>.draft.md` (D-07, D-17).
- Documents are committed on the docs branch by the CLI (`Mirai-Docs` trailer, never switching
  your checkout) and reach the integration branch through a docs MR, which the orchestrator merges
  after your signed ticket-set approval (D-06, D-50, D-56). Its gate: every changed document has a
  signed approval of its exact content hash, and the code-path diff is empty.

## 7. Connectors (storage stores)

**One source of truth per artifact type** (D-06): each type is stored in `repo` or in one external
tool, never both. Different types may live in different tools (e.g. tickets in Jira, docs in
Confluence). `repo` is forced when no tool is connected.

| Name | Purpose | Prior art | MVP |
|---|---|---|---|
| `repo` store | Markdown files in the repo (the default and the fallback) | BMAD repo store | B (A hard-codes ticket files) |
| Git host (GitHub `gh`) | Push (explicit URL), MR, retargeting stacked MRs, the docs-MR merge after your approval (D-56), merge detection logged as journal observations (`integrated`, `done`), CI status, merge timestamps for metrics. Run by the orchestrator with its own credentials; agents never call it (D-30). GitLab `glab` later. | pstack `babysit`/`watch-pr` | A |
| ClickUp, Jira, Linear | Ticket stores. One is picked when you choose a tool (D4). Also post the QA result as a ticket comment, with screenshots where the API allows (D-29). | `bmad-ticket/config/jira-ticketing.toml` (via `acli`); atlassian `spec-to-backlog` (reference) | Later |
| Confluence, Notion | Doc stores | BMAD `external_handoffs` | Later |
| GitHub Issues | Ticket store | BMAD store TOMLs | Later |
| Slack | Post the morning report; read a thread as intake | pstack `why` source categories | Later |

**The connector contract** (D-36, D-37): a definition file with verbs `setup`, `write`, `read`,
`query`, a status map, and a proof step at setup.
- Deterministic actions (status mirror, publish, merge detection) run in the CLI through the
  tool's official CLI or REST.
- MCP is used only for reading inside an agent session, and its text is fenced as untrusted data.
- **Credentials are never stored by MIRAI.** They come from the tool's own login.
- **The store is the authority for workflow status; a tracker is a one-way mirror** (D-06, D-36),
  with a last-sync time. Gates use only the signed records.

## 8. Folder layout

```
<project>/                         # the work tree (one checkout, branch switching; every run ends on the integration branch)
  .mirai/
    mirai.lock                     # version + hashes + `framework`/`rendered`/`project` mark per file (D-37)
    framework/                     # pinned MIRAI copy, read-only (protected path)
      vendor/PROVENANCE.json       # vetted vendored files: source, license, commit, hash
    config.toml                    # committed (incl. integration_branch, repos, resources, test levels, named checks, compose inputs)
    custom/                        # per-skill overrides and template overlays, committed
    context/                       # project.md, business.md, conventions/<service>.md, feature-map/ (incl. critical journeys J-n),
                                   # agents-local.md, test-baseline report
    keys/<machine>.pub             # Ed25519 public keys (committed; changed only by a key MR, D-17)
    keys/<machine>.revoked         # revocation with a date
    records/<ticket>/              # signed, immutable, committed; sandbox- and Edit-denied to agents
      branch.json                  # registration {ticket, branch, base_sha}, first commit (D-15)
      <kind>-r<n>-<hash>.json      # review / QA proofs over the normalized patch (D-16)
      gate-r<n>-<hash>.json        # signed gate-result record (D-16)
      handover.json                # {ticket, at_sha}, when you take a branch over (D-50)
    pointers/<doc-id>.json         # external documents: id, url, version, status
  .env.test                        # dummy secrets for agent test runs (committed, protected, D-49)
  <docs_root>/<initiative>/        # repo store (default docs/mirai/, or the project's own convention); on the docs branch
    brief.md  prd.md  prd.v2.draft.md  hld.md  lld-<epic>.md  adr/  tickets/  releases/  archive/  approvals/
                                   # tickets/<id>.md: content only, no status field (status lives in the store, D-06)
                                   # approvals/: signed document approvals with content hashes
                                   # no plans, review or QA reports here: they stay local (D-29)
  rendered tool files              # .claude/…, AGENTS.md block (lock mark `rendered`); never inputs to a headless run

~/Library/Application Support/mirai/<repo-id>/   # MIRAI home: OUTSIDE the project (D-47)
  store/                           # DENIED to agents (read and write)
    state.json  journal.jsonl  heartbeat.json  ledger.json  run.lock  branches.json (local index)
    config.user.toml               # your personal overrides
    cache/                         # external doc copies, tracker status cache
    baseline/<sha>.json            # the gate's test baseline per integration-branch SHA
    runs/<run-id>.jsonl            # full run logs; runs/<id>/compose.resolved.json (frozen compose)
    parked/<ticket>.json
    tickets/<ticket>/              # status.json (the only status home), plan, review findings, QA report,
                                   # evidence, transcripts, verdicts (retention rule, D-46)
    metrics/                       # structured finding + metrics data, kept (D-46)
    reports/                       # run and morning reports
  bundle/<base-sha>/               # trust root: readable, write-denied, immutable flag; skills, agents, prompts,
                                   # strict.json per role, mcp.json, hook scripts + shim, compose inputs
  hooks/                           # core.hooksPath: MIRAI git hooks, hash-checked
  input/<launch>/                  # read-only input folder for one launch (plan, delta diff, findings, ACs); deleted after
  scratch/<run>/                   # agent-writable, never trusted
  gitconfig                        # MIRAI-owned minimal GIT_CONFIG_GLOBAL for host git (D-15)
  claude-home/                     # CLAUDE_CONFIG_DIR fallback for headless runs, if `--restricted` doesn't fit
  tmp/                             # MIRAI's own temp folder (never the per-user temp dir)

~/Library/Application Support/mirai/global/      # shared by all projects (D-57); denied to agents
  usage.jsonl                      # global usage ledger: limit share per run, with repo id and plan
  run.lock                         # one MIRAI run at a time across all projects

~/.config/mirai/                   # your user only; denied to agents
  signing.ed25519                  # private key, one per machine (optionally in the Keychain)
  config.toml                      # global: [subscription] plan, [usage] night_max / week_max / reserve (D-57)
```

**Multi-repo workspace** (D-42, D-51): the same layout, split in two.

```
<workspace-repo>/                  # MIRAI lives here; its orchestrator store is outside, keyed by its <repo-id>
  .mirai/                          # config (with repos + resources), context, keys, approvals
  <docs_root>/                     # PRDs, HLDs, ADRs, epics, tickets (when stored in the repo)
<service-repo>/                    # one per entry in `repos`
  .mirai/                          # light install: lock (pins the workspace's public-key fingerprint
                                   # set and gate config version), conventions, named checks, test levels,
                                   # records/ (this repo's per-ticket proofs, both base SHAs)
  generated tool files, hooks, CI  # no document copies
```
