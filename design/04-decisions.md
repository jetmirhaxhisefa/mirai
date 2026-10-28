---
status: draft
version: 5
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

**Version 3** applies the follow-up discussion (`08-followup-discussion.md`, Q1–Q9). Rewritten:
D-14, D-23, D-29. Updated: D-06, D-12, D-15, D-16, D-18, D-19, D-20, D-26, D-32, D-33, D-37. New:
D-41 to D-46.

**Version 4** applies review round 2 (`06-review-round-2.md`, decisions U1–U5 in its section G).
Rewritten: D-06, D-07, D-12, D-15, D-16, D-17, D-24, D-29, D-30, D-34, D-35, D-38. Updated: D-14,
D-18, D-21, D-23, D-28, D-32, D-33, D-36, D-37, D-41, D-42, D-44, D-45, D-46. New: D-47 to D-52.

**Version 5** applies review round 3 (`06-review-round-3.md`, section B, with your decisions V1–V3
in its section D: V1 = keep D7 as is, V2 = no further design review, V3 = the orchestrator merges
the docs MR). Rewritten: D-30. Updated in place: D-06, D-07, D-12, D-15, D-16, D-17, D-22, D-24,
D-28, D-29, D-34, D-37, D-38, D-47, D-48, D-49, D-50. New: D-53 to D-56. Everywhere, "`main`"
now means **the integration branch**, `[git] integration_branch` (D-15).

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
  - **The `mirai` on your PATH is the launcher** (`bin/launch.js`, unit 12b): it runs the repo's
    pinned copy, only when that copy is the integration branch's or the launcher's own; `init`
    and `update` run the launcher's own code. Hooks, CI and the broker never go through it: they
    call the trust-root copy directly (`node <trust-root>/tree/.mirai/framework/bin/mirai.js`,
    D-15). `npx` is used
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
  - Version 2 put the store under `<project>/.git/`, inside the agent's reach (R2-C1). Fixed in
    version 4.
- **Options:**
  - State in the chat session: lost on compaction.
  - **BMAD way:** state in plan frontmatter plus the memlog.
  - State in Jira: the gate and resume would depend on an API.
  - Everything committed on some branch: invisible to `resume` on other branches, or a direct
    commit to `main`.
- **Decision:**
  1. **Branch-carried facts** travel with the MR: document content and versions, signed approval
     events, and the small signed proof records (D-16). The review and QA *text* is not
     committed (D-29).
  2. **Machine-local operational state** lives in the **orchestrator store**, **outside the
     project**, at `~/Library/Application Support/mirai/<repo-id>/` (D-47):
     - run progress and the run state (`running → paused → stopped | finished`, D-07), round
       counters, budget ledger, parking notes, the run lock, the trust root, hooks, reports and
       the per-ticket work files;
     - denied to agents by the sandbox and the permission rules (D-30);
     - never committed, and no run-log lines are exported into MRs (D-29, Q9);
     - in a multi-repo workspace (D-42), the store belongs to the workspace repo's `<repo-id>`;
     - modeled on bmad-loop's `state.json` + `journal.jsonl` + `heartbeat.json`.
  3. **Ticket status has exactly one home** (R2-M5, R3-M12, AR3-7). This rule is copied verbatim
     into D-07, `01` §12, `02` (h) and `03`:
     - the ticket's **content** and its signed approval are committed;
     - **all** ticket status lives in `<store>/tickets/<t>/status.json`. Ticket files have no
       `status` field in frontmatter (the lint enforces it). `dropped` is a signed human event in
       the store journal;
     - with a tracker, the store stays the authority and the tracker is a **one-way mirror**
       (D-36);
     - **derived facts are timestamped observations:** the orchestrator logs `mr_opened(head)`,
       `mr_merged(target)` and `mr_closed` as journal events with a `seq`;
     - **precedence:** merged into the integration branch → `done`, and merged into
       `feature/<epic>` → `integrated`, always win (terminal). Otherwise the latest event by `seq`
       wins. `built` holds only while the open MR's head equals the head the orchestrator shipped.
  4. **Documents reach the integration branch through a docs MR.** After your signed ticket-set
     approval, the **orchestrator merges the docs MR** (V3, D-56); documents only, never code.
     Nothing else commits to the integration branch without your merge.
  5. **Write paths** (R3-M12, AR3-9). Each artifact has one writer:

     | Artifact | Writer | Where |
     |---|---|---|
     | Ticket code commits | the orchestrator (D-50) | the ticket branch |
     | Documents, document approvals | the CLI (`mirai approve`, `mirai session end`), with a `Mirai-Docs: <initiative>` trailer, through `git commit-tree` on the docs branch; your checkout is never switched | the docs branch |
     | `branch.json`, `handover.json`, proofs, gate-result records | the CLI, signed | `.mirai/records/<ticket>/` on the ticket branch |
     | Approvals of plans, unpark, round grants, go/no-go | the CLI, signed for audit | the store journal |
     | Status, counters, ledger, work files | the orchestrator | the store |

     A **checkout lock** covers `mirai run` and `mirai session`: a session refuses to start while
     a run holds the checkout, and the reverse.
  6. **One source of truth per artifact type** (D5): each type is `repo` or `external:<tool>`.
     - Different types may live in different tools, e.g. tickets in Jira and docs in Confluence.
     - The same document never lives in two places. There is no sync and no `both` mode.
     - `repo` is forced when no tool is connected.
  7. **Control data never depends on an external API.** That covers proofs, pointers and the
     orchestrator store. The gate and `mirai resume` work offline. Tracker status is advisory
     (D-36).
- **Consequences:**
  - In `external` mode agents read from a version-tagged local cache (in the store), and a pointer
    file holds the id, url, version and status.
  - Status edits on two branches can't conflict, because operational state isn't on any branch.
  - **The MVP assumes one machine** (D-52). Losing the machine loses run progress but not the
    work itself: branches, MRs and proofs survive. `resume` rebuilds what it can from git and the
    host.

### D-07 · One status vocabulary for every document

- **Context:** BMAD has none shared: PRD draft/final, plan 8 states, research complete, TEA
  `workflowStatus` (`research/02` X5). The pilot's templates disagree with each other.
- **Decision:**
  - **Documents:** `draft → in-review → changes-requested → approved → superseded`, plus
    `dropped` and `obsolete` (retired with no replacement; excluded from agent context, D-46).
  - **Tickets:** status lives only in the store (D-06 point 3, copied verbatim there). BMAD's
    plan states, with `blocked` carrying a required `park_reason`, plus
    **`waiting`** (a stacked child whose parent changed, or a cross-repo dependency) and
    **`integrated`** (merged into `feature/<epic>`, derived, D-06). `integrated` counts as done
    for the `after` rule inside a `release: together` epic, so the next ticket can start
    (R2-M5).
  - **Release records:** `pending → [staging → verified] → approved → deployed → live | rolled-back`. The bracketed steps exist only when the project has staging
    (R2 Minor). `approved` is your production go/no-go, so it always comes before the production
    deploy.
  - **Runs:** `running → paused → stopped | finished`. `paused` = waiting for a usage-limit reset
    (D-18); `stopped` = cut-off, circuit breaker or weekly limit, resumable with `mirai resume`.
  - One transition table marks the human-only moves. It includes the moves added in round 1
    (R-M12): MR comments or red CI → `in-progress` with a round budget you grant; MR closed
    unmerged → `dropped` or `ready-for-dev`; plan rejected → re-plan; at most one re-plan after
    `bad_plan`. `mirai unpark` offers three choices: re-plan, retry, drop (R2-M3).
  - **For documents, frontmatter is the current state; the run log is history** (R-M11).
    `mirai status` treats a mismatch as an error. Tickets have no status in frontmatter (D-06).
  - **Release export:** the git tag or host release is written only at a terminal state (`live`
    or `rolled-back`), because a tag annotation can't follow state changes (AR3-14).
  - **An approved version is frozen, and the freeze is checkable.** The signed approval holds
    the document's content hash (D-17), so an edit after approval is detected. A new draft lives
    beside it (`prd.md` stays the approved v1; `prd.v2.draft.md` is the draft) and replaces it
    only on approval. Agents always read the approved version.
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
    `session_start` / `session_end` on the **MIRAI MCP broker** (D-53), which give it a run id
    (R-M3). Its `.claude/` files are rendered from the same launch bundle, so custom overrides
    apply there too (R2-M12).
  - **No sandboxed process calls `mirai`** (R3-C3, AR3-2). A workflow skill in your session, or
    an agent, reaches MIRAI only through the broker's narrow verbs (`start_agent`,
    `agent_status`, `session_start`/`session_end`, `log_event`, `lint`, `trace`). The plain
    `mirai` binary is for your terminal and the orchestrator. A `mirai agent run` from Bash fails
    (red-team, D-30).
  - **An explicit launch bundle per launch,** built from the trust root (D-15, D-47), never from
    the working copy:
    - the plugin dir with MIRAI's skills and agents;
    - the system prompt file;
    - the strict settings bundle (`strict.json`, D-30);
    - the MCP config: headless runs get only `run_tests` (D-48) and the broker's `log_event`;
      never `start_agent`, so the recursion guard holds by construction (D-53).
  - **The trust root is re-hashed before every launch,** not only at run start (R2-C1). A
    mismatch stops the run.
  - **Detach-and-wait for supervised launches** goes through the broker: `start_agent` returns an
    id, and the session polls `agent_status(id)`. The session never reads the store. That avoids
    the tool's shell timeout (Claude's Bash tool: 10 min max; agent runs: up to 45 min).
  - **Work-file exchange** (R3-C3, AR3-3). Agents never read or write the store:
    - **Inputs are injected.** Per launch, the launcher renders a **read-only input folder**
      outside the project (`<mirai-home>/<repo-id>/input/<launch>/`) holding the plan (frozen
      block plus agent sections), the delta diff, this round's findings and the ACs. Only that
      launch gets a sandbox `allowRead` on it, and it's deleted after the run.
    - **Outputs come back as structured output only:** the plan's agent sections, finding
      replies (`fixed | disputed`), `template_gap`, Ivy's QA table. The CLI writes them into the
      store and re-checks the plan's frozen-block hash on every write.
    - Ivy's scratch scripts go to `run_tests` as content, and evidence comes back inline (D-48).
  - **Reviewers read a clean export** (R3-M9). Rex, Ivy and Vera run with cwd on a read-only
    export of the committed head, outside the store, in which every instruction file and tool
    folder (`CLAUDE.md` and its `@` imports, `CLAUDE.local.md`, `AGENTS.md`, `.claude/`) is
    replaced by the **integration branch's** version.
  - **Process groups** (R3-M8). Each agent starts in its own process group. After exit the
    launcher kills the group and checks that nothing from it survives; a survivor fails the run.
  - **Read-only roles are read-only by the sandbox** (TL3-23): per-role `strict.json`, with
    sandbox `denyWrite` on the project for Rex and Vera.
  - **Verdicts come from structured output.** The launcher captures the agent's final JSON
    (`--json-schema` / `--output-format stream-json`) and stores it in the store. No verdict is
    ever read from a file in the work tree (R2-C1).
  - **The environment is an allowlist** (R3-M13, TL3-15): `PATH`, `HOME`, `LANG`, `TERM`,
    `GIT_OPTIONAL_LOCKS=0` and the token; nothing else is passed. Every launch's `stream-json`
    init event is checked for `apiKeySource`/auth, not only preflight.
  - **Write-scope check.** After every run the changed files are compared against the role's
    `may write` scope (`03` §4). A violation fails the run. Writes to `.git/**` are denied up
    front (D-30), so the check covers the work tree.
  - **Native subagents are denied** in headless runs (the Task/Agent tool), because they would
    bypass the launcher's budgets, log and recursion guard (R2-M10). They can come later as an
    optimization behind the same CLI.
- **Claude Code invocation (subscription only, section G of `06-review-round-1.md`):**
  - `--bare` is **out**: it skips the OAuth token, so it can't use a subscription
    (`research/09` §4).
  - **No user, project or local settings load** (R2-M10). `--setting-sources user` still loads
    your user settings, whose `env` could re-inject an API key and silently switch to API
    billing. The launcher therefore uses `--restricted` with only `--settings
    <trust-root>/strict.json` and the tools it names in `--tools`. **Fallback, if `--restricted`
    doesn't fit:** `CLAUDE_CONFIG_DIR=<mirai-home>/claude-home`, which isolates user settings,
    user memory (`~/.claude/CLAUDE.md`) and user skills at once, plus a source list without
    `user`. Both are UNVERIFIED and must be tested before they're relied on (`research/09` §8,
    G10).
  - The rest: `claude -p … --settings <trust-root>/strict.json --strict-mcp-config --mcp-config
    <trust-root>/mcp.json --permission-mode dontAsk --permission-prompts none --max-turns N
    --output-format stream-json`.
  - **Auth:** `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` (one-year token). The launcher
    unsets `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`, because in `-p` an API key beats the
    token (`research/09` §5). Preflight runs `claude auth status` and expects
    `authMethod: oauth_token`.
