---
unit: "22"
name: commits
status: draft (2026-11-04), waiting for SPEC APPROVED
roadmap: design/07-implementation-roadmap.md, row 22; design/01 §7 step 1, §11 ("Which branches the gates apply to"); D-15, D-17, D-24; R2-M4, R3-M8, R3-M10, AR3-4, TL2-7; G8; notes from 19a, 19b, 21b
depends_on: ["21b", "05b", "06", "14b", "17a"]
---

# Unit 22: MIRAI commits, and checkpoints every step

## Why

After 21b, Kai's work sits uncommitted on the ticket branch. That blocks everything after it:
- every launch refuses a dirty tree, so a fix round (21c) or a review (unit 24) can't start;
- "redo the step" has nothing to go back to;
- CI and the pre-push hook (unit 26) can't tell a MIRAI branch from yours.

This unit makes MIRAI the only committer on its branches, at fixed points, with the trailer. It sets a checkpoint ref before every step, registers each branch with a signed `branch.json`, and lets you throw a step's work away.

## Order (open point 1)

21b's spec left open whether 21c (fix rounds) comes before or after this unit. My recommendation: **this unit first.** With commits, a fix round starts from a clean tree, and 21c needs no exception to the clean-tree rule.

## Scope

**In.**

1. **Who commits:** MIRAI alone, with pinned git (unit 14b): no hooks, no signing program, no user config. Agents already can't commit (unit 13's denies, red-team cases `w-git-config` and others).
   - **Every commit has the trailer**, `Mirai-Ticket: <id>` (`[git] trailer`).
   - **The committer is MIRAI's identity**, which `pushScope` (05b) and the key rule (06) already look for.
   - **The author is you (open point 2).**
2. **When MIRAI commits** (the commit points, open point 3):
   1. **When it makes a ticket branch:** the first commit is the branch's signed `branch.json` (below).
   2. **After a build's handover that passed MIRAI's safety checks:** the launch's own checks, protected paths, dependencies and deleted files (21b's order). That holds whatever the test run said: `handed-over`, `checks-failed`, or `needs-you` for an environment reason. The commit records what Kai produced. Whether it was green is in `build.json` and, from unit 25, the signed proofs.
   3. **Never after a safety stop** (an undeclared protected path or dependency, a scope violation, a park, a refused run). Those files stay uncommitted for you, and `mirai discard` can remove them.
   - **The sequence at each commit point:**
     1. MIRAI checks again that the agent's process group is gone (19a);
     2. it stages everything git sees (tracked and new, never ignored);
     3. it commits;
     4. it checks that the tree is clean and the ignored files unchanged right after the commit (19a's note: killing the group isn't enough).
3. **The commit message.**
   - **Shape:** `{ticket}: {subject}`, then a blank line, Kai's summary as the body (from the handover, cleaned and capped), and the trailer last.
   - **The subject** is MIRAI's own words, never the agent's: "build from the approved plan", "branch record".
   - **G8 (17a, open point 4):** where `mirai detect` found that the project's commits follow Conventional Commits, the subject is `feat({ticket}): …`.
     - Where it found a committed commit-message rule (commitlint, a `commit-msg` hook), MIRAI can't run it, because that's the project's code. The first commit then refuses until you confirm the format: `[git] commit_format = "plain" | "conventional"` in the project config, which is committed so it's reviewed.
     - A rule on the code host is unit 39's.
4. **Checkpoint refs:** before every step, MIRAI sets `refs/mirai/checkpoints/<ticket>/<n>`, pointing at the commit the step starts from. They're listed in `<store>/tickets/<ticket>/checkpoints.json`, with the step, the time and the commit.
   - The first one, the branch record's commit, is the ticket's `baseline_revision` for unit 23's red check. It's never moved.
   - Refs under `refs/mirai/` are never pushed: unit 46 pushes branches by name.
5. **Registration and `branch.json`** (R3-M10, AR3-4).
   - **The branch record:** when MIRAI makes a ticket branch (21b's `ensureBranch`), its first commit adds `.mirai/branch.json`: `{ schema, ticket, branch, base_sha, created_at }`, signed with your key under `mirai/branch-record/1:<repo>`.
   - **The store's registry:** the branch is then registered (05b's `registerBranch`), with that commit as its `creation_sha`.
   - **Verification:** `mirai branch verify [<branch>]` checks the record with the integration branch's public keys, as CI will.
   - **An existing branch** is used only if it's registered and every commit beyond its base is MIRAI's: the trailer and MIRAI's committer. This replaces 21b's "no commits of its own".
