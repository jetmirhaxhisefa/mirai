# Agents, roles and the plan step

An **agent** is who runs: its prompt and what it's for. A **role** is what a run may change and which step it is. MIRAI keeps the two apart, so one agent can do two jobs safely. Both are data in the registry (decision D-37); a project can add its own roles in `.mirai/custom/roles/`, read from the trust root.

## Roles

| Role | Mode | Step | May change |
|---|---|---|---|
| `author` | read-write | build | anything in the project MIRAI doesn't protect outright |
| `planner` | read-only | plan | nothing: MIRAI stores the plan from the run's output |
| `reviewer`, `verifier`, `qa` | read-only | review, verify, qa | nothing |

After every run, MIRAI checks each changed file against the run's role (unit 19b). A change the role doesn't allow refuses the run, and the files are left for you to look at.

## Agents name roles

An agent definition (`registry/agents/*.toml`) names a role, and **may only narrow it, never widen it.** The registry refuses anything else when it loads:

- the role must exist;
- a read-only role's agent is read-only;
- an agent's own `may_write` is refused for now: nothing applies it at a launch yet, so a narrower scope means a narrower role;
- its tools are its mode's, as the template has them.

At each launch, a read-only agent never runs under a role that may write.

**There's no tier on an agent.** The role names its step, and the step's tier is picked at each launch (unit 19b, `docs/model-tiers.md`).

**An agent has no sandbox template of its own.** A launch takes its role's mode, `read-write` or `read-only`. The agent's definition, read from the trust root, adds only its description and prompt, through Claude Code's `--agents`.

Its tools are the launch's own list: the template's tools, MIRAI's MCP tools, and Claude Code's `StructuredOutput` when the launch asks for a structured result. Its model is the launch's. `prepareLaunch` refuses a definition of any other shape: hooks, MCP servers, a permission mode, other tools or another model.

**So the red team covers agents through their mode.** It tests the two mode templates, and a definition of the one allowed shape can't widen what a template allows. Each launch's first event is checked: it must show exactly the launch's tools, that agent loaded, and no agent MIRAI didn't pass.

**An agent that needs more tools or servers needs a new mode,** with its own template that the red team tests. It never gets them as new fields on the agent.

A launch may run an agent under its own role or under a read-only one. That's how Kai plans.

## Kai, the developer (`mirai-developer`)

Kai's role is `author`. Kai does two jobs, one per step:

- **Plan** (unit 21a): launched as `planner`, so it can't change anything. It reads the ticket and the code, and returns a plan.
- **Build** (unit 21b): launched as `author`, from the plan you approved (see below).

## The input folder

Each plan launch gets a read-only folder of what the ticket rests on. **It's all read from the integration branch's commit**, the same one as the trust root, never your work tree or a feature branch. An edit you haven't merged isn't an input, and a branch can't plant one.

In order, until the cap:

1. the ticket;
2. MIRAI's plan template;
3. the ticket's epic;
4. the ADRs it's `governed_by`;
5. the documents that define what it covers (its FR and AC ids);
6. the project's conventions (`CONTRIBUTING.md`, `CONVENTIONS.md`);
7. the plans of the epic's other tickets that you approved, from the store.

`index.json` lists each file, where it came from, and what was left out. **The cap is 32 files and 4 MiB** (unit 15a). A file that doesn't fit is left out whole and named there, never cut short. Kai is told to say in the plan what it's missing.

## The plan step: `mirai plan <ticket>`

The ticket must be `ready-for-dev`. The ticket on the integration branch must be **the exact file you approved** (unit 06's content hash): a ticket edited and merged after your approval is refused until you approve it again, as merged: `mirai approve <ticket> --file <path>` takes a ticket that's already `ready-for-dev` too, signs a new approval and leaves its state alone. It runs in your terminal for now; unit 28's orchestrator runs it at night.

1. **The checks.**
   - Your usage, against your caps (unit 20). In your terminal an unknown reading is a warning; unattended, it refuses.
   - The loop guard: a parked ticket stops here. A plan launch isn't a round.
   - Every launch check from unit 19 (the red team green, a clean tree, the trust root).
2. **The launch.** Kai, as `planner`, on the `plan` step's tier (`standard`).
3. **The plan.** It comes from the run's **structured output**, checked by Claude Code against a schema. **A file Kai writes is never the plan.** Writing one would change the project, which the planner role refuses.
4. **MIRAI stores it** in `<store>/tickets/<ticket>/plan.md`, where agents can't write. MIRAI also writes the frontmatter itself: `ticket`, `acs` (the ticket's own ACs and its `covers_ac`), `risk`, `tdd`, `tests` and `round` come from the ticket, never from Kai. A plan that declares a new dependency makes the ticket high risk.
5. **The ticket moves** `ready-for-dev → in-progress` once a plan passes the lint, or on its way to a park. A run cut short (a usage limit, Ctrl-C, a fault) leaves it `ready-for-dev`, so `mirai plan` simply runs again.
6. **The lint** (unit 08b). A plan that fails gets **one fix launch**, with the problems listed and the failed plan as `last-plan.md`. If it fails again, the ticket parks as `bad-plan`. If no plan comes back at all, twice, nothing is stored and the ticket stays `ready-for-dev`.
7. **The gate.** A plan that passes waits for you.

