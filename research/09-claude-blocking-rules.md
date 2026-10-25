---
status: draft
version: 4
---

# 09 — What Claude Code can enforce (for decision D7)

**Question:** with no container and a subscription login only, which Claude Code features can
*block* (not just advise) an unattended `claude -p` run on macOS?

**Source:** the Claude Code docs at code.claude.com, read on 2026-10-21 by a research subagent.
The local build was `claude --version` = 2.1.303. Each claim names its page. Anything marked
**UNVERIFIED** must be tested in the unit that relies on it.

## 1. The Bash sandbox: the only layer that covers code the agent writes

Source: `docs/en/sandboxing.md`.

- **It is OS level.** macOS uses Seatbelt. Its limits apply to shell commands "and the processes
  they start", so agent-written test code run through `npm test` is covered.
- **It is off by default.** Turn it on with `sandbox.enabled: true`.
- **Its scope is Bash, PowerShell and Monitor only.** "File tools, MCP servers, and hooks run
  outside it." So the Read, Edit and Write tools need permission rules too (§2).
- **Reads:** `sandbox.filesystem.denyRead` and `allowRead` (the narrower path wins).
- **Writes:** the defaults are the cwd, a per-user temp dir and the `--add-dir` dirs. Tune them
  with `allowWrite` and `denyWrite`.
- **Network:** traffic goes through a local proxy, and `allowedDomains` starts empty.
  `network.strictAllowlist: true` denies instead of prompting.
- **The escape hatch:** the model can pass `dangerouslyDisableSandbox` on a Bash call.
  `allowUnsandboxedCommands: false` makes Claude ignore it. If that comes from managed settings or
  `--settings`, repository files can't loosen it.
- **`excludedCommands` run with full access.** Every subcommand in a compound command must match.
  A script or make target that calls the tool internally doesn't match.
- **Docker is incompatible with the sandbox.** The documented workaround is
  `excludedCommands: ["docker compose *"]`, which runs docker unsandboxed.

## 2. Permission rules

Source: `docs/en/permissions.md`.

- **Syntax:**
  - `Read(~/.ssh/**)` is relative to your home folder.
  - `Read(//abs/**)` is an absolute path.
  - `Read(.env)` matches at any depth.
- **Only `Read` and `Edit` path rules count.** `Write`, `Glob` and `Grep` path rules are ignored,
  with a warning at startup.
- **What they cover:** Read and Edit denies cover the file tools, Bash file commands (`cat`, `sed`,
  `tee`…) and redirects.
- **What they don't cover:** `grep -r pattern .`. `Bash(curl *)` doesn't catch `sh -c` or a
  path-qualified binary. The sandbox has to close both gaps.
- **Order:** deny, then ask, then allow. A hook's "allow" never overrides a deny.
- **Lists merge across scopes.** A project can add denies but can't remove managed ones.
- **Managed settings file:** `/Library/Application Support/ClaudeCode/managed-settings.json`
  (`docs/en/managed-settings.md`).
  - Managed-only locks: `allowManagedPermissionRulesOnly`, `allowManagedHooksOnly`,
    `permissions.disableBypassPermissionsMode`, `sandbox.network.allowManagedDomainsOnly`,
    `sandbox.filesystem.allowManagedReadPathsOnly`.
- **Headless flags** (`docs/en/headless.md`):
  - `--permission-mode dontAsk` denies anything that would prompt;
  - `--permission-prompts none`.
- **`--restricted`** (v2.1.248 and later): loads only managed settings and `--settings`, confines
  file tools to the working dirs, and removes command tools unless they're named in `--tools`.
- **UNVERIFIED:** that deny rules behave the same in `-p`. Nothing in the docs says otherwise. Test
  it.

## 3. Hooks

Source: `docs/en/hooks.md`.

- **How a hook blocks:** a PreToolUse hook blocks with exit code 2 (stderr becomes the reason), or
  with exit 0 and `permissionDecision: "deny"`. Other exit codes do not block.
