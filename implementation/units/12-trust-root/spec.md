---
unit: "12"
name: trust-root
status: approved (2026-10-24)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 12; D-15, D-37, D-47, D-54; R-C2, R2-C1, R2-M6, R2-M10, R3-C1, R3-C4, R3-M2, R3-M9, TL3-7, TL3-12, AR3-12; 03 §8 (folder layout)
depends_on: ["05a", "10", "11"]
---

# Unit 12 — The trust root and protected paths

## Why

The gate must not be editable by the branch it checks (R-C2, R2-C1). An agent works in the work
tree, and can change anything there, including MIRAI's own files: the framework copy, the
config, the lint configs, the tool files. If hooks, gates and launches read those files from the
work tree, an agent can loosen the rules that check it.

So MIRAI uses two defences (D-15):
- **The trust root:** at run start, a snapshot of MIRAI's files **from the integration branch's
  commit**, never from the work tree or a parent branch. It's kept outside the project, hashed,
  and checked again before every launch. Hooks, gates and launches read the snapshot.
- **Protected paths:** a change that touches a file able to change MIRAI's rules, hide code from
  review, or run on its own is forced to `high` risk. Changes to files that run by themselves
  (`.vscode/`, `.husky/`, …) park in both presets, and the report warns you before you open the
  branch in your IDE.

**Roadmap "done when":**
- a branch that edits a lint config, a compose override, a `.gitattributes` `-diff` rule, a
  `.vscode` task or a nested `CLAUDE.md` gets `high` risk;
- a tampered trust-root file is detected at the next launch;
- hooks and gates read the snapshot, not the work tree;
- the report warns before you open such a branch in your IDE.

## Scope

**In:**
- **The snapshot** (`src/trust/snapshot.js`): `snapshot({ cwd, env })` builds the trust root for
  the integration branch's current commit:
  - **the base commit:** the integration branch pinned in the store (never the work tree's
    config, 05a);
  - **read from git objects, not the work tree** (`ls-tree` and `cat-file`, no checkout), so
    uncommitted or untracked changes can't reach it;
  - **verified against the base commit's own lock:** every framework file's hash, and the
    bundle's `sharedHash` against `bundles` (unit 11). A mismatch refuses: someone committed an
    edited copy, or a config change without `mirai render`;
  - **its own rendered copies** (D-37: committed rendered files are never inputs): the headless
    plugin folder is built from the snapshot's registry and config, through unit 11's
    `buildBundle` and `writePluginDir`;
  - **made read-only** (files 0444, folders 0555) and hashed into a manifest. The manifest's hash
    goes into the store, which agents can't read (D-47).
- **The re-hash** (`verifyTrustRoot(trust)`): every file against the manifest, the manifest
  against the store, nothing added or missing. Unit 19 calls it before every launch; any
  mismatch stops the run.
- **Reading from the snapshot** (`trustedFile`, `trustedConfig`, `trustedRegistry`), so gates
  and hooks (units 25, 26) never read MIRAI's files from the work tree.
