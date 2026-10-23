# 05 — Reuse matrix

How to read the Decision column:
- **Reuse logic**: take the mechanism as is, rewritten in our words.
- **Adapt**: take it and change it materially.
- **Build new**: no prior art covers it.
- **Drop**: not worth building, or not in scope.

Names use the `mirai-` prefix. The prefix is a **proposal**; it gets confirmed in Phase 1. Paths are relative to `~/Projects/mirai-sources/`; "pilot" = `people-management-tool/platform`.

MVP column: my recommendation only. It is decided in Phase 1.

## 1. Your ideas

| # | Your idea (notes ref) | Prior art (paths) | Decision | What we improve on top | Proposed name | MVP? |
|---|---|---|---|---|---|---|
| 1 | Business Analyst agent + 10-item menu (Guide:11-33) | `bmad-method/skills/bmad-agent-analyst/customize.toml:55-103`; `bmad-deep-recon/` | Adapt | Thin menu only (no persona theater); PC moves to setup; research types in one skill | `mirai-analyst` (menu) | Later |
| 2 | PM agent (Guide:35-39) | `bmad-agent-pm/`; `bmad-prd/`; `bmad-correct-course/` | Adapt → fold into workflow | Entry point = `mirai-prd`; add change-request path | (none; `mirai-prd`) | — |
| 3 | Architect agent + HLD (Guide:41-55) | `bmad-architecture/` (spine, core test, adversarial reviewer); pilot `.claude/templates/hld-template.md`; `cursor-plugins/pstack/skills/architect/` | Adapt | Decision spine for agents + optional HLD view for humans; mandatory human approval status | `mirai-design` | Yes |
| 4 | UX expert agent + workflow (Guide:57-72) | `bmad-ux/` (DESIGN.md + EXPERIENCE.md); pstack `playbooks/prototype.md` | Reuse logic | Add a post-build UX check via the verification skill | `mirai-ux` | Later |
| 5 | Developer agent + spec-file first (Guide:75-92) | `bmad-build/` (plan template, frozen intent, handoff, triage); pilot `developer` agent; superpowers `writing-plans` | Reuse logic | Plan uses MIRAI statuses + trail log; reviewers spawned by lead, not dev; hook-enforced gate | `mirai-build` | Yes |
| 6 | Code Review agent (Guide:94-98) | merges into #24 | Drop as separate | — | — | — |
| 7 | QA agent (Guide:100-105) | merges into #15/#25 | Drop as separate | — | — | — |
| 8 | Data Engineer read-only (Guide:108-110) | pstack `skills/why/references/sources/databricks.md` (pattern only) | Build new | Read-only DB role enforced outside the prompt | `mirai-data` | Later |
| 9 | Scrum Master skill (Guide:114-126) | `bmad-ticket/scripts/tickets.py` (`next`/`status`); `bmad-retrospective/` | Adapt (reports only) | Status report from the ticket tree + logs; **drop prediction** (BMAD "Never state time estimates") | `mirai-board` | Later |
| 10 | Create Tickets skill (Guide:129-136) | `bmad-ticket/` (templates, stores, validation); `tools/ticket-tree-rules.md` | Reuse logic | Our statuses; repo-first then publish to Jira; tickets from debug/security reports too | `mirai-tickets` | Yes |
| 11 | Project Context skill (Guide:139-149) | `bmad-project-context/` (ledger, verified block, admission test); pstack `correct`; Addy `context-engineering` | Adapt | Fold into `mirai-setup`; output = small verified blocks + business context file; rule→enforcer table | part of `mirai-setup` | Yes |
| 12 | Project Scan & Documentation, 3 levels (Guide:151-165) | `bmad-deep-recon/references/codebase.md`; pstack `how`, `why`, `teach` | Adapt (question-driven) | Replace "scan levels" with cited Q&A at a commit; human docs on request only | `mirai-explain` | Later |
| 13 | Setup verification (Guide:168-172) | pstack `automations/benny/skills/setup-benny/SKILL.md:48-61` (fresh-agent check); BMAD `bmad setup --status`; pilot hooks | Adapt | `doctor` checks install, config, hooks, context freshness; one smoke run | `mirai-doctor` | Yes |
| 14 | Brainstorm skill (Guide:174-216) | `bmad-brainstorming/`; Addy `skills/idea-refine/`; `bmad-forge-idea/` | Reuse logic | Lighter (Addy shape), memlog-backed | `mirai-ideate` | Later |
| 15 | Verification skill (Guide:219-221) | pstack `create-verification-skill`, `maintain-verification-skill`, `principle-prove-it-works`, `benchmark-checklist`; superpowers `verification-before-completion` | Reuse logic | Generated per project during setup; Playwright via the project's own harness or MCP | `mirai-verify` (+ generated `verify-<app>`) | Yes |
| 16 | CODING_CONVENTIONS.md (Guide:226-231) | pilot `backend/AGENTS.md`, `frontend/AGENTS.md`; pstack `correct` rule table; Addy `constraint-driven-development` CONSTRAINTS.md | Adapt | Per-service; each rule tagged "enforced by <check>" or "judgment" | context file | Yes |
| 17 | HLD_template.md (Guide:233-235) | pilot `.claude/templates/hld-template.md`; `bmad-architecture/assets/spine-template.md` | Reuse logic | Adds status frontmatter + decision IDs | template | Yes |
| 18 | PROJECT-CONTEXT.md (Guide:237-240) | `bmad-project-context/references/{template,best-practices}.md` | Adapt | Split: technical (short, harness-loaded) + business context (domain, users, goals) | context file | Yes |
| 19 | FEATURE_MAP.md (Guide:242-249) | pstack `create-verification-skill/references/feature-map-example/`; Benny `feature-map.example.md` | Reuse logic | Folder, not single file; maintained by a maintenance pass, not "whoever ships" | context folder | Yes |
| 20 | PRD workflow + reviewers + extras (Guide:254-317) | `bmad-prd/` (read in full); `bmad-spec/`; Addy `interview-me` | Adapt | interview-me intake when input is thin; discovery reads code + UI (via feature map); our statuses; Confluence/Obsidian via config | `mirai-prd` | Yes |
| 21 | Debug Council (Guide:320-321) | pstack `playbooks/bug-fix.md`, `runtime-forensics.md`, `why`; superpowers `systematic-debugging`; Addy `debugging-and-error-recovery`; pilot `debugger` | Adapt | Evidence-first single lead; parallel hypothesis agents only when ≥2 layers are plausible | `mirai-debug` | Yes |
| 22 | Implementation Plan Council (Guide:323-327) | `bmad-build/step-02-plan.md` READY + Checkpoint 1; pilot plan debate; Addy `doubt-driven-development` | Adapt | A risk-gated plan check inside `mirai-build`, not a separate workflow | part of `mirai-build` | Yes |
| 23 | TDD workflow (Guide:330-341) | TEA `bmad-tea-automate/red/` (ATDD); `bmad-build/step-03` matrix audit; pstack `tdd` | Adapt | Acceptance tests by a separate agent from the plan; verified red before build | `mirai-acceptance` | Later (MVP: matrix audit in build) |
| 24 | Code Review workflow (Guide:344-385) | `bmad-code-review/` (read in full); pstack `interrogate` + `lead-judgment.md`; pilot hooks; Addy `/ship` | Reuse logic + Adapt | Risk-scaled lenses; verdict captured by hook; recurring findings → propose lint/CI | `mirai-review` | Yes |
| 25 | QA workflow (Guide:387-390) | pstack verification; `bmad-qa-generate-e2e-tests/`; TEA `bmad-tea-trace/` | Adapt | Scope from feature map + risk; screenshot proof per step; feeds review gate | part of `mirai-verify` | Yes |
| 26 | Process Retrospective & Evals (Guide:393-408) | `bmad-retrospective/`; pstack `reflect`, `correct`, `playbooks/eval.md`; `bmad-eval/`; Addy `evals/` | Adapt | Two loops: epic retro (product) and MIRAI retro (framework), both from logs; blinded evals | `mirai-retro`, `mirai-eval` | Later |
| 27 | Market Research workflow (Guide:411-413) | `bmad-deep-recon/types/{market,competitive}.md` | Reuse logic | Inside `mirai-research` types | `mirai-research` | Later |
| 28 | Brainstorm Business workflow (Guide:415-425) | `bmad-party-mode/` (custom parties, anti-consensus club) | Drop from MIRAI MVP | Possible separate "venture" module | — | No |
| 29 | Work Council (Guide:430-438) | pilot `development-council/SKILL.md`; `bmad-party-mode` anti-consensus; pstack `orchestrate.md` gates | Adapt | Disagreement > 1 round → parked as a human gate with options + default; no EM agent deciding | `mirai-council` (pattern) | Yes (inside build/review) |
| 30 | Clear documentation & output (Guide:440-444) | BMAD `doc_standards`; pstack `technical-writing`, `unslop`; `humanizer` | Reuse logic | Every workflow writes a report file in the work item folder | part of `mirai-write` | Yes |
| 31 | Configs (Guide:446-455) | BMAD 3-layer config + `customize.toml` hook points; ticket store config; Benny user-owned config | Adapt | One `mirai.config` + per-user override; **new: notes-vault source (Obsidian)** | `mirai.config` | Yes |
| 32 | Logging system (Guide:458-469) | pstack `show-me-your-work` + `log.sh`; BMAD `memlog.py`; bmad-loop `journal.jsonl`; pilot `.claude/state/` | Adapt / Build new | Two logs: document memlog + agent run trail; committed with the work item; schema carries metric fields | `mirai-log` | Yes (foundation) |
| 33 | Documentation website (Guide:472-474) | BMAD `docs-site/`; pstack `docs/guide/` | Reuse logic later | — | `mirai-docs` | Later |
| 34 | Risk-based test design (Guide:477-521) | `bmad-tea/skills/bmad-tea-test-design/` | Reuse logic | Fix band inconsistency; one doc per epic; feeds verification scope | `mirai-test-plan` | Later |
| 35 | Document statuses (Guide:524-533) | `bmad-method/tools/ticket-tree-rules.md:21-35`; TEA progress files; Addy ADR lifecycle | Adapt | One shared state model with types, allowed transitions, human-only transitions, and checkpoints for resume | status model (foundation) | Yes (foundation) |
| 36 | Writing skill, plain language (Guide:536-540) | pstack `technical-writing`, `unslop`, `bro`; `blader-humanizer/SKILL.md` | Reuse logic | Two modes: agent-facing (terse, exact) and human-facing (plain, no AI tells); not ELI5 | `mirai-write` | Yes |
| 37 | Metrics & AI-trust (Guide:543-547) | bmad-loop journal + budgets; BMAD Review Triage Log; pilot `tool-savings.jsonl` | Build new | Metric definitions + log fields now, dashboard later | `mirai-metrics` | Fields yes, dashboard later |
| 38 | Interview Me skill (Guide:703-711) | `addyosmani-agent-skills/skills/interview-me/SKILL.md` | Reuse logic | Used in setup and PRD intake | part of `mirai-setup`, `mirai-prd` | Yes |
| 39 | Find Skills (Guide:713-716) | `vercel-labs-skills/skills/find-skills/SKILL.md` | Adapt | Search only; never `-g -y` install; vetting checklist | `mirai-find-skills` | Later |
| 40 | Setup skill (brief goal 3) | `bmad-project-context/`; pstack `create-verification-skill` "interview the repo, not the user"; BMAD `bmad setup` | Adapt | Detect → interview gaps only → write config + context + verify skill; detects existing AI setups (pilot has BMAD + council) | `mirai-setup` | Yes |
| 41 | Installable repo, one command (brief goal 1) | Claude Code plugin marketplace (pstack, BMAD plugins, Addy, superpowers all use it); `npx skills`; BMAD `setup.py` | Adapt | Plugin for framework files + `mirai-setup` for project files | (install) | Yes |
| 42 | Sync-back (brief goal 2) | No prior art does push-back. Split patterns: BMAD shipped/team/user config; pstack Benny pack vs user-owned | Build new | Framework files read-only in the project; overrides in a project folder; an "upstream proposal" export of framework diffs only | `mirai-sync` | Later (design now) |
| 43 | Lauren: enforce in structure | pilot hooks (`stop-quality-gate.sh`, `on-file-change.sh`, `mark-review-complete.sh`); pstack `correct`; Addy floor guard | Reuse logic | Generic hooks parameterized by config (reviewers, gate command, risk patterns) | `mirai-gate` (hooks) | Yes |
| 44 | Pilot council + risk tiers (not in notes) | pilot `.claude/` | Reuse logic | Becomes MIRAI's gate layer; tiers configurable | part of `mirai-gate` | Yes |
| 45 | SDD as a hard rule (brief rule 5) | `bmad-method/skills/bmad-spec/SKILL.md` (kernel, Spec Law, derived from memlog); Addy `skills/spec-driven-development/SKILL.md` (gated SPECIFY→PLAN→TASKS→IMPLEMENT, capability map) | Adapt | Every change has a spec artifact sized to risk: PRD (big), spec (feature), plan (ticket); one id scheme across them | `mirai-spec` | Yes |
| 46 | Own naming, no BMAD/pstack names or personas (brief) | `bmad-method/TRADEMARK.md`; pstack is "poteto's style" (`cursor-plugins/pstack/skills/poteto-mode/SKILL.md:3`) | Build new | `mirai-` prefix (to confirm); no personas unless they earn a place | naming convention | Yes |
| 47 | Phase 4 unit loop + `PROGRESS.md` resume (brief) | pstack `playbooks/pause-safely.md`, `session-pickup.md`; Addy `skills/context-engineering/SKILL.md:123-137` (restartable session boundary); pstack `principle-sequence-verifiable-units` | Adapt | `PROGRESS.md` is generated from unit statuses + trail log, not hand-narrated (pstack orchestrate: "status.md is derived", `playbooks/orchestrate.md:32`) | build process | Yes (how we build MIRAI) |
| 48 | Dogfooding (brief) | `bmad-method/tools/dogfood.py` (BMAD installs itself into a worktree) | Adapt | Once statuses, logging and config exist, every later unit uses them | build process | Yes |
| 49 | External-skill security gate (brief) | `vercel-labs-skills/skills/find-skills/SKILL.md` (popularity checks only); BMAD `bmad-toolsmith/scripts/scan_scripts.py` (flags network calls, model ids); this doc set's `06-skill-vetting.md` | Build new | A repeatable vetting checklist + scan script; verdict log; pinned vendored copies | `mirai-vet` (part of `mirai-find-skills`) | Later |
| 50 | Developer context with clean-code / DDD patterns (Guide:86) | pilot `backend/AGENTS.md` layering table + `LayoutTest.php`; pstack principles (`principle-model-the-domain`, `boundary-discipline`) | Adapt | Part of CODING_CONVENTIONS, with each pattern tagged "enforced by" | context file | Yes |
| 51 | Mary vs Brainstorming (Guide:184-216) | `bmad-method/skills/bmad-agent-analyst/customize.toml:55-58` (BP → `bmad-brainstorming`) | Reuse logic | Same split: the analyst routes, brainstorming runs one session. Folded into #1 and #14 | — | — |
| 52 | Lauren: small, meaningful PRs (Lauren:114-118) | `bmad-method/skills/bmad-build/workflow.md:23-31` (single goal); pstack `playbooks/opening-a-pr.md` ("Prefer five narrow PRs to one large PR") | Reuse logic | One ticket = one PR; build splits multi-goal intents | part of `mirai-build` | Yes |
| 53 | Lauren: local before cloud (Lauren:83-89) | pstack `docs/guide/07-overnight.md:7-16` | Reuse logic | MVP is local only; no cloud agents or unattended loops | scope rule | Yes |
| 54 | Lauren: cost and ROI (Lauren:120-124) | bmad-loop `docs/reference/configuration.md:84-104` (token budgets); pilot `.claude/hooks/tool-output-truncate.py`; pstack `setup-pstack` budgets | Adapt | Ceremony scales with risk; per-workflow token logging feeds metrics | part of `mirai.config` + `mirai-log` | Yes |
| 55 | Lauren: watch tool calls, skills from observed mistakes (Lauren:59-65) | pstack `skills/correct/SKILL.md`, `skills/reflect/SKILL.md`; BMAD `bmad-project-context` record intent | Adapt | A "record a mistake" step after each unit (Phase 4 learnings) | part of `mirai-retro` | Yes (light) |
| 56 | Lauren: feature-map handles (shortcuts, DOM selectors, stable handles) (Lauren:55, 130) | pstack `create-verification-skill/references/feature-map-example/README.md:33-42`; Benny `control-adapter.md:66` | Reuse logic | Prefer ARIA roles and `data-*` handles; ban generated classes | part of feature map | Yes |

