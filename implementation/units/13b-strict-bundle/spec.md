---
unit: "13b"
name: strict-bundle
status: approved (2026-10-25)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 13 (13b; "From 13a" in row 13); D7, D-30, D-47; research/09 §7; research/10
depends_on: ["12", "12b", "13a"]
---

# Unit 13b: The strict settings bundle

## Why

From unit 19 on, agents run unattended on your Mac, as you. 13a established which Claude Code
controls actually hold on 2.1.310 / macOS 26.7 (`research/10`). This unit turns those facts
into what every agent run gets:
- one settings file;
- one set of launch flags;
- one environment.

They're built from the trust root, so neither a branch nor your own user settings can loosen
them.

Each rule in it is one 13a showed works. Nothing rests on a rule 13a found weak:
- not a wildcard `Agent(mirai-*)`;
- not command denies alone;
- not the fallback launch form.

**Roadmap "done when"** (row 13, as 13a rewrote it): **the rendered bundle passes 13a's probes
pointed at it.** The guard probes (G1, G9, G16, G17, G18, the escapes, G24, G25, G13/G22, temp
folders, the home deny) run with the bundle's own settings, flags and environment instead of
each probe's hand-written settings, and every one passes.

## What an agent run gets

**The launch** (`--restricted` only; MIRAI refuses to launch without it, your decision in 13a):
```
claude -p <prompt from unit 19>
  --restricted --tools <the agent's tools, as an explicit list>
  --settings <launch>/input/settings.json
  --strict-mcp-config            (the MCP config comes with units 14/15)
  --agents <the agent, from the trust root> --agent <name>
  --permission-mode dontAsk --output-format stream-json --verbose
```

**The environment**, an allowlist with nothing inherited beyond it:
- `PATH`, `LANG`, `TERM`, `USER`;
- `HOME`;
- `TMPDIR` and `CLAUDE_CODE_TMPDIR` set to `<launch>/scratch/tmp`;
- `CLAUDE_CONFIG_DIR` set to an empty, per-launch folder, so nothing carries over between runs;
- `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL=<launch>/input/gitconfig`;
- `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3`: the token goes on file descriptor 3, read from
  `mirai token`, never into the environment or a file.

**The settings** (`<launch>/input/settings.json`, read-only, its hash in the run log):

