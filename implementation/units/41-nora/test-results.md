# Unit 41: test results (2026-11-23)

Built on `unit/41-build` from `origin/main` (d9b4a02: 38, 38b, 39 and 40 merged). The spec was
re-checked against 38, 38b, 39 and 40 first (the spec's last section). One finding changed how
Scope 2 was approved; Jet answered it (2026-11-23): **A1** (MIRAI runs the checks between Nora's
launches, in one run; D-53 and the cage stay as they are), **B1** (on the local store she returns
the documents and MIRAI writes them), **C1** (MIRAI commits her documents on your current branch,
never the integration branch). Dated notes are in 41's Scope 1, 2, 7 and T2, and in 44's Scope 1
and 3.

## Tests

All in `test/documents/nora.test.js` unless named. The fixture is an installed repo on a feature
branch (`docs-due-dates`) with 35's example interview, 36's example `business.md`, a committed key,
a stand-in token and an author in the personal file. No model runs: fake launchers stand in for
MIRAI's launcher (Nora's launches and Vera's) and for the reader. Nora's fake writes the documents
into the checkout as she would on the repo store, or returns them on the local store.

- **T1 The agent:** `mirai-product-manager` (Nora) is in the registry under her own role
  `product-manager` (read-write, step `prd`), persona `Nora`, the `prd` step's tier `deep`; she may
  run under her role and never under `developer`. Her prompt carries the one-document-per-launch
  loop, the lint/Vera/reader order and what each next launch gets (`lint.json`, `findings.md`,
  `reader.json`), the pause (`(open)`, `state: paused`), the template gaps, "never edit
  business.md", the `(REQ-23)` citation and the local store. Her schema is inlined for
  `--json-schema`. **A change outside the initiative's folder** (`src/sneaky.js` beside the brief)
  ends the run `failed`: nothing committed, the file left for you, no check run.
- **T2 The checks between her launches** (Jet's A1): one run writes the brief, then the PRD. Each
  launch has her agent, role, step, the initiative as item, round 1, her schema and her kept
  session (the PRD's launch resumes the brief's). Her inputs: the interview, the context files,
  the template and checklist as the project uses them, the `mirai-write` skill with the type's
  guide, and `index.json` (`initiative`, `store`, `folder`, `document`, `step`, `round`). After each
  launch MIRAI commits on your branch (author Test Author, committer MIRAI, `Mirai-Initiative:
  due-dates`), then the lint, then Vera with **her launch id as `verifies`** (the run log's rung,
  40's Q2), then the reader test on the PRD only (a standard brief is approved from the PRD's
  summary). The record: `nora_run` running then done, `rounds {lint 0, verify 2, reader 1}`, 2
  launches, tier `deep`, her model. **A problem goes to her next launch:** a broken heading gives
  `lint.json` (one lint round); Vera's must-fix gives `findings.md` (40's fenced hand-off, "Fix
  these, then run mirai verify … again"); she fixes, the checks run again, done. **Refused before
  she starts:** the integration branch (hint `git switch -c docs-due-dates`), a dirty tree (hint:
  commit the interview), an interview that isn't confirmed, no author; no `nora_run` is written.
  **The local store (B1):** she writes no file and returns the documents; MIRAI writes them through
  the store; nothing is committed. A file she writes in the checkout there ends the run `failed`;
  documents in her result on the repo store end it `failed` too.
- **T3 business.md at the interview:** `mirai-interview` gains "Read the business context before
  the first question": a contradiction (business.md "signed-in teams only", request "guests
  comment") is the first question, with "propose a change to business.md" as an option; the
  proposal's form and its approval command; your own list kept and only its gaps asked; and
  "Handing over to Nora" (commit, `/mirai write`, `mirai_status`, done or paused with paths). The
  question itself is the model's: P2 tests it.
- **T4 The proposal:** a well-formed `business-change.md` lints clean; one without `With:` fails.
  The brief beside an open proposal can't be approved (`proposal-open`). Rejected: one signed line,
  `business.md` unchanged, and the brief no longer waits. Approved: `business.md` becomes the
  proposal's text, and two lines are signed in one step: the proposal (`kind: business-change`,
  `files` = business.md's new hash) and business.md's own (`kind: context`, `proposal` = the
  proposal's path). A proposal whose `Replace:` text isn't in business.md as it is now is refused,
  nothing written.
- **T5 Pause:** her PRD launch adds Q-8 to `interview.md`, sets it `paused` and returns `paused`:
  the run ends `paused` with `Q-8: Comments by guests — May guests comment on a task?`, no further
  launch, no check of the paused PRD, her pause committed. A new run is refused while Q-8 is open
  (`interview-open`, "open: Q-8"). After the answer and the commit, a new run continues the PRD
  (`step: continue`), the brief's check reused. A pause her interview doesn't show ends the run
  `failed`.
- **T6 Template gap:** one gap in her result is one `template_gap` line (`by: script`, the
  initiative, the type, where it went, what didn't fit), counted in the run's record; `mirai show
  due-dates` lists it; the PRD template is unchanged.
- **T7 Telling you:** `mirai show due-dates` during her launch says "running (run r-…"; `mirai write`
  ends paused (exit 3) with the paused line, each document's full path and "next: answer the
  question in your session"; `mirai show` prints the same line (her name in full, the first time
  each output names her). Done and a run lost without its end line are worded from the journal.
  With A1 your session follows her with `mirai_status` on the `/mirai write` request, whose output
  ends with these lines; `agent_status` isn't used for her.
- **T8 The docs check and the session list:** `/mirai write` (`tty`, `run`: an agent run with the
  run's time limit) and `/mirai requirements` (quick) are on the session list; `docs/agents.md`
  has Nora's row and her role, `docs/documents.md` has the two new types and "From request to
  approval"; 34b's check (`test/docs/`) passes.
- **T9 Your own list:** `requirementLines` keeps each line word for word (list markers, headings and
  blanks off); `mirai requirements due-dates` numbers a pasted `requirements.md` in place (REQ-1 to
  REQ-3, `source: "pasted in the interview, <date>"`). The PRD's lint with the list beside it: clean
  when every line is carried (an FR's `(BR-1) (REQ-1)`) or left out under "Not in this" with its
  reason; `(REQ-9)` fails (`prd-requirement-undefined`) and leaves REQ-3 uncovered
  (`prd-requirement-uncovered`); a "Not in this" line without its `(REQ-2)` fails. **Vera's fourth
  input** is `upstream-requirements.md`; a finding against it graded suggestion (a line changed, a
  line missing) is recorded must-fix on the `checklist` layer (`graded_by: a line of the owner's
  requirements list`); one about REQ-2, left out on purpose, is dropped ("left out on purpose under
  "Not in this", with a reason").

**Tests changed by this unit** (each pin, and why): the journal's event list (`nora_run`); the CLI command list (`requirements`,
`write`); the launch-token minters (`cli/commands/write.js`); the document types (31's and 37's
lists: `business-change`, `requirements`, which have no summary); the agents and roles in 37's T7
and doctor's overlay line; the bundle file list (her rendered agent) and 17a's instruction-file pin;
38b's T8 now refuses "Nora" hard-coded in `src/` too; `custom add`'s `--as` hint.

## Probes (real)

Not run: each is a real Claude launch on your subscription. `test/probes/nora-probes.js` holds
them. Each case works in its own probe home under your home folder (its own MIRAI store, its own
kept copy of your PATH's Claude Code, your token copied in), with the red-team gate stubbed green.
A probe home has no session server, so the session there has no `/mirai`: the steps give it the
probe's own commands with `HOME` set to the probe's home (40's P3 finding), and the probe script
commits what the session left before it starts Nora (every launch needs a clean tree). Your
session's `/mirai write` → `mirai_status` path is T7's; the probes start her from your Terminal.

**Checked with no model** (`node test/probes/nora-probes.js --check`, a stand-in token, a temp
folder): each case's home builds, sits on its feature branch with a clean tree, and its context
files lint clean.

**Cost:** Nora's launches run on the `prd` step's tier, deep (Opus). Vera checks each version on
the `verify` step's own tier, standard (Sonnet: Jet's answer 1, "B"). The reader test is one Sonnet
run. A run with no fixes: 2 Nora
launches, 2 Vera checks, 1 reader test; each fix round adds 1 Nora launch and 1 Vera check.

### Before the probes (once, in Terminal)

1. `cd ~/Projects/mirai && git fetch origin unit/41-build`
2. `git worktree add --detach ~/Projects/mirai-u41 origin/unit/41-build`
   You see `HEAD is now at <commit> Unit 41: …`.
3. `cd ~/Projects/mirai-u41 && node test/probes/nora-probes.js --check`
   You see four lines, each ending `tree clean, context lints clean`.

### P1 From request to approval (a session of yours, then about 2–6 Opus launches, as many Vera checks, 1 reader test)

**The rerun (after A2):** first bring the probe worktree to this unit's head, in Terminal:
`cd ~/Projects/mirai-u41 && git fetch origin unit/41-build && git checkout --detach origin/unit/41-build`
(you see `HEAD is now at <commit> Unit 41: …`), then `node test/probes/nora-probes.js --check`
(four lines, each ending `tree clean, context lints clean`). Then the steps below, in a **fresh**
home (step 1 makes one; the old `~/.mirai-probes-JVHqLr` is kept for the record).

1. `cd ~/Projects/mirai-u41 && node test/probes/nora-probes.js --probe home --case p1`
   It prints the probe home's path and steps 1–5 with every path filled in. Keep that window open.
2. Follow the printed steps: a new Terminal window, `cd <its repo> && claude`, paste the printed
   message, answer the interview until you confirm the restatement.
3. Back in the first window, the printed `--probe write` command. You see one line per step, then
   Nora's state and each document's full path. Output goes to `~/mirai-u41-p1.txt`.
4. **Pass when** it ends "done", and you'd approve the brief and the PRD (or your rejection note
   names something the templates or Vera should have caught). Send me `~/mirai-u41-p1.txt`.
5. Delete the home: `chmod -R u+w <home> && rm -rf <home>` (the printed line).

### P2 Contradiction at the interview (a session of yours only; no Nora run)

1. `cd ~/Projects/mirai-u41 && node test/probes/nora-probes.js --probe home --case p2`, then the
   printed steps 1–3. The request (a shared link for guests) contradicts the home's business.md.
2. **Pass when** the session's first question names that contradiction and offers "propose a change
   to business.md"; choosing it produces `business-change.md`, and the printed approval command
   shows the change and applies it (you may answer r instead: business.md stays as it was).
3. Delete the home (the printed line).

### P2's run (Jet, 2026-11-23, home `~/.mirai-probes-632gIR`): PASSED, two findings fixed

The session's first question named the contradiction with business.md, quoting both sides, and
offered A "propose a change to business.md". It wrote `business-change.md`; the approval command
showed the change and Vera's "not run" line; Jet answered a, and it was applied and approved (seq 1
and 2). Two findings:

1. **The approval command came before business.md, as the change makes it, was checked.** The first
   `mirai approve --file …/business-change.md` was refused with 2 lint problems in the result (a
   44-word sentence, S-2's "Where" without backticks); nothing was written, so the gate held.
   **Fixed:** `mirai lint` on a proposal now applies it to `.mirai/context/business.md` and lints
   the result with business.md's own rules (`business-change-result`, "business.md as these changes
   make it, line N: …"; a `Replace:` text no longer there is `business-change-stale`), without the
   checks against the code, which approval still runs. A proposal the lint can't place beside the
   repo's business.md (a text lint, the local store) is left to approval. The interview skill now
   lints the proposal before handing over the command. T4 has the case (a 44-word "With:" fails
   `mirai lint`).
2. **The restatement and the proposal disagreed** (the restatement let the client see the whole
   task and every comment; the first proposal only let them comment). Jet had the session fix it.
   **Fixed:** the skill says the proposal covers everything the restatement says the change allows.
   T3 checks the line.

P1, P3 and P4 are still to run.

### P1's run (Jet, 2026-11-23, home `~/.mirai-probes-JVHqLr`, output `~/mirai-u41-p1.txt`): not passed yet

Request: team leads pin up to three tasks to the top of their team's list. Three runs, 13 Opus
launches in all, about 6 of them only lint fixes:

- **Run 1:** the brief: lint 15 → 1 → clean, then Vera 3 must-fix; Nora fixed them and **paused on
  Q-9** (a reopened task's pin). The pause worked as designed.
- **Run 2:** the brief: lint 1 → 1 → clean, Vera 0 must-fix (passed). The PRD: lint clean, Vera 2
  must-fix; Nora fixed them and **paused on Q-10** (what the app keeps once a pin ends). As designed.
- **Run 3:** the brief reused (unchanged). The PRD: lint 15 → 2 → clean, Vera 1 must-fix; Nora fixed
  it, the lint found 1 problem (a 27-word sentence), and the run **stopped**: "the lint still finds
  1 problem in the prd after 2 fixes".

Two causes, both fixed (Jet's decisions, 2026-11-23):

1. **Format slips cost a launch each.** Q1 is revised to **A2**: Nora's launch has MIRAI's `lint`
   tool on its headless server, the same lint MIRAI runs, so she lints her draft before her launch
   ends. Vera and the reader test still run only from MIRAI between her launches (D-53 stands).
2. **A bug: `LINT_FIX_ROUNDS` was spent across the whole run.** Run 3's two lint fixes went on her
   continue launch's draft, so the fix of Vera's finding had none left. The two lint fixes now
   restart for each draft: after her write and after each fix of Vera's or the reader's findings.
   A run still stops at 16 launches.

P1 reruns in a fresh home (steps below). P3 and P4 are still to run.

### A2: her own lint (Jet, 2026-11-23, after P1)

- **The tool:** `lint` on the headless server of every read-write launch (the template's
  `mcp.lint: true`; read-only templates have none: a read-only agent writes no document). Kai's
  launches get it too; his prompt doesn't use it.
- **What it reads, and why that's safe:** the server runs outside the sandbox, so in an agent run it
  takes only Markdown files under the docs root (`[docs] root`, from the trust root), named one by
  one: no folder, no whole-project lint, no part starting with "." (a `.env*` file is read-denied to
  agents), no link anywhere along the path, nothing outside. That is a subset of what her launch may
  read and write. It reads the trust root's rules and the project's approved overlays (from the
  store, as `log_event`'s policy names it) and returns the problems only; it writes nothing. A
  linked file the lint follows (the brief's interview, the PRD's brief) is read only inside the repo,
  through no link (07b's rules, unchanged).
- **The local store:** her documents aren't files there, so the tool has nothing to lint; MIRAI's lint
  between her launches is the one check, as before.
- **Tests:** `41 A2` (`nora.test.js`): the read-write template offers it, the read-only one doesn't;
  the policy's tool; the headless description; `headlessRefusal` refuses no path, `.env`,
  `docs/mirai/due-dates/.env.md`, `README.md`, a folder, a link and a missing file, and accepts the
  brief. `41 (P1's run)`: write, two lint fixes, Vera's must-fix, her fix broken again, one more lint
  fix, done (`rounds.lint: 3`; the old code stopped at the third). Pins updated: 13c's and 14d's
  allow lists, 13c's init check, 15a's tool table, 15a T7's policy, 15b's "never has" list.
- **A red-team case:** yes, an extension of an existing one. `m-server-direct` (MIRAI's server with no
  model, forged and hostile calls) now sends seven `lint` calls when the launch's policy offers it
  (none, `.env`, a dot file under the docs root, `README.md`, a folder, `../outside.md`,
  `/etc/passwd`); each must be refused. It runs in `redteam-full` on the read-write template.

### P1's rerun (Jet, 2026-11-24, home `~/.mirai-probes-w4FvBO`, output `~/mirai-u41-p1.txt`): PASSED

At `8876d31` (with 40a). Three `--probe write` runs, 8 Opus launches in all (13 last time), **lint 0
fix rounds throughout** (A2 holds: each draft came back clean):

- **Run 1:** the brief: lint clean, Vera 1 must-fix; her fix **paused on Q-9** (a new lead's pins).
  Your session resumed the interview at Q-9 (and Q-10, a reopened task's pin; it noted the app
  can't reopen a done task today).
- **Run 2:** the brief: Vera 2 must-fix, fixed, then 0 (passed). The PRD: lint clean, Vera 3
  must-fix; her fix **paused on Q-11** (a removed lead's pin records, under GDPR). Answered: "removed
  user".
- **Run 3:** the brief reused. The PRD: Vera 1, fixed, 1 more on her last round (round 3 of 3: NFR-3's
  UNKNOWN limit missing from the summary); the reader test passed; **done**.
- **Content:** every answer is in: the teams initiative first (NG-1, BR-6, A-5), Q-9, Q-10 with no
  claim that tasks reopen, Q-11 as FR-10.
- **A finding, fixed (Jet's "A"):** her "done" line read like a clean pass with Vera's must-fix still
  open after the last round. The run's record now keeps `open` (per document: Vera's count, a reader
  test not passed), and the line reads "done, with 1 must-fix finding from Vera (mirai-verifier) on
  the PRD open after the last round: … ready for your approval, which shows each one". `nora_run`'s
  journal form takes `open` (only on a done run). Test `41 (P1's rerun, Jet's "A")`.
  `src/store/journal.js` is a cage file: the sample app's red team runs again.
- **Noted, not changed:** an end record the journal refuses is dropped without a word (the run's
  outcome stands); a later unit may want it logged.
- **PASSED** (Jet, 2026-11-24: "approve": Jet would approve the brief and the PRD as they are, with Vera's one open finding).

### P3 Contradiction while writing (a session of yours, 2 Nora runs)

1. `--probe home --case p3`, then the printed steps. The request (delete a task for good) breaks a
   conventions rule of the home (nothing is deleted, only marked removed), which shows only in the
   PRD's detail.
2. **Pass when** the first `--probe write` ends "paused" with her question in `interview.md`, your
   session resumes the interview at it, and after your answer the second `--probe write` ends "done".

### P4 Your own list (a session of yours, 1 Nora run, then 1 Vera run)

1. `--probe home --case p4`, then the printed steps: the session first keeps
   `requirements-source.md` (24 lines) as `requirements.md` with the printed command.
2. After `--probe write` ends "done": `node test/probes/nora-probes.js --yes --probe drop --home <home> --line REQ-12`
   (it takes `(REQ-12)` out of the PRD, commits, and shows the lint's answer and Vera's).
3. **Pass when** the interview asked only about gaps and contradictions, every REQ-n was cited in
   the PRD after her run, and the drop prints "REQ-12 raised as a must-fix". (The lint also fails
   the dropped line, `prd-requirement-uncovered`: MIRAI catches it before Vera does.)

## The red team

This unit touches the red team's cage (`cageOf`, computed on this branch): `registry/agents/
mirai-product-manager.toml` and `registry/roles/product-manager.toml` (cage data: every agent
definition and role), `src/mcp/tools/commands.js` and `src/mcp/tools/lint.js` (cage root
`src/mcp/**`; the headless lint, A2), `src/launch/strict.js` (cage root: the read-write template's
`mcp.lint`, its policy and allow rule), `src/redteam/cases-agent.js` (cage root: `m-server-direct`'s
lint calls), and code the cage reaches: `src/agent/run.js` (a cage root: `ownTier`, Jet's answer 1), `src/config/registry.js` (two lint checks named), `src/lint/checks.js`, `src/lint/prd.js`,
`src/lint/requirements.js` (new), `src/store/connectors/common.js` (two default file names) and
`src/store/journal.js` (`nora_run`, the business-change approval). So each project's red-team pass
goes stale once its framework copy is refreshed with this unit: a `redteam-full` run is needed
after the merge, before agents launch there again. The read-write template changes (its tools gain `mcp__mirai__lint`), so its red-team result is new
work, not only stale; `m-server-direct` gains the lint calls above. No other case changes: Nora runs
under the read-write template (as Kai does), and Vera and the reader test never run from a server.

## Claude-only parts (Jet's standing rule, 2026-11-23)

Nothing in Nora's code path (`src/nora/`, `src/cli/commands/write.js`, `requirements.js`) names
Claude Code. What is Claude Code's today, each behind an existing seam:

- **Structured output** (`--json-schema`) and **the kept session** (`--resume`) come from MIRAI's
  launcher (`launchInRun`, 21a and 21c), as for Kai, Rex and Vera.
- **Her tool names** (`Read`, `Write`, `Edit`, …) are the registry's shared vocabulary, rendered per
  tool by the adapter (`registry/adapters/claude-code.toml`).
- **The reader test** starts `claude` itself (34's, unchanged).
- **The skills** name MIRAI's own MCP tools (`mirai_command`, `mirai_status`) and say "your tool
  asks the owner to allow it", not Claude Code.
- **The probes** start a Claude Code session (`claude`) for the interview: probe-level only.

## Changed from the spec

- **Scope 2, T2, Scope 7** as Jet's A1, B1, C1 (dated notes in the spec). `start_agent` takes a role,
  not an agent, and her run is several launches, so the session starts her with `/mirai write
  <initiative>` (`mirai write` in a terminal) and follows it with `mirai_status`.
- **`REQ-n`, not `R-n`:** a brief's and a PRD's `R-n` are their risks. An FR may end
  `(BR-1) (REQ-1)`.
- **`requirements` and `business-change` are document types** (template, checklist, lint check,
  protected sections, template versions), so `mirai lint` and approval read them as documents.
- **The lint also catches a lost line** (`prd-requirement-uncovered`): every REQ-n must be cited by
  an FR or NFR (or their ACs) or left out under "Not in this" / "Non-goals" with a reason. Vera
  judges whether a citing requirement keeps the meaning and the numbers, and MIRAI holds her finding
  against the list to must-fix.
- **Her tools are the read-write template's** (`Bash` included): the registry holds every agent to
  its template's tools, and a narrower template is a new cage. Her prompt uses the file tools;
  `mirai` from Bash is denied in every launch (D-30).
- **The pause question comes back through `interview.md`**, checked by MIRAI: a `paused` result whose
  interview isn't `paused` with that question open ends the run `failed`.
- **The business-change approval doesn't run Vera on business.md:** every changed line is the
  proposal's text, which you read line by line at that approval; the screen says so. See question 2.
- **Two lint fixes per draft** (`LINT_FIX_ROUNDS = 2`, in the code; per draft since P1's run, it had
  been per run), before Vera; a run stops after 16 launches whatever the settings.
- **A2 (Jet, after P1):** a headless `lint` tool on every read-write launch's server.
- **`mirai requirements <initiative> [--from <file>]`** is new: it numbers your list (Scope 9's
  "each line gets an ID").

## Jet's answers (2026-11-23)

**1: B.** Vera checks Nora's documents on the `verify` step's own tier, standard, as chosen in 40's
P1, and isn't raised to Nora's deep tier. Built: `launchInRun` takes `ownTier` (with `verifies`),
which keeps the step's tier and still runs the ladder's rung label; `runVerify` passes it whenever it
has the author's launch. **The rung label:** D-14's rungs say how independent the checker is from the
author. Rung 2 is "a different model"; rung 3 is "the same model in a fresh context". Nora runs on
Opus and Vera on Sonnet, so the run log says rung 2: honest, even though Vera's tier is below the
author's. Any other `--verifies` check (`mirai agent run --verifies`) still rises to the author's tier.
Tests: `test/agent/scope.test.js` ("41: a verifier with ownTier …": a deep author, then a verifier
with `ownTier` on standard at rung 2, and one without on deep); T2 asserts Vera's launches carry
`ownTier`. Dated note in the spec's last section.

**2: A,** as built.

## Questions for Jet (answered above)

1. **Vera's tier on Nora's documents.** With Nora's launch as the author's (40's Q2), the verifier
   ladder (D-14) runs Vera at least at the author's tier: Nora is deep (Opus), so Vera runs on Opus
   (rung 3, same model in a fresh context), not on 40's chosen default, standard. 40's P1 found Opus
   noisier on clean documents (14 must-fix vs 6). Options: **A** keep the ladder (built: D-14 as
   written; costlier, more must-fix findings, more rounds); **B** for document checks, log the rung
   against the author but keep Vera on the `verify` step's tier (a ladder exception for documents);
   **C** set `[models.alternates] deep` so rung 2 picks another model. Recommendation: **B**: your P1
   decision was made on exactly this trade-off, and the rung is still logged honestly as "below the
   author's tier". It's a change to `pickVerifier`'s use in `launchInRun` (cage code): a small,
   separate commit with its red team.
2. **No Vera on a business.md changed through a proposal.** Options: **A** as built: the proposal's
   lines are yours, shown at approval; **B** run Vera on business.md as it would become before the
   approval (one more run, and she may object to your own words). Recommendation: **A**.

## For later units

- **44:** `src/docs/route.js` splits the hand-off Nora's next launch gets (`fixFrom` in
  `src/nora/run.js`, the `findings.md` input), not a tool's reply. The incremental re-check (40's P3)
  fits there too: `checks()` calls `runVerify` once per version. The rounds-out step and the
  decision questions go through the same pause (`pausedEnd`).
- **46:** the inbox lists `nora_run` (paused, done, failed) and `template_gap` lines.

## The full suite

**Through the build runner** (a clean export each):
- `u41-tests-1` at `f75aaba`: 819/820; the one failure was 05a's T10 pin of the journal's event list
  (`nora_run` is new). Pin updated (`test/store/store.test.js`).
- `u41-tests-2` at `3a71d60`: **pass, 820/820**, 15.3 minutes.
- `u41-tests-3` at `73adc73` (Jet's answer 1, `ownTier`): **pass, 821/821**, 16.6 minutes.
- `u41-tests-4` at `ed34354` (P2's findings): **pass, 821/821**, 16 minutes.
- `u41-tests-5` at `e77b52e` (A2 and the lint-fix bug, after P1): **pass, 823/823**, 15.5 minutes.

**On the Mac** before them: `test/documents` (with `nora.test.js`, 15), `lint`, `mcp`, `cli`,
`adapters`, `docs`, `agent`, `setup`, `detect`, `store`, `findings`, `config`: 457/458 (the same pin);
`node test/probes/nora-probes.js --check`: four homes, each clean.
