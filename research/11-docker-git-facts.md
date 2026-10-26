---
status: settled by test
version: 1
---

# 11 — Docker, Compose and git facts, settled by probes (unit 14a)

**What this is:** the facts the test executor (unit 14b) and pinned host git are built on. Each
was settled by real Docker and git runs on a throwaway fixture with canaries, never real
secrets. The harnesses are:
- `test/probes/docker-probes.js`;
- `test/probes/git-probes.js`;
- for sandboxed DNS, `test/probes/claude-probes.js --bundle`.

All three are run by hand; `npm test` never runs them. Every probe is listed in
`implementation/units/14a-compose-git-facts/test-results.md`.

**Seen on:**
- Docker Desktop 29.6.2: engine and Desktop's own client, at
  `/Applications/Docker.app/Contents/Resources/bin/docker`;
- Docker Compose 5.3.1 (Desktop's plugin);
- git 2.39.5 (Apple Git-154);
- Claude Code 2.1.310;
- macOS 26.7;
- 2026-10-25.

A fact here holds for those versions only; unit 18 re-runs the probes after every update.

**The test conditions:**
- **How Docker was called:** only by absolute path, with `PATH`, `HOME`, `DOCKER_CONFIG` and
  `DOCKER_HOST` and nothing else. `DOCKER_CONFIG` was MIRAI's own: no credentials, proxies or
  context, and Compose found through `cliPluginsExtraDirs`.
- **Images and files:** only `nginx:1.27-alpine` (already local), with `--pull never` and no
  builds. Compose files were written as JSON.
- **Cleanup:** every project was named `mirai-probe-<run>-<n>`, and every container was labelled.
- **git:** a fresh repo per probe and mode, with remotes that are local folders or a server on
  127.0.0.1.

**Evidence, in order:**
1. files on the host (a marker written by a payload, a hash unchanged);
2. `docker inspect` and `/proc/mounts` inside the container;
3. canaries in the output.

Controls show that each thing exists without MIRAI's setting:
- the project `.env` steers Compose with no flags;
- a normal network reaches the host and DNS;
- each git key fires with no pins.

## Compose: what reaches the resolved file (G12)

- **With `-f <file> --project-directory <dir>`, `compose.override.yml` isn't loaded.** Without
  `-f`, the project's own `.env` decides which files load: its `COMPOSE_FILE` replaced the
  compose file entirely (the control loaded only `evil.json`).
- **What steers Compose:**

  | Input | Kept out by |
  |---|---|
  | `COMPOSE_FILE` | `-f` (from the caller's environment or the project's `.env`) |
  | `COMPOSE_PROJECT_NAME` | `-p` |
  | `COMPOSE_ENV_FILES` | `--env-file` |
  | **`COMPOSE_PROFILES` from the caller's environment** | **nothing:** applies even with every flag, so MIRAI must clear it |
  | **`COMPOSE_PROFILES` and every `${VAR}` from the project's `.env`** | only `--env-file <trust copy>`, which replaces the project `.env` completely; without it, the real `.env`'s values (the canary) were put into the resolved file |

  So **every call needs `-f`, `-p`, `--project-directory` and `--env-file`, and an environment
  with no `COMPOSE_*`**. Then nothing leaked.
- **`config --format json` shows almost every risky key, under the same name**, ready for an
  allowlist:
  - **host access:** `privileged`, `cap_add`, `devices`, `network_mode`, `pid`, `ipc`, `uts`,
    `cgroup`, `security_opt`, `userns_mode`, `sysctls`, `cgroup_parent`, `runtime`, `gpus`,
    `storage_opt`, `device_cgroup_rules`;
  - **network:** `extra_hosts`, `dns`, `ports`, `links`;
  - **other:** `logging`, `develop` (with absolute paths), `post_start`, `build` (with its
    context), `volumes_from`, `user`, `tmpfs`, `read_only`, `init`.
- **Host mounts that don't look like mounts are visible too:**
  - `configs` and `secrets` with `file:` show the host path at top level;
  - a named volume with `driver_opts: {o: bind, device: …}` shows the device;
  - `name:` and `external: true` show as written;
  - short-syntax binds come back as `{type: bind, source: <absolute>}`.
- **Some things are lost or changed by resolving:**
  - `env_file` is inlined into `environment`, and its path is gone;
  - `include` and `extends` are merged and their keys removed;
  - **top-level `models` is dropped**, while the service keeps `models: {m: null}`;
  - **a one-letter volume name is read as a Windows drive:** `v:/x` became an anonymous volume
    with target `v:/x`.

  So the validator must be an **allowlist on the resolved file**, require absolute POSIX
  targets, and check the raw files for what resolving hides (below).
- **`include` and `extends` act before any container exists.**
  - `config` fetches remote includes itself. For an OCI include it looked up the name and
    tried HTTPS. For git includes it used built-in git: the fake `git` and `ssh` on `PATH`
    never ran.
  - Local includes and extends are merged.

  **So the raw files must be checked before Compose runs:** `include`, `extends`, `env_file` and
  `provider` are refused there.
- **`provider:` services run a host plugin on `up`, not on `config`.** The fake plugin wrote its
  marker on `up`. `config` shows the `provider` key, so the allowlist on the resolved file stops
  it before `up`.

## Compose: the frozen file and the masks (G27)

- **`up -f <frozen> --no-build --pull never -p … --project-directory …` accepts `config --format
  json`'s output unchanged.**
  - `docker inspect` matched: one bind of the source, one network, the environment from the
    trust env file.
  - `$$` round-trips to `$`.
  - Paths in the frozen file are absolute.
  - The project's `.env` had no effect on the frozen run.
- **Masks over files don't hold on this Mac (found by the review, then probed).** The host's
  disk ignores case, and Docker Desktop's shared folder passes another spelling of a name through
  to macOS.
  - **What leaked:** a read-only bind of an empty file over `.env` hid `/w/.env`, but
    `/w/.ENV` and `/w/.Env` read the real file. **A write to `/w/.ENV` changed the real `.env`
    on the host.** `SUB/.env` and `Sub/.GIT` leaked the nested canaries the same way.
  - **What held:**
    - **masks over a folder:** an anonymous volume or a `tmpfs` over `.git`. Neither
      `/w/.GIT/CANARY` nor `/w/.Git/config` found anything;
    - the exact paths: writes, `rm` and `umount` through them were refused;
    - links in the work tree to `.git` and `.env`, which resolve onto the masks.

    But why the folder masks hold isn't understood, so nothing should rely on them.
  - **So D-49's masks can't protect files on macOS.** The fix is not to mount the work tree at
    all. 14b mounts a **copy** that MIRAI makes for each run: the files git lists, with no
    `.git` and no real `.env*` (only the trust root's dummy env file). Then there's nothing to
    hide, and nothing in the real work tree for a test to write (below). That's a change to
    D-49's mechanism, not its rule, and it's put to you with this unit.
- **Other mask facts** (for any mask still used):
  - a volume or `tmpfs` over a **file** stops the container from starting (runc refuses), so it
    fails closed;
  - with only the top `.git` and `.env` masked, the nested `sub/.env` and `sub/.git` canaries
    were read: every nested one would need its own mask;
  - `/dev/null` as a mask shows up as a `devtmpfs` mount.
- **A read-write mount of the work tree lets a test write anything in it** (review): a new
  `sub/.git/config` with a filter, a `.envrc`, a `.vscode` task, a symlink to a host path. The
  agent's sandbox denies those, but a test container isn't the agent. The copied tree closes
  this too: the real work tree is never mounted.

## Compose: the network (G19)

- **An `internal: true` network:**
  - no outside name resolves (`nslookup example.com`), and no outside address answers (a TCP
    connect to `1.1.1.1:443`);
  - neither `host.docker.internal` nor `gateway.docker.internal` reaches a server on the host's
    127.0.0.1;
  - there's no default route (no gateway);
  - the peer service answers by name;
  - no `*_PROXY` variable is set.

  The control, a normal network, resolved names, connected to `1.1.1.1:443` and reached the host
  server, so the probe can see a leak. The host's LAN address wasn't probed: the server listens
  on 127.0.0.1 only, and the missing default route is the evidence for every address outside
  the network.
- **A published port on an internal network isn't published** (host port 0, nothing reachable).
  14b refuses `ports` anyway.
- **Sandboxed Bash can't resolve names** (the 13c bundle, 6 Haiku runs, plus 2 reruns of
  `dscacheutil` after the review required each run to reach its end):
  - `nslookup` couldn't open its socket;
  - `dscacheutil` returned nothing, while on the host it answers;
  - Python's `getaddrinfo` failed.

  So DNS isn't a way out of the sandbox, on top of 13a's empty network allowlist.

## How MIRAI calls Docker

- **Docker Desktop's own client by absolute path.** Here the `docker` on `PATH` is
  `/usr/local/bin/docker`, a symlink into a 2021 backup of Docker 3.4.0 (client 20.10.7). A
  `docker` from `PATH` is never used. 14b records the client's path and version in
  `~/.config/mirai` (machine data, not the repo).
- **MIRAI's own `DOCKER_CONFIG` works** (`cliPluginsExtraDirs` pointing at Desktop's plugin
  folder), with **`DOCKER_HOST` set to Desktop's socket** (`~/.docker/run/docker.sock`). Without
  it, the client falls back to `/var/run/docker.sock`, which doesn't exist here. Nothing from
  your `~/.docker/config.json` is needed.