| Part | Value | 13a fact |
|---|---|---|
| Sandbox | on, `failIfUnavailable`, `allowUnsandboxedCommands: false`, no `excludedCommands`; every weakening key (`allowAppleEvents`, `allowAllUnixSockets`, `allowLocalBinding`, `allowMachLookup`, `enableWeaker*`, `allowNestedUserNamespaces`, `filesystem.disabled`, `ignoreViolations`) written at its safe value | escapes, research/10 keys |
| Network | `allowedDomains: []`, `strictAllowlist: true`, `allowUnixSockets: []` | G16, G18 |
| Reads | `denyRead` on your home folder; `allowRead` on the checkout, `<launch>/input`, the run's trust root `trust/<sha>`, and the project's opted-in toolchain paths (open point 3); `denyRead` again on `~/Library/Keychains`, the MIRAI home's `store/`, `~/.config/mirai` and each real `.env*` file by exact path | home-deny, G18, G20, G25 |
| Writes | the checkout (for agents that write; read-only agents get the checkout write-denied too), `<launch>/scratch`; `denyWrite` on `.git/**`, `.mirai/**` (MIRAI's own files, keys, records), every `auto-run` path from the protected-path rules (the core rules and the project's packs), `trust/`, and `/private/tmp/claude-<uid>` | tmp-denied, G20 |
| Credentials | `credentials.envVars` deny on `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` | G9 |
| Permissions | `allow` the agent's tools; `deny` `Read`/`Edit` on the same secret paths as the sandbox (the file tools aren't sandboxed), `Edit` on `.git/**`, `.mirai/**` and auto-run paths; `Bash` denies for `git push/commit/config`, `gh`, `docker`, `claude`, `mirai`, `env`, `printenv` (speed bumps, 13a: `sh -c` gets past them; the guards are the token's absence, the empty network and the file denies); `WebFetch`, `WebSearch` and the Task/Agent tool denied | G1, G24 |
| Absolute paths only | every path is resolved for this launch (13a: relative paths don't resolve against the project) | g25-relative |

**After launch, before the agent works:** `checkInit` compares the run's init event with what
the launch asked for:
- the tools, exactly;
- `apiKeySource: none` and `memory_paths: null`;
- the permission mode;
- no MCP servers or plugins MIRAI didn't pass;
- the agent;
- the Claude Code version.

Any difference means unit 19 stops the run. This unit provides the check and its tests.

## Scope

**In:**
- **Role templates in the trust root** (`SNAPSHOT_FORMAT` 2): `strict/<agent>.json` for each
  agent in the registry, plus `strict/read-write.json` and `strict/read-only.json` for the two
  access modes.
  - They hold everything that isn't a fact about this machine or launch: the tool list, the
    deny and allow rules, and the sandbox flags.
  - The manifest hashes them. Their hash is the "`strict.json` hash" the red-team result is
    keyed by (research/09 §7).
- **The per-launch render** (`src/launch/strict.js`, a pure function): template + checkout +
  MIRAI home + launch folder + your home folder + the real `.env*` files + the toolchain paths →
  the final settings file. It writes the git config next to it.
- **The launch plan** (`prepareLaunch`): it creates `<repo-home>/launches/<id>/{input,scratch}`,
  with private modes and `input/` read-only once written. It returns the command line,
  environment and file descriptors that unit 19 uses to start `claude`. It never starts
  `claude` itself.
- **`checkInit`:** the init-event check above.
- **`mirai sandbox show [<agent> | --mode read-write|read-only]`:** prints the settings an agent
  would run under in this checkout, with paths resolved, and the launch flags. It writes nothing
  and starts nothing. It's for you, and for dogfooding.
- **Probes against the bundle:** the 13a harness gets a `--bundle` mode. The guard probes run
  with `renderStrict`'s output for the fixture instead of their own settings. Run by hand, with
  your OK, like 13a.
- **The agent-safety docs page,** `docs/agent-safety.md` (your request in 13a). It covers:
  - why agents need limits;
  - how the limits were tested;
  - the token, exactly: what it is, what it's for, where it lives, the `mirai token` commands,
    what agents can and can't see of it, renewal, revocation (checked first), and not syncing
    `~/.config`;
  - the honest residual risks;
  - what you do by hand.

**Out:**
- **13c (open point 1):**
  - the hooks: the `realpath` path hook, secret patterns and the token in Write/Edit content,
    Glob/Grep outside the project;
  - the interactive `.claude/settings.json`, with exact `Agent(mirai-<name>)` denies and the
    hard denies on the key, the token, the store and `.git`.
- **Starting agents,** killing their process group, and the version gate: unit 19.
- **The MCP config:** units 14/15.
- **The red-team suite proper:** unit 18 (N≥3 runs, the adversarial mode, the static profile
  diff, moving the harness into `src/`).
- **Managed settings:** documented only, never installed (unit 39's checklist keeps them off).

## Files

```
src/launch/strict.js              # renderStrict (template + launch facts -> settings), the
                                  # env allowlist, prepareLaunch, checkInit
src/trust/snapshot.js             # format 2: strict/<agent>.json and the two mode templates
src/adapters/claude-code.js       # the Claude tool names for an agent's tools
registry/adapters/claude-code.toml  # [strict]: the deny lists and safe values, as data
src/cli/commands/sandbox.js       # mirai sandbox show
test/probes/claude-probes.js      # --bundle
test/launch/strict.test.js
docs/agent-safety.md
```

## Tests

| # | Test |
|---|---|
| T1 | **The templates:** a snapshot holds `strict/<agent>.json` and the two mode templates; the manifest covers them; a format-1 snapshot is rebuilt; no template holds a machine path |
| T2 | **The render:** home denied; the checkout, input, trust root and listed toolchain paths readable; the keychain, store, `~/.config/mirai` and each real `.env*` denied again; `.env.test`-style dummy files stay readable; all paths absolute |
| T3 | **Writes:** a read-only agent can't write the checkout; a writing agent can't write `.git`, `.mirai`, auto-run paths (including a project pack's), `trust/` or `/private/tmp/claude-<uid>` |
| T4 | **No weakening key** is ever loose, and `allowUnsandboxedCommands` is false; a template edited to loosen one is refused at render |
| T5 | **The environment** is exactly the allowlist; no `CLAUDE_CODE_OAUTH_TOKEN` in it; the token is only on fd 3; a user-settings or parent `ANTHROPIC_API_KEY` never reaches it |
| T6 | **The launch folder:** private, `input/` read-only after the render, a fresh empty config folder per launch, nothing in a temp folder |
| T7 | **`checkInit`:** passes the expected event; fails on an extra tool, an API key source, a memory path, another permission mode, an unexpected MCP server or plugin, another agent |
| T8 | **`mirai sandbox show`** prints resolved settings and flags, writes nothing, and shows no token |
| P | **The bundle probes** (recorded in `test-results.md`): every 13a guard probe passes with the rendered bundle |
| S | **On the sample app:** `mirai init --refresh`, a format-2 snapshot, `mirai sandbox show --mode read-write`, committed and pushed on its `main` |

## Open points for you

1. **Split the rest of unit 13 into 13b (this: the headless bundle) and 13c (the hooks and the
   interactive settings).** The hooks are a second layer: `--restricted`, the sandbox and the
   deny rules already block every route 13a probed. They bring their own work: a hash check on
   every call, failing closed, and the speed of a hook that runs on every tool call. The
   interactive settings belong with them, because the agent-start block may need a hook.
   **I recommend the split.**
2. **Templates in the trust root, resolved per launch.** The roadmap says "`strict.json` in the
   trust root", but exact `.env` paths and the checkout path differ per launch and per machine.
   - **What I propose:** the trust root holds the machine-free part; trust-root code resolves
     it into `<launch>/input/settings.json`; both hashes go in the run log.
   - **Why not one file in the trust root:** its manifest would change per checkout.

   **I recommend this.**
3. **What's readable under the home deny.** 13a's shape probe re-allowed all of `~/Library`,
   which also holds your browser profiles and cookies, Mail and Messages. 13b allows only:
   - the checkout, the launch's input folder and the run's trust root;
   - the toolchain paths a project opts into, as pack data (for example a `node` pack adds
     `~/.nvm` and `~/.npm`; stack-neutral, nothing by default).

   **13b's first step is a probe:** do `git`, `node`, `python3` and `php` from system locations
   work with nothing under `~/Library` re-allowed? If one needs a specific `~/Library` subfolder,
   only that subfolder is added, and you see it in the spec's changes. **I recommend this.**
4. **`mirai sandbox show`.** It lets you read exactly what agents run under, and it's how the
   sample-app smoke test checks the bundle before unit 19 exists. **I recommend it.**
5. **The docs page goes into this unit,** as you asked in 13a, since the bundle it describes
   exists here. 13c adds the hooks section.

## Changes after testing and review

Listed for your check before "UNIT APPROVED".

**Settled during testing:**
1. **Open point 3: nothing in `~/Library` is re-allowed.** `git`, `node`, `npm` and `python3`
   work with your whole home folder denied (they live in `/usr/bin` and Homebrew's `/usr/local`).
   `php` is broken on your Mac outside the sandbox too (Homebrew's `icu4c` moved).
2. **The launch's scratch folder is readable as well as writable.** Without it, `cat` and
   `node` failed under the home deny: Claude Code keeps command output there, and node reads its
   temp folder at start.
3. **MIRAI's git config** also points `core.excludesFile` and `core.attributesFile` at
   `/dev/null`, since git can't read `~/.config/git/*` under the home deny.
4. **`checkInit` accepts the plugins Claude Code reports as built in** (path `builtin`: three on
   2.1.310, including `cc-plugin-agents-md`) and refuses any other. Without this it would have
   stopped every run. A canary `AGENTS.md` doesn't reach the agent under the bundle.
5. **The bundle's own `printenv`/`env` deny blocks 13a's G9 measurement,** so the bundle probes
   measure the token with `python3` instead.

**Changes from the spec:**
6. **A new config key, `[sandbox] readable_env`:** the `.env*` files agents may read because
   they hold no secret (a committed `.env.example`). Every other `.env*` file is denied; the
   tests' dummy file (`[compose] env_file`) is always readable. The spec only said "the
   project's dummy env files listed in config", and one key wasn't enough. Roadmap's config list
   updated.
7. **`mirai sandbox show` may build the trust root** if there isn't one yet (the same cached
   snapshot every launch builds); it writes nothing else and creates no launch folder.
8. **No tool-name mapping in the adapter:** the registry's agent tools already use Claude Code's
   names (unit 11), so `src/adapters/claude-code.js` didn't change.
9. **The docs page** also explains `mirai sandbox show` in full (your request), and says
   plainly that revoking a setup token isn't documented officially (checked against the docs),
   with the safest steps instead.

**Fixed from the review** (both reviewers; details in `review.md`):
10. **The real launch layout was never probed (blocker, both reviewers).** In production the
    scratch folder sits in `<mirai-home>/<repo-id>/launches/<id>/`, and the whole MIRAI home was
    write-denied. A write deny wins over an allow inside it (G20), so agents couldn't have
    written their own temp folder. Fixed:
    - the MIRAI home is no longer write-denied as a whole (sandboxed commands can't write
      there anyway); its store, trust root and `launcher.json` are denied one by one;
    - `renderStrict` refuses a layout with the scratch folder under a write deny;
    - **found by the re-run on the real layout:** Claude Code puts Bash's `TMPDIR` under
      `CLAUDE_CODE_TMPDIR` only if that path is about 30 bytes or less; MIRAI's launch path is
      far longer, so Bash fell back to `/tmp/claude-<uid>`, which the bundle write-denies (your
      sessions' scratchpads live there). Each launch's scratch is now a fresh, private,
      short folder, `/private/tmp/mirai-<8 hex>` (0700, made new, removed with the launch);
    - the bundle probes now run through the real `prepareLaunch` on a production-shaped MIRAI
      home.
11. **Holes closed:**
    - `.env*` files in nested repos and submodules: the file tools' denies are globs now, not
      only today's files;
    - `.git` at any depth, including the worktree or submodule `.git` file;
    - the folder `core.hooksPath` names, and the `git-hooks` rule's files, are write-denied;
    - a checkout that is (or contains) your home folder, `/` or `/private/tmp` is refused;
    - `PATH` keeps only absolute folders outside the checkout, the launch and the MIRAI home.
12. **`[sandbox] readable_env` and `[compose] env_file` can't expose a real secret:** an entry
    counts only for a `.env*` file committed on the integration branch, and never for `.env`
    itself or a `*.local` file. `mirai sandbox show` lists refused entries.
13. **Reads outside your home folder:** `/private/tmp/claude-<uid>` (your sessions'
    scratchpads), your temp and cache folders, `/Users/Shared`, `/Volumes` and Homebrew's `var`
    are read-denied.
14. **`checkInit`:**
    - the version is required;
    - built-in plugins, skills and agents are checked by name, from `[strict]` data for the
      version seen (anything else means `--restricted` stopped working);
    - also checked: the folder, the model, and a nameless MCP server.
15. **Floors in code:** the minimum tool and env-var denies can't be removed by data. Every
    weakening key (`filesystem.disabled`, `allowGitConfig`, `ignoreViolations`, `ripgrep`, the
    proxy ports) is written or checked, and `prepareLaunch` refuses a loose file.
16. **Hygiene:**
    - a failed launch leaves no folder;
    - the token isn't enumerable on the plan, so logging it can't print it;
    - the launch facts are `realpath`ed, with your home from `HOME` and the system both denied;
    - `anchored()` handles trailing slashes and braces, and refuses `!`;
    - the red-team key is the hash of a canonical render (template plus renderer).
17. **The docs page:** restructured; says what's readable outside your home, that
    `readable_env` is team policy, what an ecosystem pack is, which secrets aren't covered yet,
    and that the token's file descriptor itself is tested in unit 19.

## Noted for later units

- **13c (hooks, interactive settings):**
  - the `realpath` hook on every file tool closes case variants and symlinks for good,
    whatever Claude Code's own matching does;
  - a hook-level `.env*` check;
  - the interactive `.claude/settings.json` with exact `Agent(mirai-<name>)` denies.
- **17 / packs:** secret files beyond `.env*` (`auth.json`, `.npmrc` tokens, `*.pem`,
  `config/master.key`, `.dev.vars`) as opt-in pack data.
- **18 (red-team):**
  - N≥3 runs of everything, including `AGENTS.md` and the case and symlink probes;
  - a static diff of each new binary's sandbox profile, settings schema and built-ins (and the
    `[strict] builtin_*` lists updated from it);
  - `denyWrite` globs at depth;
  - what's readable outside your home folder;
  - a planted program on a relative `PATH` entry;
  - the data-protection keychain;
  - results keyed by the canonical render hash, run on the two mode templates, with each
    agent's template required to be no looser than its mode's.
- **19 (`mirai agent run`):**
  - write the token to a pipe on fd 3 and close it (never a file); probe whether Bash can read
    `/dev/fd/3`;
  - start `claude` in its own process group, and kill the group at the end;
  - re-hash the trust root and `input/settings.json` right before starting;
  - `checkInit` with the version of the green red-team result;
  - build `agentsJson` from the trust root only, its tools equal to the template's;
  - log the launch id, `settingsSha256`, `canonicalSha256` and the token fingerprint, in the
    store only;
  - remove `launches/<id>` with `removeLaunch` afterwards; never trust or run anything from
    `scratch/`;
  - a `Read` allow for the plan in `input/` when unit 15 puts it there;
  - consider `DISABLE_AUTOUPDATER` so the version can't change mid-run (probe first);
  - commit with hooks off;
  - a 401 means "renew the token".
- **29 (`doctor`):** the canonical bundle hash, the green red-team version, and stale
  `launches/` folders.
- **Worktrees** (parallel lanes, later): git's common folder is outside the checkout, so a
  worktree checkout needs it re-allowed.
