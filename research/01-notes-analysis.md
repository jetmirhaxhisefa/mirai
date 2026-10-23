# 01 — Analysis of your notes, section by section

Inputs:
- `notes/main-notes/2_Efforts/AI Agent Setup Guide for Development Projects.md` (729 lines), cited as **Guide:line**.
- `notes/main-notes/3_Atlas/Lauren Tan Workshop - Trusting AI Coding Agents - Detailed Notes.md` (143 lines), cited as **Lauren:line**.

**Path convention.** All prior-art paths are relative to `~/Projects/mirai-sources/`:
- `bmad-method/skills/<skill>/...` for BMAD;
- `bmad-tea/skills/...` for TEA;
- `cursor-plugins/pstack/...` for pstack;
- `addyosmani-agent-skills/...` for Addy;
- `obra-superpowers/...`, `blader-humanizer/...` and `vercel-labs-skills/...` for the vetted skills.

"Pilot" means `people-management-tool/platform`.

For every section:
- **(a)** what you want, in my words;
- **(b)** your intent and the problem behind it;
- **(c)** gaps, contradictions, overlaps;
- **(d)** prior art with paths;
- **(e)** open questions for you.

---

## Part 1. Agents

### 1.1 Business Analyst (Guide:11-33)

**(a)** A discovery partner that explores requirements (new app or new business needs), brainstorms, finds gaps, does market research, and works "evidence-based, requirements precise, every stakeholder represented". It has a 10-item menu.

**(b)** You don't want to commit to a build before the idea is tested against the market, the domain and the evidence. The problem underneath is building the wrong thing.

**(c)**
- Your menu uses **the same codes as BMAD's current analyst, with abridged descriptions** (`bmad-method/skills/bmad-agent-analyst/customize.toml:55-103`). Your one-line purpose restates its three principles (`:45-49`). It's a fine starting point, but not yet a design of its own.
- Item by item:

| Code | Your text (Guide:23-32) | BMAD today | Overlap in your notes | MIRAI view |
|---|---|---|---|---|
| BP | Brainstorming | skill `bmad-brainstorming` (`customize.toml:56-58`) | 2.6, 4.9 | One ideation skill (2.6) |
| MR | Market, customers, trends | `bmad-deep-recon`, type market (`:60-63`) | 4.8 | Research skill, type `market` |
| DR | Industry domain and terminology | deep-recon, type domain (`:65-68`) | — | type `domain` (builds a glossary) |
| TR | Technical landscape | deep-recon, type technical (`:70-73`) | 1.3 Architect | type `technical` (feeds design) |
| TS | Choose tech, vendor, tool | deep-recon, "select" decision shape (`:75-78`) | 1.3 | `select` shape: weighted matrix |
| CR | Competitive teardown | deep-recon, type competitive (`:80-83`) | 4.8 | type `competitive` |
| UV | User voice, JTBD | deep-recon, type user-voice (`:85-88`) | — | type `user-voice` (PII redaction) |
| CB | Product brief | skill `bmad-product-brief` (`:90-93`) | 4.1 | Optional before PRD/spec |
| WB | Working Backwards PRFAQ | skill `bmad-prfaq` (`:95-98`) | — | Later; for new product concepts |
| PC | Refresh agent instructions | skill `bmad-project-context` (`:100-103`) | 2.3 | **Not analysis.** Belongs in setup |

- Six of the ten items are one research skill with a pre-set type. An "agent" with this menu is a router.

**(d)**
- `bmad-method/skills/bmad-agent-analyst/`, `bmad-method/skills/bmad-deep-recon/` (firewall, freshness bars, verification levels; `types/*.md`), `bmad-method/skills/bmad-product-brief/`, `bmad-method/skills/bmad-prfaq/`, `bmad-method/skills/bmad-brainstorming/`, `bmad-method/skills/bmad-forge-idea/`.
- `addyosmani-agent-skills/skills/idea-refine/SKILL.md`.
- pstack has nothing in this area.

**(e)**
- Q1.1a Is this agent for client/product work only, or also for your own business ideas?
- Q1.1b Do you want deep-recon's "draft a prompt for my ChatGPT/Gemini/Perplexity deep research" mode? It's cheaper than running research in Claude Code.

### 1.2 PM Agent (Guide:35-39)

**(a)** Takes generic business requirements, researches them, finds the gaps, and writes a requirements document an architect or developer can use.

**(b)** Requirements usually arrive vague, from a real PM or a stakeholder. The cost of that is rework downstream.

**(c)**
- The research part overlaps 1.1.
- The document is the PRD workflow (4.1), so this agent is a thin entry point. BMAD's PM menu is exactly PRD / correct-course / ticket (`bmad-method/skills/bmad-agent-pm/customize.toml`).
- Missing: what the PM does when requirements change mid-build. In BMAD that's `bmad-method/skills/bmad-correct-course/SKILL.md`.

**(d)** `bmad-method/skills/{bmad-agent-pm,bmad-prd,bmad-correct-course,bmad-spec}/`; `addyosmani-agent-skills/skills/spec-driven-development/SKILL.md` (Phase 0 capability map, `:34-65`).

**(e)** Q1.2 In your projects, does "requirements" mean a full PRD or a short spec per feature? The pilot's PRD run stopped with an empty file (`_bmad-output/planning-artifacts/prds/prd-platform-2026-10-03/prd.md`, 0 bytes).

### 1.3 Architect Agent (Guide:41-55)

**(a)** Chooses technologies and system design, and writes HLDs from a template, grounded in a project context file. "HLD documents should always be reviewed by a human" (Guide:55).

**(b)** Agents make inconsistent technical choices unless the design is written down and approved first.

**(c)**
- BMAD v7 writes a short **architecture spine** of `AD-n` decisions, not an HLD (`bmad-method/skills/bmad-architecture/assets/spine-template.md`). Your pilot has a 16-section HLD template (`.claude/templates/hld-template.md`) and a real 549-line HLD (`docs_old/decisions/hld-0001-backend-code-structure.md`). These are two philosophies:
  - a long design document;
  - minimal decisions that stop divergence.

  **You need to pick one, or both for different readers.**
- "Always human-reviewed" has no mechanism in your notes. It needs a status rule: an HLD can't reach `Approved` except by a human, and builds refuse unapproved HLDs. BMAD's equivalent rule: only the user marks a ticket `done` (`bmad-method/tools/ticket-tree-rules.md:35`).
- "Could be 2 context files ... business explanation file" (Guide:51) overlaps 3.3.
- ADRs appear in your Configs (5.3) but not here. The pilot uses ADR + RFC + HLD.

**(d)**
- `bmad-method/skills/bmad-architecture/SKILL.md:13` (the core test: "could two units built independently choose incompatibly?"), `customize.toml:98-101` (adversarial reviewer).
- `cursor-plugins/pstack/skills/architect/` (types first, at least two candidates, `references/design-red-flags.md`).
- `addyosmani-agent-skills/skills/documentation-and-adrs/SKILL.md:46-100` (ADR template and lifecycle).
- Pilot templates.

**(e)**
- Q1.3a HLD style: your 16-section HLD, BMAD's spine, or both (spine for agents, HLD for humans)?
- Q1.3b Who may approve an HLD: only you, or also a teammate?

