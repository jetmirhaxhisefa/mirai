---
status: draft
version: 2
---

# 09 — After the MVP

What happens once the MVP (`07` Milestones A–F) is built.

- **Version 1** (2026-10-23) set the rule "use it, measure it, fix it before adding anything
  new" and a six-group backlog.
- **Version 2** (2026-11-16) is the result of an interview with you about your Phase 2 notes
  (`2_Efforts/MIRAI - How it works`, "Phase 2 followups", and the linked ticketing prompt). It
  replaces the backlog with a staged plan, records every decision, and points to one design
  addendum per feature group (`10`–`18`, and `20` added on 2026-11-18). Phase 3 of your note is not covered.

**How to read this plan (for whoever builds it):**

1. This file is the index: the stages, the decisions, the unit list and the order.
2. Each addendum (`10`–`18`) holds one feature group: the problem, the design, the rules that
   must not be broken, and a table of units with "Depends on" and "Done when".
3. A unit still gets its own spec at build time (`implementation/units/<id>-<name>/spec.md`),
   one at a time, with research first, exactly as in the MVP. The addenda fix *what* and *why*.
   The spec fixes *how*.
4. Names of commands, config keys and files in the addenda are **proposals**. The unit's spec
   settles them.
5. Where an addendum says **"check first"**, the fact was not verified when this plan was
   written. The unit's research step verifies it before anything is built on it.

---

## 1. What you want from the post-MVP phase

**Outcome.** MIRAI goes from a tool you run alone on a Mac to one your team runs daily. You can
see where a run is, read what it writes, let it work through an epic at night, use it to debug
and understand the product, and improve it from its own logs.

**Who uses it.** You first. Then each teammate on their own machine with their own MIRAI. The
instances don't know about each other. They meet through pull requests, Jira and Confluence.
Some teammates won't use MIRAI at all.

**Constraints that hold for every unit below:**

- Gates stay in a real terminal with your key. A web page, Slack or an agent never approves,
  drops, unparks or merges. **One exception, by your decision:** with epic autopilot switched
  on for an epic, the orchestrator merges proven, non-high-risk tickets into that epic's
  branch. Your merge into the integration branch stays yours (D-66, `16` §3).
- Only the orchestrator starts agents. An agent never starts another agent.
- Agents get read-only evidence tools through the broker, never credentials or a shell into
  MIRAI.
- MIRAI itself only ever runs `SELECT` against a database.
- Everything external is optional and set per project: Slack, email, Jira, Confluence, Codex.
- Nothing may assume one key, one machine or one operating system.
- Each kind of record has one home (D5). No two-way sync between two stores.

---

## 2. The stages

| Stage | When | Contents | Addendum |
|---|---|---|---|
| **MVP additions** | Inside the MVP, in units not built yet | The build runner (unit 29e, after the pilot), MIRAI's own CI on Ubuntu with the operating-system module (unit 30a), and small additions to units 31, 32, 34, 40, 42, 45, 46, 48, 54, 56 | `10`, §4 below |
| **0a · Team start** | The day the MVP is fully done (A–F) | Tag v1.0. The onboarding checklist. The team starts on Macs with tickets and documents in the repo | `12` P00 |
| **0b · Platforms and connectors** | Right after 0a. It doesn't wait for the review | Ubuntu support, Windows through WSL, the Jira and Confluence connector with team behaviour. Built in the order of who is waiting | `11`, `12` |
| **1 · The review** | After at least 20 real tickets | First the research and audit unit (P44): how MIRAI does brainstorming, research and the whole product process, and what it misses. Then read the logs with a strong model, go through the suggestions together, judge against D-38, re-order this plan with P44's gaps in it | `13`, P44 |
| **2 · Visibility** | After the review | The run state view and one renderer, the Claude Code status line, the terminal block, notifications | `14` |
| **3 · The hub** | After the review | A separate repo built by MIRAI: MIRAI's documentation, project documents, the ticket view, logs, change records | `15` |
| **4 · Throughput** | After the review | Queue across nights, epic autopilot, two tickets at once, the conflict command, verifier model setting | `16` |
| **5 · Debug and operate** | After the review | Evidence sources, debug, learn (`teach-me`), the database skill, nightly detect and diagnose, security audit | `17` |
| **6 · Extending** | After the review | Project skills, reviewing a colleague's MR, brainstorming | `18`, `20` |