- **Protected paths** (`src/trust/protected.js`):
  - **the rules are data:** `registry/protected-paths/`, checked by a schema, part of the
    framework copy and so of the snapshot. A project can add rules in `[gate] protected` (read
    from the snapshot's config), never remove the built-in ones;
  - **two classes:**
    - **`protected`:** forced to `high` risk;
    - **`auto-run`:** files that run by themselves when you open or install the branch. Also
      `high`, and they park in both presets (D-54), with a report warning;
  - **`changedPaths`:** the paths a change touches, from git, with rename detection off (so a
    rename counts as both paths), and with pinned diff options (`--no-ext-diff`,
    `--no-textconv`). Either between two commits, or between the base and the work tree,
    including untracked files (after an agent launch, D-15);
  - **`classify(changes, rules, { declared, actor })`** → the touched protected paths with their
    rule and class, and which of them the plan didn't declare (R3-M2);
  - **content checks** where a path alone can't tell:
    - `package.json` lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`, …)
      changed is `auto-run`; any other `package.json` change is `protected` (a dependency
      manifest);
    - a file `@`-imported by a new or changed `CLAUDE.md` or `AGENTS.md`, at any depth, is
      `protected` (R3-M9).
- **A glob matcher** (`src/util/glob.js`) for the rules and `[gate]` patterns: `*`, `**`, `?`,
  `!` negation, matching the way `.gitignore` does for these forms. No glob library.
- **The CLI:**
  - `mirai trust snapshot` builds the trust root and prints its base commit and manifest hash;
  - `mirai trust check` re-hashes it;
  - `mirai protected [<base>..<head>]` lists the protected paths a change touches (default: the
    integration branch's commit against your work tree), with their class and rule.
- **The report warning:** `classify`'s `auto-run` paths are the input to 09b's
  `branch_warnings`. A test renders them through the run report.

**Out:**
- **Calling the re-hash before each launch:** unit 19 (the launcher). This unit provides it and
  tests that tampering is caught.
- **The floor guard and parking:** units 20 and 23 act on `classify`'s verdict. This unit decides
  the verdict.
- **Hooks reading the snapshot:** unit 26 writes the hooks. This unit gives them the API, and
  tests it against a work tree that disagrees.
- **Compose inputs in the snapshot:** unit 14 adds them to the manifest.
- **The read-only export of skills for agents, and the sandbox rules** that keep agents out of
  the trust root and store: unit 13 (`denyWrite`/`denyRead`). The snapshot is readable and
  write-protected by its modes; the sandbox is the real guard.
- **The git-integrity hash** (`core.hooksPath`, `.git/config`, D-54): unit 26.

## The snapshot

```
<mirai-home>/<repo-id>/trust/<base-sha>/      # read-only
  manifest.json          # { schema_version, base_sha, branch, created_at, files: [{ path, sha256 }], bundles }
  tree/                  # from the base commit, byte for byte
    .mirai/framework/…   # the framework copy
    .mirai/mirai.lock
    .mirai/config.toml
    .mirai/context/…     # agents-local.md and later context files
    .mirai/custom/…      # unit 37's overlays, when there are any
    AGENTS.md, CLAUDE.md # and every file they @-import (for unit 24's reviewer, R3-M9)
  plugins/claude-code/   # rendered from tree/: skills/, agents/ (unit 11's headless placement)
<mirai-home>/<repo-id>/store/trust.json       # { base_sha, manifest_sha256 } per snapshot
```

- **A new snapshot per base commit.** If one exists and passes the re-hash, it's reused.
- **Old snapshots** are removed when there are more than 10, except the one in use (open point 4).
- **Refusals before anything is written:**
  - the base commit has no lock (MIRAI isn't committed on the integration branch yet);
  - a framework file doesn't match the base lock;
  - the bundle doesn't match the base lock's `bundles`;
  - a blob is missing, or larger than a limit;
  - the base has a symbolic link where MIRAI's files are.

## Protected paths: the built-in rules

From D-15, in `registry/protected-paths/`:

| Class | Paths |
|---|---|
| `protected` | **MIRAI's own:** `.mirai/**` (including `keys/` and `records/`) |
| `protected` | **Instruction files:** `**/CLAUDE.md`, `**/CLAUDE.local.md`, `**/AGENTS.md`, and their `@` imports |
| `protected` | **Tool folders:** `.agents/**`, `.codex/**`, `.cursor/**` (`.claude/**` is `auto-run`, below) |
| `protected` | **CI:** `.github/workflows/**`, `.github/actions/**`, `.gitlab-ci.yml`, `.gitlab/**`, `.circleci/**`, `azure-pipelines.yml`, `bitbucket-pipelines.yml`, `Jenkinsfile` |
| `protected` | **Files that hide code from review:** `**/.gitattributes`, `**/.gitignore`, `.gitmodules`, `.lfsconfig`, `.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS` |
| `protected` | **Lint and test configs:** ESLint, Prettier, Stylelint, Biome, TypeScript `tsconfig*.json`, Vitest, Jest, Playwright, Cypress, PHPUnit, Pest, PHPStan, Psalm, PHP-CS-Fixer, Pint, Rector, EditorConfig, `phpcs.xml*`, `.coveragerc`, `pytest.ini`, `setup.cfg`, `tox.ini`, `.rubocop.yml`, `.golangci.yml` (each with its usual file names; listed in full in the data file) |
| `protected` | **Containers and secrets:** `**/*compose*.yml`, `**/*compose*.yaml`, `**/Dockerfile*`, `**/*.dockerfile`, `**/.dockerignore`, `**/.env*` |
| `protected` | **Dependency manifests and lockfiles:** `package.json` (other than lifecycle scripts), `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `.yarnrc*`, `composer.json`, `composer.lock`, `Gemfile*`, `requirements*.txt`, `pyproject.toml`, `poetry.lock`, `Pipfile*`, `go.mod`, `go.sum`, `Cargo.toml`, `Cargo.lock` (at any depth) |
| `protected` | **Git hooks outside `.husky/`:** `.githooks/**`, `lefthook.yml`, `.lefthook*`, `.pre-commit-config.yaml` |
| `protected` | **E2E tests** (D-44), unless the actor is the QA agent: the globs in a new `[testing] e2e_paths` (empty by default; unit 17's detection proposes them, and the sample app's is `e2e/**`) |
| `auto-run` | `.claude/**`, `.vscode/**`, `.idea/**`, `.envrc`, `.devcontainer/**`, `.husky/**`, `.mcp.json`, and `package.json` lifecycle-script changes |

**Declared at plan time** (R3-M2): a plan lists the protected paths it expects to touch. Once you
approve the plan, those paths are expected. `classify` still marks them `protected` (the ticket
is high risk), but lists only the undeclared ones as `undeclared`, which is what parks the
ticket. An `auto-run` path always parks, declared or not (D-54).

## Files

```
registry/protected-paths/            # core.toml (always on) and ecosystem packs (data, D-37)
src/config/registry.js               # + the protected-paths kind
src/config/config-schema.js          # [gate] protected (additions only), [testing] e2e_paths
src/util/glob.js                     # the matcher
src/store/git.js                     # + changedNames, ignoredNames, commitOf, mergeBase, isAncestor, a recursive ls-tree, larger blob reads
src/trust/snapshot.js                # snapshot, verifyTrustRoot, trustedFile/Config/Registry
src/trust/protected.js               # changeOf, classify, ignoredFingerprint, the install-script checks
src/trust/imports.js                 # the @-import parser
src/cli/commands/trust.js            # mirai trust snapshot|check
src/cli/commands/protected.js        # mirai protected
test/util/glob.test.js
test/trust/snapshot.test.js
test/trust/protected.test.js
```

## Tests

| # | Test |
|---|---|
| T1 | **The roadmap's branch cases each give `high`:** a lint config (`eslint.config.js`), a compose override (`docker-compose.override.yml`), a `.gitattributes` with a `-diff` rule, a `.vscode/tasks.json` (`auto-run`), and a nested `packages/api/CLAUDE.md`. Each comes with its rule and class |
| T2 | **The rest of the rules:** every row of the table, with a matching and a non-matching path each; a rename counts as both paths; a file `@`-imported by a changed `CLAUDE.md`; `package.json` lifecycle scripts versus dependencies; E2E paths for the developer versus the QA agent; `[gate] protected` adds a rule, and can't remove one |
| T3 | **Declared paths:** an approved plan's declared path isn't `undeclared`; an undeclared one is; an `auto-run` path is always parked |
| T4 | **`changedPaths`:** between two commits, and against the work tree with modified, deleted and untracked files; a hostile `diff.external` or textconv in the repo config isn't run |
| T5 | **The snapshot comes from the base commit, not the work tree:** uncommitted edits to the framework copy and the config, and an untracked file, are not in it; its config is the committed one; its plugin folder matches the base lock's `bundles` |
| T6 | **A tampered trust-root file is detected:** a changed file, an added file, a removed file and a changed manifest each fail `verifyTrustRoot` with a code; an untouched snapshot passes; a second `snapshot` for the same base reuses it |
| T7 | **The snapshot refuses a bad base:** no lock on the base; a framework file not matching the base lock; a stale `bundles` (a config change committed without `mirai render`); a symbolic link in `.mirai/` on the base. Nothing is written in each case |
| T8 | **Gates read the snapshot:** with a work tree that loosens a rule (removes a `[gate] protected` addition, edits `registry/protected-paths/` in the copy), `trustedConfig`/`trustedRegistry` and `classify` still use the base's rules |
| T9 | **The report warns:** `classify`'s `auto-run` paths rendered through 09b's run report give the "read them on the host before you open the branch in your IDE" warning |
| T10 | **The glob matcher:** `*`, `**`, `?`, negation, dotfiles, anchored versus any-depth patterns, against a table of cases |
| T11 | **The CLI:** `mirai trust snapshot`, `mirai trust check` (and its exit code after tampering), `mirai protected` with and without a range |
| T12 | **On the sample app** (a copy, recorded in `test-results.md`): a snapshot of your committed install; a scratch branch touching each roadmap case, run through `mirai protected` |

## Open points for you

1. **Which commit is "the integration branch's commit".** I recommend the local branch
   (`refs/heads/main`). When its remote-tracking branch exists and points elsewhere, the snapshot
   refuses and says "push or pull first". A run would otherwise build on commits the host
   doesn't have, or miss ones it does. No fetch: this unit never uses the network.
2. **Where the snapshot lives.** The roadmap says `<mirai-home>/<repo-id>/trust/`, while 03 §8
   and D-15 say `bundle/<base-sha>/`. I recommend `trust/<base-sha>/`, and fixing 03 and D-15 to
   match: "bundle" already means unit 11's launch bundle, which is only one part of the snapshot.
3. **No immutable flag.** 03 §8 mentions one (`chflags uchg`). The owner can clear that flag
   themselves, so it stops nothing that runs as you. The real guard is unit 13's sandbox
   `denyWrite` plus the re-hash. I recommend read-only modes plus the re-hash now, and dropping
   the flag from 03.
4. **Keeping old snapshots:** at most 10 (about 750K each), never the one a run uses. `mirai
   clean` (later) can do more. I recommend it.
5. **The lint and test config list** is long and will never be complete. I recommend the list in
   the table as built-ins, with `[gate] protected` for the rest. Unit 17 (setup detection) then
   proposes additions from the config files it finds in your repo, for you to approve.
6. **Two CLI commands, `mirai trust` and `mirai protected`.** They're for you (and for dogfooding
   on the sample app); agents never call `mirai`. The pinned command list gains both. I recommend
   it.

