---
unit: "21a"
date: 2026-11-03
claude_code: 2.1.316
result: 453 tests; R1 with 3 Haiku launches (2 refused at init, 1 ok); R2 with 1 Sonnet launch (a plan, lint clean, at the gate); R3 with 1 Haiku launch (a planted agent file doesn't run); no full red team (the templates are unchanged)
---

# Unit 21a — Test results

## R1: `--agents`, `--agent` and `--json-schema` under MIRAI's flags (Haiku, sample-app clone, gate stubbed)

| Try | Launches | What happened |
|---|---|---|
| First | 2, both **refused at the init event**, 0 turns | (a) Kai with the template's tools only: the init event's tools narrowed to Glob, Grep, Read. MIRAI's MCP tools were gone, so the check refused the run. (b) Without the agent, with the schema: a `StructuredOutput` tool appeared that the check didn't expect. |
| After the fix | 1, **ok**, 2 turns | The init tools were exactly the launch's, plus `StructuredOutput`. The init agents were Claude Code's built-ins plus `mirai-developer`. The model called `StructuredOutput`, and the result event carried `structured_output: {"answer":"PONG"}`. |

**What follows:** an agent's `--agents` tools must be the launch's whole list: the template's tools, MIRAI's MCP tools, and `StructuredOutput` when a schema is passed. The init check expects `StructuredOutput` only with a schema. The plan comes back through `--json-schema`; the fenced-block path stays as a fallback, unused. Recorded in research/10.

**The cage failed closed both times:** each wrong tool list was caught at the first event, before the model acted.

## R2: `mirai plan` end to end (Sonnet, sample-app clone, gate stubbed)

**The ticket:** SAMPLE-1, "a user deletes one of their tasks", with 3 ACs (204, 403, 404), committed on main in the clone.

**The run:**

| Measure | Value |
|---|---|
| Outcome | `waiting` at the plan gate (`the supervised preset`) |
| Launches | 1, ok, no fix launch needed |
| Turns, time | 11 turns, 0.51 min |
| Tokens | 2,932, plus 48,297 cached |
| Model | `claude-sonnet-5-5` |
| Usage share | unknown (the probe home had no earlier reading) |
| Inputs | `ticket.md`, `plan-template.md`, `index.json`. The clone has no epic, ADR or conventions file, so nothing was left out. |
| Tree after | clean |

**The plan** (kept at `~/.mirai-21a-r2-plan.md`, 4,782 characters):
- Its frontmatter is MIRAI's.
- Intent, Boundaries and four edge cases are filled in, adding 401 for a request that isn't signed in.
- The code map names the route, the controller's `destroy`, the policy's `delete` and the tests.
- There are three red tests, one per AC.
- Declared changes: `none`.
- Kai said honestly, in Design notes, that it didn't open `phpunit.xml`.

**Noted, not fixed:** the heading "# The plan for this ticket" is left word for word from the template, and the lint doesn't flag a template heading.

## R3: a branch's agent file against the trust root's (Haiku, from the review)

A branch committed `.claude/agents/mirai-developer.md` with a canary prompt. Kai was launched with the trust root's definition through `--agents`.

| Outcome | Answer | The planted file ran | Turns |
|---|---|---|---|
| ok | `{"answer":"PONG"}` | no | 2 |

**What it doesn't tell apart:** whether `--restricted` loads no project agents at all, or `--agents` wins over a project file of the same name. Either way, the branch's prompt didn't run.

## Tests (`npm test`, no model)

453 tests, 453 pass (after both reviews' fixes; 447 before). New or changed:

- **T1** (config T11): an agent naming a missing role, an agent that isn't read-only under a read-only role, and an agent `may_write` that widens its role are each refused. Exclusions-only narrowing loads.
- **T2:** Kai's definition comes from the trust root, with the launch's tools, not its own. A branch's edited prompt counts for nothing. An author agent may run as `author` or under a read-only role, never as a wider other role.
- **T3:** the inputs come from the integration branch's commit, and a branch's edited ticket is ignored. With the cap at 4 files, the rest are left out whole and named. A ticket that isn't on the integration branch is refused.
- **T4:** the plan comes only from the structured output. Malformed outputs are refused, and so are two fenced blocks and an oversized plan. MIRAI's frontmatter replaces whatever Kai wrote there, and a declared dependency makes the plan high risk.
- **T4b:** a plan file Kai writes into the project refuses the run (the planner role), and nothing is stored.
- **T5:**
  - the ticket moves; the plan is stored and lints clean; the run is finished;
  - a plan launch isn't a round;
  - the launch has Kai, the read-only tools, the schema and the input folder;
  - the log line names the agent.
- **T5b:**
  - a lint failure gets one fix launch, with `last-plan.md`;
  - a second failure parks `bad-plan`;
  - no plan twice stores nothing and leaves the ticket `ready-for-dev`.
- **T5c:**
  - unattended with no usage reading: refused before any launch;
  - a parked loop: no launch;
  - a ticket that isn't `ready-for-dev`: refused.
- **T6:**
  - the gate holds whatever the preset: high risk, protected paths, dependencies;
  - a wrong typed key writes nothing;
  - approval signs, and `planApproval` verifies;
  - an edit to the frozen block is caught, while an agent-owned section may change;
  - a rejection gives `ready-for-dev` with `replans: 1`, the next plan is round 2, and it carries no approval.
- **From the review (4 tests):**
  - a lint failure, then a cut-short fix launch: the ticket stays `ready-for-dev`, and the next `mirai plan` runs;
  - a stored plan that fails the lint can't be approved, but can be rejected;
  - a ticket edited after your approval is refused before any launch;
  - `launchOptions` can't change the role;
  - a launch on a moved commit is refused;
  - an agent definition with hooks, another model, other tools, or two agents is refused by `prepareLaunch`;
  - a third plan after two rejections is round 3;
  - a read-only agent never runs a writing role (`checkAgentRole`), and the one allowed shape is taken for a read-write launch;
  - no approval of yours is refused, and a changed ticket can be approved again as merged;
  - an approved plan can still be rejected, and so can a plan with no frozen block;
  - sibling plans are gated on approval, and clashing input names are both kept.
- **Pinned lists updated:**
  - the bundle and render lists, with Kai's file;
  - the detect instruction-file list;
  - the command list, with `plan`;
  - the launch-token minters, with `cli/commands/plan.js`;
  - T1 of the strict templates: one per mode, none per agent.

**Flaky tests under load:** the hook's T4 ("bin/hook.js end to end") failed once at a load around 17, and strict's T5/T6 (the launch layout) once at around 40. Both passed in isolation and in the next full run.

**Unit 06's approve test changed:** a `ready-for-dev` ticket may now be approved again, as merged, with no move. Before, that was refused. This is the re-review's Medium fix.

## Not proven

- **The red team covers agents through their mode only.** The claim rests on `--agents` changing only the prompt and model, with the tools pinned. R1 showed that the agent's list narrows the init tools. A wider list was never tried: the init check would refuse it, and so does `prepareLaunch`'s shape check.
- **No full red team was run.** The two mode templates and their canonical flags are unchanged. Agent launches add `--agents`, `--agent` and `--json-schema`, which no red-team launch carries. MIRAI's framework changed, so your red-team result is stale anyway, and your next `mirai redteam run` covers this code.
- **A schema the model can't satisfy** (what Claude Code does then) wasn't tried.
- **The fix launch and the park on a real model:** shown with the stand-in only. R2's first plan passed.
- **`mirai approve --plan` on a real terminal:** shown with the simulated terminal of unit 06's tests.