**The order of stages 2–6 is provisional.** The review in stage 1 re-orders them from what the
logs show. Stage 0 is fixed, because the team needs it.

### 2.1 The measuring period

- Tag the finished MVP as **MIRAI v1.0**. Later work ships through `mirai update`.
- Run MIRAI on real work: **at least 20 tickets** of your own, supervised first, then overnight.
  The team's first use on Macs runs in the same period.
- **No new features in this period, with these exceptions:** stage 0, and the tools the review
  itself needs (P10, P12, P13), which add nothing to a ticket's flow.
- **Stage 0b does change the flow** once a project uses Jira or Confluence: the queue filter,
  claiming, the status mirror, approvals bound to a page version. So the 20 judged tickets are
  tickets that used the `repo` store. Tickets built through Jira are logged with their store
  kind and judged apart (`13` §1).
- Capture friction with `mirai feedback` from the first ticket.
- **Your time is the limit in this period.** You are doing 20 tickets, helping teammates start
  and approving stage 0's units. If something has to give, stage 0b slows down and the 20
  tickets don't.

### 2.2 Judging against the success and kill criteria (D-38)

This is the **second** judging. The first is inside the MVP, on the 15 pilot tickets after the
5 calibration tickets (`07`). Same pass marks, new tickets.

| Result | Next |
|---|---|
| Targets met | Stages 2–6, in the order the review sets |
| Close but not met | A **fix-up phase** first: the top 3 problems from the review |
| Far off | **Stop adding features** and rethink the weak part (the kill rule) |

"Close" and "far off" are defined in `13` §1.

### 2.3 What runs on your subscription besides tickets

Several things in this plan use the same weekly limit as ticket work (D-57). The pass mark is
one night at no more than 15% of the week. Each of these has a cap, counted in the same ledger,
and each is skipped when the week's reserve is low. The numbers are **defaults, and each is a
config value** you can change (D-68). Calibration on each machine may replace them, since a
teammate may be on a smaller plan than yours.

| Consumer | When | Default cap |
|---|---|---|
| Full red team while building MIRAI (`10`) | Once per night on the latest state, and before a merge | Building MIRAI only. Not on a project |
| Red team on a new Claude Code version (P13, unit 18h) | Per release, per machine | One automatic try per binary per day, as 18h already says |
| The regression set (P12) | When an agent's instructions or a model mapping change | About thirty ticket runs for a full comparison. Never during a night run |
| `mirai retro` and the second-reviewer comparison (P11) | Every 20 tickets or once a month | 5% of a week |
| Nightly diagnose (P38) | Nightly, when switched on | 3% of a week per night, and your queue wins when both want budget |
| Security audit triage (P39) | On demand | One agent pass per audit |
| `mirai debug`, `mirai learn` | On demand | A budget per run, shown before it starts |

---

## 3. Decisions from the interview (2026-11-16)

Each row is a decision you made. "Where" names the addendum that carries the design.

### Output quality

| ID | Decision | Where |
|---|---|---|
| PM-01 | The "Claude writes 1000 lines for 100" worry comes from use outside MIRAI. It is a **measurement requirement**: Rex gets a finding category `unnecessary` (code with no reason to exist, or unrelated to the ticket). It is reported to you (follow-up list, morning report) and logged. It doesn't send the ticket back to Kai for now | §4, `13` |
| PM-02 | New coding rules for Kai are added only where the review's data points to them. No generic rule list up front | `13` |
| PM-03 | **Documents have two layers in one file** (option A): a top part for you (what, why, what changes, the decisions asked of you, what is out of scope; one to two pages, plain sentences) and a detail part for agents. Vera checks that the two match, and a reader test runs on the top part. The detail loses nothing | §4 |
| PM-04 | Work that agents repeat by hand inside a step is found by an audit of the run logs and moved to scripts or broker tools. Part of the review | `13` |
| PM-05 | Ticket count and size: no change to Tess in the MVP. Judged in the review | `13` |
| PM-06 | D-13 stays (one verifier, Vera). The review counts, per document type, what Vera passed and you or the build caught later. A type with a clearly worse rate gets a specialist verifier. HLD and ADRs are the likely first | `13` |
| PM-07 | A technical ticket is a normal ticket. Its acceptance criteria describe the system and not the customer, written so the reviewer can test them ("the log structure in GCP was changed to the new format") | §4 |

