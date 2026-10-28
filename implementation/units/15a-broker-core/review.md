---
unit: "15a"
date: 2026-10-28
reviewers: Tech Lead, Architect (independent, read-only, no network, no Docker, no model)
verdicts: Tech Lead "approvable after fixes" (two Medium); Architect "approvable after fixes" (six Medium); no Blocker or High; every Medium and Low fixed or recorded, tests added, the direct probes re-run on the fixes
---

# Unit 15a — Review

Both reviewers worked on a frozen tree. They made no network calls, ran no Docker and no
`claude`, read no secrets and changed nothing in the repo.
- **The Tech Lead** ran the broker, server, strict, sign and store tests (56/56), plus
  reproductions in its own folder under `/private/tmp` (removed afterwards).
- **The Architect** ran the broker, server and strict tests (29/29).

**What held up:**
- **Arguments:** non-objects, arrays and extra keys are refused, an own `__proto__` and
  `constructor` included. So are `item` and `by` as arguments, and `template` or `section` on a
  note. A message under 4,000 characters that's over 16 KB as JSON is refused cleanly and
  doesn't use a slot.
- **No races:** the cap check, the line check and the append run without an `await` between
  them.
- **The slot:** `log_event` doesn't take or free the test slot, and a second test call is still
  `busy`.
- **Stopping:** a stopped or tampered server refuses `log_event`, and the trust root is checked
  on log calls.
- **The refactor changed no behaviour** of `run_tests` and `run_check`, per the Tech Lead's diff
  against 14d.
- **The journal:**
  - `agent` lines are refused on privileged types, and `launch_id` goes with `agent` in both
    directions;
  - each line's own version names its signature context: a version-2 signed line verifies, and
    the same line relabelled as version 3 fails (reproduced, and now a test).
- **`by: "agent"`** fits D-17 (Architect). It's unauthenticated, like `unverified`, so nothing
  may derive state from it, and nothing does.
- **The input folder:**
  - names, count, size and types are checked before any folder is made;
  - the files are 0400 in a 0500 folder, and `removeLaunch` opens both;
  - `--add-dir` is added only with inputs;
  - every launch write-denies `input/`, and `checkInit` expects exactly the added folder.
- **The server writing the journal from outside the sandbox** is acceptable (Architect):
  - the policy is pinned by its hash and write-denied, and the store comes from the policy, not
    git;
  - the store's mode is checked, the line goes through the journal's own check, the item comes
    from the policy, and the journal lock orders writes.
- **The split holds** (Architect), apart from the owners noted below. The table's shape fits
  19's `start_agent`/`agent_status` and 43's `trace`.
- **Stack-neutral and no personal data:** both hold.
- **The b2 probe redesign** (the canary only in the file) caught a false pass. Both reviewers
  called that good probe discipline.

## Fixed in unit 15a