6. **Throwing a step away: `mirai discard <ticket>`.** In a real terminal, with the ticket's key typed back.
   - It resets the ticket branch to its last checkpoint, removes new files git sees, and lists the ignored files that changed, which it never deletes.
   - It's refused unless the checkout is on that ticket's branch.
   - It writes a journal line. The ticket stays `in-progress`.
7. **`--recheck` (21b) on a committed step:** the tree must be clean, and HEAD must be the step's commit. The fingerprint is no longer needed there.
8. **`build.json` and the run log:** each step's commit id, and its checkpoint.
9. **Docs:** `docs/agents.md` (the commit points, discard), `docs/signing.md` (the branch record's context), the roadmap.

**Out:**
- **21c:** fix rounds.
- **23:** the stub step, the red check against `baseline_revision`.
- **25:** signed proofs.
- **26:** git hooks, checking the trailer on every commit at push.
- **46:** push and `handover.json`.
- **Unit 39:** commit rules on the code host.
- **D2:** stacking, a child branch from its parent.

## Probes

None with a model. Everything here is git, signing and MIRAI's own state, testable with the stand-in. One optional run at the end, with your OK: a real `mirai build` on the sample app once its test adapters are committed, to see a step commit end to end. That's 1 Sonnet launch.

## Files

- **New:**
  - `src/agent/commit.js` (commit points, message, identity, the after-commit check);
  - `src/agent/checkpoints.js`;
  - `src/store/branch-record.js` (sign, verify);
  - `src/cli/commands/discard.js`;
  - `src/cli/commands/branch.js` (`verify`);
  - tests in `test/agent/`.
- **Changed:**
  - `src/agent/build.js`, `src/agent/branch.js`;
  - `src/store/git.js` (stage, commit, update-ref, reset: pinned);
  - `src/config/config-schema.js` (`[git] commit_format`, your author identity in the personal config);
  - `docs/agents.md`, `docs/signing.md`, the roadmap.

## Tests (`npm test`, no model)

- **T1.** Every MIRAI commit:
  - has the trailer, MIRAI's committer and your author;
  - is made with no hook running (a planted `commit-msg` hook doesn't run);
  - leaves a clean tree.

  A change appearing right after the commit is refused.
- **T2.** The commit points:
  - a branch's first commit is its signed record;
  - a handover that passed the safety checks is committed, even with failing tests;
  - a safety stop isn't committed, and its files stay.
- **T3.** A checkpoint ref is set before each step, and the first one never moves. `checkpoints.json` lists them.
- **T4.**
  - `branch.json` verifies with the integration branch's keys; an edited one fails;
  - the branch is registered with its creation commit;
  - an existing branch with a commit that isn't MIRAI's is refused.
- **T5.** `mirai discard`:
  - it needs a terminal and the typed key;
  - it resets to the last checkpoint and removes new files;
  - it lists ignored files and leaves them;
  - it's refused on another branch.
- **T6.** G8:
  - Conventional Commits gives a `feat(...)` subject;
  - a committed rule refuses the first commit until `commit_format` is set;
  - the subject is never the agent's text.
- **T7.** `--recheck` on a committed step: a clean tree at the step's commit; anything else is refused.

## Done when

- Every MIRAI commit carries the trailer and MIRAI's committer, and respects the project's format where 17a found one (G8).
- An agent's `git commit` is denied: unit 13's denies, shown again by the red-team cases.
- A registered branch's commits are made only by MIRAI.
- Every step has a checkpoint ref.
- `branch.json` verifies with the public key.

## Open points for you

1. **Order: 22 before 21c.** My recommendation: yes. The fix rounds then start from MIRAI's commit, and no launch needs an exception to the clean-tree rule.
2. **Author and committer.** My recommendation:
   - **Author:** you, from a name and email in your personal MIRAI config (`~/.config/mirai/config.toml`, `[git] author_name`, `author_email`), set once. If they aren't set, MIRAI refuses rather than guessing.
   - **Committer:** MIRAI (`MIRAI <mirai@localhost>`, or `[git] committer_email` if your host needs a real address).

   The commits are then credited to you, and each one is marked as made by MIRAI.
3. **Commit after every handover that passed the safety checks, not only green ones.** design/01 says "after each green step". My recommendation: commit any handover that passed the safety checks, with the test outcome in `build.json`.
   - **Why:** the next step (a fix round, a review) needs a clean tree, and the commit is the record of what the agent produced.
   - **What a commit doesn't mean:** passing. That's what the gate and the proofs say, from units 25 and 26.
   - **What's never committed:** a safety stop.
4. **G8.** My recommendation:
   - follow Conventional Commits where the history shows them;
   - where a committed rule exists that MIRAI can't run, refuse until you set `commit_format` once in the project config;
   - leave host rules to unit 39.
5. **Signing `branch.json` with your key, in your terminal.** The orchestrator at night (unit 28) needs a key too. That's row 29b's machine key, so this unit signs only from your terminal. My recommendation: yes. Nothing unattended makes branches before unit 28.

## Changes after testing and review

1. **What each step's checks are measured from:** the step's checkpoint (`step_base`), so only that step's work is judged. The baseline that judges the tests is still the branch's base commit, the integration commit.
2. **`prepareBranch` checks your identity and the commit format before it switches anything,** so a refusal there leaves no half-made branch behind.
3. **An existing branch with no commits and no registration** (21b's kind) is started again with a record. A branch with commits but no registration is refused (`branch-not-mirai`).
4. **`--recheck` keeps 21b's fingerprint,** taken again after the commit, beside the step's commit as `head`. It doesn't rely on HEAD alone.
5. **From the review (Tech Lead and Architect):**
   - **High, the record's path:** it's D-15's `.mirai/records/<ticket>/branch.json`, not `.mirai/branch.json`. One path per ticket means no add/add conflict between MRs, and a record counts only as the first commit after its base, with that base as parent, so it can't be replayed. `mirai branch verify` checks that. A build that touches `.mirai/records/` or `.mirai/keys/` parks, declared or not: the headless templates don't deny the folder, and changing them would change the red-team key.
   - **High, what's committed:** exactly what passed the checks. The tree is looked at again right before the commit (`changed-before-commit`), a nested repo is refused, and the ignored files are compared after the commit. The checked fingerprint is kept beside the post-commit one. Tests run on a copy (14c), so they can't add files, contrary to one reviewer's reading.
   - **High, records reaching `main`, and the push signals:** recorded for units 26, 25/54, 46/54 and D2 in D-15's update, not changed here.
   - **High, discard:**
     - it holds the run lock;
     - it needs `in-progress`;
     - it only goes back to a checkpoint in the branch's history;
     - it clears the step's commit and fingerprint in `build.json`.
   - **The committer:** passed as `GIT_COMMITTER_*` and `GIT_AUTHOR_*`, which beat a repo's `[committer]` config, and read back after the commit. `committer_email` moved to the project config, since CI and every machine must agree.
   - **Checkpoints:**
     - added only once a launch has run;
     - tied to the branch's creation commit;
     - numbered past any ref already there.
   - **Smaller fixes:**
     - an empty handover commits nothing (`commit: null`);
     - your key is loaded only when a branch is made, and refused unattended (`needs-terminal`);
     - a crash between the record's commit and its registration is taken over;
     - the foreign-commit check fails closed (unreadable, or over 500 commits) and reads the trailer from the last paragraph;
     - `--recheck` commits a safe tree that wasn't committed;
     - a ticket key that can't name a ref is refused;
     - `branch verify` checks the name first.
   - **Dropped from the spec: "checks again that the process group is gone".** The launch only ends once its group is gone, and survivors or suspects already refuse it (19a). The check right before the commit (the tree looked at again) covers what a leftover would write.
   - **For 21c:** after a discard, or any reset to a checkpoint, start a fresh session, never resume one.
6. **From the independent re-review of the fixes:**
   - **Medium: names git strips.** Git trims `. , : ; " ' \` and spaces from both ends of a name or email, so the read-back failed after the commit was made. Such values are refused in the config.
   - **Medium: registration order.** The crash takeover registers the branch last, after the foreign-commit check, so a refused takeover leaves nothing registered.
   - **`verifyBranchAt` checks the record's blob at the tip** against the one the first commit added.
   - **`discard`:**
     - with uncommitted changes it removes those only, keeping the step's commit (a launch cut short adds no checkpoint); a clean tree goes back to the checkpoint;
     - it prints a crashed run's note, and refuses while a leftover process may still be writing.
   - **The docs say the committer check is a convention, not proof.**
