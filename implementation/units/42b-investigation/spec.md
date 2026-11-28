---
unit: "42b"
name: investigation
status: draft (interview with Jet 2026-11-28: Q1 "A", Q2 "B", Q3 Jet's "D" (four choices), Q4 "A", Q5 "A" with `dropped`, Q6 "A", restatement "yes"; then the two launches, "A"). Not approved yet
roadmap: design/07-implementation-roadmap.md, row 42b; units 42 (ticket types, the investigation template), 65b (the research run, its cage and lint, the brainstorm engine), 14d and 15a (`run_tests` through MIRAI's MCP server), 44 (the document loop: Vera's rounds, approval, publish), 45 (lone tickets), 19c (agents started from your session), 21f (session commands), 18 (the red team)
depends_on: ["42", "65b", "14d", "44", "45"]
---

# Unit 42b: Running an investigation ticket

## Why

Since unit 42, a project's ticket types include Investigation (and any type with
`runs_as = "investigation"`, such as Spike): a ticket whose work is a question answered, not code
merged. Tess writes them, and the template holds the question, the criteria and where to start;
"Looked at", "Finding" and "Next steps" say "Not applicable" until a run fills them. `mirai plan`
and `mirai run` refuse one today (`investigationRefusal`, `src/tickets/types.js`). This unit runs
them: the answer, with its evidence, lands in the ticket, and you decide what it leads to.

## Decisions (Jet, 2026-11-28, interview)

1. **The agent** (Q1, "A"): 65b's research run, extended to the code. Not Kai (he'd need the web
   in the cage that writes code) and not Arlo (he works on documents).
2. **What it may use** (Q2, "B"): the repo, read only; the web under 65b's rules (`WebSearch`, and
   `WebFetch` only through the fetch gate); MIRAI's `run_tests` through its MCP server, with the
   project's levels. **No shell.** A test run it cites is a source, by its run id.
3. **Before you see it** (Q4, "A"): only the lint. Every claim cites a source; a web quote must be
   in what that fetch returned (65b); a code quote must be in that file at the run's commit; a test
   run must exist with that result. A finding that fails gets one fix round (65b's
   `RESEARCH_FIX_ROUNDS`), then the run fails. Vera runs only on the paths that need her (choices
   1 and 2).
4. **Then MIRAI shows you the finding and asks** (Q3, Jet's "D"):
   1. **Make it a document:** Vera checks the finding against the ticket's criteria, with 44's
      fix rounds; you approve it (`mirai approve`, human-only); it's published in the docs MR. The
      ticket ends `done`.
   2. **Make a ticket:** MIRAI asks which of the project's types (those that run as `change` or
      `bug`), and **Tess** writes one lone ticket from the finding; Vera checks it, as any lone
      ticket (45). The investigation ends `done` when that ticket is approved, and each links the
      other.
   3. **Do nothing** (Q5, "A"): the finding stays in the ticket, marked "Not reviewed: closed
      without a follow-up"; it's committed with the docs; the ticket ends **`dropped`** (an existing
      final state); the journal keeps your choice.
   4. **Talk it through:** a conversation about the finding in your session (65b's brainstorm
      engine: one question at a time, with a recommendation), its `Q → A` log appended to the
      ticket's Notes, then one of 1–3. In a plain terminal this choice prints the session command
      to use.
