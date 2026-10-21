---
reviewer: software-architect
round: 1
scope: design/00, 01, 02, 03, 04, 05, 07; research/02, 03, 05, 06b, 07, 08; spot checks in research/_sources
---

# Round 1 — Architect review of the MIRAI design

**Lens:** structure and boundaries, extensibility, install/update/sync-back, state model, records and gates, the agent launcher, SDD traceability, and reuse of prior art.

**Counts:** 3 Critical · 12 Major · 11 Minor.

The design's direction is sound: deterministic orchestration, git/CI as the real gate, control data kept in the repo, and a lock file as the boundary. The weak spots are the places where two mechanisms meet: tree hash vs files written after review, worktree vs trust root, branch vs state, lock vs generated files. Each of these is undefined or self-contradictory today. All of them must be settled before units 03, 04, 15, 20 and 52 get specs.

---

## Critical

### AR-1 · Critical · The review record invalidates itself on the happy path

**Where:** `04-decisions.md` D-16; `01-workflow.md` §9, §10, §11; `03-components.md` §8 (folder layout).

**Problem.**
- D-16: "A record stores the hash of the code tree it reviewed, **excluding `.mirai/state/`**."
- Several things are written into the tree **after** the review PASS and **before** the push. None of them is under `.mirai/state/`:
  - `qa-<ticket>.md` plus its evidence (screenshots). §10 says QA output is "screenshot path, command output". The layout puts reports under `<docs_root>/<initiative>/reports/`.
  - The ticket's frontmatter status `in-review → built` (§11). In repo mode tickets live in `<docs_root>/.../tickets/`.
  - The plan's append-only "implementation log, change log, and review triage log" (§6). The plan lives in `<docs_root>/.../plans/`.
  - `review-<ticket>-r<n>.json` itself, if it goes to `reports/`.
- So on every successful ticket, the `pre-push` check ("a review record and a QA record for the current code tree hash", §11) sees a different hash and refuses the push.
- The design gets out of this only by accident, if all of these files happen to sit under `.mirai/state/`. The layout says they don't.
- **CI sub-issue.** On GitHub, `actions/checkout` for `pull_request` events checks out the **merge ref** (`refs/pull/N/merge`) by default, not the head commit. Its tree never matches the reviewed tree, so CI fails every MR unless the job explicitly checks out `github.event.pull_request.head.sha`.

**Fix.** Define the hashed scope explicitly. Don't hash "everything minus one folder":
1. Add a config key `[gate] code_paths` (globs; the default is the whole repo) and `gate_excluded_paths`. The default excluded set is `.mirai/**` plus `<docs_root>/**`. Allow the excluded set only for MIRAI-owned artifact types.
2. Compute the hash deterministically. Run `git ls-files -s` over the committed tree at HEAD, filter by the pathspec, and hash the sorted `mode sha path` lines. State in the spec for unit 20 that uncommitted changes make `check` fail. Today it doesn't say whether the working tree, the index or HEAD is hashed.
3. Each record also stores `base_sha` and the `git patch-id --stable` of `base..head` for the code paths. This lets a later version accept a clean rebase (05 §F already names patch-id).
4. The CI template checks out the head SHA and computes the hash the same way, with the same script.
5. The "Done when" for unit 20 must include: "review PASS → QA report written → ticket marked built → push succeeds".

### AR-2 · Critical · The ticket worktree is the agent's sandbox and also MIRAI's trust root

**Where:** D-18 (one worktree per ticket), D-30, D-16 mitigations, D-15; `03` §3 (CI job, git hooks); `08` §5.4.

**Problem.**
- The developer agent has write access to its worktree. That worktree contains:
  - `.mirai/framework/`: skills, checklists, lints, the gate scripts themselves;
  - `.mirai/config.toml`: gates, round caps, risk paths, and the quality-gate command;
  - `.mirai/custom/`;
  - the generated `.claude/`, `.agents/`, `.codex/` and `.cursor/` files;
  - `.mirai/claude-settings.json` (passed with `--settings` in 08 §5.4);
  - the CI workflow file;
  - `.mirai/state/records/` and the run logs.
- **The next agent in the same worktree** (the reviewer, the verifier or QA) loads its instructions from those files. `--bare` stops the *branch's* hooks from loading, but `--settings`, `--plugin-dir` and `--append-system-prompt-file AGENTS.md` all point into the worktree.
- **The pre-push hook** runs gate code from `.mirai/framework/` in the agent-modified worktree.
- **CI** reads `.mirai/config.toml` and the workflow file from the MR branch. An MR can therefore relax its own gate, for example `quality_gate = "true"`, `risk_paths = []`, or a deleted lint. It then passes its own required check.
- Codex's sandbox makes `.agents` and `.codex` read-only (08 §5.4) but not `.mirai/`. Claude's deny rules on `.mirai/state/records/` (D-16) leave config and the framework writable. The floor guard (§7) only looks at tests, skips and thresholds.
- None of this needs a malicious model. An agent "fixing" a failing lint by editing the lint config is exactly the "cheapest road to green" that the floor guard exists to catch.

