---
status: draft
version: 2
---

# 04 — Decisions

Each decision is written in short ADR form:
- **Context:** the problem.
- **Options:** what we weighed, always including "do it the BMAD way" (or the pstack or pilot way)
  where that's a real option.
- **Decision.**
- **Consequences:** the costs, not only the benefits.

"Q" refers to `00-interview-log.md`. "R-…" and "D1–D7" refer to `06-review-round-1.md` (its
themes and your decisions in section G). Status of every decision: `proposed` until the design is
approved.

**Version 2** applies review round 1. Rewritten: D-06, D-07, D-12, D-15, D-16, D-17, D-18, D-24,
D-27, D-29, D-30. New: D-32 to D-40.

---

### D-01 · Name and prefix

- **Decision:** MIRAI, with every agent, skill, workflow and script prefixed `mirai-` (Q11).
- **Consequences:**
  - The npm package name `mirai` is taken (`npm view mirai` → 0.0.8), and so is `mirai-cli`.
  - The install command needs another name: see D-03 and `05-open-questions.md`.
  - A "Mirai" botnet exists, so searches will be noisy. This was accepted at naming.

### D-02 · A separate public framework repo, with a strict framework vs project split

- **Context:** MIRAI is reused across projects (Q1). It is public, and only the owner can push
  (Q10).
- **Options:**
  1. A monorepo with the pilot.
  2. A separate repo.
  3. A separate repo with the framework/project split enforced by a lock file.
- **Decision:** option 3.
  - Framework files are copied into `.mirai/framework/` and listed with hashes in
    `.mirai/mirai.lock`.
  - Everything else (config, custom, context, state, docs) belongs to the project.
- **Consequences:**
  - The lock is the sync-back boundary (D-21) and the update boundary (D-03).
  - Editing framework files directly in a project is possible, and `update` shows it.

### D-03 · Install by one command from a pinned version; files are copied into the project

- **Context:** one-command install (goal 1). It must work on three tools (Q2) and in CI without
  network fetches.
- **Options:**
  - **BMAD v7 way:** `npx skills add` plus `bmad setup`. It fetches from raw.githubusercontent at
    update time (`setup.py:1838-1912`) and uses `npx skills -y`. Both were flagged in
    `research/06`.
  - **A plugin per tool:** three packages, weak per-project config.
  - **A git submodule with symlinks:** symlinks break on some tools, and it's easy to forget the
    submodule update.
  - **One installer from a pinned version that copies files and generates tool files.**
- **Decision:** the installer (Q8), distributed as `npx github:<owner>/mirai#vX.Y.Z` (a git tag, no
  npm needed). The repo lives on your personal GitHub account (section G). An npm name can come
  later.
  - Hooks and CI call the trust-root copy (`node <trust-root>/bin/mirai.mjs`, D-15). `npx` is used
    only for `init` and `update`.
  - `update` shows a diff and migrations and applies them only on yes.
  - It uses BMAD's `retired.toml`/`migration-N.toml` pattern.
- **Consequences:**
  - The generated files are committed. Project diffs get noisier on update.
  - CI and every teammate run exactly the same version.

### D-04 · Scripts in Node.js with no npm dependencies

- **Context:** the CLI, orchestrator, lints and hooks need a runtime.
- **Options:**
  - **BMAD way:** Python + `uv`. Missing `uv` is a known failure mode (`CHANGELOG.md:72, 114`).
  - Bash: fragile for JSON and state machines.
  - Node.js.
- **Decision:** Node.js (LTS), standard library only.
  - `npx` already requires Node, so there's one runtime.
  - Zero dependencies means nothing to audit and nothing pulled at runtime.
- **Consequences:**
  - Projects without Node on the host need it installed. `doctor` checks this.
  - Some things (TOML parsing, YAML frontmatter) need small hand-written parsers. The parser
    policy is in D-40.

### D-05 · Config in three layers plus per-skill overrides

- **Options:**
  - **The BMAD way** (`bmod-core-tools/help/customization.md:41-47`): shipped, team and personal
    layers, plus per-skill `customize.toml` hook points.
  - One flat file.
- **Decision:** the BMAD way, with two changes:
  - A schema with validation. A missing required key stops the run (BMAD `CHANGELOG.md:73`).
  - Fewer hook points per skill. Only `persistent_facts`, `external_sources`, `on_complete` and
    template paths are kept until a real need appears.
- **Consequences:**
  - Updates never overwrite your settings.
  - Hook points can be added later without breaking projects.

### D-06 · Two kinds of state; one source of truth per artifact type

- **Context:**
  - Resume must work from any tool on any day (Q7).
  - One overnight run spans many ticket branches. Version 1 never said which branch state is
    written to (R-C4).
  - You want each document in exactly one place, never duplicated (D5).
- **Options:**
  - State in the chat session: lost on compaction.
  - **BMAD way:** state in plan frontmatter plus the memlog.
  - State in Jira: the gate and resume would depend on an API.
  - Everything committed on some branch: invisible to `resume` on other branches, or a direct
    commit to `main`.
- **Decision:**
  1. **Branch-carried facts** travel with the MR: document content and versions, approval
     events, review and QA records (D-16).
  2. **Machine-local operational state** lives in the **orchestrator store** at
     `<git-common-dir>/mirai/` (`git rev-parse --git-common-dir`):
     - run progress, round counters, budget ledger, parking notes, the run lock;
     - shared by every checkout and never committed;
     - modeled on bmad-loop's `state.json` + `journal.jsonl` + `heartbeat.json`.

     At ship time, selected run-log lines are exported into the MR for CI and metrics.
  3. **`built` and `done` are derived, never written:**
     - `built` = an open MR whose head has valid records;
     - `done` = the MR is merged, read from git.

     Nothing commits to `main` after a merge.
  4. **One source of truth per artifact type** (D5): each type is `repo` or `external:<tool>`.
     - Different types may live in different tools, e.g. tickets in Jira and docs in Confluence.
     - The same document never lives in two places. There is no sync and no `both` mode.
     - `repo` is forced when no tool is connected.
  5. **Control data never depends on an external API.** That covers records, pointers and the
     orchestrator store. The gate and `mirai resume` work offline.
