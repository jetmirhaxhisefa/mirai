# Round 1 review: Tech Lead lens

Reviewer: independent Tech Lead (daily practicality, cost, failure handling, maintainability,
determinism of the loop rules, budget enforcement, overnight security, design-vs-research fidelity).

Read in full: design `00`, `01`, `02`, `03`, `04`, `05`, `07`; research `08`, `04`, `06`, `06b`.
Skimmed: research `02`, `03`. Spot-checked (read-only, nothing executed):
- pilot `docker-compose.yml`, `scripts/quality-gate.sh`, `scripts/quality-gate.local.sh`, `.gitignore` status of `backend/.env`;
- `research/_sources/bmad-loop` (`docs/reference/configuration.md:80-106`, `data/profiles/claude.toml`,
  `statemachine.py`, `codex_trust.py`, `workspace_trust.py`, `recovery_flow.py`, size of `src/bmad_loop/*.py`);
- `research/_sources/cursor-plugins/pstack/skills/poteto-mode/playbooks/shipping.md`.

One harmless probe was run in my own agent shell: opening `/dev/tty` (result under TL-10).

**Overall verdict:** the document flow (PRD → design → tickets) is sound and buildable. The
per-ticket build loop and the overnight mode are **not yet implementable as written**. Four
problems would make the first real run fail or give false confidence: the worktree model against
the pilot's Docker toolchain, the overnight security model, gate integrity, and how tree-hash
records interact with post-review writes and CI. Most fixes are small design changes, not rewrites.

Severity counts: **Critical 4 · Major 13 · Minor 9**.

---

## 0. Cost, latency and friction model (estimates the design is missing)

### 0.1 Agent runs per ticket (headless launches through `mirai agent run`)

| Ticket type | Happy path | Each extra fix round adds | Typical, with 1 fix round |
|---|---|---|---|
| `normal` | plan 1 + build 1 + review 1 + QA 1 = **4** | build 1 + review 1 (+ QA 1 if QA failed) = 2–3 | **6–7** |
| `high` | plan 1 + plan verifier 1 + build 1 + lenses 6 (blind, edge, verification gap, intent, security, architecture) + per-finding confirm k (≈2–4) + QA 1 = **12–14** | build 1 + review (1, or 6 if the lenses re-run: not specified) + confirm k | **16–22** |

Notes:
- A check failure (`01` §8, `01-workflow.md:412`) also launches a **new cold-start developer
  session** and uses one of only 2 rounds.
- Token scale: bmad-loop measures "healthy sessions run ~1-2.5M weighted tokens", cache-discounted
  (`bmad-loop/docs/reference/configuration.md`, `max_tokens_per_session` row). Its advisory
  per-story cap is 2M (`max_tokens_per_story`). A MIRAI build session is the same kind of work.
  Review, verifier and QA runs are smaller, but QA with browser snapshots is not small.

### 0.2 Agent runs per feature

| Track | Document stage runs | Ticket runs (example set) | Total headless runs |
|---|---|---|---|
| `quick` (1 ticket) | 0 | 4–7 | **4–7** |
| `standard` (5 tickets, 1 high) | PRD verifier 1–3, ticket verifier 1–3 | 4 × 6 + 1 × 18 ≈ 42 | **≈ 45** |
| `full` (7 tickets, 2 high) | + HLD/ADR/LLD verifier 1–3 | 5 × 6 + 2 × 18 ≈ 66 | **≈ 70** |

On top of that come the in-session authoring runs (PM, architect, ticket planner).

The proposed budgets (`05-open-questions.md:38-44`: S $2 / M $5 / L $10 per ticket, $40 a
night) have **not been checked against these numbers**. If one healthy build session is 1–2.5M
weighted tokens, a single S build run on an Opus-tier model can use up the whole S budget before
review starts. This needs a calibration run in unit 31 before any defaults are written (see TL-8).

### 0.3 Human gates per feature (supervised preset, `01` §16)

Per feature: track + PRD + design + tickets = **4**. Per ticket: plan + push + MR + merge =
**4**. For a 7-ticket `full` feature that is **4 + 28 = 32 TTY approvals**, plus disputed
findings and the production release. Each one needs a separate real terminal (TL-10). In
`autonomous` mode it is still 4 + 7 merges + every high-risk plan. That load will push the user
to rubber-stamp, which is exactly what M6 is meant to catch.

---

## 1. Critical

### TL-1 · Critical · One worktree per ticket does not work with the pilot's toolchain: checks and QA would test the main checkout (false green)

- **Where:** `04-decisions.md` D-18 ("one git worktree per ticket"), D-24, D-30;
  `03-components.md:33`, `:166` (`worktrees/`); `01-workflow.md:374`, §8, §10.
