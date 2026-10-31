---
unit: "18c"
date: 2026-10-31
reviewers: Tech Lead, Architect (independent, read-only, no network, no Docker, no model)
verdicts: Architect one Blocker (Docker down), Tech Lead none; thirteen Highs between them, several shared; none weakens MIRAI's real limits, all are about the red team's own evidence; fixed or owned, with three decisions for you
---

# Unit 18c — Review

**What held up (both):** the copy, freeze and allowlist under hostile work-tree files; script lines can fail
a case but never pass one; the red-team parameter can't be reached from the MCP tool; no deadlock in the
Docker queue; one repo id per worker; shipping the probes in `src/` (nothing imports them from the MCP,
launch or test code, and they need Docker's socket, which the sandbox denies); image ids left out of the key.

## Fixed

| # | Finding | From | Fix | Test |
|---|---|---|---|---|
| 1 | **A false green:** Docker dying mid-run made cases pass as "not applicable" under a key naming a real Docker. With it off from the start, two cases went falsely red | Blocker, Architect; High, Tech Lead | Docker down or missing is inconclusive. "Not applicable" only with no test containers | T3, T6 |
| 2 | **The search control proved nothing:** the script contained the control's text and found itself, and it never showed the copy was searched | High, both | MIRAI plants random controls in the copy, one in a spaced name; both must be found. An env canary git doesn't ignore tests the copy's own rule | T3, T4 |
| 3 | **Word-splitting:** a leaked secret in a path with spaces went unseen, and a `HOME` with a space was never tried | High, Tech Lead | `while read` loops, quoting | T4 runs the script |
| 4 | **A route out could be missed:** a connection counted only with a body | High, Architect | Status and `nc -z` count; `gateway.docker.internal` added | T3 |
| 5 | **The race could pass untested:** every call refused still counted; the loop leaked unless the command matched exactly | High, Architect; Medium, Tech Lead | A call must really go through; the loop is always stopped | T7 |
| 6 | **`adv-network-real` could pass after a real fetch,** if a later call used the same words | High, Tech Lead | Each result judged against the calls up to it; a broader page match | T7 |
| 7 | **The output-folder row was mostly untested:** nothing checked the links existed or how MIRAI treated them | High, Tech Lead | Checked on the host; a report read through a link fails; unexercised rows dropped and recorded | T3 |
| 8 | **Your own secrets in a container had no case** | High, Architect | Canaries under `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `GH_TOKEN` in the caller's environment | T3 |
| 9 | **The gate row wasn't delivered** | High, Architect | `c23-gate-home` on the real signed path, with a throwaway key in the fixture | `pr-test-run` |
| 10 | **Mediums:** `r-input-agree` passing on a missing file; a successful Read counted as the Edit attempt; abort not reaching Docker; a home finding lost if later evidence threw; the Dockerfile marker unchecked; `leftovers` ignoring Docker's answer; `ct-paths` not saying why it refused, and lost rows; custom adapters and Compose's version missing from the key; no late home check; `redTeam` accepted with your own store; a known failure that stops failing unreported | both | All fixed | T3–T7 |
| 11 | **Docs:** stale counts, an overclaim about re-checking, the race with no limit stated, row handoffs missing from 19, 24, 51 and 54 | both | Corrected | T1 |

## Decisions for you

1. **Wider blockers (applied, as the Architect recommends):** a write reaching your checkout or its `.git`, and the branch's mounts in the frozen file, are blockers. D-48 names `.git` writes as code execution through host git. Say if you want them red only.
2. **Docker facts:** most probes record a fact and can't go red. Corrected in the docs now. A stored baseline that goes red when a fact changes would catch more, but needs a reviewed list of which facts matter. My recommendation: a small later unit, before the pilot.
3. **The probes every run or only on a change:** your approved rule, decided on the next run's time. The Architect's carry-over rules, if needed: same Docker, Compose, file sharing, macOS and framework (or git and framework), from a signed green that ran them itself, at most 30 days old, and shown as `carried`, not `pass`. That's a real addition, so I'd rather raise the target for now if it's only slightly over.

## Noted for later units

- **Unit 19:** `run_tests` through the real MCP server with real Docker; `redteam run` refusing unless it runs the trust root's copy; a launch matching Docker's version to the result.
- **A larger project** will take longer than the sample app: time grows with its levels and start-up. 15 minutes is the sample app's target.
- **Lows left:** `nginx:1.27-alpine` is a mutable tag; `head -200` could hide a hit past 200 files; once-only cases multiply if a project has several read-write templates.
