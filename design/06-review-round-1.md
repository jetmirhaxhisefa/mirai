---
status: draft
version: 1
round: 1
---

# 06 — Review round 1

## Sources and method

Three independent reviewers worked in parallel; none saw the others' output:
- **PM:** `_review/round-1-pm.md`, 2 Critical / 9 Major / 8 Minor.
- **Tech Lead:** `_review/round-1-techlead.md`, 4 / 13 / 9.
- **Architect:** `_review/round-1-architect.md`, 3 / 14 / 11.

That is **73 findings**. After merging duplicates there are **36 themes**: 7 Critical, 20 Major and
9 Minor groups. Each theme lists:
- its source IDs, so the full evidence can be read in the reviewer's file;
- the problem in one or two lines;
- the fix;
- **my recommendation:** Accept, Accept with change, or **You decide**.

**You decide.** Nothing in the design changes until you do. Section D lists the decisions that only
you can make.

---

## A. Critical

### R-C1 · The review record goes stale on every successful ticket (AR-1, TL-4)

- **Problem:**
  - After review PASS, MIRAI itself writes files outside `.mirai/state/`: the QA report, the
    plan's logs, and the ticket's `built` status. So the tree hash changes and `pre-push` refuses
    every push.
  - GitHub CI checks out the PR *merge* ref by default, so its hash never matches.
  - Every rebase forces a full re-review.
- **Fix:**
  - Bind records to `git patch-id --stable` of `merge-base..head`, restricted to **code paths**.
    The `[gate] code_paths` config has a default exclude list: `.mirai/**`, `<docs_root>/**`, and
    MIRAI bookkeeping.
  - CI checks out `pull_request.head.sha`.
  - A clean rebase keeps the record (same patch-id), and only the quality gate re-runs.
  - Unit 20's "done when" must include "review PASS → QA written → built → push succeeds".
- **Recommendation:** **Accept.** Both reviewers found this independently. It's a real bug in D-16.

### R-C2 · An agent can edit the gate it is checked by (AR-2, TL-3)

- **Problem:** the developer's working copy contains everything the gate depends on:
  - `.mirai/framework/` (the gate scripts and lints);
  - `config.toml` (risk paths, caps, the gate command);
  - the generated tool files;
  - the CI workflow;
  - records and run logs.

  The next reviewer, the hooks and CI all read *those* files. On a GitHub `pull_request` event CI
  runs the PR's own copy of the workflow. So an MR can relax its own gate. This doesn't need a
  malicious model: "fix the lint by editing the lint config" is the cheapest road to green.
- **Fix:**
  1. **Trust root outside the working copy.** At run start the orchestrator snapshots and hashes
     the framework, config, custom and generated tool files *from the base commit* into a
     read-only location outside the repo. Every launch, hook and gate uses that snapshot.
  2. **Protected paths.** A diff touching `.mirai/**`, the tool dirs, CI files, hooks or lint/test
     configs is forced to `high` risk and fails the floor guard. In autonomous mode it parks.
  3. **Hooks are installed outside the work tree** (under the git common dir) and are
     hash-checked against the base branch's `mirai.lock`.
  4. **CI verifies the framework and its own workflow against the base branch's lock**, unless a
     human labels the MR as a MIRAI update.
- **Recommendation:** **Accept.** This also corrects D-16's mitigations, which reviewers rightly
  called circular.

### R-C3 · Overnight runs have no real security boundary (TL-2)

- **Problem:**
  - Any allowed test command runs code the agent itself wrote, so command allowlists don't contain
    it.
  - That code can read API keys, `~/.ssh`, the `gh` token and cloud credentials, and reach the
    network.
  - Claude Code's profile in D-30 is a permission layer, **not** an OS sandbox. (Codex
    `workspace-write` and Cursor `--sandbox` are real sandboxes.)
  - In the pilot every test runs via `docker compose exec`, and docker access is root-equivalent.
- **Fix:**
  1. The autonomous preset **refuses to start** without an OS-level boundary. In order of
     preference: (a) a container/VM per run; (b) Claude Code's own Bash sandbox with a network
     allowlist, which needs research first; (c) at minimum a dedicated macOS user with no keys or
     logins.
  2. Agents never get `docker`. The orchestrator starts the stack, and agents call a fixed wrapper
     (`mirai exec test <suite>`).
  3. Push, `gh` and API credentials live only in the orchestrator's environment. Agents get a
     scrubbed environment.
  4. A provider-side spend limit on the model API key.
  5. Text read from connectors is fenced as untrusted data.
