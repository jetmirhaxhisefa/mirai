---
unit: "22"
date: 2026-11-04
result: 472 tests, all passing on the final code (no model run; the optional real build waits for the sample app's adapters)
---

# Unit 22 — Test results

## Probes

**None with a model.** Everything here is git, signing and MIRAI's state, tested with the stand-in `claude` on real repos. The optional real build, a step commit end to end on the sample app, waits for your adapter lines and baseline there.

## Tests (`npm test`, no model)

New, in `test/agent/build.test.js` (unit 22's T1–T7):

- **T1 + T2: every commit, and when MIRAI commits.**
  - Every MIRAI commit has your author, `MIRAI <mirai@localhost>` as committer, MIRAI's own subject, Kai's summary in the body, and the trailer last.
  - A planted `commit-msg` hook doesn't run.
  - The tree is clean after.
  - A handover with a failing test is committed; a safety stop (an undeclared protected path) isn't, and its files stay.
  - No author set: refused before anything.
- **T3 + T4: checkpoints and the branch record.**
  - The branch record's commit is checkpoint 1 and `baseline_revision`. It isn't moved by a second build step, which takes checkpoint 2 at the first step's commit.
  - `checkpoints.json` lists both.
  - `mirai branch verify` passes, and fails after the record is edited.
  - The registry has the record's commit as `creation_sha`.
- **T5: `mirai discard`.**
  - It needs a terminal, and a wrong typed key cancels.
  - It resets to the last checkpoint, removing Kai's new file and a stray one.
  - The ticket stays `in-progress`.
  - It's refused on another branch.
- **T6: G8.**
  - Plain by default.
  - A committed rule MIRAI can't run refuses until `commit_format` is set, and in a build it refuses at the branch record, before any launch.
  - `conventional` gives `feat(PMT-31): …`.
  - A trailer-like line in Kai's summary never ends the message: MIRAI's trailer does.
- **T7: `--recheck` on a committed step.** Docker down gives `needs-you`, committed. A recheck then gives `handed-over`. An edit after the commit is refused (`tree-changed`).

**Changed:**
- 21b's T2 now covers `prepareBranch`: the record commit, reuse, a dirty tree, a commit MIRAI didn't make, a bad pattern.
- 21b's T5 now expects a committed, clean tree after `checks-failed`.
- The pinned command list (`branch`, `discard`).

## After the reviews

472 tests, all passing on the final code; `test/agent/build.test.js` has 19. New for the review and re-review:
- **The committer and the commit:**
  - a repo's `[committer] email` doesn't change MIRAI's committer (the identity comes from the environment, and is read back);
  - a build touching `.mirai/records/` parks, declared or not;
  - an empty handover commits nothing.
- **The record, numbering, and takeover:**
  - a stale checkpoint ref is skipped in the numbering;
  - a crash between the record commit and its registration is taken over;
  - a record replayed onto a branch of the same name that starts with another commit is refused;
  - an unattended build that would make a branch is refused (`needs-terminal`);
  - a takeover with a commit MIRAI didn't make is refused, and registers nothing.
- **Discard and the commit's safeguards:**
  - `discard` refuses an `in-review` ticket;
  - with uncommitted changes it removes those only, then on a clean tree goes back to the checkpoint;
  - something writing into the project during MIRAI's test run makes the commit refuse (`changed-before-commit`), with `build.json` kept;
  - a name ending in `.` is refused before anything.

## Not proven

- **"A change right after the commit is refused":** the check is in `commitStep`, but no test makes something write in that window. The window before the commit is tested.
- **A real build's step commit on the sample app:** stand-in only, until its adapters are committed.
- **An agent's `git commit` being denied** is unit 13's, shown by the red-team cases. This unit adds no new case.
- **Signing at night:** records are signed with your key, from your terminal only (row 29b).
