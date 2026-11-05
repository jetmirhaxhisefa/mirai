---
unit: "21c"
date: 2026-11-05
claude_code: 2.1.316
result: 485/485 tests after the review and re-review fixes (one earlier full run, during R1's launches, had 479: strict's timing test, which passes alone 14/14); R1 with 2 Haiku launches (a restored session resumes and remembers); R2 with 1 Sonnet fix round (a seeded bug fixed in one round, the ticket in-review); no full red team yet (run.js is cage code, so your refresh needs one)
---

# Unit 21c — Test results

## R1: resume under MIRAI's flags (2 Haiku launches, sample-app clone, gate stubbed)

| Launch | What happened |
|---|---|
| 1 | Told a canary word. Its session was kept: one file, 56 KB, `projects/<the cwd, as a name>/<session id>.jsonl` in the launch's config folder. |
| 2 | A fresh config folder with the file restored, `--resume <id>`. It answered the canary word. MIRAI's real init check passed. The same session id (no fork), kept again (62 KB). |

**What follows:** resuming works under `--restricted --permission-mode dontAsk` with MIRAI's strict settings. Rounds resume when they can. Recorded in research/10.

## R2: a real fix round (sample-app clone, gate stubbed)

- **The baseline:** recorded in 1,020 s (Docker only).
- **The seeded build:** a stand-in applied Kai's SAMPLE-1 code from your walkthrough (`314a9df`), with `TaskPolicy::delete` changed to `return true`. MIRAI's own run caught exactly that: `unit` failed, with `test_a_user_cannot_delete_another_users_task` as a new failure. Lint, frontend and e2e passed. The outcome was `checks-failed`, committed.
- **`mirai fix`:**

| Round | Outcome | Decision | Turns | Minutes | Tokens | Session |
|---|---|---|---|---|---|---|
| 1 | handed-over | done | 8 | 1.78 | 1,061 (+106,063 cached) | fresh (the seeded build had none) |

- **The fix:** `delete()` returns `$task->user_id === $user->id`, the same rule as `update()`, and no test was touched. MIRAI's run then passed every level.
- **The ticket:** `in-review`.
- **The branch:** the branch record, the build, then `SAMPLE-1: fix round 1`, with Kai's explanation in the message and the trailer. Kept at `~/.mirai-21c-r2-fix.patch`.

## Tests (`npm test`, no model)

485/485 pass. New, in `test/agent/build.test.js`:
- **T1:** `mirai fix` refuses a ticket whose last outcome isn't `checks-failed`, a dirty tree, and a checkout away from the step's commit.
- **T2 + T4:**
  - the build's session was kept;
  - round 1 resumed it, with `--resume <id>` and the file restored into the fresh folder;
  - Kai got MIRAI's failures in `failures.json`;
  - the round is counted, and its log line says round 1;
  - there's a checkpoint `fix-1` and a commit "fix round 1";
  - green moves the ticket to `in-review`;
  - a missing session gives a fresh one, with no `--resume`.
- **T3:**
  - the same failure in rounds 1 and 2 gives a re-plan (`ready-for-dev`);
  - a different failure without a drop parks it, `no-progress`;
  - rounds used up park it, `cap`, with no launch;
  - a fault before the agent acted (no init event) gives its round back.
- **T5:** a protected path written in a round needs you, isn't committed, and the ticket stays `in-progress`.
- **From the reviews:**
  - **Refusals:** a ticket not in progress, an edited plan, and a step built from another plan.
  - **Rounds given back:** a launch refused before it started, and Ctrl-C before a round, use no round.
  - **A refused resume:** a resume that Claude Code refuses is forgotten, and its round is given back. The next `mirai fix` starts fresh from the same failing step.
  - **Round 2** resumes round 1's session. The kept session names the launch that made it.
  - **Discard:** a round stopped for safety, then discarded, leaves no session.
  - **L4** tells levels apart.
  - **`session.js`:**
    - an older copy is forgotten when a later one can't be kept;
    - another launch's session isn't restored;
    - a climbing path or a linked file is refused.
- **From the re-review:**
  - Kai's `blocked` refuses the next `mirai fix`.
  - **A discard back to the build:** round 1 commits and fails, and round 2 is refused before it starts (its round given back). A clean discard then returns to the build's commit, and the record starts rounds there again, with the build's failures.
  - A throw after the start keeps its round.

**Changed:** the pinned command list (`fix`) and the launch-token minters (`cli/commands/fix.js`).

## Not proven

- **A resumed real fix round:** R2's round was fresh, since a seeded build has no session. R1 shows the resume itself.
- **A re-plan or a park on a real model:** stand-in only.
- **A resumed launch under the red team:** no red-team case plants a transcript and resumes it yet (21d).
- **What a resume saves:** not measured (21d).
- **Inside a round,** only the protected-path stop is tested. The dependency and deleted-file stops are the build's own checks, through the same `afterLaunch`, and are tested there.
- **No full red team yet:** `src/agent/run.js` is cage code (18f), so your refresh with this unit needs one run.