**Fix.**
1. **The trust root is pinned outside the ticket worktree.** At run start the orchestrator snapshots and hashes `.mirai/framework`, `config.toml`, `custom/` and the generated tool files from the main checkout (or from the base commit). It builds every launch from that snapshot, for example a read-only copy under `$XDG_STATE_HOME/mirai/<run-id>/`. The agent's worktree copy is never read.
2. **Protected paths.** Add a framework-defined list: `.mirai/**` (except `state/runs` written by the CLI), the generated tool dirs, `.github/workflows/**` and the hooks. A diff that touches any of them is high risk (always human) and fails the floor guard in scripted runs.
3. **CI reads gate config from the base branch.** It verifies that `mirai.lock` and the framework hashes on the MR equal those on base, unless the MR is labeled as a MIRAI update. That label is applied by a human and checked through the host API (allowed: it is a check of the gate itself, not a control-data read).
4. The git hooks call a launcher stub that runs the gate from the pinned copy and verifies its hash against `mirai.lock` on the base branch.

### AR-3 · Critical · Control state has no defined home relative to git branches

**Where:** D-06, D-29, `01` §12 (`mirai sync` → `done`), §14 (resume), §17 (one run file per run); `02` (e).

**Problem.** The design commits run logs, records, pointers and frontmatter statuses. It never says *on which branch* each write lands:
- The orchestrator runs ticket T in worktree W (branch `mirai/T`). Its events (`ready-for-dev → in-progress`, rounds, parking) go either to:
  - the ticket branch, in which case `main` and `mirai resume` from the main checkout can't see in-progress or parked work until merge; or
  - the main checkout, in which case unattended commits land on `main` outside any MR, or the main checkout stays dirty all night.
- `mirai sync` sets `done` after merge (§12). That is a frontmatter edit on `main`. It needs either a direct push to the protected default branch, which bypasses MIRAI's own gate, or a pending uncommitted change.
- The `after` dependency check (§6) reads `done` for the dependency, so it depends on this unresolved write.
- A ticket parked on its branch and never pushed leaves its `blocked` status and parking note on an unpushed local branch. The morning report has to find it.
- Two branches that both change `brief.md`/`prd.md` status, or the same epic's frontmatter, will conflict at merge.

**Fix.** Make the split explicit, in the spirit of BMAD's "board state derived, not stored" (`bmad-method/tools/ticket-tree-rules.md:21-35`) and pstack's "status.md is derived" (`cursor-plugins/pstack/skills/poteto-mode/playbooks/orchestrate.md:32`):
1. **Committed, branch-carried facts:** records, approval events, document content and versions. These travel with the MR.
2. **Machine-local operational state:** run progress, rounds, budgets, parking. It lives in a single orchestrator store outside the worktrees, for example `<git-common-dir>/mirai/` (shared by all worktrees, never committed). Copy bmad-loop's `state.json` + `journal.jsonl` + `heartbeat.json` (`bmad-loop/docs/reference/run-state.md:50-121`). Optionally export run-log lines into the MR branch at ship time, for CI and metrics.
3. **`done` and `built` are derived, not written.** `built` = an open MR whose head carries valid records. `done` = the MR merged (from git: the ticket branch is an ancestor of `main`, or a merge-commit trailer `Mirai-Ticket: T`). `mirai status` computes them. Nothing commits to `main` after merge.
4. Write this into D-06 as "where each piece of state lives, who writes it, and on which branch". Unit 03 and unit 04 can't be specified without it.

---

## Major

### AR-4 · Major · The lock covers `.mirai/framework/`, but people edit the generated tool files

**Where:** D-02, D-03, D-21; `02` (d); `03` §2 (adapters), §8.

**Problem.**
- The tools load `.claude/skills/mirai-prd/SKILL.md`, `.agents/skills/...` and `.claude/agents/...`, which are the generated copies.
- When a user improves a skill, they edit the file their tool shows them, which is the generated copy.
- That edit:
  - is **not** in `mirai.lock` ("framework files... listed with hashes");
  - is overwritten silently on the next `update`/regenerate ("regenerate tool files");
  - is invisible to `contribute`, which reads only lock-listed files.
- So the main path by which real improvements happen is outside both the update boundary and the sync-back boundary.
- The same content also exists two or three times in the repo (the framework copy, `.claude/skills`, `.agents/skills`), all committed (D-29).

