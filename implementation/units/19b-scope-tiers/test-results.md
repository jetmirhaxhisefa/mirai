---
unit: "19b"
date: 2026-11-02
claude_code: 2.1.316
result: 418 tests; probes R1–R4 on sample-app clones (about 10 runs, 6 of them on Sonnet); no full red team (the bundle and hook are unchanged)
---

# Unit 19b — Test results

All on sample-app clones, with the red-team gate stubbed (a clone has no result).

## Probes

- **R1:** MIRAI's read-only template has no Bash ("No such tool available: Bash"), so a read-only run can't write by any route. A read-write run's Bash wrote `node_modules/.bin/b1-tool`: git doesn't show it.
- **R2:** stat-walking the sample app's 8,952 ignored files: about 0.5 s. (The re-review measured 52,000 at about 0.7 s.)
- **R3:** Sonnet and Opus report their configured ids through the real launch check; Haiku did in 19a. Fable not tried.
- **R4, end to end:**

  | Run | Result |
  |---|---|
  | A reviewer asked to write and edit | ok, nothing changed: it has no write tools |
  | An author writing a new file | ok, the file left for you |
  | A verifier of that author, same model | ok, **rung 3** |
  | An author planting `backend/vendor/bin/b4-tool` (ignored) | **refused**, the path named |
  | The next launch | **refused** (`ignored-pending`) until the file is gone |

  **My probe's first plant was wrong:** `node_modules/` isn't ignored at the sample app's root, so it was an ordinary new file, allowed for an author. Re-run on a really ignored path, on Haiku.

  **Cost:** the first R4 runs used Sonnet, the `standard` tier of the steps they ran, not Haiku as I'd said. The re-run used a light step.

- **Tokens:** a Sonnet run reports 2 to 4 input tokens and 5,700 to 28,000 cached: the cached input is nearly all of it, now logged as `tokens_cached`.

## Not shown

- Rung 2 with a real alternate model (unit tests only).
- A project's own role on a real project.
- Fable through the launch.
