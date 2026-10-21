---
status: draft
version: 2
---

# 03 — Component catalogue

Every part of MIRAI, what it's for, where the idea comes from, and whether it's in the MVP.
- "Notes" refers to the user's notes (`research/01-notes-analysis.md`).
- Prior-art paths are relative to `research/_sources/`.
- Row numbers like `#20` point to `research/05-reuse-matrix.md`.
- "R-…" points to themes in `06-review-round-1.md`. "D-…" points to `04-decisions.md`.

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
| **Trust root** | A read-only snapshot of framework, config, custom files and generated tool files taken *from the base commit* at run start, stored outside the work tree. Every launch, hook and gate uses it, never the working copy (D-15). |
| **Strict settings bundle** | `<trust-root>/strict.json` plus `mcp.json`: the sandbox, deny rules and hooks passed to every Claude Code launch, with project and local settings switched off (D-12, D-30). |
| **Protected paths** | `.mirai/**`, tool dirs, CI files, git hooks, lint/test configs and records. A diff touching them is forced to `high` risk; in autonomous mode it parks (D-15). |
| **Orchestrator store** | `<git-common-dir>/mirai/`: machine-local operational state (run progress, counters, ledger, parking, run lock, trust-root snapshots, full run logs). Never committed (D-06). |
| **Branch-carried facts** | Documents, signed approvals and records that travel with the MR (D-06). |
| **Patch-id record** | A review or QA record bound to `git patch-id --stable` of the code-path diff, stored as one immutable file (D-16). |
| **Loop guard** | The shared library every fix loop uses: rounds, ledger, fingerprints, progress check, parking (D-18). |
| **Parked** | A ticket stopped with a reason, waiting for you. Released with `mirai unpark` (D-34). |
| **Stacking** | A ticket starting from its dependency's unmerged branch, within one epic, at most depth 2 (D-24). |
| **`release: per-ticket \| together`** | The per-epic release mode. `together` uses `feature/<epic>` and a final E2E (D-33). |
| **Rung** | A step on the verifier model ladder (D-14). |
| **Track** | `quick`, `standard` or `full` (D-08). |

## 1. Foundation (scripts and data formats)

The foundation is code, not prompts. **Runtime: Node.js, no npm dependencies** (D-04). Every
machine-written file is JSON (D-40).

