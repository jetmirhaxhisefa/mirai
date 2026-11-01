---
unit: "18d"
name: permission-settings
status: approved (2026-11-01)
roadmap: new, before unit 19 (18b's review, Architect M4; 18c's research/10 note); design/07 row 19 "From 18b"; D-30; research/10
depends_on: ["18c", "13b", "13c"]
---

# Unit 18d: Claude Code's permission settings

## Why

Claude Code now has five permission settings that bear on what MIRAI promises. MIRAI sets none of them.

| Setting | What the binary says (2.1.316) |
|---|---|
| `blockWritesOutsideWorkingDirectories` | Refuses Write, Edit and NotebookEdit outside the working directories in every mode. No allow rule lifts it. Also refuses file-tool writes to Claude Code's settings files, even inside them, and removes EnterWorktree and ExitWorktree. Doesn't limit shell commands, MCP tools or hooks. Claude Code's own plan files, scratchpad, background job folder and auto-memory are exempt |
| `blockReadsOutsideWorkingDirectories` | Refuses Read, Grep, Glob and LSP outside the working directories in every mode. No allow rule lifts it |
| `blockReadsExemptPaths` | Exceptions to the read block. Taken only from `--settings`, and "allows nothing" by itself |
| `disableBypassPermissionsMode` | "Disable the ability to bypass permission prompts" |
| `disableAutoMode` | "Disable auto mode" |

**Why it matters before unit 19:**
- **The file tools run outside the macOS sandbox,** so today only permission rules, `--restricted` and MIRAI's hook stand between them and your files. A setting enforced inside Claude Code could be a layer that doesn't depend on the hook.
- **18c's `w-race-dir` showed the hook's check is what stops a swapped folder link.** That window isn't closed. A second check might narrow it.
- **The settings file refusal** would cover a path MIRAI's hook also covers, by a different route.

**What isn't known yet:**
- `--restricted` already confines the file tools (15a). These settings may add nothing on top of it.
- A block could break normal work. Claude Code keeps large tool results outside the project, and an agent may need to read them back.

So this unit probes first, and each setting goes in only if it adds a layer and breaks nothing.

**Changing the bundle changes its hash.** Every red-team result goes stale, and a full run is needed.

## Scope

**In.**
1. **Headless launches, per template (`src/launch/strict.js`).** Set whichever of these the probes support:
   - `blockWritesOutsideWorkingDirectories: true`;
   - `blockReadsOutsideWorkingDirectories: true`;
   - `disableBypassPermissionsMode` and `disableAutoMode`, if R3 shows they do anything under `dontAsk`.

   `blockReadsExemptPaths` stays unset, whatever else happens: an exception list has no use if nothing needs one. If R2 finds something that does, it comes back to you first.
2. **Each setting checked every run.**
   - **S4 (the floor):** the settings chosen must be in every template's rendered settings.
   - **S1:** a key already listed stays listed; nothing changes there.
   - **The red team:** a direct or model case for each setting chosen, with the hook out of the way, so the setting is what refuses. Real launches keep the hook.
3. **Your own sessions (`.claude/settings.json`, merged by `mirai render`).** Only what you choose in open point 3, after R4.
4. **Docs and data.**
   - `docs/agent-safety.md`: which layer refuses what, and any setting left out, with why.
   - research/10: what the probes found.
   - The roadmap: this row, 18e (your sessions, renamed from 18d; open point 1), and row 19.
   - `blockReadsExemptPaths`: recorded as deliberately unset.

**Out:**
- **Shell commands:** none of these settings limit them. The sandbox still does.
- **Unit 18e:** the red-team cases for your sessions. R4 gives it facts but doesn't replace it.
- **Unit 19:** hashing the trust root once per launch, a hook past its timeout, killing leftover processes.

## Probes (before building; Haiku, with your OK)

All of these use canaries, in fixtures, with a temporary `CLAUDE_CONFIG_DIR` for anything touching interactive settings. Your real Claude Code config is never read or written.

- **R1. What each block adds.** Through the real launch, with MIRAI's hook removed from the settings for this probe only, Write, Edit, Read, Grep and Glob on an outside canary in four setups: neither block, each alone, both. If `--restricted` already refuses everything, the block adds only a second check. Includes a link to a folder and a `/.vol` path. About 40 runs.
- **R2. What a block could break.** With both on:
  - reading files in the launch's `input/files/` (`--add-dir`);
  - a tool result large enough for Claude Code to store outside the project, then read back, from Bash and from MIRAI's MCP server;
  - writing and reading in the scratch and temp folders;
  - `run_tests`' reply;
  - the init event still passing `checkInit`.

  About 10 runs.
