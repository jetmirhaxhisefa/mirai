---
unit: "41"
name: nora
status: approved (Jet, 2026-11-20: "add it. approve 41"; decisions 1–6 from his interview the same day; built only after 40 is finished, and re-checked against 36–40 first)
roadmap: design/07-implementation-roadmap.md, row 41; D-41 (strict templates, the template-gap signal), D-43 (business context kept current), D-14 (PRD writing on deep); units 19a–19c (launch, roles, broker and `start_agent`), 31–35 (types, skills), 36 (business.md), 38 (store, links), 40 (Vera)
depends_on: ["19c", "31", "32", "34", "35", "36", "38", "40"]
---

# Unit 41: Nora, the product manager agent

## Why

The brief and PRD types, the writing skill, the interview, the reader test and Vera all exist
(31–35, 40). There's still no agent that puts them together: today a person or a generic session
writes the documents by hand. Nora is that agent. She turns your feature request into a brief
and a PRD that are ready for your approval, and your time goes only into answering her questions
and approving.

**Why now:** the `mirai-prd` workflow (44) chains Nora's steps, and Tess (42) starts from her
approved PRD.

## Decisions (Jet, 2026-11-20, interview)

1. **Split** (Q1, "B"). The interview runs in your session (35's skill). Then Nora runs as a
   background agent in MIRAI's sandbox, on the deep tier (`[models.steps] prd`, D-14; never
   downgraded). She writes the brief, then the PRD (34's skill), and works through the lint,
   Vera's rounds (40) and the reader test (34). You're called back only to approve.
2. **Contradictions with `business.md`, in two places** (Q2, "C"):
   - **at the interview:** the session reads `business.md` and turns a contradiction into a
     question then and there;
   - **while writing:** a contradiction Nora only notices in the background pauses her. Her
     question is written into `interview.md` (35's pause), and it comes back to your session.
   
   `business.md` changes only through a proposal you approve on its own (D-43). Nora never edits
   it.
3. **Template gaps as D-41 says** (Q3, "A"). The content goes into the closest existing section
   (Risks, an open question), and a `template_gap` event is logged for the inbox and the run
   report. She never adds a section, and one gap never changes a template.
4. **Telling you in two places** (Q4, "C"). The session that started her tells you when she's
   done ("the PRD is ready to approve") or paused (her question), with the file's path and link.
   The inbox lists it too (unit 46). Until then, `mirai show <initiative>` shows her state.
5. **Brief and PRD only.** The epic and tickets are Tess's (42).
6. **Your own requirements list is kept, and every line is covered** (Jet, "add it"). When you
   give a list of requirements (pasted, or a file), it's kept as a source of the initiative. The
   interview asks only what the list leaves open or contradicts. Nora writes every line into the
   PRD, tracing each requirement to its line. Vera checks that no line is lost or changed: a
   missing or weakened line is a must-fix ("line 23, '1 day before', isn't in any FR").

## Scope

**In**

1. **The agent: `registry/agents/mirai-product-manager.toml` + `.md`** (Nora), under a role of
   her own: `registry/roles/product-manager.toml` (read-write, step `prd`).
   - **Writes** only inside the initiative's folder (the store's `pathOf`, 38): after the run, her
     changes are checked against that folder.
   - **Reads** the context files, the interview, and the request's sources.
   - **Tools:** `Read`, `Glob`, `Grep`, `Write` and `Edit`, within that write scope.
   - **Gets** 34's `mirai-write` skill.
   
   Her prompt gives her steps:
   1. read the interview;
   2. write the brief;
   3. write the PRD;
   4. after each draft, run MIRAI's checks through the broker (lint, `verify`, `reader-test`);
   5. fix the must-fix findings within the rounds set in `[docs]`;
   6. stop.

   *(changed: Jet, 2026-11-23, 41 re-check, Q1 "A1"):* she doesn't run the checks herself. MIRAI
   runs them between her launches, in one MIRAI run ("Nora's run", one run lock): after each of
   her launches MIRAI checks her changes against the initiative's folder, commits them (Q3), runs
   the lint, Vera (`runVerify` with her launch as `authorLaunch`) and the reader test, and gives the
   results to her next launch (her kept session, with Vera's hand-off), within the `[docs]` rounds.
   *(changed: Jet, 2026-11-23, 41 re-check, Q2 "B1"):* on the repo store she writes the files
   herself; on the local store (MIRAI's store, which no agent may open) she returns each document as
   structured output and MIRAI writes it through the store's `write`.
2. **The checks as broker tools** (19c's tool table): `lint(file)`, `verify(file)` (40) and
   `reader_test(file)` (34), so Nora runs them from the sandbox without a shell. Each returns the
   result as data, its findings fenced.

   *(changed: Jet, 2026-11-23, 41 re-check, Q1 "A1"):* not built. A `verify` or `reader_test` tool on
   Nora's headless server would be an agent starting an agent (D-53's recursion guard), and can't
   hold the run lock, commit under her launch or mint a launch token. The checks run between her
   launches (Scope 1's note); D-53 and the cage stay as they are. Each check's result still reaches
   her as data, Vera's findings fenced (40's `handoffText`).
3. **`business.md` at the interview:** 35's skill gains a step: before the first question, read
   `business.md` (and the journeys). Any contradiction with the request becomes the first
   question, with "propose a change to business.md" as one option.
4. **`business.md` proposals:** `docs/mirai/<initiative>/business-change.md`:
   - **what it holds:** the lines to change, the new text with its source ("you said, <date>"),
     and why;
   - **how it's applied:** `mirai approve --file …/business-change.md` applies it to
     `business.md` and signs both. A rejected proposal leaves `business.md` as it was;
   - **the gate:** the brief can't be approved while a proposal it depends on is open.
5. **Pausing while writing** (decision 2):
   - when Nora meets a contradiction or a question only you can answer, she appends it to
     `interview.md` as a new open question (with options and a guess), sets `state: paused`,
     and stops;
   - the run is recorded as paused, with the question;
   - after you answer (in a session resuming the interview), a new Nora run continues from the
     documents as they are;
   - *(changed by 44's interview, Jet 2026-11-22):* the pause also carries Vera's `decision`
     findings, asked at once and using no round. Nora never answers a decision herself: she
     writes 36's `(open)` with the question (`Tax rules apply for (open) — EU only, or EU and
     US? Asked in interview.md Q-7.`), and approval refuses it. See 44's decisions 3–6.
6. **Template gaps:** her output schema has a `template_gaps` list (`type`, `what didn't fit`,
   `where it went`). MIRAI writes each one as a `template_gap` journal event. `mirai show
   <initiative>` lists them.
7. **Starting and telling you:**
   - when the interview is confirmed, the session starts Nora with 19c's `start_agent`
     (`agent: mirai-product-manager`, the initiative);
   - the session checks on her with `agent_status`, and when she's done or paused, it says so
     with the path and link (38);
   - `mirai show <initiative>` shows Nora's state (running, paused with her question, done) and
     the documents' states;
   - the journal records each step, for the inbox (46).

   *(changed: Jet, 2026-11-23, 41 re-check):* `start_agent` takes a role, not an agent, and Nora's
   run is several launches; so the session starts her with `/mirai write <initiative>` (39's
   session list; `mirai write <initiative>` in a terminal) and follows it with `mirai_status`.
   *(Q3 "C1"):* before each check MIRAI commits her documents on your current branch, as a MIRAI
   commit (you as author, MIRAI as committer, the trailer `Mirai-Initiative: <initiative>`), and
   refuses to start on the integration branch. The session commits `interview.md` (and
   `requirements.md`) first: every launch needs a clean tree.
8. **The run record:** each Nora run logs its tier, model, rounds used per check, template gaps
   and outcome (done, paused, failed), as other agents' runs do.
9. **Requirements sources** (decision 6):
   - **kept:** a pasted list is saved as `docs/mirai/<initiative>/requirements.md`, and a file is
     linked as it is. Each line gets an ID (`R-1`, `R-2`, …) so it can be cited. The brief lists it
     under its sources;
   - **the interview** reads it first and asks only about gaps and contradictions between lines;
   - **traced:** each PRD requirement that comes from a line cites it (`(R-23)`), and the lint
     fails an `R-n` the source doesn't define;
   - **Vera's coverage check:** Vera (40) gains a fourth input, the requirements source. Every
     `R-n` must be cited by an FR, NFR or AC that keeps its meaning and its numbers. A line no
     requirement cites, or one cited with a number or condition changed, is a must-fix on the
     `checklist` layer. A line you dropped on purpose is listed under "Not in this" with the
     reason, and isn't a finding.
10. **Docs:** `docs/agents.md` lists Nora. `docs/documents.md` gains "From request to approval",
   with the steps in order. Any new key goes in `docs/config.md` (34b's check).

**Out**

- The epic and tickets (Tess, 42).
- The `mirai-prd` workflow and `/mirai-new` (44).
- The inbox screen (46).
- Nora editing `business.md`; template changes from a gap.

## Tests

- **T1 The agent:** Nora's definition validates under her own role `product-manager`
  (read-write, step `prd`). After the run, a write outside the initiative's `pathOf` folder is
  refused (fake launcher). She has the
  `mirai-write` skill.
- **T2 The checks between her launches** *(changed: Jet, 2026-11-23, 41 re-check, Q1 "A1"; was
  "Broker tools")*: in one run (fake launchers), MIRAI commits her draft, runs the lint, Vera with
  her launch as the author's and the reader test, and her next launch gets the lint problems or
  Vera's must-fix findings fenced; a run on the integration branch, or with a dirty tree, is
  refused before she starts. On the local store her structured output is written through the
  store.
- ~~T2 Broker tools~~ (replaced above).
- **T3 `business.md` at the interview:** with a seeded contradiction (business.md "signed-in
  teams only", request "guests comment"), the skill's first question names it and offers "propose
  a change".
- **T4 Proposal:** approving `business-change.md` applies it and signs both files. Rejecting it
  leaves `business.md` unchanged. A brief that depends on an open proposal can't be approved.
- **T5 Pause:** a fake Nora run that meets a contradiction appends an open question to
  `interview.md`, sets `paused`, records the run as paused, and writes no further documents. A
  new run after the answer continues.
- **T6 Template gap:** a fake Nora output with one gap writes one `template_gap` event, and
  `mirai show` lists it. The template is unchanged.
- **T7 Telling you:** `mirai show <initiative>` shows running, paused (with the question) and
  done. `agent_status` returns the same.
- **T8 The docs check** (34b) passes.
- **T9 Requirements source:** a pasted list becomes `requirements.md` with `R-1`…`R-n`. A PRD
  citing an undefined `R-n` fails the lint. A fake Vera result on a PRD missing `R-23` and one
  that changed "1 day" to "before" each give a must-fix. A line listed under "Not in this" with
  a reason gives none.

## Probes (real)

- **P1 From request to approval:** on the sample app, you give a small real request in your
  session. The interview runs, Nora is started, and she writes in the background. **Pass when:**
  - the brief and the lite PRD lint clean, pass Vera and pass the reader test;
  - your session tells you she's done, with the paths;
  - you'd approve them, or your rejection note names something the templates or Vera should
    have caught.
- **P2 Contradiction at the interview:** the request contradicts the sample app's `business.md`.
  **Pass when** the first question names the contradiction, and choosing "propose a change"
  produces `business-change.md` for your approval.
- **P3 Contradiction while writing:** a contradiction seeded so it only shows up in the detail
  (a conventions rule the PRD would break). **Pass when** Nora pauses, the question is in
  `interview.md`, your session shows it, and after your answer a new run finishes.

- **P4 Your own list:** you give a list of 20–50 requirement lines for a small feature. **Pass
  when** the interview asks only about gaps and contradictions, every line is cited in the PRD,
  and a line seeded as dropped (removed from the PRD after Nora's run) is caught by Vera as a
  must-fix.

## Done when

- T1–T8 pass, and the full suite passes through the build runner and CI.
- P1–P4 pass.

## Checked against the queued units

- **35:** gains the "read business.md first" step (Scope 3) and is reused for pauses while
  writing.
- **36:** `business.md` changes only through `business-change.md`. 36's approval of
  `business.md` stays as it is.
- **38:** paths come from `pathOf`, and links come from 38's document links.
- **40:** Nora calls `verify` and fixes within `verify_fix_rounds`. 41 extends Vera with the
  requirements-source coverage check (Scope 9); 40's spec is unchanged, and 41 adds the input and
  the check on top of it.
- **44:** chains these steps behind `/mirai-new`. Row 41's "document links" item is 38's.

**Re-checked against 37 as built (2026-11-21):**

- **"You don't run `mirai`"** (Scope 1): `mirai-write` says "You don't run `mirai`"
  (`registry/skills/mirai-write/SKILL.md`; 37's "For later" note). Added: the skill says an agent
  runs MIRAI's checks through its broker tools.
- **Her write scope** (Scope 1, T1): the spec gave Nora her own write scope under role `developer`
  (named `author` before 38b). Only a role's `may_write` is applied (`src/config/overlays.js`,
  `src/agent/scope.js`), and `developer` allows `["**"]` with step `build`. Changed to: Nora runs under a role of her own
  (`registry/roles/product-manager.toml`, read-write, step `prd`); after the run her changes are
  checked against the initiative's `pathOf` folder.
- **Skills in a strict launch** (Scope 1, "Gets"): a strict launch loads no skills
  (`src/launch/strict.js`), so skill overlays reach only Jet's sessions. Added: her prompt
  carries `mirai-write` as the approved skill overlay renders it, and the type's template as
  `mirai show template` renders it. Her `lint` broker tool applies the overlays and returns
  `overlays_skipped` (`src/mcp/tools/lint.js`).
- **`requirements.md`** (Scope 9): if it's a document type, it declares `[[protected_sections]]`
  for the section where `R-n` is defined (read by `lint` and `trace`), and it gets an entry in
  `test/lint/template-versions.json`.

**Re-checked against 38, 38b, 39 and 40 (2026-11-23),** as built on `main` (d9b4a02), before the
build. **One finding changed how Scope 2 was approved** (A below). **Jet's answers (2026-11-23):
A1, B1, C1** (C1 "go with your recommendation"); dated notes are in Scope 1, 2, 7 and T2, and in
44's Scope 1 and 3. The rest is wiring.

- **A. The checks as broker tools (Scope 2, T2) conflict with D-53 and with how a launch runs.**
  `lint` alone is fine (no model, changes nothing); it's offered to your session only today
  (`contexts: ['interactive']`), and a headless one is a cage change with its red team. But
  `verify` and `reader_test` each start a model run, and from Nora's headless server that is an
  agent starting an agent:
  - **D-53:** "the headless `mcp.json` … never `start_agent`: the tool table names each tool's
    contexts, so the recursion guard holds by construction". A `verify` tool is `start_agent` for
    one agent;
  - **the run lock:** a launch needs the run lock, held by the process that launches
    (`launchInRun`, `no-run-lock`). Nora's own launch holds it; the broker is another process
    (Claude Code starts it), and locks aren't re-entrant, so Vera can't launch from it;
  - **a clean tree:** every launch refuses a dirty tree (`dirty-tree`; your 40 Q3 "A"). Mid-run,
    Nora's new brief is uncommitted, and a commit from the broker changes `.git` under her launch,
    which D-54's check refuses (`repoChanged`);
  - **the launch token** is minted in the launching process (19c), never in a headless server.

  **Options:**
  - **A1 (recommended): MIRAI runs the loop, between Nora's launches.** "Nora's run" is one MIRAI
    run (one run lock, as `mirai run` holds one for a ticket): Nora's launch writes the brief, MIRAI
    checks her changes against the initiative's folder, commits them, runs the lint, Vera
    (`runVerify` with `run` and `authorLaunch`: the rung is logged) and the reader test, then
    hands the results to her next launch (her kept session, 21c, with 40's `handoffText`), within
    `[docs]` rounds; then the PRD the same way. Nora's tools are only `Read`, `Glob`, `Grep`,
    `Write`, `Edit`. Your session starts it as a `/mirai` command (39's list; the worker already
    runs agent commands) and follows it with `mirai_status`. D-53 and the cage stay as they are,
    apart from Nora's agent and role files. Decision 1 holds: she still works through lint, Vera
    and the reader test in the background, and you're called back only to approve or answer.
    44's "the fix loop runs inside Nora's run" holds too (the MIRAI run); 44's `route.js` splits
    the hand-off into "fix these" and "ask these" instead of a tool's reply.
  - **A2:** A1, plus a headless `lint` broker tool, so Nora can lint her own draft inside a
    launch before it ends (fewer rounds). Costs a cage change (`src/mcp/**`) and a red-team run;
    the loop still runs the lint itself.
  - **A3: the spec as written.** Change D-53 to let headless servers start Vera and the reader
    test, with a nested run lock, mid-launch commits and a broker-minted token. A redesign of the
    cage with its own red team; not recommended.

- **B. The local store (38).** Its documents live in MIRAI's store on this Mac, outside the repo,
  which the sandbox denies to every agent. So Nora can't `Write` there, and a scratch copy in the
  checkout would put the documents in the repo the local store keeps them out of. **Recommended (B1):**
  on the local store, Nora returns each document as structured output and MIRAI writes it through
  the store's `write` (its `pathOf`), so no store path is ever opened to an agent. On the repo store
  she writes the files herself (B2 would be structured output on both stores: one path, but every
  fix is a whole rewrite).
- **C. Where MIRAI commits Nora's documents (repo store).** Vera needs a clean tree (40 Q3 "A"),
  so after each of Nora's launches MIRAI commits her changes, as 40's "For later" says. MIRAI's
  commits so far go on its own branches (22). **Recommended (C1):** on your current branch, as a
  MIRAI commit (you as author, MIRAI as committer, the trailer naming the initiative), refused on
  the integration branch (switch to a branch first). C2: on `docs/<initiative>`, which means
  switching your work tree's branch under your session; not recommended.
- **D. Before Nora starts,** the tree must be clean too: the session commits `interview.md` (and
  `requirements.md`) first. 35's skill gains that step; your session isn't sandboxed, so it can.
- **E. `start_agent` has no `agent` argument** (role, prompt, item, step, risk, size, verifies),
  so Scope 7's `start_agent (agent: mirai-product-manager)` doesn't exist as written. With A1 the
  session uses `/mirai write <initiative>` (wiring).

Wiring, as built if A1 is chosen:

- **38:** paths through the store's `pathOf` (the initiative's folder is the write scope Nora's
  changes are checked against after each launch); links through 38's `documentLine`.
- **38b:** `persona = "Nora"` in `mirai-product-manager.toml`; every line naming her goes
  through `agentNamer`/`fullName`; 38b's T8 refuses a hard-coded "Nora" in `src/`. Her lines name
  no merge request, so `words.js` isn't needed.
- **39:** `/mirai write` on the session list (`COMMANDS`, `tty: true`, an agent launch, like
  `verify`); her rendered agent file comes from the bundle (rendered and locked; doctor's "Not
  rendered by MIRAI" never lists it); 17a's instruction-file pin and the bundle/render pins gain
  her file (as 40's did); `mirai custom add --as` gains `mirai-product-manager`.
- **40:** `runVerify` with `run` (her run's lock) and `authorLaunch` (her launch id: the rung is
  logged, 40's Q2); her next launch gets `handoffText`; the reader test after Vera's pass or last
  round (`checkVeraFirst`); `verify_fix_rounds` and `reader_fix_rounds` as the caps. Not built
  here: the incremental re-check (44, Jet's "B" on 40's P3); nothing in 41 keys rounds in a way
  that conflicts with it (Vera's results stay keyed by subject hash and round). The PRD template's
  fixed "ID prefixes" table stays out of findings (40's `fixed_parts`).
- **40's P3 probe gap:** a session in a probe home can't run `mirai lint` (no store there); 41's
  probe steps give the probe's own lint and verify commands, and say the probe commits before it
  checks.
- **44:** expects 41's pause into `interview.md`, `mirai show` with Nora's state, a "Nora run" that
  can be continued after your answers, and the verify result to split. A1 keeps each; 44's Scope 1
  ("41's `start_agent` for Nora") and Scope 3 ("41's verify broker tool") need a dated note to say
  `/mirai write` and "the loop's hand-off" instead.