| Name | Purpose | Prior art | MVP |
|---|---|---|---|
| `mirai` CLI | The single entry point for every deterministic action. **Setup:** `init`, `update`, `doctor`. **State:** `status`, `resume`, `log`, `trace`. **Runs:** `run` (with `--plan`), `agent run`, `session start/end`, `exec test <suite>`. **Human:** `inbox`, `approve`, `drop`, `unpark`, `escape`. **Gate:** `gate`, `lint`. **Output:** `report`, `metrics`, `release`. **Sync-back:** `promote`, `contribute`. | BMAD `setup.py`, `tickets.py`; pstack `orch/`; bmad-loop CLI | A (commands arrive with their milestone) |
| Config model | `.mirai/config.toml` (project, committed) ← `.mirai/config.user.toml` (personal, gitignored) ← `.mirai/custom/<skill>.toml` (per-skill overrides). Schema-checked and versioned; a missing key stops the run instead of guessing. Holds storage per artifact type (`repo` or `external:<tool>`, D-06), `[gate] code_paths`, risk paths, test suites for `exec test`, and `release` per epic. | BMAD three layers + merge rules (`bmod-core-tools/help/customization.md:41-47`); "missing keys halt" (`CHANGELOG.md:73`); pstack role lines with defaults (`setup-pstack/SKILL.md:39-66`) | A |
| Status model | One table of document, ticket and release states, allowed moves, and which moves are human-only (`02` diagram e). Includes the round-1 moves (R-M12). Frontmatter is the current state; `mirai status` reports a mismatch with the log as an error. `built` and `done` are derived from the git host, never written (D-06). | `bmad-method/tools/ticket-tree-rules.md:21-35`; Addy ADR lifecycle; pilot template statuses (inconsistent, `research/04` §3) | A |
| Run log | JSON lines with `{schema_version, run_id, seq, ts, item, by}` on every line. Full logs live in the orchestrator store; selected lines are exported into the MR at ship time (D-29). Written only by the CLI, append-only. `mirai log` refuses privileged event types (D-17). | BMAD `memlog.py` (O_APPEND, blind writes); bmad-loop `journal.jsonl`; pstack `show-me-your-work` + `log.sh` | A |
| Orchestrator store | `<git-common-dir>/mirai/`: `state.json`, `journal.jsonl`, `heartbeat.json`, ledger, parking notes, run lock, trust-root snapshots, QA evidence (size-capped). Shared by every checkout, never committed. | bmad-loop `state.json` + `journal.jsonl` + `heartbeat.json` | A |
| Trust root + strict settings bundle | Snapshot from the base commit, hashed, read-only, outside the work tree. Renders the launch bundle: plugin dir, system prompt file, `strict.json`, `mcp.json`, with `.mirai/custom/` overrides merged in as a content-hashed snapshot. | BMAD `render_skill.py` merge rules; `research/09` §7 | A |
| Signing | HMAC key in `~/.config/mirai/` signs approvals and records. Agents can't read it (D-30). SSH signing later. | none (build new) | A |
| Records | One immutable file per record, `<ticket>/<kind>-r<n>-<patchid>.json`, bound to the patch-id over code paths, signed. Written by the CLI from the reviewer's own output file. Pointer files for external documents. | pilot `mark-review-complete.sh` + `stop-quality-gate.sh`; pstack shipping `git patch-id` idea (`playbooks/shipping.md`) | A |
| Agent launcher (`mirai agent run`) | Starts any agent headless with the launch bundle: picks the model by the verifier ladder, sets turn/time limits, scrubs the environment, captures output, checks the role's write scope afterwards, writes the run-log line (tokens, turns, minutes, dollar estimate, verdict). Detach-and-wait for supervised launches. A one-time launch token from the orchestrator replaces the env-var depth guard (D-12). | bmad-loop profiles (`data/profiles/claude.toml`) without `bypassPermissions`; pstack model roles | A |
| Loop guard | Shared by every fix loop (documents and code): round counter, budget ledger (turns, tokens, minutes, dollar estimate), finding fingerprints (file + symbol), strict-progress check, parking-note writer. Counters saved before each launch; `resume` never resets them (D-18). | bmad-loop `escalation.py`, `policy.toml`; BMAD TEA `run-and-heal.md:28` | A |
| Orchestrator (`mirai run`) | Fixed state machine per ticket (plan → build → checks → review → QA → ship). Uses the loop guard, preflight, a circuit breaker for environment faults, usage-limit pause and resume, checkpoint refs, a run lock, idempotent MR creation and `caffeinate`. **One checkout with branch switching**; stacking within an epic (depth 2); `--plan` previews the night (D-18, D-24). | bmad-loop `statemachine.py:25-65`, `escalation.py`, `policy.toml`; pstack `playbooks/orchestrate.md`, `autonomous-run.md` | Supervised: A; autonomous: C |
| `mirai exec test <suite>` | The only way agents run tests: a fixed wrapper that runs a configured suite inside the project's own containers. No free-form arguments. The single sandbox `excludedCommands` entry (D-30). | pilot `scripts/quality-gate.sh` (`docker compose exec`) | A |
| `mirai inbox` | One terminal screen with everything waiting for you: document approvals, plan batches with a short review packet, the `ship` gate, parked tickets, disputes, merges into `feature/<epic>` (D-34). | none (build new) | A (minimal), B (full) |
| Lints | `mirai lint prd|design|tickets|plan`: required sections, IDs, links, Mermaid check (fenced + keyword + balanced brackets), dependency graph, FR closure. | BMAD `lint_spine.py`, `tickets.py` diagnostics; pstack `check-plan.mjs` | A (plan), B (docs) |
| `mirai trace` | Checks the ID chain `BR → FR/NFR → AC-FR-n.m → ticket → tests → QA evidence`, and ADR Confirmation check IDs (D-35). | BMAD TEA trace step (logic) | B |
| Floor guard | Flags weakened or deleted tests, new skips and suppressions, lowered thresholds, and diffs on protected paths. | Addy `constraint-driven-development/references/floor-guard.md` | A |
| Secret scan | Blocks secrets in `pre-push` and again in CI (D-30). Zero-dependency patterns. | none (build new); patterns shared with the leak scanner | A |
| Leak scanner | Blocks project-identifying content in `mirai contribute` and in MIRAI's own pre-commit. Scans the final PR title, body and commits; generic detectors plus the block list (D-21). | none (build new); pattern ideas from BMAD `scan_scripts.py` | E |

