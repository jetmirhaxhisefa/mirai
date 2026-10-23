# Phase 1 interview log

Decisions locked during the Phase 1 interview. Each one feeds the Phase 2 design docs
(01-workflow, 03-components, 04-decisions, 07-implementation-roadmap).

**Status: approved.** The restatement was confirmed. Review round 1 changed some answers; see
the last section.

---

## Q1. Who is MIRAI for?

**Decision:** a reusable setup. The framework is shared; config and context change per project.
Used on multiple projects. **Current scope: personal projects only.** The momox team project is
out of scope for now (user correction after Q12).

## Q2. Which tools and integrations?

**Decision:**
- Supports Claude Code, Codex and Cursor.
- Installation configures the project. Setup detects and connects the team's tools
  (e.g. Slack, Jira, Confluence; other teams: others).
- When no tool is available, it falls back to `.md` files for PRDs, epics, stories, tasks, etc.

## Q3. How hard are the gates?

**Decision:** option A. The same hard gates on every tool, enforced by git and CI:
- pre-commit and pre-push hooks;
- a CI job that refuses a merge without a PASS review record and a green quality gate.

Per-tool hooks (Claude Code first) are faster feedback on top, not the enforcement.

## Q4. What is the MVP?

**Decision:** the full delivery lifecycle, run the way a proper company would run it:

1. business requirements →
2. PRD →
3. architecture docs (HLD / LLD / ADR; templates researched online in Phase 2) →
4. tickets and implementation plan →
5. implementation (TDD where it fits) →
6. review and QA →
7. push and merge request.

**Later:** market research, brainstorming and other discovery work.

**Notes:**
- **Author → verifier pairs.** A separate agent, in fresh context, checks the PRD and each design
  doc. The workflow runs both; agents never spawn each other.
- **Ticket unit: a vertical slice.** Each ticket has its own acceptance criteria, can be verified
  on the running app, has a diff reviewable in about 15 minutes, and lists its dependencies.
  Tasks live inside the agent's plan and are not tickets.
- **Template candidates to check:**
  - HLD: arc42 + C4;
  - LLD: a Google-style design doc;
  - ADR: MADR or Nygard;
  - the pilot's 16-section HLD template.
- **Build order still follows the pipeline:** foundation (config, statuses, logging) first, so
  every later stage is measured from day one.

## Q5. The autonomy switch: supervised vs overnight

**Decision:** option C.
- Each stage has a gate in config: `human` or `auto`. The stages are PRD, design, tickets, plan,
  build, review, QA, push, MR and merge.
- Modes (`supervised`, `autonomous`) are saved presets of these gates.
- High-risk tickets (auth, payments, migrations, deleting data) always stop for a human,
  whatever the preset.

**Fixed limits for the MVP:**
- Agents may push and open the MR. They never merge.
- Every run ends with a morning report: what was done, what's blocked, links, and what needs a
  human call.

### Loop and cost control (user's main concern)

Problem: developer, reviewer and QA agents go back and forth without concluding, and spend a lot
on simple tasks.

| # | Cause | Rule |
|---|---|---|
| L1 | A reviewer never runs out of findings | Severity triage. Only *blocking* findings send work back; medium and low go to a follow-up list. Reuses BMAD triage verdicts and routes (patch / defer / bad plan / intent gap). |
| L2 | Moving goalposts | Findings freeze after round 1. Later rounds check only (a) the earlier findings are fixed and (b) nothing new broke. |
| L3 | Arguing without a referee | No debating. The developer fixes a finding or marks it `disputed` with one sentence; disputed findings go to the human. |
| L4 | Retrying a wrong plan | The same failure seen twice is a plan problem: escalate, don't retry. |
| L5 | No proof of progress | Open blocking findings must strictly go down each round. Stop on churn (the same lines rewritten back and forth, or the same test failing with the same error twice). |
| L6 | LLMs doing machine work | Lint, types and tests run before any LLM reviewer; reviewers don't repeat what tools check. |
| L7 | Reviews too heavy | Review depth matches risk and size: a quick pass for normal tickets, every lens for high-risk ones. |
| L8 | An agent decides whether to continue | The orchestrator is a plain script (a fixed state machine). Agents exchange verdict files, never talk to each other. No `bypassPermissions`. |

**Hard limits (configurable defaults):**
- Fix rounds: 2 for normal tickets, 3 for high risk.
- A cost or turn budget per ticket by size (S/M/L), plus a cap for the whole night.
- When a limit is hit, the ticket is parked as `blocked` with a summary (what was tried, open
  findings, best guess at the cause). The run moves on to independent tickets, and the parked
  ticket appears in the morning report.

