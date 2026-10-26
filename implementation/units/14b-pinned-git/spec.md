---
unit: "14b"
name: pinned-git
status: approved (2026-10-26); unit approved (2026-10-26)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 14 (14a's split, split once more by this spec); D-15 §3, D-54; research/11 "Host git"
depends_on: ["14a"]
---

# Unit 14b: Pinned host git and the repo check

## Why

Every git call MIRAI makes on your Mac goes through `src/store/git.js`. Today those calls clear
the environment and switch off fsmonitor, and nothing more. So:
- **your global `~/.gitconfig` is read** (no `GIT_CONFIG_GLOBAL`);
- **the repo's `.git/config` can run code** through a filter, a diff driver, a hook path or an
  include. `changedNames` diffs against the work tree, and a stat-dirty file runs a `clean`
  filter. `mirai status`, `lint`, `trust` and `protected` all run on your Mac, outside every
  sandbox and with your credentials.

14a settled what to do about it (research/11, "Host git"):
- **the pins** (`src/store/git-pins.js`, written and probed in 14a) switch off the keys git lets
  a caller override;
- **some keys can't be pinned:**
  - filters, merge drivers, includes, `insteadOf`, URL-scoped `http.<url>.*`;
  - a `.git` file, `commondir`, alternates;
  - a nested repo.

  Those need **a repo config allowlist**, **a check of the repo's shape** and **D-54's integrity
  hash**.

**Why this comes before the test executor.** 14a planned the executor as 14b. But two things
come first:
- **The executor depends on pinned git.** It copies the files git lists, and later units commit
  what it tested.
- **Pinned git touches every command MIRAI has today.** The executor is a different job:
  Compose, the copied tree, the validator and the sample app's test config.

Together they'd be bigger than any unit so far. So I propose:
- **14b (this unit):** pinned git;
- **14c:** the executor;
- **14d:** the `run_tests` tool, which 14a called 14c.

That's open point 1.

**Versions:** git 2.39.5 (Apple Git-154, `/usr/bin/git`, the only git on this Mac) and macOS
26.7, as in 14a.

**Roadmap "done when" covered here:** "a host-side change to `.git/config` is detected before the
next git call", and the host-git half of "the gate can't give the branch control of host git".
The rest of row 14 belongs to 14c and 14d.

## Scope

**In:**
1. **Every git call pinned.** `git.js`'s single `git()` runs every call with:
   - **the arguments:** `pinArgs` and `--no-replace-objects`;
   - **the environment:** `pinEnv`, with `GIT_DIR`/`GIT_WORK_TREE` named;
   - **diffs:** `DIFF_FLAGS` on every diff.

   `pinEnv` also sets:
   - **`HOME`:** an empty folder of MIRAI's;
   - **`GIT_CONFIG_GLOBAL`:** an empty file of MIRAI's;
   - **`PATH`:** `/usr/bin:/bin`.

   So **the git binary is `/usr/bin/git`** (open point 3).

   The pin folder:
   - is `<mirai-home>/git-pins/`, holding `hooks/` (empty), `gitconfig` (empty) and `home/`
     (empty);
   - is created private, and checked before first use in each process;
   - is refused if anything is in it.
2. **The top folder from MIRAI, not from git.** `topLevel()` no longer runs
   `rev-parse --show-toplevel`, which `core.worktree` steers. Instead:
   - **with a store:** MIRAI walks up from the current folder to the first `.git`. That folder
     must match the store's `checkout`;
   - **without a store** (`init`, `--join`): the walk alone decides, and the shape check below
     follows.

   A `.git` that is a file is refused with a message. That covers a worktree, a submodule and a
   gitfile pointing elsewhere. MIRAI works in the main checkout; worktrees are unit 22's.
3. **The repo config allowlist.** Before the first git call on a repo in each process, MIRAI
   reads:
   - `.git/config`;
   - `config.worktree`, when `extensions.worktreeConfig` is on.

   It reads them with `git config --file <f> --list --null`, which never follows includes. Every
   key falls in one of three classes:

   | Class | Keys | What happens |
   |---|---|---|
   | **Known** | <ul><li>`core.*` basics (format version, filemode, `bare = false`, logallrefupdates, ignorecase, precomposeunicode, symlinks, autocrlf, eol, safecrlf, checkstat, trustctime, untrackedCache, commitGraph, multiPackIndex, compression);</li><li>`remote.<x>.url`/`pushurl`/`fetch`/`tagOpt`/`prune`/`pruneTags`/`skipDefaultUpdate`/`skipFetchAll`/`gh-resolved`;</li><li>`branch.<x>.*`;</li><li>`extensions.objectFormat`/`worktreeConfig`;</li><li>`user.*`, `author.*`, `committer.*`;</li><li>`init.defaultBranch`, `pull.*`, `push.default`/`autoSetupRemote`, `fetch.prune`/`pruneTags`, `merge.ff`/`conflictStyle`, `rebase.autoStash`/`autoSquash`/`updateRefs`, `rerere.enabled`, `gc.*`, `alias.*`;</li><li>**the keys the pins override:** `core.hooksPath` (husky sets it), `core.fsmonitor`, `core.sshCommand`, `core.pager`, `core.editor`, `core.askPass`, `core.excludesFile`, `core.attributesFile`, `credential.*`, `gpg.*`, `commit.gpgSign`, `tag.gpgSign`, `color.*`, `status.*`, the plain `http.proxy`</li></ul> | allowed: none of them runs code under MIRAI's git |
   | **Never** | `include.*`, `includeIf.*`, `filter.*`, `merge.<x>.driver`, `diff.<x>.*`, `url.*`, `http.<url>.*`, `core.worktree`, `core.bare = true`, `core.gitProxy`, `core.alternateRefsCommand`, `remote.<x>.uploadpack`/`receivepack`/`proxy`/`vcs`/`promisor`/`partialCloneFilter`, `extensions.partialClone`, `protocol.*`, `uploadpack.*`, `receive.*`, `submodule.*` | refused: every MIRAI command on this repo stops and names the key, its file and why |
   | **Unknown** | everything else, such as `difftool.*`, `lfs.*`, an IDE's own section, the plain `http.*` keys | refused, but **you can opt in**: `[git] allow_repo_config = ["difftool.*"]` in `~/.config/mirai/config.toml` (your machine, never the repo). A Never key can't be opted in |

   A Never or Unknown key is refused **before any git call runs**, so a filter in `.git/config`
   never gets the chance to run under MIRAI. The message also says that your own git would run
   it.
4. **The repo shape check**, by `lstat`, without git:
   - `<top>/.git` is a real folder, and `config` a regular file;
   - there's no `commondir`, `objects/info/alternates`, `objects/info/http-alternates` or
     `info/grafts`;
   - `info/` and `hooks/` hold only regular files and folders, no links.

   These need a git call, so they're checked where MIRAI already walks the work tree:
   - **no nested repo:**
     - no gitlink in the index (`ls-files --stage`, mode 160000);
     - no untracked nested repo (an entry ending in `/` in `ls-files --others`);
   - **where:** in `changedNames` and `lsFiles` (and, from 14c on, in the copy). Checking them
     on every command would read the whole index each time.

   Nested repos are refused because `add -A` runs their filters with their own config (14a).
   `.git/info/exclude` and `info/attributes` are allowed and hashed. The reasons:
   - they're yours: an agent can't write `.git`;
   - an exclude only hides a file, and a hidden file is never committed or tested;
   - an attribute can name a filter, but the command a filter runs must come from config, which
     the allowlist refuses.
5. **D-54's integrity hash,** `repoState(top)`: a SHA-256 over
   - `config`, `config.worktree` and everything in `info/` and `objects/info/`;
   - whether `commondir`, `shallow` and `packed-refs` exist (and `shallow`'s content);
   - the `hooks/` listing (name, mode, size, content hash);
   - `HEAD`;
   - the local refs (`refs/heads/**`, `refs/tags/**`, and their lines in `packed-refs`);
   - whether `refs/replace/` exists;
   - the `worktrees/*` and `modules/*` listings.

   Not hashed:
   - **`refs/remotes/**` and `FETCH_HEAD`**, so an editor's background fetch doesn't stop a night
     run. They're data, not code, and MIRAI never trusts a remote-tracking ref alone: the trust
     root checks local against remote (unit 12).
   - **the index and the objects**, which change on every status refresh.

   **The guard:**
   - `repoGuard(top)` records the hash;
   - `guard.check()` throws `repo-changed` on a mismatch, naming what changed (config, hooks,
     refs and so on);
   - `guard.accept()` re-records after MIRAI's own writes (unit 22's commits).

   **Where it runs in this unit:**
   - while a guard is active for a repo, every pinned git call checks it first;
   - the launch path records it before an agent launch and checks it after. That's next to
     unit 12's check of ignored files, and the launch is refused or flagged the same way.

   Outside a run, each command does the allowlist and shape check instead. Something that
   changes between your commands is caught by the next one.
6. **What the pins change for today's callers** (research/11, "Pins that change today's
   behaviour"):
   - **Your global excludes file.** Unit 10's `check-ignore` refusal and the file lists rely on
     it.
     - Each process reads its path once from your global git config:
       `git config --global --type=path --get core.excludesFile`, with your `HOME`, nothing
       pinned and nothing else, falling back to git's default (`~/.config/git/ignore`).
     - The path goes into the pin `core.excludesFile=<that path>`. It has to be an absolute path
       to a regular file outside the checkout; otherwise it's left empty and `mirai trust` says
       so.
     - An excludes file holds patterns only and runs nothing.
   - **`configValue` reads the repo's own file** (`--file .git/config`), so a pin never hides
     the repo's value. Today that's strict.js reading `core.hooksPath`. `remotes()` reads the
     same file.
   - **Git LFS.** LFS gets its filter from your global config, which pinned git no longer
     reads. Without the filter, every LFS file would show as changed. So a repo that uses LFS is
     refused, with a message that names what was found:
     - `filter=lfs` in a committed `.gitattributes` or in `info/attributes`;
     - `.lfsconfig`;
     - `lfs.*` in the repo config.

     Opting in comes with a later unit, if you need it.
   - **Commit identity:** nothing commits before unit 22. 22 sets `-c user.*` from MIRAI's
     config.
7. **Probes of MIRAI's own calls** (`test/probes/git-probes.js --mirai`):
   - **What runs:** every export of `git.js`, called the way MIRAI calls it, against each of
     14a's hostile fixtures.
   - **Each probe passes when either:**
     - MIRAI refused the repo before git ran, naming the key or the shape; or
     - git ran and no marker appeared.
   - **The controls:** 14a's unpinned runs, still in the harness.

   This is research/11's "14b's exact git command lines".
8. **Docs:**
   - `docs/agent-safety.md` gets "MIRAI's own git": what's pinned, the allowlist, what to do
     when a key is refused, and the LFS and nested-repo limits;
   - research/11 marks the 14b rows done;
   - design/07 row 14 gets the 14a–14d split.

**Out:**
- **14c (the test executor):**
  - the copied tree (14a's proposal, still for your decision with 14c's spec);
  - Compose: the prescan, allowlist, freezing, run, timeout and Docker client;
  - the sample app's `[testing]`/`[checks]`/`[compose]` config;
  - test output.
- **14d:** the `run_tests` tool and its bundle probes.
- **Unit 22:**
  - commits (identity), pushes (transport, `ls-remote --get-url`), fetch and rebase;
  - `guard.accept()` after MIRAI's writes;
  - worktrees.
- **Unit 18:** re-running the git probes when the git version changes. 14b doesn't check the
  version.
- **Not in this unit:**
  - your own git. MIRAI doesn't change `.git/config`, your global config or your hooks;
  - an opt-in for LFS or submodules.

## Files

```
src/store/git.js            # one pinned git(); topLevel by walking up; configValue/remotes by --file
src/store/git-pins.js       # + the pin folder (create, check), the excludes path
src/store/repo-check.js     # new: config allowlist, shape check, nested-repo check, LFS detection
src/store/repo-state.js     # new: repoState hash and repoGuard
src/config/config-schema.js # + [git] allow_repo_config in the personal global file
src/config/load.js          # personal-global hint lists [git] allow_repo_config
src/store/home.js           # top from the store's checkout
src/launch/launch.js        # guard before/after a launch
src/cli/commands/trust.js   # shows the pin folder, excludes path, repo check result
test/store/git-pinned.test.js   # new: T1–T12
test/probes/git-probes.js       # + --mirai: MIRAI's own calls on 14a's fixtures
test/probes/harness.test.js     # + T13
docs/agent-safety.md, research/11-docker-git-facts.md, design/07-implementation-roadmap.md
```

## Tests

| # | Test |
|---|---|
| T1 | **Pinned calls:** a fake git (on a test-only binary path) records its arguments and environment. Every `git.js` export passes `pinArgs`, `--no-replace-objects`, `GIT_DIR`/`GIT_WORK_TREE`, `GIT_CONFIG_NOSYSTEM`, MIRAI's `GIT_CONFIG_GLOBAL` and `HOME`, and nothing from the caller's environment. Every diff carries `DIFF_FLAGS` |
| T2 | **The pin folder:** created private and empty; a file planted in `hooks/`, `home/` or a non-empty `gitconfig` is refused; a symlinked pin folder is refused |
| T3 | **Top folder:** found by walking up; a `.git` file (worktree, gitfile) is refused; a `core.worktree` in the config doesn't move it; with a store, a different top is refused (`checkout` mismatch) |
| T4 | **Allowlist, known keys:** the sample app's real key set and a husky `core.hooksPath` pass |
| T5 | **Allowlist, Never keys:** each Never class is refused (one fixture per class), before any git process starts (the fake git sees no call), with the file and key in the message |
| T6 | **Allowlist, Unknown keys:** refused; allowed after `[git] allow_repo_config` names it or its section; a Never key in `allow_repo_config` is a config error; `config.worktree` is checked when `extensions.worktreeConfig` is on |
| T7 | **Shape:** `commondir`, `alternates`, `http-alternates`, `grafts`, a symlinked `config` or `info/` entry are each refused |
| T8 | **Nested repos:** a gitlink in the index and an untracked nested repo are each refused by `changedNames` and `lsFiles`; an ignored nested repo (inside an ignored folder) is not |
| T9 | **LFS:** each of the four signs is refused with the LFS message |
| T10 | **repoState and the guard:** a change to each hashed part changes the hash and `check()` names it; a change to `refs/remotes`, `FETCH_HEAD`, the index or a new object doesn't; `accept()` re-records |
| T11 | **The guard in use:** while active, a git call after a planted `.git/config` change throws `repo-changed`; the launch path refuses after a hook planted during a launch |
| T12 | **Today's behaviour kept:** a file ignored only by the global excludes is still ignored in `lsFiles`, `changedNames` and unit 10's check; an excludes path inside the checkout isn't used; strict.js still sees a repo-set `core.hooksPath` |
| T13 | **The `--mirai` probe harness:** with a fixture and a harmless key it runs every export, detects a marker and a refusal, and never runs outside the fixture |
| — | **Every existing test still passes** (228 today), with real git now pinned |
| P | **The real runs** (in `test-results.md`): the `--mirai` probes on all of 14a's hostile keys (pass = refused or no marker); `mirai status`/`lint`/`trust`/`protected` on the sample app, with their times before and after (pinning must not make a command noticeably slower); a throwaway clone of the sample app under `~` with a planted filter: refused, and the marker never written |

## Open points for you

1. **Split 14 once more: 14b pinned git (this spec), 14c the executor, 14d the `run_tests`
   tool.** I recommend it. The executor depends on pinned git, and pinned git touches every
   command MIRAI already has. The copied-tree decision moves with the executor to 14c's spec.
2. **Refuse unknown repo config by default, with a personal opt-in.** The alternative is to
   refuse only the Never list and allow everything else. That's friendlier, but a key nobody
   thought of would then run silently, which is exactly what 14a's review kept finding. I
   recommend the default refusal. On your two repos today every key is Known, so nothing
   changes for you.
3. **`/usr/bin/git` only.** It's the git that 14a probed, and the only one on this Mac. A
   Homebrew git that comes first on your `PATH` would no longer be used by MIRAI. Your own `git`
   is unchanged. Linux has git at the same path. A machine without `/usr/bin/git` gets a clear
   error. An opt-in path can come later.
4. **LFS and submodule repos are refused for now.** The pilot uses neither. Each needs its own
   probes before it can be allowed.
5. **What runs on your machine:**
   - local git only, on throwaway fixtures under your home folder (removed after);
   - your real `mirai-sample-app` is only read (its `.git/config` is not changed);
   - no network, no Docker, and no Claude runs.

## What 14c and 14d will do (for orientation; each gets its own spec)

**14c, the test executor:**
- **the copied tree:** 14a's proposal, for your decision with its spec;
- **the Compose prescan:** `include`/`extends`/`env_file`/`provider` refused;
- **the allowlist on the resolved file**, then freezing and the run. Each call has `-f`, `-p`,
  `--project-directory` and `--env-file`, no `COMPOSE_*` variables, an internal network and a
  hard timeout (force-remove the containers, then `down -v`);
- **Docker:**
  - Desktop's client, by absolute path, with MIRAI's own `DOCKER_CONFIG`;
  - a clear error when Docker Desktop isn't running;
- **the remaining Compose probes:**
  - `up --wait`;
  - `run`/`exec` on the frozen file;
  - digests;
  - resource keys;
- **the sample app's test config:** its compose file publishes ports and builds images, so 14c
  decides whether projects keep a separate test compose file or MIRAI tightens the daytime one.

**14d, the `run_tests` tool:** as 14a's spec sketched it for 14c: the MCP server, the strict
arguments, the signed gate result, the pre-step guard and the bundle probes.

## Changes after testing and review

1. **No pin folder: fixed system paths instead** (found by the test suite).
   - **The problem:** creating `<mirai-home>/git-pins/` wrote into the MIRAI home on read-only
     commands. With `HOME` inside the checkout, it wrote inside the project.
   - **The fix:** the hooks path and the global config are `/dev/null`, and `HOME` is
     `/var/empty`. macOS keeps `/var/empty` empty and only root can write it; where it doesn't
     exist, git has no home to read.
   - **Checked:** 14a's 38 probes re-ran with the same results. T2 now checks that nothing is
     written and that only `/usr/bin/git` runs.
2. **`config.worktree` is checked whenever it exists** (the review's High finding, reproduced).
   - **The problem:** git also turns it on for a bare `extensions.worktreeConfig` or `= 2`, and
     a filter planted there ran under MIRAI's git.
   - **The fix:** checked whatever the switch says.
3. **Credentials in keys are never printed:** a token in a `url.<base>.insteadOf` URL shows as
   `<redacted>`.
4. **The hash ignores routine git activity.**
   - **Ignored:** local branches are hashed by value, so `pack-refs` and `gc` change nothing;
     tags and `info/refs` are left out.
   - **Still counts:** a commit or branch switch of yours in the checkout during a run.
5. **Links in place of `.git`'s own folders are refused:** `objects`, `refs`, `info`, `hooks`,
   `HEAD`, `packed-refs`, `remotes`, `branches`. Objects linked from another repo were read
   before this.
6. **Guards:**
   - several per checkout, keyed by its real path;
   - every git call checks all of them, before the config check;
   - the guard lives in `strict.js` (`prepareLaunch`/`finishLaunch`), not `launch.js`.

   **It isn't live yet:** the launcher that calls it comes with units 15 and 19. The docs say so.
7. **The key lists:**
   - **now Never:** trailer commands and `gpg.ssh.defaultKeyCommand`;
   - **too wide to opt in:** `trailer.*` and `gpg.*`;
   - **now Known, all inert:** sparse-checkout and index options, `remote.pushDefault`,
     `maintenance.*`, `pack.*`, `gui.*`, `diff.algorithm`/`renames`, and the plain
     `diff.external`/`noprefix`/… that the pins override.

   The docs say the lists are judged against today's git commands, and that later units
   re-check them.
8. **Smaller fixes:**
   - the excludes check ignores case;
   - `configValue` reads `config.worktree` first;
   - `lsFiles` reads the index once;
   - a `.git` link is refused with its own message;
   - remotes defined by file are hashed;
   - the roadmap's host-git bullet is updated.
9. **Not built as specified:** T3's "with a store, a different top is refused". The store's
   existing checks do this: a second checkout is refused, and a moved one is recorded. Git calls
   on the walked-up top run before that comparison, which is safe now that the repo check runs
   first.
10. **Results:**
    - the `--mirai` probes: 19 refused and 19 ran with nothing fired. That is also what the first
      run showed; I had summarised it as 16 and 22, a miscount, since corrected;
    - the full suite: 242 tests. The last runs had one or two timing failures under heavy machine
      load (load average 57–140), in tests that don't touch git; they pass alone.

## Noted for later units

See `review.md` for the full list. In short:
- **15 / 19:** call `finishLaunch` in a `finally`, with one guard per launch.
- **22:**
  - ssh remotes need their own transport and credential design;
  - `accept()` after MIRAI's commits, checkpoint refs and branch switches;
  - `gc.auto=0` on MIRAI's writes;
  - whether `refs/mirai/*` is hashed;
  - re-check the key lists for `commit --trailer`;
  - `remote.<x>.push`;
  - worktrees.
- **14c:** copy the tree from `lsFiles`, not `git archive`.
- **18:** record the git version, and re-run `--mirai` after git updates.