## 2. Tool adapters and installer

| Name | Purpose | Prior art | MVP |
|---|---|---|---|
| Installer (`mirai init`) | `npx github:<owner>/mirai#vX.Y.Z`. Copies a pinned framework version into `.mirai/framework/`, writes `mirai.lock` (version + hashes of framework *and* generated tool files), runs the adapter, installs git hooks outside the work tree (`core.hooksPath` under the git common dir). | BMAD `setup.py` staging + atomic replace (`:2226-2314`) | A |
| Updater (`mirai update`) | Lock-hash diff with a 3-way merge (base from the pinned version); versioned config/state schemas with deterministic migration scripts; applies on yes; never touches config/custom/context. | BMAD `retired.toml`, `migration-N.toml`, `references/migrate.md:7` | D |
| Shared instructions | A small MIRAI-managed block in `AGENTS.md`, which all three tools read. Kept well under Codex's 32 KiB cap and about 200 lines. | `research/08` §5.1; BMAD managed `AGENTS.md` block | A |
| Adapter: Claude Code | A profile file (D-37). `CLAUDE.md` containing `@AGENTS.md`; `.claude/skills/<name>/SKILL.md`; `.claude/agents/<name>.md`; `.claude/settings.json` for your interactive sessions (sandbox on, deny rules, `ask` outside the project). **Headless** (subscription, no `--bare`): `claude -p --setting-sources user --settings <trust-root>/strict.json --strict-mcp-config --mcp-config <trust-root>/mcp.json --permission-mode dontAsk --permission-prompts none --max-turns N --output-format stream-json`, with `CLAUDE_CODE_OAUTH_TOKEN` and no `ANTHROPIC_API_KEY`. | `research/08` §2, §5.2; `research/09` §2–§5; pstack `docs/harness/claude-code.md`; pilot `.claude/` | A |
| Adapter: Codex | `.agents/skills/<name>/SKILL.md`; `.codex/agents/<name>.toml`; `.codex/config.toml` (sandbox, `[mcp_servers]`); `.codex/hooks.json` (needs user trust). Headless: `codex exec --json --output-schema --sandbox workspace-write`, network off. First used as verifier rung 1. | `research/08` §3, §5.2, §5.4 | D |
| Adapter: Cursor | No extra skill files (Cursor reads `.agents/skills` and `.claude/skills`); `.cursor/agents/` only if needed; `.cursor/cli.json` permissions; generated `.cursor/hooks.json` or dialect-aware hook scripts so Cursor doesn't run Claude's hooks wrongly. Headless: `agent -p --force --trust --sandbox enabled`, wrapped in `timeout`. Turn off third-party config import on the orchestrator machine. | `research/08` §4, §5.2, §5.4 | D |
| Managed settings (optional) | Setup offers to install `/Library/Application Support/ClaudeCode/managed-settings.json` with the managed-only locks. Needs admin rights and your approval. | `research/09` §2 | C (offered before autonomous) |
| Per-tool plugins | Thin plugin wrapper around the same files | pstack, BMAD plugins | Later |

## 3. Enforcement (gates and blocking rules)

