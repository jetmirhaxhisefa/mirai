# The test baseline

The gate checks **"nothing new broke", not "everything is green"** (D-45). A project MIRAI joins
often has tests that already fail, or fail now and then. The test baseline records them for the
integration branch's commit, so they never block new work, while a new failure does.

```sh
mirai baseline                    # record it for the integration branch's current commit
mirai baseline --level unit       # only this level (repeatable), merged into that commit's baseline
mirai baseline --force            # run it again, though the commit has one
mirai baseline show [<commit>]    # print a stored one (the integration branch's, by default)
```

## Before you run it

- MIRAI installed and its trust root built, and **your signing key committed** on the integration
  branch (`mirai key new`, then commit the `.pub`): the baseline and every run in it are signed.
- **A clean tree with HEAD on the integration branch,** at the commit its remote has: the baseline
  is that commit's. It's checked before, during and after, as `mirai test --gate` is.
- Docker Desktop running: every level and check runs in the project's containers (14c).

## What it does

1. **Every named check and test level runs whole,** checks first, one at a time. A level whose
   test adapter has `[coverage]` runs with coverage. Each run is a gate run: its result is signed.
2. **Each file with failing tests runs again** (one container run per file), and each failing
   test's outcome is read from that run:
   - **`flaky`:** it passed and failed. A test that passed first and failed in a rerun of its
     file is flaky too;
   - **`failing`:** it failed every time, 10 runs in all;
   - **`unchecked`:** anything else, with the reason: a limit was reached (10 runs a file, 50
     reruns a baseline, 50 files a level), the rerun didn't run it (it loads under another name),
     or a rerun was an environment fault.

   Each is a **known failure of that test** (`scope: "test"`). Only whether it's flaky is in
   question, for units 26 and 52. A test whose file failed to load is listed by its own ID too.
3. **A whole-level failure** is one known failure with `scope: "level"` and its `kind`, not rerun:
   - `load` (the tests didn't load), `not-found` (nothing ran), `error` (the run exited non-zero
     with nothing failing in its report: a runner failing on warnings, a coverage threshold);
   - `no-ids` (a named check, or a level without a test adapter, failed);
   - `unmapped` (failing cases whose file isn't a project path).
4. **An environment fault or refusal is never a known failure.** A timeout, a missing report or
   coverage, a Docker error, a refused compose file: that level is `env-fault` or `refused`, and
   the baseline `complete: false`. `mirai baseline` exits 5 ("needs you") then, and the next run
   completes it: only those levels run again. A change to the tree or HEAD during the runs stops
   the whole baseline, and nothing is written.

**The rule for units 25, 26 and 54** (what "doesn't block" means):
- a branch's failing test is known only if the same test ID is a known failure of that level;
  every other failing test ID is new;
- a level-wide known failure covers only the same level-wide outcome (`kind`) on the branch; it
  never covers a failing test ID;
- a named check or a level without test IDs that already fails (`no-ids`) can't be compared: a
  branch's failure there is "can't tell" (it needs you), never "known";
- `knownFailures()` returns `null` ("can't tell") for a level that's `env-fault`, `refused`, or
  missing from the baseline, and whoever reads it checks `complete`.

**Growth.** The known-failure list may only shrink automatically (AR3-11). Each baseline records the
previous commit's (`growth.previous`, with its file's hash) and the known failures it adds
(`growth.added`). `mirai baseline` shows them prominently (something broke on the integration
branch); an automatic refresh (unit 28) passes `refuseGrowth`, which stops with `baseline-grew`
so you look first.

## What it keeps

`<store>/baseline/<commit>.json`, the one home (AR3-11), signed with your key; the last 10
commits' are kept. The file holds the commit, branch, time, MIRAI's version, the trust manifest's
hash, the config's checks and levels, `complete`, the rerun `limits`, `growth` and `gaps`; for each
level and check:
- `kind`, `state` (`pass`, `fail`, `env-fault`, `refused`, with its `code` and `message`),
  `duration_ms`, `recorded_at` and the MIRAI version that ran it;
- the signed run's id and its result's hash (`run`), and each rerun's (`reruns`: file, id,
  outcome, result hash);
- the test counts and the hash of every case (`cases.json`);
- its known failures: `{ id, scope, kind?, state, runs, failed, first?, reason? }`;
- with coverage: the summary, and **the files it measures** with a hash of the list, so unit 26
  can see a branch stop measuring a file.

The runs themselves are kept with the test runs (`<store>/tests/gate/`, the last 100), so a
baseline outlives its runs' files; its hashes still name exactly what ran.

And the **gaps**, reported and never turned into tickets (D-45), each `{ level, code, text }`:
`no-adapter`, `no-coverage` (the adapter has none), `skipped`, `coverage-missing` (this run left
none), `duplicate-ids` (a test ID appears more than once in a run: a runner's several projects),
and `no-e2e` (no level named `e2e` or required for critical journeys: a name, not a stack).

A baseline whose signature doesn't verify with the integration branch's keys, or that names
another commit, is refused (`baseline-invalid`), never read as "none": record it again with
`mirai baseline --force` (`--level` won't merge into it). One baseline is recorded at a time per
repo (`baseline-busy`).

## What it doesn't do

- **Compare a branch with it:** units 25 (the gate record), 26 (pre-push) and 52 (rerunning a
  flaky test at ticket time).
- **Refresh itself:** the orchestrator (units 28, 52) calls the same library at the start of every
  run, with `refuseGrowth`; the baseline is then signed with your key unattended, as gate runs
  are. Until then, run `mirai baseline` after the integration branch moves.
- **Find flaky tests that passed:** only failing tests are rerun. A flaky test that passed in the
  baseline shows up when it fails in a ticket, where unit 52 reruns it.
