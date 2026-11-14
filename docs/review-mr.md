# Reviewing and merging from MIRAI (unit 29d)

```
mirai review-mr SAMPLE-4          # the MR on one screen; in a terminal, then: [m]erge [s]end back [l]ater
mirai review-mr SAMPLE-4 --diff   # and the whole diff of the code
mirai merge SAMPLE-4              # the decision without the packet
```

`/mirai review-mr SAMPLE-4` works in your session too; it only shows, and names the terminal command. **The merge is yours:** a real terminal and the ticket key typed, like `approve`; `/mirai merge` answers with the command to type. Reviewing and merging on GitHub or GitLab stays a choice; MIRAI notices a host merge at the ticket's next `ship` or `run`.

## The packet

```
SAMPLE-4 · MR #4 open · proofs valid at its head b6c798e · CI: none (local-only)
Files      1 code file changed, all in the plan's Code map
  backend/tests/Feature/TaskApiTest.php: change
Tests      lint pass, unit pass, frontend pass, e2e pass · the baseline knows test_known_failure_seed (failing), …
Review 1   PASS, by claude-sonnet-5-5, 0.16 min, read 3 files (input: index.json, input: review.diff, input: plan.md), 1 search · 0 blocking findings, 0 follow-ups
  Rex read only its input (the diff and the plan), no file of the project
Merge      the host can merge it · M1 if you merge now: as is
Diff       +41 −0 in 1 file (mirai review-mr SAMPLE-4 --diff for all of it)
```

- **Files:** each changed code file (over `gate.code_paths`) with its row in the plan's Code map. A file the plan doesn't name, or one it only reads, is flagged.
- **Tests:** the build's levels and checks, and the baseline's known failures.
- **Review:** Rex's last review, its model and minutes, and the files it read (while its launch is among the last 50 MIRAI keeps); a review that read only its input says so. Code changed after the review is named.
- **The head:** the MR's head on the host. When it isn't what MIRAI pushed, someone pushed after MIRAI, and the packet says so.
- **CI:** the host's checks on the head (GitHub's check runs and statuses, GitLab's pipeline): none, pending, passed or failed.

## `mirai merge`

It refuses, before anything changes, unless:
- the MR is open, and its head is what MIRAI pushed (what you reviewed);
- the proofs are valid at that head;
- the host can merge it, and CI isn't failing or pending.

Then: your decision is signed (an `approval` of kind `merge` in the journal), the host merges with a **merge commit pinned to that head** (GitHub's and GitLab's own `sha` check: a push after your review makes the host refuse, and nothing is merged), MIRAI records the merge (the ticket is `done`), deletes the branch on the host (the MR keeps its commits), and switches you to the integration branch, fast-forwarded. With uncommitted changes in your work tree, your checkout is left as it is, and MIRAI says so. The local ticket branch stays for `mirai clean` (unit 69).

**Send back** (your note as a finding for Kai's next round) comes with the inbox, unit 46. Until then: comment on the MR, or drop the ticket with `mirai drop`.
