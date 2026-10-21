---
status: draft
version: 2
---

# 07 — Implementation roadmap

This is the build order only. Each unit gets its full spec in Phase 4
(`implementation/units/NN-name/spec.md`), one at a time, never in bulk.

**Version 2** applies review round 1 (`design/06-review-round-1.md`, the fixes in §A–C as adjusted
by your decisions in §G). The main change is R-C6: instead of one horizontal layer at a time, the
roadmap is a **walking skeleton on Claude Code only**. One real pilot ticket reaches an MR at the
end of Milestone A, and every later milestone widens a path that already works.

**Rules:**
- **One unit** = one skill, one agent, one workflow, one template, one config, or one script
  module.
- **Order follows the skeleton:** the shortest path to one MR first, then documents, then
  overnight, then breadth.
- **Dogfooding starts after unit 05** (`mirai approve`). From unit 06 on, every unit's own spec
  and progress use MIRAI's config, status model and run log (PM-18).
- **Each unit is tested on a small sample app inside the MIRAI repo** (`examples/sample-app`,
  Docker-based like your real projects), built as part of unit 01's test harness. Where a "Done
  when" says "pilot ticket", read "sample-app ticket" until the pilot phase.
- **The pilot comes after the structure is built** (your decision, 2026-10-21). No local project,
  including `people-management-tool/platform`, is touched before then. The pilot phase installs
  MIRAI on the `mirai/pilot` branch (D-28) and repeats the milestone exit checks there. The pilot
  questions in `05` §E wait until that phase.
- **Claude Code is the only tool until Milestone D** (D1).
- **No `both` storage mode** (D5) and **no external connector** in the MVP (D4).
- **Subscription only:** budgets are counted in turns, tokens and minutes. Dollars are shown as
  Claude's estimate only (`research/09` §5–6).

