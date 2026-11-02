---
unit: "19c"
date: 2026-11-02
reviewers: Tech Lead and Architect, then one independent review of the fixes (read-only, no network, no model)
verdicts: two Blockers and several Highs in the first round; no Blocker and one High in the second; fixed
---

# Unit 19c — Review

## First round

| Finding | From | Fix |
|---|---|---|
| **Blocker:** `launchInRun` launched with no token and no lock (verified) | both | It spends a token and checks the caller holds the lock for its run |
| **Blocker:** every launch from a session would be refused as stale: the worker's empty environment had no `SSH_AUTH_SOCK` (verified) | Tech Lead | The socket from launchd when the environment has none |
| **High:** `launchInRun` ended the run after each launch | Architect | Only the run's owner ends it |
| **High:** a worker stuck "queued" or "running" for good; killing one left its agent unsupervised | both | Pid and start time recorded, `lost` shown; the worker handles signals like Ctrl-C |
| **High:** `status` didn't say whether start_agent asks you | Tech Lead | It does, across your settings files |
| **High:** the roadmap row dropped notes for units 20, 21, 24, 28, 29 | Architect | Restored |
| **Medium:** a forged request could set the launch's folder or environment; the reply reached your session unmarked; the token's limits left out a branch's hook and look-alike server; "asks you" and "logged like a run's" overclaimed; G24 named two questions; one session slot for all windows | both | Re-checked; `reply_untrusted`; the docs say exactly what holds; G30; stated |
| Low | both | Fixed, or stated |

## Second round (of the fixes)

| Finding | Fix |
|---|---|
| **High:** a branch's settings file linked to `/dev/zero` hung `status` (verified) | Plain, small files only |
| **Medium:** a worker that never started stayed "queued"; a reused pid looked alive; the ssh fix matches only an agent's presence | The worker's pid and start time from the start; stated |
| Low: the lock's repo, two sessions starting at once, a machine-bound test | Fixed |

The second round's fixes weren't reviewed again; each has a test, and R1/R2 and the sessions red team ran on them.
