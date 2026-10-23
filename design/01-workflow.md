---
status: draft
version: 4
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
`00-interview-log.md`. Prior-art paths are relative to `~/Projects/mirai-sources/`; "pilot" means
`people-management-tool/platform`. Version 2 applied the round-1 decisions (`06-review-round-1.md`
§G) and the follow-up agreements Q1–Q9 (`08-followup-discussion.md`). Version 3 applies review
round 2 (`06-review-round-2.md`, fixes R2-C1…R2-M15 and your decisions U1–U5 in §G). Version 4
applies review round 3 (`06-review-round-3.md` §B, with your decisions V1–V3 in §D).

**The integration branch.** Everywhere this file used to say `main`, it now means the configured
**`[git] integration_branch`** (default `main`; `mirai/pilot` during the pilot, D-28, R3-C1). The
trust root, the ticket base, the MR target, the docs MR, the test baseline and the CI base all read
it. So the pilot never touches the product's real `main`.

**No OS boundary between the agent and you (V1 = (a)).** Agents run as your own macOS user, under
the blocking rules of §7a; there is no separate user and no container around Claude Code. §7a says
honestly what that leaves open, and what stops headless runs if the red-team tests find it.

**The pilot starts right after Milestone A** (U1). Every unit is first built and tested on the
sample app, a **private** repo of its own in the pilot's stacks (Laravel/PHPUnit, React/Vitest,
Playwright), so no exit MR lands on the public MIRAI repo (R3-M1). The pilot then repeats each
milestone's exit check on real tickets, and the calibration run uses pilot tickets (see 07).

**One machine (U3).** The MVP assumes MIRAI runs on one machine. Run state stays on that machine
(Q9: no run-log lines are committed). `mirai export/import` to move it comes later.

---

## 0. The big picture