- **Evidence (pilot, read-only):**
  - `docker-compose.yml` fixes the project name (`name: hr-platform`) and bind-mounts relative
    paths: `./backend:/var/www/html` and `./frontend:/app`.
  - `scripts/quality-gate.local.sh` runs every check through
    `docker compose exec -T app|frontend …` against the **already running** stack. It refuses to
    run unless the `app` and `frontend` services are up.
  - So `scripts/quality-gate.sh` started from `.mirai/worktrees/<ticket>/` finds the same
    `hr-platform` containers, and those mount the main checkout's `./backend`, not the worktree's.
    The gate goes green on code that does not contain the ticket's change.
  - QA on `http://localhost:8000` / `:8080` would also exercise the main checkout.
  - `backend/.env` is gitignored (`backend/.gitignore:3`), and compose needs it as `env_file`. A
    fresh worktree lacks it, so `docker compose up` from the worktree fails.
  - The ports are fixed (8000, 8080, 3306, 8025, 1025), so two stacks cannot run side by side.
  - bmad-loop has to "seed" gitignored files into worktrees (`data/profiles/claude.toml`,
    `seed_files`) for the same reason.
- **Why it's critical:** the whole "machines first" premise (L6) and the review/QA records rest
  on the checks running against the ticket's code. Here they wouldn't, and nothing would notice.
- **Fix:**
  1. **MVP (sequential anyway, D-24):** drop worktrees. Use one checkout. The orchestrator runs
     `git switch -c <ticket-branch> <base>` in the main checkout, and the running stack follows the
     checkout. Add a pre-step guard: clean tree, right branch, stack healthy.
  2. **When parallel lanes come:** a per-worktree environment contract in config:
     `env.isolate = "compose-project"` (`COMPOSE_PROJECT_NAME=mirai-<ticket>`, a port-offset
     override file, seeded gitignored files listed in config, a per-lane DB).
  3. **Setup must detect the problem:** a toolchain bound to the checkout path (bind mounts,
     a fixed compose `name:`, fixed ports). Record it in config as `worktree_safe = false`.
  4. **Self-test in unit 29 or 30:** `doctor` makes a trivial marker change in the ticket
     checkout and proves the gate *sees* it.

### TL-2 · Critical · The overnight security model relies on command allowlists, but the agent writes the code it then runs

- **Where:** `04-decisions.md` D-30 (`:414-436`); `03-components.md:45-47`; `research/08` §5.4.
- **Problem:**
  - A TDD developer must run the test command, so `Bash(npm test *)`, `Shell(npm)`,
    `docker compose exec …` or the quality gate is always allowed. The agent writes the test file
    first. So any allowed test command is **arbitrary code execution chosen by the agent** (or by
    a prompt injection in ticket, PRD or Jira text). That code inherits:
    - the process env, including `ANTHROPIC_API_KEY`, and `CURSOR_API_KEY` / `CODEX_API_KEY` if present;
    - the user's home directory: `~/.ssh`, the `gh` auth token, the git credential helper, `~/.aws`;
    - the network.
  - Deny rules such as `Bash(git push *)`, `Bash(curl *)` and `Shell(git)` (`research/08:297-298`,
    `:333`) only stop the agent from typing those commands. They do not stop
    `child_process.exec('git push')` inside a test.
  - Codex `workspace-write` with network off is a real OS sandbox (`research/08:148-149`).
    Cursor `--sandbox enabled` blocks the network (`research/08:214`).
  - **The Claude Code profile in D-30 has no OS-level sandbox at all.** `dontAsk` +
    `--allowedTools` is a permission layer, not a sandbox.
  - In the pilot every test runs through `docker compose exec`. Allowing an agent to call
    `docker` is root-equivalent on the host: it can mount `/` into a container.
  - D-30 itself says "Recommended later: a disposable container or VM", and `research/08:286`
    says the vendors require it before bypass-style use.
- **Fix:**
  1. Make the autonomous preset **refuse to start** unless an OS-level boundary is configured. In
     order of preference:
     - (a) a devcontainer or VM per run (move it from "Later #12" to before unit 54);
     - (b) Claude Code's own Bash sandbox setting with a network allowlist (localhost plus the model
       API). This is **not covered in `research/08`, so research it first**;
     - (c) at minimum, a dedicated macOS user with no SSH keys, no `gh` login and no cloud
       credentials.
  2. Never give an agent role `docker`. The orchestrator starts the stack, and the agent gets a
     narrow wrapper (`mirai exec test <suite>`) that runs a fixed command. Agent-written tests
     still run, but the blast radius is the container.
  3. The `gh` token and push credentials live only in the orchestrator's environment. Agent
     processes get a scrubbed env (`env -i` plus an allowlist).
  4. Use a model API key with a provider-side spend limit, so a leaked key has a ceiling.
  5. Add "untrusted text" fencing for every connector read (`06b` already asks for it for
     mattpocock and Atlassian), and log any agent attempt to reach a non-allowlisted host.

### TL-3 · Critical · The agent can edit the gate it is gated by, and the record-forgery mitigations are circular

- **Where:** `04-decisions.md` D-15, D-16 (`:276-279`), D-17; `03-components.md:54-55`; `01` §11.
- **Problem:**
  - **CI gate:** the job template is a workflow file in the project repo. On a GitHub
    `pull_request` event the workflow definition comes from the PR's own ref. So a ticket diff that
    touches `.github/workflows/mirai-gate.yml` can weaken or no-op the required check, and the
    check still reports green.
  - **Git hooks:** if `core.hooksPath` points into the repo (e.g. `.mirai/framework/hooks`), the
    agent can edit the hook script that the orchestrator then runs **outside any sandbox** at
    commit or push time.
  - **Records:** D-16's mitigations are:
    - deny rules on `.mirai/state/records/`. These don't apply to code the agent executes (TL-2);
    - "CI cross-checks each record's run id against the run log". The run log is in the same
      repo, in the same branch, and writable the same way. A forged record plus a forged log line
      passes.
  - **D-17:** pre-commit accepts a human-only status if "the run log has a matching approval
    event". Writing that event takes only `echo '{"type":"approval",…}' >> .mirai/state/runs/x.jsonl`,
    with no TTY involved.