- **Recommendation:** **Accept.** This moves "container per run" from *Later* to *before the
  first overnight run*. It's the biggest cost of this review, and it's necessary.

### R-C4 · The design never says which branch control state is written to (AR-3, TL-5)

- **Problem:** one overnight run spans N ticket branches.
  - Run logs, statuses and parking notes would land either on ticket branches (invisible to
    `resume` and the morning report) or on `main`, outside any MR.
  - `mirai sync` writing `done` means a direct commit to `main`.
  - The `after` dependency check depends on that write.
  - Status edits in two branches conflict at merge.
- **Fix:** split state into two kinds.
  1. **Branch-carried facts** (travel with the MR): document content and versions, approval
     events, records.
  2. **Machine-local operational state:** run progress, rounds, budgets, parking. It lives in one
     orchestrator store under the git common dir, shared by all checkouts and never committed,
     modeled on bmad-loop's `state.json` + `journal.jsonl` + `heartbeat.json`. Selected log lines
     are exported into the MR at ship time for CI and metrics.
  3. **`built` and `done` are derived, never written:**
     - `built` = an open MR whose head has valid records;
     - `done` = the MR is merged (from git).

  Nothing commits to `main` after a merge.
- **Recommendation:** **Accept.** This rewrites D-06 and D-29 and the status model. It also fixes
  the run-log merge conflicts.

### R-C5 · One worktree per ticket breaks on the pilot's Docker setup (TL-1, AR-17)

- **Problem:**
  - The pilot's compose file has a fixed project name, mounts `./backend` relative to the
    checkout, and uses fixed ports.
  - The quality gate runs `docker compose exec` against the stack that is already running.
  - So checks and QA started from a worktree **test the main checkout**: false green.
  - The gitignored `backend/.env` is also missing in a new worktree.
- **Disagreement:**
  - **Tech Lead:** drop worktrees in the MVP and switch branches in one checkout.
  - **Architect:** keep worktrees, but outside the repo, with `seed_files` like bmad-loop.
- **Fix:**
  - The MVP is sequential (D-24), so use **one checkout with branch switching**, plus a pre-step
    guard: clean tree, right branch, stack healthy.
  - Setup detects "toolchain bound to the checkout path" and records `worktree_safe = false`.
  - `doctor` proves the gate sees a marker change.
  - Worktrees, or isolated compose projects, come back with parallel lanes.
- **Recommendation:** **Accept the Tech Lead's version.** The Architect's version is the right
  shape for parallel lanes later, but it doesn't solve fixed ports and shared containers now.

### R-C6 · The roadmap delivers value too late (PM-1, PM-3, TL-17)

- **Problem:** the roadmap builds one horizontal layer at a time:
  - the first real document flow is unit 39;
  - the first MR is unit 52;
  - the first overnight run is unit 54 of 57.

  All three adapters and the updater come before any use. That breaks the design's own
  tracer-bullet rule. bmad-loop's orchestrator alone is about 100k lines of Python, so "3 units"
  for orchestration is underestimated.
- **Fix:** re-cut the roadmap as a **walking skeleton on Claude Code only**:
  - **Milestone A, "first MR" (~15–18 units):**
    - CLI, config, status model, run log, approve;
    - story/bug and plan templates;
    - install on Claude Code;
    - the launcher and loop guard;
    - developer and reviewer plus plan/TDD/review skills;
    - records and `pre-push`;
    - ship;
    - a minimal report.

    Done when one real pilot ticket goes plan → TDD → review → push → MR, supervised, under
    budget.
  - **Milestone B:** brief + PRD-lite, verifier, PM, ticket planner (`standard` track).
  - **Milestone C:** QA + `verify-<app>`, sandbox (R-C3), autonomous preset, morning report.
  - **Milestone D:** `full` track (HLD/LLD/ADR), Codex adapter (first as a verifier rung),
    Cursor, CI job, external connector, updater, `mirai-change`, release.
  - **Milestone E:** sync-back.
- **Recommendation:** **Accept.** All three reviewers point the same way. Note one consequence:
  CI (the hard merge gate) moves to Milestone D. Until then the gate is `pre-push` only, which
  `--no-verify` can skip. I recommend pulling the CI job into Milestone A if the pilot can run CI
  (see R-M21).

