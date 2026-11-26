# Unit 45: test results (2026-11-26)

**Waiting for the runner, P1's real run, one question (below) and your approval.** Built on
`unit/45-build` from `origin/main` (`eea4341`: 44 merged, its re-checks merged, 62's spec merged).
The spec's sections are what was built, with its re-checks against 42, 43 and 44 as built.

## What was built

| Scope | Where | What |
|---|---|---|
| 1 The offer | `src/cli/commands/approve.js` (`tessOffer`, `startTess`) | After a PRD approval that completes the track's list: `Start Tess (mirai-ticket-planner) on the ticket set now? [y/N]`; `y` starts her run in that terminal, `N` (the default, and a closed input) prints `mirai tickets <initiative>`. After her pause on the PRD: `… paused on Q-8 for this; continue her run now? [Y/n]` (45's re-check Q1 "A"). Not complete: `tickets: still needed before … cuts the set: …`. Never on a rejection. Shown after the publish, before the documents' lines (38's rule: they come last). |
| 2 The inputs | `src/tickets/inputs.js`, `src/tess/run.js`, `[tickets.inputs]` in `src/config/config-schema.js` | `quick` none; `standard` `prd`, `tech-note`; `full` `prd`, `hld`, `adr`, `lld`; a project only adds. `mirai tickets` refuses while a needed document of a type MIRAI has isn't approved as it is now (naming it and its command); a type not built yet is skipped, and her run's first line says so (`inputs: not built yet, so not needed: no technical note yet (unit 62b)`). Approved inputs other than the PRD are her input files. |
| 3 The set's screen | `src/cli/commands/approve.js` (`approveEpic`, `epicState`, `goThrough`, `dropFiles`), `src/tickets/set-screen.js` | The release mode with Tess's reason and one line per ticket (key, type, priority, order, size, blocks, title), then `[a/e/r/t]`: `t` goes through the tickets (`K/d/c`) and the release mode (`K/s`). Drops only: files removed, the epic rendered, the lint and trace as at approval, the screen again; a drop that leaves a gap is shown and undone; a kept ticket `after` a dropped one is refused, naming both. Vera's result before the drop stands while coverage is unchanged (else `mirai verify` first). Any change: nothing signed, `ticket-notes.md` written, the next step named. |
| 4 The log | `src/store/journal.js`, `src/tess/state.js`, `src/cli/commands/show.js` | `ticket_decision` (signed: yours): `ticket`, `decision` (`drop`, `merge`, `split`, `change`), `reason`, `epic`, `round`. The set's approval line gains `release_mode`, `release_reason` (when you switched it) and `dropped`. `mirai show` lists the decisions and the signed release mode. |
| 5 After the signature | `publishAndMerge` in `approve.js` | 38's publish, then 38's merge: merged, waiting (what for, and the command), or a gap (named; your approval stands). A tracker publish has nothing to call yet (no tracker connector exists): see "Changed from the spec". |
| 6 The quick track | `src/tickets/quick.js`, `gateFor` in `src/agent/plan.js` | A lone ticket's plan gate is `auto` for normal risk; a high-risk plan, protected paths, new dependencies and changed tests still need you. See question 1. |
| The type `ticket-notes` | `registry/document-types/ticket-notes.toml`, its template and checklist, `src/store/connectors/common.js` | `docs/mirai/<initiative>/ticket-notes.md`, written by the screen, `status = "forbidden"`, never approved; Tess's input on her next run (step `notes`, a new cycle for Vera: the notes are part of the cycle's hash). The docs merge takes it only when every line is one of your signed `ticket_decision` lines (`notesNotSigned`, `src/store/connectors/state.js`). |
| Tess | `registry/agents/mirai-ticket-planner.md`, `src/tess/run.js` | The `notes` step and its prompt; `ticket-notes.md` and the approved inputs in her input list; a dropped or merged key never reused; the release mode's rule and its one line in the summary. |
| The epic template v3 | `registry/templates/epic.md`, `registry/examples/epic.md` | "What changes" ends with the release mode in one line (45's re-check: Vera flagged the summary not naming it). v2 epics get the usual `template-older` warning. |
| Docs | `docs/tickets.md` ("From approved documents to an approved set"), `docs/documents.md`, `docs/config.md` | The flow, the screen's keys, the log, the merge, the quick track; the `ticket-notes` type; `tickets.inputs.standard` and `.full`. |

## Tests

| Test | File | Result (Mac) |
|---|---|---|
| T1 the offer (standard, 62b's warning; N, empty, closed input, y; a rejection never asks) | `test/documents/tickets-workflow.test.js` | pass |
| T1 each track's list; full's warning naming 61–63 | same | pass |
| T1b after her pause: `[Y/n]`, default yes | same | pass |
| T2 a needed document: absent refused; the brief approved, her input; changed, refused with its command | same | pass |
| T3 drop: no reason refused; `after` refused naming both; a gap shown and undone; a clean drop signed with `dropped`, Vera's earlier result, `ticket_decision`, `mirai show` | same | pass |
| T3 the rows and the drop check | same | pass |
| T4 change: a split note, nothing signed, the notes lint clean (T8), `ticket_decision`; her next run's step `notes` with the notes as input | same | pass |
| T5 release mode: shown with her reason; a switch needs a reason; the signed line and `mirai show` carry it; kept, her mode and no reason | same | pass |
| T6 sign and merge: merged at the published head, documents only; a second approval doesn't merge twice | `test/store/docs-publish.test.js` | pass |
| T6 a waiting MR is reported, not retried (38's T5 and T6 now approve the set with the host's checks running) | same | pass |
| T6 the docs merge takes ticket notes only from your signed decisions | `tickets-workflow.test.js` | pass |
| T7 the quick plan gate: lone ticket normal risk auto, high risk yours, an epic's ticket the preset's | same | pass |
| T8 the docs check (34b) | `test/docs/coverage.test.js` | pass |
| P1's flow with stand-in agents (the probe's own dry run) | `tickets-workflow.test.js` | pass |

Changed to fit 45: 33's T7 (the epic's example is v3), 31 T5 (`ticket-notes` has no summary: never
approved), the journal's type list, 38 T5 and T6 (above), the template versions (epic v3,
ticket-notes v1).

