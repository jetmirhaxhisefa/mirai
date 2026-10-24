---
unit: "12b"
name: launcher
date: 2026-10-25
node: v22.23.2
result: 195 / 195 pass (earlier units' 181 + unit 12b's 14), after the review fixes; 5 full runs in a row green after the lock fix
---

# Unit 12b — Test results

## Run

`npm test`, after the review fixes (`review.md`). The new file, `test/launch/launch.test.js`:

```
T1: each repo runs its own pinned copy
T2: a copy that is neither the integration branch's nor the launcher's is refused
T2b: links, a forged cache and a newer lock are refused with their own reasons
T2c: the hint says what to do on the integration branch and on another branch, quoted for the shell
T3: right after init --refresh, before the commit, the copy is the launcher's own
T4: outside a repo, and in a repo without MIRAI, only init, --version and --help
T5: arguments, output and exit codes pass through
T6: mirai which says which copy runs, and why
T6b: the launcher's store cache is checked, never trusted
T7: a change to MIRAI's own code is auto-run
T9: the sealed copy runs committed bytes, and is built again when changed
T10: older bases (where the branch left main, origin/main) count; signing needs a committed copy
T11: links and added files in the copy are refused; arguments and signals pass through
T12: init --join sets up only this machine's store, for the branch the committed config names
# tests 195
# pass 195
# fail 0
```

**A flaky failure, found and fixed.** One in seven full runs failed, in unit 12's snapshot T6b
(three snapshot builders at once).
- **Cause:** a lock file read in the instant between its creation and its owner's pid being
  written was taken for a dead owner's.
- **Fix:** a lock with no pid yet counts as held.
- **After the fix:** 8 runs of the snapshot tests alone and 5 full runs in a row, all green.

**Earlier tests changed:**
- `test/install/init.test.js`, `test/adapters/claude-code.test.js`: none.
- The snapshot lock fix is in unit 12's `src/trust/snapshot.js`; its tests are unchanged.

## The roadmap's "done when", mapped

| Done when | Test |
|---|---|
| `mirai status` in two repos pinned to different versions runs each repo's own copy | T1 (0.0.9 and the current version) |
| A repo whose framework copy fails the check is refused, with a hint | T2, T2b, T2c, T11 |
| Outside a repo only `init` and `--version` (and `--help`) work | T4 |

## The swap race (the reviewers' blocking finding), re-run

**The attack:** one process swaps `.mirai/framework/src/cli/commands/version.js` between the
real file and an injected one every 15 ms, while `mirai version` runs 40 times (scratch repo,
temporary HOME).

| | Injected code ran | Refused | Clean |
|---|---|---|---|
| Before (Tech Lead's runs) | 8 and 9 of 40 | — | — |
| Now | **0 of 40** | 25 | 15 |

The refusals are the times the check saw the injected file. When it saw the real one, the
launcher ran the sealed copy from the store, never the work tree.

## T8: the sample app (a copy, not part of `npm test`)

**Setup.** `~/Projects/mirai-sample-app` (your commit `30b0271`) was copied to the scratchpad and
used with a temporary HOME. The original wasn't touched.

- **No store on this machine:**
  ```
  mirai: this machine has no MIRAI store for this repo, so the integration branch is unknown
  run: mirai init --join (it sets up this machine's store, without changing the repo)
  ```
- **After `init --refresh` and a commit in the copy**, `mirai which` gave:
  ```
  runs: …/mirai-sample-app-2baa88034aec/store/runtime/3801ee86…/bin/mirai.js
  why: the copy committed on main (e831be79f101), run sealed from the store
  ```
- **`status`, `lint` and `config check`:** exit 0.
- **`trust snapshot`:** exit 4, "push or pull main first". That's correct: the copy's commit wasn't
  pushed.
- **Timing, `mirai status`:**
  - through the launcher: 0.81–0.95 s;
  - run directly: 0.46 s;
  - so about 0.35–0.4 s overhead, from a second Node start, hashing the work tree and the sealed
    copy, and two to three git calls. That's the price of never running work-tree code.
