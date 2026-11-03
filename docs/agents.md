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
- **Build** (unit 21b): launched as `author`, from the plan you approved.

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

## What isn't proven yet

- **That the red team covers agents through their mode.** The claim is that a definition of the one allowed shape can only narrow the tools. Probe R1 showed `--agent` narrowing the init tools to the agent's list. A wider list was never tried; the init check and `prepareLaunch` refuse one.
- **Whether a branch's `.claude/agents/mirai-developer.md` could replace the trust root's definition** of the same name. That's probe R3 (see test-results).
- **Worktrees.** One checkout for now (D-24). A process that detaches from a run is named, not killed (19a's option A). Worktrees come back with parallel lanes, for projects that are `worktree_safe`.
