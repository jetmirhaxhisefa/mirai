---
status: draft
version: 1
---

# 08 — Follow-up discussion (after review round 1)

Your follow-up questions, taken one at a time (source: your note `2_Efforts/MIRAI - How it
works.md`, "To followup notes"). Each entry records what we agreed and which files it changes.
**Applied on 2026-10-23** to `01`, `02`, `03`, `04`, `05`, `07` and `research/09`, all in one
pass after the discussion finished. **Later superseded:** `mirai exec test` became the `run_tests` MCP tool in review round 2 (R2-C2), and "main" became `[git] integration_branch` in round 3 (R3-C1). Phase 2 follow-ups wait until after the MVP.

## Q1 · Why both HLD and ADR?

- **Agreed (2026-10-22):** keep both, as designed in `01` §4.
  - The HLD describes how one feature is built: components, flows, data ownership, NFR answers.
    It's read mostly while that feature is built.
  - An ADR records one hard decision: the options, the choice and the consequences. It belongs to
    the project, is immutable, and is superseded rather than edited.
  - With agents, ADRs stop settled decisions being re-argued, are cheap context, and are
    checkable through their "Confirmation" check ID.
- **To apply:**
  - The user documentation (docs website, after implementation) explains why both exist, with
    the notifications example.
  - The same "why" note goes in `01` §4.
  - **General rule:** design reasoning like this ends up in the user docs.

## Q2 · Standard templates for every document

- **Agreed (2026-10-22):**
  1. **Every document type has a fixed template and checklist** (`research/07` §6). This was
     already the design.
  2. **Agents may not add sections.** The lint rejects unknown headings in documents.
  3. **The template-gap signal.** When an agent thinks something important doesn't fit, it
     reports a template gap in its run output; it doesn't invent a section. Gaps are logged and
     shown in `mirai inbox` and the run report. One-off content goes into an existing section
     (Risks, open questions `Q-n`, …).
  4. **Templates are refined later, from evidence.** You change a template deliberately, per
     project (`.mirai/custom/`) or in MIRAI (`mirai contribute`). Templates are versioned.
  5. **Per-project customization is yours.** You can add, reorder or rename sections (renames
     carry a mapping for the lint). The core sections the workflow depends on can't be removed:
     requirement IDs, acceptance criteria, ADR alternatives and consequences.
- **To apply:**
  - `01` §3–§4: the template rules.
  - `07`: the lint unit rejects unknown headings and checks the protected core sections.
  - `07`: the report and inbox units show template gaps.
  - `07`: the run-log schema gets a `template_gap` event.

## Q3 · Projects with multiple repos

- **Your situation:** projects start as a monorepo and split into several repos as they grow.
  Some multi-repo projects can start all their services together; bigger ones often can't.
- **Agreed (2026-10-22):**
  1. **One model for both shapes.** The config has a `repos` list (name, local path, remote URL,
     start + health commands per repo).
     - **Monorepo:** MIRAI is installed in the repo, and the list has one entry, `.`.
     - **Multi-repo:** MIRAI lives in a separate **workspace repo** (the orchestrator repo) that
       points to the service repos.
     - Growing from one shape to the other changes only `repos` and where the docs live.
  2. **What lives where.** The workspace repo holds config, business context, PRDs, HLDs,
     ADRs, epics and tickets (when stored in the repo), run state and reports. Each service repo
     gets a light install: conventions, quality gate, hooks, CI, and no document copies (D5).
  3. **Every ticket belongs to exactly one repo** (a `repo` field). Cross-repo work is split
     into an interface ticket first (D-09), then one ticket per repo. The orchestrator runs each
     ticket in its repo and opens one MR per repo. Cross-repo dependencies wait like stacking.
  4. **Cross-repo E2E, chosen per workspace:**
     - `local`: start each repo in order, wait for every health check, run the E2E;
     - `deployed`: run the E2E against an environment URL;
     - `none`: a manual check for you, flagged in the report, never silently skipped.
     With `release: together`, each repo gets its own `feature/<epic>`, and the release order is
     recorded.
  5. **Project resource links** in config (`resources`):
     - code hosting (GitHub/GitLab repos, CI pages);
     - cloud (GCP projects, AWS account/region, console links);
     - monitoring (Grafana, Datadog, Coralogix, error tracking);
     - runbooks, status page, API docs.

     **Links and names only, never credentials.** Future access goes through the tool's own login
     and read-only connectors (Phase 2: debugging). Internal URLs and IDs are added to the leak
     scanner block list automatically. In the MVP, agents only read the links as context.
