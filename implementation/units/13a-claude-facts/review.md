---
unit: "13a"
date: 2026-10-25
reviewers: Tech Lead, Architect (independent, read-only, no network)
verdicts: approve after fixes (Tech Lead), approve after fixes (Architect); all findings applied, decided by you, or noted for later units
---

# Unit 13a — Review

Both reviewers worked on a frozen tree. I made no edits until both reports were in. Neither ran
the real harness or read a real secret. The Architect's only host call was a metadata-only
`security` lookup of the canary's name, to confirm it had been removed.

**What held up:**
- the split into 13a and 13b, and the stop at the G18 blocker;
- the keychain fix: the host baseline proves all four services were reachable outside the
  sandbox, and the deny closed both keychain routes;
- keeping V1 on that evidence;
- canary hygiene: random canaries per run, no token in any report, canary items removed;
- the token module: 0600 in a private folder, links and bad shapes refused, a fingerprint only;
  `token` runs from the launcher's own code;
- G16, G20 and G25 are well evidenced; the recorded runs used the exact commands asked for.

## Applied in unit 13a

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | G9's check could never see the token (`wc -c` prints a count), so "envVars deny works" had no evidence | Tech Lead | Reads the count; a canary variable with and without `credentials.envVars` deny; re-probed: 0 bytes, deny works | g9-*, T3 |
| 2 | G13: the project skill *does* load under the fallback (the init event lists it); the fallback also turns on an auto memory | both | Checks read the init event first; research/10 corrected; **your decision:** no `--restricted`, no launch | g13-*, g22-* |
| 3 | The 13b sketch put the token in the agent-readable input folder | Architect | Never there: hooks read `~/.config/mirai`; the token goes on fd 3 (probed: works) | g9-fd |
| 4 | The home-deny shape, escapes from the sandbox, the token in `ps`, writable temp folders, Write and Grep through a symlinked folder, `--agents` and MCP under `--restricted` were never probed | Architect | **Your decision:** probed now. Escapes blocked; `ps` shows no token; `/private/tmp/claude-<uid>` writable unless write-denied; git needs a MIRAI `GIT_CONFIG_GLOBAL` under the home deny; `--tools` doesn't limit MCP tools | runs 8–11 |
| 5 | A sandboxed command starting an unsandboxed one should count like G18 | Architect | **Your decision:** a blocker; none found | escape-* |
| 6 | research/10 claimed more than shown: "every rule has a control", G5, G17, G24, the keychain explanation, one macOS build, one cooperative run | both | Reworded; test conditions, missing controls and inferences named; macOS build recorded | — |
| 7 | Report text cut before redaction kept 40 characters of the token | Tech Lead | Redact first, then cut | T5 |
| 8 | Redaction missed a token inside a longer base64 string, base64url, upper hex, fragments | Tech Lead | All three base64 offsets, both alphabets, both hex cases, 16-character windows, the token's shape | T5 |
| 9 | The guard let through `$HOME`, `..`, `<path`, the keychain folder in commands, `git credential` for other hosts, and never read `env` or the question | Tech Lead | Every string checked, paths normalised, those refused; allows checked separately from denies | T4 |
| 10 | `--workdir` could overwrite and then delete real folders | Tech Lead | Must be empty, not home, not in a git work tree | T6 |
| 11 | Any Bash call counted as "made the call"; a missing G18 section read as "blocked"; a service the host can't reach read as "blocked" | Tech Lead | The exact command or path; every section required; host baseline gates each service | T7 |
| 12 | Ctrl-C left the canaries and the fixture behind; a failed canary setup went unnoticed | Tech Lead | Signal cleanup, a sweep at start, setup failures stop the run | — |
| 13 | `token clear` refused the very files it's needed for (too open, a link) | Tech Lead | Removes them, never follows a link | T2d |
| 14 | No test of the hidden reader's raw mode; the reader left raw mode after the stream was destroyed | Tech Lead | Reads with listeners, switches raw mode off first; tested on Enter, Ctrl-C, overflow | T1b |
| 15 | No renewal path for a one-year token; `requireTty` described as a guard | Architect | `status` shows the date and warns after 330 days; comments name the real guard (13b's denies) | T2e |
| 16 | The weakening sandbox keys weren't listed; the built-in skills' origin unknown | both | Listed; the skills are in the binary, unusable without the Skill tool | — |
| 17 | Nits: `--max-turns 4` undocumented; T13b's tautology; ssh key comments not masked; G19 had no single owner | both | Documented; checks the folder; masked; G19 is unit 14's | T13b, T5 |
| 18 | Found while fixing: a last output line without a newline hid G18's `#end` (two inconclusive runs) | me | The section reader accepts it | T7 |

## Noted for later units (in the spec and roadmap rows 13 and 18)

| Unit | Note | From |
|---|---|---|
| 13b | The launch form, token passing, init-event check, weakening keys, temp folders, git config, absolute paths, exact `Agent()` names; done when 13a's probes pass against the rendered bundle | both |
| 18 | The harness into `src/` behind a consenting human-only command, run against the rendered bundle; N≥3; an adversarial mode; a static diff of the sandbox profile and schema per binary; the data-protection keychain; Glob and Edit through links; interactive and project-settings sources | both |
| 19 | fd 3 for the token; a 401 means "renew"; the token's fingerprint in the run log only | Architect |
| 29 | `doctor` warns about the token's age | Architect |
| Docs | Where to revoke a setup token (check first); don't sync `~/.config`; the plain-language "why" you asked for | Architect, you |