## Q6. Trust metrics (what the logs must measure)

**Decision:** every agent run writes one log line. From those lines MIRAI computes metrics per
agent, stage, skill version, model and tool. A stage can move from `human` to `auto` only when it
clears a threshold the user sets (example: ≥90% acceptance over the last 20 runs, with 0
escapes). MIRAI **suggests** the switch and never flips it on its own. It **suggests demotion**
when metrics drop.

### Log line fields (one per agent run)

run id, timestamp, project, stage, agent, skill + skill version, ticket, model, tool (Claude
Code / Codex / Cursor), autonomy preset, risk tier, ticket size, rounds, tokens or turns, cost
(when the tool reports it), wall-clock time, verdict, blocking / non-blocking finding counts,
human decision (accepted / edited / rejected), human review time, park reason.

### Metrics

| # | Metric | What it tells you | MVP? |
|---|---|---|---|
| M1 | Human acceptance rate | How often output is approved without changes | Yes |
| M2 | Escape rate | Bugs found after a PASS (QA, human, production) | Yes |
| M3 | Loop rate | Average rounds and share of tickets parked | Yes |
| M4 | Cost per finished ticket | Spend per ticket, by size and risk | Yes |
| M5 | Reviewer precision | Share of blocking findings that were real (not false, not disputed-and-upheld) | Yes |
| M6 | Human review time | Minutes you spend per ticket. Also guards M1: approvals in seconds are rubber stamps, not trust. | Yes |
| M7 | Verifier recall | For PRD and design docs: issues the verifier caught vs issues you caught after it passed | Yes |
| M8 | Acceptance-criteria evidence coverage | Share of acceptance criteria with real verification evidence (test, screenshot, run output) | Yes |
| M9 | Gate bypasses | Count of `--no-verify`, manual overrides, forced merges. Trust in the system itself. | Yes |
| M10 | Sizing accuracy | Estimated S/M/L vs actual cost; tickets split mid-flight | Later |
| M11 | Rework after merge | Reverts and fixes to the same code within N days | Later |
| M12 | Lead time | Ticket ready → MR open, and MR open → merged | Later |
| M13 | Diagnosis quality | Share of parked tickets where the human agreed with the agent's guess at the cause | Later |
| M14 | Correction themes | What you keep correcting, grouped (missing context, wrong pattern, scope creep). Feeds context and skill fixes. | Later |
| M15 | TDD discipline | Share of tickets where the test was seen failing before the fix | Later |
| M16 | Model / tool comparison | M1-M5 sliced by model and tool | Later (free once fields exist) |

**Caveats:**
- **Small samples lie.** Thresholds need a minimum run count before they apply.
- **Goodhart's law:** agents optimized for one number game it. Promotion therefore needs several
  metrics together (M1 + M2 + M6), never one alone.
- **MVP scope:** MVP logs all the raw fields and produces a plain-text metrics report. The
  dashboard comes later.

## Q7. Document statuses, resuming, and where documents live

**Statuses**
- **Documents** (PRD, HLD, LLD, ADR): `draft → in-review → changes-requested → approved → superseded`.
  - Approval records who approved it.
  - An approved ADR is never edited. A change means a new ADR that supersedes it.
- **Tickets:** BMAD's list (draft → ready-for-dev → in-progress → in-review → built → done /
  blocked / dropped) plus `parked`, with a reason. Only the human marks `done`.

**Resuming**
- State never lives in a chat session.
- `mirai resume` (any tool, any day) reads the event log, shows where each item stands, and
  continues from the last finished step.
- A half-finished step is redone from its start, not continued from the middle.

**Storage mode (user addition).** Set in config per artifact type (PRD, HLD, LLD, ADR, epic,
ticket):

| Mode | Content lives in | Notes |
|---|---|---|
| `repo` | Markdown in the repo | The default, and forced when no external tool is connected |
| `external` | Only Jira / Confluence / another tool | The repo keeps a pointer file only (id, URL, status, version) |
| ~~`both`~~ | ~~Both places~~ | **Removed in review round 1 (D5).** See below. |

**Rules that hold in every mode:**
- **Control data always stays in the repo:** the event log, the review/PASS records, run state,
  and pointer files. CI gates and `mirai resume` must work without calling an external API.
- **`external`:** agents read the doc through the connector and cache it in a local copy that git
  ignores, tagged with the doc's version. If the remote version changed, the cache is refreshed
  before use.
