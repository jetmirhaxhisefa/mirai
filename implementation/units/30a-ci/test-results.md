# Unit 30a: test results (2026-11-19)

Each result names the commit it ran on (`unit/30a-ci`).

## Tests

- **`test/os/ci.test.js`:**
  - T1: marked tests;
  - T2: the left-out list;
  - T3: the module;
  - T5: the workflow is pinned, read-only and has no secrets, with Ubuntu on PRs and macOS on
    pushes only.
- **`test/os/guard.test.js`:**
  - T4: no system check outside `src/os/` beyond the list from before 30a (14 files);
  - a new check fails with its file and line;
  - a gone entry fails.
- **The full suite on your Mac:**
  - in this session at `b9fe967`: 666/666, "left out: none";
  - through the build runner's `tests` job at `96d3fb4` (`30a-tests`, 13.6 min): **666/666,
    0 skipped** (P3).

## Probes (real)

| Probe | Result |
|---|---|
| **P1 the first CI runs** | Four runs, on the PR's own pushes. Run 1 failed on all 4 jobs; each cause is below and was fixed. Run 3's Ubuntu jobs were green, and its macOS jobs were cancelled by GitHub ("not acquired by Runner … capacity constraints"). After Jet's change (decision 1), run 4 at `304a8fe`: **ubuntu (node 22) and ubuntu (node 24) green**, 519 passed, 146 left out and listed by reason; macOS skipped on the PR, as designed. At run 2, both macOS jobs were green (27–29 min). |
| **P2 a red PR** | Draft PR #76 (`probe/30a-red`) had a test that fails on purpose. Both required Ubuntu checks failed, and the PR's merge state was **BLOCKED**. Closed and its branch deleted; never merged. |
| **P3 your Mac** | The runner's `tests` job: 666/666, nothing skipped. |
| **Branch protection** | Jet set it on 2026-11-19 (`gh api … /branches/main/protection`). The required checks are `ubuntu (node 22)` and `ubuntu (node 24)`, through a PR with 0 approvals; `enforce_admins` is off, so Jet can merge past a red check. |

## What Ubuntu leaves out (146 in run 4, 147 from `17b92f7`)

| Need | Tests | Why |
|---|---|---|
| `macos` | 140 | An agent launch: its scratch folder is macOS's `/private/tmp` (`src/launch/strict.js`). |
| `macos` | 1 | The sealed copy runs a launch that reads macOS's per-user temp folders (launch T11). |
| `macos` | 2 | The process table is read the way macOS's `ps` reports it. |
| `macos` | 1 | Paths fold case as on macOS's disk (`src/launch/hook.js`). |
| `macos` | 2 | git's pinned settings point at `/var/empty`. |
| `cage` | 1 | The build runner's tests job runs inside `sandbox-exec`. Before `17b92f7` this was a plain skip, unlisted; now it's listed. |

P01 (`design/11`) turns these back on as it moves the code into `src/os/`.

## Found by CI, and fixed

1. **A test called BSD `stat -f`:** a Linux slip in test code (14c T1). It now uses
   `fs.statSync`.
2. **Git's background maintenance:**
   - **What:** GitHub's newer git starts it after a commit, and its `objects/maintenance.lock`
     came and went under `.git`. Three tests that check nothing was written under `.git` failed.
   - **The fix:** CI turns `maintenance.auto` and `gc.auto` off.
   - **Not hit yet:** your Mac's git doesn't do this. A newer git there would, so P01 should set
     it for the tests' repos.
3. **Two fixture repos were one repo:**
   - **What:** on Node 24, two test repos got identical first commits in the same second, so the
     same repo id, and `init` refused the second as a `second-checkout` (launch T6b).
   - **The fix:** each fixture's first commit names its folder.
4. **An overlap check set too high:** store T5 asked for more than 20 writer switches, and
   GitHub's 3-core Mac gave 13. Any more than 7 proves the writers overlapped, and that is now the
   bound.
5. **A hang on Ubuntu with Node 24:** launch T11 (signals through a launch) never finished. It's
   macOS-only code, so it's marked `macos`.

## Decision changed during the unit

Decision 1 was "both systems required". After runs 1–3, Jet chose Ubuntu required and macOS
advisory, run after a merge to `main`.

- **Why:**
  - GitHub's macOS jobs take about 30 minutes, against about 2 on Ubuntu;
  - twice, GitHub had no macOS machine;
  - they only repeat what the build runner already runs on the Mac.
- **The macOS gate** stays the build runner, as each unit's done-when says.