### R-C7 · Loop control arrives last, but loops run from the first workflow (PM-2, AR-13, part of TL-6)

- **Problem:**
  - The loop rules, caps, budgets and parking come at unit 53, but document fix loops run from
    unit 39 and build loops from unit 45.
  - `resume` can also reset round counters and budgets. A restart must not grant fresh rounds
    (BMAD TEA: "a restart cannot grant three more rounds", `run-and-heal.md:28`).
- **Fix:**
  - A shared **loop guard** library right after the launcher: round counter, budget ledger,
    fingerprints, strict-progress check, and a parking-note writer. Every fix loop uses it.
  - Counters are saved *before* each launch and never reset by `resume`.
- **Recommendation:** **Accept.** This is your main concern from Q5, so it has to work from the
  first loop.

---

## B. Major

### R-M1 · Approvals and records can be forged; "real terminal" isn't a boundary (AR-11, TL-3, TL-19)

- **Problem:**
  - `script -q /dev/null mirai approve …` gives an agent a terminal.
  - The run log is a plain file that an agent can append to.
  - `MIRAI_DEPTH` is an environment variable the child can unset.
- **Fix:**
  - Sign approvals and records with a key outside any agent sandbox. MVP: an HMAC key in
    `~/.config/mirai/`, readable only by your user (agents run as another user or in a container,
    R-C3). Later: SSH signing with per-use confirmation.
  - `mirai log` refuses privileged event types (approval, record, gate result, human-only status).
  - The depth guard uses a token held by the orchestrator, not an environment flag.
  - Restate D-17 honestly: "resists accidental and casual forgery; with no OS boundary, a
    determined agent can still forge".
- **Recommendation:** **Accept.**

### R-M2 · Too many approvals, and they can't be given from inside the tool (TL-10, PM-6)

- **Problem:**
  - A 7-ticket `full` feature in supervised mode needs about **32** terminal approvals.
  - `/dev/tty` can't be opened from an agent's shell, so you can't approve from inside Claude
    Code either.
  - Rubber-stamping becomes likely, which defeats M6.
  - There is no command to resolve a parked ticket.
- **Fix:**
  - `mirai inbox` in a real terminal: one screen listing everything waiting for you, with batch
    approval of plans from a short review packet.
  - Merge the push and MR gates into one `ship` gate.
  - Add `mirai unpark <ticket>`, which needs a note on what you changed.
  - Say plainly in `01` that overnight covers the build loop only, and that documents always need
    you.
- **Recommendation:** **Accept.**

### R-M3 · The launcher isn't a full choke point, and the headless adapters wouldn't load MIRAI (AR-10, TL-11, TL-12)

- **Problem:**
  - Interactive authoring bypasses the launcher.
  - A supervised launch from the tool's shell hits the shell timeout (Claude's Bash tool: 10 min
    max; agent runs: 45 min).
  - `--bare` skips `.claude/skills`, agents and settings, and the design omits the `--plugin-dir`
    and prompt file flags that `research/08` lists.
  - Codex project config needs trust per path.
  - Per-role "may write" limits aren't enforced.
- **Fix:**
  - The launcher builds an explicit bundle per launch from the trust root (R-C2): plugin dir,
    system prompt file, settings, MCP config.
  - Detach-and-wait for supervised launches: start in the background and poll the status file.
  - After every run, compare the changed files against the role's write scope. A violation fails
    the run.
  - Interactive authoring sessions get a run id via `mirai session start/end`.
- **Recommendation:** **Accept.**

### R-M4 · Budgets: unrealistic defaults, unenforceable on two tools, cold starts drive cost (TL-8, TL-9, PM-8)

