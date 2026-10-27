---
unit: "14c"
name: test-executor
date: 2026-10-27
node: v22.23.2
docker: Docker Desktop 29.6.2 (engine and client), Compose 5.3.1
git: 2.39.5 (Apple Git-154)
macos: 26.7
result: 256 / 256 pass (earlier units' 242 + unit 14c's 14) after the review fixes; 22 / 22 test-run probes through MIRAI's own runTest on Docker Desktop, nothing left behind, with a control showing the nested-mount attack the review found is real; the sample app's 4 levels and checks ran for real before and after the fixes (failures only from its seeded known failure and flaky test)
---

# Unit 14c — Test results

## `npm test`

New in `test/tests/test-run.test.js` (a fake `docker` records every call; no Docker in `npm test`):

```
14c T1: the copy: tracked and new files with modes; no .git, ignored or real .env files; links stay inside; limits; the tree hash
14c T2: the compose inputs come from the base commit's trust root, never the work tree
14c T3: the prescan refuses keys that act on the host, tags, merge keys and escaped keys, with the line
14c T4: every Docker call: Desktop's client by path, four variables, the same flags; no COMPOSE_*; a unique project; "start Docker Desktop"
14c T5: tighten removes the daytime keys, makes networks internal, adds labels and the output mount, and nothing else
14c T6: the allowlist refuses everything it doesn't name, naming service and key
14c T7: the run: frozen file, down before and after, exec vs oneoff, --path after --, inspect mismatches stop it
14c T8: a timeout is an environment fault: the client killed, containers force-removed, down -v
14c T9: the result: output tail capped and redacted, the output folder listed without following links, stored
14c T10: config: the new fields validate; an unknown name is refused with the list; a level needs a service
14c T11: mirai test: output, exit codes for pass, fail, timeout and refusal, --path
14c T12: the Docker probe scenarios stay canary-only and local
14c T13: the test runner is stack-neutral: no language, framework or tool names in src/tests/
```

**Existing tests changed by this unit:**
- **cli T14:** the pinned command list gains `test`.
- **strict T1:** the snapshot format is 3, since it now holds the compose inputs.

The two fixes found by the real runs (item 3 below) are covered:
- **T7:**
  - an inspect result with `/host_mnt/<copy>` passes. With the mapping removed, T7 fails; I
    checked that by mutating the code and restoring it;
  - a service that doesn't start fails with its last log lines, redacted.
- **T9:** terminal codes are stripped, even when one splits a token.

```
# tests 255
# pass 255
# fail 0
```

## Probe runs: MIRAI's own `runTest` on Docker Desktop

`node test/probes/test-run-probes.js --yes`. The fixture is a git repo under `~` with MIRAI
installed and a temporary MIRAI home. Each scenario commits its compose file and config on
`main`, changes the work tree, and runs one level. The only image is `nginx:1.27-alpine` (local,
never pulled). After every scenario the harness checks that no container, network or volume of
the run is left.

| Scenario | Result |
|---|---|
| c1-exec | pass. In the test, `/w` held the work tree's uncommitted `marker.txt` and the dummy `.env.test`. No `/w/.git`, `/w/.env` or `/w/sub/.ENV`; the canary never appeared. `MODE=test` came from the trust-root env file, and `junit.xml` written to `/mirai/out` was listed |
| c2-fail | pass: outcome `fail`, exit 3 |
| c3-path | pass: `args:-- tests/a b.php` |
| c4-oneoff | pass: a service behind a profile, run once after its dependency was healthy; the peer answered by name |
| c5-no-internet | pass: no TCP connection to `1.1.1.1:443`, no `nslookup example.com` |
| c6-override | pass: the committed `compose.override.yml` (privileged, a canary env) was never loaded |
| c7–c12 | pass, refused: a host mount (`/Users`), a `.git` mount, a real `.env` mount, the Docker socket, `privileged`, `network_mode: host` |
| c13-env-file-key | pass, refused by the prescan, with the line |
| c14 / c15 | pass: `shm_size` refused, then run with `[compose] allow = ["shm_size"]` (`/dev/shm` was 256M) |
| c16-digest | pass: `nginx@sha256:…` with `--pull never` |
| c17-unknown | pass: refused with the configured names |
| c18-link-out | pass: a link to `/etc` stops the run |
| c19-missing-image | pass: refused, never pulled |
| c20-timeout | pass: outcome `timeout`, exit `null`, nothing left after the 1-minute limit |

Every run had its own Compose project. The final run was on the final code.

**The runs before it found three things, now fixed:**
- **Compose's progress lines** ("Creating… Created") were mixed into a one-off test's output.
  MIRAI now passes `--progress quiet`.
- **The harness** couldn't remove the read-only trust root; it now opens it first.
- (Before the harness) **a smoke run** checked the frozen file by hand: `ports` were gone, the
  network was internal, the bind pointed at the copy, and `MODE` came from the trust env file.

## The sample app

