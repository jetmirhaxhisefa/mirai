---
unit: "29e"
name: build-runner
status: approved (Jet, 2026-11-18: "approve 29e"; decisions 1–2 from his answers the same day)
roadmap: design/07-implementation-roadmap.md, row 29e; design/10-build-runner.md (PM-45)
depends_on: ["18a", "18b", "18c", "18e", "18f", "18g", "18h", "17b", "21f", "30"]
---

# Unit 29e: The build runner

## Why

Building a unit needs runs the building session can't do itself:

- the red team (about nine minutes, your Claude subscription);
- the probes;
- the sample app's baseline and real runs.

Today you start each one by hand, wait, and paste the result back. Nothing moves while you're
away. Jet, 2026-11-16: "a script that is run in my name for red team or other blockers like the
baseline run ... so the construction of MIRAI itself is faster". Jet chose it as the first unit
after the pilot (2026-11-18: "29e first").

It is a tool for **building MIRAI only**. It is never installed into a project, and its results
never unlock agents on a real project such as Thudos.

## Decisions

From `design/10` and Jet's answers on 2026-11-18.

1. **Your yes, once, when you start it.**
   - You start the runner in a real Terminal and type yes once: "run the fixed jobs in my name
     until I stop it".
   - The runner records that start in MIRAI's store. A red-team run it starts proves itself
     through that record and its parent process, the way a `/mirai` session's worker does today
     (21f). So it passes the red team's real-terminal rule and its "Run it now?" question.
   - The proof holds only while the runner is alive. Stopping the runner ends it.
   - Nothing else gets this proof: your gates (approvals, keys, merges) never accept it.
