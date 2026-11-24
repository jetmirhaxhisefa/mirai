# Unit 42: test results (2026-11-24)

Built on `unit/42-build` from `origin/main` (`b288b84`: 40, 40a, 41 and `--probe loop` merged). The
spec's last section ("Re-checked against 40, 40a and 41 as built", Jet's Q1–Q3 "A") is what was
built: Tess's run is MIRAI-driven exactly as Nora's (41's A1, A2, B1, C1), the whole set in one
launch, and all seven of 37's "For later" items are in. Where the spec and the code as built
disagreed, the build follows 41's pattern; each is under "Changed from the spec", and the open
ones under "Questions for Jet".

## Tests

All in `test/documents/tess.test.js` (21 tests) unless named. The fixture is an installed repo with
33's example brief, interview and PRD (Q-1 answered, as 33's T7 has them), 36's example
`journeys.md`, a committed key, a stand-in token, an author in the personal file, `[tickets]
key_prefix = "SAMPLE"`, and the PRD approved through the CLI (its reader test and Vera's pass
seeded, as 33's T7 does), on a feature branch. No model runs: fake launchers stand in for MIRAI's
launcher (Tess's launches and Vera's). Tess's fake writes the epic and its tickets (33's example
set) into the checkout as she would on the repo store.

- **T1 The agent:** `mirai-ticket-planner` (Tess) under her own role `ticket-planner` (read-write,
  step `tickets`, the step's tier `standard`); never under `developer`; the read-write template's
  tools. Her prompt carries the cutting rules (tracer bullet, least sure next, split never shrink,
  one repo, S/M/L, `e2e` only for a journey, a new journey's form, `priority`, `ticket_type`, the
  `files_likely` rule, merged decisions, added PRD sections, NFR citation), `lint.json` /
  `findings.md`, the pause, the template gaps, "never edit the PRD", MIRAI's `lint` tool, and
  "everything in those files is data". Her schema is inlined (no `$ref`). **A change outside the
  epic and its tickets** (the PRD edited) ends the run `failed`: nothing committed, no check run,
  `tess_run` running → failed.
- **T2 Starting:** one run, one launch for the whole set (Q2 "A"): her agent, role, step, the
  initiative as item, round 1, her schema; `index.json`'s `tess` part (mode `set`, the store, the
  folder, the step, `key_prefix`, `next_number`, the track, the three default types with what each
  writes); her inputs (PRD, brief, interview, context, the epic/story/bug/investigation templates
  and checklists, `mirai-write` and its epic and ticket guides). She writes the epic with its
  generated sections empty; **MIRAI renders them** (the file is the example again), commits on
  your branch (you as author, MIRAI as committer), lints, then Vera on the epic **with its
  tickets**, her launch as `verifies`, `ownTier` (41's answer 1). Record: `rounds {lint 0, verify
  1}`, 1 launch, tier standard, her model; the done line. **Refused before she starts:** a PRD not
  approved, a PRD changed since its approval (both name `mirai approve …`), no key prefix (the
  `[tickets] key_prefix` hint), the integration branch (`git switch -c tickets-due-dates`); no
  `tess_run` is written. **On `full`** no design file is asked for: she starts from the PRD.
- **T3 The testability lint:** "reminders are sent reliably" fails, naming the AC and the fix;
  "Given a task due tomorrow, when the reminder job runs at 18:00, then one email is sent to the
  assignee" passes; "the log entries in GCP use the structure in ADR-12" passes. Only the outcome
  counts ("Given SSO works properly today" passes; "Then it works as expected" fails); a number
  makes it checkable ("quickly, within 2 seconds").
- **T4 Pause:** her launch adds Q-8 to `interview.md`, sets it `paused`, returns `paused`: the run
  ends paused with "Q-8: An untestable requirement — What must the reviewer see for AC-FR-4.1 to
  pass?", no further launch, no Vera, no `tickets/`, her pause committed; `mirai show` says so. A
  new run is refused while Q-8 is open. After the answer and the commit, the next run's launch is
  `continue`. A pause her interview doesn't show ends the run `failed`. (The over-cap question's
  two choices are the model's wording: P1/P2 test it.)
- **T5 One ticket by hand:** `tickets` is on the session list with `one`
  (`checkCommand`, `argv` → `tickets log-format --one`); the `/mirai` command file's `ticket` step;
  the interview skill's "One ticket by hand" with its cap. **The cap:** an interview with
  `for: ticket` and a fourth question fails the lint (`interview-cap`, "at most 3 questions; this
  one has 4"). A fake run writes one lone story at `docs/mirai/tickets/SAMPLE-1.md` (no epic, no
  render): `index.json` mode `one`, the lone tickets' folder; lint, then **Vera on the lone ticket**
  with its interview as `upstream-interview.md`; `tess_run` mode `one`, `ticket SAMPLE-1`. It is
  **approved on its own** (33's ticket approval, now with the lint and Vera's result for a lone
  ticket that links its interview): "Vera: passed", the approval line carries her result. A lone
  ticket whose AC says "logging works properly" is refused at approval, naming the AC.
- **T6 `e2e` and journeys:** in 33's example set only SAMPLE-53 has `e2e: true`; a second one
  missing from "Decisions for you" fails the epic lint; Vera's must-fix on it goes to her next
  launch as `findings.md`, which resumes her kept session (step `fix`), and the fixed set is done. A
  new journey (`### J-3` under "## New critical journeys") not under "Decisions for you" fails
  (`epic-decision`); listed, approving the set shows it, adds it to `.mirai/context/journeys.md`
  before its Sources (linted as journeys.md first; a J-n already there is refused), and signs two
  lines in one step: the epic's and journeys.md's own (`kind: context`, `proposal` = the epic).
