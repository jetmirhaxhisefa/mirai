---
unit: "19a"
name: agent-run
status: approved (2026-11-01)
roadmap: design/07-implementation-roadmap.md, Milestone A, unit 19 (split here into 19a, 19b, 19c); D-12, D-53, D-54, D-57, D-58; R3-M7, R3-M8, TL3-9; notes from 13b, 15a, 18a, 18b, 18c, 18d
depends_on: ["13b", "13c", "14d", "15a", "18a", "18d", "05b"]
---

# Unit 19a: `mirai agent run`, the first real launch

## Why

Everything so far builds or tests the cage. No agent has been started through it for real, except by the red team's own runner. This is where `prepareLaunch` meets a real run: an unattended Claude Code process, working in your repo, as you, using your subscription. So this unit is about one thing: a launch that starts only when it's safe, stops cleanly, and leaves a true record.

## The split (open point 1)

Row 19 is too big for one unit. I propose:

| Unit | What |
|---|---|
| **19a (this)** | The launch itself: the checks before it, the process, the end, the log, the verdict file rule |
| **19b** | What a run is allowed to have done and who it is: write scope per role, depth guard, tier selection, verifier ladder, judgement-step model |
| **19c** | The broker: `start_agent`, `agent_status`, `session_start`/`session_end`, `mirai session start/end`, G24, a skill launching an agent |

## Scope

**In.**

1. **`mirai agent run <agent> --mode read-write|read-only [--item <id>] [--input <file>…] --prompt-file <file> [--max-turns n]`.** In your terminal only for now (19c adds the broker). Models come from the project's config, as unit 11 has it. A `mirai agent run` from an agent's Bash already fails, and a case here says so.