- **R3. The two mode settings.** Does `--permission-mode bypassPermissions` or `auto` get refused with each set in `--settings`? Does a `dontAsk` launch notice them at all? No more than 6 runs.
- **R4. Your sessions (no MIRAI bundle).** From a project `.claude/settings.json` in a fixture: do MIRAI's deny rules hold under `acceptEdits`, `auto` and `bypassPermissions`? Does a project file's `disableBypassPermissionsMode` work at all, or only from managed settings? Would the blocks stop reading outside the project in ordinary use? About 15 runs.
- **R5. The full red team,** on the changed bundle, with your OK: once for "done when" and once after the review. About 22 minutes each, about 270 Haiku and up to 25 Sonnet runs.

## Files

- **Changed:**
  - `src/launch/strict.js`: the settings, and the bundle's schema version if needed;
  - `src/redteam/static.js` (S4) and `src/redteam/cases-agent.js`;
  - `src/adapters/` and `registry/adapters/claude-code.toml`, if open point 3 adds anything for your sessions;
  - `docs/agent-safety.md`, `docs/red-team.md`, research/10, the roadmap;
  - renaming 18d to 18e in the tests and docs that name it.
- **New:** `test/probes/permission-settings-probe.js`, kept in `test/`, since it removes the hook and never belongs in a real run.

## Tests (`npm test`, no model)

- **T1.** Each chosen setting is in every strict template's rendered settings, and a project's config can't remove it.
- **T2.** S4 goes red when one is missing.
- **T3.** The bundle's canonical hash changes with each setting, so old results go stale.
- **T4.** `blockReadsExemptPaths` never appears in a rendered template.
- **T5.** The new red-team cases, on fixture runs: they need the setting to be what refused, and are inconclusive otherwise.
- **T6.** If open point 3 adds any: the merge into `.claude/settings.json` keeps your own settings, and `mirai render` puts MIRAI's back.

## Done when

- Each of the five settings is set or deliberately left out, with its reason and probe in research/10.
- Nothing an agent needs is broken (R2).
- The full red team on the changed bundle comes back green, or each shortfall is raised with you.

## Open points for you

1. **The name.** This becomes 18d, and your sessions' unit becomes 18e, so the numbers run in build order. My recommendation: yes. It's a small rename now.
2. **Headless launches: a setting that only duplicates another layer.** If R1 shows `--restricted` already refuses everything, I'd still set the two blocks, as long as R2 shows nothing breaks. Layers from different code fail differently, and a Claude Code update could change `--restricted` without warning. The cost is some bundle size and one more thing to re-check. If you'd rather keep the bundle minimal, say so.
3. **Your own sessions.** This is your call, after R4 shows the facts.
   - **`blockReads` and `blockWrites`:** my recommendation is no. You're there approving, and you read files outside the project all the time.
   - **`disableBypassPermissionsMode` and `disableAutoMode`:** these are committed, so they'd bind everyone on the project. If R4 shows MIRAI's denies hold under those modes, I'd leave them off, since they cost you a choice and add nothing. If the denies don't hold, I'd bring you the facts and recommend them.
4. **The cost:** about 70 Haiku runs for R1–R4, then the two full runs. I'll ask before each batch.

## Changes after testing and review

1. **R1b added:** the blocks tested with `--restricted` removed too, since under it they never get the first word.
2. **No red-team case with "the setting as what refuses":** `--restricted` always answers first in a real launch. R1b is that evidence, in the probe. The floor (S4) keeps the settings on; S1 sees a change in them.
3. **The chosen settings (your option A):** only `blockWritesOutsideWorkingDirectories`, in every strict template. `blockReadsOutsideWorkingDirectories` was tried and left out, since it denies Bash commands naming an outside path, so the sandbox can't be tested and agents' commands could break. It and `blockReadsExemptPaths` turn the floor red if set. The mode settings are left out. Your sessions unchanged (open point 3's recommendation, since R4 held).
4. **T5 and T6 dropped:** no such cases, nothing added to your sessions.
5. **From the review:** new `l-restricted-*` cases (hook out, `--restricted` kept); a pass with Bash denied before it ran is noted and listed; T3 replaced by a note, since the hash covers the render by construction. One full run on the final code, not two: see review.md.