- **Problem:**
  - **Estimated agent runs:** about 4–7 per normal ticket, 12–22 per high-risk ticket, about 45
    per `standard` feature and about 70 per `full` feature.
  - One healthy build session is about 1–2.5M tokens (bmad-loop's measurement), so "$2 per S
    ticket" is probably fiction.
  - Codex reports usage only at the end (unverified); Cursor's CLI reports none.
  - A cheap lint failure costs a new cold-start session *and* one of only two rounds.
  - Budget units are mixed.
- **Fix:**
  - **A budget ledger per ticket and per night** with defined units: dollars where known, turns
    and minutes always.
  - **Overnight runs on Claude Code only** in the MVP.
  - **A calibration run** before any default numbers are written.
  - **The developer session runs the quality gate itself before handing over.** Machine failures
    inside the session don't use a round; only failures after handover do.
  - **Fix rounds resume the developer session** instead of starting a new one.
  - **A cost model per track** in `01`.
- **Recommendation:** **Accept.** The budget defaults in `05` B.7 are withdrawn until calibration.

### R-M5 · Environment faults are treated as agent failures (TL-7)

- **Problem:** a flaky test, a stack that's down, a connector outage or an API rate limit burns
  rounds or parks every ticket all night.
- **Fix:**
  - A preflight check before each run and each ticket.
  - A circuit breaker: N environment faults in a row stops the night with one clear message
    instead of parking everything.
  - A flaky test is re-run once before it counts.
  - API errors are retried with backoff.
  - Environment faults never use rounds (bmad-loop separates these).
- **Recommendation:** **Accept.**

### R-M6 · "Restart the step" has no rollback; the run isn't crash-safe (TL-6)

- **Fix:**
  - A checkpoint git ref before each step; "redo" means a reset to it.
  - A run lock.
  - Idempotent MR creation (check whether the MR already exists).
  - Sleep prevention (`caffeinate` on macOS) during runs.
- **Recommendation:** **Accept.**

### R-M7 · The loop rules can't be deterministic without a findings schema (TL-14)

- **Fix:** adopt the Tech Lead's schema (`round-1-techlead.md` TL-14):
  - each blocking finding carries a `basis.ref` the script can resolve (an AC ID, ADR ID,
    convention rule ID, or a runnable repro command for a "failure");
  - fingerprints use file + symbol, not line numbers;
  - test-failure signatures;
  - churn detected via blob hashes;
  - a precise rule for which findings may be raised from round 2.
- **Recommendation:** **Accept.** It becomes part of the report-templates unit and the loop guard.

### R-M8 · Red-phase TDD evidence is self-reported (TL-15)

- **Fix:** the orchestrator runs the new or changed tests against `baseline_revision`, and they
  must fail there. That run is the evidence for M15.
- **Recommendation:** **Accept.** It's cheap and turns a claim into a fact.

### R-M9 · Overnight runs get little done (TL-16)

- **Problem:** "after" means merged, stacking is off, and the tracer bullet comes first, so the
  first night of a new epic builds about one ticket.
- **Fix:**
  - `mirai run --plan` previews what tonight can do.
  - Allow **stacking within one epic** (a ticket builds on its dependency's open MR) with a depth
    limit. With patch-id records (R-C1), a rebase after the parent merges doesn't force a
    re-review.
- **Recommendation:** **You decide** (D2 below). This reverses my earlier "stacking off"
  recommendation. I now lean towards stacking on, within one epic, at depth 2.

### R-M10 · Spec-driven traceability is broken (AR-9)

- **Problem:**
  - The PRD uses `AC-FR-n.m`; tickets use local `AC-n`.
  - Closure is checked only for FRs, not for ACs or NFRs.
  - Tests carry no AC IDs, so M8 is self-reported.
  - There is no ID scheme for the quick and standard tracks.
- **Fix:**
  - **One ID chain:** `BR → FR/NFR → AC-FR-n.m → ticket covers AC IDs → tests tagged with AC IDs
    → QA evidence per AC ID`.
  - Quick-track tickets mint `AC-<ticket>.n`.
  - `mirai trace` (a lint) checks the whole chain: every AC covered by a ticket, every ticket AC
    covered by a test, every AC with evidence.
  - Reuse BMAD TEA's trace step.
  - ADR "Confirmation" names a check ID that the trace lint verifies exists (AR-28).
- **Recommendation:** **Accept.** This is what makes "SDD" real rather than a label.

### R-M11 · Two sources of truth for status; an approved version can be overwritten (AR-7, AR-8, PM-15)

- **Fix:**
  - **Frontmatter is the current state; the log is history.** `mirai status` treats a mismatch as
    an error.
  - **An approved version is frozen.** A draft v2 lives beside it (e.g. `prd.md` stays the
    approved v1; `prd.v2.draft.md` is the draft) and is promoted only on approval. Agents
    always read the approved version.
  - **`both` mode stores a last-sync hash for each side.** Jira status is mirrored one way:
    repo → Jira.
  - **The MVP's `both` mode is narrower:** the repo is primary, publishing is one way, and MIRAI
    warns if the external copy was edited (PM-15).
- **Recommendation:** **Accept the fixes. You decide** on the narrower MVP `both` (D5).

### R-M12 · Tickets can't go back after MR review comments, a red CI or a closed MR (AR-12, TL-22)

- **Fix:** add the missing transitions:
  - **MR comments or red CI** → `in-progress`, with a new round budget that you grant (logged).
  - **MR closed without merge** → `dropped`, or back to `ready-for-dev`.
  - **Plan rejected** → re-plan.
  - **Re-plan after `bad_plan`**, at most once.
- **Recommendation:** **Accept.**

### R-M13 · Update and sync-back miss generated files, have no 3-way merge, and can't carry new files (AR-4, AR-5, AR-16, AR-24)

- **Fix:**
  - The lock also lists the generated tool files, so edits to them are detected.
  - A 3-way merge uses the base content from the pinned package version.
  - Config and state schemas carry a version, with deterministic migration scripts (not LLM
    prose).
  - Specify how `.mirai/custom/` overrides reach agents: rendered into the launch bundle using
    BMAD's merge rules, with a content-hashed snapshot (`render_skill.py`).
  - `mirai promote` moves a custom override or a new skill into a framework path, so
    `contribute` can carry it.
- **Recommendation:** **Accept.** The updater is in Milestone D, so this doesn't delay the first
  value.

### R-M14 · The leak scanner is not a sound boundary (AR-6)

- **Problem:** the LLM-written "why" text is created *after* the scan. A setup-time block list
  misses new names. Commit author, branch names and fork history also leak.
- **Fix:**
  - Scan the final PR title, body and commit messages too.
  - Build the contribution branch fresh from upstream, never from project history, with a neutral
    git identity.
  - Add generic detectors (emails, URLs, ticket-key patterns, capitalized proper nouns not found
    in the upstream repo) alongside the block list.
  - A human reads the final diff in every case.
- **Recommendation:** **Accept.**

### R-M15 · Connectors don't say whether the CLI or an agent runs them (AR-14)

- **Fix:**
  - Deterministic actions (status mirror, publish, sync, merge detection) run in the CLI through
    official CLIs or REST.
  - MCP is used only for agent-time reading inside a session.
  - Credentials come from the tool's own login (`gh`, `acli`) and are never stored by MIRAI.
- **Recommendation:** **Accept.**

### R-M16 · Extension points have no contracts (AR-15)

- **Fix:** data-driven definitions with a schema for:
  - **tool adapters:** a profile file per tool (bmad-loop `data/profiles/*.toml`);
  - **connectors:** verbs + status map;
  - **document types:** template + checklist + lint rules + state machine;
  - **agents:** role, write scope, allowed tools, model role.
- **Recommendation:** **Accept.** It's needed anyway once Codex and Cursor come in (Milestone D).

### R-M17 · No role-to-tool matrix; QA's browser driver is unnamed (TL-13)

- **Fix:**
  - A matrix saying which tool may run which role overnight. Codex's network-off sandbox can't do
    QA or Docker tests.
  - QA uses the project's own Playwright setup, or Playwright MCP, inside the sandbox.
  - Reuse vercel `dogfood`'s issue taxonomy and report shape (AR-27).
- **Recommendation:** **Accept.**

### R-M18 · Metrics need human labels nobody captures; nine are too many to start with (PM-7, AR-23, TL-24)

- **Fix:**
  - **Capture points:**
    - `approve` asks "accepted as is / edited / rejected";
    - `mirai escape <ticket>` records a bug found after PASS;
    - dispute outcomes are recorded in `inbox`;
    - M9 is redefined from CI and host-API data.
  - **Report M1, M3, M4 and M6 first**, and the others once enough data exists.
  - All raw fields are still logged from day one.
- **Recommendation:** **Accept.**

### R-M19 · MIRAI has no success or kill criteria (PM-9)

- **Fix:** add an "MVP success" section with concrete targets, for example:
  - after 20 pilot tickets, the median cost per ticket is under $X;
  - under 20% of tickets parked;
  - zero escapes on high-risk tickets;
  - your review time per MR under 15 minutes.

  Plus a rethink trigger: if those targets are missed after 20 tickets, stop adding units and
  revisit the design.
- **Recommendation:** **Accept.** The numbers come after calibration.

### R-M20 · Reuse across projects is never tested (PM-10)

- **Fix:** add an exit unit to the MVP: install MIRAI on a second personal project with a
  different stack and run one quick-track ticket.
- **Recommendation:** **Accept.** "Reusable" (Q1) is otherwise untested.

### R-M21 · The hard merge gate depends on CI the pilot doesn't have (PM-11, TL-25)

- **Problem:** the pilot has no CI. Required status checks on private GitHub repos may depend on
  the plan (unverified).
- **Fix:**
  - Verify the facts before the CI unit.
  - Write an honest fallback: `pre-push` plus `doctor` reporting "merge gate: CI-enforced /
    local-only".
  - Offer a minimal profile for projects without CI.
- **Recommendation:** **Accept.** I'll check GitHub's rules as part of the fixes.

### R-M22 · MVP scope: release stage, two Atlassian connectors, updater, change requests (PM-4, PM-5)

- **Problem:**
  - The release stage isn't in Q4's list, but you asked for "until it is deployed live" later.
  - Jira + Confluence is doubtful for personal projects, and the pilot has no tracker.
- **Fix:**
  - Split the roadmap into **MVP-core** (Milestones A–C) and **MVP-complete** (D–E).
  - The release stage and one external connector go into MVP-complete.
- **Recommendation:** **You decide** (D3, D4).

---

## C. Minor (accept all unless you object)

| Theme | Sources | Fix |
|---|---|---|
| Parser risk | AR-18, TL-18 | JSON for every machine-written file. TOML/YAML subset with a written grammar and test corpus, rejected loudly outside it. The Mermaid "parses" check becomes "fenced + diagram keyword + balanced brackets", because a real parse needs a dependency. |
| How hooks and CI call MIRAI | AR-19 | `node <trust-root>/bin/mirai.mjs`; `npx` only for `init`/`update`. (Since unit 12b: `.../tree/.mirai/framework/bin/mirai.js`, and the `mirai` on PATH is the launcher.) |
| Run-log line identity and order | AR-20 | `{schema_version, run_id, seq, ts, item, by}` on every line; ordering rule; compaction rule. |
| State machine gaps | AR-21, TL-22 | Missing moves for `dropped`; release and work-item machines in the status unit; a lighter batch approval for context files. |
| Records are mutable | AR-22 | One immutable file per record: `<ticket>/<kind>-r<n>-<patchid>.json`. |
| Cursor loads Claude's hooks | AR-25, TL-26 | Generate `.cursor/hooks.json` or dialect-aware hook scripts; `doctor` reports. Affects humans from day one, not just the orchestrator. |
| Wrong citations and cross-references | TL-20, PM-16, AR-26 | Fix `policy.toml`, the pstack `shipping.md` path, the bmad-loop profile path, unit numbers in `05`, and roadmap dependencies (doctor needs the launcher, etc.). |
| Vendoring policy contradicts 06b | AR-27, TL-21 | One policy in D-27 plus a `vendor/` provenance manifest. Add 06b sources (bm629, dogfood) to the prior-art columns. |
| QA evidence storage | TL-23 | Evidence files in `.mirai/` artifacts per ticket, size-capped; screenshots referenced, not inlined. |
| Naming and wording | PM-12, PM-13, PM-14, PM-18, PM-19 | Milestones renamed A–E (they clash with metrics M1–M16); a glossary; a neutral entry `/mirai-new` (`/mirai-prd` kept for direct use); fix §4's "design never runs" wording; dogfooding starts after the approve unit; mark `00-interview-log.md` approved. |
| Pilot precondition | PM-17 | "P7 local URLs fixed and the pilot starts" is a precondition for the QA units. |
| Debug council deferral not recorded | PM-16 | Add a decision line: the debugger and the "council" pattern are deferred. The loop rules replace the council in the MVP. |

---

## D. What only you can decide

| # | Question | Options | My recommendation |
|---|---|---|---|
| D1 | Accept the walking-skeleton roadmap (R-C6): **Claude Code only** until Milestone D, with Codex/Cursor later? | yes / keep three tools early | **Yes.** Codex arrives first as the second-model verifier. |
| D2 | Stacked MRs within one epic (R-M9)? | off / on, depth 2 / on, unlimited | **On, depth 2.** |
| D3 | Release stage (staging check + production go/no-go): MVP-core or MVP-complete? | core / complete / later | **MVP-complete.** You asked for "until live", but it isn't needed to prove the loop. |
| D4 | First external connector, if any, in MVP-complete? | Jira + Confluence / GitHub Issues / none yet | **Tell me what your personal projects use.** The pilot has GitHub but no tracker. |
| D5 | `both` storage mode in the MVP: full two-way, or "repo primary, one-way publish, warn on external edits"? | full / narrow | **Narrow.** Full two-way comes later. |
| D6 | Keep PRD and design gates **human-only** in the MVP? (This tightens your Q5 answer.) | yes / allow auto | **Yes.** |
| D7 | The overnight security boundary (R-C3): container/VM per run, Claude's own sandbox, or a dedicated macOS user? | container / Claude sandbox / dedicated user | **Container**, with "dedicated user" as the minimum. I'll research the Claude sandbox option before choosing. |

Still open from `05`:
- the install method and repo owner;
- API key vs subscription for overnight runs;
- the persona names.

---

## E. What all three reviewers said to keep

- **The plain-script orchestrator:** one shared round budget, parking instead of retrying, no
  permission bypass.
- **Git hooks + CI as the gate,** tool hooks only as feedback. Agents never merge.
- **Lint before AI,** and the citation rule that makes "blocking" checkable.
- **Control data in the repo,** never an external API in the gate. Metrics suggest but never flip
  a gate.
- **Three tracks,** thin personas with behavior in skills, one verifier with checklists, pinned
  copy-in install.

## F. Next step

Once you answer D1–D7 (and say which fixes you reject, if any), I'll update `01`–`05` and `07` in
one pass. Then I'll either run review round 2 or wait for your "APPROVED: start implementation".

---

## G. Your decisions (2026-10-21)

All Critical, Major and Minor fixes are accepted, except where a decision below changes them.

| # | Decision | Effect on the design |
|---|---|---|
| D1 | **Yes.** Claude Code only until Milestone D. | R-C6 as written. Codex comes first as a verifier rung. |
| D2 | **Nothing merges without you.** Dependent tickets **stack**: B starts from A's branch and B's MR targets A's branch, at most 2 levels deep, within one epic. Per epic you choose `release: per-ticket` (the default) or `release: together`. `together` uses a feature branch `feature/<epic>`: ticket MRs target it, you approve each merge into it, then a **final E2E test** runs on it, then one MR goes to main. | Replaces R-M9. Changes `01` §6, §11, §12, §12a and D-24. Agents never merge, into main or into a feature branch. |
| D3 | **Release is ticket by ticket by default**, with an epic-level "release together" as the exception (D2). A feature flag is added only when you ask for it. | Release stage per ticket: deploy, smoke, and your go/no-go. The epic final E2E is part of `together`. Release stays in MVP-complete. |
| D4 | **No external tool yet.** Candidates: ClickUp (personal), Jira (work), Linear (one project). | The repo store comes first, behind a generic connector contract (R-M16). No external connector in the MVP until you pick one. |
| D5 | **One source of truth per artifact type, never two.** Different types may live in different tools (e.g. tickets in Jira, docs in Confluence). | The `both` storage mode is **removed**. This overrides the Q7 addition. R-M11's `both` fixes are dropped. Logs and state always stay local. |
| D6 | **Human-only final approval for every document** (brief, PRD, ADR/HLD/LLD, ticket set). The verifier agent still reviews each one first. | R-M2 as written. Overnight runs cover the build loop only. |
| D7 | **No container for Claude Code.** Projects run in their own Docker containers. Claude Code runs on the host under **strict blocking rules**: never reveal keys, never push secrets, never read or search outside the project without approval. The rules must **block**, not just advise. | Replaces R-C3 fix 1. Blocking layers: permission deny rules, the Claude Code OS sandbox, hooks, `pre-push` secret scan, CI secret scan (see `04` D-30). R-M1's signing is restated, because agents run as your own user. |
| Other | Install from a pinned GitHub tag; the repo is on your personal GitHub account; **subscription only** (no API key); persona names kept for now. | `--bare` is out. Budgets are counted in turns, tokens and minutes; dollars are shown as an estimate. Usage-limit hits **pause** the run and resume after the reset (your later decision, 2026-10-21; first written here as "park"). |