- ~~**`both`:** every sync compares versions…~~ Removed in review round 1 (D5).
- **Connector down:** in `external` mode the stage parks with the reason "connector
  unavailable". It doesn't fall back to writing a stray repo copy.

## Q8. Install method

**Decision:** option A, one installer command from a pinned MIRAI version (an npm package or a
git tag).

**Install**
- `npx mirai@<version> init` runs the setup skill: scan the project, interview the user, connect
  tools, write config.
- It generates each tool's files from one source: Claude Code skills, Cursor rules, and
  `AGENTS.md` for Codex. Exact locations are verified in Phase 2.
- The generated files are committed to the project.

**Update**
- `mirai update` shows a diff before applying anything.
- It never touches the team or personal config layers (BMAD-style three layers: shipped / team /
  personal).
- The version is pinned in the project, so every teammate and CI run the same MIRAI.

**Never:** no `curl | bash`, nothing fetched at runtime.

**Later:** per-tool plugins as a thin wrapper around the same files.

## Q9. Sync-back

**Decision:** `mirai contribute`, run by the user. Never automatic.

**Steps**
1. It collects changes to **framework-owned files only** (skills, templates, workflows). Config,
   context, docs, code and logs can never be included.
2. A **leak scanner** runs on the diff, using a block list built at setup: project name, repo
   paths, ticket-key patterns (e.g. `BKT-`), domains, people's names, and generic secret
   patterns. Any hit blocks the contribution until it is edited out.
3. The user sees the cleaned diff plus a **neutral explanation** of why the change helps, with
   metrics as evidence and no project details.
4. On the user's yes, it opens a **branch and a PR on the MIRAI repo**. It never pushes to main,
   and the PR goes through MIRAI's own review gate.

**Passive version:** the metrics report (M14 correction themes) *suggests* contributions and
never acts on them.

**MIRAI repo visibility (answered):** public, with push rights restricted (only the owner for now).
So the leak scanner runs at the strictest level. Other contributors work through fork + PR.

## Q10. Pilot setup

**Decision:** option A.
- A new clean branch from main (e.g. `mirai/pilot`).
- MIRAI replaces both the council and BMAD on that branch.
- The council's gate logic (marker wipe on file change, verdict capture, stop gate) is ported
  into MIRAI.
- The current BKT-48 branch is left untouched.

