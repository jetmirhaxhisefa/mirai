---
unit: "21b"
name: build
status: draft (2026-11-03), waiting for SPEC APPROVED
roadmap: design/07-implementation-roadmap.md, row 21 (21a done); design/01 §7 (build), §7a, §8 (checks); D-15, D-20, D-24, D-48; R3-C2, R3-M2, R-M4; notes from 19a, 19b, 20, 21a
depends_on: ["21a", "14c", "17b", "19b", "20"]
---

# Unit 21b: Kai builds from the approved plan

## Why

21a stops at your plan gate. This unit is the first time an agent changes your project for a reason: Kai, as `author`, works from the plan you approved, runs the tests and checks itself before it hands over, and MIRAI then checks what it did. Nothing is committed: commits and checkpoint refs are unit 22.

## The split, again (open point 1)

21a's split had 21b as "the build, fix rounds resuming the session". Building it showed fix rounds need two things that don't exist yet:
- **Every launch refuses a dirty tree** (19a), and a build leaves one until unit 22 commits it. A fix launch needs either that commit, or a record of the exact tree the last launch left.
- **Resuming a session** (`claude --resume`) needs the session's transcript, and every launch's Claude config folder is deleted at its end. That needs probing first.

So I propose:

| Unit | What |
|---|---|
| **21b (this)** | One build session from the approved plan, the in-session gate, MIRAI's checks after handover, protected paths and dependencies checked |
| **21c** | Fix rounds: a failed handover goes back to the same session (`--resume`), through the loop guard's rounds |
| **21d** | The first agent run checkpoint (PM2-2): plan and build on a sample-app ticket, supervised, with a full report |

21c can come after unit 22, which removes the dirty-tree problem cleanly. Or it can come before 22 with a recorded tree. 21c's spec will say which.

## Scope

**In.**

