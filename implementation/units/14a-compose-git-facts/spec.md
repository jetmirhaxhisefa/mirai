---
unit: "14a"
name: compose-git-facts
status: approved (2026-10-25); unit approved (2026-10-26)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 14 (split into 14a/14b/14c by this spec); D-48, D-49, D-54; research/09 §8; design/05 §G
depends_on: ["13c"]
---

# Unit 14a: Docker, Compose and git facts (probes)

## Why

Unit 14 is how agents run tests: `run_tests` builds one `docker compose` call from the trust
root, checks the resolved file against an allowlist, freezes it, runs it on a network with no way
out, and masks `.git` and every real `.env*`. Host git runs with pinned settings, so a hostile
`.git/config` can't run code. All of that rests on facts the design marks UNVERIFIED
(research/09 §8, design/05 §G):
- **G12:** does `-f <file>` stop `compose.override.yml` from loading, and does `docker compose
  config` show every mount, network and privilege, so a check can refuse the bad ones?
- **G27:** do the masks over `.git` and `.env` hide them from a container, and does `up` accept the
  frozen file unchanged?
- **G19:** can a container on an `internal` network, or a sandboxed Bash command, still resolve or
  reach outside names?
- **G15, G23:** which hostile `.git/config` keys do MIRAI's pins switch off, and which can only
  be caught by the integrity hash (D-54)?

Reading the setup on this Mac turned up more questions the design doesn't cover yet:
- **Compose now runs things on the host.** `provider:` services start a host plugin, and
  `include:` can fetch remote files. Both happen before any container exists, so checking the
  resolved file afterwards may be too late.
- **Some host mounts don't look like mounts.** `configs`/`secrets` with `file:`, and a named
  volume with `driver_opts: {o: bind}`, mount host folders. `name:` and `external:` share state
  between runs.
- **Your Docker settings leak in.** `~/.docker/config.json` can add proxy variables to every
  container, and can name credential helpers and plugin folders. MIRAI should call Docker with
  its own config folder, if Compose still works that way.
- **Two Docker clients on this Mac.** `docker` on your `PATH` is `/usr/local/bin/docker`, a symlink
  into `~/docker-upgrade-backup-2026-07-26/Docker-3.4.0.app`: client **20.10.7**. Docker
  Desktop's own client is **29.6.2**, at `/Applications/Docker.app/Contents/Resources/bin/docker`,
  with Compose **5.3.1** as a plugin. MIRAI must not depend on whichever `docker` comes first on
  `PATH`.
- **A timeout may leave containers running.** If MIRAI kills the `compose` client at a time
  limit, the containers may keep running; P5 needs to know.

If I build the executor first and probe afterwards, any wrong guess means rebuilding the
validator. So unit 14 splits in three, like 13:
- **14a (this unit):** settle the facts with Docker and git probes on a throwaway fixture;
- **14b:** the test executor;
- **14c:** the `run_tests` tool in the bundle.

14b and 14c are sketched at the end and get their own specs.

**Versions:** Docker Desktop 29.6.2 (engine and Desktop client), Compose 5.3.1, git 2.39.5
(Apple Git-154), Claude Code 2.1.310, macOS 26.7. Every result is recorded with them, because
unit 18 re-runs the probes after updates.

**Roadmap "done when" covered here:** G12, G15, G19 and G23 are settled (and G27, its
research/09 companion). The rest of row 14 is 14b's and 14c's.

## Scope

