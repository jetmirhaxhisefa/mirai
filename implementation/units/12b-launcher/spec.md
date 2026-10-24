---
unit: "12b"
name: launcher
status: approved (2026-10-24)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 12b (added 2026-10-24); D-03, D-15
depends_on: ["10", "12"]
---

# Unit 12b — The `mirai` launcher

## Why

You want to type `mirai status`, not `node ~/Projects/mirai/bin/mirai.js status`. But a single
global MIRAI is wrong inside a project:
- **Version skew:** each repo pins its own framework copy (D-03). A global `mirai` would check a
  repo pinned to 0.1.0 with whatever version you have installed.
- **Running a branch's code:** the copy in the work tree can be changed by the branch you have
  checked out. An agent's branch can edit `.mirai/framework/**` and `mirai.lock` together, and
  they still agree with each other. Running that copy means running the agent's code, on your
  machine, with your rights.

So the launcher is a small, separate entry point. It finds the repo you're in, decides which
copy may run, and runs it.

**Roadmap "done when":**
- `mirai status` in two repos pinned to different versions runs each repo's own copy;
- a repo whose framework copy fails the check is refused, with a hint;
- outside a repo, only `init` and `--version` work.

## Scope

**In:**
- **`bin/launch.js`, a new entry point.** `package.json`'s `bin` points `mirai` at it, so
  `npx github:…#vX init` and a later global install both run the launcher.
  - `bin/mirai.js` stays the direct entry point. Hooks, CI and the trust root keep calling it,
    and it never delegates. Otherwise the trust root's copy would hand over to the work tree's.
- **What the launcher does** (in this order):
  1. **Outside a git repo, or in a repo without MIRAI:** it runs only `init`, `--version` and
     `--help`, from its own code. Anything else is refused: "MIRAI isn't installed here; run
     mirai init".
  2. **`init` (including `init --refresh`):** always runs the launcher's own code. A refresh
     means "give this repo the MIRAI I'm running".
  3. **Any other command in an installed repo:** it runs the repo's copy,
     `.mirai/framework/bin/mirai.js`, but only when that copy is one it may trust (open point 1).
     Otherwise it refuses with exit 4 and says why.
  4. **Running the copy:** a child process gets the same arguments, environment and terminal.
     Its exit code is passed on.
- **`mirai which`:** a launcher-only command. It prints which copy would run in this folder, and
  why (or why none may).
- **Putting it on your PATH.** No installer writes into your home folder. You either:
  - point your alias at the launcher, `alias mirai='node ~/Projects/mirai/bin/launch.js'`; or
  - once a release is tagged, run `npm install -g github:<owner>/mirai#vX.Y.Z`. That installs
    the launcher, and each repo still runs its own copy.
- **Making the framework copy auto-run** (open point 2): a core rule marks `.mirai/framework/**`
  and `.mirai/mirai.lock` as `auto-run`. A branch that changes them parks, and the run report
  warns you before you check it out.

**Out:**
- A launcher written in shell, or for Windows: it's a Node script, like the rest of MIRAI.
- Updating the launcher itself: that's `git pull` in MIRAI's repo, or a new global install.
- `mirai update` (Milestone D).

## Which copy may run

The repo's work-tree copy runs when its files are exactly one of:
- **(A) the integration branch's copy:** every file under `.mirai/framework/` matches, by hash,
  the framework entries of the lock committed on the integration branch. The branch is the one
  pinned in the store, never the work tree's config. Nothing is added or missing; or
- **(B) the launcher's own copy:** the same files as the MIRAI that's running. That's the state
  right after `mirai init --refresh`, before you commit it. Your own launcher is trusted by
  definition, since you put it on your PATH.

Anything else is refused with a hint:
- **On an agent's branch that changed MIRAI:** "this branch changed MIRAI's framework copy; read
  the change on the host first. To run it anyway: `node .mirai/framework/bin/mirai.js …`".
  Running the copy by its path stays your explicit choice.
- **On the integration branch with an edited copy:** "restore it: `git checkout -- .mirai`".

