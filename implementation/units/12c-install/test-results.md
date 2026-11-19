# Unit 12c: test results (2026-11-19)

## Tests

- **`test/install/release.test.js`:**
  - T1: package contents, no install scripts, no dependencies;
  - T2: `npm pack`, then `npm install -g` into an empty prefix. `mirai` is found through the
    PATH, `init` sets up a fresh repo, `which` and `status` run the pinned copy, and the
    uninstall leaves nothing;
  - T4: the release check;
  - T5: the release workflow.
- **`test/launch/launch.test.js` 12c T3:** version skew.
  - A launcher older than the pin is refused with `npm install -g github:jetmirhaxhisefa/mirai#v9.9.9`.
  - A newer one runs the pin, and `which` names `init --refresh`.
- **The full suite on the Mac:** 671/671, nothing skipped.
- **CI on PR #77:** Ubuntu, Node 22 and 24, green.
- **On Linux** (a local `node:22` container): the release workflow's install steps work
  (`npm pack`, `install -g`, `init`, `which`, `status`).

## Probes (real)

| Probe | Result |
|---|---|
| **P1 a new macOS user** | **pass.** The standard user `miraiprobe` was made by Jet and reached with `su - miraiprobe`. It had Homebrew's Node 26.13.0 and Apple git 2.50.1, and no MIRAI. It installed from the 12c branch, since `v0.2.0` can only be tagged after the merge; the mechanism is the same. See below. Jet then deleted the user and its home (`id miraiprobe`: no such user). |
| **P2 your own Mac** | After the merge and the `v0.2.0` release. |
| **P3 a wrong tag** | **pass.** The tag `v0.0.1-p3` on the 12c branch made the release check red: "the tag "v0.0.1-p3" isn't v0.2.0, package.json's version: bump the version in a PR first, or tag v0.2.0". The tag was deleted. |

**P1, step by step:**

1. **The first install:** `npm install -g github:jetmirhaxhisefa/mirai#unit/12c-install` failed
   with `EACCES`. The shared Homebrew Node's global folder belongs to Jet's user, the case
   `docs/install.md` covers.
2. **The doc's fix:** `npm config set prefix ~/.npm-global`, its PATH line, and a new shell.
   Then the install worked: "added 1 package in 6s".
3. **On the PATH:** `which mirai` gave `~/.npm-global/bin/mirai`, `mirai --version` gave
   `0.2.0`, and `mirai which` said "not inside a git repository".
4. **A fresh repo:**
   - `mirai init --branch main` installed MIRAI 0.2.0, made the store, installed the pre-push
     hook, and printed "teammates install MIRAI 0.2.0 with: npm install -g github:jetmirhaxhisefa/mirai#v0.2.0";
   - after the commit, `mirai which` named "the copy committed on main …, run sealed from the
     store";
   - `mirai status` printed "no tickets yet".
5. **The uninstall:** `npm uninstall -g mirai` gave "mirai not found", and
   `~/.npm-global/lib/node_modules` was empty.

## Found by P1, and fixed in `docs/install.md`

- **git needs your name and email:** a new user has none, and the first commit fails without
  them. The doc now lists them with Node and git.
- **npm's `EACCES` message suggests running as root.** The doc now says not to use `sudo`, and
  why.
