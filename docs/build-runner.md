# The build runner

A tool for **building MIRAI itself** (unit 29e; `design/10`). It runs the jobs a building session
can't run on its own (unit tests, probes, the sample app's baseline, the red team), in your name,
while you're away. It lives in `tools/`, which MIRAI never installs into a project.

## Starting and stopping it

In a real Terminal, in MIRAI's repo:

```bash
cd ~/Projects/mirai && caffeinate -i node tools/build-runner.js
```

It says what it will do and asks once:

```
Run the fixed jobs in your name until you stop it? [y/N]
```

Answer `y` and leave the window open. It prints one line per job. **Ctrl-C** stops it, and its
permission ends with it.

It refuses to start:
- without a real terminal;
- outside MIRAI's repo (the package `mirai`, with origin `jetmirhaxhisefa/mirai`);
- without the sample app (`~/Projects/mirai-sample-app`, or `MIRAI_BUILD_SAMPLE`) and its MIRAI
  store.

## How a session uses it

Everything lives in `~/.mirai-build/`, outside every repo.

1. **Push the commit.** It must be on a branch of MIRAI's GitHub repo.
2. **Write a request** to `requests/<id>.json`:

   ```json
   { "id": "29e-hook-1", "job": "redteam-cases", "arg": "hook", "commit": "<40-character hash>" }
   ```

3. **Read the result** in `results/<id>.json`: the state (`running`, `pass`, `fail`, `refused`,
   `error`), the minutes and a summary. The full output is in `results/<id>.log`.
   `runner.log` has one line per request: the job, the commit, its branch, its diff against `main`
   and the outcome.

### The jobs

| Job | What it runs | Argument |
|---|---|---|
| `tests` | MIRAI's unit tests, on a clean export of the commit | none |
| `probes` | one file from `test/probes/` | the file name; its result is reused until the file or a tool version (Claude Code, Docker, git, Node) changes |
| `baseline` | `mirai baseline` on the sample app | none |
| `redteam-cases` | only some red-team cases: **feedback only, never a result record** | one fact the cases carry (`hook`, `bundle`, `G17`, …), or case ids |
| `redteam-full` | the full red team, which writes a result record | none |
| `redteam-session` | the session red team | none |
| `sample-run` | a script from `tools/runs/` **as it is on `main`** | the script's name |

A request can't name a command, a path or a flag. Anything else is refused and logged.

## What it does in your name

**`tests`** runs in a clean export, with nothing of yours:
- no SSH agent;
- no git, GitHub or GitLab credentials;
- no Claude token;
- a home folder and a temp folder of its own.

**Sample-app jobs** use `~/Projects/mirai-sample-app` with your real MIRAI store and keys, as when
you run things by hand. Before each job, the runner itself (not the job):

1. **Checks the checkout.** It must be on `main`, clean, and level with `origin/main`. If not, the
   job is refused. The runner never resets, stashes or overwrites anything.
2. **Refreshes MIRAI** from the requested commit (`mirai init --refresh`).
3. **Commits and pushes `main`.** The commit is "MIRAI refresh: <branch> at <commit> (build
   runner)", with a `MIRAI-Build-Commit:` line.
4. **Records the baseline.**

The job then runs without any credential variable.

The sample app's `main` keeps that commit's MIRAI until the next refresh, as it does today.

**The red team** accepts the runner in place of your terminal while the runner is alive. The runner
writes a record in the sample app's store when you start it, and removes it when you stop it. Only
`redteam run` and `redteam run --sessions` accept it. Your gates (approve, unpark, drop, discard,
merge, keys, token, `gate record`) never do.

## What it can't do

- **Count for a real project.** A red-team result on the sample app is for building MIRAI. Thudos
  and every other project need a run you start there yourself.
- **Run your gates**, approve a spec, or merge.
- **Run a script you haven't approved.** `sample-run` takes scripts from `main` only. A unit adds
  its run script in its spec PR.

**The limit that stays:** a session could weaken a red-team case, then ask for a run. The
protection is the same as today: you read the unit's diff before approving it, and the full run's
report lists the cases that ran.

## The evening batch (a habit, no code)

1. In the evening, approve the specs of the next two or three units.
2. The session builds them in order overnight, with the runner checking each one. Before asking you
   to approve a unit that touches the cage, it runs `redteam-full` on that unit's last commit.
3. In the morning, review the finished units.