- **What it sees:** the full `tool_input` (for Bash: `command`, `description`, `timeout`…) plus
  `cwd` and `permission_mode`.
- **Hooks run outside the sandbox.**
- **Project hooks run in `-p`.** Without `--bare`, a `-p` run executes the project's
  `.claude/settings.json` hooks and its `.mcp.json` servers, even in an untrusted folder. So a
  branch can bring its own hooks unless sources are restricted (§4).

## 4. Flags that keep a branch from loosening the rules

Source: `docs/en/cli-reference.md`.

- **`--setting-sources user`:** drops the project and local settings (their hooks and rules).
  Managed settings still apply.
  - **Caveat:** this also drops the project's own deny rules, so MIRAI's denies must come through
    `--settings` or managed settings.
- **`--settings <file>`:** ranks above user, project and local settings, and below managed.
- **`--strict-mcp-config`** with `--mcp-config <file>`: only the listed MCP servers load.
- **`--bare` is out.** It skips the OAuth token, so it can't use a subscription.

## 5. Subscription login

Sources: `docs/en/authentication.md`, `docs/en/errors.md`.

- **The token:** `claude setup-token` prints a one-year OAuth token (Pro, Max, Team or
  Enterprise). Use it through `CLAUDE_CODE_OAUTH_TOKEN`.
- **The precedence trap:** `ANTHROPIC_API_KEY` beats the OAuth token in `-p`. The runner must unset
  `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`.
- **Checking the login:** `claude auth status` prints JSON (`authMethod: oauth_token`) and exits 0
  when logged in.
- **Usage limits:** the messages are "You've hit your session limit" and "…weekly limit". A 429 is
  retried up to 10 times. The exit code in `-p` is **UNVERIFIED**.

## 6. Turns and cost

Sources: `docs/en/cli-reference.md`, `docs/en/headless.md`.

- **Turn and budget caps:** `--max-turns N` and `--max-budget-usd X` work in print mode only.
  The budget is a client-side estimate and can overshoot. The exit codes are **UNVERIFIED**.
- **Cost reporting:** `--output-format json` includes `total_cost_usd`, an estimate. No
  subscription exception was found. Confirm it with a real run.
- **Audit trail:** `stream-json` emits `permission_denied` events and lists `permission_denials`.
  This is useful for the run log.

## 7. What this means for MIRAI (input to `04` D-30)

Version 4 of this section applies review round 3 (`design/06-review-round-3.md`, section B, with
your decisions in its section D). Round 2 had fixed the placement of the layers. Round 3 found
**side doors**: host-side code (git, the gate, docker, the file tools) acting on files an agent or
a test container can write. **Your decision V1: keep D7 as is** (agents run as your user, no
separate user, no container) and close the side doors. **Condition:** if the red-team suite shows
the docker socket, ssh-agent, the keychain or the real `.env` reachable and configuration can't
close it (G18, G25 in §8), no headless run starts and V1 comes back to you.

**One rule over everything:** MIRAI host-side code never executes project code, and never trusts
a file an agent or a test container could have written without checking it first.

1. **MIRAI's control files are outside the project, split by trust** (`04` D-47). In
   `~/Library/Application Support/mirai/<repo-id>/`:
   - `store/` (state, status, counters, verdicts, work files) is denied to agents, read and write;
   - `trust/<sha>/` (the trust root: skills, prompts, `strict.json` per role, `mcp.json`, hooks;
     named `trust/` and without an immutable flag since unit 12) is readable but write-denied
     (sandbox `denyWrite`, `Edit` deny), with read-only modes and a re-hash before every launch;
   - `input/<launch>/` is a read-only folder for one launch; `scratch/<run>/` is agent-writable and
     never trusted.

   The private signing key is in `~/.config/mirai/`, denied like the store.
