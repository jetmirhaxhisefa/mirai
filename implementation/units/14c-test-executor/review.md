---
unit: "14c"
date: 2026-10-27
reviewers: Tech Lead, Architect (independent, read-only, no network, no Docker)
verdicts: Tech Lead "not approvable as is, approvable after fixes"; Architect "changes required" (one High); both Highs and every Medium fixed, tested and probed; the rest fixed or noted
---

# Unit 14c — Review

Both reviewers worked on a frozen tree, with pure-JS reproductions in their own folders under
`/private/tmp` (removed). They made no network calls, ran no Docker, read no secrets and changed
nothing in either repo. Each ran `test/tests/test-run.test.js` (13 / 13).

**What held up:**
- **The compose inputs:** from the trust root, hashed against the manifest, by absolute path. A
  branch's override file is never loaded.
- **The Docker environment:** four fixed variables, MIRAI's own `DOCKER_CONFIG`, Desktop's client
  by path.
- **The allowlist:** closed for every key named, including `deploy`, `gpus`, `use_api_socket`,
  `cgroup_parent`, `storage_opt`, `oom_*`, `platform`, `label_file` and `x-*`. Networks are forced
  internal and named `<project>_*`; volumes are the project's only.
- **The run:** `--no-build --pull never`; the frozen file only; cleanup in `finally`, in layers.
- **Env files and output:** left out at any depth and in any case; redaction after escape codes
  are stripped.
- **The snapshot:** the format bump rebuilds cleanly.
- **The evidence:** the 20 probes and the sample app's runs, for everything but link resolution.
- **Stack neutrality,** enforced by T13.
- **"Reuse the daytime file, tightened"** is sound as the default (Architect).

## Fixed in unit 14c

| # | Finding | From | Fix | Test / probe |
|---|---|---|---|---|
| 1 | **High:** a chain of links that stays inside on paper (`a/b/up -> ../..`, then `sub -> a/b/up/../../../O`) led out of the copy. An outside file was read and a file was written outside it (reproduced). The bind check had the same text-only gap | both | **The copy follows nothing:** a path under a link is refused; a link is copied only when it points further down (no leading `/`, no `..`); files are read through a descriptor that doesn't follow links. **The bind check:** a source must be a plain path, with no link and no `.`/`..` along it, and its real path inside the copy | T1 (chains, parent-folder links, `..`), T14 (bind sources) |
| 2 | **High:** a service that has started can swap a folder that a later service mounts (one-off runs weren't inspected either). Reasoned by the Tech Lead; **probed:** Docker Desktop follows an *absolute* link as a mount source, and a running service can make one | Tech Lead | **Separate copies:** a bind inside another service's writable bind gets its own copy, outside every mount. **Inspect:** one-off runs now start in the background (`run -d`), are inspected, waited for and their logs read | c21 (and its failing control), T14, T7 |
| 3 | A hard link brought `.env`'s content in under a harmless name. The kept dummy env files came from the work tree | Tech Lead | A file with two names on disk is refused. Kept env files are written from the base commit's blobs | T1 |
| 4 | Cleanup never checked its result. Ctrl-C or a crash left containers behind | Tech Lead | **Checked:** after cleanup the project is listed again, and anything left is an environment fault. **On start:** each run sweeps projects of the same repo left by crashed runs, under a per-repo test lock. **Ctrl-C:** stops the current Docker call, and the run still cleans up | T8, T14 |
| 5 | Inspect checked less than the spec says | both | Each container's binds must equal its service's binds in the frozen file. Host settings are checked (privileged, capabilities, devices, PID/IPC/UTS/userns modes, security options, sysctls), and `network inspect` must show `Internal` | T7 |
| 6 | A stack that wouldn't start exited like a failing test, and refusals left no result | Architect | **Every run that gets that far stores a typed `result.json`:** `pass`, `fail`, `timeout`, `env-fault` or `refused`, with a `code`. An environment fault exits 5 (needs you) | T7, T14 |
| 7 | The output folder had no size or depth cap, and test-run folders grew without end | both | Caps of 1,000 files, 256 MiB and 16 levels (`out_over_cap`). The last 20 run folders are kept | T14 |
| 8 | Concurrency: two runs at once | Architect | One run at a time per repo (a store lock); a second gets `test-busy` | T14 |
| 9 | The prescan missed YAML explicit keys (`? env_file`) | both | Refused | T14 |
| 10 | `..` in a bind source passed the inside check | Tech Lead | Refused (item 1's plain-path rule) | T14 |
| 11 | A symlinked compose or env file on main broke the whole trust snapshot | Tech Lead | Left out of the snapshot; the test run says it must be a committed file, not a link | T14 |
| 12 | The `stack-down` message carried Compose's stderr unredacted | Tech Lead | The whole message is redacted | T7 |
| 13 | Clearer errors for a missing compose file or env file | Tech Lead | Both say what's missing and where it must be | T14 |
| 14 | No probe of reaching the Mac through Docker Desktop's own names | Tech Lead | c22: `host.docker.internal` and `gateway.docker.internal` to a canary server; 0 hits | c22 |
| 15 | **Docs:** two claims false until item 1 was fixed; inspect overstated; residual risks not stated | Architect | `docs/agent-safety.md` rewritten: the link rules, separate copies, what inspect checks, the five outcomes, the Docker Desktop requirement, and residual risk (agent test code, your images, the output as a way back) | — |
| 16 | **Deviations not in the spec:** run folders in `tests/`, `service` checked at run time, the check `workdir`'s new meaning, the extra harmless keys (`stop_signal`, `expose`, `hostname`) | both | The spec's "Changes after testing and review"; D-48 notes the folder | — |

## Noted for later units (in the spec)

| Unit | Note | From |
|---|---|---|
| 14d | <ul><li>Async Docker calls (no `spawnSync` blocking an MCP server), with cancellation and progress;</li><li>a global cap on parallel runs;</li><li>the gate bound to the tree hash, plus `sha256(compose.frozen.json)` and the trust manifest hash;</li><li>the clean-tree guard made required;</li><li>how the merge step recomputes the hash from a commit</li></ul> | Architect |
| 15 | One queue per repo in the broker; it owns pruning | Architect |
| 16 | `out/` is hostile: `O_NOFOLLOW` with an `lstat` re-check, size and depth caps, XML parsed with no entity expansion | both |
| 17 | <ul><li>Build images from the integration branch's Dockerfiles before a session;</li><li>default `pids_limit` and memory limits;</li><li>setup detects `env_file: .env` and other prescan refusals in daytime compose files, and suggests a test file</li></ul> | Architect |
| 18 | <ul><li>The link chains, the absolute-link mount and the explicit-key forms go in the red-team suite;</li><li>re-run `test-run-probes.js` after Docker updates</li></ul> | both |
| Later | <ul><li>A machine-level runtime profile (OrbStack, colima, Linux: client path, socket, how mounts are reported, `/host_mnt`), each one probed before it's allowed;</li><li>on Linux there is no VM, so check the user/userns defaults</li></ul> | Architect |