## 2. Prior-art features you did not mention but should consider

| Feature | Source | Why it matters |
|---|---|---|
| **Hook-enforced review gate** (edit wipes approvals; verdict captured from reviewer's own output; Stop blocked until fresh PASS + green gate) | pilot `.claude/hooks/` | Turns your review rules from prose into structure. Lauren's main lesson. |
| **Spec kernel + Spec Law** (5 fields, CAP ids, derived from log) | `bmad-method/skills/bmad-spec/SKILL.md` | You require SDD (brief, hard rule 5) but your notes name no spec artifact other than the PRD and the dev spec-file. This is the missing middle: a short contract between PRD and plan. |
| **Frozen intent block** in the plan | `bmad-build/plan-template.md` | Humans own intent; agents own everything else. |
| **Review triage verdicts** (`false`, `maybe-false`, intent_gap, bad_plan) and a loop cap | `bmad-build/step-04-review.md` | Stops review churn and fake findings. |
| **Lead judgment buckets + Nitpick Gravity** | pstack `skills/interrogate/references/lead-judgment.md` | Filters reviewer noise. |
| **Copy workflow steps into the todo list; skips stay visible** | pstack `skills/poteto-mode/SKILL.md:123` | Cheapest guard against skipped steps. |
| **Confidence tiers + "document the null"** | pstack `skills/why/references/epistemics.md` | Honest research and analysis docs. |
| **Blast radius with a proven safety fact** | pstack `skills/blast-radius/SKILL.md` | Better small-change review. |
| **Floor guard** (detects weakened tests, new suppressions, lowered thresholds) | Addy `skills/constraint-driven-development/references/floor-guard.md` | Agents take "the cheapest road to green". |
| **Trigger evals for skill descriptions** (TF-IDF ranking; `claude plugin eval` with/without) | Addy `scripts/run-evals.js`, `evals/plugin/` | Proves skills fire at the right time; you asked for this. |
| **Restartable session boundary checklist** | Addy `skills/context-engineering/SKILL.md:123-137` | Directly serves your resume requirement. |
| **Input reconciliation before polish** | `bmad-prd/SKILL.md:92` | Catches what a PRD silently dropped. |
| **Research firewall and freshness bars** | `bmad-deep-recon/SKILL.md:14-17`, `types/*.md` | Research that doesn't invent. |
| **Retired names + migration files** for framework updates | `bmad-method/skills/bmod-method/retired.toml`, `migration-1.toml` | How MIRAI updates installed projects safely. |
| **Correct-course** (mid-build change request) | `bmad-correct-course/` | Missing from your notes; requirements change during build. |
| **Walkthrough** (guided human review of a PR) | `bmad-walkthrough/` | Helps you review agent work faster, which is a trust driver. |
| **Pause safely / session pickup** | pstack `playbooks/pause-safely.md`, `session-pickup.md` | Resume work cleanly; your status idea needs this. |
| **Token budgets and escalation classes** | bmad-loop `escalation.py`, `policy.toml` | Cost control (Lauren §8). |
| **Model diversity for review** | pstack `interrogate`; Addy doubt-driven cross-model CLI | Only if you have a second model family. |
| **superpowers** (`writing-plans` Review Focus section; `subagent-driven-development` "Rulings, not stalls" ledger) | `obra-superpowers/skills/` | Popular prior art you didn't list; similar SDD shape. |