### 1.4 UX Expert Agent (Guide:57-72)

**(a)** Creates and improves the UX design (ideas, screenshots), and verifies the UI after build. It's both a persona to talk to and a workflow that writes the documents.

**(b)** You want design intent captured before build and checked after.

**(c)**
- Your notes paraphrase BMAD's Sally text (Guide:66-72).
- "Verify when developed" has no mechanism in BMAD UX. It belongs to verification and the feature map (2.7, 3.4).
- The pilot UI is a purchased template (Lovable "Draotix HR"). UX work there is mostly mapping real flows onto existing screens.

**(d)** `bmad-method/skills/bmad-ux/` (DESIGN.md + EXPERIENCE.md, creative tools, Stitch handoff); `addyosmani-agent-skills/skills/frontend-ui-engineering/SKILL.md:129-142` ("Avoid the AI Aesthetic"); `cursor-plugins/pstack/skills/poteto-mode/playbooks/prototype.md`.

**(e)** Q1.4 Is UX in MVP scope, given the pilot's UI comes from a template?

### 1.5 Developer Agent (Guide:75-92)

**(a)**
- Implements tickets with tests.
- Calls QA and Code Review and fixes their findings.
- Reads HLDs and knows approved from draft for HLDs and tickets.
- Before coding, writes a **spec-file** plan for human approval, keeps it updated to the final solution, and the result feeds review and QA.
- TODOs:
  - a developer context file with clean-code rules and patterns like DDD (Guide:86);
  - "Should always have another 2 agents, the Code Review Agent and the QA agent" (Guide:87);
  - follow the HLDs (Guide:88).

**(b)** You want to stop "the agent codes first, explains later". The plan is the contract, and the final plan is the record.

**(c)**
- This is the strongest idea in your notes, and it matches BMAD `bmad-build`'s plan file:
  - frozen human-owned intent;
  - Code Map;
  - append-only Implementation Notes and Plan Change Log;
  - `status`, `baseline_revision` (`bmad-method/skills/bmad-build/plan-template.md`).
- **"The developer triggers QA and review"** conflicts with three sources:
  - your pilot council, where reviewers are independent and spawned by the lead (`AGENTS.md` Engineering council, steps 4-11);
  - Addy's "Personas do not invoke other personas" (`addyosmani-agent-skills/AGENTS.md:72-80`);
  - BMAD's rule that reviewers get the diff, not the developer's reasoning (`bmad-method/skills/bmad-code-review/step-01-gather-context.md:32-34`).

  A developer that calls its own reviewers is back to self-review.
- "QA and review its own code before completed" (Guide:83) is good as a self-check. It isn't independent review.
- The DDD/clean-code file is CODING_CONVENTIONS (3.1).

**(d)**
- `bmad-method/skills/bmad-build/` and `bmad-build-auto/`.
- `cursor-plugins/pstack/skills/poteto-mode/playbooks/{feature,bug-fix}.md`.
- `addyosmani-agent-skills/skills/{incremental-implementation,planning-and-task-breakdown}/SKILL.md`.
- `obra-superpowers/skills/{writing-plans,subagent-driven-development}/SKILL.md`.
- Pilot `.claude/skills/development-council/SKILL.md`.

**(e)** Q1.5 Who spawns the reviewers: the developer (your note) or a lead (your pilot)? I recommend the lead.

### 1.6 Code Review Agent (Guide:94-98)

**(a)** Reviews agent or human code against the ticket's requirements and the project's best-practices file.

**(b)** Review should check "did we build what the ticket asked", not only code quality.

**(c)** It duplicates the Code Review workflow (4.5). "Against the ticket" is BMAD's intent-alignment lens plus the Quick lens reading the plan's acceptance criteria (`bmad-method/skills/bmad-code-review/customize.toml:72-152`).

**(d)** `bmad-method/skills/bmad-code-review/`; `cursor-plugins/pstack/skills/interrogate/`; `addyosmani-agent-skills/skills/code-review-and-quality/SKILL.md` (5 axes; "review the tests first", `:152-164`); pilot `.claude/agents/code-reviewer.md` + `VERDICT: PASS` gate.

**(e)** No separate questions. This merges into 4.5, so see Q4.5.

### 1.7 QA Agent (Guide:100-105)

**(a)** QA's any change, agent-made or manual. It opens the UI and tries edge cases, using a business-goal file and a frontend-testing practices file.

**(b)** "Compiles" isn't "works". This is Lauren's central point (Lauren:39-45).

**(c)**
- Four names for one capability: QA Agent, Verification skill (2.7), QA workflow (4.6), TDD step 4 (4.4).
- The business-goal file is the business context (3.3). The frontend practices file is the frontend part of CODING_CONVENTIONS (3.1).
- **Missing: how the agent finds a feature in the UI.** That's the feature map (3.4).

**(d)** `cursor-plugins/pstack/skills/create-verification-skill/`, `maintain-verification-skill/`; `bmad-method/skills/bmad-qa-generate-e2e-tests/`; `bmad-tea/skills/bmad-tea-trace/`; `addyosmani-agent-skills/skills/browser-testing-with-devtools/`; pilot `council-qa`, `test-engineer`. Claude Code's Playwright MCP is available in this environment.

**(e)** Q1.7 Is QA done by driving the running app (live verification), by writing Playwright tests, or both? The pilot's Playwright is outside the gate, and its local URLs are currently inconsistent (`04` §3).

### 1.8 Data Engineer & Business Analyst (Guide:108-110)

**(a)** Investigates data read-only (queries, dashboards, analysis), never INSERT/DELETE/UPDATE/DROP.

**(b)** Answers from data without the risk of mutating it.

**(c)**
- There's no prior art. The real control is the **DB user's permissions**, not a prompt ("A rule in a Markdown file ... can be forgotten", Lauren:108).
- The pilot has almost no domain tables yet, so it's a poor first target.

**(d)** `cursor-plugins/pstack/skills/why/SKILL.md:39-66` and `references/sources/databricks.md` (analytics warehouse as an evidence source); pilot `.claude/settings.json` deny rules.

**(e)** Q1.8 MVP or later? I'd say later, with a mandatory read-only DB role.

---

## Part 2. Skills

### 2.1 Scrum Master (Guide:114-126)

**(a)**
1. Project reports.
2. Validate planning and produce sprint status.
3. Sprint reports.
4. Predict the next sprint from history.
5. Create tickets.
6. Retro boards in Miro.
7. Detect oversized tickets and split them.

Item 8 is an empty placeholder. It also needs approved/draft rules and a ticket location (local or Jira).

**(b)** Reporting and planning overhead costs you time. You want insight from history.

**(c)**
- Item 5 duplicates 2.2.
- Item 7 overlaps BMAD slicing ("Split, never shrink", `bmad-method/skills/bmad-ticket/references/slice.md`).
- **Item 4 conflicts with BMAD: "Never state time estimates"** (`bmad-method/skills/bmad-retrospective/workflow.md:11`), and estimates are "never proposed" (`bmad-method/skills/bmad-ticket/assets/tickets-template.toml`).
- Item 6 needs a Miro MCP.
- BMAD v7 dropped sprint planning for `tickets.py status` (counts by state, longest chain).

