---
unit: "29d"
date: 2026-11-15
claude_code: 2.1.319 (agents); no model in this unit's probes
result: 608 tests, 607 pass; the one failure is unit 13's T5/T6 temp-folder race, which passes alone · P1 on the real GitHub (17/17, on its fourth run; the first three found probe faults) · P2 on gitlab.com (14/14, first run), with a glab config folder of its own · nothing left open or behind on either host
---

# Unit 29d — Test results

## Tests (`npm test`, no model, no network)

New: `test/review/review-mr.test.js` (4 tests, a stand-in gh over a local bare repo whose merge really merges and refuses another sha, as GitHub's 409):
- the packet: open, proofs valid at the head, MIRAI's head, the host can merge it, CI none; a file outside the fixture plan's Code map flagged; the Code map read from a plan; CI states; from your session, the packet and the terminal command only; `review-mr` and the `merge` gate on the session list;
- refusals: CI failing, CI pending, not mergeable, a wrong ticket key typed (nothing signed, nothing merged), no terminal, a head pushed after MIRAI, and the host's own pin refusing the old head;
- the merge from the review's `m`: your signed `approval` of kind `merge`, `mr_merged` with the head and the merge commit, a merge commit of main and the reviewed head, the branch deleted, your checkout on main at the merge, the ticket done; again, refused;
- later and send back change nothing; a dirty work tree: the host merges, your checkout is left, said.

The pinned command list takes `merge` and `review-mr`.

## The full suite

608 tests, 607 pass. The one failure, unit 13's T5/T6 ("a failed launch left its scratch folder"), is the known race in PROGRESS; it passes alone.

## Real data, before the probes

`mirai review-mr SAMPLE-4` and `SAMPLE-3` on the sample app (both merged): the files against their Code maps (1 and 5 files, all in the plan), the tests and the baseline's known failures, Rex's review with its model, minutes and the files it read (SAMPLE-4: only its input, said; SAMPLE-3: also `StoreTaskRequest.php`), SAMPLE-3's follow-up in Rex's words.

## P1: GitHub `jetmirhaxhisefa/mirai-sample-app` (`test/probes/merge-probes.js --yes --host github`)

17/17 on the fourth run. Each case a fixture shipped to a throwaway base branch:

| Case | What happened | Result |
|---|---|---|
| a | review-mr, then merge | packet open, proofs valid, mergeable, CI none; merged as a merge commit of the base and the reviewed head; `mr_merged` with both, your approval signed; the branch deleted on GitHub; the checkout fast-forwarded to the merge |
| b | a commit pushed by hand after MIRAI | `mirai merge` refused (`mr-head-moved`); GitHub's own pin refused the old head (409); nothing merged |
| c | the PR closed | the packet says closed; `mirai merge` refused |

The first three runs found probe faults, not MIRAI's: every case's ticket has the same branch name, so a case found an earlier one's PR (now each case sees only PRs newer than the last), and case b's branch had to go before case c's push. Afterwards: no open PR, no probe branch on GitHub.

## P2: gitlab.com `jettmir.h/mirai-sample-app` (`GLAB_CONFIG_DIR=~/.config/glab-personal … --host gitlab`)

14/14 on the first run: case a (the merge, GitLab's merge commit with the reviewed head as its second parent, the source branch removed, the checkout fast-forwarded) and case b (refused by MIRAI, and by GitLab's own `sha` check). Afterwards: 0 open MRs, 0 probe branches.

**Your work GitLab was never reached:** glab ran only with a config folder logged in to gitlab.com alone (made for this, 2026-11-15, by glab's device login: you approved it in your browser), and every call named `--hostname gitlab.com`.

## Not tested

- CI that's really there (neither sample project has any): the check-runs, statuses and pipeline states are tested with the stand-in only.
- A GitHub branch rule that blocks a merge (the private free repo can't have one).