### Visibility

| ID | Decision | Where |
|---|---|---|
| PM-08 | One state file per run and one renderer feed two surfaces: the Claude Code status line (first) and a terminal block (second). You watch runs in both, mostly in Claude Code | `14` |
| PM-09 | Notifications are one-way and configurable per project, and every channel is off by default. Events: waiting for your approval, ticket parked, run paused on the usage limit, morning report ready, MR merged, release went live (with what it contained) | `14` |

### Throughput

| ID | Decision | Where |
|---|---|---|
| PM-10 | A night builds more tickets from your queue. It doesn't draft documents. The queue carries over between nights until the epic is done or blocked. The default is the whole epic, and you can name a selection | `16` |
| PM-11 | **Epic autopilot:** in `release: together` mode MIRAI merges green, non-high-risk tickets into the epic branch itself. Your signed merge stays on the final epic MR. Brake 1: you read every ticket MR afterwards, and `mirai epic reject <ticket>` stops the queue and marks what was built on it as suspect. Brake 2: the queue pauses after a set number of tickets you haven't marked as read with your key (default 5) | `16`, D-66 |
| PM-12 | Two features at once on your laptop, so you are not blocked. Conflicts are normal and solved at merge time. Two tickets in two services come first, then a checkout per run in one repo (you said "something like worktrees"; a per-run clone is what fits the cage, `16` §4.1). Never more than two until your review time shows room | `16` |
| PM-13 | A conflict command asks first: resolve automatically, or resolve together. Automatic: the agent resolves and reports. Together: the agent goes through each conflict with a recommendation and you agree or change it | `16` |
| PM-14 | "Only the orchestrator starts agents" stays. Three fan-out candidates (parallel review lenses, an explorer before the plan, test-failure triage) are built only if the review shows their signal | `13`, `16` |
| PM-15 | A second model family verifies both documents and code. A config setting picks the verifier model per role. Default: a different Claude model from the writer. Codex is an option, never required | `16` |
| PM-16 | **JEV is not planned.** Parked tickets are logged with their cause and the review decides which fix to build | §6, `13` |

### Debug and operate

| ID | Decision | Where |
|---|---|---|
| PM-17 | Two functions on one base: **debug** an issue you found, and **learn** how something works. No automatic fix: a confirmed bug becomes a ticket with the evidence attached | `17` |
| PM-18 | Evidence sources are configured per project: code, database, logs (files, GCP, AWS, and later tools like Datadog), and Playwright against the interface. Environments in this order: local, staging, production. Production gets its own setup step, an allow-list of what may be read, red-team cases, and your signed confirmation that this data may go to the model provider (D-67) | `17` |
| PM-19 | A database skill writes queries for you, including data fixes. MIRAI never runs a write: it hands you the statement in a transaction, a before/after `SELECT` and the undo statement | `17` |
| PM-20 | Nightly run in two layers: scripts **detect** (tagged journeys on staging, and new or abnormal things in live logs and metrics), an agent **diagnoses** the top few within a budget and explores what yesterday's merges changed. Staging by default. Production only if configured, behind a gate, with no data created or marked test data only | `17` |
| PM-21 | Findings are drafts, not tickets. They are announced through the notification channels and shown in the hub. Their one home is your store, since they can hold production evidence | `17`, `15` |
| PM-22 | Recreating a bug's data case on staging or local comes first. A full anonymised copy of production is a separate feature, not planned | `17` |
| PM-23 | Security audit: application code and dependencies first, the interface later, cloud (GCP, AWS) later, git-host settings optional and last. Scanners first, then an agent triages | `17` |

### Knowledge hub