**The cost** (measured, see "Changes after testing and review"): about 0.35–0.4 s per command
on the sample app, on top of the command itself. Most of it is the second Node start, the hashes
of the work tree and of the sealed copy, and two to three git calls.

## Files

```
bin/launch.js                 # the launcher: find the repo, decide the copy, run it
src/launch/launch.js          # the decision (testable without spawning)
src/launch/runtime.js         # the sealed copy, built from git objects into the store
src/install/join.js           # mirai init --join
src/install/parts.js          # PACKAGE_ROOT and FRAMEWORK_PARTS, without init's imports
src/store/git.js              # + blobAt, commitAndBlob
src/store/home.js             # + readStoreMeta
registry/protected-paths/core.toml   # + the mirai-runtime auto-run rule
package.json                  # bin: mirai -> bin/launch.js
test/launch/launch.test.js
```

## Tests

| # | Test |
|---|---|
| T1 | **Two repos pinned to different versions** (fake packages 0.0.9 and the current one): `launch.js version` in each prints that repo's version; `launch.js status` runs there |
| T2 | **Refused copies:** an agent-style branch that edits a framework file and the lock together is refused (exit 4, with the hint); so is an edited copy on the integration branch. Running `node .mirai/framework/bin/mirai.js` directly still works |
| T3 | **Right after `init --refresh`, before the commit:** the copy equals the launcher's own, so commands run |
| T4 | **Outside a repo and in a repo without MIRAI:** `init`, `--version` and `--help` work; `status` is refused with "run mirai init" |
| T5 | **Pass-through:** arguments (with spaces and dashes), stdout, stderr and the exit code (0, 2, 4) come back unchanged |
| T6 | **`mirai which`:** says "the integration branch's copy", "this launcher's copy", or why none may run |
| T7 | **The new core rule:** a change to `.mirai/framework/src/x.js` or `.mirai/mirai.lock` is `auto-run` |
| T8 | **On the sample app** (recorded in `test-results.md`): you point your alias at the launcher; `mirai status`, `mirai lint` and `mirai which` work there, and the timing is recorded |

## Open points for you

1. **Which copy may run: (A) or (B), as described above.** The alternatives:
   - **always the trust root's copy:** the safest, but it needs a snapshot first, and refuses
     whenever your local `main` and `origin/main` differ. That would get in your way every day;
   - **the work-tree copy, checked only against its own lock:** this is the hole described
     under "Why".

   I recommend (A) or (B).
2. **Also mark the framework copy `auto-run`.** It runs when you type `mirai` in that checkout,
   which is what auto-run means. A MIRAI refresh MR already parks (it touches `.claude/`), so
   this adds no new stops for you. I recommend it.
3. **The launcher becomes `bin`.** `npx github:…#vX init` and global installs then go through
   it. For `init` it behaves exactly as today. I recommend it.

## Changes after testing and review

Listed for your check before "UNIT APPROVED".

**Your decisions after the review:**
1. **The launcher never runs MIRAI's code from the work tree** (both reviewers; the Tech Lead got
   swapped code to run with your rights in 9 of 40 tries):
   - for (A) it builds that commit's framework copy from git objects into a private, read-only
     folder in the store, `<repo-home>/store/runtime/<digest>/`. It's built once per version,
     checked against the commit's lock, and built again if it changed. The launcher runs that.
     The work tree's hashes only decide whether it may;
   - for (B) it runs its own code, in the same process.

   Re-running the attack: 0 of 40 ran the swapped code (25 refused, 15 clean).
2. **The commands that sign or start agents need (A):** `approve`, `drop`, `key`, `run`,
   `agent`, `handover`, `unpark` and `resume`. An uncommitted refresh, which is only (B), is
   refused for them with "commit the refresh on the integration branch first".
3. **`mirai init --join`** sets up only this machine's store, for a teammate's clone or your new
   machine. It never changes the repo. The integration branch is the one the config committed on
   that branch names; a branch can't nominate itself. You say yes in a real terminal, and it then
   reminds you to run `mirai key new`. The launcher's no-store hint now points to it.