- **To apply:**

  | Part | Where |
  |---|---|
  | `repos` + `resources` in the config schema | `07` Milestone A, config unit |
  | `repo` field on tickets | `07` Milestone A, ticket template |
  | Setup asks for repos and resource links | `07` Milestone B, setup unit |
  | Workspace mode (multi-repo runs, cross-repo E2E, release order) | `07` Milestone D, new unit |
  | Moving a monorepo's docs into a workspace repo | `07` Later |
  | `01` §1 (setup), §5 (tickets), §12a (release) | design text |
  | `03` (config model, folder layout) and `04` (new decision) | design text |

## Q4 · Setup collects business resources and builds the business context

- **Before:** one interview question ("where business context comes from", `01` §1) and one file
  `.mirai/context/business.md` with no defined content.
- **Agreed (2026-10-22):** setup gets a proper business-context step.
  1. **Sources first, questions second.** Setup asks what describes the business: files (pitch
     deck, feature list, specs), URLs (website, Confluence/Notion pages, app store page) or pasted
     text. It reads them, then interviews only the gaps (one question with a guess). A new project
     with no sources gets the interview only.
  2. **A fixed `business.md` template** (Q2 rules apply). Sections:
     - what the product does;
     - who it's for (users, customers, who pays);
     - business model and goals/KPIs;
     - **what this project or repo is responsible for, and what it is not** (one line per repo in
       a workspace, Q3);
     - key business rules;
     - domain glossary;
     - constraints (legal/compliance, markets, languages);
     - stakeholders (optional).
  3. **Every claim names its source** (link, file, or "you said, <date>"). Sources are stored as
     links in `resources` (Q3), not copied. Fetched content is fenced as untrusted data.
  4. **Size cap** of about 1–2 pages; long sources are summarised, with the link kept.
  5. **You approve it** like the other context files.
  6. **Kept current.** When a request contradicts `business.md`, Nora proposes an update at
     intake for your approval; it never changes silently. `doctor` reports its age.
- **To apply:**
  - `01` §1 (new setup step), §2 (the intake contradiction check).
  - `07` Milestone B: the context template unit gets the business template + lint + checklist;
    the setup unit gets the sources step.
  - `03`: the context files row.

## Q5 · Cheap models for simple tasks

- **Before:** agents had a "model role" field (`03`, D-37) and the verifier ladder (D-14), but no
  rule for choosing a cheap or strong model per task.
- **Agreed (2026-10-22):** four tiers, the cheapest first.

  | Tier | Runs | Used for |
  |---|---|---|
  | 0 · No AI | a script | Anything where the data already exists: publishing an approved ticket to a tracker, status changes, MR creation, the report skeleton, lints |
  | 1 · Light | small model (e.g. Haiku) | Rewording with all facts given: commit messages, MR descriptions, report summary, parking-note wording, short summaries |
  | 2 · Standard | mid model (e.g. Sonnet) | Developer on S/M tickets, ticket planner, plans, QA, quick reviews, document verification |
  | 3 · Deep | strongest model (e.g. Opus) | PRD writing, architecture/HLD/ADRs, high-risk reviews, L tickets, re-planning after failure |

  **Rules:**
  1. **Tiers are names, not model IDs.** The config maps `light / standard / deep` to models.
  2. **Defaults per step, raised by risk and size.** High-risk or L work moves up a tier.
     Judgement steps are never downgraded (PRD and design work, high-risk reviews).
  3. **Escalate once on failure, within the loop guard.** A step that fails its check twice is
     retried once on the next tier up. It never escalates in a loop, and the round caps still
     apply.
  4. **The verifier is always a different model from the author** (D-14 still holds).
  5. **Measured, not assumed.** Every run logs its tier and model. The calibration run and the
     metrics tune the defaults, because a cheap model that causes extra rounds costs more.