2. **The checks before a launch, each refusing with its own code:**
   - **The red team (R3-M7):** `redTeamStatus({ trust, template })` with the launch's own snapshot must be `green` for that template. Stale, red, incomplete or none is refused, and so is a `blocker_seen` on this Claude Code and macOS, unless you've recorded your V1 decision (open point 3). The version of Docker must match the result's.
   - **The binary:** launch the hashed binary (`real`), never the `~/.local/bin` link, with `DISABLE_AUTOUPDATER=1`, so a night's update can't change it under a run.
   - **One run at a time** across projects (05b's global lock), and the global usage check (D-57).
   - **The trust root and `input/settings.json`** hashed again right before the start; `prepareLaunch` already hashes the repo state (D-54).

3. **The process.**
   - The token on a pipe at fd 3, closed after writing, never in the environment or a file. R2 finds out whether Bash can read `/dev/fd/3` (13b's note). A 401 says "renew the token".
   - `--permission-mode dontAsk`, `--max-turns`, `stream-json`; `--agents` from the trust root only, its tools equal to the template's.
   - `checkInit` on the first event, with the green result's version: any difference kills the run. 18d saw the init event miss an extra folder under heavy load, and this fails closed; it's logged with the machine's load.
   - **Its own process group, killed at the end of every run** (R3-M8, G21), and on your Ctrl-C. A `setsid` or double-forked process is looked for afterwards and killed, and any survivor is reported. `adv-linger`, informational since 18b, then counts in the red team.
   - **A timeout,** ending the same way.

4. **The end.**
   - `finishLaunch` (D-54: `.git` unchanged), then `removeLaunch`. Hooks stay off for any commit (the commit itself is unit 22).
   - **Exit codes:** ok, agent-failed, refused, env-fault, killed.
   - **A verdict written as a file is ignored:** results come from structured output only (R2-C1). The schemas are 09a's.

5. **The hook's cost (from 18b).** It re-hashes the trust root on every file tool call, about 2.4 s, and 20 at once under load passed its 30 s timeout. So: hash once per launch. **First a probe:** what Claude Code does with a hook past its timeout under `dontAsk`. If that fails open, it's a blocker for this unit.

6. **Long outputs (from 18d; a done-when).** An agent must recover all of a 60,000-line Bash output and an oversized MCP reply. First, tell agents to redirect large output to scratch and page it. Only if that isn't enough, a hook exception for this launch's own `tool-results/` files, real path checked.

7. **One run-log line** (05b's `agent_run`): tier and rung as given (19b fills them properly), model, turns, tokens, minutes, cost estimate, `limit_share`, bundle and trust hashes, token fingerprint, exit. The usage ledger gets its delta.

8. **Real Docker through the real server (from 18c):** one `run_tests` from a real launch, with D-54's checks around it. Added as a red-team case. `redteam run` also refuses unless it runs the trust root's own copy.

9. **Docs:** `docs/agent-safety.md` (a launch, step by step; why it refuses); roadmap rows; research/10.

**Out:**
- **19b:** write scope, depth guard, tier, ladder, judgement-step model.
- **19c:** the broker verbs and sessions.
- **Row 29b:** your key and token at rest. A launch's green result rests on the signing key, and 18e showed your own session could forge it. That's stated in the docs, not fixed here.
- **Units 20–22:** the loop guard, Kai, commits. 19a's agent changes the clone or work tree but commits nothing.

## Where a launch runs (open point 2)

Until unit 21 brings worktrees and commits, this unit runs agents in the checkout you name, and `mirai agent run` refuses a dirty tree, so anything an agent changed shows as a plain `git diff` for you. Nothing is pushed: no network in the bundle.

## Probes (before building; with your OK before each batch)

- **R1. A hook past its timeout** under `dontAsk`, for a Read and a Write. About 4 Haiku runs. Read Haiku's outcome and the file on disk.
- **R2. fd 3 from Bash,** and the token's absence from the environment. 2 runs.
- **R3. Long outputs:** 60,000 lines from Bash, and an oversized reply from MIRAI's server, with redirect-and-page instructions. About 4 runs.
- **R4. Leftovers:** a `setsid` and a double-forked process, and how to find them afterwards on macOS without a new dependency. About 3 runs.
- **R5. `DISABLE_AUTOUPDATER`** and the hashed binary, with `checkInit` passing. 1 run.
- **R6. End to end on the sample app:** a read-only agent, then a read-write one. About 4 runs.
- **R7. The full red team,** since the hook and bundle change: about 20 minutes, 290 runs. Twice at most: once for done-when, and once if the review changes anything that matters.

## Files

- **New:** `src/agent/run.js` (the launch), `src/agent/process.js` (the group, leftovers), `src/cli/commands/agent.js`, `test/agent/run.test.js`, `test/probes/agent-probes.js`.
- **Changed:** `src/launch/hook.js` and `src/launch/strict.js` (hash once), `src/redteam/cases-agent.js`, `src/redteam/cases-container.js`, `src/cli/commands/redteam.js`, `docs/agent-safety.md`, `docs/red-team.md`, research/10, the roadmap.

## Tests (`npm test`, no model; a stand-in `claude`)

- **T1.** Each state of the red team, and a template it didn't cover, refuses the launch with its own code. A `blocker_seen` refuses without your recorded decision.
- **T2.** A wrong init event kills the run, and nothing is logged as ok.
- **T3.** The stand-in leaves a background process and writes a verdict file: the process is gone, and the file is ignored.
- **T4.** Ctrl-C and a timeout both end in the same cleanup: the group killed, the launch folder removed, the lock released.
- **T5.** The token is never in the environment, the plan's JSON, the log or any error.
- **T6.** A changed `.git` during the run fails it, and a changed trust root before the start refuses it.
- **T7.** The run-log line has every field, and the ledger counts it once.
- **T8.** A dirty tree refuses, and a run from outside a terminal refuses.
- **T9.** The hook hashes once per launch and still refuses a trust root changed after that (its check moves, it doesn't vanish).

## Done when

- A launch with a stale or red result is refused.
- One read-only and one read-write agent run on the sample app, each with a true log line, and nothing left running.
- A seeded background process is gone after the run.
- A verdict written as a file is ignored.
- An agent recovers a 60,000-line output and an oversized MCP reply.
- The full red team on the final code is green, or each shortfall is raised with you.

## Open points for you

1. **The split into 19a, 19b and 19c.** My recommendation: yes. Each is a real unit's worth of risk, and the launch comes first.
2. **Where it runs.** My recommendation: your checkout, refusing a dirty tree, until unit 21. A throwaway worktree now would mean building unit 21's part twice.
3. **A blocker that was seen once (open since 18a; V1).** May a later green clear it? My recommendation: no. A launch refuses until you record a decision in your terminal, signed, naming that result. It's rare, and it shouldn't clear itself quietly.
4. **Row 29b's order.** A green result is only as trustworthy as your key, so a real unattended run before 29b rests on "no session of mine forged it". My recommendation: build 19a now, since you're there watching each launch, and keep 29b before the pilot, not before this unit.
5. **The cost:** about 18 Haiku runs for R1–R6, then the full red team once or twice. I'll ask before each batch.

## Changes after testing and review

1. **Your decision on R1:** a hook past its timeout lets a Read through. The spec called fail-open a blocker; you decided it isn't, since it needs someone else to make a hard link mid-run. Hash-once, a recorded case, and a known limit in the docs.
2. **No `<agent>` argument:** the registry has no agents until unit 21, so `agentsJson` goes there too. `--mode`, `--prompt-file`.
3. **Global usage check:** to unit 20, which owns it; nothing to check against yet. `limit_share_source` is `unknown`, so no ledger delta.
4. **Oversized MCP reply:** the server caps replies at a 32 KiB tail (14d), so an oversized one doesn't arise; R6's real `run_tests` is the check that a reply arrives. The cap itself isn't exercised.
5. **Hash once = a fingerprint:** names, modes, sizes, inodes and times of every trust-root file, taken at the launch after a full verify. No state needed, and a write changes the ctime.
6. **Leftovers:** R4 showed a group kill isn't enough; tree polling, killing a new orphan only in the launch's scratch, naming one in your checkout (the run isn't ok), others listed. R6's second run showed a plain `nohup … &` often detaches before a poll sees it, so a seeded process is named, not killed. Its environment can't be read on macOS. Stated, with rows 21 and 22 told.
7. **Leftovers in the red team:** `adv-linger` stays informational, since its marker is outside the sandbox and can't show survival. Scripted `l-*` cases replace it. The red team's kill rule is broader than a launch's: it may kill an orphan in its own clone.
8. **R6 stubs the gate** for its real launches, since a clone has no result; the refusal is shown separately.
9. **From the review:** a run is ok only with a checked start and a real success; a blocker has a permanent signed record and your decision is tied to it; survivors, suspects and a failed `ps` aren't ok; a non-ok run ends `stopped`; a crashed run is taken over; the prompt follows `--`; the model is checked; `--input` is dropped until unit 21 has something to pass; run-log schema 2 with `outcome`, `survivors`, `unproven`.
10. **Your decision on R1 re-checked:** the review showed it rested on part of the read side. R1c tried the rest, from an agent alone, and all were refused. The decision stands.
11. **The oversized MCP reply, as a limit:** a 32 KiB tail can't be paged, so an earlier first failure is lost. Unit 24 owns the full evidence. Done-when now: a 60,000-line Bash output recovered; a run_tests reply arrives.
12. **Done-when:** your first real launch on the sample app, after your own `mirai redteam run`, is the first real gate and launch together.
13. **From the second review (of the fixes):** a group counts only while a known process lives in it; a takeover happens under the lock, before the checks; the two-minute deadline starts at the launch, not the first line; a second Ctrl-C ends the cleanup wait; a blocker's record holds its whole result, an old blocker result counts, and a corrupt record refuses.
14. **Your decision on a seeded process (option A):** the done-when "a seeded background process is gone" becomes: killed if MIRAI can tie it to the run; otherwise named, and the run isn't ok. One that leaves the project first may be listed only; units 21 and 22 own the rest.
15. **`run_tests` through the real server isn't a red-team case:** a worker's store isn't laid out as a real launch's (`no-store`). It's in R6, on a real layout, once. The spec's item 8 and row 19's note are met by a probe, not per version.
