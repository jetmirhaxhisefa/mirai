# Agent safety in MIRAI

From unit 19 on, MIRAI starts AI agents (Claude Code) that work on your project on their own,
for example overnight, without you approving every step. This page explains:
- what keeps them in check;
- how that was tested;
- what you do by hand;
- what the limits are.

## Why agents need limits

An agent started by MIRAI runs **as you, on your Mac, with your rights**. There's no separate
user and no container (decision V1). Without limits it could, by mistake or because a file in
the repo tricked it:
- read your secrets: `.env` files, SSH keys, keychain passwords, git logins, MIRAI's signing key;
- push code, or change git settings so that something runs later;
- send data to the internet;
- start more agents, or edit MIRAI's own rules to approve its own work.

So every agent run gets a fixed set of limits. MIRAI calls it the **strict bundle**. It's built
from MIRAI's **trust root**, a read-only copy of MIRAI's files taken from your integration
branch. Neither the branch the agent works on nor your own Claude settings can loosen it.

## What an agent run gets

### The limits

- **Claude Code in `--restricted` mode.** It loads none of your settings, memory or skills,
  and none of the project's `CLAUDE.md` files or skills. The agent's only instructions come
  from MIRAI. If a Claude Code update ever breaks `--restricted`, MIRAI refuses to start agents
  rather than fall back to a weaker mode.
- **An explicit tool list:** only the tools the agent's definition names. No web access, no
  starting other agents.
- **The sandbox** for every command the agent runs, with no way to switch it off:
  - **Reads:** your whole home folder is denied, except:
    - the project;
    - the run's own input and scratch folders;
    - MIRAI's trust root.

    Outside your home folder, MIRAI also denies the places that can hold other people's or
    other programs' data: the temp folder your own Claude Code sessions share (their
    scratchpads and saved outputs), your personal temp and cache folders, `/Users/Shared`,
    `/Volumes` (other disks) and Homebrew's database folder. The rest of the system (programs,
    libraries, Homebrew's tools) stays readable, so tools work.

    Inside the project, every `.env*` file is denied again, at any depth (nested repos too),
    except:
    - the tests' dummy file named in `[compose] env_file` (such as `.env.test`);
    - the files listed in `[sandbox] readable_env` because they hold no secret (such as a
      committed `.env.example`).

    Both exceptions count only for a file that's **committed** on the integration branch, and
    never for `.env` itself or a `*.local` file: a file git ignores is somebody's real secret.
    `[sandbox] readable_env` is shared team policy in the project config, so it can only open
    files everyone already has. Agents don't need the others: tests run in containers through
    MIRAI (unit 14). Your keychain files, MIRAI's store and `~/.config/mirai` are always denied.
  - **Writes:** only the project and the run's scratch folder. Even there, nothing can write:
    - `.git`, at any depth (nested repos and submodules too);
    - `.mirai`;
    - files that run by themselves when you open or build the project: `.vscode/`, `.envrc`,
      `.husky/`, `.claude/`, git hook folders (including the one your project's
      `core.hooksPath` names), and those of the **ecosystem packs** you chose. A pack is a small
      list of such files for one technology (`node`: `.npmrc` and others; `php`, `python`,
      `rust`, …), switched on per project with `[gate] packs`, so MIRAI has no defaults that
      only fit one stack;
    - the temp folder your own Claude Code sessions share.

    A read-only agent can't write the project at all.
  - **Network:** none. Claude Code's own connection to Anthropic isn't affected, because it
    doesn't go through the sandbox.
- **A clean environment:** only `PATH`, `LANG`, `TERM`, `USER` and `HOME` from yours (`PATH`
  keeps only absolute folders outside the project, so an agent can't plant a program Claude Code
  itself would run), plus:
  - a fresh, empty Claude config folder for each run, so nothing carries over between runs;
  - a git config MIRAI provides.
- **A check after start:** MIRAI reads Claude Code's first message and stops the run if
  anything differs from what it asked for:
  - the tools, the agent, the folder, the model or the permission mode;
  - an API key being used;
  - a memory being on;
  - an MCP server MIRAI didn't pass;
  - a plugin, skill or agent beyond the ones built into this Claude Code version (it always
    brings some of its own). One that isn't means `--restricted` stopped keeping things out;
  - a Claude Code version other than the one the safety tests passed on.

### The second layer: MIRAI's hook

The sandbox covers every command an agent runs. Claude Code's own file tools (Read, Edit,
Write, Grep, Glob) run outside it, and Claude Code's rules for them match file **names**. So
MIRAI adds a second check, a **hook**: a small MIRAI program Claude Code runs before every file
tool call. It looks at the file on disk, not just the name it's given, and refuses:
- **any path that isn't a plain absolute path** (one starting with `~`, a space, or using `..`),
  rather than guessing how Claude Code reads it;
- **anything outside the project,** after following symlinks and ignoring letter case (as
  macOS does), and any write through a symlink that points nowhere;
- **`.git` and `.env*` files, at any depth;**
- **writes to `.mirai`, to the files that run by themselves, and to your git hooks folder;**
- **any file that is the same file on disk as a protected one** (a *hard link*: a second name
  for the same data);
- **writes that contain your login token** (in any encoding) **or a known secret format**, such
  as a private key, a GitHub, GitLab, AWS, Slack, Stripe or npm token. Only formats with a
  fixed prefix, so ordinary code doesn't trip it. A key pasted as a test fixture is refused too;
  the agent is told to use a placeholder or make the key when the tests run. This checks what
  the **file tools** write; something written by a shell command isn't scanned here, and the
  push check (unit 26) is the backstop for both.

