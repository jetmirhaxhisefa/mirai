---
unit: "17a"
name: setup-detection
status: approved (2026-10-30)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 17 (split here into 17a and 17b); design/01 §1 step 1 and 3b, D-45 (test levels), D-24 (worktree_safe), D-55 (detection in the first milestone), P2, P7, G8
depends_on: ["16a", "16b", "03b", "14"]
---

# Unit 17a: Setup detection

## Why

Today you write `.mirai/config.toml` by hand. For the sample app, that meant finding the services,
mounts, test commands, adapters and `report_root` yourself. At the pilot checkpoint (unit 30), the
roadmap expects the config to come **from detection, not by hand** (D-55): "the hand-written config
in A and at the pilot checkpoint is written from these facts".

Detection is a **script, no AI** (design/01 §1, step 1: "detect, don't ask"). It reads the
checkout and writes a **draft config for you to review**. It never changes your config, and never
runs the project's code.

**Unit 17 is split in two (proposed; open point 1).** Row 17 holds two different kinds of work:
- **17a, this unit: static detection.** It reads files, git history and the resolved compose file.
  Two container runs at most (a probe, D1).
- **17b, the test baseline.** It runs every level in containers: run times, the failing tests from
  `cases.json`, coverage and the files each level measures, and P7's flaky reruns (up to 10 runs
  per failing test). It also stores the baseline in its one home (`<store>/baseline/<sha>.json`,
  AR3-11). That work is mostly Docker runs, and it is what units 26 and 54 build on.

**Stack-neutral (as in units 12 and 16a).** Nothing about a framework is code:
- **built in, the same for every stack:** the file walk, Docker's own compose file names, the
  mount and port checks, the git history checks, and the draft writer;
- **data:**
  - what marks a stack, and its named checks: new `registry/stacks/` files;
  - how a test runner is found and run: a new `[detect]` section in each test adapter;
  - which commands in instruction files are flagged: `registry/instruction-flags/core.toml`.

  A new stack is a new data file, as with packs and adapters.

**Roadmap "done when" covered here:**
- on the sample app, it finds the stacks, levels and checks;
- it writes a draft config for review;
- G8 is checked per project.

"Existing failing tests" moves to 17b, with the baseline.

## Scope

**In:**

1. **`mirai detect`**, run in an installed checkout (it needs `mirai init` first: the detection
   data comes from the trust root, like adapters and packs).
   - It prints a report: what was found, where it was found, and the gaps.
   - It writes two files to `<store>/detect/<time>/`, outside the repo:
     - `facts.json`, for unit 39's ledger;
     - `config.draft.toml`.
   - It prints both paths. Your config and the repo are never written (open point 2).
   - `--json` prints the facts instead of the report.

2. **The file walk.** Tracked files only (`git ls-files` with the pinned git, 14b), so build
   output, `vendor/` and `node_modules/` don't count.
   - Bounded: at most 200,000 paths, and a marker file of at most 1 MiB is read.
   - Nothing is followed through a symlink.
   - Nested repos and submodules are listed as facts. Each is a candidate for `repos`, never
     entered.

3. **Stacks** (`registry/stacks/<name>.toml`, kind `stack`, schema_version 1):
   - `markers`: file names that mark the stack in a folder;
   - `pack`: the protected-paths pack it suggests (unit 12);
   - `checks`: named checks, as data:
     - from a manifest's scripts (a file, a field, the script names that count as checks, and a
       command template such as `["npm", "run", "{script}"]`);
     - or from a listed dev dependency (a package name and a command).

   **Shipped:** `node` and `php`, with markers, pack and checks, checked on the sample app;
   `python`, `go`, `rust` and `ruby`, with markers and pack only (their manifest names are facts,
   and no check is guessed). A project's own stacks go in `.mirai/custom/stacks/`, read from the
   trust root.

   The draft gets `[gate] packs` from the stacks found.

