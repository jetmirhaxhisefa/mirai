---
unit: "21b"
date: 2026-11-03
claude_code: 2.1.316
result: 463 tests, all passing on the final code (an earlier run: 459/460 at load ~195, the strict launch timing test, which passes alone); R1 with 1 Haiku launch (run_tests through the server, handover ok); R2 with 1 Sonnet build of SAMPLE-1 (handed over; MIRAI's own run said needs-you, correctly); no full red team (templates unchanged)
---

# Unit 21b — Test results

## R1: a build session's mechanics (1 Haiku launch, sample-app clone, gate stubbed)

**The launch:** Kai, as `author`, with the handover schema.

**What happened:** it called `mcp__mirai__run_tests` on the `unit` level through MIRAI's server: Docker, 225 s, 13 passed, 1 failed (the seeded known failure). Then it handed over through `StructuredOutput`: `status: done`, with `tests_run` naming the run and the known failure, and `checks_run`. 4 turns, 9.5 min, almost all of it the test run.

**What follows:** the handover schema works under MIRAI's flags. A whole level costs minutes, so a build's time is mostly its own test runs plus MIRAI's after handover.

**Not covered by R1:** the manifest check. It needs no model; T4 and T4b cover it.

## R2: `mirai build` end to end (1 Sonnet launch, sample-app clone, gate stubbed)

**The setup:** SAMPLE-1 ("a user deletes one of their tasks"), from the plan Kai wrote in 21a's R2, stored and approved through `mirai approve --plan`. The baseline was recorded first: complete, in 665 s (Docker only).

**The build:**

| Measure | Value |
|---|---|
| Kai's launch | ok, 9 turns, 7.41 min, 1,939 tokens (+93,148 cached), `claude-sonnet-5-5`, share unknown |
| Branch | `feature/SAMPLE-1-a-user-deletes-one-of-their-tasks`, made from the integration commit |
| Kai's handover | `done`. It wrote the three tests first and saw them fail (405), then added the route, the controller's `destroy`, and the policy's `delete`, ran the whole unit level (16 passed, the known failure), and ran lint (pass) |
| The diff | 4 files, +43 lines: route, controller, policy, three feature tests. No protected path, no new dependency. Kept at `~/.mirai-21b-r2-diff.patch` |

**MIRAI's own run:**

| Run | Outcome | Judged against the baseline |
|---|---|---|
| lint | timeout | unknown (the load was about 60) |
| unit | fail | unknown: it failed at baseline too, with no test IDs to compare |
| frontend | pass | pass |
| e2e | pass | pass |

**The outcome:** `needs-you`. The ticket stayed `in-progress`, and the changes stayed on the branch.

**Why that's right:** the sample app's `.mirai/config.toml` names no test adapter on its levels. Those are the `adapter = "phpunit"` and `"vitest"` lines from unit 16a, still yours to commit. Without them a level has no test IDs. So its baseline holds a level-wide `no-ids` failure, and a failing run can't be told apart from a new failure. The rule in docs/test-baseline.md says that's "can't tell", never green, and MIRAI held to it. With the adapters committed, the unit level's only failure would match the baseline's known test ID.

## Tests (`npm test`, no model)

460 tests; 459 passed in one full run at a load of about 195. The failure was strict's T5/T6 (the launch layout), the timing test that flaked in 21a. It passes alone, 14 of 14. New, in `test/agent/build.test.js`:

- **T1:** a plan edited after approval is refused; a ticket not in progress is refused. The build gets Kai's read-write tools, the handover schema and the input folder.
- **T2:**
  - the slug comes from the title, with accents dropped;
  - the branch is made and checked out, then reused;
  - a dirty tree, a branch with commits of its own, and a bad pattern are each refused.
- **T3:**
  - the handover's shape is checked;
  - `blocked` stays `in-progress` with its reason;
  - a handover file is ignored;
  - no structured output means `agent-failed`.
- **T4:**
  - an undeclared protected path is stopped, and its files are left as they are;
  - a declared one passes;
  - an auto-run path always stops;
  - an undeclared npm dependency stops, and a declared one passes.
- **T4b** (stack data):
  - a dependency moved between keys isn't new;
  - case doesn't matter in the declared name;
  - an unreadable manifest and a lock file changed alone are named.
- **T5:**
  - the comparison rule, case by case;
  - through `testsAfter` with a signed baseline: no baseline is unknown, a known failure passes, and a new one fails;
  - in the build, a new failure keeps the ticket `in-progress` with `build.json` kept, and Docker down gives `needs-you`.
- **T6 + T7:**
  - usage is checked first, before any launch;
  - green moves the ticket to `in-review`;
  - a build isn't a round;
  - the `agent_run` line names Kai, `author`, `build` and `standard`, and the `checks` line has one result per level.

**Pinned lists updated:** the command list (`build`) and the launch-token minters (`cli/commands/build.js`).

## After the reviews

463 tests, 463 passing on the final code. `test/agent/build.test.js` now has 10 tests. Three are new, for the review and re-review findings:
- **The comparison:**
  - a known level-wide `error` and `unmapped` failure match their kind;
  - fewer tests, more skipped, or counts on one side only are `unknown`;
  - a baseline that doesn't verify stops the build.
- **Dependencies:**
  - with node's pack on, a declared dependency covers `package.json` (the lock declared apart), and an undeclared one stops;
  - a spec change, an alias, a second key for an existing name, `overrides`, a `scripts` change, and a changed `pyproject.toml` each stop;
  - a `packageManager` change keeps the manifest from being covered;
  - a move between keys with the same spec isn't new.
- **Deletions, recheck, and the branch:**
  - a deletion the code map doesn't remove stops, and a folder `remove` row allows one;
  - `--recheck` turns Docker-down into `handed-over`, and refuses a changed tree, a hidden file and a changed plan;
  - a `blocked` outcome keeps `build.json`;
  - a pattern without `{ticket}` is refused.

## Not proven

- **A green handover on a real model.** R2's code was clean, and frontend and e2e passed. The unit level couldn't be compared, because the sample app has no adapter, and lint timed out under load. So `handed-over → in-review` is shown with the stand-in only.
- **A build that needs its full 150 turns, or 60 minutes.** R2 took 9 turns and 7 minutes.
- **The dependency and protected-path checks on a real model.** Kai changed neither in R2.
- **`--recheck` and the review's new stops on a real model:** stand-in only.
- **No full red team was run.** The two mode templates are unchanged. A build launch carries `--agents`, `--agent` and `--json-schema`, as 21a's plan launches do.
