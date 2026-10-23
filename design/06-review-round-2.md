---
status: draft
version: 1
round: 2
---

# 06 — Review round 2

## Sources and method

Three independent reviewers worked in parallel on the design after round 1 and the `08`
follow-ups. None saw the others' output.

| Reviewer | File | Critical / Major / Minor |
|---|---|---|
| PM | `_review/round-2-pm.md` | 1 / 8 / 10 |
| Tech Lead | `_review/round-2-techlead.md` | 4 / 12 / 7 |
| Architect | `_review/round-2-architect.md` | 4 / 17 / 12 |

That's **75 findings**. After merging duplicates there are **30 themes**: 7 Critical, 15 Major and
8 Minor groups. Each theme lists its source IDs (full evidence is in the reviewer files), the
problem, the fix, and my recommendation.

**I spot-checked the main Critical claims against the files myself:**
- the store, trust root and hooks are under `<git-common-dir>/`, which is `<project>/.git`
  (`03-components.md:246-254`);
- D-12 claims "Agents can't read the store (D-30)" (`04-decisions.md:287`), but D-30's rules
  (`04-decisions.md:755-768`) only cover paths *outside* the project;
- the pilot rule exists only in `07-implementation-roadmap.md:38-41`.

All three are confirmed. The `.git/` placement was my mistake in round 1's fix for R-C4.

**What the reviewers agree on:**
- The document flow, the derived-state model and the loop guard are now buildable.
- Most round-1 findings are fixed. PM: 13 of 19 fully fixed. Tech Lead: most fixed. Architect:
  the core ones fixed.
- The safety layers are the right ones. **Placement mistakes undo them.** Every fix below keeps
  your D7 decision (no container around Claude Code).

---

## A. Critical

### R2-C1 · MIRAI's control files sit where the agent can write (AR2-1, TL2-1, TL2-6, AR2-10)

- **Problem:** the orchestrator store, the trust root (`strict.json`, `mcp.json`, hook
  scripts), the launch tokens and the git hooks folder are all under `<project>/.git/`. The
  sandbox lets Bash write anywhere in the project, and the deny rules cover only paths outside
  it. An agent could:
  - reset its round counters;
  - read a launch token and start nested agents;
  - edit the `strict.json` the next launch uses;
  - write a hook script, which then runs **outside** the sandbox;
  - run `git config core.hooksPath` to switch hooks off;
  - write a fake PASS verdict file that the CLI then signs.

  Gitignored files the run trusts (`config.user.toml`, `cache/`) are agent-writable and
  invisible to every diff check.
- **Fix:**
  1. Move the store, trust root and hooks **out of the project**, to
     `~/Library/Application Support/mirai/<repo-id>/`. Deny them to agents like
     `~/.config/mirai`, with both sandbox `denyRead`/`denyWrite` and permission denies.
  2. Deny agent writes to `.git/**` and `Bash(git config *)`. The orchestrator runs host git with
     `-c core.hooksPath=<trust-root>/hooks -c core.fsmonitor=false`.
  3. Reviewer and QA verdicts come from the agent's **structured output** (stdout JSON
     captured by the launcher), never from files in the work tree.
  4. Re-hash the trust root before **every** launch, not only at run start.
  5. Trusted personal files (`config.user.toml`, `cache/`) move to the same outside location.
- **Recommendation:** **Accept.** It's my placement error.

### R2-C2 · Tests run docker outside the sandbox on files the branch controls (TL2-2, TL2-4)

- **Problem:**
  - `mirai exec test` runs `docker compose` unsandboxed and reads branch-controlled inputs: an
    auto-loaded `compose.override.yml`, `.env` interpolation, `COMPOSE_FILE`, Dockerfiles. None
    are protected paths, and mounts are checked only at setup. A container that mounts the repo
    root can write `.git/hooks` or `core.fsmonitor`, which host-side git then runs.
  - As designed, the wrapper can't even run headless: the `dontAsk` allow rule for it is never
    written. Because it goes through a shell, `$(...)`, PATH shadowing and env-prefix variants
    are likely bypasses.
- **Fix:**
  1. Replace the Bash wrapper with a small **MIRAI MCP tool from the trust root**,
     `run_tests(level, path?)`. It takes structured arguments, there is no shell, and it's the
     only way an agent runs tests.
  2. The compose call is built **only from trust-root files**: a pinned list of compose files,
     no override auto-load, and an env file from the trust root.
  3. Before every run, validate the resolved config (`docker compose config`): no host mounts
     except the project source, no docker socket, no privileged mode, no host network.
  4. Compose, Dockerfile and `.env*` files become **protected paths** (a change means high risk;
     autonomous mode parks).
  5. Host git always runs with hooks and fsmonitor pinned (R2-C1 fix 2).