2. **Agents reach MIRAI only through two MCP servers from the trust root**, both outside the
   sandbox, with structured arguments and no shell:
   - **`run_tests(level, path?, script?)`** (`04` D-48) for tests **and named checks** (`lint`,
     `types`, `build`, `gate`). It resolves the compose config once, validates it with an
     allowlist, freezes it, and runs the frozen file with `--no-build --pull never` and a unique
     project name. `.git` and every real `.env*` are masked in the mounts. Results come back inline.
     Agents never run `docker`, never install dependencies, never run generators;
   - **the MIRAI MCP broker** (`04` D-53): `log_event`, `start_agent`/`agent_status` (your
     interactive session only), `session_start`/`session_end`, `lint`, `trace`. The headless
     `mcp.json` holds only `run_tests` and `log_event`.

   **No sandboxed process calls `mirai`** (`Bash(mirai *)` and `Bash(claude *)` are denied).
3. **Test containers have no route out** (`04` D-49): an internal network with no outside access
   or DNS, dummy secrets from `.env.test`, and `.git` and real `.env*` masked.
4. **The sandbox is on, with no escape.** `allowUnsandboxedCommands: false`, no
   `excludedCommands`, `allowUnixSockets` empty.
   - "Outside the project" is written with the sandbox: `denyRead` on your home folder, and
     `allowRead` only for the project, the toolchain caches, `trust/` and the launch's
     `input/`.
   - Explicit `denyRead`/`denyWrite` on `store/`, `~/.config/mirai` and every real `.env*`.
   - `denyWrite` on `.git/**`, `.mirai/keys/**` and `.mirai/records/**`, and on the whole project
     for read-only roles.
   - **The headless network allowlist is empty** if G16 holds, because Claude Code's own API
     traffic comes from the `claude` process, which isn't a sandboxed command (§1). That closes
     uploads through package registries.
5. **Deny rules** name the paths explicitly: `store/`, `~/.config/mirai`, `~/.ssh`, `~/.aws`,
   `~/.config/gh`, `~/.npmrc`, `~/.netrc`, `~/.docker`, `~/.kube`, `.env*` except `.env.test`, `Edit`
   of `trust/`, `.git/**`, `.mirai/keys/**`, `.mirai/records/**`.
   - Denied commands: `git push`, `git commit`, `git config`, `gh`, `docker`, `claude`, `mirai`,
     `env`, `printenv`.
   - Denied tools in headless runs: `WebFetch`, `WebSearch`, Task/Agent.
   - Interactive sessions use `ask` outside the project, but the key, the store, `.git` writes and
     the human-only `mirai` commands are hard denies there too.
