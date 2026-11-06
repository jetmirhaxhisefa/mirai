---
unit: "18g"
date: 2026-11-06
claude_code: 2.1.319 installed (2.1.318 the last green)
result: 495/495 tests after the review and re-review fixes; R1 passed (one Haiku launch through MIRAI's copy of 2.1.319); your red-team run follows the refresh
---

# Unit 18g — Test results

## Tests (`npm test`, no model; stand-in `claude`)

- **T1 + T3** (`test/redteam/redteam.test.js`):
  - A green run keeps a read-only (0500) copy of the binary it tested under MIRAI's home, and records it, signed.
  - A red run on a newer binary leaves the record on the green one.
  - **`redTeamStatus` without a named `claude`:**
    - it judges the kept copy (green);
    - it names the version agents run;
    - with `installed`, it names the newer one on PATH, with S1 and S2 against it.
  - After green runs on two newer binaries, the record holds the newest and the one before, and the first copy is pruned.
- **T2** (`test/agent/run.test.js`):
  - A launch with a newer stand-in first on PATH still runs the kept copy, and the gate is asked about that same path.
  - A copy changed after it was kept refuses the launch (`tested-claude-changed`), with no fall back.
- **T4** (`test/redteam/redteam.test.js`): in both templates, MIRAI's `claude-code/` is in the sandbox's write-deny list and has an Edit rule, and the floor check names it when it's missing.

- **From the reviews** (`test/redteam/redteam.test.js`, `test/agent/run.test.js`):
  - **Staging:** a staged copy is the binary's bytes under its hash; a different file under that name is replaced.
  - **Refusals:** an npm `cli.js` is refused (`claude-not-native`), and a record that doesn't verify refuses (`tested-claude-invalid`).
  - **`--kept`** tests the kept copy, with a newer one first on PATH.
  - **A keep that fails** after a green run comes back as `kept.ok: false`.
  - **Pruning** spares a young copy, and removes it once it's old.
  - **The broker's fallback `claude`** still runs the kept copy.
- **From the re-review:**
  - a script stand-in is refused without `allowScript`, and a Mach-O header passes;
  - `mirai redteam status` prints the version agents run and the newer one installed;
  - a broken record shows as "none for the Claude Code agents run" (exit 2).

## R1: a copied Claude Code runs (one Haiku launch, sample-app clone, gate stubbed)

- **The copy:** MIRAI copied your Claude Code 2.1.319 into the probe home's `claude-code/af6f1f5510ae…/claude`, the way a red-team run stages it. `--version`, with the auto-updater off, answered `2.1.319 (Claude Code)`.
- **The launch:** a launch that named no `claude` ran through the copy. Its outcome was `ok`, it passed MIRAI's init check, the model was `claude-haiku-5-5`, and it replied "OK".
- **The gate** was asked about the copy's own path.
- **So:** a native Claude Code runs from outside its install folder, under MIRAI's flags.

**Not proven by R1:** Bash, the hook and MIRAI's MCP server through the copy. Your red-team run tests all of them on the copy, since every case now runs against it.

## Still to run

1. **Your red-team run** after the refresh. This is cage code, so it's needed once. MIRAI keeps 2.1.319's binary when the run is green.
