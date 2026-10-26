---
unit: "14a"
name: compose-git-facts
date: 2026-10-26
node: v22.23.2
docker: Docker Desktop 29.6.2 (engine and client), Compose 5.3.1
git: 2.39.5 (Apple Git-154)
claude_code: 2.1.310
macos: 26.7
result: 228 / 228 pass (earlier units' 223 + unit 14a's 5), after the review fixes; final runs on the reviewed code: 67 Docker probes (10 pass, 55 facts, **2 FAIL: masks over files leak through another case of the name**, which changes 14b), 38 git probes (18 pass, 20 facts), 8 sandboxed-DNS Haiku runs (all pass); nothing left behind
---

# Unit 14a — Test results

## `npm test`

New in `test/probes/harness.test.js` (the only test file under `test/probes/`, as T13b checks):

```
14a T1: the Docker harness: Desktop-style client, allowlisted env, named projects, labels, down -v around runs, canary = FAIL, reports, sweep, cleanup
14a T1b: compose files carry the probe label; the frozen-file and show checks read resolved JSON
14a T2: the git harness runs MIRAI's commands unpinned and pinned, and sees a key fire
14a T3: canaries only: Docker probes stay in the fixture, use local images, never the socket; git remotes are local
14a T4: the pin set holds the probed pins, and no value comes from the repo
# tests 228
# pass 228
# fail 0
```

## The probe runs