- **Consequences:**
  - One logging point, one budget point, one model-choice point: the launcher picks the model
    tier for each step (D-14) and logs `tier` and `model` on every run.
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
  - An agent started by the launcher can't start another one. Headless runs have no
    `start_agent` verb and `Bash(claude *)` is denied (D-30).
  - **The guard is a launch token held inside the broker or the orchestrator,** never shown to a
    session or an agent (R-M1, TL3-8). `mirai agent run` needs a valid one-time token, minted and
    consumed inside the broker (for your session) or the orchestrator.
  - **The real rule** (version 2 wrongly claimed "agents can't read the store" while the store
    sat inside the project): the store is outside the project (D-47), and agents are denied it by
    the sandbox `denyRead`/`denyWrite` and by `Read`/`Edit` deny rules (D-30). So an agent can't
    read or mint a token. The red-team test checks this (D-30).
  - Only workflow skills in your session and the orchestrator launch agents; native subagents
    are denied (above).

### D-13 · One verifier agent with a checklist per document type

- **Options:** one verifier per document type (PRD verifier, design verifier, ticket verifier) vs
  one verifier with checklists.
- **Decision:** one verifier (Vera). Expertise lives in the checklists. Metrics are still split per
  stage. The verifier reviews every document, but final approval is always yours (D-34).
- **Consequences:** if metrics show it's weak on one type, that type gets its own agent. This
  choice is reversible.

### D-14 · Model selection: tiers per step, plus the verifier ladder

- **Context:**
  - Version 2 had a "model role" per agent and a verifier ladder, but no rule for picking a cheap
    or strong model per task (`08` Q5).
  - Simple work (writing an MR description from known facts) doesn't need the strongest model,
    and on a subscription smaller models use the usage limit more slowly.
- **Decision: four tiers, the cheapest first** (Q5):

  | Tier | Runs | Used for |
  |---|---|---|
  | 0 · No AI | a script | Anything where the data already exists: publishing an approved ticket to a tracker, status changes, MR creation, the report skeleton, lints |
  | 1 · Light | small model (e.g. Haiku) | Rewording with all facts given: commit messages, MR descriptions, report summary, parking-note wording, short summaries |
  | 2 · Standard | mid model (e.g. Sonnet) | Developer on S/M tickets, ticket planner, plans, QA, quick reviews, document verification |
  | 3 · Deep | strongest model (e.g. Opus) | PRD writing, architecture/HLD/ADRs, high-risk reviews, L tickets, re-planning after failure |

  1. **Tiers are names, not model IDs.** The config maps `light / standard / deep` to models, so
     a new model is a one-line change.
  2. **Defaults per step, raised by risk and size.** High-risk or L work moves up a tier.
     Judgement steps are never downgraded: PRD and design work, high-risk reviews.
  3. **Escalate once, for light steps only** (R2-M9). A tier-1 (light) step that fails its check
     twice is retried once on the next tier up. Light steps sit outside the review rounds, so this
     never collides with loop rule L4 or the round caps. Standard and deep steps don't escalate;
     they follow the loop rules.
  4. **Measured, not assumed.** Every run logs `tier` and `model`. The calibration run (D-18)
     sets the per-step defaults, because a cheap model that causes extra rounds costs more.
- **The verifier ladder** (Q12) still decides *which* model verifies. The verifier differs from
  the author **where possible** (R2-M9; "always" made deep high-risk reviews impossible on Claude
  only):
  1. A different model family, if configured.
  2. Otherwise a different Claude model of a comparable tier (e.g. Fable vs Opus, your Q12 idea).
  3. Otherwise the same model, in fresh context, with a different checklist, logged as such.

  The rung used is logged on every run.
- **How rung 1 works in practice** (`research/08` §5.3):
  - Claude Code runs Claude models only. Codex only takes providers that speak OpenAI's Responses
    API. Only Cursor mixes model families inside one tool.
  - So a different family usually means **the launcher starts the other tool**. For example, Claude
    authors and `codex exec` verifies.
  - Rung 1 is only available when a second tool is installed and logged in. `doctor` reports which
    rungs exist.
  - **In the MVP (Claude Code only, D1)** the ladder starts at rung 2. Codex is the first rung 1
    added, in Milestone D (see `07`).
- **Consequences:**
  - Agent definitions carry a default tier instead of a free "model role" (D-37).
  - A misplaced default shows up in the metrics as extra rounds, and calibration corrects it.

### D-15 · Hard gates in git hooks and CI; tool hooks are fast feedback

- **Context:** the gates must hold on all three tools (Q3).
  - BMAD's gates are prose HALTs that nothing enforces (`research/02` X8).
  - The pilot enforces gates, but only inside Claude Code (`.claude/hooks/`).
- **Decision:**
  - **The integration branch is configurable** (R3-C1): `[git] integration_branch`, default the
    host's default branch. On the pilot it's `mirai/pilot` (D-28). Wherever this file and `01`
    say "`main`", they mean the integration branch: the trust-root base, ticket bases, MR
    targets, the docs MR, the baseline and CI's base. `doctor` checks that the integration branch
    carries `.mirai/mirai.lock`, the public keys and the CI workflow.
  - A `pre-push` hook and CI verify the signed proofs plus a **signed gate-result record**
    (D-16). **`pre-push` runs no project code** (R3-C2): it checks records only, which also keeps
    pushes fast.
  - Claude Code hooks (ported from the pilot) give in-session feedback. Codex and Cursor get hooks
    where they support them.
- **The gate can't be changed by the branch it checks** (R-C2, R2-C1):
  1. **Trust root.** At run start the orchestrator snapshots the framework, config, custom files,
     generated tool files and the compose inputs it will use (D-48) *from the base commit*. It
     hashes them into a read-only folder **outside the project**,
     `~/Library/Application Support/mirai/<repo-id>/trust/<base-sha>/` (D-47; named `trust/` with unit 12, since "bundle" is unit 11's launch bundle), and re-hashes it
     before every launch (D-12). Every launch, hook and gate uses that snapshot.
     - **The base is always the integration branch**, also for the tickets of a `release:
       together` epic, whose `feature/<epic>` holds code not yet approved into it (decided
       2026-10-24, unit 12), and **never a stacked parent's branch** (R2-M6). A change is still
       measured from where its branch left its own base. A stacked child takes its trust root and
       lock from the integration branch, not from agent-written code.
  2. **Protected paths.** A diff that touches any of these is forced to `high` risk and fails the
     floor guard; in autonomous mode the ticket parks:
     - `.mirai/**`, the tool dirs (`.claude/`, `.agents/`, `.codex/`, `.cursor/`), CI files, git
       hooks, lint/test configs;
     - compose files, Dockerfiles and `.env*` files (R2-C2);
     - any new or changed `CLAUDE.md` or `AGENTS.md`, at any depth, because a nested one would
       land in the reviewer's context (R2-M10);
     - E2E test files for anyone but the QA agent (D-44);
     - **files that hide code from review** (R3-C4, TL3-12): `**/.gitattributes`,
       `**/.gitignore`, `.gitmodules`, `.lfsconfig`, `.github/CODEOWNERS`;
     - **auto-run config** (D-54): `.claude/**`, `.vscode/**`, `.idea/**`, `.envrc`,
       `.devcontainer/**`, `.husky/**`, `.mcp.json` and `package.json` lifecycle-script changes.
       These **park in both presets**, so you review them on the host before you check the
       branch out;
     - dependency manifests and lockfiles (TL3-3): agents never install during a session;
     - `.mirai/keys/**` and `.mirai/records/**` (D-17).
     - **Declared at plan time** (R3-M2): a plan lists the protected paths it expects to touch.
       Such a ticket is high risk **at the plan gate**, so you approve it in the daytime batch, and
       the build may then touch exactly those paths and no others. Undeclared touches still park
       in autonomous mode and stop in supervised mode. `mirai run --plan` shows protected-path
       tickets, so none is queued overnight unapproved.
     - Protected paths are checked **after every agent launch**, not only at the floor guard.
  3. **Hooks live outside the project**, in `<mirai-home>/<repo-id>/hooks/` (one spelling
     everywhere, TL3-18), hash-checked against the integration branch's `mirai.lock`. `init`
     writes `core.hooksPath` into `.git/config` for your own pushes; that file is then covered by
     the git-integrity hash (D-54). **The orchestrator's own git calls are pinned** (R3-C4,
     D-54): `GIT_CONFIG_NOSYSTEM=1`, a MIRAI-owned `GIT_CONFIG_GLOBAL`, and `-c` pins for
     `core.hooksPath`, `core.fsmonitor=false`, `core.sshCommand`, `credential.helper`,
     `core.pager=cat`, `diff.external=` and `protocol.ext.allow=never`; diffs use
     `--no-ext-diff --no-textconv`; push uses an explicit URL, not `remote.origin.*`.
  4. **CI is split into two jobs** (R2-C5):
     - **`mirai-verify`** reads only data: the signatures (Ed25519, checked with the public keys
       from the **base** commit, D-17), the lock hashes and the proof files. It runs from the
       base branch's copy of the workflow (`pull_request_target`) and **never executes PR code**,
       so a PR can't rewrite or delete it. Hardening (R3-M10, TL3-13, AR3-18):
       - it **recomputes the code hash itself** from the PR head (D-16, with the hash domain and
         code paths read from the **base** config) and requires a signed proof for exactly that
         hash, so an old valid proof can't pass;
       - `permissions:` `contents: read` and `statuses: write` only; base checkout with
         `persist-credentials: false`; the PR head fetched into a separate folder as data; no
         `npm ci`, no `setup-*` cache, no `actions/cache`;
       - whether a required check can be pinned to the real `mirai-verify` (not a same-named job
         a PR adds) is UNVERIFIED (G11).
     - **the test job** runs the quality gate and the secret scan on `pull_request.head.sha`, with
       no secrets and `permissions: contents: read`, so agent-written test code can't push.
     - **Stacked MRs** (R3-M10, AR3-5): a stacked MR is **never merged into its parent**. Your
       merge targets are the integration branch or `feature/<epic>`, after the orchestrator
       retargets the child. CI on a stacked MR is advisory: `mirai-verify` finds the stack root
       and verifies against its keys and lock. The run that counts is the one after retargeting.
       Required checks are set only on the integration branch and `feature/*`.
     - **The test baseline has one home**, the store (`<store>/baseline/<sha>.json`, per
       integration-branch SHA). CI computes its own baseline on the merge-base (or a cached
       artifact keyed by base SHA), so both sides compare against the same base (AR3-11). The
       known-failure list may only shrink automatically.
     - The only exception to "framework and workflow match the base lock" is an MR you label as a
       MIRAI update.
     - The GitHub event behaviour is UNVERIFIED and checked before the CI unit (`research/09` §8,
       `05` §G).