## Changes after testing and review

Listed for your check before "UNIT APPROVED".

**Your decisions after the review:**
1. **The rules are a stack-neutral core plus ecosystem packs** (your point: MIRAI is for every
   stack, and the pilots mustn't shape its defaults). This replaces the single built-in list in
   the table above:
   - **`registry/protected-paths/core.toml`, always on:** only what's true on every stack.
     That's MIRAI's files, instruction files for every AI tool (`CLAUDE.md`, `AGENTS.md`,
     `GEMINI.md`, `.cursorrules`, …), tool folders, CI, files that hide code from review,
     `.editorconfig`, containers and `.env*`, git hooks, and the auto-run paths at any depth.
   - **Packs, one data file each:** `node`, `php`, `python`, `rust`, `go`, `ruby` and
     `task-runners`. A project switches them on in a new `[gate] packs` (read from the trust
     root, so a branch can't switch one off). Unit 17 proposes them; an unknown name is refused.
     A new stack is a new pack file, with no code.
   - **The install-script check is data too** (`[[scripts]]` in a pack: file, field, keys). It
     covers npm's lifecycle scripts and Composer's `post-autoload-dump` and similar with the
     same code. The Composer question became part of the `php` pack.
   - `Makefile` and the other task runners are a pack, not core: in some stacks they're ordinary
     code.
   - **For the sample app:** its config needs `[gate] packs = ["php", "node"]`. That's your file
     to change, or unit 17 proposes it.
2. **Ignored files are closed here.** In the work tree, ignored files and folders under a
   protected path get fingerprinted (`ignoredFingerprint`). Given the fingerprint from before a
   launch (unit 19 takes it), whatever changed is part of the change. Without it, they're only
   listed (`ignoredPresent`, and `mirai protected` shows them apart), so your own `.idea/` or
   `.env` never parks a ticket.
3. **A plan declares exact file paths only.** A pattern declares nothing. The plan lint
   refuses `*`, `?`, `[ ]` and `{ }` in a protected-path row, and the plan template's guidance
   says so (08b's template text changed by one phrase).
4. **The trust root's base is always the integration branch,** also for a `release: together`
   epic's tickets. D-15 is amended.

**Fixed from the review:**
5. **A symbolic link counts as a change of its own** (`symbolic-link`), as auto-run when it
   points into an auto-run path. Before, a `.vscode` link to another folder matched nothing.
   `x/**` now matches the folder `x` itself too.
6. **Matching ignores case,** as macOS disks do: `.VSCode/`, `Claude.md` and `dockerfile` are
   caught.
7. **A change is measured from the merge-base,** so commits that landed on `main` after the
   branch was cut aren't the branch's. `mirai protected` accepts `a..b` and `a...b`, both read
   that way.
8. **An unreadable file isn't taken for an absent one:** a link, or a file over 1 MiB, counts as
   changed install scripts. A blob too big for one git read gives its own error code, not a
   false timeout.
9. **No filter or driver runs on a diff:** `core.attributesFile` is pinned to `/dev/null`, along
   with the earlier pins. T4 now tests a clean filter, the real exposure; the old T4 passed by
   accident. Diff output is read raw, so a path starting with a space keeps it.
10. **The glob matcher no longer backtracks exponentially.** It matches part by part with a memo,
    each part with a two-pointer wildcard match: 10 `**` against 28 levels, or `*a*a*…` against
    60 characters, is instant.
    - A trailing `/` no longer anchors, as in `.gitignore`.
    - Patterns in rules and configs refuse `[ ]` and `\`, wildcards inside `{ }`, and more
      than 8 wildcards.
11. **The snapshot is anchored to the base commit:**
    - every `tree/` file is listed with its git blob id;
    - a reused snapshot recomputes each file's blob id from its bytes and compares it with the
      commit's, so rewriting a file, the manifest and the store's record together is caught;
    - the manifest holds no time, so the same base gives the same hash;
    - a snapshot `format` number rebuilds an older one.
12. **`verifyTrustRoot` also catches** a file made writable and an added folder.
13. **`trustedFile` hashes what it returns;** `trustedConfig` and `trustedRegistry` re-hash the
    whole trust root first.
14. **Pinned runs:**
    - `openTrustRoot({ baseSha })` opens a run's own snapshot after `main` moves on;
    - `snapshot({ keep })` never prunes the bases a run uses;
    - temp folders left by a killed build are pruned after an hour.
15. **One build at a time:** a lock file in the store, taken over when its process is gone.
    Three processes at once now give one snapshot, where before they left one that always read as
    "tampered".
16. **Instruction files aren't MIRAI's, so they're never refused:**
    - a `CLAUDE.md` → `AGENTS.md` link, or a linked or huge import, is skipped and listed in the
      manifest's `skipped`;
    - nested `CLAUDE.md`/`AGENTS.md`, `.claude/CLAUDE.md`, `.claude/rules/**`, the project's
      skills and all their imports are in the snapshot, for unit 24.
17. **`base-not-pushed` says which way to go:** push, pull, or "both have moved on". It never
    fetches, so two refs that are both behind the host still agree (documented).
18. **`classify` returns `needsYou`** (was `park`): units 20 and 23 park in autonomous mode and
    stop in supervised mode. It also returns the touched `instructionFiles`, which unit 24 blocks
    in supervised mode too. The E2E role is a shared constant, `E2E_ROLE`.
19. **More core and pack rules:**
    - nested `.vscode`, `.idea`, `.husky` and `.devcontainer`;
    - `*.code-workspace`, `.devcontainer.json`, `mise.toml`;
    - `.pnpmfile.cjs`, `.yarn/plugins`, `.npmrc`/`.yarnrc.yml` as auto-run;
    - `binding.gyp`, `setup.py`, `build.rs`;
    - static-analysis baselines, Babel/SWC/Mocha/Karma/c8/nyc configs;
    - `lefthook-local`, `bun.lock`, `uv.lock`;
    - Copilot, Gemini and Cursor instruction files.
20. **The rules live in a folder,** `registry/protected-paths/`, so they load like the registry's
    other kinds. The function names became `changeOf`/`changedNames`. Literal pathspecs are used
    for `ls-tree`.
21. **The docs:** research/09 §7 and G26 say `trust/` and no immutable flag; roadmap rows 13 and 14
    take over the `strict.json` render, the skill export and the compose inputs.

**Noted for later units:**
- **12b (the launcher):** which framework copy it runs, since a branch can edit
  `.mirai/framework/**` and the lock together. Options: the trust root's copy, the work-tree copy
  checked against the integration branch's lock, or classifying those paths as `auto-run`. Put to
  you with the 12b spec.
- **13:** `denyWrite` on `trust/`; render `strict.json` into the snapshot before the manifest is
  written; deny writes to auto-run paths.
- **14:** the compose inputs join the snapshot's parts.
- **19:**
  - re-hash with the run's pinned base (`openTrustRoot({ baseSha })`) before each launch;
  - take `ignoredFingerprint` before each launch and pass it as `ignoredBefore` after;
  - the actor is the registry role.
- **20, 23:** act on `needsYou` per preset; never combine `[gate] risk.high`'s `!` patterns with
  the rules in one list.
- **25, 54:** CI runs `classify` on base...head with the base's rules (the default `code_paths`
  leaves out `.mirai/**`).
- **29:** `doctor` checks `trust.json`, orphan folders and `.tmp-*` leftovers, and verifies every
  snapshot.
- **37:** overlays may add rules, never replace `core`.
- **53:** a stacked child's change runs from its parent's head.
- **Not done:**
  - a branch's configured upstream remote (`branch.<b>.remote`) instead of origin or the only
    remote;
  - absolute imports that point inside the repo, and escaped spaces in imports;
  - a size limit across the whole import closure (it's per read).
