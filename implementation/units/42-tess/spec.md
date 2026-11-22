---
unit: "42"
name: tess
status: approved (Jet, 2026-11-21: "approve 42"; interview 2026-11-21: Q1 "C", Q2 "A", Q3 "A", restatement "yes"; after his read of the draft: Q4 "A" priority, Q5 "a mix of A and B" ticket types, Q6 "A")
roadmap: design/07-implementation-roadmap.md, row 42; design/01 §5 (tickets) and §7 (`tdd`, `tests`); design/02 (d) (one feature, from idea to live); 09 PM-07 (system-facing criteria); D-41 (strict templates, the template-gap signal); units 19c (`start_agent`, broker tools), 33 (epic, tickets, graph lint), 34 (`mirai-write`), 35 (interview, pause), 36 (journeys), 38 (store, links), 40 (Vera), 41 (Nora, the pause and the run record)
depends_on: ["19c", "33", "34", "35", "36", "38", "40", "41"]
---

# Unit 42: Tess, the ticket planner

## Why

The epic and ticket types and their graph lint exist (33), and Nora writes the brief and the PRD
(41). Nobody yet turns an approved PRD into the epic and its tickets: today a person or a generic
session splits the work by hand. Tess is that agent. She cuts the approved documents into tickets
that are ready for your one approval of the set. She also writes a single ticket you ask for by
hand.

**Why now:** the build loop runs tickets, and the `mirai-prd` workflow (44) and the night run
(55) need a ticket set to start from.

## Decisions (Jet, 2026-11-21, interview)

1. **When she starts follows the workflow** (Q1, "C"; design/02 (d)):
   - **`standard`:** after your PRD approval;
   - **`full`:** after your approval of the design (HLD, ADRs, LLD; units 62–65). Until those
     units exist, she starts from the approved PRD on `full` too;
   - **by hand:** you ask for one ticket (decision 2).
2. **A ticket you ask for by hand: a short interview, then one ticket** (Q2, "A"). You give one
   line in your session. She reads the context files and asks only what's missing (1–3 questions,
   35's skill). She writes one story or bug that passes the lint and Vera, and you approve it on
   its own. It belongs to no epic. It gets its own branch, and its documents travel in the code
   merge request (38).
3. **A gap in the PRD: she pauses and asks you** (Q3, "A"). An AC no one could test, or a case
   the PRD doesn't cover, pauses her as 41's pause does: her question goes into `interview.md`,
   and your session shows it. If your answer changes the PRD, Nora updates it and you approve the
   PRD again, shown only what changed. Then a new Tess run continues. She never edits the PRD,
   and she never fixes a gap only in a ticket: the PRD stays the one truth that Vera and
   `mirai trace` check against.