| Name | Purpose | Prior art | MVP |
|---|---|---|---|
| `mirai-gate` git hooks | Installed outside the work tree, hash-checked against the base `mirai.lock`, run from the trust root. `pre-commit`: status and frontmatter checks; a status change to a human-only state only with a signed approval event. `pre-push`: a patch-id review (and QA, once it exists) record for the current change, green checks, and the secret scan. | pilot `stop-quality-gate.sh` logic, moved to git | A |
| CI job template | Checks out `pull_request.head.sha`; re-runs the quality gate and secret scan; re-checks records and signatures; verifies the framework and its own workflow against the base branch's lock unless the MR is labelled a MIRAI update. Set as a required status check where the GitHub plan allows; `doctor` reports "CI-enforced / local-only". | pilot `scripts/quality-gate.sh` | A if the pilot can run CI, otherwise D (R-C6, R-M21) |
| Blocking-rules layer | The strict settings bundle: sandbox on with `allowUnsandboxedCommands: false`, `denyRead` on home except the project and toolchain caches, strict network allowlist, `Read`/`Edit` deny outside the project, deny on `git push`, `gh`, `docker`, `env`/`printenv`, `mirai exec test` as the only excluded command, and the scrubbed environment. Includes the red-team test (D-30). | `research/09` §7; pilot `settings.json` denies | A (supervised), C (red-team test before autonomous) |
| Claude Code hooks | Loaded from the trust root. Blocking (exit 2): secret patterns in Write/Edit, Glob/Grep outside the project. Feedback: an edit makes the current record stale, the reviewer verdict is captured from the reviewer's own output, a stop gate, a read-only guard for reviewers. | pilot `on-file-change.sh`, `mark-review-complete.sh`, `stop-quality-gate.sh`, `reviewer-bash-guard.sh` | A |
| Codex / Cursor hooks | Same where the tool supports it; otherwise git/CI only. They fail open, so they are never the gate (D-15). | `research/08` | Later (as available) |

## 4. Agents (personas)

An agent is a persona plus a role contract: what it does, what it may touch, what it hands off. It
**follows skills**; the behavior lives in skills (BMAD lesson X4: "personas add little" when
behavior lives in them). Personas are limited to a name and 1–2 lines of style (Q11). Each agent is
a definition file with a schema: role, `may write` scope, allowed tools, model role (D-37). The
launcher enforces `may write` after every run (D-12).

