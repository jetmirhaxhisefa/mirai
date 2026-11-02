---
unit: "19b"
date: 2026-11-02
reviewers: Tech Lead and Architect, then one independent review of the fixes (read-only, no network, no model)
verdicts: no Blocker in either round; three Highs and three Mediums in the first, two Highs in the second; fixed
---

# Unit 19b — Review

## First round

| Finding | From | Fix |
|---|---|---|
| **High:** the ignored-file check did nothing for the author, whose `**` covered them | Architect | Ignored files out of scope for every role unless `may_write.ignored` lists them |
| **High:** a high-risk review wasn't a judgement step | Architect | `review` with high risk is `review-high-risk`, always deep, logged so |
| **High:** a weaker verifier could be called rung 2 | Architect, Tech Lead | A verifier runs at least at the author's tier; dated or suffixed ids are the same model |
| **Medium:** past the budget a change was invisible and the run ok; the budget counted folders | both | Counted per entry; not ok when partial |
| **Medium:** `!` ignored in roles, broken globs accepted | both | `included()`, `globProblem` |
| **Medium:** an odd `--step` or model id lost the log line | Tech Lead | Checked, made safe |
| **Medium:** roles vs the AGENT kind, files left dirty, evidence lost, step defaults outside the config | Architect | Row 21 reconciles roles; rows 20, 22, 28 handle the dirty tree; evidence in the store; defaults in `defaults.js` |
| Low | both | Fixed, or named in the spec's changes |

## Second round (of the fixes)

| Finding | Fix |
|---|---|
| **High:** a planted ignored file passed on the next launch, and the docs said otherwise | Kept on record; launches refuse while it's there |
| **High:** too many ignored files found only after a whole run | Refused before; the limit raised to 200,000 |
| **Medium:** a scope fault hid a security refusal; a large evidence file before the log line, pruned with streams; sparse checkouts could never launch | Reordered; paths only, after the log line, pruned with its stream; a sparse checkout gets its own refusal |
| Low: `__proto__`, unreadable folders, logs skipped silently | Fixed |

The second round's fixes weren't reviewed again; each has a test, and R4 ran on them.