| ID | Decision | Where |
|---|---|---|
| PM-24 | The hub is read by you only, for now. No login, roles or database in the first scope | `15` |
| PM-25 | Priority: (1) MIRAI's own documentation, (2) project documents, (3) the ticket view, then logs and change records | `15` |
| PM-26 | Where each kind of record lives is set per project: the project repo (default), an external repo, or Confluence and Jira | `12`, `15` |
| PM-27 | Documentation opens with a summary and "how to do a task", then overnight and other situations, then the full depth: every command, the architecture, every workflow from plan to live | `15` |
| PM-28 | Documentation stays current: reference pages are generated from the installed commands, config, agents and skills (project skills included), a documentation skill runs when MIRAI's infrastructure changes, and a check fails when a new command, key, agent or skill has no page | `15` |
| PM-29 | The ticket board is a view first, with the next command beside each ticket. Edits that aren't gates come later. A login that unlocks gates is a question for the later product | `15` |
| PM-30 | Log pages: the overview across tickets, one ticket's timeline, and MIRAI's raw logs (agents, skills, feedback, evaluation) with filters | `15` |
| PM-31 | Memory is a growing record written at merge time by a script, per workspace. Documents that describe the current state are updated as part of the ticket that changes them. D-26 stays | `15` |
| PM-32 | Memory, hub and reporting are **per workspace** (D-42). Unrelated projects never share an instance | `15` |
| PM-33 | The screenshot story per feature comes first. Recorded videos come later and only for features you mark | `15` |
| PM-34 | `teach-me` teaches the project: code, interfaces, logic and business reasons, for you and for a developer joining | `17` |
| PM-35 | **The hub is a separate repo from the start**, built by MIRAI as a normal project during post-MVP. Server in Python (FastAPI), interface in React with TypeScript and shadcn. No Node on the server. MIRAI knows the repo and works with it by default when a project chooses it | `15` |

### Extending MIRAI and the team

| ID | Decision | Where |
|---|---|---|
| PM-36 | Projects get a folder MIRAI never writes to, for project skills and additions to each agent's instructions. Additions can add rules, never remove MIRAI's own | `18` |
| PM-37 | Reviewing a colleague's MR: findings are shown to you first, you choose and edit, and MIRAI posts them under your account. The basis is acceptance criteria you give it (the linked ticket, or criteria you type) | `18` |
| PM-38 | First external connector: **Jira and Confluence**. Others when needed | `12` |
| PM-39 | **The team starts when the MVP is fully done.** Each developer runs their own MIRAI with their own key, and any listed key's approval counts. Documents can live in Confluence where teammates read and comment. On a shared Jira epic MIRAI works on your tickets only | `12` |
| PM-40 | The MVP stays macOS-only. **Ubuntu support is one of the first post-MVP units**, then **Windows through WSL**. Windows users must be able to run MIRAI | `11` |

### Evaluation and upkeep

| ID | Decision | Where |
|---|---|---|
| PM-41 | The first post-MVP step after the 20 tickets is to read the logs and re-check this plan | `13` |
| PM-42 | A retro run, on a schedule and on demand, uses a strong model to investigate the logs and propose improvements. You go through them together and approve. Nothing changes by itself | `13` |
| PM-43 | An approved change to an agent's instructions is proven on a regression set before it ships | `13` |
| PM-44 | MIRAI notices a new Claude Code version, runs the red-team suite against it in the background and reports. **It moves by itself** between tickets once the red team is green (unit 18h, confirmed in D-69: "I don't want to move it manually"). The project's proven version is recorded in the repo so teammates are told to run their own red team | `13` §7 |
| PM-45 | **Building MIRAI itself gets faster:** a build runner runs red-team, probe and baseline jobs in your name from a fixed list. Partial red-team runs are feedback only. The green result always comes from a full run | `10` |

### Added after the interview