6. **Hooks** (from the trust root, through a shim that checks its target's hash on every call):
   - **a path hook on `Read`/`Edit`/`Write`/`MultiEdit`/`NotebookEdit`** that resolves the target
     with `realpath` and denies anything outside the project or inside `.git/`, `.env*`,
     `.mirai/keys/` or `.mirai/records/`. It closes the symlink route whatever Claude Code's own
     matching does (G17);
   - secret patterns and the login token, plain and encoded, in Write/Edit content;
   - Glob/Grep paths outside the project.
7. **Neither a branch nor your user settings can change the rules.** The launcher passes
   `--settings <trust-root>/strict.json --strict-mcp-config` with `--restricted`. The fallback is
   `CLAUDE_CONFIG_DIR=<mirai-home>/claude-home` plus a source list without `user`, which also
   isolates user memory and user skills (G10). The environment is an allowlist, and auth is
   checked in every launch's init event. Reviewers read a clean export with the integration
   branch's instruction files. Optional managed settings add the managed-only locks.
8. **Git and auto-run config are integrity-checked** (`04` D-54).
   - `.git/config`, `.git/info/**`, the hooks listing and the refs are hashed before every git
     call and around every launch and `run_tests` call.
   - Host git runs with `GIT_CONFIG_NOSYSTEM=1`, a MIRAI-owned `GIT_CONFIG_GLOBAL`, `-c` pins and
     `--no-ext-diff --no-textconv`, and pushes to an explicit URL.
   - Auto-run config (`.vscode/`, `.envrc`, `.husky/`, `package.json` scripts, `.claude/`) parks
     in both presets.
   - Every run ends on the integration branch.
9. **Credentials.** Agents never get push credentials or the `gh` token. The orchestrator commits,
   pushes and opens MRs. The token's exposure depends on G9.
10. **Secrets in commits.** `pre-push` (which runs no project code) and CI's test job scan for
    patterns, the exact token and its encoded forms, and high-entropy new files. CI's
    `mirai-verify` recomputes the code hash from the PR head and checks Ed25519 signatures with
    the base commit's keys (`04` D-15, D-17).

**Honest residual risk** (`04` D-30, from the round-3 Tech Lead's draft, adapted to V1):
- This is weaker than a container or a separate user per agent.
- The agent runs as you, so every host-side component that touches agent-written files is part of
  the boundary: the unsandboxed file tools, hooks and MCP servers, the orchestrator's git commands,
  and the `run_tests` executor. Each one is hardened, but a bug in any of them crosses the
  boundary.
- The login token is readable by the agent unless G9 says otherwise. It has no *known* route out.
  Treat it as a one-year credential you can revoke quickly.
- Anything your user can reach that isn't listed is one wrong rule away. The red-team suite is how
  new gaps get found.
- Your merge remains the final gate.

**The red-team suite** is a single list, kept in `04` D-30. **No headless launch happens without a
green result** recorded for this machine's Claude Code version, `strict.json` hash and Docker
version. It covers rounds 1–3:
- reads outside the project, including through symlinks;
- writes to control files, `.git/config` and `.git/hooks`, from Bash and from a test container;
- gate and launch tricks (`mirai`/`claude` from Bash, fake verdicts, frozen-block edits,
  background processes);
- network and secret exfiltration (DNS, `npm publish`, encoded tokens);
- docker and test inputs;
- host credential sockets (G18, G25);
- instruction injection (nested `CLAUDE.md`, `@` imports, auto-run config, `.gitattributes`);
- CI tricks (same-named check, old proof on a changed head, stacked parent editing the workflow).

## 8. UNVERIFIED facts the design relies on (to test before the unit that needs them)

**Settled by unit 13a (2026-10-25, Claude Code 2.1.310):** G1, G5, G9, G10, G13, G16, G17, G18,
G20, G22, G24 and G25, in `research/10-claude-code-facts.md`. What changes §7:
- the login keychain is reachable from sandboxed Bash unless `~/Library/Keychains` is read-denied
  (G18);
- `Agent(mirai-*)` doesn't match (exact names only);
- `/private/tmp/claude-<uid>` (your interactive sessions' scratchpads) is writable unless
  write-denied;
- under a home deny, git needs a MIRAI-owned `GIT_CONFIG_GLOBAL`;
- command denies (§7.5) are speed bumps, since `sh -c` gets past them; the guards are the
  token's absence from Bash, the empty network and the file denies;
- the fallback launch form loads the work tree's instruction files, so MIRAI refuses to launch
  without `--restricted` (your decision, 2026-10-25);
- a sandboxed command starting an unsandboxed one is now a blocker like G18 (none found).

The rest of this list stays open for its unit; G19 (DNS) is unit 14's.

From round 1 (§2, §5, §6), still open:
- deny rules behave the same in `-p` as interactively;
- the exit code and JSON shape when a usage limit is hit in `-p`;
- the exit code and JSON subtype when `--max-turns` is reached;
- `total_cost_usd` appears on subscription auth.

New from review round 2 (several came from the reviewers' own knowledge, marked [own] in
`design/_review/round-2-techlead.md`):
- **Token in the Bash environment:** whether Claude Code passes `CLAUDE_CODE_OAUTH_TOKEN` into the
  environment of Bash commands, and whether it can be kept out.
- **`--restricted` fit:** whether `--restricted` plus `--settings` and `--tools` gives a working
  headless developer run (Bash, file tools, the `run_tests` MCP tool), and, if not, whether a
  `--setting-sources` list without `user` is accepted.
- **Compose override auto-loading:** whether `docker compose -f <file>` with explicit files still
  loads `compose.override.yml`, and how `COMPOSE_FILE`, `COMPOSE_PROJECT_NAME` and `.env`
  interpolation behave with `--project-directory` and `--env-file`.
- **`pull_request_target` behaviour:** that it runs the base branch's workflow file on a PR, which
  secrets it exposes, and that a data-only job (no PR code executed) is safe. Also whether
  required status checks work on a private repo on your GitHub plan.
- **Nested `CLAUDE.md` loading in `-p`:** whether a `CLAUDE.md` in a subfolder the agent reads is
  loaded into context in headless runs, which decides how strict the protected-path rule must be.
- **git hooks and fsmonitor:** that `-c core.hooksPath=…` and `-c core.fsmonitor=false` on every
  host git call override anything a work-tree config sets.

New from review round 3 (`design/_review/round-3-techlead.md` TL3-3 to TL3-23 and
`round-3-architect.md` AR3-2, several marked [own]). Each is tested before the first headless
launch that relies on it:
- **G16, empty headless allowlist:** whether a headless `claude -p` run works with an empty
  `sandbox.network.allowedDomains`, i.e. Claude Code's own API traffic doesn't go through the
  sandbox proxy. If it doesn't, the allowlist is the model API only, and the residual risk says so.
- **G17, symlinks and file-tool rules:** whether Claude Code's file tools and `--restricted`
  resolve symlinks before matching `Read`/`Edit` rules and the working-dir confinement. MIRAI's
  `realpath` path hook covers it either way; the test decides whether the hook is the only
  control.
- **G18, host sockets and keychain:** whether a sandboxed command can reach the Docker Desktop
  socket, the ssh-agent socket (`SSH_AUTH_SOCK`), `git credential fill` (keychain helper) or
  `security find-generic-password` / `find-internet-password`, and whether `allowUnixSockets: []`
  closes the sockets. **If any is reachable and can't be closed by configuration, the V1 condition
  triggers.**
- **G19, DNS from the sandbox and from internal compose networks:** listed in `design/05` §G.
- **G25, real `.env` reads:** whether exact-path sandbox `denyRead` entries for each real `.env*`
  block reads through Bash (`cat`, `python3 -c`, `cp`), and whether globs work there.
- **G26, immutable bundle:** closed with unit 12 (2026-10-24): no immutable flag, since its owner
  can clear it; the sandbox `denyWrite` and the re-hash before every launch are the guard.
- **G20, `allowWrite` inside `denyWrite`:** which wins when an allowed path sits inside a denied
  one (§1 states precedence only for reads).
- **G22, user memory and skills:** whether `--restricted`, a source list without `user`, or
  `CLAUDE_CONFIG_DIR` keeps `~/.claude/CLAUDE.md`, user skills and user agents out of a headless
  run.
- **G24, `claude` and `mirai` from Bash:** that `Bash(claude *)` and `Bash(mirai *)` denies plus
  the empty allowlist stop a nested headless run started from Bash outside the launcher, and that
  a nested `claude -p` started by an MCP server outside the sandbox gets its own fresh sandbox.
- **G21, background shells at exit:** what Claude Code does with background shells when a `-p`
  run exits, and whether killing the process group catches all of them.
- **G23, git pins:** that `GIT_CONFIG_NOSYSTEM=1`, a MIRAI `GIT_CONFIG_GLOBAL` and the `-c` pins
  (`core.sshCommand`, `credential.helper`, `core.pager`, `diff.external`, `protocol.ext.allow`)
  override a hostile `.git/config` for every host git command MIRAI runs. This extends the
  round-2 hooksPath and fsmonitor item.
- **G27, compose masks:** that an anonymous volume or tmpfs over `<mount>/.git` and each real
  `.env*` hides them from the container, and that `docker compose config --format json` gives a
  frozen file `up` accepts unchanged.
- **G28, GitHub required checks:** whether a required check can be pinned to the real
  `mirai-verify` job and not a same-named job a PR adds. This extends the round-2
  `pull_request_target` item.
- **G29, Playwright MCP origins:** whether Playwright MCP can be restricted to the app's
  localhost origins for interactive sessions.