**Timing:** nothing touches the pilot until the plan is approved ("APPROVED: start
implementation"). The uncommitted BKT-48 work must be committed or stashed by the user first.


## Q11. Naming and personas

**Decision:** **agents** have persona names (a display name and a short style). **Skills** and
workflows keep functional names. Everything is prefixed `mirai-`.

**Guardrails:**
- File names, log names and metric keys stay functional (e.g. `mirai-prd-author`,
  `mirai-qa`). The persona name lives in the agent's frontmatter as a display name, so metrics
  always map to one file.
- A persona is limited to a name plus 1-2 lines of style. It never changes scope, permissions,
  or output format.
- Persona names are our own, never BMAD's. They are proposed in Phase 2.

## Q12. Cross-model verification

**Decision:** the main model is Claude. Verifiers use a fallback ladder, configured per verifier:
1. **A different model family** when one is available (e.g. Codex/GPT verifies Claude's work).
2. **Else a different Claude model** (e.g. the author on Opus, the verifier on Fable).
   This was the user's idea.
3. **Else the same model**, in fresh context, with a different checklist.

The log records which rung ran. M7 (verifier recall) and M5 (reviewer precision), sliced by rung,
show whether a second model is worth its cost.

## Corrections after the restatement

- **Momox is out of scope for now.** I had wrongly assumed the pilot contained momox content.
  The research has no momox material, so the proposed `private/` folder is dropped.
- **`~/Projects/ai-team-setup-momox` is not read.**
- The leak scanner for `mirai contribute` stays as a generic safeguard, since MIRAI is public.

## Changes from review round 1

Recorded in `design/06-review-round-1.md` §G (2026-10-21). The ones that change answers above:
- **Q7 storage mode:** `both` is removed (D5). Each artifact type has **one source of truth,
  never two**: no sync, no mirror. Different types may live in different tools (e.g. tickets in
  Jira, docs in Confluence). With no external tool, everything lives in the repo.
- **Q7 ticket statuses:** `built` and `done` are derived (an open MR with valid records; a
  merged MR), never written (R-C4).
- **Q2 tools:** Claude Code only until Milestone D (D1). No external connector in the MVP (D4).
  Candidates for later: ClickUp, Jira, Linear.
- **Q5 gates:** every document's final approval is human-only (D6). The verifier still reviews
  first. Overnight runs cover the build loop only.
- **Q5 merging and release:** nothing merges without you. Dependent tickets stack within an
  epic, at most 2 deep. Release is ticket by ticket, or per epic with `release: together`
  (a `feature/<epic>` branch and a final E2E test) (D2, D3).
- **Overnight safety:** no container for Claude Code. Projects run in their own Docker
  containers, and Claude Code runs under strict blocking rules (D7, `research/09`).
- **Q12 / runtime:** subscription only. `--bare` is out, and budgets are counted in turns,
  tokens and minutes.

## Changes from review round 2

See `06-review-round-2.md` §G (2026-10-23). The answers above stay; these refine them:
- **Q10 pilot:** the pilot starts **right after Milestone A** (U1). Units are first built and
  tested on the sample app (since round 3: its own private repo, in the pilot's stacks, R3-M1);
  the pilot then repeats each milestone's exit check, and calibration uses pilot tickets.
- **Q5 gates for small work (U4):**
  - `quick` track: approve the ticket, then merge. Two actions (three once the release stage
    adds your production go/no-go, R3-M4).
  - `standard` track: the brief is approved together with the PRD (the track sits in the PRD
    header).
  - `full` track keeps its own brief gate.
  - No supervised `ship` gate: your merge is the gate.
- **Q7 resume:** the MVP assumes one machine (U3); no run-log lines are committed.
- **Q4 E2E (U2):** Ivy writes the E2E test **before** review, and Rex reviews it with the code.
  One proof covers both.
- **Milestone D order (U5):** the second-project install comes first; workspace mode and Cursor
  are built "when needed".

## Changes from review round 3

See `06-review-round-3.md` §D (2026-10-23). The answers above stay; these refine them:
- **Overnight safety (V1 = (a)):** D7 is kept as it is. Agents run as your own macOS user under
  the blocking rules; no separate user, no container. All round-3 fixes apply, and the remaining
  risk is stated honestly. **Condition:** if the red-team tests show the docker socket,
  ssh-agent, keychain or real `.env` is reachable and can't be closed by configuration, headless
  runs are blocked and this decision comes back to you.
- **Design reviews end here (V2):** after the round-3 fixes, safety is carried by the red-team
  suite. No headless agent launch happens before it passes.
- **Q5 merging (V3):** the orchestrator merges the **docs MR** after your signed ticket-set
  approval. Documents only; code is never merged by MIRAI. This refines "nothing merges without
  you" from round 1: that still holds for all code.
- **Q10 pilot:** MIRAI reads the base branch from `[git] integration_branch` (`mirai/pilot`
  during the pilot), so the pilot never touches the product's real `main` (R3-C1).

## Changes at the start of implementation

Agreed on 2026-10-23, after "APPROVED: start implementation":
- **The pilot is confirmed:** `~/Projects/people-management-tool/platform`, installed on
  `mirai/pilot` at unit 30.
- **The pilot's work:**
  - **First ticket:** stories for the app's real components. Storybook is already installed in
    `frontend/`, so the ticket needs no new packages.
  - **Second topic:** Roles & Permissions for the whole app. You discuss it with Nora once
    Milestone B exists; its design (HLD, ADRs) needs Milestone D's design units.
- **Your plan:** Max 20x for now; it may change, and MIRAI will run on several projects. So
  there's **one usage budget across all projects** (D-57).
- **Step 0, the usage spike, is dropped.** Unit 30's usage note is the first reading.
- **The sample app is a test bench, not a product.** It's a small private repo in the pilot's
  stacks, used to test each unit safely and cheaply (dummy secrets, seeded failing and flaky
  tests). Its feature can be anything small; it doesn't need Storybook. The real "new project"
  tests are the pilot install (unit 30), a fresh `/mirai-setup` on the pilot after Milestone B,
  and the second-project install (unit 59).
- **Before unit 30:**
  - merge or park the pilot's `BKT-48/ai-architecture-setup-mvp` branch;
  - install and log in to the `gh` CLI;
  - check that the pilot's GitHub organisation allows required checks on a private repo, and
    who has access.
- **Models (D-58, during unit 03b):** you keep full freedom to map any model to any tier, in the
  project file or your personal file. MIRAI doesn't block a small model for judgement work; it
  shows which model each tier uses, warns when a tier uses a model outside its usual family, and
  every report shows the model used for PRDs, designs and high-risk reviews.
