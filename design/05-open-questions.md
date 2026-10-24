---
status: draft
version: 5
---

# 05 — Open questions

Each question lists what it blocks and my recommendation. **Version 2** marks the ones you
answered in review round 1 (`design/06-review-round-1.md` §G, 2026-10-21). **Version 3** adds the
items raised in the follow-up discussion (`design/08-followup-discussion.md`). **Version 4** applies
review round 2 (`design/06-review-round-2.md`, §G U1–U5). **Version 5** applies review round 3
(`design/06-review-round-3.md`, §B and your decisions §D V1–V3). Unit numbers refer to `07` version 5.

## A. Install and runtime

1. **Package name and install method.** **Answered:** install from a pinned GitHub tag,
   `npx github:<owner>/mirai#vX.Y.Z`. Nothing is published to npm for now. An npm name (`mirai-dev`
   or a scope) can come later.
2. **Which GitHub owner hosts MIRAI?** **Answered:** your personal GitHub account. The exact
   handle goes into unit 10's spec.
3. **Claude Code headless auth.** **Answered: subscription only.**
   - `--bare` is out, because it skips the OAuth token (`research/09` §4).
   - Overnight runs use `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`, with
     `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` unset (`research/09` §5).
   - Isolation comes from the strict settings bundle (unit 13), the `run_tests` tool (unit 14),
     the MIRAI MCP broker (unit 15) and the red-team suite (unit 18) instead.
   - **V1 (round 3): D7 is kept as is**: agents run as your user, with no separate macOS user and
     no container. The condition: if G18 shows the docker socket, ssh-agent or keychain reachable
     and not closable by configuration, or the real `.env` stays readable, no headless run
     happens and V1 comes back to you.
4. **Node version floor.** **Recommendation:** current Node LTS. `doctor` checks it.
5. **MIRAI's own license.** **Recommendation:** MIT. It's compatible with what we reuse (MADR,
   mattpocock, Rust RFC, Atlassian Apache-2.0 ideas). It's not CC BY-SA, which is why we don't
   copy arc42 text.

## B. Workflow choices

6. **Stacked MRs.** **Answered (D2):**
   - on, within one epic, at most 2 levels;
   - nothing merges without you;
   - built in unit 53 (trust root always from the integration branch; `rebase --onto` for squash
     merges; children never merge into a parent).
7. **Default budgets.** **Withdrawn** (R-M4).
   - The earlier numbers ($2 per S ticket, etc.) were unrealistic.
   - With a subscription, budgets are counted in turns, tokens and minutes. Dollars are only
     Claude's estimate.
   - The calibration run (unit 57, pilot tickets only) writes the budget and tier defaults (Q5).
     The pass marks are fixed in `07` beforehand, not by calibration (R2-M2).
   - Until calibration, a **provisional S-ticket turn cap of 100** is used for the pilot
     checkpoint's early stop rule (R3-M3).
8. **Track for a "standard" item: who decides when the PM proposal is wrong?**
   - **Recommendation:** you, at the intake gate.
   - Document approval is always yours (D6), so this is settled in practice.
9. **Where does the morning report go?** **Answered (round 2, PM2-17):** in the orchestrator store
   (`<mirai-home>`, never committed), printed by `mirai report` and in the terminal (units 29, 56).
   A Slack post comes later.
10. **Release.** **Answered (D3):**
    - **Default:** ticket by ticket.
    - **Per epic:** you can choose `release: together`, with a `feature/<epic>` branch and a final
      E2E test.
    - **Feature flags:** only when you ask.
    - **Staging:** **Answered.** Some projects have it, new unreleased ones often don't, and they
      will later. So the release stage reads `release.environments` from config and adapts: with
      staging, deploy there and verify first; without it, the record plus your go/no-go and a smoke
      check after deploy; not released yet, record only. `doctor` reports the current shape, and
      adding staging later is a config change (unit 60).

## C. Connectors

11. **Which external store first?** **Answered (D4):**
    - none in the MVP;
    - the `repo` store sits behind a generic connector contract (unit 38);
    - candidates for later: ClickUp (personal tasks), Jira (work), Linear (one project).
12. **Storage mode `both`.** **Answered (D5):**
    - removed;
    - each artifact type has one source of truth, never two;
    - different types may live in different tools.
13. **Status mapping per tracker.** Jira has no default "In Review" status, and ClickUp and Linear
    use custom statuses. When the first connector is built, setup asks per project, as BMAD does.

## D. Agents and naming

14. **Persona names.** **Answered:** kept for now. They can change later.

    | Persona | Role |
    |---|---|
    | Nora | product manager |
    | Arlo | architect |
    | Tess | ticket planner |
    | Kai | developer |
    | Rex | reviewer |
    | Ivy | QA |
    | Vera | verifier |

15. **Second model family.** Not needed until Milestone D (D1). Until then the verifier ladder uses
    a different Claude model (rung 2), else the same model. Is Codex installed and logged in on
    the machine that runs overnight? This decides rung 1 in unit 71.

## E. Pilot (Thudos)