- **T7 Template gap and run record:** one gap she reports is one `template_gap` line (item, type,
  section, message); an untestable AC in her first draft goes to her next launch as `lint.json`
  (with its file); the record: done, `rounds {lint 1, verify 1}`, 2 launches, 1 gap, tier, model.
- **T8 The docs check** (34b, `test/docs/coverage.test.js`) passes: every new key
  (`tickets.key_prefix`, `tickets.types[].name|description|runs_as|template|checklist|tracker_type`)
  has its row in `docs/config.md`; `mirai tickets` and `/mirai tickets` are named;
  `docs/tickets.md` is new and listed in `docs/README.md`; `docs/agents.md` has Tess's row, her
  role and the session lines; `docs/documents.md` has the ticket step and "One ticket by hand".
- **T9 The run's pick:** A (`normal`, order 2, blocks two through a chain), B (order 1), C (order
  3), D (a `high` lone bug): A, D, B, C. With the chain done, nothing counts as blocked. The
  earliest approval breaks the last tie. A `high` ticket missing from "Decisions for you" fails the
  epic lint. The epic's table shows type, priority, order and blocks (the example re-rendered).
- **T10 Ticket types:** with Task (`change`), Bug (`bug`), Spike (`investigation`) and Tech Debt
  (`change`, own template): the config check refuses a type with no description, an unknown
  `runs_as` and two types with one name, each naming the problem; with none, the defaults apply; a
  Spike written as a story fails (`ticket-type`); an unknown type fails; the investigation example
  lints clean; starting an investigation is refused (`investigationRefusal`, wired into `mirai
  plan` and so `mirai run`). **Tech Debt's own template** (`.mirai/custom/ticket-types/tech-debt.toml`
  + `.md`, `base = "story"`): checked by 37's replacement rules, not used until approved; approved,
  a Tech Debt ticket lints with its section ("What stays the same") and still with 33's story
  checks and the testability lint; a template without "## Acceptance criteria" is refused, naming
  the protected section and its readers.
