# 02 — BMAD Method analysis

Sources (all relative to `~/Projects/mirai-sources/`):

| Repo | Commit | What it is |
|---|---|---|
| `bmad-method/` | `cfba3ff` (2026-10-16) | The core method. `main` is the **v7 preview alpha**; stable v6.12 is on branch `V6.12` (`bmad-method/README.md:18-40`). |
| `bmad-tea/` | `22f38e5` (2026-10-15) | Test Architect module (TEA v3.1.0), where your `/bmad-testarch-test-design` now lives as `bmad-tea-test-design`. |
| `bmad-loop/` | `77d89f9` (2026-10-17) | Unattended epic runner (v0.13.2). |

Method: three Explore subagents built file inventories. I then read these core files myself: `bmad-prd/` (SKILL, customize, template, rubric, validate, headless), `bmad-code-review/` (all step files and customize), `bmad-build/` (workflow, steps 01-05, plan template, customize), `bmad-spec/SKILL.md`, `bmad-ticket/SKILL.md`, the Jira store config, the ticket templates, `tools/ticket-tree-rules.md`, `bmad-agent-analyst/` (SKILL and customize), `bmad/scripts/memlog.py`, `bmad-brainstorming/SKILL.md`, `bmad-project-context/SKILL.md`, `bmad-retrospective/workflow.md`, `bmad-tea-test-design/steps-c/step-03-risk-and-testability.md`, and `CHANGELOG.md`. I spot-checked the subagents' citations against these files and they held. The independent 0.6 audit then found that **my own** first-draft citations of `bmad-method/CHANGELOG.md` and `bmad-code-review/customize.toml` were shifted. I had taken those line numbers from concatenated `cat` output. They are now corrected and re-verified with `grep -n`.

**Path convention.** A path that starts with a skill folder name (`bmad-prd/...`, `bmod-method/...`, `bmad/scripts/...`) is under `bmad-method/skills/`. TEA paths are under `bmad-tea/skills/` unless they start with `bmad-tea/`. Loop paths start with `bmad-loop/`. Repo-level files are written as `bmad-method/CHANGELOG.md`, `bmad-method/tools/...` and so on.

