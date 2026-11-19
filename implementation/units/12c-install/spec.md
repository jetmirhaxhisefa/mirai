---
unit: "12c"
name: install
status: approved (Jet, 2026-11-19: "approve 12c"; decisions 1–3 from his answers the same day)
roadmap: design/07-implementation-roadmap.md, row 12c; 12b's open item; D-03, D-62
depends_on: ["10", "12b", "30a"]
---

# Unit 12c: Install MIRAI with one command, and `mirai` on your PATH

## Why

Today MIRAI runs by its full path from a development checkout:
`node ~/Projects/mirai/bin/launch.js plan SAMPLE-49`. That works only on the Mac MIRAI is built
on.

- **What you said:** Jet, 2026-11-16, at the pilot: "very important that MIRAI gets installed with
  a command".
- **Who needs it:** each of D-62's teammates needs a real install, and every new project needs
  one.

12b already made the launcher safe to put on your PATH: in a repo, it runs only that repo's
pinned, committed copy. 12c makes it installable, versioned and released.

## Decisions (Jet, 2026-11-19)

1. **Install with npm from a GitHub tag:**

   ```bash
   npm install -g github:jetmirhaxhisefa/mirai#v0.2.0
   ```

   - It needs only Node and git, which MIRAI already requires.
   - There's no registry account: the repo is public, and the tag names the exact version.
2. **A release is cut when you decide, with one command:**
   - Any unit's PR may bump the version.
   - You release with `gh release create vX.Y.Z --target main --generate-notes`.
   - CI checks that the tag matches `package.json` before teammates install it.
3. **The proof is a new macOS user on this Mac.** It has an empty home and no MIRAI anywhere. You
   create it, run the steps I give you, and delete it after.

## Scope

**In**

1. **What a release contains:**
   - `package.json` gets a `repository` field. Its `files` list stays `bin`, `src`, `registry`,
     `LICENSE` and `README.md`.
   - **No install scripts:** `preinstall`, `install`, `postinstall` and `prepare` are refused by a
     test. Installing MIRAI runs none of its code.
   - **No dependencies,** as today.
2. **The release check** (`.github/workflows/release.yml`, on a pushed `v*` tag):
   - **What it does:** checks the tag equals `v` + `package.json`'s version, runs the Ubuntu tests,
     and installs the tagged package into a temporary npm prefix. It then runs `mirai --version`
     and `mirai init` in a fresh repo.
   - **Where it shows:** a failure is red on the release.
   - **Permissions:** read-only, like `ci.yml`.
   - **Your one command for a release:** `docs/releasing.md` gives it. A bump goes through a PR
     first, as `main` is protected.
3. **`mirai` on your PATH, from any folder:**
   - `npm install -g` links `package.json`'s `bin` entry (`mirai` → `bin/launch.js`) into npm's
     global bin folder. That folder is on your PATH with nvm and with Homebrew's Node. With your own
     npm prefix, `docs/install.md` gives the PATH line.
   - A new terminal then runs `mirai` from any folder, in any repo. There's no alias, and nothing
     per repo or per project.
