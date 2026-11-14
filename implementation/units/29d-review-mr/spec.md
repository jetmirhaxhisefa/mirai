---
unit: "29d"
name: review-mr
status: approved (2026-11-14; Jet: "approve 29d"; interview decisions 1–4, the defaults as written)
roadmap: design/07-implementation-roadmap.md, row 29 ("Review a ticket's MR without the host", Jet 2026-11-14) and row 46 (the inbox opens it; send back); D-34's update of 2026-11-14 (review and merge from MIRAI; the merge stays yours)
depends_on: ["29a", "29c", "27a", "27b"]
---

# Unit 29d: `mirai review-mr` and `mirai merge`

## Why

Your decision of 2026-11-14: review a ticket's MR without opening GitHub or GitLab, and decide on it there; the host stays a choice. For SAMPLE-4 the review was by hand: the diff against the plan, the tests against the baseline, how deep Rex looked (6 s, the diff only), whether the proofs still hold. Nothing puts that on one screen, and merging means the host's page.

Already built: the MR's facts in the journal (`ticketFacts`: number, URL, head, proofs at the head; the final head and merge commit since 29a), `checkProofs` (the code hash and the signed proofs), the review records (`src/agent/review.js`: findings, follow-ups, the launch), each launch's line in the run log (model, turns, minutes, tool counts) and its raw stream for the last 50 launches (the files it read), the build record's test results and the baseline, the plan's Code map (`src/lint/` reads its table), the hosts (`src/ship/host.js`, `src/ship/gitlab.js`: `findMr`, auth, the credential helper), M1 (`src/reports/m1.js`).

New: the host's CI state, whether it can merge, the merge, deleting the branch; the packet; the decision; `mirai merge`.

## Decisions (Jet, 2026-11-14, in the interview)

1. **Send back comes with unit 46.** 29d's review ends with **merge** or **later**. Choosing send back says it comes with the inbox (unit 46: your note as a signed finding, a fix round, Rex again, the MR updated) and, until then, what you can do: comment on the MR, or `mirai drop <ticket>`.
2. **A merge commit.** `mirai merge` merges with a merge commit, so MIRAI's commits, its signed branch record and its proofs land on main as they are (what SAMPLE-3 and SAMPLE-4 used). A per-project `[git] merge_method` can come later.
3. **After the merge, tidy:** the MR's branch is deleted on the host (the MR keeps its commits; M1 reads them through `refs/pull/<n>/head`), you're switched to the integration branch and it's fast-forwarded, and the local ticket branch is kept for `mirai clean` (unit 69). With uncommitted changes, only the host's merge happens, and MIRAI says so.
4. **Real probes on both hosts** (P1 GitHub, P2 gitlab.com; you sign glab in to gitlab.com first).

## Defaults taken with the decisions (not asked; say if you want them otherwise)

- **The packet** (`mirai review-mr <ticket>`, also `/mirai review-mr <ticket>`; `--json`; `--diff` adds the whole diff):
  ```
  SAMPLE-4 · PR #4 open · proofs valid at its head b6c798e · CI: none (local-only)
  Files      1 changed, all in the plan's Code map (backend/tests/Feature/TaskApiTest.php: change)
  Tests      lint pass, unit pass, frontend pass, e2e pass · as the baseline (KnownFailureSeedTest failing, flaky-seed flaky)
  Review 1   PASS by Rex (Sonnet), 0.2 min, read 3 files (review.diff, plan.md, index.json), 1 search · 0 blocking, 0 follow-ups
  Merge      the host can merge it · M1 if you merge now: as is
  Diff       +41 −0 in 1 file (mirai review-mr SAMPLE-4 --diff for all of it)
  ```
  - **Files against the Code map:** each changed code file (over `gate.code_paths`) with its Code map row; a file the plan doesn't name, or one it marks `read`, is flagged.
  - **Tests:** the build's last checks and each level's verdict against the baseline.
  - **The review's depth:** from the review launch's run-log line (model, minutes, tool counts) and, while it's among the last 50 kept, its stream (the files Rex read, never their contents). A review that read only its input files says so.
  - **CI:** the host's checks on the head (GitHub's check runs and statuses, GitLab's head pipeline): `none`, `pending`, `passed` or `failed` with the names.
- **The decision** (a real terminal only): `[m]erge  [s]end back  [l]ater`. Merge asks for the ticket key, typed, as `approve` does.
- **`mirai merge <ticket>`:** the same decision without the packet. A gate: never from your session (`/mirai merge` answers with the terminal command, as `approve` does). It refuses unless all of these hold, and names which doesn't:
  - the MR is open, and its head is the commit MIRAI last pushed (the head you reviewed);
  - the proofs are valid at that head (`checkProofs`);
  - the host says it can merge it (no conflict, nothing the host requires is missing);
  - CI isn't failing or pending (none is fine, as today: local-only).