- **To apply:**
  - `07` Milestone A:
    - config unit: tier mapping;
    - launcher: tier selection;
    - loop guard: the one-step escalation;
    - run-log schema: `tier`, `model`.
  - `07` Milestone C: the calibration run also sets per-step tier defaults.
  - `04`: D-14 extended into a model-selection decision.
  - `01`: §0, plus a tier column per stage.
  - `03`: the agent definitions' model role becomes a tier.

## Q6 · E2E tests and Playwright

- **Before:** the design mixed two things.
  - **QA verification** (Ivy checks each AC on the running app with evidence, `01` §10) was
    designed.
  - **An automated E2E suite** committed in the repo was not: nobody wrote it, and "acceptance
    tests by a separate agent" sat in Later.
  - **Safety gap:** Playwright MCP runs outside Claude's sandbox (`research/09` §1).
- **Concept agreed:** follow the test pyramid / testing trophy. E2E tests are the most
  expensive kind, so there are few of them, **for critical user journeys only** ("if this breaks
  we lose users or money"). They cover mainly happy paths plus one or two key failure paths.
  Edge cases go to unit and API tests. The suite grows with journeys, not with features.
- **Agreed (2026-10-22):**
  1. **A critical-journeys list** per project, in the feature map. Setup proposes it from the
     business context (Q4), and you approve it.
  2. **The ticket planner marks `e2e: yes`** only when a ticket creates or changes a critical
     journey. You can override it at ticket approval.
  3. **Ivy writes or updates the E2E test** for that journey, not Kai, so the developer doesn't
     grade himself. It's tagged with the journey and AC IDs, committed with the ticket, and run in
     CI. **Later:** acceptance-test-first (tests written from ACs before the code).
  4. **Other ACs** are covered by AC-tagged unit and integration tests (seen by `mirai trace`)
     plus Ivy's QA evidence.
  5. **New critical journeys** are proposed by Ivy or Tess and approved by you.
  6. **E2E runs in a container:** `mirai exec test e2e` with the official Playwright image next to
     the project's containers. No host browser in overnight runs.
  7. **Playwright MCP only in interactive daytime sessions.**
  8. **E2E files are protected from Kai.** Touching or deleting them trips the floor guard.
  9. **Stable selectors** (`data-testid`, ARIA roles from the feature map). A flaky test is
     re-run once (R-M5).
  10. **A suite time budget** in config (e.g. under 10 minutes). Going over is flagged in the
      report.
  11. **No Playwright in the project:** setup offers a minimal container-based setup with your
      yes. Otherwise it's QA verification only, and the report says "no E2E suite".
  12. **Final E2E for `release: together`** = the epic's E2E tests plus one exploratory pass by
      Ivy.
- **To apply:**
  - `01`: §5 (`e2e` ticket field), §7–§8 (protected files), §10 (rewrite), §12a (final E2E).
  - `07`:
    - Milestone B: the context/feature-map unit gets critical journeys;
    - Milestone C: the QA agent and skill units cover E2E authoring and the Playwright
      container; the strict bundle drops overnight MCP browser use.
  - `03`: the QA agent and skill rows.
  - `04`: a new decision.
  - `research/09` §7: the MCP note.

## Q7 · TDD optional

- **Before:** TDD was the default with orchestrator-proven red evidence (D-23, `01` §7). The plan
  allowed `no-test` rows, but there was no switch.
- **Assessment agreed:**
  - **What TDD gives agents:** a clear stop condition, a proof that the test can fail, and
    smaller diffs.
  - **Where it's weak:** the same agent writing test and code shares one misunderstanding of the
    AC. Agents can fake "red" (import or not-found errors). It fits UI, config, glue and
    migrations badly. It costs more turns (unmeasured). The refactor step gets skipped.
  - **The real value** is an AC-derived test, proven to fail for the right reason, that the
    implementer can't weaken. Independence comes from a separate agent (ATDD).
- **Agreed (2026-10-22):**
  1. **Two settings**, set per project, overridable per epic or ticket by you only (agents can't
     change them):

     | Setting | Values | Default |
     |---|---|---|
     | `tdd` | `auto` · `on` · `off` | `auto` |
     | `tests` | `required` · `optional` | `required` |

  2. **`tdd: auto`:** TDD for logic-heavy work (business rules, APIs, calculations, bug fixes,
     where the bug is reproduced in a test first). Tests-after or QA evidence for UI styling,
     config, glue and migrations. The ticket planner proposes it per ticket, and you can
     override.
  3. **`tdd: off, tests: required`:** tests are written after the code, and there's no red check.
     Every AC still needs a test or QA evidence (`mirai trace`).
  4. **`tests: optional`:** the MR states "no tests" clearly, and review and QA carry the weight.
  5. **High-risk tickets keep `tests: required`** unless you override that ticket.
  6. **Red must fail for the right reason.** The orchestrator accepts only assertion failures as
     red evidence, not compile, import or not-found errors.
  7. **ATDD moves from Later into Milestone D**, at least for high-risk tickets: acceptance tests
     written from the ACs by a separate agent before the code.
  8. **Decided by data.** `tdd` and `tests` are logged per ticket, and after calibration rounds
     and escapes are compared.
- **To apply:**
  - `01`: §5 (ticket fields), §6–§7 (plan and build).
  - `04`: D-23 rewritten.
  - `07`:
    - Milestone A: the config unit gets `tdd` + `tests`; the TDD unit gets the right-reason red
      check;
    - Milestone D: a new ATDD unit;
    - Later: remove ATDD.
  - `03`: the `mirai-tdd` skill row.

## Q8 · Setup configures the test levels (and how MIRAI works in an existing project)

- **Before:** setup only detected test commands for the quality gate. The design quietly assumed a
  project with healthy tests.
- **Agreed (2026-10-22), test levels:**
  1. **Detect, then ask the gaps.** Frameworks, test folders, commands, and how they run in
     Docker, per repo or service.
  2. **One config entry per level** (`unit`, `integration`, `api`, `e2e`, `contract`, …): command
     (via `mirai exec test <level>`), purpose, when it's required (e.g. `api` for endpoint changes,
     `e2e` only for critical journeys, Q6), and a time budget.
  3. **The plan names a level for each AC:** the lowest level that really proves it. Rex flags a
     test at a needlessly high, expensive level.
  4. **Missing levels: suggest, never force.** Setup offers a minimal setup with your yes;
     otherwise the level stays off.
  5. **Multi-repo (Q3):** a `contract` level is suggested, so the interface ticket ships with a
     contract test.
  6. **Recommended minimum** (setup recommends it, you decide): unit + one of integration/API,
     plus E2E for critical journeys only.
  7. **Combined with Q7:** `tdd`/`tests` decide when and whether tests are written; the levels
     decide which kind.