| File name | Persona | Role | May write | Prior art | MVP |
|---|---|---|---|---|---|
| `mirai-product-manager` | **Nora** | Intake, interview, business brief, PRD | business brief, PRD, its replies to findings | `bmad-agent-pm/`, `bmad-prd/`; notes PM agent (#2) | B |
| `mirai-architect` | **Arlo** | HLD, ADRs, LLDs | design docs | `bmad-agent-architect/`, `bmad-architecture/`; pstack `architect`; notes Architect (#3) | D |
| `mirai-ticket-planner` | **Tess** | Epics, stories, bugs, dependencies, risk, size, release mode proposal | tickets | `bmad-ticket/`; Addy `planning-and-task-breakdown`; notes Create Tickets (#10) | B |
| `mirai-developer` | **Kai** | Plan, TDD build, fixes | code, tests, plan (never protected paths) | `bmad-build/`; pilot `developer`; notes Developer (#5) | A |
| `mirai-reviewer` | **Rex** | Code review lenses (quick or thorough by risk) | review findings only (read-only on code) | `bmad-code-review/`; pilot reviewers; pstack `interrogate`; notes Code Review (#24) | A |
| `mirai-qa` | **Ivy** | Verification on the running app, evidence per AC ID, final E2E for `release: together`, staging check | QA report + evidence only | pstack verification skills; vercel `dogfood` taxonomy and report shape (logic); notes QA (#15, #25) | C |
| `mirai-verifier` | **Vera** | Checks brief, PRD, design docs and tickets against the doc type's checklist before your approval; input reconciliation | review files only | `bmad-prd` reviewer gate + rubric; `bmad-architecture` reviewer gate; `bmad-ticket/references/validate.md`; your "another agent verifies" (Q4) | B |
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
sandbox).

## 5. Skills (procedures)

| Name | Purpose | Used by | Prior art | MVP |
|---|---|---|---|---|
| `mirai-setup` | Detect → ledger → interview gaps → config + context → storage per artifact type → verify skill → enforcement (hooks, strict settings bundle, `worktree_safe` check, compose mount check) → doctor | you | `bmad-project-context/`; pstack `create-verification-skill`; BMAD `bmad setup` (#40, #11) | A (minimal), B (full) |
| `mirai-doctor` | Health check of install, config, hooks, CI ("CI-enforced / local-only"), blocking rules, `claude auth status`, connectors, verifier rungs, context freshness; one smoke run | you, setup | pstack Benny fresh-agent check (`setup-benny/SKILL.md:48-61`) (#13) | A |
| `mirai-interview` | One question at a time with a guess, confidence, want vs should-want, restatement, explicit yes | setup, product-manager | `addyosmani-agent-skills/skills/interview-me/SKILL.md` (#38) | B |
| `mirai-write` | Writing rules: agent-facing (terse, exact) and human-facing (plain, no AI tells) | every author | pstack `technical-writing`, `unslop`; `blader-humanizer` (vendored, pinned, D-27) (#30, #36) | B |
| `mirai-new` | Neutral entry point: intake → proposes track → routes to `mirai-prd` or straight to a quick-track ticket | you | none (build new) | B |
| `mirai-prd` | Workflow: intake → business brief → interview → PRD (lite on `standard`) → lint → verify → fix loop (loop guard) → your approval → publish | product-manager, verifier | `bmad-prd/` (#20) | B |
| `mirai-design` | Workflow: decide which docs (HLD/ADR/LLD) → draft → lint → verify → your approval → publish | architect, verifier | `bmad-architecture/`; Addy `documentation-and-adrs` (#3, #17) | D |
| `mirai-tickets` | Workflow: slice → graph checks → trace → verify → your approval → publish to store; sets `release` per epic | ticket-planner, verifier | `bmad-ticket/` (#10) | B |
| `mirai-plan` | Per-ticket plan from the plan template; VCS and multi-goal checks; plans batch into `mirai inbox` | developer | `bmad-build/step-01`, `step-02` (#5, #22) | A |
| `mirai-tdd` | Red-green-refactor; red evidence produced by the orchestrator against `baseline_revision`; tests tagged with AC IDs; prove-it pattern for bugs; matrix audit | developer | Addy `test-driven-development`; mattpocock `tdd` (refactor step restored); `bmad-build/step-03` (#23) | A |
| `mirai-review` | Lens prompts per risk tier, the findings schema (`basis.ref`, fingerprints), triage rules, freeze after round 1, per-finding check for high risk | reviewer | `bmad-code-review/`; `bmad-build/step-04-review.md`; pstack `lead-judgment.md` (#24) | A |
| `mirai-qa` | Verify each AC ID on the running app with evidence; edge-case probes; final E2E on `feature/<epic>`; staging check | qa | pstack verification skills; superpowers `verification-before-completion` (logic) (#15, #25) | C |
| `verify-<app>` (generated) | Project-specific: start the app (in its containers), log in, feature map, evidence capture | qa | pstack `create-verification-skill/references/feature-map-example/` (#19, #56) | C |
| `mirai-ship` | Run by the orchestrator, not the agent: commit per repo convention, push, open or update the MR (idempotent), target `main`, the stacked parent or `feature/<epic>` | orchestrator | pstack `opening-a-pr.md` (#52) | A |
| `mirai-release` | Per ticket by default; per epic for `release: together`. Staging check, production go/no-go record, smoke check | qa, you | none in prior art (build new) | D |
| `mirai-report` | Run report / morning report: done, parked (with reasons, incl. `usage_limit`), ledger, metrics M1, M3, M4, M6 first | orchestrator, you | bmad-loop run state; BMAD retro "source or drop" rule | A (minimal), C (morning) |
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
| PRD (full / lite) | Kevin Yien structure + HashiCorp per-requirement acceptance criteria + BMAD PRD discipline | `FR-n`/`NFR-n` with `AC-FR-n.m` (Given/When/Then); non-goals with reasons; metrics with baseline/target + counter-metrics; risks; assumptions index; `UNKNOWN` for missing numbers. The lite variant = the spec kernel (Why / Capabilities / Constraints / Non-goals / Success). | B (lite), D (full) |
| HLD | arc42 order + C4 context/container (Mermaid) + the pilot's 16 sections | top quality goals; FR/NFR → component/ADR trace table; failure modes, migration, test strategy (pilot strengths) | D |
| ADR | MADR 4.0.0 full | required: decision drivers, ≥2 options, good/bad consequences, Confirmation naming a check ID (checked by `mirai trace`), a Y-statement summary, supersede links | D |
| LLD | Google design-doc shape + Rust RFC "drawbacks / unresolved questions" | API contracts with error cases; schema + migration + rollback; test plan mapped to AC IDs; ticket breakdown | D |
| Epic / story / bug | BMAD ticket templates + Addy task structure | `covers` (AC IDs), `governed_by`, `after`, `risk`, `size`, `files_likely`, `verify`; epic: `release: per-ticket \| together`; feature flag only when you ask; bug: reproduction + cause hypothesis, never a fix; quick track mints `AC-<ticket>.n` | A (story/bug), B (epic) |
| Plan | BMAD plan template | test list column with AC IDs; `no-test: <reason>` rows; round counter | A |
| Review findings / QA report / MR description / run report / release record | BMAD triage log; pilot `verification-report.md`; pstack PR body; vercel `dogfood` report shape (logic) | the findings schema (`basis.ref`, file + symbol fingerprint); evidence per AC ID; exported run-log lines in the MR | A (findings, MR, run report), C (QA), D (release) |
| Context files | BMAD project-context template; Addy CONSTRAINTS; pstack feature map | `enforced by <check>` tags; business context file | B |

**Shared across all documents:**
- YAML frontmatter (subset grammar, D-40): `id`, `type`, `status`, `version`, `derived_from`,
  `upstream`, `downstream`, `owner`, `updated`.
- A one-line "done when" per section, used by both author and verifier.
- "N/A — reason" for optional sections; never left empty.
- An approved version is frozen; a new draft lives beside it as `<name>.v<n>.draft.md` (D-07).

## 7. Connectors (storage stores)

**One source of truth per artifact type** (D-06): each type is stored in `repo` or in one external
tool, never both. Different types may live in different tools (e.g. tickets in Jira, docs in
Confluence). `repo` is forced when no tool is connected.

| Name | Purpose | Prior art | MVP |
|---|---|---|---|
| `repo` store | Markdown files in the repo (the default and the fallback) | BMAD repo store | A |
| Git host (GitHub `gh`) | Push, MR, merge detection (`done`), CI status. Run by the orchestrator with its own credentials; agents never call it (D-30). GitLab `glab` later. | pstack `babysit`/`watch-pr` | A |
| ClickUp, Jira, Linear | Ticket stores. One is picked when you choose a tool (D4). | `bmad-ticket/config/jira-ticketing.toml` (via `acli`); atlassian `spec-to-backlog` (reference) | Later |
| Confluence, Notion | Doc stores | BMAD `external_handoffs` | Later |
| GitHub Issues | Ticket store | BMAD store TOMLs | Later |
| Slack | Post the morning report; read a thread as intake | pstack `why` source categories | Later |

**The connector contract** (D-36, D-37): a definition file with verbs `setup`, `write`, `read`,
`query`, a status map, and a proof step at setup.
- Deterministic actions (status mirror, publish, merge detection) run in the CLI through the
  tool's official CLI or REST.
- MCP is used only for reading inside an agent session, and its text is fenced as untrusted data.
- **Credentials are never stored by MIRAI.** They come from the tool's own login.

## 8. Folder layout

```
<project>/                         # the work tree (one checkout, branch switching)
  .mirai/
    mirai.lock                     # version + hashes of framework AND generated tool files
    framework/                     # pinned MIRAI copy, read-only (protected path)
      vendor/PROVENANCE.json       # vetted vendored files: source, license, commit, hash
    config.toml                    # committed
    config.user.toml               # gitignored
    custom/                        # per-skill overrides, committed
    context/                       # project.md, business.md, conventions/<service>.md, feature-map/
    records/<ticket>/<kind>-r<n>-<patchid>.json   # immutable, signed (committed)
    approvals/                     # signed approval events (committed)
    pointers/<doc-id>.json         # external documents: id, url, version, status
    cache/                         # gitignored: external doc copies
  <docs_root>/<initiative>/        # repo store (default docs/mirai/, or the project's own convention)
    brief.md  prd.md  prd.v2.draft.md  hld.md  lld-<epic>.md  adr/  tickets/  plans/  reports/  releases/
  generated tool files             # .claude/…, AGENTS.md managed block; Codex/Cursor files from D

<git-common-dir>/                  # e.g. <project>/.git — outside the work tree
  hooks-mirai/                     # core.hooksPath: MIRAI git hooks, hash-checked
  mirai/                           # orchestrator store, never committed
    state.json  journal.jsonl  heartbeat.json  ledger.json  run.lock
    runs/<run-id>.jsonl            # full run logs
    parked/<ticket>.json
    evidence/<ticket>/             # QA evidence, size-capped
    trust/<base-sha>/              # trust root: snapshot + strict.json + mcp.json + launch bundle

~/.config/mirai/                   # your user only; denied to agents
  signing.key
```