- **No proxy variables reach containers** on this Mac, with MIRAI's config or yours.

## A timeout (P5)

- **The container outlives the Compose client.** After SIGTERM or SIGKILL to `docker compose run`,
  the container was still running.
  - For SIGKILL that's certain: the client can't pass anything on.
  - For SIGTERM the cause is unclear. `sleep` as the container's first process ignores SIGTERM,
    so it might have survived even if Compose passed the signal on.

  The conclusion holds either way.
- **`down -v` alone then left the project's network behind,** since a one-off container was
  still attached.

So 14b's timeout must force-remove the project's containers (`rm -f` by the project label), then
run `down -v`, and only then report the timeout.

## Host git: what MIRAI's pins switch off (G15, G23)

The pin set is `src/store/git-pins.js`:
- **the environment:** `GIT_CONFIG_NOSYSTEM=1`, an empty `GIT_CONFIG_GLOBAL` and `HOME` (MIRAI
  folders in 14a; `/dev/null` and `/var/empty` since 14b, re-probed with the same results),
  `GIT_DIR`/`GIT_WORK_TREE` named outright, `GIT_ALLOW_PROTOCOL=file:https`, and `GIT_SSH_COMMAND`,
  `GIT_ASKPASS` and the editors set to `/usr/bin/false`;