2. **Your real sample app, as by hand today** (Jet, 2026-11-18, after P3 below).
   - Jobs that need the sample app run in `~/Projects/mirai-sample-app`, with your real MIRAI
     store and keys. The runner does exactly what is done by hand today: it refreshes the sample
     app's `main` with the requested commit's MIRAI, commits ("MIRAI refresh: <branch> at
     <short commit>"), pushes, records the baseline, and runs the job.
   - **The runner owns that folder while it runs.** It refuses to start a job when the checkout
     isn't on `main`, has uncommitted changes, or has commits `origin` doesn't. It never resets,
     stashes or overwrites.
   - **Why not a separate branch (the first draft):** P3 checked it in the code. MIRAI allows one
     checkout per repo (D-52, `second-checkout`), and refuses a store whose integration branch
     changed. So a worktree on `mirai-build` can't share your store.
   - The sample app's `main` carries the last requested commit's MIRAI until the next refresh,
     as it does today. Its red-team results and baselines are for building MIRAI. They never
     count for Thudos or any other project, whose trust roots differ.
3. **A fixed job list, a pushed commit, nothing else** (`design/10` §2.2). A request names a job,
   a MIRAI commit pushed on a branch of MIRAI's GitHub repo, and only the argument that job
   declares.
4. **A partial red-team run is feedback only** (`07`'s rule since roadmap v6). `redteam-cases`
   never writes a result record. The green result comes from `redteam-full`: once a night on the
   latest state, and before each merge.
5. **A scrubbed environment for `tests`**: no `SSH_AUTH_SOCK`, no git or `gh`/`glab`
   credentials, no Claude token, a home of its own. Sample-app jobs keep your home (decision 2),
   but lose every credential variable, and `SSH_AUTH_SOCK` too except in red-team jobs (found on P2:
   the red team's S5 control must reach your SSH agent from outside the cage). Only the runner itself pushes the
   sample app's `main`, in the refresh step before the job starts.

## Scope

**In**

1. **`tools/build-runner.js`** and its modules under `tools/build-runner/`:
   - `tools/` is outside `package.json`'s `files`, so nothing installs it.
   - It refuses to start anywhere but MIRAI's own repo: the package name `mirai` and an `origin`
     of `jetmirhaxhisefa/mirai`.
   - It needs a real terminal at start, prints what it will do, and asks once:
     `Run the fixed jobs in your name until you stop it? [y/N]`.
2. **The folders**, outside every repo:
   - `~/.mirai-build/requests/`: the session writes one JSON file per
     request.
   - `…/results/`: the runner writes `<id>.json` and `<id>.log`.
   - `…/runner.log`: one line per request: time, id, job, commit, branch, its diff size against
     `main`, and the outcome. Refused requests are logged too.
3. **The jobs:**

   | Job | Runs | Where | Argument |
   |---|---|---|---|
   | `tests` | `npm test` | a clean export of the commit (`git archive`), scrubbed environment | none |
   | `probes` | one probe file from `test/probes/` | a clean export | the file's name, which must exist in that commit |
   | `baseline` | `mirai baseline` | `~/Projects/mirai-sample-app`, refreshed from the commit | none |
   | `redteam-cases` | `mirai redteam run --only <ids>` | the same | one `fact` that cases carry (a case's `fact` field, matched as one of its comma-separated parts), or case ids that exist |
   | `redteam-full` | `mirai redteam run` | the same | none |
   | `redteam-session` | `mirai redteam run --sessions` | the same | none |
   | `sample-run` | a script under `tools/runs/` | the same | the script's name; it must exist on MIRAI's `main` |

   - `regress` (`13` P12) is added when that unit exists.
   - One job at a time. A queue in file order. The red team's own machine lock stays.
4. **The refresh step** for sample-app jobs, done by the runner itself (in its own environment,
   which can push), before the job starts:
   - check the checkout is clean, on `main`, and level with `origin/main` (refuse otherwise);
   - `mirai init --refresh` from the exported commit;
   - commit "MIRAI refresh: <branch> at <short commit>" and push `main`;
   - record the baseline for that commit (the red team and builds need one);
   - skip all of this when `main` already carries that commit's MIRAI.
5. **The proof in MIRAI** (`src/cli/tty.js`): `requireTtyOrSession` also accepts a live runner
   record:
   - the record is written by the runner at start in the sample app's store (your real one);
   - it carries the runner's pid;
   - the command's parent chain must reach that pid;
   - the record says which commands it covers: `redteam run` and `baseline` only.
   - `requireTty` (the gates) is unchanged.
6. **Stored results:** first, check what the probe harnesses and 17b already store.
   - Probes: a `probes` request whose file and tool versions (Claude Code version and binary
     hash, Docker engine, git) match a stored result gets that result back, marked "reused".
   - The baseline already lives per commit (17b); nothing new is expected there.
7. **The result file:** `{ id, job, arg, commit, branch, state: pass | fail | refused | error,
   started, minutes, summary, log }`. The summary is the job's last lines, capped. The session
   reads it and asks again.
8. **`docs/build-runner.md`:** starting it, stopping it, what it can and can't do, and the
   evening batch habit (`design/10` §2.5).

**Out**

- Any use on a real project. The pilot's red team stays a run you start in Thudos.
- A runner on another machine, or more than one job at a time.
- `regress`, until its unit exists.
- Changing what the red team tests, or how a result's key is made.

## How the session uses it

1. Push the unit branch.
2. Write `requests/<id>.json`, for example:
   `{ "id": "29e-hook-1", "job": "redteam-cases", "arg": "hook", "commit": "<40 hex>" }`.
3. Wait for `results/<id>.json`, read it, fix, push, and ask again.
4. Before asking you to approve a unit that touches the cage, run `redteam-full` on its last
   commit.

## Tests (`test/tools/build-runner.test.js`, no real runs)

- **T1 Requests:** each is refused and logged:
  - an unknown job;
  - an unknown `fact`;
  - an argument with a `/` or `..`;
  - an extra field;
  - a commit that isn't 40 hex;
  - a commit that isn't on any branch of `origin` after a fetch;
  - `sample-run` with a script that isn't on `main`.
- **T2 Fact to ids:** `hook` selects exactly the cases whose `fact` includes `hook`. A fact that
  matches no case is refused.
- **T3 Partial runs record nothing:** `redteam-cases` builds a command with `--only`, and the red
  team's existing rule keeps it out of the store (checked against 18a's code path, not
  re-implemented).
- **T4 Scrubbed environment:** a `tests` job's environment has none of `SSH_AUTH_SOCK`,
  `GH_TOKEN`, `GITHUB_TOKEN`, `GLAB_*`, `CLAUDE_CODE_OAUTH_TOKEN`, `GIT_ASKPASS`, and `HOME` is
  the job's own folder.
- **T5 The proof:**
  - `requireTtyOrSession` accepts a command whose parent chain reaches a live runner record that
    covers it;
  - it refuses: a dead pid, a record for another command, a process outside the chain, and
    `requireTty` in every case.
- **T6 Wrong repo:** the runner started outside MIRAI's repo exits with a message.
- **T7 Not installed:** `npm pack --dry-run` lists nothing under `tools/`.
- **T8 Probe reuse:** a stored probe result is returned when the versions match, and run again
  when one changes.
- **T9 A checkout that isn't ready is refused:** a sample-app checkout on another branch, with
  uncommitted changes, or with unpushed commits gets `refused`, and nothing in it changes.

## Probes (real, on this Mac)

- **P1** A canary variable in your environment and a canary file in your real home are
  unreadable from a real `tests` job.
- **P2** `redteam-cases hook` on a pushed commit returns its result in minutes, with no result
  record written. `redteam-full` on the same commit writes one for that refresh commit's trust
  root.
- **P3** (done before building, 2026-11-18): a worktree can't share your store: `openStore`
  refuses a second checkout (`second-checkout`, D-52) and a changed integration branch. Decision
  2 was changed with Jet.
- **P4** A night batch: three requests queued in the evening (`tests`, `redteam-cases`,
  `redteam-full`) finish in order with no one at the Mac. The runner's terminal shows one line
  each.

## Done when

- T1–T9 pass, and the full suite passes.
- P1–P4 pass on this Mac.
- `docs/build-runner.md` is written.
- The roadmap's done-when for 29e holds: a fact's cases run with no record written, and a full
  run writes one; bad requests are refused and logged; canaries are unreadable from `tests`; a
  `sample-run` script not on `main` is refused; a probe result is reused until its tool changes;
  the runner refuses another repo; the installed file set doesn't contain it.
