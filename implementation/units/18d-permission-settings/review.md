---
unit: "18d"
date: 2026-10-31
reviewers: Tech Lead, Architect (independent, read-only, no network, no model)
verdicts: no Blocker from either; the code is sound; Highs on a row marked done too early, and on no run testing Claude Code's own layers; Mediums mostly overclaims; fixed, or a decision for you
---

# Unit 18d — Review

**What held up:** one renderer, so every template gets the setting and no project config can remove it; the floor reads the real rendered files; no conflict with `checkInit` or S3; the decision on each setting; the honest correction about 18c.

## Fixed

| # | Finding | From | Fix |
|---|---|---|---|
| 1 | The roadmap row said "Done" before any full run on the final bundle | High, both | Reworded; the run is still owed |
| 2 | **No run tests Claude Code's own layers:** S4 only reads MIRAI's render, and the hook answers first, so a weaker `--restricted` would stay green. Reads are the weak side: the hook fails open for them and the read block is off | High, Architect | New cases `l-restricted-read`, `-grep`, `-write`: the hook out, and `--restricted`'s own refusal required. **Not** removing `--restricted` in the shipped suite: that could let a project's files act (Tech Lead M4), so the write block alone stays a one-off probe |
| 3 | The Bash finding overclaimed ("every command") and the `$TMPDIR` remark was confounded | Medium, Tech Lead | Reworded in research/10, the docs and the code comment; rule stated as unknown |
| 4 | The write block was never tried alone where it acts | Medium, Tech Lead | R1b gains it, on Write and Edit |
| 5 | A pass with Bash denied before it ran says nothing about the sandbox | Medium, Architect | Noted per run and listed in the report. Not inconclusive: some cases expect the denial |
| 6 | The docs on what the hook adds, on sessions and on `cat` were wrong or too broad | Medium, both | Rewritten to what was probed |
| 7 | R2's facts unrecorded; D-30 didn't record the decision | Medium, Architect | Both added |
| 8 | R1b's risk understated; token handling and comments in the probe; fragile argument edits; a missing folder notice; T3's title; rename leftovers; a broken table row | Lows, Mediums | Fixed. T3 isn't a test: the hash covers the render by construction |

## For unit 19 (in its row)

**Saved large output (High, Architect):** not a safety hole, since it fails closed, but a real quality risk: test failures sit at the tail, and a reviewer could judge a partial diff. Now a done-when: an agent recovers all of a 60,000-line output and an oversized MCP reply. Redirect to scratch first; a narrow hook exception only if that isn't enough.

## Decisions for you

1. **The write block alone isn't re-checked per version**, and I recommend it stays that way (see 2 above).
2. **One full run, not the spec's two.** The first spec'd run happened on the discarded bundle. One run on this final code covers both purposes.