| ID | Decision | Where |
|---|---|---|
| PM-46 | A brainstorming skill before Nora's brief: you explore a problem or idea in your session, and the result is one to three candidate briefs that start the normal flow. Late in the plan (stage 6). It was on the original Later list (2026-11-18) | `20` |
| PM-47 | **Scripts and languages, strictly defined** (Jet, 2026-11-21: "I don't want MIRAI to go crazy with the script setup"). A script does any work that recurs and can be solved without a model, so no tokens are spent on it, and agents never write scripts on demand. MIRAI's scripts are JavaScript, and maybe Python; no mix of many languages, and no pile of one-off Bash scripts. The rules say which language, where scripts live, how they're structured, tested and approved, and how recurring agent work is found and turned into a script. An interview opens the unit (P43) | §5, P43 |
| PM-48 | **MIRAI as a product team: a research and audit unit, early** (Jet, 2026-11-27). Research how MIRAI handles brainstorming, research and investigations; audit every process a product owner, product manager, principal engineer, architect and team lead goes through, with two independent auditors on two models (Opus, Fable); name the processes MIRAI doesn't cover. Placed at the start of stage 1, not at the end, so its findings add units to this plan. Interview first | §5, P44 |

---

## 4. Additions to the MVP

You said to add to the MVP only what really makes sense. There are two new units and ten
additions to units that aren't built yet. `07` version 6 carries them, and `04` D-59 to D-65
record the decisions.

| # | Addition | Unit | Why it can't wait |
|---|---|---|---|
| 1 | **The build runner** | New unit **29e**, right after the pilot (unit 30) and before Milestone B | Every remaining unit waits on runs you start by hand (`10`) |
| 2 | Rex's finding category `unnecessary`, and your agree or disagree on each | 48 | The 20 tickets only produce this data if the category exists from the first judged ticket |
| 3 | Two-layer documents: the top part in each template | 31, 32 | Templates are written once. Changing them later means rewriting documents |
| 4 | `mirai-write`: a named reader and a word budget per template, three to five before/after examples, banned words in a lint script, the reader test on the top part | 34 | This is unit 34's purpose |
| 5 | Vera's checklist item: the top part and the detail part match | 40 | Your approval may rest on the top part |
| 6 | Tickets may have system-facing acceptance criteria, and each must be testable | 42 | Tess's rules are written once |
| 7 | A reason is recorded when you drop, merge, split or reject a ticket at ticket-set approval | 45 | The review needs it to judge ticket count |
| 8 | A park that involves a review dispute records its dispute cause. Other parks ask nothing extra | 46 | The review needs it to choose a dispute fix |
| 9 | Metrics log: `unnecessary` findings, dispute causes, what Vera passed that was caught later, the store kind per ticket, and each agent tool call with its sanitised target | 56 | Raw fields for the review. The tool calls aren't kept today |
| 10 | One key per developer, and any listed key's approval counts. A plain PR from a colleague passes CI, which is already the design and is now tested | 54 | A team can't start without it |
| 11 | **MIRAI's own CI on Ubuntu, and one module for everything specific to an operating system** | New unit **30a**, first in Milestone B | Makes the Ubuntu port small |

**Honest size:** rows 2 to 9 are a field, a line in a prompt or a template section each. Rows
1 and 11 are real units. Row 10 is small because the role rule was moved out of the MVP into
`12` P09.

**Unit 72 (workspace mode) is now needed, not optional.** Your team case is several services
in one workspace (D-42). It stays in Milestone D and counts as a core unit there.

---

## 5. All post-MVP units

One row per unit. The full "Done when" is in the addendum. Units inside a stage are built in
the order listed unless "Depends on" says otherwise. "Review" means the unit starts only after
the review of stage 1 confirmed it.

