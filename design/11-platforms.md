---
status: draft
version: 1
---

# 11 — Ubuntu and Windows (stage 0)

Decision PM-40. The MVP is proven on macOS only. Your team uses Macs with Intel and Apple
processors, Ubuntu, and Windows. Ubuntu comes first, then Windows through WSL.

## 1. Where the work is

Checked on 2026-11-16: 14 of MIRAI's source files contain something specific to macOS (where
the store lives, a few launcher settings, the red-team suite). Changing those is small. The
work is the proof, because everything MIRAI's safety rests on was measured on a Mac.

| Area | macOS today | What changes on Ubuntu |
|---|---|---|
| **The cage** | Claude Code's sandbox on macOS, plus deny rules and hooks | Claude Code uses a different sandbox mechanism on Linux, with its own gaps and its own install needs. Every blocking rule is tested again (`research/10` redone for Linux) |
| **Docker** | Docker Desktop runs in a small virtual machine, which shields the host | Docker runs on the host. Access to the Docker socket is close to full control of the machine. `research/11` already says a Linux host needs the probes again |
| **The red team** | About 124 cases in 25 files. Many target macOS things: the keychain, `launchctl`, `open`, `osascript`, a case-insensitive file system | Linux equivalents are needed: the secret service and `gnome-keyring`, `systemd-run` and `systemctl --user`, `xdg-open`, D-Bus, a case-sensitive file system |
| **The result key** | One of its ten parts is the macOS build | It becomes the operating system and its version |
| **Paths** | Store under `~/Library/Application Support/mirai/`, key under `~/.config/mirai/` | Store under the XDG data folder (`~/.local/share/mirai/` by default). The key stays under `~/.config/mirai/` |
| **The kept agent binary** | One binary per result | One per operating system and processor |
| **The session server** | Installed for macOS | A `systemd` user service |
| **File ownership** | Files written by a container belong to you | Files written by a container may belong to root. The test containers must run as your user id |

## 2. Rules

- **A result never crosses systems.** A green red-team result on a Mac says nothing about
  Ubuntu. Each machine earns its own.
- **No headless run on a system without its own green result.** This is the existing rule
  (R3-M7). It needs no change, only cases that exist for that system.
- **Blockers come back to you.** If the Docker socket, the ssh-agent, the secret store or a real
  `.env` can be reached on Ubuntu and can't be closed by configuration, it is a blocker, exactly
  as the V1 condition says for macOS. For Docker the likely answers are rootless Docker or a
  socket the agent's sandbox can't see. P03 measures which one holds.
- **One module for the operating system.** After the MVP rule (`09` §4 row 11), P01 only has to
  fill in the Linux side.
- **Two processors on Mac are one system.** Intel and Apple Macs differ only in the kept binary.

**Check first, not verified when this was written:**

- whether Ubuntu 24.04's restriction on unprivileged user namespaces affects Claude Code's
  sandbox on Linux, and what must be installed or allowed;
- whether the deny rules MIRAI uses (path patterns, per-path unix sockets) behave the same on
  Linux;
- whether Docker Desktop on WSL counts as the setup P03 proves, or needs its own proof.

## 3. Windows

- **Through WSL 2.** A Windows user installs WSL with Ubuntu and Docker Desktop with its WSL
  integration, then works exactly like an Ubuntu user. The project lives inside the WSL file
  system, not on a Windows drive.
- **WSL has its own escape routes**, which the red team must cover:
  - Windows programs can be started from inside WSL (`cmd.exe`, `powershell.exe`);
  - Windows drives are mounted under `/mnt/c`, so Windows files, including credentials stored
    there, may be readable;
  - Docker Desktop's socket comes from Windows.
- **Native Windows is not planned.** As far as known, Claude Code has no sandbox there. **Check
  first** in P06 against the current Claude Code documentation. If that has changed, native
  support becomes a follow-up unit.

## 4. What you need

