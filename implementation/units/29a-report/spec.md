---
unit: "29a"
name: report
status: approved (2026-11-14; Jet: "approve 29a"; interview decisions 1–5, the defaults as written)
roadmap: design/07-implementation-roadmap.md, row 29 (report, the M1 script, feedback) and the Milestone A exit row (`07:98`); design/06-review-round-2.md PM2-17 (one place for reports); design/_review/round-2-pm.md:215 (the only M1 definition); design/01 §17 and D-38 (M1), D-57 (the usage ledger), D-58 (the judgement-step model); 01:1498 (the retention rule's "kept" class)
depends_on: ["28", "18"]
---

# Unit 29a: `mirai report`, the M1 rate and `mirai feedback`

## Why

Milestone A's exit evidence is a report: "`mirai report <run>` for one hand-written sample-app ticket shows plan → TDD → review → push → MR inside the loop caps, with rounds, turns, tokens, minutes and the share of the usage limit; the red-team suite is green for the current Claude Code version; the MR lands in the private sample-app repo" (`07:98`). There's no `mirai report` yet. The pilot's value check needs M1, the share of MIRAI's MRs you merge without changing them, and nothing measures it.

Already built and waiting (the research, 2026-11-14):

- **The run log** (`src/store/run-log.js`, schema 3): one `agent_run` line per launch with step, role, round, tier, model, `model_used`, `tier_reason`, tokens, turns, minutes, `limit_share`, verdict, outcome and tool counts; `run_started`, `checks`, `finding`, `run_finished`.
- **The loop counters** (`src/loop/guard.js`): rounds used, re-plans, and each ticket's summed budget, limit share included.
- **The usage ledger and readings** (`src/store/global.js`, `src/loop/ledger.js`, D-57).
- **The journal's MR facts** (`src/store/journal.js`): `pushed`, `mr_opened` (number, URL, head), `mr_merged`, `mr_closed`; `ship` notices a merge since PR #40.
- **The code hash** (`src/proofs/hash.js` `codeHash`): the ticket's change against its base, code paths only; a clean rebase keeps it (D-16).
- **The run-report template and renderer** (`registry/templates/run-report.md`, `renderRunReport` in `src/reports/render.js`): built in 09b, never called. It has no rounds, limit share, verdicts, models, M1 or feedback.
- **`redTeamStatus`** (`src/redteam/run.js`).

What's missing: the `report` command and the saved reports, the M1 classification, the `feedback` event (in neither the journal's nor the run log's types), and the final MR head on `mr_merged`.

## Decisions (Jet, 2026-11-14, in the interview)

1. **Unit 29 is split in three** (29b is already "your key and token at rest"):
   - **29a** (this): `report`, the M1 rate, `feedback`. Read-only over what MIRAI logs, plus git; closes Milestone A's evidence.
   - **29c:** minimal `mirai doctor`.
   - **29d:** `mirai review-mr` and `mirai merge` (the host's CI state, mergeability and merge on GitHub and GitLab; a new gate; real-host probes).
2. **M1 compares the code, not the commits.**

   | Class | Rule |
   |---|---|
   | **merged as is** | merged, and the MR's final head has the same code hash as MIRAI's last push |
   | **edited** | merged, and the code hash differs: someone changed code after MIRAI's last push |
   | **closed** | closed without merge |

   GitHub's "Update branch" and a clean rebase keep the code hash, so they count as "as is"; a change only to docs or records (outside `gate.code_paths`) isn't an edit. The design's commit-based wording ("no non-`Mirai-Ticket` commits after the MR opened") is replaced, and D-38 and design/01 §17 get the definition.
3. **`mirai feedback <ticket> "<text>"` goes in the ticket's journal, from your terminal or your session.**
   - A new journal type `feedback` (`ticket`, `text`), privileged: MIRAI's own commands write it, never an agent (not in `LOG_TYPES`).
   - From your terminal: `by: human`, signed with your key. From your session (`/mirai feedback …`): `by: session`, with the registration id; `report` and `show` say "from your session".
   - Kept under the retention rule's "kept" class (structured data, never cleaned).
4. **One report per run, with each ticket's whole path.**
   - `mirai report` prints the last run's report; `mirai report <run-id>` an earlier one; `--json` the data. Also `/mirai report` in your session (read-only).
   - For each ticket the run touched: every step so far, earlier runs' marked "earlier run", each with its model (configured and used), round, turns, tokens, minutes, limit share and verdict; rounds used of the cap and re-plans; the MR and its M1 class; your feedback.
   - On top: the run's totals and limit share, and the red-team state for the Claude Code agents run.
   - Saved when a run ends, as `<store>/reports/<run-id>.md` and `.json` (PM2-17: one place), in the run-report template's sections.
5. **The M1 probe uses real PRs on `mirai-sample-app`** (below).

## Defaults taken with the decisions (not asked; say if you want them otherwise)

- **The MR's final head:** `ship` records it on `mr_merged` (`head`, from the host's `findMr`) from now on (journal schema v6; older lines stay valid). For a merge recorded before (SAMPLE-3, SAMPLE-4), the M1 script reads it from git: `refs/pull/<n>/head` on GitHub, `refs/merge-requests/<n>/head` on GitLab, fetched into `FETCH_HEAD` only (no new refs in your repo). The MR number is on `mr_opened`.
- **MIRAI's last push** is the `pushed` line's `sha`; its code hash is taken against the base MIRAI built on (`branch.json`'s start commit), the final head's against the merge base with the integration branch, both with the integration branch's `gate.code_paths`.
- **M1 in the report:** each ticket's class; `mirai report --m1` prints the rate over every merged or closed ticket so far: `M1: 2 of 2 merged as is (100%) · 0 edited · 0 closed`. A ticket whose head can't be read is `unknown`, named with why, and left out of the rate.
- **A report for a run from before 29a** is rendered from its run log when asked (`mirai report <run-id>`), and saved then.
- **No run yet:** `mirai report` says so and names `mirai run <ticket>`.
- **Feedback text:** one line, up to 2,000 characters, shown escaped (`plain`); empty text is refused. `mirai show` lists it under a new `Feedback` row.
- **The session list (21f):** `report` is a quick command (read-only); `feedback` runs from the session as `by: session` (decision 3); neither is a gate. `test/mcp/commands.test.js` holds both.
- **The model per step (D-58):** the report shows `model_used` beside the configured model when they differ.

## Scope

**In.**

1. **`src/reports/run-report.js`:** the report's data from the run log, the loop counters, the journal, the ledger and `redTeamStatus`; saved at run end (`driveTicket`'s finish) and on demand.
2. **`src/reports/render.js`:** `renderRunReport` gets the rounds, limit share, verdicts, models, M1 and feedback.
3. **`src/reports/m1.js`:** the classification above, and the rate.
4. **`src/store/journal.js`:** `feedback` (privileged, `human` or `session`), `head` on `mr_merged`; schema v6. `src/ship/ship.js` writes the head.
5. **Commands:** `mirai report [<run-id>] [--json] [--m1]`, `mirai feedback <ticket> "<text>"`, in `src/cli/commands/` and the session list. `mirai show` gets the `Feedback` row.
6. **Docs:** a new `docs/report.md` (the report, M1, feedback); D-38 and design/01 §17 (M1's definition); docs/run.md (the saved report).

**Out.**

- `doctor` (29c), `review-mr` and `merge` (29d), the morning report and `mirai metrics` (unit 56), `mirai clean` (unit 69).
- M1 for MRs into `feature/<epic>` (with epics, unit 53).

## Probes (with your OK: yes, 2026-11-14)

- **P1, M1 on real PRs** (about 30 minutes; Sonnet as Kai and Rex; on `mirai-sample-app` itself, since M1 reads the real host):
  1. SAMPLE-3 (#3) and SAMPLE-4 (#4) classify as **merged as is**, their heads read from `refs/pull/<n>/head`.
  2. **Edited:** a probe ticket (one comment line) built and shipped by MIRAI; the probe pushes one hand-made code commit to its branch, then merges the PR → **edited**.
  3. **Closed:** a second probe ticket's PR closed by the probe → **closed**.
  4. **Update branch:** a third probe ticket; main moves first, the probe presses GitHub's "Update branch" (`gh api -X PUT …/update-branch`), then merges → **merged as is**.
  5. `mirai report --m1`: `3 of 4 merged as is · 1 edited · 1 closed`.
  - Leaves 3 PRs (2 merged, 1 closed) and their small probe commits on the sample app's main, each titled "probe 29a"; the closed PR's branch is deleted.
- **By hand, at the end (you):** `mirai report` after your next sample-app run, and `/mirai feedback` from a session.

## Files

- **New:** `src/reports/run-report.js`, `src/reports/m1.js`, `src/cli/commands/report.js`, `src/cli/commands/feedback.js`, `docs/report.md`; `test/reports/run-report.test.js`, `test/reports/m1.test.js`; `test/probes/m1-probes.js`.
- **Changed:** `src/reports/render.js`, `registry/templates/run-report.md` (only if a section is missing), `src/store/journal.js`, `src/ship/ship.js`, `src/run/drive.js` (save the report), `src/run/show.js`, `src/mcp/tools/commands.js`, `src/cli/commands/index.js`, design/04 (D-38), design/01 §17.

## Tests (`npm test`, no model, no network; stand-in `claude` and host as before)

- **M1:** merged at MIRAI's head → as is; a hand commit that changes code → edited; one that changes only a doc outside `code_paths` → as is; a rebase onto a moved main → as is; a squash merge with an unchanged diff → as is; closed → closed; no head readable → unknown, left out of the rate.
- **The report:** a ticket over two runs shows both runs' steps, the earlier marked; rounds of the cap; limit share summed as the loop guard sums it; `model_used` shown when it differs; feedback from the terminal and from the session told apart; saved once at run end, the same bytes on demand.
- **Feedback:** signed when `human`; a session line carries the registration id; an agent's `log_event` of type `feedback` is refused; empty or too-long text refused.
- **The journal:** v5 lines read under v6; `mr_merged` with and without `head`.
- **The session list:** `report` and `feedback` placed; `merge` not yet present (29d).

## Done when

- `mirai report` on the sample app prints the Milestone A evidence for SAMPLE-4's run: plan → build (TDD `after`) → review → proofs → push → MR merged, inside the loop caps, with rounds, turns, tokens, minutes, limit share, the models, and the red-team state for the agents' Claude Code.
- P1 classifies the seeded merged, edited, closed and updated PRs correctly.
- `npm test` passes; the docs say what's above.

## What you'll do by hand (when we get there; exact commands then)

- Approve this spec; give the OK to start P1 (it opens the real PRs).
- After the build: `mirai report`, `mirai report --m1`, and `/mirai feedback SAMPLE-4 "…"` from a session.

## Open points for you

- None beyond the approval.