- **The merge is pinned to the head:** GitHub's `sha` on the merge call, GitLab's `sha` on its merge: a commit pushed after your review makes the host refuse, and nothing is merged.
- **Your merge is signed:** an `approval` line of kind `merge` (the ticket key typed, signed with your key, its content hash the code hash at the head), then `mr_merged` with the head and the merge commit. So the journal says you merged it, not only that it was merged.
- **Through the host's API**, with the host's CLI as the only credential (as `ship`): GitHub `PUT /repos/{repo}/pulls/{n}/merge` with `merge_method: merge` and `sha`, then `DELETE /repos/{repo}/git/refs/heads/{branch}`; GitLab `PUT …/merge_requests/{iid}/merge` with `sha` and `should_remove_source_branch`. No `gh pr merge` (it touches local branches).

## Scope

**In.**

1. **`src/review/packet.js`:** the packet's data and text.
2. **The hosts** (`src/ship/host.js`, `src/ship/gitlab.js`): `mrState(number)` (state, head, mergeable, CI), `mergeMr(number, { head })` (the merge commit), `deleteBranch(branch)`.
3. **`src/review/merge.js`:** the checks, the signed approval, the merge, the journal, the tidy-up.
4. **Commands:** `mirai review-mr <ticket> [--diff] [--json]` (the session list: read-only), `mirai merge <ticket>` (a gate).
5. **`src/store/journal.js`:** `approval` kind `merge`.
6. **Docs:** a new `docs/review-mr.md`; docs/ship.md (merging from MIRAI).

**Out.**

- Send back (unit 46). The inbox (46). Merges into `feature/<epic>` (with epics, 53). Waiting for pending CI (CI is unit 54).

## Probes (with your OK: yes, 2026-11-14)

No model: as 29a's P1, the probe makes MIRAI's side itself (a branch with one code commit, the trailer, a branch record and proofs signed with a probe key in a clone, pushed, the MR), then runs MIRAI's real `review-mr` and `merge` code.

- **P1, GitHub `mirai-sample-app`:** (a) `review-mr` shows the packet; `merge` merges it with a merge commit, the branch is deleted on GitHub, the clone's main is fast-forwarded, `mr_merged` has the head and merge commit, M1 says as is; (b) a commit pushed after the review: `merge` refuses (the head isn't the reviewed one), and GitHub's `sha` check is proved too by calling the merge with the old head: refused, nothing merged; (c) a closed PR: `review-mr` says closed, `merge` refuses. Leaves one probe merge under `probes/29d/` on main.
- **P2, gitlab.com `jettmir.h/mirai-sample-app`:** (a) and (b) the same through GitLab.

## Files

- **New:** `src/review/packet.js`, `src/review/merge.js`, `src/cli/commands/review-mr.js`, `src/cli/commands/merge.js`, `docs/review-mr.md`; `test/review/review-mr.test.js`; `test/probes/merge-probes.js`.
- **Changed:** `src/ship/host.js`, `src/ship/gitlab.js`, `src/store/journal.js`, `src/mcp/tools/commands.js`, `src/cli/commands/index.js`, docs/ship.md, `src/doctor/checks.js` (the merge gate's hint names `mirai review-mr`).

## Tests (`npm test`, no model, no network; stand-in `gh` and `glab` as 27a and 27b)

- The packet: files in and outside the Code map, a `read` file changed, tests against the baseline, a review that read only its inputs, CI none/pending/passed/failed, a merged and a closed MR.
- `merge`: each refusal (not open, head moved, proofs invalid, not mergeable, CI failing or pending, no terminal, a wrong key typed); the merge pinned to the head (the stand-in refuses another sha); the signed approval and `mr_merged`; the branch deleted; main fast-forwarded; a dirty tree left as it is, said.
- The session list: `review-mr` with `--diff` and `--json`; `merge` a gate with its terminal command.

## Done when

- P1 and P2 pass: a reviewed MR merged from MIRAI on each host, a head pushed after the review refused, nothing merged by mistake.
- `npm test` passes; `docs/review-mr.md` says what's above.

## What you'll do by hand (when we get there)

- Approve this spec. Before P2: `glab auth login --hostname gitlab.com`.
- Then, on your next ticket: `/mirai review-mr <ticket>` in a session, and `mirai merge <ticket>` (or the review's `m`) in your terminal.

## Open points for you

- None beyond the approval.

## Changes during the build (2026-11-14/15)

- **The probes merge into throwaway base branches, never your main:** each case is the unit tests' fixture (planned, built and reviewed by a stand-in claude, proofs signed with a probe key), pushed to the real host on `mirai-probe/base-<id>`, which its MR targets. Nothing landed on the sample app's main, and every probe branch was deleted (the spec had planned one probe merge on main).
- **GitLab only through its own config folder:** this laptop's glab also knows a work GitLab. P2 runs only with `GLAB_CONFIG_DIR` set to a folder logged in to gitlab.com alone (`~/.config/glab-personal`, made 2026-11-15), and every call it makes names `--hostname gitlab.com`; it refuses to run without that folder. MIRAI's own GitLab code already names the server on every call.
- **The packet for a merged MR** compares with the base its build started from (main holds its code by then), and says `merged at <head>` instead of checking proofs. A review's commit differing from the head isn't flagged when only the proofs commit came after it: only code changed after the review is.
- **The diff in the packet** counts the code files only (MIRAI's records left out, as in Files); follow-ups show Rex's words, not their ids.
- **An open MR's facts** (unit 29a's journal facts) now carry its number and MIRAI's last push too; only merged and closed ones had them.
