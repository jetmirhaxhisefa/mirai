---
unit: "21c"
name: fix-rounds
status: approved (2026-11-05)
roadmap: design/07-implementation-roadmap.md, row 21 (21a and 21b done; 22 and 18f done before this); design/01 §7 (fix rounds resume the session), §8 (machine work first); D-18; R-M4, R-M5, R-C7; notes from 20, 21b, 22
depends_on: ["21b", "22", "20"]
---

# Unit 21c: fix rounds

## Why

When MIRAI's own test run after a build finds a new failure, the ticket stays `in-progress` with MIRAI's commit of Kai's work, and nothing more happens (21b, 22). This unit sends that back to Kai to fix, round by round, under the loop guard (unit 20): a fixed budget of rounds, the same problem twice is a plan problem, and no progress parks the ticket. An AI never decides whether to go on.

design/01 §7 asks that **fix rounds resume the same session**, so a fix doesn't pay for a cold start (R-M4). Today every launch gets a fresh, empty Claude Code config folder, deleted at its end, so there's nothing to resume. That's the main thing to settle here.

## Scope

**In.**

1. **`mirai fix <ticket>`,** in your terminal (unit 28's orchestrator runs it at night).
   - **It refuses unless:**
     - the ticket is `in-progress`;
     - its plan's approval still verifies;
     - its last build or fix ended `checks-failed`, with MIRAI's commit, and the tree is clean at that commit.
   - **It then runs rounds until one of these:**
     - **green:** the ticket moves to `in-review`, as a build would;
     - **the loop guard says park or re-plan** (unit 20): the ticket parks, or goes back to `ready-for-dev` for its one re-plan;
     - **a stop for you:** any of 21b's safety stops, an environment fault, a usage limit;
     - **you press Ctrl-C.**
2. **One round** (design/01 §7 and §8):
   1. **The loop guard first:** `beforeLaunch(…, { round: true })`. Rounds used up park the ticket (`cap`).
   2. **A checkpoint** at the current commit (unit 22).
   3. **The launch:**
      - **Who and what:** Kai, role `author`, step `build`, on the build's tier.
      - **The inputs:**
        - `plan.md`, the verified text;
        - **`failures.json`: the new failures from MIRAI's own last run** (each failing test ID, its message, the level and the run's output tail), never Kai's own report;
        - the ticket and `index.json`.
      - **The prompt:** "fix exactly these; change nothing else the plan doesn't name".
      - **The session:** resumed where it can be (open point 2).
   4. **The handover,** then **MIRAI's checks** as after a build (21b's order: the launch's own checks, records and keys, protected paths, dependencies, deleted files, then its own test run against the baseline). Then **MIRAI's commit** when the safety checks pass (22).
   5. **`afterRound`** (unit 20) gets the round's new failures as `failures` (L4: the same failure signature in a later round), and the files this round changed (L5: churn, and the open count must drop). It decides: `done`, `fix`, `replan` or `park`.
   6. **Refunds:** an environment fault decided before the agent acted, or a usage limit, gives its round back (unit 20's `settleLaunch`). A fault found in what the agent did keeps it.
3. **Resuming the session (open point 2).**
   - **Kept after a build or fix launch:** Claude Code's transcript of that launch (its session file from the launch's own config folder), copied into the store, `<store>/tickets/<ticket>/session/`, before the folder is removed. Agents can't write the store.
   - **The next round:** the transcript goes back into the new launch's fresh config folder, and Claude Code starts with `--resume <session id>`. Everything else about the launch is as fresh as ever: settings, token, trust root, the init check.
   - **A fresh session instead,** never a resume:
     - after a `mirai discard` or any reset to a checkpoint (unit 22's note: the old session believes in edits that are gone);
     - when the transcript is missing, unreadable or over a size cap;
     - when the plan changed;
     - when the resume is refused at the init check.

     The fresh session gets the plan and the failures, and costs a cold start.
4. **What Kai is told it may not do:** edit a test's expectation to make it pass, skip or delete a test, lower a threshold.
   - 21b's count check catches fewer tests or more skipped against the baseline, and its deleted-file check catches removed files.
   - Unit 23's floor guard is the full check.
5. **The run log:** each round's `agent_run` line (with `round` set), and its `checks` line. The loop counters hold the rest.
6. **Docs:** `docs/agents.md` (fix rounds), `docs/loop-rules.md` (rounds in practice), the roadmap.

**Out:**
- **Review findings as a source of rounds:** unit 24.
- **QA:** unit 51.
- **The red check:** unit 23.
- **Re-planning itself:** a `replan` decision moves the ticket back to `ready-for-dev`, and you run `mirai plan` again (21a). Plan rounds stay plan rounds.
- **The orchestrator's loop:** unit 28.

## Probes (with your OK before each batch)

- **R1. Resume under MIRAI's flags** (Haiku, about 2 runs, on a sample-app clone, gate stubbed):
  - a first launch is told a canary word, and its transcript is kept;
  - a second launch, with a fresh config folder and the transcript restored, resumes with `--resume`, and is asked the word.
  - **What we learn:** does it remember, does the init check still pass, and where does Claude Code keep the session file under `--restricted`?
- **R2. A real fix round** (Sonnet, 1 to 2 runs, on a sample-app clone):
  - a build of SAMPLE-1 is seeded with one deliberately broken test and committed as MIRAI's step, so the ticket is `checks-failed`;
  - `mirai fix` then runs, in a fresh session, since there's no real build session in a seeded state;
  - **What we learn:** it fixes the failure, MIRAI's run is green, and the ticket goes to `in-review`.

  R1 shows the resume path; R2 the round and the loop guard.

## Files

- **New:**
  - `src/agent/fix.js`, `src/agent/session.js` (keep and restore a transcript);
  - `src/cli/commands/fix.js`;
  - tests in `test/agent/`;
  - `test/probes/fix-probes.js`.
- **Changed:**
  - `src/agent/run.js` (keep the transcript; `--resume`);
  - `src/agent/build.js` (shared checks and commit; the failures it records);
  - `registry/agents/mirai-developer.md` (the fix section);
  - docs, the roadmap.
- **`src/agent/run.js` is in the cage (18f),** so this unit makes the red team stale once, and your refresh needs one run.

## Tests (`npm test`, no model; a stand-in `claude`)

- **T1.** `mirai fix` refuses:
  - a ticket not in progress;
  - one whose last outcome isn't `checks-failed`;
  - a dirty tree;
  - an edited plan.
- **T2.** A round:
  - the guard counts it;
  - a checkpoint is set;
  - Kai gets the failures from MIRAI's run (not its own report);
  - a green round moves the ticket to `in-review` with MIRAI's commit.
- **T3.** The loop guard decides:
  - the same failure twice gives a re-plan, and then a park;
  - no drop in the failure count parks;
  - the rounds used up park (`cap`);
  - an environment fault before the agent acted gives its round back.
- **T4.** Resume:
  - the transcript is kept after a launch and restored into the next one's fresh folder, with `--resume`;
  - a fresh session after a discard, after a changed plan, or with a missing transcript.
- **T5.** The safety stops still hold inside a round (a protected path, a dependency, a deleted test), and a stop isn't committed.

## Done when

- A failing build gets fix rounds under the loop guard until green, a re-plan, or a park.
- A round resumes Kai's session when it can, and starts fresh when it must.
- R2: a real fix round on a sample-app clone ends green.

## Open points for you

1. **One command runs rounds until the guard stops it** (`mirai fix <ticket>`), rather than one round per command. My recommendation: yes. The loop guard decides when to stop, you can Ctrl-C, and it's what the orchestrator will do anyway.
2. **Resume by keeping the transcript in the store.** It's restored into a fresh config folder each round, so nothing else about a launch carries over. My recommendation: yes, with a fresh session after a discard, a reset, a changed plan, or a missing transcript.
   - **What a transcript holds:** everything the agent saw, including file contents it read. It's kept with the store's private permissions, one per ticket, and removed when the ticket is done (retention, unit 69).
   - **What R1 must show** is that a restored transcript resumes under `--restricted`. If it doesn't, rounds start fresh, and the spec records that.
3. **Fix rounds start only from `checks-failed`.** A safety stop or a park needs you first: `mirai unpark`, or `discard`. My recommendation: yes. A round shouldn't try to fix what was stopped for safety.
4. **The cost:** R1 is about 2 Haiku runs, and R2 is 1 to 2 Sonnet runs, plus Docker test runs. I'll ask before each batch.

## Changes after testing and review

1. **Each round's run-log line names its round.** `launchInRun` takes `round`; it was always 1.
2. **The shared path after a launch** (the handover, MIRAI's checks, the commit, the record, the ticket's state) is one function, `afterLaunch` in `build.js`, used by both the build and each fix round.
3. **MIRAI's own test run keeps each failing test's message and the output's tail,** capped. They're what `failures.json` is made from.
4. **`mirai discard` forgets the kept session,** so the next step starts fresh.
5. **R2's fix round started fresh:** the seeded build had no session to keep, as the spec expected. R1 showed the resume itself.
6. **From the reviews (Tech Lead and Architect):**
   - **Where rounds start is kept** (`fix_from` in `build.json`: the failing step's commit, tests, plan and launch). A round that stops for a usage limit, a fault or Ctrl-C no longer blocks the next `mirai fix` (Tech Lead H2). A step built from another plan is refused, so after a re-plan `mirai build` comes first (Tech Lead M3).
   - **A session belongs to the launch that made it.** A keep forgets what was there first, a launch that hit any stop keeps nothing, and a round resumes only the session of the step it starts from. An older session can't be resumed because a newer one couldn't be kept (both reviewers' H). A resume Claude Code refuses ends the launch as an environment fault: its round is given back, and the session is forgotten, so the next attempt starts fresh instead of failing the same way forever (Architect H1, Tech Lead M1). A re-plan forgets it too.
   - **The session's place is decided in the cage.** `run.js` computes the store path from the ticket and takes only `keep` and the launch to resume from. A copy is read without following links, and measured as it's copied (Architect M1, L2; Tech Lead L5).
   - **Refunds:** a launch MIRAI refused before it started (a stale red team, a token, Ctrl-C) gives its round back, and Ctrl-C between rounds stops before the next is counted (Tech Lead H1). `settleLaunch` refunds `refused` only when the caller says the agent never ran; `run.js` never does for a launch that ran.
   - **The usage caps are checked before every round** (Tech Lead M4).
   - **L4 signs a failure by level and test,** so two different levels failing whole aren't the same problem (Architect M4).
   - **Small ones:** a discard forgets the session before it resets (Architect L3); `failures.json` holds at most 50 failures and says how many more; Kai's prompt calls their text data, not instructions (Architect L8); a "done" from the guard on a failing run is never a handover (Tech Lead L1); `sessionDir` is now `agentSessionDir` (Architect L5).
   - **Decided, not changed:**
     - **The build's failures aren't round 0** (Tech Lead M2). The loop rules count the launches that send work back, and the build isn't one. So a failure round 1 didn't fix gets round 2 before it's a plan problem, within the cap.
     - **The step is still `build`** in the launch and the run log, with `round` set (Architect L4). The role's tier and step rules are the build's. The prompt calls it a fix round.
     - **The checkpoint is set after the launch,** at the commit before it, as the build does (Architect L7). Same commit, same effect.
   - **Left for 21d:**
     - a red-team case for a resumed launch with a planted transcript (Architect M2);
     - measuring what a resume saves, including `--max-turns` and the structured output on a resume (Architect M5);
     - keeping Claude Code's large tool results beside the session file (Architect L1).
   - **Left as it is:** a `--recheck` of a fix round commits with the build's subject (Tech Lead L3).
7. **From the independent re-review of the rework:**
   - **Only a stop that's no one's decision carries the step rounds start from:** a usage limit, a fault, Ctrl-C, or your discard. Kai's `blocked`, a safety stop or an error refuses the next `mirai fix` until you've looked (Medium).
   - **A round resumes the session of the failing step it starts from** (`fix_from.launch`), never the last launch's. A stopped launch's session can't be picked up (Medium).
   - **The step before is kept too** (`fix_from_prev`). A clean discard after a committed failing round goes back to it, and rounds start there again, with its failures. A discard to anything else drops it, and the hint says `mirai build` (Medium).
   - **An error thrown after Claude Code started is marked as such** in `run.js`, and never gives its round back (Medium).
   - **Small ones:**
     - a launch refused before it started leaves the last step's session as it was;
     - a stop record no longer carries the previous step's tests, handover and checks;
     - the 50 failing messages kept per level are the new failures first.
   - **Not changed:** a refunded round's checkpoint name repeats on the next attempt (`fix-N` at the same commit). It's cosmetic.
   - **Ordering:** the red-team case for a resumed launch comes before unit 28 runs `mirai fix` unattended. It's in the roadmap.