**First, a throwaway clone under `~`.** The changes were committed in the clone, its `origin`
removed, and it ran with a temporary MIRAI home, so your repo and store were untouched. The
clone run found:
1. **`backend/.env.testing` wasn't in the copy.** That's by design: every `.env*` file is left
   out unless listed. The fix is sample-app config, `[sandbox] readable_env =
   ["backend/.env.testing"]`. It's the committed dummy file the app's entrypoint needs when
   `APP_ENV=testing`.
2. **The browser test couldn't stay logged in.** `.env.testing` had `SESSION_DRIVER=array`; it's
   now `file`. PHPUnit still forces `array` through `phpunit.xml`.
3. **Three MIRAI fixes:**
   - **`/host_mnt`:** Docker Desktop reported a bind's host path with that prefix (the VM's
     view), so the after-start check refused a correct mount. It now maps the prefix back;
   - **start-up failures:** a service that doesn't start now shows its exited containers' last
     log lines (redacted);
   - **output:** terminal colour codes are stripped.

You reviewed the sample-app diff, committed it and pushed it (`4fd3e11 MIRAI test config (unit
14c)`).

**Then the real runs** in `~/Projects/mirai-sample-app`, with `node
~/Projects/mirai/bin/mirai.js test <name>` (MIRAI's work tree; the app's pinned framework copy
is still 13c's):

| Command | Exit | Result |
|---|---|---|
| `mirai test unit` | 1 | **fail, as it should:** 13 passed, 1 failed, `Tests\Feature\KnownFailureSeedTest`, the seeded known failure from unit 02 (34 s) |
| `mirai test frontend` | 0 | pass, 6 of 6 (53 s). The seeded flaky test (`Math.random() < 0.5`) passed this time; it failed in the clone run |
| `mirai test lint` | 0 | pass, `eslint .` (47 s) |
| `mirai test e2e` | 0 | pass: Playwright logged in, added a task and completed it, against the app on the internal network (54 s) |

On the clone, `unit` with `--path tests/Unit` passed (3 tests), so `php artisan test -- <path>`
works.

**Afterwards:**
- every run copied the same tree (229 files, tree `861561503394`), from base `4fd3e11e075d`;
- no container, network or volume of any run was left;
- your daytime stack's volumes and network (`mirai-sample_*`) were untouched;
- `git status` in the sample app was empty;
- MIRAI's Docker folder `~/Library/Application Support/mirai/docker/config/` holds only
  `config.json` (`cliPluginsExtraDirs`).

**Cleaned up:** the clone and all probe folders under `~`.

## After the review

Both reviewers found the same High: a chain of links that stays inside on paper led out of the
copy. The Tech Lead reproduced it on the copy (an outside file read, and a file written outside
it). The fixes and their checks are in `review.md` and the spec's "Changes after testing and
review".

**Before choosing the fix, three new probes**, canaries only, under `~` (the Desktop
client, `nginx:1.27-alpine`):

| Form of the bind source | Result |
|---|---|
| a relative link to a folder, or a path through one, or a relative link to a file | refused by Docker Desktop: it tries to create a folder there ("file exists"); the container doesn't start |
| an absolute link, or a path through one | **followed:** the container read the canary folder outside the project |
| `docker inspect` | shows the unresolved path (the link's own path), so it can't see where a link led |

**The new probe scenarios** (`test-run-probes.js`, now 22):
- **c21-nested-swap:** `app` mounts `./` read-write. At start it replaces `sub/` with an absolute
  link to a canary folder outside the project. `web` mounts `./sub` and starts after `app` is
  healthy.
  - With MIRAI's separate copy, `web` read `inside-copy`, and the result names the separate
    copy (`web: sub`).
  - **The control**, with the separate copy switched off for one run (and restored), was a FAIL:
    `web` read `mirai-canary-14c-0f3e9a-outside`. So the attack is real on Docker Desktop.
- **c22-no-host:** a canary server on the Mac's `127.0.0.1`. A test fetching it through
  `host.docker.internal` and `gateway.docker.internal` got nothing, and the server logged 0
  requests.

**The final runs:**
- **The 22 probe scenarios:** all pass. Every run had its own project; the outside folder was
  unchanged; the host server got 0 hits; nothing was left.
- **`npm test`:** 256 / 256.
  - **14c T1** gained cases for: a parent folder that is a link, chains, `..` anywhere in a
    target, a hard link to `.env`, and kept env files coming from the base commit, not the work
    tree.
  - **14c T14** is new: nested mounts, link and `..` checks on mount sources, explicit keys, the
    env-fault outcome with its stored result, the output caps, one run at a time, the sweep of
    a crashed run's projects, and a symlinked compose file on main.

**The sample app again,** on the fixed code (`node ~/Projects/mirai/bin/mirai.js test <name>`):

| Command | Exit | Result |
|---|---|---|
| `unit` | 1 | fail: the seeded known failure (13 passed, 1 failed) |
| `frontend` | 1 | fail: the seeded flaky test (5 passed, 1 failed). It passed in the run before the fixes; it's random |
| `lint` | 0 | pass |
| `e2e` | 0 | pass. nginx's `backend/public` got its own copy (`isolated_binds: ["nginx: backend/public"]`); the one-off Playwright run used the new start, check, wait and logs path |

Nothing of any run was left in Docker, and the sample app's `git status` was empty. All probe
folders are removed.