**When the pilot starts: answered (U1, round 2).** Right after Milestone A, at the pilot
checkpoint (`07` unit 30). Units are built and tested on the sample app first. The sample app is
a **private** repo in the pilot's stacks (unit 02, R3-M1). During the pilot,
`[git] integration_branch = "mirai/pilot"`, so MIRAI never targets the pilot's real `main`
(R3-C1). The questions below are answered **at the pilot checkpoint** (unit 30), not before.
They were raised in `research/04` §6:

16. **P3 Decision docs.** Is `docs_old/decisions/` still the truth? Do HLD-0002, ADR-0004 and
    ADR-0009 exist anywhere?
17. **P6 Business context.** Is `ALL_FEATURES.md` in the mockup repo the input for the business
    context and feature map?
18. **P7 Local URLs.** Which local setup is current: the `*.thudos.test` proxy or ports 8000/8080?
    QA (Milestone C) can't run on the pilot until this is settled.
19. **P9 Risk paths.** Reuse the council's high-risk path list as MIRAI config?
20. **Where should repo-mode docs go in the pilot?**
    - **Recommendation:** continue the existing `docs/decisions/` numbering for ADRs/HLDs (D-20)
      and put PRDs and tickets under `docs/mirai/`.
21. **Can the pilot run CI with required checks?** It decides whether unit 54 is CI-enforced or
    reports "local-only" (R-M21). See also G11.