**(d)** `bmad-method/skills/bmad-ticket/scripts/tickets.py` (`next`/`status`), `bmad-method/skills/bmad-retrospective/`. There's no prior art for prediction. It's over-scoped for MVP.

**(e)** Q2.1 Is sprint reporting for you, or for a team or manager? Do you run sprints on the pilot?

### 2.2 Create Tickets (Guide:129-136)

**(a)**
- Epics, stories, tasks and bugs, each with its own template (adjustable).
- Created from a PRD, an HLD, a debug report or a security finding.
- Callable by any agent.
- Approved/draft states.
- Local `.md` files or Jira.

**(b)** Turning plans into good tickets is tedious, and agents need tickets they can build from.

**(c)**
- This is fully covered by BMAD `bmad-ticket`:
  - templates for initiative, epic, story, spike and bug;
  - stores for Jira, GitHub, Linear, Notion, Trello and repo;
  - statuses;
  - validation subagents.
- Your "task" maps to a story or spike. **Reuse heavily.**

**(d)** `bmad-method/skills/bmad-ticket/` (`SKILL.md`, `config/jira-ticketing.toml`, `assets/*-template.md`), `bmad-method/tools/ticket-tree-rules.md`; `addyosmani-agent-skills/skills/planning-and-task-breakdown/SKILL.md:125-164` (sizing; "Never overwrite an incomplete plan").

**(e)** Q2.2 The pilot uses `BKT-` keys. Which tracker is that? Should MIRAI write local tickets first and publish on approval?

### 2.3 Project Context (Guide:139-149)

**(a)** Builds the context files (PROJECT-CONTEXT, CODING_CONVENTIONS, ...) from the code and configured external sources. They're mandatory before implementation and human-validated.

**(b)** Agents lack product and team context (Lauren:61), so give it to them once, in writing.

**(c)**
- **Main tension with 2.4**: you also say big generated context "made the agent worst". BMAD's answer: one small verified block, and "anything derivable from source is read live and never stored" (`bmad-method/CHANGELOG.md:79`; `bmad-method/skills/bmad-project-context/references/best-practices.md`).
- So these files must be **short**.
- The pilot already did this: `AGENTS.md`, `backend/AGENTS.md` and `frontend/AGENTS.md` were created by `bmad-project-context`.

**(d)** `bmad-method/skills/bmad-project-context/SKILL.md` (ledger; "Never ask what a scan could answer"; prefer a hook or lint to prose); `cursor-plugins/pstack/skills/correct/SKILL.md` (rule → enforcer table); `addyosmani-agent-skills/skills/context-engineering/SKILL.md:20-36` (context hierarchy).

**(e)** Q2.3 Separate files with your four names, or sections of `AGENTS.md`/`CLAUDE.md` that the harness loads automatically?

### 2.4 Project Scan & Documentation (Guide:151-165)

**(a)** Three levels:
1. General: structure, tech.
2. Deep: processes.
3. Exhaustive: all docs, **the ticket system's epics and tasks** (Guide:156), cloud, full documentation.

The note says it's deprecated in BMAD for bloating context, so use it for humans, not agents.

**(b)** Understanding an existing codebase, for you or a newcomer.

**(c)**
- Your reading of BMAD is correct (`bmad-method/CHANGELOG.md:68`).
- Better prior art is **question-driven**, not level-driven: BMAD deep-recon codebase intent (questions → cited answers at a commit, `bmad-method/skills/bmad-deep-recon/references/codebase.md`); pstack `how`/`why`/`teach`.
- Scanning Jira epics is pstack `why`'s "issue tracker" category (`cursor-plugins/pstack/skills/why/SKILL.md:39-66`).
- "Search in Claude (Like GCP)" (Guide:161) is unclear.

**(d)** `bmad-method/skills/bmad-deep-recon/`; `cursor-plugins/pstack/skills/{how,why,teach,recall}/`.

**(e)**
- Q2.4a Keep a human-docs generator, or replace it with on-demand `how`/`why` questions?
- Q2.4b What did "search in Claude (Like GCP)" mean?

### 2.5 Setup Verification (Guide:168-172)

**(a)** Prove that the setup works, that agents do their job, and that the code is good. "Research need to be done."

**(b)** You can't trust what you can't measure (Lauren:31-37, 67-81).

**(c)** It's three questions:
1. Does the install work? A fresh-agent check (`cursor-plugins/pstack/automations/benny/skills/setup-benny/SKILL.md:48-61`); BMAD `bmad status`.
2. Do agents do their job? Evals (4.7).
3. Is the code good? Gates and reviews. The pilot already enforces this with hooks.

**(d)** pstack `setup-benny`, `skills/poteto-mode/playbooks/eval.md`; `bmad-method/skills/bmad/references/setup.md`, `bmad-method/skills/bmad-eval/`; `addyosmani-agent-skills/evals/README.md` (3 tiers), `evals/plugin/` (`claude plugin eval`); pilot `.claude/hooks/stop-quality-gate.sh`.

**(e)** Q2.5 For MVP, is "setup verification" an install doctor plus one smoke run, or do you also want skill evals?

### 2.6 Brainstorm + "Mary vs Brainstorming" (Guide:174-216)

**(a)** BMAD-style brainstorming with many techniques, maybe a bigger multi-agent version. Your analysis says Mary manages the discovery journey and brainstorming is one session.

**(b)** Ideas get better with structure and varied techniques.

**(c)**
- Your Mary-vs-brainstorming analysis is correct and matches BMAD: `bmad-brainstorming` is one session with 108 techniques; Mary routes to it (`bmad-agent-analyst/customize.toml:55-58`).
- The bigger version is 4.9.
- It doesn't need a separate MIRAI design. Reuse BMAD's stances, memlog and converge moves, or Addy's lighter `idea-refine`.

**(d)** `bmad-method/skills/bmad-brainstorming/SKILL.md`, `bmad-method/skills/bmad-forge-idea/`, `bmad-method/skills/bmad-party-mode/`; `addyosmani-agent-skills/skills/idea-refine/SKILL.md`; `obra-superpowers/skills/brainstorming/SKILL.md`.

**(e)** Q2.6 Is brainstorming in MVP, given the pilot is past the idea stage?

### 2.7 Verification Skill (QA) (Guide:219-221)

**(a)** Verifies an implementation: reads the code, tests it, checks CPU and memory, tests "everything".

**(b)** Prove behavior on the real system (Lauren:39-45).

**(c)**
- "Everything" per change isn't feasible. pstack scopes it through the feature map.
- CPU and memory checks are the perf playbook plus `benchmark-checklist`.

**(d)** `cursor-plugins/pstack/skills/{create-verification-skill,maintain-verification-skill,principle-prove-it-works,benchmark-checklist}/`; `obra-superpowers/skills/verification-before-completion/SKILL.md:16-36`.

**(e)** Same question as 1.7 (Q1.7). Also Q2.7: is performance verification (CPU/memory) MVP, or later?

---

## Part 3. Context files

### 3.1 CODING_CONVENTIONS.md (Guide:226-231)