4. **Compose.** Docker's own file names (`compose.yaml`, `compose.yml`, `docker-compose.yaml`,
   `docker-compose.yml`) at the root.
   - **Each is read safely:** first with 14c's text prescan, then resolved by
     `docker compose config --format json` in 14c's private Docker setup. It is given an
     **empty `--env-file`**, so your real `.env` is never read, even for interpolation. No
     container starts.
   - **From the resolved file it keeps:** the services, their working folders, their bind mounts
     (source to target), ports, profiles, and a fixed project `name`.
   - **Mount warnings** (design/01 step 1): a project service that mounts your home folder, the
     Docker socket, `.git`, or a folder outside the repo is reported, with the service and the
     line. 14c already refuses these at run time; detection reports them early.
   - **Draft `[compose]`:** `files`, and `env_file = ".env.test"`. If no `.env.test` exists, that
     is a gap: unit 39's checklist item 4.

5. **Test levels.** Each adapter's new optional `[detect]` section (`test-adapter/1` gains an
   optional table) gives:
   - **`markers`:** the runner's config files, such as `phpunit.xml`;
   - **an optional `package` check:** a manifest, its dependency fields, and the package name;
   - **`commands`, tried in order.** Each is a command, plus an optional condition: a file that
     must exist beside the marker, or a script that must contain a word. A command whose
     condition fails is skipped.
   - **`level`:** the level name to suggest;
   - **`report_root`:** candidate folders, if the adapter needs one (Playwright);
   - **`suites`, optional (P7):** where the config names its suites (an XML element and
     attribute), the argument that selects one (`--testsuite={suite}`), and a name map. For
     PHPUnit this is `Unit = "unit"`, `Feature = "api"`; any other suite is lowercased.

   **For each marker found:**
   - **The service** is the compose service whose bind mount covers the marker's folder, the
     longest match. Its `workdir` is the mount target, unless that is already the service's
     working folder.
   - **`run`:** a service in a profile, or with no long-running command, gets `run = "oneoff"`
     (as the sample app's `playwright` has by hand).
   - **No service mounts the folder:** that is a gap, and the level isn't drafted.
   - **A name already taken** becomes `<service>-<name>`.

   **Shipped:** `[detect]` for `phpunit`, `vitest` and `playwright`, checked on the sample app.

6. **Named checks**, from the stacks' check data, put in the service found as in item 5:
   - an `npm run lint` script gives `lint`;
   - a `build` script gives `build`;
   - and so on, per the stack data.

   The quality-gate script itself (design/01 step 1, "split into named checks") isn't parsed: a
   shell script is code. If one is found (`Makefile`, `scripts/*`, CI steps), it is listed as a
   gap with its path.

7. **`worktree_safe`** (D-24, R-C5). It is `false`, with the reasons, when:
   - the compose file sets a fixed project `name`;
   - a bind mount is relative to the checkout;
   - a host port is fixed.

   It is drafted as `[workspace] worktree_safe`. The schema gains this boolean (open point 4).
   Nothing reads it until parallel work, but it is recorded now, as D-24 asks.

8. **Git conventions** (pinned git; refs and `log` only; never a hook, never a filter):
   - **Branch pattern.**
     - Branch names (local and remote, at most 2,000) are matched against
       `<prefix>/<KEY-123>-<slug>` shapes.
     - If at least 60% of the non-integration branches fit one shape, it becomes
       `git.branch_pattern`, such as `feature/{ticket}-{slug}`, with the ticket-key pattern.
     - Otherwise MIRAI's default stays, and the pattern is a gap.
   - **Commit format.** The last 200 non-merge commits on the integration branch are checked:
     - Conventional Commits (`type(scope): subject`), a ticket key in the subject, and existing
       trailers;
     - a share of 80% or more counts as "strict".
   - **G8, per project.** Whether a commit-message rule exists:
     - a `commit-msg` hook in a committed hooks folder (`.husky/`, `.githooks/`, or
       `core.hooksPath` if the repo check allows it);
     - a commitlint config;
     - a CI step that checks messages.

     If none exists and the format isn't strict, G8 passes for this project. Otherwise G8 is a gap
     ("check that `Mirai-Ticket: <id>` passes your rule"). It is never run: that would run project
     code. Unit 22 settles G8 where a rule exists.

9. **Agent-instruction files (P2).**
   - **What's found:** every tracked `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`,
     `.github/copilot-instructions.md` and `.cursorrules` at any depth, and the files under
     `.claude/`, `.cursor/rules/`, `.agents/` and `_bmad/`. Each is listed with its size.
   - **What's flagged:** shell, network and install commands, in code spans, fenced blocks and
     command-shaped lines, using lint's Markdown scanner (unit 07b; its T12 fixes for code spans and
     long lines). The patterns are data in `registry/instruction-flags/core.toml`:
     - network fetches: `curl`, `wget`, `Invoke-WebRequest`;
     - piping into a shell;
     - `sudo`, `ssh`, `scp`, `docker`;
     - installs in every ecosystem: `npm`/`pnpm`/`yarn add` or `install`, `pip install`,
       `composer require`/`install`, `cargo install`, `go install`, `gem install`, `brew`,
       `apt`.
   - **MIRAI's own block** (between `<!-- mirai:begin -->` and `<!-- mirai:end -->`) is skipped.
   - **Report only:** each flag gives the file, the line, the pattern and the text (cut to 200
     characters). Nothing blocks here; unit 39's ledger asks you about each file.