For **writes**, the hook is the gate: the agent's write tools work only when the hook allows
the call, so a hook that fails to run means no write. For **reads**, Claude Code needs no
permission inside the project, so the hook only refuses (when a read is fine it says nothing,
leaving Claude Code's own checks in place); if it ever failed to run, the first layer (the
sandbox, `--restricted` and the deny rules) still stands. On every call the hook checks that the
run's policy and the rest of MIRAI's trust root are unchanged. It can't vouch for its own code,
since it is that code: what keeps agents from changing it is the sandbox's write deny on the
trust root. A call costs about 0.2 seconds.

**What the hook can't close:** it checks a file, then Claude Code uses it a moment later. An
agent running a command in the background could swap the file for a symlink in between. Claude
Code's own symlink check has the same gap. The sandbox still covers everything the agent's
commands do; this gap is about the file tools only.

**Hard links, specifically.** An agent can't create one (the sandbox refuses), but if a
second name for a secret file already exists in the project, both the sandbox and the file
tools would read the secret through it. So a launch is refused while a real `.env*` file, your
token or your signing key has a second name, or is itself a symbolic link (its target would be
readable under the target's own name). The message tells you what to do.

**MIRAI protects names and file identity, not content.** A copy of a secret made before the
run under another name (`prod.env`, `config/app.env`, a `*.pem` key, an `auth.json`) is a new
file MIRAI doesn't know is secret. So is a `.env` that was ever committed: it stays readable in
git's history. Keep secrets out of the project folder except the `.env*` files, and never commit
them. Secret files for a given technology come as pack data later (unit 17).

### Seeing it yourself: `mirai sandbox show`

The rules are generated from MIRAI's trust root, your project config and this machine's paths,
so they aren't written down by hand anywhere. `mirai sandbox show` prints the real result, so
you can read and check it instead of trusting a description:
```
mirai sandbox show                    # an agent that may edit the project
mirai sandbox show --mode read-only   # an agent that may only read (a reviewer)
mirai sandbox show <agent-name>       # one specific agent (once agents exist, unit 21 on)
```
It prints:
1. **The exact `claude` command** MIRAI would start (`--restricted`, the tool list, the settings
   file).
2. **The environment:** which variables the agent gets. The token is never shown.
3. **What MIRAI checks right after the start:** the tools, no API key, no memory, the
   permission mode.
4. **The full settings file, with your real paths:** what's read-denied, what's readable, what's
   write-denied, and that the network is off.

**Use it to:**
- see the effect when you add an ecosystem pack (`[gate] packs`) or a `[sandbox] readable_env`
  entry;
- answer "can an agent read X?" by looking for X under `denyRead` and `allowRead`;
- find out which rule blocked an agent that says "I couldn't read or write Y".

**What it changes:** nothing. It starts no agent and creates no launch folder. The only thing it
may write is MIRAI's trust-root snapshot, if there isn't one yet: the same cached copy every
launch builds, kept outside the project.

## Your own Claude Code sessions in a MIRAI project

Your interactive sessions don't run in the strict bundle: you're there, approving what they
do. MIRAI still adds a few hard rules to the project's `.claude/settings.json`. They stop
Claude's file tools outright, whatever a conversation asks; a shell command (`cat` of a file,
for example) isn't covered by them and still asks you first, and the command rules below are
speed bumps:
- never read or change `~/.config/mirai` (your signing key and the token) or MIRAI's store;
- never write into `.git` or the committed keys and records under `.mirai/`;
- never run the commands only you may run (`mirai approve`, `drop`, `key`, `token`);
- never start MIRAI's agents as subagents: they always go through MIRAI, which logs them and
  keeps them in their limits.

MIRAI **merges** these into your `.claude/settings.json`: your own settings and rules stay as
they are, and `mirai render` adds MIRAI's back if one goes missing. The lock records only
MIRAI's entries, so your own changes to the file are never flagged. The file is rewritten as
plain JSON with 2-space indents the first time. It's shared with your team, so put rules that
are only yours in `.claude/settings.local.json`, which Claude Code reads too (keep it out of
git).

### MIRAI's tools in your sessions (unit 15b)