4. **How she cuts is design/01 §5 and §7, as written** (restatement, "yes"):
   - vertical slices by default, and the first ticket is a tracer bullet through every layer;
     next comes the one she's least sure of;
   - "split, never shrink": "for now", "placeholder" or "wired later" is a second ticket;
   - every ticket belongs to exactly one repo; cross-repo work gets an interface ticket first,
     then one ticket per repo;
   - sizes S, M and L only, within 33's caps; a set over the cap means splitting the PRD or moving
     to `full` (33), and she pauses to ask which;
   - `e2e: true` only when a ticket creates or changes a critical journey (`journeys.md`, 36). A
     feature that creates a new journey gets a proposal to add it, which you approve at the
     ticket gate;
   - `tdd` and `tests` only where they differ from the project setting, as a proposal; only you
     set them;
   - a technical ticket is a normal ticket. Its ACs may describe the system ("the log entries in
     GCP use the new structure") instead of a customer, and each must be testable by the
     reviewer.

5. **Priority and order are two things** (Q4, "A", after Jet's read: "Is the priority decided
   properly?"; it wasn't, anywhere):
   - **`priority`:** a field on every ticket, `high`, `normal` or `low`, `normal` by default.
     Tess proposes it (an urgent bug as `high`), and you set it at approval;
   - **`order`:** within an epic, Tess numbers the tickets: the tracer bullet first, then the one
     she's least sure of;
   - **the run's pick** (Jet, after his second read: "mainly what is blocking each other"):
     among the ready tickets (their `after` tickets done), first the one that blocks the most
     other tickets (counted through the whole `after` chain), then the highest priority, then the
     epic's order, then the earliest approval. So a ticket three others wait for goes first; an
     urgent bug that blocks nothing goes before every other ticket that blocks nothing.
6. **Ticket types are the project's** (Q5, "a mix of A and B"; Jet: "Each ticket type should
   have the name and a description how it is used and for what. Imagine in Jira ticket types
   might have different names"):
   - **the defaults:** Story, Bug and Investigation;
   - **per project, fully yours:** each type has a name and a description of what it's for and
     when to use it. Tess reads the descriptions to choose a ticket's type. The names can be
     Jira's (Task, Bug, Spike, Tech Debt), and each type names its tracker issue type (38);
   - each type may have its own template and checklist.
7. **Every type runs as one of MIRAI's behaviours** (Q6, "A"): `change` (code and tests), `bug`
   (a test that reproduces it first) or `investigation` (research and a written finding, no code
   merge). A type can't invent a new way to run, so the safety model stays the same. A new
   behaviour is a MIRAI change, never a project setting.

## Scope

**In**

1. **The agent: `registry/agents/mirai-ticket-planner.toml` + `.md`** (Tess), under a role of
   her own (`registry/roles/ticket-planner.toml`, read-write, step `tickets`).
   - **Writes** only the initiative's epic and its `tickets/` folder (the store's `pathOf`, 38),
     or the one ticket's file for a ticket asked by hand: after the run, her changes are checked
     against those paths.
   - **Reads** the approved brief, PRD and design documents, the context files (36), and the
     interview.
   - **Tools:** `Read`, `Glob`, `Grep`, `Write` and `Edit`, within that write scope.
   - **Gets** 34's `mirai-write` skill (its epic and ticket guides) and the rules of decision 4.
   
   Her prompt gives her steps:
   1. read the approved documents and the context files;
   2. write the epic and its tickets;
   3. call the `epic_render` broker tool (`mirai epic render`, 33) for the generated sections;
   4. run MIRAI's checks through the broker (lint with the graph lint, `verify`);
   5. fix the must-fix findings within the rounds set in `[docs]`;
   6. stop.
2. **Starting her:**
   - **after an approval:** when the PRD (on `standard`) or the design (on `full`) is approved,
     the session that approved it starts Tess with 19c's `start_agent` (`agent:
     mirai-ticket-planner`, the initiative). She refuses to start while the PRD, or the design
     on `full`, isn't approved as it is now;
   - **by hand:** `/mirai ticket "<one line>"` in your session runs 35's interview with a cap of
     3 questions, then starts Tess for one ticket. The ticket's type (story or bug) comes from the
     answers;
   - the session checks on her with `agent_status` and tells you when she's done or paused, with
     the paths and links (38), as for Nora (41).
3. **The testability lint for ticket ACs** (the roadmap's "an AC nobody could test fails the
   lint"). Each AC of a story or a bug is a "Given … when … then …" sentence, or a plain sentence
   whose outcome can be observed, and its outcome names no vague word without a number. The
   writing lint's vague words (`fast`, `reliable` …) count, plus `reliably`, `properly`,
   `correctly`, `as expected`, `appropriately`, `smoothly`, `seamlessly` and `quickly`. The
   lint names the AC and the fix ("say what the reviewer sees: a value, a screen, a record, a log
   line"). Vera's ticket checklist keeps the judgement: could the reviewer test it with what the
   ticket says?
4. **Pausing** (decision 3): when Tess meets a PRD gap, or a set over 33's cap, she appends an
   open question to `interview.md` (with options and a guess), records the run as paused, and
   stops. Your session shows the question. After your answer (and the PRD's new approval, if it
   changed), a new run continues from the documents as they are.
5. **Priority and order** (decision 5): `priority` (`high`, `normal`, `low`; default `normal`)
   and `order` (a whole number, within the epic) on the story and bug types; the epic's ticket
   table shows both, and how many tickets each one blocks; `high` is listed under "Decisions for
   you". The run's pick (the build loop's "next ready ticket") orders by the number of tickets it
   blocks (all the tickets whose `after` chain reaches it, not yet done), then priority, then
   `order`, then approval time. `mirai show`
   lists ready tickets in that order.
6. **Ticket types** (decisions 6 and 7):
   - **config:** `[[tickets.types]]` (project layer), each with `name`, `description`,
     `runs_as` (`change`, `bug` or `investigation`), and optional `template`, `checklist` and
     `tracker_type`. The defaults are Story (`change`), Bug (`bug`) and Investigation
     (`investigation`). The config check refuses a type with no description, an unknown
     `runs_as`, or two types with one name;
   - **the ticket:** its frontmatter gains `ticket_type: "<name>"`. The document type that lints
     it comes from `runs_as`: `change` is 33's story, `bug` is 33's bug, and `investigation` is a
     new document type (template, checklist, example: a question, what was looked at, the
     finding, what to do next, with sources);
   - **a type's own template** is checked like 37's replacement template: it must keep every
     protected part of its behaviour's type. It's approved like an overlay (37), and an
     unapproved one isn't used;
   - **Tess** gets the types and their descriptions in her input and picks one per ticket. A
     ticket asked for by hand gets its type from the interview;
   - **trackers (38)** use `tracker_type` as the issue type when a ticket is published.
   
   Running an `investigation` ticket (the research run, the finding, no code merge) is a unit of
   its own, 42b, in the roadmap. Until it's built, the run refuses to start one, with the reason.
7. **New critical journeys:** when a feature creates one, the epic's "Decisions for you" lists
   the proposal with the ticket key, and approving the set adds it to `journeys.md` as a change
   you approve with it (36's approval of `journeys.md`, a new signed line).
8. **Template gaps:** as 41 (D-41): the content goes into the closest section, a `template_gap`
   event is logged, and `mirai show <initiative>` lists it.
9. **The run record:** each Tess run logs its tier, model, rounds used per check, template gaps
   and outcome (done, paused, failed), as Nora's runs do.
10. **Docs:** `docs/agents.md` lists Tess. `docs/tickets.md` (new): the types, priority and
   order. `docs/documents.md`'s "From request to approval" (41)
   gains the ticket step, and a short section "One ticket by hand". `/mirai ticket` goes on the
   session list (21f). Any new key goes in `docs/config.md` (34b's check).

**Out**

- The `mirai-prd` workflow and `/mirai-new` (44).
- `mirai trace` (43). The graph lint's coverage check (33) is what this unit uses.
- Arlo and the design documents (62–65). Tess reads them when they exist.
- Writing code, plans or tests (Kai, Ivy).
- Tess editing the PRD, the design or `business.md`.

## Tests

- **T1 The agent:** Tess's definition validates under her own role (read-write, step
  `tickets`; 37's validation). After the run, a write outside the initiative's epic and tickets
  is refused (fake launcher). She has the `mirai-write` skill.
- **T2 Starting:** `start_agent` for Tess on an initiative whose PRD isn't approved, or was
  changed after approval, is refused with the reason. On `full` with no design approved yet
  (before 62–65), she starts from the PRD.
- **T3 The testability lint:** a ticket AC "reminders are sent reliably" fails, naming the AC; "Given
  a task due tomorrow, when the reminder job runs at 18:00, then one email is sent to the
  assignee" passes; a system-facing AC "the log entries in GCP use the structure in ADR-12"
  passes.
- **T4 Pause:** a fake Tess run that meets a PRD gap appends an open question to `interview.md`,
  records the run as paused, and writes no tickets after it. A set over the cap pauses with the
  two choices. A new run after the answer continues.
- **T5 One ticket by hand:** `/mirai ticket` exists on the session list. A fake run produces one
  ticket with no epic, which lints clean and is approved on its own with 33's ticket approval.
  More than 3 interview questions is refused by the skill's cap.
- **T6 `e2e` and journeys:** on a seeded set where one ticket changes J-1, only that ticket has
  `e2e: true` (a fake output with a second `e2e: true` ticket is a Vera must-fix); a proposed new
  journey is listed under "Decisions for you", and approving the set records the `journeys.md`
  change.
- **T7 Template gap and run record:** a fake output with one gap writes one `template_gap` event;
  the run record holds tier, model, rounds, gaps and outcome.
- **T8 The docs check** (34b) passes, with `[[tickets.types]]` in `docs/config.md`.
- **T9 The run's pick:** with four ready tickets: A (`normal`, `order` 2, blocks two tickets
  through a chain), B (`normal`, `order` 1, blocks none), C (`normal`, `order` 3, blocks none),
  and D (a `high` lone bug, blocks none), the run picks A, then D, then B, then C. A done
  ticket in the chain no longer counts as blocked. A `high` ticket missing from "Decisions for you" fails the epic lint.
- **T10 Ticket types:** a project with Task (`change`), Bug (`bug`), Spike (`investigation`) and
  Tech Debt (`change`, own template): a Tech Debt ticket lints with its own template and 33's
  story checks; a type with no description, an unknown `runs_as`, and a template missing a
  protected part are each refused, naming the problem; with no `[[tickets.types]]` the defaults
  apply; starting an `investigation` ticket is refused until 42b, with the reason.

## Probes (real)

- **P1 A real PRD into tickets:** Tess cuts 41's P1 PRD (or 32's P2 PRD if 41's isn't there) on
  the sample app. **Pass when:**
  - the set passes the graph lint and Vera after at most one fixing round;
  - every FR, NFR and AC is covered, and nothing is added or cut;
  - only the journey-changing ticket has `e2e: true`;
  - you'd approve the set, or your rejection names something the rules or Vera should have
    caught.
- **P2 A gap:** the same PRD with one AC made untestable ("reminders are sent reliably"). **Pass
  when** Tess pauses with a question that names it, and after your answer and the PRD's update, a
  new run finishes.
- **P3 A technical ticket by hand:** in your session, `/mirai ticket "the log format in GCP should
  change to the new structure"` on the sample app (or a similar system change). **Pass when** she
  asks at most 3 questions, and the ticket's ACs describe the system and are testable by the
  reviewer.
- **P4 Your work's types:** a project configured with your work's types (Task, Bug,
  Investigation, each with your description). Tess cuts a small PRD. **Pass when** each ticket's
  type is the one you'd have chosen, and the set lints clean.

## Done when

- T1–T10 pass, and the full suite passes through the build runner and CI.
- P1–P4 pass.
- The roadmap row's done-when holds: a graph-lint-clean ticket set; only the journey-changing
  ticket in a seeded set gets `e2e: true`; a seeded technical ticket gets system-facing ACs that a
  check can test; an AC nobody could test fails the lint.

## Checked against the queued units

- **33:** Tess writes 33's types and passes its graph lint and caps. The testability lint is new,
  on 33's `ticket` check. Story and bug gain `priority`, `order` and `ticket_type`.
- **37:** a ticket type's own template is checked and approved through 37's replacement path.
- **35:** the interview skill gains a question cap for a ticket asked by hand.
- **36:** `e2e` is decided from `journeys.md`. A new journey goes through 36's approval.
- **37 (agents):** her definition validates and can be overlaid like Kai's and Rex's.
- **38:** paths come from `pathOf`, links from 38. A lone ticket's documents ride in the code
  merge request (38).
- **40:** Vera checks the set with the ticket checklist. Her 36 rule applies to journeys.
- **41:** the pause, the telling, the template gaps and the run record are 41's, reused.
- **44** *(corrected by 44's interview, Jet 2026-11-22; it said "chains Tess after the PRD
  behind `/mirai-new`"):* 44 ends at the approved, published PRD. You start Tess yourself; 45 automates
  the hand-off. `/mirai-new` sends a `quick` request to the one-ticket path (decision 2).
- **55:** the night run starts from Tess's approved set, in the run's pick order.
- **42b (new):** running an `investigation` ticket.

**Re-checked against 37 as built (2026-11-21):**

- **Her role** (Scope 1, T1): as for Nora (41), only a role's `may_write` is applied, and
  `developer` (named `author` before 38b) allows `["**"]` with step `build`. Changed to: Tess runs under a role of her own,
  read-write, step `tickets`; after the run her changes are checked against the initiative's
  epic and `tickets/` paths.
- **The `investigation` type** (Scope 6): it declares `protected_sections` and
  `protected_fields`, each with `read_by` (37's T1, `test/documents/overlays.test.js`), and its
  template's hash goes in `test/lint/template-versions.json`.
- **Story and bug change** (Scope 5, Scope 6): their templates change, so each gets
  `template_version` 2 with new hashes. `priority`, `order` and `ticket_type` are
  `[[protected_fields]]` read by a new reader, `run-pick`, added to `READERS`
  (`src/config/registry.js`).
- **A ticket type's own template** (Scope 6, T10): 37 keys an overlay to an existing type name,
  so it refuses `tech-debt` (`src/config/overlays.js`, `applyType`), and it has no replacement
  checklist. Added: a ticket type's template is `.mirai/custom/ticket-types/<name>.toml` + `.md`
  with `base = "story" | "bug"`, checked by 37's replacement rules and approved as
  `overlay-<name>`.
- **The testability lint** (Scope 3): it reads "Acceptance criteria" by name, but
  `CHECK_READS.ticket` is empty (`src/config/registry.js`). Added: `CHECK_READS.ticket` gains
  "Acceptance criteria".
- **Skills and commands in her run** (Scope 1): 41's findings apply. `mirai-write` must say an
  agent runs MIRAI's checks through its broker tools, and her prompt carries `mirai-write` and
  the templates as the approved overlays render them, since a strict launch loads no skills.
  `mirai epic render` reaches her as a broker tool, `epic_render`: Tess has no shell.
- **37's "For later" items for 33/42** (37's test-results). Each is to sort at 42's re-check
  before its build (scope or out):
  - the `files_likely` overlap warning fires many times with no guidance;
  - NFRs with no AC-NFR IDs leave `covers_ac` empty;
  - an NFR verified by an end-to-end test when there's no critical journey;
  - near-identical high-risk items in "Decisions for you";
  - where the ticket key prefix comes from;
  - the story template's `epic:` line is only in a comment;
  - how added PRD sections (Data privacy, Security sign-off) flow into tickets.