10. **The draft config.**
    - **The start:** a valid `schema_version = 1` config, built from your current config's
      integration branch and the facts above.
    - **Comments:** every detected value has one saying where it came from (`# from
      backend/phpunit.xml and the app service's mount ./backend:/var/www/html`). Every gap is a
      `# check:` comment.
    - **Validation:** it is loaded through the config schema before it is written. If it doesn't
      validate, that is a bug in MIRAI, and nothing is written.
    - **Your current config:** the report lists the differences, key by key. The draft never
      replaces your config: you copy what you want.

11. **Probe D1, with your OK: at most 2 container runs on the sample app, Docker only, no
    subscription.** It checks the PHPUnit suite levels (item 5) through `php artisan test`:
    - `--testsuite=Unit` plus a file path: does the path narrow the suite, or replace it?
    - `--testsuite=Feature` plus a test ID (`--filter`).

    If the path doesn't narrow the suite, the suites are reported as facts only, and the draft
    keeps one level per runner. Plus `mirai detect` on a clone of the sample app, which starts no
    container.

**Out:**
- **17b:** the test baseline. Run times, failing and flaky tests (P7's reruns), coverage and the
  files each level measures, `<store>/baseline/`, and 16a's and 16b's notes for 17: read
  `cases.json`; a Playwright project qualifier; Vitest titles containing " > "; trusted
  `coverage_paths` per level.
- **Unit 39:** the ledger, the interview, the business context, resources, and offering missing
  levels.
- **Not detected here:** git hosting and reachable tools (unit 39 asks; detecting them means the
  network), local app URLs, the ticket-key pattern beyond what branches and commits show, and
  templates and decision docs (39's ledger).
- **The pilot:** detection runs there at the pilot checkpoint (unit 30), not in this unit.

## Files

- **New:**
  - `src/detect/` with `walk.js`, `stacks.js`, `compose.js` (the safe resolution and the mount
    facts), `levels.js`, `git.js` (branches and commits), `instructions.js` and `draft.js`;
  - `src/cli/commands/detect.js`;
  - `registry/stacks/{node,php,python,go,rust,ruby}.toml`;
  - `registry/instruction-flags/core.toml`.
- **Changed:**
  - `src/config/registry.js`: the `stack` and `instruction-flags` kinds, and the adapters'
    `[detect]`;
  - `src/config/config-schema.js`: `[workspace] worktree_safe`;
  - `registry/test-adapters/*.toml`: `[detect]`;
  - `src/cli/commands/index.js` and `help.js`;
  - `docs/setup-detection.md` (new), `docs/test-adapters.md`, `registry/README.md`.
- **Design:** the roadmap splits row 17 into 17a and 17b. Units 30 and 39 then depend on both,
  and unit 26 on 17b.
- **Tests:** `test/detect/*.test.js`, with fixture repos built under `~` by the tests (as 14c's
  are).
- **Probe:** `test/probes/detect-probes.js` (D1).

## Tests

`npm test`, no Docker (the compose step goes through a fake docker that returns a resolved file,
as 14c's tests do):
- **T1: the walk.** Tracked files only; nested repos and submodules listed, never entered; the
  limits; links not followed.
- **T2: stacks.** Markers at any depth; the pack suggested; checks from scripts and dependencies.
  A custom stack from the trust root; a broken one is `bad-stack`; a core name can't be reused.
- **T3: compose.** The empty env file is passed (a real `.env` in the fixture is never read: a
  canary in it never shows up in the facts). The prescan refuses as in 14c. The mount warnings:
  home folder, socket, `.git`, outside the repo. Profiles and the project name kept.
- **T4: levels.** Marker to service by the longest mount; `workdir`; `oneoff`; the commands' order
  and conditions; the package check; suites and the name map; a name clash; a marker with no
  service is a gap.
- **T5: named checks** from scripts and dependencies, in the right service.
- **T6: worktree_safe:** each of the three reasons, and none.
- **T7: git conventions.** Fixture repos with branch sets: one dominant shape, mixed shapes, only
  `main`. Commit sets: conventional, ticket keys, trailers, plain. The G8 outcomes. A repo's own
  git config (aliases, hooks, filters) never runs.
- **T8: instruction files.** Every listed name and folder; flags in code spans, fenced blocks and
  plain lines; MIRAI's block skipped; prose that only mentions a word isn't flagged; long lines
  and big files bounded.
- **T9: the draft and the command.** It validates. Comments for sources and gaps. The differences
  from your config. `--json`. The repo is unchanged afterwards (status and hashes). Not installed
  gives `not-installed`.
- **T10:** stack neutrality (14c's T13 test covers `src/detect/` too: no framework names in code)
  and the probes staying local.

**Probes:** D1 (at most 2 container runs), plus `mirai detect` on a clone of the sample app.

## Open points for you

1. **The split: 17a now (static detection), 17b next (the baseline, with test runs).** My
   recommendation: yes. 17b is mostly Docker runs and P7's reruns, a different kind of work and
   review.
2. **Where the draft goes: in the store (`<store>/detect/<time>/`), never the repo.**
   Recommended: a draft in `.mirai/` could be committed by mistake, or look like a config. The
   alternative is `.mirai/config.draft.toml`, git-ignored.
3. **Suite levels (P7):** PHPUnit's `Unit`/`Feature` become levels `unit`/`api`, if D1 shows a
   path narrows a suite. The sample app's hand config has one `unit` level running both, so the
   draft would differ from it there. That is the point of the comparison: you choose.
4. **`worktree_safe` under `[workspace]`.** It is recorded now and read only once parallel work
   exists.
5. **Instruction-file flags only report.** Blocking, or rewriting files, belongs to unit 39's
   ledger and to Rex's clean instruction files (unit 24).

## Changes after testing and review

**From the probes:**
1. **D1 settled open point 3 the other way:** a path given to a `--testsuite` level *replaced*
   the suite (a Feature file ran in the `Unit` level; research/12, D1). So, as item 11 said for
   this case, suites are facts only and the draft keeps one level per runner. The adapter's
   `[detect.suites]` keeps only `element` and `attribute`: no selecting argument, no name map.
2. **D1 ran in `test/probes/adapter-probes.js`** (the d- scenarios), reusing its clone and
   cleanup. `test/probes/detect-probes.js` holds the `mirai detect` run on a sample-app clone.

**Other changes from the spec:**
3. **The walk reads the integration branch's commit from git objects,** not `git ls-files` on
   the work tree (item 2). It's what the config will run against, a link can't be followed (it's
   a blob), and the compose file is resolved from those bytes. `.mirai/` is left out: MIRAI's
   own framework copy has a `package.json`, which read as a node stack.
4. **New git calls:** `for-each-ref` (branch names), `log` (messages: no signature check, no
   notes, UTF-8), and `ls-tree -l` (sizes, so a large file is never read). Each is in the git
   probes' MIRAI run, with 16b's `changedLines`, which had never been added there: 38 / 38 pass.
5. **`run = "oneoff"` comes from profiles only.** "No long-running command" (item 5) can't be
   told from a compose file.
6. **The `workdir` is written out** when the compose file doesn't name the service's working
   folder. The image's own working folder isn't read: that needs Docker running.
7. **G8 (item 8):**
   - a CI step that checks messages can't be told apart from other steps, so it isn't detected
     (documented);
   - the rule files are data: each stack's `commit_rules` (commitlint, lefthook, gitlint,
     pre-commit, CaptainHook, GrumPHP, Overcommit), plus any tracked file named `commit-msg`
     (which covers `.husky/`, `.githooks/` and a committed `core.hooksPath` folder).
8. **Thresholds:** a branch pattern needs at least 5 branches; a commit format at least 10
   commits (otherwise `unknown`). A ticket key is capital letters: `feature/proj-12-x` isn't
   one.
9. **Instruction files (item 9):**
   - also listed: `CLAUDE.local.md`, `.windsurfrules`, `.mcp.json`, `.github/instructions/` and
     `.windsurf/rules/`;
   - in JSON, only `command` with its `args` is read (hooks, MCP servers), so MIRAI's own deny
     list in `.claude/settings.json` isn't flagged;
   - a file MIRAI rendered and that hasn't changed (its `mirai.lock` hash) is listed, not read;
   - caps: 2,000 files, 256 KiB a file, 50 flags a file, 500 in all.
10. **The quality-gate files** are found with the protected-path data (the `task-runners` pack and
    core's `ci` rule), not a new list.
11. **Names are unique across levels and checks** (a check named like a level gets
    `<service>-<name>`), and a check whose command is already drafted for that service is
    dropped.
12. **Codes:** not installed is the store's existing `no-store` (T9), not a new `not-installed`.
    New: `detect-no-data` (an installed MIRAI from before 17a), `bad-stack`,
    `detect-too-large`, `draft-invalid`.
13. **Compose gaps also cover** a second compose file name (Compose reads the first) and an
    override file (only `[compose] files` are read in test runs).
14. **Two older promises named "unit 17"** and aren't in 17a or 17b. `docs/agent-safety.md` and
    `registry/secrets/core.toml` now say so:
    - secret-file patterns per stack, as pack data;
    - rebuilding the images from the integration branch before each run.

    Each needs a unit of its own on the roadmap: your call where.
15. **A pack MIRAI doesn't have** (a project's own stack naming one) is a gap, not drafted into
    `[gate] packs`.
16. **The Files list:** `help.js` didn't change (help is built from the command list).

**From the review (`review.md`):**
17. **Instruction files:**
    - each has its blob id;
    - `@` imports are followed (the trust root's `importsOf`, five levels);
    - `.mirai/context/agents-local.md` is read (it's rendered into MIRAI's block);
    - MIRAI's block is skipped only when it's closed and matches the lock;
    - links are listed;
    - the JSON keys, the Markdown endings and the patterns allowed on prose lines are data.
18. **G8 never "passes":** the states are `check` and `no-local-rule`, since rules on the code
    host can't be seen; too few commits to tell is `check`. Roadmap row 22 owns G8.
19. **`label_file` is refused by 14c's prescan,** in test runs and in detection.
20. **A level or check whose value from the repo the config can't hold is a gap,** never a failed
    run; one name helper for both.
21. **`worktree_safe`** also counts fixed container names and networks or volumes made outside
    the file.
22. **Composer `format` and `cs` scripts aren't checks** (they usually fix files).
23. **`facts.json`** records the trust manifest's hash and the MIRAI version, writes home paths
    from `~`, and is documented as data for unit 39's AI.
24. **The docs give the order:** init, commit and push, detect. The report compares with your
    *committed* config.
25. **Smaller fixes:** see `review.md`, row 13.
26. **Three items need a place on the roadmap** (`review.md`), your call:
    - rebuilding images before each run, before the pilot;
    - secret-file patterns per stack;
    - suite levels.
