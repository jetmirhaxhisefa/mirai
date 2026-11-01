---
unit: "18e"
date: 2026-11-01
reviewers: Tech Lead, Architect (independent, read-only, no network, no model)
verdicts: no Blocker from either; "not ready" before the fixes: promises could read "holds" with nothing behind them, and the signing finding was under-scoped
---

# Unit 18e — Review

**What held up:** isolation from launches (folder, key, signing context; the headless status untouched); no route to real files found; a through can't be retried away; stored results hold no output.

## Fixed

| # | Finding | From | Fix |
|---|---|---|---|
| 1 | A dead server read as "held" (verified with `/usr/bin/false`) | High, Tech Lead | Only MIRAI's own `refused` counts; a control note in the same process first; exit and text asserted |
| 2 | `d-lint-link` couldn't see a leak: lint doesn't echo that content, and the first link's refusal hid the others | High, Tech Lead | A shape lint echoes, a plain copy as control, one call per link, the refusal code asserted |
| 3 | `d-log-text` displayed nothing | High, Tech Lead | Reads `status --json`; checks the whole set; records that nothing prints a note's text yet |
| 4 | A refusal wasn't tied to the rule or the call; controls only in bypass | High, Tech Lead | The exact call's own answer, in Claude Code's words for a rule; a control per promised attempt and per mode for the main ones; no writes in plan |
| 5 | `drop` could hide behind `approve`'s message | High, both | Each on its own output, exit and state; `drop` and `token clear` tried through `script` too |
| 6 | `agent-general` could hold without a subagent | High, Architect | The Agent call and the subagent's own Read refused, plus a control |
| 7 | The look-alike's "holds" was a `-p` artifact | High, Architect | No promise; a bypass variant; docs say you'd be asked |
| 8 | **The signing finding was too narrow** | High, Architect | Restated: a session can read the key and token. D-17, D-34, signing.md, the store's comment corrected; row 29b, with what collides |
| 9 | A cleanup error could replace a result; the key described the work tree; warnings cut at 64 characters; docs overclaims and stale claims; a missing token check; thin tests; hints; notes | Medium, Low | Fixed |

## A second review, of those fixes (you asked for it; read-only, no model)

No Blocker; three Highs, all in the fixes or left by them. The code had 12 green tests and these got past them.

| # | Finding | Fix |
|---|---|---|
| 1 | **High:** my fix for cut-off warnings let a hostile branch print raw escapes and a forged `warning: all clear` through `mirai status` (verified) | `plain()` on every warning, moved to `status/text.js`; a test |
| 2 | **High:** `agent-general` could hold, and its control pass, with no subagent read: nothing said whose Read it was (verified). The docs' subagent line rested on that | The stream's `parent_tool_use_id` is kept; only a Read under the Agent call counts, both ways; a test |
| 3 | **High:** `d-lint-link` held when its whole-project half died or returned a fault (verified) | The whole lint must run, in full, and show the control's word |
| 4 | **Medium:** `ranIt` matched "token" in any output; `b-hook` "refused" on an API error; a server that can't spawn crashed the suite; the warning silent with no integration ref; a title and a doc line claiming more than tested; no tests for these | Fixed; `cat ~/…` isn't promised, only the full path |
| 5 | **Low:** an abort counted a partial promise as holding; rehash could pass with no swap; a partial run's report; counts in the docs | Fixed |

## Left, and named

- `mirai key` through `script`, and `git config` from Bash: row 18e.
- `realFolderFacts` covers `~/.config/mirai`'s top level only; the real store isn't compared, since a real run writes there. The docs say what's compared.
- T1 is a kept list of ids. `--max-turns` doesn't cap a subagent.

## Decisions for you

1. **Row 29b:** your key and token at rest, before the pilot. Costs are in the row.