## The plan gate: `mirai approve <ticket> --plan`

**Who approves.** Under `supervised`, you. Under any preset, you approve for:

- a high-risk ticket;
- a plan that declares protected paths;
- a plan that declares new dependencies.

Automatic approval is unit 28's. Until then, every plan waits for you.

**What you sign.** In a real terminal, after reading the plan. You type the ticket's key to confirm. The plan is linted again first: a plan that fails can't be approved, but you can always reject it, an approved one too, until the build.

- **Approved:** your signature over the plan's approval hash (unit 08b), under `mirai/plan-approval/1:<repo>`. The hash covers the frozen block (Intent, Boundaries, Edge cases), the Declared changes and the fields `ticket`, `acs`, `risk`, `tdd`, `tests` and `round`. The signature is kept beside the plan, and an approval line goes into the journal.
- **Rejected:** the line, with your reason. The ticket goes back to `ready-for-dev`, and that counts as its one re-plan. A rejection by you also uses up the orchestrator's one re-plan (loop rule L4), so a later repeat parks the ticket. You can always reject again. Each new plan is one round on (round 2, 3, …): every plan you rejected and the orchestrator's re-plan count. A plan launch cut short doesn't.

**An edit after approval is caught.** Change the frozen block, the declared changes or a key field, and the approval no longer verifies. The build (unit 21b) refuses the plan until you approve it again. The sections Kai keeps up during the build (code map, tasks, logs) may change.

## The build step: `mirai build <ticket>`

The ticket must be `in-progress`, with a plan whose approval verifies as it is now. The build uses exactly the text that was verified. The ticket on the integration branch must still be the file you approved.

1. **The checks:** your usage, the loop guard (a build session isn't a round), and every launch check from unit 19.
2. **The branch.** The build runs on the ticket's own branch, named by `[git] branch_pattern` (`feature/{ticket}-{slug}`, with the slug from the ticket's title). MIRAI makes it from the integration branch's commit and switches your clean checkout to it. An existing branch is used only while it has no commits of its own, since nothing commits before unit 22.
3. **The launch:**
   - Kai runs as `author`, on the `build` step's tier: `standard`, one up for a high-risk ticket or size `L`.
   - It gets at most 150 turns and 60 minutes.
   - Its inputs are `plan.md`, the ticket, the project's conventions and `index.json`. The plan is its only source of truth.
