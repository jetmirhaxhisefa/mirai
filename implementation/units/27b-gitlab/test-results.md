---
unit: "27b"
date: 2026-11-11
claude_code: 2.1.319
result: 578 tests: 577 pass in the full suite, the 578th (unit 13's T5/T6 temp-folder race) fixed and passing · git probe all pass, with pushBranch-ca · P1 passed on its first run on gitlab.com · P2 passed on its second run on a local GitLab CE with its own certificate authority; its first found that GitLab can refuse an MR seconds after the push (now retried), and Rex found the normal review's index.json didn't list the diff (fixed, from 24a)
---

# Unit 27b — Test results

## Tests (`npm test`, no model, no network; a stand-in `glab` serving the API calls, a bare repo as the host's git)

New, in `test/ship/gitlab.test.js` (6), plus the changed `hostFor` case in `test/ship/ship.test.js` (gitlab now builds a host, and with no recorded glab is refused `no-glab`).

## The full suite

**577/577 pass** at the build commit (25.5 min under `caffeinate -i`).

After P2's fixes (the MR retry, the review index, the glab-auth message): **578 tests, 577 pass** (29 min), twice. Both times the one failure was unit 13's T5/T6, the known race: it counted the `mirai-*` scratch folders in `/private/tmp` while other test files removed theirs (2 → 1). It now compares them by name and fails only on a new one; `test/launch/strict.test.js` passes 14/14 alone, and with the GitLab tests 21/21. The review and lens tests: 21/21 (the two new index checks failed without the fix).

## The git probe

`node test/probes/git-probes.js --yes --mirai`: 38/38. The new `pushBranch-ca` case passes. `pushLog: bad-ref` is the expected refusal step it always was.

## Quick checks (glab 1.130.0, this Mac)

- The credential helper's `get` answers from an environment with only `HOME` and `GLAB_CONFIG_DIR`, run from `/`: username `oauth2`, a password, its expiry, and an OAuth refresh token. MIRAI never reads these; git does.
- `glab auth status --hostname H`: exit 0 logged in, 1 for an unknown host, 1 for an empty config folder.
- glab's config on a fresh Mac is `~/Library/Application Support/glab-cli`, not 27a's guess `~/.config/glab-cli`. Running glab once with `GLAB_CONFIG_DIR=~/.config/glab-cli` made it create `config.yml` there, and from then on glab used that empty file first (401). `glabConfigDir` follows glab's own order; the stray file was moved aside.

## P1, gitlab.com

`caffeinate -i node test/probes/gitlab-probes.js --yes --repo jettmir.h/mirai-sample-app` (log `~/mirai-27b-p1.log`). Passed on its first run.

- **Build and review:** baseline 529 s; the seeded build handed over (unit fail → pass, the rest pass → pass); Rex passed it in round 1 (8 turns, 0.47 min, Sonnet). No canary in the run.
- **Auth:** glab logged in to gitlab.com, no `ca_cert` (system trust), 1.4 s.
- **Push:** the base branch `mirai-probe/base-3c9def` pushed through glab's credential helper in 2.1 s.
- **Ship:** `opened`, MR !1, pushed, 9.3 s. Title `SAMPLE-1: A user deletes one of their tasks`, from `feature/SAMPLE-1-…` to the base branch, not a draft, opened. The description starts with the marker, has the review line `Review: PASS after 1 round (MIRAI)`, "QA hasn't run for this ticket", the ticket's path. It cites no file:line, as expected: the review had no findings.
- **The journal:** MR open, proofs valid at the head, the MR's URL recorded.
- **Again:** `unchanged`, same MR, no push, 6.2 s.
- **Edited on GitLab:** `updated`, same MR, no push, 7.0 s.
- **Closed:** refused `mr-closed`; the MR stayed closed.
- **The poisoned MR** (MR !2, its title and description full of every GitLab reference form and quick action: `/merge /close /approve /label /assign @all #1 !1 ~bug %v1 &1 $1 ^alert#1 *iteration:1 [[_TOC_]] [TOC] [issue:1] :tada:`): still opened, not a draft, no labels, no assignees; no reference links in the rendered description or title; 0 notes, 0 system notes; your pending to-dos 0 → 0. GitLab did return `description_html`, so the link check looked at real rendered HTML.
- **Tokens:** none of your GitLab secrets (taken from the helper in memory) or any token shape in the probe folder.
- **Cleanup:** both MRs and every probe branch deleted.

**Seen:** in "What changed", `$task),` and `[TaskController::class,` show as code spans. Both are the renderer's guards on purpose: `$` against math and snippet references (as in 27a), `[word:` against GitLab's bracket references (new in this unit). They read a little oddly; nothing renders from them.

**My worry that GitLab would link references in MR titles was unfounded:** the title kept `#1 !1 ~bug` as text, with no links in `title_html`.

## P2, a local GitLab CE with its own certificate authority

`test/probes/gitlab-ce/setup.sh` (log `~/mirai-27b-p2-setup.log`): the 2-day certificate authority made, `gitlab/gitlab-ce:19.5.1-ce.0` pulled and up in about 10 min, its certificate checked against the probe's authority, glab logged in as root with the token made inside the server, `ca_cert` set, the empty project `root/mirai-sample-app` made.

**First run: stopped at the poisoned MR, and found two things.** Everything up to it passed as on gitlab.com: auth with `ca /Users/…/.mirai-gitlab-ce/ca.pem`, the base branch pushed through the helper with that CA, `opened` → `unchanged` → `updated` → `mr-closed`. Then:

1. **A real bug: an MR opened right after its push was refused "source_branch does not exist".** GitLab registers a pushed branch in a background job; on a busy server it can lag the push by seconds (the branch was there for the cleanup). `mirai ship` pushes then opens straight away, so this would have hit users too. Fixed: `openMr` tries that one refusal again, about 30 s in all; a test plays it.
2. **A probe gap:** the project started empty, so the first probe branch pushed became its default branch, which GitLab wouldn't delete in the cleanup. Fixed in the probe: it pushes `main` and makes it the default when it isn't, and deletes `mirai-probe/*` branches a stopped run left behind.

**Second run** (`~/mirai-27b-p2.log`): passed.

- **Build and review:** baseline 559 s (the first run's was 1125 s, with GitLab still settling in Docker); handed over; Rex passed it in round 1 (7 turns, 0.25 min, Sonnet). No canary.
- **The project put right:** the default branch was the first run's `mirai-probe/base-74c013`; `main` pushed and made the default; the leftover branch deleted.
- **Auth and push with your own certificate authority:** glab logged in, `ca` the probe's `ca.pem` (1.9 s); the base branch pushed through glab's helper with git checking the server against that CA (1.5 s).
- **Ship:** `opened` (MR !2, 7.4 s), `unchanged` (6.1 s), `updated` after an edit on GitLab (5.9 s), refused `mr-closed` once closed. The journal has the MR open, proofs valid at the head, its URL.
- **The poisoned MR** (MR !3): opened, not a draft, no labels, no assignees, no reference links in the rendered description or title, 0 notes, to-dos 0 → 0, `description_html` there.
- **Certificate checks turned off** (`skip_tls_verify true` in glab's config): refused `tls-off`, before anything left.
- **`ca_cert` emptied:** refused `glab-auth`, before anything left: glab couldn't reach the server, which system trust doesn't know. The message said "isn't logged in", which was misleading here; it now says glab isn't logged in *or can't reach the server*, and the hint names `glab auth status` and `ca_cert`.
- **`ca_cert` put back:** got past auth and TLS to `mr-closed` (the MR from before, still closed), so the config was restored.
- **Tokens:** none of the server's secrets (from the helper, in memory) or any token shape in the probe folder.
- **Cleanup:** every MR and probe branch deleted, `main` kept.

**Found by Rex, fixed: a normal review's `index.json` didn't list the diff.** Rex's follow-up: "review.diff was not in the input folder (index.json lists only plan.md and ticket.md), so I reviewed the code at the checkout". The file was there; the folder's `index.json` was the plan stage's, written before MIRAI added `review.diff` and `review-files.json` (and in round 2, `delta.diff` and `prior-findings.json`). Rex's prompt says to read `index.json` first, so this time it believed the index. This dates from unit 24a and touched every normal-risk review (high-risk lenses build their own index). The index now names every file in the folder; the 24a review tests check it in round 1 and round 2 (they failed without the fix). P1's review raised nothing about it; whether it read the diff isn't recorded.

## After the merge: glab's version in `mirai init`

The sample app's `mirai init --refresh` showed `gitlab: …/glab (version unknown)`. glab reads, and makes, its config folder even for `--version`, and exits 2 when it can't; `glabVersion` ran it with the read-only `/var/empty` as HOME. Shipping wasn't affected (its version check runs with your glab config, as P1 and P2 showed); only `init`'s line and its "too old" warning were. Fixed: a throwaway config folder, removed after. A stand-in glab that, like the real one, exits 2 without a config folder it can make: the test failed before the fix and passes after.

## The sample app on 27b

- **Refreshed** (`9528664`, pushed; the pre-push check passed): `mirai init --refresh` recorded `glab` beside `gh` in the store's `host-tools.json`, `gitlab: /Users/jetmir.haxhisefa/.local/bin/glab (1.130.0)` (after the fix above; the first refresh showed "version unknown"). The framework copy's changed files are the eight 27b source files, each the same as MIRAI's merged code.
- **Red team: GREEN**, key `fae1f78835284f7a`, framework `594c403d8aee`, Claude Code 2.1.319 (kept; 2.1.322 is installed), 325 runs on 6 workers in 20 min 32 s (haiku), signed with `k-eea753565042f25b`; S1–S5 ok, cases ran under both templates. "Bash denied before it ran" for `w-git-config` and `a-claude`, as before.
- **Baseline** for `9528664`, signed: lint pass (49 s); unit 13/14 with `KnownFailureSeedTest` failing 10 of 10 (the known failure), coverage 31 of 35 lines in 8 files; frontend 5/6 with the planted `flaky-seed.test.ts` caught as flaky (failed 2 of 3), coverage 41 of 121 lines in 6 files; e2e 1/1 (90 s). One gap (reported): the playwright adapter has no coverage. The same as 27a's.