| ID | Unit | Stage | Depends on | Addendum |
|---|---|---|---|---|
| P00 | The v1.0 tag and Mac team onboarding | 0a | MVP | `12` |
| P01 | Operating-system module audit and Linux home paths | 0b | MVP unit 30a | `11` |
| P02 | Claude Code sandbox facts on Ubuntu | 0b | P01 | `11` |
| P03 | Docker and git facts on Ubuntu | 0b | P01 | `11` |
| P04 | The red-team suite on Ubuntu | 0b | P02, P03 | `11` |
| P05 | The kept agent binary per platform, the session server on Linux, `doctor` | 0b | P04 | `11` |
| P06 | Windows through WSL | 0b | P05 | `11` |
| P07 | Jira connector (tickets) | 0b | MVP unit 38 | `12` |
| P08 | Confluence connector (documents and comments) | 0b | MVP unit 38 | `12` |
| P08b | An external repo as a store, if unit 38 can't already | 0b | MVP unit 38 | `12` |
| P09 | Team behaviour on a shared epic, and roles | 0b | P07, MVP unit 54 | `12` |
| P44 | **MIRAI as a product team: a research and audit unit** (Jet, 2026-11-27). Early in the post-MVP plan, so what it finds becomes units and improvements before the later stages are ordered. Research and tests of the edge cases of using MIRAI for:<br>• **brainstorming;**<br>• **research and investigations;**<br>• **an audit of every process a product goes through while it is developed:** what a product owner, a product manager, a principal engineer, an architect and a team lead each do, from idea to live and after, checked against what MIRAI covers. **Two auditors, separately:** two sub-agents on different models (Opus and Fable), each with its own context and no sight of the other's work, audit the framework and research best practice; their findings are compared, and where they agree and differ is shown to you;<br>• **the processes MIRAI doesn't cover yet**, named with what each would need.<br>Output: a gap list, each gap with its evidence and a proposed unit or improvement, which you sort into this plan (`§5`). Interview first | 1 (early: before the review re-orders the stages) | MVP done (A–F) | `09` |
| P10 | Review data pack | 1 (built during the measuring period) | MVP units 45, 46, 48, 56 | `13` |
| P11 | `mirai retro` | 1 | P10, P12 | `13` |
| P12 | The regression set | 1 (built during the measuring period) | MVP units 02, 28, 29e | `13` |
| P13 | Claude Code update check | 1 (built during the measuring period) | MVP units 18g, 18h | `13` |
| P14 | Run state view and event stream | 2 | Review | `14` |
| P15 | The tracker renderer and the terminal block | 2 | P14 | `14` |
| P16 | The Claude Code status line | 2 | P15 | `14` |
| P17 | Notifications | 2 | P14 | `14` |
| P18 | File-format contract and `mirai hub` | 3 | Review | `15` |
| P19 | Change records at ship | 3 | P18 | `15` |
| P20 | Generated reference and the documentation check | 3 | P18 | `15` |
| P21 | The hub repo, set up as a MIRAI project | 3 | P18 | `15` |
| P22a | Hub epic H1, MIRAI's documentation | 3 | P20, P21 | `15` |
| P22b | Hub epic H2, project documents | 3 | P22a | `15` |
| P22c | Hub epic H3, the ticket view | 3 | P22b | `15` |
| P22d | Hub epic H4, logs | 3 | P22c, P10 | `15` |
| P22e | Hub epic H5, the history of changes | 3 | P22c, P19 | `15` |
| P22f | Hub epic H6, findings and the screenshot story | 3 | P22c, P33 | `15` |
| P23 | Record search for agents | 3 | P19 | `15` |
| P24 | Queue across nights and queue selection | 4 | Review, MVP units 55, 57 | `16` |
| P25a | Epic autopilot: the merge | 4 | P24, MVP units 53, 54, 29b | `16` |
| P25b | Epic autopilot: reject and repair | 4 | P25a | `16` |
| P25c | Epic autopilot: the unreviewed limit and the final MR | 4 | P25a | `16` |
| P26 | Two tickets at once in two services | 4 | Review, MVP unit 72 | `16` |
| P27 | A checkout per run | 4 | Review | `16` |
| P28 | Second ticket while the first waits | 4 | P26, P27 | `16` |
| P29 | `mirai resolve` (conflicts) | 4 | P27 | `16` |
| P30 | Verifier model per role, Codex as a review lens | 4 | MVP unit 71 | `16` |
| P31 | Evidence source contract, logs | 5 | Review | `17` |
| P31b | Evidence: databases | 5 | P31 | `17` |
| P32 | Staging and production adapters (GCP, AWS) | 5 | P31, P31b | `17` |
| P33 | Findings record and drafts | 5 | P31 | `17` |
| P34 | `mirai debug` | 5 | P31, P31b, P33 | `17` |
| P35 | `mirai learn` (`teach-me`) | 5 | P31, P31b | `17` |
| P36 | The database skill | 5 | P31b | `17` |
| P37 | Nightly detect | 5 | P32, P33, MVP units 39, 51 | `17` |
| P38 | Nightly diagnose and exploratory testing | 5 | P34, P35, P37 | `17` |
| P39 | Security audit: code and dependencies | 5 | P33 | `17` |
| P40 | Project skills and agent additions | 6 | MVP units 37, 74, P20 | `18` |
| P41 | `mirai review-external` | 6 | MVP units 24, 24b, 27a, 27b | `18` |
| P42 | `mirai-brainstorm` | 6 | Review, MVP units 31, 34, 35, 41, 44 | `20` |
| P43 | **Scripts and languages** (PM-47). Interview first. It explores and then fixes the rules: <br>• **languages:** JavaScript, and whether Python is allowed, for what, and how its runtime is checked;<br>• **where scripts live and how they're structured:** MIRAI's own, and a project's in `.mirai/custom/scripts/` (39);<br>• **tests and approval;**<br>• **finding work worth a script:** the review's log reading (stage 1) lists the agent work that recurs and costs tokens, and each item is either scripted or kept with a reason;<br>• **a check that refuses** a new language, or a script outside the agreed places.<br>**Done when:** the rules are written and enforced, and a seeded one-off Bash script in a MIRAI change is refused | 4 | Review, MVP units 19c, 37, 38, 39 | §3 PM-47 |