- **Agreed (2026-10-22), existing projects without AI:** don't fix the past, protect the
  future (a ratchet).
  1. **Setup records a test baseline:** existing levels, run times, coverage if available, and
     **the tests that already fail or are flaky**.
  2. **The gate checks "nothing new broke".** Known failures are listed, not blocking; new
     failures block.
  3. **Diff coverage, not file coverage.** Only the lines a ticket changes need tests. Unchanged
     code in the same file doesn't count.
  4. **Characterization tests only for the functions or methods the ticket changes**, written
     before the change. Not the whole class or file. With `tdd: auto` this applies when a ticket
     touches untested code.
  5. **The plan lists them in advance**, visible at the plan gate.
  6. **Rex flags tests for unchanged code** as an out-of-scope finding.
  7. **No automatic test-debt work.** Setup only reports the gaps in the baseline. Test-debt
     tickets exist only when you ask for them.
  8. **Untested areas raise ticket risk**, which means a deeper review and stricter gates.
  9. **The existing test style wins** (D-20). No new framework without your yes.
- **Agreed (2026-10-22), human developers in the same repo:**
  1. **No `mirai/` branch prefix.** MIRAI follows the project's branch naming pattern, set at
     setup.
  2. **MIRAI work is marked by a commit trailer,** `Mirai-Ticket: <id>`, written by the
     orchestrator (agents don't commit). It's adapted to a strict commit format if the project
     has one.
  3. **The hard gates apply only to branches with MIRAI commits.** Human branches are untouched.
     The secret scan is offered to everyone.
- **To apply:**
  - `01`:
    - §1: test levels, baseline, branch pattern;
    - §6–§9: the plan's level per AC, characterization tests, diff coverage, the Rex scope
      check;
    - §8: gate "no new failures";
    - §11: the trailer.
  - `04`:
    - D-15/D-16: gates scoped by trailer;
    - D-20: test style;
    - a new decision for the ratchet.
  - `07`:
    - Milestone A: config levels, gate baseline and diff coverage, ship trailer, `pre-push` and
      CI scoped by trailer;
    - Milestone B: setup detects levels and the baseline, and asks for the branch pattern.
  - `03`: the gate and setup rows.
  - Correction: anything that implied a `mirai/` branch prefix (e.g. `mirai/pilot` in D-28 is
    a branch name we choose ourselves for the pilot, and it stays).

## Q9 · Documents and agent results that aren't needed anymore

- **Before:** documents had `superseded`/`obsolete` statuses, and D-29 kept bulky files out of
  git. But there was no retention rule, and per-ticket work files (plans, review findings, QA
  reports) had no defined home.
- **Agreed (2026-10-23):**
  1. **Product documents are kept forever and retired by status.** These are the brief, PRD, HLD,
     ADR, LLD, business context, and tickets in the repo.
     - Retired ones (`superseded`/`obsolete`) are excluded from agent context automatically.
     - Optional `mirai archive` moves them to an `archive/` folder, only when you run it.
  2. **Per-ticket work files are never committed:** plans, review findings, QA reports, parking
     notes, screenshots, transcripts.
     - They live in the orchestrator store, readable through `mirai inbox` and
       `mirai show <ticket>`.
     - **Only the small signed proof files are committed** (the gate and CI need them; they hold
       no findings).
  3. **No review comments on GitHub/GitLab.** While you are the human gate, reviews stay local.
     - **The MR description gets one line:** `Review: PASS after N rounds (MIRAI)`, plus the
       non-blocking follow-ups worth knowing.
     - QA evidence in the MR is text (AC table, test names, command output).
  4. **The QA result is posted as a ticket comment** when a tracker exists (a tier-0 script). It's a
     frozen snapshot, so it doesn't conflict with D5.
     - Screenshots are uploaded to the ticket where the tracker's API allows it.
     - Screenshots on the MR come later, after checking what GitHub allows (no official API for
       comment images).
  5. **The retention rule:** how long a file is kept before it may be deleted.
     - **Review and QA text, screenshots, transcripts and full logs:** 90 days after the merge
       (configurable). Parked or unfinished tickets keep everything until they're resolved.
     - **Structured finding and metrics data** (severity, category, file, outcome; AC
       PASS/FAIL; rounds, tokens, time, tier): kept. It's read only by `mirai metrics`, so it
       costs zero tokens. An optional setting compacts it into monthly totals after a year.
     - **Agents never load past reviews or metrics data as context.** A recurring insight
       becomes a lint rule or a convention line instead.
  6. **Deletion is never silent.** `mirai clean` lists what will go and the space freed, then
     asks for your yes. The morning report notes when something is due. Automatic deletion is off
     by default.
- **To apply:**
  - `04`: D-29 rewritten, plus a new retention decision.
  - `01`: §9–§11 (where results live, the MR line, the ticket QA comment), §13 (the clean
    notice), §17 (logging).
  - `03`: `mirai show`, `mirai clean`, `mirai archive`.
  - `07`:
    - Milestone A: the report and records units;
    - Milestone C: the QA ticket comment, after a tracker connector exists, so in practice
      Milestone D or later;
    - a `mirai clean` unit;
    - Later: "review someone else's MR" (GitHub/GitLab inline comments) and MR screenshots.

## Addendum (2026-10-23) · Feedback capture in the MVP

- **Agreed:** evaluation (cost analysis, retros, skill evals) stays post-MVP (`09` step 3, group 1).
  But the *reasons* behind back-and-forth with agents are captured from the first ticket:
  - `mirai feedback <ticket> "<text>"`;
  - an optional one-line reason when you edit or reject at `approve`.
- **Applied:** `07` unit 06 (reason at approve) and unit 29 (`mirai feedback`), both in Milestone A.