**Fix.**
1. Put every generated file in the lock with `{source, generator_version, output_hash}`. `pre-commit` and `doctor` flag drift ("generated file edited: move the change to `.mirai/framework/...` or `.mirai/custom/...`").
2. `update` refuses to regenerate over a drifted file without a choice.
3. Stamp a `GENERATED by mirai from <source> — edit <source>` header in each generated file.
4. Consider making the generated `SKILL.md` a thin stub that points into `.mirai/framework/` for long bodies. Skills load bodies on demand anyway, and that leaves one copy of the truth.

### AR-5 · Major · `update` has no 3-way merge and no deterministic migrations

**Where:** D-03, `02` (d) U2–U5, `03` §2 (updater); unit 19.

**Problem.**
- `update` "keeps those local edits unless you accept the new version". That is a binary keep-or-replace per file. It is not a merge.
- A 3-way merge needs the **base content**. The lock stores hashes only, so the base can't be reconstructed offline.
- "Never touch config / custom / context" conflicts with schema evolution. When a config key is renamed, a gate preset changes shape, the run-log schema adds a required field, or the record format changes, existing projects either break ("a missing key stops the run", D-05) or need a migration that the design forbids.
- The cited prior art for migrations, BMAD `migration-N.toml`, is a prose-guided **LLM** procedure (detect / guide / checklist, `bmad/references/migrate.md:7`). That is the weak part to copy for a zero-dependency deterministic updater.

**Fix.**
1. Keep a base copy: `.mirai/framework.base/` (committed, or regenerable by fetching `pkg@<locked version>`).
2. `update` runs a 3-way merge per locally edited file: base → local and base → new. It can use `git merge-file` and write conflict markers. Clean merges apply; conflicts stop.
3. Pstack Benny's rule is the right policy and should be cited: "When an existing source-managed file differs, inspect the diff and merge without discarding local edits. If ownership is ambiguous, stop and ask" (`cursor-plugins/pstack/automations/benny/skills/setup-benny/SKILL.md:20-30`).
4. Add **code migrations**: `framework/migrations/NNNN-<name>.mjs` with `detect()`/`apply()`/`verify()`. They cover config schema, state schema, records and frontmatter, are idempotent, and are recorded in the lock (`migrations_applied`).
5. Allow migrations to touch config/custom under the same approve-then-apply flow. Keep BMAD's `retired.toml` (renames/removals) as data, which is the good part.
6. Every run-log line and record carries `schema_version`.
7. Add a roadmap unit "schema versioning + migration runner" before unit 19.

### AR-6 · Major · The leak scanner runs before the LLM writes the PR text, and a denylist is not a sound boundary

**Where:** `02` (d) S2–S5; D-21; Q9; unit 56.

**Problem.**
- The diagram runs the scanner (S3), **then** produces the "cleaned diff + neutral 'why' with metrics" (S5). The "why" is written by a model that has the project context, after the scan, so it is never scanned.
- A denylist built at setup (project name, paths, ticket keys, domains, people) misses things that were never listed:
  - new domain terms, customer names and internal hostnames added after setup;
  - identifiers copied from project code into a skill example;
  - numbers in "metrics as evidence".
- Git metadata can also leak: commit author and email, branch names (`mirai/BKT-48-...`), and a fork created from the project clone carrying history.
- Where the block list itself lives isn't stated. It contains exactly the sensitive strings, so it must never sit in a framework path.

**Fix.**
1. Scan **last**, over every outbound byte: diff, PR title/body, commit messages, branch name.
2. Add an **allowlist-diff** check. Tokenize the framework diff and flag any identifier-like token that appears in the project's own tracked files (excluding `.mirai/framework`) and **not** in the upstream MIRAI repo at the base tag. This catches leaks nobody listed.
3. Build the PR in a fresh temporary clone of the MIRAI repo by applying a patch, never from the project repo. Use a configured contributor identity, a neutral branch name (`contrib/<hash>`), and metrics only as buckets/ratios.
4. Keep the block list in `.mirai/config.user.toml` or `.mirai/state/`. The scanner refuses to run if the block list path is inside the lock.

### AR-7 · Major · Two sources of truth for status, plus external and `both` modes with no sync base

**Where:** D-06 ("Statuses live in document frontmatter, or in a pointer file... History lives in run logs"), D-17; `02` (e) rules; Q7 `both` rules; `03` §7.

**Problem.**
- Status lives in frontmatter, its history in the run log, and for external docs in the pointer, mirrored to Jira/Confluence. `pre-commit` cross-checks only human-only states. Nothing defines which side wins when they disagree, for example after a hand edit, a git merge, or a Jira user moving a ticket to Done.
- **Mirror direction is unspecified.** Q7 says status "is mirrored to the tool". Is a status change made in Jira imported, ignored, or flagged?
- **`both` mode is self-contradictory.** One side is `primary` and the other a mirror, yet "if both sides changed since the last sync, MIRAI stops and asks". "Since the last sync" needs a stored base (last synced version + content hash per side). The pointer schema (`id, url, version, status`) has no such field.
- **External content drift.** An approved Confluence page can be edited by anyone after approval. "An approved document is never edited" is unenforceable unless the approval binds a content hash.