- **The hard gates apply to MIRAI work only, and the scope fails closed** (`08` Q8, R2-M4):
  - **No `mirai/` branch prefix.** MIRAI follows the project's own branch naming pattern, which
    setup records. Most companies have naming policies.
  - **MIRAI work is marked by a commit trailer,** `Mirai-Ticket: <id>`. **The orchestrator writes
    every MIRAI commit** (agents can't commit, D-50), so the trailer is reliable. If the project
    has a strict commit format, setup adapts the trailer to it.
  - **Registration is a branch-carried, signed fact** (R3-M10, AR3-4). When MIRAI creates a
    branch, its first commit adds a signed `.mirai/records/<ticket>/branch.json` with `{ticket,
    branch, base_sha}`. The store keeps a local index keyed by `(branch, creation_sha)`, cleared
    on merge or delete.
  - **Scope fails closed, locally and in CI.** A branch is MIRAI-scoped if any commit has the
    trailer, **or** a valid `branch.json` exists, **or** the committer is the MIRAI git identity.
    In scope, every non-merge commit must carry the trailer and a valid proof must match. A mix of
    trailer and non-trailer commits fails. Host-made merge commits are refused; the orchestrator
    rebases instead. If MIRAI is installed but the local index is missing or corrupt, pushes of
    trailer branches are refused until `doctor` repairs it (TL3-22).
  - **`mirai handover <ticket>`** releases a MIRAI branch to you by hand. It commits a signed
    `.mirai/records/<ticket>/handover.json` `{ticket, at_sha}`, so CI sees it too. For a
    handed-over branch, CI checks only the secret scan, and the MR line says "MIRAI review
    covers up to `<at_sha>`" (R2-M4, AR3-4).
  - Human developers' unregistered branches without the trailer are untouched.
  - The secret scan is the exception: it's offered to everyone, because it protects everyone.
- **Consequences:**
  - **Your merge is the final gate** (R2-C5). For a solo developer CI is a strong second check,
    not a wall: `doctor` and the docs say so plainly.
  - `--no-verify` can skip local hooks. CI still checks the MR, and every bypass is counted (M9).
  - **Until CI exists for a project, the merge gate is local only** (R-M21). `doctor` says
    "merge gate: CI-enforced / local-only". A minimal profile covers projects without CI. Whether
    required status checks work on a private repo on your GitHub plan is checked before the CI
    unit (see `07`).
  - Changing MIRAI's own rules always needs you, which is intended.
- **Confirmed by `research/08` §5.3:**
  - Codex and Cursor hooks **fail open** when a hook errors.
  - Codex skips hooks a user hasn't trusted.
  - Only Claude Code supports fail-closed hooks.
  - So tool hooks can't be the gate.

### D-16 · Review and QA proofs are bound to the code change

- **Context:**
  - The pilot wipes review markers on every edit (`on-file-change.sh`). That only works inside one
    Claude Code session.
  - Version 1 bound records to the tree hash. That broke every successful ticket: after review
    PASS, MIRAI itself writes the QA report and status, the hash changes, and `pre-push` refuses
    (R-C1, found by two reviewers). GitHub CI checks out the PR *merge* ref by default, so its
    hash never matched either.
  - Version 3's E2E step (Ivy writing the E2E test *after* review) broke the record again
    (R2-C4). Version 3 also used `git patch-id --stable`, which ignores whitespace and doesn't
    hash binary content (R2-M7).
- **Options:**
  - The tree hash (version 1).
  - The pilot's session markers.
  - pstack's `git patch-id` idea (`playbooks/shipping.md`).
  - Our own hash over the code-path diff.
- **Decision:** **patch-id records with MIRAI's own hash** (the name "patch-id record" stays).
  - A record stores **SHA-256 over a normalized patch** (R3-M11, AR3-6), computed by the CLI:
    1. `git -c core.quotePath=true diff --binary --no-ext-diff --no-textconv --no-renames
       --no-color -U3 --src-prefix=a/ --dst-prefix=b/ <merge-base>..<head> -- <code paths>`,
       with the pinned git environment (D-15);
    2. then drop the `index …` lines, replace hunk headers with `@@`, and sort the file sections
       by path.

    Whitespace, mode changes and binary content still count. Blob ids and hunk line numbers
    don't, so a change on the new base in a touched file doesn't break the proof.
    Version 4 hashed raw `git diff --binary`, which includes both (AR3-6).
  - **Hash at commit time** (R3-M8): right before every commit and every proof hash, the
    orchestrator checks that the hash of `git status --porcelain=v2 --ignored` is unchanged since
    the last check, so a lingering process can't slip in a change.
  - **A signed gate-result record** (R3-C2, TL3-1): the orchestrator runs the named checks
    (D-48) and writes `<ticket>/gate-r<n>-<hash>.json`, signed and bound to the code hash.
    `pre-push` and CI verify it instead of re-running suites.
  - **When proofs are minted** (AR3-15): at ship time, from the captured verdicts, together with
    the trace result. Before `mirai trace` exists the field is `trace: "n/a"`. Each proof also
    carries `base_sha`, `trust_root_hash`, `framework_version` and the verifier rung and model.
    Proofs from earlier rounds stay as immutable files; the checker picks the one that matches.
  - The `[gate] code_paths` config has a default exclude list: `.mirai/**`, `<docs_root>/**` and
    MIRAI bookkeeping. **E2E test files are code paths**: Ivy writes them **before** review and
    Rex reviews them with the code (U2, D-44), so one proof covers both.
  - Any later code change changes the hash, so the record stops counting, in any tool and in CI.
  - **CI checks out `pull_request.head.sha`,** not the merge ref.
  - **A clean rebase keeps the record**, as long as the normalized patch against the new base is
    the same. Only the named checks re-run. This is what makes stacking (D-24) affordable. Test
    cases: the base moves inside a touched file (proof kept); a context line changes (proof
    fails); mode-only and binary-only changes (proof fails).
  - **Records are immutable files,** one per record: `<ticket>/<kind>-r<n>-<hash>.json`. The CLI
    writes them from the reviewer's or QA agent's **structured output captured by the launcher**
    (D-12), never from a file in the work tree, and signs them (D-17).
  - **A record is only a proof:** "review (or QA) PASS for this exact code change", plus the
    `mirai trace` result computed at ship time (D-35). It holds no findings. The review and QA
    text stays local in the orchestrator store (D-29, D-46).
- **Consequences:**
  - **Honest limit** (as the pilot's README says): a record proves a review ran on this exact
    change, not that the review was good.
  - The records folder is a protected path (D-15) and agents are denied `Edit` on it (D-30). An
    agent change to it parks the ticket.
  - The unit's "done when" includes the full happy path, with an `e2e: true` ticket: E2E written →
    review PASS → QA PASS → gate-result record → built → push succeeds.

### D-17 · Human-only moves are signed, and given in a real terminal

- **Context:** version 1 relied on `/dev/tty`. But `script -q /dev/null mirai approve …` gives an
  agent a terminal, the run log is a plain file an agent can append to, and an environment flag can
  be unset (R-M1). Version 2's HMAC key was symmetric, so CI couldn't check a signature without
  holding the secret, and a PR's workflow could leak it (R2-C5).
- **Decision:**
  - `mirai approve`, `mirai drop`, `mirai unpark`, `mirai handover` and the production go/no-go
    are the only paths to human-only states. `built`, `integrated` and `done` are derived (D-06),
    so they aren't moves anyone makes.
  - **Ed25519 signatures** through Node's built-in `crypto` (still zero dependencies):
    - the **private key** stays in `~/.config/mirai/` (one per machine), readable only by your
      user and denied to agents (D-30);
    - the **public key is committed** (`.mirai/keys/<key-id>.pub`; the key id is derived from the key, unit 06);
    - every signature carries `{key_id, ts}` (TL3-19);
    - CI's `mirai-verify` job checks signatures with the public keys from the **base** commit
      (D-15), so it needs no secret, and a PR can't add its own key.
  - **What gets signed:**
    - approvals sign the **document's content hash** and version, so an edit after approval is
      detected (R2-M11);
    - the plan's frozen block is hashed into the plan approval;
    - proof records sign the code-change hash (D-16) and the trace result.
  - **Key lifecycle** (R3-M10, AR3-10):
    - **bootstrap:** the first public key lands in the `init` commit, which you push by hand;
    - **key changes go only through a key MR** (in Milestone A: your own key-only commit from `mirai key new | revoke`, unit 06), which
      changes only `.mirai/keys/`. `mirai-verify` refuses key changes in any other MR, and refuses
      any MR with a MIRAI trailer that touches `.mirai/keys/`. The key MR passes by a
      self-signature check plus a label you set;
    - **revocation:** `keys/<machine>.revoked` with a date; proofs signed after that date fail.
      `doctor` lists active keys and fingerprints;
    - optional Keychain storage for the private key;
    - agents are denied sandbox writes and `Edit` on `.mirai/keys/` and `.mirai/records/` (D-30).
  - **Where approvals live** (AR3-9): document approvals are committed on the docs branch (D-06).
    Approvals of plans, unpark, round grants and go/no-go are store-journal events, signed for
    audit. `handover` gets a committed record (D-15).
  - **`mirai log` refuses privileged event types:** approval, record, gate result, human-only
    status. Those are written only by the commands above.
  - `pre-commit` and CI reject a status change to a human-only state without a matching signed
    approval event.
  - Approvals are given in `mirai inbox` or `mirai approve` in a real terminal (D-34). The key,
    the store, `.git` writes and `mirai approve | drop | unpark | handover` are **hard denies in
    interactive sessions too**, not `ask` (TL3-19).
- **Consequences:**
  - **Honest restatement:** this resists accidental and casual forgery. Agents run as your own
    user (D7, no container), so the protection is only as strong as the deny rules and the
    sandbox around the key file. A bug there would let a determined agent forge an approval.
    The red-team test in D-30 includes reading the key.
  - A second machine needs its own key pair, with its public key merged once (D-52).
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
  - **One tier escalation, for light steps only:** a tier-1 step that fails its check twice is
    retried once on the next tier up (D-14). It sits outside the review rounds.
  - **Template gaps** an agent reports are logged as `template_gap` events, not acted on (D-41).
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
  - a preflight before each run and each ticket (stack healthy, `claude auth status`, clean tree,
    trust root hash, test baseline refreshed from `main`, D-45);
  - a flaky test is re-run once before it counts;
  - API errors are retried with backoff;
  - **a circuit breaker:** N environment faults in a row stop the night with one clear message,
    instead of parking every ticket;
  - **a subscription usage limit** ("session limit" / "weekly limit") **pauses** the run:
    checkpoint, record the reset time, wait, then resume from the checkpoint with the same
    counters (your decision, 2026-10-21). An unknown reset time is probed by one tiny launch every
    30 minutes. A reset after `run.stop_by`, or a weekly limit, stops the run for `mirai resume`
    later. An outer timeout covers indefinite 429 retries (`research/09` §5). The run state moves
    `running → paused → running`, or to `stopped` (D-07). A pause during a stacked rebase or an
    open fix round resumes that exact step, with the same counters.
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
- **Consequences:**
  - Writing our own templates is a unit of work each, but it keeps MIRAI's license clean.
  - **Why the document types exist is explained in the user docs** (`08` Q1). For example, the
    HLD describes how one feature is built, while an ADR records one hard decision that outlives
    the feature. Design reasoning like this always ends up in the user documentation.
  - Templates are strict; see D-41.

### D-20 · An existing project convention beats the MIRAI default

- **Decision:** if a project already has ADRs, HLDs or tickets, MIRAI matches their location,
  numbering, file pattern and headings. Addy: "An established convention overrides the defaults"
  (`documentation-and-adrs/SKILL.md:36-44`). Conflicting evidence is surfaced, not resolved
  silently.
- **The same holds for tests** (`08` Q8): agents write tests the way the project already does,
  with the same framework, folder layout and naming. No new test framework is added without your
  yes.
- **Consequences:** templates need a mapping step at setup. The pilot's `docs_old/decisions/`
  numbering continues.

### D-21 · Sync-back: the lock-hash boundary, a leak scanner, and a PR

- **Context:** no prior art pushes improvements upstream (`research/05` #42).
- **Decision** (Q9):
  - `mirai contribute` reads only files the lock marks **`framework`** whose hash changed. Files
    marked **`rendered`** (the `.claude/` files, the `AGENTS.md` block, `verify-<app>`) or
    **`project`** (context, config, custom) are never carried upstream (R2-M12, R3-M13, D-37).
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
    rules, as a content-hashed snapshot (`render_skill.py`). The same render produces the
    interactive `.claude/` files, so headless and interactive runs see the same thing (R2-M12).
  - **Custom templates are overlays** (add, rename, reorder sections) on the framework template,
    not full copies, so `update` still applies framework changes underneath. Every document
    records `template: <type>@vN` (D-41).
  - **Config schema migrations are allowed:** deterministic scripts, shown to you as a diff before
    they apply. Version 3's "migrations never touch config" is withdrawn (round-1 AR-5, R2-M12).

### D-22 · Agents never merge and never release to production

- **Decision** (Q5, D2):
  - Merging **code** and production deploy are always human. That includes merging a ticket MR
    into an epic's `feature/<epic>` branch (D-33). Nothing merges without your consent.
  - **One exception, documents only** (V3, D-56): after your signed ticket-set approval, the
    orchestrator merges the **docs MR**. It contains only documents you approved, and its gate
    requires an empty code-path diff.
  - **A stacked MR is never merged into its parent** (AR3-5). The orchestrator retargets it to the
    integration branch or `feature/<epic>` first; `mirai inbox` and the MR description say "do
    not merge until retargeted".
  - The orchestrator pushes and opens MRs. Agents themselves never get push credentials (D-30).
  - This is revisited only once the trust metrics are good enough. Any change would be a new
    decision.
- **Consequences:** overnight output is "MRs ready for review", not shipped features.

### D-23 · TDD is `auto` by default; tests are required by default

- **Context** (`08` Q7):
  - **What TDD gives agents:** a clear stop condition, proof that the test can fail, and smaller
    diffs.
  - **Where it's weak:**
    - the same agent writing test and code shares one misunderstanding of the AC;
    - agents can fake "red" with import or not-found errors;
    - it fits UI, config, glue and migrations badly;
    - it costs more turns (unmeasured);
    - the refactor step gets skipped.
  - **The real value** is an AC-derived test, proven to fail for the right reason, that the
    implementer can't weaken. Independence comes from a separate agent (ATDD).
  - You want TDD optional, per project and per feature.
- **Decision: two settings,** set per project and overridable per epic or ticket **by you only**
  (agents can't change them):

  | Setting | Values | Default |
  |---|---|---|
  | `tdd` | `auto` · `first` · `after` | `auto` |
  | `tests` | `required` · `optional` | `required` |

  - **`tdd: auto`:** TDD for logic-heavy work (business rules, APIs, calculations, and bug fixes,
    where the bug is reproduced in a test first). Tests-after or QA evidence for UI styling,
    config, glue and migrations. The ticket planner proposes it per ticket, and you can override.
    When a ticket changes untested existing code, characterization tests come first (D-45).
  - **`tdd: after, tests: required`:** tests after the code, no red check. Every AC still needs a
    test or QA evidence (`mirai trace`, D-35).
  - **`tests: optional`:** the MR says "no tests" clearly, and review and QA carry the weight.
  - **High-risk tickets keep `tests: required`** unless you override that ticket.
  - **Red evidence is produced by the orchestrator, not reported by the agent** (R-M8). It runs
    the new or changed tests against `baseline_revision`, and they must fail there.
  - **Red must fail for the right reason:** only an assertion failure counts, not a compile,
    import or not-found error.
  - **A stub step before red** (R2-M7): for brand-new code, Kai first adds an empty stub with the
    final signature and a wrong return value. The new test then fails on an assertion, which is the
    red the orchestrator accepts. Without the stub, new code could only fail as "not found".
  - **How the red run works in one checkout:** the orchestrator runs only the new or changed tests
    (through `run_tests(level, path)`, D-48) against `baseline_revision` plus the stub, then
    returns to the branch head.
  - Tests carry the AC IDs they cover (D-35). `no-test: <reason>` is allowed for non-behavior rows
    and shown to the reviewer.
  - **ATDD moves from Later into Milestone D**, at least for high-risk tickets: acceptance tests
    written from the ACs by a separate agent before the code (TEA ATDD idea, `research/05` #23).
- **Consequences:**
  - M15 (TDD discipline) is measured on tickets where TDD applies.
  - `tdd` and `tests` are logged per ticket. After calibration, rounds and escapes are compared,
    so the default can change on evidence.

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
    - **Its trust root and lock always come from the integration branch**, never from the parent
      branch (D-15, R2-M6). It's never merged into its parent (D-22); CI on it is advisory until
      it's retargeted (D-15).
    - **When the parent merges,** the orchestrator moves the child with
      `git rebase --onto <new-base> <old-parent-head>`. That replays only the child's own commits,
      so it survives a squash merge of the parent (R2-M6). It then re-runs the named checks (D-48). A
      clean rebase keeps the review (D-16).
    - **The orchestrator force-pushes** the rebased child with
      `--force-with-lease=<branch>:<expected-sha>`, naming the exact commit it last pushed. Agents
      never push. The recorded parent head is refreshed whenever the parent is pushed, so the
      `--onto` point never goes stale (AR3-17).
    - **Cascade:** a child of a child is rebased after its own parent, one level at a time.
    - Changes requested on the parent mark the child `waiting` (D-07). A rebase conflict parks it.
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
- **What we added:** a business-context file (D-43) and the feature map, which also holds the
  critical journeys (D-44).

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
    This is a branch name we choose ourselves for the pilot. It isn't a MIRAI convention: ticket
    branches follow the project's own naming pattern (D-15).
  - **During the pilot, `[git] integration_branch = mirai/pilot`** (R3-C1). Ticket MRs, docs MRs,
    the trust-root base, the baseline and CI's base all use `mirai/pilot`, never the product's
    `main`. Merging `mirai/pilot` into the product's `main` is a separate, later decision of
    yours. The pilot checkpoint includes "`doctor` shows the integration branch, and its lock and
    public key are present".
  - The council's gate logic is ported into MIRAI's hooks.
  - BMAD's install is not carried over.
  - Nothing happens before "APPROVED: start implementation", and your BKT-48 work must be
    committed or stashed first.
  - **When the pilot starts** (U1, R2-C6): **right after Milestone A.** Every unit is first built
    and tested on the **private sample-app repo** in the pilot's stacks (D-55). From the end of Milestone A on, the pilot
    repeats each milestone's exit check on real tickets, and calibration and the success check
    (D-38) run on pilot tickets.

### D-29 · What gets committed

- **Context:** version 2 didn't say where per-ticket work files go. Committing every plan, review
  and QA report would add hundreds of files nobody reads again, and agents might load them as
  context (`08` Q9). Version 3 still exported run-log lines into MRs, which conflicts with Q9
  (R2-M15, decision U3).
- **Committed (branch-carried facts, D-06):**
  - documents, signed approval events, pointers, config (including `resources`, kept committed
    for now; `doctor` warns if the project repo is public), context and generated tool files;
  - **the small signed records** under `.mirai/records/<ticket>/` (D-16, D-15): proofs,
    gate-result records, `branch.json` and `handover.json`. The gate and CI need them. They hold
    no findings;
  - `.env.test`, which holds fake values only and is a protected path (D-49);
  - **the public signing keys** (D-17);
  - E2E test files, with the code (D-44).
- **Never committed:**
  - the orchestrator store (outside the project, D-47): run progress, counters, ledger, parking
    notes, trust-root snapshots, hooks, reports, full run logs, `config.user.toml` and the
    external-doc cache;
  - **per-ticket work files:** plans, review findings, QA reports, parking notes, screenshots
    and transcripts. You read them with `mirai inbox` and `mirai show <ticket>`;
  - **no run-log lines.** CI needs only the signed proofs, and the metrics are read from the
    store.
- **No review comments on GitHub/GitLab** while you are the human gate (`08` Q9). Reviews stay
  local.
  - **The MR description gets one line:** `Review: PASS after N rounds (MIRAI)`, plus the
    non-blocking follow-ups worth knowing.
  - QA evidence in the MR is text: the AC table, test names, command output.
  - **The QA result is posted as a ticket comment** when a tracker exists, by a tier-0 script. It's
    a frozen snapshot, so it doesn't conflict with D-06's one source of truth. Screenshots are
    uploaded to the ticket where the tracker's API allows it. Screenshots on the MR come later,
    after checking what GitHub allows (it has no official API for comment images).
  - Reviewing someone else's MR with inline comments is a separate later feature (see `07`).
- **Reason:**
  - CI needs only the proof records.
  - Live state on branches caused the conflicts in R-C4.
  - Transcripts are large and may hold sensitive output.
- **Consequences:**
  - Every log line in the store carries `{schema_version, run_id, seq, ts, item, by}`, with an
    ordering rule and a compaction rule.
  - How long local work files are kept is set by the retention rule (D-46).

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
  - **Review round 2** found that version 3 placed the layers wrongly (R2-C1 to R2-C3). **Review
    round 3** found side doors around version 4's layers (`06-review-round-3.md` §A): host-side
    code (git, the gate, docker, the file tools) acting on files an agent or a test container can
    write. Version 5 closes those.
  - **Your decision V1 (round 3): keep D7 as is**, with no separate macOS user and no container,
    and apply every round-3 fix. **Condition:** if the red-team suite shows that the docker
    socket, ssh-agent, the keychain (`git credential fill`, `security find-*-password`) or the
    real `.env` are reachable from an agent and configuration can't close it (G18, G25), that's a
    **blocker**: no headless run starts, and V1 comes back to you as a decision.
- **Options:**
  1. A container or VM per run (the round-1 recommendation). Rejected by you (D7).
  2. A dedicated macOS user for headless runs (recommended in round 3). Rejected by you (V1),
     unless the condition above triggers.
  3. Rules in prompts only. They don't block, so this isn't an option.
  4. **Layered blocking rules using what Claude Code enforces** (`research/09` §1–§4), plus
     hardening of every host-side component that touches agent-written files.
- **Decision:** option 4. **One rule over everything: MIRAI host-side code never executes project
  code, and never trusts a file an agent or a test container could have written without checking
  it first** (R3-C2, TL3-1). The layers:
  1. **MIRAI's control files are outside the project and split by trust** (D-47, TL3-7). Under
     `~/Library/Application Support/mirai/<repo-id>/`:
     - `store/`: tokens, ledger, counters, verdicts, status, work files. Read and write denied
       to agents;
     - `trust/<sha>/` (the trust root): skills, agents, prompts, `strict.json`, `mcp.json`,
       hooks. Readable by agents; write-denied by the sandbox `denyWrite` and an `Edit` deny,
       with read-only modes, and hashed again before every launch. No immutable flag (unit 12):
       its owner can clear it, so it stops nothing that runs as you;
     - `input/<launch>/`: the per-launch read-only input folder (D-12);
     - `scratch/<run>/`: agent-writable, never trusted;
     - `tmp/`: MIRAI's own temp folder. Host code never uses the per-user temp dir, which the
       sandbox can write.

     The signing key lives in `~/.config/mirai/` and is denied like the store.
  2. **Agent-written code never runs on the host.** Agents run tests and named checks only
     through **`run_tests`** from the trust root (D-48): structured arguments, no shell, a frozen
     and validated compose file, inside the project's containers. Agents never run `docker`,
     never install dependencies, never run generators. The gate, the baseline and post-rebase
     re-runs go through the same executor (R3-C2).
  3. **Test containers have no route out and see no secrets** (D-49): an internal network with no
     outside access or DNS, dummy secrets from `.env.test`, and **`.git` and every real `.env*`
     masked** in the mounts (R3-C4, TL3-2).
  4. **The OS sandbox is on, with no escape.**
     - `sandbox.enabled: true`, `allowUnsandboxedCommands: false`, **no `excludedCommands`**, and
       `allowUnixSockets` explicitly empty (TL3-5).
     - **"Outside the project" is written with the sandbox** (deny beats allow in permission
       rules, R2-M10): `denyRead` on your home folder, `allowRead` only for the project, the
       toolchain caches, the trust-root `bundle/` and the launch's `input/` folder; explicit
       `denyRead`/`denyWrite` on `store/`, `~/.config/mirai` and every real `.env*` path setup
       finds (TL3-14; whether globs work there is UNVERIFIED, G25).
     - **`denyWrite` on `<project>/.git/**`, `.mirai/keys/**` and `.mirai/records/**`**
       (R3-C4, AR3-1). Read-only roles (Rex, Vera) get `denyWrite` on the whole project.
     - **Network:** the headless allowlist is **empty**, because Claude Code's own API traffic
       comes from the `claude` process, which isn't a sandboxed command (R3-M5, TL3-3). That
       closes uploads through package registries. It's UNVERIFIED (G16) and tested before any
       headless run. If it fails, the allowlist is the model API only, and the residual risk
       below says so.
     - The sandbox is the only layer that covers child processes, `grep -r`, `sh -c` and
       path-qualified binaries.
  5. **Permission deny rules** for the file tools, which run outside the sandbox:
     - `Read`/`Edit` of `store/`, `~/.config/mirai`, `~/.ssh`, `~/.aws`, `~/.config/gh`,
       `~/.npmrc`, `~/.netrc`, `~/.docker`, `~/.kube`; `Edit` of `bundle/`, `.git/**`,
       `.mirai/keys/**`, `.mirai/records/**`; `Read`/`Edit` of `.env*` except `.env.test`;
     - `Bash(git push *)`, `Bash(git commit *)`, `Bash(git config *)`, `Bash(gh *)`,
       `Bash(docker *)`, `Bash(claude *)`, `Bash(mirai *)`, `Bash(env)`, `Bash(printenv *)`;
     - **`WebFetch` and `WebSearch`** and **the Task/Agent tool** in headless runs;
     - in headless runs `dontAsk` turns anything else that would prompt into a deny. In your
       interactive sessions "outside the project" is `ask` ("not without my approval"), **except**
       the key, the store, `.git` writes and `mirai approve | drop | unpark | handover`, which are
       hard denies there too (TL3-19).
  6. **Hooks** (PreToolUse, exit 2 blocks), loaded from the trust root:
     - **a path hook on `Read | Edit | Write | MultiEdit | NotebookEdit`** that resolves the
       target with `realpath` (the parent folder for a new file) and denies anything outside
       `realpath(project)`, or inside `.git/`, `.env*` (except `.env.test`), `.mirai/keys/` or
       `.mirai/records/` (R3-C4, TL3-4). It runs whether `--restricted` is used or not, and
       closes the symlink route whatever Claude Code's own matching does (G17);
     - the hook command in `strict.json` is a fixed shim that checks its target's hash against a
       value embedded in `strict.json` on **every** call;
     - secret patterns in Write/Edit content, including the exact login token and its base64,
       base64url, hex and reversed forms;
     - Glob/Grep paths outside the project, which permission rules ignore.
  7. **A branch can't loosen the rules.** All of the above ships as the per-role **strict
     settings bundle** `<trust-root>/strict.json` with `mcp.json`, passed with `--settings` and
     `--strict-mcp-config`; no user, project or local settings, memory or skills load
     (`--restricted`, or the `CLAUDE_CONFIG_DIR` fallback, D-12). The trust root is re-hashed
     before every launch. Reviewers read a clean export with the integration branch's
     instruction files (D-12).
     - **Optional, recommended before the first overnight run:** setup offers to install
       `/Library/Application Support/ClaudeCode/managed-settings.json` with the managed-only
       locks (`allowManagedPermissionRulesOnly`, `allowManagedHooksOnly`,
       `disableBypassPermissionsMode`). It needs admin rights and your approval. Default: off;
       `doctor` shows it as "recommended".
  8. **Git and auto-run config are integrity-checked** (D-54): the orchestrator hashes
     `.git/config`, `.git/info/**`, the `.git/hooks/` listing and the ref list before and after
     every agent launch and every `run_tests` call, and before every git call. A change stops the
     run. Its own git calls are pinned (D-15). Auto-run config paths park in both presets (D-15).
     Every run ends with the checkout on the integration branch and a clean tree, so what you
     open in the morning isn't a MIRAI branch.
  9. **Credentials stay with the orchestrator.** Agents never get push credentials or the `gh`
     token. The orchestrator commits (D-50), pushes with an explicit URL and opens MRs. The
     environment is an allowlist (D-12). Whether Claude Code keeps `CLAUDE_CODE_OAUTH_TOKEN` out
     of the Bash environment is UNVERIFIED (G9).
  10. **Secrets can't reach a commit.** `pre-push` runs a secret scan that blocks (patterns, the
      exact token value and its encoded forms, and an entropy rule on new files), and CI's test
      job runs it again. The autonomous preset refuses to run on a public repo.
  11. **Limits:** an outer `timeout` on every launch, `--max-turns`, the budget ledger (D-18), and
      a killed process group after every launch (D-12).
  12. **Text from connectors and web pages is fenced as untrusted data** in every prompt.
  - **Never used:** any permission-bypass or sandbox-off flag.
  - **Codex and Cursor** (from Milestone D): Codex `exec --sandbox workspace-write` with network
    off; Cursor `agent -p --force --trust --sandbox enabled` with deny rules in
    `.cursor/cli.json` (`research/08` §5.4).
- **The red-team suite** is the single list; `01` and `07` refer to it. **No headless launch,
  supervised or autonomous, happens without a green red-team result** recorded for this
  machine's Claude Code version, `strict.json` hash and Docker version (R3-M7, TL3-9). `doctor`
  re-runs it after any update, and the launcher enforces the result. Each seeded attempt must be
  blocked or detected:
  - **Reads outside the project:** `~/.ssh`, `~/.config/mirai`, `store/`, `~/.npmrc` through
    Read, `cat`, `grep -r`, `python3 -c`, and through a symlink created in the project (to a
    hook, `.git/config`, the key, `~/.npmrc`); a Glob from `/`.
  - **Writes to control files:** `store/`, `bundle/`, a trust-root hook (directly, via symlink,
    via the Edit tool); `.git/config` (a `filter.*.clean`, `core.sshCommand`, `include.path`) and
    `.git/hooks/x` from Bash **and** from a test container; `git config core.hooksPath`;
    `git commit`; `.mirai/keys/x.pub`; `.mirai/records/`.
  - **Gate and launch:** reading a launch token; `mirai agent run` or `claude -p` from Bash; the
    Task tool; writing a fake verdict file and expecting it to be signed; editing the plan's
    frozen block (detected); writing outside its scope into the input folder; a background
    process that edits a file after review (detected at commit).
  - **Network and secrets:** `curl` to an unlisted host; DNS lookups from the sandbox and from the
    test network; `npm publish` with an attacker's token; `WebFetch`; reading the login token or
    `backend/.env` and sending it out of a container; writing the token (plain or base64) into a
    file and pushing it.
  - **Docker and tests:** a branch that adds `compose.override.yml`, edits a Dockerfile or
    `.env`, sets `COMPOSE_FILE`, or mounts the repo root or the docker socket; a test that writes
    `~/mirai-pwned` when the gate runs it (the file must never appear); a `run_tests` path with a
    leading `-`, a symlink or `..`; a `run_tests` check name that isn't configured; a
    `compose.resolved.json` edited between validation and run.
  - **Host credentials (G18, G25):** connecting to the docker socket, the ssh-agent socket,
    `git credential fill`, `security find-generic-password`. **If any succeeds and can't be closed
    by configuration, the V1 condition triggers.**
  - **Instruction injection:** a branch that adds its own `.claude/settings.json` hook, a nested
    `CLAUDE.md` or `@` import with instructions for the reviewer, `.vscode/tasks.json`, `.envrc`,
    a `package.json` `postinstall`; a `.gitattributes` with `-diff` that hides code from the
    review diff.
  - **CI:** a PR that edits the workflow or adds a same-named `mirai-verify` job; an old valid
    proof on a changed head; a stacked parent that edits the workflow (the child still verifies
    against the integration branch's rules); a test job that tries to push.

  It also checks every UNVERIFIED item from `research/09` §8 and `05` §G that a layer relies on.
- **Consequences:**
  - **Honest residual risk** (TL3-16, adapted to V1). This is weaker than a container or a
    separate user per agent. The agent runs as you, so **every host-side component that touches
    agent-written files is part of the boundary**: the unsandboxed file tools, hooks and MCP
    servers, the orchestrator's git commands, and the `run_tests` executor. Each one is hardened
    (path resolution, frozen compose, masked `.git` and `.env`, config hashing, pinned git), but a
    bug in any of them crosses the boundary. The login token is readable by the agent unless G9
    says otherwise. It has no *known* route out: the headless sandbox has no network (if G16
    holds), test containers have no outside network or DNS, and the secret scan checks encoded
    forms. A route we haven't thought of would leak it, so treat it as a one-year credential you
    should be able to revoke quickly (`claude setup-token` again). Anything your user can reach
    that we haven't listed is one wrong rule away; the red-team suite is how new gaps get found,
    and each one becomes a failing test plus a fix. **Your merge remains the final gate.**
  - **Browser tests:** E2E and exploratory QA run in the Playwright container through
    `run_tests`. Playwright MCP runs outside the sandbox, so it's never in the headless
    `mcp.json`. In interactive daytime sessions it's restricted to the app's localhost origins
    with `ask` on every navigation (UNVERIFIED option, TL3-20).
  - The autonomous preset **refuses to start** unless `doctor` confirms every layer above and the
    red-team suite is green.

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

  - QA drives the browser through the official Playwright container via `run_tests` (`e2e` and
    `qa-explore`, D-48),
    next to the project's containers. **Playwright MCP runs outside Claude's sandbox**
    (`research/09` §1), so it's allowed only in interactive daytime sessions, never overnight
    (D-44). The issue taxonomy and report shape come from vercel `dogfood` (logic only).
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
    - ticket MRs target `feature/<epic>`. You merge every one of them yourself; `mirai inbox`
      lists them and allows batching. `feature/<epic>` is protected like `main`;
    - a ticket merged into it is **`integrated`** (D-07), which satisfies `after` for the next
      ticket in the epic, so the epic can't deadlock (R2-M5);
    - when all tickets are in, the QA agent runs the **final E2E**: the epic's E2E tests
      (critical journeys, D-44) plus one exploratory pass, on `feature/<epic>`, in the
      project's containers;
    - then there's one MR from `feature/<epic>` to `main` and one release.
  - **Feature flags** are added only when you ask for one, written into that ticket's plan.
  - Stacking (D-24) works the same in both modes, with depth 2 inside the epic.
  - Projects without staging: the release record goes `pending → approved → deployed → live`
    (D-07). Your go/no-go comes first, then the deploy, then a smoke check.
- **Consequences:**
  - `together` keeps `main` clean but delays feedback. The final E2E is one more QA run per epic.
  - The release stage is in MVP-complete (see `07`).

### D-34 · Every document needs your final approval; approvals go through `mirai inbox`

- **Context:**
  - A wrong PRD spreads into every ticket, and documents have no objective test (D6).
  - Supervised mode as designed needed about 32 terminal approvals per 7-ticket feature, which
    invites rubber-stamping (R-M2). Round 2 found a one-line fix still needed 5 human actions
    (R2-M3).
- **Decision:**
  - The PRD, ADRs, HLD, LLD and the ticket set always need **your** approval, in every preset.
    The verifier still reviews each one first (D-10).
  - **Gates by track** (decision U4, recounted in round 3, R3-M4). This table is the one source;
    `01` §0 copies it:

    | Track | Your actions per item | Notes |
    |---|---|---|
    | quick | approve the ticket → merge (2); **+1 production go/no-go** once the release stage exists (3) | quick + normal risk: the plan gate is `auto` in both presets |
    | standard | approve brief + PRD together → approve ticket set (the orchestrator then merges the docs MR, V3) → plan batch in `mirai inbox` → merge each ticket → go/no-go per release | the track choice sits in the PRD header |
    | full | approve brief → approve PRD → approve design → approve ticket set (docs MR merged by the orchestrator, V3) → plan batch → merge each ticket (or each merge into `feature/<epic>` plus one epic merge) → go/no-go per release | |

    Autonomous runs skip the plan batch for normal-risk tickets. High-risk and protected-path
    tickets always come to the plan gate (D-15).
  - **No separate `ship` gate.** The orchestrator pushes and opens the MR; **your merge is the
    gate** (D-15, D-22).
  - **Overnight runs cover the build loop only,** for tickets from an approved set.
  - **`mirai inbox`**, in a real terminal: one screen with everything waiting for you, with batch
    approval of plans from a short review packet, merges into `feature/<epic>` (D-33), template
    gaps and disputes.
  - **`mirai unpark <ticket>`** resolves a parked ticket with one of three choices (re-plan,
    retry, drop) and needs a note on what you changed.
  - `approve` asks "accepted as is / edited / rejected" (the M6 label, D-38).
  - **The docs MR is merged by the orchestrator** after your signed ticket-set approval (V3,
    D-56). That saves one action per feature and removes the "docs not merged yet" dependency
    before a night starts.
- **Consequences:** two or three touchpoints per feature before overnight builds (documents,
  ticket set, plan batch). Fewer, richer approvals instead of many thin ones.

### D-35 · One ID chain from requirement to evidence; `mirai trace`

- **Context:** version 1 broke the SDD chain (R-M10): the PRD used `AC-FR-n.m` and tickets used
  local `AC-n`; closure was checked only for FRs; tests carried no AC IDs. Round 2 found more gaps
  (R2-M11): lite-PRD IDs, NFR verification, two field names for the same thing, no journey IDs,
  and a trace "in CI" that needed local-only evidence.
- **Decision:**
  - **The chain:** `BR → FR/NFR → AC-FR-n.m → ticket covers_ac → tests tagged with AC IDs (and
    J-n for E2E) → QA evidence per AC ID`.
  - **One field name:** `covers_ac` on tickets (replacing `covers`).
  - **The lite PRD uses the same IDs** (`FR-n`, `NFR-n`, `AC-FR-n.m`).
  - **Every NFR names its verification method:** a test level, a measurement, or a manual check.
  - **Critical journeys get IDs** `J-n` (D-44). E2E tests carry `J-n` plus the AC IDs.
  - Quick-track tickets mint `AC-<ticket>.n`.
  - **`mirai trace`** (a lint) checks the whole chain: every AC covered by a ticket, every ticket
    AC covered by a test or QA evidence, as the ticket's `tdd`/`tests` settings require (D-23).
    It reuses BMAD TEA's trace step (logic).
  - **It runs locally at ship time.** Its result goes into the signed proof (D-16), and CI checks
    the proof, not the evidence.
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
  - **External status is advisory** (R2-M13). Tracker status is mirrored into a local cache in the
    store with a last-sync time. Gates use only repo-side facts (the signed proofs), so MIRAI
    works offline.
- **Consequences:** no ClickUp, Jira or Linear in the MVP.

### D-37 · Extension points are data with a schema

- **Decision** (R-M16): every extension point is a definition file checked against a schema:
  - **tool adapters:** a profile file per tool (bmad-loop `data/profiles/*.toml`);
  - **connectors:** the D-36 contract;
  - **document types:** template + checklist + lint rules + state machine;
  - **agents:** role, `may write` scope, allowed tools, default model tier (D-14). Allowed tools
    use **Claude Code's tool names** (`Read`, `Grep`, `Edit`, `Bash`, `mcp__<server>__<tool>`);
    the Codex and Cursor renderers translate or drop them (decided 2026-10-24, unit 11).
- **The lock marks every file with one of three marks** (R2-M12, R3-M13, AR3-13):
  - **`framework`:** copied from MIRAI, 3-way merged on `update`, contributable;
  - **`rendered`:** generated from framework + config + custom (the `.claude/` files, the
    `AGENTS.md` framework block, `verify-<app>`). Re-rendered on every `update` or `config
    apply`, never edited by hand, never contributed; `doctor` flags drift. `AGENTS.md` is
    rendered from a framework block plus a project source file (`.mirai/context/agents-local.md`).
    **Committed rendered files are never inputs to a headless run**: the trust root renders its
    own copies;
  - **`project`:** yours (context, config, custom), untouched by `update`. `mirai promote` moves a
    local addition into a framework path, so it becomes `framework`.

  `update` and `contribute` treat the three marks differently (D-21). Interactive and headless
  bundles are compared on the hash of their **shared part** (skills, agents, prompts); their
  permission modes legitimately differ.
- **The registry is a unit of its own** (see `07`): document types, agents and adapters are
  loaded from these definitions, and the status model reads each document type's state machine
  from its definition. Until that unit exists, the first milestone hard-codes the two state
  machines it needs (document and ticket) and the registry later moves them to data (AR3-22).
- **Consequences:** Codex, Cursor and a first connector plug in as data plus a small adapter, not
  as code changes across the CLI.

### D-38 · MVP success and kill criteria

- **Context:** there was no way to tell whether MIRAI works (R-M19). Round 2 found the targets
  circular, late and silent about value (R2-M2). Round 3 found two pass marks unmeasurable, the
  early stop rule using a cap that doesn't exist yet, and this decision contradicting `07`
  (R3-M3, PM3-5, PM3-6).
- **Decision:** the list below is the same as in `07` ("MVP success and kill criteria"); `07` is
  the copy you adjust at the pilot checkpoint. **The pass marks are fixed now, from your side.
  Calibration sets only the budgets, never the pass marks.**
  - **Pass marks** (proposed values; judged on 15 pilot tickets after 5 calibration tickets):
    - **Value:** at least 60% of MIRAI MRs merged with no hand edits (derived from git, a tier-0
      script that already exists in the first milestone's minimal report).
    - **Shipped** means an MR with valid proofs that you merge within 48 hours.
    - **Your time:** under 15 minutes of **active** review per shipped ticket, measured
      directly: `mirai review <ticket>` opens the MR and starts a timer, the merge event stops
      it, and idle time is capped at 30 minutes. The MR timeline is a secondary, upper-bound
      number.
    - **Overnight:** at least 2 of 3 overnight tickets shipped per night.
    - **Usage:** one night uses at most **15% of the weekly limit** (limit share, read from the
      run, or by hand from `/status` if that isn't available, G4).
    - **Parking:** under 20% of tickets parked.
    - **Escapes:** zero escapes on high-risk tickets (`mirai escape`).
    - **Safety:** zero blocking-rule violations that got through.
  - **Measured from the first milestone:** every ticket logs its share of the subscription
    limit.
  - **Stop rules:**
    - **Early (pilot checkpoint, after Milestone A):** stop and rethink if a pilot ticket needs
      more than 2 fix rounds or parks, or exceeds the **provisional turn cap** written now
      (labelled "provisional until calibration"). Your attention is captured as `mirai session`
      time plus one manual note.
    - **B checkpoint (after Milestone B, 3–5 supervised pilot tickets):** stop and rethink before
      building C if fewer than 40% are merged without hand edits, or your time per ticket is over
      30 minutes (provisional numbers).
    - **Kill / rethink:** if the pass marks are missed on the 15 judged tickets, stop adding
      units and revisit the design before Milestone D.
  - **Calibration and the success check run on pilot tickets,** never the sample app (D-28).
  - **Metrics:** report M1, M3, M4 and M6 first (R-M18). Log every raw field from day one.
    - Capture points: the `approve` label, `mirai escape <ticket>` for a bug found after PASS,
      dispute outcomes in `mirai inbox`, the review timer, merge timestamps from the host.
    - M9 comes from CI and host-API data.
  - **Reuse test** (R-M20): MVP-complete starts by installing MIRAI on a second personal project
    with a different stack and running one quick-track ticket (D-28, see `07`).

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

### D-41 · Templates are strict; agents report template gaps instead of adding sections

- **Context** (`08` Q2): you want every PRD or HLD to have the same shape, with nothing
  forgotten. Agents tend to pad documents with sections nobody asked for, which costs tokens and
  review time.
- **Options:**
  - Allow extra sections.
  - Strict templates, refined later.
- **Decision:** strict templates, refined later from evidence.
  1. **Every document type has a fixed template and checklist** (`research/07` §6, D-19). Optional
     sections are filled or say "Not applicable — <reason>"; they're never empty.
  2. **Agents may not add sections.** The lint rejects unknown headings in documents.
  3. **The template-gap signal.** When an agent thinks something important doesn't fit, it
     reports a template gap in its run output instead of inventing a section. Gaps are logged as
     `template_gap` events and shown in `mirai inbox` and the run report. One-off content goes
     into an existing section, such as Risks or an open question `Q-n`.
  4. **You refine templates deliberately,** per project (`.mirai/custom/`) or in MIRAI
     (`mirai contribute`). Templates are versioned, and every document records
     `template: <type>@vN`.
  5. **Per-project customization is yours,** as an **overlay** on the framework template, not a
     full copy (D-21). You can add, reorder or rename sections (renames carry a mapping for the
     lint). The core sections the workflow depends on can't be removed:
     requirement IDs, acceptance criteria, ADR alternatives and consequences.
- **Consequences:**
  - Occasionally useful content has to wait for a template change.
  - Recurring gaps show up in the logs, so template changes are based on data.

### D-42 · One model for monorepo and multi-repo; project resource links in config

- **Context** (`08` Q3):
  - Your projects start as a monorepo and split into several repos as they grow.
  - Some multi-repo projects can start all their services together; bigger ones often can't.
- **Decision:**
  1. **A `repos` list in config**, for both shapes. Each entry has a name, local path, remote URL,
     and start + health commands.
     - **Monorepo:** MIRAI is installed in the repo, and the list has one entry, `.`.
     - **Multi-repo:** MIRAI lives in a separate **workspace repo** (the orchestrator repo) that
       points to the service repos.
     - Growing from one shape to the other changes only `repos` and where the docs live.
  2. **What lives where.** The workspace repo holds config, business context, PRDs, HLDs, ADRs,
     epics, tickets (when stored in the repo) and approvals; its orchestrator store (outside the
     project, D-47) holds run state and reports. **Per-ticket proofs live in the service repo**
     (D-51). Each service repo gets a
     light install: conventions, quality gate, hooks, CI, and no document copies (D-06).
  3. **Every ticket belongs to exactly one repo** (a `repo` field). Cross-repo work is split into an
     interface ticket first (D-09), then one ticket per repo. The orchestrator runs each ticket in
     its repo and opens one MR per repo. Cross-repo dependencies wait like stacking (D-24).
  4. **Cross-repo E2E, chosen per workspace:**
     - `local`: start each repo in order, wait for every health check, run the E2E;
     - `deployed`: run the E2E against an environment URL;
     - `none`: a manual check for you, flagged in the report, never silently skipped.

     With `release: together` (D-33), each repo gets its own `feature/<epic>`, and the release
     order is recorded.
  5. **Project resource links** in config (`resources`): code hosting (GitHub/GitLab repos, CI
     pages), cloud (GCP projects, AWS account and region, console links), monitoring (Grafana,
     Datadog, Coralogix, error tracking), runbooks, status page, API docs.
     - **Links and names only, never credentials.** Future access goes through the tool's own
       login and read-only connectors (Phase 2: debugging).
     - Internal URLs and IDs are added to the leak scanner's block list automatically (D-21).
     - In the MVP, agents only read the links as context.
- **Consequences:**
  - The MVP builds the config shape and the `repo` field. Running tickets across several repos,
    cross-repo E2E and release order come in Milestone D; moving a monorepo's docs into a
    workspace repo comes later (see `07`).

### D-43 · Setup builds the business context from your sources

- **Context** (`08` Q4): version 2 had one interview question ("where business context comes
  from") and a `business.md` with no defined content. Without business context, PRDs come out
  generic and reviewers can't judge whether a feature makes sense.
- **Decision:** setup has a proper business-context step.
  1. **Sources first, questions second.** Setup asks what describes the business: files (pitch
     deck, feature list, specs), URLs (website, Confluence or Notion pages, app store page) or
     pasted text. It reads them, then interviews only the gaps, one question with a guess. A new
     project with no sources gets the interview only.
  2. **A fixed `business.md` template** (D-41). Sections:
     - what the product does;
     - who it's for (users, customers, who pays);
     - business model and goals/KPIs;
     - **what this project or repo is responsible for, and what it is not** (one line per repo in
       a workspace, D-42);
     - key business rules;
     - domain glossary;
     - constraints (legal/compliance, markets, languages);
     - stakeholders (optional).
  3. **Every claim names its source:** a link, a file, or "you said, <date>". Sources are stored as
     links in `resources` (D-42), not copied. Fetched content is fenced as untrusted data.
  4. **A size cap** of about 1–2 pages, because agents load it on every document run. Long sources
     are summarised, with the link kept.
  5. **You approve it,** like the other context files.
  6. **Kept current.** When a request contradicts `business.md`, Nora proposes an update at intake
     for your approval. It never changes silently. `doctor` reports its age.
- **Consequences:** setup takes longer the first time. The business template gets its own lint
  and checklist.

### D-44 · E2E tests cover critical journeys only, written by the QA agent

- **Context** (`08` Q6):
  - Version 2 mixed two things. QA verification (Ivy checks each AC on the running app with
    evidence) was designed. An automated E2E suite committed in the repo was not: nobody wrote it.
  - Playwright MCP runs outside Claude's sandbox (`research/09` §1).
  - E2E tests are the most expensive kind: slow, flaky, brittle and hard to debug. The test
    pyramid and the testing trophy agree they should be few.
- **Decision:**
  1. **A critical-journeys list** per project, in the feature map ("if this breaks we lose users
     or money"), each with an ID `J-n`. Setup proposes it from the business context (D-43), and you approve it.
  2. **The ticket planner marks `e2e: true`** only when a ticket creates or changes a critical
     journey. You can override it at ticket approval.
  3. **Ivy writes or updates the E2E test** for that journey, not Kai, so the developer doesn't
     grade himself. **She writes it after the build and before review** (U2, R2-C4): build →
     checks → E2E written → review (Rex reviews the code *and* the E2E test) → QA runs
     everything. One proof covers both (D-16). The test covers the happy path plus one or two key
     failure paths, is tagged with the journey ID `J-n` and the AC IDs (D-35), is committed with
     the ticket, and runs in CI. Acceptance-test-first (ATDD) comes in Milestone D for high-risk
     tickets (D-23).
  4. **Other ACs** are covered by AC-tagged unit and integration tests (seen by `mirai trace`)
     plus Ivy's QA evidence.
  5. **New critical journeys** are proposed by Ivy or Tess and approved by you.
  6. **E2E runs in a container:** `run_tests(level: "e2e")` with the official Playwright image
     next to the project's containers (D-48). No host browser in overnight runs.
     - **Exploratory QA overnight** (R2-M8): Ivy writes a throwaway Playwright script that runs
       through `run_tests(level: "qa-explore")` and returns screenshots and output into the store.
       It isn't committed.
  7. **Playwright MCP is allowed only in interactive daytime sessions.**
  8. **E2E files are protected from Kai.** Touching or deleting them trips the floor guard.
  9. **Stable selectors** (`data-testid`, ARIA roles from the feature map). A flaky test is re-run
     once (D-18).
  10. **A suite time budget** in config (e.g. under 10 minutes). Going over is flagged in the
      report.
  11. **No Playwright in the project:** setup offers a minimal container-based setup with your yes.
      Otherwise it's QA verification only, and the report says "no E2E suite".
- **Consequences:** the suite grows with critical journeys, not with features. Most ACs are proven
  at a cheaper level.

### D-45 · Test levels per repo; existing projects use a ratchet

- **Context** (`08` Q8):
  - Version 2 only detected test commands for the quality gate, and quietly assumed a project
    with healthy tests.
  - Many projects you'll install MIRAI in were built without AI: partial unit tests, few
    integration tests, no TDD, and sometimes other developers working in the same repo.
- **Decision, test levels:**
  1. **Detect, then ask the gaps:** frameworks, test folders, commands, and how they run in Docker,
     per repo or service.
  2. **One config entry per level** (`unit`, `integration`, `api`, `e2e`, `contract`, …): the
     command (run through `run_tests`, D-48) and its test-adapter contract, its
     purpose, when it's required (e.g. `api` for
     endpoint changes, `e2e` only for critical journeys, D-44), and a time budget.
  3. **The plan names a level for each AC:** the lowest level that really proves it. Rex flags a
     test at a needlessly high, expensive level.
  4. **Missing levels: suggest, never force.** Setup offers a minimal setup with your yes;
     otherwise the level stays off.
  5. **Multi-repo** (D-42): a `contract` level is suggested, so the interface ticket ships with a
     contract test.
  6. **Recommended minimum** (setup recommends it, you decide): unit plus one of integration/API,
     plus E2E for critical journeys only.
  7. `tdd`/`tests` (D-23) decide when and whether tests are written; the levels decide which kind.
- **Decision, existing projects: don't fix the past, protect the future (a ratchet):**
  1. **Setup records a test baseline:** existing levels, run times, coverage if available, and the
     tests that already fail or are flaky. **The orchestrator refreshes it from `main` at the
     start of every run** (R2-M7), so it never goes stale. Only that refresh moves the baseline;
     no agent can edit it.
  2. **The gate checks "nothing new broke".** Known failures are listed in the report but don't
     block; new failures block.
  3. **Diff coverage, not file coverage.** Only the lines a ticket changes need tests. Unchanged
     code in the same file doesn't count.
  4. **Characterization tests only for the functions or methods the ticket changes,** written
     before the change. Not the whole class or file.
  5. **The plan lists them in advance,** so they're visible at the plan gate.
  6. **Rex flags tests for unchanged code** as an out-of-scope finding.
  7. **No automatic test-debt work.** Setup only reports the gaps in the baseline. Test-debt
     tickets exist only when you ask for them.
  8. **Untested areas raise ticket risk,** which means a deeper review and stricter gates.
  9. **The existing test style wins** (D-20).
- **Human developers in the same repo:** the hard gates apply only to registered MIRAI branches
  and commits with the `Mirai-Ticket` trailer, and the scope fails closed (D-15, D-50).
- **Consequences:** coverage improves only where work happens. Old untested code stays untested
  until a ticket touches it, which is intended.

### D-46 · Retention: local work files are kept 90 days, metrics are kept

- **Context** (`08` Q9): every ticket produces bulky local files (screenshots, transcripts, full
  logs, review and QA text). After 200 tickets that's gigabytes nobody reads, and forever-kept
  text risks being loaded as context.
- **Decision:**
  1. **Product documents are kept forever and retired by status** (`superseded`/`obsolete`).
     Retired ones are excluded from agent context automatically. Optional `mirai archive` moves
     them to an `archive/` folder, only when you run it.
  2. **The retention rule** (how long a file is kept before it may be deleted):
     - **review and QA text, screenshots, transcripts and full logs:** 90 days after the merge
       (configurable). Parked or unfinished tickets keep everything until they're resolved;
     - **structured finding and metrics data** (severity, category, file, outcome; AC PASS/FAIL;
       rounds, tokens, time, tier): kept. Only `mirai metrics` reads it, so it costs zero tokens.
       An optional setting compacts it into monthly totals after a year.
  3. **Agents never load past reviews or metrics data as context.** A recurring insight becomes a
     lint rule or a convention line instead.
  4. **Deletion is never silent.** `mirai clean` lists what will go and the space freed, then asks
     for your yes. The morning report notes when something is due. Automatic deletion is off by
     default.
- **Edge cases** (R2 Minor): a stacked child keeps its parent's work files until the child
  merges; a reopened ticket (MR comments after merge, `mirai escape`) restarts its 90 days;
  dropped tickets count from the drop.
- **`mirai clean` arrives in MVP-complete** (see `07`), because nothing is due for 90 days.
- **Consequences:** after 90 days the full wording of a review is gone. Its structured data is
  enough for the metrics and for checking reviewer quality (M5).

### D-47 · The orchestrator store lives outside the project

- **Context:** version 2 and 3 put the store, the trust root, the launch tokens and the git hooks
  under `<project>/.git/`. That is inside the project, which the sandbox and deny rules leave
  open to agents (R2-C1, found by two reviewers). An agent could reset its rounds, edit the next
  launch's `strict.json`, plant a hook that runs outside the sandbox, or write a verdict the CLI
  would sign.
- **Options:**
  - Keep it in `.git/` and add deny rules for it.
  - A separate macOS user for the store.
  - **A per-repo folder in your user's Application Support, denied to agents.**
- **Decision:** the store is `~/Library/Application Support/mirai/<repo-id>/`.
  - `<repo-id>` is derived from the repo's first commit and its remote URL, so it survives moving
    the checkout.
  - **It's split by trust** (R3-C3, TL3-7):
    - **`store/`** (denied to agents, read and write): `state.json`, `journal.jsonl`,
      `heartbeat.json`, `ledger.json`, `run.lock`, `runs/`, `parked/`, `tickets/<ticket>/`
      (status and work files under retention), `metrics/`, `baseline/`, `reports/`, `cache/`,
      `branches.json` (the local index of registered branches, D-15), `config.user.toml`;
    - **`trust/<base-sha>/`** (the trust root; readable, write-denied): skills,
      agents, prompts, `strict.json` per role, `mcp.json`, hook scripts;
    - **`hooks/`** (the git hooks; `core.hooksPath`, hash-checked);
    - **`input/<launch>/`** (read-only, one launch only, deleted after) and **`scratch/<run>/`**
      (agent-writable, never trusted);
    - **`gitconfig`** (the MIRAI-owned minimal global git config, D-15) and **`tmp/`**.
  - `store/` and `hooks/` are denied to agents by the sandbox (`denyRead`/`denyWrite`) and by
    explicit `Read`/`Edit` deny rules; `bundle/` is write-denied (D-30). The red-team suite reads
    and writes each of them.
  - Agents are also denied writes to `.git/**` (sandbox `denyWrite` and `Edit` deny) and
    `git config`. Host git runs pinned and integrity-checked (D-15, D-54).
  - **Agents never read or write the store.** What they need comes in through the input folder,
    and what they produce goes out as structured output or through the broker (D-12, D-53).
  - In a multi-repo workspace the store belongs to the workspace repo's `<repo-id>` (D-42, D-51).
- **Consequences:**
  - `.mirai/config.user.toml` and `.mirai/cache/` move out of the work tree. Gitignored files in
    the work tree are no longer trusted by any run (R2-C1, AR2-10).
  - The store is tied to this machine (D-52).

### D-48 · Agents run tests through a `run_tests` MCP tool, never a shell exception

- **Context:** version 3's `mirai exec test <suite>` was a Bash wrapper and the only sandbox
  `excludedCommands` entry (R2-C2):
  - its `dontAsk` allow rule was never written, so headless runs couldn't run tests at all;
  - as a shell command, `$(...)`, PATH shadowing and env-prefix variants were likely bypasses;
  - it ran `docker compose` unsandboxed on inputs the branch controls: an auto-loaded
    `compose.override.yml`, `.env` interpolation, `COMPOSE_FILE`, Dockerfiles. A container that
    mounts the repo root can write `.git/hooks` or `core.fsmonitor`, which host git then runs.
- **Decision:**
  1. **A small MIRAI MCP server from the trust root** exposes one tool,
     **`run_tests(level, path?, script?)`**:
     - `level` is a configured test level (`unit`, `integration`, `api`, `e2e`, `contract`, …,
       D-45), a **named check** (below), or `qa-explore` (Ivy's throwaway Playwright script,
       D-44). An unconfigured name is refused;
     - `path` is an optional file or test ID. It must match `^[A-Za-z0-9_][A-Za-z0-9_./:@-]*$`,
       its `realpath` must be inside the project, and it's passed after `--`, with
       adapter-specific escaping for test-ID filters (R3-M6, TL3-17);
     - `script` carries Ivy's `qa-explore` script **as content**, never as a path (AR3-3);
     - there is no shell; the server builds the command itself and calls it with `execFile` and
       an explicit minimal environment (never its own, which holds the token);
     - it returns structured results **inline**: pass/fail per test (JUnit XML), coverage (lcov or
       Cobertura), text output (capped) and screenshots as MCP image content. It also stores
       them in the store.
     - **Built in unit 14d** as two tools, `run_tests(level, path?)` and `run_check(name)` (the
       roadmap's split). Until unit 16, `path` is a file or folder only (no `:` test IDs) and
       results are the outcome, exit code, output tail and the output folder's file list; `script`
       comes with `qa-explore` (unit 51). Only `mirai test --gate` signs a result; an agent's
       runs are stored unsigned (`by: "agent"`).
  1a. **Named checks** (R3-C2, PM3-3, TL3-1): `lint`, `types`, `build`, `gate` and any other
      check the project's quality gate needs are configured by name in the trust-root config.
      Setup translates the project's gate script into named checks and test levels; a gate step
      that can't be expressed that way is shown to you and stays off for agent runs. Agents run
      them with `run_tests(level: "lint")` and nothing else. **Agents can't install packages or
      run generators.** A ticket that needs a new dependency is high risk: the plan names the
      package, you approve it at the plan gate, and the orchestrator installs it from the
      **integration branch's** manifests before the session, in a container with network that
      mounts only the manifests and lockfiles, with lifecycle scripts off where the ecosystem
      allows (TL3-3).
  2. **The compose call is built only from trust-root files:** a pinned list of compose files
     (`-f` for each), no override auto-load, `--project-directory` set, an env file from the trust
     root, and `COMPOSE_*` variables cleared.
  3. **Resolve once, freeze, run the frozen file** (R3-M6, TL3-6). `docker compose config
     --format json` → validate → write `<mirai-home>/<repo-id>/store/runs/<id>/compose.resolved.json`
     → `docker compose -p mirai-<repo-id>-test-<run> -f <frozen> up --no-build --pull never`. (Built in unit 14c as `<store>/tests/<id>/compose.frozen.json`, since `runs/` holds the run logs, with the project `mirai-<repo-id>-t-<id>`.) The
     project name is unique per run, so it can't collide with your daytime stack. All paths are
     absolute trust-root paths.
     - **The validator is an allowlist:** image, command, environment from `.env.test`, volumes =
       the project source **with `.git` and every real `.env*` masked** (an empty tmpfs or volume
       over each, required by the validator, D-49), the one internal network, `depends_on`,
       healthcheck, `working_dir`, `user`. Anything else is refused: host mounts, the docker
       socket, privileged mode, host network, added capabilities.
     - After start, `docker inspect` confirms the mounts and networks. `down -v` runs before and
       after.
     - **`run_tests` never builds:** the orchestrator builds images from the integration
       branch's Dockerfiles before the session (TL3-3).
  4. **Compose files, Dockerfiles and `.env*` are protected paths** (D-15).
  5. **The test-adapter contract per stack** (R2-M7): run one file or test ID; JUnit XML results;
     lcov or Cobertura coverage. MIRAI ships small zero-dependency parsers for exactly those
     formats (D-40). A stack without one of them gets a project adapter at setup.
  6. **The sandbox has no `excludedCommands`.** The MCP server runs outside the sandbox, so it's
     MIRAI's own small, tested code with fixed behaviour.
- **Consequences:**
  - Partial runs (one file) avoid the Bash 10-minute limit; full suites run in the background
    with the result polled.
  - Some compose facts (override auto-loading, `COMPOSE_FILE` handling) are UNVERIFIED and tested
    in the unit (`research/09` §8).

### D-49 · Test containers get no outside network and only dummy secrets

- **Context:** `echo $CLAUDE_CODE_OAUTH_TOKEN` works whatever `env`/`printenv` denies say. An
  agent can write the token into a file, and a test container with open network can send it
  anywhere. The containers also held the real `.env` secrets (R2-C3).
- **Decision:**
  - Containers started by `run_tests` for agent-triggered tests run on an **internal network**:
    the project's own services can talk to each other, nothing reaches the internet, and there's
    no outside DNS (red-team, D-30).
  - **`.git` and every real `.env*` are masked** in the container mounts (R3-C4, TL3-2). The
    validator refuses a resolved config without the masks.
    **Since unit 14c** (your decision with its spec): not masked but left out. Test containers
    mount a fresh copy of the project per run, without `.git` and real `.env*` files, since masks
    over files leak through another case of the name on macOS (research/11).
  - Setup creates **`.env.test` with fake values**. It's committed (fake values only) and is a
    protected path (AR3-11). The real `.env` is never mounted for agent runs, and setup adds each
    real `.env*` path as an exact sandbox `denyRead` (D-30). A project that needs a real outside service in tests gets a mock or stays a manual
    check.
  - The secret scan and the Write/Edit hook match the **exact value** of the login token as well
    as the patterns (D-30).
  - `WebFetch` and `WebSearch` are denied in headless runs.
- **Consequences:**
  - Integration tests that call real third-party APIs don't run in agent runs. They run in CI or
    by you.
  - Residual risk: the token may stay readable by the agent (G9). It has no *known* route out
    (D-30's residual-risk statement).

### D-50 · Only the orchestrator commits; MIRAI branches are registered

- **Context:** "agents don't commit" wasn't enforced, and nobody defined when commits happen,
  though the proofs, stacking, parking and checkpoints all depend on it. A missing trailer
  silently exempted a branch from the gates. You couldn't take over a MIRAI branch by hand
  (R2-M4).
- **Decision:**
  - Agents are denied `git commit`, `git push` and `git config` (D-30).
  - **The orchestrator commits at fixed points:** stub, tests written, build, fix round, E2E
    written, always with the `Mirai-Ticket` trailer. The plan isn't a commit point; it lives in
    the store (AR3-3). Each commit is also a checkpoint ref (D-18).
  - **Before every commit** (R3-M8): the agent's process group is gone (D-12), the
    `git status --porcelain=v2 --ignored` hash is unchanged since the last check, and the
    git-integrity hash matches (D-54).
  - **Docs branch** (R3-M12, AR3-9): document commits are made by the CLI with a
    `Mirai-Docs: <initiative>` trailer, through `git commit-tree` against the docs branch. Your
    checkout is never switched. The docs branch is registered, and its gate is: every changed
    document under `<docs_root>` has a signed approval of its exact content hash, and the
    code-path diff is empty.
  - **Every branch MIRAI creates is registered** with a signed `branch.json` in its first commit
    plus the local index (D-15). The gate scope fails closed, locally and in CI.
  - **`mirai handover <ticket>`** gives a branch to you: it commits a signed `handover.json`,
    the MIRAI gates stop applying beyond `at_sha` (CI checks only the secret scan), and the
    ticket leaves MIRAI's queue.
- **Consequences:** commit history on MIRAI branches is regular and predictable. Squashing at
  merge is your choice on the host.

### D-51 · In a workspace, proofs live in the service repo

- **Context:** in multi-repo mode (D-42) the records, approvals, gate config and traceability
  inputs lived in the workspace repo, while the MR, `pre-push` and CI run in the service repo.
  "Facts travel with the MR" broke, and a ticket had two base commits (R2-C7).
- **Decision** (built in Milestone D, designed now so the record path is right from the start):
  - **Per-ticket proofs are committed on the service repo's ticket branch,** because they're
    about that repo's code.
  - **Documents and approvals live in the workspace repo.**
  - **Each service repo's lock pins** the workspace's public-key fingerprint set and the gate
    config version, so its `pre-push` and CI can verify proofs without reading the workspace.
    `mirai update` refreshes the fingerprint set, so a key rotation is one command across the
    repos (AR3-10). Proofs in workspace mode carry both base SHAs (AR3-15).
  - **`mirai trace` runs from the workspace** at ship time and its result goes into the service
    repo's proof (D-35).
  - The orchestrator store belongs to the workspace (D-47).
- **Consequences:** the record path in the MVP is already per repo, so workspace mode adds repos
  without changing the proof format.

### D-52 · The MVP assumes one machine

- **Context:** round 2 noted that a second (or lost) machine loses the round counters, the inbox
  and the metrics (R2-M5). The Architect proposed committing exported log lines as a portable
  ledger. That conflicts with your Q9 decision that work data stays local.
- **Decision** (U3): the MVP runs on **one machine**, and says so in `doctor` and the docs.
  - Q9 is kept: no run-log lines are committed.
  - A later `mirai export` / `mirai import` moves the store between machines.
  - A second machine, if you add one, needs its own signing key pair (D-17).
- **Consequences:** if the machine is lost, round counters and metrics history are lost. The work
  (branches, MRs, proofs, documents) survives in git and on the host.

### D-53 · One MIRAI MCP broker is the only channel from a sandboxed session to MIRAI

- **Context:** workflow skills in your session called `mirai agent run`, `session start/end`,
  `lint` and `trace`; agents called `mirai log`; supervised launches polled a file in the store.
  All of these run inside the sandbox, which denies the store, so either the flows break or a hole
  reopens R2-C1 (R3-C3, AR3-2, TL3-8).
- **Options:**
  - Allow the sandbox to reach the store. Reopens R2-C1.
  - A `mirai` daemon on a local socket. Another listener to harden.
  - **A narrow MCP server from the trust root**, built the same way as `run_tests` (D-48).
- **Decision:** the **MIRAI MCP broker**, from the trust root, running outside the sandbox with
  structured arguments only:
  - `log_event(type, …)`: privileged types (approval, record, gate result, human-only status)
    aren't in the enum;
  - `start_agent(role, item)` and `agent_status(id)`: for workflow skills in **your** session.
    The launch token is minted and consumed inside the broker and never shown to the session;
  - `session_start` / `session_end`;
  - `lint(doc)` and `trace(item)`: read-only.
  - **The interactive `mcp.json`** gets the broker and `run_tests`. **The headless `mcp.json`**
    gets only `run_tests` and `log_event`, never `start_agent`, so the recursion guard holds by
    construction.
  - **No sandboxed process calls `mirai`** (`Bash(mirai *)` is denied, D-30). The plain binary is
    for your terminal and the orchestrator.
- **Consequences:**
  - The interactive bundle denies the store exactly like the headless one; the daytime flow uses
    only broker verbs.
  - Whether a nested `claude -p` started by an MCP server outside the sandbox gets its own fresh
    sandbox is UNVERIFIED (G24) and tested before supervised launches rely on it.

### D-54 · `.git` and auto-run config are protected and integrity-checked

- **Context:** round 3 found `.git/` still writable from Bash and from test containers. Code
  written there (`filter.*.clean`, `core.sshCommand`, `credential.helper`, `include.path`,
  `.git/hooks/*`) runs outside every sandbox when you, your IDE or the orchestrator run git, with
  your credentials. Agent-written config that runs on its own (`.vscode` tasks, `.envrc`,
  `.husky`, `package.json` scripts) fires when you open the branch (R3-C4, AR3-1, AR3-12, TL3-2).
- **Decision:**
  - **Write-deny `.git/**`** in the sandbox and for `Edit`; **mask `.git`** in every test
    container (D-48, D-49).
  - **Integrity hash:** setup records a hash of `.git/config`, `.git/info/**`, the `.git/hooks/`
    listing and the ref list. The orchestrator re-checks it before every git call and before and
    after every agent launch and `run_tests` call. A mismatch stops the run. The hash is the real
    control, because the list of dangerous config keys is open-ended.
  - **Pinned host git** (D-15): `GIT_CONFIG_NOSYSTEM=1`, MIRAI's own `GIT_CONFIG_GLOBAL`, `-c`
    pins, `--no-ext-diff --no-textconv`, push to an explicit URL.
  - **Auto-run config and files that hide code** are protected paths (D-15). Auto-run paths
    park in **both** presets, so you review them on the host before you check the branch out.
    The reviewer's diff runs with `--text --no-textconv --no-ext-diff`.
  - **Every run ends on the integration branch** with a clean tree. The morning report lists any
    MR touching auto-exec paths at the top, with a warning not to open it in your IDE before
    reviewing it on the host.
- **Consequences:** a ticket that legitimately changes editor or hook config always needs you.
  That's intended.

### D-55 · The sample app is a private repo in the pilot's stacks

- **Context:** the sample app lived inside the public MIRAI repo, in an unspecified stack. Milestone
  A's exit MR would have opened on the public framework repo, and test adapters built for it
  wouldn't carry over to the pilot (R3-M1, PM3-2, PM3-8).
- **Decision:**
  - The sample app is **its own private repo** (e.g. `mirai-sample-app`), with its own `main` and
    remote. MIRAI is installed at its root exactly like a real project.
  - It uses **the pilot's stacks**: a Laravel/PHPUnit API, a React/Vitest UI, Playwright, and
    Docker Compose. So the first milestone's test adapters carry over unchanged.
  - The MIRAI repo keeps only small test fixtures.
  - Setup detection (the script part of setup, no AI) moves into the first milestone, so the pilot
    checkpoint gets its config, test levels, baseline and branch pattern from detection, not by
    hand. The pilot checkpoint is a sized step of its own (see `07`).
- **Consequences:** the first milestone's exit MR opens on a private repo you control. A second
  stack is first exercised by the reuse test (D-38).

### D-56 · The orchestrator merges the docs MR after your ticket-set approval

- **Context:** documents reach the integration branch through a docs MR (D-06). Merging it was one
  more action for you per feature, and a night couldn't start until it was merged (PM3-7).
- **Decision** (your decision V3, round 3): after your **signed ticket-set approval**, the
  orchestrator merges the docs MR.
  - It's the same pattern as merges into `feature/<epic>` after an inbox approval (D-33): the
    decision is yours and signed; the orchestrator only performs it.
  - **Documents only.** The docs MR's gate requires an empty code-path diff and a signed approval
    of every changed document's exact content hash (D-50). `mirai-verify` checks the same in CI.
  - **Code is never merged by MIRAI** (D-22).
- **Consequences:** one action less per feature, and approved documents are on the integration
  branch before the night starts.

### D-57 · One usage budget across all projects

- **Context:** the usage pass mark (D-38: one night uses at most 15% of the weekly limit) was
  written for one project. You'll run MIRAI on several projects on one subscription (Max 20x
  today, possibly another plan later), so per-project caps could add up past your limit.
  Agreed on 2026-10-23, at the start of implementation.
- **Decision:**
  - **A global config** in `~/.config/mirai/config.toml`, outside every project and denied to
    agents like the signing key. It holds only:
    - `[subscription] plan` (e.g. `max-20x`): informational, recorded with every run;
    - `[usage] night_max` (default 15): the share of the weekly limit all MIRAI runs together
      may use in one night;
    - `[usage] week_max` (default 60): the same, for the week;
    - `[usage] reserve` (default 40): MIRAI starts no new ticket when less than this share of
      the weekly limit is left, whatever used it (your daytime work included).
  - **A global usage ledger** in `~/Library/Application Support/mirai/global/`, next to the
    per-repo homes. Every run appends its limit share there, with the repo id and plan.
  - **One MIRAI run at a time across all projects** (a global run lock). Simple, and it keeps the
    shared budget honest; parallel runs are Later.
  - **Checked before every ticket**, not only at run start. When the next ticket could break a
    cap, the run stops cleanly like `run.stop_by` and the report says which cap.
  - **A plan change** is one value. `doctor` then warns that the limit-share numbers from
    calibration were measured on the old plan.
- **Personal, never in a repository.** Your plan and usage caps are about you, not the project.
  In a project many developers share, each person's MIRAI reads their own global config. So
  **no project file holds subscription or usage settings**, and the config loader rejects
  `[subscription]` or `[usage]` in `.mirai/config.toml`.
- **Consequences:** projects never need usage caps. The 15% pass mark in D-38 now means "all of
  your MIRAI runs together".

### D-58 · Any model may be mapped to a tier; MIRAI shows which model runs judgement work

- **Context:** D-14 fixes judgement steps (PRD, design, high-risk review) to the `deep` tier, and
  config maps each tier to a model. A personal file could map `deep` to a small model, which
  would quietly downgrade judgement work. Both 03b reviewers flagged it (2026-10-23).
- **Decision** (your choice): **freedom with visibility.**
  - Any model may be set for any tier, in the project file or in your personal per-repo file.
  - The defaults stay: `light` = Haiku, `standard` = Sonnet, `deep` = Opus (Fable also counts
    as deep).
  - **A model outside its tier's usual family is a warning, not an error.** `mirai config check`
    always prints the model of each tier and where it was set, and the warning names what runs
    on that tier.
  - **Every run shows the model actually used for judgement steps:** the launcher logs it
    (unit 19), and the run report and morning report show it per PRD, design and high-risk
    review (units 29 and 56).
- **Consequences:** D-14's rule still holds at the tier level (judgement steps always use
  `deep`); what `deep` means is your choice, made visible.