- **Consequences:**
  - In `external` mode agents read from a version-tagged local cache, and a pointer file holds
    the id, url, version and status.
  - Status edits on two branches can't conflict, because operational state isn't on any branch.
  - Losing the machine loses run progress but not the work itself: branches, MRs and records
    survive. `resume` rebuilds what it can from git and the host.

### D-07 · One status vocabulary for every document

- **Context:** BMAD has none shared: PRD draft/final, plan 8 states, research complete, TEA
  `workflowStatus` (`research/02` X5). The pilot's templates disagree with each other.
- **Decision:**
  - **Documents:** `draft → in-review → changes-requested → approved → superseded`, plus
    `dropped`.
  - **Tickets:** BMAD's plan states, with `blocked` carrying a required `park_reason`.
  - **Release records:** `staging → verified → approved → live | rolled-back`.
  - One transition table marks the human-only moves. It includes the moves added in round 1
    (R-M12): MR comments or red CI → `in-progress` with a round budget you grant; MR closed
    unmerged → `dropped` or `ready-for-dev`; plan rejected → re-plan; at most one re-plan after
    `bad_plan`.
  - **Frontmatter is the current state; the run log is history** (R-M11). `mirai status` treats
    a mismatch as an error.
  - **An approved version is frozen.** A new draft lives beside it (`prd.md` stays the approved
    v1; `prd.v2.draft.md` is the draft) and replaces it only on approval. Agents always read the
    approved version.
- **Consequences:**
  - Status mapping for an external tracker is set once at setup, when one is connected. BMAD's
    "In Review is not a default Jira status" problem gets asked at setup, as BMAD does.

### D-08 · Three tracks: quick, standard, full

- **Context:** running the full lifecycle for a bug fix wastes money. Your answer to Q4 asks for
  the full company process.
- **Options:**
  - Always the full process.
  - BMAD's misroute scan, which reroutes small asks.
  - Explicit tracks.
- **Decision:** explicit tracks (`01` §0).
  - The PM proposes, you confirm.
  - `full` always stops for you.
  - The PRD lite variant absorbs BMAD's spec kernel (`bmad-spec/SKILL.md:9`), so SDD holds on
    every track: quick = ticket + plan; standard = lite PRD; full = PRD + design docs.
- **Consequences:** one more decision at intake. A wrong track can be changed later through a
  change request.

### D-09 · Tickets are vertical slices, with an interface-stub exception

- **Context:** your view is that small tickets work best (Q4).
  - BMAD allows stories that aren't user-visible ("the epic is the unit of value",
    `slice.md:65`) and uses lanes.
  - Addy insists on vertical slices (`planning-and-task-breakdown/SKILL.md:57-77`).
- **Options:**
  - Horizontal tickets (one per layer).
  - BMAD lanes.
  - Vertical slices.
- **Decision:**
  - Vertical slices by default, sized for one session and a roughly 15-minute review.
  - An interface plus a stub is its own story when two lanes share a boundary (from BMAD).
  - A tracer bullet first.
  - "Split, never shrink".
  - Tasks stay inside plans.
- **Consequences:**
  - More stories than a human team would make. The `after` graph and the closure check keep them
    coherent.

### D-10 · Every document is checked by a separate agent in fresh context

- **Context:** your requirement that "another agent can verify it" (Q4). In BMAD the author skill
  runs its own reviewer gate (`bmad-prd/SKILL.md:75-85`).
- **Decision:** the author never verifies its own document. A separate agent does, launched in
  fresh context, on another model where available (D-14).
  - A cheap script lint runs first.
  - Each reviewer writes a file and returns only a summary (BMAD `SKILL.md:81`).
- **Consequences:** each document costs one or two extra agent runs. Metric M7 (verifier recall)
  shows whether that pays off.

### D-11 · Personas allowed, but thin; behavior lives in skills

- **Context:** you want personas (Q11). BMAD found personas "made no difference" for review quality
  (`CHANGELOG.md:102`) and that the dev agent's guardrails were bypassed on the `bmad-build` path
  (`CHANGELOG.md:110`).
- **Decision:**
  - A persona is a display name plus 1–2 lines of style.
  - File names, logs and metrics use functional names.
  - Rules, permissions and output formats live in skills and in the CLI, never in persona text.
  - **Personas never invoke personas** (Addy's rule). A workflow skill or the orchestrator does.

### D-12 · Every agent launch goes through `mirai agent run`

- **Context:** logging must be complete and comparable across Claude Code, Codex and Cursor
  (Q2, Q6). The verifier model must be selectable (Q12). Budgets must be enforced (Q5).
- **Options:**
  1. Each tool's native subagents. Logging, model choice and limits differ per tool, and some
     tools lack them.
  2. **BMAD way:** subagents spawned inside the session by prose instructions.
  3. A CLI that starts every agent as a separate headless process through a per-tool adapter.
- **Decision:** option 3 for every verifier, reviewer, QA and scripted developer run.
  - **Interactive authoring** (the PM interviewing you) runs in your session, wrapped by
    `mirai session start` / `mirai session end`, which give it a run id (R-M3).
  - **An explicit launch bundle per launch,** built from the trust root (D-16), never from the
    working copy:
    - the plugin dir with MIRAI's skills and agents;
    - the system prompt file;
    - the strict settings bundle (`strict.json`, D-30);
    - the MCP config.
  - **Detach-and-wait for supervised launches.** The launch starts in the background and the
    session polls a status file. That avoids the tool's shell timeout (Claude's Bash tool: 10 min
    max; agent runs: up to 45 min).
  - **Write-scope check.** After every run the changed files are compared against the role's
    `may write` scope (`03` §4). A violation fails the run.
  - Native subagents can come later as an optimization behind the same CLI.