**Dependencies across stages.** The stage order is provisional, so these are the links the
review must keep when it re-orders:

- P22d needs P10. P22e needs P19. P22f needs P33 (stage 5).
- P40 needs P20 (stage 3), for the generated reference.
- A unit that adds an event (P25c, P33, P37) or a record type (P14, P19, P33) registers it with
  P14's event list or P18's contract. If the unit is built first, it writes to the run log and
  its own schema file, and registers when P14 or P18 exists. No unit waits for those two.
- P34 uses record search (P23) when it exists and works without it.

**Candidates the review decides** (no unit until the data asks for one, with a threshold and a
minimum sample each, in `13` §5): extra coding rules for Kai, a plan-against-diff check,
`unnecessary` as blocking, a ticket size rule, a specialist verifier for HLD and ADRs, a fix for
disputes (a refutation pass for all tickets, an early exit on an unclear spec, a contest step
with an arbiter, a test as tiebreaker, a precedent file), parallel review lenses, an explorer
before the plan, test-failure triage, two builders truly in parallel, Codex as a standing
reviewer.

---

## 6. Considered and not planned

| Idea | Why not | What would reopen it |
|---|---|---|
| **JEV (TypeSafe) as the arbiter between Kai and Rex** | It returns a number with no reasons. Independent tests are small and mixed: it matched an LLM judge on simple routing, lost clearly on a single hard question (62.6% against 81.3% for Haiku), and the same input scored 0.94 and then 0.78. No example exists of it deciding between two agents. Diffs would go to a US service that keeps them by default | Independent proof on code-review tasks, or an arbiter step that turns out expensive enough for a cheap sorter to pay |
| Documents drafted at night | Each document waits for your approval before the next can start, so a night produces one draft and idles | A document flow with fewer gates |
| Agents starting agents, or agents as a team | Costs and permissions become unpredictable, and debate between agents adds little over a single pass | Nothing foreseen |
| Native Windows (without WSL) | No sandbox to cage agents there, as far as known (check in P06) | Claude Code ships a sandbox for native Windows |
| MIRAI running writes on a production database | A mistake changes customer data | A new gate with your key, by your decision |
| A full anonymised copy of production on staging | A data project of its own, and where personal data leaks | Your decision. MIRAI would only name the project's refresh command |
| One memory across unrelated projects | Leaks one project's details into another | Nothing foreseen |
| A built-in viewer inside MIRAI | You chose the separate hub repo from the start | Nothing foreseen |
| A separate "maintenance" ticket kind | A normal ticket with system-facing criteria covers it (PM-07) | Nothing foreseen |
| Configurable ticket statuses | Belong to the later hub product, or come from Jira | The hub product |