**(a)** Agreed conventions per service, or one shared file.

**(b)** Agents should write and review against the team's rules.

**(c)**
- The pilot already has `backend/AGENTS.md`, `frontend/AGENTS.md` and a layering test (`backend/tests/Unit/Architecture/LayoutTest.php`).
- Lauren and pstack say to turn rules into checks where possible (Lauren:108). So the file should hold judgment rules, plus a table of what enforces each rule.

**(d)** `cursor-plugins/pstack/skills/correct/SKILL.md:28-30`; `addyosmani-agent-skills/skills/constraint-driven-development/SKILL.md:93-140`; `bmad-method/skills/bmad-project-context/references/template.md` ("Conventions that differ from defaults").

**(e)** Q3.1 Separate files, or nested `AGENTS.md` per service (already loaded automatically)?

### 3.2 HLD_template.md (Guide:233-235)

**(a)** One template every HLD follows.

**(b)** Consistent, complete designs that a human can review quickly.

**(c)** It exists in the pilot (`.claude/templates/hld-template.md`, 16 sections, `Status: Draft`). It overlaps BMAD's spine; see Q1.3a.

**(d)** Pilot template; `bmad-method/skills/bmad-architecture/assets/spine-template.md`; `cursor-plugins/pstack/skills/architect/references/rationale-template.md`.

**(e)** Q3.2 Keep the pilot's template as MIRAI's default HLD template, with status frontmatter added?

### 3.3 PROJECT-CONTEXT.md (Guide:237-240)

**(a)** A main doc that explains the whole setup: services, paths, how they connect.

**(b)** A newcomer, human or agent, should understand the system shape fast.

**(c)**
- It overlaps `AGENTS.md`. BMAD excludes overviews and trees, because agents read the tree live (`bmad-method/skills/bmad-project-context/references/best-practices.md:24-35`).
- A **business** context file (domain, users, goals) has no BMAD equivalent. You ask for it at Guide:51 and Guide:104.

**(d)** `bmad-method/skills/bmad-project-context/references/{template,best-practices}.md`; pilot `AGENTS.md`; the business source `people-management-tool-mockup/ALL_FEATURES.md`.

**(e)** Q3.3 Split it into a technical part (short, harness-loaded) and a business part for PM and QA agents?

### 3.4 FEATURE_MAP.md (Guide:242-249)

**(a)** A map of all app features so agents can find them. A skill builds it for an existing app, and QA updates it as features ship.

**(b)** Lauren's Control Glass lesson: the agent could drive the app but didn't know where the features were (Lauren:51-57).

**(c)**
- This is pstack's feature map: one file per feature with exactly four sections (Sub-features / How to get to it / Driving it / Gotchas) (`cursor-plugins/pstack/skills/create-verification-skill/SKILL.md:36`; `references/feature-map-example/README.md:33-42`).
- "QA updates it" drifts. pstack has a dedicated maintenance pass (`maintain-verification-skill/SKILL.md`).
- The pilot's feature list already exists in `people-management-tool-mockup/ALL_FEATURES.md`.

**(d)** As above, plus `cursor-plugins/pstack/automations/benny/skills/reproduce-and-fix-issues/references/feature-map.example.md`.

**(e)** Q3.4 One file, or a folder with one file per feature?

---

## Part 4. Workflows

### 4.1 PRD workflow (Guide:254-317)

**(a)**
- "What a PRD is": who, problem, capabilities, out of scope, success. Behavior, not tech.
- "What it does": produce a PRD good enough for the architect.
- Create / Update / Validate intents.
- "When to use": before committing to a build, for fuzzy internal tools, on a direction change, or to check a draft.
- Five reviewers.
- Extras:
  1. interview-me depth;
  2. upfront context questions: docs (local or Confluence), code and cloud, walking the UI, external examples;
  3. config for locations and templates.

**(b)** You've seen half-finished PRDs. The pilot's PRD is literally empty.

**(c)**
- Your "What a PRD is" and "when to use" match BMAD's template purpose (§0 Document Purpose; `bmad-method/skills/bmad-prd/assets/prd-template.md:15-16`) and its stakes calibration (`SKILL.md:52`).
- **Reviewers, mapped to v7:**

| Your reviewer | BMAD v7 | Default? |
|---|---|---|
| Rubric reviewer | rubric walker vs `prd-validation-checklist.md` (7 dimensions) | Yes (`SKILL.md:79`) |
| Specialist (security, privacy, a11y...) | `finalize_reviewers` + ad-hoc reviewers | **No**: `finalize_reviewers = []` (`customize.toml:148`) |
| Adversarial | via `finalize_reviewers` or ad-hoc | **No** (none configured by default) |
| Source-extraction | "Extract, don't ingest" subagents (`SKILL.md:71`) | Yes |
| Reconciliation | Finalize step 2, one subagent per input (`SKILL.md:92`) | Yes |

  So in v7 you must **configure** the specialist and adversarial reviewers yourself.
- **Extras 2 and 3 already exist in BMAD**: the brain dump asks for every input (`SKILL.md:46`); `prd_output_path`, `prd_template`, `external_sources` and `external_handoffs` (`customize.toml:43-127`).
- **Extra 1 conflicts with BMAD's design**: "Get to working mode fast — two or three turns, not ten" (`SKILL.md:44`). A mix is possible: interview-me for intent first, then the PRD flow.
- Really missing:
  - reading the code, the cloud and the UI during discovery;
  - a status lifecycle beyond `draft`/`final`.

**(d)** `bmad-method/skills/bmad-prd/` (read in full; `02` §3.1), `bmad-method/skills/bmad-spec/`; `addyosmani-agent-skills/skills/{interview-me,spec-driven-development}/SKILL.md`.

**(e)**
- Q4.1a Should every PRD start with interview-me, or only when the input is thin?
- Q4.1b PRD or spec as the default? BMAD now treats the five-field spec as the hub.
- Q4.1c Which specialist reviewers should be on by default for the pilot (security for auth/PII)?

### 4.2 Debug Council (Guide:320-321)

**(a)** Multiple agents debug an issue across frontend, backend, DevOps, architecture or performance.