- **Claude Code invocation (subscription only, section G):**
  - `--bare` is **out**: it skips the OAuth token, so it can't use a subscription
    (`research/09` §4).
  - Instead: `claude -p … --setting-sources user --settings <trust-root>/strict.json
    --strict-mcp-config --mcp-config <trust-root>/mcp.json --permission-mode dontAsk
    --permission-prompts none --max-turns N --output-format stream-json`. Project and local
    settings, including any hooks a branch brings, never load.
  - **Auth:** `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` (one-year token). The launcher
    unsets `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`, because in `-p` an API key beats the
    token (`research/09` §5). Preflight runs `claude auth status` and expects
    `authMethod: oauth_token`.
- **Consequences:**
  - One logging point, one budget point, one model-choice point.
  - Each launch pays a cold start. Fix rounds resume the developer session to cut that (D-18).
  - Subscription usage limits are a real stop condition (D-18).
- **Facts from `research/08-tool-integration.md` §5:**
  - **Headless commands exist on all three:**
    - Claude Code: `claude -p --output-format stream-json`.
    - Codex: `codex exec --json`.
    - Cursor: `agent -p --output-format stream-json`. Cursor's CLI was renamed from `cursor-agent`.
  - **Only Claude Code has native caps** (`--max-turns`, `--max-budget-usd`) **and reports cost**
    (`total_cost_usd`). For the others the launcher enforces limits itself:
    - **Codex:** cost = tokens from `turn.completed.usage` × a price table in config. The launcher
      kills the process when over budget.
    - **Cursor CLI:** reports no usage. Limits are wall-clock timeout plus rounds, and the cost
      field is logged as `unknown`.
  - **Structured output:** Claude `--json-schema` and Codex `--output-schema` validate the final
    answer. For Cursor, the launcher validates the JSON and retries once.
- **The Codex and Cursor facts apply from Milestone D** (D1). The MVP runs on Claude Code only;
  Codex comes in first as a verifier rung (D-14).
- **Recursion guard** (added after `research/06b-skill-sweep.md`): mattpocock's review sub-agents
  once spawned more than 50 agents (`docs/engineering/code-review.md:61`).
  - An agent started by the launcher can't start another one.
  - **The guard is a launch token held by the orchestrator,** not an environment flag a child
    could unset (R-M1). `mirai agent run` needs a valid one-time token from the orchestrator
    store or your `mirai session`. Agents can't read the store (D-30), so they can't mint one.
  - Only workflow skills in your session and the orchestrator launch agents.

### D-13 · One verifier agent with a checklist per document type

- **Options:** one verifier per document type (PRD verifier, design verifier, ticket verifier) vs
  one verifier with checklists.
- **Decision:** one verifier (Vera). Expertise lives in the checklists. Metrics are still split per
  stage. The verifier reviews every document, but final approval is always yours (D-34).
- **Consequences:** if metrics show it's weak on one type, that type gets its own agent. This
  choice is reversible.

### D-14 · The verifier model ladder

- **Decision** (Q12):
  1. A different model family, if configured.
  2. Otherwise a different Claude model.
  3. Otherwise the same model, in fresh context, with a different checklist.
- The rung used is logged on every run.

- **How rung 1 works in practice** (`research/08` §5.3):
  - Claude Code runs Claude models only. Codex only takes providers that speak OpenAI's Responses
    API. Only Cursor mixes model families inside one tool.
  - So a different family usually means **the launcher starts the other tool**. For example, Claude
    authors and `codex exec` verifies.
  - Rung 1 is only available when a second tool is installed and logged in. `doctor` reports which
    rungs exist.
  - **In the MVP (Claude Code only, D1)** the ladder starts at rung 2. Codex is the first rung 1
    added, in Milestone D (see `07`).

### D-15 · Hard gates in git hooks and CI; tool hooks are fast feedback

- **Context:** the gates must hold on all three tools (Q3).
  - BMAD's gates are prose HALTs that nothing enforces (`research/02` X8).
  - The pilot enforces gates, but only inside Claude Code (`.claude/hooks/`).
- **Decision:**
  - A `pre-push` hook and a CI required check verify the review and QA records plus a green
    quality gate.
  - Claude Code hooks (ported from the pilot) give in-session feedback. Codex and Cursor get hooks
    where they support them.
- **The gate can't be changed by the branch it checks** (R-C2):
  1. **Trust root.** At run start the orchestrator snapshots the framework, config, custom files
     and generated tool files *from the base commit*. It hashes them into a read-only folder
     outside the work tree, under the orchestrator store (`<git-common-dir>/mirai/trust/<base-sha>/`).
     Every launch, hook and gate uses that snapshot.
  2. **Protected paths.** A diff that touches `.mirai/**`, the tool dirs (`.claude/`, `.agents/`,
     `.codex/`, `.cursor/`), CI files, git hooks or lint/test configs is forced to `high` risk and
     fails the floor guard. In autonomous mode the ticket parks.
  3. **Hooks are installed outside the work tree** (`core.hooksPath` under the git common dir).
     They are hash-checked against the base branch's `mirai.lock`.
  4. **CI checks the framework and its own workflow against the base branch's lock.** The only
     exception is an MR you label as a MIRAI update.
- **Consequences:**
  - `--no-verify` can skip local hooks. CI still blocks the merge, and every bypass is counted
    (M9).
  - **Until CI exists for a project, the merge gate is local only** (R-M21). `doctor` says so
    plainly: "merge gate: CI-enforced / local-only". A minimal profile covers projects without
    CI. Whether required status checks work on a private repo on your GitHub plan is checked
    before the CI unit (see `07`).
  - Changing MIRAI's own rules always needs you, which is intended.
