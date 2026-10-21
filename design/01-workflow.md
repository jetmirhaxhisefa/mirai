---
status: draft
version: 1
---

# 01 — The MIRAI workflow, end to end

This file describes how one piece of work moves from a business request to a merge request (MR).
For each stage it says:
- what starts it;
- who does the work (an agent, a skill, or a plain script);
- what goes in and what comes out;
- which status changes happen;
- where a human must decide;
- who checks the work;
- which prior-art mechanism it is based on, and what we changed.

Decisions referenced here (D-nn) are in `04-decisions.md`. Interview answers (Q1–Q12) are in
`00-interview-log.md`. Prior-art paths are relative to `research/_sources/`; "pilot" means
`people-management-tool/platform`.

---

## 0. The big picture

```
 setup (once per project)
   └─► intake ─► PRD ─► design (HLD / ADR / LLD) ─► tickets ─► per ticket: plan ─► build (TDD)
                                                                     ─► checks ─► review ─► QA ─► ship (push + MR)
                                                                                                   └─► human merges
                                                                                                        └─► release
   every stage: writes the run log, updates status, can stop for a human, can be resumed
```

**Where to start:** `/mirai-new <request>` is the neutral entry. It runs intake and routes to the
right first stage for the track. `/mirai-prd`, `/mirai-design` and `/mirai-tickets` stay available
for direct use.

**What runs overnight:** only the **build loop** (plan → build → checks → review → QA → ship).
Every document (brief, PRD, ADR/HLD/LLD, ticket set) needs your final approval after the verifier
has reviewed it (decision D6 in `06-review-round-1.md` §G). Agents can draft and verify documents
unattended, but they stop at your gate.

There are **three tracks**, so small work doesn't pay for big-work ceremony (D-08):

| Track | Use it for | Documents | Example |
|---|---|---|---|
| `full` | A new product area or several epics | PRD (full) → HLD → ADRs → LLD per epic where needed → tickets | "Leave management" |
| `standard` | One feature that fits in one epic | PRD (lite) → ADRs only when a hard-to-reverse choice exists → design notes inside each plan → tickets | "Export employee list as CSV" |
| `quick` | Bugs and small changes | Ticket (story or bug) → plan | "Login button misaligned on mobile" |

The PM agent proposes the track at intake, with one sentence of reasoning, and the human confirms
it. In autonomous mode the proposal is accepted only when it is `quick` or `standard`. A `full`
proposal always stops for a human.

**Two ways to run the same stages** (D-12):
- **Supervised:** you type a command in your tool (for example `/mirai-prd`) and work with the
  agent.
- **Scripted:** `mirai run` (the orchestrator) walks the stages itself.

Both paths use the same skills, write the same files, and log the same way. The difference is only
which gates are `human` and which are `auto` (Q5).

**Your approvals go through one place: `mirai inbox`.** It runs in a real terminal and lists
everything waiting for you: documents, plans, disputed findings, parked tickets and MRs. Plans can
be approved in a batch from a short review packet. A parked ticket comes back only through
`mirai unpark <ticket>`, which asks for a note on what you changed (R-M2).

**Cost model per track (shape only; numbers come from a calibration run, R-M4):**

| Track | Agent runs, about | Where the cost goes |
|---|---|---|
| `quick` | 4–7 per ticket | developer session (plan + build), one review, QA |
| `standard` | about 45 per feature | PRD + verifier rounds, ticket set, 4–7 per normal ticket |
| `full` | about 70 per feature | adds HLD/ADR/LLD + verifier rounds; 12–22 per high-risk ticket |

- **What a budget counts:** a ticket and a night each have a budget counted in **turns, tokens and
  minutes**. Claude Code also reports an estimated dollar cost (`research/09-claude-blocking-rules.md`
  §6), which is shown but not used as the limit, because the runs use a subscription.
