---
unit: "29a"
date: 2026-11-14
claude_code: 2.1.319 (agents); no model in this unit's probe
result: 600 tests, 599 pass at the build commit; the one failure (an older report test building data without the two new fields) fixed by making them optional, its files 13/13 · P1 passed on its first run on the real GitHub sample app: edited, closed, "Update branch" and SAMPLE-3/4 classified right; M1: 3 of 4 merged as is (75%) · 1 edited · 1 closed
---

# Unit 29a — Test results

## Tests (`npm test`, no model, no network)

- **New:** `test/reports/m1.test.js` (3 tests, a real git repo): merged at MIRAI's push → as is; a hand code commit → edited (with the host's merge commit, and found on main without it); a docs-only commit → as is; a rebase onto a moved main, "Update branch" and a squash (with the host's squash commit) → as is; a squash without it → unknown, said why; closed, open, none, epics, a head not in the clone; the rate and its line.
- **`test/run/run.test.js`, one new test:** two runs of one ticket (plan, then build, review, proofs, MR); each saves its report; the second's path marks the plan and both approvals as an earlier run's; models, turns and rounds; Done, Usage (this run's only), the red team; the Markdown file's sections; `mirai report`, `--json`, an earlier run, unknown and bad run ids; `mirai feedback` signed, empty and too long refused; a session line accepted, an agent's and an unverified one refused; `mirai show`'s Feedback row; the report's feedback lines; `log_event`'s feedback type for your session only.
- **`test/ship/ship.test.js`:** after your merge, `mr_merged` carries the MR's head and merge commit (journal v6), and the facts give them to M1.
- **`test/reports/render.test.js`:** the two new sections and the limit share column.
- **Pinned lists** (reviewed changes): the commands (`feedback`, `report`), the journal events (`feedback`), the `/mirai` file's tools (`log_event` for `/mirai feedback`).

## The full suite

600 tests, 599 pass (about 25 minutes under `caffeinate -i`). The one failure: `test/trust/protected.test.js` T9 renders a run report from hand-made data without `tickets` and `red_team`. Fixed by making both optional (none, and a red team not known); that file and `test/reports/` 13/13.

## Real data, before the probe

On the sample app (SAMPLE-4's two runs): the report shows the ticket approval, both of Kai's plans and the plan approval as an earlier run's, the build and Rex's review with model, turns, tokens, minutes and limit share, then the push, the MR and the merge as a later run's; the known failures from the baseline the run used (KnownFailureSeedTest failing, flaky-seed flaky); the red team green for 2.1.319. `mirai report --m1`: SAMPLE-3 and SAMPLE-4 merged as is, their heads read from GitHub through gh's credential helper; without the host, both `unknown`, named.

## P1: M1 on real PRs (`test/probes/m1-probes.js --yes`, no model, the real GitHub sample app)

Passed on its first run, about 1 minute. The probe made MIRAI's side itself (one code commit with the trailer, pushed, a PR, the journal facts MIRAI writes) and yours on GitHub, then ran `src/reports/m1.js` with the host as `--m1` has it:

| PR | What happened on GitHub | M1 |
|---|---|---|
| #6 | a hand-made code commit pushed to its branch, then merged | edited |
| #7 | closed without merge | closed |
| #5 | opened first; after #6 merged, GitHub's "Update branch" API (0811c4d → 437f973), then merged; its head left out of the journal on purpose, read from `refs/pull/5/head` | merged as is |
| #3, #4 | SAMPLE-3 and SAMPLE-4, from your real journal | merged as is |

`M1: 3 of 4 merged as is (75%) · 1 edited · 1 closed`. Clean-up: every probe branch deleted on GitHub. Left on the sample app's main, as agreed: the merges of #6 and #5, each adding one file under `probes/29a/` (`cd1abe0`).

**Changed from the spec:** the probe builds no ticket with Kai. M1 depends on what the host does with a merge, not on the agent, so MIRAI's push and PR are made by the probe; it costs no model time.

## Not tested

- GitLab's `merge_commit_sha` / `squash_commit_sha` and `refs/merge-requests/<n>/head` against a real GitLab (the code reads them as 27b's host does; covered when 29d probes GitLab).
- A squash merge recorded before 29a (stays `unknown`, as the spec says).