Your sessions can use the same MCP server agents use, with four tools: `lint` (MIRAI's document
checks), `log_event` (a note or a template gap in the journal), and `run_tests` and `run_check`
(the project's tests and checks in their containers). Workflow skills call these, so a skill works
the same in your session and in an agent run. Later (unit 19) this server is also how a skill
starts an agent, so the skill never handles the launch token.

**How it's set up, and only if you choose to:** `mirai session-server install` registers the
server with Claude Code's own CLI at **local scope**: in your Claude Code config, for this project
folder only, never in the repo. MIRAI never edits Claude Code's files itself, and never replaces
or removes a server named `mirai` that it didn't register.
- **The allow rules** for the four tools go into your `.claude/settings.local.json` (yours, and
  only if git ignores it, so they're never shared). Not into the committed settings: there they'd
  also let a look-alike `mirai` server from a branch's `.mcp.json` run its tools without asking,
  for a teammate who never registered.
- **Keeping it current:** `mirai render`, run in your terminal, registers it again only when it's
  behind the integration branch. It never registers a project that hasn't been, so `remove` lasts.
  `mirai session-server status` says where it stands.
- **A moved project folder** loses the entry (it's keyed by the folder's path): run install again.
- **A failed or impossible install** (no `claude` on your PATH) leaves the registration that's
  running alone: each policy file is named by its own hash, and its trust root is kept.

**What's checked:**
- **The rules come from the integration branch.** The server runs from the trust root it was
  registered with, hashed again on every call; `lint` uses that trust root's document rules and
  config, never the work tree's, so a branch can't loosen them.
- **Its environment is empty** (`/usr/bin/env -i`), as for agent runs.
- **A committed `.mcp.json` can't take its place.** A local-scope server wins over a project one
  of the same name, even with `enableAllProjectMcpServers` (probed). `.mcp.json` and `.claude/` are
  also auto-run paths: agents can't write them, and a branch that changes them is high risk.
- **What your session writes says so:** journal lines are `by: "session"`, with the
  registration's id (one per repo, shared by all your sessions there), apart from yours and an
  agent run's. At most 200 a day (a UTC day), counted under the journal lock. Its test runs are
  stored as the session's and never signed. `lint` says which trust root's rules it used.
- **What these checks guard against:** what a branch contains, and accidents, not your session
  itself. Your session isn't sandboxed (13c): from Bash it could rewrite the policy, its
  registration or the store, and only your prompts hold it back. So these tools add little safety
  on their own.
- **Not checked, on purpose:** the server doesn't stop when `.git` changes, as an agent run's
  does, because your own commits change it all the time. MIRAI's git calls still run its pinned
  git with the repo config allowlist and the shape check (unit 14b).

**If something's off:** a server that can't start shows as "failed" in Claude Code (`claude mcp
list`), and your session goes on without its tools. A project you've never trusted in Claude Code
ignores the project's allow rules, so the tools then ask first. Claude Code may also list the tools
through its tool search rather than up front; they're there all the same (probed).

## How this was tested

Every limit above rests on a fact that was tested, not assumed (unit 13a,
`research/10-claude-code-facts.md`). MIRAI ran short, real Claude Code runs against a throwaway
project full of **canaries**: fake secrets with random values. If a canary shows up in a run's
output, that limit failed. No real secret was ever read.

What the tests found, on Claude Code 2.1.310 and macOS 26.7:
- Most limits hold as documented: `.env` denies, deny rules, symlinks, the empty network, and
  keeping your settings and memory out.
- **One didn't hold by default: the keychain.** Without an extra rule, a sandboxed command
  could read your git login and other keychain items. The bundle's read deny on
  `~/Library/Keychains` closes it, and that was tested twice.
- No way was found for a sandboxed command to start a program outside the sandbox (`open`,
  `osascript`, `launchctl` were all tried).
- **A hard link to a secret file** (a second name for the same data) would let both the sandbox
  and the file tools read it. Agents can't create one, and MIRAI refuses to launch while one
  exists (unit 13c).
- The rendered bundle itself passes the same tests (unit 13b).

The tests are re-run after every Claude Code update (unit 18), because each fact holds for the
version it was seen on.

### Tests run in containers (units 14a–14d)

Agents never run `docker` or the project's tests themselves. They ask MIRAI's MCP server: the
tools `run_tests` and `run_check` (unit 14d, below). You run the same thing yourself with
`mirai test <level or check> [--path <file or folder> | --test <test ID>]` (units 14c, 16a).

**What happens on each run** (one run at a time per project, and at most `[tests] max_parallel`
at once across all your projects, set in your personal `~/.config/mirai/config.toml`, 1–8,
default 2; a run waits up to 30 minutes in all for its turn and a slot):
1. **A fresh copy of the project** is made in MIRAI's store. It holds the files git lists: tracked
   ones, plus new ones that aren't ignored.
   - **Never copied:**
     - `.git`;
     - ignored files (dependencies and build output come from the images);
     - any `.env*` file, unless the project lists it as a committed dummy file
       (`[compose] env_file` and `[sandbox] readable_env`). Those are written from the
       integration branch's version, never from your work tree.
   - **Nothing is ever followed:**
     - a path under a link is refused;
     - a link is copied only when it points further down in its own folder, with no `/` at the
       start and no `..`;
     - a file with a second name on disk (a hard link) is refused.

     Docker Desktop follows an absolute link given as a mount source (probed in unit 14c), so
     the copy never holds one.
   - **After the run** the copy is removed. Tests can write to the copy, never to your project.
2. **The compose files come from the integration branch** (the trust root), not from the branch
   being tested. A branch's own `compose.override.yml`, `COMPOSE_FILE` or `.env` changes nothing.
3. **A quick text check** refuses compose files that use keys acting on your machine before
   Compose even reads them: `include`, `extends`, `env_file`, `provider`, `models`, YAML tags,
   merge keys and explicit (`?`) keys. It's coarse, and fails closed: a false match is refused
   with its line.
4. **Compose resolves the files once:**
   - with Docker Desktop's own client, never the `docker` on your `PATH`;
   - with MIRAI's own Docker settings, so nothing from your `~/.docker/config.json` is used;
   - with the dummy env file for every `${VAR}`.
5. **MIRAI tightens the result:**
   - it removes what only your daytime stack needs (`ports`, `build`, `restart`,
     `container_name`, `develop`, `profiles`);
   - it makes every network internal;
   - it adds its own labels and an output folder (`/mirai/out`).
6. **An allowlist checks every key.** Anything it doesn't name is refused, naming the service
   and the key:
   - privileged mode, added capabilities, devices;
   - the host's network, PID or IPC;
   - the Docker socket;
   - a mount from outside the copy, or one whose path goes through a link or `..`;
   - a `.git` mount;
   - shared or external volumes and networks;
   - an image that isn't already on your Mac (test runs never build or pull).
7. **Mounts one service could swap for another get their own copy.** A folder one service
   mounts from inside another service's writable folder gets a separate copy. In the sample
   app, nginx's `backend/public` sits inside the app's writable `backend/`. Otherwise the
   service that starts first could replace that folder with a link before the second one
   mounts it; unit 14c showed this works on Docker Desktop. The cost: the second service sees
   that folder as it was when the run began, not what the first one writes there later.
8. **The checked file is frozen and run as it is:**
   - the service starts and must turn healthy;
   - `docker inspect` then checks each container: its mounts are exactly its service's mounts in
     the frozen file, nothing is privileged, it has no extra capabilities, devices, security
     options or host namespaces, and every network is the project's own and internal;
   - the command runs, inside the running service or, with `run = "oneoff"`, once in its own
     container, which is checked the same way.
9. **Afterwards** every container, network and volume of the run is removed: forcibly after a
   timeout, since containers outlive a killed client. MIRAI then checks that nothing is left.
   **Ctrl-C stops the run but still cleans up**, and a crashed run's leftovers are removed before
   the next run.

**Every run ends in one of five outcomes,** stored in the run's `result.json`:
- **pass** and **fail:** the test's own result;
- **timeout;**
- **env-fault:** the stack didn't start, or Docker or cleanup failed;
- **refused:** a check said no.

Only pass and fail are about the code. The last 20 runs' folders are kept in the store.

**What a test sees:**
- **The network:** nothing outside the project's own services. No internet and no name
  lookups (unit 14a, re-checked in 14c), and no way to reach your Mac.
- **The result keeps:**
  - the exit code;
  - the last 64 KiB of output, with terminal colour codes removed and the login token and known
    secret shapes redacted;
  - a fingerprint of the copied files;
  - each service's image ID;
  - the list of files the test wrote to `/mirai/out`.

**What you configure** (`.mirai/config.toml`, on the integration branch):
```toml
[compose]
files = ["docker-compose.yml"]     # your daytime file is fine; MIRAI tightens it
env_file = ".env.test"             # committed, dummy values only: what ${VAR} gets in test runs

[sandbox]
readable_env = ["backend/.env.testing"]   # other committed dummy env files the copy keeps

[[testing.levels]]
name = "unit"
command = ["your", "test", "command"]
service = "app"                    # the compose service it runs in
timeout_minutes = 10               # default 15
# run = "oneoff"                   # for a service that runs once (a browser-test runner)

[checks]
lint = { command = ["your", "lint", "command"], service = "app" }
```
- **Nothing in MIRAI is tied to a language or framework.** It runs whatever command the
  project names, in whatever image the project builds.
- **What a stack needs goes in the project's own files:** the sample app passes `APP_ENV`
  through its compose file and sets it in `.env.test`; a Django project would use its own
  setting there.
- **`[compose] allow`** lets a few resource keys through when a project needs them: `shm_size`,
  `ulimits`, `mem_limit`, `cpus`, `pids_limit`.

**What MIRAI requires is Docker Compose,** not a language: tests must run in containers, so they
can't reach the network or your Mac (D-48, D-49). Today that means **Docker Desktop on macOS**
(its client path, socket and file sharing are what was probed). OrbStack, colima and Linux each
need their own probes first.

**What this doesn't protect (residual risk):**
- **The test code is the agent's.** It runs as whatever user the image allows, in Docker
  Desktop's VM, with every peer service and its data within reach.
- **The images are the ones you built.** Their Dockerfiles are protected paths, but they're not
  rebuilt from the integration branch before each run until unit 17.
- **The output goes back to the agent.** That's the last 64 KiB of output and the files in
  `/mirai/out`. Redaction catches the login token and known secret shapes, nothing else, so
  anything a container can read can come back in a test's output. That's why containers get
  only the copy and dummy env files.

### How agents run tests: `run_tests` and `run_check` (unit 14d)

A headless agent run gets **MIRAI's MCP server** with two tools for tests:
- **`run_tests(level, path? or test?)`**: one of the project's test levels, optionally for one
  file or folder, or one test by its ID (unit 16a, on a level with a test adapter);
- **`run_check(name)`**: one of its named checks (`lint`, …), always whole.

Each one runs the steps above and returns the result in its reply. The server's only other tool
is `log_event` (see "How agents talk to MIRAI" below), and it gives no shell or Docker access. Claude Code starts the server itself, outside the
sandbox, with an empty environment, as with the hook (so `NODE_OPTIONS` and the like never reach
it). The server's code comes from the trust root, so a branch can't change it.

**What the agent can pass:**
- **a name** from the configured list only. An unknown one is refused, with the list;
- **a `path`:**
  - a file or folder of the project, relative to its top: letters, digits and `_ . / @ -`;
  - never starting with `-` or `/`, and no `.` or `..` parts. So there are no options, shell
    characters, spaces or quotes;
  - checked again in the copy: it must be there, with no link along it;
  - passed to the runner as the **service's own path** for it, from the frozen compose file's
    mounts (unit 16a). The sample app's `backend/` is `/var/www/html` in its `app` service, so
    `backend/tests/Unit` reaches the runner as `/var/www/html/tests/Unit`. A path the service
    doesn't mount, or that another of its mounts hides, is refused (`bad-path`);
  - on a level without a test adapter, it's passed after `--`;
- **a `test`** (unit 16a): one test, as `<file>::<test name>`:
  - the file by the path's rules;
  - the name as the runner reports it (the failing list shows it): 1–1,000 characters of plain
    printable text, with no control, format (bidi, zero-width) or invisible-only characters. A
    data provider's method name covers its data sets (`phpunit`'s `variant`);
  - a file, never a folder (`bad-path`);
  - only on a level with a test adapter, which passes it as one argument, escaped for how that
    runner matches names. A level without one refuses it (`no-adapter`);
- **nothing else:** an extra field (such as a `script`) is refused.

A name or path of the wrong form is refused before anything runs (`bad-arguments`). A path that
isn't in the copy, or has a link along it, is refused after the copy (`bad-path`). The same path
rules hold for `mirai test --path`.

**What comes back:**
- the outcome (pass, fail, timeout, env-fault, refused) and the exit code;
- the duration, and the last 32 KiB of output, redacted;
- the output folder's file list, and the tree hash;
- **on a level with a test adapter** (unit 16a, below), what its JUnit report says:
  - `tests`: the counts, `total`, `passed`, `failed`, `errors`, `skipped`, and `outside` (cases
    that ran but weren't asked for, such as a file's twin that a runner's filter also matched);
  - `failing`: the failed and errored tests, each with its `id`, `kind` and the first line of its
    message (redacted, at most 300 characters). At most 50, and at most 16 KiB of the reply (the
    output's tail gets the rest of the 32 KiB), with `failing_total` counting them all;
  - `report`: `ok`, `missing` or `malformed`.

**Test adapters and kinds** (unit 16a; how to write one: [test-adapters.md](test-adapters.md)).
A level opts in with `adapter = "<name>"`: `phpunit`, `vitest` and `playwright` ship, as data
files in `registry/test-adapters/`, and a project adds its own in `.mirai/custom/test-adapters/`.
Both are read from the trust root, so a branch can't change how MIRAI asks for and reads its
reports. What the runner does is still the branch's: its own config and scripts choose which
tests run, and the code under test could write the report itself. So a report is evidence, and
unit 25 compares counts and IDs with the integration branch's baseline. Each failing test has a
`kind`:
- **`assertion`:** a check in the test failed;
- **`error`:** the test threw, or the runner reported an error;
- **`not-found`:** the file, test or level ran nothing: it isn't there, or every case was
  skipped. Some runners exit 0 when their name filter matches nothing, so this is never a pass;
- **`load`:** the tests couldn't be loaded or compiled (a syntax error, a missing import). Only
  when no test ran: a line a test prints can't turn a real failure into this.

A failed run with nothing failing in its report (a runner that fails on warnings) gets one
`error` entry, so a failed run never reads as "no failures". Every case is stored in the run's
`cases.json`, and the failing ones with messages in `result.json` (up to 1,000); the result holds
the hashes of both and of the report.

The kind is the runner's word, read from the report; it's what unit 23's red check uses to tell
"fails for the right reason" (an assertion) from a typo or a crash.

**A level with an adapter whose report is missing or unreadable** is an environment fault
(`bad-report`), whatever the exit code: a run that should have written results and didn't can't
be trusted to have run the tests. A run whose tests didn't load fails as `load` instead. MIRAI
reads the report as a regular file only (never through a link the container left), at most
16 MiB, with a small XML reader of its own: no DOCTYPE, no entities of the file's own, nothing
fetched.

Nothing in the reply points into MIRAI's store, error messages included: paths into the MIRAI
home show as `<mirai home>` and `<trust root>`. Agents can't read the store anyway. Each agent
run's stored result names its launch.

**What's checked on every call:**
- **the trust root** is hashed again, and it must be the launch's: a pull or a merge mid-session
  doesn't switch the rules. If it changed, the call is refused and the server refuses every
  later call;
- **`.git`:** D-54's hash is compared with the launch's before the call, again when the run's
  turn comes (before MIRAI's first git call on the checkout, since the wait can be long), and
  after the run, however it ended. If it changed, the call fails and the server refuses every
  later call. The launch's own end check (unit 19's `finishLaunch`) finds the change too;
- **one call at a time:** a second call while one runs gets "busy".

**Where the server's settings come from:** nothing from its environment or from Claude Code.
Everything is in a policy file that MIRAI writes read-only into the launch's `input/` folder,
with its hash on the server's command line. A changed policy file and the server won't start.

**How the launch wires it:**
- `input/mcp.json` with `--mcp-config`, next to `--strict-mcp-config`, so no other server
  loads;
- an allow rule for each tool. Under `dontAsk` an MCP tool without one is denied (probed);
- the launch's init check requires MIRAI's server to be connected, and still refuses any other
  server;
- the wiring is part of the strict template in the trust root (which levels and checks are
  offered), so the template's hash and the canonical bundle hash red-team results are keyed by
  both cover it;
- `MCP_TOOL_TIMEOUT` is set to six hours, since a call may wait 30 minutes for its turn, run up
  to 240 and then clean up. A 12-minute call completed in the probes.

`mirai sandbox show` lists the server, its tools and the names it offers.

**When a run ends mid-call:**
- **What Claude Code does:** it sends its MCP servers SIGINT (probed).
- **What MIRAI's server does:** it cancels the run. The Docker call under way is killed, with
  its own process group. Then it removes the containers before exiting. With Claude Code gone it
  writes nothing more, so a closed pipe can't end the cleanup early.
- **`mirai test`** does the same on Ctrl-C, a kill or a closed terminal.
- **If either is killed outright (SIGKILL):** the next test run of the project sweeps what was
  left.

**Signed results (`mirai test --gate`):**
- `mirai test <name> --gate --branch <b>` is for you and, later, the orchestrator. It runs the
  whole level or check (no `--path`). It refuses unless HEAD is on `<b>` and the work tree is
  clean: no changed, staged or new files that aren't ignored, and no tracked file marked
  assume-unchanged or skip-worktree (which `git status` doesn't check).
- **Checked three times:** before the run, again right after the copy (a run can wait a long
  time for its turn), and again before signing. If HEAD or the tree changed in between, the run
  is refused and nothing is signed. So the copy that ran is HEAD's files, plus the base commit's
  dummy env files that every run gets.
- **What's signed:** the whole stored result, with your key, for this repo. That includes the
  outcome, the tree hash, HEAD, the base commit, the frozen compose file's hash and the trust
  root's hash. Only a run that ended in pass, fail or timeout is signed; a refusal or an
  environment fault isn't.
- **Kept apart:** a signed result is also kept in the store's `tests/gate/`, so agents' runs
  can't push it out of the last 20.
- **An agent's runs are never signed:** they're stored as `by: "agent"`. Unit 25 builds the
  gate-result record from signed results.

## How agents talk to MIRAI (unit 15a)

Agents can't run `mirai` (it's denied in Bash, and it would need the MIRAI home, which the
sandbox denies). Everything an agent may ask of MIRAI goes through the same MCP server as the
test tools (D-53). Its tools are a table in MIRAI's code: each one has its own arguments and
checks, and later units add tools to the table rather than new ways in.

**Every headless run gets the server,** with or without tests, because every agent may need
`log_event`. If it doesn't start, the run doesn't either.

**`log_event(type, message, template?, section?)`** writes one line to the repo's journal:
- **Two types only:** `note` and `template_gap` (a section a MIRAI template is missing), the same
  ones `mirai log` takes. Approvals, status changes, gate results and records aren't in the
  list, so an agent can't write them.
- **The line says it's the agent's:** `by: "agent"` and the launch it came from. Your own
  `mirai log` lines say `by: "unverified"`, and your signed lines `by: "human"`.
- **The agent doesn't choose the ticket.** The line is filed under the launch's own item, which
  MIRAI sets; an `item` argument is refused.
- **Plain text only:** no control characters but newlines and tabs, no bidi overrides, nothing
  invisible-only. The text is the agent's and ends up in your inbox and reports.
- **No secrets:** as the hook does for files an agent writes, text with the login token (in any
  encoding) or a known secret shape is refused, never written.
- **Limits:** at most 50 lines per run and 4,000 characters per message. Past that the tool says
  `log-full`. The count is kept in the launch folder, so a restarted server doesn't start again
  at 0, and a refused or failed call doesn't count.
- **What's checked:** the arguments (no extra fields), the trust root on every call, and a
  stopped server refuses this tool too. It runs no git, so it needs no `.git` check. If the
  journal is busy, the call waits two seconds at most (the server answers nothing while it
  waits) and then says `journal-busy`.
- **Which tools a server may offer** is in the table too: each tool names the kinds of server it
  may be in, and every tool so far is for agent runs only. A policy that offers a tool outside
  its kind stops the server at start (D-53: an agent run never gets `start_agent`, unit 19).

**The input folder:** what an agent is given to read for one run (its plan, the findings of
earlier rounds) is written into that run's `input/files/` before it starts:
- **readable by the agent's tools:** Claude Code's `--restricted` keeps the file tools inside
  the project, so the launch adds the folder with `--add-dir` (and the init check expects
  exactly that folder). Bash reads it through the sandbox's `allowRead`;
- **read-only:** `--add-dir` would also let sandboxed commands write there (probed: a `chmod`
  got through), so every launch write-denies its `input/` in the sandbox and for Edit. Under
  that, Write, Edit, `echo >>`, `chmod` and `rm` were all refused (probed). The files are also
  0400 in a 0500 folder, and MIRAI's hook only lets the file tools write inside the project and
  scratch;
- **this run only:** the folder is in this run's `allowRead` and `--add-dir`, and in no other
  run's;
- **checked names:** lower case, ending in `.md`, `.json`, `.txt` or `.diff`; at most 32 files
  and 4 MiB;
- **gone after the run,** with the rest of the launch folder.

- **no instruction files:** `claude.md`, `agents.md` and the like are refused as input names (on
  your Mac's disk, `claude.md` is `CLAUDE.md`), though nothing loads them today.

Unit 19 fills it with real plans. What an agent produces comes back as its structured output,
never as files it writes for MIRAI.

**Not secret from the agent:** the server's and the hook's policy files sit in the launch's
`input/`, which sandboxed Bash can read, and they name the store, the trust root and the MIRAI
home. That's by design: those paths are denied anyway. Error messages still show them as
`<store>`, `<trust root>` and `<mirai home>`, which keeps replies short and free of your user
name.

**What isn't here yet:**
- **launching agents and session runs** (`start_agent`, `agent_status`, `session_start` and
  `session_end`): unit 19, with `mirai agent run`;
- **`trace`:** unit 43.

## MIRAI's own git

MIRAI runs git on your Mac for almost every command: `status`, `lint`, `trust`, `protected`,
and later the commits. Those calls run outside every sandbox, with your user's rights. A repo's
own config can make git run programs: a filter on every file it reads, a diff driver, a hook.
So whatever is in `.git/config` would run under MIRAI too. Since unit 14b, three things stop that.

**1. Every call is pinned.** MIRAI runs `/usr/bin/git` only, never a shell. It runs it:
- with the repo named outright (`GIT_DIR` and `GIT_WORK_TREE`), so `core.worktree` can't move
  it. MIRAI finds the project's top folder itself, without asking git;
- without your global `~/.gitconfig` and without the system one;
- with an empty `HOME` (`/var/empty`, which macOS keeps empty and only root can write; where
  it doesn't exist, as on some Linux systems, git simply has no home folder to read);
- with hooks off (`core.hooksPath=/dev/null`);
- with ssh, credential helpers, askpass, proxies, pagers, editors and signing programs switched
  off;
- with only `file` and `https` transports;
- with diffs that never run a diff driver or a text converter.

Nothing from your shell's environment reaches these calls. Your own `git` is untouched: this is
only how MIRAI calls it.

**2. The repo's config is checked before git runs.** MIRAI reads `.git/config` (and
`config.worktree`, if that's on) without following includes, and sorts every key:
- **Known keys are fine:**
  - the usual `core` settings, remotes, branches, `user`, `pull`, `gc` and `alias`;
  - keys MIRAI overrides anyway: `core.hooksPath` (husky), `core.fsmonitor`, `credential.*`,
    `gpg.*`, `color.*` and others.
- **Keys that run programs or send git elsewhere are always refused:**
  - `include` and `includeIf`;
  - trailer commands and `gpg.ssh.defaultKeyCommand`;
  - filters, merge and diff drivers;
  - `url.*` rewrites and per-URL `http.*` settings;
  - `core.worktree` and a bare repo;
  - promisor and partial-clone settings;
  - `submodule.*`, and the remote's upload and receive programs.

  You'll see:
  ```
  mirai: MIRAI won't run git on this repo: .git/config sets filter.x.clean, which runs a program on your files (a filter)
  ```
  A credential inside a key (a token in a `url.<base>.insteadOf` URL) is shown as `<redacted>`.
  Your own git runs that key too. If you didn't add it, remove it with the `git config --unset-all`
  command the message names.
- **Any other key is refused until you allow it.** This covers a `difftool`, an IDE's own
  section and so on. If you trust the key, allow it on your machine in
  `~/.config/mirai/config.toml`:
  ```toml
  [git]
  allow_repo_config = ["difftool.*", "gitlens.someKey"]
  ```
  An entry is an exact key or a whole section (`name.*`). Keys from the always-refused list
  can't be allowed, and neither can sections too wide to judge (`core.*`, `remote.*`,
  `trailer.*`). What a key may do is judged against the git commands MIRAI runs today; a later
  unit that adds a git command checks these lists again. This
  setting belongs to you, not the project: a branch can't allow anything for itself.

MIRAI also checks the repo's shape:
- `.git` must be a real folder. A worktree, a submodule checkout or a `.git` file or link
  pointing at another repo is refused;
- `.git/config.worktree` is checked like `.git/config` whenever it exists;
- the folders inside `.git` that git reads from (`objects`, `refs`, `info`, `hooks`) must not
  be links;
- there must be no `commondir`, object alternates or grafts;
- `.git/info` and `.git/hooks` must hold no links;
- there must be no repo nested inside the project. A committed nested repo or submodule, or an
  untracked repo folder that isn't ignored, is refused: adding files would run that repo's own
  config. A repo inside an ignored folder (`vendor/`) is fine;
- **Git LFS repos are refused for now**, with a message saying what was found. LFS gets its
  filter from your global config, which MIRAI's git doesn't read, so every LFS file would look
  changed.

**3. `.git` is fingerprinted during runs.** For each agent launch, MIRAI records a hash of:
- `.git/config` and `config.worktree`, `info/` and `objects/info/`;
- the hooks folder;
- `commondir` and `shallow`;
- `HEAD`, the local branches (by the commit each points at), replace refs, worktrees, modules,
  and remotes defined by file.

The hash is checked again before every git call MIRAI makes during the launch, and when the
launch ends. A change stops the run and names what changed (`config`, `hooks`, `refs`…).
- **Routine git activity doesn't count:** packing refs, `git gc`, new tags and remote-tracking
  branches (your editor's background fetch) change nothing in the hash.
- **A commit or branch switch of yours in that checkout does count:** during a run, the
  checkout is MIRAI's.
- **Not live yet:** the launch code holds the fingerprint (`prepareLaunch` / `finishLaunch`), but
  MIRAI's launcher, which calls them, comes with units 15 and 19. Until then the checks in 1 and
  2 run on every command, and the fingerprint is tested but not yet in use.

**Your global excludes file still applies.** MIRAI reads the path of your global excludes
(`core.excludesFile`, or `~/.config/git/ignore`) and passes it in, so files only it ignores
(`.DS_Store`, IDE folders) stay ignored. An excludes file inside the project isn't used.
`mirai trust check` shows which git MIRAI uses and which excludes file it honours.

**How it was tested.** `test/probes/git-probes.js --mirai` runs every git call MIRAI makes
against 38 hostile repos from unit 14a, each with one key planted whose program only writes a
marker file:
- 19 were refused before git ran on the repo;
- in the other 19, git ran and nothing fired.

On a clone of the sample app with a planted filter, MIRAI's old git calls ran the filter 458
times in one call. The new ones refused the repo, and nothing ran.

## The login token

Agent runs don't use your normal Claude login. They use a separate **login token**.

- **What it is:** a long-lived (one-year) login for your Claude subscription, made by
  `claude setup-token`. It isn't an API key, and it uses your subscription's limits like your
  own sessions do.
- **Why a separate token:** agent runs deliberately don't load `~/.claude`, and the sandbox
  keeps them out of your keychain, where your normal login lives. So they can't use your normal
  login. The token is the only way they log in.
- **What it's used for:** only MIRAI's headless agent runs. Your own Claude Code sessions keep
  using your normal login.
- **Where it lives:** `~/.config/mirai/claude-token`, readable only by you, next to your
  MIRAI signing key. Never in a project, never committed, never in MIRAI's logs.
- **The commands** (each works in any folder):
  - `mirai token set`: paste the token from `claude setup-token`. It isn't shown while you
    paste, and it only works in a real terminal, never piped or run by an agent.
  - `mirai token status`: says whether a token is set, shows a short fingerprint (never the
    token), and when it was set. From day 330 on it reminds you to renew it.
  - `mirai token clear`: removes it (also in a real terminal).
- **What an agent can see of it: nothing, as far as tested** (the environment and other
  processes were tested; reading the private file descriptor itself is tested in unit 19).
  MIRAI hands the token to Claude Code on a private file descriptor, never in the environment.
  The agent's commands:
  - don't see it in their environment;
  - can't read it from other processes;
  - can't read `~/.config/mirai`.

  It's also kept out of Bash by a sandbox rule. A nested `claude` started by an agent isn't
  logged in.
- **Renewing it:** before it expires, run `claude setup-token` again, then `mirai token set`.
- **If it leaks:** run `mirai token clear`, then revoke the token at its source (see "Revoking
  the token" below). Then make a new one.
- **Don't sync `~/.config` into a dotfiles repo or a cloud folder:** the token lives there.

### Revoking the token

Checked against the official Claude Code docs on 2026-10-25:
- **How to revoke a setup token isn't documented officially.** `claude setup-token` has no list
  or revoke command, and Claude Code itself keeps no copy of the token.
- Community reports say such tokens may be listed in your claude.ai settings (Claude Code
  section) or in the Anthropic Console, and that revoking there didn't always take effect.
  That's unconfirmed.
- The docs say plainly that **deleting a stored copy of a token doesn't invalidate it.**
  `mirai token clear` only removes MIRAI's copy.

So if your token leaks:
1. `mirai token clear`;
2. look for it in your claude.ai settings and revoke it there if it's listed;
3. if it isn't listed, ask Anthropic support (or `/feedback` in Claude Code) to revoke it;
4. make a new one: `claude setup-token`, then `mirai token set`.

**When it expires,** headless runs fail with "Failed to authenticate: OAuth token revoked"
(the docs' wording). Make a new one the same way.

## What you do by hand

1. Once per machine: `claude setup-token`, then `mirai token set`, in your own terminal.
2. Renew the token about once a year (`mirai token status` reminds you).
3. Before trusting agent runs after a Claude Code update: let the red-team checks pass
   (unit 18).

## The limits of all this (honest residual risk)

- **This is weaker than a container or a separate macOS user.** The agent runs as you, so every
  part of MIRAI that touches what an agent wrote is part of the boundary. Each part is hardened,
  but a bug in any of them crosses it.
- **The tests were one run each, with an agent that cooperated,** on one macOS build. Unit 18
  runs them several times, including a mode where the agent actively looks for ways around the
  rules.
- **Command rules (such as "no `git push`") are speed bumps:** a command wrapped in `sh -c`
  gets past them. What actually holds is that agents have no network, no token in their
  environment, and no read or write access to the places that matter.
- **Newer app passwords** (the data-protection keychain) are guarded by macOS's app signatures,
  not by MIRAI's rules. They haven't been tested yet (unit 18).
- **Secrets not named `.env*`** (an `.npmrc` with a token, `*.pem` keys, `config/master.key`)
  are readable in the project unless a pack names them; secret files per technology come as
  pack data later.
- **What's readable outside your home folder:** system folders stay readable so tools work.
  The places known to hold data are denied (see "Reads"); unit 18 lists the rest.
- **MIRAI's git:** the repo check and the hash catch a hostile `.git` between two checks, not the
  moment it's written. Something other than an agent (your IDE, another tool) can still change
  `.git` between your commands; the next MIRAI command or check refuses it. The key lists were
  probed on git 2.39.5 (Apple); a git update needs the probes again (unit 18).
- **Your merge is the final gate.** MIRAI reviews and tests every change, but you decide what
  reaches your integration branch.

## Coming next

- **Unit 18:** the red-team suite, re-run after every update.
- **Unit 19:** the first real agent runs.