**Fix.**
1. Declare the **run log authoritative for status**, with frontmatter and pointer `status` as a cache written only by the CLI. Apply BMAD's B2 rule ("derive the contract from the log; one writer per artifact", `bmad-method/skills/bmad-spec/SKILL.md:56-60`). `mirai status --check` (in pre-commit and CI) fails on any divergence.
2. External tool status is **observed, never authoritative**. A divergence becomes an event `external_status_drift` shown in `mirai status`, never applied automatically.
3. Extend the pointer to `{id, url, remote_version, remote_content_hash, approved_content_hash, last_sync: {local_hash, remote_version}}`. On read, if the remote hash ≠ the approved hash for an `approved` doc, the doc counts as modified-after-approval and the stage stops.
4. In `both` mode, drop "primary" or define it precisely: primary wins on content, and a conflict is detected against `last_sync`.

### AR-8 · Major · Approved-version semantics are undefined in repo mode

**Where:** `01` §15; `02` (e) ("A change starts version N+1 in `draft`"); `03` §6 frontmatter.

**Problem.**
- When PRD v2 starts in `draft`, is it the same file `prd.md`? If so, the working tree no longer holds the approved v1 that downstream tickets were `derived_from: prd@v1`. Every agent that reads `prd.md` for a v1 ticket reads an unapproved draft.
- The verifier can't diff v1 → v2.
- Stale detection compares version numbers but can't show *what* changed.
- The same applies to ADRs that move to `superseded`.

**Fix.**
1. In repo mode, keep immutable approved snapshots, for example `prd.md` (the working version) plus `prd@v1.md` frozen at approval with `approved_content_hash` in the approval event. Or store `approved_commit` in the approval event and have the CLI resolve `prd@v1` via `git show`.
2. Agents always receive the resolved version that their ticket's `derived_from` names, as a file path from the CLI.
3. Stale detection reports the FR/AC IDs that were added, changed or removed between versions.

### AR-9 · Major · SDD traceability is broken: two AC ID schemes, no AC-level closure, tests not bound to IDs

**Where:** `01` §3 (FR/NFR/UJ), §5 ("acceptance criteria... IDs `AC-n`"), §7, §10; `03` §6 (PRD `AC-FR-n.m`); D-08; `research/05` #45; `research/07` §6 rule 2.

**Problem.**
- The PRD defines `AC-FR-n.m` (research/07 §6.1, `03` §6). Tickets define local `AC-n` (`01` §5). No field maps one to the other.
- Ticket `covers:` lists FR/NFR, not ACs. The closure check is "every FR is covered by at least one story". It doesn't check that every **AC** and **NFR** is covered, or that BR → FR closure holds (research/07 §6.1 asks for both).
- The plan's test list has "one row per AC", but tests aren't required to carry the AC ID. QA rows are keyed by AC, but CI only checks that a QA record *exists*, not that it covers every AC of the ticket. So M8 (AC evidence coverage) is self-reported.
- **Standard track.** The lite PRD "= the spec kernel (Why / Capabilities / ...)". BMAD's kernel uses `CAP-n` (`bmad-spec/SKILL.md:9`). If lite PRDs use CAP IDs, `covers: [FR-...]` and FR closure don't apply to the most common track.
- **Quick track.** There is no upstream ID at all, so `covers` is empty and closure is trivially true. This is fine for bugs, but say so.
- The reuse matrix proposed `mirai-spec` with "one id scheme across them" (`research/05` #45, MVP yes). The design dropped it without replacing the ID scheme.

**Fix.**
1. Write one ID grammar into the shared frontmatter spec (unit 07): `BR-n`, `FR-n`, `NFR-n`, `AC-FR-n.m`, `CAP-n` (lite PRDs use `FR-n` too, so pick one), ticket ACs `AC-<ticket>-n` with `refines: [AC-FR-3.1]`, and `T-<ticket>-n` test rows.
2. Add `mirai trace` (deterministic) that builds BR → FR/NFR → AC-FR → ticket AC → test ID → QA evidence row, and fails on gaps per track rules.
3. Tests carry the AC ID in their name or a tag. QA and CI check that every ticket AC has a PASS evidence row whose referenced test or artifact exists.
4. Reuse TEA trace's evidence classification instead of inventing one: FULL / PARTIAL / NONE / UNIT-ONLY, with tests that only *name* a criterion going to `rejectedEvidence` (`bmad-tea/skills/bmad-tea-trace/steps-c/step-03-map-criteria.md:70-77`). This makes M8 honest.
5. Add an ID-stability lint across versions: a removed ID is marked `retired`, never reused (BMAD: "never renumber or reuse", `bmad-architecture/SKILL.md:87`).

### AR-10 · Major · The agent launcher is a choke point only for scripted runs, and its guards can be bypassed

**Where:** D-12, `02` (b)/(c), `03` §1 (launcher).

**Problem.**
- **Interactive authoring bypasses it.** "Runs in your session, with `mirai log` at its start and end". Cost, model and turns for PM/architect/planner authoring are self-reported, and M1/M4 for document stages are built on agent goodwill.
- **The author launches its own verifier.** In `02` (c) step 5, `PM->>O: mirai agent run verifier --doc prd`. If the launcher accepts a free-form prompt or context list from the caller, the author shapes its own verification.
- **`MIRAI_DEPTH` is an environment variable the child can unset** (`env -u MIRAI_DEPTH mirai agent run …`). Native subagents (Claude Task tool, Cursor subagents) don't go through `mirai` at all.
- **"May write" in the agent table (`03` §4) has no enforcement.** For example, the reviewer is "read-only on code" and QA writes "QA report + evidence only". Per-tool allow lists differ in power (Cursor `--force` allows everything not denied, 08 §5.4).

**Fix.**
1. `mirai agent run <role> --item <id>` takes **no prompt**. The launcher builds the prompt from the role's skill plus the item's resolved inputs (file paths). The caller can't add text.
2. Enforce depth by structure: launched sessions get a deny rule on `mirai agent*` / `Bash(mirai agent *)`, and native subagent tools are disabled (Claude `--disallowedTools Task`, Codex `agents.max_depth`-style config where available). Keep the env var as a second signal only. The launcher also refuses when its parent process tree contains another launcher.
3. **Write-scope check after each run** (tool-independent). Diff the worktree before and after. Changes outside the role's `may_write` globs are reverted and logged as a violation. This also gives reviewer read-only for free.
4. For interactive sessions, offer `mirai session start/end`, which reads the tool's own session transcript or usage (Claude `~/.claude/projects` JSONL; ECC's `message.id` dedupe, `research/06b`) to log real token counts instead of self-report. Mark these lines `source: interactive`.