Runner: `u45-tests-1`, `u45-baseline-1`, `u45-redteam-1` were refused (`"arg": null` in the
request); `u45-tests-2`, `u45-baseline-2` and `u45-redteam-2` are queued at `225f1f8`.

## Found on the way (fixed)

- **38's publish lost its own docs branch** when the initiative's documents were on the
  integration branch already: the docs commit was the tip itself (`same`), so it pushed the branch
  but never made it here, and the next publish refused its own push ("a commit MIRAI didn't push").
  P1's dry run found it (the probe home commits its documents on `main`). Now the local branch is
  made whenever it isn't the head (`src/store/connectors/publish.js`).
- **The docs merge refused `ticket-notes.md`** ("has no approval MIRAI checks"): it now takes it when
  every line is one of your signed decisions.

## Probes (real)

- **P1 PRD to merged set** (`test/probes/tickets-probes.js --probe p1 --yes --auto`): the sample
  app, real Tess, Vera and the reader test; the docs MR on a stand-in GitHub over a local bare repo
  (38's probes proved the real hosts). **Run 1 (2026-11-26, at `225f1f8`, `~/mirai-u45-p1.txt`):
  7 of 8 checks pass; "drop" couldn't run.**
  - The offer: `y` started her run in that terminal. She cut 9 tickets; Vera found 2 must-fix, she
    fixed them, and round 2 passed.
  - The screen: the probe's rule picks a drop only when the ticket blocks nothing and another ticket
    covers every ID it covers. Her real set had no such ticket (a good set has none), so it dropped
    nothing and split SAMPLE-2. Nothing was signed, `ticket-notes.md` was written, and the decision
    was logged.
  - Her `notes` run split SAMPLE-2 (10 tickets). Vera found 1 must-fix, she fixed it, round 2 passed.
  - `a` signed the set (`release: per-ticket`); MIRAI published and **merged the docs pull request
    at the published head, documents only**; `mirai show` lists the split and the release mode.
  - **The drop, checked on the kept home with no model:** dropping SAMPLE-10 (it blocks nothing)
    would leave FR-8 and its two ACs uncovered; the screen listed the three gaps, said "the drop was
    undone: SAMPLE-10 is back, and the epic as it was", wrote nothing (exit 4), and left the tree
    clean. A clean drop is T3's (a duplicated ticket).
  - Verdict: the flow passes; a real drop of a ticket the set needs is refused, as it should be.
    Kept home: `~/.mirai-probes-d1Dv2g` (delete with your OK).
- **P2 the quick ticket**: moved to after unit 55 (Jet's "A": until 55 signs an `auto` plan, a quick ticket is three actions: the ticket, the plan, the merge).

## Changed from the spec

- **Scope 1, the order on screen:** the offer comes after the publish and before the documents'
  lines (the re-check against 44 said after them; 38's rule keeps the documents last).
- **Scope 3, the keys:** the first question is the usual `[a/e/r]` plus `t` ("go through the tickets
  and the release mode"); `t` asks `K/d/c` per ticket and `K/s` for the release mode. Keeping every
  ticket is one key (`a`), as before.
- **Scope 3, drops with changes:** in one pass with a change, the drops are applied too (files
  removed, the epic rendered, logged); the lint and trace run on Tess's next set.
- **Scope 5, the tracker publish:** no tracker connector exists yet (38 built the docs store only),
  so there is nothing to call; `docs/tickets.md` says so.
- **Scope 5, a re-approval after the merge:** this clone is then behind the host's `main`; the
  publish says so with the commands, and the approval stands.
- **The release mode switched at the screen** is in the signed line (`release_mode`,
  `release_reason`); the epic file keeps Tess's proposal. The signed line is the truth.

## Questions for Jet (answered)

1. **The quick track's two actions** (answered **A**, Jet 2026-11-26: the gate's rule as built; three actions until unit 55's signer; P2 runs after 55). U4 says the quick plan gate is `auto`, so a quick ticket needs
   only your ticket approval and your merge. Nothing can sign an `auto` plan approval yet: that
   signer is unit 55's ("a signer for auto plan approvals", PROGRESS's open list). So today a quick
   ticket takes three actions (the ticket, the plan, the merge). A: build the gate's rule now (done:
   `gateFor` says `auto`, and the plan says why it still waits for you), count three until 55, and
   run P2 then. B: build the signer for `auto` plans here (a MIRAI-held key signing a lint-clean,
   normal-risk lone ticket's plan; a red-team question). Recommendation: **A**: an automatic
   signature over a plan is the night run's design (55), with its own interview and red team.
