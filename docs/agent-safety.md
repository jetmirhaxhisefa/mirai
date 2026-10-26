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

Agents never run `docker` or the project's tests themselves. They ask MIRAI's `run_tests` tool
(unit 14d), which runs them in the project's own containers. Unit 14a tested what that relies on,
with Docker and git probes (`research/11-docker-git-facts.md`):
- **No way out of the containers:** test containers on an internal network can't look up or
  reach the internet or your Mac; only the project's own services answer. Sandboxed commands
  can't look up names either.
- **Tests get a copy, not your project folder:** on a Mac, hiding a file inside a container
  doesn't work. Writing the name in another case (`.ENV` for `.env`) reaches the real file, and
  can even change it. So the test runner (unit 14c) gives the containers a fresh copy of the
  project for each run, without `.git` and without your real `.env` files. Tests can write to
  that copy, never to your project.
- **Nothing from the branch steers Docker:** the branch can't change which compose files load,
  or their values. MIRAI names every file, the project name and a trusted env file on each call,
  and clears Docker's own variables.
- **git on your Mac:** see "MIRAI's own git" below (unit 14b).

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

- **Units 14c and 14d:** the test runner (a fresh copy of the project per run) and the
  `run_tests` tool.
- **Unit 18:** the red-team suite, re-run after every update.
- **Unit 19:** the first real agent runs.