## 7. Later

Kept from version 1 and from `07`'s Later list, unchanged in meaning:

- Recorded feature videos (after the screenshot story).
- The full hub product: editing, login, statuses, saved views. Your ticketing prompt is its
  reference (`15` §8).
- Security audit of the running interface, of the cloud setup (GCP, AWS) and of git-host
  settings.
- Team features beyond the tracker: shared run status, shared evaluation logs, shared findings.
- ClickUp, Linear, GitHub Issues and Notion connectors.
- UX agent. Market research (needs a reviewed way for agents to read the web). Brainstorming
  itself is planned (`20`, P42).
- Codex and Cursor as main tools (not only as verifiers).
- `mirai export/import`. A dedicated system user or a container per agent run (it comes back to
  you under the V1 condition, on Ubuntu too). A hardware key for signing.
- A helper that moves a monorepo's documents into a new workspace repo. Per-tool plugins.
- `mirai-test-plan`. Acceptance-test-first for every ticket.

## 8. The process per feature (lighter than the MVP)

1. **A short interview** (one question at a time, with a guess), only for what the addendum
   left open.
2. **The design addendum** already exists (`10`–`18`). A feature that grows past its addendum
   gets a new numbered file, never a rewrite of `01`–`07`.
3. **One review round** (PM, Tech Lead, Architect) per addendum, before its first unit.
4. **Units built one at a time**, with spec approval and unit approval, as in the MVP.
5. **External skills and tools are vetted first** (`research/06` gate: read every file, pin a
   commit, record the verdict). Debugging skills, scanners and connectors especially.
6. **Dogfooding:** the hub goes through MIRAI's own brief → PRD → tickets flow. Units inside
   MIRAI's own repo are built the way MIRAI is built today, because agents must not edit the
   framework that cages them.
7. **Every new command also runs as `/mirai <command>`** in the session unless it is a gate.
8. **Nothing is tested against your work GitLab, Jira or Confluence.** Personal accounts only.

## 9. Names

Proposed names, reserved here so two units don't pick the same one. A unit's spec may still
change its own.

| Name | What it is | Not to be confused with |
|---|---|---|
| **the review** | The step after 20 tickets (`13` §1) | Rex's code review, and `mirai review-mr` |
| `mirai retro` | The log investigation and the walk-through of suggestions (P11) | |
| `mirai retro data` | The data pack, no model (P10) | |
| `tools/regress.js` | The regression set, a development tool run through the build runner (P12). Not an installed command | |
| `mirai review-mr` | Exists (unit 29d): your own ticket's MR on one screen, with merge, send back or later | |
| `mirai review-external` | Review of a colleague's MR (P41) | `review-mr` |
| `mirai epic reject <ticket>` | After an autopilot merge: stop the queue and repair (P25b). A gate | `review-mr`'s "send back" (before the merge) and `mirai discard` |
| `mirai resolve` | Conflicts between a ticket branch and what was merged (P29) | |
| `mirai learn` | Teaches the project (P35). Your note called the idea `teach-me`; the skill keeps that name, the command is `learn` | |
| `mirai debug` | Investigation only (P34) | |
| `mirai finding …` | List, show, promote or dismiss a finding (P33) | |
| `mirai audit security` | The security audit (P39) | `mirai doctor` |
| `mirai evidence setup` | Sets up evidence sources per environment (P31, P32) | |
| `mirai hub`, `mirai hub export`, `mirai docs build` | The hub and the generated reference (P18, P20) | |
| `mirai watch` | Attach the terminal block to a run (P15) | `mirai status` |
| `mirai notify set` | Stores a channel's secret outside the repo (P17) | |
| `/mirai brainstorm` | The brainstorming skill, in your session only (P42) | Nora's interview, which writes the brief |

**Config.** Settings that differ per developer (a notification address, the hub's port, the
verifier model when it needs a second subscription) belong in the personal layer. Settings the
project shares (which events to send, where records live, evidence sources without their
secrets) belong in project config. Each unit's spec assigns its keys to a layer.