22. **Does the pilot's compose file mount anything outside the project** (home folder, docker
    socket, `.git`)? Unit 14 refuses such mounts for agent-triggered runs, so the pilot may need a
    test compose file (part of unit 30's hand work).

## F. Known risks to watch (not questions, but they could change the design)

- **Cursor loading things twice:** Cursor imports Claude's and Codex's folders. How it handles
  duplicate skill names is UNVERIFIED (`research/08` §5.2). Unit 73 must test it.
- **Codex hooks need user trust** and are skipped otherwise. Fine, because hooks aren't the gate.
- **Tree-hash records and rebases:** resolved. Records are bound to MIRAI's own SHA-256 over a
  **normalized patch** of code paths (R-C1, R2-M7, R3-M11, unit 25). Pinned git options are used,
  and blob IDs and hunk line numbers are stripped. So a clean rebase keeps the record, a base
  change elsewhere in a touched file doesn't break it, and whitespace or binary changes don't slip
  through. G14 checks it's stable.
- **Claude Code rule matching is a single point of failure for reads.** File tools and hooks run
  outside the OS sandbox and rely on the deny rules being right (`research/09` §7). The red-team
  suite (unit 18) is re-run by `doctor` after every Claude Code update. Its result is recorded per
  (Claude Code version, `strict.json` hash, Docker version), and **the launcher (unit 19) refuses
  every headless launch** without a green result (R3-M7), not just the autonomous preset. Symlink
  handling by the file tools is G17.
- **The OAuth token is readable by the agent** (R2-C3, TL3-3). Two earlier claims were wrong:
  - "the network allowlist limits where it could be sent": a test container with open network
    could send it anywhere;
  - "no route out": the allowed package registries accept uploads made with attacker-supplied
    credentials (round 3).

  Now:
  - agent-triggered test containers have no outside network (unit 14);
  - the headless network allowlist is tested **empty** (G16), and dependency installs go only
    through the broker;
  - `WebFetch`/`WebSearch` and `claude` from Bash are denied (unit 13);
  - the secret scan matches the token's exact value (unit 26).

  Whether the token can be kept out of the Bash environment is G9. DNS from sandboxed Bash and
  from an internal compose network is G19. If the token stays readable, the residual risk is
  stated honestly in `04` D-30.
- **Run log growth:** one file per run keeps merges clean. Growth is handled by the retention rule
  and `mirai clean` (unit 69, Q9). Structured metrics data is kept, but it's small and never
  loaded by agents.

## G. Facts to settle by test (UNVERIFIED)

Each is settled in the unit named, before anything depends on it. G6–G8 come from the follow-up
discussion (`08`). G9–G15 come from review round 2, and G16–G23 from review round 3. Some of them
rest on the reviewers' own knowledge, not on `research/`.

**V1 condition (round 3, §D):** G18 is a blocker. If the docker socket, the ssh-agent socket,
`git credential fill` (keychain) or `security find-*-password` can be reached from sandboxed Bash,
and configuration can't close it, no headless run happens. Decision V1 then comes back to you
(a dedicated macOS user or a container, `07` Later 17). The same applies if the real `.env` stays
readable through Bash despite unit 13's `denyRead`.

| # | Fact | Unit |
|---|---|---|
| G1 | Deny rules behave the same in headless `-p` as in interactive mode | 13 (red-team in 18) |
| G2 | The exit code and JSON shape when a usage limit is hit in `-p` | 13 (used by 52) |
| G3 | The exit code and JSON subtype when `--max-turns` is reached | 19 |
| G4 | `total_cost_usd` is reported on subscription auth, and how to read the session and weekly limit share per run (if not, read `/status` by hand for the pilot checkpoint) | 19 |
| G5 | `CLAUDE_CODE_OAUTH_TOKEN` works for an unattended run on this machine | 13 |
| G6 | GitHub has no official API for attaching images to MR comments or descriptions. Check the options before screenshots go on MRs (Q9) | Later item 6 |
| G7 | Diff coverage (coverage of changed lines only) can be produced for each stack the pilot uses, inside its containers (Q8) | 16 (warns in 26, blocks from 54) |
| G8 | The `Mirai-Ticket` commit trailer passes the commit-message rules of projects with a strict format (Q8) | 22 (checked per project by detection, 17) |
| G9 | Whether Claude Code can keep `CLAUDE_CODE_OAUTH_TOKEN` out of the environment its Bash tool and child processes see (`echo $CLAUDE_CODE_OAUTH_TOKEN`) (R2-C3) | 13 |
| G10 | Whether `--restricted` fits MIRAI's headless runs (the tools it removes, `--tools` to add back the needed ones, `--settings` only), and that user settings can't inject `env` such as `ANTHROPIC_API_KEY` when it's used (TL2-5) | 13 |
| G11 | GitHub `pull_request_target` runs the base branch's workflow for a PR that edits the workflow file, and required status checks are available on a personal private repo on your plan, and a required check can be bound to the `mirai-verify` job so a same-named check from a PR can't satisfy it (R2-C5, TL3-13) | 54 |
| G12 | `docker compose` auto-loads `compose.override.yml`, and `docker compose config` with an explicit file list shows every mount, network and privilege so validation can refuse bad ones (R2-C2) | 14 |
| G13 | A nested `CLAUDE.md` in a subfolder is loaded into a headless `-p` session's context when files there are read, and how to stop it for the reviewer (R2-M10); also `@` imports and project skill folders (R3-M9) | 13 (attack in 18; clean export in 24) |
| G14 | SHA-256 over the **normalized patch** of `merge-base..head -- <code paths>` (pinned options, `index` lines and hunk line numbers stripped) is stable across git versions, user git config and base changes elsewhere in a touched file (R2-M7, R3-M11) | 25 |
| G15 | Host-side git run with `-c core.hooksPath=… -c core.fsmonitor=false` ignores hooks and fsmonitor set in the repo's own config (R2-C1, R2-C2) | 14 |
| G16 | A headless `-p` run works with an **empty** sandbox `allowedDomains`, because Claude's own API traffic doesn't go through the sandbox proxy (TL3-3) | 13 |
| G17 | Claude Code's file tools and `--restricted` resolve symlinks before matching their rules, so a symlink made by sandboxed Bash can't reach the trust root, `.git/config` or the signing key (TL3-4) | 13 (attack in 18) |
| G18 | From sandboxed Bash, the docker socket, the `ssh-agent` socket, `git credential fill` (osxkeychain) and `security find-*-password` are blocked; what `allowUnixSockets` allows (TL3-5). **A failure that configuration can't close is a blocker and returns V1 to you** | 13 (attack in 18) |
| G19 | DNS resolution of outside names from sandboxed Bash and from an `internal: true` compose network on Docker Desktop (TL3-3) | 13 / 14 |
| G20 | Sandbox precedence of `allowWrite` inside a `denyWrite` path, and glob support in `denyRead` (needed for `.git` and `.env*`) | 13 |
| G21 | Claude Code kills background processes started by Bash when a `-p` session ends, or MIRAI's process-group kill is needed (R3-M8) | 19 |
| G22 | `--restricted` or a scrubbed `CLAUDE_CONFIG_DIR` keeps user memory (`~/.claude/CLAUDE.md`), user skills, user settings and `~/.claude.json` out of `-p` runs (TL3-15) | 13 |
| G23 | Host git ignores `.git/config` keys beyond `hooksPath`/`fsmonitor` when MIRAI pins them (filters, `core.sshCommand`, credential helper, `gpg.program`, `include.path`, `remote.*.pushurl`), and how `GIT_CONFIG_NOSYSTEM`/`GIT_CONFIG_GLOBAL` behave; extends G15 (R3-C4) | 14 |
| G24 | `claude` and `mirai` invoked from sandboxed Bash are refused by the deny rules in every form (path-qualified, `sh -c`, env-prefixed) (R3-M5, R3-C3) | 13 (attack in 18) |
| G25 | Exact-path sandbox `denyRead` entries for each real `.env*` file stop reads from sandboxed Bash (`cat`, `cp`, `python -c`, `grep -r`) (TL3-14) | 13 (attack in 18) |
| G26 | ~~`chflags uchg` on the trust-root bundle stops writes by your own user's processes without breaking MIRAI's own updates (R3-C1 hardening)~~ **Closed with unit 12 (2026-10-24):** not used. The flag's owner can clear it, so it stops nothing that runs as you; the sandbox `denyWrite` (unit 13) and the re-hash before every launch are the guard | 12 |
| G27 | An anonymous volume or tmpfs over `<mount>/.git` and over each real `.env*` file hides them inside test containers on Docker Desktop (R3-C4) | 14 |
| G28 | A GitHub required check can be pinned to the `mirai-verify` workflow, so a same-named check from a PR can't satisfy it (TL3-13) | 54 |
| G29 | Playwright MCP in interactive sessions can be restricted to the app's origin (TL3-20) | 50 |
