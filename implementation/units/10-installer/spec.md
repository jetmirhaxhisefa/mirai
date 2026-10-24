---
unit: "10"
name: installer
status: approved (2026-10-24)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 10; D-02, D-03, D-37, D-47; R-M13, R2-M12, R3-M13, AR3-13; 01 §1; 03 "Installer", "Shared instructions", §8 (folder layout)
depends_on: ["03b", "05a", "07b"]
---

# Unit 10 — The installer, `mirai init`

## Why

MIRAI reaches a project by one command from a pinned version (D-03):
`npx github:<owner>/mirai#vX.Y.Z init`.

That command copies MIRAI into the project, and records in a lock file every file it put there
and whose each one is (D-02, D-37):
- **`framework`:** MIRAI's own files, as they are;
- **`rendered`:** generated from framework plus project data;
- **`project`:** yours.

From that lock, later units:
- build the trust root (unit 12);
- update safely (Milestone D);
- contribute back only what is really MIRAI's.

`init` also creates the MIRAI home for the repo, outside the project (D-47).

**Roadmap "done when":**
- a fresh install on the sample app;
- the lock lists every file with its mark;
- `AGENTS.md`'s MIRAI block is `rendered`;
- nothing MIRAI controls is written under `.git/`.

## Scope

**In:**
- **`mirai init [--branch <name>]`:**
  - copies the framework into `.mirai/framework/`;
  - writes `.mirai/config.toml` (when absent) and `.mirai/context/agents-local.md` (when
    absent);
  - renders MIRAI's block in `AGENTS.md`;
  - writes `.mirai/mirai.lock`;
  - creates the store in the MIRAI home (05a).
- **The lock format and a reader** (`readLock`, `checkLock`). Later units hash against the lock,
  so the reader is part of this unit.
- **The `AGENTS.md` block:** a framework template plus your `agents-local.md`, between two
  markers. The rest of `AGENTS.md` stays yours, untouched.
- **Install through `npx github:…`:** `package.json` already has the `bin` entry. This unit makes
  sure the package carries exactly what `init` needs.

**Out:**
- **The Claude Code files** (`CLAUDE.md`, `.claude/`): unit 11. They join the lock as
  `rendered`, through this unit's lock writer.
- **The trust root and protected paths:** unit 12.
- **Git hooks and `core.hooksPath`:** unit 26 (that write goes under `.git/`, which this unit
  never touches).
- **The signing key:** `mirai key new`, unit 06. `init` says to run it.
- **`/mirai-setup`** (detecting the stack, the interview, context files): later units.
- **`mirai update` and `mirai contribute`:** Milestone D.

## What `init` does

**It refuses, with nothing written:**
- outside a git repo;
- in a repo with no commit;
- in a shallow clone;
- when `.mirai/` or anything under it is a symbolic link;
- when MIRAI is already installed (a `mirai.lock` exists), with the hint "`mirai update` comes
  later";
- when `.mirai/framework/` exists without a lock;
- when the integration branch can't be found.

**The integration branch:** `--branch`, or else `origin`'s default branch (`origin/HEAD`), or
else the current branch. It must exist.

**In order:**
1. **Stage everything** in a temporary folder inside `.mirai/`, then move it into place, so a
   failure leaves nothing half-written.
2. **The framework copy:** MIRAI's runtime and registry, so hooks and CI can run the copy
   without `npx` (D-03):
   - `bin/`, `src/` and `registry/`;
   - `package.json` and `LICENSE`.

   Not tests, design or research.
3. **`.mirai/config.toml`:** `schema_version = 1` and `[git] integration_branch`. An existing
   config is kept, and must pass `checkConfig`.
4. **`.mirai/context/agents-local.md`:** a short stub for your own instructions, if absent.
5. **`AGENTS.md`:**
   - **The block:** MIRAI's block goes between `<!-- mirai:begin -->` and `<!-- mirai:end -->`.
     It is rendered from `registry/templates/agents-block.md` plus `agents-local.md`, and kept
     under 200 lines (03).
   - **The rest of the file:** an existing `AGENTS.md` keeps every line outside the block; a
     new one holds only the block.
6. **`.mirai/mirai.lock`** (JSON, D-40):
   ```json
   { "schema_version": 1, "mirai_version": "0.1.0",
     "files": {
       ".mirai/framework/src/cli/main.js": { "mark": "framework", "sha256": "…" },
       "AGENTS.md": { "mark": "rendered", "block": "mirai", "sha256": "…" },
       ".mirai/config.toml": { "mark": "project" } } }
   ```
   - **Every file `init` wrote or manages is listed.**
   - **`framework` and `rendered` entries carry their hash.** For `AGENTS.md`, it's the hash of
     the block only.
   - **`project` files carry no hash:** they're yours, and change freely.