4. **Kai's own gate.** Kai runs the tests and checks through MIRAI's server before it hands over, and fixes what fails. That costs no round.
5. **The handover** comes from the run's structured output only: `done` with a summary, or `blocked` with the reason. A file Kai writes is never it.
6. **MIRAI's checks, in order.** Each stops the ticket with the reason and leaves the files as they are:
   1. **The launch's own checks:** `.git`, processes, the token, and the `author` role's scope.
   2. **A path that runs by itself** (hooks, MIRAI's own files) **parks the ticket** (`scope`), declared or not (D-15).
   3. **Protected paths:** one the plan didn't declare needs you. A manifest whose only change is declared dependencies (it's otherwise exactly as it was) counts as declared, so a planned `npm:left-pad` doesn't trip node's protected `package.json`. **Its lock file never counts:** the plan declares `package-lock.json` or `composer.lock` as a protected path, so a rewritten lock is always seen.
   4. **Dependencies:** the manifests are stack data (`[[dependencies]]` in `registry/stacks/`: `package.json` for npm, `composer.json` for composer). These need you:
      - a name added or a spec changed (a version, a URL, an alias) that the plan didn't declare as `<ecosystem>:<name>`;
      - any change to the keys that say where dependencies come from (`overrides`, composer's `repositories`);
      - any change to the scripts the named checks run (a `lint` script turned into `true` checks nothing);
      - a manifest MIRAI can't read.
   5. **A stack with no dependency data:** a changed marker (`pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`) needs you. Its dependencies can't be checked yet, and MIRAI says so rather than passing it.
   6. **Deleted files:** a file deleted that the plan's code map doesn't mark `remove` needs you.
   7. **MIRAI's own test run:** every named check and test level, through the test executor, on the work tree as Kai left it, judged against your baseline for the branch's base commit (`docs/test-baseline.md`). Nothing new may break, and:
      - **with no baseline, it's `unknown`, never green, even when every run passed;**
      - a baseline that doesn't verify stops the build;
      - a level that ran fewer tests, or skipped more, than at baseline is `unknown`. This guards against a deleted or skipped test until unit 23's floor guard;
      - a run that can't be judged (Docker down, a timeout) is `unknown`.

      These runs are recorded as `by: build`, never signed. A signed gate result tests a commit, which comes with units 22 and 25.
7. **The outcome:**
   - **All green:** the ticket moves to `in-review`, with MIRAI's commit on the branch (unit 22).
   - **A new failure:** the ticket stays `in-progress` (21c's fix round).
   - **Blocked, or stopped for you:** the ticket stays `in-progress`, with the reason.
   - **Parked:** the ticket is `blocked`, `scope`. Look, then `mirai unpark`.

   **Every outcome after the launch** is kept in `<store>/tickets/<ticket>/build.json`: the outcome, the reason, the handover, MIRAI's checks and a fingerprint of the tree.

## What you see while a step runs (unit 21e)

`mirai plan`, `build` and `fix` say what's happening as it happens, on stderr:

```
Kai (Sonnet): started
Kai (Sonnet): 4 turns, 2.1 min — Edit backend/app/Http/Controllers/TaskController.php
Kai (Sonnet): 7 turns, 5.3 min — run_tests unit
Kai (Sonnet): 9 turns, 8.9 min — handed over
MIRAI's checks: unit running…
MIRAI's checks: unit pass, only known failures (56 s)
```

- **How often:** a line per tool call, at most one every 5 seconds, and a "still working" line after 15 seconds with nothing new (a long test level says "still running"). Only the short step between Kai's handover and MIRAI's first check (its safety checks and the commit) has no line of its own.
- **What a line shows:** the tool's name (one of the launch's own tools, so a denied one Kai tried still shows; anything else is "a tool"), a file path in the project when it's plain (letters, digits and `._@+/-`, no spaces, no secret-length segment; else "a file"; "outside the project" for one that isn't in it), and the level for `run_tests` and `run_check` (one of the project's). **Never Kai's text, a Bash command or a tool's output.** Kai chooses its paths and calls, so anything that could pass for one of MIRAI's own lines is shown as "a file" or "a tool".
- **The plan step** also names its lint, and the one fix launch when the first plan fails it.
- **From a second terminal:** `mirai status` shows the running step and its last progress line, including the check running while MIRAI tests the work after a build or fix round (a `--recheck` has no run of its own, so it only prints).
- **Before a build starts:**
  - a build or fix round MIRAI couldn't judge is refused at once, rather than after the launch: no test levels or checks, or no complete baseline covering each of them for the commit it's judged against (an existing branch's own base, else the integration commit);
  - a red team that isn't green, or no baseline, refuses before the ticket's branch is made. Other refusals at the launch itself (the integration branch moved, an ignored file that can't be checked) can still come after it;
  - `mirai init --refresh` lists the baseline among its next steps;
  - a stale usage reading says how old it is.

## What a ticket costs (unit 21d's checkpoint)

**SAMPLE-2** (a filter across API and UI, 9 files, about 190 lines, with tests at two levels):
- **3 Sonnet launches:** the plan, one lint fix of the plan, and the build.
- **30 turns, about 13,000 output tokens, and 190,000 tokens of cached prompt.**
- **About 10 minutes of agent time,** the build's including Kai's own test runs through MIRAI.
- **MIRAI's own test runs come on top.** The baseline's levels took about 7 minutes in the sample app.

**A fix round:** 7 turns, about 1.5 to 2.5 minutes (unit 21d's R1). A resumed round re-reads the whole build conversation, so it cost more cached input than a fresh one, for the same turns.

**The share of your usage limit:** not measured yet. Claude Code reports it for some launches only. The full numbers are in `implementation/units/21d-checkpoint/checkpoint-report.md`.

## Fix rounds: `mirai fix <ticket>` (unit 21c)

When MIRAI's own test run after a build finds new failures, the ticket stays `in-progress`, with MIRAI's commit of Kai's work. `mirai fix` sends those failures back to Kai, round by round, under the loop guard (`docs/loop-rules.md`), until one of these:
- **green:** the ticket moves to `in-review`;
- **a re-plan:** the same failure came back. The ticket goes back to `ready-for-dev` for its one re-plan, and you run `mirai plan` again;
- **a park:** rounds used up (`cap`), or no progress (the failures didn't drop, or a file went back to an earlier version);
- **a stop for you:** any of the build's safety stops, an environment fault, a usage limit, or Ctrl-C.

It starts only from a step that ended with failing tests MIRAI committed, under the plan that's approved now. A round that stopped for a usage limit, a fault or Ctrl-C doesn't lose that: the next `mirai fix` starts from the same step. Kai's `blocked`, a safety stop, an error or a park needs you first: look at it, then `mirai discard` (which goes back to the last checkpoint, and fix rounds start again there when it's a failing step), `mirai unpark`, or `mirai build`. After a re-plan, `mirai build` comes first.

**Each round:**
1. The loop guard counts it.
2. A checkpoint marks where it starts.
3. Kai gets `failures.json`: the new failures from **MIRAI's** run (each test, its message, the run's output tail), never its own report. `plan.md` is still its only source of truth.
4. MIRAI runs the same checks and commit as after a build. The commit's subject is `<ticket>: fix round <n>`.
5. The loop guard decides the next round.

An environment fault before Kai could act, a launch MIRAI refused before it started (a stale red team, say), Ctrl-C between rounds, or a usage limit: the round is given back. Each round checks your usage caps first.

The build itself isn't a round, so the loop guard's rules start with round 1: a failure the first round didn't fix gets a second round before it counts as a plan problem.

**Resuming Kai's session:**
- **What's kept:** after a build or fix launch that ended clean, MIRAI keeps Kai's Claude Code session file, with the large tool results Claude Code writes beside it (unit 21d), in the store (`<store>/tickets/<ticket>/session/`), where agents can't write. It names the launch that made it. A launch that Claude Code or MIRAI's launch checks stopped, or whose session can't be kept whole, leaves no session: an older one is never kept in its place.
- **How it's resumed:** a round resumes only the session of the failing step it starts from, never one from a launch that stopped. It puts the file into its own fresh config folder and starts with `--resume`, so Kai carries on with what it already read. Nothing else carries over: settings, token, trust root and the start-up check are as fresh as ever. Where the session lives and which one is resumed is decided in the launch code (the cage), not by the command.
- **A fresh session instead:** after a `mirai discard` (the old session would remember edits that are gone), after a re-plan, when Claude Code refused the resume (the session is forgotten, so it can't fail again the same way), or when the session is missing, over 32 MiB or 64 files, or holds a link.
- **The red team checks a resumed launch** (unit 21d; pending its first real run): Kai can't write its own config folder, and a forged history that claims more permissions must not change MIRAI's permission mode or let a refused write through.
- **Measured once (unit 21d's R1):** in one sample, a resume saved nothing. The same 7 turns as a fresh round, with nearly twice the cached input. Whether fix rounds should start fresh by default is yours to decide. MIRAI's test run between rounds can take longer than the prompt cache lasts, so a long session may be read again uncached.
- **What a kept session holds:** everything Kai saw, including files it read. It's private to you in the store, and stays until a discard, a re-plan or the next launch replaces it. Removing it when a ticket is done comes with retention (unit 69).

## MIRAI's commits (unit 22)

MIRAI alone commits on its branches, with pinned git: no hook runs, nothing signs, and no git config of yours is read.

- **Every commit has the trailer** (`Mirai-Ticket: <id>`, from `[git] trailer`).
- **It credits you as author:** `[git] author_name` and `author_email` in your personal file, `~/.config/mirai/config.toml`. Without them MIRAI refuses rather than guessing.
- **It names MIRAI as committer** (`MIRAI <mirai@localhost>`, or `[git] committer_email` there).
- **The subject is MIRAI's own words** (`PMT-31: build from the approved plan`). Kai's summary goes in the body, cleaned.

**G8:** where `mirai detect` saw your history follow Conventional Commits, the subject is `feat(PMT-31): …`. Where it found a commit-message rule MIRAI can't run (commitlint, a `commit-msg` hook), the first commit refuses until you set `[git] commit_format = "plain"` or `"conventional"` in `.mirai/config.toml`. A rule on the code host is unit 39's.

**When MIRAI commits:**
1. **A new ticket branch's first commit** is its signed record, `.mirai/records/<ticket>/branch.json` (`docs/signing.md`). The branch is then registered in the store with that commit.
2. **A build's handover that passed the safety checks:** the launch's own checks, protected paths, dependencies and deleted files. That holds whatever the test run said. The commit records what Kai produced; `build.json` and, from unit 25, the signed proofs say whether it passed.
3. **Never after a safety stop.** Those files stay uncommitted for you.

**Right after each commit the tree must be clean.** Anything still writing to the project is refused.

**An existing branch** is used only when its record verifies (the first commit after its base, unchanged since) and every commit after it is MIRAI's: the trailer and MIRAI's committer. That check is a convention, not proof: anyone can set a committer email. The proof comes from the signed records of units 25 and 26.

**Checkpoints:** before every step, a ref at the commit the step starts from, `refs/mirai/checkpoints/<ticket>/<n>`, listed in `<store>/tickets/<ticket>/checkpoints.json`. The first one, the branch record's commit, is the ticket's `baseline_revision` for unit 23's red check. Refs are only ever created, never moved, and never pushed.

**`mirai discard <ticket>`,** in your terminal with the ticket's key typed back, throws the last step away:
- the branch goes back to its last checkpoint;
- new files git sees are removed;
- ignored files under protected paths that changed are listed, never deleted.

**With uncommitted changes in the tree, it removes those only.** The step's commit stays, so a launch cut short can't make it throw away a step that was already checked. Run it again on the clean tree to go back to the checkpoint.

It holds the run lock, so it never runs under a live build. It also refuses while a crashed run's leftover process may still be writing. It's refused unless the ticket is `in-progress` and you're on its branch, and only to a checkpoint in that branch's history. The ticket stays `in-progress`.

**Right before each commit, MIRAI looks at the tree again.** If anything changed since its checks (a leftover process, an editor), it refuses. What's committed is exactly what was checked.

**A repo's own git config can't change who MIRAI's commits name.** The identity is passed in the environment, which beats every config file, and read back after the commit. `[git] committer_email` is a project setting, so every machine, CI and the push checks agree on MIRAI's address.

**A build may never touch `.mirai/records/` or `.mirai/keys/`,** declared or not: the ticket parks.

**What reaches the integration branch:**
- when a ticket's MR merges, its record (`.mirai/records/<ticket>/`) goes with it;
- so does every MIRAI commit, failing steps included, unless the merge squashes them.

Units 26 and 46 settle the push checks and the merge policy for that (`design/07`).

**After `needs-you` because of the environment** (no baseline, Docker down, a timeout): fix that outside the tree, then run `mirai build <ticket> --recheck`. It runs MIRAI's checks again, with no agent, and only on exactly the tree the build left. It checks, in order:
- the same branch and commit;
- the same approved plan;
- no file git is told to look past;
- the same fingerprint, which covers file contents, modes, and ignored files under protected paths.

A tree you changed is refused before anything runs.

**What a recheck can't fix:**
- **A baseline that can never compare a level.** A level with no test adapter that already fails (the sample app's `unit` before its adapter lines) gives `no-ids`, so every build needs you there. Commit the levels' `adapter = "…"` lines on the integration branch, then record its baseline. The build's own base commit needs that baseline, so start the ticket again from the new commit.
- **Your baseline refreshing by itself** at the start of a run (D-45) isn't built yet.
- **A flaky test isn't re-run** yet (design/01 §8).

**After `handed-over`:** the work is MIRAI's commit on the ticket branch (`git log -p main..` there). Don't commit on a MIRAI branch by hand: a commit MIRAI didn't make is refused by the next step. Taking a branch over is unit 46's `mirai handover`.

**Installing a dependency isn't built yet.** Agents have no network in the sandbox. If the plan declares a dependency that isn't installed, Kai stops `blocked`. To go on:
1. add the dependency to the manifest yourself, on the integration branch, and commit it;
2. record the baseline for that commit (`mirai baseline`);
3. start the ticket again: `mirai unpark` or a re-plan, then `mirai build`.

This contradicts D-48 ("installed from the integration branch's manifests"), which can't hold a dependency that's new. That's recorded as open.

## What isn't proven yet

- **That the red team covers agents through their mode.** The claim is that a definition of the one allowed shape can only narrow the tools. Probe R1 showed `--agent` narrowing the init tools to the agent's list. A wider list was never tried; the init check and `prepareLaunch` refuse one.
- **Whether a branch's `.claude/agents/mirai-developer.md` could replace the trust root's definition** of the same name. That's probe R3 (see test-results).
- **Worktrees.** One checkout for now (D-24). A process that detaches from a run is named, not killed (19a's option A). Worktrees come back with parallel lanes, for projects that are `worktree_safe`.