- **Fix:**
  1. Keep a **protected-path list** in config, with defaults: `.github/**`, CI files,
     `.mirai/**`, `AGENTS.md`, `CLAUDE.md`, `.claude/**`, `.codex/**`, `.cursor/**`, `.agents/**`,
     hook paths, lint configs and test thresholds. Any ticket diff touching it is forced to `high`,
     the floor guard flags it, and the MR title is tagged `[touches-gate]`. In autonomous mode the
     run parks before commit. It joins the floor guard (unit 46).
  2. Install hooks from the pinned package outside the work tree, e.g. a hooksPath under
     `$(git rev-parse --git-common-dir)/mirai-hooks`, written by `mirai init` and verified by
     hash against `mirai.lock` before every orchestrator commit or push.
  3. The CI job verifies its own workflow file and `.mirai/framework/` against the
     **base branch's** `mirai.lock` (checked out separately), and fails if they differ in a PR not
     labelled as a framework update.
  4. Records and approval events carry an HMAC with a key in `~/.config/mirai/key`. Agent
     sandboxes can't read it (TL-2 boundary). `mirai log` refuses approval/record event types.
     Then document the honest limit: on a host with no boundary, records stop accidents, not a
     determined agent.

### TL-4 · Critical · Tree-hash records invalidate themselves, and they break on GitHub's PR merge ref and on every rebase

- **Where:** `04-decisions.md` D-16 (`:268`: "excluding `.mirai/state/`"); `01` §9 output, §11
  enforcement (`01-workflow.md:519-522`); `05-open-questions.md:103-105`.
- **Problem:**
  1. **Self-invalidation.** After the review record is written, MIRAI itself writes files outside
     `.mirai/state/`:
     - QA writes `qa-<ticket>.md`;
     - the plan's append-only implementation log and review triage log are updated
       (`01-workflow.md:345-347`);
     - the ticket's frontmatter status moves `in-review → built` (`01` §11);
     - MR/report/follow-up files are written under `<docs_root>`.

     All of these live under `docs/mirai/…` (`03-components.md:167-168`), so the hash changes,
     and the `pre-push` check fails on MIRAI's own bookkeeping.
  2. **CI computes a different tree.** GitHub's `pull_request` checkout is the synthetic merge
     commit (`refs/pull/N/merge`). Its tree differs from the branch tree whenever `main` has moved,
     so CI's "record for the current tree" check fails on every MR opened before an earlier one
     was merged, even with no conflict. This is the normal overnight case.
  3. **Rebase.** `05` §F accepts "a rebase changes the tree, so the review must re-run". With
     TL-16's merge pattern every MR but the first gets rebased, which means a full review + QA
     re-run (6–20 agent runs, §0.1) per morning merge.