- **No defaults yet:** the default numbers are withdrawn until the calibration run. One healthy
  build session is about 1–2.5M tokens (bmad-loop's measurement), so the earlier "$2 per small
  ticket" was not realistic.

---

## 1. Setup (once per project, again after big changes)

| | |
|---|---|
| **Trigger** | `npx github:<owner>/mirai#vX.Y.Z init` (copies files, no AI), then `/mirai-setup` in your AI tool |
| **Who** | `mirai-setup` skill (runs in your session; uses `mirai-interview`) |
| **Inputs** | the repo itself, existing AI setups, existing docs and templates, git remote, CI files, your answers |
| **Outputs** | `.mirai/config.toml`, `.mirai/context/*` (project, business, conventions per service, feature map), generated `verify-<app>` skill, connector proof, git hooks + CI job, the **strict settings bundle** for Claude Code, the tool files (Claude Code first; Codex and Cursor later, see 07) |
| **Statuses** | each context file starts `draft`; you approve → `approved` |
| **Human checkpoint** | always: you approve the config and every context file before first use |
| **Checked by** | `mirai doctor` (script): install, config, hooks, CI, connector, a smoke run of one agent |

**Steps:**
1. **Detect, don't ask.** Scan:
   - languages and frameworks;
   - services (compose files);
   - test, lint and build commands;
   - the quality-gate script;
   - CI;
   - the branch-name and commit conventions;
   - git hosting;
   - existing AI setups (`.claude/`, `_bmad/`, `.agents/`, `AGENTS.md` blocks, `.cursor/`);
   - existing templates and decision docs, and how they are numbered;
   - the ticket-key pattern;
   - local app URLs;
   - which external tools are reachable (ClickUp, Jira, Confluence, Linear, GitHub/GitLab, Slack
     MCP servers or CLIs);
   - **whether the toolchain is bound to the checkout path** (fixed compose project name, mounts
     relative to the checkout, fixed ports). If so, setup records `worktree_safe = false` (R-C5);
   - **what the compose file mounts.** Setup warns if a project container mounts your home folder
     or the docker socket, because those containers run agent-written test code (D7).
2. **Ledger of what's already there.** Every existing instruction file and rule gets a line:
   `keep | rewrite | move | automate | delete`, with a reason. Nothing is deleted or overwritten
   without your yes.
3. **Interview only the gaps.** One question at a time, each with a guess. Never ask something a
   scan can answer. The questions:
   - track defaults;
   - **where each artifact type lives:** one tool per type, never two (D5). Different types may
     live in different tools, for example tickets in Jira and documents in Confluence. With no tool
     connected, everything lives in the repo;
   - gate preset;
   - risk paths;
   - budgets;
   - verifier model ladder;
   - where business context comes from.
4. **Write the context.** Small verified blocks:
   - every claim that names a file is path-checked;
   - every claim about a command is checked against the script it runs;
   - every convention is tagged `enforced by <check>` or `judgment`;
   - a rule a lint or CI check already enforces is not written as prose.
5. **Connect tools.** For each connected store, prove it works: create a test item, read it back,
   delete it.
6. **Generate the verify skill.** It describes:
   - how to start the app;
   - how to log in;
   - the feature map (screens, stable handles such as ARIA roles and `data-*` attributes);
   - how to capture evidence.
7. **Install enforcement:**
   - git hooks, installed **outside the work tree** (under the git common dir) and hash-checked
     against the base branch's `mirai.lock` (R-C2);
   - the CI job template;
   - per-tool hooks (fast feedback only).
8. **Generate the strict settings bundle for Claude Code** (D7; `research/09-claude-blocking-rules.md`
   §7). These rules **block**; they don't just advise:
   - **Sandbox:** Claude Code's OS sandbox is on and can't be escaped
     (`allowUnsandboxedCommands: false`). Reads of your home folder are denied except the project
     and the toolchain caches. The network is a strict allowlist (package registries and the model
     API).
   - **Deny rules:** `Read`/`Edit` outside the project, agent `git push`, `gh`, `docker`,
     `printenv`/`env`, and the key and token folders (`~/.ssh`, `~/.aws`, `~/.config/gh`,
     `~/.config/mirai`).
   - **Hooks:** they block secret patterns in Write/Edit content, and Glob/Grep paths outside the
     project, which permission rules can't cover.
   - **Tests:** they run only inside the project's own Docker containers, through
     `mirai exec test <suite>`. That wrapper is the one command allowed outside the sandbox, and it
     takes no free-form arguments.
   - **Daytime and overnight:** in an interactive session, access outside the project is an
     **`ask`** ("not without my approval"). In a headless run the same rules are **deny**
     (`--permission-mode dontAsk`).
   - **Locking the rules:** setup can also install the rules as macOS managed settings, so no
     project file can loosen them. That needs admin rights and your yes.
9. Run `mirai doctor`. It reports:
   - "merge gate: CI-enforced" or "local-only" (R-M21);
   - whether the gate sees a marker change on the current branch;
   - the result of a red-team check of the blocking rules (§7a).

**Prior art:**
- `bmad-method/skills/bmad-project-context/SKILL.md`: ledger; "never ask what a scan could
  answer"; prefer a hook or lint to prose; path-check every claim.
- `cursor-plugins/pstack/skills/create-verification-skill/SKILL.md`: feature map; "interview the
  repo, not the user".
- `addyosmani-agent-skills/skills/interview-me/SKILL.md`: one question with a guess.
- `bmad-method/skills/bmad-ticket/references/store-setup.md`: prove the store with a test ticket.
- pilot `.claude/hooks/*`: the gate.

**What we changed:**
- One setup builds *all* context, not just the AGENTS.md block.
- It also adds a business-context file.
- It detects and offers to migrate existing AI setups. The pilot has the council plus BMAD.
- It generates files for every supported tool from one source (Claude Code first).
- It generates blocking safety rules instead of advice in prose.

---

## 2. Intake (start of every piece of work)

| | |
|---|---|
| **Trigger** | `/mirai-new <request>` (or `/mirai-prd <request>` directly), or `mirai run --from intake <request>`. The request can be text, a file, or, once a connector exists, an issue key, a page URL or a thread link. Text read through a connector is fenced as untrusted data (R-C3). |
| **Who** | `mirai-product-manager` agent (persona proposed: **Nora**) |
| **Inputs** | the request plus every source you add when asked ("anything else?"); business context; feature map; existing PRDs |
| **Outputs** | `brief.md`, the **business requirements** brief (template based on Lenny's 1-pager structure; `research/07-doc-templates.md`). It contains: the problem, who it's for, why now, what success looks like, `BR-n` requirement IDs, the sources list, the proposed track and why, and open questions. For the `quick` track the brief is a few lines inside the ticket instead. |
| **Statuses** | a new work item is created with status `draft`; the brief goes `draft → in-review → approved` |
| **Human checkpoint** | `brief` gate: you approve the brief after the verifier's review and confirm the track. Always human (D6). For `quick`, the brief lines are approved together with the ticket. |

**Prior art:**
- The brain dump comes from `bmad-method/skills/bmad-prd/SKILL.md:42-65`: ask for all inputs, then
  "anything else?".
- Stakes calibration comes from the same section.
- The "misroute scan" (a tiny change shouldn't get a PRD) comes from `bmad-prd/SKILL.md:16-32`.

**What we changed:** the track is an explicit field that the rest of the flow reads. It decides
which documents are required.

---

## 3. PRD (requirements)

| | |
|---|---|
| **Trigger** | intake finished (`full` and `standard` tracks) |
| **Author** | `mirai-product-manager` (Nora) |
| **Verifier** | `mirai-verifier` (persona proposed: **Vera**), fresh context, model chosen by the ladder (Q12, D-14) |
| **Inputs** | intake note, sources, business context, feature map, related code (read-only) |
| **Output** | `prd.md` from the PRD template (full or lite variant; see `research/07-doc-templates.md`) + `prd.review-<n>.md` per verifier round |
| **Statuses** | `draft → in-review → changes-requested → draft → in-review → approved` |
| **Human checkpoint** | `prd` gate (default `human` in every preset; Q5) |

**Steps:**
1. **Interview, if the input is thin.** Use `mirai-interview`: one question at a time, each with a
   guess, until the agent is about 95% sure or you say "draft it". In autonomous mode there is no
   interview: the agent writes `[ASSUMPTION]` tags and an open-questions list. A blocking open
   question parks the item.
2. **Draft from the template.**
   - Functional requirements have stable IDs (`FR-n`) in the form "[Actor] can [capability]
     [under conditions]". Each one carries acceptance criteria with IDs `AC-FR-n.m`, and each
     traces to a `BR-n` from the brief. This is the start of the one ID chain (§5a).
   - Non-functional requirements get their own IDs (`NFR-n`). A missing number is written as
     `UNKNOWN`, never invented.
   - User journeys get `UJ-n` IDs.
   - The PRD has non-goals (at least one), success metrics plus counter-metrics, and an
     assumptions index.
   - Tech choices go to the design, not the PRD.
3. **Self-check** against the author checklist.
4. **Mechanical lint** (script `mirai lint prd`): required sections present, IDs unique and stable,
   no `TBD` in required sections, every FR has a testable consequence. A lint failure goes back to
   the author before any AI verifier runs, because it is cheap.
5. **Verify** (Vera, in fresh context). Vera does three things:
   - **Rubric:** the seven dimensions (decision-readiness, substance over theater, strategic
     coherence, done-ness clarity, scope honesty, downstream usability, shape fit).
   - **Input reconciliation:** one pass per source. What did the PRD silently drop?
   - **Testability:** can each FR become a ticket with a check?

   Output: findings, each marked `blocking` or not, each with a location.
6. **Fix loop.** Same rules as code review (§9: L1–L5). It runs through the shared **loop guard**
   from the first loop (R-C7). Only blocking findings send it back, at most 2 rounds. The author
   marks each finding `fixed` or `disputed`, and disputed findings go to you.
7. **Human gate (always, D6).** You read the PRD plus Vera's last review in `mirai inbox` and
   approve it there; `mirai approve <item>` does the same. Both need a real terminal; agents can't
   call them (D-17). The PRD moves to `approved`.
   - **What's logged:** your decision ("accepted as is / edited / rejected") and your review time
     (M1, M6; R-M18).
8. **Storage.** The doc is written to the one place configured for PRDs (D5): the repo, or one
   external tool. It is never kept in two places. With no tool connected, it stays in the repo.

**Versions (R-M11):**
- **Frontmatter `status` is the current state; the run log is the history.** `mirai status`
  reports a mismatch between them as an error.
- **An approved version is frozen.** A change creates `prd.v2.draft.md` beside the approved
  `prd.md`. It replaces `prd.md` only when you approve it.
- **Agents always read the approved version.**

**Prior art:** `bmad-method/skills/bmad-prd/`:
- FR format, NFRs, `UNKNOWN` and counter-metrics: `SKILL.md:67-73`;
- template: `assets/prd-template.md`;
- rubric: `assets/prd-validation-checklist.md`;
- input reconciliation: `SKILL.md:92`;
- headless contract with `assumptions[]` and `open_questions[]`: `references/headless.md`;
- each reviewer writes a file and returns only a summary: `SKILL.md:81`.

**What we changed:**
- A **separate verifier agent** in fresh context on a different model where available. In BMAD
  the author runs its own gate.
- **Lint before AI**, so the cheap check runs first.
- **Blocking/non-blocking triage with a round cap.**
- **Human approval is a recorded event**, not a frontmatter edit.
- A lite variant for the `standard` track, which absorbs the BMAD spec kernel
  (`bmad-spec/SKILL.md:9`): Why / Capabilities / Constraints / Non-goals / Success signal.

---

## 4. Design: HLD, ADR, LLD

| | |
|---|---|
| **Trigger** | PRD `approved` (`full` track; `standard` only if an ADR-worthy decision exists) |
| **Author** | `mirai-architect` (persona proposed: **Arlo**) |
| **Verifier** | `mirai-verifier` (Vera) with the design checklist |
| **Inputs** | approved PRD, codebase (read-only scan), conventions, existing ADRs/HLDs (their numbering and format win; D-20) |
| **Outputs** | `hld.md`, `adr/ADR-NNNN-<slug>.md` (one per decision), `lld-<epic>.md` where needed, review files |
| **Statuses** | each document separately: `draft → in-review → changes-requested → approved`; an ADR later → `superseded` |
| **Human checkpoint** | `design` gate (default `human` in every preset) |

**Which documents get written** (rules, not taste):
- **ADR:** for each decision that passes the test "two parts built independently could choose
  incompatibly, the choice is not obvious, and it's a real trade-off"
  (`bmad-architecture/SKILL.md:13`), or that is expensive to reverse
  (`addyosmani-agent-skills/skills/documentation-and-adrs/SKILL.md:27-34`). At least two
  alternatives, including "do nothing" where it makes sense.
- **HLD:** `full` track only. The system shape: context and containers (C4 levels 1–2 as Mermaid),
  main flows, data ownership, cross-cutting rules, and the NFR answers. It **links** to ADRs instead
  of repeating decisions.
- **LLD:** per epic, only when the epic introduces a new data model, a public API contract, or
  touches more than one module. Otherwise the per-ticket plan's design notes are enough.

**Steps:**
1. **Read before deciding** (brownfield). Ratify the conventions the code already has; don't invent
   new ones. Cite files for every claim about the code.
2. **Show the big choices.** The paradigm, the stack or starter, and the major boundaries are shown
   with the alternatives weighed, not silently made. In autonomous mode the architect may draft
   and the verifier may review, but the design is **never approved without you**: its gate is
   always human (D6).
3. **Draft** from the templates (chosen in `research/07-doc-templates.md`: HLD on arc42 + C4,
   ADR on MADR, LLD on a design-doc shape). Each document carries frontmatter `status`, `version`,
   `derived_from: prd@v<n>`.
4. **Mechanical lint:**
   - required sections;
   - Mermaid blocks are fenced, start with a diagram keyword and have balanced brackets (a full
     parse would need a dependency);
   - every ADR has alternatives and consequences;
   - every ADR "Confirmation" names a check ID that `mirai trace` can find;
   - every link resolves.
5. **Verify** (Vera, design checklist):
   - **Coverage map:** every FR/NFR is mapped to a component, an ADR, or `deferred` with a reason.
   - **Adversarial:** "two teams obey every rule here and still build incompatible parts. Where?"
   - **Feasibility:** claims about the codebase checked at the cited files.
   - **ADR quality.**
6. Fix loop (§9 rules, through the loop guard), then the human gate (always, D6), then storage
   (one place per type, D5).

**Prior art:**
- `bmad-method/skills/bmad-architecture/SKILL.md`: core test, read-before-deciding, "decisions,
  not rationale", reviewer gate, adversarial reviewer (`customize.toml:98-101`).
- Spine template: `assets/spine-template.md`, with AD IDs carrying Binds / Prevents / Rule.
- Addy's `documentation-and-adrs` for the ADR lifecycle and "match the existing convention first".
- The pilot's 16-section HLD template (`.claude/templates/hld-template.md`).

**What we changed:**
- BMAD has one "spine". We split it into the three documents people actually use (HLD / ADR /
  LLD), with rules for when each is needed.
- ADRs are immutable after approval.
- Verification is by a separate agent.

---

## 5. Tickets (splitting the work)

| | |
|---|---|
| **Trigger** | design `approved` (`full`), PRD `approved` (`standard`), or a direct request (`quick`) |
| **Author** | `mirai-ticket-planner` (persona proposed: **Tess**) |
| **Verifier** | `mirai-verifier` (Vera) with the ticket checklist + script checks |
| **Inputs** | approved PRD, HLD/LLD/ADRs, codebase map (which areas each ticket touches) |
| **Outputs** | epics + stories/bugs (repo files or the one configured ticket tool, D5) with a dependency list; review file. Each epic also records its release mode, `per-ticket` (the default) or `together` (§12a). |
| **Statuses** | ticket `draft`; the set is approved → each ticket `ready-for-dev` |
| **Human checkpoint** | `tickets` gate: **always human** (D6) |

**Slicing rules** (Q4 note; D-09):
- **A story is a vertical slice where it can be:** it touches each layer it needs and has its own
  acceptance criteria (Given/When/Then) and one runnable check. It lists the PRD ACs it covers
  (`covers_ac: [AC-FR-n.m]`). On the `quick` track, where there is no PRD, it mints its own
  `AC-<ticket>.n`. It is sized so that
  one agent session can plan and finish it, and its diff can be reviewed in about 15 minutes.
  Sizes S/M/L; anything bigger is split.
- **Exception: an interface first.** When two lanes would touch the same boundary, the interface
  plus a stub is its own early story, so both lanes can start.
- **The first story is a tracer bullet:** the thinnest path through every layer. Next comes the
  story you are least sure of.
- **Split, never shrink.** "For now", "placeholder" and "wired later" are a second story.
- **Every ticket records:**
  - `covers: [FR-…, NFR-…]`;
  - `governed_by: [ADR-…]`;
  - `after: [ticket ids]` (real prerequisites only);
  - `risk: normal|high` (auto-set from risk paths and keywords, can be raised by hand);
  - `size`;
  - `files_likely`;
  - `verify` (one sentence).
- Tasks are *not* tickets. They live inside the plan.
- Epics with more than 3 stories get a closing "refactor sweep" story by default.

**Checks:**
- **Script:**
  - the dependency graph has no cycles;
  - every FR, NFR and PRD AC is covered by at least one story (closure, through `mirai trace`);
  - stacking chains are at most 2 levels deep and stay inside one epic (§6);
  - no story is bigger than L;
  - every story has at least one AC and a `verify` line;
  - two stories that both list the same file without an `after` link get a warning.
- **Vera:** the BMAD checks (Ticket / Set / Tree / Dependencies / Closure).

**Prior art:**
- `bmad-method/skills/bmad-ticket/references/slice.md`: tracer bullet; lanes; "split, never
  shrink"; refactor sweep; one-session size; dated `Decision:` lines.
- `references/validate.md`: the check subagents.
- Store adapters: `config/*-ticketing.toml`.
- Status lives in the plan: `tools/ticket-tree-rules.md:21-35`.
- `addyosmani-agent-skills/skills/planning-and-task-breakdown/SKILL.md:57-141`: vertical slicing,
  size table, "break down further when…".

**What we changed:**
- Vertical slices are the default. BMAD allows stories that aren't user-visible.
- Interface stubs are the explicit exception.
- A 15-minute review size is added.
- `governed_by` links tickets to ADRs.
- The graph checks are deterministic.

---

## 5a. Traceability: one ID chain (R-M10)

```
BR-n  →  FR-n / NFR-n  →  AC-FR-n.m  →  ticket covers_ac  →  tests tagged with the AC ID  →  QA evidence per AC ID
```

- **The quick track** starts the chain at the ticket with `AC-<ticket>.n`.
- **`mirai trace`** is a lint that checks the whole chain:
  - every AC is covered by a ticket;
  - every ticket AC is covered by a test;
  - every AC has QA evidence;
  - every ADR "Confirmation" check exists.
- It runs at the ticket gate, before ship, and in CI.
- **Prior art:** BMAD TEA's trace step.

---

## 6. Plan (per ticket)

| | |
|---|---|
| **Trigger** | the orchestrator or you pick the next `ready-for-dev` ticket whose `after` tickets are `done`, or `built` in the same epic within the stacking depth (see "Branches" below). `mirai run --plan` previews what tonight can do. |
| **Author** | `mirai-developer` (persona proposed: **Kai**) |
| **Checker** | script lint always; `mirai-verifier` only on high-risk tickets |
| **Inputs** | the ticket, its epic, the docs it cites (`covers`, `governed_by`), conventions, sibling plans |
| **Output** | `<ticket>-plan.md` from the plan template |
| **Statuses** | ticket `ready-for-dev → in-progress` (plan written) |
| **Human checkpoint** | `plan` gate (`human` in `supervised`, `auto` in `autonomous`; **always `human` for high-risk tickets**) |

**The plan template contains:**
- a **frozen block**, owned by the human after approval: Intent (problem and approach), Boundaries
  (always / never), and an I/O & edge-case matrix;
- agent-owned sections: code map, tasks, a test list (one row per matrix row and per AC),
  verification commands, design notes (where no LLD exists), an append-only implementation log, a
  change log, and a review triage log.

**Gates:**
- **Pre-step guard** (script, before every step): a clean tree, the right branch, and a healthy
  project stack. Otherwise stop (R-C5).
- **Multi-goal check:** a second goal is split into a new ticket.
- **Open questions:** in supervised mode they stop for you; in autonomous mode they park the ticket.

**Branches (D2, R-C5):**
- **One checkout.** The MVP works sequentially in **one checkout and switches branches**. It
  creates no worktree per ticket, because the pilot's compose setup is bound to the checkout path
  (fixed project name, relative mounts, fixed ports). Worktrees or isolated compose projects come
  back with parallel lanes (see 07, Later).
- **The base branch:**
  - a ticket with no open dependency branches from `main`, or from `feature/<epic>` when the epic
    is `release: together` (§12a);
  - **stacking:** if ticket B depends on ticket A and A is `built` (MR open, not merged), B starts
    from **A's branch**. B's MR targets A's branch, so it shows only B's changes.
- **Stacking limits:**
  - at most **2 levels deep** (A → B → C);
  - **only within one epic**;
  - nothing ever merges without you.
- **When A changes:**
  - **You merge A:** MIRAI rebases B onto A's target and re-runs the quality gate. If B's patch-id
    is unchanged, its review record still holds (§9), so B doesn't pay for a second review. B's MR
    is retargeted.
  - **You request changes on A:** B is marked "waiting on A". It is rebased after A is fixed.
  - **The rebase conflicts:** B is parked with reason `rebase-conflict`.

**Prior art:** `bmad-method/skills/bmad-build/`:
- `plan-template.md` (frozen block);
- `step-01-clarify-and-route.md` (VCS sanity, multi-goal check);
- `step-02-plan.md` (investigate with subagents, READY standard, Checkpoint 1, re-read the plan
  from disk before acting on approval);
- `workflow.md:12-31` (plan size 900–1,600 tokens).

**What we changed:**
- The plan gate is configurable per stage and per risk tier.
- The plan carries the test list that TDD and QA both use.
- A rejected plan goes back to re-plan; it doesn't go forward (R-M12).

---

## 7. Build with TDD (per ticket)

| | |
|---|---|
| **Trigger** | plan approved (by you or by the `auto` gate) |
| **Who** | `mirai-developer` (Kai), **a fresh session whose only input is the plan** |
| **Inputs** | the plan file (sole source of truth), conventions, the repo |
| **Outputs** | code + tests on the ticket branch (one checkout, §6); red and green evidence in the run log |
| **Statuses** | stays `in-progress` |
| **Human checkpoint** | `build` gate (default `auto` after plan approval) |

**Steps:**
1. Record `baseline_revision`, which is never overwritten on resume. The orchestrator sets a
   **checkpoint git ref** before each step, so "redo the step" means a reset to it (R-M6).
2. **Red:** for each test-list row, write the test, run it through `mirai exec test <suite>`
   (inside the project's containers), and record the failing output. A test that passes on its
   first run is flagged: it may not test anything.
3. **Green:** write the minimum code to pass it. **Refactor** with the tests green.
4. **Bugs follow the prove-it pattern:** a test that reproduces the bug comes first.
5. **Matrix audit:** every matrix row and AC has a test that ran and passed. "Never edit the
   expectation to match the code."
6. **Floor guard** (script, before review): flags weakened or deleted tests, new skip markers, new
   lint suppressions, and lowered thresholds. It also fails any diff touching **protected paths**
   (§8).
7. **The developer runs the quality gate itself before handing over** (R-M4). Lint or test
   failures it fixes inside its own session don't use a round. Only a failure after handover
   (§8) does.
8. **The orchestrator checks the red evidence itself** (R-M8). It runs the new or changed tests
   against `baseline_revision`, and they must fail there. That run, not the developer's report, is
   the evidence for M15.

**Fix rounds resume the same developer session** instead of starting a new one, so a fix doesn't
pay for a cold start (R-M4).

TDD is the default for behavior changes. A plan can mark rows `no-test: <reason>` (pure config,
copy text). The reviewer sees that reason.

**Prior art:**
- `addyosmani-agent-skills/skills/test-driven-development/SKILL.md`: red-green-refactor;
  prove-it pattern; "tests that pass on first run" red flag.
- `bmad-build/step-03-implement.md` and `customize.toml:85-91`: a fresh implementer whose only
  input is the plan; matrix audit; judge the diff, not the report.
- `addyosmani-agent-skills/skills/constraint-driven-development/references/floor-guard.md`.

**What we changed:**
- Red evidence is produced by the orchestrator against the baseline, which gives metric M15.
- The floor guard is a script that runs before any reviewer.

---

## 7a. Safety while agents work (D7)

There is no container around Claude Code. The **project** runs in its own Docker containers;
Claude Code runs on your machine under the strict settings bundle from Setup step 8. Five layers
block, and each covers a gap the others leave (`research/09-claude-blocking-rules.md` §7):

| Layer | Blocks | Gap it leaves |
|---|---|---|
| Claude Code OS sandbox (Seatbelt) | shell commands and every process they start: reads outside the project, writes outside the project, network outside the allowlist | doesn't cover the file tools, hooks or MCP |
| Permission deny rules | Read/Edit outside the project, key folders, `git push`, `gh`, `docker`, `printenv` | `grep -r`, `sh -c` around a denied command (the sandbox catches these) |
| PreToolUse hooks (from the trust root) | secret patterns in written content; Glob/Grep outside the project | runs outside the sandbox, so its own code must be trusted |
| `pre-push` secret scan | a commit containing a key, a password or a token | can be skipped with `--no-verify` locally |
| CI secret scan | the same, on the MR, where it can't be skipped | none for this purpose |

**Two more rules:**
- **Agents never hold credentials.** The orchestrator pushes and opens MRs from outside the
  agent. An agent's environment is scrubbed except `CLAUDE_CODE_OAUTH_TOKEN`.
- **A branch can't loosen the rules.** Headless runs use `--setting-sources user --settings
  <trust root>/strict.json --strict-mcp-config`, so a branch's own `.claude/` files don't load.

**Red-team check:** the safety unit and `mirai doctor` run seeded attempts. Each one must be
blocked:
- reading `~/.ssh`;
- `curl` to a host not on the allowlist;
- `sh -c` around a denied command;
- `grep -r` from `/`;
- writing a fake key into a file.

**Honest residual risk:** this is weaker than a container per agent. The file tools and hooks run
outside the sandbox and depend on the deny rules being right. A bug in Claude Code's rule matching
would be a single point of failure for reads.

---

## 8. Checks (machine work first)

| | |
|---|---|
| **Trigger** | the developer hands over |
| **Who** | script: the project's quality-gate command (found at setup; pilot: `scripts/quality-gate.sh`), run from the **trust root** copy of MIRAI + floor guard + MIRAI lints + `mirai trace` |
| **Output** | pass/fail recorded in the run log |
| **On fail** | back to the developer. **A failure after handover counts as a fix round** (§9 caps). The same failure twice is a plan problem: park or re-plan. |

No LLM reviewer runs until checks are green (L6). Reviewers are told not to comment on what these
checks cover.

**The gate can't be edited by the work it checks (R-C2):**
- **The trust root.** At run start the orchestrator copies and hashes the framework, config,
  custom files and generated tool files **from the base commit** into a read-only folder outside
  the repo. Every launch, hook and gate uses that copy, never the branch's copy.
- **Protected paths:** `.mirai/**`, the tool folders, CI files, hooks, and lint and test configs.
  A diff touching them is forced to `high` risk and fails the floor guard. In autonomous mode the
  ticket parks.

**Environment faults are not agent failures (R-M5):**
- A **preflight check** runs before each run and each ticket: the stack is up, the login works,
  disk space is free, and the trust root hash matches.
- A **flaky test** is re-run once before it counts as a failure.
- **API errors** are retried with backoff.
- A **circuit breaker** stops the night with one clear message after N environment faults in a
  row, instead of parking every ticket.
- **A subscription usage limit** ("session limit" or "weekly limit") **pauses** the run; it does
  not park anything:
  1. The current step is logged and checkpointed, and the run state becomes `paused: usage-limit`
     with the reset time (read from the limit message when it has one).
  2. MIRAI waits (`caffeinate` keeps the machine awake). When the reset time is unknown, it checks
     with one tiny launch every 30 minutes, not a retry loop.
  3. At reset it resumes from the checkpoint: the interrupted agent session is resumed, or the step
     is redone. Round counters and budgets carry on; the pause never grants new rounds.
  4. If the reset falls after `run.stop_by` (your morning cut-off, config), or it's a weekly limit,
     the run stops instead and the morning report says when `mirai resume` can continue it.
  - Daytime supervised runs pause the same way and tell you in the terminal.
  - Resuming after reset uses the new limit window, which you may want in the morning. That's why
    `run.stop_by` exists.
- Environment faults **never use rounds**.

---

## 9. Review (per ticket)

| | |
|---|---|
| **Trigger** | checks green |
| **Who** | `mirai-reviewer` (persona proposed: **Rex**), fresh context, model by the ladder |
| **Inputs** | the diff since `baseline_revision` and the plan's claims, **as file paths, never pasted** (B8); the plan's frozen intent; the ACs; conventions; ADRs it must obey |
| **Output** | `review-<ticket>-r<n>.json` (findings, schema below) + a summary line; on PASS a **patch-id record** (see "Records" below) |
| **Statuses** | ticket `in-progress → in-review` |
| **Human checkpoint** | `review` gate (default `auto`; disputed findings always go to the human list) |

**Depth matches risk** (L7):
- **`normal`:** one combined pass covering correctness, edge cases, intent alignment, and test
  gaps.
- **`high`:** separate lens passes in parallel: a blind hunter (diff only), edge cases,
  verification gap, and an intent-alignment auditor (gets the verbatim intent). Plus security and
  architecture lenses (the pilot's high tier).

**Loop rules** (from Q5; enforced by the orchestrator script, not by agent goodwill):

| Rule | Mechanism |
|---|---|
| L1 Only blocking findings send work back | A finding is `blocking` only if it cites `file:line` **and** a `basis.ref` the script can resolve: an AC ID, an ADR ID, a convention rule ID, or a runnable repro command for a concrete failure (crash, data loss, security). The script downgrades a blocking finding whose `basis.ref` doesn't resolve. Non-blocking findings → follow-up list in the report. |
| L2 Findings freeze after round 1 | From round 2 the reviewer gets only (a) last round's blocking findings and (b) the delta diff. A new finding is allowed only if it is blocking *and* its cited lines are inside the delta. |
| L3 No debate | For each finding the developer answers `fixed` or `disputed: <one sentence>`. Disputed → `mirai inbox`. The reviewer doesn't reply to disputes. |
| L4 Same failure twice = plan problem | The script compares finding fingerprints (file + symbol + `basis.ref`, never line numbers) and test-failure signatures across rounds. A repeat → route `bad_plan` (re-plan at most once) or park. |
| L5 Progress or stop | Open blocking count must strictly drop each round. Churn detection: the same file's blob hash returns to an earlier value. Either → park. |
| L6 Machines first | §8 runs before any review. |
| L7 Depth by risk | Above. |
| L8 Script decides | The orchestrator reads verdict files. Agents never talk to each other. |

**Caps:** 2 fix rounds (`normal`) / 3 (`high`), counting post-handover check failures, review
rounds and QA failures together. Each ticket also has a budget by size, counted in turns, tokens
and minutes. At a cap → `blocked` with a parking note.

**The loop guard (R-C7)** is one shared library, used by every fix loop: documents and build alike.
It holds:
- the round counter and the budget ledger;
- the fingerprints;
- the strict-progress check;
- the parking-note writer.

Counters are saved to the orchestrator store (§17) **before** each launch. `resume` never resets
them: a restart can't grant fresh rounds.

**Records (R-C1):**
- **What a PASS record binds to:** `git patch-id --stable` of `merge-base..head`, restricted to
  **code paths**. The `[gate] code_paths` setting excludes `.mirai/**`, the docs root and MIRAI
  bookkeeping by default.
- **Why:** MIRAI writing the QA report or bookkeeping after review doesn't invalidate the record.
  A clean rebase keeps the same patch-id, so only the quality gate re-runs.
- **Storage:** each record is its own immutable file, `<ticket>/<kind>-r<n>-<patchid>.json`. It is
  signed with an HMAC key in `~/.config/mirai/`, which the sandbox and deny rules keep agents
  from reading (R-M1).

**High-risk tickets only: check each finding.** Before the developer sees a blocking finding, a
short separate check confirms it at the cited location. A finding that isn't confirmed is dropped
and logged as `false`, which feeds M5 (reviewer precision). The idea comes from Anthropic's
code-review plugin, used as an idea only because of its license (`research/06b-skill-sweep.md`),
and BMAD's "verify every claim at the cited location" (`bmad-build/step-04-review.md`).

**Prior art:**
- `bmad-method/skills/bmad-build/step-04-review.md`: spawn all lenses before reading any; verify
  claims at the cited location; verdicts high/medium/low/false/maybe-false; routes intent_gap /
  bad_plan / patch / defer; loop cap 5.
- `bmad-method/skills/bmad-code-review/`: quick/thorough sets (`customize.toml:43, 72-152`); diff
  staged as files (`step-01:32`); intent alignment (`customize.toml:148`).
- `cursor-plugins/pstack/skills/interrogate/references/lead-judgment.md`: filtering nitpicks.
- bmad-loop budgets: `max_review_cycles` 3, `max_dev_attempts` 2
  (`bmad-loop/docs/reference/configuration.md:84-104`).
- Pilot risk tiers and the reviewer-verdict capture (`.claude/hooks/mark-review-complete.sh`).

**What we changed:**
- The citation rule turns "blocking" into a checkable claim.
- Findings freeze after round 1.
- No debate rounds.
- Repeat detection and strict-progress rules.
- Lower caps (2/3 instead of 5).
- One shared round budget across checks, review and QA.

---

## 10. QA / verification (per ticket)

| | |
|---|---|
| **Trigger** | review PASS |
| **Who** | `mirai-qa` (persona proposed: **Ivy**), using the project's generated `verify-<app>` skill |
| **Inputs** | the running app, started by the orchestrator in the project's own containers (the agent gets only its URL, never `docker`); ACs; the plan's matrix; the feature map |
| **Output** | `qa-<ticket>.md`: one row per AC ID with PASS/FAIL and evidence (screenshot path, command output, test name), plus edge-case probes from the matrix. Evidence files go in `.mirai/` artifacts per ticket, size-capped; screenshots are referenced, not inlined. |
| **Statuses** | stays `in-review` until QA passes |
| **Human checkpoint** | `qa` gate (default `auto`) |

**Rules:**
- No evidence = not passed. "Inconclusive or wrong-surface is not a pass."
- A QA FAIL goes back to the developer and **uses the same round budget** as review.
- If the app can't start, the ticket parks with reason `environment`. QA doesn't try to fix the
  environment, and the failure uses no round (§8).
- **The browser driver is the project's own Playwright setup,** run through
  `mirai exec test <suite>` inside the project containers, or Playwright MCP against the app URL
  (R-M17). The issue taxonomy and report shape follow vercel `dogfood` (`research/06b-skill-sweep.md`).
- **Precondition for the pilot:** the local URLs (open question P7) are settled and the pilot
  starts.

**Prior art:**
- `cursor-plugins/pstack/skills/create-verification-skill/` and `maintain-verification-skill/`:
  the feature map, driving the real app.
- pstack `playbooks/bug-fix.md`: the "wrong surface" rule.
- `obra-superpowers` `verification-before-completion`: logic only.

**What we changed:** QA evidence is tied to AC IDs, so metric M8 (evidence coverage) can be
computed.

---

## 11. Ship: push and MR

| | |
|---|---|
| **Trigger** | QA PASS |
| **Who** | `mirai-ship` skill (mostly script), run by the **orchestrator, outside the agent**: commit per repo convention, push the ticket branch, open the MR with the host CLI (`gh` / `glab`). Agents hold no push credentials (§7a). |
| **Output** | MR with a description from the template: Why / What changed / ACs with evidence links / Risk / Follow-ups (non-blocking findings) / Links (ticket, PRD, ADRs) / stack position ("based on !A"). Selected run-log lines are exported into the MR for CI and metrics. |
| **Target branch** | `main`; A's branch when stacked (§6); `feature/<epic>` when the epic is `release: together` (§12a) |
| **Statuses** | none written. The ticket *is* `built` because an open MR exists whose head has valid records (R-C4). |
| **Human checkpoint** | one `ship` gate covering push + MR (R-M2): `human` in `supervised`, `auto` in `autonomous`. **Every merge is `human`. Agents never merge anything: not into `main`, not into a feature branch, not into a stacked parent.** |

**Enforcement (Q3, D-15):**
- **`pre-push` hook** (installed outside the work tree, run from the trust root): refuses unless
  - a valid review record and QA record exist for the branch's current patch-id;
  - checks are green;
  - the secret scan is clean.
- **CI job:**
  - checks out `pull_request.head.sha`, not the merge ref;
  - re-runs the quality gate, the secret scan and `mirai trace`;
  - re-verifies the records and the framework against the **base branch's** `mirai.lock`.

  A required status check blocks the merge without them. If the host plan can't make the check
  required, `doctor` says "merge gate: local-only" (R-M21).
- **MR creation is idempotent:** if an MR for the branch already exists, it is updated, not opened
  twice (R-M6).

**Prior art:**
- `bmad-build/step-05-present.md`: "NEVER auto-push" (we allow push, never merge).
- pstack `playbooks/opening-a-pr.md`: PR body sections, small PRs.
- pstack `playbooks/babysit.md`: never merge unless asked.
- pstack `playbooks/shipping.md`: the `git patch-id` idea.

---

## 12. Merge and done

You merge the MR. The merge is the human act.
- **`done` is derived, never written** (R-C4). A ticket is `done` when its MR is merged into
  `main` (from git or the host API), or, in a `together` epic, when its MR is merged into
  `feature/<epic>` and that branch is merged into `main`.
- **Nothing commits to `main` after a merge.** No status files are written there.
- **An epic is done** when all its tickets are done.
- **No agent moves a ticket past `built`.** `built` is itself derived
  (`bmad-method/tools/ticket-tree-rules.md:35`).

**After review on the host (R-M12):**
- **MR comments or a red CI:** the ticket goes back to `in-progress`. It gets a new round budget
  that you grant in `mirai inbox`, and the grant is logged.
- **MR closed without merge:** the ticket goes to `dropped`, or back to `ready-for-dev`. You
  choose.
- **Stacked tickets on top:** they follow §6, "When A changes".

---

## 12a. Release

MIRAI does **not** replace the project's deploy pipeline. It wraps it with a check and your
decision. Projects differ and change over time, so the stage follows `release.environments` in
config: with staging, steps 1–2 run there; without staging, step 2 is skipped and the smoke check
runs after the production deploy; a project not released yet only gets the record. Adding staging
later is a config change. Each epic chooses one release mode (D3):

### `release: per-ticket` (the default)

Each ticket is released on its own after you merge it.
1. The project's CD deploys the merged change (to staging first, if the project has one).
2. Ivy runs a smoke test plus the ticket's ACs on the deployed environment, with evidence.
3. You give the production go/no-go (`deploy_prod`, always human).
4. CD deploys to production, and a smoke check runs there. On failure, the project's rollback
   runs and you are told.

**Feature flags:** a flag is added **only when you ask for one** in that ticket. For example, you
might ask when a ticket isn't safe to release on its own. MIRAI never adds a flag by itself.

### `release: together` (you choose it per epic)

For an epic that should go live as one piece:
1. **The feature branch.** At the ticket gate, MIRAI creates `feature/<epic>` from `main`.
2. **Ticket MRs target it.** Every ticket MR targets `feature/<epic>` (stacking still applies
   inside it). You approve each merge into it; `mirai inbox` can batch them.
3. **Final E2E test.** When all tickets are merged into it, Ivy runs a **final end-to-end test**
   of every AC in the epic on the feature branch, in the project containers, with evidence per AC
   ID.
4. **One MR to `main`.** It carries the E2E report. You merge it.
5. **One release,** with the same steps 1–4 as per-ticket.

| | |
|---|---|
| **Who** | the project's own CD deploys. `mirai-qa` (Ivy) verifies. `mirai release` (script) records the release. |
| **Outputs** | `releases/<version>.md`: which tickets and PRDs are in it, evidence per AC, your go/no-go, the production smoke result |
| **Statuses** | the release record goes `staging → verified → approved → live` (or `rolled-back`). When every ticket of a PRD is live, the PRD's work item is marked `live`. |
| **Human checkpoint** | `deploy_prod`: **always human**, like merge |

**MVP vs later:**
- **MVP-complete (see 07):** per-ticket release and `together` with a final E2E, provided the
  project has a deploy command or pipeline that MIRAI can trigger or watch. Without one, the
  release stage is the record plus your decision.
- **Later:** watching error rates after a deploy through an observability connector.

---

## 13. Report (after every run, and the "morning report")

| | |
|---|---|
| **Trigger** | the end of any `mirai run`, or `mirai report` |
| **Who** | `mirai-report` (script; an LLM only writes the short "what needs your call" summary) |
| **Output** | `reports/run-<date>-<id>.md` plus the terminal: done (MR links, stack order), parked (with parking notes and reasons, plus any `usage-limit` pauses with their reset times), follow-ups, turns/tokens/minutes per ticket and total with the estimated dollar cost, what waits in `mirai inbox`. Metrics: M1, M3, M4 and M6 first; the others once enough data exists (R-M18). A Slack post comes later. |

---

## 14. Resume

`mirai resume` reads the orchestrator store and each item's status, then lists:
- what is in progress;
- what is parked and why;
- what waits for you.

**What it does:**
- It continues from the last *finished* step. A half-finished step is reset to that step's
  checkpoint ref and restarts from its beginning.
- **It never resets round counters or budgets** (R-C7; BMAD TEA: "a restart cannot grant three
  more rounds", `run-and-heal.md:28`).
- It works from any tool, on any day, because state lives in files, never in a chat session (Q7).

**Crash safety (R-M6):**
- **A run lock:** one `mirai run` at a time per repo.
- **Idempotent steps:** for example, MR creation checks whether the MR already exists.
- **No sleep:** macOS sleep is prevented during a run (`caffeinate`).

**Prior art:**
- pstack `playbooks/session-pickup.md`: "The prior trail is authoritative input".
- `addyosmani-agent-skills/skills/context-engineering/SKILL.md:123-137`: restartable session
  boundary.
- BMAD TEA progress checkpoints that refuse a foreign checkpoint
  (`bmad-tea-test-design/steps-c/step-01b-resume.md`).
- bmad-loop `state.json` + `journal.jsonl` + `heartbeat.json`.

---

## 15. Change requests (requirements move after approval)

Approved documents are never edited in place (R-M11):
- **A change creates a draft beside the approved file**, for example `prd.v2.draft.md` next to
  `prd.md`. Agents keep reading the approved version until you approve the draft.
- **On approval** the draft replaces it as `version: 2`, and v1 is `superseded`. The old file is
  kept under its version name.
- **Every downstream item records its source** (`derived_from: prd@v1`).
- **`mirai status` flags stale items,** meaning items built from an older version. You decide:
  re-slice, keep, or drop.
- **ADRs follow the same rule:** a new ADR supersedes the old one.

**Prior art:** `bmad-method/skills/bmad-correct-course/`; `bmad-spec/SKILL.md:133-139` ("The
update itself never edits a ticket").

---

## 16. Human checkpoints per stage (the presets)

| Stage | `supervised` | `autonomous` | Can ever be `auto`? |
|---|---|---|---|
| Track choice | human | auto for quick/standard; human for full | yes (quick/standard) |
| Brief | human | human | **no**: every document needs you (D6) |
| PRD | human | human | **no** (D6) |
| Design (HLD/ADR/LLD) | human | human | **no** (D6) |
| Tickets (the set) | human | human | **no** (D6) |
| Plan | human (batch in `inbox`) | auto (human if high risk) | yes |
| Build | auto | auto | yes |
| Review | auto | auto | yes |
| QA | auto | auto | yes |
| Ship (push + MR) | human | auto | yes |
| Merge (into `main`, `feature/<epic>` or a stacked parent) | human | human | **never in MVP** |
| New round budget after MR comments | human | human | no |
| Unpark | human | human | no |
| Deploy to staging | project CD (auto) | project CD (auto) | n/a |
| Final E2E (`together` epics) | auto | auto | yes |
| Deploy to production | human | human | **never in MVP** |

These presets are config (`[gates]` in `.mirai/config.toml`), and you can change any `yes` line.
When a stage's metrics clear your threshold, MIRAI *suggests* moving it to `auto`. It suggests
moving it back when they drop (Q6). Metrics never flip a gate by themselves.

**The autonomous preset refuses to start** when any of these is missing:
- the strict settings bundle;
- a passing red-team check (§7a);
- a clean preflight.

---

## 17. What every stage logs

Each agent run writes one line (fields in `00-interview-log.md` Q6). Status changes, gate
decisions, human decisions, parking and loop events are lines in the same run file.
- **Format:** JSON Lines. Every line carries `{schema_version, run_id, seq, ts, item, by}`.
- **One file per run.**
- **Written only by the `mirai` script.** Agents call `mirai log …`, which refuses privileged
  event types (approval, record, gate result, human-only status). The orchestrator writes the
  rest (R-M1).

**Where state lives (R-C4):** there are two kinds of state, kept apart.

| Kind | What | Where |
|---|---|---|
| **Branch-carried facts** (travel with the MR) | document content and versions, approval events, review and QA records, run-log lines exported at ship time | the branch, committed |
| **Operational state** | run progress, rounds, budgets, parking notes, checkpoint refs, the run lock, heartbeat | the **orchestrator store** at `<git-common-dir>/mirai/`. Shared by every branch in one checkout, never committed. |

- **`built` and `done` are derived** from MRs and merges, never stored (§11, §12). That keeps
  status edits on two branches from conflicting at merge.
- **Every permission denial is logged.** Claude Code's `stream-json` output lists them, which
  gives an audit trail for the blocking rules (§7a).

**Prior art:**
- BMAD `memlog.py`: append-only, blind writes, `O_APPEND`.
- bmad-loop `state.json` + `journal.jsonl` + `heartbeat.json`.
- pstack `show-me-your-work` + `log.sh`: a decision trail with evidence.

**What we changed:**
- One schema covers document decisions *and* agent actions *and* cost.
- The metric fields exist from day one.
- Operational state lives outside the branches, so one night across many ticket branches has one
  place to resume from.
