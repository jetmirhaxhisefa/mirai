# Unit 29e: test results (2026-11-18)

Each result below names the commit it ran on (`unit/29e-build-runner`). The runner itself was
started by Jet in his Terminal, three times as fixes landed.

## Tests

- `test/tools/build-runner.test.js`: 15/15. The tests:
  - T1–T9;
  - the branch naming;
  - the "still running" line;
  - partial red-team runs;
  - the folders.
- The full suite: **652/652**.
  - In this session at `2d28883`: 649/649.
  - Through the runner's own `tests` job, inside its sandbox, at `266c21e` (`p9-tests`, 11.7 min):
    652/652.

## Probes (real, on this Mac, through the runner)

| Probe | Request | Result |
|---|---|---|
| P1 canaries | `p1-canary`: `tests` on `addea46` (branch `probe/29e-canary`, never merged) | **pass**, 651/651. The canary file in the real home: `EPERM`. The canary variable `MIRAI_29E_CANARY`: not in the environment. `HOME` was the job's own folder. |
| P2 partial run | `p2-hook`: `redteam-cases hook` on `298170a` | The 6 `hook` cases passed, 3/3 each, in 24 s. "a partial run is never recorded": no record. |
| P2 full run | `p2-full-2`: `redteam-full` on `2d28883` | **GREEN**: 324 runs in 11 min 39 s, signed, recorded. The known limits `h-timeout-link` and `l-cd` were accepted on 2026-11-07. |
| P3 shared store | checked in the code before building | `openStore` refuses a second checkout (`second-checkout`, D-52) and a changed integration branch. Decision 2 was changed with Jet. |
| P4 queue | `p1-canary`, `p2-hook`, `p2-full`, queued together | They ran in order, with nobody at the keyboard; one runner line each. |
| Session red team | `p6-session` on `2d28883` | **GREEN**: 175 runs in 4 min 41 s; no promise broken. |
| Probe reuse | `p8-probes-git`, then `p8-probes-git-again`, on `266c21e` | Ran (pass, 0.6 min), then **reused** without running. |
| Refusal | `p7-bad`: `redteam-cases` with `../etc` | **refused** and logged: "needs one argument: a name, never a path or a flag". |
| No terminal | `!` in a Claude Code session | refused: "start it yourself, in a real terminal". |

## Found while building, and fixed

1. **P3:**
   - a worktree can't share the sample app's store;
   - the runner now uses `~/Projects/mirai-sample-app`'s `main`, as by hand (Jet's decision);
   - the checkout must be clean, on `main` and level with origin, or the job is refused.
2. **A home closed by `HOME` alone isn't closed:**
   - a test could read your files by their full path;
   - the `tests` job now runs inside `sandbox-exec`, with the real home denied except the job's
     folder.
3. **macOS refuses `/bin/ps` inside any sandbox** (checked in Jet's own Terminal):
   - `ps` is a setuid program, and MIRAI's tests use it;
   - the profile lets exactly `/bin/ps` start outside the sandbox.
4. **A space in the path breaks MIRAI's tests:**
   - "Application Support" caused 136 failures (`%20` file URLs);
   - the runner's folders moved to `~/.mirai-build`.
5. **Path limits:**
   - a key-holder socket path went over macOS's 104 characters;
   - one test expects `/private/var/folders`;
   - the `tests` job uses macOS's own temp folder, opened in its sandbox.
6. **Exports are git checkouts** (a clone of the local repo): one test expects a git working copy.
7. **Red-team jobs keep `SSH_AUTH_SOCK`:**
   - the red team's S5 control must reach the SSH agent from outside the cage;
   - without it, every full run would be INCOMPLETE;
   - the variable hid nothing anyway, since MIRAI finds the socket through launchd.
8. **The first full run was RED on `pr-test-run`:**
   - a leftover container was the cause: Jet's Storybook preview from the pilot (`sweet_germain`,
     from the `mirai-bkt-49` image, running for 22 hours);
   - the red team counts any container with MIRAI's label;
   - the container was stopped, and the rerun was green.
9. **Probes:**
   - most probe files ask for `--yes`, so the job passes it;
   - only passing probe results are stored (a non-run had been stored and reused).
10. **The runner's window:**
    - a "still running" line every 5 minutes, with the job's latest output;
    - a commit's branch is the one whose tip it is, before any other branch that contains it.

## Noted for later (not fixed here)

- **The red team's leftover check:** it counts any container with MIRAI's label, including a
  ticket image someone runs by hand (the preview above). It could name the container and its
  image, or count only the run's own project. Item 8 above; a pilot-style finding.
- **`sample-run` hasn't run for real:** there's no script under `tools/runs/` on `main` yet. The
  refusal for a script not on `main` is tested (T1). The first unit that adds a run script is its
  real test.
- **The `baseline` job's real run** happened inside each sample-app job's refresh step (`p2-hook`,
  `p2-full`), not as its own request.