| Run | What | Result |
|---|---|---|
| g1 | all 31 git probes | `g23-credential` and `g23-askpass` FAIL, `g23-includeif` inert: **harness bugs**. The test server ran in the harness's own process, which a synchronous git call blocks (moved to a child process), and the `includeIf` pattern with a trailing `/` didn't match on git 2.39 (now `gitdir:**/repo/.git`) |
| g1b | the git probes again | the 14 expected pins hold; `http.proxy` fired pinned, so it was **added to the pin set** |
| g2 | `g23-http-proxy` after the pin | pass |
| d1 | all Docker probes | **Docker Desktop had quit** (its socket was gone) before the first container probe; the config probes ran. The one-letter volume quirk was found here, and the probe's volume renamed |
| n1 | 6 sandboxed-DNS Haiku runs (`claude-probes.js --bundle`) | 6 pass: no name resolved |
| d2 | all Docker probes, Docker restarted by you | `g19-internal` FAIL from a **harness bug**: an empty output section read the next section's marker. Fixed, and tested (14a T1b) |
| d3 | `g19-internal`, `g19-control` | pass / fact |
| d4, g3 | **the final runs** of every Docker and git probe, on the final code (tables below) | 0 FAIL. The two P5 probes left their projects' networks behind (the containers outlive the client: the fact they record) |
| d5 | `p5-kill-*` after the harness force-removes survivors and sweeps networks | no container, volume or network left |
| — | **the review** (Tech Lead, Architect; `review.md`) | pins added, 7 git and 1 Docker control probes added, the masks probed with other cases of the names, checks that passed on no output tightened |
| g4 | the 7 new git probes | the gpg-ssh, untracked-files and diff-shape pins hold; URL-scoped proxy, gitfile, commondir and nested repo are not pinnable. The nested repo first showed "inert" (a size change skips the filter; the probe now makes the file stat-dirty), then "not pinnable": `add -A` runs the nested filter even with `diff.ignoreSubmodules=all` |
| n2 | `g19-dns-dscacheutil-1`, `-2` again (the check now needs the run's end) | pass: both ran to the end with no answer; on the host, `dscacheutil` answers (control) |
| d6, g5 | **the final runs** on the reviewed code (tables below) | git: no FAIL. Docker: **`g27-mask-volume` and `g27-mask-tmpfs` FAIL**: `/w/.ENV`, `/w/.Env`, `/w/SUB/.env` and `/w/Sub/.GIT` read the real files past the masks, and a write to `/w/.ENV` changed the fixture's real `.env`. The `.git` folder masks held. No container, volume or network left |

Leftovers checked after d5: `docker ps -a --filter label=mirai.probe` is empty, and no `mirai-probe-*`
volume or network is left. The fixture folders under your home folder were removed, apart from their
`out/` reports.

### Sandboxed DNS (n1 and n2, the 13c bundle)

| Probe | Outcome | What was seen |
|---|---|---|
| g19-dns-nslookup-1, -2 | **pass** | `bind: Operation not permitted`: nslookup can't open its socket |
| g19-dns-dscacheutil-1, -2 | **pass** | no answer (rerun n2: both reached their end; the host answers) |
| g19-dns-python-1, -2 | **pass** | `socket.gaierror: [Errno 8] nodename nor servname provided, or not known` |

### Docker and Compose (d6)

| Probe | Fact | Outcome | What was seen |
|---|---|---|---|
| g12-override | G12 | **pass** | override loaded: no |
| g12-override-control | G12 | **fact** | exit 0; override loaded: no; the project .env's COMPOSE_FILE loaded evil.json: yes; app present: no; dbg/name: mirai-probe-23b54463-2  |
| g12-override-shown | G12 | **fact** | exit 0; override loaded: yes (expected yes: the g12-override pass can fail);  |
| g12-dotenv | G12 | **pass** | Y=from-trust-env; leaked from .env: nothing |
| g12-dotenv-control | G12 | **fact** | exit 0; Y=from-dotenv; canary inlined: yes; evil: no; dbg: yes; name: mirai-probe-23b54463-5 |
| g12-callerenv | G12 | **fact** | exit 0; evil (COMPOSE_FILE): no; dbg (COMPOSE_PROFILES): yes; name: mirai-probe-23b54463-6; canary (COMPOSE_ENV_FILES): no |
| g12-show-privileged | G12 | **fact** | app: privileged=true; top: none |
| g12-show-cap_add | G12 | **fact** | app: cap_add=["SYS_ADMIN"]; top: none |
| g12-show-devices | G12 | **fact** | app: devices=[{"source":"/dev/null","target":"/dev/probe","permissions":"rwm"}]; top: none |
| g12-show-network_mode-host | G12 | **fact** | app: network_mode="host"; top: none |
| g12-show-pid-host | G12 | **fact** | app: pid="host"; top: none |
| g12-show-ipc-host | G12 | **fact** | app: ipc="host"; top: none |
| g12-show-uts-host | G12 | **fact** | app: uts="host"; top: none |
| g12-show-cgroup-host | G12 | **fact** | app: cgroup="host"; top: none |
| g12-show-security_opt | G12 | **fact** | app: security_opt=["seccomp:unconfined"]; top: none |
| g12-show-userns_mode | G12 | **fact** | app: userns_mode="host"; top: none |
| g12-show-sysctls | G12 | **fact** | app: sysctls={"net.ipv4.ip_forward":"1"}; top: none |
| g12-show-extra_hosts | G12 | **fact** | app: extra_hosts=["probe=127.0.0.1"]; top: none |
| g12-show-dns | G12 | **fact** | app: dns=["1.1.1.1"]; top: none |
| g12-show-ports | G12 | **fact** | app: ports=[{"mode":"ingress","host_ip":"127.0.0.1","target":80,"published":"18999","protocol":"tcp"}]; top: none |
| g12-show-build | G12 | **fact** | app: build={"context":"~/.mirai-probes-14a-docker/project","dockerfile":"Dockerfile"}; top: none |
| g12-show-env_file | G12 | **fact** | app: environment={"APP_ENV":"testing","PROBE_VAR":"from-trust-env"}; top: none |
| g12-show-bind-outside | G12 | **fact** | app: volumes=[{"type":"bind","source":"~/.mirai-probes-14a-docker/outside","target":"/o","bind":{}}]; top: none |
| g12-show-develop | G12 | **fact** | app: develop={"watch":[{"path":"~/.mirai-probes-14a-docker/project/app","action":"sync","target":"/app","exec":{"command":null}}]}; top: none |
| g12-show-post_start | G12 | **fact** | app: post_start=[{"command":["echo","x"]}]; top: none |
| g12-show-runtime | G12 | **fact** | app: runtime="runc"; top: none |
| g12-show-gpus | G12 | **fact** | app: gpus=[{"count":-1}]; top: none |
| g12-show-cgroup_parent | G12 | **fact** | app: cgroup_parent="probe"; top: none |
| g12-show-logging | G12 | **fact** | app: logging={"driver":"syslog"}; top: none |
| g12-show-device_cgroup_rules | G12 | **fact** | app: device_cgroup_rules=["c 1:3 mr"]; top: none |
| g12-show-volumes_from | G12 | **fact** | app: depends_on={"other":{"condition":"service_started","required":true}} volumes_from=["other"]; top: none |
| g12-show-links | G12 | **fact** | app: depends_on={"other":{"condition":"service_started","restart":true,"required":true}} links=["other"]; top: none |
| g12-show-storage_opt | G12 | **fact** | app: storage_opt={"size":"1G"}; top: none |
| g12-show-user-root | G12 | **fact** | app: user="0:0"; top: none |
| g12-show-tmpfs | G12 | **fact** | app: tmpfs=["/scratch"]; top: none |
| g12-show-read_only | G12 | **fact** | app: read_only=true; top: none |
| g12-show-init | G12 | **fact** | app: init=true; top: none |
| g12-show-volume-one-letter | G12 | **fact** | app: volumes=[{"type":"volume","target":"v:/x","volume":{}}]; top: none |
| g12-show-configs-file | G12 | **fact** | app: configs=[{"source":"c1"}]; top: configs={"c1":{"name":"mirai-probe-23b54463-39_c1","file":"~/.mirai-probes-14a-docker/outside/secret.txt"}} |
| g12-show-secrets-file | G12 | **fact** | app: secrets=[{"source":"s1","target":"/run/secrets/s1"}]; top: secrets={"s1":{"name":"mirai-probe-23b54463-40_s1","file":"~/.mirai-probes-14a-docker/outside/secret.txt"}} |
| g12-show-volume-driver-bind | G12 | **fact** | app: volumes=[{"type":"volume","source":"vol","target":"/x","volume":{}}]; top: volumes={"vol":{"name":"mirai-probe-23b54463-41_vol","driver":"local","driver_opts":{"device":"~/.mirai-probes-14a-docker/outside","o":"bi |
| g12-show-volume-name | G12 | **fact** | app: volumes=[{"type":"volume","source":"vol","target":"/x","volume":{}}]; top: volumes={"vol":{"name":"mirai-probe-shared"}} |
| g12-show-volume-external | G12 | **fact** | app: volumes=[{"type":"volume","source":"vol","target":"/x","volume":{}}]; top: volumes={"vol":{"name":"vol","external":true}} |
| g12-show-network-external | G12 | **fact** | app: networks={"n":null}; top: networks={"n":{"name":"n","ipam":{},"external":true}} |
| g12-show-models | G12 | **fact** | app: models={"m":null}; top: none |
| g12-include-local | G12 | **fact** | exit 0; included service in the result: yes; include key kept: no |
| g12-extends-local | G12 | **fact** | exit 0; merged: yes; extends kept: no |
| g12-include-remote-oci | G12 | **pass** | exit 1; host programs run: none; failed to pull OCI resource "mirai-probe.invalid/x:1": failed to do request: Head "https://mirai-probe.invalid/v2/x/manifests/1": dialing mirai-probe.invalid:443 host via direct connection because Docker Desktop has no HTTPS proxy: connecting to mirai-probe.invalid:443: dial tcp: lookup mirai-probe. |
| g12-include-remote-git-ssh | G12 | **pass** | exit 1; host programs run: none; failed to access repository at git@mirai-probe.invalid:x/y.git: |
| g12-include-remote-git-https | G12 | **pass** | exit 1; host programs run: none; failed to access repository at https://mirai-probe.invalid/x/y.git: |
| g12-provider-config | G12 | **pass** | exit 0; plugin ran on the host: no;  |
| g12-provider-up | G12 | **fact** | exit 1; plugin ran on the host: yes (plugin); failed to create service provider: exit status 1 |
| g27-frozen | G27 | **pass** | started: yes; env Y/Z: Z=a$b Y=from-trust-env; mounts: bind:~/.mirai-probes-14a-docker/project/app->/w/app; networks: mirai-probe-23b54463-53_inner; relative path in frozen: no; containers: mirai-probe-23b54463-53-app-1 |
| g27-mask-volume | G27 | **FAIL** | started: yes; ran to the end: yes; canaries seen: 3; case variants: CANARY_SECRET=CANARY-env-… \| COMPOSE_FILE=evil.json \| COMPOSE_PROFILES=dbg \| COMPOSE_PROJECT_NAME=mirai-probe-from-dotenv \| PROBE_VAR=from-dotenv \| CANARY_SECRET=CANARY-env-… \| C; host files changed: .env; mounts: /w fakeowner rw,nosuid,nodev,relatime,fakeowner \| /w/.env fakeowner ro,nosuid,nodev,relatime,fakeowner \| /w/.git ext4 rw,relatime,discard \| /w/sub/.env devtmpfs ro,nosuid,noexec,relatime,size=6119580k,nr_inodes=1529895,mode=755 \ |
| g27-mask-tmpfs | G27 | **FAIL** | started: yes; ran to the end: yes; canaries seen: 3; case variants: CANARY_SECRET=CANARY-env-… \| COMPOSE_FILE=evil.json \| COMPOSE_PROFILES=dbg \| COMPOSE_PROJECT_NAME=mirai-probe-from-dotenv \| PROBE_VAR=from-dotenv \| z \| CANARY_SECRET=CANARY-env-…; host files changed: .env; mounts: /w fakeowner rw,nosuid,nodev,relatime,fakeowner \| /w/.git tmpfs rw,nosuid,nodev,noexec,relatime,mode=755 \| /w/.env fakeowner ro,nosuid,nodev,relatime,fakeowner \| /w/sub/.env devtmpfs ro,nosuid,noexec,relatime,size=6119580k,nr_ino |
| g27-mask-file-volume | G27 | **fact** | started: no; canary seen: no; Error response from daemon: failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: error mounting "/var/lib/docker/volumes/3dd047ffc2c816daf4b3cd46728dab9f43071c0cdaf0746db118d12c |
| g27-mask-file-tmpfs | G27 | **fact** | started: no; canary seen: no; Error response from daemon: failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: error mounting "tmpfs" to rootfs at "/w/.env": mount src=tmpfs, dst=/w/.env, dstFd=/proc/thread- |
| g27-unmasked-nested | G27 | **fact** | sub/.env seen: yes; sub/.git seen: yes (expected yes: every nested one needs its mask) |
| g19-internal | G19 | **pass** | outside DNS: no; outside IP: no; host reached: no; peer: yes; proxy vars: none; gw: gw= |
| g19-control | G19 | **fact** | outside DNS: yes; outside IP: yes; host reached: yes; peer: yes; proxy vars: none |
| g19-ports-internal | G19 | **fact** | host port: 0; reachable from the host: no |
| docker-own-config | docker | **pass** | exit 0; Docker Compose version v5.3.1  |
| docker-no-host | docker | **fact** | exit 1; failed to connect to the docker API at unix:///var/run/docker.sock; check if the path is correct and if the daemon is running: dial unix /var/run/docker.sock: connect: no such file or directory |
| docker-proxy-own | docker | **pass** | proxy variables: none |
| docker-proxy-yours | docker | **fact** | proxy variables: none |
| p5-kill-sigterm | P5 | **fact** | containers still running after SIGTERM: 1 |
| p5-kill-sigkill | P5 | **fact** | containers still running after SIGKILL: 1 |

### git (g5)

Unpinned = repo config only (no system or global file); pinned = `src/store/git-pins.js`. `pass` = an expected pin held; `fact` = recorded for 14b.

| Probe | Fact | Outcome | Kind | Fired unpinned | Fired pinned |
|---|---|---|---|---|---|
| g15-hookspath | G15 | **pass** | neutralised | yes | no |
| g15-hooks | G15 | **pass** | neutralised | yes | no |
| g15-fsmonitor | G15 | **pass** | neutralised | yes | no |
| g15-fsmonitor-worktree | G15 | **pass** | neutralised | yes | no |
| g23-filter | G23 | **fact** | not pinnable | yes | yes |
| g23-filter-process | G23 | **fact** | not pinnable | yes | yes |
| g23-filter-info | G23 | **fact** | not pinnable | yes | yes |
| g23-diff-external | G23 | **pass** | neutralised | yes | no |
| g23-textconv | G23 | **fact** | neutralised | yes | no |
| g23-diff-command | G23 | **fact** | neutralised | yes | no |
| g23-merge-driver | G23 | **fact** | not pinnable | yes | yes |
| g23-pager | G23 | **fact** | inert | no | no |
| g23-editor | G23 | **fact** | inert | no | no |
| g23-sshcommand | G23 | **pass** | neutralised | yes | no |
| g23-credential | G23 | **pass** | neutralised | yes | no |
| g23-credential-url | G23 | **fact** | neutralised | yes | no |
| g23-askpass | G23 | **pass** | neutralised | yes | no |
| g23-gpg | G23 | **pass** | neutralised | yes | no |
| g23-include | G23 | **fact** | not pinnable | yes | yes |
| g23-includeif | G23 | **fact** | not pinnable | yes | yes |
| g23-ext | G23 | **pass** | neutralised | yes | no |
| g23-receivepack | G23 | **fact** | neutralised | yes | no |
| g23-receivepack-origin | G23 | **fact** | not pinnable | yes | yes |
| g23-insteadof | G23 | **fact** | not pinnable | yes | yes |
| g23-http-proxy | G23 | **pass** | neutralised | yes | no |
| g23-gpg-ssh-verify | G23 | **pass** | neutralised | yes | no |
| g23-http-proxy-url | G23 | **fact** | not pinnable | yes | yes |
| g23-gitfile | G23 | **fact** | not pinnable | yes | yes |
| g23-commondir | G23 | **fact** | not pinnable | yes | yes |
| g23-nested-repo | G23 | **fact** | not pinnable | yes | yes |
| g23-hide-untracked | G23 | **pass** | neutralised | yes | no |
| g23-diff-shape | G23 | **pass** | neutralised | yes | no |
| g23-worktree | G23 | **pass** | neutralised | yes | no |
| g23-alternates | G23 | **fact** | not pinnable | yes | yes |
| g23-info-exclude | G23 | **fact** | not pinnable | yes | yes |
| g23-excludesfile | G23 | **pass** | neutralised | yes | no |
| g23-nosystem | G23 | **pass** | neutralised | yes | no |
| g23-global | G23 | **pass** | neutralised | yes | no |
