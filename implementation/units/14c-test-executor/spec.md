---
unit: "14c"
name: test-executor
status: approved (2026-10-26); unit approved (2026-10-27)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 14 (split into 14a–14d); D-48, D-49; research/11
depends_on: ["14b"]
---

# Unit 14c: The test executor

## Why

Agents must be able to run the project's tests, but never with control of Docker or your Mac
(D-48, D-49). 14a settled the facts and 14b made MIRAI's own git safe. This unit builds the part
that actually runs a test level or a named check (`unit`, `lint`, …) in the project's own
containers:
- **from a copy of the project**, never your folder. On this Mac, masks over `.env` leak through
  another case of the name (14a);
- **from compose files taken from the integration branch** (the trust root), never the branch
  under test;
- **resolved once, checked against an allowlist, frozen and run as frozen;**
- **on an internal network,** with a hard timeout that also removes the containers.

14d then exposes it to agents as the `run_tests` tool. Until then you start it yourself with a
new command, `mirai test <name>`. The sample app's real runs use that command.

**Versions:** as 14a: Docker Desktop 29.6.2, Compose 5.3.1, git 2.39.5, macOS 26.7.

**Roadmap "done when" covered here:**
- a marker change on the branch is seen by the test run;
- a seeded `compose.override.yml`, a host mount, a `.git` mount and a Docker-socket mount are
  each refused;
- a test that tries to reach the internet fails;
- a real `.env` is never mounted;
- an unknown level or check is refused;
- two runs never share a Compose project.

The `run_tests` tool, the gate-result record and the pre-step guard are 14d's.

## Scope