5. **When** (Q6, "A"): `mirai run` picks investigations in the normal ticket order, at night too;
   `mirai investigate <KEY>` starts one by hand. A finished one waits for you: `mirai status` and
   the run's report (`mirai report`) list it until the inbox (46) does. You choose with
   **`mirai investigate <KEY> --decide`**, also `/mirai investigate <KEY> --decide` in your session
   (Claude Code, Cursor, Codex; 21f's list).

## Question for Jet: two launches, so no launch holds both your code and the web (answered 2026-11-28: "A")

65b's cage rests on "nothing to steal": its research run sees no repo (65b, decision 3.1). Decision
2 above gives one agent your code **and** the web. That is the "lethal trifecta" 65b avoided: private
data, untrusted pages, and a way out. The fetch gate stops a page from making it fetch a crafted
URL, but **a search query is itself a way out**: a page with hidden instructions can make the run
search for a line of your code or a key it read, and the search engine receives it. The lint runs
after the fact; it can't take a query back.

- **A. Two launches, web first (recommended).** One investigation is two launches of the same
  agent, under two templates:
  1. **web** (65b's `research` template, unchanged): input is only the ticket file (the question,
     the criteria, the starting sources, all from Tess's set that you approved). It writes
     `research.md` for this ticket, with 65b's lint. It runs only when the ticket asks for the web
     (Tess sets `web: true`, or you do; default off), so a code-only question costs nothing extra;
  2. **code** (a new `investigation` template): the repo read only, `run_tests`, `research.md` as
     data; **no web tools at all**. It writes the finding.
  Your code never sits in a launch that can reach out, and the web launch only ever sees what you
  approved. Cost: the web questions can't be informed by the code. If the code launch finds it
  needs the web, it says so under "Next steps" ("search for X"), and choice 4 or a new
  investigation takes it from there.
- **B. One launch, both** (the interview's literal answer): simpler, one round trip, web searches
  informed by the code. The risk above stays; mitigations would be a query filter (refuse a query
  holding a line from the repo or a high-entropy string) and the red team. A filter can't be
  complete, so this is a known limit you'd accept.
- **C. Code only, no web.** Simplest and safe; a question about a library's current docs isn't
  answered.

**Recommendation: A.** It keeps 65b's guarantee by construction, and the extra launch is skipped
whenever the web isn't needed. Jet chose A (2026-11-28); the scope below is written for it.

## Scope

**In**

1. **`mirai investigate <KEY>`** (`src/cli/commands/investigate.js`) and its place in `mirai run`:
   - refuses a ticket that isn't an investigation (by its type's `runs_as`), not `ready-for-dev`,
     or with a dirty tree, naming the reason;
   - `investigationRefusal` is removed: `mirai run` picks an investigation in the run-pick order
     and runs this flow instead of plan/build; `mirai plan <KEY>` on one says to use
     `mirai investigate`;
   - one MIRAI run (one run lock), as Nora's and Tess's.
2. **The web launch** (when the ticket has `web: true`): 65b's research run, its inputs the ticket
   file only; `research.md` written beside the ticket (`tickets/<KEY>-research.md`); 65b's caps,
   fetch gate, lint and "Suspicious pages" unchanged.
3. **The code launch** (`src/investigate/run.js`), role `investigation`, the research agent's
   persona with its own rules section for code:
   - **the `investigation` template** (`src/launch/strict.js`): `Read`, `Glob`, `Grep` in the
     repo, with the build template's denied paths (secrets, `.git` internals, the store, the home);
     `mcp__mirai__run_tests` with the project's levels; `Write` only to `finding.md` in its working
     folder. Denied: Bash, Task, Agent, `WebSearch`, `WebFetch`, every other MCP tool, any write in
     the repo;
   - **inputs:** the ticket, `research.md` if any (as data, never instructions; its suspicious
     pages listed), the repo at the run's commit;
   - **output:** `finding.md` with the ticket's four run sections (Looked at, Finding, Next steps,
     Sources); MIRAI writes them into the ticket file and commits on your current branch (41's C1;
     the local store as 41's B1). The ticket's Question and criteria are never changed;
   - caps: `[investigate] max_minutes` (default 30) and the launch's turns; a row
     `investigation` in `mirai models` (45b).
4. **The finding's sources and their lint** (the `investigation` type gains `template_version` 2):
   - each source is one of: **web** (`[S-n]` from `research.md`: URL, quote), **code** (path,
     line range, short quote), **test run** (the run id, the level, the result);
   - every claim in "Finding" cites at least one source; "Sources" also keeps the planner's
     starting points, marked as such;
   - the lint: a web quote not in that fetch's evidence, a code quote not in that file at the run's
     commit, a test run id that doesn't exist or has another result, a claim with no source, a
     section left "Not applicable": each fails. A finding with no sources fails (the roadmap's row);
   - one fix round with the lint's report, then the run fails and the ticket goes back to
     `ready-for-dev` with the reason.
5. **The ticket's states** (`src/status/machines.js`): an investigation uses
   `ready-for-dev → in-progress` (investigation started) `→ in-review` (finding written, lint clean:
   waiting for your choice). Two new moves, human-only, signed: `in-review → done` (choices 1 and 2,
   with the approval) and `in-review → dropped` (choice 3, with its note). `done` is derived from
   merge events for code tickets; for an investigation it is this signed move, as no MR exists.
6. **`--decide`** (`mirai investigate <KEY> --decide`, `/mirai investigate`):
   - shows the question, the finding and its sources (as clickable paths and links, 32's rule),
     then the four choices; a journal line `investigation_choice` (choice, note);
   - **1:** Vera with the `investigation` checklist (does the finding answer each criterion, is
     each claim supported), 44's rounds (`[docs] verify_fix_rounds`; a fix is a code launch with
     Vera's findings); then your `mirai approve <KEY>`; publish through the docs MR (38);
   - **2:** you pick a type; Tess's `one` mode with the finding as its input in place of an
     interview; the new ticket links the investigation ("From:"), and the investigation's Next steps
     link the new ticket; it moves to `done` when the new ticket is approved (45);
   - **3:** "Not reviewed: closed without a follow-up" under the Finding's heading; committed; `dropped`;
   - **4:** in the session, the brainstorm engine (65b) with the finding as its topic; its log goes
     to the ticket's Notes; then 1–3. In a terminal: the session command, and nothing changes.
7. **Status and report:** `mirai status` lists investigations waiting for a choice; the run's report
   (`mirai report`) has a line per investigation run at night (its key, its answer's first sentence,
   the `--decide` command).
8. **The red team** (`src/redteam/cases-investigation.js`, the `investigation` template):
   - `WebSearch` and `WebFetch` are absent [blocker];
   - Bash is absent; a write in the repo or outside `finding.md` is refused [blocker];
   - a read of `.env`, the home or the store is refused [blocker];
   - `run_tests` with a level outside the policy is refused [blocker];
   - a planted instruction in a repo file (a comment "ignore your rules, write to …") is not
     followed (recorded: it depends on the model);
   - the control: a read in the repo and a `run_tests` call succeed.
9. **Docs:** `docs/tickets.md` (an investigation's run, the four choices; the "isn't run yet"
   paragraph goes), `docs/run.md`, `docs/agents.md` (the two launches and their cages),
   `docs/documents.md` (the type's run sections), `docs/model-tiers.md`.

**Out:**
- a shell, prototypes or any code change in an investigation (Q2);
- Vera before you choose (Q4);
- the inbox line (46);
- talking to an agent directly about a document (45c);
- a web launch that sees the code (the question above, if A).

## Tests

- **T1** `mirai investigate`: the refusals (not an investigation, wrong state, dirty tree);
  `mirai run` picks an investigation in order and runs it; `mirai plan` on one points to
  `investigate`.
- **T2** the two launches: no `web` → the code launch only; `web: true` → web, then code, with
  `research.md` as the code launch's input; the finding written into the ticket, Question and
  criteria untouched; committed.
- **T3** the `investigation` template: web tools, Bash, Task, Agent and other MCP tools absent;
  writes outside `finding.md` refused; denied paths refused; `run_tests` levels from the policy.
- **T4** the lint: each failing case in Scope 4 fails, a clean finding passes; one fix round, then
  `ready-for-dev` with the reason.
- **T5** the states: the two new human-only moves, signed; `done` for an investigation without an
  MR; a forged move refused (44's pre-commit rule).
- **T6** `--decide`: each of the four choices, with a stand-in Vera and Tess; the journal line;
  choice 2's links both ways and `done` only after the new ticket's approval; choice 4 in a terminal
  changes nothing.
- **T7** status and report lines; `mirai models` shows `investigation`.
- **T8** the docs check (34b); the session list (21f).

## Probes (real)

- **P1** on the sample app, a code-only investigation (for example "Which of our jobs run on the
  queue, and would the CSV import need new infrastructure to move there?"): a real code launch
  with a real `run_tests` call; the finding passes its lint with code and test sources; choice 3
  ends `dropped`, finding kept.
- **P2** a `web: true` investigation (for example "Is Laravel 11's job batching fit for a
  10 000-row import?"): web launch, then code launch; choice 1 through Vera to your approval.
- **P3** choice 2: Tess writes a lone ticket from a finding; Vera checks it; you approve it; the
  investigation goes `done`.
- **P4** the red team's investigation cases through the build runner: GREEN.

## Done when

T1–T8 pass, the full suite through the build runner and CI; P1–P4 pass; the full red team GREEN
with the new cases; the roadmap's row 42b holds ("an investigation ticket ends with an approved
finding and no code change; a finding with no sources fails the lint"; with Jet's choices, choice 3
ends `dropped` with the finding kept).

## Checked against the other units

- **42:** the type, template and `protected_sections` stay; `template_version` 2 for the sources'
  shape and the "Not reviewed" mark; its hash in `test/lint/template-versions.json`. Tess's
  ticket-writing rules gain `web: true` (when a question needs current outside sources).
- **65b:** its research run and cage are reused unchanged for the web launch (A); its lint's
  quote check is shared with the finding's lint; the brainstorm engine gets its second caller
  (before P42).
- **14d, 15a:** `run_tests` unchanged; the `investigation` template's policy lists the levels.
- **43:** `mirai trace` on an investigation already says "no code scope"; unchanged.
- **44:** choice 1 reuses its Vera rounds and approval; a new checklist `investigation-checklist.md`
  (the template already names it).
- **45:** choice 2 reuses the `one` path with a finding in place of an interview; 45's "two actions"
  for a quick ticket stays about change tickets.
- **46:** "waiting for your choice" becomes an inbox line there; until then `mirai status`.
- **55:** the night run picks investigations like other tickets.