### AR-11 · Major · Human-only moves and records can be forged with a few shell commands

**Where:** D-16 mitigations, D-17.

**Problem.**
- `approve` "asks for confirmation on `/dev/tty`, which agent tool shells don't have". Any agent with shell access can allocate a pty: `script -q /dev/null mirai approve prd` (macOS/BSD `script`), `expect`, or Python `pty.spawn`. Then it pipes `y`.
- `pre-commit` accepts a status change when "the run log has a matching approval event". The run log is a plain file in the worktree, and `mirai log` may be callable by agents (§17: "agents call `mirai log …`").
- CI "cross-checks each record's run id against the run log". Both are in the same agent-writable branch.
- The design is honest that "a record proves a review ran, not that it was good". But D-17 claims human-only moves are *enforced*, and they aren't.

**Fix.**
1. Sign approvals and records. `mirai approve` signs `{item, version, content_hash, ts}` with a key the agent can't reach. Pragmatic for personal projects: an SSH signing key loaded with `ssh-add -c` (per-use confirmation dialog) and `ssh-keygen -Y sign`. Records are signed by the orchestrator with a key held outside the worktree and outside the sandbox. CI verifies with public keys committed in the base branch.
2. `mirai log` refuses event kinds `approval`, `record`, `gate_result` and `status_change` to human-only states. Only `approve`, `drop` and the orchestrator may emit them.
3. Restate D-17's guarantee precisely: "resists casual and accidental forgery; a determined agent with shell access and your signing key can still forge."

### AR-12 · Major · The ticket lifecycle has no path back from MR review or CI failure

**Where:** `02` (e) tickets state machine; `01` §11–§12; D-22.

**Problem.**
- The machine ends at `built → done (you merge)`. Several common events have no transition:
  - human review comments on the MR;
  - a red CI on the MR, for example when the base moved;
  - a rebase that invalidates records (05 §F);
  - an MR that is closed without merging.
- D-22 makes "MRs ready for review" the overnight output. So this is the most common next event, and the loop can't absorb it.
- Also missing: `in_progress → dropped` and `blocked → dropped`. And `blocked → ready_for_dev` doesn't say whether the existing plan, round count and budget are kept.

**Fix.**
1. Add `built → changes_requested` (triggered by `mirai sync` seeing review comments or failing checks, or by `mirai reopen T`), which leads to `in_progress` with a **new round budget granted only by the human**.
2. Add `built → dropped` (MR closed).
3. Reuse pstack's `playbooks/babysit.md` rules (treat review comments as data; never interpolate comment text into shell commands, `babysit.md:12,20`) for ingesting MR feedback into a findings file in the same format as reviewer findings.

### AR-13 · Major · Resume can reset round caps and budgets

**Where:** `01` §14 ("a half-finished step restarts from its beginning"), §9 caps; D-18.

