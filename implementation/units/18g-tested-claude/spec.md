---
unit: "18g"
name: tested-claude
status: approved (2026-11-06)
roadmap: design/07-implementation-roadmap.md, row 18 (the red team's key, R3-M7); proposed during 21d's checkpoint, when Claude Code updated twice in a day (2.1.316 → 2.1.318 → 2.1.319)
depends_on: ["18f", "21d part 1"]
---

# Unit 18g: agents run the Claude Code the red team tested

## Why

A red-team result vouches for one exact Claude Code binary (its version and hash are a key part). Every agent launch uses whatever `claude` is first on your PATH. That's a link Claude Code's updater moves to the newest version, often several times a day. So every update makes the result stale, and no agent may start until you run the red team again (about 25 minutes).

The check is right: an update can change what's allowed. 2.1.318 and 2.1.319 brought two new permission keys and a new built-in plugin. But it shouldn't block your work every time Claude Code updates, and you want updates on.

**The fix:** MIRAI launches agents with the binary its last green result tested. Your own Claude Code keeps updating. MIRAI moves to a newer version only when a red-team run on it is green.

## Scope

**In.**

1. **The tested binary, kept by MIRAI.**
   - **Where:** when a red-team run is recorded green, MIRAI copies the binary it tested into its own home, `~/Library/Application Support/mirai/claude-code/<sha256>/claude`. The folder is private (0700) and the file read-only (0500).
   - **What's recorded:** the repo's store records which binary that is, as version, hash and path, in `redteam/tested-claude.json`, signed like the result.
   - **What's kept:** the binary of each repo's current green result, and the one before it. Older copies are removed.
2. **Every agent launch uses that binary,** never the PATH link.
   - **What it covers:** `mirai agent run`, `plan`, `build`, `fix`, and the broker's `start_agent`.
   - **The gate checks the same binary it launches.** The red-team status is worked out for the kept binary's version and hash.
   - **Before each launch:** the copy's hash is checked against the record. A changed or missing copy refuses the launch, with "run the red team".
   - **A test or a probe that names its own `claude`** still uses that one (as today).
3. **`mirai redteam run` tests the newest installed Claude Code,** as today. A green result is how MIRAI moves to it. A red or incomplete run on the new version changes nothing: launches stay on the version that was green, and its result still holds.
4. **`mirai redteam status` says both:**
   - what agents launch with: "Claude Code 2.1.318, green";
   - what's installed: "2.1.319 is installed: MIRAI stays on 2.1.318 until a red-team run on 2.1.319 is green".

   The S1 and S2 checks, which need no model, run against the newer binary in `status` too. So you see early whether moving will need a MIRAI update, as 2.1.318's new key did. S3 needs a real run.
5. **The cage keeps it out of the agent's reach.** `claude-code/` under MIRAI's home is denied by name, in the sandbox's write list and as an Edit rule, like the store. The hash check at each launch catches any change anyway.
6. **2.1.319's new permission key,** `denyInsteadOfPrompting`, is listed in the adapter data (prepared during 21d; it only ever denies). So the day you run the red team on 2.1.319, S1 is ok.
7. **Docs:**
   - `docs/red-team.md` (when a run is needed now, and what status says);
   - `docs/agent-safety.md` (which Claude Code agents run);
   - the roadmap.

**Out:**
- **A release channel or a fixed version list.** MIRAI follows what you have installed, after testing it.
- **Your own Claude Code sessions.** They use your newest version; the sessions suite is unchanged.

## The trade-offs (open points 2 and 4)

- **Security fixes in a new Claude Code reach MIRAI's agents only when you run the red team on it.** Today that's forced on you with every update. With 18g you choose when. `status` tells you a newer version is waiting.
- **A very old version may one day stop working with Anthropic's servers.** MIRAI can't know when. A launch that fails that way is an environment fault: the round is given back, and the message suggests running the red team to move to the installed version.

## Probes (with your OK)

- **R1. A copied binary works** (one Haiku launch, on a sample-app clone, the gate stubbed):
  - MIRAI's copy answers `--version`;
  - a real launch through it passes MIRAI's init check;
  - its init event names the copy's version.

  **What we learn:** Claude Code runs from outside its install folder, under MIRAI's flags, with the auto-updater off.
- **R2. In your sample app, after your refresh:**
  1. you run the red team once;
  2. MIRAI keeps the binary;
  3. `status` shows what agents launch with.

  Then the SAMPLE-2 build runs, even if Claude Code has updated in between.

## Files

- **New:** `src/redteam/tested.js` (keep, record, find, check and prune the tested binary), tests in `test/redteam/`, `test/probes/tested-claude-probe.js` (R1).
- **Changed:**
  - `src/redteam/run.js` (keep the binary after a green run; status for the kept binary, and a note on the installed one);
  - `src/redteam/key.js` (`resolveClaude` takes the kept binary);
  - `src/agent/run.js` (the launch and the gate use the kept binary);
  - `src/cli/commands/redteam.js` (status's two lines);
  - `src/launch/strict.js` (the deny);
  - `registry/adapters/claude-code.toml` (the 2.1.319 key);
  - docs.
- **All of these are cage code,** so this unit makes the red team stale once. Your refresh needs one run. After that, an update to Claude Code no longer blocks launches.

## Tests (`npm test`, no model; a stand-in `claude`)

- **T1.** A green run keeps a read-only copy of the tested binary under MIRAI's home and records it, signed. A red or incomplete run doesn't. Only two copies per repo are kept.
- **T2.**
  - A launch uses the kept copy, not the PATH link: after a stand-in "update" on PATH, the launch still runs the old copy, and the gate is green.
  - A tampered or missing copy refuses the launch.
- **T3.**
  - `status` names the version agents launch with, and a newer installed one, with its S1 and S2 results.
  - With no kept binary yet (before the first green run after 18g), it says to run the red team.
- **T4.** The kept folder is denied by name in both templates. Its denial counts in the floor check.

## Done when

- After one green red-team run, a Claude Code update no longer blocks any agent launch.
- Launches run the exact binary that run tested.
- `status` says when a newer Claude Code is waiting.

## Open points for you

1. **MIRAI keeps its own copy (about 200 MB each, at most two per repo),** rather than pointing at the updater's `~/.local/share/claude/versions/` folder. The updater removes old versions on its own schedule, and could pull a tested version away mid-run. My recommendation: copy.
2. **A green run moves MIRAI to the new version automatically.** The other choice is a separate `mirai redteam adopt` step. My recommendation: automatic. A green run on a version is the evidence, and one command is enough.
3. **One exception: a blocker seen on the new version.** Should MIRAI also stop launching the old green version? My recommendation: no. A blocker on 2.1.319 is about 2.1.319, so launches stay on the tested 2.1.318. The blocker shows in `status`, and is kept with 2.1.319's results.
4. **No age limit on the kept version.** My recommendation: none. `status` shows how far behind it is, and a launch the servers refuse says so.

## Changes after testing and review

1. **The red team tests the copy, not the install (Architect H1, Tech Lead M1).**
   - **What changed:** a run first copies the newest installed Claude Code into MIRAI's home, hashed as copied, and every case runs against that copy. Agents then run the exact bytes, at the exact path, that were tested.
   - **The hash:** an existing copy under that hash that differs is replaced, so a bad copy can't block launches for good.
   - **Why:** the first build copied the binary after the run. The updater could have changed it in those 25 minutes, and the copy was never hashed.
   - **After a run that isn't green,** its copy is removed.
   - **Pruning** spares copies younger than 15 minutes, since another project's run may be about to name one.
2. **The broker's `start_agent` runs the kept copy too (Tech Lead H1).**
   - **The bug:** the worker passed the `claude` your session server found at registration, which a launch took as a test's override.
   - **Now:** it's only a fallback, for while no tested binary is kept.
3. **`mirai redteam run --kept` (Tech Lead M3, Architect M2).** It tests the copy agents run now, so a macOS, Docker, git, Node, project or MIRAI change can be re-tested without also moving to the newest Claude Code.
4. **A keep that fails after a green run is reported, not thrown (Tech Lead M2).** The command says "green, but MIRAI couldn't keep the binary", and agents stay on the one they ran.
5. **The server-refusal message isn't built (Architect M3).** The spec claimed a launch the servers refuse "says so". Claude Code's own error comes through as an environment fault. `red-team.md` names the risk instead.
6. **An npm install is refused (Architect M4).** A copy of `cli.js` alone wouldn't run, so MIRAI keeps only the native Claude Code.
7. **Records and status:**
   - **A record that doesn't verify refuses,** never read as "no record" (Architect L1).
   - **A gone, changed or unverified copy is a state in `status`,** not a crash (Tech Lead L1).
   - **The "installed" line says when the installed version is older** (Tech Lead L6).
8. **Smaller fixes:**
   - the floor check needs the Edit rule as well as the sandbox deny (Architect L7);
   - the binary hash cache keeps a few binaries, so `status` doesn't make the next launch hash the kept copy again (both reviews' L);
   - `--version` runs with the auto-updater off (Architect L8);
   - research/10 has a 2.1.319 entry (Architect L6);
   - `red-team.md` says S3 and the cases need a real run (Architect L5, Tech Lead L2);
   - the 20-result rotation is written down (Tech Lead L7);
   - a known limit is named in `agent-safety.md`: your own sessions could swap the copy between the hash check and the launch (Architect L2).
9. **The spec's files list:** `resolveClaude` didn't change. The logic is in `src/redteam/run.js`, `src/redteam/tested.js` and `src/agent/run.js` (Tech Lead L9).
10. **From the independent re-review of the rework:**
    - **R1's probe called the old API (High).** It would have failed before any launch. It now stages the copy as a run does, and its `--version` runs with the auto-updater off.
    - **The nested-`claude` case aims at both** (Medium): `a-claude` now also tries the copy agents run, beside the installed one.
    - **Native only, by an allow list (Medium).** The check is the first 4 bytes, which must be a Mach-O header. A version manager's shim (a script that runs whatever is newest) is refused, as is a JavaScript install. MIRAI's own tests opt in to their script stand-ins (`allowScript`), which the CLI never sets.
    - **The docs say a red run changes nothing only on a newer version** (Medium). A run that isn't green on the version agents already run replaces its result.
    - **Small ones:**
      - a prune that fails after the record moved isn't reported as a failed keep;
      - before any copy is kept, the gate judges the file the launch runs, not the link;
      - `--kept` doesn't need a `claude` on PATH;
      - an unreadable record or a copy that vanishes mid-check is a state in `status`, not a crash;
      - the young window's reason is corrected (runs are one at a time under the red team's lock);
      - a test covers `status`'s new lines and its broken-record state;
      - the red team's guard takes a case's reviewed exact path out before it scans for paths, so the kept copy's path, which has a space in it ("Application Support"), isn't split. `a-claude` names it as reviewed.