```
 setup (once per project)
   └─► intake ─► PRD ─► design (HLD / ADR / LLD) ─► tickets ─► per ticket: plan ─► build (TDD by setting)
                                                     ─► checks ─► E2E test (Ivy, if e2e: yes) ─► review ─► QA ─► ship (orchestrator: push + MR)
                                                                                                                  └─► you merge
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

The PM agent proposes the track at intake, with one sentence of reasoning, and you confirm it at
the first document gate of that track (U4, R2-M3):

| Track | Your actions before the build | Where you confirm the track |
|---|---|---|
| `quick` | **approve the ticket**, then **merge** the MR: 2 actions (the quick plan gate is `auto`). Once the release stage exists, plus your production **go/no-go**: 3 | at the ticket approval |
| `standard` | approve the **brief and PRD together**, approve the ticket set, merge each MR (+ one go/no-go per release) | in the PRD header, at the PRD gate |
| `full` | approve the brief, the PRD, the design and the ticket set, merge each MR (+ one go/no-go per release) | at the brief gate |

There is no supervised `ship` gate: **your merge is the gate** (R2-M3). **The docs MR is not your
action** (V3): after your signed ticket-set approval the orchestrator merges the docs MR itself
(§3 step 8). That is the only merge MIRAI ever performs, and it carries documents only. This table
is a summary; **§16 is the one gates table** (R3-M4).

**Two ways to run the same stages** (D-12):
- **Supervised:** you type a command in your tool (for example `/mirai-prd`) and work with the
  agent.
- **Scripted:** `mirai run` (the orchestrator) walks the stages itself.

Both paths use the same skills, write the same files, and log the same way. The difference is only
which gates are `human` and which are `auto` (Q5).

**One repo or several (`08` Q3).** The config has a `repos` list: name, local path, remote URL,
and start + health commands per repo.
- **Monorepo:** MIRAI is installed in the repo, and `repos` has one entry, `.`.
- **Multi-repo:** MIRAI lives in a separate **workspace repo** that points to the service repos.
  The workspace repo holds the config, business context, documents, tickets (when stored in the
  repo), run state and reports. Each service repo gets a light install (conventions, quality gate,
  hooks, CI) and no document copies (D5).
- Growing from one shape to the other changes only `repos` and where the docs live. The stages
  below are the same in both.

**Model tiers (`08` Q5).** Every step runs at the cheapest tier that does it well:

| Tier | Runs | Used for |
|---|---|---|
| 0 · no AI | a script | anything where the data already exists: publishing an approved ticket, status changes, MR creation, the report skeleton, lints |
| `light` | small model (e.g. Haiku) | rewording with all facts given: commit messages, MR descriptions, report summary, parking-note wording |
| `standard` | mid model (e.g. Sonnet) | developer on S/M tickets, ticket planner, plans, QA, quick reviews, document verification |
| `deep` | strongest model (e.g. Opus) | PRD writing, architecture/HLD/ADRs, high-risk reviews, L tickets, re-planning after failure |

- **Names, not model IDs:** the config maps `light / standard / deep` to models.
- **Raised by risk and size:** high-risk or L work moves up a tier. Judgement steps (PRD and
  design work, high-risk reviews) are never downgraded.
- **Escalate once, tier-1 steps only (R2-M9):** a `light` step (commit message, MR text, report
  summary) that fails its check twice is retried once at `standard`. These steps are outside the
  review rounds, so this never collides with the loop rules (L4) or the round caps. Review and
  fix rounds don't escalate; a repeat failure there is L4 (re-plan or park, §9).
- **The verifier ladder (D-14, R2-M9):** the verifier uses
  1. a different model family when one is available;
  2. otherwise a different Claude model (for example Fable when the author used Opus);
  3. otherwise the same model in a fresh context, **logged as such**.

  A deep, high-risk review on Claude only is therefore always possible.
- **Measured:** every run logs `tier` and `model`. The calibration run sets the per-step defaults
  (see 07).

**Your approvals go through one place: `mirai inbox`.** It runs in a real terminal and lists
everything waiting for you: documents, plans, disputed findings, parked tickets and MRs. Plans can
be approved in a batch from a short review packet. A parked ticket comes back only through
`mirai unpark <ticket>`, which asks for a note on what you changed and one of three choices:
**re-plan**, **retry** (same plan, a fresh round budget you grant, logged) or **drop** (R-M2,
R2-M3). Merges into `feature/<epic>` are also approved here (§12a).

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
| **Outputs** | `.mirai/config.toml` (including `[git] integration_branch`, `repos`, `resources`, test levels, the **named checks**, `tdd`/`tests`, the branch pattern), `.mirai/context/*` (project, business, conventions per service, feature map with critical journeys), the test baseline, generated `verify-<app>` skill, connector proof, git hooks + CI job, the **strict settings bundle** for Claude Code, a `.env.test` with dummy secrets for agent-triggered test runs, the tool files (Claude Code first; Codex and Cursor later, see 07). Outside the project: the **MIRAI home for this repo**, `~/Library/Application Support/mirai/<repo-id>/` (orchestrator store, trust root, hooks, `config.user.toml`, cache, `reports/`), and the Ed25519 signing key in `~/.config/mirai/` (its public key is committed) |
| **Statuses** | each context file starts `draft`; you approve → `approved` |
| **Human checkpoint** | always: you approve the config and every context file before first use |
| **Checked by** | `mirai doctor` (script): install, config, hooks, CI, connector, a smoke run of one agent |

**Steps:**
1. **Detect, don't ask.** Scan:
   - languages and frameworks;
   - services (compose files);
   - test, lint and build commands;
   - the quality-gate script, split into **named checks** (`lint`, `types`, `build`, …) that the
     orchestrator runs through `run_tests` in hardened containers (§7a, §8, R3-C2). The pilot's
     `docker compose exec` gate on the normal stack is not used for agent work, because that
     stack has the real `.env` and an open network;
   - CI;
   - the branch-name and commit conventions. MIRAI's ticket branches follow the project's own
     branch pattern (for example `feature/PROJ-123-short-name`); there is no MIRAI prefix. A
     strict commit format is noted so the `Mirai-Ticket: <id>` trailer can fit it (§11);
   - **the test levels per repo or service:** frameworks (PHPUnit/Pest, Vitest/Jest,
     Playwright, …), test folders, commands, and how they run in Docker;
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
     or the docker socket, because those containers run agent-written test code (D7). The same
     check runs again before every test run (§7a), because a branch can change compose files.
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
   - verifier model ladder and the tier mapping (§0);
   - the `repos` list, if more than one repo is involved (§0);
   - **`resources`**: links and names only, never credentials. Code hosting (GitHub/GitLab repos,
     CI pages), cloud (GCP projects, AWS account/region, console links), monitoring (Grafana,
     Datadog, Coralogix, error tracking), runbooks, status page, API docs. Agents read them as
     context in the MVP. Internal URLs and IDs are added to the leak scanner's block list
     automatically (D-21);
   - the branch pattern, if it wasn't detected;
   - `tdd` and `tests` (§7) and which test levels new work should use (step 3b).
3a. **Business context** (`08` Q4). Sources first, questions second:
   - Setup asks what describes the business: files (pitch deck, feature list, specs), URLs
     (website, Confluence or Notion pages, app store page) or pasted text. It reads them, then
     interviews only the gaps. A new project with no sources gets the interview only.
   - It writes `.mirai/context/business.md` from a fixed template: what the product does; who it's
     for (users, customers, who pays); business model and goals/KPIs; **what this project or repo
     is responsible for, and what it is not** (one line per repo in a workspace); key business
     rules; domain glossary; constraints (legal/compliance, markets, languages); stakeholders
     (optional).
   - Every claim names its source (link, file, or "you said, <date>"). Sources are stored as links
     in `resources`, not copied. Fetched content is fenced as untrusted data.
   - It's capped at about 1–2 pages; long sources are summarised, with the link kept.
   - From it, setup proposes the first **critical journeys** list for the feature map (§10). You
     approve both.
3b. **Test levels and the test baseline** (`08` Q8):
   - **One config entry per level** (`unit`, `integration`, `api`, `e2e`, `contract`, …): its
     command, what it's for, when it's required (for example `api` for endpoint changes, `e2e`
     only for critical journeys), and a time budget. Agents run a level only through the MIRAI
     MCP tool `run_tests(level, path?)` (§7a).
   - **A test adapter per stack** (R2-M7): how to run one file or test ID (not only the whole
     suite), where the JUnit-XML results and the lcov/Cobertura coverage land, and how an
     assertion failure is told apart from an error. MIRAI reads only those formats, with small
     zero-dependency parsers.
   - **Missing levels: suggest, never force.** Setup offers a minimal setup (for example a
     container-based Playwright setup) only with your yes; otherwise the level stays off. The
     recommended minimum is unit + one of integration/API, plus E2E for critical journeys only.
     You decide per project.
   - **Multi-repo:** a `contract` level is suggested, so interface tickets ship with a contract
     test.
   - **The test baseline** records existing levels, run times, coverage if available, and **the
     tests that already fail or are flaky**. The gate uses it so old failures don't block new
     work (§8). It is **refreshed from the integration branch at the start of every run**, so it
     doesn't go stale (R2-M7). **It has one home**, the MIRAI home (R3-M10): the signed
     gate-result record (§8) names the baseline it used and its known failures, and CI reads that
     list from the record instead of keeping a second copy.
   - **Test gaps are reported, not fixed.** The baseline lists them as information. Test-debt
     tickets exist only when you ask for them.
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
   - git hooks, installed **outside the project** in the trust root (`<trust-root>/hooks`, inside
     the MIRAI home) and hash-checked against the integration branch's `mirai.lock` (R-C2, R2-C1).
     Every host git call by MIRAI is **pinned** (R3-C4): it first checks `.git/config` against the
     hash MIRAI recorded last time and refuses if it changed, then runs with
     `-c core.hooksPath=<trust-root>/hooks -c core.fsmonitor=false -c core.sshCommand=ssh
     -c credential.helper= -c diff.external= -c core.pager=cat -c protocol.ext.allow=never` and
     `GIT_OPTIONAL_LOCKS=0`. So nothing an agent or a container writes into `.git/config` (filters,
     includes, helpers, remotes) runs on your machine through MIRAI;
   - the Ed25519 signing key pair: the private key in `~/.config/mirai/`, the **public key
     committed** in `.mirai/` with a **key id** (R2-C5, R3-M10). **Bootstrap:** the first public
     key arrives in the first docs MR; `mirai-verify` accepts a key-adding MR only when you merge
     it by hand, and only that one. **Revocation:** a revoked key id is listed in `.mirai/` and
     proofs signed with it fail;
   - the two CI jobs: `mirai-verify` and the test job (§11);
   - per-tool hooks (fast feedback only).
8. **Generate the strict settings bundle for Claude Code** (D7; `research/09-claude-blocking-rules.md`
   §7). These rules **block**; they don't just advise:
   - **Sandbox:** Claude Code's OS sandbox is on and can't be escaped
     (`allowUnsandboxedCommands: false`). **"Outside the project" is written with the sandbox's
     `denyRead`/`allowRead`** (the narrower path wins): your home folder is denied, the project and
     the toolchain caches are allowed (R2-M10). The MIRAI home and `~/.config/mirai` get
     `denyRead` **and** `denyWrite`. Inside the project, `.git/**` gets `denyWrite` (R2-C1,
     R3-C4). The network is a strict allowlist. Setup first tests an **empty** headless allowlist,
     because Claude Code's own API traffic may not go through the sandbox (`05` §G, R3-M5); the
     package registries are added only if that test fails, and dependency installs go through the
     broker, never through the agent's shell.
   - **Deny rules** for the file tools, which run outside the sandbox: `Read`/`Edit` of the MIRAI
     home, `~/.config/mirai`, `~/.ssh`, `~/.aws`, `~/.config/gh`; `Edit` of `.git/**`; and
     `Bash(git push *)`, `Bash(git commit *)`, `Bash(git config *)`, `gh`, `docker`, `claude`
     (an agent can't start its own `claude -p` outside the launcher, R3-M5), `mirai` (§7a). In headless
     runs also `WebFetch`, `WebSearch` and the Task/Agent tool (native subagents would bypass the
     launcher, R2-M10). Denying `env`/`printenv` is kept but is cosmetic; the real protection
     for the login token is in §7a.
   - **Hooks:** they block secret patterns in Write/Edit content, and Glob/Grep paths outside the
     project, which permission rules can't cover.
   - **Tests and checks:** agents run tests and named checks only through the MIRAI MCP tool
     **`run_tests(level, path?)`** from the trust root. It takes structured arguments, has no
     shell, and runs inside the project's own Docker containers (§7a). There is no shell exception
     any more (R2-C2).
   - **The MIRAI MCP broker** (R3-C3): every other MIRAI action an agent or a workflow skill needs
     (`launch`, `log`, `lint`, `trace`) is a tool on the same narrow broker, which runs outside the
     sandbox as the orchestrator. **No sandboxed process calls `mirai` directly**; the CLI would
     need the MIRAI home, which the sandbox denies.
   - **Environment:** the agent's environment is built from an **allowlist** (R3-M13), not by
     removing known names.
   - **Base mode:** setup evaluates `--restricted` as the base for headless runs, with only
     `--settings <trust-root>/strict.json`; otherwise user settings are excluded too, because
     their `env` could re-inject an API key and silently switch you to API billing (R2-M10).
   - **Daytime and overnight:** in an interactive session, access outside the project is an
     **`ask`** ("not without my approval"). In a headless run the same rules are **deny**
     (`--permission-mode dontAsk`).
   - **Locking the rules:** setup can also install the rules as macOS managed settings, so no
     project file can loosen them. That needs admin rights and your yes.
9. Run `mirai doctor`. It reports:
   - "merge gate: CI-enforced" or "local-only" (R-M21), and plainly that **your merge is the
     final gate**; CI is a strong second check (R2-C5);
   - whether the gate sees a marker change on the current branch;
   - the result of a red-team check of the blocking rules (§7a);
   - whether `resources` links sit in a public project repo (warning only);
   - the integration branch, and that the trust root was taken from it.

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
- It builds the business context from your sources, with a fixed template and a source per claim.
- It records the test levels and a test baseline, so an existing project without AI can be used
  as it is.
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
| **Human checkpoint** | Always human (D6), and **one way in every view** (R2-M3, U4): `full` has its own `brief` gate (you approve the brief after the verifier's review and confirm the track); `standard` has **no separate brief gate**: the brief is approved together with the PRD, and the track sits in the PRD header; `quick` approves the brief lines together with the ticket. |

**Prior art:**
- The brain dump comes from `bmad-method/skills/bmad-prd/SKILL.md:42-65`: ask for all inputs, then
  "anything else?".
- Stakes calibration comes from the same section.
- The "misroute scan" (a tiny change shouldn't get a PRD) comes from `bmad-prd/SKILL.md:16-32`.

**Business context stays current (`08` Q4):** when a request contradicts `business.md` (for
example a new customer type), Nora proposes an update to it for your approval. It never changes
silently. `mirai doctor` reports the file's age.

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
| **Output** | `prd.md` from the PRD template (full or lite variant; see `research/07-doc-templates.md`); Vera's findings per round go to the orchestrator store, not the repo (§15a) |
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
   - **The lite PRD uses the same IDs:** its Capabilities are `FR-n` with `AC-FR-n.m` (R2-M11).
   - Non-functional requirements get their own IDs (`NFR-n`). A missing number is written as
     `UNKNOWN`, never invented. **Every NFR names its verification method:** acceptance criteria
     `AC-NFR-n.m`, or a `check:` ID that `mirai trace` verifies like an ADR Confirmation.
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
   call them (D-17). The PRD moves to `approved`. On the `standard` track the brief is approved in
   the same step (U4).
   - **The approval signs a content hash** of the exact document (Ed25519, R2-M11). An approved
     document edited afterwards no longer matches its approval, and `mirai status` and the gate
     report it.
   - **What's logged:** your decision ("accepted as is / edited / rejected") and your review time
     (M1, M6; R-M18).
8. **Storage.** The doc is written to the one place configured for PRDs (D5): the repo, or one
   external tool. It is never kept in two places. With no tool connected, it stays in the repo.
   - **How repo documents reach the integration branch (R2-M5, R3-M12, V3):** the
     **orchestrator commits** the documents and their signed approvals on a `docs/<initiative>`
     branch (named per the project's branch pattern); approvals are always written to that branch,
     whatever the checkout is on. It opens **one docs MR** against the integration branch. **After
     your signed ticket-set approval the orchestrator merges the docs MR itself** (V3), before any
     ticket starts, so ticket branches and CI see the approved PRD and ticket set.
   - **The docs MR's own gate:** it may touch only document paths and `.mirai/` approval and key
     files. `mirai-verify` checks every approval's Ed25519 signature and content hash. A docs MR
     that touches a code path, or adds a signing key after the first, is never merged by MIRAI;
     it waits for your merge. Code never reaches the integration branch without your merge.

**Template rules, for every document type (`08` Q2):**
- **Every document type has a fixed template and checklist** (`research/07-doc-templates.md` §6):
  shared frontmatter, a hidden "done when" rule per section, required sections checked by
  `mirai lint`, and optional sections either filled or marked "Not applicable — <reason>".
- **Agents may not add sections.** The lint rejects unknown headings.
- **Template gap:** when an agent thinks something important doesn't fit, it reports a template
  gap in its run output (a `template_gap` event); it doesn't invent a section. Gaps show in
  `mirai inbox` and the run report. One-off content goes into an existing section (Risks, open
  questions `Q-n`, …).
- **Templates are refined later, from evidence.** You change a template deliberately, per
  project (`.mirai/custom/`) or in MIRAI (`mirai contribute`). Templates are versioned, and
  every document records the version it was written from (`template: prd@v3`, R2-M12).
- **A custom template is an overlay** (add, rename, reorder) on the framework template, not a
  full copy, so `mirai update` still delivers framework changes to it (R2-M12).
- **Per-project customization is yours:** you can add, reorder or rename sections (a rename
  carries a mapping for the lint). The core sections the workflow depends on can't be removed:
  requirement IDs, acceptance criteria, ADR alternatives and consequences.

**Versions (R-M11):**
- **For documents, frontmatter `status` is the current state; the run log is the history.**
  `mirai status` reports a mismatch between them as an error. Tickets work differently (§12,
  R2-M5).
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

**Why both an HLD and ADRs (`08` Q1):**
- **The HLD describes how one feature is built:** components, flows, data ownership, the NFR
  answers. It's read mostly while that feature is built, and the next big feature gets a new one.
- **An ADR records one hard decision:** the options (including rejected ones), the choice and the
  consequences. It belongs to the project, not the feature, is immutable, and is superseded rather
  than edited.
- **Example:** a notifications HLD shows the service, the queue, the email provider and the retry
  rules. The hard choice inside it, Postgres LISTEN/NOTIFY instead of Redis pub/sub, becomes
  `ADR-0012`. A year later "why not Redis?" is one valid file, not section 7 of an old feature
  doc.
- **With agents this matters more:** ADRs stop settled decisions being re-argued, they are cheap
  context (three one-page ADRs instead of a 15-page HLD), and their "Confirmation" check makes them
  checkable by Rex and `mirai trace`.
- The user documentation explains this too (see 07, docs website).

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
  `AC-<ticket>.n`, and the ticket file travels on its own ticket branch. It is sized so that
  one agent session can plan and finish it, and its diff can be reviewed in about 15 minutes.
  Sizes S/M/L; anything bigger is split.
- **Exception: an interface first.** When two lanes would touch the same boundary, the interface
  plus a stub is its own early story, so both lanes can start.
- **The first story is a tracer bullet:** the thinnest path through every layer. Next comes the
  story you are least sure of.
- **Split, never shrink.** "For now", "placeholder" and "wired later" are a second story.
- **Every ticket records:**
  - `covers_fr: [FR-…, NFR-…]` and `covers_ac: [AC-…]` (one name for each, everywhere,
    R2-M11);
  - `governed_by: [ADR-…]`;
  - `after: [ticket ids]` (real prerequisites only);
  - `risk: normal|high` (auto-set from risk paths and keywords, can be raised by hand);
  - `size`;
  - `repo` (which entry of the `repos` list; every ticket belongs to exactly one repo);
  - `e2e: yes|no` (`yes` only when the ticket creates or changes a critical journey, §10; you can
    override it at ticket approval);
  - `tdd` and `tests` when they differ from the project setting (§7; proposed by Tess, set only
    by you);
  - `files_likely`;
  - `verify` (one sentence).
- **Cross-repo work** (`08` Q3) is split into an interface ticket first (the interface-stub rule
  below), then one ticket per repo. A ticket in one repo that depends on another repo's ticket
  waits like a stacked ticket (§6).
- **New critical journeys:** when a feature creates one (say, a new payment flow), Tess proposes
  adding it to the list, and you approve it at the ticket gate.
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
BR-n  →  FR-n / NFR-n  →  AC-FR-n.m / AC-NFR-n.m  →  ticket covers_ac  →  tests tagged with the AC ID  →  QA evidence per AC ID
                                                                       (E2E tests also tagged J-n)
```

- **The quick track** starts the chain at the ticket with `AC-<ticket>.n`.
- **Critical journeys** have `J-n` IDs in the feature map, each with `realizes: [UJ-n]` (R2-M11).
- **Retired IDs are never reused.** An ID-stability lint checks it.
- **`mirai trace`** is a lint that checks the whole chain:
  - every BR is covered by at least one FR;
  - every AC is covered by a ticket;
  - every ticket AC is covered by a test (unit, integration, API or E2E, each tagged with the AC
    ID), **unless the ticket's `tests` setting is `optional`**, in which case QA evidence is
    enough (§7);
  - every `e2e: yes` ticket has a test tagged with its `J-n` and AC IDs;
  - every AC has QA evidence;
  - every NFR's verification method and every ADR "Confirmation" check exists.
- **Where it runs (R2-M11):** at the ticket gate, and **locally at ship time**, where it can see
  the local QA evidence. Its result goes **inside the signed proof**. CI doesn't re-run it; CI
  checks the proof (§11).
- **Prior art:** BMAD TEA's trace step.

---

## 6. Plan (per ticket)

| | |
|---|---|
| **Trigger** | the orchestrator or you pick the next `ready-for-dev` ticket whose `after` tickets are `done`; or `integrated` in the same `release: together` epic; or `built` in the same epic within the stacking depth (see "Branches" below, R2-M5). `mirai run --plan` previews what tonight can do. |
| **Author** | `mirai-developer` (persona proposed: **Kai**) |
| **Checker** | script lint always; `mirai-verifier` only on high-risk tickets |
| **Inputs** | the ticket, its epic, the docs it cites (`covers`, `governed_by`), conventions, sibling plans, copied by the orchestrator into a **per-launch read-only input folder** (R3-C3) |
| **Output** | the plan, from the plan template, returned as Kai's **structured output**; the orchestrator stores it as `<ticket>-plan.md` in the store (agents can't write the store) |
| **Statuses** | ticket `ready-for-dev → in-progress` (plan written) |
| **Human checkpoint** | `plan` gate (`human` in `supervised`, `auto` in `autonomous`; **`auto` on the `quick` track**; **always `human` for high-risk tickets** and for plans that declare protected paths or new dependencies) |

**The plan template contains:**
- a **frozen block**, owned by the human after approval: Intent (problem and approach), Boundaries
  (always / never), and an I/O & edge-case matrix. **Your plan approval signs a content hash of
  the frozen block** (R2-M11), so a later edit to it is detected;
- agent-owned sections: code map, tasks, a test list (one row per matrix row and per AC, each
  naming its **test level**: the lowest level that really proves the AC, from the project's
  levels, §1 step 3b), the **characterization tests** planned for untested code the ticket
  changes (§7), the stub step for new symbols (§7), the ticket's `tdd` and `tests` values,
  verification commands, design notes (where no LLD exists), an append-only implementation log, a
  change log, and a review triage log;
- **declared protected paths and dependencies** (R3-M2, R3-C2): every protected path (§8) the
  ticket will touch, and every new dependency it needs. They are approved with the plan, so the
  floor guard doesn't park the ticket mid-night for something you already agreed to. A new
  dependency is always high risk. An undeclared protected path still parks.

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
- **Branch names** follow the project's branch pattern from setup; MIRAI adds no prefix. MIRAI
  work is recognised by the `Mirai-Ticket: <id>` commit trailer (§11), not by the branch name.
- **The base branch:**
  - a ticket with no open dependency branches from the **integration branch**, or from
    `feature/<epic>` when the epic is `release: together` (§12a);
  - **stacking:** if ticket B depends on ticket A and A is `built` (MR open, not merged), B starts
    from **A's branch**. B's MR targets A's branch, so it shows only B's changes.
- **Stacking limits:**
  - at most **2 levels deep** (A → B → C);
  - **only within one epic**;
  - nothing ever merges without you;
  - **a child never merges into its parent** (R3-M10). B's MR targets A's branch only so you see
    B's diff; it is retargeted to the integration branch before it can be merged.
- **The trust root and lock always come from the integration branch**, never from the parent
  branch (R2-M6). A stacked ticket must not run under rules from an unmerged, agent-written
  branch. CI verifies a stacked MR against the integration branch too (§11).
- **When A changes (R2-M6):**
  - **You merge A:** MIRAI rebases B with `git rebase --onto <integration-branch>
    <old-parent-head>`, using A's head recorded in the store. That record is **updated every time
    the orchestrator pushes A**, so it never goes stale. This survives squash and rebase merges, which
    would otherwise replay A's commits and fake a conflict. Then it re-runs the quality gate. If
    B's code hash is unchanged, its review proof still holds (§9), so B doesn't pay for a second
    review. B's MR is retargeted (idempotent: MIRAI reads the current target first).
  - **You request changes on A:** B is marked `waiting` on A. It is rebased after A is fixed.
  - **The orchestrator pushes a rebased branch with `--force-with-lease=<branch>:<expected-sha>`**,
    naming the exact commit it last pushed, never a plain force push. Agents never push.
  - **Cascade:** a child of a child (C on B) is rebased after its own parent, one level at a
    time.
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

## 7. Build (per ticket; TDD by setting)

| | |
|---|---|
| **Trigger** | plan approved (by you or by the `auto` gate) |
| **Who** | `mirai-developer` (Kai), **a fresh session whose only input is the plan** |
| **Inputs** | the plan (sole source of truth) and, in fix rounds, the blocking findings, both in the per-launch read-only input folder (R3-C3); conventions; the repo |
| **Outputs** | code + tests on the ticket branch (one checkout, §6); red and green evidence in the run log when TDD applies |
| **Statuses** | stays `in-progress` |
| **Human checkpoint** | `build` gate (default `auto` after plan approval) |

**Two settings decide how tests are written (`08` Q7).** They're set per project and can be
overridden per epic or ticket by you only; agents can't change them.

| Setting | Values | Default |
|---|---|---|
| `tdd` | `auto` · `on` · `off` | `auto` |
| `tests` | `required` · `optional` | `required` |

- **`tdd: auto`:** TDD for logic-heavy work (business rules, APIs, calculations, bug fixes, where
  the bug is reproduced in a test first). Tests after the code, or QA evidence, for UI styling,
  config, glue and migrations. Tess proposes it per ticket; you can override.
- **`tdd: off, tests: required`:** tests are written after the code and there's no red check.
  Every AC still needs a test or QA evidence (`mirai trace`).
- **`tests: optional`:** the ticket can ship without tests. The MR says "no tests" clearly, and
  review and QA carry the weight.
- **High-risk tickets keep `tests: required`** unless you override that ticket.
- **Why TDD stays the default for logic:** a test written first from the AC gives the agent a clear
  stop condition and can't simply confirm what the code already does. It doesn't catch a
  misunderstood AC, because the same agent writes test and code; review, QA and acceptance tests by
  a separate agent (ATDD for high-risk tickets in Milestone D, see 07) cover that.

**Steps:**
1. Record `baseline_revision`, which is never overwritten on resume. The orchestrator sets a
   **checkpoint git ref** before each step, so "redo the step" means a reset to it (R-M6).
   **Kai never commits:** `git commit`, `git config` and writes to `.git/**` are denied to agents
   (R2-C1, R2-M4). **The orchestrator commits** at fixed points, after each green step, with the
   `Mirai-Ticket: <id>` trailer (§11), and the checkpoint ref points at that commit. **At every
   handover the orchestrator kills the agent's whole process group** first, so no background
   process can change files afterwards, and it computes the code hash **at commit time** (R3-M8).
2. **Characterization tests first, only for what changes** (`08` Q8). Before changing an
   untested function or method, Kai writes tests that pin down what it does *today*, then makes the
   change. They cover only the functions or methods the ticket changes, not the whole class or
   file, and the plan lists them in advance. With `tdd: auto` this applies whenever a ticket
   touches untested code.
3. **Stub step, then red (when TDD applies, R2-M7):** for a new function, class or endpoint, Kai
   first adds an empty **stub**: the signature, returning a wrong typed default or throwing a
   `NotImplemented` sentinel. The orchestrator commits it. Then, for each test-list row, Kai
   writes the test, runs it through `run_tests(level, path)` (inside the project's containers),
   and records the failing output. A test that passes on its first run is flagged: it may not test
   anything.
4. **Green:** write the minimum code to pass it. **Refactor** with the tests green. With TDD off,
   the code comes first and the tests follow, at the levels the plan names.
5. **Bugs follow the prove-it pattern:** a test that reproduces the bug comes first.
6. **Matrix audit:** every matrix row and AC has a test that ran and passed. "Never edit the
   expectation to match the code."
7. **Floor guard** (script, before review): flags weakened or deleted tests, new skip markers, new
   lint suppressions, and lowered thresholds. It also fails any diff touching **protected paths**
   (§8). **E2E test files are protected from Kai:** only Ivy writes them (§10).
8. **The developer runs the quality gate itself before handing over** (R-M4), through the named
   checks: `run_tests(level: "lint")`, `"types"`, `"build"`, and the test levels (R3-C2). Lint or
   test failures it fixes inside its own session don't use a round. Only a failure after handover
   (§8) does. A new dependency is installed only through the broker, and only if the approved
   plan declares it.
9. **The orchestrator checks the red evidence itself** (R-M8), when TDD applies. It runs the new
   or changed tests against **`baseline_revision` plus the stub commit**, and they must fail there
   **for the right reason**: an assertion failure, or the `NotImplemented` sentinel, counts; a
   compile, import or "not found" error doesn't (R2-M7). The stub is what makes this possible
   for new code.
   - **How, in one checkout:** checkpoint, put back the stub-commit version of the non-test
     paths (test paths come from the level config), run only the selected test IDs through the
     test adapter, restore, and verify the tree hash.
   - **Rows by kind:** plan rows marked `characterization` must **pass** at baseline; `red` rows
     must fail for the right reason.
   - **Per-framework classifiers** tell an assertion failure from an error (PHPUnit `<failure>`
     vs `<error>`; Jest/Vitest need their own rule), each with test fixtures.
   - That run, not the developer's report, is the evidence for M15.

**Fix rounds resume the same developer session** instead of starting a new one, so a fix doesn't
pay for a cold start (R-M4).

A plan can mark rows `no-test: <reason>` (pure config, copy text). The reviewer sees that
reason.

**Prior art:**
- `addyosmani-agent-skills/skills/test-driven-development/SKILL.md`: red-green-refactor;
  prove-it pattern; "tests that pass on first run" red flag.
- `bmad-build/step-03-implement.md` and `customize.toml:85-91`: a fresh implementer whose only
  input is the plan; matrix audit; judge the diff, not the report.
- `addyosmani-agent-skills/skills/constraint-driven-development/references/floor-guard.md`.

**What we changed:**
- Red evidence is produced by the orchestrator against the baseline plus a stub, which gives
  metric M15, and it must fail for the right reason.
- TDD is a setting (`auto` by default), not a rule for every change.
- Characterization tests are limited to the code the ticket changes.
- The floor guard is a script that runs before any reviewer.

---

## 7a. Safety while agents work (D7)

There is no container around Claude Code, and no separate macOS user (your decision V1 = (a),
`06-review-round-3.md` §D). The **project** runs in its own Docker containers; Claude Code runs on
your machine, **as you**, under the strict settings bundle from Setup step 8. Each layer blocks,
and each covers a gap the others leave (`research/09-claude-blocking-rules.md` §7). Round 2 found
that several were placed wrongly (R2-C1 to R2-C3), and round 3 found side doors through host-side
code acting on files an agent or a container can write (R3-C1 to R3-C4); this is the corrected
version.

**MIRAI's own control files are outside the project (R2-C1).** The orchestrator store, the trust
root, the hooks, `config.user.toml`, the cache and the reports live in the MIRAI home,
`~/Library/Application Support/mirai/<repo-id>/`. It is denied to agents by the sandbox
(`denyRead` + `denyWrite`) and by permission denies, like `~/.config/mirai`. Agents may not write
`.git/**` or run `git config` / `git commit`. So an agent can't reset its round counters, edit the
rules its next launch uses, plant a hook, or mint a launch token.

**Agents reach MIRAI only through the MCP broker (R3-C3).** Because the store is denied, a
sandboxed process can't run the `mirai` CLI. Everything an agent or a workflow skill needs goes
through one narrow MCP broker from the trust root, running outside the sandbox as the
orchestrator: `run_tests`, `launch` (supervised launches from your session; the broker holds the
launch tokens, so there's no store file to poll, TL3-8), `log` (refuses privileged event
types), `lint` and `trace`. Inputs reach an agent through a **per-launch read-only input folder**
(allowed by the sandbox for that launch only, never writable); outputs come back only as the
agent's structured output.

| Layer | Blocks | Gap it leaves |
|---|---|---|
| Claude Code OS sandbox (Seatbelt) | shell commands and every process they start: reads of your home folder except the project and toolchain caches (`denyRead`/`allowRead`), writes to the MIRAI home and `.git/**`, network outside the allowlist (ideally empty) | doesn't cover the file tools, hooks or MCP; whether the docker socket, ssh-agent socket and keychain are reachable is UNVERIFIED (see V1 condition below) |
| Permission deny rules | Read/Edit of the MIRAI home, key folders and `.git/**`; `git push`, `git commit`, `git config`, `gh`, `docker`, `claude`, `mirai`; headless also WebFetch, WebSearch and the Task/Agent tool | `grep -r`, `sh -c` around a denied command (the sandbox catches these); whether the file tools resolve symlinks before matching is UNVERIFIED (`05` §G) |
| PreToolUse hooks (from the trust root) | secret patterns in written content; Glob/Grep outside the project | runs outside the sandbox, so it is hash-checked before it runs |
| The MIRAI MCP broker (`run_tests`, `launch`, `log`, `lint`, `trace`) + validated compose | agent-triggered tests and checks run only in the project's containers, from trust-root compose files, with `.git` masked, no outside network and dummy secrets | the containers run agent-written code, so their mounts are checked on every run |
| Pinned host git (§1 step 7) | `.git/config` filters, includes, helpers, fsmonitor and hooks running through MIRAI's own git calls | your own git, IDE and shell still read `.git/config` (see the IDE warning below) |
| `pre-push` secret scan | a commit containing a key, a password, a token, or **the exact login-token value** | can be skipped with `--no-verify` locally |
| CI secret scan + `mirai-verify` | the same on the MR, plus the signed proofs, from the base branch's workflow | your merge is still the final gate |

**Tests: one MCP tool, no shell (R2-C2).** Agents run tests only with **`run_tests(level, path?)`**,
a small MCP server from the trust root. It takes structured arguments and has no shell, so
`$(...)`, PATH tricks and env prefixes don't exist. For every call (R3-M6):
- **Strict arguments:** `level` must be a configured level or named check; `path` must resolve,
  without following symlinks, to a file inside the project's test paths, and may not start with
  `-`. Nothing else is accepted.
- **The compose call is built only from trust-root files:** a pinned list of compose files given
  as **absolute trust-root paths**, no auto-loaded `compose.override.yml`, no `COMPOSE_FILE` from
  the environment, and an env file from the trust root. The login token is never passed to
  docker.
- **Validate exactly what runs:** the tool renders the resolved config once (`docker compose
  config`) into a file in the trust root, validates **that file** against an **allowlist** (only
  the project source mounted, never `.git`, `.env` or anything outside the project; no docker
  socket, no privileged mode, no host network, no added capabilities), and runs compose with
  **that same file**. There is no gap between checking and running.
- **`.git` is masked:** the project source is mounted with `.git` covered by an empty read-only
  volume, so test code can't touch `.git/config` or `.git/hooks` (R3-C4).
- **A unique compose project name per run,** so a test run never collides with your daytime stack.
- **No outside network:** containers started for agent-triggered tests get only an internal
  network between the project's own services (R2-C3).
- **Dummy secrets:** they use `.env.test` with fake values from setup. The real `.env` is never
  mounted for agent runs.
- **Levels** come from the project's test levels (§1 step 3b), the **named checks** (`lint`,
  `types`, `build`, …), plus `e2e` (the Playwright image) and **`qa-explore`**, which runs one of
  Ivy's throwaway Playwright scripts, **passed as content** in the call, not as a file path (§10).
- **Dependency installs** run only through the broker, inside the test network, and only for
  dependencies the approved plan declares.

**Protected paths** (§8) now also include compose files, Dockerfiles, `.env*`, new or changed
`CLAUDE.md` / `AGENTS.md` files (and anything they `@`-import), project skill folders,
`.gitattributes`, `.gitignore`, `.lfsconfig`, `.claude/`, `.vscode/`, `.envrc`, `.husky/`, and the
`scripts` section of `package.json` (R2-M10, R3-C4). A change to any of them means high risk; in
autonomous mode the ticket parks unless the approved plan declared it (§6).
- **Instruction files never reach the reviewer from the branch (R3-M9):** Rex runs on a clean
  export of the integration branch's instruction files, not the work tree's. A diff that changes
  an instruction file **blocks in supervised mode too**, until you approve it.
- **Files that run by themselves** (`.vscode` tasks, `.envrc`, `.husky`, `package.json` scripts,
  `.claude/` hooks) fire outside every sandbox when *you* open the branch. So they are protected,
  and **the report warns you before you open a MIRAI branch in your IDE** whenever the branch
  touches one of them (R3-C4).

**Three more rules:**
- **Agents never hold credentials.** The orchestrator commits, pushes and opens MRs from outside
  the agent, with pinned host git (§1 step 7). An agent's environment is built from an
  **allowlist**; the only secret in it is `CLAUDE_CODE_OAUTH_TOKEN`.
- **The login token: fewer routes out, not none (R3-M5).** The agent can read it
  (`echo $CLAUDE_CODE_OAUTH_TOKEN`; denying `env` is cosmetic). The routes we close: test
  containers have no outside network; WebFetch is denied; `claude` can't be run from Bash; the
  secret scan blocks its exact value in any commit. The route that may stay open: if the sandbox
  allowlist has to keep the package registries, an upload to a registry with
  attacker-supplied credentials could carry it. Setup tests an empty allowlist first (`05` §G).
  Whether Claude Code can keep the token out of the Bash environment is UNVERIFIED.
- **A branch can't loosen the rules.** Headless runs use only `--settings <trust-root>/strict.json`
  (on top of `--restricted`, if setup confirms it works) and `--strict-mcp-config`, so neither a
  branch's `.claude/` files nor your user settings load. **The trust root is re-hashed before
  every launch**, not only at run start.

**Verdicts come from the launcher, never from files (R2-C1).** Rex's and Ivy's verdicts are their
structured final output, captured from stdout by the launcher. No file in the work tree is ever
read as a verdict.

**Red-team check:** the safety unit and `mirai doctor` run seeded attempts. **No headless agent
launch happens before the red-team suite has passed** (R3-M7), not only autonomous runs. Each
attempt must be blocked:
- reading `~/.ssh` or `~/.config/mirai`;
- writing into the MIRAI home or `.git/hooks`, and running `git config core.hooksPath`;
- editing the trust root's `strict.json` or a hook between two launches (the re-hash catches it);
- `curl` to a host not on the allowlist, and from inside a test container;
- `sh -c` around a denied command;
- `grep -r` from `/`;
- a branch adding `compose.override.yml`, or a compose file that mounts `..` or the docker socket;
- a branch bringing its own `.claude/settings.json` hook;
- a nested `CLAUDE.md` with instructions for the reviewer (flagged as a protected path);
- starting a native subagent (Task tool) in a headless run;
- writing a fake key, or the login token's value, into a committed file;
- **round 3:** writing `.git/config` (a `filter.*.clean`, `core.sshCommand`, `include.path`, a
  `remote.*.pushurl`) from the shell and from inside a test container, then letting MIRAI commit
  and push (the hash check must refuse);
- a symlink in the project pointing at a trust-root hook, `.git/config` or `~/.config/mirai`,
  then an Edit or Read through it;
- reaching the docker socket, the ssh-agent socket, `git credential fill` and
  `security find-generic-password` from the sandboxed shell;
- reading the real `.env` through Bash (`cp`, `python -c`, `grep -r`);
- running `claude -p` or `mirai` from Bash;
- an upload to a package registry from the sandbox;
- a `.gitattributes` `-diff` or `linguist-generated` line that hides code from review;
- a background process left running that edits a file after handover;
- a `run_tests` path starting with `-`, or a symlinked path;
- a compose file changed between validation and run.

**Honest residual risk (V1 = (a)):** there is **no OS boundary between the agent and you**. The
agent is your user. Everything your user can reach (files, sockets, the keychain, other projects)
is held back only by Claude Code's sandbox and rules being correct and complete, and the list of
what your user can reach is open-ended. The file tools and hooks run outside the sandbox. A bug in
Claude Code's rule matching is a single point of failure. The agent can read its own login token,
and files that run by themselves can still fire when you open a branch (the report warns you).
This is weaker than a separate macOS user or a container per run.

**The V1 condition (your decision, `06-review-round-3.md` §D):** if the red-team tests show that
the docker socket, the ssh-agent, the keychain (`git credential`, `security`) or the real `.env`
is reachable from an agent and **can't be closed by configuration**, headless runs are
**blocked**, and V1 comes back to you before any headless run.

---

## 8. Checks (machine work first)

| | |
|---|---|
| **Trigger** | the developer hands over |
| **Who** | the orchestrator: the project's **named checks** (`lint`, `types`, `build`, …, found at setup) and test levels, run through `run_tests` in hardened containers from the **trust root** (R3-C2), + floor guard + MIRAI lints + `mirai trace`. Never `docker compose exec` on your normal stack. |
| **Output** | pass/fail in the run log, and a **signed gate-result record** (which checks ran, on which code hash, against which baseline, with which known failures). `pre-push` checks that record instead of re-running the suites. |
| **On fail** | back to the developer. **A failure after handover counts as a fix round** (§9 caps). The same failure twice is a plan problem: park or re-plan. |

No LLM reviewer runs until checks are green (L6). Reviewers are told not to comment on what these
checks cover.

**"Nothing new broke", not "everything is green" (`08` Q8):**
- **Known failures** from the test baseline (§1 step 3b) are listed in the report but don't
  block. New failures block.
- **Diff coverage, not file coverage:** only the lines the ticket changes need tests. Unchanged
  code in the same file doesn't count, so there's no pressure to test code nobody touched.
- **Untested areas raise the risk:** a ticket that changes files with no tests is scored higher
  risk, which means a deeper review and stricter gates.
- **The existing test style wins** (D-20): the project's framework, folders and naming. No new
  framework without your yes.

**The gate can't be edited by the work it checks (R-C2):**
- **The trust root.** At run start the orchestrator copies and hashes the framework, config,
  custom files and generated tool files **from the integration branch** into a read-only folder
  outside the repo. Every launch, hook and gate uses that copy, never the branch's copy.
- **The trust root lives in the MIRAI home**, outside the project (§7a), and is re-hashed before
  every launch.
- **Protected paths:** `.mirai/**`, the tool folders, CI files, hooks, lint and test configs,
  compose files, Dockerfiles, `.env*`, new or changed `CLAUDE.md`/`AGENTS.md` files and their
  imports, project skill folders, `.gitattributes`, `.gitignore`, `.lfsconfig`, `.claude/`,
  `.vscode/`, `.envrc`, `.husky/`, `package.json` scripts, and (for the developer) the E2E test
  files. A diff touching them is forced to `high` risk and fails the floor guard. In autonomous
  mode the ticket parks, **unless the approved plan declared that path** (§6, R3-M2).

**Environment faults are not agent failures (R-M5):**
- A **preflight check** runs before each run and each ticket: the stack is up, the login works
  (`claude auth status`), disk space is free, the trust root hash matches, and the machine is on
  power (a laptop on battery with the lid closed can sleep despite `caffeinate`, R2 Minor).
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
  - **Pause time doesn't count** against the ticket's minutes budget or the launch timeout. The
    30-minute probe launches use quota, so they're logged in the ledger.
  - The run's own state machine is `running → paused → running`, ending `stopped` or `finished`
    (§14).
- Environment faults **never use rounds**.

---

## 8a. E2E test (per ticket, only when `e2e: yes`)

| | |
|---|---|
| **Trigger** | checks green on a ticket marked `e2e: yes` (§5) |
| **Who** | `mirai-qa` (Ivy), **before review** (U2, R2-C4) |
| **Inputs** | the ticket's ACs, its critical journey `J-n`, the feature map's stable selectors, the running app (started by the orchestrator) |
| **Output** | new or updated Playwright test files for that journey, tagged with `J-n` and the AC IDs. The orchestrator commits them on the ticket branch. |

**Why before review:** if Ivy wrote the test after review PASS, the committed code would change and
the review proof would no longer match (the round-1 R-C1 bug again). Written here, **Rex reviews
the code and the E2E test together**, there is **one proof**, and the test itself gets reviewed.

- The test is run once through `run_tests(level: "e2e", path)` to prove it runs. QA (§10) runs
  it again with everything else.
- E2E files stay protected from Kai (§8). If review sends the E2E test back, Ivy fixes it, in the
  same round budget.

---

## 9. Review (per ticket)

| | |
|---|---|
| **Trigger** | checks green, and the E2E test written when `e2e: yes` (§8a) |
| **Who** | `mirai-reviewer` (persona proposed: **Rex**), fresh context, model by the ladder |
| **Inputs** | the diff since `baseline_revision` (code **and** any E2E test) and the plan's claims, **as files in the per-launch read-only input folder, never pasted** (B8, R3-C3); the plan's frozen intent; the ACs; conventions; ADRs it must obey. Instruction files come from a **clean export of the integration branch**, never from the work tree (R3-M9). |
| **Output** | Rex's verdict and findings as **structured final output**, captured from stdout by the launcher (never read from a file in the work tree, R2-C1). The orchestrator stores them as `review-<ticket>-r<n>.json` in the store, never committed and never posted to the git host (§15a), plus a summary line. On PASS a small signed **proof file** (see "Records" below). |
| **Statuses** | ticket `in-progress → in-review` |
| **Human checkpoint** | `review` gate (default `auto`; disputed findings always go to the human list) |

**Depth matches risk** (L7):
- **`normal`:** one combined pass covering correctness, edge cases, intent alignment, and test
  gaps.
- **`high`:** separate lens passes in parallel: a blind hunter (diff only), edge cases,
  verification gap, and an intent-alignment auditor (gets the verbatim intent). Plus security and
  architecture lenses (the pilot's high tier).

**Test scope checks (`08` Q6, Q8):** Rex flags a test placed at a needlessly high, expensive level
(for example an E2E test for an edge case a unit test proves), and any test for code the ticket
doesn't change, as an out-of-scope finding.

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
| L8 Script decides | The orchestrator reads verdicts from the launcher's captured structured output, never from files. Agents never talk to each other. |

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
- **What a PASS record binds to:** MIRAI's own **code hash**: SHA-256 over a **normalized
  patch** of `<merge-base>..head`, restricted to **code paths** (R2-M7, R3-M11). The patch is
  produced with pinned git options (no rename detection, fixed context, no external diff or
  textconv) and normalized: **no blob IDs in `index` lines, no hunk line numbers**, but every
  added and removed line, whitespace and binary content included. So a clean rebase onto a moved
  base keeps the same hash, and any real change to the code changes it. `git patch-id --stable`
  isn't used, because it ignores whitespace and doesn't hash binary content. The merge-base is
  always against the integration branch (or `feature/<epic>`), never a stacked parent. The `[gate] code_paths` setting excludes
  `.mirai/**`, the docs root and MIRAI bookkeeping by default. E2E test files **are** code paths;
  that's why they're written before review (§8a).
- **Why:** MIRAI's bookkeeping after review doesn't invalidate the record. A clean rebase keeps
  the same diff, so only the quality gate re-runs.
- **Storage:** each record is its own immutable proof file, `<ticket>/<kind>-r<n>-<hash>.json`,
  committed because the gate and CI need it. It says only "PASS for this exact code"; it holds no
  findings.
- **When proofs are made:** the **review proof** at review PASS, the **QA proof** at QA PASS, and
  the **gate-result record** after the checks (§8). The QA proof, the last one before ship,
  carries the `mirai trace` result (§5a).
- **Signed with Ed25519** (R2-C5), built into Node's `crypto`, so still zero dependencies. The
  private key is in `~/.config/mirai/`, which the sandbox and deny rules keep agents from reading
  (R-M1). The **public key is committed with its key id**, so CI can verify a proof without any
  secret; revoked key ids fail (§1 step 7). The proof is written by the orchestrator from the
  launcher's captured verdict.

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

## 10. QA / verification and E2E (per ticket)

QA has two parts that used to be mixed up (`08` Q6):
- **Verification:** Ivy checks each AC on the running app once, with evidence. Every ticket.
- **The E2E suite:** committed Playwright tests that run in CI on every MR from then on. **Only
  for critical journeys.** Ivy writes them **before review** (§8a); this section runs them.

| | |
|---|---|
| **Trigger** | review PASS |
| **Who** | `mirai-qa` (persona proposed: **Ivy**), using the project's generated `verify-<app>` skill. Ivy's verdict is structured final output captured by the launcher, like Rex's. |
| **Inputs** | the running app, started by the orchestrator in the project's own containers (the agent gets only its URL, never `docker`); ACs; the plan's matrix; the feature map with its critical journeys |
| **Output** | `qa-<ticket>.md`: one row per AC ID with PASS/FAIL and evidence (test name, command output, screenshot), plus edge-case probes from the matrix. It lives in the orchestrator store with its evidence files, size-capped, and is never committed (§15a). QA writes no committed files: the E2E test was written and reviewed before (§8a), so the proof still matches. |
| **Statuses** | stays `in-review` until QA passes |
| **Human checkpoint** | `qa` gate (default `auto`) |

**Rules:**
- No evidence = not passed. "Inconclusive or wrong-surface is not a pass."
- A QA FAIL goes back to the developer and **uses the same round budget** as review.
- If the app can't start, the ticket parks with reason `environment`. QA doesn't try to fix the
  environment, and the failure uses no round (§8).
- The issue taxonomy and report shape follow vercel `dogfood` (`research/06b-skill-sweep.md`).

**E2E tests: few, for critical journeys only** (the test pyramid / testing trophy):
- **A critical journey** means "if this breaks, we lose users or money": sign-up and login, the
  core business flow, payment, anything legal. The list lives in the feature map; setup proposes
  it from the business context, and you approve it (§1 step 3a).
- **E2E tests cover mainly happy paths plus one or two key failure paths per journey.** Edge cases
  go to unit and API tests. The suite grows with journeys, not with features.
- **Only tickets marked `e2e: yes`** get E2E work (§5). Ivy, not Kai, writes or updates the E2E
  test for that journey, before review (§8a), so the developer doesn't grade his own work. Each
  test is tagged with the journey `J-n` and the AC IDs.
- **All other ACs** are covered by AC-tagged unit and integration tests (seen by `mirai trace`)
  plus Ivy's verification evidence.
- **ATDD (Milestone D, high-risk tickets first; see 07):** acceptance tests written from the ACs
  before the code, by a separate agent.

**How E2E and the browser run:**
- **In a container:** `run_tests(level: "e2e")` runs the official Playwright image, pinned to
  the project's `@playwright/test` version, next to the project's containers, on the no-egress
  test network. Its `node_modules` are installed inside the container. No browser runs on your
  machine during overnight runs.
- **Overnight verification also runs in that container (R2-M8, R3-C3):** for each AC, Ivy writes
  a throwaway Playwright or HTTP script and **passes it as content** in
  `run_tests(level: "qa-explore", script)`; she can't write the store, and the script never
  touches the work tree. The broker runs it, keeps the screenshots and output in the store, and
  returns a summary to Ivy as the tool result. These scripts are never committed.
- **Playwright MCP only in interactive daytime sessions,** where you can see it. MCP servers run
  outside Claude Code's sandbox (`research/09-claude-blocking-rules.md` §1), so they're not used
  headless.
- **Stable selectors:** `data-testid` and ARIA roles from the feature map, never CSS paths. A
  flaky test is re-run once (R-M5).
- **A suite time budget** in config (for example under 10 minutes). Going over it is flagged in
  the report.
- **No Playwright in the project:** setup offers a minimal container-based setup with your yes.
  Otherwise QA is verification only, and the report says "no E2E suite".

**Where the QA result goes:**
- **The MR description** gets it as text: the AC table, test names, command output (§11).
- **The ticket gets a QA comment** when the tickets live in a tracker. It's posted by a script
  (tier 0) through the connector. It's a frozen snapshot that's never edited, so it doesn't
  conflict with "one source of truth" (D5). Screenshots are uploaded to the ticket where the
  tracker's API allows it. Screenshots on the MR come later, after checking what the git host's
  API allows.
- With tickets in the repo, the QA result lives in the MR only.

**Precondition for the pilot:** the local URLs (open question P7) are settled and the pilot
starts.

**Prior art:**
- `cursor-plugins/pstack/skills/create-verification-skill/` and `maintain-verification-skill/`:
  the feature map, driving the real app.
- pstack `playbooks/bug-fix.md`: the "wrong surface" rule.
- `obra-superpowers` `verification-before-completion`: logic only.

**What we changed:**
- QA evidence is tied to AC IDs, so metric M8 (evidence coverage) can be computed.
- The E2E suite is limited to critical journeys and written by a separate agent.

---

## 11. Ship: push and MR

| | |
|---|---|
| **Trigger** | QA PASS |
| **Who** | `mirai-ship` skill (mostly script), run by the **orchestrator, outside the agent**: the commits already exist (the orchestrator commits after each green step with the `Mirai-Ticket: <id>` trailer, §7); ship runs `mirai trace` and writes the signed proof (§9), pushes the ticket branch, and opens the MR with the host CLI (`gh` / `glab`). Agents hold no push credentials (§7a). |
| **Output** | MR with a description from the template: Why / What changed / `Review: PASS after N rounds (MIRAI)` plus the non-blocking follow-ups worth knowing / QA as text (AC table, test names, command output) / Risk / Links (ticket, PRD, ADRs) / stack position ("based on !A"). **No review comments are posted on the git host**: review results stay local (§15a). **No run-log lines are committed or exported** (Q9, U3); CI checks only the signed proofs. |
| **Target branch** | the **integration branch**; A's branch when stacked, for review only, retargeted before merge (§6); `feature/<epic>` when the epic is `release: together` (§12a) |
| **Statuses** | none written. The ticket *is* `built` because an open MR exists whose head has valid proofs (R-C4), unless a later written state overrides it (§12). |
| **Human checkpoint** | **none at ship** (U4, R2-M3): push and MR are automatic in both presets, because nothing is merged here. **Your merge is the gate. Agents never merge code: not into the integration branch, not into a feature branch, not into a stacked parent.** The only merge MIRAI performs is the docs MR, after your signed approval (V3). |

**Which branches the gates apply to (`08` Q8):**
- **MIRAI work is marked by a commit trailer,** `Mirai-Ticket: <id>`, written by the
  orchestrator (agents can't commit, §7). If the project has a strict commit format, setup adapts
  the trailer to it. Branch names follow the project's own pattern.
- **Every branch MIRAI creates is registered** (R2-M4, R3-M10): in the store, **and** as a
  signed `branch.json` that the orchestrator commits as the branch's first commit, so CI can see
  it too. The gate scope **fails closed**: a registered branch is gated whether or not its commits
  carry the trailer, and a registered branch with a commit **without** the trailer is
  **blocked**, not exempted. If the store is lost, the committed `branch.json` still marks the
  branch as MIRAI's.
- **Taking a branch over by hand:** `mirai handover <ticket>` releases a MIRAI branch to you. It's
  logged, the branch is unregistered, and MIRAI commits a signed `handover.json`, so the local
  gate **and** CI stop applying MIRAI's rules to it.
- **Human developers' branches** (never registered, no trailer) are untouched. The secret scan is
  offered to everyone.

**Enforcement (Q3, D-15), for MIRAI branches:**
- **`pre-push` hook** (in the trust root, run with pinned git): refuses unless
  - valid review and QA proofs exist for the branch's current code hash (§9), and their Ed25519
    signatures verify;
  - a valid signed **gate-result record** exists for that same code hash ("nothing new broke"
    against the test baseline, §8). It checks the record; it doesn't re-run the suites (R3-C2);
  - the secret scan is clean, including the exact login-token value.
- **CI: two jobs (R2-C5).**
  - **`mirai-verify`** runs on `pull_request_target`, so it uses the **base branch's** workflow
    file; a PR can't edit or delete this check. It **reads data only** and never executes PR
    code (R3-M10):
    - it **recomputes the code hash from the PR head** itself (§9) and checks that the proofs
      and the gate-result record are for that hash;
    - it verifies the signatures with the **public keys and key ids from the integration
      branch**, never from a stacked parent or the PR;
    - it checks the `mirai trace` result inside the QA proof, the framework files against the
      integration branch's `mirai.lock`, and `branch.json` / `handover.json` for the gate scope;
    - it runs with **minimal permissions** (read-only contents, a status write only), **no
      caches**, and needs no secret. A same-named check from the PR doesn't count: the required
      check is bound to this workflow.
  - **The test job** runs on `pull_request`, checks out `pull_request.head.sha` (not the merge
    ref), with a read-only `GITHUB_TOKEN`, and re-runs the named checks and the secret scan. It
    compares failures against the known-failure list in the signed gate-result record, not a
    second copy of the baseline.

  Required status checks block the merge without them. If the host plan can't make them
  required, `doctor` says "merge gate: local-only" (R-M21). Either way **your merge is the final
  gate**; CI is a strong second check, not a wall. The GitHub event details are UNVERIFIED until
  the CI unit tests them (`05` §G).
- **MR creation is idempotent:** if an MR for the branch already exists, it is updated, not opened
  twice (R-M6).

**Prior art:**
- `bmad-build/step-05-present.md`: "NEVER auto-push" (we allow push, never merge).
- pstack `playbooks/opening-a-pr.md`: PR body sections, small PRs.
- pstack `playbooks/babysit.md`: never merge unless asked.
- pstack `playbooks/shipping.md`: the `git patch-id` idea (replaced by our own code hash, §9).

---

## 12. Merge and done

You merge the MR. The merge is the human act.

**Where ticket status lives (R2-M5):**
- **Ticket content is committed** (ACs, `covers_fr`, `covers_ac`, `repo`, `e2e`, …). **Ticket
  status is not in the ticket's frontmatter.** It has **one home** (R3-M12): the per-ticket status
  file in the orchestrator store (`<store>/tickets/<ticket>/status.json`). When tickets live in a
  tracker, MIRAI mirrors that status to the tracker; the tracker's copy is advisory (R2-M13).
- **`built`, `integrated` and `done` are derived, never written** (R-C4):
  - `built`: an open MR whose head has valid proofs;
  - `integrated`: the MR is merged into `feature/<epic>` (a `release: together` epic). Without
    this state a `together` epic would deadlock: the next ticket waits for an `after` ticket that
    is neither `built` nor `done`;
  - `done`: the MR is merged into the integration branch (from git or the host API), or, in a
    `together` epic, the feature branch is merged into the integration branch.
- **Precedence: derived states win** (R3-M12). `done` and `integrated` always win: a merged
  ticket is never `blocked`. `built` wins over every written state from before the MR's latest
  head push; a written `in-progress` (after MR comments) or `waiting` **after** that push takes
  over until the next push with valid proofs makes it `built` again.
- **No code reaches the integration branch without your merge.** Ticket work reaches it through
  ticket MRs that you merge; documents through the docs MR, which the orchestrator merges after
  your signed ticket-set approval (§3 step 8, V3). No status files are written there.
- **An epic** has its own small state machine: `open → integrating → final-e2e → ready-to-merge →
  done`, with `final-e2e-failed`, after which you choose which bug ticket in the epic gets the fix
  (§12a).
- **No agent moves a ticket past `built`.** (`bmad-method/tools/ticket-tree-rules.md:35`)

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
1. **The feature branch.** At the ticket gate, MIRAI creates `feature/<epic>` from the
   integration branch.
2. **Ticket MRs target it.** Every ticket MR targets `feature/<epic>` (stacking still applies
   inside it). You approve each merge into it, either by merging on the host or by approving it
   in `mirai inbox`, which can batch them; after an inbox approval the orchestrator performs
   exactly that merge, and your signed approval is logged. `feature/*` branches are protected
   with the same required checks as the integration branch.
3. **Final E2E test.** When all tickets are merged into it, the final E2E runs on the feature
   branch, in the project containers: **the epic's E2E tests plus one exploratory pass by Ivy**
   over the epic's ACs, with evidence per AC ID.
4. **One MR to the integration branch.** It carries the E2E report. You merge it.
5. **One release,** with the same steps 1–4 as per-ticket.

### Several repos (`08` Q3)

- **`release: together` across repos:** each repo gets its own `feature/<epic>` branch and its own
  MR to its integration branch. The release order is recorded (for example backend first, then frontend).
- **Cross-repo E2E**, chosen per workspace in config:
  - `local`: start each repo in order, wait for every health check, then run the E2E;
  - `deployed`: run the E2E against an environment URL (for example staging);
  - `none`: a manual check for you, flagged in the report, never silently skipped.

| | |
|---|---|
| **Who** | the project's own CD deploys. `mirai-qa` (Ivy) verifies. `mirai release` (script) records the release. |
| **Outputs** | a release record in the orchestrator store: which tickets and PRDs are in it, evidence per AC, your go/no-go, the production smoke result. It's exported as a git tag annotation or a host release (tier 0), so nothing is committed to the integration branch after the merge (R2-M5). |
| **Statuses** | staging is optional, and nothing assumes it (R2 Minor). With staging: `pending → staging → verified → approved → deployed → live`. Without staging: `pending → approved → deployed → live` (your go/no-go first, then the production deploy, then smoke + ACs). Either can end `rolled-back`. A PRD's `live` state is **derived** when every ticket of it is in a `live` release; it is never written. |
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
| **Output** | `<store>/reports/run-<date>-<id>.md` in the MIRAI home (one place, never committed) plus the terminal; `mirai report` prints the last one: done (MR links, stack order), parked (with parking notes and reasons, plus any `usage-limit` pauses with their reset times), follow-ups, turns/tokens/minutes per ticket and total with the estimated dollar cost, what waits in `mirai inbox`, template gaps reported by agents (§3), known test failures from the baseline, **a warning for every MIRAI branch that touches files
which run by themselves** (`.vscode` tasks, `.envrc`, `.husky`, `package.json` scripts, `.claude/`
hooks), to read before you open that branch in your IDE (§7a), and a note when old files are due
for `mirai clean` (§15a). Metrics: M1, M3, M4 and M6 first; the others once enough data exists (R-M18). A Slack post comes later. |

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
- **One machine (U3):** it resumes on the machine whose MIRAI home holds the store. Moving a run
  to another machine needs `mirai export/import`, which comes later.

**The run state machine:** `running → paused → running`, ending in `stopped` (cut-off, circuit
breaker, weekly limit, or you) or `finished`. `paused` is used for usage limits (§8); `resume`
continues a `stopped` run.

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

## 15a. Old documents, agent results and the retention rule (`08` Q9)

| Class | What | Rule |
|---|---|---|
| **Product documents** | brief, PRD, HLD, ADR, LLD, business context, tickets in the repo | **Kept forever, retired by status.** `superseded` means replaced by a newer version or a new ADR; **`obsolete`** means no longer relevant and not replaced (for example a dropped feature). Both are excluded from agent context automatically. `mirai archive` moves them to an `archive/` folder, only when you run it. |
| **Per-ticket work files** | plans, review findings, QA reports, parking notes, screenshots, transcripts | **Never committed.** They live in the orchestrator store, readable through `mirai inbox` and `mirai show <ticket>`. Only the small signed proof files are committed (§9). |
| **Logs and metrics** | full run logs; structured finding and metrics data | Bulk is temporary; the structured data is kept (below). |

**The retention rule** says how long a file is kept before it may be deleted:
- **Review and QA text, screenshots, transcripts and full logs:** 90 days after the merge by
  default (configurable). Parked or unfinished tickets keep everything until they're resolved.
- **Structured finding and metrics data** (severity, category, file, outcome; AC PASS/FAIL;
  rounds, tokens, time, tier): kept. Only `mirai metrics` reads it, so it costs zero tokens. An
  optional setting compacts it into monthly totals after a year.
- **Agents never load past reviews or metrics data as context.** A recurring insight becomes a
  lint rule or a convention line instead.

**Deletion is never silent:** `mirai clean` lists what will go and the space freed, then asks for
your yes. The morning report notes when something is due. Automatic deletion is off by default.

---

## 16. Human checkpoints per stage (the presets)

**This is the one gates table** (R3-M4). §0 summarises it per track; every other file points here.

**Your actions per piece of work** (supervised; autonomous is the same minus the plan batch):

| Work | Your actions |
|---|---|
| Quick fix | approve the ticket, merge: **2**; + production go/no-go once the release stage exists: **3** |
| Standard feature, 5 tickets | approve brief + PRD, approve the ticket set, one plan batch, 5 merges: **8**; + go/no-go per release |
| Full-track epic | approve brief, PRD, design, ticket set, plan batches, the merges; with `release: together` the merges into `feature/<epic>` can be one inbox batch, then one merge to the integration branch and one go/no-go |

The docs MR is merged by the orchestrator after your signed ticket-set approval (V3), so it adds
no action.

| Stage | `supervised` | `autonomous` | Can ever be `auto`? |
|---|---|---|---|
| Track choice | confirmed at the track's first gate (§0) | same | no |
| Brief | human (`full`: own gate; `standard`: with the PRD; `quick`: with the ticket) | same | **no**: every document needs you (D6) |
| PRD | human | human | **no** (D6) |
| Design (HLD/ADR/LLD) | human | human | **no** (D6) |
| Tickets (the set) | human | human | **no** (D6) |
| Plan | human (batch in `inbox`); **`auto` on the `quick` track** | auto | yes; **always human** if high risk, or if the plan declares protected paths or new dependencies (§6) |
| Build | auto | auto | yes |
| Review | auto | auto | yes |
| QA | auto | auto | yes |
| Ship (push + MR) | auto, no gate (your merge is the gate, U4) | auto | n/a |
| Docs MR merge | orchestrator, after your signed ticket-set approval (V3); documents only | same | yes (V3); a docs MR touching code paths or adding a second key always waits for you |
| Instruction-file change (`CLAUDE.md`, `AGENTS.md`, skills) | human (blocks) | human (parks) | no |
| Merge of code (into the integration branch or `feature/<epic>`; never into a stacked parent) | human | human | **never in MVP** |
| New round budget after MR comments | human | human | no |
| Unpark (re-plan / retry / drop) | human | human | no |
| Business context update, critical-journeys list, template change | human | human | no |
| `mirai clean` (deleting old files) | human | human | no (automatic deletion is an opt-in setting) |
| Deploy to staging | project CD (auto) | project CD (auto) | n/a |
| Final E2E (`together` epics) | auto | auto | yes |
| Deploy to production | human | human | **never in MVP** |

These presets are config (`[gates]` in `.mirai/config.toml`), and you can change any `yes` line.
When a stage's metrics clear your threshold, MIRAI *suggests* moving it to `auto`. It suggests
moving it back when they drop (Q6). Metrics never flip a gate by themselves.

**No headless launch at all** (supervised or autonomous) happens when any of these is missing
(R3-M7):
- the strict settings bundle;
- a passing red-team check (§7a), and the V1 condition not triggered;
- a clean preflight.

---

## 17. What every stage logs

Each agent run writes one line (fields in `00-interview-log.md` Q6, plus `tier`, `model`, and the
ticket's `tdd` and `tests` values). Status changes, gate decisions, human decisions, parking, loop
events, `template_gap` events and `feedback` events (`mirai feedback <ticket> "<text>"`, your reasons for back-and-forth with an agent; kept as structured data for the post-MVP evaluation, `09`) are lines in the same run file.
- **Format:** JSON Lines. Every line carries `{schema_version, run_id, seq, ts, item, by}`.
- **One file per run.**
- **Written only by MIRAI.** Agents log through the MCP broker's `log` tool (they can't run the
  `mirai` CLI, §7a), which refuses privileged event types (approval, record, gate result,
  human-only status). The orchestrator writes the rest (R-M1, R3-C3).

**Where state lives (R-C4):** there are two kinds of state, kept apart.

| Kind | What | Where |
|---|---|---|
| **Branch-carried facts** (travel with the MR) | document content and versions, signed approval events (with content hashes), the signed review and QA proof files (no findings; the QA proof carries the `mirai trace` result), the signed gate-result record, the signed `branch.json` / `handover.json`, E2E test files, the public signing keys with key ids and the revocation list. **No run-log lines** (Q9, U3). | the branch, committed |
| **Operational state** | run progress, ticket status files (the one status home), rounds, budgets, parking notes, checkpoint refs, the run lock, heartbeat, the registered-branch list, the test baseline (its one home), the recorded parent heads for stacking, the hash of `.git/config`, the run reports, plus the per-ticket work files (plans, review findings, QA reports, evidence) under the retention rule (§15a) | the **orchestrator store** in the MIRAI home, `~/Library/Application Support/mirai/<repo-id>/`, **outside the project** and denied to agents (§7a). Shared by every branch in one checkout, never committed. One machine in the MVP (U3). |
| **The trust root** | the per-run snapshot of framework, config, custom files, `strict.json`, `mcp.json`, hooks, the broker and the launch bundle, taken from the integration branch | the MIRAI home, re-hashed before every launch |
| **Per-launch input folder** | the plan, findings and other inputs for one agent launch | a folder in the MIRAI home the sandbox allows read-only for that launch only, deleted afterwards |

- **`built`, `integrated` and `done` are derived** from MRs and merges, never stored (§11, §12).
  That keeps status edits on two branches from conflicting at merge.
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