1. **`mirai build <ticket>`**, in your terminal (unit 28's orchestrator runs it at night).
   - **It refuses unless:**
     - the ticket is `in-progress`;
     - `planApproval` verifies (21a). The build uses exactly the text that was verified.
   - **Then the same checks as every plan launch:** your usage before a ticket, the loop guard (a build session isn't a round; unit 20), and 19a's launch gate (the red team green, a clean tree, the trust root).
2. **The ticket's branch (open point 2).** The build runs on the ticket's own branch, named by `git.branch_pattern` (`feature/{ticket}-{slug}`, with the slug from the ticket's title).
   - MIRAI creates the branch from the integration branch's commit, the trust root's, if it doesn't exist, and switches your clean checkout to it with pinned git (unit 14b), before the launch.
   - An existing branch is used as it is, only if it holds no commits beyond its base, since nothing commits before unit 22.
   - Registration and `branch.json` are unit 22's.
3. **The launch.**
   - **Who and what:** Kai, role `author`, step `build`.
     - The tier is `standard`; one up for a high-risk ticket or size `L` (19b's `pickTier`).
     - Turns at most 150; time at most 60 minutes.
   - **The inputs, from the store and the integration branch:**
     - `plan.md`, the verified text, the sole source of truth (design/01 §7);
     - the ticket;
     - the conventions (21a's list);
     - `index.json`.
   - **Kai's job:** follow the plan's tasks and test list.
     - Write tests the way the project already does (D-20).
     - Run `run_tests` and `run_check` through MIRAI's server, and fix what fails inside the session. That costs no round (R-M4).
     - Change nothing the plan didn't declare.
   - **The structured handover:** `{ status: "done" | "blocked", summary, tests_run, checks_run, blocked_reason }`.
     - `blocked` is Kai saying it can't go on, for example a declared dependency that isn't installed, or a plan that doesn't fit the code. Kai stops instead of guessing.
     - A handover written to a file is never read (R2-C1).
4. **What MIRAI checks after the session**, in this order. Each failure is named, and the files are left as they are (unit 22 reverts):
   1. **The launch's own checks (19a, 19b):** `.git` unchanged, processes, the token, and the `author` role's scope (tracked, new and ignored files).
   2. **Protected paths** (unit 12's `classify`, with the plan's Declared changes as `declared`):
      - an undeclared protected path stops the run for you;
      - so does any auto-run path, declared or not (D-15);
      - instruction files are named.
   3. **New dependencies** (R3-C2): every dependency added to a manifest must be declared in the plan as `<ecosystem>:<name>`.
      - The manifests are **stack data** (open point 3): `[[dependencies]]` in `registry/stacks/*.toml`, such as `package.json`'s `dependencies` for `npm` and `composer.json`'s `require` for `composer`.
      - A changed manifest MIRAI can't read is refused. A changed lock file without a manifest change is named for you.
   4. **MIRAI's own test run** (open point 4): every configured level and check, through the test executor (unit 14c), on the work tree as Kai left it.
      - "Green" means nothing new broke against your baseline (unit 17b): known failures are listed, and new ones count.
      - With no baseline for the base commit, the result is `unknown` and needs you; it's never called green.
      - These runs aren't signed: a signed gate result tests a commit (14d), and that comes with units 22 and 25.
5. **The outcome.**
   - **All green:** the ticket moves `in-progress → in-review` (04's "handover, checks green").
   - **Any check failed:** the ticket stays `in-progress`, with the failures in the store for the fix round (21c).
   - **Blocked by Kai, or stopped for you** (a protected path, a dependency, an unknown baseline): the ticket stays `in-progress`, and the report names why. Nothing here uses a round.
   - **The run log:** one `agent_run` line, plus a `checks` line (05b's event) for MIRAI's own test run.
6. **Kai's prompt:** its build section (`registry/agents/mirai-developer.md`), replacing 21a's placeholder.
7. **Docs:** `docs/agents.md` (the build step), and the roadmap row.

**Out:**
- **21c:** fix rounds and resuming the session.
- **21d:** the checkpoint run and its report.
- **22:** commits, checkpoint refs, registering the branch, reverting a refused run's files.
- **23:** the stub step, MIRAI's red check, the floor guard. Until then, Kai's red and green evidence is its own report, not proof.
- **Installing a dependency through the broker** (open point 3).
- **24:** review. **25:** signed gate results.

## Probes (with your OK before each batch)

- **R1. A build session's mechanics, on Haiku** (`--step commit-message` with the `author` role, as in 19b): Kai calls `run_tests` and `run_check` through MIRAI's server and returns the handover schema; a seeded change to a manifest is caught. About 2 runs; Docker must be running.
- **R2. A real build on Sonnet:** SAMPLE-1 ("delete a task", 21a's R2 plan, approved) on a sample-app clone, with the gate stubbed as in 19a unless your own red team is green by then. 1 run, maybe 2. It may take 30 to 80 turns, so it's the most expensive probe so far.

## Files

- **New:**
  - `src/agent/build.js`, `src/agent/deps.js`, `src/agent/branch.js`;
  - `src/cli/commands/build.js`;
  - tests in `test/agent/`;
  - `test/probes/build-probes.js`.
- **Changed:**
  - `registry/agents/mirai-developer.md` (the build section);
  - `registry/stacks/*.toml` (`[[dependencies]]`), and the stack schema in `src/config/registry.js`;
  - `src/agent/run.js`, if the handover needs anything new;
  - `docs/agents.md` and the roadmap.

## Tests (`npm test`, no model; a stand-in `claude`, a fake docker)

- **T1.** `mirai build` refuses:
  - a ticket that isn't `in-progress`;
  - a plan with no approval;
  - a plan edited after its approval.

  It builds from exactly the verified text.
- **T2.** The branch is created from the integration commit and checked out. An existing branch with commits beyond its base is refused, and so is a dirty tree.
- **T3.** The handover comes from structured output only. `blocked` stays `in-progress` with its reason, and a handover file is ignored.
- **T4.**
  - An undeclared protected path stops for you; a declared one passes.
  - An auto-run path always stops.
  - An undeclared dependency in `package.json` or `composer.json` stops for you; a declared one passes.
  - An unreadable manifest is refused.
- **T5.** MIRAI's test run:
  - green moves the ticket to `in-review`;
  - a new failure keeps it `in-progress`, with the failures stored;
  - a known failure doesn't count;
  - no baseline gives `unknown`.
- **T6.** The usage check and the loop guard come first. A build session isn't a round.
- **T7.** The run log has the `agent_run` and `checks` lines.

## Done when

- A build from an approved plan, on its own branch, hands over, and MIRAI's checks decide the ticket's state.
- An undeclared dependency and an undeclared protected path are each stopped.
- A real build of SAMPLE-1 on a sample-app clone (R2) is reported: turns, tokens, minutes, what passed.

## Open points for you

1. **Split 21b once more** (21b build, 21c fix rounds, 21d checkpoint). My recommendation: yes. Fix rounds hinge on unit 22's commits or a tree record, and on a resume probe. Each is a risk of its own, and the checkpoint deserves the whole chain working.
2. **The branch.** My recommendation: 21b creates and checks out `feature/{ticket}-{slug}` from the integration commit (D-24: one checkout, switching branches), and unit 22 adds registration and `branch.json`. The other way, building on whatever branch you're on, would make 22 redo it.
3. **Dependencies.** My recommendation: detect them in 21b from manifests, as stack data, refusing undeclared ones. Leave *installing* a declared one through the broker to a later unit: agents have no network in the sandbox, so Kai stops `blocked` and you install it yourself meanwhile. The sample-app tickets need none.
4. **MIRAI's own test run after handover:** every configured level and check, on the work tree, unsigned, judged against your baseline. My recommendation: yes. Kai's own runs are its report; MIRAI's run is what decides. Without a baseline it's `unknown`, never green.
5. **The cost:** R1 is about 2 Haiku runs, and R2 is 1 to 2 Sonnet runs that may be long (30 to 80 turns each). I'll ask before each batch.

## Changes after testing and review

1. **The run log's `checks` line:**
   - `tdd_applied` is optional, since what `tdd` resolved to is unit 23's to record;
   - a named result may be `unknown`, for a run that can't be judged against the baseline.

   No schema bump, as before.
2. **The baseline comparison is a module of its own** (`src/baseline/compare.js`, `againstBaseline`), following docs/test-baseline.md's rule, for units 25, 26 and 54 too. A run that failed as a whole (it didn't load, or ran nothing) is matched by its kind.
3. **Inputs:** 21a's `planInputs` takes the approved plan for a build. It then gives `plan.md`, the ticket and the conventions, without the epic, ADRs or sibling plans (design/01 §7: the plan is the sole source).
4. **The branch switch happens before the launch.** A launch refused after it (the red team not green) leaves your checkout on the new branch, with no changes.
5. **R2 ended `needs-you`, not handed over.** The sample app's levels name no test adapter, so its baseline can't compare the unit level, and lint timed out under load. The rule held; a green end-to-end build wasn't shown on a real model.
6. **From the review (Tech Lead and Architect):**
   - **High (Architect): a non-green outcome had no way forward.** Re-running `mirai build` was refused by the dirty tree. Now `mirai build <ticket> --recheck` runs MIRAI's checks again, with no agent, only on exactly the tree the build left: branch, HEAD and a fingerprint kept in `build.json`. `build.json` is now written for every outcome after the launch.
   - **No baseline is never green**, even when every run passed. This matches the spec, which the first build didn't. A baseline that doesn't verify stops the build.
   - **The comparison:** a known level-wide `error` failure, and the level-wide `unmapped` kind, now match their kind.
   - **Fewer tests, or more skipped, than at baseline is `unknown`,** and a deleted file the plan's code map doesn't `remove` needs you. These guard against a deleted or skipped test until unit 23's floor guard.
   - **A manifest whose every change is a declared dependency counts as a declared protected path,** with its lock files: node's and php's packs protect them.
   - **Dependency changes now caught:**
     - a changed spec (a version, a URL, an alias) counts like a new dependency;
     - a change to the stack's `sources` keys (`overrides`, `repositories`; new stack data) needs you;
     - so does any change to the scripts the named checks run;
     - a changed marker of a stack with no dependency data (Python, Go, Rust, Ruby) needs you, instead of passing unchecked.
   - **An auto-run path parks the ticket** (`scope`), as D-15 says.
   - **MIRAI's own runs are recorded as `by: build`.**
   - **The branch pattern must name `{ticket}`.**
   - **A separate branch base** (the integration commit, until stacking gives a parent).
   - **The CLI prints instruction files, lock-only changes and the declared dependencies it saw.**
   - **The docs say what to do after each outcome,** and the "install it yourself" steps are honest: commit on the integration branch, record the baseline, start the ticket again. The D-48 contradiction, the `no-ids` warning, the baseline refresh and the flaky-test rerun are recorded in design/05 §F.
7. **From the independent re-review of the fixes:**
   - **High: one key could hide behind another.** Kai could add a declared dependency and re-point an existing one under a second key (`optionalDependencies.foo` → a git URL), and the manifest still counted as covered. Specs are now compared per key: a name is unchanged only when the same key, or another key, held exactly that spec.
   - **A manifest is covered only when it's otherwise exactly as it was** (not `packageManager`, `config`, `autoload`). **Lock files are never covered:** the plan declares them.
   - **`--recheck`:**
     - it refuses a changed approved plan (`plan_sha256` in `build.json`) and files git is told to look past;
     - it compares the fingerprint before running any test;
     - the fingerprint covers file modes and ignored files under protected paths.
   - **An incomplete baseline, or test counts on one side only, is never green.**
   - **An error during MIRAI's checks still writes `build.json`** (`outcome: error`, with a fingerprint), then the error is raised.
   - **Code-map `remove` rows may name a folder** (ending in `/`) or start with `./`.
   - **Not done: a recheck writes no run-log `checks` line,** only `build.json`.