- **New build items:**
  - **Vera's 32-file cap:** an epic with 20 tickets (33's cap), the PRD, the checklist and three
    context files fits (`INPUT_LIMITS.files`); 35 tickets is refused, naming the split.
  - **Approving the PRD again shows what changed:** after a commit that changes one line, `mirai
    approve` prints "changed since your approval (seq n): 2 lines; the whole file: <path>" and the
    `-`/`+` lines (read from the commit holding the approved bytes). `changedLines` unit-tested.
  - **37's items:** the `files_likely` warning is one per file naming every ticket that shares it;
    an NFR cited in `covers_fr` counts for coverage; the story's and bug's templates (v2) carry
    `epic:`, `priority`, `order` and `ticket_type` as fields; the epic checklist's new lines.
  - **Her result is checked:** a lone ticket can't pause or return the epic; documents only on the
    local store; a document name outside `epic.md`, `interview.md`, `tickets/<KEY>.md` is refused.
- **Elsewhere:** `test/documents/verify.test.js` (40 T1: a story of an epic is refused with "check
  it with its epic", a plan still "isn't checked"; 40 T7: story and bug are Vera's types now);
  `test/agent/naming.test.js` (38b T8: no "Tess" hard-coded in `src/`).

**Tests changed by this unit** (each pin, and why):

- `test/cli/cli.test.js` T14: the command list gains `tickets`.
- `test/mcp/agents.test.js`: the launch-token minters gain `cli/commands/tickets.js`.
- `test/store/store.test.js` T10: the journal's event list gains `tess_run`.
- `test/lint/templates.test.js` T1: the document types gain `investigation`; `story@v1` → `@v2` in
  T3's status case (the template version bump).