- **Confirmed by `research/08` §5.3:**
  - Codex and Cursor hooks **fail open** when a hook errors.
  - Codex skips hooks a user hasn't trusted.
  - Only Claude Code supports fail-closed hooks.
  - So tool hooks can't be the gate.

### D-16 · Review and QA records are bound to the code change (patch-id)

- **Context:**
  - The pilot wipes review markers on every edit (`on-file-change.sh`). That only works inside one
    Claude Code session.
  - Version 1 bound records to the tree hash. That broke every successful ticket: after review
    PASS, MIRAI itself writes the QA report and status, the hash changes, and `pre-push` refuses
    (R-C1, found by two reviewers). GitHub CI checks out the PR *merge* ref by default, so its
    hash never matched either.
- **Options:**
  - The tree hash (version 1).
  - The pilot's session markers.
  - pstack's `git patch-id` idea (`playbooks/shipping.md`).
- **Decision:** **patch-id records.**
  - A record stores `git patch-id --stable` of `merge-base..head`, restricted to **code paths**.
  - The `[gate] code_paths` config has a default exclude list: `.mirai/**`, `<docs_root>/**` and
    MIRAI bookkeeping.
  - Any later code change changes the patch-id, so the record stops counting, in any tool and in
    CI.
  - **CI checks out `pull_request.head.sha`,** not the merge ref.
  - **A clean rebase keeps the record** (same patch-id). Only the quality gate re-runs. This is
    what makes stacking (D-24) affordable.
  - **Records are immutable files,** one per record:
    `<ticket>/<kind>-r<n>-<patchid>.json`. They are written by the CLI from the reviewer's own
    output file, never by the developer agent, and signed (D-17).
- **Consequences:**
  - **Honest limit** (as the pilot's README says): a record proves a review ran on this exact
    change, not that the review was good.
  - The records folder is a protected path (D-15) and agents are denied `Edit` on it (D-30). An
    agent change to it parks the ticket.
  - The unit's "done when" includes the full happy path: review PASS → QA written → built → push
    succeeds.

### D-17 · Human-only moves are signed, and given in a real terminal

- **Context:** version 1 relied on `/dev/tty`. But `script -q /dev/null mirai approve …` gives an
  agent a terminal, the run log is a plain file an agent can append to, and an environment flag can
  be unset (R-M1).
- **Decision:**
  - `mirai approve`, `mirai drop`, `mirai unpark` and the production go/no-go are the only paths
    to human-only states. `done` is derived from the merge (D-06), so it isn't a move anyone
    makes.
  - **Approvals and records are signed** with an HMAC key in `~/.config/mirai/`, readable only by
    your user. Agents can't read it: the sandbox `denyRead` and the `Read` deny rules both cover
    it (D-30). Later: SSH signing with per-use confirmation.
  - **`mirai log` refuses privileged event types:** approval, record, gate result, human-only
    status. Those are written only by the commands above.
  - `pre-commit` and CI reject a status change to a human-only state without a matching signed
    approval event.
  - Approvals are given in `mirai inbox` or `mirai approve` in a real terminal (D-34).
- **Consequences:**
  - **Honest restatement:** this resists accidental and casual forgery. Agents run as your own
    user (D7, no container), so the protection is only as strong as the deny rules and the
    sandbox around the key file. A bug there would let a determined agent forge an approval.
    The red-team test in D-30 includes reading the key.
  - You approve from a terminal, not by telling the agent "approved". That is a deliberate bit of
    friction.

### D-18 · The orchestrator is a plain state machine with loop rules, caps and budgets

- **Context:** your main worry is endless agent back-and-forth that burns money (Q5).
- **Options:**
  - **bmad-loop's way:** a deterministic state machine, `max_review_cycles` 3,
    `max_dev_attempts` 2, advisory token budgets, `bypassPermissions`
    (`bmad-loop/docs/reference/configuration.md:84-104`, `data/profiles/claude.toml:5`).
  - **pstack's way:** an LLM coordinator with a ledger (`playbooks/orchestrate.md`).
  - An LLM that decides whether to continue.
- **Decision:** bmad-loop's shape, with:
  - loop rules L1–L8 (`01` §9);
  - a single shared round budget (2 normal / 3 high) across checks, review and QA;
  - hard budgets per ticket and per night;
  - parking instead of retrying;
  - no permission bypass (the strict settings bundle per agent role instead, D-30);
  - one checkout with branch switching, not a worktree per ticket (D-24).
- **The loop guard comes first** (R-C7). It's a shared library built right after the launcher,
  and every fix loop uses it, for documents and for code:
  - round counter, budget ledger, finding fingerprints, a strict-progress check, and a
    parking-note writer;
  - counters are saved to the orchestrator store *before* each launch;
  - **`resume` never resets counters or budgets.** A restart can't grant new rounds (BMAD TEA:
    "a restart cannot grant three more rounds", `run-and-heal.md:28`).
- **The findings schema makes the rules deterministic** (R-M7, `_review/round-1-techlead.md`
  TL-14):
  - each blocking finding carries a `basis.ref` the script can resolve: an AC ID, ADR ID,
    convention rule ID, or a runnable repro command for a "failure";
  - fingerprints use file + symbol, not line numbers;
  - test failures get signatures, and churn is detected by blob hashes;
  - a fixed rule says which findings may still be raised from round 2.