7. **The store** (05a's `createStore`), in `<mirai-home>/<repo-id>/`.
8. **What it prints:** the files written, and the next steps:
   - commit them;
   - `mirai key new`;
   - `mirai lint`.

**It writes nothing under `.git/`**, and nothing outside the repo except the MIRAI home. It
never commits, and never runs a network call.

**`checkLock(root)`** compares the files with the lock. It returns the `framework` and
`rendered` files whose hash changed, or that are missing. `mirai doctor` (unit 29) and the
trust root (unit 12) will use it.

## Files

```
src/install/init.js          # the steps above
src/install/lock.js          # LOCK_SCHEMA, writeLock, readLock, checkLock, hashes
src/install/agents-block.js  # render and replace the AGENTS.md block
src/install/render.js        # the rendered files; `mirai render` (added after the review)
src/cli/commands/init.js
src/cli/commands/render.js
registry/templates/agents-block.md   # the framework part of the block
LICENSE                      # if the repo has none yet (decided in open point 5)
test/install/init.test.js
```

## Tests

| # | Test |
|---|---|
| T1 | **A fresh install on a sample repo** (a temporary git repo with a commit): the framework copy, config, context stub, `AGENTS.md` and lock are written, and the store exists; `node .mirai/framework/bin/mirai.js version` runs from the copy |
| T2 | **The lock lists every file with its mark:** each framework file `framework` with the right hash, `AGENTS.md` `rendered` (block hash), config and context `project`; `checkLock` is clean, and reports an edited framework file and an edited block |
| T3 | **`AGENTS.md`'s MIRAI block is `rendered`:** an existing `AGENTS.md` keeps its own lines; the block is between the markers; `agents-local.md` text appears in it |
| T4 | **Nothing is written under `.git/`:** every file there is unchanged (names, sizes, times) |
| T5 | Refusals, each with nothing written: not a repo, no commit, shallow, symlinked `.mirai`, already installed, a framework folder without a lock, an unknown `--branch` |
| T6 | The integration branch: `--branch`, `origin/HEAD`, the current branch; an existing valid config is kept, a broken one is refused |
| T7 | A failure partway (a file that can't be written) leaves no `.mirai/` changes behind |
| T8 | **On the sample app** (`mirai-sample-app`, a local copy): `mirai init`, then `mirai lint` and `mirai status` work there (recorded in `test-results.md`, not part of `npm test`) |

## Open points for you

1. **The framework copy is MIRAI's runtime** (`bin/`, `src/`, `registry/`, `package.json`), not
   only the registry. Hooks and CI then run `node .mirai/framework/bin/mirai.js` without `npx`
   (D-03, D-15), and the trust root copies it (unit 12). I recommend it.
2. **No keys, hooks or commits in `init`.** It prints `mirai key new` as a next step (a human-only
   command, unit 06). Hooks and `core.hooksPath` come in unit 26, so this unit writes nothing
   under `.git/`. You commit the files. I recommend it.
3. **No `.gitignore` entries for now.** The roadmap lists them, but D-47 moved
   `config.user.toml` and the cache out of the work tree, so nothing `init` writes needs
   ignoring. I recommend writing none, and adding them when a later unit needs one.
4. **Re-running `init` on an installed repo is refused.** Changing the version is
   `mirai update` (Milestone D). I recommend it.
5. **A licence for the framework copy.** MIRAI's repo has no `LICENSE` file yet, and the copy
   lands in every project. Which licence? D-02 says the repo will be public, so I recommend MIT
   (like the vetted sources we vendor), or you name another.
6. **How dogfooding starts.** We agreed to keep approvals in chat until `init` exists. After this
   unit is approved, I'll propose a short plan: installing MIRAI into its own repo, and which
   approvals move to `mirai approve`, for you to decide then. I recommend deciding it after this
   unit, not inside it.

## Changes after testing and review

Listed for your check before "UNIT APPROVED".

**Settled while building:**
1. **The lock's `files` is a list** of `{ path, mark, block?, sha256? }`, sorted by path. It
   replaces the object keyed by path shown above: a list can be checked by 09a's schema
   validator, and the same install always gives the same bytes. It is read with 09a's strict
   JSON parser, so a duplicate key is refused.
2. **The licence is MIT,** "Copyright (c) 2026 Jetmir Haxhisefa" (open point 5; you named no
   other). `package.json` now says `"license": "MIT"`, and lists the files the package ships
   (`bin`, `src`, `registry`, `LICENSE`, `README.md`) for `npx github:…`.
3. **An existing store for the repo is reused,** for example after `.mirai/` was deleted and
   `init` runs again. A store that fails its checks refuses the install.
4. **What happens on a failure:** every step is undone, newest first, and an existing
   `AGENTS.md` gets its old bytes and mode back. One undo step failing doesn't stop the others,
   and the first error is the one reported, naming what is left. A store `createStore` only half
   made is removed (a small fix in 05a's `createStore`).
5. **An existing config that names another branch than `--branch` is refused**
   (`branch-mismatch`), rather than silently ignoring one of them. An existing store set up for
   another branch is refused too (05a's own check).
6. **Your `agents-local.md` goes into the block without its HTML comments and its `#` title
   line,** so the block holds only the instructions. The title is only a first non-blank line
   starting `# `; comments inside a code fence are kept.
7. **`checkLock` also reports `added`:** files under `.mirai/framework/` that the lock doesn't
   list.

**Your decisions after the review:**

8. **The integration branch:** `--branch`, else the branch an existing `.mirai/config.toml`
   names, else the remote's default branch (`origin/HEAD`, or `<remote>/HEAD` for a repo whose
   only remote has another name). **Never just the current branch:** with none of these, `init`
   refuses and says `mirai init --branch main`. It prints where the branch came from, and says
   "commit them on `<branch>`". A clone without `origin/HEAD` (the sample app copy) needs
   `--branch`.
   - Taking an existing config's branch is my addition: that config is already your explicit
     choice.
9. **MIRAI's own git rules,** which revisit open point 3:
   - `.mirai/.gitignore` holds `!*`, so a rule elsewhere such as `*.lock` can't drop a MIRAI
     file;
   - `.mirai/.gitattributes` holds `* -text`, so line endings are never converted and the
     lock's hashes hold on every machine;
   - both are `framework` files in the lock;
   - after the files are in place, `git check-ignore` runs over every listed path. A rule that
     ignores `.mirai/` itself can't be undone from inside it, so then `init` refuses
     (`ignored`) and undoes everything;
   - an existing `.mirai/.gitignore` or `.gitattributes` that isn't MIRAI's is refused
     (`git-rules`).
10. **`mirai render`** (a new command; the pinned command list is updated). It renders the
    rendered files again from the installed framework copy plus your config and
    `agents-local.md`, and updates their lock entries through `updateLock`:
    - the template must match its lock hash, otherwise it refuses with `framework-changed`;
    - a block edited by hand is rendered again, with a warning;
    - nothing outside the block changes;
    - unit 11 adds its files (`CLAUDE.md`, `.claude/`) to it.
11. **The block goes first** in `AGENTS.md` (after a byte-order mark, if any), since some tools
    read only the start (Codex, 32 KiB):
    - an existing block is replaced where it is;
    - the block is at most 8 KiB, otherwise it refuses with `block-too-large`. This replaces
      the 200-line limit;
    - a warning comes when the whole file is over 32 KiB.

**Fixed from the review:**

12. **The branch is written as an escaped TOML string,** and the config is read back: its
    branch must equal the one asked for. A branch named `main"#x` used to pin `main`.
13. **The lock has more fields:**
    - **`source`:** `local` for a MIRAI working copy, else `v<version>`;
    - **`framework_sha256`:** one digest over the framework entries, checked on every read;
    - **`from` on rendered entries:** each input's path and hash, so a later check can tell a
      stale block from an edited one;
    - **a lock from a newer MIRAI** (a higher `schema_version`) gets its own code,
      `lock-newer`;
    - the entries are checked for marks: a `project` file has no hash, and only a `rendered`
      file has `block` or `from`.
14. **`AGENTS.md` is written in one step:** a new file beside it, then a rename over it. Its
    bytes and line endings outside the block are kept (a CRLF file gets a CRLF block). Before
    anything is written, the install refuses an `AGENTS.md` that:
    - isn't UTF-8 (`agents-encoding`);
    - can't be written (`not-writable`);
    - is a symbolic link. The hint covers the common case of an `AGENTS.md` that links to
      `CLAUDE.md`.
15. **Markers count only on a line of their own, at column 0, outside a code fence,** so an
    example in your text is never taken for MIRAI's block.
16. **`checkLock` refuses a symbolic link on the way to a listed file** (for example a linked
    `.mirai/framework/registry`), so it never reads files from outside the repo.
17. **`symbolicBranch` drops `--short`** (a short name can be ambiguous) and strips the exact
    prefix.
18. **The docs root goes into the block as plain text:** `$&` stays `$&`, and a backtick is
    refused (`docs-root-backtick`).
19. **The block's errors name their file,** and `BlockError` is a `MiraiError`, so unit 11 can
    use the same block for `CLAUDE.md`.
20. **The template's wording:** "Agents never edit `.mirai/`, `AGENTS.md` or `CLAUDE.md`; the
    owner changes the config and the project's own instructions". The claim "an edit is
    detected" is gone, since nothing detects edits yet.

**Noted for later units:**
- **Unit 11:** the Claude Code files join `mirai render` and the lock as `rendered`, with `from`.
- **Unit 12:** hooks and CI run the trust-root copy, not the work-tree copy (D-15). A branch can
  edit `.mirai/framework/`, so the work-tree copy is never trusted on its own.
- **Unit 26:** hook paths live under `.git/`, so they can't be lock entries; the trust root
  checks them instead.
- **Unit 29:** `mirai doctor` uses `checkLock`, `from` (stale or edited) and `lock-newer`
  (version skew). Also: sweeping a stale `.mirai/.init-*` folder left by a killed `init`.
- **Units 12, 26 and 29:** version skew between the lock's `mirai_version` and the running
  MIRAI.
- **`/mirai-setup`:** when it scans the stack, it excludes `.mirai/`.
- **Vendored code:** a vendored licence must be added to `FRAMEWORK_PARTS`.
  `src/lint/YAML-SUBSET.md` cites a `test/vendor` path that isn't in the copy; that's
  harmless, since it's only a reference.
- **The licence notice** ("Copyright (c) 2026 Jetmir Haxhisefa") lands in every project's
  copy, as MIT requires.