**In:**
- **The Docker probe harness, `test/probes/docker-probes.js`.** You start it by hand (`--yes`);
  `npm test` never runs it. It:
  1. builds a **throwaway fixture** under your home folder (`~/.mirai-probes-*`, like 13a's).
     The fixture holds:
     - a git repo with a canary in `.git/`, canary `.env` and `sub/.env` files, and a fake
       `.env.test`;
     - a canary `compose.override.yml`;
     - one compose file per probe;
  2. calls Docker **only through Docker Desktop's own client by absolute path**:
     - with an allowlisted environment and `--pull never`;
     - with no builds;
     - **with local images only:** `nginx:1.27-alpine`, already on this Mac, whose busybox has
       `nslookup` and `wget`. Nothing is pulled;
  3. names every compose project `mirai-probe-<id>-<n>` and labels every container. It runs
     `down -v` before and after each probe, and on exit it removes anything left with its label;
  4. records per probe the command, the exit code, the resolved config (for config probes), and
     **whether any canary appears** in the output or in what the container saw;
  5. runs a **canary HTTP server on the host's 127.0.0.1**, on a random port, owned by the
     harness and stopped at exit. It answers the "can a container reach the host" probes.
- **The git probe harness, `test/probes/git-probes.js`.** No Docker, no network.
  - Each probe plants **one hostile key** in a fixture repo's `.git/config`, or `.git/info/`, or
    `objects/info/alternates`. Each key's payload is a script that only writes a marker file.
  - It then runs **the git commands MIRAI uses or will use**: the read calls in
    `src/store/git.js`, plus `status`, `diff`, `add`, `commit`, `switch` and `push` to an
    explicit local bare repo.
  - Each command runs twice: **unpinned**, as control, and **with the pin set**.
  - A marker file means the pins didn't stop that key.
  - The credential-helper probe uses a local HTTP server that answers 401, so git asks for
    credentials without any outside network.
- **The pin set as data, `src/store/git-pins.js`.** It holds the `-c` pins and the environment
  (`GIT_CONFIG_NOSYSTEM`, an empty MIRAI `GIT_CONFIG_GLOBAL` and the rest), so the probes test
  exactly what 14b will use. 14a only defines it; 14b wires it into `src/store/git.js`. Today's
  read calls deliberately use your global excludes file (unit 10), so moving them is a decision
  for 14b.
- **The sandboxed-DNS half of G19:** about **6 short Haiku runs** through 13a's harness, against
  the 13c bundle (`--bundle`). They run `nslookup`, `dscacheutil -q host` and
  `python3 -c socket.getaddrinfo` on `example.com`. A sandbox that can resolve names can leak
  data in DNS queries, even with no network allowed.
- **`research/11-docker-git-facts.md`:** every fact, its probe, the versions and what it means
  for 14b. Plus the design/05 §G rows and the research/09 §8 entries marked settled.

**Out:**
- **14b:**
  - the executor;
  - the validator;
  - the frozen file in the store;
  - named checks and levels in the config;
  - the timeouts;
  - pinned git wired into every host git call;
  - the `.git` integrity hash;
  - the sample app's `[testing]`/`[checks]`/`[compose]` config;
  - image digests.
- **14c:**
  - the `run_tests` MCP tool;
  - its path rules;
  - the gate-result record;
  - the pre-step guard;
  - the bundle wiring and its probes.
- **Later units:**
  - JUnit/lcov parsing (unit 16);
  - `qa-explore` (unit 51).
- **Not in any unit:** changes to your Docker install or your `PATH`. Those are yours (open
  point 2).

## The probes

Canaries only. No probe reads a real `.env`, `~/.docker/config.json`, a key or a credential.
The probe that checks for proxy variables looks inside the container, not at your config. The
sample app isn't touched.

| Fact | What the probe does | Settled when |
|---|---|---|
| **G12** override and env auto-loading | `config` with `-f compose.yml --project-directory <fixture>`, with the canary `compose.override.yml` present. Then the same with `COMPOSE_FILE`, `COMPOSE_PROJECT_NAME`, `COMPOSE_PROFILES` and `COMPOSE_ENV_FILES` set by the caller, and set **inside a project `.env`**. Then `${VAR}` interpolation with `--env-file <trust copy>` vs a project `.env` | it's recorded which inputs reach the resolved file, and which flags and environment keep each out |
| **G12** what `config --format json` shows | one compose file per risky key: `privileged`, `cap_add`, `devices`, `network_mode: host`, `pid`/`ipc: host`, `security_opt`, `userns_mode`, `sysctls`, `extra_hosts`, `ports`, `build`, `env_file`, `configs`/`secrets` with `file:`, volumes with `name:`/`external:`/`driver_opts` bind, an external network, `develop`, `post_start`, `runtime`, `gpus`, `cgroup_parent`, a logging driver. Only `config` runs; no container starts | for each, the JSON field it appears as (or that it's dropped): 14b's allowlist is written from this list |
| **G12** host-side actions before any container | `include:` and `extends: file:` with a local file, and `include:` with an unreachable remote (`oci://mirai-probe.invalid/x`, `git` URL); a `provider:` service whose type names a fake plugin (a marker script in a plugin folder the probe controls) | it's recorded whether `config` alone fetches or runs anything. If it does, 14b must refuse those keys in the raw files before calling Compose |
| **G27** frozen file | `config --format json` → write → `up -d --no-build --pull never -p <name> -f <frozen> --project-directory <dir>`, then `docker inspect`. Checks for the same mounts, networks and env, a relative path in the frozen file, and whether `up` reads a project `.env` again | `up` accepts the frozen file unchanged, or the needed change is recorded |
| **G27** masks | container mounts the fixture root. `.git` is masked by an anonymous volume, then a `tmpfs`. Each `.env` is masked by a read-only bind of an empty MIRAI file, then `/dev/null` (a volume can't sit on a file). The container lists, reads, writes and `rm -rf`s each mask, and tries `umount` | no canary is read; the host's `.git` and `.env` are unchanged, byte for byte; it's recorded which mask form holds |
| **G27** masks and links | a symlink in the work tree to `.git` and to `.env`, and a nested `sub/.git` file (like a submodule) | the container never sees a canary through them |
| **G19** internal network | an `internal: true` network with two services. From one: `nslookup example.com`, `wget` to `1.1.1.1`, to `host.docker.internal:<canary port>`, to the Docker gateway, to the host's LAN address; then the other service by name; and the container's `*_PROXY` variables | no outside name resolves, no outside or host address answers, the other service does, no proxy variable is set |
| **G19** `ports` on an internal network | a published port on an internal network | recorded (14b refuses `ports` anyway) |
| **G19** sandboxed DNS | ~6 Haiku runs via `claude-probes.js --bundle`: the three lookups above, twice each | it's recorded whether the sandbox resolves names. **If it does and no setting closes it, it goes to you as a residual risk** (not a blocker: there's no network to send data back) |
| **Docker environment** | Compose through Desktop's client with `DOCKER_CONFIG=<a MIRAI folder>` holding only `currentContext` and the plugin folder, `DOCKER_HOST` unset vs set to Desktop's socket, `HOME` and `PATH` fixed | Compose works without your `~/.docker/config.json`, or what it needs from it is recorded |
| **P5 timeout** | `run` a container that sleeps; kill the Compose client with SIGTERM, then SIGKILL | it's recorded whether the container survives the client: if it does, 14b's timeout must `down` |
| **G15** hooks and fsmonitor | `core.hooksPath` to a marker hook folder; plain `.git/hooks/*`; `core.fsmonitor` as a script | each fires unpinned and doesn't with `-c core.hooksPath=<empty MIRAI folder> -c core.fsmonitor=false` |
| **G23** the other keys | each of these, alone: <ul><li>`filter.<x>.clean`/`smudge`/`process` with `.gitattributes`;</li><li>`diff.external`, `diff.<x>.textconv`;</li><li>`core.pager`, `core.editor`, `sequence.editor`;</li><li>`core.sshCommand` with an `ssh://` remote; `credential.helper` with the 401 server;</li><li>`gpg.program` with `commit.gpgsign`;</li><li>`include.path`, `includeIf.gitdir:`;</li><li>`protocol.ext.allow` with an `ext::` remote;</li><li>`remote.<x>.receivepack`/`uploadpack`;</li><li>`core.askPass`;</li><li>`merge.<x>.driver`;</li><li>`url.<x>.insteadOf` redirecting the push;</li><li>`core.worktree`;</li><li>`objects/info/alternates`;</li><li>`.git/info/attributes`;</li><li>`GIT_CONFIG_NOSYSTEM`/`GIT_CONFIG_GLOBAL` with a canary system and global file</li></ul> | for each key: neutralised by the pins (with which pin), or **not pinnable**, so only D-54's integrity hash catches it. The list goes to research/11 and 14b |

**About 70 Docker probe steps**, most of them `config` only and a few seconds each, and **about
40 git probes**, all local. Only the DNS half uses your subscription: about 6 short Haiku runs.
The probes run one at a time; the containers are tiny and gone at the end.

## Files

```
test/probes/docker-probes.js     # the Docker harness (run by hand, never by npm test)
test/probes/git-probes.js        # the git harness (run by hand)
test/probes/compose-fixture.js   # builds and removes the Docker/git fixtures; canary server
test/probes/compose-probes.js    # the Docker and git probe lists as data
test/probes/probes.js            # + the sandboxed-DNS probes for claude-probes.js
src/store/git-pins.js            # the pin set (data; wired in 14b)
test/probes/harness.test.js      # + T1–T4 below
research/11-docker-git-facts.md
research/09-claude-blocking-rules.md, design/05-open-questions.md   # rows marked settled
docs/agent-safety.md             # a short "tests run in containers" note, filled in by 14b
```

## Tests

| # | Test |
|---|---|
| T1 | **The Docker harness without Docker:** with a fake `docker` it builds the fixture, uses Desktop's client path and the allowlisted environment, names and labels every project, runs `down -v` before and after, flags a canary in the output, writes both reports, and cleans up even when a probe throws |
| T2 | **The git harness:** with a fixture repo and a harmless key it runs each command unpinned and pinned, and detects a marker file; it never runs outside the fixture |
| T3 | **Canaries only:** every Docker probe mounts only fixture paths and names only local images with `--pull never`; a probe that names a path outside the fixture, the Docker socket or a non-local image is refused by the harness. The git probes' remotes are local paths or 127.0.0.1 |
| T4 | **The pin set:** `git-pins.js` holds `GIT_CONFIG_NOSYSTEM=1`, a global config file MIRAI owns, the hooks and fsmonitor pins, and the rest of the probed `-c` list; no pin takes a value from the repo |
| T13 | (existing) `npm test` doesn't pick up `test/probes/` |
| P | **The real runs** (in `test-results.md` and research/11): every row above, on the versions named in Why |

## Open points for you

1. **Split unit 14 into 14a (facts), 14b (the executor) and 14c (the tool).** I recommend it.
   The facts decide the validator's allowlist, the mask forms, the timeout behaviour and which
   git keys need the hash. 14b alone is bigger than 13b was.
2. **The old `docker` on your `PATH`:** `/usr/local/bin/docker` points into a backup folder of
   Docker 3.4.0 (client 20.10.7, from 2021). MIRAI will use Docker Desktop's own client by
   absolute path either way, and record its path and version in `~/.config/mirai` (machine
   data, never the repo). Whether you fix the symlink is up to you; I won't touch it. Fixing it
   means pointing it at `/Applications/Docker.app/Contents/Resources/bin/docker`, or letting
   Docker Desktop reinstall its CLI tools.
3. **What runs on your machine:**
   - Docker containers from `nginx:1.27-alpine` (already local, nothing pulled);
   - a harness-owned HTTP server on 127.0.0.1 for the length of the run;
   - about 6 short Haiku runs for sandboxed DNS.

   I run the harnesses from here. If this session's sandbox blocks the Docker socket, you run
   `node ~/Projects/mirai/test/probes/docker-probes.js --yes` in your terminal once the spec is
   committed, and I read the reports.
4. **The fixture lives under your home folder and is removed after**, not in the sample app.
   The probes plant hostile git config and canary `.env` files. The sample app's real run comes
   with 14b.

## What 14b and 14c will do (for orientation; each gets its own spec)

**14b, the test executor** (`src/tests/`):
- **Config to command.**
  - Test levels and named checks come from the trust-root config (`[testing] levels`,
    `[checks]`, `[compose] files`/`env_file`).
  - The `compose` call uses absolute trust-root paths, MIRAI's own Docker config folder, a
    cleared environment and a unique project name per run.
- **Before Compose runs:** raw files are refused if they carry a key 14a shows acting on the
  host (`include`, `extends`, `provider` and so on).
- **The allowlist.** It's written from 14a's list: images that exist locally, `command`,
  `environment` from the dummy env file, project-source volumes with the required masks, one
  internal network, `depends_on`, `healthcheck`, `working_dir` and `user`. Everything else is
  refused.
- **Freezing.** `config` → the allowlist check → the frozen file is written to the store → `up`
  runs it.
- **During and after the run:**
  - `docker inspect` checks the containers;
  - `down -v` runs before and after;
  - a hard timeout, which also stops the containers;
  - output is capped.
- **Pinned host git** in every git call, and **the `.git` integrity hash** (`config`, `info/`,
  the hooks listing, the refs), checked before and after every run.
- **The sample app** gets its config, pinned image digests, and a real run of each level and
  check.

**14c, the `run_tests` tool:**
- **The server.** A minimal MCP server from the trust root, which unit 15's broker later grows
  into.
- **The tool.**
  - `run_tests(level, path?)` is strict about its arguments. `path` follows D-48's pattern, its
    real path is inside the project, and it's passed after `--`.
  - Results come back inline.
  - The gate result is signed as a record.
  - The pre-step guard checks for a clean tree, the right branch and a healthy stack.
- **The bundle.** The tool is wired in (`--mcp-config`, the tool in `--tools`), with
  bundle probes in which a real Haiku run calls `run_tests` and every refused case is tried.

## Changes after testing and review

1. **Masks over files don't hold on this Mac (the review's finding, confirmed by probe).** On the
   case-insensitive disk Docker Desktop shares, another spelling of a masked name (`.ENV` for
   `.env`) reads the real file. A write through it changed the fixture's real `.env`. The folder
   masks over `.git` held, for reasons that aren't understood.

   **Proposed for 14b, for your decision at "UNIT APPROVED":** test containers never mount the
   work tree. They get a fresh copy for each run, made by MIRAI: the files git lists, without
   `.git` or real `.env*`, plus the trust root's dummy env file. Test output goes to a separate
   folder. This keeps D-49's rule (no secrets, no `.git` in test containers) but changes its
   mechanism, masks becoming a copy. It also closes the review's other finding: with the work
   tree mounted read-write, a test could write anything into it.
2. **More pins** (`src/store/git-pins.js`), each probed:
   - every signing program, with signature checks off. An ssh-signed commit ran
     `gpg.ssh.program` on `merge` and `log`;
   - the submodule pins;
   - every untracked file listed;
   - no colour and standard diff prefixes;
   - the plain `http.proxy` (found by g1b);
   - `--no-color` in the diff flags.
3. **Not pinnable, newly found:** a URL-scoped `http.<url>.proxy`, a `.git` file or `.git/commondir`
   pointing elsewhere, and a nested repo (`add -A` runs its filter). So 14b gets a **repo config
   allowlist** and a **repo shape check** on top of D-54's hash (research/11).
4. **Probes added:**
   - 7 git probes;
   - a Compose control that shows the override does load;
   - case-variant reads and writes in the mask probes;
   - a TCP connect for the outside-IP check, which the control reaches.
5. **Stricter checks and guard:**
   - a pass needs the run's end marker (the two `dscacheutil` runs were re-run);
   - the guard covers `~` paths, object includes, `extends.file`, device objects and the
     arguments of plain `docker` calls;
   - the ssh probe targets 127.0.0.1.
6. **Not probed, recorded:**
   - `remote.<x>.uploadpack` (unit 22, with fetch);
   - the host's LAN address (the missing default route is the evidence).
7. **Harness fixes found by the runs:**
   - test servers in a child process, since a synchronous git or Docker call blocked the
     harness's own;
   - the `includeIf` pattern;
   - the section parser;
   - surviving P5 containers force-removed and networks swept;
   - the one-letter volume name (a Compose quirk, now probed on purpose).
8. **The docs** (`docs/agent-safety.md`): tests get a copy, not your project folder; unknown repo
   config is refused.

## Noted for later units

See `review.md` for the full list. In short:
- **14b:**
  - the copied tree (1);
  - the repo config allowlist and shape check;
  - `top` from MIRAI's record;
  - the hash's full scope;
  - what the pins change for today's git calls (your global excludes, commit identity, Git LFS);
  - JSON-only or a strict YAML subset for the compose prescan;
  - a stack-neutral allowlist with per-project opt-ins;
  - MIRAI's own resource limits;
  - a clear error when Docker Desktop isn't running;
  - the remaining Compose probes (`run`, `--wait`, digests, resource keys, `--env-file` on the
    frozen `up`).
- **22:**
  - pushing with the pins (per-operation transport and credential, `ls-remote --get-url`);
  - the pinned hooks path and D-54's pre-push;
  - unsigned commits;
  - worktrees;
  - fetch and rebase probes.
- **18:** re-run the case-variant and git-bypass probes after Docker or git updates.
