---
status: draft
version: 1
---

# 15 — The hub (stage 3)

Decisions PM-21, PM-24 to PM-33, PM-35.

## 1. What it is

One place to **read** what MIRAI stores: its own documentation, the project's documents, the
tickets, the logs, the findings and the history of changes. Your notes listed these as separate
ideas (a docs website, document pages, a log page, a prompt collection, a ticket board, central
memory). They are one system seen from different sides.

- **A separate repo from the start**, proposed name `mirai-hub`. MIRAI is installed on it like
  on any project and builds it through its own flow: brief, PRD, design, tickets, MRs. It is
  MIRAI's second real project after the pilot.
- **An extension of MIRAI.** MIRAI knows the repo, pins a tested version of it, and a project
  that chooses the hub gets it with one command.
- **Read by you only**, on your laptop, in this scope. No login, no roles, no database.
- **Per workspace.** One hub instance shows one workspace with all its services. Two unrelated
  projects never appear in one hub.

**Why a separate repo:** MIRAI's agents must not edit the framework that cages them, so MIRAI
can't build the hub inside its own repo with its own agents. A separate repo also frees the hub
from MIRAI's zero-dependency rule.

**Because MIRAI's own document flow designs the hub, this addendum fixes only its scope, its
priorities, its stack and the interface between the two repos.** The hub's PRD and HLD are
written by Nora and Arlo and approved by you.

## 2. The stack (your decision)

| Part | Choice |
|---|---|
| Server | Python with FastAPI. No Node on the server |
| Interface | React with TypeScript and shadcn components |
| Storage | None in this scope. The server reads MIRAI's files. SQLite comes with the later product |
| Run | Locally, bound to `127.0.0.1` only |
| Export | A command writes the documentation and document pages as plain HTML files, so they can be hosted (for example on GitHub Pages) |

## 3. The interface between MIRAI and the hub (in MIRAI's repo)

MIRAI is JavaScript and the hub's server is Python, so the hub can't reuse MIRAI's code for
reading files. The formats are therefore published in a neutral form.

### 3.1 The file-format contract (P18)

- **A schema per record type** (JSON Schema), committed in MIRAI's repo under one folder and
  versioned. P18 covers the types the MVP writes: ticket, epic, document frontmatter, approval
  record, proof record, run log line, feedback entry, metrics.
- **Each later unit registers its own type** with the contract when it is built: the run state
  view and events (P14), the change record (P19), the finding (P33). The contract is a folder
  and a rule, so no unit has to wait for another.
- **Sample files** for each type: valid ones and a few invalid ones. The hub's tests run
  against them.
- **Additive only.** A contract version may add fields and types. It never removes or renames
  one without a new major version, which the hub must opt into.
- **How the hub gets the schemas:** the hub repo copies the schema folder from the MIRAI version
  it is pinned to, with a script, and its tests fail when the copy differs from that version.
- **MIRAI's own tests fail** when a record written by the code doesn't match its schema, so a
  format can't change by accident. MIRAI has no dependencies, so **check first** how to
  validate: a small validator for the subset of JSON Schema the contract uses is the likely
  answer.

### 3.2 How the hub gets the data

The store is outside the project and private to MIRAI. The hub doesn't read it directly.

- `mirai hub export` (no model) writes a read-only **snapshot folder** for the workspace:
  records from the store and the repos, each matching its schema.
- **An export redactor, defined in P18,** decides what goes in. It is an allow-list per record
  type: named fields are exported and everything else is left out. Agent output, raw streams,
  the data an evidence tool returned and anything from the key or token folders are never on
  the list. A finding is exported with its evidence **references** (a file and line, a query
  and its row count), not with the rows or log lines themselves. (`shown()` only
  escapes text for a terminal. It is not a filter for secrets.)
- `mirai hub` starts the hub's server on that folder and refreshes the snapshot when the store
  changes.
- **The hub runs from a pinned release, not from a working checkout.** MIRAI's agents build in
  the hub's repo, so starting that checkout would run unreviewed code. `mirai hub` runs the
  pinned commit, in a container, with the snapshot mounted read-only.
- The snapshot holds no key, no token and no file an approval depends on. Deleting it loses
  nothing.

### 3.3 Config

```toml
[hub]                # project config
enabled = true
```

```toml
[hub]                # personal layer, per developer
port = 4310
```

The pinned hub version is part of MIRAI's lock, like other pinned parts.

A project without `[hub]` has no hub and loses nothing: every fact stays reachable through
`mirai` commands.

### 3.4 What the hub never does

- It never approves, drops, unparks, merges or signs. Beside each item it shows the command to
  copy.
- It never writes to the store, the repos or a ticket in this scope.
- It is never reachable from another machine.
- It is never readable by an agent during a run. The snapshot folder is on the sandbox's deny
  list, and the server's port isn't reachable from the cage (two red-team cases in P18).