4. **The launcher, installed globally (12b's rules unchanged):**
   - **Outside a repo:** `init`, `--version`, `help` and `which` work, as today.
   - **In an installed repo:** it runs the repo's pinned, committed copy, never its own code for
     the repo's commands.
   - **Version skew:**
     - **A launcher older than the repo's pinned copy** is refused. The message names the
       pinned version and the one command that updates the launcher:
       `npm install -g github:jetmirhaxhisefa/mirai#v<pinned>`.
     - **A newer launcher** runs the pinned copy as today. `mirai which` adds one line:
       "this repo pins <v>; `mirai init --refresh` moves it to <launcher's>".
   - **Today's "store written by a newer MIRAI" refusal** names the same install command.
5. **`mirai init` names the install command:** at the end of `init`, it prints
   the command a teammate runs, for the version just installed. `docs/install.md` has it too.
6. **Nothing else in your home:**
   - npm writes only under its prefix: the `mirai` link and the package folder.
   - MIRAI's store is made in `~/Library/Application Support/mirai` only on first use, as today.
   - `npm uninstall -g mirai` removes the link and the package. `docs/install.md` says how to
     remove the store too, if you want.
7. **Docs:**
   - `docs/install.md`:
     - the command;
     - Node and git first;
     - npm's `EACCES` on a shared Homebrew or system Node: `npm config set prefix ~/.npm-global`
       and a PATH line;
     - nvm: a global install belongs to one Node version;
     - updating, and uninstalling.
   - The README's first lines: the install command.
   - `docs/releasing.md`.
   - Every doc that says `node ~/Projects/mirai/bin/launch.js` says `mirai`. The build runner
     and MIRAI's own development keep the checkout.
8. **The first release, v0.2.0,** cut by you once 12c is merged. The probe installs it.

**Out**

- The npm registry, Homebrew, and install scripts (decision 1).
- Automatic updates, and any "check for a new version" call. The launcher never calls the
  network.
- Ubuntu and WSL installs: P01. The launcher installs there, but `init` says "not supported yet"
  through 30a's module.

## Tests

- **T1 Package contents:**
  - `npm pack --dry-run --json` lists only `bin/`, `src/`, `registry/`, `LICENSE`, `README.md` and
    `package.json`;
  - no test, no `implementation/`, no `.github/`;
  - no install-time script;
  - no dependencies.
- **T2 Installed from a tarball** (`npm pack`, then `npm install -g` into a temporary prefix):
  - `mirai --version` prints the package's version;
  - `mirai which` works outside a repo;
  - `mirai init` in a fresh repo installs MIRAI and prints the install command;
  - `mirai status` there runs the pinned copy.
  - Uninstall leaves the prefix as it was.
- **T3 Skew:**
  - a launcher at 0.2.0 in a repo pinned at 0.3.0 is refused with
    `npm install -g github:…#v0.3.0`;
  - a launcher at 0.3.0 in a repo pinned at 0.2.0 runs the pinned copy, and `which` names the
    refresh;
  - the same version runs as today.
- **T4 The release check:** the script the workflow runs refuses a tag that doesn't match the
  version, and accepts one that does.
- **T5 The workflow file:** pinned actions, read-only permissions, triggered only on `v*` tags,
  no secrets (as 30a's T5).

## Probes (real)

- **P1 A new macOS user (decision 3).** You create a standard user and log in to it. In
  Terminal, from the steps I give you:
  - put Homebrew's Node on the PATH, and set npm's prefix in that home;
  - run the one install command for `v0.2.0`;
  - open a new terminal tab and check `mirai --version` from the home folder, so it's on the
    PATH, not run by a path;
  - `git init` a fresh repo with one commit, then `mirai init`, `mirai which` and `mirai status`;
  - `npm uninstall -g mirai`.

  **Pass when:** each step works as `docs/install.md` says, with no step missing from the doc,
  and the uninstall leaves no `mirai` on the PATH. Then you log out and delete the user.
- **P2 Your own Mac:** you install `v0.2.0` globally. In the sample app, `mirai status` runs its
  pinned copy. In Thudos, you get the skew refusal or the run, as its pinned version says. The
  full-path commands stop being needed.
- **P3 A release that's wrong:** a tag on a throwaway branch that doesn't match `package.json`
  makes the release check go red. The tag is then deleted.

## Done when

- T1–T5 pass, and the full suite passes through the build runner and CI.
- P1, P2 and P3 pass.
- The roadmap row's done-when holds:
  - on a clean account with only Node and git, one command installs `mirai`, and a new terminal
    runs it from any folder;
  - `mirai init` installs MIRAI into a fresh repo;
  - `mirai which` names the pinned copy;
  - an older global launcher is refused with the update command;
  - uninstall leaves nothing behind.
