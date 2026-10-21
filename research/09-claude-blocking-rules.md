---
status: draft
version: 1
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

1. **Agent-written code never runs on the host.** Every test runs inside the project's own Docker
   containers. The agent calls one fixed wrapper (`mirai exec test <suite>`). That wrapper is the
   only `excludedCommands` entry, and it takes no free-form arguments. The project container is
   the boundary for test code, which matches "projects work on containers". `doctor` checks that
   the compose file mounts neither your home folder nor the docker socket.
2. **The sandbox is on, with no escape.** `allowUnsandboxedCommands: false`, `denyRead` on your
   home folder except the project and the toolchain caches, and a strict network allowlist
   (package registries and the model API).
3. **Deny rules.** `Read` and `Edit` outside the project are denied. So are agent `git push`,
   `gh`, `docker`, and `printenv`/`env`. Headless runs use `dontAsk`. Interactive sessions use
   `ask` for anything outside the project ("not without my approval").
4. **Hooks** (from the trust root, through `--settings`) block:
   - secret patterns in Write/Edit content;
   - Glob/Grep paths outside the project, which permission rules can't cover.
5. **A branch can't change the rules.** `--setting-sources user --settings <trust-root>/strict.json
   --strict-mcp-config`. Optionally, setup offers to install `managed-settings.json` with the
   managed-only locks. This needs admin rights and your approval.
6. **Credentials.** Agents never get push credentials or the `gh` token. The orchestrator pushes
   and opens MRs outside the agent. The environment is scrubbed except `CLAUDE_CODE_OAUTH_TOKEN`.
   That token stays readable by the agent; the network allowlist limits where it could be sent.
7. **Secrets in commits.** `pre-push` runs a secret scan that blocks, and CI runs it again.

**Honest residual risk:** this is weaker than a container per agent. The file tools and hooks run
outside the sandbox and rely on the deny rules being right. A bug in Claude Code's rule matching
is a single point of failure for reads. The unit that builds this layer must include a red-team
test: seeded attempts to read `~/.ssh`, run `curl` to an unlisted host, `sh -c` around a denied
command, and `grep -r` from `/`. Each one must be blocked.