**The most important fact for MIRAI.** Your notes describe BMAD **v6** (Mary's menu, `/bmad-testarch-test-design`, `/bmad-document-project`, "sprint status"). BMAD has since changed a lot (v6.11 on 2026-08-09, v6.12 on 2026-09-03, then v7 preview). Several of your "improvements" are now in BMAD itself (see §8). Your pilot runs **v6.12.1-next.0** (`platform/_bmad/_config/manifest.yaml`).

---

## 1. Shape of BMAD v7

- **Everything is a skill** in a flat `skills/` folder. There is no installer source tree and no `src/`. Since v6.11 the catalog has shrunk: "Core drops from fourteen skills to eight", `bmad-quick-dev`→`bmad-build`, three research skills→`bmad-deep-recon`, `bmad-document-project`+`bmad-generate-project-context`→`bmad-project-context` (`bmad-method/CHANGELOG.md:54-56`).
- **Modules** are registered by a record skill `bmod-<code>/` that holds `bmod.toml` (code, version, skill list, required skills, install messages), `retired.toml` (renames and removals), `roster.toml` (personas), `help/*.md`, and sometimes `migration-N.toml`. There are three records in core: `bmod-core-tools` (8 skills), `bmod-method` (20 skills), `bmod-toolsmith` (2 skills) (`bmod-core-tools/bmod.toml`, `bmod-method/bmod.toml`, `bmod-toolsmith/bmod.toml`).
- **"There is no installer plugin, registry, or build step. A module is installed with `npx skills add <owner>/<repo>`, and `bmad` finds it on its next run"** (`bmod-core-tools/help/modules.md:7`).
- **Python helpers via `uv`** are mandatory for setup and for rendered skills (`bmad/references/setup.md:3`; `CHANGELOG.md:72`).

---

## 2. Full inventory

### 2.1 Hub and module records

| Skill | Purpose | Key files |
|---|---|---|
| `bmad` | Hub. Help ("Every help answer comes from the installed modules' own help, never from memory", `bmad/SKILL.md:23`), setup, update, repair, status, migrate, active initiative | `references/{help,setup,migrate,initiative}.md`; 12 scripts incl. `setup.py` (2,490 lines), `memlog.py`, `render_skill.py`, `resolve_config.py`, `resolve_customization.py`, `knowledge.py`, `roster.py`, `migrate_v6.py`, `validate_manifests.py` |
| `bmod-core-tools` | Record: bmad, advanced-elicitation, brainstorming, customize, deep-recon, forge-idea, party-mode, review | `bmod.toml`, `retired.toml`, `help/*.md` (help, customization, modules, party-mode, research, team-adoption) |
| `bmod-method` | Record: 5 agents + architecture, build, build-auto, code-review, correct-course, prd, prfaq, product-brief, project-context, qa-generate-e2e-tests, retrospective, spec, ticket, ux, walkthrough | `bmod.toml`, `retired.toml` (46 removed v6 names), `roster.toml`, `migration-1.toml` (v6→v7, 210 lines), `help/*.md` (16 topic files) |
| `bmod-toolsmith` | Record: toolsmith, eval | `bmod.toml`, `retired.toml`, `roster.toml`, `help/*.md` (24 files) |

### 2.2 Agents (personas)

**All five share one 75-line SKILL.md**, with only the names and descriptions changed (Explore inventory, confirmed by reading `bmad-agent-analyst/SKILL.md`). An agent is a persona plus a menu that dispatches to skills. It does no work itself.

Activation steps (`bmad-agent-analyst/SKILL.md:19-75`):
1. Resolve `[agent]` from `customize.toml` → `_bmad/custom/<skill>.toml` → `.user.toml`.
2. Run the prepend steps.
3. Adopt the persona: "Do not break character until the user dismisses the persona. When the user calls a skill, this persona carries through".
4. Load the persistent facts.
5. Load the config and find docs by the `<type>-*/<type>-*.md` convention.
6. Greet, prefixing every message with the icon.
7. Run the append steps.
8. Dispatch directly if the first message maps to a menu item. Otherwise render the menu and "**Stop and wait for input.**"

| Agent | Persona | Menu (code → skill) | Guardrails in prompt |
|---|---|---|---|
| `bmad-agent-analyst` | Mary 📊, "Porter's strategic rigor and Minto's Pyramid Principle" | BP→brainstorming; MR, DR, TR, CR, UV→deep-recon (type pre-set); TS→deep-recon "select" shape; CB→product-brief; WB→prfaq; PC→project-context (`customize.toml:55-103`) | Principles: "Every finding grounded in verifiable evidence", "Requirements stated with absolute precision", "Every stakeholder voice represented" (`:45-49`) |
| `bmad-agent-pm` | John 📋 | PRD→prd; CC→correct-course; TK→ticket | "PRDs emerge from user interviews, not template filling", "Ship the smallest thing that validates the assumption" |
| `bmad-agent-architect` | Winston 🏗️ | CA→architecture; TK→ticket | "Rule of Three before abstraction", "Boring technology for stability" |
| `bmad-agent-ux-designer` | Sally 🎨 | CU→ux | "Data-informed, but always creative" |
| `bmad-agent-dev` | Amelia 💻 | BD→build; QA→qa-generate-e2e-tests; CR→code-review; ER→retrospective; TK→ticket | "No task complete without passing tests", "Never add epic or story references as inline code comments" |
| `bmad-toolsmith` | Smithy ⚒️ | BUILD→`discover.md`; SCAFFOLD→`discover.md` (approach fixed to scaffold); LOGS→`approaches/from-logs.md`; EDIT/CONVERT/REVIEW/CUT/PACKAGE/VALIDATE/MIGRATE→`modes/<name>.md`; EVAL→skill `bmad-eval` (`bmad-toolsmith/customize.toml:57-110`) | "Nothing is written to disk until the user has approved a read-back" (`bmad-toolsmith/SKILL.md:28`) |
| `bmad-tea` (TEA) | Murat 🧪 | TMT→teach-me-testing; TD→test-design; TF→framework; CI→framework (`setup_scope=ci`); AT→automate (`test_mode=red`, i.e. ATDD); TA→automate (expand); EV→evaluate; GATE→prompt that routes test-review → nfr → trace phase 2 ("Do not merge these workflows"); RV→test-review; NR→nfr; TR→trace (`bmad-tea/skills/bmad-tea/customize.toml:60-113`). Routing-ambiguity table at `SKILL.md:97-106`, unservable-request table at `:115-124` | "Risk-based testing — depth scales with impact", "Quality gates backed by data, not vibes" |

### 2.3 Workflow skills (method + core tools)

| Skill | Trigger (description) | Intents / modes | Main output | State / resume |
|---|---|---|---|---|
| `bmad-brainstorming` | "help me brainstorm / ideate" | Facilitator / Creative Partner / Ideate-for-me; headless | `brainstorm-<slug>/` with `.memlog.md`, optional HTML keepsake, intent doc | memlog frontmatter `status` set `complete` at finalize; resume globs `brainstorm-*/.memlog.md` (`SKILL.md:29`) |
| `bmad-product-brief` | create/update/validate a brief | Create / Update / Validate; Fast or Coaching | `brief-<slug>/brief-<slug>.md` + addendum | `status: draft`; resume offered |
| `bmad-prfaq` | "work backwards", "PRFAQ challenge" | 5 stages: Ignition, Press Release, Customer FAQ, Internal FAQ, Verdict | `prfaq-<slug>.md` + `-distillate.md` | frontmatter `stage` 2→5 and `status` |
| `bmad-prd` | create/edit/validate a PRD | Create / Update / Validate; Fast or Coaching (Vision+Features or Journey-led) | `prd-<slug>/prd-<slug>.md`, `addendum.md`, `.memlog.md`, `review-*.md`, `reconcile-*.md`, `validation-report.{html,md}` | `status: draft`→`final`; resume = runs with `status != final` (`SKILL.md:28`) |
| `bmad-ux` | "create UX design" | Create / Update / Validate; Fast / Coaching / Design handoff | `DESIGN.md` + `EXPERIENCE.md` + mockups | `status` → `final` |
| `bmad-architecture` | "create the architecture / solution design" | create / update / validate; altitude initiative, feature or epic | `architecture-<slug>.md` "spine" with `AD-n` decisions (Binds / Prevents / Rule) | memlog; `status: final`; `lint_spine.py` |
| `bmad-spec` | "create a spec", "distill this" | create / update / validate; express or guided; headless | `spec-<slug>/spec-<slug>.md` five-field kernel + companions | spec **derived from** memlog; memlog has no status |
| `bmad-ticket` | "create initiative", "slice", "make a ticket", "what's ready" | Standalone / Epic / Initiative; publish / start / move / close; validate; store setup | ticket tree under `{output_folder}/{active_initiative}/` | `tickets.toml` + per-leaf plan `status` |
| `bmad-build` | delegate a feature, story, bug | route oneshot / full / auto; review none / quick / thorough / auto | `<type>-<slug>-plan.md` or `plan-<slug>.md` + a local commit | plan `status` draft→ready-for-dev→in-progress→in-review→built |
| `bmad-build-auto` | "one iteration of an unattended development loop" | no human; HALT protocol | same plan + `## Auto Run Result` | adds `blocked`; `deferred:` list in frontmatter |
| `bmad-code-review` | "run code review" | quick / thorough; interactive true/false; fixes apply/handoff | `## Code Review` block appended to the plan + `deferred-work.md` | "Never change a plan's `status`" (`step-04-present.md:10`) |
| `bmad-qa-generate-e2e-tests` | e2e/API tests for working features | 5 phases | test files; chat report only | none |
| `bmad-retrospective` | "run a retrospective"; `-H` headless | 5 phases | `epic-<slug>-retrospective.md` with `verdict` | resumes at first incomplete phase |
| `bmad-correct-course` | "correct course", "propose sprint change" | Incremental / Batch | `change-<slug>/change-<slug>.md` sprint change proposal | none |
| `bmad-project-context` | "Use when invoked by name" | setup / adopt / refresh / record / audit | one managed `<!-- bmad:context -->` block in `AGENTS.md` | provenance line "Verified <date> against <sha>" |
| `bmad-deep-recon` | "deep recon", "market research", "research the codebase" | codebase / draft / process / run / refresh / deepen; type packs; explore or select | `research-<slug>/` with `brief.md`, `digests/`, report, memlog | memlog; `status: draft`→`complete` |
| `bmad-review` | "review" (and only when asked) | lenses: adversarial, edge-case-hunter, verification-gap, structure, prose | findings JSON / markdown | none |
| `bmad-walkthrough` | guided human review of a commit or PR | step files 01-03 | `walkthrough-<slug>/` narrative + append-only log | narrative checkboxes |
| `bmad-party-mode` | "party mode", "roundtable" | session / auto / subagent / agent-team | keepsake HTML; memlog per party | per-party memlog |
| `bmad-advanced-elicitation` | "socratic, first principles, pre-mortem, red team" | 71 methods in 12 categories (`assets/methods.csv`) | improves work in place | none |
| `bmad-forge-idea` | "pressure-test this idea" | attack / defend / switch roles | `forge-<slug>/` + verdict HTML (HARDENED / KILLED / CLARIFIED) | memlog `status` |
| `bmad-customize` | "customize bmad", "override a skill" | Directed / Exploratory / Audit / Cross-cutting | `_bmad/custom/<skill>.toml` or `.user.toml` | none |
| `bmad-eval` | "evaluate / benchmark a skill" | baseline / variant / quality / trigger | eval-report folder | run folders never deleted |

### 2.4 TEA (Test Architect) skills

| Skill | Purpose | Output |
|---|---|---|
| `bmad-tea-test-design` | System-level or epic-level **risk-based test plan** (your `/bmad-testarch-test-design`) | `test-design-architecture.md` + `test-design-qa.md` + handoff, or `test-design-epic-N.md` |
| `bmad-tea-trace` | Traceability matrix + **quality gate decision** PASS / CONCERNS / FAIL / WAIVED | `trace/gate-decision-{run_key}.json` + report |
| `bmad-tea-automate` | Expand coverage, or **red mode = ATDD** (failing acceptance tests first) with run-and-heal | `automation-summary-*.md`, `atdd-checklist-*.md` |
| `bmad-tea-nfr` | Audit NFR evidence (security, performance, reliability, maintainability) | `nfr-assessment-*.md` |
| `bmad-tea-framework` | Set up a test framework and CI (GitHub Actions, GitLab, Azure, Harness, Jenkins); installs a write-time enforcement hook `tea-enforce.cjs` | framework + CI files, progress journals |
| `bmad-tea-test-review` | Score test quality 0-100 against a criteria registry (C1-C7 critical … L1-L9) | `test-review-*.md` |
| `bmad-tea-teach-me-testing` | 7-session testing course with quizzes | progress YAML |
| `bmad-tea-evaluate` | Scored behavioral evals of an agent with mutation testing | eval artifacts |
| `bmod-tea` | Record + 59-fragment knowledge base indexed by `tea-index.csv` | — |

### 2.5 bmad-loop

A Python orchestrator. "Plain Python drives the loop — pick story → implement → adversarially review → verify → commit — while LLMs do only the creative work, inside disposable, fresh-context coding-agent sessions" (`bmad-loop/README.md:5-7`). Hard invariant: "No LLM calls in the orchestrator control loop" (`bmad-loop/AGENTS.md:25`). Details in §4.8.

Its skills and data files (`bmad-loop/src/bmad_loop/data/`):

| Item | Purpose | Trigger | Output |
|---|---|---|---|
| `skills/bmad-loop-setup/` (161 lines) | Install or upgrade the orchestrator: `uv tool install "bmad-loop[tui] @ git+https://..."` (`SKILL.md:73-96`), then `bmad-loop init --project ... --cli <name>`, then `bmad-loop validate`. "The BMAD installer owns `_bmad/` registration; this skill does not" (`:14`) | user asks to set up bmad-loop | hooks merged into the CLI's settings, skills copied, `.bmad-loop/policy.toml`, gitignore entries |
| `skills/bmad-loop-sweep/` (134 lines + `automation-mode.md`, `deferred-work-format.md`, `migration-mode.md`) | "Triage the deferred-work ledger ... return a machine-readable partition (bundles, already-resolved, blocked, skip, human decisions)" (`SKILL.md:3`). Read-only: "never edit the ledger, never edit code, never ask questions" (`:12-15`). Exits unless `BMAD_LOOP_MODE=1` | orchestrator only ("Automation-only") | result file with the partition |
| `skills/bmad-loop-resolve/` (381 lines) | Interactive resolution of a CRITICAL escalation: "resolve the ambiguity with the human and update the frozen spec, so the orchestrator can re-arm the story" (`SKILL.md:8-14`). A human is present; `$BMAD_LOOP_MODE` is deliberately unset | `/bmad-loop-resolve <story-key>` after a pause | `resolution.json` + spec edits |
| `skills/bmod-bmad-loop/` | Module record; "Never invoke this skill" | — | — |
| `bmad_loop_hook.py` | Stdlib hook relay: writes one event file per hook event into the run's events dir; no-ops unless the session was spawned by bmad-loop; adds a `lineage` tag (`:1-40`) | CLI hook events | event files |
| `bmad_loop_probe_hook.py` | Hook used to probe the CLI's hook support | `bmad-loop validate` | probe result |
| `profiles/*.toml` | One per CLI (claude, codex, gemini, copilot, antigravity, opencode): launch args, hook events. Claude: `bypass_args = ["--permission-mode", "bypassPermissions"]` (`claude.toml:5`) | — | — |
| `settings/core.toml` | Policy schema and defaults (gates, review, limits, verify, scm, sweep) | — | — |
| `plugins/{tea,unity,example}/plugin.toml` | Workflow-stage plugins (`post_dev_phase`, `post_review_result`, `pre_commit_gate`) that can veto a commit. The TEA plugin runs test design/ATDD/automate after dev and trace/NFR/review before commit; advisory by default (`plugins/tea/plugin.toml:10-11`) | `[plugins] enabled` | verdict files |

### 2.6 Tools and templates (repo-level)

- `tools/ticket-tree-rules.md`: the cross-skill contract for the ticket tree. "No skill loads it: each one states the rules it acts on in its own files" (`:5`).
- `tools/skill-validator.md` + `validate_skills.py` (deterministic rules SKILL-01..07, PATH-*, SEQ-*, TPL-01) + `validate_file_refs.py`.
- Templates: PRD template (`bmad-prd/assets/prd-template.md`), PRD rubric (`assets/prd-validation-checklist.md`), spec template, architecture spine, brief, five ticket templates, `tickets-template.toml`, the plan template, the retrospective doc, and the TEA templates.

---

## 3. Workflow mechanics, one by one

### 3.1 PRD (`bmad-prd/`), read in full

**Trigger.** "Create, update, or validate a PRD" (`SKILL.md:3`). Opening stance: "Fight the urge to do the thinking for them unless they put you into Fast path" (`:7`).

**Activation** (`:16-32`):
1. Resolve customization.
2. Run the prepend steps and load `persistent_facts`. `external_sources` is a registry of org tools consulted on demand.
3. Resolve `core.output_folder` and `core.active_initiative`. With no initiative, hand off to `bmad`.
4. Greet and mention party-mode and elicitation. **Misroute scan**: an express build goes to `bmad-build`, a one-pager to `bmad-product-brief`, idea vetting to `bmad-prfaq`.
5. Detect the intent. For Create, **scan for prior runs whose `status` is not `final` and offer to resume** (`:28`).

**Create** (`:36`): bind `{doc_workspace}`, write the PRD with frontmatter `status: draft`, run `memlog.py init`, and tell the user the path. Then Discovery, then Finalize.

**Update** (`:38`): source-extract against the PRD, addendum, memlog and inputs. If the memlog is missing, a bootstrap subagent reverse-engineers one. "Surface conflicts with prior decisions before applying."

**Validate**: `references/validate.md`.

**Discovery** (`:42-65`):
1. **Brain dump** first. Ask for existing inputs (brief, research, transcripts, competitor analysis, design docs), then "anything else?"
2. **Research subagents by default.**
3. "Elicitation, not direction ... When you find yourself naming wedges, picking MVP cuts, or proposing phases, stop."
4. Stakes calibration: hobby / internal / launch.
5. Working mode: **Fast path** (batched questions, then a full draft with `[ASSUMPTION]` tags) or **Coaching path** (Vision+Features or Journey-led).
6. Concern scan (compliance, integrations, SLAs...), form-factor probe.
7. "User Journeys are captured, not authored". Named protagonists, UJ-N ids.

**PRD discipline** (`:67-73`): globally numbered FR ids; NFRs in their own section; tech choices go to `addendum.md`; counter-metrics required when there are success metrics; "Extract, don't ingest" (source docs go to subagents); length scales with stakes (hobby about 2 pages, internal 5-8).

**Template** (`assets/prd-template.md`): Essential Spine (§0 Document Purpose … §9 Assumptions Index) plus an Adapt-In Menu of clusters (Enterprise, Regulated, Developer products, ...). FR format: "[Actor] can [capability] [under conditions]" + "Consequences (testable)" + Out of Scope.

**Reviewer gate** (`:75-85`):
- A rubric walker plus `finalize_reviewers` plus ad-hoc reviewers run as parallel subagents.
- "Each writes its full review to `{doc_workspace}/review-{lens}.md` and returns ONLY a compact summary ... the parent never holds full review text" (`:81`).
- Findings are surfaced tiered (critical/high first, the rest as "plus N more in {file}"). For each finding: autofix / discuss / defer / ignore.

**Rubric** (`assets/prd-validation-checklist.md`): seven dimensions, each judged strong / adequate / thin / broken:
1. Decision-readiness.
2. Substance over theater (persona, innovation, NFR and vision "theater").
3. Strategic coherence.
4. Done-ness clarity ("Be unforgiving here").
5. Scope honesty (open-items density relative to stakes).
6. Downstream usability.
7. Shape fit.

Plus mechanical notes.

**Validate synthesis** (`references/validate.md:21-48`): the grade is Excellent / Good / Fair / Poor, derived by fixed rules. Output is `validation-report.html` plus a markdown twin.

**Finalize** (`:87-98`):
1. Memlog audit.
2. **Input reconciliation**: one subagent per user input, catching what the PRD silently dropped.
3. Reviewer gate.
4. Triage open items (phase-blockers resolved one at a time).
5. Polish via `doc_standards` (default `skill:bmad-review lenses=structure,prose`).
6. **External handoffs** (e.g. Confluence or Notion via MCP).
7. Set `status: final`, add a memlog event.
8. `on_complete`.

**Headless** (`references/headless.md`): no questions; `assumptions[]` and `open_questions[]`; JSON status `complete` / `partial` / `blocked`.

**Human checkpoints:** brain dump, working-mode choice, gate menu, each critical finding, each phase-blocker.

**Handoff:** `bmad-ux`, `bmad-architecture`, `bmad-ticket`.

### 3.2 Spec (`bmad-spec/SKILL.md`), read in full

- **Five-field kernel**: Why, Capabilities (`CAP-n` with intent and success), Constraints, Non-goals, Success signal (`:9`).
- **The spec is derived, never hand-edited.** "`.memlog.md` is canonical ... `spec-{slug}.md` and every spec-authored companion are **derived on each run** from the memlog ... bmad-spec is its single writer; a hand-edit ... is overwritten on the next derive" (`:56-60`). The reason: "Deriving the contract from a living log instead of editing the contract in place is what lets the steps around the spec (PRD, UX, architecture, epics) run in any order and feed the same spec without merge drift" (`:60`).
- **Companions**: spec-authored (glossary, stack, conventions, brownfield, diagrams) or adopted (`../ux-foo/DESIGN.md`, `project-context.md`). "Diagrams always land in a companion" (`:102`).
- **Spec Law**, 8 rules (`:106-117`): each capability has intent and success; WHAT not HOW; constraints must bend decisions; at least one non-goal; testable success signal; stable CAP ids; preservation; lean prose.
- **Self-validate** in two passes: coherence, then preservation, walking the source claim by claim (`:119-127`).
- "This skill distills; it does not coach" (`:82`). Thin input → suggest `bmad-prd`.
- Handoff to `bmad-ticket`: entries cite `CAP-N`. A spec update finds tickets that reference the spec and offers to re-slice, but "The update itself never edits a ticket" (`:133-139`).

### 3.3 Ticket (`bmad-ticket/`, `tools/ticket-tree-rules.md`), read in full

- **Tree** `{output_folder}/{active_initiative}/`: `initiative-<slug>.md`, `tickets.toml` (epics in build order), `epic-<slug>/` with its own `tickets.toml`, story/spike/bug files when "pulled", and `<type>-<slug>-plan.md` beside each leaf (`SKILL.md:75-98`).
- **Entries without files**: a leaf can be built from its `tickets.toml` entry alone; a file is written only on "pull" (to review, refine, or publish).
- **Templates** with frontmatter `id, type, title, parent, covers, after, hitl, risk` (+ `severity` P0-P3 on bugs).
  - Story: Description / Acceptance Criteria (Given/When/Then when refined) / Boundaries / References / Notes.
  - Bug: adds Reproduction and Cause Hypothesis, "never a fix".
- **Status lives in the plan, not the ticket** (`ticket-tree-rules.md:21-35`).
  - Plan values: `draft, ready-for-dev, in-progress, in-review, built, done, blocked, dropped`.
  - Board mapping: none/draft/ready-for-dev → backlog; in-progress/blocked → in-progress; in-review/built → review.
  - Writers: the build skills write `draft…built`; `bmad-build-auto` writes `blocked`; **only the user or an orchestrator writes `done`** via `tickets.py mark`; `bmad-ticket` writes `dropped`.
  - "**No skill moves a ticket past `built`**" (`:35`).
- **Stores**: repo (default), Jira (via `acli`), GitHub (`gh`), Linear, Notion, Trello (MCP), each a TOML file of verbs `setup`/`write`/`query` plus type and status maps (`config/*-ticketing.toml`).
  - Jira: "In Review" is "not a default Jira status; `setup` asks for it" (`jira-ticketing.toml:81`).
  - Setup proves the store by creating and deleting a test ticket (`references/store-setup.md`).
- **Validation always runs on a draft breakdown** with independent subagents (Ticket, Set, Tree, Dependencies, Closure checks), with findings merged into fix / suggest / ask (`references/validate.md`).
- **Slicing rules** (`references/slice.md`):
  - The first story is a tracer bullet.
  - "Split, never shrink"; typical 8-12 stories.
  - A closing "Refactor sweep" is required when an epic has more than 3 entries.
  - Every decision is recorded as a dated `Decision:` line "when it is made, not after approval".
- `tickets.py` (1,473 lines, 1,659 lines of tests) owns `next` / `status` / `find` / `pull` / `mark` / `mirror`, with JSON output and diagnostics (`unpinned_after`, `order_conflict`, `drift`, cycles).

### 3.4 Build (`bmad-build/`), read in full

**Standards** (`workflow.md:12-31`):
- **READY FOR DEVELOPMENT**: Actionable, Logical, Testable (Given/When/Then), Complete, Sufficient, Coherent.
- **SCOPE STANDARD**: a single user-facing goal, plan of 900-1,600 tokens ("Below 900 risks ambiguity; above 1600 risks context-rot"). "Neither limit is a gate."

**Step 1, clarify and route** (`step-01-clarify-and-route.md`):
1. Resolve state in order: explicit arg (a ticket ref → `tickets.py find`; a plan file → EARLY EXIT by its `status`); recent conversation; the ticket tree (`tickets.py next`); otherwise list active plans and HALT with Resume / Next entry / New.
2. Load context: entry, epic, story, research docs, sibling plans' Code Map and Change Log.
3. **VCS sanity check**: a dirty tree or mismatched branch → HALT.
4. **Multi-goal check** → HALT with Split / Keep. Deferred goals go to `deferred-work.md`.

**Step 2, plan** (`step-02-plan.md`):
1. Investigate via subagents that "return short summaries only". "Do not ask the human during investigation."
2. Score `risk`.
3. Fill the plan template. Gaps become `## Open Questions`, "Never write an intent gap into the frozen block as an assumption."
4. Self-review against READY.
5. Gates: token count over 1,600 → Split / Keep; open questions → HALT.
6. **CHECKPOINT 1**: Approve and continue / **Approve and stop** (leave `ready-for-dev` for a fresh session) / Review plan.
7. "Before acting on approval, re-read `{plan_file}` from disk." Then `ready-for-dev`; the `<frozen-after-approval>` block becomes human-owned.

**Plan template** (`plan-template.md`):
- Frontmatter: `type`, `ticket`, `status`, `baseline_revision`, `route`, `risk`, `review`, `lenses_ran`, `review_loop_iteration`, `context`.
- Frozen block: Intent (Problem / Approach), Boundaries (Always / Never), I/O & Edge-Case Matrix.
- Agent-owned sections: Code Map, Tasks & Acceptance, **append-only** Implementation Notes, Plan Change Log, Review Triage Log, Design Notes, Verification (commands + manual checks).

**Step 3, implement** (`step-03-implement.md`):
1. Capture `baseline_revision` (never overwritten on resume) and set `in-progress`.
2. Execute `implementation_handoff`, which by default is "Launch a subagent with no prior conversation context ... Read {plan_file} fully and implement it — the plan is the sole source of truth" (`customize.toml:85-91`). The parent is barred from restating goals or file lists in the dispatch.
3. Stage the diff since baseline, "Judge against the diff, not just the implementation subagent's report."
4. **Matrix test audit**: every I/O-matrix row needs a test that actually ran and passed; "never edit the expectation to match the code".

**Step 4, review** (`step-04-review.md`):
1. Set `in-review`; launch all lenses in parallel ("spawn every reviewer before reading or reacting to any of their output").
2. Classify: disregard reviewer severity; verify every claim at the cited location; render one verdict `high` / `medium` / `low` / `false` / `maybe-false`; log every finding in `## Review Triage Log`.
3. Route:
   - **intent_gap**: revert, ask the human.
   - **bad_plan**: keep the KEEP instructions, revert, amend the plan, log it in the Change Log, re-implement.
   - **patch**: re-engage the *same* implementer.
   - **defer**: to `deferred-work.md`.
4. Loop cap: `review_loop_iteration` over 5 → HALT.

**Step 5, present**: set `built`, local commit, "NEVER auto-push", offer a PR or `bmad-walkthrough`.

### 3.5 Code review (`bmad-code-review/`), read in full

Your notes describe the v6.12 version. The v7 version differs in four ways.

**What's new:**
1. `quick` vs `thorough` lens sets (`bmad-code-review/customize.toml:43, 72-152`). Quick is one combined reviewer; thorough is Blind Hunter + Edge Case Hunter + Verification Gap + **Intent Alignment Auditor**.
2. The "Acceptance Auditor" became the Intent Alignment Auditor. It receives the verbatim intent and reports "(1) the defensible readings of the intent ... (2) which reading this diff implements; (3) where the readings and the diff diverge" (`bmad-code-review/customize.toml:148`).
3. A `fixes = handoff` "no-code review" mode writes a block for a coding agent instead of patching (`step-04-present.md:70-75`).
4. A `interactive = false` mode for CI/bots.

**What stays the same:**
- Gather target: request → ticket tree `review` rows → current branch → ask.
- The diff goes to a temp file outside the repo; "the diff text is never pasted into their prompts" (`step-01:32`).
- Claims (commit messages) are staged in a separate file only the edge-case lens reads.
- Blind Hunter's finding floor is `N = min(floor(sqrt(kB)+1), 10)` (`bmad-code-review/customize.toml:94`).
- Triage verdicts and buckets are `decision_needed` / `patch` / `defer`; "An entry this change caused ... is never `defer`" (`step-03:42`).
- Failed layers produce a warning, never a "clean review".
- Findings are written to the plan's `## Code Review` with checkboxes; the patch menu is Apply all / Leave as action items / Walk through each.

### 3.6 Project context (`bmad-project-context/SKILL.md`), read in full

- **Intents**: setup, adopt, refresh, record, audit. "A supplied intent that contradicts what detection finds ... is surfaced and confirmed, never silently obeyed."
- **"No writes until step 5!"** Steps:
  1. Assess and open a **ledger**: one entry per existing instruction, with `retain | rewrite | relocate | automate | delete` plus reason, evidence, risk and approval.
  2. Ask what they bring.
  3. Discover and verify with parallel subagents: "Path-check every claim naming a file. For every claim the block will make about what a command does, read the target or script that runs it and verify the claim."
  4. Interview the gaps: "Never ask what a scan could answer", "Batches of at most eight ... A batch yielding nothing new means write."
  5. Show the block and the settled ledger, then write between markers. For each candidate line, "ask first whether a hook, lint rule, or CI check enforces it better than prose". "Never commit."
  6. Close.
- **Output**: one small verified block in AGENTS.md, **not** generated documentation. The v6.11 changelog: "no generated overview, source-tree, or deep-dive pages and no `project-context.md`, just one verified block in `AGENTS.md`" (`CHANGELOG.md:68`). This is the answer to your note that "project scan was deprecated because it generated too much context".
- **Admission test**: "anything derivable from source is read live and never stored, so `pnpm test` stays out while 'the suite takes eleven minutes' goes in" (`CHANGELOG.md:79`).
- **Deletion grounds**, from `references/best-practices.md`:
  1. Stale or incorrect.
  2. Mechanically enforced.
  3. Harmful.
  4. User-approved.
  - "'it is discoverable somewhere in the repository' is never, alone, grounds".

### 3.7 Deep recon (`bmad-deep-recon/`)

- Covers Mary's MR/DR/TR/CR/UV/TS. "Never conclude from training data alone." **Research firewall**: "project context shapes what to ask, never what is true. Research subagents receive only their brief" (`SKILL.md:14-17`).
- **Modes**:
  - **Draft**: produce a paste-ready prompt for your own ChatGPT/Gemini/Perplexity deep research.
  - **Process**: ingest that report into cited digests.
  - **Run**: research here, with presets quick/standard/deep, a single hard plan gate, rounds with stop rules, and a fan-out brief with budgets.
  - **Codebase**: locator/analyzer/historian/verifier roles, with citations `path:line (symbol) @ sha`.
- **Verification levels**: normal / high / max. Each claim is verified / disputed / unverified / overturned. Optional red team.
- `recon_kit.py`: `citations`, `tally`, `staleness`, `slug`, `anchors` (re-finds code citations at a commit).
- **Type packs** (market, domain, technical, competitive, user-voice, academic-lit) each define dimensions, freshness bars (e.g. "pricing ≤ 3 mo"), two-source classes, and the downstream skill they feed.

### 3.8 Brainstorming (`bmad-brainstorming/`)

- Three stances, fixed for the run. "Aim past 100 ideas; resist concluding." Shift domain every 5-10 turns. "One prompt per message ... no multiple-choice menus."
- 108 techniques in 13 categories (`assets/brain-methods.csv`). An HTML "composer" page lets the user pick techniques.
- Converge with one move: Affinity, Impact-Effort, NUF, Dot vote, PMI, MoSCoW.
- Outputs are delegated to subagents: keepsake HTML and an intent doc for brief/PRD.

### 3.9 Retrospective (`bmad-retrospective/`)

- "Every finding you report carries a source reference ... A claim you cannot point at ... is not a finding. Drop it" (`workflow.md:5`).
- **Phases**:
  1. Gather: plans, diffs between `baseline_revision`s, session logs; `git_evidence.py` measures churn.
  2. Analyze: architecture delta, duplication, god-class growth, pattern divergence, spec reconciliation; plus a `bmad-review` diff-scope pass and an end-to-end behavior check.
  3. Optional party-mode discussion seeded only with sourced findings.
  4. Decide: two dispositions per finding (instance and prevention lesson); ADRs proposed only for "hard to reverse, surprising without context, and the result of a real trade-off" decisions.
  5. Verdict: `accepted` / `accepted-with-open-items` / `rejected`. Pending tickets force `rejected`.
- "no status change, no `tickets.py mark`, and no edit to the epic file" (`workflow.md:100`).
- "Never state time estimates".

### 3.10 The remaining method and core workflows

Each entry gives trigger → flow → inputs/outputs → checkpoints → state/resume → handoff. Sources are the Explore inventory, cross-checked against the files listed.

**Product brief** (`bmad-product-brief/SKILL.md`, 95 lines; `assets/brief-template.md`, 41 lines)
- Trigger: create/update/validate a brief.
- Flow:
  1. Activation, with `external_sources` consulted on demand (`:18-29`).
  2. Discovery (`:71`): "Read what exists first; ask only what is missing", then "anything else?"; read the stakes early; web-research subagents return digests; deep work goes to deep-recon.
  3. Working mode: Fast path (batched questions, `[ASSUMPTION]` tags) or Coaching path (`:73-78`).
  4. Finalize (`:91-95`): memlog audit + addendum review, then polish with `doc_standards`, then `external_handoffs`, then next steps via `bmad`.
- Template: Executive Summary, The Problem, The Solution, What Makes This Different, Who This Serves, Success Criteria, Scope, Vision. It is "a starting structure, not a contract".
- State: `status: draft`, resume offered (`:83-85`). Update surfaces conflicts with prior decisions (`:37`).
- Handoff: PRD.

**PRFAQ** (`bmad-prfaq/SKILL.md`, 136 lines; `agents/artifact-analyzer.md`, `agents/web-researcher.md`; `references/{press-release,customer-faq,internal-faq,verdict}.md`; `assets/prfaq-template.md`)
- Trigger: "work backwards".
- Flow, five stages:
  1. **Ignition** (`SKILL.md:89-126`): customer-first enforcement (redirect solution-first openers); essentials are customer, problem, stakes, concept; "do not read user-provided files yourself". Two parallel subagents run: the Artifact Analyzer (JSON under 1,500 tokens) and the Web Researcher (3-5 searches, under 1,000 tokens).
  2. **Press release** (`press-release.md`): banned weasel words ("significantly", "revolutionary"), mom test, "so what?" test.
  3. **Customer FAQ**: 6-10 questions including "The hard question they're afraid of". Each gap forces a call: launch blocker, fast-follow, or accepted trade-off (`customer-faq.md:13-35`).
  4. **Internal FAQ**: 6-10 questions including "The question the founder avoids".
  5. **Verdict**: "Forged in steel / Needs more heat / Cracks in the foundation", plus an always-produced `-distillate.md` (`verdict.md:16-52`).
- State: frontmatter `stage` 2→5 and `status`. Resume reads the first 20 lines of the file to find the stage (`SKILL.md:73`).
- Handoff: "tell your PM 'create a PRD'".

**UX** (`bmad-ux/SKILL.md`, 95 lines; `references/{design-md-spec,creative-tools,validate,headless}.md`; 9 assets)
- Outputs: `DESIGN.md` (tokens frontmatter, locked section order, `references/design-md-spec.md:9-50`) and `EXPERIENCE.md` (Foundation, IA, Voice and Tone, Component/State Patterns, Interaction Primitives, Accessibility Floor, Key Flows).
- Flow:
  1. Discovery: "Capture; do not author" (`:57-77`).
  2. Creative tools are subagent renderers: 4-6 color themes, 3-6 directions, Excalidraw wireframes, 2-4 key screens. Each returns "ONLY a compact summary" (`creative-tools.md:17`).
  3. "Surface closure": every need has a surface and every surface has a journey.
  4. The reviewer gate is opt-in. The rubric has Pass 1 mechanical checks (flow, token, component, state coverage) and Pass 2 judgment (bloat, inheritance, shape fit) (`references/validate.md:17-60`).
  5. Finalize, in 8 outcomes, including "These will be built from spine tables alone — any need a visual reference?" (`SKILL.md:85-94`).
- State: `status: final` on both files.
- Handoff: architecture, ticket, build.

**Architecture** (`bmad-architecture/SKILL.md`, 91 lines; `assets/spine-template.md`; `references/reviewer-gate.md`; `scripts/lint_spine.py`)
- Core test: see the bullet below (`:13`).
- Flow:
  1. Coaching is the default; load-bearing calls "are shown, not silently made" (`:21`).
  2. Mandatory question: is the spine the only deliverable? (`:64`).
  3. Altitude: initiative → features → epics → stories. A parent spine's ADs are "binding, read-only" (`:29-31`).
  4. Memlog types `decision|constraint|version|assumption|question|direction|event`; the spine is "distilled from the memlog at the end, not written as you go" (`:35-40`).
  5. Finalize: distill (every AD has Binds/Prevents/Rule), reconcile inputs, run the gate (`lint_spine.py` first, then rubric + reviewers; "configured reviewers always run", `reviewer-gate.md:5-11`), triage, then optional renderings (deck, C4).
- Update keeps AD ids stable: "never renumber or reuse" (`:87`).
- Handoff: spec, ticket, build.

**Correct course** (`bmad-correct-course/SKILL.md`, 304 lines; `checklist.md`, 279 lines)
- Trigger: "correct course", "propose sprint change".
- Inputs: PRD, architecture, UX, spec and the `AGENTS.md` context block, all loaded in full. "HALT if neither a PRD nor a spec can be found" (`:101`).
- Flow:
  1. Initialize (`:105-121`): ask the trigger, the affected epics and stories, and Incremental vs Batch mode.
  2. Walk the checklist interactively, marking `[x]`/`[N/A]`/`[!]`. Sections: Trigger & Context; Epic Impact; Artifact Conflict (PRD / Architecture / UX / other); Path Forward (Direct Adjustment / Rollback / MVP Review); Proposal Components; Final Review.
  3. Draft OLD→NEW proposals; in Incremental mode each one gets Approve/Edit/Skip (`:180-185`).
  4. Write the Sprint Change Proposal: Issue Summary, Impact Analysis, Recommended Approach, Detailed Changes, Implementation Handoff by scope (Minor / Moderate / Major).
  5. Explicit approval yes/no/revise (`:242-284`).
- Routing: Minor → developer; Moderate → PO/developer; Major → PM/architect.
- State: none beyond the written proposal.

**Walkthrough** (`bmad-walkthrough/`: SKILL 14, workflow 99, step-01..03, `templates/log-template.md`)
- Trigger: guide a human review of a commit, PR, file or directory.
- Rule: "A block or the review as a whole is done only when the user says it is" (`workflow.md:1-4`). Because "Human attention is scarce", a background subagent writes the narrative and the log (`:19-27`).
- Block shapes: Intent (≤300 tokens), Broad strokes (3-5 entry points), Slices, Periphery.
- Steps: orientation → narrative (`walkthrough-<slug>/walkthrough-<slug>.md` with a checkbox per block + `-log.md`) → walkthrough moves (Thoughts, Second opinion, Formal review, Test, Drive, Wrap-up), with "Stay with the current block until the user explicitly says it is done" (`step-03:10-14`).
- Log template: append-only entries with Session ID, timestamp, Action/Result/Evidence/Open, ≤150 tokens each; dispositions fixed/accepted/deferred/open (`templates/log-template.md:5-37`).
- State: the checkboxes own block status.

**QA e2e** (`bmad-qa-generate-e2e-tests/workflow.md`, 74 lines)
- Phases:
  1. Scope from ticket/tree/branch, with a HALT to confirm the scenarios.
  2. Learn the harness: run the existing suite once ("a failing suite is a finding"); no harness → propose one and HALT before adding dependencies.
  3. Write one test per scenario, using role/label/text locators and isolated data, with no new page-object layers.
  4. Run twice; classify each failure as test wrong / harness wrong / application wrong.
  5. Report in chat only: "Do not write a summary file".
- Rules: "Never weaken an assertion", "Do not add retries" (`:60-66`).

**Forge idea** (`bmad-forge-idea/SKILL.md`, 113 lines)
- Trigger: "pressure-test this idea".
- Rules (`:68-84`): one question at a time; "Find discoverable answers yourself instead of asking"; for an existing project, check claims against files; in attack mode, "never agree with the idea until the user ends the mode". Steering commands: "attack this / defend this / switch roles".
- Each turn uses one installed persona plus one generated persona (`resolve_personas.py`).
- Memlog types `decision|assumption|crack|kill|direction|lock|note`.
- Exits: Hardened (writes a short brief), Killed ("Idea Death Certificate"), or Clarified. All write `forge-report.html` (`:102-113`).
- Resume: glob `forge-*/.memlog.md` and check `status`.

**Party mode** (`bmad-party-mode/SKILL.md`, 66 lines; `references/`; `scripts/resolve_party.py`)
- Rules: "It reads like people talking, not a report"; "They clash, and you don't resolve it"; no summaries unless asked (`:33-45`).
- Modes: `session` (inline voices, the default fallback), `auto`, `subagent` (a standing cast that stays "idle, not done"), and `agent-team` (Claude Code only).
- 9 shipped custom personas plus the groups `code-review-crew` and `anti-consensus-club` (`customize.toml:95-211`).
- Memory: a per-party memlog, distilled by a reader subagent into "a few hundred tokens" (`references/party-memory.md:13`).
- Output: an HTML keepsake.

**Advanced elicitation** (`bmad-advanced-elicitation/SKILL.md`, 66 lines; `assets/methods.csv`, 71 methods)
- Role: "BMad's shared refinement checkpoint: other skills invoke you at natural pauses" (`:8`).
- Flow: pick 2-4 categories, then a menu of 5 methods + Reshuffle / List all / Proceed (HALT). Each method's proposals get Apply / Reject / redirect: "Never change the work unless the user accepts the proposal" (`:56-66`).
- Output: none; the work improves in place.

**Customize** (`bmad-customize/SKILL.md`, 111 lines)
- Flow:
  1. Classify the intent (Directed / Exploratory / Audit / Cross-cutting).
  2. Discover with `list_customizable_skills.py`.
  3. Show the surface and compose a sparse override.
  4. Place it as team `.toml` or personal `.user.toml`, with confirmation.
  5. "Never silently overwrite", "Wait for explicit yes", then verify with the resolver (`:83-97`).

**Review** (`bmad-review/SKILL.md`, 54 lines; `references/lens-*.md`)
- Trigger: "Use when, and only when, the user asks you to review ... Never invoke this uninvited, including on edits you just made" (`:3`).
- Lenses: adversarial ("Find at least ten issues"), edge-case-hunter, verification-gap (code only), structure and prose (docs only; prose runs after structure).
- Each runs as a subagent with "Do not invoke any skill, and do not spawn subagents of your own".
- Output: JSON findings `lens, location, trigger_condition, guard_snippet, potential_consequence`, with "No severity, priority, or ranking anywhere" (`:40-54`).

**Eval** (`bmad-eval/SKILL.md`, 71 lines; `references/{eval-format,grader,harness,description-optimization,self-improvement}.md`; 5 scripts)
- Modes: baseline / variant / quality / trigger.
- Clean-room temp folder with a fresh HOME. A harness command is derived once and recorded. Cases live in `<skill>/evals/cases.json`, triggers in `evals/triggers.json`.
- Rules: "a result counts as settled only at 3 or more" runs; a grader subagent writes `grading.json`; "Never delete, overwrite or rotate a run folder" (`:46-64`).
- Description optimization: about 20 queries, a 60/40 split, the test score hidden from the improver, ≤5 rounds.

**Toolsmith** (`bmad-toolsmith/`: SKILL 31, `canon.md`, `discover.md`, `ship.md`, approaches/, modes/, lenses/, shapes/, 10 scripts)
- Flow:
  1. Discover: "Mine before you ask"; five things settle a skill (outcome, consumer, triggers and near misses, know-how source, checkability); the read-back is a halt (`discover.md:5-30`).
  2. Approach: lean / eval-first / eval-loop / skill-creator-loop / scaffold / from-logs.
  3. Ship: manifest, refine with 5 lens subagents (architecture, contract, customization, determinism, leanness, trigger) for at most two rounds, then checks (`init_skill.py --check`, `scan_paths.py`, `scan_scripts.py`, `validate_manifests.py`), cost budget (~800 tokens for a plain SKILL.md, 1,200 for an agent, `ship.md:30`), and an optional trigger eval.
- `scan_scripts.py` flags network calls, model ids and a missing PEP 723 header. Useful for vetting MIRAI's own scripts.

### 3.10b TEA workflows other than test design

**Trace** (`bmad-tea-trace/`: SKILL 93, workflow.yaml 108, checklist 693, trace-template 755, steps c/01-05 + 01b, e/01-02, v/01)
- Phase 1, coverage:
  1. Resolve the coverage oracle in order: formal requirements → API contract → external pointers → a synthetic oracle from source (5-12 journeys). HALT if none resolves (`steps-c/step-01:40-97`).
  2. Discover tests.
  3. Classify coverage FULL / PARTIAL / NONE / UNIT-ONLY / INTEGRATION-ONLY by what the evidence establishes. Tests that only name a criterion go to `rejectedEvidence` (`step-03:38-90`).
- Phase 2, gate (`step-05:74-363`):
  - P0 < 100% → FAIL; overall < 80% → FAIL; P1 < 80% → FAIL; P1 ≥ 90% → PASS; 80-89% → CONCERNS.
  - "WAIVED is never derived from coverage data ... only ... by a human".
  - A synthetic oracle or live-only coverage caps the result at CONCERNS.
- Output: `trace/gate-decision-{run_key}.json`, `e2e-trace-summary-{run_key}.json`, report. Resume from the matrix frontmatter.

**Automate** (`bmad-tea-automate/`: expand and `red/` modes, each with workflow.yaml, instructions, checklist, steps c/e/v; `resources/run-and-heal.md`, `test-generation-routing.md`)
- Expand mode:
  1. Preflight: "Run `framework` workflow first" if there is no framework.
  2. Targets by level and priority.
  3. Parallel workers (API, E2E, backend, mobile) write JSON to `/tmp`; an aggregate step writes the files.
  4. Run-and-heal.
- Red mode (ATDD):
  - A story with ACs is required.
  - Each `test.skip()` names exactly one `AC-n`, and the criterion assertion is the first that can fail (`red/steps-c/step-04c:73-100`).
  - Verified red in a disposable copy: "A correct red result executes the criterion assertion and fails for the saved missing behavior" (`run-and-heal.md:54`).
- Run-and-heal: at most 3 rounds, persisted so "a restart cannot grant three more rounds". Banned repairs: "Never introduce `test.fixme()`, additional `skip`… relaxed matchers, changed business expectations, arbitrary sleeps or larger timeouts" (`:78`).
- Output: `automation-summary-{run_key}.md` or `atdd-checklist-{story}.md`.

**NFR** (`bmad-tea-nfr/`: checklist 410, nfr-report-template 484, steps 01-05 with 04a-e workers)
- Thresholds are reused from test design. Four audit domains (security, performance, reliability, maintainability) run as parallel workers.
- "If the threshold ... was marked UNKNOWN ... the finding must be CONCERNS, never PASS" (`steps-c/nfr-status-definitions.md:21-44`). Domain status = its worst finding.
- Output: `nfr/nfr-assessment-{run_key}.md`.

**Framework + CI** (`bmad-tea-framework/`, `ci/` subfolder with 5 pipeline templates)
- Scope: framework | ci | both. Selection: Playwright by default for frontend, else Cypress; pytest/JUnit5/go test/xUnit/RSpec/cargo by backend language; Maestro for mobile (`steps-c/step-02:38-90`).
- Run journal with a single writer; an "immutable contract" is agreed before generation.
- CI gates: P0 = 100%, P1 ≥ 95%, plus burn-in.
- **Installs `tea-enforce.cjs` (1,101 lines) as Claude Code Pre/PostToolUse + Stop hooks.** It enforces the mechanically decidable "Absolute" rows of the test-review registry and fails open (`steps-c/step-04-docs-and-scripts.md:83-171`).

**Test review** (`bmad-tea-test-review/`: criteria-registry 236, steps 01-04 with 4 workers)
- Registry: CRITICAL C1-C7 (disabled, focused, tautological, no assertion, mock asserted against itself, ...), HIGH H1-H10 (hard wait, conditional assertion, file > 1000 lines ...), MEDIUM, LOW (`steps-c/criteria-registry.md:137-186`).
- Score = 100 − (10·C + 5·H + 2·M + L) + bonuses, with caps per severity.
- Recommendation: CRITICAL → Block; HIGH or score < 70 → Request Changes; other findings → Approve with Comments; none → Approve (`step-03f:140-260`).

**Teach me testing**: 7 sessions with a menu and 3-question quizzes (pass ≥70%). Progress YAML per user (`steps-c/step-01-init.md`, `templates/progress-template.yaml`).

**Evaluate**: a 12-stage loop (inspection → intake → corpus → contract → oracles → adapters → evaluator → mutation → harness → run → gaps → CI). "never compute a verdict, score, or pass/fail decision outside `eval-quality`'s own CLI" (`bmad-tea-evaluate/SKILL.md:66-128`).

### 3.10c Mechanics worth naming across these workflows
- **Architecture "core test"**: "If two units one level down built this independently, could they choose incompatibly? Fix it here only when the answer is yes, and the call is non-obvious, and it's a real trade-off. Otherwise name it under Deferred" (`bmad-architecture/SKILL.md:13`). Default reviewer: "construct two units one level down that each obey every AD to the letter yet still build incompatibly" (`customize.toml:98-101`).
- **QA e2e**: "Never weaken an assertion"; "Do not add retries"; classify each failure as test wrong / harness wrong / application wrong; run twice (`bmad-qa-generate-e2e-tests/workflow.md:60-66`).
- **Party mode**: "They clash, and you don't resolve it." The **anti-consensus club** persona group (Wildcard, Level, Killjoy, Splinter) "resist fast agreement while keeping a human in control" (`CHANGELOG.md:140`). This relates to your Work Council's "never-ending discussion" problem.

### 3.11 Test design, TEA (`bmad-tea/skills/bmad-tea-test-design/`), the step I read in full

- **Modes**: Create / Resume / Validate / Edit (your notes are correct).
- **Scope**: system-level (PRD + ADRs) or epic-level.
- **Checkpoint file** `test-design-progress-{run_key}.md` with frontmatter `workflowStatus`, `stepsCompleted`, `lastStep`, `nextStep`, `lastSaved`. Resume refuses a checkpoint that belongs to a different run; "**Never merge two runs into one checkpoint.**"
- **Risk register derivation is deterministic** (`step-03-risk-and-testability.md:58-82`): "Ground every risk in an explicit statement from the supplied epic ... Do not add plausible risks merely because they are common in other systems." Gap statements are listed and merged only when they name the same missing control, giving exactly one scored risk per gap.
- **Categories** TECH/SEC/PERF/DATA/BUS/OPS. Probability 1-3 × Impact 1-3. "Flag high risks (score ≥ 6)" with mitigation, owner, timeline.
- **Action thresholds** (`bmod-tea/knowledge/probability-impact.md:565-572`): 1-3 DOCUMENT, 4-5 MONITOR, 6-8 MITIGATE (CONCERNS), 9 BLOCK (FAIL).
- **Coverage**: one risk-linked row per scored risk, "at the single test level where the failure first becomes observable" (Unit / Component / Integration / API / E2E by boundary crossed).
- **Priority** P0-P3 by "business impact, user reach, and workaround availability. Risk score is supporting evidence and is not a required condition."
- **Gates**: P0 = 100%, P1 ≥ 95%, coverage ≥ 80%.
- **NFR thresholds**: "Mark missing thresholds as **UNKNOWN** ... do not guess values."
- **Defect found**: the medium band is "3 to 4" in step 3 but "3-5" in `test-design-architecture-template.md:101`. A 1-3 × 1-3 product can only be 1, 2, 3, 4, 6 or 9.

---

## 4. Cross-cutting machinery

### 4.1 How agents share context

1. **`AGENTS.md` managed block** from `bmad-project-context`, which every agent loads. Other config deliberately ships empty: "`persistent_facts` ships empty" (`CHANGELOG.md:39`). "Repo-wide context belongs in AGENTS.md ... use this for context only this skill needs" (`bmad-prd/customize.toml:27-29`).
2. **Folder-type convention**: every document is `<type>-<slug>/<type>-<slug>.md` under the active initiative, so skills find each other's outputs by glob (`bmod-method/help/help.md:83`; agent step 5).
3. **Spec companions** list the files downstream must read.
4. **`tickets.py find`** returns the entry, epic, story and plan for one ticket.
5. **Plan `context:`** frontmatter lists project-wide docs the implementer must load.
6. **Research docs** carry a `ticket:` and a `commit:` so the build reloads them and re-checks claims against the current code (`bmad-build/step-02-plan.md:13`).

### 4.2 Document sharding

**Removed.** "`bmad-index-docs` and `bmad-shard-doc` ... Retired with no replacement" (`CHANGELOG.md:119`). v7 instead keeps documents short (length scales with stakes; plans 900-1,600 tokens), sends overflow to addenda and companions, and uses "extract, don't ingest" via subagents.

### 4.3 Story files and status tracking

- v6 had `sprint-status.yaml` plus story files; v7 deprecates `bmad-create-story`/`bmad-dev-story` (`CHANGELOG.md:65`).
- v7 status lives in **per-leaf plan frontmatter**, read through `tickets.py`. Board states are derived, not stored (§3.3).
- Document statuses are simple: PRD/brief/UX/architecture `draft` → `final`; research `draft` → `complete`; retro verdicts; TEA `workflowStatus`.
- **There is no shared document-status vocabulary across skill types.** Each skill has its own values.

### 4.4 Memory and audit: the memlog

`bmad/scripts/memlog.py` (290 lines, 365 lines of tests). Read in full at the header.
- **Append-only, chronological**: "There is no edit or delete subcommand by design."
- **Write-only / blind**: every command echoes one JSON line, "so the caller never re-reads the file mid-session"; reads happen only on resume.
- **Atomic**: `O_APPEND` single write, so parallel appenders never drop each other; `init`/`set` use temp+fsync+rename.
- **Typed entries** `(decision)`, `(assumption)`, `(idea by user)` with an optional author `--by`.
- **"No lifecycle status"**: state is a fact recorded as an event. The inventory found this contradicted in practice: `bmad-forge-idea` and `bmad-brainstorming` run `memlog.py set --key status --value complete`.
- Used as the canonical record by prd, brief, spec, architecture, ux, brainstorming, forge, deep-recon and party-mode.
- **Gap vs your needs**: it records *document decisions*, not *agent actions* (no tool calls, verification results, costs, or who/which model).

### 4.5 Config and customization

- **Central config** (`bmod-core-tools/help/customization.md:41-47`): `_bmad/config.toml` (setup-created) ← `_bmad/custom/config.toml` (team, committed) ← `_bmad/custom/config.user.toml` (personal, gitignored). `[core] output_folder`, `[core] active_initiative`, `[modules.<code>]`, `[agents.<code>]`.
- **Per-skill customization**: `<skill>/customize.toml` (shipped, "DO NOT EDIT -- overwritten on every update") ← `_bmad/custom/<skill>.toml` (team) ← `<skill>.user.toml` (personal).
  - Merge rules: scalars override, tables merge, arrays of tables keyed by `code`/`id` replace or append, other arrays append.
  - "An override cannot remove a shipped item"; "A full copy of `customize.toml` blocks later shipped defaults".
- **Hook points on every skill**: `activation_steps_prepend/append`, `persistent_facts` (`file:`, `skill:`, literal), `on_complete`, `external_sources`, `external_handoffs`, `doc_standards`, `finalize_reviewers`, template paths, output paths.
- **Rendered skills** (build, code-review, retro, QA, walkthrough) run `render_skill.py`, which renders Jinja templates with the merged config and publishes an **immutable, content-addressed snapshot** with a manifest of hashes (`CHANGELOG.md:88`). Missing keys halt instead of rendering empty (`CHANGELOG.md:73`).

### 4.6 Installer, multi-IDE, updates

- **v6.12 stable**: `npx bmad-method install` (npm installer; separate branch).
- **v7**: `npx skills add bmad-code-org/BMAD-METHOD` (the vercel-labs Skills CLI, which supports 70+ agent hosts) or the Claude Code / Codex plugin marketplace `bmad-code-org/bmad-plugins` (`README.md:34-55`). Then `bmad setup` runs `setup.py`, which:
  1. Discovers module records across every skills folder the host loads.
  2. Asks module config questions.
  3. Writes `_bmad/config.toml`.
  4. Copies shared scripts into `_bmad/scripts/` and module scripts into `_bmad/<code>/scripts/`.
  5. Creates `_bmad/custom/` with a `*.user.toml` gitignore.
  6. Does all of this through a staging dir that atomically replaces `_bmad` (`setup.py:2226-2314`).
- **Updates**: `bmad status` fetches each module's `bmod.toml` from `raw.githubusercontent.com/.../main/...` and compares SemVer (`setup.py:1838-1912`). `bmad setup` runs `npx skills update`, then offers deletion of skills in `retired.toml`, renames customization files, and offers migrations (`migration-N.toml` with detect / guide / checklist; "a plan is shown and approved by the user before anything changes", `bmad/references/migrate.md:7`).
- **Plugin installs** report `plugin-managed`: "update the plugin through its marketplace, not these files" (`setup.py:1791-1800`).
- **Sync-back: none.** BMAD has no mechanism to push a project's improvements upstream. Customization stays in `_bmad/custom/`, which is the right *split* (shipped vs team vs personal) but one-directional.

### 4.7 Evals and self-improvement

- `bmad-eval`: baseline (vs bare model), variant (vs prior version), quality (rubric with a grader subagent), and trigger accuracy (canary-token detection, description optimization with a held-out split). "a result counts as settled only at 3 or more" runs; "never widen a tolerance to make a run look like it succeeded" (`bmad-eval/SKILL.md:8,46`).
- `bmad-toolsmith` REVIEW/CUT modes run 5 lens subagents (architecture, determinism, leanness, customization, trigger) over a skill; LOGS mode mines Claude Code session logs into skill candidates (`read_session_log.py`).

### 4.8 Unattended runs (bmad-loop)

- **Deterministic orchestrator** with a task phase state machine (`bmad-loop/src/bmad_loop/statemachine.py:25-65`):
  - PENDING → {DEV_RUNNING, TRIAGE_RUNNING, DONE}.
  - DEV_RUNNING → DEV_VERIFY → {DEV_RUNNING, REVIEW_RUNNING, COMMITTING, DEFERRED, ESCALATED}.
  - REVIEW_RUNNING → REVIEW_VERIFY → {REVIEW_RUNNING, DEV_RUNNING, COMMITTING, DEFERRED, ESCALATED}.
  - TRIAGE_RUNNING → TRIAGE_VERIFY → {TRIAGE_RUNNING, COMMITTING, DONE, ESCALATED} (the deferred-work sweep path).
  - COMMITTING → {DONE, ESCALATED, AWAITING_OPERATOR}.
  - Terminal states: DONE, DEFERRED, ESCALATED, AWAITING_OPERATOR. An illegal move raises `IllegalTransition`.
- Sessions end only on hook Stop events, "never on LLM prose" (`bmad-loop/AGENTS.md:26`).
- **Escalation**: "CRITICAL escalations pause the run for a human; PREFERENCE escalations are journaled and the run continues. Exhausted budgets plateau-defer" (`escalation.py:1-6`).
- **Budgets** in `.bmad-loop/policy.toml`: `max_review_cycles` 3, `max_dev_attempts` 2, `max_tokens_per_story` 2M (advisory), `session_timeout_min` 90 (`docs/reference/configuration.md:84-104`).
- **Logs**: `.bmad-loop/runs/<run-id>/journal.jsonl` ("append-only, one JSON object per line with `ts` and `kind`"), `state.json`, per-task `prompt.txt`, `result.json`, `heartbeat.json`, and an `ATTENTION` file (`docs/reference/run-state.md:50-121`).
- **Security**: the claude profile runs `--permission-mode bypassPermissions` (`data/profiles/claude.toml:5`).

---

## 5. Steal list (mechanisms worth reusing, and why)

| # | Mechanism | Source | Why |
|---|---|---|---|
| B1 | Append-only typed decision log per document, written only by a script (`O_APPEND`, blind writes, read only on resume) | `bmad/scripts/memlog.py` | Your "keep history and resume" requirement, solved cheaply and safely. |
| B2 | Derive the contract from the log; one writer per artifact | `bmad-spec/SKILL.md:56-66` | Prevents drift when several workflows feed one spec. |
| B3 | Five-field spec kernel + Spec Law + two-pass self-validate | `bmad-spec/SKILL.md:9,106-127` | A small, testable SDD contract; better than a long PRD for most work. |
| B4 | Status in the plan frontmatter; board state derived; only the user marks `done`; no skill moves past `built` | `tools/ticket-tree-rules.md:21-35` | Exactly your "approved vs draft" rule, with the human as the final writer. |
| B5 | Plan template with a frozen human-owned intent block, Code Map, append-only implementation notes, change log and triage log | `bmad-build/plan-template.md` | This *is* your Developer "spec-file". |
| B6 | Implementation handoff: a fresh subagent whose only input is the plan; the parent may not restate scope | `bmad-build/customize.toml:85-91`, `step-03:31` | Forces the plan to be complete; keeps context clean. |
| B7 | Review triage: discard reviewer severities, verify at cited location, five verdicts, intent_gap / bad_plan / patch / defer, loop cap 5 | `bmad-build/step-04-review.md` | Most precise triage logic in all prior art. |
| B8 | Diff and claims staged as files; reviewers get paths, never pasted text | `bmad-code-review/step-01-gather-context.md:32-34` | Token saving and blindness in one move. |
| B9 | Reviewer gate where each reviewer writes a file and returns only a compact summary | `bmad-prd/SKILL.md:81` | Parent context stays small no matter how many reviewers. |
| B10 | Input reconciliation (one subagent per source input) before polish | `bmad-prd/SKILL.md:92` | Your "Reconciliation agent". |
| B11 | Hook points on every skill (`persistent_facts`, `external_sources`, `external_handoffs`, `doc_standards`, `finalize_reviewers`, prepend/append, `on_complete`) | every `customize.toml` | Your config requirement (Confluence, Jira, Notion, templates) without forking skills. |
| B12 | Three-layer config: shipped / team (committed) / personal (gitignored) | `bmod-core-tools/help/customization.md` | The base of the framework-vs-project split. |
| B13 | Ticket store adapters (repo / Jira / GitHub / Linear / Notion / Trello) with a type map, a status map, and a setup-proof ticket | `bmad-ticket/config/*.toml`, `references/store-setup.md` | Your "local .md or Jira" requirement. |
| B14 | Project context as one small verified block; ledger; "never ask what a scan could answer"; prefer a hook or lint to prose | `bmad-project-context/SKILL.md` | Better than generating large docs; fixes your "scan bloats context" problem. |
| B15 | Research firewall, freshness bars, claim ledger, anchors re-check | `bmad-deep-recon/` | Market research that doesn't hallucinate. |
| B16 | Deterministic risk register (one risk per gap statement, P×I, thresholds, UNKNOWN for missing NFR numbers) | `bmad-tea-test-design/steps-c/step-03*.md` | Your risk-based test design note, with anti-hallucination rules. |
| B17 | TEA progress checkpoint with run identity; refuse a foreign checkpoint | `bmad-tea-test-design/steps-c/step-01b-resume.md` | Safe resume for long workflows. |
| B18 | Retrospective that drops unsourced findings and gives two dispositions per finding | `bmad-retrospective/workflow.md` | Base for your Process Retrospective. |
| B19 | `retired.toml` + `migration-N.toml` (detect / plan / approve / checklist) | `bmod-method/retired.toml`, `migration-1.toml` | How framework updates reach installed projects safely. |
| B20 | Deterministic orchestrator with a phase state machine, escalation classes, budgets, and an append-only journal | `bmad-loop/` | Reference design if MIRAI ever runs unattended. |
| B21 | Architecture core test plus an adversarial "two units obey every rule and still diverge" reviewer | `bmad-architecture/SKILL.md:13`, `customize.toml:98-101` | Keeps HLDs short and useful. |
| B22 | Headless JSON contract (`complete | partial | blocked`, `assumptions[]`, `open_questions[]`) | `bmad-prd/references/headless.md` | Lets one workflow call another without a human. |

---

## 6. Weak spots (and how MIRAI improves)

| # | Weak spot | Evidence | Improvement |
|---|---|---|---|
| X1 | **Moving target.** v7 is preview alpha with breaking changes between updates; your pilot is already on a superseded layout (`_bmad-output/planning-artifacts`). | `README.md:30-32`; `CHANGELOG.md:9-16`; pilot `_bmad/config.toml` | Vendor *logic*, not files. Pin what we reuse. No runtime dependency on BMAD. |
| X2 | **Heavy runtime:** `uv` + Python required, Jinja rendering, many scripts; failure modes when uv is missing. | `CHANGELOG.md:72, 114` | Keep scripts few and stdlib-only; prefer Claude Code hooks and plain markdown. |
| X3 | **Long prompt files.** `correct-course/SKILL.md` 304 lines; the TEA test-design checklist 486 lines, the trace step 05 965 lines. BMAD's own AGENTS.md says "Length and ambiguity are paid on every run" (`bmad-method/AGENTS.md:29`). | inventory line counts | Hard budget per skill (Addy: under 500 lines; Toolsmith: about 800 tokens for a plain skill, `ship.md:30`). |
| X4 | **Personas add little.** Five agents share one SKILL.md; the dev agent's guardrails don't apply on the `bmad-build` path (`CHANGELOG.md:110`); the "cynical reviewer" persona "made no difference" (`CHANGELOG.md:102`). | as cited | Agents become thin menus or are dropped; behavior lives in workflows. |
| X5 | **No shared document-status model** (PRD draft/final, plan 8 states, research complete, TEA workflowStatus, memlog "no status" yet `set status`). | §4.3, §4.4 | One status vocabulary and one transition table for every MIRAI document. |
| X6 | **Agent work is not logged** (memlog covers document decisions only; build keeps logs inside the plan; only bmad-loop has a run journal). | §4.4, §4.8 | A run log per agent session, à la pstack `show-me-your-work` + bmad-loop journal. |
| X7 | **No sync-back.** Improvements made in `_bmad/custom/` never reach upstream. | §4.6 | MIRAI designs this explicitly. |
| X8 | **No enforcement.** HALT points and "never" rules are prose; nothing stops an agent from skipping a gate. Your pilot's hooks do (see `04`). | `bmad-build/workflow.md:74-80` vs pilot `stop-quality-gate.sh` | Enforce key gates with Claude Code hooks. |
| X9 | **Internal inconsistencies**: TEA band 3-4 vs 3-5; config "four-layer" vs three files; `bmad-customize` names retired `bmad-workflow-builder`; bmad-loop's TEA plugin reads v2 artifact names. | inventories | Lint our own references; one source of truth per rule. |
| X10 | **Token cost of thorough review**: 4 parallel same-model reviewers per change, at "the same model capability as the current session" (`step-02-review.md:9`). | | Risk-scaled review: quick by default, thorough on risk ≥ medium (the pilot's risk model). |
| X11 | **Unattended runner bypasses permissions** (`claude.toml:5`). | bmad-loop | Out of MVP scope; if ever built, run in an isolated worktree with hooks, never bypass mode. |

---

## 7. What BMAD does NOT have that your notes want

- A logging system for all agent work (X6).
- Document statuses `In Review` and `In QA` as first-class states across all documents (X5).
- Sync-back (X7).
- UI verification with a maintained feature map (BMAD's QA e2e writes tests; it does not keep a feature map). pstack covers this.
- AI-trust metrics.
- A Data Engineer / read-only DB analyst.
- A Debug council (BMAD has none; pstack's bug-fix playbook and `why`, plus superpowers `systematic-debugging`, are the prior art).
- Scrum-master reporting and sprint prediction (v7 removed sprint planning in favor of `tickets.py status`).

## 8. Where your notes are now behind BMAD

| Your note | BMAD today |
|---|---|
| PRD "extras": ask for related docs | Brain dump step asks for every input (`bmad-prd/SKILL.md:46`). |
| PRD "extras": config for where to read and write docs, and templates | `prd_output_path`, `prd_template`, `external_sources`, `external_handoffs` (`customize.toml:43-127`). |
| PRD reviewers (rubric, specialist, adversarial, source-extraction, reconciliation) | Rubric walker, `finalize_reviewers`, ad-hoc reviewers, "Extract, don't ingest", input reconciliation (`SKILL.md:69-92`). |
| Project scan with 3 levels; deprecated for bloating context | Replaced by `bmad-project-context` (small verified block) + `bmad-deep-recon` codebase intent (question-driven, cited) (`CHANGELOG.md:68, 24`). |
| Create tickets with templates; approved vs draft | `bmad-ticket` with templates, stores, statuses, validation. |
| Developer writes a spec-file first and keeps it updated | `bmad-build` plan with frozen intent and append-only notes. |
| Code review "four reviewers" | Now quick/thorough sets, Intent Alignment instead of Acceptance Auditor, no-code handoff mode. |
| `/bmad-testarch-test-design` | Renamed `bmad-tea-test-design`, separate module, same C/R/V/E modes. |
| Evals for skills | `bmad-eval` with baseline/variant/quality/trigger modes. |

---

## Appendix A. Templates, checklists and config files

### A.1 BMAD method + core (`bmad-method/skills/`)

| Kind | Files |
|---|---|
| Document templates | `bmad-prd/assets/prd-template.md`, `bmad-product-brief/assets/brief-template.md`, `bmad-prfaq/assets/prfaq-template.md`, `bmad-spec/assets/spec-template.md`, `bmad-architecture/assets/spine-template.md`, `bmad-deep-recon/assets/research.template.md`, `bmad-deep-recon/assets/codebase.template.md`, `bmad-project-context/references/template.md`, `bmad-walkthrough/templates/log-template.md`, `bmad-build/plan-template.md`, `bmad-build-auto/plan-template.md` |
| Ticket templates | `bmad-ticket/assets/{initiative,epic,story,spike,bug}-template.md`, `bmad-ticket/assets/tickets-template.toml` |
| UX examples and assets | `bmad-ux/assets/{color-themes,design-directions,excalidraw-wireframe,key-screens}.md`, `design-example-{editorial,mobile,shadcn}.md`, `experience-example-{mobile,shadcn}.md` |
| Report templates | `bmad-prd/assets/validation-report-template.html`, `bmad-ux/assets/validation-report-template.html` |
| Rubrics / checklists | `bmad-prd/assets/prd-validation-checklist.md` (7 dimensions), `bmad-correct-course/checklist.md` (6 sections, 279 lines), `bmad-ticket/references/validate-checks.md` (Ticket/Set/Tree/Dependencies/Closure), `bmad-architecture/references/reviewer-gate.md` (good-spine checklist), `bmad-ux/references/validate.md` (two-pass rubric), `bmad-build/workflow.md:12-31` (READY + SCOPE standards) |
| Catalogs | `bmad-advanced-elicitation/assets/methods.csv` (71), `bmad-brainstorming/assets/brain-methods.csv` (108), `bmad-deep-recon/types/*.md` (6 packs) |
| Review prompts | `bmad-{build,build-auto,code-review}/review-prompts/{edge-case-hunter,verification-gap}.md`, `references/{claims-check,deletion-check}.md`, `bmad-review/references/lens-*.md`, `editorial-common.md`, `structure-models.md` |
| Per-skill config | `customize.toml` in every customizable skill (agents ×5, advanced-elicitation, architecture, brainstorming, build, build-auto, code-review, correct-course, deep-recon, eval, forge-idea, party-mode, prd, prfaq, product-brief, project-context, qa-generate-e2e-tests, retrospective, review, spec, ticket, toolsmith, ux, walkthrough); `bmod.toml` in every skill |
| Store configs | `bmad-ticket/config/{repo,jira,github,linear,notion,trello}-ticketing.toml` |
| Central config | `bmad/assets/config.template.toml` (seeds `_bmad/config.toml`: `project_name`, `output_folder`) |
| Module records | `bmod-{core-tools,method,toolsmith}/{bmod,retired,roster}.toml`, `bmod-method/migration-1.toml` |
| Toolsmith shapes | `bmad-toolsmith/shapes/{agent,memory-agent,multi-skill-module,plain-skill,rendered-skill,script-utility,single-skill-module}/` with templates: `SKILL-template.md`, `customize-template.toml`, `capability-template.md`; memory agent "sanctum" files `BOND`, `CREED`, `PERSONA`, `PULSE`, `CAPABILITIES`, `HOW-I-REMEMBER`, `first-breath(-config)`, `init-sanctum-template.py`, `wake-template.py`; module `record-bmod-template.toml`, `member-bmod-template.toml`, `retired-template.toml`, `roster-template.toml`, `help-template.md`; `script-template.py`, `test-template.py` |

### A.2 BMAD repo-level (`bmad-method/`)

`tools/skill-validator.md`, `tools/validate_skills.py`, `tools/validate_file_refs.py`, `tools/ticket-tree-rules.md`, `tools/quality.py` (all CI checks), `tools/dogfood.py` (installs BMad into a fresh worktree via `npx --yes skills add ... -y`), `tools/release.md`, `action.yml` (composite action that validates `bmod.toml` files), `docs-site/` (Astro docs site), `docs/` (start, plan, build, existing-codebases, customize, reference, toolsmith), `AGENTS.md` (35 lines, itself a `bmad:context` block).

### A.3 TEA (`bmad-tea/skills/`)

| Kind | Files |
|---|---|
| Workflow definitions | `workflow.yaml` + `instructions.md` + `customize.toml` in each of test-design, trace, automate (+ `red/`), nfr, framework (+ `ci/`), test-review |
| Templates | `bmad-tea-test-design/test-design-{,architecture-,qa-,handoff-}template.md`; `bmad-tea-trace/trace-template.md`; `bmad-tea-nfr/nfr-report-template.md`; `bmad-tea-test-review/test-review-template.md`; `bmad-tea-automate/red/atdd-checklist-template.md`; `bmad-tea-framework/ci/{github-actions,gitlab-ci,azure-pipelines,harness-pipeline}-template.yaml`, `jenkins-pipeline-template.groovy`; `bmad-tea-teach-me-testing/templates/{progress-template.yaml,session-notes-template.md,completion-summary-template.md}`; `bmad-tea-evaluate/assets/*.template.json` |
| Checklists | `checklist.md` in test-design (486), trace (693), automate (640) + red (446), nfr (410), framework (372) + ci (301), test-review (493), teach-me-testing (198) |
| Knowledge base | `bmod-tea/knowledge/` (59 fragments), indexed by `tea-index.csv`; `adr-quality-readiness-checklist.md` (8 categories, 29 criteria) |
| Repo-level | `DESIGN-CRITERIA-REGISTRY.md`, `eval-quality.config.json`, `cli/*.js` (tea-* CLIs), `tools/` validators |

### A.4 bmad-loop

`module.yaml` (`code: bmad-loop`), `.claude-plugin/marketplace.json`, `src/bmad_loop/data/{profiles/*.toml, settings/core.toml, plugins/*/plugin.toml, skills/*}`, `bmad_loop_hook.py`, `bmad_loop_probe_hook.py`, and `docs/reference/{configuration,run-state,cli}.md`, `docs/FEATURES.md`, `docs/escalations-guide.md`.
