---
status: draft
version: 1
---

# 10 — The build runner (MVP unit 29e)

**When:** right after the pilot (unit 30), before Milestone B. The pilot was already running
when this was decided, and the runner doesn't help it: the pilot's red-team run must be
started by you in the pilot project.

Decision PM-45. This is the only addendum that belongs to the MVP. It is a tool for **building
MIRAI itself** and is never installed into a project.

## 1. The problem

Building a unit needs runs that the building session can't do: the red team (170 to 250 agent
launches, about nine minutes), the probes (Claude Code, Docker, git), the test baseline and
the real runs on the sample app. Today you start each one by hand, wait, and bring the result
back. Nothing moves while you're away, so no unit can be built overnight, and the MVP is taking
weeks longer than the work itself needs.

## 2. The design

### 2.1 The runner

A small script, `tools/build-runner.js` (proposed), that you start once in a real terminal and
leave running:

```
caffeinate -i node ~/Projects/mirai/tools/build-runner.js
```

- It watches a **request folder** and writes to a **result folder**, both outside the repo
  (proposed: `~/Library/Application Support/mirai-build/requests/` and `…/results/`).
- The building session writes a request file: a **job name** and a **commit**. Nothing else.
- The commit must be **pushed on a unit branch** of MIRAI's repo. The runner fetches it from the
  remote, so it never runs something that exists only in the session's folder.
- The runner checks out exactly that commit into a clean folder of its own, runs the job, and
  writes the log, the exit state and a short summary to the result folder.
- The session reads the result, fixes, and asks again.
- One job at a time. The red team already holds a lock per machine; the runner queues behind
  it.
- The runner prints one line per job in its terminal, so you can see what ran in your name.

### 2.2 The fixed job list

The list is in the runner's code. A request can't add to it or pass arguments beyond what a
job declares.

| Job | What it runs | Arguments a request may give |
|---|---|---|
| `tests` | The unit tests, with the scrubbed environment of §3 | none |
| `redteam-full` | The full red-team suite on the sample-app clone | none |
| `redteam-session` | The session red team | none |
| `redteam-cases` | Only some cases: those of one `fact` (`hook`, `bundle`, `escape`, `G17`, …), or named case ids. Each case already carries an `id` and a `fact`, and the red team already has an `--only` filter by id whose runs are never stored | one existing `fact` value, or case ids that exist |
| `probes-claude` / `probes-docker` / `probes-git` | The probe harnesses | none |
| `baseline` | The test baseline on the sample app | none |
| `sample-run` | A named real run on the sample app (a unit's R- or P-run) | the name of a script under `tools/runs/` **that exists on `main`** |
| `regress` | The regression set (`13` P12), once that unit exists | none |

`sample-run` only runs a script that is already on `main`. A unit's new run script is added in
the unit's spec PR, which you read and merge before the build starts. So the script that runs in
your name is one you approved, while the code it exercises is the unit's branch.

### 2.3 Targeted red-team runs are feedback only

Checked in the code on 2026-11-16: a red-team result is valid for a key of ten parts (the
Claude Code binary, the settings bundles, the cage's source files, Docker, git, macOS, Node,
the project's rule files, host controls, compose). Any change makes the whole result stale.
That is strict on purpose: the cage's parts interact, and a hand-written "this case depends on
these files" can be wrong, which would give a green result for something never tested.

So:

| Run | Produces a green result? |
|---|---|
| No run, because the key didn't change (a unit that touches only reports or display) | The existing result stays valid. Nothing to do |
| `redteam-cases` for one `fact` or some ids, while building | **No.** It answers in a minute or two and never writes a result record |
| `redteam-full` | Yes. Run once per night on the latest state, and before each merge |

A wrong choice of cases can cost a surprise in the full run. It can never produce a false green.

### 2.4 Stored probe and baseline results

- **Probes** test facts about outside tools. Their results are stored per tool version (Claude
  Code version and binary hash; Docker engine version; git version) and reused until that
  version changes.
- **The baseline** is stored per commit of the sample app plus the adapter config.
- **Check first:** how much of this storing the probe harnesses and unit 17b already do.

### 2.5 Batched approvals (a habit, no code)

In the evening you approve the specs of the next two or three units. The session builds them
in order overnight, each on top of the last, with the runner verifying. In the morning you
review finished units.

## 3. What it trusts, and what limits it

**What the runner trusts.** The `tests` job and the red-team jobs execute code from the unit
branch, in your name, before you have reviewed that unit's diff. That is the point of the tool,
and it is also what you do today when you run what the session wrote. The runner doesn't make
that safer. It makes it unattended. So the limits below matter.

- **A fixed job list.** A request names a job and a commit. It can't pass a command, a path or a
  flag.
- **Pushed commits on a unit branch only**, fetched from the remote into a clean folder.
- **A scrubbed environment.** Jobs run without your `SSH_AUTH_SOCK`, without git or `gh`
  credentials, and with a home folder of their own that holds only what the job needs (the
  subscription token for red-team jobs, as today). The runner's own home, your key and your
  real `.env` files are not reachable from a job.
- **Scripts from `main` only** for `sample-run` (§2.2).
- **A line per request** in the runner's terminal and its log: the job, the commit, and the
  size of that commit's diff against `main`, so an unexpected request stands out.
- **MIRAI's own repo only.** The runner refuses to start anywhere else, and it isn't part of
  what `mirai init` installs.
- **Build results only.** The red-team result that unlocks headless agents on a real project,
  such as the pilot, still comes from a run you start yourself in that project.
- **Your gates are untouched.** Spec approval and unit approval stay with you.
- **The request and result folders are outside the repo.** A request is never committed, and an
  agent inside a MIRAI run on a project can't reach them.
- **The limit that stays:** the session could weaken a red-team case and then ask for a run. The
  protection is the one you have now: you review the unit's diff before approving it, and the
  full run's report lists the cases that ran.

## 4. The unit

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| 29e | **The build runner** (`tools/build-runner.js`, development only):<br>• the request and result folders, one job at a time, a line per request with its diff size;<br>• the fixed job list of §2.2, with `redteam-cases` taking one `fact` or existing case ids and never writing a result record;<br>• a clean checkout of the requested commit, which must be pushed on a unit branch;<br>• the scrubbed environment of §3;<br>• `sample-run` only for scripts on `main`;<br>• stored probe and baseline results (§2.4), after checking what exists;<br>• refuses to start outside MIRAI's repo; not in the installed file set;<br>• a short page in `docs/` on starting it and on the evening batch | 18a–18h (red team), 17b (baseline) | Every later unit and the pilot preparation wait on these runs | A request for `redteam-cases hook` on a commit returns its result with no result record written; `redteam-full` on the same commit writes one; a request naming an unknown job, an unknown `fact`, a path, or a commit that isn't pushed is refused and logged; a canary credential in your environment and a canary file in your home are unreadable from a `tests` job; a `sample-run` script that isn't on `main` is refused; a probe job reuses a stored result until the tool's version changes; the runner started in another repo exits with a message; the installed file set doesn't contain it |