| # | Finding | Severity, from | Fix | Test |
|---|---|---|---|---|
| 1 | **The 50-line cap was per server process, not per launch,** and a failed append still used a slot. An agent can end the server (a message over 1 MiB), and if Claude Code restarted it, the count would start again at 0 | Medium, Tech Lead (also Architect, Low) | The count is kept in the launch folder (`<launch>/log-events`, which the agent can't write: the hook and the MIRAI home), and it goes up only after a line is written. The server keeps no per-tool state; the policy gains `launch_dir` | T3: a fresh server on the same launch is still `log-full`; refused and busy calls don't count. Checked by mutation |
| 2 | **The spec didn't match the build:** the input mechanism, the canonical hash, `item`, the file names, and agent lines in `mirai status` (never built; `status` shows no journal notes at all) | Medium, both | The spec's "Changes after testing and review". The display of agent lines moves to unit 46 (the inbox) on the roadmap: shown as the agent's, through `shown()` | — |
| 3 | **`log_event` skipped the secret check** that the hook makes on everything an agent writes | Medium, Architect | The token, in any encoding, and the template's secret shapes are refused, never redacted. The shapes travel in the policy | T3: a key shape, the token and its base64 in any field. Checked by mutation |
| 4 | **The roadmap's split was only in the description:** row 15's checks had no owners, row 19 didn't name the verbs, the token or G24, and row 43 didn't mention the broker | Medium, Architect | Each of row 15's checks names its unit. Row 19 gains the verbs, the token minted in the broker, G24, the moved check and the input contents, and depends on 15a and 15b. Row 43 gains its tool-table entry | — |
| 5 | **The trust-root skill export, the findings and the ACs as inputs had no owner,** and `template_gap` had two paths | Medium, Architect | Row 19 fills the input folder with all of them. D-53 says `template_gap` keeps both paths on purpose: `log_event` during a run, structured output at its end, de-duplicated by launch in unit 19 | — |
| 6 | **The canonical hash didn't cover the launch flags,** and 15a showed that a flag (`--add-dir`) changes what sandboxed commands may write | Medium, Architect | It hashes the settings, the template's `mcp` field and the canonical launch flags, with and without an input folder. Hashing the server and hook code is noted for unit 18 | strict T7 (the `mcp` field) |
| 7 | **The control, bidi, invisible-only and lone-surrogate characters** in agent text | Low, Tech Lead | Refused at the source; newlines and tabs are fine | T3 (and by mutation) |
| 8 | **A busy journal lock froze the server for up to 30 s** (a synchronous wait), progress and cancels included | Low, both | `log_event` waits at most 2 s (`appendEvent`'s new `lock` option), then answers `journal-busy` | T3: another process holds the lock; answered in under 5 s, not counted |
| 9 | **D-53's recursion guard lived only in the policy writer** | Low, Architect | Each tool names its `contexts`, and the policy its `kind` (`headless`). A policy that offers a tool outside its kind stops the server at start | T1, T6 |
| 10 | **Store paths weren't hidden** when the store's path differs from the MIRAI home's | Low, Tech Lead | `<store>` and `<launch>` are hidden too. The docs now say the policy files are readable from Bash by design (the paths are denied anyway) | T3 (no store path) |
| 11 | **`checkInit` threw** on an `additional_directories` that isn't a list | Low, Tech Lead | Reported as a problem | strict 15a T8 |
| 12 | **The template's `mcp` field wasn't checked,** so a bad one failed late at the server | Low, Tech Lead | `renderStrict` refuses it | strict 15a T8 |
| 13 | **The tests:** "no git" only counted calls; "signed lines still verify" across 2→3 wasn't tested; b2 didn't require each write attempt to be refused | Low and Note, Tech Lead | T3 shows the checkout isn't a repo (any git call would fail); a new sign test for a version-2 signed line and its relabelling; b2 now requires 6 of 6 refusals | Checked against the saved runs: 6/6 on the final run, 5/6 on the run with the hole |
| 14 | **`claude.md`, `agents.md` and the like were valid input names** (on APFS, `claude.md` is `CLAUDE.md`) | Low and Note, both | Refused | strict 15a T8 |
| 15 | **Design drift:** 03-components rows 47, 94, 101 and D-12's path | Low, Architect | Updated | — |

## Noted for later units

| Unit | Note | From |
|---|---|---|
| 15b | <ul><li>A policy `kind` for your session, and `contexts` per tool;</li><li>how D-54 and the trust root work in a long, unsandboxed session (`.git` changes with every commit; the trust root moves with the integration branch);</li><li>the `by` and id model for lines from your session (journal version 4 if `launch_id` loosens);</li><li>rewriting and re-hashing the policy for a local-scope server;</li><li>`lint` paths held to `run_tests`' rules</li></ul> | Architect |
| 18 | <ul><li>Red-team rows: Bash `chmod`, `mv`, `ln`, `touch` and `rm` on `input/` and `input/files/`; Write, Edit and NotebookEdit into it;</li><li>a work-tree symlink into it, then an Edit through the link; another launch's input folder; Read on `input/*.json` versus Bash `cat`; Glob and Grep into it;</li><li>`log_event` with privileged types, a forged `item`, `by` or `launch_id`, a flood, a restart, terminal escapes and bidi characters, the token and secret shapes;</li><li>`node <trust>/bin/mirai.js` with a faked HOME;</li><li>key the red-team result on the MCP server's and hook's code too, not only the bundle</li></ul> | both |
| 19 | <ul><li>Fill `inputs` (plan, delta diff, findings, ACs, the skill export) and check that 4 MiB holds a large delta;</li><li>set `item`; record `launch_id` in the run log, so agent lines join their run;</li><li>`start_agent` with an interactive context only, and the launch token minted in the broker; G24;</li><li>de-duplicate `template_gap` from `log_event` and the structured output;</li><li>treat agent-written journal text as untrusted when it goes into another agent's inputs;</li><li>tools may need an output schema, and long non-exclusive calls an abort signal</li></ul> | Architect |
| 43 | `trace` as a read-only, non-exclusive table entry, with an abort signal if it can be slow | Architect |
| 46 | Agent lines shown as the agent's, only through `shown()` | both |
