---
unit: "29c"
name: doctor
status: approved (2026-11-14; Jet: "approve 29c, P1 and P2 OK"; interview decisions 1–3, the defaults as written)
roadmap: design/07-implementation-roadmap.md, row 29 (minimal `mirai doctor`) and row 47 (the full doctor, which extends it); design/03's `mirai-doctor` row; design/01 §9 (what doctor reports) and the merge-gate line (R-M21); D-57 (the plan and the week's share); the 05a/05b specs (repairs deferred to 29)
depends_on: ["29a", "28", "18"]
---

# Unit 29c: a minimal `mirai doctor`

## Why

About 25 of MIRAI's errors end with "run: mirai doctor", and there's no `doctor`. The roadmap's exit check for row 29: "`mirai doctor` is green on the sample app and names each red item with a fix hint". Moving to the new laptop (2026-11-14) showed what nothing checks today: `status` said "hook: ok" while the hook's Node was gone and every push failed; `ship` would have refused for `gh` and `glab` paths from the old Mac; agents ran an Intel binary through Rosetta, and nobody was told.

Already built (the research, 2026-11-14): `redTeamStatus` (`src/redteam/run.js`, safe with Docker down), `snapshot`/`verifyTrustRoot` (`src/trust/`), `checkLock` (`src/install/lock.js`, promised to 29), `readToken`/`tokenSetAt` (`src/sign/token.js`), `readCommittedKeys` (its `problems` "for doctor", `src/sign/keys.js`), `hooksState` (`src/hooks/install.js`), `usageSince`/`latestWeekly`/`usageCaps` (`src/store/global.js`, `src/loop/ledger.js`), the session server's status (`src/cli/commands/session-server.js`), `readBaseline` (`src/baseline/store.js`), `readRegistry` (`src/store/branches.js`), the run state and its log (`src/store/run.js`, `runStateMatchesLog`), and the store's readers, which already throw with a code (`missing`, `corrupt-line`, `order`, `counter-behind`, `bad-lock`, `stale-breaker`, …).

## Decisions (Jet, 2026-11-14, in the interview)

