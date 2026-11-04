---
unit: "18f"
name: cage-key
status: draft (2026-11-04), waiting for SPEC APPROVED
roadmap: design/07-implementation-roadmap.md, row 18 (the red team's key, R3-M7); proposed after the walkthrough of 2026-11-04
depends_on: ["18a", "22"]
---

# Unit 18f: the red team's key covers the cage, not all of MIRAI

## Why

A red-team run takes about 18 minutes, and every agent launch needs a current green one. Today the result's key includes a hash of **every** file of MIRAI's framework copy. So any change to MIRAI, even a wording fix in `mirai build`'s output, makes the result stale. During the walkthrough you ran the red team four times in one evening, and two of those runs were caused only by MIRAI's own fixes.

The key exists so a result can't vouch for a cage it never tested. The cage is a part of MIRAI, not all of it. This unit keys the result on that part, and makes the split explicit so nobody moves a file across the line unnoticed.

## Scope

**In.**

1. **The `framework` key part hashes the cage files only.** Two lists, as data in `src/redteam/cage.js`, each a set of globs over the framework copy:
   - **The cage:**
     - `bin/hook.js`, `bin/mcp.js`, `bin/agent-worker.js` and `bin/launch.js`;
     - `src/launch/**` (strict templates, the hook, the launcher's pinning), `src/mcp/**` (what agents call), `src/tests/**` (the container executor `run_tests` uses) and `src/redteam/**` (the cases, the key, the gate);
     - in `src/agent/`: `run.js`, `process.js`, `scope.js`, `requests.js` and `worker.js` (the launch, the process group, the scope check, the broker's tokens);
     - `src/trust/**` (the trust root, protected paths) and `src/adapters/**` (the agent definition passed to `--agents`);
     - in `src/store/`: `git.js`, `git-pins.js`, `repo-check.js`, `repo-state.js`, `home.js`, `mirai-home.js` and `files.js` (pinned git, D-54's guard, the store's location and permissions);
     - `src/sign/**` (the token on fd 3, the results' signatures), `src/config/**` (what builds the templates) and `src/util/**` (globs and the like, used by both);
     - in `registry/`: `adapters/`, `protected-paths/` and `secrets/`.
   - **Not the cage:** everything else. The build's and plan's own checks, commits and checkpoints, the loop guard, the baseline, lint, detect, install, reports, status and the journal; the CLI's commands and wording; `registry/agents`, `registry/roles` and the rest of the registry; the docs.
2. **Every framework file is in exactly one list, checked by a test.** A file added later, in neither or in both, fails `npm test`. So each unit's change decides, in review, which side a new file is on. Nothing falls through by default.
3. **Everything else in the key stays as it is:** Claude Code's version and binary, the templates' bundles (already the canonical render of the strict settings, from the registry), Docker, git, macOS, node, your project's rule files, the host controls, and the test setup (`compose`).
4. **`mirai redteam status` names what changed,** as now, and says when a refresh changed MIRAI only outside the cage: "MIRAI changed, but not the cage: this result still holds".
5. **Docs:** `docs/red-team.md` (what the key covers, and why), the roadmap.

**Out:**
- Making runs faster.
- The sessions suite: it never gates a launch, and is unchanged.

## The trade-off (open point 2)

**The risk:** a change to a file on the "not the cage" side that does weaken the cage would no longer make the result stale.

**The guards:**
- the explicit lists, so moving a file is a reviewed diff;
- the test above, so a new file has to be placed;
- the reviewers, told every unit to check new files' side;
- the build's own checks after a run (protected paths, dependencies, scope). These were never what the red team tested, and they still run on every build.

**What stays fully covered:** anything that changes what an agent's process can do (the settings, the hook, the MCP server, the sandbox, the launch, the process kill) is on the cage side, and still makes the result stale.

## Probes

None with a model. Your next red-team run, after the sample app is refreshed with this unit, records a result under the new key (one run). After that, a refresh that touches only the workflow keeps it green. Unit 21c will be the first test of that.

## Files

- **New:** `src/redteam/cage.js`, tests in `test/redteam/`.
- **Changed:** `src/redteam/key.js` (`frameworkHash` over the cage), `src/redteam/run.js` (the status wording), `docs/red-team.md`, the roadmap.

## Tests (`npm test`, no model)

- **T1.** Every file of MIRAI's framework copy is in exactly one list. A new file in `src/` that's in neither fails.
- **T2.** Changing a non-cage file, such as `src/agent/build.js` or a CLI wording, leaves the key unchanged. Changing a cage file (`src/launch/strict.js`, `bin/hook.js`, `src/mcp/server.js`) changes it.
- **T3.** `redteam status` says "MIRAI changed, but not the cage" when only non-cage files changed since the result.

## Done when

- A refresh that changes only workflow code keeps the red team green.
- A change to any cage file makes it stale.
- Every framework file is placed on one side, checked by the tests.

## Open points for you

1. **Order: this before 21c.** My recommendation: yes. It's small, and it saves a red-team run on 21c and on most units after it.
2. **The trade-off above.** My recommendation: accept it, with the explicit lists and the test. The red team never tested the workflow code, so hashing it bought staleness, not safety.
3. **The split as listed.** My recommendation: as above, erring towards the cage: `src/config`, `src/util`, `src/sign`, and the store's git and file code are on the cage side, though only parts of them touch it. If you'd rather keep more on the cage side, say which.

## Changes after testing and review

1. **The cage is computed, not listed (High, found by both reviewers).** The hand-drawn split was wrong: cage files import workflow files. The hook parses its policy with `src/findings/schema.js`; the launcher and the trust root list and hash files with `src/install/lock.js`; the MCP server writes the journal through `src/store/journal.js`, and its lint tool checks paths with `src/lint/`. A change there would have changed the cage and kept the key.
   - **Now the cage is:**
     - its roots (the hook, the MCP server, the worker, the launcher, the launch, the tests, the trust root, the adapters, the launch's own checks, the red team and its command);
     - every file their code imports, directly or through others;
     - the registry data the templates and roles come from (roles added, per the Architect).
   - **Computed from the trust root's own files** at every key.
   - **One import edge is allowed out of it, with its reason:** the launcher to the CLI, run in-process only as itself.
   - **T1 checks the cage is closed under imports.**
   - **The OUTSIDE list and "unplaced" are gone:** a file is outside only while no cage code reaches it.
   - **The result:** 140 of 238 files in the cage. Outside: plan, build, commit, branch and checkpoint code, the baseline, detect, most of the CLI's commands, the loop guard's rounds and parks, findings, reports, Kai's prompt and most of the registry.
2. **The red-team command is a root** (Tech Lead): it holds the check that the running code is the trust root's copy.
3. **Docs that contradicted the change are fixed:** red-team.md's opening and key list, agent-safety.md, the key's comment, roadmap row 47. The docs say what the result vouches for (the cage plus the pinned machine, not all of MIRAI), and that the first status after 18f is stale once (framework).
4. **`package.json` is matched at the top only,** not at any depth (Tech Lead's glob finding).
6. **From the independent re-review of the rework:**
   - **The sessions suite keeps hashing all of MIRAI,** as the spec said. The rework had changed it too.
   - **It fails closed.** If a cage code file can't be read (files are read through the trust root's own hash check), uses an import the closure can't follow (a computed `import(`, a computed `new URL(…, import.meta.url)`, `createRequire`), or names a path that's nothing, the whole copy is hashed.
   - **What the scan follows and skips:**
     - `new URL('./…', import.meta.url)` counts as an import;
     - a folder found by path pulls in everything under it;
     - comments are skipped;
     - `.mjs` and `.cjs` files are scanned.
   - **Allowed edges:** MIRAI's package folder (`src/install/parts.js`'s `PACKAGE_ROOT`) is an allowed edge, with its reason. The launcher-to-CLI edge's reason now says what it really is.
   - **`registry/agents/*.toml` is cage data** (the role an agent may run under). Kai's prompt isn't.
   - **The docs are honest about the gate:** the key never guarded against MIRAI code that skips it, and the commands that start agents can pass the launch replacements for its checks. They also say the red team runs one CLI command.
5. **Not done (the Tech Lead's option):** refusing to record a run whose test-only options aren't at their defaults. The red-team command, which sets them, is in the cage now, so a change to it changes the key.