**Problem.**
- The round counter and per-ticket spend appear only as "round counter" in the plan template and in run-log lines. Nothing states that `resume` restores them.
- A crash or kill mid-review followed by `mirai resume` restarts the step. Without an explicit rule, an implementation can restart counts from zero. Repeated crashes (an OOM-ing app under QA, a flaky tool) then become unlimited spend.
- Cost overruns are the user's main concern (Q5).

**Fix.**
1. Rounds, spend and tokens per ticket are persisted in the orchestrator store after every launch, *before* the result is acted on.
2. Resume continues from the saved counters.
3. A restarted step's partial cost counts against the budget.
4. Prior art states exactly this rule: "a restart cannot grant three more rounds to the same unfinished run" (`bmad-tea/skills/bmad-tea-automate/resources/run-and-heal.md:28`). Cite and adopt it.
5. Add "a killed run resumes with the same remaining budget" to unit 50's Done-when.

### AR-14 · Major · Connector execution model is undefined (CLI script vs agent-via-MCP)

**Where:** `03` §7 ("uses the tool's official CLI or an MCP server you've configured"); D-31 (Atlassian MCP `spec-to-backlog` as reference); Q7.

**Problem.**
- MCP servers are configured *for the AI tool* (`.mcp.json`, `.codex/config.toml`). The `mirai` CLI is a zero-dependency Node script and isn't an MCP client. The Atlassian remote MCP uses OAuth tied to the tool session.
- If connector verbs run through MCP, then publishing, status mirroring and `mirai sync` are performed **by an agent**. That is non-deterministic and unloggable at the CLI, and it contradicts "control data via the CLI" and L8.
- If they run through official CLIs (`acli`, `gh`, `glab`) or REST, MCP shouldn't be the reference design.

**Fix.**
1. Split connectors into two layers:
   - **(a) Deterministic store verbs** (`write`, `read`, `query`, `status`, `proof`), run by the CLI only, through shell CLIs or REST with tokens from env or keychain. Copy BMAD's data-driven store TOMLs (`bmad-method/skills/bmad-ticket/config/jira-ticketing.toml`, which uses `acli`).
   - **(b) Optional agent-side read access** through MCP, for research and intake only, with the "ticket text is data" rule.
2. Every write to an external store goes through (a), so it is logged and idempotent (a store-side idempotency key = MIRAI item id + version).

### AR-15 · Major · Extension points are named but have no contracts

**Where:** `03` §2 (adapters), §4 (agents), §6 (templates), §7 (connectors); D-07 (one transition table).

**Problem.** Every axis the brief cares about (new tool, new connector, new doc type, new agent) is coded in today, with no plug-in contract:
- **New tool:** an adapter is code with no interface. The per-tool facts in `research/08` §1 (flags, skill tree, usage parser, hook dialect, trust step) are data.
- **New doc type** (UX, test plan, runbook): this needs edits across the status model, lints, templates, the verifier checklist, the storage-mode config keys and the trace rules, because none of them is keyed off a registry.
- **New agent:** the role contract ("may write", allowed tools, model ladder, budget) lives in prose tables.