- **Budget ledger** (R-M4):
  - It's kept per ticket and per night, in fixed units: **turns, tokens and minutes** always. A
    **dollar figure is an estimate** from `total_cost_usd` (subscription, section G).
  - **No default numbers until a calibration run.** Version 1's "$2 per S ticket" is withdrawn.
    One healthy build session is about 1–2.5M tokens (bmad-loop's measurement).
  - **The developer session runs the quality gate itself before handing over.** Machine failures
    inside the session don't use a round; only failures after handover do.
  - **Fix rounds resume the developer session** instead of starting a new one.
  - A cost model per track lives in `01`.
- **Environment faults never use rounds** (R-M5):
  - a preflight before each run and each ticket (stack healthy, `claude auth status`, clean tree);
  - a flaky test is re-run once before it counts;
  - API errors are retried with backoff;
  - **a circuit breaker:** N environment faults in a row stop the night with one clear message,
    instead of parking every ticket;
  - **a subscription usage limit** ("session limit" / "weekly limit") **pauses** the run:
    checkpoint, record the reset time, wait, then resume from the checkpoint with the same
    counters (your decision, 2026-10-21). An unknown reset time is probed by one tiny launch every
    30 minutes. A reset after `run.stop_by`, or a weekly limit, stops the run for `mirai resume`
    later. An outer timeout covers indefinite 429 retries (`research/09` §5).
- **Crash safety** (R-M6):
  - a checkpoint git ref before each step, so "redo" means a reset to it;
  - a run lock in the orchestrator store;
  - idempotent MR creation (check whether the MR already exists);
  - `caffeinate` on macOS during runs.
- **Consequences:**
  - Some tickets park that a human would push through. That's the intended trade.
  - The cap values are config, tuned from metrics after calibration.
  - A usage limit can make the night shorter or push work past `run.stop_by`. The morning report
    lists every pause and its reset time.

### D-19 · Templates use our own wording on proven structures

- **Context:** licensing (`research/07-doc-templates.md` §1):
  - MADR is MIT/CC0, Nygard is CC0, Rust RFC is Apache/MIT, C4 is CC BY.
  - arc42 is CC BY-SA, so copied text would force ShareAlike on MIRAI.
  - The PRD templates and the Google design doc have no license.
- **Decision:**
  - **ADR:** MADR 4.0.0 structure. Its text may be reused.
  - **HLD:** arc42 order and C4 diagrams, in our own wording, merged with the pilot's 16 sections.
  - **LLD:** Google design-doc shape plus the Rust RFC add-ons.
  - **PRD:** Yien's structure plus HashiCorp-style acceptance criteria per requirement, with BMAD's
    PRD discipline.
  - **Business brief:** Lenny's 1-pager shape.
- **Consequences:** writing our own templates is a unit of work each, but it keeps MIRAI's license
  clean.

### D-20 · An existing project convention beats the MIRAI default

- **Decision:** if a project already has ADRs, HLDs or tickets, MIRAI matches their location,
  numbering, file pattern and headings. Addy: "An established convention overrides the defaults"
  (`documentation-and-adrs/SKILL.md:36-44`). Conflicting evidence is surfaced, not resolved
  silently.
- **Consequences:** templates need a mapping step at setup. The pilot's `docs_old/decisions/`
  numbering continues.

### D-21 · Sync-back: the lock-hash boundary, a leak scanner, and a PR

- **Context:** no prior art pushes improvements upstream (`research/05` #42).
- **Decision** (Q9):
  - `mirai contribute` reads only files listed in `mirai.lock` whose hash changed.
  - It runs the leak scanner, shows the cleaned diff plus a neutral explanation, and opens a
    branch and PR on the MIRAI repo (a fork for non-owners).
  - It never pushes to main and never runs automatically.
  - **The leak scanner isn't trusted alone** (R-M14):
    - it also scans the final PR title, body and commit messages, *after* the explanation is
      written;
    - the contribution branch is built fresh from upstream, never from project history, with a
      neutral git identity;
    - generic detectors (emails, URLs, ticket-key patterns, capitalized proper nouns not found in
      the upstream repo) run alongside the setup-time block list;
    - you read the final diff every time.
  - **The lock also lists the generated tool files** (R-M13), so edits to them are detected.
    Updates use a 3-way merge with the base taken from the pinned package version. Config and
    state schemas are versioned, with deterministic migration scripts, not LLM prose.
- **Consequences:**
  - A project improvement made through `.mirai/custom/` overrides is *not* picked up until
    `mirai promote` moves it into a framework path (R-M13). That keeps the boundary strict.
  - Custom overrides reach agents by being rendered into the launch bundle with BMAD's merge
    rules, as a content-hashed snapshot (`render_skill.py`).

### D-22 · Agents never merge and never release to production

- **Decision** (Q5, D2):
  - Merge and production deploy are always human. That includes merging a ticket MR into an
    epic's `feature/<epic>` branch (D-33). Nothing merges without your consent.
  - The orchestrator pushes and opens MRs. Agents themselves never get push credentials (D-30).
  - This is revisited only once the trust metrics are good enough. Any change would be a new
    decision.
- **Consequences:** overnight output is "MRs ready for review", not shipped features.

### D-23 · TDD is the default, with recorded red evidence

- **Decision:**
  - For behavior changes, the failing test run is recorded before the fix (Addy's red-green and
    prove-it patterns).
  - **Red evidence is produced by the orchestrator, not reported by the agent** (R-M8). It runs
    the new or changed tests against `baseline_revision`, and they must fail there. That run is
    the evidence for M15.
  - Tests carry the AC IDs they cover (D-35).
  - `no-test: <reason>` is allowed for non-behavior rows and shown to the reviewer.
  - **Later:** acceptance tests written by a separate agent from the plan (TEA ATDD idea,
    `research/05` #23).
- **Consequences:** M15 (TDD discipline) is measurable from the start.

### D-24 · Sequential first, parallel later

- **Context:** Lauren: earn trust before parallelism (`research/01` Lauren section).
- **Context:** worktrees break on the pilot (R-C5). Its compose file has a fixed project name,
  mounts `./backend` relative to the checkout and uses fixed ports. So checks started from a
  worktree **test the main checkout** (false green), and the gitignored `backend/.env` is missing
  there.
- **Decision:**
  - **The MVP orchestrator runs one ticket at a time in one checkout, switching branches.**
  - A pre-step guard checks: clean tree, right branch, stack healthy.
  - Setup detects "toolchain bound to the checkout path" and records `worktree_safe = false`.
    `doctor` proves the gate sees a marker change.
  - **Stacking within one epic** (D2): a ticket whose dependency's MR is open but not merged
    starts from the dependency's branch.
    - Its MR targets the dependency's branch, so it shows only its own diff.
    - It's limited to **depth 2** (A → B → C) and to one epic.
    - When the parent merges, the orchestrator rebases the child onto the new base and re-runs
      the quality gate. With patch-id records (D-16), a clean rebase keeps the review.
    - Changes requested on the parent mark the child "waiting on parent". A rebase conflict
      parks it.
  - `mirai run --plan` previews what tonight can do.
  - **Parallel lanes** come only after the loop metrics are stable. They bring back worktrees (or
    isolated compose projects) with `seed_files`, the Architect's shape from R-C5.
- **Consequences:**
  - One ticket at a time is slower, but a green check means green on the code under test.
  - A stacked child can need a second look after its parent changes.

### D-25 · Local first

- **Decision:** overnight runs happen on your machine, through your tools' headless modes. There
  are no cloud agents in the MVP (Lauren: local before cloud; pstack `docs/guide/07-overnight.md`).
- **Note:** this replaces `research/05` row 53 ("no unattended loops"). Q5 brought unattended runs
  into scope, with the limits above.

### D-26 · Context is small verified blocks, not generated documentation

- **Decision:** follow `bmad-project-context` (`research/02` §3.6):
  - every claim is path-checked;
  - nothing derivable from the source is stored;
  - prefer a lint or hook to prose.
- **What we added:** a business-context file and the feature map.

### D-27 · Prior art is reused as logic, not as a runtime dependency

- **Decision:**
  - No BMAD or pstack install is required at runtime. BMAD v7 is still preview with breaking
    changes (`research/02` X1).
  - **One vendoring policy** (replaces the conflicting lines between this decision and
    `research/06b`):
    - external *logic* is rewritten in our words, with the source credited in the skill;
    - external *files* are vendored only after vetting, as a pinned copy under
      `.mirai/framework/vendor/`;
    - each vendored file has an entry in `vendor/PROVENANCE.json`: source URL, author, license,
      pinned commit, the vetting entry in `research/06-skill-vetting.md`, and the file hash.
  - Today the only vendored file is a reviewed, pinned copy of `blader-humanizer` (approved in
    `research/06`).
  - Every future external skill goes through the vetting gate (D-31).

### D-28 · Pilot: a clean branch from main; MIRAI replaces the council and BMAD there

- **Decision** (Q10):
  - The pilot branch is `mirai/pilot`, cut from `main`.
  - The council's gate logic is ported into MIRAI's hooks.
  - BMAD's install is not carried over.
  - Nothing happens before "APPROVED: start implementation", and your BKT-48 work must be
    committed or stashed first.

### D-29 · What gets committed

- **Committed (branch-carried facts, D-06):** documents, signed approval events, immutable records,
  pointers, config, context, generated tool files, and the run-log lines exported into the MR at
  ship time.
- **Never committed:** the orchestrator store (`<git-common-dir>/mirai/`: run progress, counters,
  ledger, parking notes, trust-root snapshots, full run logs), `config.user.toml`, the
  external-doc cache, full agent transcripts, and QA evidence over the size cap.
- **Reason:**
  - CI and metrics need only the exported lines.
  - Live state on branches caused the conflicts in R-C4.
  - Transcripts are large and may hold sensitive output.
- **Consequences:**
  - Exported lines must stay small. The schema caps free-text fields.
  - Every log line carries `{schema_version, run_id, seq, ts, item, by}`, with an ordering rule
    and a compaction rule.
  - QA evidence lives per ticket under the orchestrator store and is size-capped. Screenshots are
    referenced, not inlined.

### D-30 · Strict blocking rules for every agent run (no container for Claude Code)

- **Context:**
  - An unattended agent with shell access is the riskiest part of MIRAI. Any allowed test
    command runs code the agent itself wrote (R-C3).
  - bmad-loop uses `bypassPermissions` (`data/profiles/claude.toml:5`). snarktank's `ralph.sh`
    uses Claude Code's permission-skipping flag (`research/06b-skill-sweep.md`).
  - **Your decision (D7):** no container for Claude Code. Projects run in their own Docker
    containers. Claude Code runs on the host under strict rules that **block**, not advise:
    - never reveal API keys;
    - never push passwords or secrets;
    - never read or search outside the project without your approval.
- **Options:**
  1. A container or VM per run (the round-1 recommendation). Rejected by you.
  2. A dedicated macOS user.
  3. Rules in prompts only. They don't block, so this isn't an option.
  4. **Layered blocking rules using what Claude Code enforces** (`research/09` §1–§4).
- **Decision:** option 4. Each layer covers a gap in the one before it (`research/09` §7):
  1. **Agent-written code never runs on the host.** Every test runs inside the project's own
     containers, through one fixed wrapper: `mirai exec test <suite>`.
     - It takes a suite name from config and no free-form arguments.
     - It's the **only** `excludedCommands` entry.
     - Agents never run `docker` themselves (docker access is root-equivalent). The orchestrator
       starts the stack.
     - `doctor` checks that the compose file mounts neither your home folder nor the docker
       socket.
  2. **The OS sandbox is on, with no escape.**
     - `sandbox.enabled: true` and `allowUnsandboxedCommands: false`.
     - `denyRead` on your home folder, with `allowRead` only for the project and the toolchain
       caches. This covers `~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.config/mirai` (the signing
       key) and other projects.
     - `network.strictAllowlist` with only the package registries and the model API.
     - The sandbox is the only layer that covers child processes, `grep -r`, `sh -c` and
       path-qualified binaries.
  3. **Permission deny rules** for the file tools, which run outside the sandbox:
     - `Read(...)` and `Edit(...)` outside the project;
     - `Read` and `Edit` of `.env*` files; `Edit` of the records folder (D-16);
     - `Bash(git push *)`, `Bash(gh *)`, `Bash(docker *)`, `Bash(env)`, `Bash(printenv *)`.
     - In headless runs, `dontAsk` turns anything else that would prompt into a deny. In your
       interactive sessions the same "outside the project" rules are `ask`, so you can approve
       them case by case. That's your "not without my approval".
  4. **Hooks** (PreToolUse, exit 2 blocks), loaded from the trust root:
     - secret patterns in Write/Edit content;
     - Glob/Grep paths outside the project, which permission rules ignore.
  5. **A branch can't loosen the rules.** All of the above ships as the **strict settings
     bundle** `<trust-root>/strict.json`, passed with `--settings` and
     `--setting-sources user --strict-mcp-config` (D-12). Project and local settings never load.
     - **Optional, recommended for overnight:** setup offers to install
       `/Library/Application Support/ClaudeCode/managed-settings.json` with the managed-only
       locks (`allowManagedPermissionRulesOnly`, `allowManagedHooksOnly`,
       `disableBypassPermissionsMode`). It needs admin rights and your approval.
  6. **Credentials stay with the orchestrator.** Agents never get push credentials or the `gh`
     token. The orchestrator commits, pushes and opens MRs. The environment is scrubbed except
     `CLAUDE_CODE_OAUTH_TOKEN`.
  7. **Secrets can't reach a commit.** `pre-push` runs a secret scan that blocks, and CI runs it
     again.
  8. **Limits:** an outer `timeout` on every launch, `--max-turns`, and the budget ledger (D-18).
  9. **Text from connectors and web pages is fenced as untrusted data** in every prompt.
  - **Never used:** any permission-bypass or sandbox-off flag.
  - **Codex and Cursor** (from Milestone D): Codex `exec --sandbox workspace-write` with network
    off; Cursor `agent -p --force --trust --sandbox enabled` with deny rules in
    `.cursor/cli.json` (`research/08` §5.4).
- **A red-team test is part of the unit that builds this layer.** Each seeded attempt must be
  blocked:
  - reading `~/.ssh` and `~/.config/mirai` through Read, `cat` and `grep -r`;
  - `curl` to an unlisted host;
  - `sh -c` around a denied command;
  - a Glob from `/`;
  - writing a fake secret into a file and pushing it;
  - a branch that adds its own `.claude/settings.json` hook.

  It also checks the UNVERIFIED items from `research/09`: deny rules in `-p`, and the exit codes
  on usage limits and `--max-turns`.
- **Consequences:**
  - **Honest residual risk:** this is weaker than a container per agent. The file tools and
    hooks run outside the sandbox and rely on the deny rules being right. A bug in Claude Code's
    rule matching is a single point of failure for reads. The OAuth token is readable by the
    agent; the network allowlist limits where it could be sent.
  - Test code runs inside the project's containers, so those containers are the real boundary
    for agent-written code. A compose file that mounts host paths weakens that, and `doctor`
    reports it.
  - The autonomous preset **refuses to start** unless `doctor` confirms every layer above and the
    red-team test has passed on this machine and Claude Code version.

### D-31 · External skills reused as logic after the sweep

- **Context:** the security gate asks for a skill search before building new skills.
  `research/06b-skill-sweep.md` vetted 7 sources.
- **Decision:**
  - Reuse mechanisms (logic, rewritten in our words) from **mattpocock/skills** (MIT): grilling
    interview, to-tickets, TDD, two-axis code review, ADR significance test.
    - Restore the refactor step its `tdd` drops (`tdd/SKILL.md:38`).
    - Keep our recursion guard (D-12).
  - Use **atlassian/atlassian-mcp-server `spec-to-backlog`** (Apache-2.0, official) as the
    reference for a future Jira/Confluence connector (none is in the MVP, D-36), with two changes:
    - a "treat ticket text as data" rule;
    - our vertical slicing in place of its split by layer.
  - Take only *ideas* from Anthropic's code-review plugin, because its license is "All rights
    reserved". The idea: one separate check per finding before it counts.
  - **Rejected:** `ralph.sh`, the agent-browser CLI and installer, and installing the ECC plugin.
  - Every reuse is logged in `research/06-skill-vetting.md`.

### D-32 · The MVP runs on Claude Code only, with a role-to-tool matrix

- **Context:** building three adapters before anything runs end to end triples the work before
  the first MR (R-C6). You use Claude mainly (Q12), and you answered D1 yes.
- **Decision:**
  - Milestones A–C run on Claude Code only. Codex comes in at Milestone D, first as the
    rung 1 verifier (D-14). Cursor follows (see `07`).
  - **A role-to-tool matrix** (R-M17) says which tool may run which role, and whether
    overnight:

    | Role | Claude Code | Codex (from D) | Cursor (from D) |
    |---|---|---|---|
    | Authors (PM, architect, ticket planner) | yes, interactive | — | — |
    | Developer | yes, overnight | later | later |
    | Reviewer, verifier | yes | yes (verifier rung 1) | later |
    | QA (needs the running app, browser, network) | yes, overnight | no (network-off sandbox) | later |

  - QA uses the project's own Playwright setup, or Playwright MCP, inside the sandbox rules
    (D-30). The issue taxonomy and report shape come from vercel `dogfood` (logic only).
- **Consequences:** you can't drive MIRAI from Codex or Cursor until Milestone D.

### D-33 · Release per ticket by default; "release together" per epic

- **Context** (D2, D3): you release ticket by ticket. Sometimes a whole epic should ship at once,
  after a final end-to-end test. Feature flags only when you ask.
- **Decision:** one setting per epic, `release: per-ticket | together`.
  - **`per-ticket` (the default):**
    - each ticket's MR targets `main` (or its stacked parent, D-24);
    - after you merge it, the release stage runs for that ticket: deploy, smoke check, and your
      go/no-go for production.
  - **`together`:**
    - MIRAI creates `feature/<epic>` from `main`;
    - ticket MRs target `feature/<epic>`. You approve every merge into it, and `mirai inbox`
      allows batching;
    - when all tickets are in, the QA agent runs a **final E2E test** of all the epic's ACs on
      `feature/<epic>`, in the project's containers;
    - then there's one MR from `feature/<epic>` to `main` and one release.
  - **Feature flags** are added only when you ask for one, written into that ticket's plan.
  - Stacking (D-24) works the same in both modes, with depth 2 inside the epic.
  - Projects without staging: the release stage is the record plus your go/no-go.
- **Consequences:**
  - `together` keeps `main` clean but delays feedback. The final E2E is one more QA run per epic.
  - The release stage is in MVP-complete (see `07`).

### D-34 · Every document needs your final approval; approvals go through `mirai inbox`

- **Context:**
  - A wrong PRD spreads into every ticket, and documents have no objective test (D6).
  - Supervised mode as designed needed about 32 terminal approvals per 7-ticket feature, which
    invites rubber-stamping (R-M2).
- **Decision:**
  - The brief, PRD, ADRs, HLD, LLD and the ticket set always need **your** approval, in every
    preset. The verifier still reviews each one first (D-10).
  - **Overnight runs cover the build loop only,** for tickets from an approved set.
  - **`mirai inbox`**, in a real terminal: one screen with everything waiting for you, with batch
    approval of plans from a short review packet.
  - The push and MR gates merge into one `ship` gate.
  - **`mirai unpark <ticket>`** resolves a parked ticket and needs a note on what you changed.
  - `approve` asks "accepted as is / edited / rejected" (the M6 label, D-38).
- **Consequences:** one touchpoint per feature before overnight builds. Fewer, richer approvals
  instead of many thin ones.

### D-35 · One ID chain from requirement to evidence; `mirai trace`

- **Context:** version 1 broke the SDD chain (R-M10): the PRD used `AC-FR-n.m` and tickets used
  local `AC-n`; closure was checked only for FRs; tests carried no AC IDs.
- **Decision:**
  - **The chain:** `BR → FR/NFR → AC-FR-n.m → ticket covers AC IDs → tests tagged with AC IDs →
    QA evidence per AC ID`.
  - Quick-track tickets mint `AC-<ticket>.n`.
  - **`mirai trace`** (a lint) checks the whole chain: every AC covered by a ticket, every ticket
    AC covered by a test, every AC with evidence. It reuses BMAD TEA's trace step (logic).
  - An ADR's "Confirmation" names a check ID, and `mirai trace` verifies that the check exists.
- **Consequences:** M8 is computed, not self-reported. Authors carry more IDs.

### D-36 · Connectors: one contract, CLI for actions, MCP for reading; none external in the MVP

- **Context:**
  - Version 1 didn't say whether the CLI or an agent runs a connector (R-M15).
  - Your projects don't have one tool yet. ClickUp (personal), Jira (work) and Linear (one
    project) are candidates (D4).
- **Decision:**
  - **One connector contract:** verbs `setup`, `write`, `read`, `query`, a status map, and a proof
    step at setup.
  - **Deterministic actions run in the CLI** through official CLIs or REST: status mirror,
    publish, merge detection.
  - **MCP is only for reading inside an agent session.**
  - **Credentials come from the tool's own login** (`gh`, `acli`, …) and are never stored by
    MIRAI.
  - **The MVP ships the `repo` store and the git host (GitHub) only.** The first external
    connector is chosen when you pick a tool, and is written against the contract without
    changing any workflow.
- **Consequences:** no ClickUp, Jira or Linear in the MVP.

### D-37 · Extension points are data with a schema

- **Decision** (R-M16): every extension point is a definition file checked against a schema:
  - **tool adapters:** a profile file per tool (bmad-loop `data/profiles/*.toml`);
  - **connectors:** the D-36 contract;
  - **document types:** template + checklist + lint rules + state machine;
  - **agents:** role, `may write` scope, allowed tools, model role.
- **Consequences:** Codex, Cursor and a first connector plug in as data plus a small adapter, not
  as code changes across the CLI.

### D-38 · MVP success and kill criteria

- **Context:** there was no way to tell whether MIRAI works (R-M19).
- **Decision:**
  - **Success, measured after 20 pilot tickets.** The exact numbers are set after calibration
    (D-18):
    - median cost per ticket under the target;
    - under 20% of tickets parked;
    - zero escapes on high-risk tickets;
    - your review time per MR under 15 minutes.
  - **Kill/rethink trigger:** if those targets are missed after 20 tickets, stop adding units and
    revisit the design.
  - **Metrics:** report M1, M3, M4 and M6 first (R-M18). Log every raw field from day one.
    - Capture points: the `approve` label, `mirai escape <ticket>` for a bug found after PASS,
      dispute outcomes in `mirai inbox`.
    - M9 comes from CI and host-API data.
  - **Reuse test** (R-M20): the MVP ends by installing MIRAI on a second personal project with a
    different stack and running one quick-track ticket.

### D-39 · The debugger agent and the "council" pattern are deferred

- **Decision:** loop rules L1–L8 and the review stage replace the pilot's council in the MVP. A
  debugger agent comes later (`03` §4). Recorded because round 1 noticed the deferral wasn't
  written down.

### D-40 · Parser policy

- **Context:** zero dependencies (D-04) means hand-written parsers (R-Minor).
- **Decision:**
  - **JSON for every machine-written file:** state, records, ledger, run logs (JSON lines).
  - Human-edited TOML and YAML frontmatter use a **written subset grammar** with a test corpus.
    Anything outside it is rejected loudly, never guessed.
  - The Mermaid check is "fenced + diagram keyword + balanced brackets". A real parse would need
    a dependency.