- **the `-c` pins:**
  - `core.hooksPath` to an empty place (`/dev/null` since 14b) and `core.fsmonitor=false`;
  - empty `credential.helper`, `http.proxy`, `diff.external`, `core.askPass` and
    `core.excludesFile`;
  - `protocol.ext.allow=never`;
  - every signing program (`gpg`, `openpgp`, `ssh`, `x509`) set to `/usr/bin/false`, with
    signing and signature checks off;
  - `diff.ignoreSubmodules=all` and no submodule recursion;
  - **pins for what MIRAI reads:** every untracked file listed, no colour, standard diff
    prefixes;
- **`--no-ext-diff --no-textconv --no-color`** on diffs. They're mandatory: with
  `diff.external` empty, a plain `git diff` fails.

MIRAI's commands were run unpinned (repo config only) and pinned: the store's read calls,
`status`, `diff`, `add`, `commit`, a three-way `merge`, `switch`, `log` and `push`. The review
added the bottom rows of each column and reproduced two of them first.

| Neutralised by the pins (fired unpinned, not pinned) | Not pinnable (fired both ways) |
|---|---|
| `core.hooksPath`, `.git/hooks/*`, `core.fsmonitor` (also from `config.worktree`) | `filter.<x>.clean`/`smudge`/`process`, named by `.gitattributes` or `.git/info/attributes` |
| `diff.external`, `diff.<x>.textconv`, `diff.<x>.command` (by the diff flags) | `merge.<x>.driver` (runs on a three-way merge) |
| `core.sshCommand`, `credential.helper` (also URL-scoped), `core.askPass`, the plain `http.proxy` | `include.path` and `includeIf` (the included file's own keys; a pinned key in it stays pinned) |
| `gpg.program` with `commit.gpgSign`; **`gpg.ssh.program` run to verify an ssh-signed commit on `merge` and `log`** (`merge.verifySignatures`, `log.showSignature`) | `url.<x>.insteadOf` (rewrites even an explicit push URL) |
| `protocol.ext.allow` with an `ext::` URL | **a URL-scoped `http.<url>.proxy`** (more specific than the pin, so it wins; the same holds for every `http.<url>.*` key, such as `sslVerify`) |
| `core.worktree` (by `GIT_DIR`/`GIT_WORK_TREE`), `core.excludesFile` | **a `.git` file pointing at another repo**, and **`.git/commondir`** (git follows both, even with `GIT_DIR` named) |
| a system config (`GIT_CONFIG_NOSYSTEM`), a global one (MIRAI's `GIT_CONFIG_GLOBAL`) | **a nested repo committed as a gitlink**, with a filter in its own config: the pins stop it in `status` and `diff`, but `add -A` still runs it |
| **`status.showUntrackedFiles=no`** (hid a new file); **`color.ui`, `diff.noprefix`** (changed the diff) | `objects/info/alternates` (objects read from elsewhere); `.git/info/exclude` (hides new files from MIRAI's file list) |
| | `remote.<x>.receivepack` when pushing by the remote's name. MIRAI pushes to an explicit URL, which stops it; that's not a pin |

Two keys didn't fire under MIRAI's commands at all: `core.pager` (no terminal) and
`core.editor`/`sequence.editor` (`commit -m`). They're pinned anyway.

`remote.<x>.uploadpack` wasn't probed: MIRAI doesn't fetch before unit 22, which probes it with
fetch and rebase.

**What this means for 14b.** The pins can't be the only control. 14b adds three more:
- **An allowlist of the repo's own config.** `git config --file .git/config --list` doesn't
  follow includes. Keys outside a short list (`core.*` basics, `remote.<x>.url`/`fetch`,
  `branch.*`, `extensions.*` MIRAI knows) are refused before any git call. That closes the left
  column's config keys as a class, including `http.<url>.*`, `filter`, `merge`, `url`,
  `include*` and `gpg`, where the pins only catch what MIRAI knew to name.
- **The repo's shape is checked:**
  - `<top>/.git` is a real folder, with no `commondir`, `objects/info/alternates`,
    `http-alternates`, `info/grafts` or `info/exclude` patterns MIRAI doesn't expect;
  - no `.git` below the top folder (a nested repo or submodule) is allowed, since `add -A`
    reaches into it;
  - `top` comes from MIRAI's own record of the project, never from `rev-parse --show-toplevel`
    (which `core.worktree` steers).
- **D-54's integrity hash** covers all of that between checks:
  - `config`, `config.worktree`, `info/` and `objects/info/`;
  - `commondir`, `shallow`, the hooks listing and the refs;
  - `modules/*/config` and `worktrees/*` if they ever appear.

  A `.gitattributes` in the work tree is agent-writable, but it only names a filter or driver.
  The command it runs must come from config, which the allowlist refuses.

**Pins that change today's behaviour (for 14b's move of `src/store/git.js`):**
- **Your global excludes file** (used by unit 10 on purpose): with `core.excludesFile` empty,
  files only it ignores (`.DS_Store`, IDE folders) show up as untracked.
- **No `user.name`/`user.email`.**
- **Git LFS filters are gone.**

14b handles each:
- **excludes:** the excludes path recorded in `~/.config/mirai` (patterns only, no code);
- **identity:** `-c user.*` from MIRAI's config;
- **LFS:** an LFS repo refused with a clear message, or an opt-in.

**Done in unit 14b** (`implementation/units/14b-pinned-git/`):
- every call in `src/store/git.js` is pinned, on `/usr/bin/git` only;
- the top folder is found by walking up to `.git`, never by `rev-parse`;
- the repo config allowlist is `src/config/git-repo-keys.js`, with a personal opt-in for unknown
  keys;
- the shape and nested-repo checks are `src/store/repo-check.js`;
- the hash and guard are `src/store/repo-state.js`, held by `prepareLaunch`/`finishLaunch` for
  the launcher (units 15 and 19, which call them);
- after the review: `config.worktree` is checked whenever it exists (git reads it for a bare
  `extensions.worktreeConfig` or any non-zero number, and a filter in it ran); links in place
  of `.git`'s own folders are refused; local branches are hashed by value, so `gc` and
  `pack-refs` change nothing;
- your global excludes path is read and pinned;
- LFS repos are refused.

`git-probes.js --mirai` ran every export of `git.js` against all 38 probes (again after the
review fixes): 19 refused before git ran, 19 ran with no marker, 0 failed. Commit identity, pushing and worktrees remain unit
22's.

## Residual risk this adds to research/09 §7

- **The config allowlist and the hash, not the pins, are the control** for filters, merge
  drivers, includes, `insteadOf`, URL-scoped `http` keys, gitfiles, `commondir`, alternates and
  exclude. Between two checks, a change to `.git` by something that isn't an agent (your IDE,
  another tool) is caught at the next check, not prevented.
- **A Compose key that's new in a later Compose version** is refused by the allowlist, not
  understood. A Compose update can only break runs, not open them. Unit 18 re-runs these probes
  after updates.
- **Masks can't protect files on a case-insensitive Mac disk shared with Docker Desktop.** This
  is why 14b mounts a copy of the tree. Folder masks held, but for unknown reasons. Another
  sharing mode, a case-sensitive volume or a Linux host needs the probes again.
- **The pins were probed against MIRAI's commands as listed.** A new git command in a later
  unit (fetch, rebase, worktree, `log -p`) needs its own probe (units 18 and 22). An Apple git
  update arrives silently, so unit 18 re-runs these probes when the git version changes.