- **Recommendation:** **Accept**, including the Tech Lead's MCP-tool idea, which is cleaner than
  a shell exception. Some docker/compose facts here come from the reviewer's own knowledge and
  are marked UNVERIFIED. They go into `05` §G for testing.

### R2-C3 · The Claude login token and project secrets can leave the machine (TL2-3)

- **Problem:**
  - Denying `env`/`printenv` is cosmetic: `echo $CLAUDE_CODE_OAUTH_TOKEN` works.
  - The agent can write the token into a file. A test container with open network can then send
    it anywhere.
  - Containers hold the real `.env` secrets.
  - `WebFetch` is no longer denied.
  - So "the allowlist limits where it could be sent" (`04:805-806`, `05:119`) is false.
- **Fix:**
  1. Containers started for agent-triggered tests get **no outside network** (an internal
     network between the project's own services only).
  2. Tests use **dummy secrets**: setup creates a `.env.test` with fake values. The real `.env`
     is never mounted for agent runs.
  3. The secret scan (`pre-push`, CI) also matches the **exact value** of the login token.
  4. Deny `WebFetch`/`WebSearch` in headless runs.
  5. Check whether Claude Code can keep the token out of the Bash environment (UNVERIFIED, into
     `05` §G). If it can't, the residual risk is stated honestly: the token is readable but has
     no route out.
- **Recommendation:** **Accept.**

### R2-C4 · The E2E test written after review breaks the review proof again (AR2-2, TL2-8)

- **Problem:** Ivy writes the E2E test **after** review PASS, and it's committed with the ticket.
  E2E files count as code, so the patch-id changes and `pre-push` refuses every `e2e: true`
  ticket. It's the R-C1 bug again.
- **Options:**
  - **(a)** Change the order: build → checks → **Ivy writes the E2E test** → review (Rex
    reviews code *and* the E2E test) → QA runs everything. One proof, and the E2E test gets
    reviewed too.
  - **(b)** Two proofs: the review proof covers code minus E2E paths, and the QA proof covers
    the E2E paths. Push needs both.
- **Recommendation:** **(a)**. It's simpler, and a reviewed test is better than an unreviewed one.
  **You decide (U2).**

### R2-C5 · CI can't check the signatures, and a PR can still rewrite its own CI check (AR2-3, TL2-13)

- **Problem:**
  - HMAC is symmetric, so CI would need the secret key. A PR's workflow runs with repo secrets,
    so it could leak the key.
  - Approvals signed on one machine fail on another.
  - Round-1 TL-3.1 is still unfixed: on a `pull_request` event GitHub runs the PR's own copy of
    the workflow, so the PR can delete the check.
- **Fix:**
  1. Switch to **Ed25519 signatures** (built into Node's `crypto`, still zero dependencies). The
     private key stays in `~/.config/mirai/`, and the **public key is committed** on the base
     branch. CI verifies with the base branch's public key and needs no secret.
  2. Split CI into two jobs:
     - **`mirai-verify`** reads only data (signatures, lock hashes) and runs from the base
       branch's workflow (`pull_request_target`, never executing PR code);
     - **the normal test job.**
  3. Be honest in `doctor` and D-15: for a solo developer **your merge is the final gate**, and
     CI is a strong second check, not a wall.
- **Recommendation:** **Accept.** The GitHub event details (`pull_request_target` behaviour,
  required checks on personal private repos) go into `05` §G and are verified in the CI unit.

### R2-C6 · When MIRAI first touches the pilot is undefined (PM2-1)

- **Problem:**
  - `07:38-41` says the pilot comes "after the structure is built". It appears nowhere else:
    not in `06` §G, D-28 or `00`.
  - Milestone exits, the calibration run ("real pilot tickets") and the kill rule ("before
    Milestone D") all assume real tickets earlier.
  - Read literally, calibration runs on a sample app (meaningless numbers, PM2-16), and the first
    real value comes at unit 68.
- **Fix:** tie the pilot start to a milestone. Record it in D-28, `07` and `00`.
- **Recommendation:** start the pilot **right after Milestone A**. The structure for one ticket
  exists then, and calibration and the kill rule need real tickets. Units still get built and
  tested on the sample app first; the pilot repeats each milestone's exit check. **You decide
  (U1).**

### R2-C7 · Workspace mode puts the proofs in a different repo from the gated branch (AR2-4)

- **Problem:** in multi-repo mode the records, approvals, gate config and traceability inputs
  live in the workspace repo. But the MR, `pre-push` and CI run in the service repo. "Facts
  travel with the MR" breaks, and a ticket has two base commits.
- **Fix:** define the split now, even though workspace mode is built in Milestone D.
  - **Per-ticket proofs** are committed on the **service repo's** ticket branch, because they're
    about that repo's code.
  - **Documents and approvals** live in the workspace repo.
  - **Each service repo's lock** pins the workspace's public key and gate config version.
  - **`mirai trace`** runs from the workspace.
- **Recommendation:** **Accept** the design now, so unit 17 fixes the record path the right way.
  It's built in D.

---

## B. Major

### R2-M1 · Milestone A is too big *and* incomplete (PM2-2, PM2-3, TL2-19, TL2-22)

- **Too big:** about 7 units' worth of refinements could wait:
  - template customization;
  - tier escalation;
  - E2E file protection;
  - the reviewer's test-level checks;
  - diff coverage as a hard block (warn first);
  - a whole Docker sample app hidden inside unit 01.
- **Incomplete:**
  - no minimal run report (reports only arrive at unit 49);
  - no `mirai session start/end`;
  - no `pre-commit` hook;
  - unit 19 (CI) depends on `doctor` (unit 42, Milestone B);
  - A can't push under its own `pre-push` rule (TL2-19).
- **Fix:** cut A to about 20 units, and make the sample app its own unit. Add the minimal report
  and session units. Fix the dependency order. Add a **"first agent run" checkpoint** after the
  loop guard, so a real headless run is proven early.
- **Recommendation:** **Accept.**

### R2-M2 · The keep-or-stop numbers can't be measured in time (PM2-4, PM2-5, PM2-8, PM2-16)

- **Problem:**
  - Success targets are set by the calibration run from the same data they judge (circular),
    and they say nothing about value delivered.
  - "Review time per MR" has no capture point, because merges happen on GitHub.
  - Whether a subscription can sustain overnight runs isn't measured until unit 51.
- **Fix:**
  - Write the **kinds** of targets now, before any data:
    - share of MRs you merge without changes;
    - your minutes per MR, derived from git and GitHub timestamps (approximate, labelled so);
    - parked share;
    - zero high-risk escapes.
  - Calibration only fills in the numbers.
  - From Milestone A on, every ticket logs its **share of the subscription limit** used.
  - Calibration runs on the pilot (U1).
- **Recommendation:** **Accept.**

### R2-M3 · Too many human actions for small work (PM2-6, PM2-12, PM2-13, PM2-14)

- **Problem:**
  - A one-line CSS fix needs 5 human actions; a 5-ticket feature needs about 19 supervised.
  - The supervised `ship` gate duplicates your merge.
  - Brief and PRD are two separate gates, and the brief gate is drawn three different ways.
  - `unpark`'s choices from round 1 weren't adopted.
- **Fix:**
  - **Quick track:** approve the ticket, then merge. That's 2 actions.
  - **Supervised `ship` gate:** drop it. Your merge is the gate.
  - **Standard track:** the brief has no separate gate; it's approved together with the PRD (the
    track choice sits in the PRD header). **Full track** keeps the brief gate.
  - Draw the brief gate one way everywhere.
  - Adopt `unpark`'s choices: re-plan, retry, drop.
- **Recommendation:** **Accept.** The standard-track change touches your Q5 answer, so **you
  decide (U4).**

### R2-M4 · Who commits is undefined, and the trailer gate fails open (TL2-6, TL2-7, AR2-20)

- **Problem:**
  - "Agents don't commit" isn't enforced.
  - No one defines when commits happen, yet patch-id, stacking, parking and checkpoints all
    depend on it.
  - A missing trailer silently exempts a MIRAI branch from the gates.
  - You can't take over a MIRAI branch by hand.
- **Fix:**
  - Deny `Bash(git commit *)` and related commands to agents. **The orchestrator commits** at
    fixed points: after each green step, with the trailer.
  - **The gate scope fails closed.** The branch is registered in the store when MIRAI creates
    it. A registered branch without the trailer is **blocked**, not exempted.
  - `mirai handover <ticket>` releases a branch to you by hand. It's logged, and the MIRAI gates
    switch off for it.
- **Recommendation:** **Accept.**

### R2-M5 · State model gaps (AR2-5, AR2-6, AR2-7, AR2-8, AR2-23, AR2-22)

- **Problem:**
  - **A second machine** loses round counters, the inbox and metrics.
  - **Ticket status has no defined home**, and derived `built` clashes with the moves out of
    `built`.
  - **Documents and release records have no branch model.**
  - **A `release: together` epic deadlocks:** a ticket merged into `feature/<epic>` is neither
    `built` nor `done`.
  - There's no run-level state machine, and `obsolete` is used but undefined.
- **Fix:**
  - **Status home:** a small status file per ticket in the repo store (or the tracker's status
    when a tracker is used). `built` and `done` stay derived. `waiting` and a new
    **`integrated`** state ("merged into `feature/<epic>`") are explicit, so the next ticket in
    a `together` epic can start.
  - **Documents** reach main through a **docs MR** that you merge. So "nothing commits to main
    without your merge" stays true.
  - Add a run state machine (`running → paused → stopped/finished`) and define `obsolete`.
  - **Second machine: see U3.**
- **Disagreement:**
  - **Architect:** export the run-log lines into the MR as a portable ledger.
  - **PM (PM2-9):** committing those lines already **conflicts with your Q9 decision**
    (work data stays local).
- **My recommendation:** keep Q9. The MVP assumes **one machine** and says so. A later
  `mirai export/import` moves the store between machines. CI doesn't need the log lines, because
  the signed proofs carry what it checks. **You decide (U3).**

### R2-M6 · Stacking flaws (AR2-9, TL2-15, AR2-31)

- **Problem:**
  - A stacked ticket takes its trust root and CI lock from its unmerged, agent-written parent.
  - After a squash merge, the rebase replays the parent's commits and parks the child for a false
    conflict.
  - Force-push and cascade rules are missing.
- **Fix:**
  - The trust root and lock always come from the **main** base, never from the parent branch.
  - Rebase with `git rebase --onto main <old-parent-head>`, which survives squash merges.
  - The orchestrator force-pushes with `--force-with-lease`.
  - A child of a child is rebased after its own parent, one level at a time.
- **Recommendation:** **Accept.**

### R2-M7 · Test mechanics aren't specified enough to build (TL2-9, TL2-10, TL2-18, TL2-21, AR2-28)

- **Problem:**
  - **"Assertion failure only" rejects normal red for new code**, because a brand-new function
    can only fail as "not found".
  - **There's no test-adapter contract.** Running only full suites hits the 10-minute Bash limit,
    and the setup-time baseline goes stale.
  - **`patch-id --stable` ignores whitespace** and doesn't hash binary content.
  - **Zero dependencies hides parsers:** XML, diff and coverage formats.
- **Fix:**
  - **A stub step before red:** Kai first adds an empty stub (wrong return value), so red is a
    real assertion failure.
  - **A test-adapter contract per stack:**
    - run one file or test ID;
    - JUnit-XML results;
    - lcov or Cobertura coverage;
    - small zero-dependency parsers for exactly those formats.
  - **The baseline is refreshed from main** at the start of every run.
  - **The record hash** becomes our own SHA-256 over `git diff --binary` of code paths.
- **Recommendation:** **Accept.**

### R2-M8 · Overnight QA has no working mechanism (TL2-11)

- **Problem:** there's no MCP browser overnight, no ad-hoc scripts, and the sandbox allowlist
  doesn't include the app. So Ivy can't take a screenshot or even curl the app.
- **Fix:** exploratory QA also runs **in the Playwright container**. Ivy writes a throwaway
  Playwright script, which runs through `run_tests(level: "qa-explore")` and returns
  screenshots and output. The browser never runs on your machine.
- **Recommendation:** **Accept.**

### R2-M9 · Model tiers: escalation never fires, and "always a different model" is impossible (TL2-12)

- **Problem:**
  - Tier escalation, loop rule L4 and the round caps all fire on the same event, so escalation
    never happens.
  - On Claude only, "verifier always a different model" makes deep, high-risk reviews impossible
    when the author already used the strongest model.
- **Fix:**
  - Escalation applies to **tier 1 (light) steps only**. Those are outside the review rounds, so
    it doesn't collide with L4.
  - **The verifier ladder:**
    1. a different model family when available;
    2. otherwise a different Claude model (e.g. Fable vs Opus, your Q12 idea);
    3. otherwise the same model in fresh context, logged as such.
- **Recommendation:** **Accept.**

### R2-M10 · Claude Code configuration holes (TL2-5, TL2-14, TL2-16, AR2-18, AR2-19)

- **Problem:**
  - **`--setting-sources user` still loads your user settings**, whose `env` can re-inject an
    API key and silently switch you to API billing.
  - **"Deny everything outside the project" can't be written as deny + allow**, because deny
    wins.
  - **`--restricted` was researched but isn't used.**
  - **A nested `CLAUDE.md` written by the developer lands in the reviewer's context**
    (instruction injection).
  - **Native subagents** (the Task tool) bypass the launcher's budgets and recursion guard.
  - **The red-team list misses these.**
- **Fix:**
  - **Evaluate `--restricted`** as the base for headless runs, with only `--settings` from the
    trust root. Otherwise exclude user settings too.
  - **"Outside the project"** is written with the sandbox's `denyRead`/`allowRead` (where the
    narrower path wins), not with permission rules.
  - **Deny the Task/Agent tool** in headless runs.
  - **New or changed `CLAUDE.md`/`AGENTS.md` files** in a diff are a protected path (high risk,
    flagged to you).
  - **Expand the red-team list** with every Critical above.
  - **Add every new UNVERIFIED fact to `05` §G.**
- **Recommendation:** **Accept.**

### R2-M11 · Traceability and approvals aren't bound to content (AR2-11, AR2-12, AR2-13, TL2-20)

- **Problem:**
  - **`mirai trace` "in CI"** needs QA evidence that's local-only, and ignores the `tdd`/`tests`
    settings.
  - **The ID chain has gaps:** lite-PRD IDs, how NFRs are verified, `covers` vs `covers_ac`,
    and no critical-journey IDs.
  - **Approvals don't sign the document's content**, so an approved document can be edited
    unnoticed.
  - **The plan's frozen block isn't hashed either.**
- **Fix:**
  - **`mirai trace` runs locally at ship time.** Its result goes into the signed proof, and CI
    checks the proof.
  - **Fix the ID gaps:** `J-n` journey IDs, an NFR verification method per NFR, and one field
    name.
  - **Approvals and the frozen block sign a content hash.**
- **Recommendation:** **Accept.**

### R2-M12 · Templates, customization and updates don't fit together (AR2-14, AR2-15, AR2-17, AR2-21)

- **Problem:**
  - **Custom templates are full copies** that `update` never touches, and documents don't record
    their template version.
  - **"Migrations never touch config"** contradicts the schema migrations (round-1 AR-5, still
    open).
  - **Overrides reach headless runs but not interactive sessions.**
  - **Project-specific generated files sit in the framework lock**, so `contribute` could carry
    project content upstream.
  - **D-37's registry has no unit.**
- **Fix:**
  - **Custom templates become overlays** (add, rename, reorder) on the framework template, so
    updates still apply. Documents record `template: prd@v3`.
  - **Config schema migrations are allowed**, deterministic and shown to you before they apply.
    The contradicting sentence is removed.
  - **Interactive `.claude/` files are rendered from the same bundle.**
  - **The lock marks files `framework` or `project`.** `contribute` takes `framework` only.
  - **Add a unit for the D-37 registry.**
- **Recommendation:** **Accept.**

### R2-M13 · External status vs "works offline" (AR2-16)

- **Fix:** gates use only repo-side facts (the signed proofs). Tracker status is mirrored from a
  local cache with a last-sync time and is advisory for MIRAI's own decisions.
- **Recommendation:** **Accept.**

### R2-M14 · Milestone D is a 14-unit grab bag; the reuse proof comes last (PM2-7)

- **Fix:**
  - **Reorder D:** the second-project install first, then the `full` track and release.
  - **Workspace mode and Cursor are built when you actually need them** (a "when needed" list in
    D).
- **Recommendation:** **Accept. You decide** the order in D (U5).

### R2-M15 · Exported run-log lines are committed (PM2-9)

- Covered under R2-M5 (U3). If you keep Q9, the "exported lines in the MR" text is removed from
  D-29, `01` §11 and `03`.

---

## C. Minor (accept all unless you object)

| Theme | Sources | Fix |
|---|---|---|
| Stale decision text | PM2-10, TL2-17, PM2-11 | `06-review-round-1.md` §G still says usage limits **park**; your later decision is **pause** (fix §G). ATDD still called "Later" in `01:903` and `04:1083` (fix). Pause timing edge cases specified. |
| Retention placement | PM2-15, AR2-25 | `mirai clean` moves from Milestone C to D, because there's nothing to delete for 90 days. Edge cases (parked, stacked, reopened tickets) defined. |
| Release without staging | PM2-18 | The release state machine starts at `deployed`; `staging` is optional. |
| Report location | PM2-17 | One place: `<store>/reports/` plus the terminal; `mirai report` prints the last one. |
| Checkable milestone exits | PM2-19 | Each exit becomes a check you can run (a command or an observable result). |
| `resources` in a committed file | AR2-30 | Fine for private project repos. `doctor` warns if the project repo is public, and links can move to the outside personal config. **Tell me if you'd rather keep them out of git by default.** |
| Leftover contradictions and missing paths | AR2-24, AR2-26, AR2-27, AR2-29, AR2-32, AR2-33, TL2-22, TL2-23 | Fix the cross-references, add missing connector verbs, define who merges into `feature/<epic>` (you, via `inbox`), document the launcher input contract, MIRAI-repo leak scanner wording, unit sizing, round-1 leftovers (L1 changed-lines rule, context pack). |
| `track: auto in autonomous` is meaningless | PM2-12 | Removed with R2-M3. |

---

## D. What only you can decide

| # | Question | Options | My recommendation |
|---|---|---|---|
| U1 | When does MIRAI first touch the pilot (R2-C6)? | after Milestone A / after MVP-core (A–C) / after everything | **Right after Milestone A.** Units are still built on the sample app first. |
| U2 | E2E test timing (R2-C4)? | (a) Ivy writes E2E before review, Rex reviews it / (b) after review, with two proofs | **(a)** |
| U3 | Second machine (R2-M5)? | MVP assumes one machine; `mirai export/import` later / commit log lines into MRs as a portable ledger (conflicts with Q9) | **One machine for the MVP**, keep Q9 |
| U4 | Gates for small work (R2-M3)? | quick = approve ticket + merge; standard = brief folded into PRD approval; drop the supervised `ship` gate / keep as is | **Accept all three** |
| U5 | Milestone D order (R2-M14)? | second-project install first, workspace + Cursor "when needed" / keep current order | **Second project first** |

Plus: say if you reject any Accept above, and answer the `resources` question in the Minor
table.

## E. What all three reviewers said to keep

- The plain-script orchestrator, the loop guard, and parking instead of retrying.
- Derived `built`/`done`; agents never merge; your merge as the final gate.
- Lint before AI, the citation rule, and the findings schema.
- The tiers, the test-level rules and the "don't fix the past" ratchet from `08`.
- The honest residual-risk statements and the red-team requirement.

## F. Next step

Once you answer U1–U5, I'll apply all accepted fixes in one pass, the same way as round 1:
`01`–`05`, `07`, `00` and `research/09`, plus the fix to the `06-review-round-1.md` §G text.
I'll then cross-check the files. **My view:** the Criticals here are concrete placement and
mechanism fixes, not design changes. After they're applied, a short round 3 limited to the
safety model (R2-C1 to R2-C5) would be worth it. Everything else can go straight to approval.

---

## G. Your decisions (2026-10-23)

All Critical, Major and Minor fixes are accepted as recommended.

| # | Decision |
|---|---|
| U1 | The pilot starts **right after Milestone A**. Units are still built and tested on the sample app first; the pilot repeats each milestone's exit check, and calibration runs on pilot tickets. |
| U2 | **Ivy writes the E2E test before review**, and Rex reviews it with the code. One proof. |
| U3 | **The MVP assumes one machine.** Q9 is kept: no run-log lines are committed. `mirai export/import` comes later. |
| U4 | Quick track = approve ticket + merge. Standard track: the brief is approved together with the PRD. The supervised `ship` gate is dropped (your merge is the gate). The full track keeps the brief gate. |
| U5 | Milestone D: the second-project install first. Workspace mode and Cursor are built "when needed". |
| Minor | `resources` links stay in the committed project config for now; `doctor` warns if the project repo is public. Can change later. |

**Applied on 2026-10-23** to `00`–`05`, `07` and `research/09`, all in one pass. A cross-check aligned the release states, but missed `03:77` and the `02` (h) diagram; round 3 (AR3-14) caught them, and they were fixed on 2026-10-23. Intended everywhere, `pending → [staging → verified] → approved → deployed → live | rolled-back`.