- An Ubuntu machine or virtual machine you can run agents on, logged in to Claude Code with a
  subscription, with Docker. A teammate's machine works if they run the red team and send the
  report.
- A Windows machine with WSL 2 for P06.
- Neither needs access to work systems. Tests use the sample app.

## 5. Units

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| P01 | **Operating-system module audit and Linux home paths:**<br>• list every place the code asks which system it runs on, and move any left outside the module that MVP unit 30a created;<br>• the store under the XDG data folder on Linux, with the same private permissions;<br>• the result key's `macos` part becomes `os` (name, version, build), with old results read as macOS;<br>• `mirai doctor` names the system and says plainly when it is unsupported | MVP unit 30a | Everything else builds on it | Every unit test passes on Ubuntu, including those unit 30a had to leave out, with the store in the XDG folder; a search finds no system check outside the module; a result recorded before the change still reads as valid on the same Mac |
| P02 | **Claude Code sandbox facts on Ubuntu** (`research/10` for Linux):<br>• install needs of the sandbox, and `doctor` checks for them;<br>• each fact G1–G30 that the cage relies on, probed again;<br>• the strict settings bundle for Linux where a key or path differs;<br>• written up as `research/10-linux.md` | P01 | The cage's facts come before its tests | Every fact has a probe result on Ubuntu; each difference from macOS is listed with what MIRAI does about it; a fact that fails and can't be closed is reported to you as a blocker |
| P03 | **Docker and git facts on Ubuntu** (`research/11` for Linux):<br>• what an agent can reach of Docker when Docker runs on the host;<br>• rootless Docker against a hidden socket: which one MIRAI requires, measured;<br>• test containers run as your user id, and files they write are yours;<br>• the pinned git and its settings;<br>• written up as `research/11-linux.md` | P01 | Docker is the largest security difference | A canary shows the agent can't reach the Docker socket in the chosen setup; a test run leaves no root-owned file in the project; `doctor` refuses a Docker setup that isn't the proven one |
| P04 | **The red-team suite on Ubuntu:**<br>• each case marked: same on both, macOS only, or needs a Linux twin;<br>• Linux twins for the keychain, `launchctl`, `open`, `osascript` and case-folding cases;<br>• new Linux cases: `systemd-run`, `systemctl --user`, D-Bus, `xdg-open`, `/proc` of the parent, `ptrace`;<br>• the session red team the same way | P02, P03 | No headless run without it | A full run on Ubuntu ends green or with blockers named; the report lists each macOS-only case and its Linux twin; a headless launch on Ubuntu is refused before the run and allowed after a green one |
| P05 | **The kept agent binary per platform, the session server on Linux, `doctor`:**<br>• the kept binary's folder and record name the system and processor;<br>• the session server as a `systemd` user service, with install and remove as gates;<br>• `mirai init --join` on Ubuntu;<br>• the guide gets an Ubuntu install chapter | P04 | The last pieces before a teammate can work | A teammate's Ubuntu machine joins a project with `init --join`, earns a green red team and runs one sample ticket to an MR; the session server survives a logout |
| P06 | **Windows through WSL:**<br>• **check first:** Claude Code's sandbox on native Windows, recorded;<br>• `doctor` detects WSL and refuses a project on a Windows drive;<br>• red-team cases for Windows programs started from WSL, files under `/mnt/c`, and Docker Desktop's socket;<br>• the guide gets a Windows chapter: install WSL, Docker Desktop, then the Ubuntu steps | P05 | Windows users must be able to run MIRAI | On a Windows machine with WSL, the red team ends green or names its blockers; a canary on the Windows drive isn't readable by an agent; one sample ticket reaches an MR |

**Order:** P01 → P02 and P03 (either order) → P04 → P05 → P06. P00 and P07–P09 (`12`) don't
depend on these. Which comes first is decided by who is waiting: a teammate on Ubuntu, or
tickets in Jira.

P04 is large. Its spec may split it into the Linux twins, the new Linux cases and the session
red team.