- `test/lint/template-versions.json`: story 2, bug 2, epic 2, investigation 1 (each template
  changed: the new fields; the epic's "New critical journeys" and its table columns).
- `test/documents/brief.test.js` 31 T5: `investigation` has no summary (a ticket).
- `test/documents/epic.test.js`: 33 T1 (the template's sections now end with the optional "New
  critical journeys"), T2 and T3 (the ticket table's new Type, Priority, Order and Blocks columns),
  T3 (the grouped `files_likely` warning, 37's item 1); `story@v1` → `@v2`.
- `test/documents/overlays.test.js` 37 T7 and doctor's overlay line: Tess and her role.
- `test/documents/verify.test.js` 40 T1 and T7: a lone story/bug is Vera's (decision 2).
- `test/store/connector-contract.test.js` 38 T1: the stores hold `investigation`, so the "type no
  store holds" case moves to `holds[7]`.
- `test/adapters/claude-code.test.js` T1 and T5, `test/detect/detect.test.js` 17a T8: the bundle,
  the rendered files and the instruction files gain her rendered agent.
- `test/setup/setup.test.js` 39 T2: `custom add --as` names `mirai-ticket-planner` too.
- `test/agent/naming.test.js` 38b T8: "Tess" joins the persona names refused in `src/`.
- `registry/examples/`: the tickets and the example story and bug are `@v2` with `ticket_type`,
  `priority` and `order`; the example epic is `@v2`, re-rendered (the table's new columns), with
  "New critical journeys: Not applicable"; a new `investigation.md` example.

## Probes (real)

Not run: each is a real Claude launch on your subscription. `test/probes/tess-probes.js` holds them.
Each case works in its own probe home under your home folder (its own MIRAI store, its own kept
copy of your PATH's Claude Code, your token copied in), with the red-team gate stubbed green. The
PRD is the probes' **input**, not what they test: P1, P2 and P4's homes hold 33's example brief,
interview and PRD (due dates, for the sample app), with the PRD's own checks seeded (Vera's pass,
a reader test, no model), so your approval of it is the one step before her. A probe home has no
session server: the steps give the session the probe's own commands. Every probe uses `--probe
loop` (`test/probes/loop.js`): on a pause it prints her question and the message for your session,
waits for your confirmed interview, then (P2) runs Nora to bring the PRD in line, waits for your
approval of the PRD again, and starts Tess again.

**Checked with no model** (`node test/probes/tess-probes.js --check`, a stand-in token, a temp
folder): four lines, each "home built, branch probe-pN, tree clean, documents lint clean".

**Cost:** Tess's launches run on the `tickets` step's tier, standard (Sonnet). Vera checks each
version on her own tier, standard. A run with no fixes: 1 Tess launch, 1 Vera check; each fix round
adds 1 of each. P2's pause adds Nora's continue step (Opus, 1–3 launches with her checks) and a
second Tess run.

### Before the probes (once, in Terminal)

1. `cd ~/Projects/mirai && git fetch origin unit/42-build`
2. `git worktree add --detach ~/Projects/mirai-u42 origin/unit/42-build`
   You see `HEAD is now at <commit> Unit 42: …`.
3. `cd ~/Projects/mirai-u42 && node test/probes/tess-probes.js --check`
   You see four lines, each ending `tree clean, documents lint clean`.

### P1 A real PRD into tickets (1–3 Sonnet launches, as many Vera checks)

1. `cd ~/Projects/mirai-u42 && node test/probes/tess-probes.js --probe home --case p1`
   It prints the probe home's path and the steps with every path filled in. Keep the window open.
2. The printed approval command (`cd <repo> && HOME=<home> node … approve due-dates-prd --file
   docs/mirai/due-dates/prd.md`). You see the brief and the PRD, "one decision approves both",
   Vera passed, the reader test passed. Answer `a`, then type `due-dates-prd`.
3. The printed `--probe loop` command. You see one line per step (`Tess: write (round 1): ok`,
   `epic render: rendered from N ticket(s)`, `lint: …`, `Vera: round 1, N must-fix`), then her
   state, the epic's and each ticket's full path. Output goes to `~/mirai-u42-p1.txt`.
4. **Pass when** it ends "done" after at most one fixing round, every FR, NFR and AC is in the
   epic's Coverage table (nothing added or cut), `e2e: true` is only on a ticket that changes a
   critical journey in journeys.md (none in this PRD: J-1 log in and J-2 add a task and mark it
   done don't change), a proposed new journey, if any, is under "New critical journeys", and you'd
   approve the set (or your rejection names something the rules or Vera should have
   caught). Send me `~/mirai-u42-p1.txt`.
5. Delete the home (the printed `chmod -R u+w <home> && rm -rf <home>`).

### P1's run (Jet, 2026-11-24, home `~/.mirai-probes-QBKd53`, output `~/mirai-u42-p1.txt`): PASSED

- **One run, 2 Sonnet launches,** lint 0 fix rounds. Vera round 1: 1 must-fix (business.md's
  visibility rule against the team lead's access), which Tess put under "Decisions for you";
  round 2: 0 must-fix. Done.
- **The set:** 8 tickets, SAMPLE-2 to SAMPLE-9; all 30 PRD IDs covered, each exactly once.
- **`e2e`:** no ticket has `e2e: true`, which is right: neither J-1 (log in) nor J-2 (add a task and
  mark it done) changes in this PRD. (The probe's printed pass line said "only the reminder-email
  ticket has e2e: true", which was wrong for these journeys: fixed, below.)
- **Noted, not a must-fix:** SAMPLE-7 → 8 → 9 is a straight `after` chain where 8 and 9 may not need
  7; Vera didn't raise it, and it costs only parallelism.
- **PASSED** (Jet, 2026-11-24: "approve").

**Three findings from the run, fixed:**

1. **The pass line** (`tess-probes.js` and this file) now reads: `e2e: true` only on a ticket that
   changes a critical journey in journeys.md (none in this PRD); a proposed new journey, if any,
   under "New critical journeys".
2. **Claude Code's empty write staging** (`.claude/.cc-writes/`, seen at
   `docs/mirai/due-dates/tickets/.claude/.cc-writes`) was filtered in Kai's scope check only
   (`src/agent/build.js`), not in Tess's or Nora's after-launch checks; it passed only because Jet's
   global git ignore lists `**/.claude/.cc-writes/`. Kai's rule is now one helper,
   `src/agent/staging.js` (`isWriteStaging`: only empty, only that name directly in a `.claude`
   folder), used by Kai's check, and by Nora's and Tess's change checks, start checks and
   after-commit checks. Test `42 (P1's run)`: with `GIT_CONFIG_GLOBAL=/dev/null`, an empty staging
   folder beside her tickets leaves the run done; one with a file in it, or another file under
   `.claude/`, fails it, naming the file. (git's status never lists an empty folder, so the case
   that can reach her check is a non-empty one, which still fails; the helper keeps all three
   agents on one rule.) Not a cage file: `staging.js` is outside the cage, and `build.js`,
   `src/nora/run.js` and `src/tess/run.js` are too.
3. **The probe's file list** printed `tickets/.claude`: it now lists only `.md` documents.

### P2 A gap (Tess, then Nora's continue, then Tess again)

1. `--probe home --case p2`: the same PRD with AC-FR-4.1 made "reminders are sent reliably".
2. Approve the PRD (the printed command, as P1's step 2), then the printed `--probe loop`.
3. When it prints **PAUSED**: in a new Terminal window, `cd <repo> && claude`, paste the printed
   message, answer her question there and confirm the restatement. The loop then commits the
   interview, runs Nora (her `continue` step, Opus), and prints the PRD's approval command: run it.
   You see "changed since your approval (seq n): N lines" with only the changed lines; answer `a`.
   The loop sees the approval and starts Tess again.
4. **Pass when** her question names AC-FR-4.1 (its "reliably"), and the run after your answer and
   the PRD's update ends "done". Output: `~/mirai-u42-p2.txt`.

### P3 A technical ticket by hand (a session of yours, then 1 Sonnet launch and 1 Vera check)

1. `--probe home --case p3`, then the printed steps: a new Terminal window, `cd <repo> && claude`,
   paste the printed message (the `mirai-interview` skill's "One ticket by hand", for "the log
   format in GCP should change to the new structure"), answer at most 3 questions, confirm.
2. The printed `--probe loop`: you see `Tess: write (round 1): ok`, `lint: …`, `Vera: …`, then her
   state and the ticket's full path under `docs/mirai/tickets/`.
3. **Pass when** she (the session) asked at most 3 questions, the run ends "done", and the ticket's
   ACs describe the system and a reviewer could test each one. Output: `~/mirai-u42-p3.txt`.

### P4 Your work's types (1–3 Sonnet launches)

1. `--probe home --case p4`. Approve the PRD (the printed command).
2. Put your work's descriptions in: `open -e <repo>/.mirai/config.toml`, change each
   `[[tickets.types]]` description (Task, Bug, Investigation) to how your team uses them, save,
   then the printed `git add .mirai/config.toml && git commit -m "probe: our ticket types"`.
3. The printed `--probe loop`.
4. **Pass when** each ticket's `ticket_type` is the one you would have chosen, and the set lints
   clean (the run ends "done"). Output: `~/mirai-u42-p4.txt`.

## The red team

This unit touches the red team's cage (`cageOf`, computed on this branch): `registry/agents/
mirai-ticket-planner.toml` and `registry/roles/ticket-planner.toml` (cage data: every agent
definition and role), `registry/connectors/local.toml` and `repo.toml` (they hold
`investigation`), `src/adapters/claude-code.js` (cage root: the `/mirai` command file's `ticket`
step), `src/mcp/tools/commands.js` (cage root: the `tickets` session command and its `one` flag),
and code the cage reaches: `src/config/config-schema.js` (`[tickets]`), `src/config/overlays.js`
(ticket-type overlays), `src/config/registry.js` (the `run-pick` reader, the ticket check's
section), `src/lint/checks.js`, `epic.js`, `graph.js`, `interview.js`, `lint.js`, `testable.js`
(new), `src/tickets/types.js` (new), `src/store/connectors/common.js` and `contract.js`,
`src/store/journal.js` (`tess_run`). So each project's red-team pass goes stale once its framework
copy is refreshed with this unit: a `redteam-full` run is needed after the merge, before agents
launch there again. **No case changes:** Tess runs under the read-write template, exactly as Kai
and Nora (the same tools, the same headless `lint`, `m-server-direct`'s lint calls unchanged); her
role is `**` like theirs, with MIRAI's path check after each launch outside the launch; Vera's
launch is unchanged (a lone ticket is one more document type in her input folder). The interactive
settings' deny list gains `Agent(mirai-ticket-planner)` (13c's rule: every agent by name), which
the session red team's existing "start an agent as a subagent" case covers.

**After Jet's answers** (`e3f6774`), three cage files changed again: `src/mcp/tools/commands.js`
(the `ticket fix` session command), `src/adapters/claude-code.js` (the `/mirai` command file's
`ticket fix` step) and `src/store/journal.js` (`tess_run`'s `fix` mode). So `u42-baseline-2` and
`u42-redteam-2` run at the new head. No case changes: `mirai tickets fix` is one more run of Tess
under the same read-write template.

## Claude-only parts (Jet's standing rule, 2026-11-23)

Nothing in Tess's code path (`src/tess/`, `src/tickets/`, `src/cli/commands/tickets.js`,
`src/lint/testable.js`) names Claude Code. What is Claude Code's today, each behind an existing seam:

- **Structured output** and **the kept session** (her fix launches resume her session) come from
  MIRAI's launcher (`launchInRun`, 21a and 21c), as for Kai, Rex, Vera and Nora.
- **Her tool names** (`Read`, `Write`, `Edit`, …) are the registry's shared vocabulary, rendered per
  tool by the adapter (`registry/adapters/claude-code.toml`).
- **`io.claude`** in `mirai tickets` is the launcher's binary seam (`write.js` has the same line).
- **`/mirai ticket`** is a step of the `/mirai` command file, which is the Claude Code adapter's
  (`src/adapters/claude-code.js`); Cursor and Codex adapters render their own. The skills name
  MIRAI's own MCP tools (`mirai_command`, `mirai_status`), not Claude Code.
- **The probes** start a Claude Code session (`claude`) for the interviews: probe-level only.

## Changed from the spec

- **Scope 1 and 2 as the re-check** (Q1 "A"): `mirai tickets <initiative>` / `/mirai tickets`
  followed with `mirai_status`, not `start_agent`; MIRAI renders the epic (no `epic_render` broker
  tool) and runs the lint and Vera between her launches; her tools are the read-write template's,
  with the headless `lint`.
- **A lone ticket's interview lives in a folder of its own** (`docs/mirai/<name>/interview.md`,
  `for: ticket`), and `mirai tickets <name> --one` names that folder; the ticket goes to
  `docs/mirai/tickets/<KEY>.md` (38's `pathOf` for a ticket with no initiative), links its interview
  (`Interview:` under its title, `upstream: [<interview id>]`). The spec said `--one <id>`.
- **A ticket asked for by hand doesn't pause.** The cap is 3 questions for the whole interview, so
  a pause question would break it; her open points go in the ticket's Notes ("Open: …") and Vera's
  findings reach you at approval. See question 2.
- **The interview cap is a lint rule** (`interview-cap` on `for: ticket`), so "refused by the
  skill's cap" is checkable; the skill says so too.
- **Vera on a lone story or bug:** `verifier = true` on story and bug; `verifySubject` refuses a
  ticket of an epic ("checked with its epic"). Since Jet's answer 3: every lone story or bug needs
  her result at approval (a person's may be approved anyway after her first check); one that links
  its interview is linted there too.
- **New critical journeys live in the epic** (an optional section, "New critical journeys", in
  journeys.md's own form), not in a separate file: Vera reads them with the set, the epic's
  approval covers them, and approving the set writes journeys.md and signs its line (as 41's
  business-change approval does). The epic template is v2.
- **The PRD's re-approval** shows the changed lines and the whole file's full path; "the whole file
  on request" is that path (no extra prompt, so approval keeps its one question).
- **`[tickets] key_prefix`** is required: with no tracker yet (38's trackers come later) and no
  `mirai init` question, Tess refuses to start without it, with the line to add. See question 1.
- **The run's pick** is built as `runPick` (`src/tickets/pick.js`) and shown by `mirai show
  <initiative>` ("ready, in the run's pick order: …"); there is no build loop picking tickets yet
  (55's night run will call it).
- **Tier:** Tess on the `tickets` step's tier (standard). "One up for high risk or size L" applies
  to a ticket's launches (Kai's); her set has no risk or size before she writes it.
- **The investigation document type** has "Looked at", "Finding" and "Next steps" as optional
  sections ("Not applicable" until 42b's run writes them); "Question", "Acceptance criteria" and
  "Sources" are required.
- **A ticket type's own template:** `kind = "ticket-type-overlay"` in `.mirai/custom/ticket-types/`,
  approved as `overlay-<name>` through 37's path; `[[tickets.types]] template` names it.

## Jet's answers (2026-11-24)

**1: A,** as built. `[tickets] key_prefix` stays a required config line; the tracker fills it
later (38's connector). No change.

**2: A+.** As built (a ticket by hand doesn't pause; her open points go in its Notes), **plus** a
rule in `mirai-interview`'s "One ticket by hand": when, after reading the context and the code, the
session sees that three questions can't settle the request ("make logging better"), it says so up
front, before asking anything, and offers two ways on: (a) a small feature through `/mirai-new`
(a full interview, no cap) or (b) a sharper line from the owner. It never writes a ticket
interview from a guess. Test: `42 (Jet's answer 2, A+)` (the skill's text carries each part).

**3: B, plus A+.** Built:

- **Every story or bug with no epic needs Vera's result at approval**, whoever wrote it, with or
  without an interview (`loneTicketGate`, `src/cli/commands/approve.js`). One that links its
  interview is still linted as at approval too; one with no interview isn't linted there (as 33's
  ticket approval never was). A ticket of an epic stays checked and approved with its epic.
- **Approve anyway after the first check, for a person's own ticket.** The signal: **no `tess_run`
  line in the journal names the ticket** (`ticket: <KEY>`). The journal is the reliable one: only
  MIRAI writes `tess_run` (privileged, `by: script`), while an `Interview:` line or a frontmatter
  field is the file's own text, which anyone can add or remove. For a person's ticket, approval
  shows Vera's open must-fix findings right after her first check, says "this is your own ticket, so
  you may approve it anyway now", offers `mirai tickets fix <KEY>`, and takes `a`; the signed line
  carries her result's hash (`verifier`), as 40's approve-anyway after the last round does, so it
  names the findings approved over. Tess's tickets keep the rounds: refused with `verify-open` while
  rounds are left (`verifierFor`'s new `early` flag, `src/verify/gate.js`).
- **`mirai tickets fix <KEY>`** (in your session `/mirai ticket fix <KEY>`, session command
  `ticket fix`): Tess on an existing lone ticket (any author) with Vera's must-fix findings on it as
  it is now as `findings.md`; her prompt: change only what they name, never the ticket's scope or
  intent; then MIRAI lints it and Vera checks it again, with the normal rounds (a fix starts a cycle
  of its own: the ticket as she starts) and the 16-launch cap; the write scope is that one ticket
  file; no pause (leftovers in Notes); a `tess_run` line with `mode: fix` and the ticket's key as
  its item. Refused on a ticket of an epic (`ticket-of-epic`: fix it through the epic's set), on one
  with no result of Vera's for it as it is now (`no-verify`: `mirai verify <file>` first), and on
  one whose result has nothing to fix (`nothing-to-fix`). On the session list (21f, the `/mirai`
  command file), in `docs/tickets.md` ("A lone ticket fixed", "Approving a lone ticket") and
  `docs/agents.md`. Nothing in its code path names Claude Code.
- **Tests:** `42 (Jet's answer 3, B)` (a person's lone ticket with no interview and no result is
  refused naming `mirai verify`; after her first check with a must-fix open it is approved anyway,
  the line records her result; Tess's lone ticket with a must-fix open at round 2 of 3 is refused);
  `42 (Jet's answer 3): mirai tickets fix` (a fake run fixes one AC, Vera checks again at round 1 of
  the new cycle, done, the `tess_run` line, the session command); `… a write outside the ticket
  fails the run; refused for a ticket of an epic and for one with no result`.
- **Tests changed by this answer:** `test/agent/build.test.js`, `plan.test.js`, `review.test.js`,
  `tdd.test.js` and `test/proofs/fixture.js`: their `tty` helper records Vera's pass before an
  approval (`veraBefore`, 40's helper), since their lone ticket `PMT-31` now needs her result.

**4: A** (Jet, 2026-11-24, the builder's new question): Vera on every lone ticket; the lint at
approval only on a ticket that links its interview (Tess's). A person's own ticket approves after
Vera's check without the lint, as 33's always did; a lint failure has no "approve anyway", and old
hand-written tickets (such as the fixtures' `PMT-31`) miss template sections. Revisit at 44, once
`/mirai-new` covers the small cases.

## Questions for Jet (answered above)

1. **The ticket key prefix with no tracker.** The spec says `mirai init` asks once. Built: Tess
   refuses to start without `[tickets] key_prefix`, naming the line to add. Options: **A** keep it
   as built (one line in `.mirai/config.toml`, checked by the config check); **B** `mirai init`
   asks for it (and `mirai init --refresh` on an existing project), as the spec says; **C** default
   to the repo's name in capitals. Recommendation: **A** now, **B** with 38's tracker connector
   (the prefix then comes from the tracker's project key, and init asks only when there is none).
2. **A ticket by hand doesn't pause.** Options: **A** as built (her open points go in the ticket's
   Notes; Vera and you see them at approval); **B** she may pause, and the cap counts only the
   session's questions (a `asked_by` marker on her question). Recommendation: **A**: a ticket that
   needs more than three answers is a small initiative (`/mirai-new`, 44).
3. **Lone-ticket approval needs Vera only for a ticket that links its interview.** Options: **A**
   as built (33's tickets without an interview, written by you, approve as before); **B** every
   story or bug with no epic needs her result. Recommendation: **A**, so your own hand-written
   tickets keep their one-step approval.
4. **Lint every lone ticket at approval?** **A** Vera always, the lint only with an interview (as
   built); **B** lint every lone ticket. Recommendation: **A**, revisit at 44.

## For later units

- **55 (the night run):** takes the ready tickets in `runPick`'s order; `readyLines` already reads
  the store's states and approval times.
- **42b:** the investigation's run (the research launch, its finding into "Looked at", "Finding",
  "Next steps"); `investigationRefusal` is the one place to lift.
- **38's trackers:** `tracker_type` is stored and documented; nothing publishes it yet; the key
  prefix then comes from the tracker (question 1).
- **44:** `/mirai-new` sends a `quick` request to the one-ticket path (`mirai tickets <name> --one`).
- **46 (the inbox):** lists `tess_run` (paused, done, failed) and her `template_gap` lines.

## The full suite

**On the Mac** before the runner: `test/documents/tess.test.js` 21/21; the touched folders
(`lint`, `documents`, `config`, `cli`, `store`, `mcp`, `agent`, `adapters`, `docs`, `detect`,
`setup`) green after the pins above; `node test/probes/tess-probes.js --check`: four homes, each
clean. **The full suite on the Mac** (`caffeinate -i npm test` at `0f8c1fa`): **853/853 pass**, 0
skipped. After it: test results and PROGRESS only.

**Through the build runner** (a clean export each):
- `u42-tests-1` at `b2fdbb5`: **pass, 853/853**, 16.7 minutes; `u42-baseline-1` pass;
  `u42-redteam-1` **GREEN** (Claude Code 2.1.331).
- After Jet's answers, on the Mac at `e3f6774`: **857/857 pass**, 0 skipped
  (`test/documents/tess.test.js` 25/25). Queued at the new head: `u42-tests-2` (tests),
  `u42-baseline-2` and `u42-redteam-2` (redteam-full: three cage files changed, see "The red team").
