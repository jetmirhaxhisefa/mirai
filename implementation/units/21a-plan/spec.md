---
unit: "21a"
name: plan
status: approved (2026-11-02)
roadmap: design/07-implementation-roadmap.md, row 21 (split here into 21a, 21b, 21c); design/01 §6 (plan), §7 (build); D-14, D-15, D-24, D-34, D-37, D-48; R3-C2, R3-C3, R2-M11; notes for 21 from 19a, 19b, 19c, 20
depends_on: ["20", "19c", "08b"]
---

# Unit 21a: Kai writes the plan, and the plan gate

## Why

This is the first time MIRAI does real work with an agent rather than testing the cage. Row 21 is too much for one unit, so I propose a split:

| Unit | What | Ends with |
|---|---|---|
| **21a (this)** | Kai's definition, roles reconciled with agent definitions, the input folder filled, **`mirai plan <ticket>`**: Kai writes the plan, MIRAI stores and lints it, and it stops at your gate | A plan in the store that passes lint and waits for your approval |
| **21b** | The build session: a fresh Kai from the approved plan, `run_check` / `run_tests` before handover, the loop guard, unplanned dependencies refused, fix rounds resuming the session | Code on the branch, no commit (commits are unit 22) |
| **21c** | **The first agent run checkpoint (PM2-2):** one supervised Kai session on a sample-app ticket, plan and build, no ship, with a full report | Real numbers: turns, tokens, minutes, limit share |

The plan step goes first because everything after it rests on the plan: what the build may touch, which tests prove the ACs, and which dependencies and protected paths you've agreed to.

## Scope

**In.**

1. **Agents name roles (from 19b).** The AGENT kind's `role` must name a ROLE, checked across kinds.
   - `read_only` and `may_write` may only narrow the role's scope, never widen it. A check refuses anything that would.
   - `default_tier` goes: the role's step decides (19b's `pickTier`).
   - The role's name is `changeOf`'s actor (12).
   - D-14's and D-37's wording is updated.
2. **`mirai-developer` (Kai):** the agent definition, as data in `registry/agents/`.
   - Its role is `author`, its tools those of the read-write template, and its prompt in `registry/agents/mirai-developer.md`.
   - **One agent, two jobs, by step:** `plan`, which changes nothing in the project, and `build` (21b).
   - For the plan step it launches with role `planner`, so 19b's scope check refuses any write.