## 4. The hub's scope, in priority order

These are the epics MIRAI builds in the hub repo. Each goes through the normal flow, so the
detail is decided there.

### H1 · MIRAI's documentation (priority 1)

- **Source:** the guide in `docs/guide/` (MVP units 77 and 78), the reference pages generated
  by P20, and the design reasoning from `design/`.
- **Structure (PM-27):**
  1. a summary and **how to do a task**, organised by situation ("a ticket parked, now what",
     "start a night run", "a document was changed after approval");
  2. overnight, the team, and the other situations;
  3. the full depth: every command (terminal and `/mirai`), every config key, the agents and
     skills, the architecture, and every workflow from the plan to going live;
  4. why it is designed this way.
- **Your prompt collection and tips** are how-to pages and a reference section here, not a
  separate site.
- Navigation, search, and diagrams rendered from Mermaid.

### H2 · Project documents (priority 2)

- Each PRD, HLD, LLD, ADR and brief, rendered with its diagrams and its two layers.
- Its state: draft or approved, the version, who approved and when, and "changed since
  approval".
- Links from a PRD to its design documents and tickets, from `mirai trace`.
- Only for documents that live in a repo. Documents in Confluence are linked, not copied.

### H3 · The ticket view (priority 3)

- A board of epics, tickets, bugs and investigations with MIRAI's own states.
- Per epic: progress, what is parked, what waits for you, what is queued for tonight.
- Beside each ticket: the next command, and links to its MR, its documents and its timeline.
- A view only. Tickets that live in Jira are shown from the local cache with a link to Jira.

### H4 · Logs

- **The overview across tickets:** the pass marks, parks by cause, cost per ticket, agent and
  step with the wasted part, `unnecessary` findings over time. This is the review's data pack
  (`13` P10) as pages.
- **One ticket's timeline:** every step in order with rounds, findings, tests, tokens and time.
- **MIRAI's raw logs:** run logs, agent and skill behaviour, feedback entries and evaluation
  records, with filters by ticket, agent, step and date.

### H5 · The history of changes

- From the change records (P19): a **changelog**, an **index of decisions** (ADRs and the
  tickets they governed), and a **feature map** (everything that ever touched an area).
- Releases: what went live and when, from the `released` events (`14`).

### H6 · Findings and the screenshot story

- Findings from the nightly run, the debug workflow and the security audit (`17`), with their
  evidence references and state (draft, became a ticket, dismissed).
- Per feature, Ivy's screenshots for each acceptance criterion in order.

## 5. Memory: the change record (P19)

Decision PM-31. D-26 stays: agents get small verified blocks, and no generated documentation is
loaded into their context.

- **Written at merge time by a script**, with no agent, from facts MIRAI already has.
- **One record per merged ticket:** the ticket id, title and service, the epic, the acceptance
  criteria, the top-part summary you approved, the files and folders touched, the ADRs that
  governed it, the MR link, the merge commit and the date.
- **Written on the ticket's branch at ship, before the merge.** The orchestrator commits it
  with the proofs, so it arrives with the MR and nothing is committed to the integration branch
  after your gate. A teammate who merges on the host gets it too. The merge commit and the
  merge date aren't in the file: they are read from git when the record is shown.
- **One small file per ticket** in the repo the ticket belongs to (proposed `.mirai/changes/`,
  a folder of its own, apart from the signed records under `.mirai/records/<ticket>/`). In a
  workspace, `mirai hub export` gathers them from all services.
- It isn't signed. It is a description, and no gate reads it.
- **It only grows.** A record is never rewritten. A revert adds a new record that points to the
  old one.
- **Documents that describe the current state** (an architecture description, a user manual)
  are not generated. When a ticket changes something such a document describes, updating the
  document is part of the ticket: the plan names the document, Rex checks it, you approve it.

### Record search for agents (P23)

- One broker tool, proposed `search_records(query, service?, path?, limit)`, returns matching
  change records and ADR titles. Results are capped and fenced.
- Nothing is loaded in advance. An agent that plans a ticket asks when it needs to.

## 6. Documentation that stays current (P20)

Decision PM-28.

- **Generated reference** (`mirai docs build`, no model): pages for every command with its
  options (and whether it is a gate), every config key with its default, every agent and skill
  with its role and tools. A project's own skills are added to it by P40 (`18`), so they are
  documented without anyone writing them.
- **A check** in MIRAI's own tests: a new command, config key, agent or skill with no page
  fails. This backs the skill, since a skill can be forgotten and a failing check can't.
- **A documentation skill** for MIRAI's own development: when a unit changes MIRAI's
  infrastructure, it updates the written pages (how-to and explanation) in the same PR. This
  matches Milestone F's rule that the guide changes with the code it describes.

