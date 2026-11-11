---
unit: "27b"
date: 2026-11-11
claude_code: 2.1.319
result: 577/577 in the full suite · git probe all pass, with pushBranch-ca · P1 passed on its first run on gitlab.com · P2 pending
---

# Unit 27b — Test results

## Tests (`npm test`, no model, no network; a stand-in `glab` serving the API calls, a bare repo as the host's git)

New, in `test/ship/gitlab.test.js` (6), plus the changed `hostFor` case in `test/ship/ship.test.js` (gitlab now builds a host, and with no recorded glab is refused `no-glab`).

## The full suite

**577/577 pass** (25.5 min under `caffeinate -i`).

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

Pending.