1. **Doctor checks; `--fix` repairs only what's safe.**
   - `mirai doctor` only reads. Each item is green, yellow (works, but worth knowing) or red (something will fail), with a fix hint for every yellow and red.
   - `mirai doctor --fix` repairs three kinds, each derived from what MIRAI trusts, and says what it did:
     - **a dead process's leftovers:** a lock or a lock breaker whose process is gone (by its pid and start time, as the locks check today);
     - **the run state**, rebuilt from the run log (`runStateMatchesLog`);
     - **the branch registry**, rebuilt from the signed branch records (`.mirai/records/<ticket>/branch.json` on each MIRAI branch, verified with the integration branch's keys).
   - **Damaged history is never rewritten:** a broken or out-of-order journal or run-log line, a counter behind, a bad signature. Doctor names the file and line, and what you can do. That's your signed history; a rewrite would hide what happened.
2. **What it checks: the roadmap's eight, and six found this week.**

   | Item | Red when | Yellow when |
   |---|---|---|
   | **Login** (auth method, the token) | no token, or Claude Code would use an API key | the token is over 300 days old (it lasts a year) |
   | **Strict bundle** | the trust root's strict templates don't match their hashes | — |
   | **Red team** | none, stale or red for the Claude Code agents run | a newer Claude Code installed, not tested yet |
   | **Trust root** | the integration branch's MIRAI files don't match `mirai.lock` | — |
   | **Registry** | the branch registry can't be read or disagrees with the branch records (`--fix`) | — |
   | **Merge gate** | — | always "local-only" until CI (unit 54): your merge is the gate |
   | **Plan and week** (D-57) | the week's MIRAI share is past `usage.week_max` | no usage reading in `usage.stale_hours`, or the plan changed |
   | **Store** | a store file can't be read (each with its code), a dead lock (`--fix`), the run state off its log (`--fix`) | — |
   | **Hook's Node** (new) | the pre-push hook or `hooks.json` runs a Node that doesn't exist | — |
   | **Host CLIs** (new) | `host-tools.json` names a `gh` or `glab` that doesn't exist | — |
   | **Agents' binary CPU** (new) | — | the kept Claude Code is for another CPU (runs through Rosetta) |
   | **Your key** (new) | no key, or yours isn't on the integration branch, or signatures don't verify | — |
   | **Session server** (new) | — | not registered, or behind the trust root |
   | **Baseline** (new) | — | none for the integration branch's commit (the next run records one) |

3. **Both from your session:** `/mirai doctor` and `/mirai doctor --fix` (21f's session list; Claude Code asks you each time). The repairs sign nothing.

## Defaults taken with the decisions (not asked; say if you want them otherwise)

- **Output:** one line per item, `ok`/`yellow`/`red`, then each yellow and red item's fix hint, then a summary: `doctor: 12 ok, 2 yellow, 0 red`. `--json` for scripts.
- **Exit codes:** 0 when nothing is red (yellow is fine), 5 (needs you) when something is red; `--fix` gives 0 when it left nothing red.
- **No item is skipped silently:** an item doctor can't check (Docker down for the red team, no host CLI) is yellow and says so.
- **`--fix` in order, each one only when its check is red:** the dead leftovers first (a repair takes the store's locks), then the run state, then the registry; then every item is checked again and printed.
- **The run state is rebuilt only when no run is alive** (the run lock free), so `--fix` never touches a running run.
- **The kept binary's CPU:** read from its Mach-O header; the fix hint says agents move to a native binary when a red-team run on the newer Claude Code is green (blocked today by S1/S2's new settings keys and sandbox rules).
- **`status`'s "hook: ok"** now also checks that the hook's Node exists (the same check), so `status` stops saying ok when it isn't.
- **Every doctor hint stays as it is:** "run: mirai doctor" now leads somewhere. A hint for a kind `--fix` repairs says `mirai doctor --fix`.

## Scope

**In.**

1. **`src/doctor/checks.js`:** the fourteen checks, each `{ id, title, state, detail, hint, fix? }`, from the functions above.
2. **`src/doctor/fix.js`:** the three repairs.
3. **`src/cli/commands/doctor.js`:** `mirai doctor [--fix] [--json]`; on the session list (`src/mcp/tools/commands.js`).
4. **`src/hooks/install.js`:** `hooksState` checks the hook's Node; `src/cli/commands/status.js` shows it.
5. **Hints:** the ones for kinds `--fix` repairs (`stale-breaker`, `bad-lock` of a dead pid, the registry, the run state) say `mirai doctor --fix`.
6. **Docs:** a new `docs/doctor.md` (each item, what red and yellow mean, the fixes, what's never fixed).

**Out.**

- The full doctor (unit 47): stack health, verifier rungs, `business.md` age, Docker disk, the public-repo warning, the managed settings, the ledger rewrite from the run log.
- Running the red team again from doctor (unit 47, through the same `[y/N]`).

## Probes (with your OK: yes, 2026-11-14)

- **P1, on the sample app (no model, writes nothing):** `mirai doctor` on your sample app as it is: green but for the expected yellows (merge gate local-only; the agents' binary is Intel on this Mac), each with its hint.
- **P2, seeded faults in a throwaway clone with its own MIRAI home (no model, nothing outside a temp folder):** the hook's Node removed, `gh` pointed at a missing path, a dead process's lock and breaker, the run state deleted, the branch registry deleted, one journal line broken. `mirai doctor` names each one red with its hint; `mirai doctor --fix` repairs the lock, the breaker, the run state and the registry, and leaves the broken journal line red, named with its line.

## Files

- **New:** `src/doctor/checks.js`, `src/doctor/fix.js`, `src/cli/commands/doctor.js`, `docs/doctor.md`; `test/doctor/doctor.test.js`; `test/probes/doctor-probes.js`.
- **Changed:** `src/hooks/install.js`, `src/cli/commands/status.js`, `src/mcp/tools/commands.js`, `src/cli/commands/index.js`, the hints above (`src/store/files.js`, `src/store/branches.js`, `src/store/run.js`).

## Tests (`npm test`, no model, no network)

- Each check green, yellow and red from a fixture (a missing or wrong-CPU binary by its header bytes; a missing Node; a token's age; a week past its cap; no baseline; a session server behind).
- `--fix`: each repair from its red state to green; a live process's lock left alone; the run state left alone while the run lock is held; a broken journal line never touched (the file's bytes unchanged).
- Exit codes; `--json`; the session list holds `doctor` with `fix` and `json`.
- `status` says the hook isn't ok when its Node is missing.

## Done when

- `mirai doctor` is green on the sample app but for the expected yellows, each red or yellow item with a fix hint (the roadmap's check).
- P2's seeded faults are each named; `--fix` repairs the safe ones and leaves the history alone.
- `npm test` passes; `docs/doctor.md` says what's above.

## What you'll do by hand (when we get there)

- Approve this spec; then `/mirai doctor` from a session once it's built.

## Open points for you

- None beyond the approval.

## Changes during the build (2026-11-14)

- **A store that can't be opened is the finding:** a damaged journal (or counter) makes the store refuse to open, so doctor shows the Store item red (the file, and what you can do by hand) and the login, and nothing else; `--fix` has nothing to repair there.
- **The registry keeps what it can't check:** an entry whose record's commit isn't in this clone (on the sample app: SAMPLE-2's first, discarded build from the old Mac) is kept, and named in the ok line. Red only when the registry and the journal's branch lines with their records disagree.
- **The token's age:** yellow from 330 days, MIRAI's existing renew mark (`RENEW_AFTER_DAYS`), not 300.
- **`run`, `review` and `resume` refuse too** when the hook's Node is gone (`hooksState` isn't ok), before a push would fail.
- **`--fix` checks again after each repair** and repairs what's newly red (the Store item shows its first problem, so a dead lock can hide a missing run state), each kind once.
