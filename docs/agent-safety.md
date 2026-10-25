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
- **Your merge is the final gate.** MIRAI reviews and tests every change, but you decide what
  reaches your integration branch.

## Coming next

- **Unit 18:** the red-team suite, re-run after every update.
- **Unit 19:** the first real agent runs.