**In:**
1. **The copied tree** (14a's proposal; open point 1). Each run gets a fresh copy at
   `<store>/runs/<run>/tree/`:
   - **what's copied:** the files `lsFiles` lists, tracked plus new ones not ignored, so 14b's
     nested-repo check comes with it;
   - **copied as clones** (APFS `COPYFILE_FICLONE`, near-free), with file modes kept;
   - **what's never copied:**
     - `.git`;
     - every `.env*` file at any depth, in any case. The exceptions are `[compose] env_file`
       and `[sandbox] readable_env`, which must be committed files;
     - ignored files (`vendor/`, `node_modules/` come from the images and their volumes, as
       the sample app's Dockerfiles already arrange);
   - **links:** a symlink is copied as a link only when it is relative and stays inside the
     copy; any other symlink stops the run, with its path named. Nothing is ever followed;
   - **limits:** 100,000 files and 2 GiB by default; past them the run stops with a clear
     message;
   - **the tree hash** (SHA-256 over sorted path, mode and content hash) goes in the result. 14d
     binds the gate result to it;
   - **removed after the run,** whatever happened.
2. **Compose inputs in the trust root.** The snapshot (format 3) also holds `[compose] files` and
   `[compose] env_file`, from the integration branch's commit. A run uses those files by
   absolute trust-root path, never the copies in the work tree. A branch that changes them
   changes nothing until it's merged; they're protected paths already (unit 12).
3. **The raw-file prescan** (open point 3): before Compose reads anything, each trust-root
   compose file is refused if its text holds:
   - `include`, `extends`, `env_file`, `provider` or `models` as a key (14a: they act on the
     host or are hidden by resolving);
   - a YAML tag, an anchor with a merge key (`<<`), or a backslash escape in a double-quoted
     key.

   The scan is deliberately coarse and fails closed: a false match is refused with the line, and
   you rewrite the file.
4. **One Compose call, the same shape every time** (research/11):
   - **the client:** Docker Desktop's own, by absolute path, never the `docker` on `PATH`;
   - **the environment:** only `PATH`, `HOME`, `DOCKER_HOST` (Desktop's socket) and
     `DOCKER_CONFIG`. That's MIRAI's own folder `<mirai-home>/docker/`, holding only
     `cliPluginsExtraDirs`, so none of your `~/.docker/config.json` is read. No `COMPOSE_*`;
   - **the flags:** `-f` for each trust-root file, `-p mirai-<repo-id>-<run>`, `--project-directory
     <copy>`, `--env-file <trust-root env file>`;
   - **Docker Desktop not running** gives "start Docker Desktop", not a socket error.
5. **Tighten, then allowlist** (open point 2). `config --format json` resolves the files. MIRAI
   then:
   - **removes a short fixed list** that only matters for your daytime stack: `ports`, `build`,
     `restart`, `container_name`, `develop`, `profiles`;
   - **makes every network `internal: true`;**
   - **adds its labels** (run id, repo id) and **the output folder** (item 7).

   Each of these only narrows what the file allows. The result must pass **the allowlist**,
   written from 14a's list. Anything not named is refused, naming the service and the key.

   | Where | Allowed |
   |---|---|
   | top level | `name` (MIRAI's), `services`, `networks` (internal only, no `external`/`name`/`driver`), `volumes` (no `external`/`name`/`driver`/`driver_opts`) |
   | a service | <ul><li>`image`: a local image, by name or digest, never pulled;</li><li>`command`, `entrypoint`, `environment`, `working_dir`, `user`;</li><li>`depends_on`, `healthcheck`;</li><li>`networks`: the project's own;</li><li>`volumes`: a bind whose source is inside the copy or the run's output folder; a project volume; an anonymous volume; `tmpfs`;</li><li>`tmpfs`, `read_only`, `init`, `stop_grace_period`, `tty`, `stdin_open`;</li><li>MIRAI's `labels`;</li><li>with `[compose] allow`, from a fixed safe list: `shm_size`, `ulimits`, `mem_limit`, `cpus`, `pids_limit`</li></ul> |
   | always refused | <ul><li>**host access:** `privileged`, `cap_add`, `devices`, `network_mode`, `pid`, `ipc`, `uts`, `cgroup`, `security_opt`, `userns_mode`, `sysctls`, `runtime`, `gpus`;</li><li>**Docker and host state:** `configs`, `secrets`, `volumes_from`, `links`, `extra_hosts`, `dns`, `logging`, `post_start`, `provider`;</li><li>**mounts:** any bind outside the copy (the Docker socket, your home, `/`), and any target that isn't an absolute POSIX path (14a's `v:/x` quirk)</li></ul> |
6. **Freeze and run.**
   - **Freezing:** the checked JSON is written to `<store>/runs/<run>/compose.frozen.json`, and
     only that file runs (`-f <frozen>`, `--no-build --pull never`).
   - **Before:** `down -v` on the project name.
   - **The run:** `up -d --wait` on the level's service and what it depends on, then the
     command:
     - `exec -T <service> <command…>` (the default);
     - or `run --rm -T <service> <command…>` for a one-off service such as Playwright
       (`run = "oneoff"`).

     `path` is passed after `--` (14d checks it).
   - **After `up`:** `docker inspect` checks each container: the mounts match the frozen file,
     the networks are internal only, and nothing is privileged.
   - **After the command:** the containers are force-removed by the project label, then
     `down -v`, always, including after a failure or timeout (14a's P5).
   - **A hard timeout** per level or check (`timeout_minutes`, default 15). It's reported as an
     environment fault, never as a failing test.
7. **The result.**
   - **Run facts:** exit code, duration, timed out or not, the tree hash, and each service's
     image ID.
   - **Output:** the last 64 KiB of combined output, with token-shaped strings redacted
     (`registry/secrets/core.toml`).
   - **The output folder:** `<store>/runs/<run>/out/` is mounted read-write at `/mirai/out` in
     the level's service, for JUnit, coverage and screenshots. Afterwards MIRAI lists it
     (regular files only, no links followed, size caps). Parsing those files is unit 16's.
   - **Stored** as `<store>/runs/<run>/result.json`; the tree and the frozen file's mounts are
     gone afterwards.
8. **Config** (`.mirai/config.toml`, project layer):
   - **`[testing] levels` and `[checks]` gain:**
     - `service` (required: everything runs in a container);
     - `workdir`;
     - `timeout_minutes`;
     - `run = "exec" | "oneoff"`;
   - **`[compose]` gains:** `allow` (the safe list above) and `output = "/mirai/out"` (the
     mount target, changeable);
   - **an unknown level or check name** is refused, listing the configured ones.
9. **`mirai test <name> [--path <p>]`:** runs one level or check now, from your terminal, and
   prints the result. It's for you and for this unit's runs. Agents can't run `mirai` (13b), so
   they get it through `run_tests` in 14d.
10. **The sample app's own config (data, not MIRAI code)** (open point 4). Its config gets:
    - **`[compose]`:** `files = ["docker-compose.yml"]` (the daytime file, tightened) and
      `env_file = ".env.test"`, a new committed file holding `APP_ENV=testing`;
    - **`environment: APP_ENV: ${APP_ENV:-local}`** for `app`, so the test run uses the
      committed `backend/.env.testing` without a real `.env`;
    - **levels:**
      - `unit` (`php artisan test` in `app`);
      - `frontend` (`npm test` in `frontend`);
      - `e2e` (`npx playwright test` in `playwright`, `run = "oneoff"`);
    - **checks:** `lint` (`npm run lint` in `frontend`).
11. **Probes** (Docker, local images only, as 14a), the open facts from 14a's review:
    - `up --wait` with healthchecks, `exec` and `run` on a frozen file;
    - `--env-file` on the frozen `up`;
    - a digest image reference with `--pull never`;
    - the safe-list keys in `config` JSON;
    - the output-folder bind;
    - removal of a timed-out `exec`.
12. **Docs:** `docs/agent-safety.md` "Tests run in containers" filled in (what runs, what a test
    sees, what you configure); research/11 notes the 14c rows done.

**Out:**
- **14d:**
  - the `run_tests` MCP tool and its argument rules;
  - the signed gate result;
  - the pre-step guard (clean tree, right branch, healthy stack);
  - `qa-explore` scripts as content;
  - the bundle probes.
- **Building images:** images must already exist locally; a missing one is a clear error ("build
  it: docker compose build <service>"). Building from the integration branch's Dockerfiles before
  a session (D-48, TL3-3) is a later unit's (17, setup).
- **Unit 16:** parsing JUnit, lcov and Cobertura from the output folder.
- **Later:** MIRAI's own default resource limits (a default `pids_limit`, memory); for now only
  the opt-in safe list.

## Files

```
src/tests/copy.js            # the copied tree, its limits and hash
src/tests/compose.js         # prescan, the Compose call, tighten, allowlist, freeze
src/tests/run.js             # up/exec/run, inspect, timeout, cleanup, the result
src/tests/docker.js          # Desktop's client, MIRAI's DOCKER_CONFIG, "is Docker running"
src/cli/commands/test.js     # mirai test <name> [--path]
src/config/config-schema.js  # level/check fields, [compose] allow/output
src/trust/snapshot.js        # format 3: compose files and env file
test/tests/*.test.js         # T1–T12 (a fake docker for the pipeline; no Docker in npm test)
test/probes/docker-probes.js, compose-probes.js   # + 14c's probes
docs/agent-safety.md, research/11-docker-git-facts.md
mirai-sample-app: .mirai/config.toml, docker-compose.yml, .env.test   # your repo: committed by you
```

## Tests

| # | Test |
|---|---|
| T1 | **The copy:** tracked and new files copied with modes; `.git`, ignored files and every real `.env*` (any depth, any case) left out; `env_file` and `readable_env` kept; an outward or absolute symlink stops the run; a nested repo is refused; limits; the tree hash changes with one byte; the copy is gone afterwards |
| T2 | **Trust-root inputs:** the snapshot holds the compose files and env file from the base commit; a work-tree edit to them changes nothing; a branch's `compose.override.yml` is never passed |
| T3 | **The prescan:** each refused key or form is refused with its line; a clean file passes |
| T4 | **The call:** with a fake docker, every call has Desktop's path, the four-variable environment, `-f`/`-p`/`--project-directory`/`--env-file`, no `COMPOSE_*`; a unique project per run; "start Docker Desktop" when the socket is missing |
| T5 | **Tighten:** each removed key is gone; every network becomes internal; labels and the output mount are added; nothing else changes |
| T6 | **The allowlist:** each always-refused key, a bind to `/`, `~`, the Docker socket or outside the copy, a non-POSIX target, an external network or volume, and a non-local image are each refused naming service and key; the sample app's tightened file passes; `[compose] allow` lets exactly its keys through |
| T7 | **Freeze and run:** the frozen file is what `up` gets; `down -v` before and after; `exec` vs `run`; `path` after `--`; inspect mismatches stop the run |
| T8 | **Timeout:** the client is killed, containers force-removed by label, `down -v`, result `timed_out: true` as an environment fault |
| T9 | **The result:** output tail capped and redacted (the login token's exact value and the shapes); the output folder listed without following links; image IDs; stored |
| T10 | **Config:** new fields validate; `service` required; an unknown name refused with the list; `[compose] allow` only from the safe list |
| T11 | **`mirai test`:** exit codes (pass, fail, timeout, refused), output, `--path` |
| T12 | **Probe harness additions:** the new probes stay canary-only and local (14a's guard) |
| P | **Real runs** (`test-results.md`): the new probes; on the sample app, `mirai test unit`, `frontend`, `lint` and `e2e` pass; a marker change in the work tree is seen; a seeded `compose.override.yml`, a host mount, a `.git` mount and a socket mount (each in a throwaway fixture's trust root) are refused; a test that reaches for the internet fails; the container sees no `.git` and no real `.env`; two runs use different projects; a timeout leaves no container behind |

## Open points for you

1. **A per-run copy of the project instead of masks** (14a's finding). I recommend it.
   - **Why:** masks over `.env` files leak on this Mac through another case of the name, and a
     read-write mount lets a test write anything into your project.
   - **What it means:** tests see the project as git sees it (tracked plus new, not ignored).
     Dependencies come from the images and their volumes. Each run starts clean.
   - **The cost:** a copy per run. APFS clones make it near-free, and the copy is removed after.
2. **Reuse the daytime compose file, tightened.** I recommend it. MIRAI removes `ports`, `build`,
   `restart`, `container_name`, `develop` and `profiles`, makes networks internal, then
   allowlists everything. Each of those changes only narrows the file, so a project needs no
   second compose file. The alternative is a separate test compose file per project: stricter to
   read, but more setup for every developer.
3. **The raw-file prescan is a coarse text scan, not a YAML parser.** The files come from the
   integration branch, which you reviewed, so this is a second line of defence. A
   full YAML reader for compose files would be a unit of its own, like 07a. The scan fails
   closed.
4. **Changes to your `mirai-sample-app`:**
   - `.mirai/config.toml`: levels, checks and `[compose]`;
   - `docker-compose.yml`: `APP_ENV` for `app`;
   - a new `.env.test`.

   I write them in its work tree, show you the diff, and you commit and push to `main` (the
   trust root reads them from there). They're protected paths, which is intended.
5. **What runs on your machine:**
   - **Docker containers:** from the sample app's own local images (`mirai-sample/*:dev`,
     `mysql:8.4`, `nginx:1.27-alpine`) and `nginx:1.27-alpine` for the probes. Nothing is pulled
     or built;
   - **files:** a copy of the sample app per run, in its MIRAI store, removed after;
   - **nothing else:** no Claude runs, no network for the tests;
   - **Docker Desktop must be running.**

## What 14d will do (for orientation; it gets its own spec)

**The `run_tests(level, path?, script?)` tool:**
- a minimal MCP server from the trust root, which unit 15's broker later grows into;
- strict arguments: D-48's `path` pattern, its real path inside the project, passed after `--`;
- results inline;
- the gate result signed as a record, bound to 14c's tree hash;
- the pre-step guard (clean tree, right branch, healthy stack);
- the bundle wiring, with probes in which a real Haiku run calls `run_tests` and every refused
  case is tried.

## Changes after testing and review

1. **No link is ever followed into or out of the copy** (both reviewers' High, reproduced).
   - **The problem:** a chain of links that stays inside on paper led out. The copy then read
     an outside file and wrote outside itself.
   - **What changed:**
     - a path under a link is refused;
     - a link is copied only when it points further down in its own folder (no leading `/`, no
       `..`);
     - files are read through a descriptor that doesn't follow links;
     - a file with two names on disk (a hard link) is refused;
     - the committed dummy env files are written from the base commit, not the work tree.
   - **Mounts:** a source must be a plain real path inside the copy, with no link or `..` along
     it.
2. **A mount inside another service's writable mount gets its own copy** (the Tech Lead's
   second High, probed).
   - **The fact:** Docker Desktop follows an absolute link as a mount source. So a service that
     has started can redirect a later service's mount. The control read a canary from outside
     the project.
   - **The fix:** such a mount gets a separate copy, outside every mount. That service sees the
     folder as it was when the run began. For the sample app that's nginx's `backend/public`,
     and e2e still passes.
3. **One-off runs** (`run = "oneoff"`) start in the background, are inspected, waited for and
   their logs read, instead of `run --rm`. **Inspect** now checks each container's mounts
   against the frozen file exactly, its host settings, and that the networks are internal.
4. **Every run that gets that far stores a typed result:** `pass`, `fail`, `timeout`,
   `env-fault` or `refused`, with a code.
   - **An environment fault** (the stack didn't start, Docker, cleanup) exits 5 (needs you),
     never like a failing test.
   - **A stack that doesn't start** shows its exited containers' last log lines, redacted.
5. **Cleanup checks itself;** anything left is an environment fault.
   - **One run at a time per repo** (a store lock).
   - **Each run first sweeps** what a crashed run of the same repo left.
   - **Ctrl-C** stops the current Docker call and still cleans up.
   - **The store keeps the last 20 run folders.**
6. **Limits and checks added:**
   - **the output folder** is capped at 1,000 files, 256 MiB and 16 levels;
   - **the prescan** also refuses YAML explicit keys (`?`);
   - **a symlinked compose or env file on main** no longer breaks the trust snapshot: the test
     run says it must be a file;
   - **terminal colour codes** are stripped from output, and the whole error message is
     redacted;
   - **`/host_mnt`:** Docker Desktop's VM view of a Mac path is mapped back in inspect;
   - **`--progress quiet`** keeps Compose's progress lines out of the output;
   - **`--profile '*'`** resolves services behind a profile.
7. **Not built as specified:**
   - **Run folders** are `<store>/tests/<id>/`, not `runs/<run>/`: `runs/` already holds the run
     logs. D-48 notes this.
   - **`service`** is required when a level or check runs, not by the schema: existing configs
     without it still load.
   - **A named check's `workdir`** is now an absolute path in the container, as for levels. It
     used to be a repo-relative path that nothing read.
   - **The allowlist** also allows `stop_signal`, `expose` and `hostname` (harmless).
8. **The sample app's own config** (data, not MIRAI code), committed by you as `4fd3e11`:
   - `[sandbox] readable_env = ["backend/.env.testing"]`, the committed dummy file its
     entrypoint needs in test runs;
   - `SESSION_DRIVER=file` in `backend/.env.testing`, so the browser test stays logged in.
     PHPUnit still forces `array`.
9. **Stack neutrality (your question with the spec):**
   - item 10 is labelled as the sample app's data;
   - **T13** checks that `src/tests/` names no language, framework, tool or stack variable;
   - the docs say MIRAI needs Docker Compose (today Docker Desktop on macOS), not a language.
10. **The docs** (`docs/agent-safety.md`) cover:
    - the link rules and separate copies;
    - what inspect checks;
    - the five outcomes;
    - **residual risk:** the test code is the agent's; the images are the ones you built; the
      output goes back to the agent.

    D-49 notes the copy instead of the masks (your decision with this spec).

## Noted for later units

See `review.md` for the full list. In short:
- **14d:**
  - async Docker calls with cancellation, and a global cap on parallel runs;
  - the gate bound to the tree hash, plus the frozen file's and the trust manifest's hashes;
  - a required clean-tree guard.
- **15:** a queue per repo in the broker, which owns pruning.
- **16:** treat `out/` as hostile (no links, caps, no XML entity expansion).
- **17:**
  - build images from the integration branch before a session;
  - default resource limits;
  - setup flags daytime files the prescan refuses.
- **18:** red-team the link chains, the absolute-link mount and explicit keys; re-run the probes
  after Docker updates.
- **Later:** runtime profiles for OrbStack, colima and Linux, each probed before it's allowed.