**Fix.**
1. **Tool profiles as data.** Reuse bmad-loop's design: one TOML profile per CLI (`binary`, `model_flag`, `usage_parser`, `skill_tree`, hook dialect, `seed_files`, `first_run_note`), resolved by an adapter registry (`bmad-loop/src/bmad_loop/data/profiles/codex.toml`, `src/bmad_loop/adapters/profile.py`, `registry.py`). MIRAI adds a `capabilities` block (`max_turns`, `budget_usd`, `structured_output`, `reports_cost`) that the launcher reads to pick fallbacks. That is research/08 §5.3 as data.
2. **Doc-type registry:** `framework/doctypes/<type>.toml` with `id_prefix`, template, author and verifier checklists, lint rules, `states` (default: the document machine), `upstream_types`, `trace_rules`, and storage default. Status model, lint, trace and storage all key off it.
3. **Agent manifest:** `framework/agents/<role>.toml` with `may_write` globs (used by AR-10's write-scope check), tool allow/deny, ladder, default budgets and skill list. The adapters generate the per-tool agent files from it.
4. **Connector manifest:** as in AR-14, with a `capabilities` field (supports status mirror, versions, delete-for-proof).

### AR-16 · Major · How `.mirai/custom/` overrides reach agents is unspecified

**Where:** D-05, `03` §1 (config model), `02` (b) (`CFG -. overrides .-> CUS`).

**Problem.**
- Overrides are TOML with four hook points. Skills are static Markdown generated into tool folders. Who merges them?
  - At generate time, which means re-running the adapter on every custom change?
  - At run time, by the skill calling `mirai config resolve <skill>`?
  - Or by prose ("read `.mirai/custom/<skill>.toml`")?
- The merge semantics (scalar/table/array-by-key) are not stated, nor is whether an override may remove a shipped item.
- BMAD solved both, and MIRAI cites only the layering.
- The diagram arrow direction "config overrides custom" is also backwards relative to the text (custom overrides config for that skill).

**Fix.**
1. Adopt BMAD's merge rules verbatim as the spec: scalars override, tables merge, arrays of tables keyed by `id` replace or append, other arrays append, and "an override cannot remove a shipped item" (`bmad-method/skills/bmad/scripts/resolve_customization.py`; `bmod-core-tools/help/customization.md`).
2. Adopt BMAD's **content-addressed render snapshot** for generation: "immutable, content-addressed snapshots… each with a `manifest.json` of renderer and source hashes, resolved values, and per-output hashes… a collision raises rather than overwrites" (`bmad-method/CHANGELOG.md:88`, `bmad/scripts/render_skill.py`). This gives AR-4's lock entries and AR-2's pinned trust root in one mechanism.
3. Regenerate on `mirai config apply`. `doctor` flags stale renders.

### AR-17 · Major · Worktrees inside the repo, and gitignored files missing in them

**Where:** `03` §8 (`.mirai/worktrees/` inside the project, gitignored); D-18, D-24.

**Problem.**
- Nested worktrees under the main checkout are visible to everything running in the main checkout:
  - Claude Code loads nested `.claude/skills` from subdirectories (08 §1, "nested"), so it sees every worktree's copy;
  - test runners and linters glob into them (jest/vitest/phpunit pick up duplicate tests, and the quality gate in the main checkout changes);
  - IDE search and Cursor's nested `AGENTS.md` combine with them.
- Separately, a worktree checkout lacks every gitignored file the run needs: `config.user.toml` (budgets/models may be personal), `.mirai/cache/`, and the project's own `.env` for starting the app in QA. bmad-loop documents exactly this failure: "gitignored, so a worktree checkout omits it and isolated sessions lose their MCP servers", solved with `seed_files` (`bmad-loop/src/bmad_loop/data/profiles/codex.toml`).

**Fix.**
1. Put worktrees outside the repo: `$XDG_CACHE_HOME/mirai/worktrees/<repo-id>/<ticket>` or `../.<repo>-mirai/`. Use bmad-loop's `worktree_isolation_conflict` refusal logic as the reference (`bmad-loop/src/bmad_loop/bmadconfig.py:191-220`).
2. Add a `[worktree] seed_files` config (copied, never committed) and a `doctor` check that the app starts from a fresh worktree.

---

## Minor

### AR-18 · Minor · Hand-written TOML/YAML parsers (D-04)

The design reads TOML (config, custom, connectors, generated Codex agents) and YAML frontmatter with hand-written parsers. A subset parser that silently mis-parses (multi-line strings, inline tables, dates) is a gate risk. **Fix:**
- Specify the accepted subset as a grammar with a conformance test corpus.
- Reject anything outside it loudly.
- Use JSON for every machine-written file (state, records, pointers, lock).
- Or vendor one audited single-file parser (for example smol-toml, MIT, zero dependencies) under the same pinning rule as the humanizer.

### AR-19 · Minor · How hooks and CI invoke `mirai` is unspecified

If hooks call `npx <pkg>@<ver>`, every commit and push does a registry or cache lookup, and CI needs network access, which contradicts "nothing fetched at runtime" (Q8). **Fix:** hooks and CI run `node .mirai/framework/bin/mirai.mjs` (the pinned copy, hash-checked per AR-2). `npx` is used only for `init` and `update`.

### AR-20 · Minor · Run-log ordering and identity across many files

Q7/§14 replay "the event log" spread over one file per run. **Fix:**
- Each line carries `{schema_version, run_id, seq (monotonic per run), ts, item, by}`.
- Interactive sessions get a run id from `mirai session start`.
- Ordering across runs is defined: by item then `(ts, run_id, seq)`.
- Resume never trusts wall-clock order alone.
- Add the compaction rule now (05 §F), because CI reads these files on every MR.

### AR-21 · Minor · Gaps in the document state machine

The document machine has no `in_review → dropped` or `changes_requested → dropped`. Release-record states (`staging → verified → approved → live | rolled-back`, D-07) and the PRD work item's `live` state (§12a) are not in diagram (e) or the status-model unit. Context files use the full approval flow with a TTY for every edit, which is heavy for small context updates. **Fix:** add the missing moves, add the release and work-item machines to unit 03, and give context files a lighter path (`mirai approve context --batch`).

### AR-22 · Minor · Records are one mutable file per ticket

`records/<ticket>.json` holds "review + QA records", so round 2 overwrites round 1. **Fix:** one immutable file per record, `records/<ticket>/<kind>-r<n>-<treehash>.json`. `check` looks for one that matches. Audit trail and M5 then come for free.

### AR-23 · Minor · M9 (gate bypasses) can't be measured as defined

`--no-verify` leaves no local trace. **Fix:** define M9 as "pushes/MRs that CI found without valid records, plus merges with a failing required check (from the host API at `mirai sync`), plus manual `mirai gate override` events".

### AR-24 · Minor · Contribute can't carry new framework files or promoted overrides

D-21 reads only lock-listed files "whose hash changed". New skills or templates written in a project, and improvements made the recommended way in `.mirai/custom/`, can never be contributed. The design steers users toward the path that sync-back ignores. **Fix:** add `mirai promote <custom-file|new-file>`. It moves the change into a framework path (marked `local-addition` in the lock), and `contribute` then picks it up.

### AR-25 · Minor · Cursor imports Claude's hooks in interactive sessions too

08 §5.2/§U6: Cursor loads `.claude/settings.json` hooks by default. The design turns the import off only "on the orchestrator machine" (`03` §2). Interactive Cursor users then run Claude-dialect hooks with Cursor payloads (fail-open, possibly twice). **Fix:**
- Either generate `.cursor/hooks.json` and document turning the import off, or write the hook scripts to detect the dialect from the payload.
- Have `doctor` report which is in effect.

### AR-26 · Minor · Roadmap dependency errors

- Unit 30 (`doctor`: "a smoke run of one agent") needs unit 31, the launcher, which comes later.
- Unit 19 (updater) depends only on 15 but must handle generated files from 16–18 (AR-4).
- "Dogfooding starts after unit 04", but approvals only exist from unit 05.
- There is no unit for schema versioning and migrations (AR-5), the trace lint (AR-9), protected paths and the pinned trust root (AR-2), or signing (AR-11).

**Fix:** reorder, and add these units to Stages 1, 3 and 4.

### AR-27 · Minor · The vendoring position contradicts the skill sweep, and the catalogue omits its best matches

- D-27 says "the only vendored external file is… `blader-humanizer`", and D-31 says "logic, rewritten".
- But `research/06b` lists "vendor" for mattpocock `grilling`, `to-tickets`, `tdd`, `code-review`; bm629 `authoring-prd`/`reviewing-prd`/architecture/test-plan; and ECC's ADR skill (`06b` component map, lines 244–257).
- `03` doesn't cite bm629 (06b: "best content match" for PRD/HLD/LLD), or vercel `dogfood` (06b: QA method + taxonomy + template, Apache-2.0) for `mirai-qa`, which cites only pstack and superpowers.

**Fix:**
1. Pick one policy and record it in D-27.
2. Add a `vendor/` provenance manifest (source, commit, license, local diff) under the lock.
3. Add the 06b sources to the Prior-art column where they apply, especially `dogfood`'s issue taxonomy for QA reports.

### AR-28 · Minor · Tickets have no ADR compliance hook

MADR's required "Confirmation" (how compliance is checked, `03` §6) is the hook for ADR enforcement, but nothing consumes it. **Fix:** an ADR's Confirmation names a check id (lint rule, test, CI step). The reviewer gets `governed_by` ADRs plus their checks. `mirai trace` warns when an approved ADR's Confirmation check doesn't exist in the repo. This is pstack `correct`'s "rule → enforcer table" (`cursor-plugins/pstack/skills/correct/SKILL.md`).

---

## What is clearly right

1. **A deterministic orchestrator with loop rules as code** (D-18, `01` §9). It takes bmad-loop's state machine shape (`bmad-loop/src/bmad_loop/statemachine.py:25-65`) and drops its weakest choice (`bypassPermissions`, `data/profiles/claude.toml:5`). It adds three things not found anywhere in prior art:
   - one shared round budget across checks, review and QA;
   - the citation rule that makes "blocking" checkable;
   - fingerprint-based repeat detection.
2. **Git hooks plus CI as the gate, tool hooks only as feedback** (D-15). This rests on verified facts (Codex/Cursor hooks fail open; Codex skips untrusted hooks, research/08 §5.3), not preference.
3. **Control data in the repo; CI and resume never call an external API; a connector outage parks instead of writing a stray copy** (Q7, D-06). This is the correct availability boundary.
4. **One launcher with capability-aware fallbacks.** It does Codex cost as tokens × a price table, Cursor limits by wall clock, schema validation with one retry, and logs which verifier rung ran (D-12, D-14). Whether a second model is worth its cost then becomes a measurement, not an opinion.
5. **Thin personas, behavior in skills, one verifier with per-type checklists** (D-11, D-13). This follows BMAD's own finding that personas "made no difference" (`bmad-method/CHANGELOG.md:102`) and is explicitly reversible by metrics. Copying files at a pinned version, with no runtime fetch (D-03), is also the right call over BMAD v7's `raw.githubusercontent` update check.