**Milestones** (renamed from M1–M6 so they don't clash with metrics M1–M16):

| Milestone | Name | Done when | Part of |
|---|---|---|---|
| **A** | First MR | One real pilot ticket, written by hand, goes plan → TDD → review → push → MR, supervised, inside the loop caps | MVP-core |
| **B** | Supervised document flow (`standard` track) | A pilot feature request → approved brief and PRD-lite → approved ticket set → one ticket to MR | MVP-core |
| **C** | Overnight | An unattended night of at least 3 small pilot tickets ends in MRs and a morning report, inside the budgets, with zero blocking-rule violations | MVP-core |
| **D** | Full track, release, more tools | The `full` track (ADR/HLD/LLD), per-ticket and per-epic release, updater, Codex verifier, Cursor, and a second project | MVP-complete |
| **E** | Sync-back | A framework change made in the pilot becomes a clean PR on the MIRAI repo | MVP-complete |

**Unit count:** A 26 · B 16 · C 8 · D 12 · E 3 · **65 in total.**
- **Milestone A is larger than the review's estimate of 15–18 units.** That estimate didn't
  include the safety units (12–14) that R-C2 and D7 require before any agent runs on your
  machine.
- **Orchestration is spread across milestones**, not squeezed into 3 units (R-C6):
  - the run store (04);
  - the loop guard (16);
  - one supervised ticket (26);
  - inbox and parking (41);
  - environment faults (46);
  - stacking (47);
  - the autonomous preset (48).

---

## Milestone A: First MR (MVP-core)

### A1. Foundation

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 01 | `mirai` CLI skeleton (Node, no deps): command router, `--help`, exit codes, test harness | — | Everything else is a subcommand | `mirai --help` lists commands; the test runner works; zero npm dependencies |
| 02 | Config model: schema with `schema_version`, 3-layer load + merge, validation, presets (`supervised`, `autonomous`), `[gate] code_paths` defaults. JSON for machine-written files; a TOML subset with a written grammar and a test corpus, rejected loudly outside it (AR-18) | 01 | Every later unit reads config | Merging is tested; a missing required key stops with a clear message; out-of-grammar TOML is rejected |
| 03 | Status model: states, allowed moves including the missing ones (R-M12: MR comments / red CI → `in-progress`; MR closed → `dropped` or `ready-for-dev`; plan rejected → re-plan; at most one re-plan after `bad_plan`), human-only moves. **Frontmatter is the current state; the log is history** (R-M11). **Approved versions are frozen**, and a draft v2 lives beside them. **`built` and `done` are derived, never written** (R-C4). `mirai status` | 01, 02 | Every document and ticket needs it | The transition table is tested; illegal moves are refused; a frontmatter/log mismatch is an error; `built`/`done` are computed from git and the MR state |
| 04 | Orchestrator store under `<git-common-dir>/mirai/` (`state.json`, `journal.jsonl`, `heartbeat.json`, never committed) + run log: one file per run; every line carries `{schema_version, run_id, seq, ts, item, by}`; metric fields from day one; `mirai log` refuses privileged event types (approval, record, gate result, human-only status) | 01, 02 | Logging must exist before anything is measured (Q6); state must not live on ticket branches (R-C4) | Concurrent appends lose no lines; all checkouts see one store; a privileged event via `mirai log` is refused; free-text fields are capped |
| 05 | `mirai approve` / `mirai drop`: TTY confirmation, **signed** approval events (HMAC key in `~/.config/mirai/`, readable only by you and denied to agents by the strict settings bundle, R-M1), the "accepted as is / edited / rejected" capture (R-M18), review time capture | 03, 04 | Every human gate needs it. Dogfooding starts here | Refuses without a TTY; an unsigned or edited approval fails verification; status moves only through it. D-17 is restated honestly ("resists accidental and casual forgery") |
| 06 | Lint framework + `mirai lint`: frontmatter, required sections, IDs, links. The Mermaid check is "fenced + diagram keyword + balanced brackets", with no parser dependency (AR-18) | 01, 03 | Lint runs before any AI | Lints a sample doc set; messages give file:line |

### A2. The templates one ticket needs

Each template unit includes its checklist for the author and the verifier, and its lint rules.

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 07 | Story/bug templates + ticket checklist. Quick-track tickets mint `AC-<ticket>.n` IDs (R-M10) | 03, 06 | The skeleton starts from one hand-written ticket | A filled example lints clean; a ticket without AC IDs is flagged |
| 08 | Plan template + plan lint (frozen block, test list with AC IDs, `no-test` rows) | 07 | Per-ticket planning | A plan with an untested AC is flagged |
| 09 | Report templates + **findings schema** (R-M7): review findings with `basis.ref`, fingerprints by file + symbol, test-failure signatures; QA report; MR description; run report | 08 | The loop guard and review need a machine-checkable format | A finding without a citation or a resolvable `basis.ref` is flagged; the schema has a test corpus |

### A3. Install on Claude Code and lock it down

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 10 | Installer `mirai init` (Claude Code only): copy the framework, write `mirai.lock` with hashes **including generated tool files** (R-M13), `.gitignore` entries. Install via `npx github:<owner>/mirai#vX.Y.Z` | 02 | Gets MIRAI into the pilot | Fresh install on `mirai/pilot`; the lock lists every framework and generated file |
| 11 | Claude Code adapter: `CLAUDE.md` → `@AGENTS.md`, skills, agents, `.mcp.json`. Tool profile as a data file with a schema (R-M16) | 10 | The only tool until Milestone D | Claude Code in the pilot lists MIRAI skills and agents |
| 12 | **Trust root + protected paths** (R-C2): at run start, snapshot and hash the framework, config, custom and generated tool files **from the base commit** into a read-only folder outside the repo. Every launch, hook and gate uses the snapshot. Diffs touching `.mirai/**`, tool dirs, CI files, hooks or lint/test configs are forced to `high` risk | 10, 04 | The gate must not be editable by the agent it checks | A branch that edits a lint config gets `high` risk; hooks and gates read the snapshot, not the work tree |
| 13 | **Strict settings bundle + blocking rules** (D7, `research/09` §7). Generates `<trust-root>/strict.json`: sandbox on with `allowUnsandboxedCommands: false`; `denyRead` on your home folder except the project and toolchain caches; strict network allowlist; `Read`/`Edit` denies outside the project; denies for agent `git push`, `gh`, `docker`, `env`/`printenv`; `dontAsk` headless and `ask` interactive. Blocking hooks: secret patterns in Write/Edit content; Glob/Grep outside the project. Launch flags: `--setting-sources user --settings <trust-root>/strict.json --strict-mcp-config`. Subscription auth check: `claude auth status` reports `oauth_token`; `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` unset; scrubbed environment. Optional, with your approval: install `managed-settings.json` locks. Includes the **red-team test** | 12, 11 | Agents run on your machine from unit 15 on, supervised or not | Every seeded attempt is blocked and logged from `permission_denials`: read `~/.ssh`, `curl` to an unlisted host, `sh -c` around a denied command, `grep -r` from `/`, writing an API key into a file, `dangerouslyDisableSandbox`. The UNVERIFIED items in `05` §G are settled by test |
| 14 | `mirai exec test <suite>` wrapper + pre-step guard + preflight (R-C5, R-M5). Tests run **inside the project's Docker containers**, so agent-written test code never runs on the host. The wrapper is the only `excludedCommands` entry and takes no free-form arguments. Single checkout with branch switching; the guard checks a clean tree, the right branch and a healthy stack. Setup records `worktree_safe = false` for checkout-bound toolchains | 13, 02 | The gate must test the branch actually checked out | A marker change on the branch is seen by the test run; extra arguments are refused; a dirty tree or a stopped stack blocks the step with a clear message |

### A4. Launcher and loop guard

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 15 | `mirai agent run` (Claude adapter): an explicit launch bundle from the trust root (plugin dir, system prompt file, strict settings, MCP config); `--permission-mode dontAsk`, `--max-turns`, `stream-json`; detach-and-wait for supervised launches; write-scope check per role after every run; depth guard via an orchestrator-held token, not an env flag; one run-log line with turns, tokens, minutes and the cost estimate (R-M3, R-M1) | 04, 13, 14 | Every agent run goes through it (D-12) | One run is logged with its usage; a nested launch is refused; a write outside the role's scope fails the run |
| 16 | **Loop guard** library (R-C7): round counter, budget ledger (turns, tokens, minutes), fingerprints, strict-progress check, parking-note writer. Counters are saved **before** each launch and **never reset by resume** | 15, 09 | Loops start at unit 22. Your main concern from Q5 | Seeded loops park inside the caps; a killed-then-resumed loop keeps its counters; a repeat fingerprint routes to re-plan |

### A5. Gate

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 17 | **Patch-id records** (R-C1) + `mirai gate record|check`: bound to `git patch-id --stable` over `merge-base..head`, restricted to `code_paths`. One immutable, signed file per record: `<ticket>/<kind>-r<n>-<patchid>.json` (AR-22) | 04, 05, 09, 12 | The gate needs records | A code change after a record fails `check`; review PASS → QA written → push still passes; a clean rebase keeps the record |
| 18 | `pre-push` hook: records, green checks, blocking **secret scan**. Installed outside the work tree (git common dir) and hash-checked against the base `mirai.lock` (R-C2) | 17, 12 | Q3 hard gate | A push without records is refused; a push containing a seeded secret is refused; an edited hook is detected |
| 19 | CI job (GitHub Actions): checks out `pull_request.head.sha`; verifies records, the secret scan, and the framework and workflow against the **base branch's** lock. Honest fallback if the pilot can't require checks: `doctor` reports "merge gate: CI-enforced / local-only" (R-M21) | 17, 18 | Pulled into A so the hard gate exists early (R-C6 note) | An MR without records fails CI on the pilot repo, or the local-only fallback is documented and reported |

### A6. Build loop for one ticket

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 20 | Agent: `mirai-developer` (Kai). The session runs the quality gate itself before handing over, so machine failures inside it don't use a round. Fix rounds resume the same session (R-M4) | 15, 08 | Builder | Plans and builds one tiny pilot ticket |
| 21 | `mirai-plan` skill + plan gate | 20, 08 | Per-ticket start | A pilot ticket's plan passes lint; the gate stops for your approval |
| 22 | `mirai-tdd` skill + floor guard. **Red evidence is produced by the orchestrator**: new or changed tests run against `baseline_revision` and must fail there (R-M8) | 21, 14, 16 | Build discipline | Red evidence is logged from the baseline run; a weakened test is caught |
| 23 | Agent: `mirai-reviewer` (Rex), read-only | 15, 09 | Reviewer | Finds a seeded bug; uncited findings are downgraded |
| 24 | `mirai-review` skill: lenses by risk, citation rule, freeze after round 1, per-finding check for high risk, findings in the R-M7 schema | 23, 16, 17 | Review | A PASS record is bound to the patch-id; round 2 sees only the delta plus the old blocking findings |
| 25 | `mirai-ship` skill: commit per convention. **The orchestrator pushes and opens the MR**, never the agent. MR creation is idempotent (it checks for an existing MR, R-M6) | 18, 19, 09 | Ship | A pilot MR opens with the template; running it twice opens one MR |
| 26 | `mirai run`, supervised, one ticket: a deterministic state machine over plan → TDD → review → ship. Checkpoint git ref before each step ("redo" = reset to it), run lock, `caffeinate` during runs (R-M6). `mirai resume` restarts from the store | 21, 22, 24, 25 | **Milestone A exit** | One real pilot ticket goes to an MR, stopping at each human gate; a killed run resumes without new rounds |

---

## Milestone B: Supervised document flow, `standard` track (MVP-core)

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 27 | Shared frontmatter + business brief template + checklist | 03, 06 | First document in the flow | A filled example lints clean |
| 28 | PRD template (full + lite) + checklist. One ID chain: `BR → FR/NFR → AC-FR-n.m` (R-M10) | 27 | Feeds tickets | FR/NFR/AC ID rules are linted; the lite variant covers the spec kernel |
| 29 | Epic template + ticket **graph lint** (cycles, closure over FRs, ACs and NFRs, sizes) | 07, 28 | Ticket splitting | Graph lint catches a cycle and an uncovered AC in tests |
| 30 | `mirai-write` skill (agent-facing + human-facing rules; vendored, pinned humanizer) | 11 | Every author agent uses it | Before/after examples pass the checklist |
| 31 | `mirai-interview` skill | 11 | Setup and PRD need it | A sample interview ends in a restatement and an explicit yes |
| 32 | Context file templates: project, business, conventions (per service), feature map | 27 | Setup writes them | Templates with `enforced by` tags lint clean |
| 33 | **Connector contract** (verbs + status map, R-M16; deterministic actions run in the CLI, MCP only for agent-time reading, R-M15) + **`repo` store**. One source of truth per artifact type (D5); `external` types keep a pointer file. Connector text is fenced as untrusted data | 03, 04 | Every document workflow writes through it | The `repo` store passes the contract tests; a stub external store passes the same tests; there is no `both` mode |
| 34 | `mirai-setup` skill (Claude only): detect → ledger → interview → write → connect → enforce. Offers the council and BMAD migration via the ledger | 18, 31, 32, 33, 13 | First real setup on the pilot | Pilot set up; you approve the context |
| 35 | Agent: `mirai-verifier` (Vera). The verifier ladder on Claude only: a different Claude model (rung 2), else the same model | 15, 16, 27, 28, 29 | Every document needs it | Finds the seeded defects in a test PRD; findings have citations; the log records the rung |
| 36 | Agent: `mirai-product-manager` (Nora) | 30, 31, 28 | PRD author | Writes a lint-clean PRD-lite from a sample request |
| 37 | Agent: `mirai-ticket-planner` (Tess) | 30, 29 | Ticket author | A graph-lint-clean ticket set from an approved PRD |
| 38 | `mirai trace` lint: AC → ticket → test → QA evidence, end to end (R-M10) | 29, 08, 09 | Makes SDD checkable | A seeded broken link in the chain is reported with its location |
| 39 | `mirai-prd` workflow (intake, brief, interview, PRD, lint, verify, fix loop through the loop guard, **human-only final approval**, publish). Neutral entry `/mirai-new` (PM-14) | 35, 36, 33, 05, 16 | First stage of the lifecycle | A real pilot feature goes request → approved PRD-lite; every step is logged |
| 40 | `mirai-tickets` workflow (`standard` track: PRD → ticket set, verifier review, human-only approval of the ticket set) | 39, 37, 38 | Feeds the build loop | Approved PRD → approved ticket set, trace lint clean |
| 41 | `mirai inbox` + `mirai unpark <ticket>` (R-M2): one screen of everything waiting for you, batch plan approval from a short review packet, push and MR merged into one `ship` gate, dispute outcomes captured, unpark needs a note | 05, 16, 26 | Approvals per feature drop from about 32 to a few batches | A feature's approvals are done from one screen; unpark without a note is refused |
| 42 | `mirai doctor`: install, config, hooks, CI or local-only gate, strict bundle and red-team status, auth method, stack health, verifier rungs available | 15, 19, 34 | Proves setup | Reports each item green/red with a fix hint on the pilot |

**Milestone B exit:** units 39 → 40 → 26 run end to end on one real pilot feature.

---

## Milestone C: Overnight (MVP-core)

**Precondition:** pilot question P7 (local URLs) is settled and the pilot starts (`05` §E).

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 43 | `verify-<app>` generator (part of setup) | 34, 14 | QA needs it | The generated skill starts the pilot, logs in and screenshots one screen |
| 44 | Agent: `mirai-qa` (Ivy). The browser driver is the project's Playwright setup or Playwright MCP inside the strict bundle; the issue taxonomy follows vercel `dogfood` (R-M17) | 15, 43 | QA | Verifies one AC on the running pilot with a screenshot |
| 45 | `mirai-qa` skill: evidence per AC ID, stored size-capped under `.mirai/` artifacts and referenced, not inlined | 44, 38 | QA step in the loop | A QA report with evidence per AC; `mirai trace` sees it |
| 46 | Environment faults (R-M5): a preflight before each run and each ticket; a circuit breaker after N faults in a row; a flaky test re-run once; API backoff; **a usage-limit hit pauses the run** (checkpoint, reset time, wait, resume with the same counters; stop and report if the reset falls after `run.stop_by` or it's a weekly limit). Faults never use rounds | 16, 26 | One bad night must not park everything | A stopped stack, a flaky test and a simulated usage limit each behave as specified; a paused run resumes at the simulated reset without new rounds |
| 47 | **Stacking within an epic** (D2): a ticket whose dependency has an open MR starts from that branch; its MR targets the parent branch; at most 2 levels; after the parent merges, rebase onto main and re-run checks (the patch-id record holds if the code is unchanged); changes requested on the parent → `waiting on parent`; conflicts → parked | 26, 17, 41 | Overnight throughput (R-M9) | A 3-ticket chain A → B → C builds in one night; changes on A put B in `waiting on parent`; a depth-3 chain is refused |
| 48 | `mirai run`, autonomous preset: a multi-ticket queue, `mirai run --plan` preview. **Refuses to start** unless `doctor` shows the strict bundle active and the red-team test passing. Credentials and push stay with the orchestrator. Overnight covers the build loop only, never document approval (D6) | 46, 47, 45, 42 | Overnight | An unattended run of 3 small pilot tickets ends in MRs |
| 49 | Morning report + `mirai metrics`: report M1, M3, M4 and M6 first, and log all raw fields. Capture point `mirai escape <ticket>` (R-M18) | 04, 48 | Morning report | The report lists done, parked, waiting and usage; metrics are computed from the logs |
| 50 | **Calibration run** (R-M4): measure turns, tokens and minutes per ticket size on real pilot tickets, then write the budget defaults into the presets. Fill in the MVP success and kill targets (below) | 48, 49 | Budget numbers were withdrawn until measured | Presets carry measured defaults; the targets have numbers |

**Milestone C exit:** a night of at least 3 small pilot tickets → MRs + morning report, inside the
calibrated budgets, with zero blocking-rule violations in `permission_denials` that got through.

---

## Milestone D: Full track, release, more tools (MVP-complete)

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 51 | ADR template (MADR 4.0.0-based) + checklist. "Confirmation" names a check ID that `mirai trace` verifies (AR-28) | 27, 38 | `full` track | Required sections linted; supersede links checked |
| 52 | HLD template (arc42 order in our own words + C4 + pilot sections) + checklist | 27, 51 | `full` track | The trace table is linted; the Mermaid check passes |
| 53 | LLD template + checklist | 27, 51 | Epic-level design | The AC-mapped test plan section is linted |
| 54 | Agent: `mirai-architect` (Arlo) | 30, 51, 52, 53 | Design author | Writes a lint-clean ADR + HLD for a pilot feature |
| 55 | `mirai-design` workflow (verifier review, human-only final approval) | 39, 54, 35 | `full` track | Approved PRD → approved ADR(s)/HLD/LLD → `mirai-tickets` |
| 56 | `mirai-change`: versioning, frozen approved versions with drafts beside them, stale detection downstream | 39, 40, 55 | Requirements move | Editing an approved PRD makes a v2 draft; downstream items are flagged stale |
| 57 | Release record template + `mirai-release`, **per ticket** (D3): deploy after your merge, smoke check, your go/no-go for production; staging check if the project has one. Feature flag only when you ask | 25, 45 | Up to live | A release record for one pilot ticket (or record-only if there's no deploy pipeline) |
| 58 | **Epic release `release: together`** (D2, D3): a `feature/<epic>` branch, ticket MRs target it, you approve each merge into it, a **final E2E test** of all the epic's ACs on the feature branch by the QA agent, then one MR to main and one release | 57, 47, 45 | Some epics ship as a whole | A 2-ticket pilot epic goes through the feature branch, final E2E and one release record; no agent merges anything |
| 59 | Updater `mirai update`: lock diff including generated files, 3-way merge with the pinned base version, versioned schemas with deterministic migrations, approve-then-apply. `.mirai/custom/` overrides rendered into the launch bundle with a content hash (R-M13) | 10, 12 | Before others rely on it | An update with a local edit shows a 3-way diff and leaves config, custom and context untouched |
| 60 | Codex adapter, **as a verifier rung first** (rung 1: a second model family) via its tool profile. Role-to-tool matrix (R-M17) | 15, 35, 11 | Q12 cross-model verification | A Codex verifier run is logged with tokens; the ladder picks rung 1 when Codex is logged in |
| 61 | Cursor adapter: generated `.cursor/hooks.json` or dialect-aware hooks; **duplicate-loading test**; `doctor` reports (AR-25, TL-26) | 60 | Q2 | Cursor lists each MIRAI skill once; the duplicate behavior is documented |
| 62 | **Second-project install** (R-M20): install MIRAI on another personal project with a different stack and run one quick-track ticket to MR | 42, 59 | Proves "reusable" (Q1) | One quick-track ticket reaches an MR on project 2 with no framework edits |

## Milestone E: Sync-back (MVP-complete)

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 63 | `mirai promote`: move a custom override or a new skill into a framework path so `contribute` can carry it (R-M13) | 59 | New files need a way into the framework | A promoted file appears in the lock as a framework file |
| 64 | Leak scanner (R-M14): setup block list + secret patterns + generic detectors (emails, URLs, ticket-key patterns, proper nouns not in upstream); scans files **and** the final PR title, body and commit messages. MIRAI repo pre-commit | 34 | Needed before contribute | Seeded project names, paths, ticket keys and secrets are caught in files and in the PR text |
| 65 | `mirai contribute`: builds the contribution branch fresh from upstream with a neutral git identity, runs the scanner last, and shows you the final diff before opening the PR | 63, 64 | Last MVP unit | A framework change from the pilot becomes a clean PR on the MIRAI repo; no project history or identity leaks |

---

## MVP success and kill criteria (R-M19)

The numbers are written by unit 50 (calibration), not guessed now. The shape:
- **Cost:** after 20 pilot tickets, the median turns, tokens and minutes per ticket are under the
  calibrated target for its size.
- **Parking:** under 20% of tickets parked.
- **Escapes:** zero escapes on high-risk tickets (`mirai escape`).
- **Your time:** your review time per MR is under 15 minutes (from `approve` capture).
- **Safety:** zero blocking-rule violations that got through.

**Kill / rethink trigger:** if the targets are missed after 20 tickets, stop adding units and
revisit the design before Milestone D.

## Later (not in the MVP; ordered by value)

1. Parallel lanes: worktrees or isolated compose projects with `seed_files` (R-C5 Architect
   version).
2. Acceptance tests by a separate agent (ATDD).
3. External connectors behind the contract from unit 33 (D4). Candidates: **ClickUp**
   (personal tasks), **Jira** (work projects), **Linear** (one project). Then Confluence, GitHub
   Issues, Notion.
4. Codex and Cursor as overnight drivers (not just as verifiers), with their own hooks.
5. Slack connector and a morning report post.
6. `mirai-retro` and `mirai-eval` (blinded skill evals).
7. `mirai-test-plan` (risk-based test design).
8. Debugger agent and the "council" pattern (deferred; the loop rules replace the council in the
   MVP).
9. Discovery: analyst, research, ideate.
10. UX agent.
11. Per-tool plugins.
12. SSH signing of approvals with confirmation per use (stronger than the HMAC key in unit 05).
13. A container per agent run, if the blocking rules (unit 13) prove insufficient.
14. Metrics dashboard.
15. Docs website.