3. **`agentsJson` from the trust root (19a's note):** the agent definition passed to `--agents`, its tools equal to the template's, built from the trust root only.
4. **The input folder, filled (R3-C3; unit 15a's `inputs`).** The ticket, its epic, the documents it cites (`covers`, `governed_by`), the project's conventions where they exist, and sibling plans.
   - Read from the integration branch's commit, never the work tree, so a branch can't plant inputs.
   - **Size:** 15a's cap is 32 files and 4 MiB. Anything past that is left out and the plan says what's missing; it's never truncated silently.
5. **The plan as structured output (design/01 §6).**
   - Kai returns the plan's text as its run's structured output, through Claude Code's `--json-schema` if R1 shows it works under MIRAI's flags, otherwise as a fenced block in its reply, parsed strictly.
   - **MIRAI stores it,** `<store>/tickets/<id>/plan.md`; agents can't write the store.
   - **A file Kai writes is never the plan** (R2-C1).
6. **`mirai plan <ticket>`.**
   - **Moves:** `ready-for-dev → in-progress` (04).
   - **Checks first:** the usage check before the ticket (unit 20), the loop guard's `beforeLaunch` (a plan launch isn't a round), and 19a's gate on a launch.
   - **Then:** Kai's launch, the plan stored, **08b's plan lint**, and the result.
   - **A plan that fails lint** gets one fix launch, Kai given the problems. A second failure parks the ticket (`bad-plan`).
   - **A plan that passes stops at the plan gate.** `human` under `supervised`, and always for high-risk tickets or a plan that declares protected paths or new dependencies (design/01 §6). `auto` approval is unit 28's (the orchestrator).
7. **The plan gate.**
   - **You approve** with `mirai approve <ticket> --plan`, which signs 08b's `approvalHash` (frozen block plus declared changes) under `mirai/plan-approval/1`, in a real terminal (06).
   - **A rejected plan** goes back to re-plan, counting the ticket's one re-plan (04, 20).
   - **An approved plan that's later edited** is detected by its hash (08b), and the build refuses it (21b).
8. **The worktree question (from 19a), decided, not built (open point 2).**
9. **Docs:** `docs/agents.md` (Kai, roles, inputs, the plan step); the roadmap rows; D-14, D-37.

**Out:**
- **21b:** the build, `run_tests` before handover, unplanned dependencies, resuming a session.
- **21c:** the checkpoint run and its report.
- **Unit 22:** commits, checkpoint refs.
- **Unit 24:** the verifier on high-risk plans (design/01 §6 "checker").
- **Unit 28:** `auto` gates, picking the next ticket, the night.

## Probes (with your OK before each batch)

- **R1. Structured output under MIRAI's flags:** does `--json-schema` work with `--restricted` and `--permission-mode dontAsk`, and what does the stream carry? 2 Haiku runs.
- **R2. A real plan on a sample-app ticket, end to end:** Kai on the plan step, with the inputs and the gate. With the red-team gate stubbed, as in 19a, unless your own green is current by then. 1 to 2 runs on Sonnet, the plan step's `standard` tier, since a plan from Haiku would show little.

## Files

- **New:** `registry/agents/mirai-developer.toml` and `.md`, `src/agent/inputs.js`, `src/agent/plan.js`, `src/cli/commands/plan.js`, `docs/agents.md`, tests in `test/agent/`.
- **Changed:** `src/config/registry.js` (AGENT and ROLE across kinds), `src/adapters/claude-code.js` (`agentsJson`), `src/agent/run.js` (inputs, agents, structured output), `src/cli/commands/approve.js` (`--plan`), `src/trust/protected.js` (the actor), D-14, D-37, the roadmap.

## Tests (`npm test`, no model; a stand-in `claude`)

- **T1.** An agent naming a role that doesn't exist, or widening its role's scope, is refused by the registry.
- **T2.** `agentsJson` comes from the trust root, with the template's tools. A branch's agent definition counts for nothing.
- **T3.** The inputs come from the integration branch. A branch's edited ticket is ignored. The size cap leaves files out and names them.
- **T4.** The plan comes from the run's structured output only. A plan file Kai wrote is ignored, and a malformed output is refused.
- **T5.** `mirai plan`: the ticket moves; the plan is stored and linted. One fix launch on a lint failure, then a park. The usage check and the loop guard run first.
- **T6.** The gate: a plan with protected paths or new dependencies, or on a high-risk ticket, needs you whatever the preset. `mirai approve --plan` signs the hash in a terminal. A later edit is detected. A rejection counts the re-plan.

## Done when

- A plan passes lint and stops at the gate.
- Your approval signs it, and an edit after that is caught.
- A real plan from Kai on a sample-app ticket (R2).

## Open points for you

1. **The split into 21a, 21b and 21c.** My recommendation: yes. The plan, the build and the first checkpoint each carry their own risk, and the checkpoint deserves a unit of its own.
2. **Worktrees.** Unit 19a's note says a worktree per launch, so a detached process can be killed safely. **D-24 says the opposite:** one checkout, because the pilot's compose setup is bound to the checkout's path (fixed project name, relative mounts). Unit 17a already detects `worktree_safe`. My recommendation:
   - keep D-24's single checkout for now;
   - keep your option A from 19a (a detached process is named, not killed);
   - bring worktrees back with parallel lanes (Later), only for projects that are `worktree_safe`.

   The plan step changes nothing, so this matters from 21b on, and 21b's spec will say so again.
3. **Inputs from the integration branch only.** My recommendation: yes. A plan built on a branch's edited ticket would be built on something you never approved.
4. **The plan step on `standard` (Sonnet).** That's D-14's default for `plan`. My recommendation: keep it. A plan from Haiku would save little and risk a lot downstream.
5. **The cost:** 2 Haiku runs for R1, and 1 to 2 Sonnet runs for R2. I'll ask before each batch.

## Changes after testing and review

1. **No strict template per agent** (a deviation; you weren't asked).
   - **What changed:** a launch takes its role's mode template. The agent's definition, from the trust root, adds only its description and prompt through `--agents`, with the launch's tools.
   - **Why:** under 18b's rule an agent template got every case of its mode, so each agent would have roughly doubled the read-write runs of every red team. The red-team runner couldn't launch an agent template anyway (it passed no `--agents`).
   - **What it rests on:** the red team covers agents through their mode. The claim is that `--agents` changes only the prompt and model, never what the sandbox allows. Each launch's init event must show that agent loaded and no other.
   - **Knock-on changes:** `mirai sandbox show <agent>` shows the agent's role's mode, and docs/red-team.md is updated.
2. **R1's first try was refused at the init event, twice, and fixed:**
   - `--agent` narrows the init tools to the agent's own list, so the list is now the launch's whole one (the template's tools and MIRAI's MCP tools);
   - `--json-schema` adds `StructuredOutput`, expected only with a schema.

   The second try was ok, so the plan comes through `--json-schema`.
3. **MIRAI writes the plan's frontmatter itself:** `ticket`, `acs`, `risk`, `tdd`, `tests` and `round`, the fields your approval covers. They're never Kai's to choose, and a declared dependency makes the plan high risk. The spec had Kai return them.
4. **When the ticket moves:** `ready-for-dev → in-progress` once a plan is stored (04's "plan written"), not before the launch. A launch that fails leaves the ticket as it was. No plan twice stores nothing and leaves it `ready-for-dev`, since a park needs `in-progress`.
5. **A plan launch's failed plan goes to the fix launch as `last-plan.md`,** an input file, not in the prompt. The first launch's inputs keep room for it.
6. **Launch tokens:** `mirai plan` (your terminal) mints two, for the launch and its fix. The plan library never mints its own: an existing review test pins who may mint.
7. **`agent` in the run log:** an optional field of `agent_run`. The plan approval is an `approval` journal line of kind `plan`, with `path` its place in the store and `content_hash` the approval hash. No schema version bump, as unit 20 added optional fields.
8. **The `changeOf` actor:** no code change was needed. `classify` already takes the launch's role name, so only its comment changed (a ROLE's name).
9. **From the review (Tech Lead and Architect):**
   - **High, found by both: a ticket could stick at `in-progress`.** A failed plan was stored, then the fix launch was cut short, and no command could move the ticket on. Now:
     - the ticket moves only when a plan passes lint, or on its way to a park, so a run cut short leaves it `ready-for-dev`;
     - `approve --plan` can always *reject*, and needs a clean lint only to approve.
   - **An agent's own narrowing is now applied at the launch:**
     - a `read_only` agent never runs a role that may write;
     - an agent's own `may_write` is refused until a launch applies it. This replaces the exclusions-only rule; narrowing goes through a role.
   - **`prepareLaunch` takes one shape of agent definition only:** one agent, description, prompt, the launch's tools, model `inherit`. An agent that needs more needs a red-teamed mode.
   - **The ticket on the integration branch must be the file you approved** (unit 06's content hash). A ticket edited and merged after approval is refused. This is open point 3's intent made exact.
   - **The launch must run on the commit its inputs came from** (`base-moved`).
   - **`launchOptions` may only watch a launch** (an allowlist), never change what it is.
   - **The ticket's own fields are checked** before they're used: types, id patterns, escaped regexes. Bad ones are named in `index.json`.
   - **Input names that clash get a number,** never one lost.
   - **The docs scan refuses past 5,000 documents or 64 MiB,** instead of reading part of them and missing the ticket.
   - **Sibling plans are given only when you approved them.**
   - **`round` counts every plan you rejected,** so the third plan is round 3. A human rejection also uses up the orchestrator's one re-plan (L4); the docs now say so.
   - **`planApproval` returns the text it verified,** for 21b.
   - **The journal's path hint now covers store paths.**
   - **Doc and report wording that claimed more than was shown is corrected.**
   - **Noted for later:** Kai under any read-only role, such as reviewing its own change (unit 24); an `auto` plan approval needs its own signer or kind (unit 28).
   - **A branch's `.claude/agents/mirai-developer.md` doesn't replace the trust root's `--agents` definition** (probe R3, 1 Haiku run): the planted canary prompt didn't run.
10. **From the independent re-review of the fixes** (it confirmed all eight):
    - **Medium: `ticket-changed` was a dead end.** Its hint asked for a re-approval that `approve --file` refused outside `draft`. Now `approve --file` takes a ticket that's already `ready-for-dev`: a new signed approval line, no move. The hint names the exact command.
    - **`round`:** 1 + the plans you rejected + the orchestrator's re-plans (the loop counters'), counted apart, so it never repeats.
    - **An approved plan can be rejected,** until the build. A rejection removes the approval file.
    - **The old approval file goes before a new plan is written,** not after.
    - **The journal says what a plan line's `content_hash` is** when there's no frozen block (the hash of the whole text).
    - **The `launchOptions` comment says what the allowlist really holds:** stop signals, time limits, and the hooks for tests and the CLI's test io (binary, red-team status, init check). It never includes role, agent, inputs, prompt or token.
    - **Tests added:**
      - `agent-read-only`, through `checkAgentRole`, now one function;
      - a read-write launch with the one shape, taken;
      - `no-ticket-approval`, and re-approval as merged;
      - rejecting an approved plan, and a plan with no frozen block;
      - sibling plans gated on approval;
      - clashing input names.
    - **Not tested:** `docs-too-large` (it needs 5,000 documents), and the "plan changed while you were answering" re-read.