## 7. Units

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| P18 | **File-format contract and `mirai hub`:** schemas and sample files for the MVP's record types, the registration rule for later types, the additive-only rule and the contract version, a validator after checking how, MIRAI's tests checking written records, the export redactor as an allow-list per type, `mirai hub export`, `mirai hub` starting the pinned release in a container with a read-only snapshot, `[hub]` config in its two layers, the snapshot and the port unreachable from the cage | Review | The hub is built against this | Every record type the code writes validates against its schema in the tests; an export of a seeded store contains only allow-listed fields, with no key, token, agent output or evidence (canary test); an agent can read neither the snapshot nor the port (red-team cases); a field removed from a schema fails the contract's own test; `mirai hub` without `[hub]` explains how to enable it |
| P19 | **Change records at ship:** the record written by script on the ticket branch with the proofs, one file per ticket in `.mirai/changes/`, merge data read from git, the revert record, the type registered with the contract | P18 | Memory starts collecting early | Shipping a seeded ticket adds a record to its MR that validates and matches the ticket and files; after the merge the record shows the merge commit from git; nothing was committed to the integration branch outside the MR; a revert adds a second record; no agent ran |
| P20 | **Generated reference and the documentation check** (`mirai docs build`): pages from commands, config, agents and skills; the failing check; the documentation skill for MIRAI's development | P18 | Reference pages can't go stale | Adding a dummy command without a page fails the tests; every command is listed in both its terminal and `/mirai` form; every config key appears with its layer and default |
| P21 | **The hub repo, set up as a MIRAI project:** the repo created, the stack skeleton of §2 with its checks and test levels, the schema copy script and its test, MIRAI installed, the brief and PRD for H1–H6 written through MIRAI and approved by you, the pin in MIRAI's lock | P18 | The hub is MIRAI's second project | `mirai doctor` is green in the hub repo; the hub's test run includes the contract's sample files and fails when the schema copy is out of date; an approved PRD and ticket set for H1 exist |
| P22a | **Hub epic H1, MIRAI's documentation.** Released first, including the static export | P20, P21 | Priority 1 | H1's own acceptance criteria from its PRD. For this plan: the guide and the generated reference are shown with navigation and search, and the export opens as plain files |
| P22b | **Hub epic H2, project documents** | P22a | Priority 2 | A two-layer document is shown with its approval state, and a document changed after approval is marked |
| P22c | **Hub epic H3, the ticket view** | P22b | Priority 3 | A seeded epic's board shows states, what is parked and what waits for you, with the next command beside each ticket |
| P22d | **Hub epic H4, logs** | P22c, P10 | The review's numbers as pages | The overview matches the data pack; a ticket's timeline matches its run log; raw logs filter by ticket, agent, step and date |
| P22e | **Hub epic H5, the history of changes** | P22c, P19 | Memory you can browse | The changelog, the decision index and the feature map are built from seeded change records; a release lists what went live |
| P22f | **Hub epic H6, findings and the screenshot story** | P22c, P33 | Findings have a history | Findings show their evidence and state; a feature's screenshots appear in AC order |
| P23 | **Record search for agents:** the broker tool, capped and fenced results, logged like other broker calls | P19 | Agents can ask what was done before | An agent planning a seeded ticket retrieves the earlier ticket that touched the same folder; a record containing a planted instruction reaches the agent fenced; a query returns no more than the cap |

Each of P22a–P22f is one epic that MIRAI builds in the hub repo, and each is confirmed by the
review before it starts. P22d–P22f wait for the units they depend on, in whatever order the
review sets for the stages.

## 8. The later product

Your ticketing prompt (`3_Atlas/Ticketing System for Mirai prompt`) describes a much larger
product: users and roles, customizable statuses, custom fields, saved views, claims and leases,
plan batches, editing, a database, an API with CLI and MCP. It is **not** in this plan. It is
the reference for what the hub repo may grow into after post-MVP.

Kept open now, so that step stays possible:

- The contract of §3.1 is the product's data model for everything MIRAI owns.
- The hub's server already sits between the files and the interface, so a database can be added
  behind it.
- Records keep stable ids.

Open questions for that product, not answered here:

- **One home per record (D5).** The prompt's "both" storage mode (files and database with
  two-way sync) conflicts with it. The product should pick files or database per record type.
- **A login that unlocks gates** (your thought in the interview). The problem to solve: agents
  run on the same machine as the browser, so a browser session that holds the unlocked key must
  be as unreachable for them as the key file is today.
- **Edits that aren't gates:** creating a draft, reordering the queue, editing a ticket's text
  before approval.
- **Recorded videos** for features you mark. The demo script is the source and the video is
  rebuilt from it, so a changed interface breaks a test and not a stored file.