**(b)** Single agents guess root causes (Lauren's Howl story, Lauren:63).

**(c)**
- Your note is one line, with no mechanics.
- Prior art centers **evidence discipline**, not many voices:
  - pstack: "Reproduce it yourself ... Binary-search the cause ... Don't guess" (`cursor-plugins/pstack/skills/poteto-mode/playbooks/bug-fix.md:7-8`);
  - superpowers: "NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST" (`obra-superpowers/skills/systematic-debugging/SKILL.md:17`).
- Parallel agents help with competing hypotheses (`addyosmani-agent-skills/references/orchestration-patterns.md`, Agent Teams example).
- The pilot has a `debugger` agent.

**(d)** `cursor-plugins/pstack/skills/poteto-mode/playbooks/{bug-fix,runtime-forensics,trace-forensics}.md`, `skills/why/`, `skills/principle-attack-the-premise/`; `obra-superpowers/skills/systematic-debugging/`; `addyosmani-agent-skills/skills/debugging-and-error-recovery/SKILL.md:21-34`; pilot `.claude/skills/fix-bug/`, `.claude/agents/debugger.md`.

**(e)** Q4.2 What failure made you want a council: a guess loop, or a cross-layer bug no single agent sees?

### 4.3 Implementation Plan Council (Guide:323-327)

**(a)** A final multi-agent check of the plan against the PRD, HLD and every document before implementation.

**(b)** Fewer rework loops during implementation.

**(c)**
- It overlaps:
  - BMAD's readiness gate (`bmad-method/CHANGELOG.md:69`);
  - the build's READY standard and Checkpoint 1 "Review plan" (`bmad-method/skills/bmad-build/step-02-plan.md:65-69`);
  - your pilot's plan debate (`.claude/skills/development-council/SKILL.md:84-97`).
- pstack warns that "Adversarial review of a plan with no code behind it invents risks that will never happen" (`cursor-plugins/pstack/docs/guide/10-recipes-and-pitfalls.md:143`).
- Keep it small and risk-gated.

**(d)** As above; `addyosmani-agent-skills/skills/doubt-driven-development/SKILL.md:62-191` (artifact plus contract only, 3-cycle cap).

**(e)** Q4.3 Always, or only above a risk level?

### 4.4 TDD workflow (Guide:330-341)

**(a)** One ticket at a time:
1. Spec-file.
2. Tests from the spec (API, E2E, integration).
3. The developer implements.
4. QA runs the tests.

The tests define the desired result.

**(b)** You want tests that fit the requirement, not tests that fit the code.

**(c)**
- This is ATDD, acceptance tests first. TEA red mode does exactly this: one skipped test per AC, verified red before build (`bmad-tea/skills/bmad-tea-automate/red/`; `resources/run-and-heal.md:54`).
- The tests must come from a different agent than the implementer. Addy: spawn a subagent to write the reproduction test "without knowledge of the fix" (`addyosmani-agent-skills/skills/test-driven-development/SKILL.md:343-357`).
- pstack: use TDD only when the test path is cheap; "Prefer no new test over a bad test" (`cursor-plugins/pstack/skills/tdd/SKILL.md:26`).

**(d)** As above; `bmad-method/skills/bmad-build/step-03-implement.md:43-45` (matrix test audit); `obra-superpowers/skills/test-driven-development/SKILL.md`.

**(e)** Q4.4 ATDD for every story, or only for stories with API/UI acceptance criteria?

### 4.5 Code Review workflow (Guide:344-385)

**(a)** BMAD-style adversarial review: parallel reviewers, triage, checkpoints, always against **one ticket**.

**(b)** Reviews that find real defects without noise, and never rubber-stamp.

**(c)** Your three sub-sections compared with v7 (`bmad-method/skills/bmad-code-review/`):
- **"How a run proceeds"** (Guide:356-369):
  1. Target order: request → ticket tree `review` rows → current branch → ask (`step-01-gather-context.md:20-30`).
  2. The diff is written to a temp file, never pasted (`:32`).
  3. Commit messages are staged in a separate claims file only the edge-case lens reads (`:34`).
  4. Spec / no-spec → `review_mode` full/no-plan.
  5. Parallel lenses; a failed lens is recorded and the rest continue (`step-02-review.md:28`).
  6. Triage: reviewer severities are discarded, each claim is verified at its location, verdicts are high/medium/low/false/maybe-false, grouping is by root cause, buckets are decision-needed/patch/defer (`step-03-triage.md:15-42`).
  7. Present and act (`step-04-present.md`).

  Your description is accurate for v6.12. v7 adds `quick`/`thorough` sets (`customize.toml:41-148`), a no-code `fixes = handoff` mode, and `interactive = false` for CI.
- **"The four reviewers"** (Guide:371-380):
  - Blind Hunter keeps its finding floor `N = min(floor(sqrt(kB)+1), 10)` (`customize.toml:94`).
  - Edge Case Hunter is now a "pure path tracer" with deletion and claims checks (`review-prompts/edge-case-hunter.md`).
  - Verification Gap is unchanged in purpose (`review-prompts/verification-gap.md`).
  - **Acceptance Auditor is replaced by the Intent Alignment Auditor**, which reports the defensible readings of the intent and where the diff diverges (`customize.toml:148`).
  - Your note "Blind Hunter and Edge Case Hunter stay context-free" still holds.
- **"What it will not do on its own"** (Guide:382-384):
  - It still halts at each checkpoint (`step-04-present.md:65, 92`).
  - "Never change a plan's `status`" (`:10`).
  - It warns when a layer failed instead of announcing a clean review (`step-03-triage.md:44-46`).
- The "one ticket" rule matches BMAD.
- **Your pilot enforces more than BMAD**: verdicts are captured by hook and a Stop gate blocks completion (`04` §4).
- pstack: "The adversarial signal comes from model diversity, not assigned personas" (`cursor-plugins/pstack/skills/interrogate/SKILL.md:9`). BMAD found the "cynical reviewer" persona "made no difference" (`bmad-method/CHANGELOG.md:102`).

**(d)** As above; `cursor-plugins/pstack/skills/interrogate/references/lead-judgment.md`; `addyosmani-agent-skills/.claude/commands/ship.md`; pilot `.claude/hooks/`.

**(e)**
- Q4.5a Do you have access to a second model family (Codex/Gemini CLI) for cross-model review?
- Q4.5b Should formal review be hook-enforced, as in your pilot?

### 4.6 QA workflow (Guide:387-390)

**(a)** E2E tests (Playwright/Cypress) over all user scenarios, a screenshot per step, a report, and **developer agents check out and fix** the failures (Guide:390).

**(b)** Confidence that user journeys work, with visual proof.

**(c)**
- "All scenarios" per change is too expensive. TEA test-design gives a risk-based scope; the feature map gives the routes.
- The proof standard is pstack's: "Capture the user action and the resulting state, not only the final screen" (`cursor-plugins/pstack/skills/create-verification-skill/references/feature-map-example/README.md:25`).
- The fix loop needs the same rules as review triage: BMAD QA e2e classifies each failure as "test wrong / harness wrong / application wrong" and "Never weaken an assertion" (`bmad-method/skills/bmad-qa-generate-e2e-tests/workflow.md:60-66`).

**(d)** As above; `bmad-tea/skills/bmad-tea-trace/`; Playwright MCP.

**(e)** Same question as 1.7 (Q1.7). Also Q4.6: who fixes a failing journey, the same developer agent or a fresh one?

### 4.7 Process Retrospective & Evals (Guide:393-408)

**(a)**
- After an epic, use all logs and documents to improve the AI architecture itself.
- Use interview-me, find-skills and **web search for new AI techniques** (Guide:397).
- Report first, change later.
- Evals check trigger accuracy and output quality, with and without the skill. **Inputs: prompts, documents, code, and logs** (Guide:408).
- Run often.

**(b)** A self-improving system: "watch actual behavior, identify a recurring failure, and encode a better way" (Lauren:63).

**(c)**
- Two loops are mixed in this section:
  1. a retro on the **product epic** (BMAD `bmad-retrospective`);
  2. a retro on **MIRAI itself** (pstack `reflect`, `correct`).
- Web search for new techniques fits BMAD deep-recon's technical type ("AI-adjacent landscape ≤ 3 mo" freshness, `bmad-method/skills/bmad-deep-recon/types/technical.md`).
- Evals: pstack blinded eval, BMAD `bmad-eval`, Addy 3 tiers.
- This is heavy. **Recommend later, after logs exist.** The logging schema (5.4) must capture the inputs you list.

**(d)** `bmad-method/skills/bmad-retrospective/`, `bmad-method/skills/bmad-eval/`, `bmad-method/skills/bmad-toolsmith/approaches/from-logs.md`; `cursor-plugins/pstack/skills/{reflect,correct}/`, `skills/poteto-mode/playbooks/eval.md`; `addyosmani-agent-skills/evals/`.

**(e)** Q4.7 Is the retro/eval loop post-MVP, with only the logs in MVP?

### 4.8 Market Research workflow (Guide:411-413)

**(a)** Find competitors and generate business ideas from market research.

**(b)** Business decisions grounded in the market.

**(c)** It's the same as analyst MR/CR. "Generate business ideas" is ideation, not research.

**(d)** `bmad-method/skills/bmad-deep-recon/types/{market,competitive}.md`.

**(e)** Q4.8 For the pilot product, or for your own ideas? That decides whether it belongs in a dev framework.

### 4.9 Brainstorm Business workflow (Guide:415-425)

**(a)** A deep multi-agent discussion (business analyst, entrepreneur, market research, marketing). "Not mandatory in proven projects."

**(b)** Pressure-test a business idea from several angles.

**(c)** It's BMAD party-mode with a custom party (`bmad-method/skills/bmad-party-mode/references/create-party.md`), possibly with the anti-consensus club. It's not a dev lifecycle step. **Recommend: out of MIRAI's MVP**, perhaps a separate "venture" module.

**(d)** `bmad-method/skills/{bmad-party-mode,bmad-forge-idea,bmad-prfaq}/`.

**(e)** Q4.9 Should this live in MIRAI at all, or in a separate personal toolkit for your business ideas?

---

## Part 5. Ideas / TODO

### 5.1 Work Council (Guide:430-438)

**(a)** Agents debate toward a solution. To avoid endless discussion, either an Engineering Manager agent decides, or a disagreement longer than one round becomes a question for you.

**(b)** Better decisions through debate, without loops or false consensus.

**(c)**
- Your option 2 is what prior art does:
  - party-mode "They clash, and you don't resolve it";
  - doubt-driven's 3-cycle cap;
  - build's loop cap of 5;
  - your pilot's "no majority vote; an unresolved BLOCKER or MAJOR blocks".
- An EM agent that decides hides disagreement, which works against trust.
- pstack parks human questions with options and a default in `gates.md` (`cursor-plugins/pstack/skills/poteto-mode/playbooks/orchestrate.md:30`).

**(d)** Pilot `.claude/skills/development-council/SKILL.md:84-97`; `bmad-method/skills/bmad-party-mode/customize.toml` (anti-consensus club); `addyosmani-agent-skills/skills/doubt-driven-development/SKILL.md:181-191`.

**(e)** Q5.1 Council for code changes only (as in the pilot), or for any decision?

### 5.2 Clear documentation and output (Guide:440-444)

**(a)** Every agent writes a readable report to a file, not just the terminal, with a writing skill against AI prose.

**(b)** You review agent work by reading. Bad prose and terminal-only output waste your time.

**(c)** It overlaps 5.8 (writing) and 5.4 (logging). Reports belong in the work item's folder.

**(d)** `bmad-method/skills/bmad-prd/customize.toml:87-89` (`doc_standards`); `cursor-plugins/pstack/skills/{unslop,technical-writing}/`; `addyosmani-agent-skills/skills/documentation-and-adrs/SKILL.md:259-265`; `blader-humanizer/SKILL.md`.

**(e)** Q5.2 One report per workflow run in the work-item folder, plus a one-paragraph chat summary. Is that the shape you want?

### 5.3 Configs (Guide:446-455)

**(a)**
1. Optional notes directory (Obsidian, Confluence, Notion), for context and outputs.
2. Output directories for PRDs, HLDs, ADRs and tickets.
3. External apps (Jira, Confluence, Notion, Obsidian).

Item 3 in your list is an empty placeholder.

**(b)** MIRAI should fit how you already store knowledge and work.

**(c)**
- BMAD has an output folder, an initiative, per-skill `external_sources` and `external_handoffs`, and a ticket store config.
- **A personal-notes location as an input source is new**; your Obsidian vault is the obvious case.

**(d)** `bmad-method/skills/bmod-core-tools/help/customization.md:41-47`; `bmad-method/skills/bmad-ticket/references/store-setup.md`; `cursor-plugins/pstack/automations/benny/FOR_AGENTS.md:34`.

**(e)**
- Q5.3a Should MIRAI write into your vault, or only read from it?
- Q5.3b What else belongs in config: models per role, risk patterns, the gate command, reviewer sets?

### 5.4 Logging system of AI infrastructure (Guide:458-469)

**(a)** Keep the history of every document and all AI work (implementation, QA, review), especially long runs, so humans and agents can review later. Possibly a git repo. `show-me-your-work` is the example.

**(b)** Context survives sessions, and trust needs an audit trail.

**(c)**
- No single prior art covers both:
  - document history (git + BMAD memlog);
  - agent work (pstack decision TSV, uncommitted by default; bmad-loop `journal.jsonl`; the pilot's review reports, wiped on each edit).
- The schema must carry what metrics need (5.9).

**(d)** `cursor-plugins/pstack/skills/show-me-your-work/` (`03` §4.6); `bmad-method/skills/bmad/scripts/memlog.py`; `bmad-loop/docs/reference/run-state.md:50-121`; pilot `.claude/state/`.

**(e)** Q5.4 Commit logs to the project repo, or to a separate history repo?

### 5.5 Documentation website (Guide:472-474)

**(a)** A docs site for MIRAI with graphs.

**(b)** Others (and future you) can learn the system.

**(c)** It's "later" per your brief.

**(d)** `bmad-method/docs-site/` (Astro); `cursor-plugins/pstack/docs/guide/`; `addyosmani-agent-skills/docs/`.

**(e)** Q5.5 Who is the audience: you, your team, or public (personal branding)?

### 5.6 `/bmad-testarch-test-design` (Guide:477-521)

**(a)** Optional risk-based test design with Create / Resume / Validate / Edit and five stages.

**(b)** Test what matters most, decided by risk.

**(c)**
- It's now `bmad-tea-test-design` in TEA v3.1.0 (`02` §3.11).
- Its risk register is deterministic, with P×I scoring and UNKNOWN NFR thresholds.
- It has a defect: the medium band is "3 to 4" (`bmad-tea/skills/bmad-tea-test-design/steps-c/step-03-risk-and-testability.md:76`) but "3-5" in `test-design-architecture-template.md:101`.

**(d)** `bmad-tea/skills/bmad-tea-test-design/`, `bmad-tea/skills/bmod-tea/knowledge/{probability-impact,risk-governance,test-priorities-matrix}.md`.

**(e)** Q5.6 Use it to decide QA scope per epic?

### 5.7 Document statuses (Guide:524-533)

**(a)** Every document has a state (Draft, In Progress, In Review, In QA, Approved, maybe more) so work resumes after a shutdown.

**(b)** Nothing gets lost when a session dies, and nobody builds on an unapproved document.

**(c)**
- BMAD has statuses per skill but no shared model (`02` §6 X5).
- Your list mixes a **document** lifecycle (Draft → In Review → Approved) with a **work-item** lifecycle (In Progress → In QA).
- Resume needs checkpoints and logs, not just a status: TEA `stepsCompleted`/`nextStep` (`bmad-tea/skills/bmad-tea-test-design/steps-c/step-01-detect-mode.md:162-173`); build routes by status (`bmad-method/skills/bmad-build/step-01-clarify-and-route.md:20`).
- Missing from your list: Blocked, Superseded/Deprecated, Dropped, and **who may move a state**.

**(d)** `bmad-method/tools/ticket-tree-rules.md:21-35`; `addyosmani-agent-skills/skills/documentation-and-adrs/SKILL.md:93-100`; `cursor-plugins/pstack/skills/recall/SKILL.md:29`.

**(e)** Q5.7 Which transitions are human-only (Approved? Done?)

### 5.8 Writing / documentation skill (Guide:536-540)

**(a)** Plain, simple language; maybe an ELI5 skill.

**(b)** AI prose is long, inflated and hard to review.

**(c)** ELI5 drops precision. Better fits:
- pstack `technical-writing` (Diátaxis + Google style + STE + Global English) plus `unslop`;
- `humanizer` ("When not to act", "Writing for the wrong reader");
- pstack `bro` for an on-demand plain restatement.

**(d)** `cursor-plugins/pstack/skills/{technical-writing,unslop,bro}/SKILL.md`; `blader-humanizer/SKILL.md`. Vetting in `06`.

**(e)** Q5.8 Different standards for agent-facing and human-facing documents?

### 5.9 Metrics, analyses and data (Guide:543-547)

**(a)** A frontend showing AI usage, success and trust. For example: bugs the AI introduced, and how much correcting back-and-forth you have to do.

**(b)** Evidence-based trust, and a case for (or against) investing more in AI.

**(c)**
- No prior art has an AI-trust dashboard. The raw signals exist:
  - review verdicts and triage counts;
  - loop iterations;
  - reverts;
  - human corrections;
  - token budgets;
  - `tool-savings.jsonl`.
- **Lauren warns that PR count isn't quality**, and that auto-merge is an end state, not a start (Lauren:35-37, 118). Metrics must measure quality and correction, not volume.

**(d)** `bmad-method/skills/bmad-build/plan-template.md` (Review Triage Log); `bmad-loop/docs/reference/configuration.md:84-104`; pilot `scripts/token-savings.sh`; `cursor-plugins/pstack/skills/correct/SKILL.md:15`.

**(e)** Q5.9 Which three numbers would change your behavior? For example: % of tickets passing review first time, human edits per merged PR, escaped bugs per epic.

### 5.10 Lauren Tan pointer (Guide:549-551)

**(a)** Use the workshop ideas too.

**(b)** You trust Lauren's approach.

**(c)** It's covered in Part 7.

**(d)** `cursor-plugins/pstack/`.

**(e)** None beyond Part 7.

---

## Part 6. "Context for agent and human for initial setup" (Guide:557-718)

### 6.1 The setup prompt (Guide:560-700)

**(a)** The prompt for this session holds requirements that aren't in the earlier sections:
- **SDD** as a hard rule;
- **own naming**, with no BMAD/pstack names or personas;
- a **separate installable repo** (one command);
- **sync-back** that never leaks project files;
- a **setup skill** that scans and interviews;
- **logging and statuses**;
- a **pilot** on a separate branch;
- a **one-unit-at-a-time build loop** with specs, tests on the pilot, reviews, and `PROGRESS.md` that a new session can resume from;
- **dogfooding**;
- an **external-skill security gate**.

**(b)** You want a durable, auditable system built carefully, plus a process you can trust because each piece is proven before the next one starts.

**(c)**
- SDD: your notes name the PRD and the dev spec-file but no middle **spec**. BMAD's five-field spec fills it (`bmad-method/skills/bmad-spec/SKILL.md:9`).
- Own naming: BMAD's name is a trademark (`bmad-method/README.md:121-123`).
- Sync-back has **no prior art**. Install has several (plugin marketplace, `npx skills`).
- `PROGRESS.md` as a resume point matches pstack "Pause safely / Session pickup" and Addy's restartable session checklist.
- The "one unit at a time" loop is pstack's `principle-sequence-verifiable-units`.

**(d)** `bmad-method/skills/bmad-spec/`; `cursor-plugins/pstack/skills/poteto-mode/playbooks/{pause-safely,session-pickup}.md`; `addyosmani-agent-skills/skills/context-engineering/SKILL.md:123-137`; `bmad-method/tools/dogfood.py`; `vercel-labs-skills/skills/find-skills/SKILL.md`.

**(e)** Covered in Phase 1. Install method, sync-back and team scope are already required topics there.

### 6.2 Interview Me skill (Guide:703-711)

**(a)** Use it to write the prompt, to set up the project, and maybe as part of MIRAI.

**(b)** Avoid half-specified setups by asking many good questions.

**(c)**
- Its mechanics (`addyosmani-agent-skills/skills/interview-me/SKILL.md`):
  - hypothesis plus confidence (`:40-51`);
  - one question at a time with a guess (`:53-77`);
  - the "want vs should want" probe (`:79-92`);
  - a restate with Out of scope (`:94-111`);
  - an explicit yes (`:113-122`);
  - "STOP YOUR TURN" (`:124-130`).
- "Do not invoke in non-interactive contexts" (`:36`).
- It fits MIRAI's setup interview and PRD intake.
- BMAD's PRD warns against long intakes. Combine them by stakes.

**(d)** As above; `bmad-method/skills/bmad-project-context/SKILL.md` ("Batches of at most eight").

**(e)** Q6.2 In MIRAI, interview-me for setup only, or also before every PRD/spec?

### 6.3 Find Skills skill (Guide:713-716)

**(a)** Use it to find the skills the setup needs.

**(b)** Don't build what exists.

**(c)**
- It runs `npx skills find` and **offers `-g -y` installs** (`vercel-labs-skills/skills/find-skills/SKILL.md:27, 100-103`).
- Its quality check is popularity, not content safety.
- Under your gate: search only, read before recommending, never auto-install.

**(d)** `06-skill-vetting.md` §1.

**(e)** Q6.3 Are you OK with web search plus my vetting replacing `npx skills find`, or do you want to run `npx skills find` yourself?

### 6.4 References (Guide:721-729)

**(a)** The sources to study.

**(b)** Ground the design in proven prior art.

**(c)** The Udemy BMAD course was not read (login required). All repos were read; see `SOURCES.md`.

**(d)** `SOURCES.md`.

**(e)** Q6.4 Anything from the Udemy course you rely on that isn't in the repo?

---

## Part 7. Lauren Tan workshop (Lauren:1-143)

| Concept (lines) | What it means for MIRAI | Prior art | Where in your notes | Gap / tension |
|---|---|---|---|---|
| Manager / kitchen analogy: arrange the environment and standards, check the process (Lauren:14) | MIRAI's job is the environment (context, gates, verification), not more agents | — | implicit | Your notes focus on agents; Lauren focuses on environment |
| Trust gates parallelism; learn one agent first (Lauren:31-37) | MVP = single-agent workflows with strong gates | `cursor-plugins/pstack/docs/guide/07-overnight.md:7-16` | 5.1 | Councils add parallelism before trust exists |
| PR counts aren't quality; auto-merge is her end state, not a start (Lauren:35-37, 118) | No volume metrics; no auto-merge in MVP | — | 5.9 | Metrics could reward volume by mistake |
| Verification closes the loop (Lauren:39-45) | Verification + feature map are core MVP | `cursor-plugins/pstack/skills/create-verification-skill/` | 1.7, 2.7, 4.6 | Four overlapping names in your notes |
| Runtime evidence: run the app, CDP, CPU trace, heap snapshot, simulator (Lauren:41) | The verification skill supports traces where relevant | `cursor-plugins/pstack/skills/poteto-mode/playbooks/{runtime,trace}-forensics.md` | 2.7 | CPU/memory is in your note but unscoped |
| Agents Window story: a wrong diagnosis from human-supplied traces (Lauren:43) | The agent must collect its own evidence | pstack `playbooks/bug-fix.md:7` ("Reproduce it yourself") | 4.2 | — |
| Functional correctness ≠ good design (Lauren:45) | Verification and code review are separate gates | `bmad-method/skills/bmad-build/step-04-review.md` | 4.5 | — |
| Control skill per app (Lauren:47-49) | A generated project-local "drive the app" skill | pstack `create-verification-skill` | 2.7 | — |
| Feature maps: what, how to reach, subfeatures, **shortcuts, DOM selectors / stable handles** (Lauren:55, 130) | Feature map with ARIA/`data-*` handles; generated classes banned | `.../feature-map-example/README.md:33-42`; `automations/benny/.../control-adapter.md:66` | 3.4 | Your note lacks the handles |
| Feature map needs maintenance (Lauren:57) | A maintenance pass | `cursor-plugins/pstack/skills/maintain-verification-skill/` | 3.4 | "QA updates it" drifts |
| Skills from observed mistakes; **watch tool calls and reasoning** while coaching (Lauren:59-65) | A "record a mistake" step after each unit | `cursor-plugins/pstack/skills/correct/`, `skills/reflect/` | 4.7 | — |
| Investigate, don't guess (Howl) (Lauren:63) | The debug flow requires evidence | `obra-superpowers/skills/systematic-debugging/SKILL.md:17` | 4.2 | — |
| Evals as unit tests; neutral dirs; judge on another model; **test on the models the team uses** (Lauren:67-81) | Eval harness for MIRAI's skills (later) | `cursor-plugins/pstack/skills/poteto-mode/playbooks/eval.md`; `bmad-method/skills/bmad-eval/` | 4.7 | Only Claude is available here |
| Local before cloud (Lauren:83-89) | MVP runs locally only | pstack Benny is the cloud case | — | — |
| Benny found the bug already fixed on main; a stage can stop the line (Lauren:87) | Every workflow may end early with "nothing to do" | `cursor-plugins/pstack/automations/benny/.../verify-existing-fix.md` | 4.2 | — |
| Mature vs new apps: guardrails differ; Grok Bot needed 600+ PRs of refactor; consider a rewrite (Lauren:95) | The pilot is template-based with little real code. Set guardrails **now**, before agents write most of it | pilot `LayoutTest.php` | 3.1 | — |
| Dune: `useEffect` ban, **comment ban (agents memorialize one-off instructions)**, process boundaries checked in CI, **colocated features** (Lauren:99-106) | Pattern: encode project rules as CI checks; consider no-comment and colocation rules for the pilot | `cursor-plugins/pstack/skills/no-comments/`, `agents/comment-sicko.md` | 3.1 | Your notes have no structural rules |
| Layers: structure → static checks/CI → review tools → instructions; **firmer constraints first**; compilers help (Lauren:108-110) | Gate order in MIRAI: CI/lint > hooks > review > prose | pstack `skills/correct/SKILL.md:17-23` | 4.5 | Your notes rely mostly on prose |
| Repeated review comment → lint/CI (Lauren:110) | Review proposes checks for recurring findings | pstack `principle-encode-lessons-in-structure` | 4.5 | — |
| Shortest path = good path (Lauren:112) | Templates and generators make the right way the easy way | `cursor-plugins/pstack/skills/architect/references/design-red-flags.md` | — | — |
| Small, meaningful PRs (Lauren:114-118) | One ticket = one PR | `bmad-method/skills/bmad-build/workflow.md:23-31` | 4.5 | — |
| Cost / ROI, her near-unlimited tokens (Lauren:120-124) | Token-budgeted; ceremony scales with risk | `bmad-loop/docs/reference/configuration.md:84-104` | — | Councils everywhere are expensive |
| Non-engineers contribute when constraints are strong (Lauren:124) | Later: PMs file and verify through MIRAI | — | — | — |
| Working mental model table (Lauren:126-137) | Six questions; a good acceptance test for MIRAI's design | — | — | — |

**(c) Gaps and contradictions across the workshop vs your notes**
1. Your notes put **agents** at the center. Lauren puts **environment and constraints** at the center.
2. Your notes put **councils** early. Lauren builds **trust in one agent** before adding parallelism.
3. Your notes lean on **markdown rules**. Lauren ranks them **last**, after architecture, CI and checks.
4. The **feature map's interface handles** are missing from your notes.

**(e) Questions**
- Q7.1 Should Lauren's six mental-model questions (Lauren:126-137) be MIRAI's acceptance test, so the design must answer each one?
- Q7.2 Are you willing to add structural checks to the pilot (lint rules, CI) as part of MIRAI, or should MIRAI stay outside the product code?

---

## Part 8. Cross-section findings

1. **Four names for one capability**: QA Agent, Verification skill, QA workflow, TDD step 4. Merge them into one verification capability with a feature map.
2. **Three names for research**: Analyst MR/CR/DR, Market Research, Brainstorm Business. Use one research skill with types.
3. **Two names for review**: the Code Review agent and the Code Review workflow.
4. **Context-file tension**: "mandatory context files" (2.3) vs "big context makes agents worse" (2.4). Resolve with small verified context plus live reads.
5. **The pilot already has a working version of several notes**: council (5.1), enforced review (4.5), templates (3.2), project context (2.3), risk tiers. MIRAI should absorb these.
6. **Agents vs skills**: in prior art an agent is a persona plus a menu (BMAD) or nothing (Addy). Most of your eight agents are entry points to workflows.
7. **Over-scoped for MVP**: Scrum prediction, Data Engineer, Brainstorm Business, Market Research, docs website, metrics dashboard, full evals.
8. **Human-only approvals** appear in several places (HLD review, context-file validation, ticket approval) without a mechanism. A shared status model with human-only transitions solves all of them (5.7).