- **Fix:**
  - Define the binding precisely:
    `record.patch_id = git diff <merge-base>...<head> -- <code_paths> | git patch-id --stable`,
    where `code_paths` = all tracked files minus a configured `records.exclude` list (`.mirai/**`,
    `<docs_root>/**`, and the protected bookkeeping files).
  - Also store `head_tree` for audit.
  - CI checks out `github.event.pull_request.head.sha`, not the merge ref, and recomputes the
    patch-id.
  - After a clean rebase, the record survives if the patch-id is unchanged. Only the quality gate
    re-runs (pstack's rule, `pstack/skills/poteto-mode/playbooks/shipping.md:7`). Promote this from
    "possible later improvement" to MVP unit 20.

---

## 2. Major

### TL-5 · Major · Where state lives across N ticket branches is undefined, and committed state will conflict

- **Where:** `01` §17 (`:644`: "One file per run … so parallel branches never conflict");
  D-06, D-29; `02` (e); `01` §12 (`mirai sync`).
- **Problem:**
  - One overnight run spans several ticket branches. If `.mirai/state/runs/<run-id>.jsonl` is
    committed on each ticket branch (D-29 says committed), every pair of MRs from the same night
    has an add/add conflict on that file. "One file per run" prevents conflicts between runs,
    not within one run.
  - Ticket and epic statuses live in frontmatter (D-06). In-flight status changes happen in the
    ticket's branch. The orchestrator's view of "which tickets are ready" reads… which checkout?
  - `mirai sync` sets `done` after the merge. That means writing to `main`, either by CI pushing
    to main or by a dirty local `main`. The design gives agents no push to main.
  - An epic file updated by several branches conflicts too.
- **Fix:**
  1. Log path `runs/<run-id>/<ticket-or-doc-id>.jsonl`: one file per (run, item), and only that
     item's file goes on its branch.
  2. Live orchestration state goes in a gitignored `.mirai/state/live/` in the main checkout. It
     is authoritative during a run and rebuilt from logs plus git on resume.
  3. Derive `done` (and `live`) instead of storing it: a ticket is done when its record's
     patch-id is reachable from `main` (or the git host says the MR merged). No write to main.
  4. Keep frontmatter for document statuses (human-gated, committed on main). Keep in-flight
     ticket status out of frontmatter.

### TL-6 · Major · "Redo a half-finished step from its start" has no rollback mechanism, and counters can reset on restart

- **Where:** Q7 (`00-interview-log.md:149-151`); `01` §14; `07` unit 50.
- **Problem:**
  - A crash mid-build (killed by `--max-turns`, `timeout`, OOM, laptop sleep, Ctrl-C) leaves a
    dirty, half-edited tree. Redoing "from the start" requires knowing and restoring the tree as
    it was when the step began.
  - In round 2 that tree is not `baseline_revision`; it is the end of round 1. Nothing in the
    design records it. The agent never commits (D-30), so there is no natural checkpoint.
  - Not specified either:
    - whether a restart re-grants rounds or budget (BMAD TEA persists rounds so "a restart cannot
      grant three more rounds", `research/02:490`);
    - an orchestrator single-instance lock;
    - an idempotent ship (don't open a second MR);
    - a macOS sleep guard.
  - bmad-loop needed a dedicated rollback and recovery-ref state machine for this
    (`src/bmad_loop/recovery_flow.py` header).
- **Fix:**
  - Before each step the orchestrator writes a checkpoint ref:
    `git stash create` → `refs/mirai/<ticket>/<round>-<step>`, or a WIP commit on a private ref.
    Resume = `git reset --hard <ref> && git clean -fd` (excluding gitignored env files), then
    relaunch.
  - Persist the round, budget-spent and attempt counters **before** each launch.
  - A PID lock in `.mirai/state/live/lock`.
  - `ship` checks for an existing MR on the branch first (`gh pr view`).
  - Wrap overnight runs in `caffeinate -dimsu` on macOS. `doctor` warns when on battery.

### TL-7 · Major · Environment faults are not separated from agent failures (flaky tests, app down, connector down, API errors)

- **Where:** `01` §8 (`:412`), §10 (`:494-495`), L4/L5 (`:444-445`); Q7 connector-down rule.
- **Problem:**
  - A flaky test that fails twice with the same message trips L4 ("same failure twice = plan
    problem") and parks a correct ticket.
  - A broken stack (Docker Desktop not started, MySQL unhealthy, the pilot's known proxy
    mismatch `research/04:64-67`) lets each ticket spend plan + build + review, then park at QA
    with `environment`. All night, ticket after ticket.
  - API 429/5xx, an expired login or a connector outage are counted the same way.
  - bmad-loop explicitly reclassifies transport failures as an *environment fault* so the run
    pauses "instead of charging a dev attempt" (`data/profiles/claude.toml`, comment block under
    `seed_files`).
- **Fix:**
  1. **Run preflight** (fail the whole run fast):
     - the stack is up and the health URL answers;
     - the quality gate is **green on the base branch** (otherwise every ticket inherits red);
     - connectors answer;
     - model auth works (a zero-cost probe);
     - there is disk space.
  2. **Circuit breaker:** 2 consecutive tickets parked for the same non-ticket reason, or 3 API
     errors in 10 minutes → stop the run and say so in the morning report.
  3. **Flaky protocol:** a failing test is re-run once in isolation. If it passes, it's recorded
     as `flaky:<test-id>` and doesn't count as a round or toward L4. A test that is red on base
     is excluded.
  4. **API errors:** retry with backoff (bounded). They never count as a round.

### TL-8 · Major · "Hard budgets" can't be enforced on Codex and Cursor as claimed, and the budget units are ambiguous

- **Where:** Q5 hard limits; D-12 (`04-decisions.md:204-209`); D-18; `05` Q7 (`:38-44`).
- **Problem:**
  - The interview demands "a cost or turn budget per ticket … plus a cap for the whole night".
    On Cursor's CLI there is no usage or cost at all (`research/08:33-36`, `:209`), so neither
    the per-ticket nor the per-night dollar cap is enforceable. Only wall-clock is.
  - On Codex, D-12 says "the launcher kills the process when over budget" using
    `turn.completed.usage`. In `codex exec` one prompt is normally **one turn**, so
    `turn.completed` likely arrives only at the end. That makes a live kill impossible: you learn
    the cost after it's spent. This is **UNVERIFIED** either way, because `research/08` doesn't
    establish when usage events arrive. It must be tested in unit 31.
  - Codex with a ChatGPT subscription login has no per-token price at all.
  - Units are mixed:
    - "turns: S 30 / M 60 / L 100" (per run or per ticket?);
    - "45 minutes per agent run";
    - "money per ticket".

    `--max-budget-usd` is per process, so the launcher must split the ticket budget across
    plan/build/review/QA and fix rounds. Nothing says how.
  - 30 turns for a whole S ticket (plan + build + review + QA) is far too few. For one TDD build
    run it is tight.
- **Fix:**
  - Keep a **budget ledger per ticket and per night**. Each launch gets
    `cap = min(remaining_ticket, remaining_night, per_role_max)`, passed as `--max-budget-usd` on
    Claude. Spend is debited from the result's `total_cost_usd`.
  - **MVP overnight runs: Claude Code only** for write roles. Codex is allowed only as a
    read-only verifier/reviewer, with a wall-clock cap and post-hoc cost from tokens. Cursor
    headless is not in MVP (or only through its SDK `Agent.getUsage()`, `research/08:215`).
  - Express turn caps per role, not per ticket.
  - Calibrate defaults from a 5-ticket pilot run before writing them into presets.

### TL-9 · Major · Per-ticket token and latency cost is driven by cold starts, and cheap failures burn expensive rounds

- **Where:** `01` §7 (`:372`: "a fresh session whose only input is the plan"), §8 (`:412`),
  §9 caps (`:450-451`), high-risk lenses (`:433-435`), per-finding check (`:453-457`); D-12 "Each
  launch pays a cold start".
- **Problem:**
  - Per §0.1, a normal ticket is 4–7 cold starts and a high-risk one 12–22.
  - Each cold start re-reads AGENTS.md, the skill, conventions and the plan, and re-explores the
    code.
  - A lint or type error after build sends the work back to a **new** developer session and uses
    one of 2 shared rounds. A type error followed by one real review finding = parked.
  - High-risk round 2 doesn't say whether all 6 lenses re-run.
  - The per-finding confirmation is one run per finding.
- **Fix:**
  1. The build run must execute the quality gate itself as its last step and fix its own red. The
     orchestrator re-runs it as the check. Count orchestrator-detected check failures against a
     **separate** cheap cap (e.g. 2) rather than the shared review/QA round budget.
  2. Fix rounds **resume** the build session (`claude --resume`, `codex exec resume`,
     `agent --resume`) with the findings file. A fresh session only after a `bad_plan` re-plan.
     This conflicts with `--no-session-persistence` in `research/08:303`, so decide explicitly.
  3. The launcher builds a **context pack** (plan, code map, `files_likely` contents, conventions
     excerpt) so plan/review/QA don't each re-explore.
  4. High-risk: from round 2, one combined delta review, not 6 lenses. Batch the per-finding
     confirmation into one run with all findings.
  5. Put the §0 numbers into `01` so the user sees what a feature costs before turning on
     autonomy.

### TL-10 · Major · Human friction: about 32 TTY approvals per feature, and `approve` can't run from inside the tool

- **Where:** `01` §16 table; D-17 (`04-decisions.md:283-290`); §0.3 above.
- **Evidence:** in my own Claude Code agent shell, `exec 3</dev/tty` returns
  `device not configured: /dev/tty`. That's good for D-17: agents can't approve. It also means
  the user can't approve from the session they're working in (e.g. Claude Code's `!` prefix is
  very likely the same kind of shell, **UNVERIFIED**). So every gate is a context switch to a
  second terminal.
- **Fix:**
  - `mirai inbox`: one TTY session that lists every pending gate (docs, plans, disputed findings,
    pushes) with its review file and approves or rejects them in sequence. Time per item is still
    logged for M6.
  - Merge the `push` and `mr` gates into one `ship` gate.
  - In `supervised`, default the plan gate to `auto` for `normal` + `S` tickets once the ticket
    set is approved (still `human` for high).
  - Approve the ticket set once, not per ticket.
  - Document that the approval terminal is a separate pane by design.

### TL-11 · Major · Supervised launches from inside a tool session will hit the tool's shell timeout and auth

- **Where:** D-12 (`04-decisions.md:192-195`); `02` (c) steps 5–6 (`PM->>O: mirai agent run verifier`).
- **Problem:**
  - In supervised mode the workflow skill runs `mirai agent run verifier …` through the tool's
    shell. That call blocks until the child agent finishes.
  - Claude Code's Bash tool has a 2-minute default and 10-minute maximum timeout. Codex and
    Cursor shells have their own limits. A verifier or reviewer run often takes longer, and the
    budget allows 45 minutes.
  - If supervised launches also use `--bare`, they need `ANTHROPIC_API_KEY` even when the user
    works on a subscription. `05` Q3 frames auth as an overnight-only question.
- **Fix:**
  - `mirai agent run --detach` returns a run id immediately. `mirai wait <id> --timeout 9m`
    returns when the run finishes, or prints progress and exits so the skill can call it again.
  - Decide supervised auth explicitly:
    - either non-`--bare` `claude -p` with `--setting-sources` and `--strict-mcp-config`
      (acceptable when a human is present);
    - or an API key for every launch.

### TL-12 · Major · The headless adapters as specified wouldn't load MIRAI's skills or config

- **Where:** `03-components.md:45-47`; D-30 (`:426-428`).
- **Problem:**
  - **Claude:** `--bare` skips CLAUDE.md, skills, hooks, plugins and MCP (`research/08:82`).
    `03` lists the Claude adapter's outputs as `.claude/skills/…`, `.claude/agents/…` and
    `.claude/settings.json`, none of which a `--bare` run reads. D-30 says only "MIRAI's own
    settings and MCP config passed in". The research's working command also needs
    `--plugin-dir .mirai/claude-plugin` and `--append-system-prompt-file AGENTS.md`
    (`research/08:299-302`). Without those the headless reviewer runs without `mirai-review`.
  - **Codex:** project `.codex/config.toml` and its MCP servers load only in **trusted** projects
    (`research/08:42`, `:158`). Trust is per path, and every new worktree is a new path.
    bmad-loop has two whole modules for exactly this (`codex_trust.py`, `workspace_trust.py`: "every
    unit runs in a fresh path, so without a grant every session hangs").
  - **Cursor:** turning off third-party import on the orchestrator machine (`03:47`) means
    `.claude/agents/` is no longer read, yet `03` says `.cursor/agents/` is generated "only if
    needed".
- **Fix:** the launcher passes **everything explicitly** per run and never relies on project
  tool config in headless mode.
  - **Claude:** `--plugin-dir <generated .mirai/build/claude-plugin>` (skills + agents), `--agents`
    JSON for the role, `--append-system-prompt-file` with AGENTS.md + the context pack,
    `--settings`, `--mcp-config --strict-mcp-config`.
  - **Codex:** `-c` overrides or a launcher-written `--profile`, the skill inlined in the prompt,
    the worktree trust question answered by TL-1 (single checkout).
  - **Cursor:** always generate `.cursor/agents/`.

  Add "a headless run of each role lists its skill" to unit 31's done-when.

### TL-13 · Major · The role-to-tool matrix is missing; Codex's network-off sandbox can't do QA or the pilot's Docker tests

- **Where:** D-14 rung 1 (cross-tool verification), D-30 Codex profile, `01` §10.
- **Problem:**
  - `workspace-write` keeps the network off (`research/08:148`). QA has to reach the app on
    localhost and drive a browser. The pilot's tests run through `docker compose exec`, which
    needs the Docker socket.
  - Whether Codex's sandbox allows localhost or Unix sockets is **UNVERIFIED** in `research/08`.
  - The design also never names QA's browser driver:
    - `06` rejected lackeyjb and noted "Claude Code here has a Playwright MCP";
    - `06b` rejected the agent-browser CLI;
    - `01` §10 just says "the running app".
- **Fix:** add an explicit matrix to `03`. For the MVP:

  | Role | Tool | Sandbox |
  |---|---|---|
  | Developer and QA | Claude Code | TL-2 sandbox, network allowlist = localhost + model API |
  | Verifier and reviewer | Codex or Claude | Codex `--sandbox read-only` is ideal for rung 1 |
  | Any role | Cursor | interactive only |

  - Name QA's browser driver: the project's Playwright (pinned) or the Playwright MCP (pinned
    version), launched by the orchestrator.

### TL-14 · Major · L1/L4/L5 are only deterministic if the findings schema and fingerprints are specified, and the design doesn't specify them

- **Where:** `01-workflow.md:441-445`; `07` unit 53.
- **Problem:**
  - **L1:** "cites `file:line` **and** an AC, ADR, convention rule, or a concrete failure". The
    first three are checkable as IDs. "Concrete failure (crash, data loss, security)" is free
    text, and a model will learn to always claim it.
  - **L4:** "compares finding fingerprints". Line numbers shift and models reword between rounds,
    so a naive fingerprint never repeats and L4 never fires.
  - **L5:** "the same hunk changed back and forth" needs per-round snapshots, which don't exist
    (TL-6).
  - **L2:** "caused by the delta" is checkable only if defined as "cited line inside the delta
    hunks".
- **Fix:** specify these in unit 14 (findings template) and unit 53.
  - **Findings JSON schema:**
    `{id, severity, basis: {type: ac|adr|convention|failure, ref}, file, line, symbol, claim, repro?}`.
    - `basis.ref` must resolve: the AC id exists in the ticket, the ADR file exists, the rule id
      exists in a conventions file.
    - `type: failure` is blocking only with `repro` = a failing test name or command the script
      can run. Otherwise it is downgraded.
    - `file:line` must fall inside `baseline..HEAD` changed lines. Otherwise it is downgraded to a
      follow-up ("pre-existing").
  - **Fingerprint** = `sha1(file + enclosing_symbol_or_hunk_header + basis.type + basis.ref)`,
    never line or prose.
  - **Test-failure signature** = `test_id + normalized first error line` (numbers, hex, paths and
    timestamps stripped).
  - **Churn** = for any file, blob hash at round N equals blob hash at round N−2 (from TL-6
    checkpoint refs), or the same hunk header is changed in 2 consecutive rounds with net diff
    ≈ 0.
  - **L2 delta** = cited `file:line` ∈ `diff <round N-1 ref>..<round N ref>`.
  - Note: with a 2-round cap, L4/L5 can only fire in round 2. Implement them, but don't spend unit
    budget polishing them before the caps are tuned.

### TL-15 · Major · Red-phase evidence is self-reported by the agent, so M15 and the TDD claim aren't trustworthy

- **Where:** `01` §7 step 2 (`:380-381`), D-23; red evidence goes "in the run log" via
  `mirai log`, which the agent calls.
- **Problem:** the developer agent records its own failing output. A model under budget pressure
  can log a fabricated red result. Nothing checks it.
- **Fix:** make red verification an orchestrator step after build, which is deterministic and
  cheap:
  1. Check out `baseline_revision` source with the ticket's **new or changed test files** laid
     on top.
  2. Run those tests. Each test-list row's test must fail (or not compile) there and pass at
     HEAD.
  3. Record the result as orchestrator-written evidence. A test that passes on baseline is
     flagged (this is the "passes on first run" red flag, made mechanical).

  This also feeds M15 honestly, and it slots into the floor guard (unit 46).

### TL-16 · Major · Overnight throughput is very low by construction

- **Where:** `01` §5 (tracer bullet first, `after` edges), `01` §6 trigger (`:334`), D-22,
  D-24, `05` Q6 (stacking off).
- **Problem:**
  - A ticket starts only when its `after` tickets are `done` (merged by the human).
  - The first story is a tracer bullet that later stories depend on. The second is "the story
    you're least sure of".
  - So with stacking off, a fresh epic's first night can build the **tracer bullet and nothing
    that depends on it**. A 7-story epic takes roughly as many nights as the length of its
    dependency chain, with a human merge in between each.
  - The design's flagship scenario (`02` (c): "epic + 7 stories … overnight … morning report")
    implicitly assumes otherwise.
- **Fix:**
  - `mirai run --plan` prints which tickets are eligible tonight and the expected count before
    starting.
  - Allow **stacking within one epic** in the MVP for `after` chains only: a child branches
    from the parent's ticket branch. Combined with TL-4's patch-id rule, a parent rebase keeps the
    child's records.
  - Or ask the ticket planner to maximize the independent frontier after the tracer bullet. In
    `01` §5, say "interface-stub stories unblock parallel lanes" explicitly.

### TL-17 · Major · Scope and maintainability: 57 units, 3 adapters, and an orchestrator sized at 3 units

- **Where:** `07` (stages 3, 9); Q2 (three tools); `03` §2.
- **Evidence:**
  - The closest prior art for the orchestrator alone, bmad-loop, is
    **≈100,800 lines of Python in `src/bmad_loop/*.py`** (top level only, `wc -l`). It has
    dedicated modules for recovery, stalls, worktrees, trust and checkpoints.
  - MIRAI allots units 52–54 for its orchestrator.
  - The three tools change monthly. `research/08` cites behavior pinned to specific versions
    (v2.1.277, v2.1.295, v2.1.302).
  - The first overnight run is unit 54 of 57, so the user's main concern (Q5 loop cost) is
    validated last.
  - That contradicts MIRAI's own "tracer bullet first" slicing rule.
- **Fix:** re-cut the roadmap as a tracer bullet.
  1. **M1′ (≈ units 1–4, 13, 14, 20, 31, 36, 37, 46, 52 on Claude Code only):** one pilot ticket
     goes `ready-for-dev → MR` in supervised mode. That proves records, checks, the launcher, the
     loop and the cost per ticket.
  2. **M2′:** loop rules + budgets + autonomous mode on Claude only, inside the TL-2 boundary.
  3. **M3′:** the document flow (PRD → tickets).
  4. **M4′:** Codex as a read-only verifier (rung 1).
  5. **Later:** Cursor headless. Cursor *interactive* works almost for free, because Cursor reads
     `.claude/skills` and `.agents/skills`.

  Move Confluence (44), release (55) and contribute (56–57) after the first 10 real tickets.
  Budget each adapter as an ongoing maintenance cost: add a `doctor` probe per tool version.

---

## 3. Minor

### TL-18 · Minor · Zero-dependency Node: "Mermaid parses" is not achievable, and the parser subsets need a spec

- **Where:** D-04 (`04-decisions.md:76-77`); `01` §4 step 4; `07` units 06, 10.
- **Problem:**
  - Real Mermaid validation needs the `mermaid` package, which needs a DOM. That's a large
    dependency tree.
  - Agents writing YAML frontmatter will produce block scalars, quoted keys and nested maps
    outside any "restricted subset".
  - Codex agent files need a TOML **writer**.
  - Schema validation is hand-written too.
- **Fix:**
  - Lint Mermaid only for a known diagram type keyword, balanced brackets and quotes, and no
    empty fences. Run `mmdc` when the project already has it.
  - Publish the YAML subset in the templates: scalar, inline list, one level of nesting. Give
    lint errors that show the allowed form.
  - Keep MIRAI's machine-written state in JSON. Keep TOML only for human config, as a documented
    subset.
  - Add property tests for both parsers in unit 02.

### TL-19 · Minor · The `MIRAI_DEPTH` recursion guard can be bypassed

- **Where:** D-12 (`04-decisions.md:212-217`).
- **Problem:** `env -u MIRAI_DEPTH mirai agent run …` gets past it. So does a native subagent
  tool (Claude `Task`), which never goes through `mirai` at all.
- **Fix:**
  - Leave `mirai agent run` out of every headless role's allowlist.
  - The launcher writes a per-run lock and refuses when it finds a live lock owned by an ancestor
    PID.
  - Disable native subagent tools in headless roles (`--disallowedTools Task`, or the Cursor and
    Codex equivalents) unless a role needs them.

### TL-20 · Minor · Some citations don't match the source tree

- `03-components.md:33` cites bmad-loop `policy.toml`. The source has `src/bmad_loop/policy.py`.
  `research/02:606` uses `.bmad-loop/policy.toml` as the runtime path, so write it that way
  consistently.
- `01`, `05` §F and `03:31` cite pstack `playbooks/shipping.md`. The actual path is
  `cursor-plugins/pstack/skills/poteto-mode/playbooks/shipping.md`.
- `03:32` cites "bmad-loop profiles (`data/profiles/claude.toml`)". The full path is
  `src/bmad_loop/data/profiles/claude.toml`.

### TL-21 · Minor · Vendoring statements contradict `06b`

- **Problem:**
  - D-27 says "the only vendored external file is … `blader-humanizer`".
  - D-31 says mattpocock is reused as "logic, rewritten in our words".
  - `06b` §1's verdict says "Vendor pinned copies … of `grilling`, `to-tickets`, `tdd` …
    `code-review`, `ADR-FORMAT.md`".
  - `06b` §5 says "vendor a pinned copy" of the ECC ADR skill. D-31 doesn't mention ECC or bm629.
- **Fix:** pick one rule and update `06b` or D-27/D-31. For maintainability, "logic only, our
  words" for everything except humanizer.

### TL-22 · Minor · The ticket state machine lacks the plan-rejected and re-plan paths

- **Where:** `02` (e) tickets.
- **Problem:** `ready_for_dev → in_progress : plan written`, but the plan gate can reject a plan,
  and L4 routes `bad_plan` to "re-plan once". Neither path is in the table. `pre-commit`
  enforcement (unit 21) would refuse them.
- **Fix:**
  - Add `in_progress → in_progress (replan, counter+1)`.
  - Add `in_progress → ready_for_dev (plan rejected)`.
  - Make the re-plan counter part of the persisted counters (TL-6).

### TL-23 · Minor · QA evidence storage is not specified

- **Where:** `01` §10 output; `06b` §4 required changes.
- **Problem:** screenshots and videos committed per AC will bloat the repo. `06b` requires that
  the "output dir [be] outside the repo or gitignore[d], never persist auth state".
- **Fix:**
  - Evidence goes to the gitignored `.mirai/cache/evidence/<ticket>/`.
  - The QA report commits only hashes and paths, and the MR links to CI artifacts.
  - Add a rule: never write the browser storage state to disk.

### TL-24 · Minor · M6 human review time will be noisy

- **Where:** Q6 M6; D-17 "review-time capture".
- **Problem:** the time from gate-ready to approve includes sleep and meetings. The "approvals in
  seconds are rubber stamps" guard works only at the low end.
- **Fix:**
  - Measure time from `mirai inbox` opening the item to the decision.
  - Cap each item at 60 minutes.
  - Report the median, not the mean.

### TL-25 · Minor · Required status checks on GitHub depend on the plan

- **Where:** D-15, unit 22.
- **Problem:** branch protection and rulesets on **private** repos need a paid GitHub plan.
  Whether the pilot org (`github.com/people-management-tool/platform`) is private or on a paid
  plan is **UNVERIFIED**. Without it, the "CI blocks the merge" claim falls back to "CI is red
  and the human notices".
- **Fix:** `doctor` checks via `gh api` that the required check is actually enforced, and the
  morning report states "enforced: yes/no".

### TL-26 · Minor · Cursor duplicate loading is pushed to unit 18, but it affects humans from day one

- **Where:** `03:44-47`, `05` §F.
- **Problem:** with the default import on, a Cursor user sees each skill in both `.agents/skills`
  and `.claude/skills`. MIRAI generates both (Codex needs `.agents/skills`; Claude doesn't read
  it, `research/08:61`).
- **Fix:** test it in unit 16 or 17 rather than 18, or generate Claude skills only and add
  `.claude/skills` to Codex via `project_doc_fallback_filenames`. Note that this setting covers
  instruction files, not skills, so the test is still needed.

---

## 4. What is clearly right

1. **A deterministic script owns the loop (L8, D-18), with verdict files and no
   `bypassPermissions`.** This is the right answer to the user's main fear, it matches bmad-loop's
   proven shape (`statemachine.py` TRANSITIONS table), and it fixes bmad-loop's worst flaw
   (`claude.toml:5`).
2. **The real gates are git + CI, and tool hooks are only fast feedback (D-15).** This is exactly
   what `research/08` §5.3 supports: Codex and Cursor hooks fail open, and Codex hooks need trust.
   The design reads its research correctly here.
3. **Machines before models, and depth by risk (L6, L7, lint-before-verifier on every document).**
   These are the two biggest cost levers in the design, and they're cheap to build.
4. **Control data stays in the repo, CI and resume never call an external API, and connector
   down parks instead of writing a stray copy (Q7, D-06).** That is good failure isolation. It
   only needs TL-5's per-branch layout to be complete.
5. **Low caps with parking and a morning report (2/3 rounds, park with a note), plus "agents never
   merge" (D-22).** These bound the worst case and keep a human in the loop where it matters.
   Honest limits are stated (D-16 "proves a review ran, not that it was good").

---

## 5. Suggested order of fixes

1. TL-1 (single checkout in MVP) and TL-4 (patch-id binding plus an exclude list): both change
   unit 20's spec.
2. TL-2 and TL-3 (sandbox boundary, protected paths, out-of-tree hooks, HMAC): these block unit 54.
3. TL-6, TL-7 and TL-14 (checkpoint refs, preflight and circuit breaker, findings schema): these
   define units 50, 52 and 53.
4. TL-8, TL-9 and TL-17 (budget ledger, Claude-only overnight MVP, tracer-bullet roadmap):
   re-cut `07`.
5. TL-10 and TL-11 (`mirai inbox`, detached launches): these define units 05 and 31.