4. **(A) also accepts older bases:** besides the integration branch's tip, the remote's tip
   (origin, or the only remote, as the repo id picks) and the commit where your branch left the
   integration branch. That covers a feature branch cut before a refresh merged, and a branch
   rebased onto `origin/main` while your local `main` is behind. These are looked at lazily, only
   when the first doesn't match.
5. **Your alias points at a clean release folder,** `~/Projects/mirai-release`, a clone you
   `git pull` after each approved, pushed unit. The steps are in the README.

**Fixed from the review:**
6. **A symbolic link in the copy is never trusted** (Tech Lead's exploit: a linked `bin/mirai.js`
   next to planted code ran it). This covers links inside the copy, a linked `.mirai` or
   `.mirai/framework`, and anything that isn't a regular file.
7. **The cache holds repo ids, not paths:** `<mirai-home>/launcher.json`, checkout → id. A hit is
   used only if the store's folder for that id is private and its record names that id and this
   checkout. Otherwise the repo id is worked out again.
8. **The launcher only reads the store, tolerantly:** its record (`store.json`) and the commits'
   locks, only the framework entries and their digest. It never writes the store's journal or
   record. A lock from a newer MIRAI still works; a store from a newer one gets "update the
   launcher".
9. **No store on this machine refuses before anything else** (except `--version` and `--help`),
   with the `--join` hint. When the repo pins a newer MIRAI than the launcher, it says so.
10. **Signals:** the launcher waits for the command when you press Ctrl-C (the terminal sends it
    to both), passes SIGTERM and SIGHUP on, and exits with the same signal.
11. **Two separate hints,** told apart by the current branch: "it was edited here; restore it:
    `git checkout -- .mirai`", or "this branch changed MIRAI's copy: read that change on the host
    first; to run it anyway: `node .mirai/framework/bin/mirai.js …`". The suggested command is
    quoted for the shell.
12. **`--version`, `--help` and `help` still answer when the copy may not run,** from the launcher,
    saying why.
13. **Smaller fixes:**
    - a lock that's there in any form, even a dangling link, counts as installed;
    - a too-large blob gives null, not an error;
    - the launcher loads a small `parts.js` instead of init's imports;
    - `update` already runs the launcher's own code (Milestone D);
    - the `mirai-runtime` rule's comment is right now.
14. **The docs:** D-03 (the `mirai` on PATH is the launcher; hooks and CI call the trust root's
    copy), the old `bin/mirai.mjs` note in round 1, roadmap row 12b, 03 §8 (`launcher.json`) and
    the README.

**Noted for later units:**
- **13:** deny agents the MIRAI home, including `launcher.json` and `store/runtime/`. Until then
  an interactive agent session could move `refs/heads/main` or edit those files.
  `Bash(mirai *)` doesn't catch `node …/launch.js`; the MIRAI-home deny is the real guard. Add it
  to the red-team list.
- **15, 19, 26, 54:** hooks, CI, the broker and `mirai agent run` from the broker call the trust
  root's copy by its full path, never the launcher. A test should keep `bin/mirai.js` from ever
  importing `src/launch`.
- **29:** `doctor` shows the launcher's version next to the repo's pin, checks `launcher.json`'s
  permissions, and prunes stale cache entries and old `store/runtime/` folders.
- **54:** `mirai-verify`'s "framework against the base lock" fails every refresh or update MR. It
  needs an update-MR path, like the key MR.
- **D-56 docs MR:** the orchestrator-merged docs MR must refuse any `.mirai/framework` or lock
  change. Otherwise (A)'s premise, that the integration branch holds only framework code you
  merged, has a hole.
- **70 (`mirai update`):** it leaves `.mirai/framework/` byte-equal to the release, with overlays
  in `custom/`. Otherwise the result is neither (A) nor (B).
- **Not done:**
  - a cache hit doesn't re-check the repo's first commits (a different repo cloned later at the
    same path would use the old store's branch);
  - a test that `mirai approve` through the launcher still sees a real terminal.
