---
unit: "09a"
name: findings-schema
date: 2026-10-24
node: v22.23.2
result: 145 / 145 pass (earlier units' 140 + unit 09a's 5), after the review fixes; 3 full runs in a row green
---

# Unit 09a — Test results

## Run

`npm test` (scoped to `test/**/*.test.js`), after the review fixes (`review.md`). The new file:

```
T1: the corpus: valid outputs pass their schema; invalid ones fail at their path with their code
T2: the validator: the keywords it supports, the ones it refuses, strict JSON
T3: a finding without a citation or a resolvable basis is downgraded; changed lines make others pre-existing
T4: fingerprints: file + symbol + basis, never the line; the run log takes them
T5: failure signatures: runs that differ only in times, durations, ids and paths match; results don't
# tests 145
# pass 145
# fail 0
```

Three full runs in a row: 145/145 each.

**The corpus** (`test/findings/corpus/`): 18 valid outputs and 69 invalid ones, across the five
schemas. Each invalid one names the exact path and code it must fail with. T1 also checks that
no reason repeats the output's text.

**Earlier tests changed:** none.

## The roadmap's "done when", mapped (09a's share)

| Done when | Test |
|---|---|
| a finding without a citation or a resolvable `basis.ref` is flagged | T3 (downgraded, with its reason, for every basis kind) |
| the schema has a test corpus | T1 |

## What came up while testing

1. **My test's run id had the wrong shape.** The run log expects `r-YYYYMMDD-HHMMSS-xxxx`.
2. **After the review, two expectations were stale.** A multi-line repro is now
   `repro-not-run`, and the leak check had flagged my own wording ("critical"), which is now a
   real QA severity.
