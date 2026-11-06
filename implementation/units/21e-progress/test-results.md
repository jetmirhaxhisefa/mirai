---
unit: "21e"
date: 2026-11-06
claude_code: 2.1.319
result: 503/503 tests after the review and re-review fixes; R1 (one Haiku launch, pre-approved) passed
---

# Unit 21e — Test results

## Tests (`npm test`, no model; stand-in `claude`)

- **T1** (`test/agent/run.test.js`): a stand-in streams four tool calls.
  - **The events:** `Edit app/Team.php`, `Bash` (no command), `run_tests unit`, and `Read outside the project`. Turns are counted, and "preparing" comes before "started".
  - **Nothing of the agent's gets through:** its message text, its Bash command and an Edit's strings carry a secret-looking string and a terminal escape. Neither reaches an event or a printed line.
- **T2** (`test/cli/progress.test.js`): the printer, on a fake clock.
  - A tool line inside 5 s of the last one isn't printed. The start and the end always are.
  - A "still working (last: run_tests unit)" line comes after 15 s of quiet, and "unit still running (18 s)" while a level runs.
  - Each check prints as it starts and ends.
- **T3** (`test/cli/progress.test.js`): `mirai status` shows the running step (`ticket SAMPLE-2 (build)`) and its last progress line, from the heartbeat. A progress line with a control character is refused.
- **T4** (`test/agent/build.test.js`):
  - **No baseline** for the integration commit: `mirai build` is refused with `no-baseline`, before any branch or launch.
  - **A stale red team** refuses before the branch, and you stay on `main`.
  - **The checks report each level:** `unit` running, then pass; `feature` running, then "fail (1 new)".
  - **A recheck writes its own `checks` line.**
  - **A baseline that doesn't verify** now refuses before the build starts. It used to end `needs-you` after the launch.
- **The usage reading's age** (`test/loop/guard.test.js` T6): "out of date (5 h old)".

- **From the reviews** (`test/agent/run.test.js`, `test/cli/progress.test.js`, `test/agent/build.test.js`):
  - **Malformed events:** string, number, object and null contents don't throw.
  - **Turns:** three events of one message are one turn, and a subagent's message is none.
  - **Hidden as "a tool" or "a file":**
    - a made-up tool name is "a tool";
    - a path padded with spaces into a fake MIRAI line, a secret-length segment, and a bidi character are each "a file";
    - a backslash path is "outside the project", and a level that isn't the project's is no level.
  - **Long paths** keep their head.
  - **A launch for `docs/prd.md`** still writes its heartbeat, with no ticket and the last line.
  - **The printer:** one "preparing" line, then "still preparing".
  - **`checkJudgeable`:** refuses no levels and a baseline without a level.
  - **A fix round after `main` moved** is judged against the branch's own base, and goes ahead.

- **From the re-review:**
  - `init --refresh` lists `mirai baseline` among its next steps;
  - for an older base than the integration commit, the no-baseline hint says to start the ticket again from the current commit.

## R1: real progress (one Haiku launch, pre-approved; a sample-app clone, the gate stubbed)

```
+12.9 s  Haiku probe (Haiku): started
+14.9 s  Haiku probe (Haiku): 2 turns, 0.18 min — Read backend/composer.json
+20.0 s  Haiku probe (Haiku): 5 turns, 0.27 min — Read frontend/package.json
+27.0 s  Haiku probe (Haiku): 7 turns, 0.38 min — handed over
```

- **The events arrived while it ran,** the first at 14.9 s of 27.4 s.
- **The Bash call** fell inside the 5-second limit, so it wasn't printed.
- **The canary word** the launch was told to say was in its reply, but in no progress line.
- **What changed after it:** the first 13 seconds were MIRAI preparing the launch (its checks, the red-team gate, the trust root's hashes). A "preparing the launch" line now comes first.

## Not proven

- **A real build with MIRAI's test levels:** your next build shows it, after the refresh and one red-team run (`run.js` is cage code).
- **`mirai status` from a second terminal during a real run:** tested on a written heartbeat only.
- **The message after a committed step:** the CLI text was changed and read, but no test runs `mirai build` through the CLI.
- **A rebuild on an existing branch after `main` moved:** the fix round's case is tested, the build's isn't. Both use the same check.
